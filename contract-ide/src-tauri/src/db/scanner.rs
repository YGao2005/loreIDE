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
    // a child whose UUID sorts before its parent's UUID would otherwise trip
    // the constraint when walkdir yields it first. Level strings "L0"…"L4"
    // sort lexicographically in the correct order.
    let mut parsed = parsed;
    parsed.sort_by(|a, b| a.0.level.cmp(&b.0.level));

    for (fm, body, path) in parsed {
        if !seen.insert(fm.uuid.clone()) {
            errors.push(format!("Duplicate UUID {} in {}", fm.uuid, path));
            continue;
        }
        if let Err(e) = upsert_node_pub(db, &fm, &body).await {
            errors.push(format!("Upsert {} failed: {e}", fm.uuid));
            continue;
        }
        n += 1;
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
    let name = fm
        .code_ranges
        .first()
        .map(|r| {
            std::path::Path::new(&r.file)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or(&fm.uuid)
                .to_string()
        })
        .unwrap_or_else(|| fm.uuid.clone());
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
