//! Phase 5 MCP sidecar lifecycle: spawn the compiled mcp-server binary at
//! startup, keep the CommandChild alive in Tauri managed state (dropping it
//! would kill the process — Pitfall 3 in 05-RESEARCH.md), forward stderr lines
//! into a `mcp:status` Tauri event so the UI health pill can render liveness.
//!
//! Single-writer invariant (MCP-03): the sidecar opens SQLite read-only.
//! Plan 05-02 wires the real tool handlers; Plan 05-01 ships the launch
//! plumbing with stub tools so the end-to-end path is proven before the
//! SQL surface lands.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Tauri managed state holding the sidecar's CommandChild. Keeping the child
/// here prevents immediate drop-kill after `setup()` returns.
#[derive(Default)]
pub struct McpSidecarHandle(pub Mutex<Option<CommandChild>>);

/// Spawn the MCP sidecar binary. Called from `setup()` AFTER plugins are
/// registered. Silently logs failures instead of panicking — the app should
/// still boot without the MCP server (Phase 4 inspector will expose the
/// `unknown`/`stopped` status through McpStatusIndicator).
pub fn launch_mcp_sidecar(app: AppHandle) {
    // Resolve the DB path so the sidecar's future SQLite reads hit the same
    // file as tauri-plugin-sql. `app_data_dir()` is the authoritative source
    // (Pitfall 5 — hardcoded paths drift between machines / platforms).
    let db_path = match app.path().app_data_dir() {
        Ok(p) => p.join("contract-ide.db"),
        Err(e) => {
            eprintln!("[mcp-sidecar] cannot resolve app_data_dir: {e}");
            let _ = app.emit(
                "mcp:status",
                serde_json::json!({ "status": "stopped", "reason": "no-app-dir" }),
            );
            return;
        }
    };

    // Sidecar spawn. If this fails (e.g. binary missing because `npm run build`
    // was not run), emit a stopped event rather than crashing the app.
    let sidecar = match app.shell().sidecar("mcp-server") {
        Ok(cmd) => cmd,
        Err(e) => {
            eprintln!("[mcp-sidecar] sidecar('mcp-server') failed: {e}");
            let _ = app.emit(
                "mcp:status",
                serde_json::json!({ "status": "stopped", "reason": "not-found" }),
            );
            return;
        }
    };

    // Resolve the section-parser-cli binary path so the MCP TypeScript sidecar
    // can invoke it via execFileSync(process.env.SECTION_PARSER_CLI_PATH, ...).
    // Plan 08-01 registered the binary in tauri.conf.json externalBin as
    // "binaries/section-parser-cli"; Tauri places it at:
    //   <resource_dir>/binaries/section-parser-cli-<triple>
    // The triple is detected at runtime from CARGO_CFG_TARGET_ARCH / consts.
    //
    // NOTE: Tauri sidecar name convention appends the target triple using
    // ARCH-apple-darwin (macOS). The exact triple string must match what Tauri
    // uses for the externalBin entry. On Apple Silicon that is "aarch64-apple-darwin".
    let section_parser_cli_path = app
        .path()
        .resource_dir()
        .ok()
        .map(|d| {
            let triple = format!(
                "{}-apple-{}",
                std::env::consts::ARCH, // "aarch64"
                "darwin"                // macOS platform suffix Tauri uses
            );
            d.join("binaries")
                .join(format!("section-parser-cli-{triple}"))
        });

    let mut sidecar =
        sidecar.env("CONTRACT_IDE_DB_PATH", db_path.to_string_lossy().as_ref());

    if let Some(cli_path) = &section_parser_cli_path {
        sidecar = sidecar.env("SECTION_PARSER_CLI_PATH", cli_path.to_string_lossy().as_ref());
    }

    // Thread the currently-open repo path into the sidecar so `update_contract`
    // can locate `.contracts/<uuid>.md`. Plan 02-02 stored the repo path in
    // managed state as the newtype `commands::repo::RepoState` wrapping
    // `Mutex<Option<PathBuf>>`. Tauri's `try_state::<T>()` matches on the
    // EXACT registered type — looking up the bare `Mutex<Option<PathBuf>>`
    // returns None — so we must ask for `RepoState` and reach into `.0` for
    // the inner Mutex.
    //
    // TODO(Phase 8): On open_repo / repo-switch, restart the sidecar with the
    // new CONTRACT_IDE_REPO_PATH, OR add a `set_repo_path` management tool
    // to the MCP server that mutates an in-memory variable. For Phase 5 the
    // sidecar is spawned once at app start with whatever repo was open at
    // that moment (typically None on first launch); the UAT in Plan 05-02
    // Task 3 uses a stand-alone `.mcp.json` that supplies the repo path
    // directly, sidestepping this deferral.
    let repo_path_opt: Option<String> = app
        .try_state::<crate::commands::repo::RepoState>()
        .and_then(|state| {
            state
                .0
                .lock()
                .ok()
                .and_then(|guard| guard.as_ref().map(|p| p.to_string_lossy().into_owned()))
        });
    if let Some(rp) = repo_path_opt.as_deref() {
        sidecar = sidecar.env("CONTRACT_IDE_REPO_PATH", rp);
    }

    let (mut rx, child) = match sidecar.spawn() {
        Ok(pair) => pair,
        Err(e) => {
            eprintln!("[mcp-sidecar] spawn failed: {e}");
            let _ = app.emit(
                "mcp:status",
                serde_json::json!({ "status": "stopped", "reason": "spawn-failed" }),
            );
            return;
        }
    };

    // CRITICAL (Pitfall 3): store the CommandChild in managed state BEFORE
    // returning; dropping it would kill the process. `McpSidecarHandle::default()`
    // is registered in `.manage()` BEFORE `run()` is called (see lib.rs).
    if let Some(state) = app.try_state::<McpSidecarHandle>() {
        *state.0.lock().unwrap() = Some(child);
    } else {
        eprintln!("[mcp-sidecar] McpSidecarHandle managed state not registered");
    }

    // Forward stderr lines into a mcp:status event. The sidecar emits
    // `[mcp-server] ready` on stderr once StdioServerTransport is live.
    let app_for_loop = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stderr(bytes) => {
                    let msg = String::from_utf8_lossy(&bytes);
                    if msg.contains("[mcp-server] ready") {
                        let _ = app_for_loop.emit(
                            "mcp:status",
                            serde_json::json!({ "status": "running" }),
                        );
                    }
                    eprintln!("[mcp-sidecar] {}", msg.trim_end());
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[mcp-sidecar] terminated: {payload:?}");
                    let _ = app_for_loop.emit(
                        "mcp:status",
                        serde_json::json!({ "status": "stopped" }),
                    );
                }
                CommandEvent::Error(e) => {
                    eprintln!("[mcp-sidecar] error: {e}");
                }
                _ => {}
            }
        }
    });
}

/// Frontend-queryable status. Returns the current CommandChild presence as a
/// coarse liveness hint; the `mcp:status` event stream is the source of truth.
#[tauri::command]
pub fn get_mcp_status(state: tauri::State<'_, McpSidecarHandle>) -> Result<String, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    Ok(if guard.is_some() {
        "running".to_string()
    } else {
        "unknown".to_string()
    })
}
