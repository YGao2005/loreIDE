//! Chat decision retrieval + code-region reads.
//!
//! Live writes to `chat_decisions` / `decision_anchors` happen inside the MCP
//! sidecar (`record_decision` tool). The sidecar fires a stderr marker that
//! mcp.rs converts into a `chat:decision-recorded` Tauri event, so the active
//! ChatStream can render the new card immediately without polling. This module
//! covers the *read* side:
//!
//!   - `list_chat_decisions(chat_id?, tracking_id?)` — replay decisions when
//!     the user reopens a chat tab or scrolls history. Filtered by either
//!     chat_id or tracking_id (the live event already populated the active
//!     run; this is for cold loads).
//!   - `read_code_region(file, line_start, line_end)` — slice the repo file
//!     for inline expansion under each anchor in the DecisionList UI. Bounded
//!     to the open repo to prevent path traversal.

use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_sql::DbInstances;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatDecisionAnchor {
    pub file: String,
    pub line_start: i64,
    pub line_end: i64,
    pub kind: String,
    pub ord: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatDecisionRow {
    pub uuid: String,
    pub chat_id: Option<String>,
    pub tracking_id: Option<String>,
    pub decision: String,
    pub rationale: String,
    pub created_at: String,
    pub anchors: Vec<ChatDecisionAnchor>,
}

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

/// List decisions for the given chat or tracking id. At least one filter must
/// be provided — listing every decision across every chat would blow up the
/// UI on cold load and isn't a current product surface. Newest first.
#[tauri::command]
pub async fn list_chat_decisions(
    app: tauri::AppHandle,
    chat_id: Option<String>,
    tracking_id: Option<String>,
) -> Result<Vec<ChatDecisionRow>, String> {
    if chat_id.is_none() && tracking_id.is_none() {
        return Err("must filter by chat_id or tracking_id".into());
    }

    let pool = pool_clone(&app).await?;

    // Query decisions matching whichever filter was supplied. Both supplied =
    // intersection (both must match) — useful when a single chat has produced
    // multiple runs but only the active run's decisions should reload.
    let mut sql = String::from(
        "SELECT uuid, chat_id, tracking_id, decision, rationale, created_at \
         FROM chat_decisions WHERE 1=1",
    );
    if chat_id.is_some() {
        sql.push_str(" AND chat_id = ?");
    }
    if tracking_id.is_some() {
        sql.push_str(" AND tracking_id = ?");
    }
    sql.push_str(" ORDER BY datetime(created_at) DESC");

    let mut q = sqlx::query(&sql);
    if let Some(ref c) = chat_id {
        q = q.bind(c);
    }
    if let Some(ref t) = tracking_id {
        q = q.bind(t);
    }
    let decision_rows = q.fetch_all(&pool).await.map_err(|e| e.to_string())?;

    let mut out: Vec<ChatDecisionRow> = Vec::with_capacity(decision_rows.len());
    for r in decision_rows {
        let uuid: String = r.try_get("uuid").map_err(|e| e.to_string())?;
        let anchor_rows = sqlx::query(
            "SELECT file, line_start, line_end, kind, ord \
             FROM decision_anchors WHERE decision_uuid = ? ORDER BY ord ASC",
        )
        .bind(&uuid)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

        let anchors: Vec<ChatDecisionAnchor> = anchor_rows
            .iter()
            .map(|ar| ChatDecisionAnchor {
                file: ar.try_get("file").unwrap_or_default(),
                line_start: ar.try_get("line_start").unwrap_or(0),
                line_end: ar.try_get("line_end").unwrap_or(0),
                kind: ar.try_get("kind").unwrap_or_else(|_| "code".to_string()),
                ord: ar.try_get("ord").unwrap_or(0),
            })
            .collect();

        out.push(ChatDecisionRow {
            uuid,
            chat_id: r.try_get("chat_id").ok(),
            tracking_id: r.try_get("tracking_id").ok(),
            decision: r.try_get("decision").unwrap_or_default(),
            rationale: r.try_get("rationale").unwrap_or_default(),
            created_at: r.try_get("created_at").unwrap_or_default(),
            anchors,
        });
    }

    Ok(out)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeRegion {
    /// 1-indexed inclusive line range actually returned (may be clamped if the
    /// file is shorter than the requested range).
    pub line_start: i64,
    pub line_end: i64,
    /// Total line count in the file — useful so the UI can show "lines 42-58
    /// of 312" context.
    pub total_lines: i64,
    /// File slice text, joined with `\n`.
    pub text: String,
}

/// Read a 1-indexed inclusive line range from the file. Path is resolved
/// against the currently-open repo and rejected if it escapes the repo root.
#[tauri::command]
pub async fn read_code_region(
    app: tauri::AppHandle,
    file: String,
    line_start: i64,
    line_end: i64,
) -> Result<CodeRegion, String> {
    if line_start < 1 {
        return Err(format!("line_start must be >= 1 (got {line_start})"));
    }
    if line_end < line_start {
        return Err(format!(
            "line_end ({line_end}) must be >= line_start ({line_start})"
        ));
    }

    let repo_path: PathBuf = {
        let repo_state = app.state::<crate::commands::repo::RepoState>();
        let guard = repo_state
            .0
            .lock()
            .map_err(|e| format!("RepoState lock poisoned: {e}"))?;
        guard
            .clone()
            .ok_or("no repository open — call open_repo first")?
    };

    let candidate = repo_path.join(&file);
    let canonical = candidate
        .canonicalize()
        .map_err(|e| format!("canonicalize {file}: {e}"))?;
    let repo_canonical = repo_path
        .canonicalize()
        .map_err(|e| format!("canonicalize repo: {e}"))?;
    if !canonical.starts_with(&repo_canonical) {
        return Err(format!("path {file} escapes repo root"));
    }

    let text = std::fs::read_to_string(&canonical)
        .map_err(|e| format!("read {}: {e}", canonical.display()))?;

    let lines: Vec<&str> = text.split('\n').collect();
    let total_lines = lines.len() as i64;
    let start_idx = (line_start - 1).max(0) as usize;
    let end_idx_inclusive = ((line_end - 1).min(total_lines - 1)).max(0) as usize;
    let actual_end = (end_idx_inclusive + 1).min(lines.len());
    let actual_start = start_idx.min(actual_end);

    let slice = lines[actual_start..actual_end].join("\n");

    Ok(CodeRegion {
        line_start: (actual_start as i64) + 1,
        line_end: (actual_end as i64),
        total_lines,
        text: slice,
    })
}

