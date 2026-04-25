//! Phase 10 Tauri commands for session ingestion + backfill UI.
//!
//! Four commands exposed to the frontend (10-04 consumes):
//! - `get_ingested_sessions`: list sessions for the open repo
//! - `get_backfill_preview`: token + cost estimate per session (NO LLM CALL)
//! - `execute_backfill`: run ingest for selected session_ids
//! - `get_session_status`: footer indicator stats (active sessions + episode count)
//!
//! All commands are READ-ONLY against existing DB state, except
//! `execute_backfill` which calls into `crate::session::ingestor::ingest_session_file`
//! (10-02) which writes via the standard sqlx path.
//!
//! CRITICAL: Phase 10 makes ZERO Claude API calls (Pitfall 6). The backfill
//! preview is `chars / 4` arithmetic with a hardcoded Sonnet rate. If
//! pricing changes, update the constant and document in the next phase
//! summary. No `reqwest::Client`. No `anthropic` crate.

use crate::session::cwd_key::{claude_projects_dir, derive_cwd_key};
use crate::session::types::{BackfillPreview, SessionRow};
use chrono::Utc;
use sqlx::sqlite::SqliteRow;
use sqlx::Row;
use tauri::{AppHandle, Manager};

// ─── Pricing heuristic constants ──────────────────────────────────────────────

/// Sonnet 4.5 input rate as of 2026-04 — $3 / MTok. Pure heuristic for the
/// backfill preview UI (Pitfall 6: no actual API call). If pricing changes,
/// update this constant and document in the next phase summary.
const ESTIMATED_INPUT_RATE_PER_MTOK_USD: f64 = 3.0;
const ESTIMATED_TOKENS_PER_CHAR: f64 = 1.0 / 4.0;

fn estimate_tokens_from_chars(chars: usize) -> u64 {
    (chars as f64 * ESTIMATED_TOKENS_PER_CHAR).round() as u64
}
fn estimate_cost_usd(tokens: u64) -> f64 {
    (tokens as f64) * ESTIMATED_INPUT_RATE_PER_MTOK_USD / 1_000_000.0
}

/// Resolve the currently-open repo path → cwd_key. Returns None if no repo
/// is open (the frontend should not call these commands in that state, but
/// we tolerate it gracefully).
async fn current_cwd_key(app: &AppHandle) -> Option<String> {
    let repo_state = app.state::<crate::commands::repo::RepoState>();
    let path_opt = repo_state.0.lock().ok().and_then(|g| g.clone());
    path_opt.map(|p| derive_cwd_key(&p))
}

// ─── Command 1: get_ingested_sessions ─────────────────────────────────────────

/// Return up to `limit` (default 50, max 500) ingested sessions for the
/// currently-open repo, ordered by `last_seen_at DESC`. Used by the backfill
/// modal (10-04) to seed the session-picker list and by the
/// `SessionStatusIndicator` for the live footer count.
///
/// Filters by `cwd_key = derive_cwd_key(repo_path)`.
#[tauri::command]
pub async fn get_ingested_sessions(
    app: AppHandle,
    limit: Option<u32>,
) -> Result<Vec<SessionRow>, String> {
    let Some(cwd_key) = current_cwd_key(&app).await else {
        return Ok(Vec::new());
    };
    let limit = limit.unwrap_or(50).min(500) as i64;

    let instances = app.state::<tauri_plugin_sql::DbInstances>();
    let map = instances.0.read().await;
    let Some(db) = map.get("sqlite:contract-ide.db") else {
        return Err("DB not loaded".into());
    };
    let pool = match db {
        tauri_plugin_sql::DbPool::Sqlite(p) => p,
        #[allow(unreachable_patterns)]
        _ => return Err("only sqlite supported".into()),
    };

    // Decode rows manually into SessionRow — sqlx 0.8 in this crate is
    // configured without the `derive` feature, so `query_as` against a struct
    // with `#[derive(sqlx::FromRow)]` would not compile. Mirror the
    // `commands::nodes::hydrate_node_rows` pattern: query() → SqliteRow →
    // try_get per column.
    let rows: Vec<SqliteRow> = sqlx::query(
        "SELECT session_id, cwd_key, repo_path, started_at, last_seen_at,
                episode_count, bytes_raw, bytes_filtered, last_line_index,
                state, ingested_at
         FROM sessions
         WHERE cwd_key = ?1
         ORDER BY last_seen_at DESC
         LIMIT ?2",
    )
    .bind(&cwd_key)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("session select: {e}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        out.push(SessionRow {
            session_id: r.try_get("session_id").map_err(|e| e.to_string())?,
            cwd_key: r.try_get("cwd_key").map_err(|e| e.to_string())?,
            repo_path: r.try_get("repo_path").ok(),
            started_at: r.try_get("started_at").map_err(|e| e.to_string())?,
            last_seen_at: r.try_get("last_seen_at").map_err(|e| e.to_string())?,
            episode_count: r.try_get("episode_count").unwrap_or(0),
            bytes_raw: r.try_get("bytes_raw").unwrap_or(0),
            bytes_filtered: r.try_get("bytes_filtered").unwrap_or(0),
            last_line_index: r.try_get("last_line_index").unwrap_or(0),
            state: r.try_get("state").map_err(|e| e.to_string())?,
            ingested_at: r.try_get("ingested_at").map_err(|e| e.to_string())?,
        });
    }

    Ok(out)
}

// ─── Command 2: get_backfill_preview ──────────────────────────────────────────

/// For each provided session_id, locate the JSONL file under
/// `~/.claude/projects/<cwd-key>/<session-id>.jsonl`, run the filter to
/// estimate filtered character count, and return token + cost previews.
///
/// CRITICAL: This makes ZERO Claude API calls. Token count = chars / 4
/// heuristic. Cost = tokens * Sonnet rate / 1M. Per Phase 10 SC: backfill
/// preview must NOT round-trip through any LLM (Pitfall 6).
///
/// Sessions whose JSONL file no longer exists on disk are silently skipped —
/// the UI will show fewer rows than requested rather than error out.
#[tauri::command]
pub async fn get_backfill_preview(
    app: AppHandle,
    session_ids: Vec<String>,
) -> Result<Vec<BackfillPreview>, String> {
    let Some(cwd_key) = current_cwd_key(&app).await else {
        return Err("No repo open".into());
    };
    let projects_dir = claude_projects_dir()?;
    let session_dir = projects_dir.join(&cwd_key);
    if !session_dir.exists() {
        return Ok(Vec::new());
    }

    let mut previews = Vec::with_capacity(session_ids.len());
    for session_id in &session_ids {
        let jsonl_path = session_dir.join(format!("{session_id}.jsonl"));
        if !jsonl_path.exists() {
            continue;
        }

        let metadata = match std::fs::metadata(&jsonl_path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let bytes_raw = metadata.len();
        let mtime_iso = metadata
            .modified()
            .ok()
            .and_then(|t| {
                t.duration_since(std::time::UNIX_EPOCH).ok().map(|d| {
                    chrono::DateTime::<Utc>::from_timestamp(d.as_secs() as i64, 0)
                        .unwrap_or_else(Utc::now)
                        .to_rfc3339()
                })
            })
            .unwrap_or_else(|| Utc::now().to_rfc3339());

        // Run the filter on a separate thread (synchronous file IO).
        // `filter_session_lines` is a sync fn from 10-02 returning
        // `Result<Vec<FilteredTurn>, String>`. Failures (file open errors,
        // etc.) skip this session rather than abort the whole batch — the
        // user gets a preview for the sessions that succeeded.
        let path_clone = jsonl_path.clone();
        let turns = match tokio::task::spawn_blocking(move || {
            crate::session::ingestor::filter_session_lines(&path_clone, 0)
        })
        .await
        .map_err(|e| format!("filter join: {e}"))?
        {
            Ok(t) => t,
            Err(e) => {
                eprintln!("[session] preview: filter failed for {session_id}: {e}");
                continue;
            }
        };

        let total_chars: usize = turns.iter().map(|t| t.text.len()).sum();
        let estimated_tokens = estimate_tokens_from_chars(total_chars);
        let estimated_cost_usd = estimate_cost_usd(estimated_tokens);

        // Episode count estimate: count user-role turns (each opens an
        // episode in the chunker — see 10-02 chunk_episodes).
        let episode_count_estimate = turns.iter().filter(|t| t.role == "user").count() as u32;

        previews.push(BackfillPreview {
            session_id: session_id.clone(),
            estimated_tokens,
            estimated_cost_usd,
            episode_count_estimate,
            bytes_raw,
            mtime_iso,
        });
    }

    Ok(previews)
}

// ─── Command 3: execute_backfill ──────────────────────────────────────────────

/// Run `ingest_session_file` for each provided session_id sequentially.
/// Returns total newly-inserted episode count.
///
/// Frontend (10-04 backfill modal) calls this ONLY after explicit user
/// confirmation — there is no automatic backfill (SC4: opt-in, never
/// ingest historical sessions without confirmation).
///
/// Errors on individual session ingest are logged via `eprintln!` but do NOT
/// fail the whole batch — subsequent sessions still process. The total
/// count reflects only successfully-ingested episodes.
#[tauri::command]
pub async fn execute_backfill(
    app: AppHandle,
    session_ids: Vec<String>,
) -> Result<u64, String> {
    let Some(cwd_key) = current_cwd_key(&app).await else {
        return Err("No repo open".into());
    };
    let projects_dir = claude_projects_dir()?;
    let session_dir = projects_dir.join(&cwd_key);

    let mut total: u64 = 0;
    for session_id in session_ids {
        let jsonl_path = session_dir.join(format!("{session_id}.jsonl"));
        if !jsonl_path.exists() {
            eprintln!("[session] backfill: file missing {jsonl_path:?}");
            continue;
        }
        match crate::session::ingestor::ingest_session_file(
            app.clone(),
            session_id.clone(),
            jsonl_path,
        )
        .await
        {
            Ok(n) => total += n as u64,
            Err(e) => eprintln!("[session] backfill error on {session_id}: {e}"),
        }
    }

    // Emit session:status so footer + UI counts update once after batch
    // completes. `null` placeholders signal the UI to refetch via
    // `get_session_status` (avoids racing with the per-ingest emits the
    // watcher already sent during the batch).
    use tauri::Emitter;
    let _ = app.emit(
        "session:status",
        serde_json::json!({
            "watchingSessions": null,
            "episodesIngested": null,
        }),
    );

    Ok(total)
}

// ─── Command 4: get_session_status ────────────────────────────────────────────

/// Return current count of active sessions + total episodes for the open
/// repo. Used by the footer SessionStatusIndicator (10-04) to seed initial
/// state before subscribing to `session:status` events (race-resistance,
/// same pattern as McpStatusIndicator).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatus {
    pub watching_sessions: u32,
    pub episodes_ingested: u64,
}

#[tauri::command]
pub async fn get_session_status(app: AppHandle) -> Result<SessionStatus, String> {
    let Some(cwd_key) = current_cwd_key(&app).await else {
        return Ok(SessionStatus {
            watching_sessions: 0,
            episodes_ingested: 0,
        });
    };

    let instances = app.state::<tauri_plugin_sql::DbInstances>();
    let map = instances.0.read().await;
    let Some(db) = map.get("sqlite:contract-ide.db") else {
        return Err("DB not loaded".into());
    };
    let pool = match db {
        tauri_plugin_sql::DbPool::Sqlite(p) => p,
        #[allow(unreachable_patterns)]
        _ => return Err("only sqlite supported".into()),
    };

    let s: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM sessions WHERE cwd_key = ?1 AND state = 'active'",
    )
    .bind(&cwd_key)
    .fetch_one(pool)
    .await
    .unwrap_or((0,));
    let e: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM episodes e
         JOIN sessions s ON s.session_id = e.session_id
         WHERE s.cwd_key = ?1",
    )
    .bind(&cwd_key)
    .fetch_one(pool)
    .await
    .unwrap_or((0,));

    Ok(SessionStatus {
        watching_sessions: s.0.max(0) as u32,
        episodes_ingested: e.0.max(0) as u64,
    })
}

// ─── Command 5: list_historical_session_files ────────────────────────────────

/// One historical session JSONL file in the open repo's
/// `~/.claude/projects/<cwd-key>/` directory. Returned by
/// `list_historical_session_files` to seed the BackfillModal session-picker.
///
/// Counts lines per file as an approximation (counts `\n` characters, doesn't
/// tokenize). At <5MB per JSONL the read is fast.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionFile {
    pub session_id: String,
    pub bytes_raw: u64,
    pub mtime: String,
    pub line_count: u32,
}

/// List all *.jsonl session files in the open repo's
/// `~/.claude/projects/<cwd-key>/` directory, sorted by mtime DESC (newest
/// first). Used by the BackfillModal (10-04) session-picker — these are
/// candidate files the user may explicitly opt-in to ingest.
///
/// Returns an empty vec if no repo is open OR the directory doesn't exist
/// (Pitfall 4: graceful deferral mirroring the watcher's degraded posture).
#[tauri::command]
pub async fn list_historical_session_files(
    app: AppHandle,
) -> Result<Vec<SessionFile>, String> {
    let Some(cwd_key) = current_cwd_key(&app).await else {
        return Ok(Vec::new());
    };
    let projects_dir = claude_projects_dir()?;
    let session_dir = projects_dir.join(&cwd_key);
    if !session_dir.exists() {
        return Ok(Vec::new());
    }

    // All work below is blocking syscalls (read_dir, metadata, file streaming).
    // Move off the Tokio runtime via spawn_blocking — at 20+ files the BackfillModal
    // open should not stall the executor (sister `get_backfill_preview` follows the
    // same pattern around `filter_session_lines`).
    let files = tokio::task::spawn_blocking(move || -> Result<Vec<SessionFile>, String> {
        use std::io::{BufRead, BufReader};

        let mut out: Vec<SessionFile> = Vec::new();
        let entries = std::fs::read_dir(&session_dir).map_err(|e| format!("read_dir: {e}"))?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let Some(session_id) = path.file_stem().and_then(|s| s.to_str()).map(String::from)
            else {
                continue;
            };
            let Ok(metadata) = entry.metadata() else { continue };
            let bytes_raw = metadata.len();
            let mtime = metadata
                .modified()
                .ok()
                .and_then(|t| {
                    t.duration_since(std::time::UNIX_EPOCH).ok().map(|d| {
                        chrono::DateTime::<Utc>::from_timestamp(d.as_secs() as i64, 0)
                            .unwrap_or_else(Utc::now)
                            .to_rfc3339()
                    })
                })
                .unwrap_or_else(|| Utc::now().to_rfc3339());

            // Stream the file with BufReader::lines().count() — avoids loading the
            // full payload into memory just to count newlines (5MB session × 20
            // files = 100MB previously). Approximate by definition (final line
            // without trailing newline still counts).
            let line_count = std::fs::File::open(&path)
                .map(|f| BufReader::new(f).lines().count() as u32)
                .unwrap_or(0);

            out.push(SessionFile {
                session_id,
                bytes_raw,
                mtime,
                line_count,
            });
        }

        // Sort by mtime DESC (newest first) — matches the BackfillModal's
        // "most recent at top" expectation.
        out.sort_by(|a, b| b.mtime.cmp(&a.mtime));
        Ok(out)
    })
    .await
    .map_err(|e| format!("list_historical_session_files join: {e}"))??;

    Ok(files)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estimate_tokens_4_chars_per_token() {
        assert_eq!(estimate_tokens_from_chars(4), 1);
        assert_eq!(estimate_tokens_from_chars(40_000), 10_000);
        assert_eq!(estimate_tokens_from_chars(0), 0);
    }

    #[test]
    fn estimate_cost_sonnet_rate() {
        // 1M tokens at $3/MTok = $3
        let cost = estimate_cost_usd(1_000_000);
        assert!((cost - 3.0).abs() < 0.0001);
    }

    #[test]
    fn estimate_cost_zero_tokens_zero_cost() {
        assert_eq!(estimate_cost_usd(0), 0.0);
    }

    #[test]
    fn estimate_cost_typical_session() {
        // 50KB filtered → 12.5K tokens → $0.0375 (well under "trivial" UX
        // bar that justifies opt-in confirmation rather than auto-ingest).
        let tokens = estimate_tokens_from_chars(50_000);
        let cost = estimate_cost_usd(tokens);
        assert!(cost > 0.03 && cost < 0.05, "cost={cost} for 50KB session");
    }
}
