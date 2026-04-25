//! Phase 10 ingestion pipeline — filter + chunk + DB upsert.
//!
//! Pure functions for filtering JSONL → FilteredTurn[] and chunking into
//! Episode[]. Async `ingest_session_file` is the single entry point used by
//! the watcher (10-03) and the backfill IPC (10-03).
//!
//! Performance: each filter+chunk pass is O(N) over JSONL lines. At hackathon
//! scale (< 5MB per session) this is microseconds-per-line. Idempotency comes
//! from `INSERT OR IGNORE` on `episodes.episode_id` PK, so duplicate calls are
//! cheap.
//!
//! SAFETY: this module makes ZERO Claude API calls. No reqwest, no Anthropic
//! SDK. Pure parse + DB. Phase 11 distiller is the LLM consumer.

use crate::session::state::SessionLocks;
use crate::session::types::{Episode, FilteredTurn};
use chrono::Utc;
use sha2::{Digest, Sha256};
use std::io::BufRead;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

/// Filter a JSONL session file to conversational text only.
///
/// Returns `Vec<FilteredTurn>` for lines AT OR AFTER `start_from_line`. Lines
/// strictly before `start_from_line` are skipped — used for incremental ingest
/// (Pitfall 2 in 10-RESEARCH.md: avoid re-scanning the entire file on every
/// FSEvents tick).
///
/// Filter rules (validated against `~/.claude/projects/-Users-yang-lahacks/`
/// real session files — see 10-RESEARCH.md §Claude Code JSONL Session File Lifecycle):
///
/// KEEP:
/// - `type: "user"` + `isMeta` not true + `message.content` is plain string
///   not starting with `<` (preamble injection)
/// - `type: "user"` + `message.content` is array → for each `{type: "text"}` item, keep
/// - `type: "assistant"` → `message.content` is always array → for each `{type: "text"}` item, keep
///
/// SKIP:
/// - `type: "user"` with `isMeta: true` (system caveats / preamble)
/// - `type: "user"` plain string starting with `<` (preamble injection)
/// - tool_result / tool_use / thinking content blocks
/// - all other `type` values (system, attachment, last-prompt, queue-operation,
///   file-history-snapshot)
///
/// Malformed lines (invalid JSON, missing fields) are SILENTLY SKIPPED — never
/// panic on a malformed line. The filter must tolerate Claude Code's evolving
/// schema (forward-compat).
pub fn filter_session_lines(
    path: &Path,
    start_from_line: usize,
) -> Result<Vec<FilteredTurn>, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("open: {e}"))?;
    let reader = std::io::BufReader::new(file);
    let mut results = Vec::new();

    for (i, line_result) in reader.lines().enumerate() {
        if i < start_from_line {
            continue;
        }
        let Ok(line) = line_result else { continue };
        let Ok(obj) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };

        match obj.get("type").and_then(|t| t.as_str()) {
            Some("user") => {
                // Skip meta messages — `isMeta: true` is preamble/caveat injection.
                if obj.get("isMeta").and_then(|m| m.as_bool()).unwrap_or(false) {
                    continue;
                }
                let content = obj.get("message").and_then(|m| m.get("content"));
                let timestamp = obj
                    .get("timestamp")
                    .and_then(|t| t.as_str())
                    .unwrap_or("")
                    .to_string();
                match content {
                    Some(serde_json::Value::String(s)) if !s.starts_with('<') => {
                        results.push(FilteredTurn {
                            role: "user".into(),
                            text: s.clone(),
                            line_index: i,
                            timestamp,
                        });
                    }
                    Some(serde_json::Value::Array(items)) => {
                        for item in items {
                            if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                                if let Some(t) = item.get("text").and_then(|t| t.as_str()) {
                                    results.push(FilteredTurn {
                                        role: "user".into(),
                                        text: t.into(),
                                        line_index: i,
                                        timestamp: "".into(),
                                    });
                                }
                            }
                            // tool_result blocks: skip
                        }
                    }
                    _ => {}
                }
            }
            Some("assistant") => {
                // assistant message.content is always an array.
                if let Some(serde_json::Value::Array(items)) =
                    obj.get("message").and_then(|m| m.get("content"))
                {
                    for item in items {
                        if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                            if let Some(t) = item.get("text").and_then(|t| t.as_str()) {
                                results.push(FilteredTurn {
                                    role: "assistant".into(),
                                    text: t.into(),
                                    line_index: i,
                                    timestamp: "".into(),
                                });
                            }
                        }
                        // tool_use, thinking: skip
                    }
                }
            }
            // file-history-snapshot, system, attachment, last-prompt, queue-operation: all skipped
            _ => {}
        }
    }

    Ok(results)
}

/// Chunk a sequence of FilteredTurns into Episodes by user-prompt boundaries.
///
/// An episode opens at each non-meta `user` turn and closes just before the
/// next non-meta `user` turn (or end of file). Plain conversational turns
/// with no tool-use are valid episodes — research notes these are often
/// HIGHEST-QUALITY for downstream constraint extraction.
///
/// Returns Vec<Episode> in source order. Each Episode has `filtered_text` =
/// `[User]: <text>\n[Assistant]: <text>\n[Assistant]: <text>...` so Phase 11's
/// distiller can distinguish speakers without an extra join.
///
/// Idempotency: same input → same output. `episode_id` derived from
/// `(session_id, start_line)` is the stability primitive — re-running this
/// function on the same turns produces identical episode_ids in identical order.
pub fn chunk_episodes(turns: &[FilteredTurn], session_id: &str) -> Vec<Episode> {
    let mut episodes = Vec::new();
    let mut current_user_line: Option<usize> = None;
    let mut current_texts: Vec<String> = Vec::new();
    let mut start_line: usize = 0;
    let mut end_line: usize = 0;
    let mut user_turns_in_current: u32 = 0;

    for turn in turns {
        if turn.role == "user" {
            // Flush previous episode if there is one
            if current_user_line.is_some() && !current_texts.is_empty() {
                let filtered_text = current_texts.join("\n");
                let content_hash = compute_content_hash(&filtered_text);
                let episode_id = compute_episode_id(session_id, start_line);
                episodes.push(Episode {
                    episode_id,
                    session_id: session_id.into(),
                    start_line,
                    end_line,
                    filtered_text,
                    content_hash,
                    turn_count: user_turns_in_current,
                });
                current_texts.clear();
                // user_turns_in_current is reset to 1 on the next line — no
                // intermediate read possible, so skip the explicit zero.
            }
            start_line = turn.line_index;
            current_user_line = Some(turn.line_index);
            current_texts.push(format!("[User]: {}", turn.text));
            user_turns_in_current = 1;
        } else {
            // assistant — append to current episode (or start orphan episode if no user yet)
            if current_user_line.is_none() {
                // No user prompt seen yet — assistant lines without a preceding user
                // turn are unusual but possible (e.g., interrupted session). Start
                // a synthetic episode anchored at this assistant line; user_turns = 0
                // signals "orphan" to downstream consumers.
                start_line = turn.line_index;
                current_user_line = Some(turn.line_index);
            }
            current_texts.push(format!("[Assistant]: {}", turn.text));
        }
        end_line = turn.line_index;
    }

    // Flush final episode
    if !current_texts.is_empty() && current_user_line.is_some() {
        let filtered_text = current_texts.join("\n");
        let content_hash = compute_content_hash(&filtered_text);
        let episode_id = compute_episode_id(session_id, start_line);
        episodes.push(Episode {
            episode_id,
            session_id: session_id.into(),
            start_line,
            end_line,
            filtered_text,
            content_hash,
            turn_count: user_turns_in_current,
        });
    }

    episodes
}

/// `sha256(session_id + ":" + start_line)` — hex-encoded. Deterministic primary
/// key for the `episodes` table. INSERT OR IGNORE on this PK is the idempotency
/// primitive (re-ingest produces same id, INSERT skips).
///
/// Uses `hex::encode(hasher.finalize())` per the project convention (sha2 0.11
/// returns `Array<u8, _>` from `finalize()`, which doesn't impl `LowerHex`
/// directly; matches Phase 6 `commands::derive::compute_contract_hash` exactly).
pub fn compute_episode_id(session_id: &str, start_line: usize) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("{session_id}:{start_line}").as_bytes());
    hex::encode(hasher.finalize())
}

/// `sha256(filtered_text)` — change-detection signal for downstream distillation.
fn compute_content_hash(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hex::encode(hasher.finalize())
}

/// Single async entry point for ingesting a Claude Code JSONL session file
/// into SQLite. Idempotent — calling twice on the same file produces the
/// same DB state.
///
/// Flow:
/// 1. Acquire `SessionLocks::for_session(&session_id)` mutex. Prevents
///    concurrent re-ingest of the same session from creating duplicate rows
///    even if INSERT OR IGNORE would catch it (saves redundant DB read).
/// 2. Read `last_line_index` from `sessions` table. New session → 0.
/// 3. Filter from `last_line_index` onward.
/// 4. Chunk into episodes.
/// 5. INSERT OR IGNORE INTO episodes (...) — idempotency primitive.
/// 6. INSERT OR REPLACE INTO sessions (...) updating stats.
/// 7. Return count of NEWLY-INSERTED episodes (not total — for UI status).
///
/// Errors are surfaced as Result<usize, String>. Watcher callback (10-03)
/// logs and discards; backfill IPC (10-03) propagates to the UI.
///
/// SAFETY: makes ZERO Claude API calls. No reqwest::Client. Pure parse + DB.
pub async fn ingest_session_file(
    app: AppHandle,
    session_id: String,
    path: PathBuf,
) -> Result<usize, String> {
    // 1. Per-session mutex (Pitfall 3 in 10-RESEARCH.md)
    let locks = app.state::<SessionLocks>();
    let mutex = locks.for_session(&session_id);
    let _guard = mutex.lock().await;

    // Resolve cwd_key + repo_path for the row insert.
    // cwd-key derivation: parent dir name of the session file.
    let cwd_key = path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    let repo_path: Option<String> = {
        let repo_state = app.state::<crate::commands::repo::RepoState>();
        repo_state
            .0
            .lock()
            .ok()
            .and_then(|g| g.clone())
            .map(|p| p.to_string_lossy().into_owned())
    };

    // 2. Read last_line_index from sessions row (or 0 for new sessions).
    let instances = app.state::<tauri_plugin_sql::DbInstances>();
    let map = instances.0.read().await;
    let Some(db) = map.get("sqlite:contract-ide.db") else {
        return Err("DB not loaded".into());
    };
    let pool = match db {
        tauri_plugin_sql::DbPool::Sqlite(p) => p.clone(),
        #[allow(unreachable_patterns)]
        _ => return Err("only sqlite supported".into()),
    };

    // Drop the read lock before doing the parse work + write — avoid holding it
    // across the filter loop (Pitfall 2: notify can fire 10+ events back-to-back).
    drop(map);

    let prior: Option<(i64,)> =
        sqlx::query_as("SELECT last_line_index FROM sessions WHERE session_id = ?1")
            .bind(&session_id)
            .fetch_optional(&pool)
            .await
            .map_err(|e| format!("session select: {e}"))?;
    let last_line_index = prior.map(|(idx,)| idx as usize).unwrap_or(0);

    // 3. Filter from last_line_index onward.
    let turns = filter_session_lines(&path, last_line_index)?;
    if turns.is_empty() {
        // Nothing new — but we may need to INSERT the session row for first-sight Create.
        ensure_session_row(&pool, &session_id, &cwd_key, repo_path.as_deref(), &path).await?;
        return Ok(0);
    }

    // Determine new max line index for next call.
    let new_max_line = turns.iter().map(|t| t.line_index).max().unwrap_or(last_line_index) + 1;

    // 4. Chunk.
    let mut episodes = chunk_episodes(&turns, &session_id);

    // Filter out episodes whose start_line is BEFORE last_line_index — the chunker
    // may produce a leading episode that started in a previous ingest cycle if
    // an assistant turn straddles ingest boundaries. The PK guarantees idempotency
    // either way (INSERT OR IGNORE), but trimming saves a redundant write.
    episodes.retain(|e| e.start_line >= last_line_index);

    // FK precondition: episodes.session_id REFERENCES sessions(session_id). For
    // a brand-new session (prior is None), the sessions row does not exist yet,
    // so the episode INSERTs below would fail with SQLITE_CONSTRAINT_FOREIGNKEY.
    // ensure_session_row is INSERT OR IGNORE — cheap when the row already exists.
    ensure_session_row(&pool, &session_id, &cwd_key, repo_path.as_deref(), &path).await?;

    // 5. Insert episodes via INSERT OR IGNORE — idempotency primitive.
    let now = Utc::now().to_rfc3339();
    let mut newly_inserted = 0usize;
    for ep in &episodes {
        let res = sqlx::query(
            "INSERT OR IGNORE INTO episodes
             (episode_id, session_id, start_line, end_line, filtered_text, content_hash, turn_count, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
        )
        .bind(&ep.episode_id)
        .bind(&ep.session_id)
        .bind(ep.start_line as i64)
        .bind(ep.end_line as i64)
        .bind(&ep.filtered_text)
        .bind(&ep.content_hash)
        .bind(ep.turn_count as i64)
        .bind(&now)
        .execute(&pool)
        .await
        .map_err(|e| format!("episode insert: {e}"))?;
        if res.rows_affected() == 1 {
            newly_inserted += 1;
            // Phase 11 hook: distiller pipeline subscribes to episode:ingested in
            // distiller::pipeline::init(). Emit fire-and-forget — distiller failures
            // should not block ingestion.
            let _ = app.emit(
                "episode:ingested",
                serde_json::json!({
                    "episode_id": ep.episode_id,
                    "session_id": ep.session_id,
                }),
            );
        }
    }

    // 6. Upsert sessions row stats.
    let bytes_raw = std::fs::metadata(&path).map(|m| m.len() as i64).unwrap_or(0);
    let bytes_filtered: i64 = episodes.iter().map(|e| e.filtered_text.len() as i64).sum();

    // Use ON CONFLICT DO UPDATE — sqlx-idiomatic upsert. Preserves started_at
    // and ingested_at on update; updates last_seen_at, episode_count, byte stats,
    // and last_line_index (taking MAX of prior + new).
    let started_at = turns
        .iter()
        .find(|t| t.role == "user" && !t.timestamp.is_empty())
        .map(|t| t.timestamp.clone())
        .unwrap_or_else(|| now.clone());

    sqlx::query(
        "INSERT INTO sessions
         (session_id, cwd_key, repo_path, started_at, last_seen_at, episode_count,
          bytes_raw, bytes_filtered, last_line_index, state, ingested_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'active', ?10)
         ON CONFLICT(session_id) DO UPDATE SET
           last_seen_at = excluded.last_seen_at,
           episode_count = (SELECT COUNT(*) FROM episodes WHERE session_id = ?1),
           bytes_raw = excluded.bytes_raw,
           bytes_filtered = sessions.bytes_filtered + excluded.bytes_filtered,
           last_line_index = MAX(sessions.last_line_index, excluded.last_line_index)"
    )
    .bind(&session_id)
    .bind(&cwd_key)
    .bind(repo_path.as_deref())
    .bind(&started_at)
    .bind(&now)
    .bind(episodes.len() as i64)
    .bind(bytes_raw)
    .bind(bytes_filtered)
    .bind(new_max_line as i64)
    .bind(&now)
    .execute(&pool)
    .await
    .map_err(|e| format!("session upsert: {e}"))?;

    Ok(newly_inserted)
}

/// Internal helper — INSERT a session row at first-sight Create event when no
/// turns have been ingested yet (so the watcher's "watching N sessions" status
/// indicator counts the file even before the first user prompt lands).
async fn ensure_session_row(
    pool: &sqlx::SqlitePool,
    session_id: &str,
    cwd_key: &str,
    repo_path: Option<&str>,
    path: &Path,
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    let bytes_raw = std::fs::metadata(path).map(|m| m.len() as i64).unwrap_or(0);
    sqlx::query(
        "INSERT OR IGNORE INTO sessions
         (session_id, cwd_key, repo_path, started_at, last_seen_at, episode_count,
          bytes_raw, bytes_filtered, last_line_index, state, ingested_at)
         VALUES (?1, ?2, ?3, ?4, ?4, 0, ?5, 0, 0, 'active', ?4)",
    )
    .bind(session_id)
    .bind(cwd_key)
    .bind(repo_path)
    .bind(&now)
    .bind(bytes_raw)
    .execute(pool)
    .await
    .map_err(|e| format!("session ensure: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compute_episode_id_is_deterministic() {
        let id1 = compute_episode_id("abc", 42);
        let id2 = compute_episode_id("abc", 42);
        assert_eq!(id1, id2);
        // Different start_line → different id
        let id3 = compute_episode_id("abc", 43);
        assert_ne!(id1, id3);
        // Different session → different id
        let id4 = compute_episode_id("xyz", 42);
        assert_ne!(id1, id4);
        // Hex-encoded sha256 → 64 chars
        assert_eq!(id1.len(), 64);
    }

    #[test]
    fn chunk_episodes_groups_by_user_boundary() {
        let turns = vec![
            FilteredTurn {
                role: "user".into(),
                text: "Q1".into(),
                line_index: 1,
                timestamp: "".into(),
            },
            FilteredTurn {
                role: "assistant".into(),
                text: "A1".into(),
                line_index: 2,
                timestamp: "".into(),
            },
            FilteredTurn {
                role: "user".into(),
                text: "Q2".into(),
                line_index: 3,
                timestamp: "".into(),
            },
            FilteredTurn {
                role: "assistant".into(),
                text: "A2".into(),
                line_index: 4,
                timestamp: "".into(),
            },
        ];
        let episodes = chunk_episodes(&turns, "test-session");
        assert_eq!(episodes.len(), 2);
        assert!(episodes[0].filtered_text.contains("[User]: Q1"));
        assert!(episodes[0].filtered_text.contains("[Assistant]: A1"));
        assert!(episodes[1].filtered_text.contains("[User]: Q2"));
        assert!(episodes[1].filtered_text.contains("[Assistant]: A2"));
    }

    #[test]
    fn chunk_episodes_idempotent_on_same_input() {
        let turns = vec![
            FilteredTurn {
                role: "user".into(),
                text: "Q".into(),
                line_index: 0,
                timestamp: "".into(),
            },
            FilteredTurn {
                role: "assistant".into(),
                text: "A".into(),
                line_index: 1,
                timestamp: "".into(),
            },
        ];
        let e1 = chunk_episodes(&turns, "s");
        let e2 = chunk_episodes(&turns, "s");
        assert_eq!(e1.len(), e2.len());
        for (a, b) in e1.iter().zip(&e2) {
            assert_eq!(a.episode_id, b.episode_id);
            assert_eq!(a.filtered_text, b.filtered_text);
            assert_eq!(a.content_hash, b.content_hash);
        }
    }
}
