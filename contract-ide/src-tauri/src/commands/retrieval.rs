use crate::retrieval::{
    candidates::candidate_selection, rerank::llm_rerank, scope::lineage_scope_uuids, SubstrateHit,
};
use sqlx::SqlitePool;
use tauri::Manager;
use tauri_plugin_sql::DbInstances;

/// Extract and clone the SqlitePool from AppHandle.
///
/// Mirrors commands/nodes.rs:94-102 canonical pattern:
/// - Pool key: "sqlite:contract-ide.db"
/// - Async read().await on tokio RwLock
/// - Clone the pool (Arc-internal, cheap) and DROP the read guard before
///   any subsequent .await to satisfy clippy::await_holding_lock
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
    // Read guard drops here — pool clone is cheap (Arc internally).
    Ok(pool)
}

/// Private Tauri IPC command — NOT exposed via MCP per CONTEXT lock.
/// Used by Plan 11-04 delegate_compose to retrieve the 5 substrate hits
/// for the composing overlay.
///
/// Three-stage pipeline:
/// 1. lineage_scope_uuids(scope_uuid) — computes parent + ancestors + siblings set
///    (cousins EXCLUDED per CONTEXT lock). Used as HARD JOIN FILTER on anchored_uuids.
/// 2. candidate_selection(scope, query, top-15) — FTS5 + cousin-exclusion JOIN via
///    json_each(substrate_nodes.anchored_uuids) WHERE je.value IN (lineage_uuids).
///    Optional embedding cosine + RRF k=60. Zero-hit fallback sets ScopeUsed::Broad.
/// 3. (optional) llm_rerank(contract_body, candidates, limit) — listwise LLM rerank
///    via claude -p --bare. Only fired when with_rerank=true (Delegate dispatch).
///    MCP tool hot-paths (Plan 11-02) do NOT call rerank — cost discipline.
#[tauri::command]
pub async fn find_substrate_for_atom(
    app: tauri::AppHandle,
    scope_uuid: String,
    query: String,
    contract_body: String,
    limit: usize,
    with_rerank: bool,
) -> Result<Vec<SubstrateHit>, String> {
    let pool = pool_clone(&app).await?;

    // Stage 1: Lineage scope — HARD JOIN FILTER on anchored_uuids (cousins excluded).
    let scope_uuids = lineage_scope_uuids(&pool, &scope_uuid).await?;

    // Stage 2: Candidate selection — FTS5 + cousin-exclusion JOIN over top-15.
    // query_embedding is None for the v1 FTS5-only path; embeddings usable once
    // Plan 11-02 or a subsequent plan populates substrate_embeddings.
    let candidates = candidate_selection(
        &pool,
        &scope_uuids,
        &query,
        None, // query_embedding — None for v1 FTS5-only path
        15,
    )
    .await?;

    if !with_rerank || candidates.len() <= limit {
        return Ok(candidates.into_iter().take(limit).collect());
    }

    // Stage 3: LLM rerank top-15 → top-K. Pool is already cloned and owned;
    // safe to .await alongside the claude spawn.
    let reranked = llm_rerank(&app, &contract_body, &candidates, limit).await?;
    Ok(reranked)
}
