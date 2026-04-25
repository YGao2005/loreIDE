// Cheap retrieval path for the read-only Substrate side panel (Plan 11-05).
//
// list_substrate_for_atom — FTS5 + lineage scope, NO LLM rerank.
//   The Delegate overlay is the LLM-rerank path; the side panel is the
//   explore-without-cost path. Open Question 4 / RESEARCH §Don't Hand-Roll.
//
// get_total_substrate_count — single COUNT(*) for the footer indicator.
//
// Both commands use the canonical async pool extraction pattern:
//   app.state::<DbInstances>() → read lock → get("sqlite:contract-ide.db") → clone pool
// (nodes.rs:94-102 pattern)

use crate::retrieval::{candidates::candidate_selection, scope::lineage_scope_uuids, ScopeUsed, SubstrateHit};
use crate::distiller::types::SubstrateNode;
use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool};
use sqlx::SqlitePool;

/// Extract a cloned SqlitePool from the managed DbInstances state.
/// Canonical pattern from commands/nodes.rs:94-102 (key: "sqlite:contract-ide.db").
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

/// Cheap retrieval path for the read-only Substrate side panel.
///
/// - If `query` is provided: FTS5 + lineage cousin-exclusion JOIN (Plan 11-03 candidate_selection,
///   no LLM rerank). Returns up to `limit` SubstrateHits ordered by FTS5 rank.
/// - If no query: returns ALL current-truth substrate nodes whose anchored_uuids intersects
///   the lineage scope, ordered by valid_at DESC. Falls back to all current-truth substrate
///   if the lineage JOIN returns 0 rows (mirrors the broad-fallback in candidate_selection).
///
/// Both paths filter `invalid_at IS NULL` (current-truth bitemporal filter).
#[tauri::command]
pub async fn list_substrate_for_atom(
    app: tauri::AppHandle,
    scope_uuid: String,
    query: Option<String>,
    limit: usize,
) -> Result<Vec<SubstrateHit>, String> {
    let pool = pool_clone(&app).await?;

    let lineage_uuids = lineage_scope_uuids(&pool, &scope_uuid).await?;

    let query_text = query.unwrap_or_default();
    if !query_text.is_empty() {
        // FTS5 path with cousin-exclusion — reuses Plan 11-03's candidate_selection
        // (which has the anchored JOIN + zero-hit broad fallback built in).
        return candidate_selection(&pool, &lineage_uuids, &query_text, None, limit).await;
    }

    // No query → return current-truth substrate scoped to the lineage via anchored_uuids JSON JOIN.
    // Ordered by valid_at DESC (most recently captured first).
    let nodes: Vec<SubstrateNode> = if lineage_uuids.is_empty() {
        // No lineage scope available (e.g. orphan node) — return global current-truth list.
        sqlx::query_as(
            r#"
            SELECT uuid, node_type, text, scope, applies_when,
                   source_session_id, source_turn_ref, source_quote, source_actor,
                   valid_at, invalid_at, expired_at, created_at,
                   confidence, episode_id, invalidated_by, anchored_uuids
            FROM substrate_nodes
            WHERE invalid_at IS NULL
            ORDER BY valid_at DESC
            LIMIT ?
            "#,
        )
        .bind(limit as i64)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("substrate list (global): {e}"))?
    } else {
        // Lineage-scoped: only rows whose anchored_uuids intersect the lineage set.
        // Uses SQLite json_each() to expand the JSON array and check membership.
        let placeholders = std::iter::repeat_n("?", lineage_uuids.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            r#"
            SELECT DISTINCT s.uuid, s.node_type, s.text, s.scope, s.applies_when,
                   s.source_session_id, s.source_turn_ref, s.source_quote, s.source_actor,
                   s.valid_at, s.invalid_at, s.expired_at, s.created_at,
                   s.confidence, s.episode_id, s.invalidated_by, s.anchored_uuids
            FROM substrate_nodes s
            WHERE s.invalid_at IS NULL
              AND EXISTS (
                  SELECT 1 FROM json_each(s.anchored_uuids) je
                  WHERE je.value IN ({placeholders})
              )
            ORDER BY s.valid_at DESC
            LIMIT ?
            "#
        );
        let mut q = sqlx::query_as::<_, SubstrateNode>(&sql);
        for u in &lineage_uuids {
            q = q.bind(u);
        }
        q = q.bind(limit as i64);
        let scoped = q
            .fetch_all(&pool)
            .await
            .map_err(|e| format!("substrate list (scoped): {e}"))?;

        if scoped.is_empty() {
            // Zero-hit fallback: no anchored substrate yet — return global list so the
            // side panel is informative rather than empty (mirrors candidate_selection's
            // broad-fallback strategy, ScopeUsed::Broad path).
            sqlx::query_as(
                r#"
                SELECT uuid, node_type, text, scope, applies_when,
                       source_session_id, source_turn_ref, source_quote, source_actor,
                       valid_at, invalid_at, expired_at, created_at,
                       confidence, episode_id, invalidated_by, anchored_uuids
                FROM substrate_nodes
                WHERE invalid_at IS NULL
                ORDER BY valid_at DESC
                LIMIT ?
                "#,
            )
            .bind(limit as i64)
            .fetch_all(&pool)
            .await
            .map_err(|e| format!("substrate list (broad fallback): {e}"))?
        } else {
            scoped
        }
    };

    let scope_used = if lineage_uuids.is_empty() {
        ScopeUsed::Broad
    } else {
        ScopeUsed::Lineage
    };

    Ok(nodes
        .into_iter()
        .map(|n| SubstrateHit::from_node(n, scope_used))
        .collect())
}

/// Total current-truth substrate count for the footer indicator.
///
/// Returns COUNT(*) of substrate_nodes WHERE invalid_at IS NULL.
/// Used by SubstrateStatusIndicator on mount to seed the initial count
/// (race-resistant: handles the case where substrate:ingested events fired
/// before the React component mounted, matching the McpStatusIndicator seed pattern).
#[tauri::command]
pub async fn get_total_substrate_count(app: tauri::AppHandle) -> Result<i64, String> {
    let pool = pool_clone(&app).await?;
    let row: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM substrate_nodes WHERE invalid_at IS NULL")
            .fetch_one(&pool)
            .await
            .map_err(|e| format!("substrate count: {e}"))?;
    Ok(row.0)
}
