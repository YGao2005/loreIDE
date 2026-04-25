//! Substrate review queue — the human approve/deny gate.
//!
//! Two writers can produce a row with `published_at = NULL`:
//!   1. The post-session distiller (`distiller/pipeline.rs`) — runs after a
//!      Claude Code session ends, sweeps the transcript with `claude -p`.
//!   2. The MCP tool `record_substrate_rule` — fired live by the coding
//!      agent during a chat turn.
//!
//! Both land in `substrate_nodes` with `published_at = NULL`. This module
//! exposes the IPCs the chat-banner UI calls to drain that queue.
//!
//! - `list_pending_substrate` — read the queue.
//! - `approve_substrate` — flip `published_at` to now (becomes visible to
//!   retrieval, MCP read tools, the canvas).
//! - `reject_substrate` — DELETE the row. The agent may try to capture the
//!   same rule again later, which will land back in the queue under the same
//!   idempotent UUID — re-presenting the user with the same choice. That's
//!   the right behavior: a deny means "not now," not "remember forever."

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use tauri::Manager;
use tauri_plugin_sql::DbInstances;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingSubstrateRow {
    pub uuid: String,
    pub node_type: String,
    pub text: String,
    pub scope: Option<String>,
    pub applies_when: Option<String>,
    pub source_quote: Option<String>,
    pub source_actor: Option<String>,
    pub confidence: String,
    pub created_at: String,
    /// Synthesized short label (first clause of `text`) so the banner can show
    /// a one-line headline before the user expands the row. Mirrors the field
    /// the existing `substrate:nodes-added` event payload uses.
    pub name: String,
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

/// Lift the leading clause out of `text` for a one-line banner headline.
/// Mirrors `distiller::pipeline::derive_node_name` semantics: trim, take up
/// to the first sentence boundary or 60 chars, ellipsize when content was lost.
fn derive_name(text: &str) -> String {
    let t = text.trim();
    if t.is_empty() {
        return "Untitled rule".to_string();
    }
    let dot = t.find('.');
    let nl = t.find('\n');
    let raw_cut = match (dot, nl) {
        (Some(d), Some(n)) => d.min(n),
        (Some(d), None) => d,
        (None, Some(n)) => n,
        (None, None) => t.len(),
    };
    let cut = raw_cut.min(60);
    let head = t[..cut].trim();
    // Ellipsize only when content beyond the cut was meaningful — i.e. there
    // is more text after a newline / hard length cap. A trailing period that
    // ends the only sentence shouldn't read as "…".
    let trailing = t[cut..].trim_start_matches('.').trim();
    if trailing.is_empty() {
        head.to_string()
    } else {
        format!("{head}…")
    }
}

/// Pending = row exists but `published_at IS NULL`. Oldest first so the
/// banner shows them in the order they were captured.
#[tauri::command]
pub async fn list_pending_substrate(
    app: tauri::AppHandle,
) -> Result<Vec<PendingSubstrateRow>, String> {
    let pool = pool_clone(&app).await?;
    let rows = sqlx::query(
        r#"SELECT uuid, node_type, text, scope, applies_when,
                  source_quote, source_actor, confidence, created_at
           FROM substrate_nodes
           WHERE published_at IS NULL
             AND invalid_at IS NULL
           ORDER BY created_at ASC"#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("list_pending_substrate query: {e}"))?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let text: String = row.try_get("text").unwrap_or_default();
        out.push(PendingSubstrateRow {
            uuid: row.try_get("uuid").unwrap_or_default(),
            node_type: row.try_get("node_type").unwrap_or_default(),
            name: derive_name(&text),
            text,
            scope: row.try_get("scope").ok(),
            applies_when: row.try_get("applies_when").ok(),
            source_quote: row.try_get("source_quote").ok(),
            source_actor: row.try_get("source_actor").ok(),
            confidence: row
                .try_get("confidence")
                .unwrap_or_else(|_| "inferred".to_string()),
            created_at: row.try_get("created_at").unwrap_or_default(),
        });
    }
    Ok(out)
}

/// Approve a pending row — set `published_at = now`. Idempotent: re-approving
/// an already-approved row is a no-op (the WHERE clause limits to NULL).
#[tauri::command]
pub async fn approve_substrate(
    app: tauri::AppHandle,
    uuid: String,
) -> Result<(), String> {
    let pool = pool_clone(&app).await?;
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "UPDATE substrate_nodes SET published_at = ?1
         WHERE uuid = ?2 AND published_at IS NULL",
    )
    .bind(&now)
    .bind(&uuid)
    .execute(&pool)
    .await
    .map_err(|e| format!("approve_substrate update: {e}"))?;
    Ok(())
}

/// Reject a pending row — DELETE. The CASCADE on `substrate_edges` cleans up
/// any anchor edges. Already-published rows are out of scope for review and
/// won't be hit by this call (UI only ever lists pending).
#[tauri::command]
pub async fn reject_substrate(
    app: tauri::AppHandle,
    uuid: String,
) -> Result<(), String> {
    let pool = pool_clone(&app).await?;
    sqlx::query(
        "DELETE FROM substrate_nodes
         WHERE uuid = ?1 AND published_at IS NULL",
    )
    .bind(&uuid)
    .execute(&pool)
    .await
    .map_err(|e| format!("reject_substrate delete: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::derive_name;

    #[test]
    fn derive_name_lifts_first_clause() {
        assert_eq!(
            derive_name("Destructive primary actions use #FF0000."),
            "Destructive primary actions use #FF0000"
        );
    }

    #[test]
    fn derive_name_truncates_long_text() {
        let long = "a".repeat(200);
        let n = derive_name(&long);
        assert!(n.ends_with('…'));
        assert!(n.len() <= 64);
    }

    #[test]
    fn derive_name_handles_empty() {
        assert_eq!(derive_name("   "), "Untitled rule");
    }

    #[test]
    fn derive_name_stops_at_newline() {
        assert_eq!(
            derive_name("Use red for delete\n\nSee figma link"),
            "Use red for delete…"
        );
    }
}
