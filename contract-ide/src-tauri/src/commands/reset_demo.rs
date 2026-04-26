// Demo reset hotkey backend. Invokes the existing
// `contract-ide/demo/reset-demo.sh` script via bash. Pure stagecraft tool —
// the script kills the running app, restores the SQLite seed, and relaunches
// the production bundle (or `tauri dev`). Because the script kills *this*
// process via `pkill -f contract-ide`, the JS `invoke()` may never see the
// success result — the spawn itself has to be reported as success before
// pkill fires. We therefore:
//
//   1. Resolve the script path (CARGO_MANIFEST_DIR/../demo/reset-demo.sh
//      compiled-in baseline; HOME/lahacks/contract-ide/demo/reset-demo.sh
//      runtime fallback for relocated bundles).
//   2. Spawn `bash <script>` detached (so it survives our death) and capture
//      a brief startup window (~250ms) of stderr to surface obvious errors
//      like "script not found" before the kill cascade lands.
//   3. Return Ok(()) on successful spawn. The frontend toast should treat
//      "no completion event" as success-by-relaunch.
//
// Logged to stdout for a `tail -f` debugging pass during stage rehearsals.

use std::path::PathBuf;
use std::process::{Command, Stdio};

fn resolve_script_path() -> Result<PathBuf, String> {
    // Compile-time baseline: src-tauri/../demo/reset-demo.sh
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let baked = manifest
        .parent()
        .map(|p| p.join("demo").join("reset-demo.sh"));
    if let Some(p) = baked.as_ref() {
        if p.is_file() {
            return Ok(p.clone());
        }
    }
    // Runtime fallback: $HOME/lahacks/contract-ide/demo/reset-demo.sh
    if let Ok(home) = std::env::var("HOME") {
        let runtime = PathBuf::from(home)
            .join("lahacks")
            .join("contract-ide")
            .join("demo")
            .join("reset-demo.sh");
        if runtime.is_file() {
            return Ok(runtime);
        }
    }
    Err(format!(
        "reset-demo.sh not found (looked at {:?} and $HOME/lahacks/contract-ide/demo/reset-demo.sh)",
        baked
    ))
}

#[tauri::command]
pub fn reset_demo_state() -> Result<(), String> {
    let script = resolve_script_path()?;
    println!("[reset_demo_state] invoking: {}", script.display());

    // Detach: stdout/stderr inherited to parent terminal so the operator
    // (running `npm run tauri dev` from a terminal) sees [reset] progress
    // lines. The script's `pkill -f contract-ide` will kill this process
    // before the child finishes; that's expected and not a failure.
    let child = Command::new("bash")
        .arg(&script)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("failed to spawn reset-demo.sh: {e}"))?;

    println!(
        "[reset_demo_state] spawned reset-demo.sh as pid {} — process will be killed by script's pkill cascade",
        child.id()
    );
    // Intentionally don't .wait() — the script will SIGTERM us before it
    // finishes. Returning Ok here is the correct contract.
    Ok(())
}
