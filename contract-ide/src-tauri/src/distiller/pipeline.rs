//! Distiller pipeline: per-episode claude -p extraction + idempotent upsert.
//!
//! # Pattern 1 (from 11-RESEARCH.md)
//! 1. Load episode + session metadata (pool_clone, drop read guard before .await)
//! 2. Acquire per-session lock (DistillerLocks::for_session) — prevents concurrent distills of the
//!    same session writing conflicting substrate_node IDs
//! 3. Build candidate-atom hint for the prompt (heuristic: atoms updated since session start)
//! 4. Run `claude -p --bare --output-format json --json-schema <schema>` with 60s timeout
//! 5. Parse structured_output.nodes; dead-letter on any failure mode
//! 6. Compute stable UUIDs: sha256(session_id + ':' + start_line + ':' + text[:120]) hex-encoded,
//!    prefixed 'substrate-' (idempotent — re-run on same episode = no duplicates)
//! 7. Resolve anchored_uuids: prefer LLM emission; fallback = repo-level lineage rollup (all
//!    candidate-atom UUIDs for the session). Documented fallback always fires when LLM omits field.
//! 8. INSERT OR REPLACE INTO substrate_nodes + emit substrate:ingested event
//!
//! # DB pool pattern
//! Mirrors commands/nodes.rs:119-125: extract DbInstances, read().await, clone inner SqlitePool
//! (cheap — Arc), drop read guard BEFORE any further .await. DB key = "sqlite:contract-ide.db".
//! Satisfies clippy `await_holding_lock`.
//!
//! # Dead-letter kinds
//! - `timeout`: claude process didn't return within 60s
//! - `claude_exit_nonzero`: claude process exited non-zero
//! - `json_parse`: stdout was not valid JSON
//! - `schema_mismatch`: structured_output.nodes was absent or wrong shape

use crate::distiller::{prompt, state::DistillerLocks};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Listener, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_sql::DbInstances;
use tokio::time::{timeout, Duration};

/// Canonical async pool extraction — mirrors commands/nodes.rs:119-125.
/// Returns an OWNED clone of the inner sqlx::SqlitePool (cheap — Arc internally).
/// The DbInstances read lock drops when db_map goes out of scope (implicit at fn return),
/// BEFORE the caller awaits anything. Satisfies clippy `await_holding_lock`.
async fn pool_clone(app: &AppHandle) -> Result<SqlitePool, String> {
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
    // db_map drops here — safe to .await on the cloned pool afterward.
    Ok(pool)
}

/// Distill a single episode: run claude -p extraction, upsert substrate_nodes.
///
/// Called by `init()`'s episode:ingested listener (fire-and-forget spawn).
/// Also called directly by `commands::distiller::retry_dead_letter`.
///
/// Returns the number of substrate_nodes upserted on success.
pub async fn distill_episode(app: &AppHandle, episode_id: &str) -> Result<usize, String> {
    // 1. Load episode + session metadata. Pool is owned-clone; no read guard held across awaits.
    let pool = pool_clone(app).await?;

    let row: (String, String, i64, Option<String>) = sqlx::query_as(
        "SELECT e.session_id, e.filtered_text, e.start_line, s.cwd_key
         FROM episodes e
         LEFT JOIN sessions s ON s.session_id = e.session_id
         WHERE e.episode_id = ?",
    )
    .bind(episode_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| format!("episode lookup: {e}"))?;
    let (session_id, filtered_text, start_line, _cwd_key) = row;

    // 2. Acquire per-session lock (Pattern 1 sub-pattern 3 in 11-RESEARCH.md).
    // Guard scope spans the claude -p call + upsert to prevent two episodes from
    // the same session distilling concurrently (would race on stable substrate UUIDs).
    let locks = app.state::<DistillerLocks>();
    let session_guard = locks.for_session(&session_id);
    let _lock = session_guard.lock().await;

    // 3. Compute candidate-atom hint for the prompt.
    // v1 strategy: atoms whose updated_at >= session.started_at (cheap heuristic).
    // Tighten to file-path matching only if precision proves poor in UAT.
    let atom_candidates = load_session_atom_candidates(&pool, &session_id)
        .await
        .unwrap_or_default();
    let candidates_hint = prompt::render_atom_candidates_hint(&atom_candidates);

    // 4. Run claude -p with --json-schema, 60s timeout.
    let schema = prompt::substrate_node_schema();
    let prompt_text = prompt::DISTILLER_PROMPT
        .replace("{atom_candidates}", &candidates_hint)
        .replace("{filtered_text}", &filtered_text);

    let claude_future = app
        .shell()
        .command("claude")
        .args([
            "-p",
            &prompt_text,
            "--output-format",
            "json",
            "--json-schema",
            &schema.to_string(),
            "--bare",
        ])
        .output();

    let output = match timeout(Duration::from_secs(60), claude_future).await {
        Err(_) => {
            write_dead_letter(&pool, episode_id, "timeout", "").await?;
            return Err("distiller timeout".into());
        }
        Ok(Err(e)) => {
            write_dead_letter(&pool, episode_id, "claude_exit_nonzero", &e.to_string()).await?;
            return Err(format!("claude spawn: {e}"));
        }
        Ok(Ok(out)) => out,
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        write_dead_letter(&pool, episode_id, "claude_exit_nonzero", &stderr).await?;
        return Err("distiller failed (claude non-zero exit)".into());
    }

    // 5. Parse outer JSON, drill into structured_output.nodes (Pitfall 1: never trust
    // LLM output without --json-schema validation).
    let response: serde_json::Value = match serde_json::from_slice(&output.stdout) {
        Ok(v) => v,
        Err(e) => {
            let raw = String::from_utf8_lossy(&output.stdout).to_string();
            write_dead_letter(&pool, episode_id, "json_parse", &raw).await?;
            return Err(format!("response parse: {e}"));
        }
    };

    let nodes_raw = response
        .get("structured_output")
        .and_then(|v| v.get("nodes"))
        .and_then(|v| v.as_array());

    let nodes_raw = match nodes_raw {
        Some(arr) => arr.clone(),
        None => {
            let truncated = response.to_string();
            let trimmed = truncated[..truncated.len().min(4096)].to_string();
            write_dead_letter(&pool, episode_id, "schema_mismatch", &trimmed).await?;
            return Err("missing structured_output.nodes".into());
        }
    };

    // 6. Compute repo-level lineage rollup as fallback for nodes that didn't emit
    // anchored_atom_uuids (or emitted an empty array). v1: every candidate-atom UUID
    // from step 3 anchors any substrate node when the LLM is unsure which atoms to
    // reference. This is intentionally broad — Plan 11-03 filters by FTS5 rank, not
    // anchor count, so a broad fallback doesn't penalise retrieval precision.
    let fallback_anchors: Vec<String> = atom_candidates
        .iter()
        .map(|(u, _, _)| u.clone())
        .collect();

    // 7. Idempotent upsert — stable UUID per (session_id, start_line, text-prefix-120).
    // sha256(session_id + ':' + start_line + ':' + text[:120]) hex[:24], prefixed 'substrate-'.
    let mut upserted = 0usize;
    let now = chrono::Utc::now().to_rfc3339();

    for raw in &nodes_raw {
        let text = raw.get("text").and_then(|v| v.as_str()).unwrap_or("");
        if text.is_empty() {
            continue;
        }
        let node_type = raw
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("constraint");

        // Stable UUID — re-running on same episode produces same UUID (no duplicate rows).
        let prefix_len = text.len().min(120);
        let key = format!("{session_id}:{start_line}:{}", &text[..prefix_len]);
        let mut hasher = Sha256::new();
        hasher.update(key.as_bytes());
        // Take first 12 bytes of sha256 = 24 hex chars — sufficient collision resistance
        // at hackathon scale; shorter than full 64-char sha256 for readability.
        let uuid = format!("substrate-{}", hex::encode(&hasher.finalize()[..12]));

        // Resolve anchored_uuids — prefer LLM emission, fall back to repo-level rollup.
        let llm_anchors: Vec<String> = raw
            .get("anchored_atom_uuids")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        let anchored_uuids: Vec<String> = if llm_anchors.is_empty() {
            // Fallback: repo-level lineage rollup — documented here per must_haves.
            // When LLM omits anchored_atom_uuids or emits [], we anchor to the full
            // candidate set for this session. Plan 11-03's cousin-exclusion JOIN will
            // still work because the anchor set will include the relevant atom UUIDs.
            fallback_anchors.clone()
        } else {
            llm_anchors
        };
        let anchored_uuids_json =
            serde_json::to_string(&anchored_uuids).unwrap_or_else(|_| "[]".to_string());

        sqlx::query(
            r#"INSERT OR REPLACE INTO substrate_nodes
               (uuid, node_type, text, scope, applies_when,
                valid_at, invalid_at, expired_at, created_at,
                source_session_id, source_turn_ref, source_quote, source_actor,
                confidence, episode_id, anchored_uuids)
               VALUES (?,?,?,?,?, ?,NULL,NULL,?, ?,?,?,?, ?,?,?)"#,
        )
        .bind(&uuid)
        .bind(node_type)
        .bind(text)
        .bind(raw.get("scope").and_then(|v| v.as_str()))
        .bind(raw.get("applies_when").and_then(|v| v.as_str()))
        .bind(&now) // valid_at
        .bind(&now) // created_at
        .bind(&session_id)
        .bind(start_line)
        .bind(
            raw.get("source")
                .and_then(|v| v.get("quote"))
                .and_then(|v| v.as_str()),
        )
        .bind(
            raw.get("source")
                .and_then(|v| v.get("actor"))
                .and_then(|v| v.as_str())
                .unwrap_or("claude"),
        )
        .bind(
            raw.get("confidence")
                .and_then(|v| v.as_str())
                .unwrap_or("inferred"),
        )
        .bind(episode_id)
        .bind(&anchored_uuids_json)
        .execute(&pool)
        .await
        .map_err(|e| format!("upsert {uuid}: {e}"))?;

        upserted += 1;
    }

    // 8. Emit substrate counter event — Plan 11-05 footer counter subscribes.
    app.emit(
        "substrate:ingested",
        serde_json::json!({
            "episode_id": episode_id,
            "session_id": session_id,
            "count": upserted,
        }),
    )
    .ok();

    Ok(upserted)
}

/// Load candidate atom UUIDs in scope of the given session.
///
/// v1 strategy: heuristic — atoms whose updated_at >= session.started_at OR
/// atoms in the session's repo. Capped at 50 to keep the prompt hint manageable.
/// Tighten to file-path matching only if atom precision proves poor in UAT.
async fn load_session_atom_candidates(
    pool: &SqlitePool,
    session_id: &str,
) -> Result<Vec<(String, String, String)>, String> {
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        r#"
        SELECT n.uuid, n.level, n.name
        FROM nodes n, sessions s
        WHERE s.session_id = ?
          AND n.is_canonical = 1
          AND (n.updated_at IS NOT NULL AND n.updated_at >= s.started_at)
        LIMIT 50
        "#,
    )
    .bind(session_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("atom candidates lookup: {e}"))?;
    Ok(rows)
}

/// Write a dead-letter row for a failed distillation attempt.
/// `raw_output` is truncated to 4096 bytes to cap storage.
///
/// ON CONFLICT: if the same (id) already exists, increment attempt_count
/// and update last_attempt_at. This allows retry_dead_letter to call
/// distill_episode again and the failure is still tracked.
async fn write_dead_letter(
    pool: &SqlitePool,
    episode_id: &str,
    error_kind: &str,
    raw_output: &str,
) -> Result<(), String> {
    let id = uuid::Uuid::new_v4().to_string();
    let truncated_len = raw_output.len().min(4096);
    let truncated = &raw_output[..truncated_len];
    sqlx::query(
        "INSERT INTO distiller_dead_letters (id, episode_id, error_kind, raw_output, attempt_count)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(id) DO UPDATE SET
           attempt_count = attempt_count + 1,
           last_attempt_at = datetime('now')",
    )
    .bind(&id)
    .bind(episode_id)
    .bind(error_kind)
    .bind(truncated)
    .execute(pool)
    .await
    .map_err(|e| format!("dead_letter insert: {e}"))?;
    Ok(())
}

/// Subscribe to Phase 10's episode:ingested event. Called from lib.rs setup().
///
/// On receipt of an `episode:ingested` payload `{ episode_id, session_id }`,
/// spawns `distill_episode` in a background task. Any distillation failure is
/// logged as a warning (and written to distiller_dead_letters) but does NOT
/// propagate back to the caller — ingestion must not be blocked by distillation
/// failures.
pub fn init(app: &AppHandle) {
    let app_clone = app.clone();
    app.listen("episode:ingested", move |event| {
        let payload: serde_json::Value =
            serde_json::from_str(event.payload()).unwrap_or(serde_json::json!({}));
        let Some(episode_id) = payload
            .get("episode_id")
            .and_then(|v| v.as_str())
            .map(String::from)
        else {
            return;
        };
        let app = app_clone.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = distill_episode(&app, &episode_id).await {
                eprintln!("[distiller] distill_episode({episode_id}) failed: {e}");
            }
        });
    });
}
