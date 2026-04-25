//! Phase 8 Plan 08-02 rollup detection IPC commands.
//!
//! `list_rollup_states` — seeds the React rollup store on app boot (mirrors
//! Plan 07-03's drift seeding pattern: seed-on-mount + subscribe-to-events).
//!
//! `recompute_all_rollups` — cache-rebuild helper; walks all L1/L2/L3 nodes
//! bottom-up (L3 before L2 before L1) so children's section_hashes are fresh
//! before parents read them.
//!
//! NOTE: `tauri::generate_handler!` resolves commands by the `__cmd__<name>`
//! shim emitted ALONGSIDE each `#[tauri::command]` fn. The shim lives at the
//! definition site — pub-use re-exports do NOT propagate the shim. Always
//! register via fully-qualified `commands::rollup::list_rollup_states` etc.
//! (STATE.md decision: "pub-use re-exports break generate_handler!").

use serde::Serialize;
use tauri::Manager;
use tauri_plugin_sql::DbInstances;

/// Serde-friendly row returned by `list_rollup_states`.
/// Mirrors the `rollup_derived` table shape that the React store hydrates from.
#[derive(Debug, Serialize, Clone)]
pub struct RollupStateRow {
    pub node_uuid: String,
    pub state: String,
}

/// Return all rows from `rollup_derived`.
///
/// React's mount path calls this once on app boot to seed `useRollupStore`
/// before any `rollup:changed` events can fire (seed-on-mount + subscribe
/// pattern — Plan 07-03 lineage, applied to rollup).
#[tauri::command]
pub async fn list_rollup_states(
    app: tauri::AppHandle,
) -> Result<Vec<RollupStateRow>, String> {
    let instances = app.state::<DbInstances>();
    let map = instances.0.read().await;
    let Some(db) = map.get("sqlite:contract-ide.db") else {
        return Err("sqlite db not loaded".into());
    };
    let pool = match db {
        tauri_plugin_sql::DbPool::Sqlite(p) => p,
        #[allow(unreachable_patterns)]
        _ => return Err("non-sqlite DbPool variant".into()),
    };

    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT node_uuid, state FROM rollup_derived")
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|(node_uuid, state)| RollupStateRow { node_uuid, state })
        .collect())
}

/// Trigger a full rollup recompute for all L1/L2/L3 nodes.
///
/// Walks the nodes table ORDER BY level DESC (L3 → L2 → L1, skip L0/L4)
/// and spawns `compute_rollup_and_emit` for each UUID. L3 nodes are queued
/// before L2 so children's `section_hashes` are populated before their
/// parent reads them.
///
/// This is called:
/// 1. On app startup (lib.rs setup) after drift refresh — populates rollup_derived
///    from scratch.
/// 2. On demand from a future "force recompute" dev affordance (08-06 may surface).
#[tauri::command]
pub async fn recompute_all_rollups(app: tauri::AppHandle) -> Result<(), String> {
    trigger_recompute_all_rollups(app).await
}

/// Internal async helper — separated so `lib.rs`'s setup() can call it without
/// wrapping in a tauri::command. Also called by `recompute_all_rollups` above.
pub async fn trigger_recompute_all_rollups(app: tauri::AppHandle) -> Result<(), String> {
    let uuids = {
        let instances = app.state::<DbInstances>();
        let map = instances.0.read().await;
        let Some(db) = map.get("sqlite:contract-ide.db") else {
            return Err("sqlite db not loaded".into());
        };
        let pool = match db {
            tauri_plugin_sql::DbPool::Sqlite(p) => p,
            #[allow(unreachable_patterns)]
            _ => return Err("non-sqlite DbPool variant".into()),
        };

        // Order by level DESC so L3 (child) nodes are processed before L2, L2
        // before L1. This ensures section_hashes from child nodes are computed
        // (via lazy disk read) before their parent's rollup reads them.
        //
        // L0 exempt: rollup mechanics don't apply (plan spec).
        // L4 exempt: L4 are leaf atoms — no children to roll up.
        sqlx::query_as::<_, (String,)>(
            "SELECT uuid FROM nodes WHERE level IN ('L1','L2','L3') ORDER BY level DESC",
        )
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|(uuid,)| uuid)
        .collect::<Vec<String>>()
    };

    for uuid in uuids {
        let app2 = app.clone();
        let uuid2 = uuid.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = crate::drift::engine::compute_rollup_and_emit(&app2, &uuid2).await {
                eprintln!("[rollup] recompute_all: {uuid2}: {e}");
            }
        });
    }

    Ok(())
}
