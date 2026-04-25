//! Chats — multi-tab chat persistence + History panel data layer.
//!
//! A chat = one logical conversation. Each agent run (turn) writes a receipt;
//! all receipts within a chat share the same `claude_session_id` (because
//! follow-up turns spawn claude with `--resume`). Chats with `closed_at IS NULL`
//! are open tabs in the right panel; closed chats live in the History view and
//! can be reopened by clearing `closed_at`.
//!
//! When a closed chat is reopened, the conversation content is reconstructed
//! by reading the session JSONL at
//! `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` (see Phase D —
//! `read_chat_jsonl`). No streamBuffer duplication in the DB.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqlitePool};
use tauri::Manager;
use tauri_plugin_sql::DbInstances;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRow {
    pub id: String,
    pub name: String,
    pub scope_uuid: Option<String>,
    pub claude_session_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub closed_at: Option<String>,
}

/// Async pool extraction — mirrors the pattern in commands/nodes.rs and
/// distiller/pipeline.rs. Returns an owned clone of the inner SqlitePool;
/// the DbInstances read guard drops at function return so callers can `.await`
/// safely (clippy `await_holding_lock`).
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

fn row_to_chat(row: &SqliteRow) -> Result<ChatRow, String> {
    Ok(ChatRow {
        id: row.try_get("id").map_err(|e| e.to_string())?,
        name: row.try_get("name").map_err(|e| e.to_string())?,
        scope_uuid: row.try_get("scope_uuid").ok(),
        claude_session_id: row.try_get("claude_session_id").ok(),
        created_at: row.try_get("created_at").map_err(|e| e.to_string())?,
        updated_at: row.try_get("updated_at").map_err(|e| e.to_string())?,
        closed_at: row.try_get("closed_at").ok(),
    })
}

fn fresh_chat_id() -> String {
    // 16 hex chars from a v4 uuid — short, collision-safe at hackathon scale,
    // matches the format the v9 backfill SQL uses (`'chat-' || lower(hex(randomblob(8)))`).
    let s = uuid::Uuid::new_v4().simple().to_string();
    format!("chat-{}", &s[..16])
}

/// Create a new chat row in the open state. Caller should activate it in the
/// frontend store immediately.
#[tauri::command]
pub async fn create_chat(
    app: tauri::AppHandle,
    scope_uuid: Option<String>,
    name: Option<String>,
) -> Result<ChatRow, String> {
    let pool = pool_clone(&app).await?;
    let id = fresh_chat_id();
    let now = Utc::now().to_rfc3339();
    let chat_name = name.unwrap_or_else(|| "New chat".to_string());
    sqlx::query(
        r#"INSERT INTO chats (id, name, scope_uuid, claude_session_id, created_at, updated_at, closed_at)
           VALUES (?1, ?2, ?3, NULL, ?4, ?4, NULL)"#,
    )
    .bind(&id)
    .bind(&chat_name)
    .bind(&scope_uuid)
    .bind(&now)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(ChatRow {
        id,
        name: chat_name,
        scope_uuid,
        claude_session_id: None,
        created_at: now.clone(),
        updated_at: now,
        closed_at: None,
    })
}

/// All open chats (closed_at IS NULL), ordered by creation time ascending so
/// the tab strip renders left-to-right in the order chats were opened.
#[tauri::command]
pub async fn list_open_chats(app: tauri::AppHandle) -> Result<Vec<ChatRow>, String> {
    let pool = pool_clone(&app).await?;
    let rows = sqlx::query(
        "SELECT id, name, scope_uuid, claude_session_id, created_at, updated_at, closed_at
         FROM chats
         WHERE closed_at IS NULL
         ORDER BY created_at ASC",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    rows.iter().map(row_to_chat).collect()
}

/// Closed chats (closed_at IS NOT NULL), most recently closed first. The
/// History panel paginates via `limit`/`offset`.
#[tauri::command]
pub async fn list_history_chats(
    app: tauri::AppHandle,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<ChatRow>, String> {
    let pool = pool_clone(&app).await?;
    let rows = sqlx::query(
        "SELECT id, name, scope_uuid, claude_session_id, created_at, updated_at, closed_at
         FROM chats
         WHERE closed_at IS NOT NULL
         ORDER BY closed_at DESC
         LIMIT ?1 OFFSET ?2",
    )
    .bind(limit.unwrap_or(50))
    .bind(offset.unwrap_or(0))
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    rows.iter().map(row_to_chat).collect()
}

/// Move a chat to the History panel — sets closed_at to now. Reversible via
/// reopen_chat (Cursor model — closing is not destructive).
#[tauri::command]
pub async fn close_chat(app: tauri::AppHandle, chat_id: String) -> Result<(), String> {
    let pool = pool_clone(&app).await?;
    let now = Utc::now().to_rfc3339();
    sqlx::query("UPDATE chats SET closed_at = ?1, updated_at = ?1 WHERE id = ?2")
        .bind(&now)
        .bind(&chat_id)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Restore a closed chat back to the open tab strip. Returns the refreshed row
/// so the frontend can populate ChatSession state directly. Caller should also
/// invoke `read_chat_jsonl` to reconstruct conversation content.
#[tauri::command]
pub async fn reopen_chat(app: tauri::AppHandle, chat_id: String) -> Result<ChatRow, String> {
    let pool = pool_clone(&app).await?;
    let now = Utc::now().to_rfc3339();
    sqlx::query("UPDATE chats SET closed_at = NULL, updated_at = ?1 WHERE id = ?2")
        .bind(&now)
        .bind(&chat_id)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let row = sqlx::query(
        "SELECT id, name, scope_uuid, claude_session_id, created_at, updated_at, closed_at
         FROM chats WHERE id = ?1",
    )
    .bind(&chat_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| e.to_string())?;
    row_to_chat(&row)
}

/// User-facing rename. Auto-naming on first turn (Phase F polish) also goes
/// through this command.
#[tauri::command]
pub async fn rename_chat(
    app: tauri::AppHandle,
    chat_id: String,
    name: String,
) -> Result<(), String> {
    let pool = pool_clone(&app).await?;
    let now = Utc::now().to_rfc3339();
    sqlx::query("UPDATE chats SET name = ?1, updated_at = ?2 WHERE id = ?3")
        .bind(&name)
        .bind(&now)
        .bind(&chat_id)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Capture the claude session_id once it's known (after each turn completes).
/// Always overwrites: if a stale session id was dropped server-side (because
/// its JSONL went missing), the run starts a fresh session and the new id
/// must replace the stale one. Within a normal multi-turn chat, every turn's
/// session_id is the same value (claude --resume reuses), so the overwrite
/// is a no-op there.
#[tauri::command]
pub async fn update_chat_session_id(
    app: tauri::AppHandle,
    chat_id: String,
    session_id: String,
) -> Result<(), String> {
    let pool = pool_clone(&app).await?;
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "UPDATE chats SET claude_session_id = ?1, updated_at = ?2 WHERE id = ?3",
    )
    .bind(&session_id)
    .bind(&now)
    .bind(&chat_id)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Bump updated_at on activity (send, append, complete) so History sorts by
/// recency rather than original creation.
#[tauri::command]
pub async fn touch_chat(app: tauri::AppHandle, chat_id: String) -> Result<(), String> {
    let pool = pool_clone(&app).await?;
    let now = Utc::now().to_rfc3339();
    sqlx::query("UPDATE chats SET updated_at = ?1 WHERE id = ?2")
        .bind(&now)
        .bind(&chat_id)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Hard delete (no soft-delete tombstone). Receipts/episodes for the chat's
/// session_id remain because they're keyed by session_id, not chat_id; this
/// matches the existing receipts model where deleting a chat doesn't lose the
/// underlying audit trail.
#[tauri::command]
pub async fn delete_chat(app: tauri::AppHandle, chat_id: String) -> Result<(), String> {
    let pool = pool_clone(&app).await?;
    sqlx::query("DELETE FROM chats WHERE id = ?1")
        .bind(&chat_id)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// All receipts attached to the chat's claude_session_id, oldest first
/// (chronological — matches the in-chat turn order). Used by the History
/// panel to fold per-receipt detail under each chat row.
#[tauri::command]
pub async fn get_chat_receipts(
    app: tauri::AppHandle,
    chat_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let pool = pool_clone(&app).await?;
    let rows = sqlx::query(
        r#"SELECT r.id, r.session_id, r.transcript_path, r.started_at, r.finished_at,
                  r.input_tokens, r.output_tokens, r.cache_read_tokens, r.tool_call_count,
                  r.nodes_touched, r.estimated_cost_usd, r.raw_summary,
                  r.raw_jsonl_path, r.parse_status, r.wall_time_ms, r.created_at
           FROM receipts r
           JOIN chats c ON c.claude_session_id = r.session_id
           WHERE c.id = ?1
           ORDER BY COALESCE(r.started_at, r.created_at) ASC"#,
    )
    .bind(&chat_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(serde_json::json!({
            "id": row.try_get::<String, _>("id").unwrap_or_default(),
            "session_id": row.try_get::<String, _>("session_id").unwrap_or_default(),
            "transcript_path": row.try_get::<Option<String>, _>("transcript_path").unwrap_or(None),
            "started_at": row.try_get::<Option<String>, _>("started_at").unwrap_or(None),
            "finished_at": row.try_get::<Option<String>, _>("finished_at").unwrap_or(None),
            "input_tokens": row.try_get::<i64, _>("input_tokens").unwrap_or(0),
            "output_tokens": row.try_get::<i64, _>("output_tokens").unwrap_or(0),
            "cache_read_tokens": row.try_get::<i64, _>("cache_read_tokens").unwrap_or(0),
            "tool_call_count": row.try_get::<i64, _>("tool_call_count").unwrap_or(0),
            "nodes_touched": row.try_get::<Option<String>, _>("nodes_touched").unwrap_or(None),
            "estimated_cost_usd": row.try_get::<f64, _>("estimated_cost_usd").unwrap_or(0.0),
            "raw_summary": row.try_get::<Option<String>, _>("raw_summary").unwrap_or(None),
            "raw_jsonl_path": row.try_get::<Option<String>, _>("raw_jsonl_path").unwrap_or(None),
            "parse_status": row.try_get::<Option<String>, _>("parse_status").unwrap_or(None),
            "wall_time_ms": row.try_get::<Option<i64>, _>("wall_time_ms").unwrap_or(None),
            "created_at": row.try_get::<String, _>("created_at").unwrap_or_default(),
        }));
    }
    Ok(out)
}

/// Aggregate stats for a single chat — turn count, total tokens, total cost,
/// last activity. Used by the History panel row to show a condensed summary
/// without round-tripping all receipts.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSummary {
    pub chat_id: String,
    pub turn_count: i64,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub total_cost_usd: f64,
    pub last_activity_at: Option<String>,
}

/// One reconstructed turn pulled out of the session JSONL — the data
/// ChatPanel needs to repopulate `history` when reopening a closed chat.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnRecord {
    /// User prompt as a plain string (the user-bubble text). May be empty
    /// for kickoff-style first turns where the prompt was a structured
    /// payload rather than chat input.
    pub user_prompt: String,
    /// Raw JSONL lines from the session that belong to this turn (assistant
    /// blocks + tool_result fake-user messages). Each line is fed to
    /// ChatStream's parseChatStream verbatim so the rendered timeline matches
    /// what was shown live.
    pub stream_lines: Vec<String>,
    /// Tracking id is synthesized on reconstruction (real tracking ids are
    /// per-spawn and not persisted). Format: `replay-<chat-id>-<turn-idx>`
    /// — stable for React keys but not equal to any live tracking id, so
    /// reconciliation with in-flight events can never collide.
    pub tracking_id: String,
}

/// Reconstruct a closed chat's conversation by reading its session JSONL and
/// splitting on user-message boundaries.
///
/// Lookup chain: chats.claude_session_id → receipts.raw_jsonl_path. If the
/// chat has no receipts (e.g., a chat that was created but never sent to),
/// returns an empty Vec — caller renders an empty timeline.
///
/// JSONL format notes (v2.1.x Claude CLI):
/// - `type: "file-history-snapshot"` and other non-conversational types are skipped.
/// - `type: "user"` with `isMeta: true` is system-injected (e.g. caveat banners) — skipped.
/// - `type: "user"` with `message.content` as STRING or text-only array → real user turn boundary.
/// - `type: "user"` with `message.content` containing `tool_result` blocks → tool result,
///   NOT a turn boundary; flowed into the current turn's stream_lines.
/// - `type: "assistant"` and other types → flow into current turn's stream_lines.
#[tauri::command]
pub async fn read_chat_jsonl(
    app: tauri::AppHandle,
    chat_id: String,
) -> Result<Vec<TurnRecord>, String> {
    let pool = pool_clone(&app).await?;
    let row = sqlx::query(
        r#"SELECT r.raw_jsonl_path
           FROM receipts r
           JOIN chats c ON c.claude_session_id = r.session_id
           WHERE c.id = ?1 AND r.raw_jsonl_path IS NOT NULL
           ORDER BY COALESCE(r.started_at, r.created_at) DESC
           LIMIT 1"#,
    )
    .bind(&chat_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| e.to_string())?;
    let Some(row) = row else {
        return Ok(Vec::new());
    };
    let jsonl_path: String = row.try_get("raw_jsonl_path").unwrap_or_default();
    if jsonl_path.is_empty() {
        return Ok(Vec::new());
    }
    let path = std::path::PathBuf::from(&jsonl_path);
    if !path.exists() {
        // Session JSONL was cleaned up — return empty so the UI shows a
        // bare "(transcript no longer on disk)" hint rather than blowing up.
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("read {}: {}", path.display(), e))?;
    Ok(split_session_jsonl(&content, &chat_id))
}

/// Pure splitter — extracted so it's testable without a filesystem.
fn split_session_jsonl(content: &str, chat_id: &str) -> Vec<TurnRecord> {
    let mut turns: Vec<TurnRecord> = Vec::new();
    let mut current: Option<TurnRecord> = None;

    for raw_line in content.lines() {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let v: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue, // tolerate malformed lines
        };
        let line_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");

        // Skip file-history-snapshot, summary, and other meta-only line types.
        // Stream lines we keep (for parseChatStream): assistant, user-with-tool-result,
        // and the trailing result line if present.
        if line_type == "file-history-snapshot" || line_type == "summary" {
            continue;
        }

        if line_type == "user" {
            let is_meta = v.get("isMeta").and_then(|b| b.as_bool()).unwrap_or(false);
            if is_meta {
                continue;
            }
            let msg = v.get("message");
            let content_val = msg.and_then(|m| m.get("content"));
            let is_real_user_prompt = match content_val {
                Some(serde_json::Value::String(_)) => true,
                Some(serde_json::Value::Array(blocks)) => {
                    // Real user prompt = no tool_result blocks. Tool-result
                    // user messages flow into the current turn's stream lines.
                    !blocks.iter().any(|b| {
                        b.get("type").and_then(|t| t.as_str()) == Some("tool_result")
                    })
                }
                _ => false,
            };
            if is_real_user_prompt {
                // Boundary: archive the prior turn (if any) and start a new one.
                if let Some(prev) = current.take() {
                    turns.push(prev);
                }
                let user_prompt = match content_val {
                    Some(serde_json::Value::String(s)) => s.clone(),
                    Some(serde_json::Value::Array(blocks)) => blocks
                        .iter()
                        .filter_map(|b| {
                            if b.get("type").and_then(|t| t.as_str()) == Some("text") {
                                b.get("text").and_then(|t| t.as_str()).map(String::from)
                            } else {
                                None
                            }
                        })
                        .collect::<Vec<_>>()
                        .join("\n"),
                    _ => String::new(),
                };
                let idx = turns.len();
                current = Some(TurnRecord {
                    user_prompt,
                    stream_lines: Vec::new(),
                    tracking_id: format!("replay-{chat_id}-{idx}"),
                });
                continue;
            }
            // Tool-result user message: fall through to flow into current.stream_lines.
        }

        // Anything reaching here flows into the current turn. If we see stream
        // content before the first user boundary (kickoff-style runs where the
        // first message was synthesized), open an anonymous turn so we don't
        // drop content.
        if current.is_none() {
            let idx = turns.len();
            current = Some(TurnRecord {
                user_prompt: String::new(),
                stream_lines: Vec::new(),
                tracking_id: format!("replay-{chat_id}-{idx}"),
            });
        }
        if let Some(c) = current.as_mut() {
            c.stream_lines.push(trimmed.to_string());
        }
    }
    if let Some(last) = current.take() {
        turns.push(last);
    }
    turns
}

#[cfg(test)]
mod split_tests {
    use super::*;

    #[test]
    fn empty_input_returns_no_turns() {
        assert_eq!(split_session_jsonl("", "c-1").len(), 0);
        assert_eq!(split_session_jsonl("   \n\n", "c-1").len(), 0);
    }

    #[test]
    fn meta_user_messages_are_skipped() {
        let jsonl = r#"{"type":"user","isMeta":true,"message":{"role":"user","content":"caveat"}}
{"type":"user","message":{"role":"user","content":"hello"}}"#;
        let turns = split_session_jsonl(jsonl, "c-1");
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].user_prompt, "hello");
    }

    #[test]
    fn tool_result_user_flows_into_current_turn() {
        let jsonl = r#"{"type":"user","message":{"role":"user","content":"hi"}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Read","input":{}}]}}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}
{"type":"assistant","message":{"content":[{"type":"text","text":"done"}]}}"#;
        let turns = split_session_jsonl(jsonl, "c-1");
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].user_prompt, "hi");
        assert_eq!(turns[0].stream_lines.len(), 3);
    }

    #[test]
    fn multiple_user_prompts_form_separate_turns() {
        let jsonl = r#"{"type":"user","message":{"role":"user","content":"first"}}
{"type":"assistant","message":{"content":[{"type":"text","text":"ans1"}]}}
{"type":"user","message":{"role":"user","content":"second"}}
{"type":"assistant","message":{"content":[{"type":"text","text":"ans2"}]}}"#;
        let turns = split_session_jsonl(jsonl, "c-1");
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[0].user_prompt, "first");
        assert_eq!(turns[1].user_prompt, "second");
        assert_eq!(turns[0].stream_lines.len(), 1);
        assert_eq!(turns[1].stream_lines.len(), 1);
    }

    #[test]
    fn tracking_id_is_chat_scoped_and_indexed() {
        let jsonl = r#"{"type":"user","message":{"role":"user","content":"a"}}
{"type":"user","message":{"role":"user","content":"b"}}"#;
        let turns = split_session_jsonl(jsonl, "chat-abc");
        assert_eq!(turns[0].tracking_id, "replay-chat-abc-0");
        assert_eq!(turns[1].tracking_id, "replay-chat-abc-1");
    }

    #[test]
    fn malformed_lines_are_tolerated() {
        let jsonl = r#"not-json
{"type":"user","message":{"role":"user","content":"ok"}}
also-not-json
{"type":"assistant","message":{"content":[{"type":"text","text":"done"}]}}"#;
        let turns = split_session_jsonl(jsonl, "c-1");
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].user_prompt, "ok");
        assert_eq!(turns[0].stream_lines.len(), 1);
    }
}

#[tauri::command]
pub async fn get_chat_summaries(
    app: tauri::AppHandle,
    chat_ids: Vec<String>,
) -> Result<Vec<ChatSummary>, String> {
    if chat_ids.is_empty() {
        return Ok(Vec::new());
    }
    let pool = pool_clone(&app).await?;
    // Build the IN-list with bind placeholders so SQLite caches the prepared
    // statement and we don't risk SQL injection.
    let placeholders = (1..=chat_ids.len())
        .map(|i| format!("?{i}"))
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        r#"SELECT c.id AS chat_id,
                  COUNT(r.id) AS turn_count,
                  COALESCE(SUM(r.input_tokens), 0) AS total_input_tokens,
                  COALESCE(SUM(r.output_tokens), 0) AS total_output_tokens,
                  COALESCE(SUM(r.estimated_cost_usd), 0.0) AS total_cost_usd,
                  MAX(COALESCE(r.finished_at, r.started_at, r.created_at)) AS last_activity_at
           FROM chats c
           LEFT JOIN receipts r ON r.session_id = c.claude_session_id
           WHERE c.id IN ({placeholders})
           GROUP BY c.id"#,
    );
    let mut q = sqlx::query(&sql);
    for cid in &chat_ids {
        q = q.bind(cid);
    }
    let rows = q.fetch_all(&pool).await.map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(ChatSummary {
            chat_id: row.try_get("chat_id").unwrap_or_default(),
            turn_count: row.try_get("turn_count").unwrap_or(0),
            total_input_tokens: row.try_get("total_input_tokens").unwrap_or(0),
            total_output_tokens: row.try_get("total_output_tokens").unwrap_or(0),
            total_cost_usd: row.try_get("total_cost_usd").unwrap_or(0.0),
            last_activity_at: row.try_get("last_activity_at").ok(),
        });
    }
    Ok(out)
}
