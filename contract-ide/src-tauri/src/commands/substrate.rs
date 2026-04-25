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
use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool};

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
        SELECT uuid, node_type, text,
               source_session_id, source_turn_ref, source_quote, source_actor,
               confidence, invalid_at, intent_drift_state
        FROM substrate_nodes WHERE uuid = ?1 LIMIT 1
        "#
    } else {
        r#"
        SELECT uuid, node_type, text,
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
        confidence,
    }))
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
}
