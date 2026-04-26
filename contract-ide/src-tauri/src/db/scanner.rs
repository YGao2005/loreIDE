use std::collections::HashSet;
use std::path::Path;
use walkdir::WalkDir;
use serde::Serialize;
use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool};
use crate::sidecar::frontmatter::{parse_sidecar, ContractFrontmatter};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub node_count: u32,
    pub error_count: u32,
    pub errors: Vec<String>,
}

pub async fn scan_contracts_dir(
    app: &tauri::AppHandle,
    repo_path: &Path,
) -> anyhow::Result<ScanResult> {
    let contracts_dir = repo_path.join(".contracts");
    if !contracts_dir.exists() {
        return Ok(ScanResult { node_count: 0, error_count: 0, errors: vec![] });
    }

    // Phase 1 (blocking): walk + parse under spawn_blocking. Collect parse/read
    // errors into a dedicated vec (do NOT drop them) and merge them into the outer
    // errors vec after the blocking step returns.
    let contracts_dir_owned = contracts_dir.clone();
    let (parsed, parse_errors): (
        Vec<(ContractFrontmatter, String, String)>,
        Vec<String>,
    ) = tauri::async_runtime::spawn_blocking(move || {
        let mut out = Vec::new();
        let mut errs = Vec::<String>::new();
        for entry in WalkDir::new(&contracts_dir_owned)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("md"))
        {
            let path_display = entry.path().display().to_string();
            match std::fs::read_to_string(entry.path()) {
                Ok(content) => match parse_sidecar(&content) {
                    Ok((fm, body)) => out.push((fm, body, path_display)),
                    Err(e) => errs.push(format!("Parse {path_display}: {e}")),
                },
                Err(e) => errs.push(format!("Read {path_display}: {e}")),
            }
        }
        (out, errs)
    })
    .await
    .map_err(|e| anyhow::anyhow!("spawn_blocking join error: {e}"))? ;

    // Phase 2: duplicate detection + upsert sequentially.
    //
    // NOTE: Phase 2 keeps scan best-effort per-sidecar rather than wrapping in a
    // single transaction. A partial scan (one bad row skipped, rest upserted)
    // leaves SQLite in a usable state — which is what the watcher (02-03) also
    // produces. A future phase can add BEGIN IMMEDIATE / COMMIT around the loop
    // if atomicity becomes observable (e.g. the graph renders half-scanned
    // state visibly). For Phase 2 the UI surfaces ScanResult.errors instead.
    let instances = app.state::<DbInstances>();
    let db_map = instances.0.read().await;
    let db = db_map
        .get("sqlite:contract-ide.db")
        .ok_or_else(|| anyhow::anyhow!("sqlite:contract-ide.db pool not loaded"))?;

    // Wipe stale graph state from any prior repo before re-populating. The
    // SQLite cache is ambient (not repo-scoped) so opening a different repo
    // would otherwise show the previous repo's nodes layered on top of the new
    // one's. The .contracts/ files on disk are the source of truth — wiping
    // the cache and re-upserting from sidecars is safe and idempotent.
    //
    // Order matters: delete child rows first to avoid orphans even if FK
    // enforcement gets turned on later. Receipts (session-scoped, not
    // repo-scoped) are intentionally preserved across repo switches.
    let pool = match db {
        DbPool::Sqlite(p) => p,
        #[allow(unreachable_patterns)]
        _ => return Err(anyhow::anyhow!("non-sqlite DbPool variant")),
    };
    for stmt in [
        "DELETE FROM rollup_derived",
        "DELETE FROM receipt_nodes",
        "DELETE FROM drift_state",
        "DELETE FROM node_flows",
        "DELETE FROM edges",
        "DELETE FROM nodes",
    ] {
        sqlx::query(stmt).execute(pool).await?;
    }

    let mut seen = HashSet::<String>::new();
    let mut errors = parse_errors; // merge walk-phase errors first
    let mut n: u32 = 0;

    // Upsert parents before children. parent_uuid has a FK to nodes(uuid), so
    // a row whose parent isn't already inserted trips the constraint and the
    // upsert is dropped (errors.push, continue).
    //
    // Level-only ordering (the prior heuristic) covered most repos because the
    // L0→L1→L2→L3→L4 hierarchy guarantees children sit at a higher level than
    // parents. It breaks for `kind: flow` contracts whose `parent` points at a
    // sibling-level surface (an L2 flow whose parent is the L2 screen surface
    // it triggers from), which is what the codebase-to-contracts skill emits
    // when wiring flows into existing UI hierarchies. Within-level walkdir
    // order is unstable, so the flow row would silently disappear from the DB
    // whenever it landed before its same-level parent.
    //
    // Topological insertion: keep the level sort as a hint (most rows clear in
    // one pass), then iterate, deferring any row whose parent isn't yet in the
    // `inserted` set to the next pass. Stops when a pass makes no progress;
    // anything still pending after that has an unsatisfiable parent (orphan or
    // cyclic reference) and gets logged.
    //
    // Cost: O(N) when no within-level dependencies exist (single pass), worst
    // case O(N²) for a chain of N rows each parented to the previous. At
    // hackathon corpus sizes (~500 rows) the worst case is sub-millisecond;
    // for Phase 14's bootstrap-demo-target (potentially much larger generated
    // trees) we expect a small constant number of passes since flows-of-flows
    // chains stay shallow.
    let mut parsed = parsed;
    parsed.sort_by(|a, b| a.0.level.cmp(&b.0.level));

    let mut inserted = HashSet::<String>::new();
    let mut pending: Vec<_> = parsed;
    loop {
        let mut deferred = Vec::with_capacity(pending.len());
        let mut progress = false;
        for (fm, body, path) in pending {
            let parent_ready = fm
                .parent
                .as_deref()
                .filter(|s| !s.is_empty())
                .is_none_or(|p| inserted.contains(p));
            if !parent_ready {
                deferred.push((fm, body, path));
                continue;
            }
            if !seen.insert(fm.uuid.clone()) {
                errors.push(format!("Duplicate UUID {} in {}", fm.uuid, path));
                continue;
            }
            if let Err(e) = upsert_node_pub(db, &fm, &body).await {
                errors.push(format!("Upsert {} failed: {e}", fm.uuid));
                continue;
            }
            inserted.insert(fm.uuid.clone());
            n += 1;
            progress = true;
        }
        pending = deferred;
        if pending.is_empty() || !progress {
            break;
        }
    }

    // Anything still pending has an unresolvable parent — orphan reference
    // (parent uuid not present in the repo) or a cycle. Log per-row so the
    // ScanResult.errors surface tells the user exactly which contracts were
    // dropped and why, instead of silently disappearing.
    for (fm, _, path) in pending {
        let parent = fm.parent.as_deref().unwrap_or("<none>");
        errors.push(format!(
            "Skipping {} ({}): parent {} not present in repo",
            fm.uuid, path, parent
        ));
    }

    Ok(ScanResult {
        node_count: n,
        error_count: errors.len() as u32,
        errors,
    })
}

/// The canonical name every other module uses. Do not introduce a private
/// `upsert_node` variant — the whole crate points at this one symbol.
///
/// Works with the tauri_plugin_sql DbPool enum (wraps Pool<Sqlite> for sqlite).
pub async fn upsert_node_pub(
    db: &DbPool,
    fm: &ContractFrontmatter,
    body: &str,
) -> anyhow::Result<()> {
    let pool = match db {
        DbPool::Sqlite(p) => p,
        #[allow(unreachable_patterns)]
        _ => anyhow::bail!("only sqlite is supported"),
    };

    // Coerce empty-string FK fields to None. Some legacy sidecars / scanner
    // paths set `parent: ""` (instead of `parent: null`); binding an empty
    // string to a REFERENCES nodes(uuid) column fails the FK check because no
    // node has uuid="". NULL is the correct "no parent" value.
    let parent_fk = fm.parent.as_deref().filter(|s| !s.is_empty());

    let code_ranges_json = serde_json::to_string(&fm.code_ranges)?;
    // Display-name derivation order — every contract surfaces a human-readable
    // label on the canvas, sidebar, breadcrumb, and Cmd+P. Falling through to
    // the bare UUID is forbidden (was a real demo regression: flow contracts
    // and L1/L2 internal nodes with empty `code_ranges` rendered as `flow-de1e
    // -0000-...` UUIDs). Order: author-supplied → route → first-sentence intent
    // → file basename → "untitled-<8>" placeholder. The placeholder still
    // includes a UUID slice so duplicates remain distinguishable, but is
    // explicitly marked as a placeholder, not a name.
    let name = fm
        .name
        .clone()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| derive_from_route(&fm.route))
        .or_else(|| derive_from_intent_first_sentence(body))
        .or_else(|| derive_from_file_basename(&fm.code_ranges))
        .unwrap_or_else(|| format!("untitled-{}", &fm.uuid[..8.min(fm.uuid.len())]));
    let human_pinned_i = if fm.human_pinned { 1i64 } else { 0i64 };

    // Phase 8 propagation columns. Serialize to JSON strings; defaults remain
    // NULL when empty so v2 sidecars don't get spurious "{}" rows.
    let section_hashes_json: Option<String> = if fm.section_hashes.is_empty() {
        None
    } else {
        Some(serde_json::to_string(&fm.section_hashes)?)
    };
    let rollup_inputs_json: Option<String> = if fm.rollup_inputs.is_empty() {
        None
    } else {
        Some(serde_json::to_string(&fm.rollup_inputs)?)
    };
    let rollup_generation_i: Option<i64> = fm.rollup_generation.map(|g| g as i64);

    // Phase 9 FLOW-01: members_json — JSON array of UUID strings for kind:flow
    // contracts; NULL for all other kinds. Serialized from fm.members.
    let members_json: Option<String> = fm
        .members
        .as_ref()
        .filter(|m| !m.is_empty())
        .map(serde_json::to_string)
        .transpose()?;

    // 1) nodes upsert — code_ranges and kind are v2 columns; file_path kept NULL.
    //    Phase 8 columns (section_hashes_json, rollup_inputs_json, rollup_hash,
    //    rollup_state, rollup_generation) round-trip from the parsed sidecar so
    //    the rollup engine can read them on first scan and on watcher refresh.
    //    Phase 9 column: members_json (v5 migration).
    sqlx::query(
        r#"
        INSERT INTO nodes (
            uuid, level, name, kind, code_ranges, parent_uuid,
            is_canonical, code_hash, contract_hash, human_pinned,
            route, derived_at, contract_body,
            section_hashes_json, rollup_inputs_json, rollup_hash,
            rollup_state, rollup_generation, members_json, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8, ?9, ?10, ?11, ?12,
                ?13, ?14, ?15, ?16, COALESCE(?17, 0), ?18, datetime('now'))
        ON CONFLICT(uuid) DO UPDATE SET
            level                = excluded.level,
            kind                 = excluded.kind,
            code_ranges          = excluded.code_ranges,
            parent_uuid          = excluded.parent_uuid,
            code_hash            = excluded.code_hash,
            contract_hash        = excluded.contract_hash,
            human_pinned         = excluded.human_pinned,
            route                = excluded.route,
            derived_at           = excluded.derived_at,
            contract_body        = excluded.contract_body,
            section_hashes_json  = excluded.section_hashes_json,
            rollup_inputs_json   = excluded.rollup_inputs_json,
            rollup_hash          = excluded.rollup_hash,
            rollup_state         = excluded.rollup_state,
            rollup_generation    = excluded.rollup_generation,
            members_json         = excluded.members_json,
            updated_at           = datetime('now')
        "#,
    )
    .bind(&fm.uuid)
    .bind(&fm.level)
    .bind(&name)
    .bind(&fm.kind)
    .bind(&code_ranges_json)
    .bind(parent_fk)
    .bind(&fm.code_hash)
    .bind(&fm.contract_hash)
    .bind(human_pinned_i)
    .bind(&fm.route)
    .bind(&fm.derived_at)
    .bind(body)
    .bind(&section_hashes_json)
    .bind(&rollup_inputs_json)
    .bind(&fm.rollup_hash)
    .bind(&fm.rollup_state)
    .bind(rollup_generation_i)
    .bind(&members_json)
    .execute(pool)
    .await?;

    // 2) edges: one row per neighbor UUID (Phase 2 success criterion 1 —
    //    "populate nodes, edges, node_flows"). We clear existing outgoing
    //    edges from this node first so a removed neighbor disappears on rescan,
    //    then insert the current set.
    //
    //    Schema (from v1 migration): edges(id PK, source_uuid, target_uuid, edge_type, label)
    sqlx::query("DELETE FROM edges WHERE source_uuid = ?1")
        .bind(&fm.uuid)
        .execute(pool)
        .await?;
    for neighbor in &fm.neighbors {
        // Use a deterministic composite id so repeated upserts are idempotent.
        // Gate on target existence — scan order is alphabetical, so a neighbor
        // referenced before it has been upserted would trip the FK. A rescan
        // (triggered by the watcher on any future .md write) wires the edge in
        // once the target exists. Two-pass scan (all nodes first, then
        // relationships) is the cleaner fix — deferred.
        let edge_id = format!("{}->{}", fm.uuid, neighbor);
        sqlx::query(
            r#"
            INSERT OR IGNORE INTO edges (id, source_uuid, target_uuid, edge_type)
            SELECT ?1, ?2, ?3, 'neighbor'
            WHERE EXISTS (SELECT 1 FROM nodes WHERE uuid = ?3)
            "#,
        )
        .bind(&edge_id)
        .bind(&fm.uuid)
        .bind(neighbor)
        .execute(pool)
        .await?;
    }

    // 3) node_flows: a node's flow membership comes from (a) its parent
    //    (primary flow) and (b) its route when present (secondary flow keyed
    //    by route string). DATA-05 ghost-ref generation is Phase 3 — here we
    //    only materialise canonical membership. Wipe + reinsert on rescan so
    //    a dropped parent/route is reflected.
    sqlx::query("DELETE FROM node_flows WHERE node_uuid = ?1")
        .bind(&fm.uuid)
        .execute(pool)
        .await?;
    // Both inserts are gated on EXISTS — the parent may not yet have been
    // upserted in this scan pass, and route strings (e.g. "/cart") are not
    // node UUIDs at all. The schema declares `flow_uuid REFERENCES nodes(uuid)`
    // so an unchecked bind of a route string always violates the FK. Routes
    // become real flow membership only if a derivation pass later creates a
    // node with that UUID; until then the insert is a no-op.
    if let Some(parent) = parent_fk {
        sqlx::query(
            r#"
            INSERT OR IGNORE INTO node_flows (node_uuid, flow_uuid)
            SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM nodes WHERE uuid = ?2)
            "#,
        )
        .bind(&fm.uuid)
        .bind(parent)
        .execute(pool)
        .await?;
    }
    if let Some(route) = &fm.route {
        sqlx::query(
            r#"
            INSERT OR IGNORE INTO node_flows (node_uuid, flow_uuid)
            SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM nodes WHERE uuid = ?2)
            "#,
        )
        .bind(&fm.uuid)
        .bind(route)
        .execute(pool)
        .await?;
    }

    // TODO(Phase 3): rebuild_ghost_refs() — derive is_canonical=0 rows keyed
    // by canonical_uuid from node_flows membership. Deferred per RESEARCH.md
    // Open Question 4 and ROADMAP Phase 3 requirements.

    // 4) Rebuild the FTS5 shadow index.
    //
    // nodes_fts is an external-content FTS5 table (content='nodes'). A plain
    // UPDATE/INSERT on nodes does NOT populate the inverted index — SELECTs
    // without MATCH still work because they project through the content
    // reference, but any `nodes_fts MATCH ?` query returns empty until the
    // index is rebuilt. Phase 5's find_by_intent depends on MATCH, so we
    // rebuild after every upsert.
    //
    // Perf: this is O(corpus) per upsert. For hackathon-scale corpora (< ~1k
    // rows) it's sub-millisecond and not observable. Phase 6+ should switch
    // to per-row incremental sync via AFTER INSERT/UPDATE/DELETE triggers on
    // nodes (canonical external-content FTS5 pattern), which is O(1) per row.
    sqlx::query("INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')")
        .execute(pool)
        .await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Display-name derivation helpers (used by `upsert_node_pub` above).
//
// Each helper returns Option<String>; None means "this strategy can't produce
// a name from the available data — try the next one." The fallback chain is
// authored-name → route → first-sentence intent → file basename → "untitled-
// <uuid prefix>" placeholder.
// ---------------------------------------------------------------------------

/// Pretty-cased name derived from a `route` field.
///
/// `/account/settings`         → "Account Settings"
/// `DELETE /api/account`       → "DELETE /api/account" (already pretty)
/// `/team/[slug]/settings`     → "Team Settings"
/// `/`                         → "Home"
fn derive_from_route(route: &Option<String>) -> Option<String> {
    let route = route.as_deref().map(str::trim).filter(|s| !s.is_empty())?;
    // Already-pretty: anything starting with an HTTP verb (GET/POST/...).
    let upper_first = route
        .split_whitespace()
        .next()
        .map(|w| w.chars().all(|c| c.is_ascii_uppercase() || c == '_'))
        .unwrap_or(false);
    if upper_first && route.contains('/') {
        return Some(route.to_string());
    }
    // Path-only: split on '/' and pretty-case each segment.
    let segments: Vec<String> = route
        .split('/')
        .filter(|s| !s.is_empty())
        // Drop dynamic segments like [slug] / :id / {id}; the contract is the
        // surface, not a specific instance.
        .filter(|s| {
            !(s.starts_with(':')
                || (s.starts_with('[') && s.ends_with(']'))
                || (s.starts_with('{') && s.ends_with('}')))
        })
        .map(pretty_case_segment)
        .collect();
    if segments.is_empty() {
        return Some("Home".to_string());
    }
    Some(segments.join(" "))
}

/// Pretty-case a single URL/path segment: split on `-`/`_`/`.`, title-case
/// each word.
fn pretty_case_segment(seg: &str) -> String {
    seg.split(['-', '_', '.'])
        .filter(|w| !w.is_empty())
        .map(title_case_word)
        .collect::<Vec<_>>()
        .join(" ")
}

fn title_case_word(word: &str) -> String {
    let mut chars = word.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
    }
}

/// Pull a short title from the first sentence of an intent block. Mirrors
/// the substrate distiller's `derive_node_name` (distiller/pipeline.rs).
/// Looks for the first H2 section (preferred: "## Intent"); if none, uses
/// the leading paragraph of the body. Caps at ~50 chars at a word boundary.
fn derive_from_intent_first_sentence(body: &str) -> Option<String> {
    // Strip H1/H2 headers and find the first non-empty content line. Prefer
    // the body of an "## Intent" section if present.
    let intent_block = extract_intent_block(body).unwrap_or(body);
    let trimmed = intent_block.trim();
    if trimmed.is_empty() {
        return None;
    }
    let head_end = trimmed
        .find(['.', ',', ';', '\n'])
        .or_else(|| trimmed.find(" — "))
        .or_else(|| trimmed.find(" - "))
        .unwrap_or(trimmed.len());
    let head = trimmed[..head_end].trim();
    if head.is_empty() {
        return None;
    }
    const MAX: usize = 50;
    if head.chars().count() <= MAX {
        return Some(head.to_string());
    }
    // Cut at a word boundary near MAX.
    let mut end = 0usize;
    for (idx, _) in head.char_indices().take(MAX) {
        end = idx;
    }
    let cut = &head[..end];
    let cut = cut.rsplit_once(' ').map(|(a, _)| a).unwrap_or(cut);
    Some(format!("{}…", cut.trim()))
}

/// Find the body of an "## Intent" section, if present. Returns the slice
/// between the heading line and the next H2 (or end of body).
fn extract_intent_block(body: &str) -> Option<&str> {
    let lower = body.to_ascii_lowercase();
    let pos = lower.find("## intent")?;
    let after_heading = body[pos..].find('\n').map(|n| pos + n + 1)?;
    let rest = &body[after_heading..];
    let next_h2 = rest.find("\n## ").unwrap_or(rest.len());
    Some(&rest[..next_h2])
}

/// Convert the first code_range's file path into a pretty-cased label.
///   `page.tsx`              → parent dir basename pretty-cased ("Settings")
///   `route.ts`              → parent dir basename pretty-cased
///   `schema.prisma`         → "Schema (Prisma)"
///   `beginAccountDeletion.ts` → "Begin Account Deletion"
///   `utils/format-date.ts`  → "Format Date"
fn derive_from_file_basename(code_ranges: &[crate::sidecar::frontmatter::CodeRange]) -> Option<String> {
    let file = &code_ranges.first()?.file;
    let path = std::path::Path::new(file);
    let stem = path.file_stem()?.to_str()?;
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");

    // Next.js convention: page.tsx / layout.tsx / route.ts → use the parent
    // directory name (the route segment) instead of the generic file name.
    if matches!(stem, "page" | "layout" | "route" | "loading" | "error" | "index") {
        if let Some(parent_dir) = path.parent().and_then(|p| p.file_name()).and_then(|s| s.to_str()) {
            return Some(pretty_case_segment(parent_dir));
        }
    }

    // Special-cased schemas: schema.prisma → "Schema (Prisma)"
    if stem == "schema" && !ext.is_empty() {
        let ext_pretty = title_case_word(ext);
        return Some(format!("Schema ({ext_pretty})"));
    }

    Some(pretty_case_camel_or_kebab(stem))
}

/// Convert "beginAccountDeletion" → "Begin Account Deletion",
/// "format-date" → "Format Date", "send_welcome_email" → "Send Welcome Email".
fn pretty_case_camel_or_kebab(stem: &str) -> String {
    if stem.contains('-') || stem.contains('_') {
        return pretty_case_segment(stem);
    }
    // CamelCase / camelCase: insert a space before each uppercase letter
    // that's preceded by a lowercase letter or a digit.
    let mut out = String::with_capacity(stem.len() + 4);
    let mut prev: Option<char> = None;
    for c in stem.chars() {
        if c.is_ascii_uppercase()
            && prev.is_some_and(|p| p.is_ascii_lowercase() || p.is_ascii_digit())
        {
            out.push(' ');
        }
        out.push(c);
        prev = Some(c);
    }
    // Capitalize first character.
    let mut cs = out.chars();
    match cs.next() {
        None => String::new(),
        Some(first) => first.to_uppercase().collect::<String>() + cs.as_str(),
    }
}

#[cfg(test)]
mod derive_name_tests {
    use super::*;
    use crate::sidecar::frontmatter::CodeRange;

    #[test]
    fn route_path_pretty_cases_segments() {
        assert_eq!(
            derive_from_route(&Some("/account/settings".to_string())),
            Some("Account Settings".to_string())
        );
        assert_eq!(
            derive_from_route(&Some("/team/[slug]/settings".to_string())),
            Some("Team Settings".to_string())
        );
        assert_eq!(
            derive_from_route(&Some("/".to_string())),
            Some("Home".to_string())
        );
    }

    #[test]
    fn route_already_pretty_with_http_verb_passes_through() {
        assert_eq!(
            derive_from_route(&Some("DELETE /api/account".to_string())),
            Some("DELETE /api/account".to_string())
        );
        assert_eq!(
            derive_from_route(&Some("POST /api/checkout".to_string())),
            Some("POST /api/checkout".to_string())
        );
    }

    #[test]
    fn route_handles_dynamic_segments() {
        assert_eq!(
            derive_from_route(&Some("/users/:id/profile".to_string())),
            Some("Users Profile".to_string())
        );
        assert_eq!(
            derive_from_route(&Some("/posts/{id}".to_string())),
            Some("Posts".to_string())
        );
    }

    #[test]
    fn route_none_returns_none() {
        assert_eq!(derive_from_route(&None), None);
        assert_eq!(derive_from_route(&Some("".to_string())), None);
        assert_eq!(derive_from_route(&Some("   ".to_string())), None);
    }

    #[test]
    fn intent_first_sentence_extracts_lead() {
        let body = "## Intent\nThe checkout button submits payment. It also shows a spinner.\n";
        assert_eq!(
            derive_from_intent_first_sentence(body),
            Some("The checkout button submits payment".to_string())
        );
    }

    #[test]
    fn intent_truncates_long_lead_at_word_boundary() {
        let body = "## Intent\nThis is a very long single clause without any sentence break that runs on forever\n";
        let name = derive_from_intent_first_sentence(body).unwrap();
        assert!(name.ends_with('…'), "expected ellipsis, got {name}");
        assert!(name.chars().count() <= 52, "got {} chars", name.chars().count());
    }

    #[test]
    fn intent_falls_back_to_body_when_no_intent_section() {
        let body = "## Role\nThe primary surface for foo bar.\n";
        // No "## Intent" — falls back to body, takes the first sentence.
        let name = derive_from_intent_first_sentence(body).unwrap();
        assert!(name.contains("Role") || name.contains("primary"), "unexpected {name}");
    }

    #[test]
    fn intent_empty_body_returns_none() {
        assert_eq!(derive_from_intent_first_sentence(""), None);
        assert_eq!(derive_from_intent_first_sentence("   \n  "), None);
    }

    #[test]
    fn file_basename_uses_parent_for_nextjs_conventions() {
        let cr = vec![CodeRange {
            file: "src/app/account/settings/page.tsx".to_string(),
            start_line: 1,
            end_line: 1,
        }];
        assert_eq!(derive_from_file_basename(&cr), Some("Settings".to_string()));
    }

    #[test]
    fn file_basename_handles_route_ts() {
        let cr = vec![CodeRange {
            file: "src/app/api/account/route.ts".to_string(),
            start_line: 1,
            end_line: 1,
        }];
        assert_eq!(derive_from_file_basename(&cr), Some("Account".to_string()));
    }

    #[test]
    fn file_basename_handles_schema_prisma() {
        let cr = vec![CodeRange {
            file: "prisma/schema.prisma".to_string(),
            start_line: 1,
            end_line: 1,
        }];
        assert_eq!(
            derive_from_file_basename(&cr),
            Some("Schema (Prisma)".to_string())
        );
    }

    #[test]
    fn file_basename_camel_cases() {
        let cr = vec![CodeRange {
            file: "src/lib/beginAccountDeletion.ts".to_string(),
            start_line: 1,
            end_line: 1,
        }];
        assert_eq!(
            derive_from_file_basename(&cr),
            Some("Begin Account Deletion".to_string())
        );
    }

    #[test]
    fn file_basename_kebab_cases() {
        let cr = vec![CodeRange {
            file: "src/lib/format-date.ts".to_string(),
            start_line: 1,
            end_line: 1,
        }];
        assert_eq!(
            derive_from_file_basename(&cr),
            Some("Format Date".to_string())
        );
    }

    #[test]
    fn file_basename_empty_returns_none() {
        assert_eq!(derive_from_file_basename(&[]), None);
    }
}
