// Phase 13.5 — Constraint narrowing IPC.
//
// Backs the Sync Review surface's flag → Accept narrowing → Merge flow.
// On Accept, the user types free-form text describing how to narrow a
// stale parent-surface constraint. This IPC writes that narrowing into
// the live substrate_nodes row by:
//
//   1. Appending the narrowing as a dated clause onto applies_when, so
//      the next time someone clicks the citation pill the modal shows
//      the rule's evolved scope.
//   2. Clearing intent_drift_state so the rule no longer surfaces as an
//      orange flag in subsequent verifier runs.
//
// Idempotent on demo data because reset-demo.sh re-applies the seed,
// restoring the original applies_when and re-arming intent_drift_state.

use sqlx::Row;
use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool};

async fn pool_clone(app: &tauri::AppHandle) -> Result<sqlx::SqlitePool, String> {
    let instances = app.state::<DbInstances>();
    let db_map = instances.0.read().await;
    let db = db_map
        .get("sqlite:contract-ide.db")
        .ok_or_else(|| "DB not loaded".to_string())?;
    match db {
        DbPool::Sqlite(p) => Ok(p.clone()),
        #[allow(unreachable_patterns)]
        _ => Err("expected sqlite pool".into()),
    }
}

#[derive(serde::Serialize)]
pub struct NarrowingResult {
    /// Updated applies_when value, ready for the panel to display in its receipt.
    pub new_applies_when: String,
    /// Previous applies_when value (for the demo receipt's "before/after").
    pub previous_applies_when: Option<String>,
}

/// Append a dated narrowing clause to a substrate node's applies_when and
/// clear its intent_drift_state. Returns the new + previous applies_when
/// so the UI receipt can show what changed.
#[tauri::command]
pub async fn apply_constraint_narrowing(
    app: tauri::AppHandle,
    uuid: String,
    narrowing: String,
) -> Result<NarrowingResult, String> {
    let trimmed = narrowing.trim();
    if trimmed.is_empty() {
        return Err("Narrowing text is empty".into());
    }
    let pool = pool_clone(&app).await?;

    // Read existing applies_when
    let row = sqlx::query("SELECT applies_when FROM substrate_nodes WHERE uuid = ?1")
        .bind(&uuid)
        .fetch_optional(&pool)
        .await
        .map_err(|e| format!("read applies_when: {e}"))?;

    let Some(r) = row else {
        return Err(format!("Substrate node not found: {uuid}"));
    };
    let previous: Option<String> = r.try_get("applies_when").ok();

    // Compose narrowed applies_when. Format keeps the original intact and
    // adds a clearly-marked narrowing clause; future reads can still see
    // the original framing.
    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let narrowed = match &previous {
        Some(prev) if !prev.is_empty() => {
            format!("{prev}\n\n— narrowed {date}: {trimmed}")
        }
        _ => format!("narrowed {date}: {trimmed}"),
    };

    // Write: update applies_when + clear intent_drift_state.
    sqlx::query(
        "UPDATE substrate_nodes
         SET applies_when = ?1,
             intent_drift_state = NULL,
             intent_drift_reasoning = NULL
         WHERE uuid = ?2",
    )
    .bind(&narrowed)
    .bind(&uuid)
    .execute(&pool)
    .await
    .map_err(|e| format!("update substrate_nodes: {e}"))?;

    Ok(NarrowingResult {
        new_applies_when: narrowed,
        previous_applies_when: previous,
    })
}
