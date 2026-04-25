//! Agent runner — spawn `claude` CLI, stream output via `agent:stream` events,
//! persist receipt on termination.
//!
//! W3 fix: wall_time_ms is measured via `Instant::now()` deltas around spawn,
//! NOT derived from JSONL timestamps.
//!
//! I2: CommandChild handle is tracked in a Tauri-managed state map keyed by
//! tracking_id. Future kill-switch UI calls:
//!   `app.state::<AgentRuns>().0.lock().await.remove(&id).map(|c| c.kill())`

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tauri::async_runtime::Mutex as AsyncMutex;
use tauri::{Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Tauri-managed map of in-flight agent runs.
///
/// I2 insurance: this struct is registered with `app.manage()` so that a future
/// kill-switch command can call:
///   `app.state::<AgentRuns>().0.lock().await.remove(&tracking_id).map(|c| c.kill())`
/// No v1 UI consumer — this is purely insurance for v2.
pub struct AgentRuns(pub AsyncMutex<HashMap<String, CommandChild>>);

impl Default for AgentRuns {
    fn default() -> Self {
        AgentRuns(AsyncMutex::new(HashMap::new()))
    }
}

/// Run the claude CLI in `-p` (print) mode, streaming stdout via `agent:stream`
/// events. On termination, parses the session JSONL and persists a receipt.
///
/// Returns the `tracking_id` immediately so the frontend has a handle while the
/// run streams in the background.
///
/// Phase 11's Delegate button calls this command with a `scope_uuid` and `bare=Some(true)`.
/// Phase 8's chat panel calls this with or without a scope_uuid; `bare` defaults to false.
///
/// Phase 11 amendment: optional `bare: bool` param (default false).
/// When true, appends `--bare` to the claude spawn args.
/// All Phase 11 claude -p calls (planning + execute) pass bare=true via this param.
/// Phase 8 chat panel callers omit the param (Tauri treats missing as None → false).
#[tauri::command]
pub async fn run_agent(
    app: tauri::AppHandle,
    prompt: String,
    scope_uuid: Option<String>,
    bare: Option<bool>,
) -> Result<String, String> {
    let bare = bare.unwrap_or(false);
    let tracking_id = uuid::Uuid::new_v4().to_string();

    // Assemble context-rich prompt from SQLite + sidecar reads (AGENT-01 invariant).
    let assembled_prompt = crate::agent::prompt_assembler::assemble_prompt(
        &app,
        &prompt,
        scope_uuid.as_deref(),
    )
    .await
    .unwrap_or_else(|_| prompt.clone());

    // Resolve the open repo path — the agent must run with cwd at the user's
    // repo so relative paths in code_ranges (`src/foo.tsx`) resolve correctly
    // and the PostToolUse hook can find `.contracts/journal/`. Without this,
    // the agent inherits the Tauri host's cwd (the contract-ide source root in
    // dev) and Read/Write tool calls land in the wrong tree.
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

    // --- Snapshot ~/.claude/projects/<encoded-cwd>/ BEFORE spawn ---
    // Fallback path for session-id discovery if stream doesn't expose it.
    // Use the agent's actual cwd (open repo) so the encoded path matches the
    // session JSONL Claude writes.
    let encoded_cwd = crate::commands::receipts::encode_cwd(&repo_path);
    let claude_projects_dir = dirs_home().join(".claude").join("projects").join(&encoded_cwd);
    let pre_spawn_jsonl_names: std::collections::HashSet<String> =
        list_jsonl_names(&claude_projects_dir);

    // Shared session_id discovered from stream events.
    let stream_session_id: Arc<AsyncMutex<Option<String>>> = Arc::new(AsyncMutex::new(None));

    // W3: capture spawn instant IMMEDIATELY before .spawn().
    let spawn_start = Instant::now();

    // --dangerously-skip-permissions: the user has already opted into agent
    // execution by typing intent into the chat panel and clicking Send. Without
    // this flag, every Read/Write/Edit/Bash tool call inside the spawned agent
    // emits a permissions prompt that goes nowhere (no interactive stdin), so
    // the agent halts mid-stream waiting for approval that never arrives.
    // For the demo bar (CLAUDE.md), the chat panel IS the consent surface.
    //
    // Phase 11 amendment: when bare=true (delegate_execute path), append --bare
    // to suppress MCP discovery + CLAUDE.md + skills loading (saves 1-3s startup
    // latency; mandatory per Pitfall 3).
    let mut claude_args: Vec<String> = vec![
        "-p".to_string(),
        assembled_prompt.clone(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
        "--dangerously-skip-permissions".to_string(),
    ];
    if bare {
        claude_args.push("--bare".to_string());
    }
    let (mut rx, child) = app
        .shell()
        .command("claude")
        .current_dir(repo_path.clone())
        .args(claude_args)
        .spawn()
        .map_err(|e| format!("claude spawn failed: {e}"))?;

    // I2: store CommandChild keyed by tracking_id before spawning drain task.
    {
        let state = app.state::<AgentRuns>();
        let mut map = state.0.lock().await;
        map.insert(tracking_id.clone(), child);
    }

    // Clone for drain task.
    let app2 = app.clone();
    let tracking_id2 = tracking_id.clone();
    let scope_uuid2 = scope_uuid.clone();
    let stream_session_id2 = Arc::clone(&stream_session_id);

    tauri::async_runtime::spawn(async move {
        loop {
            match rx.recv().await {
                Some(CommandEvent::Stdout(bytes)) => {
                    let line = String::from_utf8_lossy(&bytes).to_string();

                    // Extract session_id from stream line if present.
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                        if let Some(sid) = v
                            .get("session_id")
                            .and_then(|s| s.as_str())
                            .filter(|s| !s.is_empty())
                        {
                            let mut guard = stream_session_id2.lock().await;
                            if guard.is_none() {
                                *guard = Some(sid.to_owned());
                            }
                        }
                    }

                    let session_id_known = stream_session_id2.lock().await.is_some();
                    let _ = app2.emit(
                        "agent:stream",
                        serde_json::json!({
                            "tracking_id": tracking_id2,
                            "line": line,
                            "is_stderr": false,
                            "session_id_known": session_id_known,
                        }),
                    );
                }
                Some(CommandEvent::Stderr(bytes)) => {
                    let line = String::from_utf8_lossy(&bytes).to_string();
                    eprintln!("[agent] stderr {tracking_id2}: {line}");
                    let _ = app2.emit(
                        "agent:stream",
                        serde_json::json!({
                            "tracking_id": tracking_id2,
                            "line": line,
                            "is_stderr": true,
                            "session_id_known": false,
                        }),
                    );
                }
                Some(CommandEvent::Terminated(payload)) => {
                    // W3: measure wall_time_ms via Instant delta (authoritative).
                    let wall_time_ms = spawn_start.elapsed().as_millis() as u64;

                    // Resolve session_id: prefer stream-discovered, fall back to snapshot diff.
                    let session_id = {
                        let guard = stream_session_id2.lock().await;
                        guard.clone().or_else(|| {
                            // Snapshot diff path.
                            let post_names = list_jsonl_names(&claude_projects_dir);
                            post_names
                                .difference(&pre_spawn_jsonl_names)
                                .next()
                                .and_then(|name| name.strip_suffix(".jsonl").map(str::to_owned))
                        })
                    };

                    let jsonl_path = session_id
                        .as_ref()
                        .map(|sid| claude_projects_dir.join(format!("{sid}.jsonl")));

                    // Parse + persist receipt.
                    if let Some(ref jpath) = jsonl_path {
                        match crate::commands::receipts::parse_and_persist(
                            &app2,
                            &tracking_id2,
                            jpath,
                            scope_uuid2.as_deref(),
                            Some(wall_time_ms),
                        )
                        .await
                        {
                            Ok(_) => {}
                            Err(e) => {
                                eprintln!("[agent] parse_and_persist error: {e}");
                                // Emit a mock receipt so the UI never blanks.
                                let mock = crate::commands::receipts::mock_receipt(
                                    &tracking_id2,
                                    jpath.clone(),
                                );
                                let _ = app2.emit(
                                    "receipt:created",
                                    serde_json::json!({
                                        "tracking_id": tracking_id2,
                                        "parse_status": mock.parse_status.as_str(),
                                        "wall_time_ms": wall_time_ms,
                                        "input_tokens": 0,
                                        "output_tokens": 0,
                                    }),
                                );
                            }
                        }
                    } else {
                        // No session JSONL found — emit mock receipt with wall_time.
                        let mock = crate::commands::receipts::mock_receipt(
                            &tracking_id2,
                            PathBuf::from("/dev/null"),
                        );
                        let _ = app2.emit(
                            "receipt:created",
                            serde_json::json!({
                                "tracking_id": tracking_id2,
                                "parse_status": mock.parse_status.as_str(),
                                "wall_time_ms": wall_time_ms,
                                "input_tokens": 0,
                                "output_tokens": 0,
                            }),
                        );
                    }

                    // Remove from AgentRuns map.
                    {
                        let state = app2.state::<AgentRuns>();
                        let mut map = state.0.lock().await;
                        map.remove(&tracking_id2);
                    }

                    // Emit agent:complete.
                    let _ = app2.emit(
                        "agent:complete",
                        serde_json::json!({
                            "tracking_id": tracking_id2,
                            "code": payload.code,
                            "wall_time_ms": wall_time_ms,
                        }),
                    );

                    break;
                }
                None => break,
                _ => {}
            }
        }
    });

    Ok(tracking_id)
}

/// List all .jsonl filenames in a directory.
fn list_jsonl_names(dir: &PathBuf) -> std::collections::HashSet<String> {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().into_owned();
                    if name.ends_with(".jsonl") {
                        Some(name)
                    } else {
                        None
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Resolve the home directory.
fn dirs_home() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp"))
}
