// Phase 13 Plan 01 — substrate-state IPC for canvas coloring.
//
// Two commands:
//   get_substrate_states_for_canvas — returns Vec<SubstrateNodeSummary> read from
//     the `substrate_nodes` table (Phase 11 distiller writes; Phase 13 reads).
//   get_substrate_node_detail — single-row lookup by uuid for chip detail panels
//     (Phase 13 plans 13-04 / 13-05 consume this).
//
// Both commands map the actual substrate_nodes schema to a wire shape friendly
// for the canvas:
//   - `kind`           ← `node_type`           (constraint / decision / open_question /
//                                                resolved_question / attempt — plus 'contract'
//                                                reserved for future contract-row mirroring)
//   - `name`           ← first non-empty line of `text` (chip label)
//   - `summary`        ← full `text`           (panel body)
//   - `state`          ← derived:
//                          intent_drift_state == 'DRIFTED' → 'intent_drifted'
//                          invalid_at IS NOT NULL          → 'superseded'
//                          else                            → 'fresh'
//                        ('stale' is not yet emitted by Phase 11 — reserved for plan 13-09 sync.)
//   - `session_id`     ← `source_session_id`
//   - `turn_ref`       ← `source_turn_ref` stringified (it's INTEGER in SQLite)
//   - `verbatim_quote` ← `source_quote`
//   - `actor`          ← `source_actor`
//   - `confidence`     ← `confidence`
//
// Defensive boots: if the `substrate_nodes` table is absent (e.g. fresh dev DB
// missing Phase 11 / Phase 12 migrations), return Ok([]) / Ok(None) so the app
// boots cleanly and the canvas just renders without orange overlays.
//
// Pool-extraction pattern mirrors commands/nodes.rs:94-102 — read DbInstances
// state, get the named pool, match Sqlite, clone for use.

use serde::{Deserialize, Serialize};
use sqlx::Row;
use sqlx::SqlitePool;
use tauri::{Manager, State};
use tauri_plugin_sql::{DbInstances, DbPool};

// Phase 13 Plan 03 — Cmd+P semantic intent palette (SUB-08).
//
// `find_substrate_by_intent` aggregates contract FTS5 (nodes_fts — Phase 5
// Plan 05-02 retrieval surface) AND substrate retrieval (substrate_nodes_fts +
// LIKE fallback) into a single ranked result list. The frontend's IntentPalette
// dialog calls this on each debounced 300ms keystroke.
//
// Why a single Rust IPC instead of two separate calls (one for contracts, one
// for substrate)? Three reasons:
//   1. Single round-trip — the frontend doesn't have to merge + sort two async
//      results and risk inconsistent rank scales.
//   2. Score normalisation lives in one place — contract FTS5 emits BM25
//      (negative; more negative = better), substrate LIKE emits binary; without
//      central normalisation the merged list is incoherent.
//   3. Phase 5 already established this pattern in
//      mcp-sidecar/src/tools/find_by_intent.ts. Mirroring it for the Tauri-side
//      Cmd+P ipc keeps the mental model consistent.
//
// The returned `IntentSearchHit` is intentionally a fresh struct (NOT
// `SubstrateNodeSummary`): hits include both contracts (with `level` + `kind`
// + `parent_uuid`) and substrate nodes (with `state`). Different shapes warrant
// a unified envelope.
//
// **Score normalisation:** contract FTS5 rank is BM25 (negative). We invert it
// (positive_score = -fts_rank) and emit it as `score`. Substrate hits get a
// flat `0.5` score so they always rank below contracts of equivalent FTS
// relevance — by design, the demo's flow→L2 / atom→L3 entry is the primary
// navigation target; substrate nodes augment context but should not outrank
// contracts in the palette.
//
// **Defensive boots:** if `nodes_fts` is missing (impossible in practice but
// keeps the handler total), we return only substrate hits. If
// `substrate_nodes_fts` is missing OR the table is empty, we fall through to a
// LIKE query against `substrate_nodes.text` so the user gets *some* result on
// a fresh dev DB.

/// Wire-shape returned by `get_substrate_states_for_canvas` and
/// `get_substrate_node_detail`. Matches `SubstrateNodeSummary` in
/// `src/ipc/substrate.ts`.
///
/// `#[serde(rename_all = "snake_case")]` keeps fields lowercase-with-underscores
/// (matches the TS interface exactly — no manual rename attrs needed).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct SubstrateNodeSummary {
    pub uuid: String,
    pub kind: String,
    pub state: String,
    pub name: String,
    pub summary: String,
    pub session_id: Option<String>,
    pub turn_ref: Option<String>,
    pub verbatim_quote: Option<String>,
    pub actor: Option<String>,
    /// Phase 15 Plan 02 (folded from 15-03): pre-fill for RefineRuleEditor.
    /// Only populated by `get_substrate_node_detail`; canvas bulk-read sets None.
    pub applies_when: Option<String>,
    pub confidence: Option<String>,
}

/// Pool-clone helper (mirrors substrate_panel.rs:21-33 exactly).
async fn pool_clone(app: &tauri::AppHandle) -> Result<SqlitePool, String> {
    let instances = app.state::<DbInstances>();
    let db_map = instances.0.read().await;
    let db = db_map
        .get("sqlite:contract-ide.db")
        .ok_or_else(|| "DB not loaded".to_string())?;
    let pool = match db {
        DbPool::Sqlite(p) => p.clone(),
        #[allow(unreachable_patterns)]
        _ => return Err("expected sqlite pool".into()),
    };
    Ok(pool)
}

/// Returns 0 if the substrate_nodes table is missing, 1 otherwise.
/// Used to short-circuit reads so the app boots cleanly even before Phase 11
/// has shipped its migration on a particular machine.
async fn substrate_table_exists(pool: &SqlitePool) -> Result<bool, String> {
    let row: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='substrate_nodes'",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("substrate_table_exists: {e}"))?;
    Ok(row.0 > 0)
}

/// Returns 1 if the `intent_drift_state` column is present on `substrate_nodes`
/// (Phase 12 v7 migration added it). If absent, the canvas read falls back to
/// `invalid_at` for state derivation only — no `intent_drifted` emitted.
async fn intent_drift_column_present(pool: &SqlitePool) -> Result<bool, String> {
    // PRAGMA table_info is the SQLite-portable way to introspect columns;
    // sqlite_master.sql LIKE matching is brittle (whitespace / quoting).
    let rows = sqlx::query("PRAGMA table_info('substrate_nodes')")
        .fetch_all(pool)
        .await
        .map_err(|e| format!("intent_drift_column_present: {e}"))?;
    for r in rows {
        let name: String = r.try_get("name").unwrap_or_default();
        if name == "intent_drift_state" {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Pull the first non-empty line of `text` as the chip label. Falls back to the
/// uuid prefix if `text` is empty (defensive — `text NOT NULL` per schema, but
/// don't crash the canvas on garbage data).
fn first_line(text: &str, uuid_fallback: &str) -> String {
    for line in text.lines() {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            // Cap at 80 chars so a 1000-char first paragraph doesn't blow up
            // the chip — the panel body shows the full text anyway.
            return trimmed.chars().take(80).collect();
        }
    }
    format!("substrate {}", &uuid_fallback[..uuid_fallback.len().min(8)])
}

/// Map (intent_drift_state, invalid_at) → wire `state`.
///
/// Precedence:
///   1. intent_drift_state == 'DRIFTED'             → 'intent_drifted'
///   2. invalid_at IS NOT NULL (and not DRIFTED)    → 'superseded'
///   3. otherwise                                   → 'fresh'
///
/// 'stale' is reserved for Phase 13-09 sync work (a future engine signal). It
/// is intentionally NOT emitted here — the canvas treats absent-or-fresh the
/// same way (no overlay).
fn derive_state(intent_drift_state: Option<&str>, invalid_at: Option<&str>) -> &'static str {
    if matches!(intent_drift_state, Some("DRIFTED")) {
        return "intent_drifted";
    }
    if invalid_at.is_some() {
        return "superseded";
    }
    "fresh"
}

/// Phase 13 Plan 01 — hydrate the per-uuid substrate state map for canvas coloring.
///
/// Returns one entry per row in `substrate_nodes`. Frontend (AppShell hydrate)
/// calls `useSubstrateStore.getState().bulkSet(...)` with the result.
///
/// Defensive: returns Ok(vec![]) if the table is missing (fresh DB, Phase 11
/// migrations not yet shipped on this machine).
#[tauri::command]
pub async fn get_substrate_states_for_canvas(
    app: tauri::AppHandle,
) -> Result<Vec<SubstrateNodeSummary>, String> {
    let pool = pool_clone(&app).await?;

    if !substrate_table_exists(&pool).await? {
        return Ok(vec![]);
    }
    let has_intent_col = intent_drift_column_present(&pool).await?;

    // Build the SELECT dynamically — if the v7 migration hasn't run, skip
    // intent_drift_state to avoid a column-missing error on older DBs.
    let sql = if has_intent_col {
        r#"
        SELECT uuid, node_type, text,
               source_session_id, source_turn_ref, source_quote, source_actor,
               confidence, invalid_at, intent_drift_state
        FROM substrate_nodes
        "#
    } else {
        r#"
        SELECT uuid, node_type, text,
               source_session_id, source_turn_ref, source_quote, source_actor,
               confidence, invalid_at,
               CAST(NULL AS TEXT) AS intent_drift_state
        FROM substrate_nodes
        "#
    };

    let rows = sqlx::query(sql)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("get_substrate_states_for_canvas: {e}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let uuid: String = r.try_get("uuid").map_err(|e| e.to_string())?;
        let kind: String = r.try_get("node_type").map_err(|e| e.to_string())?;
        let text: String = r.try_get("text").unwrap_or_default();
        let session_id: Option<String> = r.try_get("source_session_id").ok();
        // source_turn_ref is INTEGER in SQLite; stringify so the wire shape stays uniform.
        let turn_ref_int: Option<i64> = r.try_get("source_turn_ref").ok();
        let turn_ref = turn_ref_int.map(|v| v.to_string());
        let verbatim_quote: Option<String> = r.try_get("source_quote").ok();
        let actor: Option<String> = r.try_get("source_actor").ok();
        let confidence: Option<String> = r.try_get("confidence").ok();
        let invalid_at: Option<String> = r.try_get("invalid_at").ok();
        let intent_drift_state: Option<String> = r.try_get("intent_drift_state").ok();

        let state = derive_state(intent_drift_state.as_deref(), invalid_at.as_deref());
        let name = first_line(&text, &uuid);

        out.push(SubstrateNodeSummary {
            uuid,
            kind,
            state: state.to_string(),
            name,
            summary: text,
            session_id,
            turn_ref,
            verbatim_quote,
            actor,
            // Canvas bulk read doesn't need applies_when — skip the column to
            // keep the SELECT fast; 15-03's RefineRuleEditor reads it via
            // get_substrate_node_detail instead.
            applies_when: None,
            confidence,
        });
    }
    Ok(out)
}

/// Phase 13 Plan 01 — single-row lookup for chip detail panels.
///
/// Returns Ok(None) if uuid not found OR if the table is missing.
#[tauri::command]
pub async fn get_substrate_node_detail(
    app: tauri::AppHandle,
    uuid: String,
) -> Result<Option<SubstrateNodeSummary>, String> {
    let pool = pool_clone(&app).await?;

    if !substrate_table_exists(&pool).await? {
        return Ok(None);
    }
    let has_intent_col = intent_drift_column_present(&pool).await?;

    let sql = if has_intent_col {
        r#"
        SELECT uuid, node_type, text, applies_when,
               source_session_id, source_turn_ref, source_quote, source_actor,
               confidence, invalid_at, intent_drift_state
        FROM substrate_nodes WHERE uuid = ?1 LIMIT 1
        "#
    } else {
        r#"
        SELECT uuid, node_type, text, applies_when,
               source_session_id, source_turn_ref, source_quote, source_actor,
               confidence, invalid_at,
               CAST(NULL AS TEXT) AS intent_drift_state
        FROM substrate_nodes WHERE uuid = ?1 LIMIT 1
        "#
    };

    let row = sqlx::query(sql)
        .bind(&uuid)
        .fetch_optional(&pool)
        .await
        .map_err(|e| format!("get_substrate_node_detail: {e}"))?;

    let Some(r) = row else { return Ok(None) };

    let uuid_out: String = r.try_get("uuid").map_err(|e| e.to_string())?;
    let kind: String = r.try_get("node_type").map_err(|e| e.to_string())?;
    let text: String = r.try_get("text").unwrap_or_default();
    let applies_when: Option<String> = r.try_get("applies_when").ok();
    let session_id: Option<String> = r.try_get("source_session_id").ok();
    let turn_ref_int: Option<i64> = r.try_get("source_turn_ref").ok();
    let turn_ref = turn_ref_int.map(|v| v.to_string());
    let verbatim_quote: Option<String> = r.try_get("source_quote").ok();
    let actor: Option<String> = r.try_get("source_actor").ok();
    let confidence: Option<String> = r.try_get("confidence").ok();
    let invalid_at: Option<String> = r.try_get("invalid_at").ok();
    let intent_drift_state: Option<String> = r.try_get("intent_drift_state").ok();

    let state = derive_state(intent_drift_state.as_deref(), invalid_at.as_deref());
    let name = first_line(&text, &uuid_out);

    Ok(Some(SubstrateNodeSummary {
        uuid: uuid_out,
        kind,
        state: state.to_string(),
        name,
        summary: text,
        session_id,
        turn_ref,
        verbatim_quote,
        actor,
        applies_when,
        confidence,
    }))
}

// =============================================================================
// Phase 13 Plan 03 — find_substrate_by_intent (Cmd+P palette IPC)
// =============================================================================

/// Wire-shape returned by `find_substrate_by_intent`.
///
/// Mirrors the TS `IntentSearchHit` interface in `src/ipc/substrate.ts`. Fields
/// are deliberately a UNION of contract metadata (`level` non-null for contracts,
/// null for substrate nodes) AND substrate metadata (`state` non-null for
/// substrate nodes, null for contracts). The frontend branches on `kind` to
/// decide navigation: `flow|contract` → push parent stack / focus atom;
/// substrate kinds → open detail panel via the parent contract uuid.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct IntentSearchHit {
    /// uuid of the matched row — contract uuid for contract hits, substrate
    /// node uuid for substrate hits.
    pub uuid: String,
    /// `contract` | `flow` (for contract rows where kind == 'flow') |
    /// `constraint` | `decision` | `open_question` | `resolved_question` |
    /// `attempt`. Drives navigation branch in the frontend.
    pub kind: String,
    /// L0..L4 for contracts; null for substrate nodes.
    pub level: Option<String>,
    /// Display name for the row's primary line.
    pub name: String,
    /// Body / summary text for the row's secondary line + future detail panel.
    pub summary: String,
    /// Substrate state derived from `intent_drift_state` + `invalid_at`. Null
    /// for contract hits.
    pub state: Option<String>,
    /// Parent contract uuid:
    ///   - For contracts: the contract's own `parent_uuid` column (used by L4
    ///     atom-hit landing to push the parent surface and focus the atom).
    ///   - For substrate nodes: the FIRST entry of `anchored_uuids` (the atom
    ///     the substrate node speaks to) — null if the substrate row has no
    ///     anchored uuids yet.
    pub parent_uuid: Option<String>,
    /// Ranking score (positive; higher = better). Contract FTS5 BM25 inverted;
    /// substrate hits get a flat 0.5 fallback so contracts dominate the top
    /// of the list.
    pub score: f64,
}

/// Build an FTS5 MATCH expression from a free-form user query.
///
/// Mirrors the OR-tokenization established by `commands::mass_edit::build_fts_query`
/// (Phase 9 Plan 09-01). FTS5's default tokenization treats whitespace-separated
/// terms as implicit AND — natural-language Cmd+P queries like
/// `"account settings danger"` would return zero rows under AND. OR-tokenization
/// combined with BM25 ranking lets relevant contracts surface even when the
/// query carries extra context words.
///
/// Pass-through behavior: if the user already wrote a structured FTS query
/// (uppercase AND/OR/NOT, NEAR, or quoted phrases), respect it verbatim. This
/// keeps power users on stable footing.
fn build_fts_or_query(user_query: &str) -> String {
    let trimmed = user_query.trim();
    if trimmed.is_empty() {
        return trimmed.to_string();
    }

    // Detect structured queries — pass through.
    let upper = trimmed.to_ascii_uppercase();
    let has_operator = upper.contains(" AND ")
        || upper.contains(" OR ")
        || upper.contains(" NOT ")
        || upper.contains(" NEAR(")
        || trimmed.contains('"');
    if has_operator {
        return trimmed.to_string();
    }

    // Light stopword filter — same set as mass_edit.rs to keep behaviour
    // consistent across IDE search surfaces. Don't drop action verbs (delete,
    // add, update) — those carry intent signal in Cmd+P queries.
    const STOPWORDS: &[&str] = &[
        "a", "an", "the", "to", "of", "in", "on", "at", "by", "for", "from",
        "with", "into", "onto", "and", "or", "but", "is", "are", "was", "were",
        "be", "been", "being", "has", "have", "had",
    ];

    let tokens: Vec<String> = trimmed
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .filter(|t| !STOPWORDS.contains(&t.to_ascii_lowercase().as_str()))
        .map(|t| format!("\"{t}\""))
        .collect();

    if !tokens.is_empty() {
        return tokens.join(" OR ");
    }

    // Fallback: every word was a stopword. Re-tokenize WITHOUT the filter so
    // the user gets *some* result for stopword-only queries.
    let fallback: Vec<String> = trimmed
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{t}\""))
        .collect();

    if fallback.is_empty() {
        trimmed.to_string()
    } else {
        fallback.join(" OR ")
    }
}

/// Phase 13 Plan 03 — unified Cmd+P retrieval (SUB-08).
///
/// Aggregates contract FTS5 hits (nodes_fts) and substrate hits
/// (substrate_nodes_fts when present, falling back to LIKE on
/// `substrate_nodes.text` if the FTS virtual table is empty/missing) into one
/// ranked result list.
///
/// **Score normalisation:**
///   - Contract FTS5: BM25 rank is negative; we invert (`-fts_rank`) so
///     positive_score sorts ascending → descending best-first.
///   - Substrate hits: flat `0.5` score so contracts dominate the top of the
///     list. (At demo scale, contracts are the primary navigation target;
///     substrate augments via the detail panel.)
///
/// **Anchored-uuid extraction for substrate hits:** `parent_uuid` is set to the
/// FIRST entry of `anchored_uuids` (a JSON array on substrate_nodes). Frontend
/// uses this to navigate to the atom contract that the substrate node speaks
/// to, when the user clicks a substrate hit row.
///
/// **Defensive boots:** all reads short-circuit cleanly — if either FTS5
/// virtual table is empty, we just skip its hits. If `substrate_nodes` itself
/// is missing (Phase 11 migration not run), substrate hits return [].
///
/// **Phase 15 Plan 02 — `kind_filter` parameter (TRUST-01):**
///   - `None` / `Some("all")` → existing behaviour (both FTS scans + merged results)
///   - `Some("substrate")`    → substrate-only; skip contract FTS scan entirely.
///     All `WHERE invalid_at IS NULL` predicates preserved — tombstoned rows don't surface.
///   - `Some("contracts")`    → contracts-only; skip substrate FTS scan.
///   - `Some("code")`         → same as "contracts" for now.
///     TODO: Phase 16 code-only filter
///
/// **Performance target (TRUST-01 SC):** <2s from Cmd+P keystroke (Substrate
/// chip active, query "why email confirmation") to first readable verbatim quote
/// in SourceArchaeologyModal on demo SQLite.
#[tauri::command]
pub async fn find_substrate_by_intent(
    db_instances: State<'_, DbInstances>,
    query: String,
    limit: Option<i32>,
    kind_filter: Option<String>,
) -> Result<Vec<IntentSearchHit>, String> {
    let limit = limit.unwrap_or(10).clamp(1, 50);
    let fts_match = build_fts_or_query(&query);

    if fts_match.is_empty() {
        return Ok(vec![]);
    }

    let db_map = db_instances.0.read().await;
    let db = db_map
        .get("sqlite:contract-ide.db")
        .ok_or_else(|| "DB not loaded".to_string())?;
    let pool = match db {
        DbPool::Sqlite(p) => p.clone(),
        #[allow(unreachable_patterns)]
        _ => return Err("expected sqlite pool".into()),
    };
    drop(db_map); // release RwLock before async DB work

    let mut hits: Vec<IntentSearchHit> = Vec::with_capacity(limit as usize * 2);

    // Normalise kind_filter to a canonical mode string for branch dispatch.
    //   None / Some("all") → "all"       (both contract FTS + substrate FTS)
    //   Some("substrate")  → "substrate" (substrate FTS only)
    //   Some("contracts")  → "contracts" (contract FTS only)
    //   Some("code")       → "contracts" (TODO: Phase 16 code-only filter)
    let filter_mode: &str = match kind_filter.as_deref() {
        Some("substrate") => "substrate",
        Some("contracts") | Some("code") => "contracts",
        _ => "all",
    };

    // ---------- Contract hits (nodes_fts) ----------
    //
    // Skip entirely when filter_mode == "substrate" (Substrate chip active).
    //
    // Cap contract hits at `limit` so the substrate slice still has room.
    // BM25 rank is the canonical sort key — sort ASC (most negative = best).
    // Tuple shape: (uuid, name, level, kind, parent_uuid?, body, fts_rank).
    // `body` is COALESCE(n.contract_body, '') so it's a non-NULL String to sqlx;
    // `parent_uuid` IS nullable on the nodes table so it stays Option<String>.
    if filter_mode != "substrate" {
        // Contract FTS scan — skipped when Substrate chip is active.
        #[allow(clippy::type_complexity)]
        let contract_rows: Vec<(
            String,
            String,
            String,
            String,
            Option<String>,
            String,
            f64,
        )> = sqlx::query_as(
            r#"
            SELECT n.uuid,
                   n.name,
                   n.level,
                   n.kind,
                   n.parent_uuid,
                   COALESCE(n.contract_body, '') AS body,
                   nodes_fts.rank AS fts_rank
            FROM nodes_fts
            JOIN nodes n ON n.uuid = nodes_fts.uuid
            WHERE nodes_fts MATCH ?1
              AND n.is_canonical = 1
            ORDER BY nodes_fts.rank
            LIMIT ?2
            "#,
        )
        .bind(&fts_match)
        .bind(limit as i64)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("find_substrate_by_intent contract scan: {e}"))?;

        for (uuid, name, level, kind, parent_uuid, body, fts_rank) in contract_rows {
            // Treat kind='flow' as a top-level navigation kind so the frontend
            // can branch directly without a string-equals on a nested field.
            let surface_kind = if kind == "flow" {
                "flow".to_string()
            } else {
                "contract".to_string()
            };
            // Body summary capped to first ~200 chars for palette display; the
            // full body is fetched on click via existing detail IPCs.
            let summary = body.chars().take(200).collect::<String>();
            hits.push(IntentSearchHit {
                uuid,
                kind: surface_kind,
                level: Some(level),
                name,
                summary,
                state: None,
                parent_uuid,
                // BM25 invert — most-negative becomes most-positive.
                score: -fts_rank,
            });
        }
    }

    // ---------- Substrate hits ----------
    //
    // Skip when filter_mode == "contracts" (Contracts chip active).
    //
    // Try substrate_nodes_fts first (proper BM25 ranking on text+applies_when+scope).
    // If FTS yields no rows for this query, fall back to a LIKE scan so the user
    // sees something on a fresh DB where the FTS index hasn't picked up rows yet.
    if filter_mode != "contracts" && substrate_table_exists(&pool).await? {
        let has_intent_col = intent_drift_column_present(&pool).await?;

        // Build FTS query first — try the full-text index. Note: substrate text
        // is shorter than contract bodies, so BM25 noise is lower; we keep the
        // same OR-tokenized query.
        let substrate_sql = if has_intent_col {
            r#"
            SELECT s.uuid,
                   s.node_type,
                   s.text,
                   s.invalid_at,
                   s.intent_drift_state,
                   s.anchored_uuids,
                   substrate_nodes_fts.rank AS fts_rank
            FROM substrate_nodes_fts
            JOIN substrate_nodes s ON s.uuid = substrate_nodes_fts.uuid
            WHERE substrate_nodes_fts MATCH ?1
              AND s.invalid_at IS NULL
            ORDER BY substrate_nodes_fts.rank
            LIMIT ?2
            "#
        } else {
            r#"
            SELECT s.uuid,
                   s.node_type,
                   s.text,
                   s.invalid_at,
                   CAST(NULL AS TEXT) AS intent_drift_state,
                   s.anchored_uuids,
                   substrate_nodes_fts.rank AS fts_rank
            FROM substrate_nodes_fts
            JOIN substrate_nodes s ON s.uuid = substrate_nodes_fts.uuid
            WHERE substrate_nodes_fts MATCH ?1
              AND s.invalid_at IS NULL
            ORDER BY substrate_nodes_fts.rank
            LIMIT ?2
            "#
        };

        #[allow(clippy::type_complexity)]
        let mut substrate_rows: Vec<(
            String,
            String,
            String,
            Option<String>,
            Option<String>,
            String,
            f64,
        )> = sqlx::query_as(substrate_sql)
            .bind(&fts_match)
            .bind(limit as i64)
            .fetch_all(&pool)
            .await
            .map_err(|e| format!("find_substrate_by_intent substrate fts: {e}"))?;

        // Fallback: if FTS yields nothing, run a LIKE scan against `text`. Use
        // the user's RAW query (not OR-tokenized) so substring matching works
        // intuitively on multi-word inputs like "soft delete grace".
        if substrate_rows.is_empty() && !query.trim().is_empty() {
            let like_pattern = format!("%{}%", query.trim());
            let like_sql = if has_intent_col {
                r#"
                SELECT uuid,
                       node_type,
                       text,
                       invalid_at,
                       intent_drift_state,
                       anchored_uuids,
                       0.0 AS fts_rank
                FROM substrate_nodes
                WHERE invalid_at IS NULL
                  AND text LIKE ?1
                LIMIT ?2
                "#
            } else {
                r#"
                SELECT uuid,
                       node_type,
                       text,
                       invalid_at,
                       CAST(NULL AS TEXT) AS intent_drift_state,
                       anchored_uuids,
                       0.0 AS fts_rank
                FROM substrate_nodes
                WHERE invalid_at IS NULL
                  AND text LIKE ?1
                LIMIT ?2
                "#
            };

            substrate_rows = sqlx::query_as(like_sql)
                .bind(&like_pattern)
                .bind(limit as i64)
                .fetch_all(&pool)
                .await
                .map_err(|e| format!("find_substrate_by_intent substrate like: {e}"))?;
        }

        for (uuid, node_type, text, invalid_at, intent_drift_state, anchored_uuids_json, _rank) in
            substrate_rows
        {
            let state = derive_state(intent_drift_state.as_deref(), invalid_at.as_deref());
            let name = first_line(&text, &uuid);
            let summary = text.chars().take(200).collect::<String>();
            // Pull first anchored uuid for navigation. Defensive: empty array
            // and bad JSON both yield None — the frontend will fall back to a
            // generic detail-panel open.
            let parent_uuid = first_anchored_uuid(&anchored_uuids_json);

            hits.push(IntentSearchHit {
                uuid,
                kind: node_type,
                level: None,
                name,
                summary,
                state: Some(state.to_string()),
                parent_uuid,
                // Flat substrate score so contracts dominate the top of the
                // list; tie-break by FTS rank within the substrate slice via
                // small bias if rank is non-zero.
                score: 0.5,
            });
        }
    }

    // ---------- Merge + truncate ----------
    //
    // Sort descending by score (contracts → 0.5+; substrate → 0.5). Within
    // contracts the BM25-derived score gives the right order; substrate hits
    // tie at 0.5 and stay in their original FTS-rank order (Vec::sort is
    // stable so ties preserve insertion order).
    hits.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    hits.truncate(limit as usize);
    Ok(hits)
}

/// Pull the first uuid from a JSON array string. Returns None for empty array,
/// invalid JSON, non-array shapes, or non-string elements. Defensive — the
/// `anchored_uuids` column has `DEFAULT '[]'` per migration v6 so empty array
/// is the common case.
fn first_anchored_uuid(json_str: &str) -> Option<String> {
    let parsed: serde_json::Value = serde_json::from_str(json_str).ok()?;
    let arr = parsed.as_array()?;
    let first = arr.first()?;
    first.as_str().map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_line_takes_first_non_empty_line() {
        assert_eq!(first_line("hello\nworld", "abc"), "hello");
        assert_eq!(first_line("\n\nhello", "abc"), "hello");
        assert_eq!(first_line("   spaced   \n", "abc"), "spaced");
    }

    #[test]
    fn first_line_falls_back_to_uuid_prefix_on_empty() {
        let s = first_line("", "deadbeef-1234-5678-abcd-1234567890ab");
        assert_eq!(s, "substrate deadbeef");
    }

    #[test]
    fn first_line_caps_at_80_chars() {
        let long = "a".repeat(200);
        let s = first_line(&long, "abc");
        assert_eq!(s.len(), 80);
    }

    #[test]
    fn derive_state_intent_drifted_wins() {
        assert_eq!(derive_state(Some("DRIFTED"), None), "intent_drifted");
        assert_eq!(
            derive_state(Some("DRIFTED"), Some("2026-04-25T00:00:00Z")),
            "intent_drifted"
        );
    }

    #[test]
    fn derive_state_invalid_at_means_superseded() {
        assert_eq!(
            derive_state(None, Some("2026-04-25T00:00:00Z")),
            "superseded"
        );
        assert_eq!(
            derive_state(Some("NOT_DRIFTED"), Some("2026-04-25T00:00:00Z")),
            "superseded"
        );
    }

    #[test]
    fn derive_state_default_fresh() {
        assert_eq!(derive_state(None, None), "fresh");
        assert_eq!(derive_state(Some("NOT_DRIFTED"), None), "fresh");
        assert_eq!(derive_state(Some("NEEDS_HUMAN_REVIEW"), None), "fresh");
    }

    // ----- Phase 13 Plan 03 helpers -----

    #[test]
    fn fts_or_query_natural_language_or_tokenizes_with_stopwords_dropped() {
        // Beat 1 entry query for the demo: drops "to", keeps "settings",
        // "danger", "account". Each remaining token quoted + OR'd.
        let q = build_fts_or_query("account settings danger");
        assert_eq!(q, r#""account" OR "settings" OR "danger""#);
    }

    #[test]
    fn fts_or_query_drops_articles_and_aux_verbs() {
        let q = build_fts_or_query("the workspace is deleted");
        // "the", "is" stripped — "deleted" left intact (action word, not stopword).
        assert_eq!(q, r#""workspace" OR "deleted""#);
    }

    #[test]
    fn fts_or_query_passthrough_on_explicit_operators() {
        let q1 = build_fts_or_query("account AND danger");
        assert_eq!(q1, "account AND danger");
        let q2 = build_fts_or_query(r#""danger zone""#);
        assert_eq!(q2, r#""danger zone""#);
    }

    #[test]
    fn fts_or_query_empty_returns_empty() {
        assert_eq!(build_fts_or_query(""), "");
        assert_eq!(build_fts_or_query("   "), "");
    }

    #[test]
    fn fts_or_query_stopwords_only_falls_back() {
        // Every input token is a stopword — fallback re-tokenizes WITHOUT the
        // filter so the query still produces some output.
        let q = build_fts_or_query("the of a");
        assert_eq!(q, r#""the" OR "of" OR "a""#);
    }

    #[test]
    fn fts_or_query_punctuation_splits_tokens() {
        let q = build_fts_or_query("account-settings.danger:zone");
        assert_eq!(
            q,
            r#""account" OR "settings" OR "danger" OR "zone""#
        );
    }

    #[test]
    fn first_anchored_uuid_extracts_first_string() {
        assert_eq!(
            first_anchored_uuid(r#"["uuid-a","uuid-b"]"#),
            Some("uuid-a".to_string())
        );
    }

    #[test]
    fn first_anchored_uuid_returns_none_for_empty_array() {
        assert_eq!(first_anchored_uuid("[]"), None);
    }

    #[test]
    fn first_anchored_uuid_returns_none_for_invalid_json() {
        assert_eq!(first_anchored_uuid("not json"), None);
        assert_eq!(first_anchored_uuid(""), None);
    }

    #[test]
    fn first_anchored_uuid_returns_none_for_object_or_non_string_element() {
        // Object instead of array.
        assert_eq!(first_anchored_uuid(r#"{"k":"v"}"#), None);
        // Array of integers — element is not a string.
        assert_eq!(first_anchored_uuid("[1, 2, 3]"), None);
    }
}
