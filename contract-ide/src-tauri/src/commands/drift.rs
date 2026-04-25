//! Phase 7 Plan 07-02: Drift Tauri commands.
//!
//! Provides:
//!   - `refresh_source_watcher_from_db`: reusable helper that reads the full
//!     set of `(uuid, code_ranges.file[])` pairs from SQLite and calls
//!     `SourceWatcher::refresh`. Single source of truth — called from both
//!     `open_repo` and `refresh_nodes` in `commands/repo.rs`.
//!   - `acknowledge_drift`: Tauri command that clears the drift flag for a
//!     specific node UUID by setting `drift_state.reconciled_at` and emitting
//!     `drift:changed { drifted: false }` so the React red pulse clears.
//!
//! IMPORTANT: `refresh_source_watcher_from_db` MUST NOT be called from inside
//! `drift::engine::compute_and_emit`. Calling refresh from inside the engine
//! would recursively re-register the watcher on every drift event — disaster.
//! The only valid call sites are `open_repo` and `refresh_nodes` in repo.rs.

use std::collections::HashMap;
use std::path::Path;
use tauri::AppHandle;
use tauri::Manager;

/// Read every node's `(uuid, list-of-code-range-files)` from SQLite and
/// re-register the source-file watcher. Called from `open_repo` AFTER
/// `scan_contracts_dir` awaits AND from `refresh_nodes` AFTER its DB upserts
/// settle so a newly-derived node's `code_ranges` start being observed within
/// the sidecar-refresh window (RESEARCH.md Pitfall 7).
///
/// Failures are logged via `eprintln!` but do NOT propagate to the caller —
/// a failed watcher refresh puts the app in a degraded "no drift detection"
/// mode, but the repo open / node refresh should still succeed.
///
/// IMPORTANT: This helper releases the `DbInstances` read lock before calling
/// `watcher.refresh` to avoid holding the DB lock during the (potentially
/// blocking) notify watcher setup. The drop is implicit — the `map` binding
/// falls out of scope before the watcher call.
pub async fn refresh_source_watcher_from_db(app: &AppHandle, repo_path: &Path) {
    let instances = app.state::<tauri_plugin_sql::DbInstances>();
    let map = instances.0.read().await;
    let Some(db) = map.get("sqlite:contract-ide.db") else {
        return;
    };
    let pool = match db {
        tauri_plugin_sql::DbPool::Sqlite(p) => p,
        #[allow(unreachable_patterns)]
        _ => return,
    };

    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT uuid, code_ranges FROM nodes WHERE code_ranges IS NOT NULL",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    // Phase 8 Plan 08-02: fetch uuid → parent_uuid map for rollup ancestor walk.
    // NULL parent_uuid rows are filtered out — they are L0 roots with no ancestor.
    let parent_rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT uuid, parent_uuid FROM nodes WHERE parent_uuid IS NOT NULL",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    // Build (uuid, Vec<file>) pairs, skipping nodes with empty or
    // undeserializable code_ranges. Malformed sidecar rows fall through to
    // unwrap_or_default() — existing `get_nodes` uses this same pattern.
    let mut pairs: Vec<(String, Vec<String>)> = Vec::new();
    for (uuid, ranges_json) in rows {
        let ranges: Vec<crate::sidecar::frontmatter::CodeRange> =
            serde_json::from_str(&ranges_json).unwrap_or_default();
        let files: Vec<String> = ranges.into_iter().map(|r| r.file).collect();
        if !files.is_empty() {
            pairs.push((uuid, files));
        }
    }

    // Build the uuid → parent_uuid map for the rollup ancestor walk.
    let parent_map: HashMap<String, String> = parent_rows.into_iter().collect();

    // Release the DB read lock before calling watcher.refresh.
    // notify::recommended_watcher setup is synchronous/blocking; holding the
    // DbInstances read lock through it would serialize concurrent DB queries.
    drop(map);

    let watcher = app.state::<crate::drift::watcher::SourceWatcher>();
    if let Err(e) = watcher.refresh(app.clone(), repo_path, &pairs, parent_map) {
        eprintln!("[drift] SourceWatcher::refresh failed: {e}");
    }
}

/// Clear the drift flag for a node by UUID.
///
/// Acquires the per-UUID `tokio::sync::Mutex` from `DriftLocks` BEFORE any DB
/// work so a concurrent watcher event for the same uuid cannot re-flag drifted
/// between our `UPDATE` and our `emit`. This is the same mutex that
/// `compute_and_emit` uses — guarantees sequential access per UUID.
///
/// Sets `drift_state.reconciled_at = now()` (silently no-ops if no row exists
/// for the uuid — idempotent UX). Emits `drift:changed { drifted: false }` so
/// the React graph clears the red pulse without requiring a full node refresh.
///
/// Payload shape matches `drift::engine::DriftChanged` camelCase so the React
/// listener can use one unified event-handler signature for both watcher events
/// and acknowledge events.
#[tauri::command]
pub async fn acknowledge_drift(app: AppHandle, uuid: String) -> Result<(), String> {
    // Acquire the per-UUID mutex BEFORE any DB work (prevents race with the
    // watcher re-flagging the same uuid between UPDATE and emit).
    let locks = app.state::<crate::drift::state::DriftLocks>();
    let mutex = locks.for_uuid(&uuid);
    let _guard = mutex.lock().await;

    let instances = app.state::<tauri_plugin_sql::DbInstances>();
    let map = instances.0.read().await;
    let db = map.get("sqlite:contract-ide.db").ok_or("DB not loaded")?;
    let pool = match db {
        tauri_plugin_sql::DbPool::Sqlite(p) => p,
        #[allow(unreachable_patterns)]
        _ => return Err("only sqlite supported".into()),
    };

    let now = chrono::Utc::now().to_rfc3339();

    // UPDATE only — the node must already have a drift_state row to
    // acknowledge. If no row exists the UPDATE affects 0 rows and we return
    // Ok(()) silently (idempotent — user acknowledging a non-drifted node is
    // harmless).
    sqlx::query("UPDATE drift_state SET reconciled_at = ?2 WHERE node_uuid = ?1")
        .bind(&uuid)
        .bind(&now)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    // Release the DB read lock before emitting. The frontend's event handler
    // may turn around and invoke another Rust command; releasing early prevents
    // any potential deadlock on the DbInstances RwLock.
    drop(map);

    // Emit drift:changed { drifted: false } to clear the red pulse.
    // Field names are camelCase to match `drift::engine::DriftChanged`'s
    // `#[serde(rename_all = "camelCase")]` shape — React uses one handler.
    use tauri::Emitter;
    let _ = app.emit(
        "drift:changed",
        serde_json::json!({
            "uuid": uuid,
            "drifted": false,
            "currentCodeHash": null,
            "baselineCodeHash": null,
        }),
    );

    Ok(())
}
