// Phase 13 Plan 08 — PR-review intent-drift IPC.
//
// `analyze_pr_diff` takes structured diff hunks (parsed in TS via
// parseDiffHunks) and returns:
//   - affected_uuids:        nodes whose code_ranges file+line overlaps a hunk
//   - intent_drifted_uuids:  subset whose substrate_nodes.intent_drift_state
//                            is 'DRIFTED' (Phase 12 cascade signal)
//
// Why structured hunks instead of raw diff text? The TS parser is simpler
// and the diff is small. Rust does the SQL join (more efficient than
// shipping all nodes to TS).
//
// Defensive on missing `substrate_nodes` table or `intent_drift_state`
// column — empty intent_drifted list, never errors. Mirrors Phase 13 Plan 01
// commands/substrate.rs defensive-boot pattern.
//
// Code-range JSON fields use snake_case (`start_line`, `end_line`, `file`)
// because Rust's serde default serialisation of CodeRange in
// sidecar/frontmatter.rs has no rename attribute.

use serde::{Deserialize, Serialize};
use sqlx::Row;
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct PrReviewResult {
    pub affected_uuids: Vec<String>,
    pub intent_drifted_uuids: Vec<String>,
    pub hunk_count: usize,
    pub file_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DiffHunkInput {
    pub file_path: String,
    pub new_start: i64,
    pub new_lines: i64,
}

async fn pool_clone(app: &AppHandle) -> Result<SqlitePool, String> {
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

async fn substrate_table_exists(pool: &SqlitePool) -> Result<bool, String> {
    let row: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='substrate_nodes'",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("substrate_table_exists: {e}"))?;
    Ok(row.0 > 0)
}

async fn intent_drift_column_present(pool: &SqlitePool) -> Result<bool, String> {
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

/// Analyze parsed diff hunks against the contract graph.
///
/// Returns `affected_uuids` (file+line overlap) and `intent_drifted_uuids`
/// (subset whose substrate state is DRIFTED). Defensive on missing
/// substrate_nodes table or intent_drift_state column — empty list, never
/// errors.
#[tauri::command]
pub async fn analyze_pr_diff(
    app: AppHandle,
    hunks: Vec<DiffHunkInput>,
) -> Result<PrReviewResult, String> {
    if hunks.is_empty() {
        return Ok(PrReviewResult {
            affected_uuids: vec![],
            intent_drifted_uuids: vec![],
            hunk_count: 0,
            file_count: 0,
        });
    }

    let pool = pool_clone(&app).await?;
    let file_count = hunks
        .iter()
        .map(|h| &h.file_path)
        .collect::<std::collections::HashSet<_>>()
        .len();

    // Fetch all nodes with code_ranges. At hackathon scale (~50-200 nodes),
    // this is cheap; avoids per-hunk SQL roundtrips and lets us do JSON
    // parsing once per node.
    let rows = sqlx::query("SELECT uuid, code_ranges FROM nodes WHERE code_ranges IS NOT NULL")
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("nodes select: {e}"))?;

    let mut affected = std::collections::HashSet::<String>::new();
    for row in rows {
        let uuid: String = row.get("uuid");
        let code_ranges_str: Option<String> = row.try_get("code_ranges").ok();
        let Some(cr) = code_ranges_str else { continue };
        let parsed: Result<Vec<serde_json::Value>, _> = serde_json::from_str(&cr);
        let Ok(ranges) = parsed else { continue };
        let mut hit = false;
        for r in ranges {
            let file = r.get("file").and_then(|v| v.as_str()).unwrap_or("");
            // Frontmatter uses snake_case (start_line/end_line — Rust serde default).
            let start = r
                .get("start_line")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let end = r
                .get("end_line")
                .and_then(|v| v.as_i64())
                .unwrap_or(i64::MAX);
            for h in &hunks {
                if h.file_path == file {
                    let h_end = h.new_start + (h.new_lines - 1).max(0);
                    if end >= h.new_start && start <= h_end {
                        affected.insert(uuid.clone());
                        hit = true;
                        break;
                    }
                }
            }
            if hit {
                break;
            }
        }
    }

    // Intersect with substrate_nodes.intent_drift_state == 'DRIFTED', if both
    // table and column exist.
    let mut intent_drifted: Vec<String> = vec![];
    if substrate_table_exists(&pool).await?
        && intent_drift_column_present(&pool).await?
    {
        let drifted_rows = sqlx::query(
            "SELECT DISTINCT uuid FROM substrate_nodes WHERE intent_drift_state = 'DRIFTED'",
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("substrate_nodes select: {e}"))?;
        for r in drifted_rows {
            // substrate_nodes.uuid may not be a contract uuid in every schema;
            // intersect against the affected set so we only return uuids that
            // are both file-affected and substrate-drifted.
            let u: String = r.try_get("uuid").unwrap_or_default();
            if !u.is_empty() && affected.contains(&u) {
                intent_drifted.push(u);
            }
        }
    }

    Ok(PrReviewResult {
        affected_uuids: affected.into_iter().collect(),
        intent_drifted_uuids: intent_drifted,
        hunk_count: hunks.len(),
        file_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diff_hunk_input_deserialises_snake_case() {
        let json = r#"{"file_path":"a.ts","new_start":10,"new_lines":5}"#;
        let h: DiffHunkInput = serde_json::from_str(json).unwrap();
        assert_eq!(h.file_path, "a.ts");
        assert_eq!(h.new_start, 10);
        assert_eq!(h.new_lines, 5);
    }

    #[test]
    fn pr_review_result_serialises_snake_case() {
        let r = PrReviewResult {
            affected_uuids: vec!["u1".into()],
            intent_drifted_uuids: vec![],
            hunk_count: 1,
            file_count: 1,
        };
        let s = serde_json::to_string(&r).unwrap();
        assert!(s.contains("affected_uuids"));
        assert!(s.contains("intent_drifted_uuids"));
        assert!(s.contains("hunk_count"));
    }
}
