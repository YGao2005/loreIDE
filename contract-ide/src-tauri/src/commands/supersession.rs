//! Tauri commands for the supersession engine.
//! 12-02 ships fact-engine commands; 12-03 will add intent-engine commands.
//!
//! Pool extraction mirrors `distiller::pipeline::pool_clone` — read DbInstances,
//! clone the inner SqlitePool (cheap Arc), drop the read guard before any
//! `.await`. Satisfies clippy `await_holding_lock`.

use crate::supersession::fact_engine::invalidate_contradicted;
use crate::supersession::intent_engine::{
    preview_intent_drift_impact, propagate_intent_drift, record_priority_shift_internal,
    ImpactPreview,
};
use crate::supersession::queries::{fetch_current_substrate_nodes, fetch_substrate_history};
use crate::supersession::types::{IntentDriftResult, SubstrateNode};
use sqlx::SqlitePool;
use tauri::Manager;
use tauri_plugin_sql::DbInstances;

/// Get an OWNED clone of the contract-ide SqlitePool. Mirrors the canonical
/// pattern used in distiller/pipeline.rs.
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
    Ok(pool)
}

/// Synchronous ingestion-with-invalidation. Phase 11 distiller will call this after
/// every substrate_node upsert. For 12-02 standalone testability, also exposes the
/// invalidation step on an already-upserted node.
#[tauri::command]
pub async fn ingest_substrate_node_with_invalidation(
    app: tauri::AppHandle,
    new_uuid: String,
) -> Result<Vec<String>, String> {
    let pool = pool_clone(&app).await?;
    invalidate_contradicted(&app, &pool, &new_uuid).await
}

#[tauri::command]
pub async fn find_substrate_history_cmd(
    app: tauri::AppHandle,
    root_uuid: String,
) -> Result<Vec<SubstrateNode>, String> {
    let pool = pool_clone(&app).await?;
    fetch_substrate_history(&pool, &root_uuid)
        .await
        .map_err(|e| format!("find_substrate_history: {e}"))
}

#[tauri::command]
pub async fn current_truth_query_cmd(
    app: tauri::AppHandle,
    node_type: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<SubstrateNode>, String> {
    let pool = pool_clone(&app).await?;
    let lim = limit.unwrap_or(100);
    fetch_current_substrate_nodes(&pool, node_type.as_deref(), lim)
        .await
        .map_err(|e| format!("current_truth_query: {e}"))
}

// ----------- 12-03 intent-engine commands -----------

/// Record a priority shift. Frontend calls this when a user's L0 contract edit
/// is explicit-y declared as a priority shift (NOT auto-fired by every L0 edit
/// — RESEARCH.md Pitfall 3). Returns the new shift id.
#[tauri::command]
pub async fn record_priority_shift(
    app: tauri::AppHandle,
    old_l0_uuid: String,
    new_l0_uuid: String,
    valid_at: String,
    summary_of_old: String,
    summary_of_new: String,
) -> Result<String, String> {
    let pool = pool_clone(&app).await?;
    record_priority_shift_internal(
        &pool,
        &old_l0_uuid,
        &new_l0_uuid,
        &valid_at,
        &summary_of_old,
        &summary_of_new,
    )
    .await
}

/// DRY-RUN preview before full apply. Surfaces "N nodes will flip" gate.
#[tauri::command]
pub async fn preview_intent_drift_impact_cmd(
    app: tauri::AppHandle,
    priority_shift_id: String,
) -> Result<ImpactPreview, String> {
    let pool = pool_clone(&app).await?;
    preview_intent_drift_impact(&app, &pool, &priority_shift_id).await
}

/// Apply intent-drift judgment to ALL descendants. Marks shift applied on success.
/// Caller (frontend) should always run preview_intent_drift_impact_cmd FIRST and
/// confirm with the user before invoking this.
#[tauri::command]
pub async fn propagate_intent_drift_cmd(
    app: tauri::AppHandle,
    priority_shift_id: String,
) -> Result<IntentDriftResult, String> {
    let pool = pool_clone(&app).await?;
    propagate_intent_drift(&app, &pool, &priority_shift_id).await
}
