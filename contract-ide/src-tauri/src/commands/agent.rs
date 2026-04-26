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

/// Defaults tuned for the chat panel — favor low latency over reasoning depth.
/// Override per-call by passing `model` / `effort` params from the frontend.
/// Delegate code-gen path (commands/delegate.rs) opts up to sonnet + medium.
const DEFAULT_AGENT_MODEL: &str = "haiku";
const DEFAULT_AGENT_EFFORT: &str = "low";

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
///
/// Latency tuning: optional `model` (alias like "haiku"/"sonnet"/"opus" or a
/// full model id) and `effort` ("low"/"medium"/"high"/"xhigh"/"max" — the
/// claude CLI's surfaced thinking-budget knob). Both default to the
/// DEFAULT_AGENT_* constants above when None — chat callers get fast defaults
/// without having to pass anything; delegate callers opt up explicitly.
#[tauri::command]
pub async fn run_agent(
    app: tauri::AppHandle,
    prompt: String,
    scope_uuid: Option<String>,
    bare: Option<bool>,
    model: Option<String>,
    effort: Option<String>,
    extra_args: Option<Vec<String>>,
    substrate_rules_json: Option<String>, // Phase 15: forwarded to parse_and_persist → receipts
    resume_session_id: Option<String>,    // Chat continuity: when set, --resume the prior claude session
    previous_scope_uuid: Option<String>,  // Scope from the prior turn — when it differs from scope_uuid on a resume turn, we re-inject the new scope so the agent sees the user's mid-chat canvas focus shift.
) -> Result<String, String> {
    let bare = bare.unwrap_or(false);
    let model = model.unwrap_or_else(|| DEFAULT_AGENT_MODEL.to_string());
    let effort = effort.unwrap_or_else(|| DEFAULT_AGENT_EFFORT.to_string());
    let extra_args = extra_args.unwrap_or_default();
    let tracking_id = uuid::Uuid::new_v4().to_string();

    eprintln!(
        "[run_agent] tracking_id={} scope_uuid={:?} previous_scope_uuid={:?} resume_session_id={:?} user_prompt={:?}",
        tracking_id, scope_uuid, previous_scope_uuid, resume_session_id, prompt
    );

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

    // Validate resume_session_id BEFORE deciding whether to skip scope
    // assembly. claude --resume errors with "valid session ID required" when
    // the underlying JSONL is missing on disk (account change, /clear, log
    // rotation). When we drop a stale id, the run starts fresh AND scope
    // gets re-injected — without the early validation we'd send a bare prompt
    // with no scope context to a brand-new claude session.
    let encoded_cwd = crate::commands::receipts::encode_cwd(&repo_path);
    let claude_projects_dir = dirs_home().join(".claude").join("projects").join(&encoded_cwd);
    let resume_session_id: Option<String> = resume_session_id
        .filter(|s| !s.trim().is_empty())
        .and_then(|sid| {
            let candidate = claude_projects_dir.join(format!("{sid}.jsonl"));
            if candidate.exists() {
                Some(sid)
            } else {
                eprintln!(
                    "[run_agent] resume_session_id={sid} but JSONL not found at {} — dropping --resume, starting a fresh session",
                    candidate.display()
                );
                None
            }
        });

    // Resuming a prior session: claude --resume injects all prior turns automatically,
    // so normally we skip scope assembly (it was already injected on the first turn).
    // EXCEPTION: when the user has shifted canvas focus mid-chat (scope_uuid differs
    // from previous_scope_uuid), we re-inject the new scope so the agent sees the
    // contract body the user just highlighted — without this, the resumed session
    // only knows the turn-1 scope and the agent answers from stale context.
    // First-turn callers (resume_session_id None) run the full assembly path below.
    let assembled_prompt = if resume_session_id.is_some() {
        let scope_changed = match (scope_uuid.as_deref(), previous_scope_uuid.as_deref()) {
            (Some(now), Some(prev)) => now != prev,
            (Some(_), None) => true, // user picked a scope after an unscoped turn
            _ => false,              // None on this turn → keep prior context
        };
        if scope_changed {
            eprintln!(
                "[run_agent] resume + scope changed (prev={:?} → now={:?}) — re-injecting scope context",
                previous_scope_uuid, scope_uuid
            );
            match crate::agent::prompt_assembler::assemble_prompt(
                &app,
                &prompt,
                scope_uuid.as_deref(),
            )
            .await
            {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("[run_agent] scope re-injection FAILED: {} — falling back to raw prompt", e);
                    prompt.clone()
                }
            }
        } else {
            eprintln!("[run_agent] resuming prior session — skipping scope assembly, using raw prompt");
            prompt.clone()
        }
    } else {
        // Assemble context-rich prompt from SQLite + sidecar reads (AGENT-01 invariant).
        // Don't silently fall back on error — log the failure so we can see why scoping
        // didn't work. Falling back to raw `prompt` strips scope context, which makes
        // the agent answer as if no node were selected.
        match crate::agent::prompt_assembler::assemble_prompt(
            &app,
            &prompt,
            scope_uuid.as_deref(),
        )
        .await
        {
            Ok(p) => {
                eprintln!(
                    "[run_agent] assembled prompt ({} chars):\n----- BEGIN PROMPT -----\n{}\n----- END PROMPT -----",
                    p.len(),
                    p
                );
                p
            }
            Err(e) => {
                eprintln!("[run_agent] assemble_prompt FAILED: {} — falling back to raw user prompt (NO SCOPE)", e);
                prompt.clone()
            }
        }
    };

    // --- Snapshot ~/.claude/projects/<encoded-cwd>/ BEFORE spawn ---
    // Fallback path for session-id discovery if stream doesn't expose it.
    // (encoded_cwd + claude_projects_dir were resolved above for the
    // resume-session validation; reuse them rather than recompute.)
    let pre_spawn_jsonl_names: std::collections::HashSet<String> =
        list_jsonl_names(&claude_projects_dir);

    // Shared session_id. When --resume-ing, pre-populate so the Terminated branch
    // can locate the JSONL — claude appends to the existing session file rather than
    // creating a new one, so the snapshot-diff fallback would not find it.
    let stream_session_id: Arc<AsyncMutex<Option<String>>> = Arc::new(AsyncMutex::new(resume_session_id.clone()));

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
        "--model".to_string(),
        model.clone(),
        "--effort".to_string(),
        effort.clone(),
    ];
    if bare {
        claude_args.push("--bare".to_string());
    }

    // Demo-clean defaults: kill MCP discovery and slash commands so chat runs
    // are reproducible across machines and never surface unrelated tools
    // mid-demo. We can't use --bare on OAuth (it requires ANTHROPIC_API_KEY),
    // so we mimic the parts of its effect we can with explicit flags.
    //
    // Skipped when the caller (e.g. delegate) provides its own --mcp-config
    // in extra_args — delegate intentionally loads the contract-ide MCP for
    // tool-grounded execution. Detection is conservative: any presence of
    // --mcp-config OR --strict-mcp-config in extras opts the caller out.
    //
    // Note: we used to also pass `--setting-sources project` to skip user-
    // level skills/agents, but it caused the run to hang at startup on some
    // configs (suspect: needed user settings for keychain/auth resolution).
    // Reverted — user-level skills are still cosmetically present but the
    // MCP zero-out + disable-slash-commands cover the demo-relevant surface.
    let caller_handles_mcp = extra_args
        .iter()
        .any(|a| a == "--mcp-config" || a == "--strict-mcp-config");
    if !caller_handles_mcp {
        claude_args.push("--strict-mcp-config".to_string());
        claude_args.push("--mcp-config".to_string());
        claude_args.push(r#"{"mcpServers":{}}"#.to_string());
        claude_args.push("--disable-slash-commands".to_string());
    }

    if let Some(ref sid) = resume_session_id {
        claude_args.push("--resume".to_string());
        claude_args.push(sid.clone());
    }
    // Caller-provided extras (e.g. delegate_execute passes lean-mode flags +
    // a focused mcp-config that loads only the contract-ide MCP server,
    // skipping Chrome/Firebase/Scholar/etc to cut startup latency).
    claude_args.extend(extra_args);
    eprintln!(
        "[run_agent] spawning: claude {} (cwd={})",
        claude_args
            .iter()
            .map(|a| if a.contains(' ') || a.contains('"') {
                format!("{a:?}")
            } else {
                a.clone()
            })
            .collect::<Vec<_>>()
            .join(" "),
        repo_path.display()
    );
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
    let substrate_rules_json2 = substrate_rules_json.clone();

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
                            substrate_rules_json2.as_deref(), // Phase 15: TRUST-03
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

                    // Emit agent:complete. session_id is included so the frontend
                    // can pass it as resume_session_id on the next turn — enables
                    // multi-turn chat continuity via claude --resume.
                    let _ = app2.emit(
                        "agent:complete",
                        serde_json::json!({
                            "tracking_id": tracking_id2,
                            "code": payload.code,
                            "wall_time_ms": wall_time_ms,
                            "session_id": session_id,
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

/// Send SIGTERM to a running agent's claude process. The Terminated event
/// will fire shortly after, draining the rest of the agent:complete pipeline
/// (parse_and_persist, receipt:created emission). Frontend optimistically
/// marks the run 'stopped' before this returns so the UI doesn't lag.
///
/// Returns Ok(true) if a child was found and kill signaled, Ok(false) if the
/// run had already completed or wasn't tracked.
#[tauri::command]
pub async fn stop_agent(app: tauri::AppHandle, tracking_id: String) -> Result<bool, String> {
    let state = app.state::<AgentRuns>();
    let mut map = state.0.lock().await;
    if let Some(child) = map.remove(&tracking_id) {
        // CommandChild::kill consumes the handle.
        if let Err(e) = child.kill() {
            // Already exited, or kill signal failed — non-fatal; the
            // Terminated branch in the drain task will still cleanup.
            eprintln!("[stop_agent] kill {tracking_id} returned {e}");
            return Ok(false);
        }
        eprintln!("[stop_agent] killed tracking_id={tracking_id}");
        Ok(true)
    } else {
        Ok(false)
    }
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
