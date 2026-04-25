// Tauri commands for repository open / path query / incremental refresh.
//
// The folder-picker dialog is invoked from the FRONTEND via
// @tauri-apps/plugin-dialog (Task 3). The Rust side receives only the already-
// chosen path, keeping this module testable without a UI.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Manager, State};
use tauri_plugin_fs::FsExt;
use tauri_plugin_sql::{DbInstances, DbPool};
use crate::db::scanner::{scan_contracts_dir, ScanResult};
use crate::sidecar::frontmatter::CodeRange as SidecarCodeRange;
use crate::sidecar::jsx_align_validator::{
    validate_jsx_alignment, CodeRange as JsxCodeRange,
    ContractRecord as JsxContractRecord,
};
use crate::sidecar::backend_section_validator::{
    validate_backend_sections, ContractRecord as BackendContractRecord,
};

/// Persisted repository root. Stored in Tauri managed state so
/// `get_repo_path` can retrieve it and Plan 02-03's watcher can read it.
pub struct RepoState(pub Mutex<Option<PathBuf>>);

/// Open a repository at `repo_path`, scan its `.contracts/` directory, and
/// populate the SQLite DB. Returns a `ScanResult` so the frontend can surface
/// errors (duplicate UUIDs, parse failures).
#[tauri::command]
pub async fn open_repo(
    app: tauri::AppHandle,
    repo_path: String,
    repo_state: State<'_, RepoState>,
) -> Result<ScanResult, String> {
    let path = PathBuf::from(&repo_path);

    // Persist path for watcher + reload.
    //
    // TODO(Phase 8): When the repo path changes here (open_repo called on an
    // already-running app), the MCP sidecar spawned in setup() still has the
    // OLD CONTRACT_IDE_REPO_PATH env var baked in — its `update_contract` tool
    // will write to the previous repo's `.contracts/` dir. Phase 8 needs to
    // either restart the sidecar with the new env, or add an in-memory
    // management tool. See also commands/mcp.rs `launch_mcp_sidecar` for the
    // symmetric pointer. Plan 05-02 accepts the startup-time posture because
    // its UAT launches Claude Code against a fixed `.mcp.json` that supplies
    // the repo path directly.
    {
        let mut guard = repo_state.0.lock().map_err(|e| e.to_string())?;
        *guard = Some(path.clone());
    }

    // Grant the fs plugin runtime scope for the selected repo so the JS-side
    // `watch()` call in startContractsWatcher can observe `.contracts/` edits.
    // The `fs:allow-watch` capability permission only enables the command; the
    // path itself is gated by the plugin's scope. Canonicalize so macOS
    // `/tmp` (symlink) matches the `/private/tmp` form the plugin checks.
    let canonical = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
    let fs_scope = app.fs_scope();
    let _ = fs_scope.allow_directory(&canonical, true);
    if canonical != path {
        let _ = fs_scope.allow_directory(&path, true);
    }

    let mut scan_result = scan_contracts_dir(&app, &path)
        .await
        .map_err(|e| e.to_string())?;

    // Phase 9 Plan 09-04b: JSX-01 + BACKEND-FM-01 startup validators run after
    // scan completes. Errors are appended to `scan_result.errors` with
    // [JSX-01] / [BACKEND-FM-01] prefixes so the existing repo-load error
    // surface (GraphPlaceholder + scanResult.errors path) renders them as a
    // persistent display until the next scan.
    let validator_errors = run_repo_validators(&app, &path).await;
    if !validator_errors.is_empty() {
        scan_result.error_count = scan_result.error_count.saturating_add(validator_errors.len() as u32);
        scan_result.errors.extend(validator_errors);
    }

    // Phase 7 (Plan 07-02): Re-register the source-file watcher from the
    // freshly-scanned DB state. This call MUST happen AFTER scan_contracts_dir
    // awaits (SQLite upserts have landed) and BEFORE we return to the frontend
    // (so a user who edits a file immediately after open won't miss the event).
    //
    // CRITICAL: Only call watcher-refresh from open_repo and refresh_nodes —
    // NEVER from drift::engine::compute_and_emit (would recursively re-register
    // on every drift event).
    crate::commands::drift::refresh_source_watcher_from_db(&app, &path).await;

    // Phase 10 (Plan 10-03): register the SessionWatcher for this repo's
    // cwd_key. Watches `~/.claude/projects/<cwd-key>/` for ambient Claude Code
    // session activity (first user message → row in `sessions` table within
    // ~2s on macOS FSEvents). Does NOT propagate errors to the frontend
    // (degraded mode = no substrate collection, but repo still opens — same
    // posture as Phase 7's drift watcher). If `~/.claude/projects/<cwd-key>/`
    // does not yet exist, the watcher silently defers per Pitfall 4.
    let cwd_key = crate::session::cwd_key::derive_cwd_key(&path);
    let session_watcher = app.state::<crate::session::watcher::SessionWatcher>();
    if let Err(e) = session_watcher.watch_project(app.clone(), &cwd_key) {
        eprintln!("[session] SessionWatcher::watch_project failed: {e}");
    }

    Ok(scan_result)
}

/// Return the currently-open repository path so the frontend can reconstruct
/// state on reload. Returns `None` if no repository has been opened yet.
#[tauri::command]
pub fn get_repo_path(repo_state: State<'_, RepoState>) -> Result<Option<String>, String> {
    let guard = repo_state.0.lock().map_err(|e| e.to_string())?;
    Ok(guard.as_ref().map(|p| p.to_string_lossy().to_string()))
}

/// Re-parse only the changed sidecar files (supplied by the JS watcher) and
/// upsert their rows into SQLite. Does NOT walk the full `.contracts/` dir —
/// only the specific `paths` the watcher reported as modified/created.
///
/// Delete events: when a sidecar is deleted the OS fires an event with the old
/// path, which will fail the `path.exists()` check below and be silently skipped.
/// TODO(Phase 7 → punted to 07-04 UAT): propagate deletes to SQLite via
/// `DELETE FROM nodes WHERE uuid = ?` as part of drift reconciliation. Requires
/// distinguishing sidecar-file-deleted vs source-file-deleted. Phase 2 watcher
/// focuses on create/modify only; DRIFT-01 success criterion doesn't depend on
/// delete handling.
#[tauri::command]
pub async fn refresh_nodes(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<ScanResult, String> {
    let mut updated: u32 = 0;
    let mut errors: Vec<String> = Vec::new();

    // Scope the DbInstances read lock to the upsert block only. We must drop
    // `db_map` BEFORE calling refresh_source_watcher_from_db below — that
    // helper also acquires the DbInstances read lock, and holding a read lock
    // across an .await that tries to reacquire it would deadlock.
    {
        let instances = app.state::<DbInstances>();
        let db_map = instances.0.read().await;
        let db = db_map
            .get("sqlite:contract-ide.db")
            .ok_or("DB not loaded")?;

        for p in &paths {
            let path = std::path::Path::new(p.as_str());
            // Filter: only process .md files that still exist on disk.
            if path.extension().and_then(|x| x.to_str()) != Some("md") {
                continue;
            }
            if !path.exists() {
                // File was deleted — skip; see TODO above.
                continue;
            }
            match std::fs::read_to_string(path) {
                Ok(content) => {
                    match crate::sidecar::frontmatter::parse_sidecar(&content) {
                        Ok((fm, body)) => {
                            if let Err(e) =
                                crate::db::scanner::upsert_node_pub(db, &fm, &body).await
                            {
                                errors.push(format!("Upsert {} failed: {e}", fm.uuid));
                            } else {
                                updated += 1;
                            }
                        }
                        Err(e) => errors.push(format!("Parse {p}: {e}")),
                    }
                }
                Err(e) => errors.push(format!("Read {p}: {e}")),
            }
        }
        // db_map read lock released here (end of scope).
    }

    // Phase 7 (Plan 07-02): Re-register the source-file watcher so any
    // newly-derived node's code_ranges start being observed (RESEARCH.md
    // Pitfall 7). Reads the FULL set from DB (not just paths in this batch) to
    // stay simple and correct. Called AFTER upserts settle so new rows exist.
    //
    // Option A (no signature change): fetch RepoState from app handle inline.
    // The std::sync::MutexGuard is scoped to the inner block so it drops before
    // the .await on refresh_source_watcher_from_db (holding std::sync::Mutex
    // across .await is a clippy -D warnings violation).
    //
    // CRITICAL: Only call watcher-refresh from open_repo and refresh_nodes —
    // NEVER from drift::engine::compute_and_emit (would recursively re-register
    // on every drift event).
    let repo_path_opt: Option<std::path::PathBuf> = {
        let repo_state = app.state::<crate::commands::repo::RepoState>();
        let guard = repo_state.0.lock().ok();
        guard.and_then(|g| g.clone())
    };
    if let Some(repo_path) = repo_path_opt {
        crate::commands::drift::refresh_source_watcher_from_db(&app, &repo_path).await;
    }

    Ok(ScanResult {
        node_count: updated,
        error_count: errors.len() as u32,
        errors,
    })
}

/// Phase 9 Plan 09-04b: run JSX-01 + BACKEND-FM-01 startup validators against
/// the freshly-scanned DB. Returns a flat `Vec<String>` of prefixed error
/// strings to merge into `ScanResult.errors`.
///
/// On any DB read failure, returns a single `[VALIDATORS]` error rather than
/// failing the whole repo open — degraded posture mirrors Phase 7's drift
/// watcher (a missing validator pass should not block repo entry).
async fn run_repo_validators(app: &tauri::AppHandle, repo_root: &Path) -> Vec<String> {
    let instances = app.state::<DbInstances>();
    let db_map = instances.0.read().await;
    let pool = match db_map
        .get("sqlite:contract-ide.db")
        .and_then(|d| match d {
            DbPool::Sqlite(p) => Some(p.clone()),
            #[allow(unreachable_patterns)]
            _ => None,
        }) {
        Some(p) => p,
        None => {
            return vec!["[VALIDATORS] sqlite pool unavailable — JSX-01 + BACKEND-FM-01 skipped".to_string()];
        }
    };
    drop(db_map);

    let rows = match sqlx::query_as::<_, (String, String, String, Option<String>, Option<String>)>(
        "SELECT uuid, kind, level, code_ranges, contract_body FROM nodes",
    )
    .fetch_all(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return vec![format!("[VALIDATORS] DB read failed: {e}")];
        }
    };

    let mut jsx_records: Vec<JsxContractRecord> = Vec::with_capacity(rows.len());
    let mut backend_records: Vec<BackendContractRecord> = Vec::with_capacity(rows.len());

    for (uuid, kind, level, code_ranges_json, contract_body) in rows {
        let body = contract_body.unwrap_or_default();
        let code_ranges: Vec<SidecarCodeRange> = code_ranges_json
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default();

        let jsx_code_ranges: Vec<JsxCodeRange> = code_ranges
            .iter()
            .map(|cr| JsxCodeRange {
                file: cr.file.clone(),
                start_line: cr.start_line as usize,
                end_line: cr.end_line as usize,
            })
            .collect();

        jsx_records.push(JsxContractRecord {
            uuid: uuid.clone(),
            kind: kind.clone(),
            level: level.clone(),
            body: body.clone(),
            source_file: String::new(),
            code_ranges: jsx_code_ranges,
        });

        backend_records.push(BackendContractRecord {
            uuid,
            kind,
            source_file: String::new(),
            body,
        });
    }

    let mut out = Vec::new();

    for err in validate_jsx_alignment(repo_root, &jsx_records) {
        out.push(format!(
            "[JSX-01] {} ({}:{}-{}): {}",
            err.uuid, err.file, err.start_line, err.end_line, err.reason
        ));
    }

    for err in validate_backend_sections(&backend_records) {
        out.push(format!(
            "[BACKEND-FM-01] {} (kind={}): missing required sections — {}",
            err.uuid,
            err.kind,
            err.missing.join(", ")
        ));
    }

    out
}
