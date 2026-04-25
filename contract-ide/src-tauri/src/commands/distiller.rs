//! Tauri commands for the distiller subsystem (Plan 11-02).
//!
//! Three commands:
//! - `list_dead_letters` — surface failed distillation attempts for the dev panel
//! - `retry_dead_letter` — re-run distill_episode for a dead-letter row, delete on success
//! - `get_substrate_count_for_session` — quick count of current-truth substrate nodes per session
//!
//! Pool extraction follows the canonical async pattern from commands/nodes.rs:119-125.
//! DB key = "sqlite:contract-ide.db" (NOT .sqlite). Read guard dropped before .await.

use crate::distiller::{pipeline::distill_episode, types::DeadLetter};
use sqlx::SqlitePool;
use tauri::Manager;
use tauri_plugin_sql::DbInstances;

/// Canonical async pool extraction (mirrors commands/nodes.rs).
async fn pool_clone(app: &tauri::AppHandle) -> Result<SqlitePool, String> {
    let instances = app.state::<DbInstances>();
    let db_map = instances.0.read().await;
    let db = db_map
        .get("sqlite:contract-ide.db")
        .ok_or("DB not loaded")?;
    let pool = match db {
        tauri_plugin_sql::DbPool::Sqlite(p) => p.clone(),
        #[allow(unreachable_patterns)]
        _ => return Err("expected sqlite pool".into()),
    };
    // db_map drops here — safe to .await on the pool afterward.
    Ok(pool)
}

/// List all dead-letter rows, most recent first.
#[tauri::command]
pub async fn list_dead_letters(app: tauri::AppHandle) -> Result<Vec<DeadLetter>, String> {
    let pool = pool_clone(&app).await?;
    sqlx::query_as::<_, DeadLetter>(
        "SELECT id, episode_id, error_kind, raw_output, attempt_count, last_attempt_at
         FROM distiller_dead_letters
         ORDER BY last_attempt_at DESC",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("query: {e}"))
}

/// Re-run `distill_episode` for the given dead-letter row. On success, deletes
/// the dead-letter row. On failure, the new attempt is tracked in distiller_dead_letters.
#[tauri::command]
pub async fn retry_dead_letter(app: tauri::AppHandle, id: String) -> Result<usize, String> {
    // Look up episode_id for this dead-letter row.
    let pool = pool_clone(&app).await?;
    let row: (String,) =
        sqlx::query_as("SELECT episode_id FROM distiller_dead_letters WHERE id = ?")
            .bind(&id)
            .fetch_one(&pool)
            .await
            .map_err(|e| format!("dead-letter lookup: {e}"))?;

    // Re-run the distillation.
    let upserted = distill_episode(&app, &row.0).await?;

    // Success: delete the dead-letter row. Re-clone pool (Arc<> clone is cheap).
    let pool2 = pool_clone(&app).await?;
    sqlx::query("DELETE FROM distiller_dead_letters WHERE id = ?")
        .bind(&id)
        .execute(&pool2)
        .await
        .map_err(|e| format!("delete: {e}"))?;

    Ok(upserted)
}

/// Count current-truth substrate nodes for a session.
/// Filters `WHERE invalid_at IS NULL` (current-truth always — Phase 12 forward-compat).
#[tauri::command]
pub async fn get_substrate_count_for_session(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<i64, String> {
    let pool = pool_clone(&app).await?;
    let row: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM substrate_nodes WHERE source_session_id = ? AND invalid_at IS NULL",
    )
    .bind(&session_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| format!("count: {e}"))?;
    Ok(row.0)
}
