//! Phase 10 SessionWatcher — notify::RecommendedWatcher on
//! `~/.claude/projects/<cwd-key>/` for `*.jsonl` session activity.
//!
//! Mirrors Phase 7's `crate::drift::watcher::SourceWatcher` structure but
//! watches a directory NonRecursive (not individual files) — Claude Code
//! creates new session UUIDs dynamically (per `/clear`, per `claude`
//! invocation), so directory-level watching is required (RESEARCH §Pattern 1
//! / Pitfall 5).
//!
//! Lifecycle:
//! - `SessionWatcher::new()` — registered in `lib.rs` managed state at
//!   startup (no project bound yet).
//! - `watch_project(app, cwd_key)` — called from `commands::repo::open_repo`
//!   AFTER `scan_contracts_dir` + `refresh_source_watcher_from_db`. Replaces
//!   any prior watcher (idempotent on same key).
//! - On Modify/Create event for a `<session-id>.jsonl` file the closure
//!   spawns `crate::session::ingestor::ingest_session_file` via
//!   `tauri::async_runtime::spawn`. Errors logged via `eprintln!`; the
//!   watcher callback must remain infallible.
//! - After each successful ingest the closure also emits a
//!   `session:status` Tauri event so the footer indicator (10-04) updates
//!   live without re-polling.
//!
//! Missing-directory handling (Pitfall 4): if
//! `~/.claude/projects/<cwd-key>/` does not yet exist (the user has never
//! run `claude` in this repo), `watch_project` returns Ok(()) silently
//! after recording the cwd_key — no watcher is started but the call
//! succeeds so `open_repo` does not surface a spurious error. The user
//! must reopen the repo after their first `claude` invocation to activate
//! the watcher (v1 simplicity per RESEARCH).

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::sync::Mutex;
use tauri::AppHandle;

use crate::session::cwd_key::claude_projects_dir;

pub struct SessionWatcher {
    /// The active notify watcher. `None` when no project is open or when the
    /// target directory does not exist yet (deferred per Pitfall 4).
    /// `std::sync::Mutex` is correct — `watch_project` is synchronous and
    /// no `.await` is held across the lock guard.
    inner: Mutex<Option<RecommendedWatcher>>,
    /// Currently-watched cwd_key — used to detect the no-op repo-reopen case
    /// and to recognise repo-switch (replace the watcher).
    current_cwd_key: Mutex<Option<String>>,
}

impl SessionWatcher {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
            current_cwd_key: Mutex::new(None),
        }
    }

    /// Set (or replace) the watched directory based on the current repo's
    /// cwd_key. Watches `~/.claude/projects/<cwd-key>/` non-recursively for
    /// `*.jsonl` Modify/Create events.
    ///
    /// If the target directory does not exist (Pitfall 4 deferral), records
    /// the key and returns Ok(()) silently — the open_repo call still
    /// succeeds, but no events will fire until the user reopens the repo
    /// after running `claude` for the first time in it.
    pub fn watch_project(&self, app: AppHandle, cwd_key: &str) -> Result<(), String> {
        // Idempotency: if same cwd_key as currently watched, no-op. open_repo
        // can be called repeatedly during scanning + refresh without churning
        // the underlying notify watcher.
        {
            let current = self
                .current_cwd_key
                .lock()
                .map_err(|e| format!("SessionWatcher.current_cwd_key poisoned: {e}"))?;
            if current.as_deref() == Some(cwd_key) {
                return Ok(());
            }
        }

        let projects_dir = claude_projects_dir()?;
        let target_dir = projects_dir.join(cwd_key);

        if !target_dir.exists() {
            eprintln!(
                "[session] projects dir {target_dir:?} does not exist yet — watcher deferred. \
                 Once you run `claude` in this repo and reopen it in Contract IDE, the watcher \
                 will activate. (Pitfall 4 deferral.)"
            );
            // Clear any stale watcher so a previously-open repo's watcher
            // doesn't keep firing after a switch.
            *self
                .inner
                .lock()
                .map_err(|e| format!("SessionWatcher.inner poisoned: {e}"))? = None;
            *self
                .current_cwd_key
                .lock()
                .map_err(|e| format!("SessionWatcher.current_cwd_key poisoned: {e}"))? =
                Some(cwd_key.to_string());
            return Ok(());
        }

        let app_cb = app.clone();
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
            let Ok(event) = res else { return };
            // Modify or Create — append-grow + new-session events. Skip
            // Remove (Claude Code doesn't delete session files; if the user
            // manually rm's one, no ingestion to do). Skip Access / Other to
            // reduce noise.
            match event.kind {
                EventKind::Modify(_) | EventKind::Create(_) => {}
                _ => return,
            }
            for path in &event.paths {
                // Filter to *.jsonl only — `~/.claude/projects/<cwd>/` may
                // also contain Claude Code's own state files we don't ingest.
                if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                    continue;
                }
                let session_id = match path.file_stem().and_then(|s| s.to_str()) {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                let app2 = app_cb.clone();
                let path2 = path.clone();
                tauri::async_runtime::spawn(async move {
                    match crate::session::ingestor::ingest_session_file(
                        app2.clone(),
                        session_id.clone(),
                        path2,
                    )
                    .await
                    {
                        Ok(newly_inserted) => {
                            // Only emit on actual progress. Tool-use bursts can
                            // fire 10+ FSEvents per write where most resolve to
                            // newly_inserted == 0; emitting per-event would
                            // generate 10× the redundant DB COUNT(*) round-trips
                            // and frontend re-renders.
                            if newly_inserted > 0 {
                                emit_session_status(&app2).await;
                                eprintln!(
                                    "[session] {session_id}: {newly_inserted} new episodes ingested"
                                );
                            }
                        }
                        Err(e) => eprintln!("[session] {session_id} ingest error: {e}"),
                    }
                });
            }
        })
        .map_err(|e| format!("notify watcher init: {e}"))?;

        // NonRecursive: directory-level watch, not per-file. Claude Code
        // creates new session-id files dynamically; recursive would be
        // unnecessary (no subdirs in a project's session dir).
        watcher
            .watch(&target_dir, RecursiveMode::NonRecursive)
            .map_err(|e| format!("notify watch register: {e}"))?;

        *self
            .inner
            .lock()
            .map_err(|e| format!("SessionWatcher.inner poisoned: {e}"))? = Some(watcher);
        *self
            .current_cwd_key
            .lock()
            .map_err(|e| format!("SessionWatcher.current_cwd_key poisoned: {e}"))? =
            Some(cwd_key.to_string());
        Ok(())
    }
}

impl Default for SessionWatcher {
    fn default() -> Self {
        Self::new()
    }
}

/// Emit `session:status` event with current watching count + total episode
/// count for the currently-open repo. Called from the watcher dispatch
/// closure after each successful ingest, and (with `null` placeholders) from
/// `commands::session::execute_backfill` after batch completion.
///
/// Reads from SQLite directly with `COUNT(*)` queries — sub-millisecond at
/// hackathon scale (< 100 sessions per developer per day).
async fn emit_session_status(app: &AppHandle) {
    use tauri::{Emitter, Manager};
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

    // Resolve the open repo path → cwd_key. If no repo is open we still emit
    // a zero-count event so the UI clears any stale numbers.
    let cwd_key_opt: Option<String> = {
        let repo_state = app.state::<crate::commands::repo::RepoState>();
        let path_opt = repo_state.0.lock().ok().and_then(|g| g.clone());
        path_opt.map(|p| crate::session::cwd_key::derive_cwd_key(&p))
    };

    let (sessions_count, episodes_count): (i64, i64) = if let Some(cwd) = cwd_key_opt {
        let s: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM sessions WHERE cwd_key = ?1 AND state = 'active'",
        )
        .bind(&cwd)
        .fetch_one(pool)
        .await
        .unwrap_or((0,));
        let e: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM episodes e
             JOIN sessions s ON s.session_id = e.session_id
             WHERE s.cwd_key = ?1",
        )
        .bind(&cwd)
        .fetch_one(pool)
        .await
        .unwrap_or((0,));
        (s.0, e.0)
    } else {
        (0, 0)
    };

    drop(map);

    let _ = app.emit(
        "session:status",
        serde_json::json!({
            "watchingSessions": sessions_count.max(0) as u64,
            "episodesIngested": episodes_count.max(0) as u64,
        }),
    );
}
