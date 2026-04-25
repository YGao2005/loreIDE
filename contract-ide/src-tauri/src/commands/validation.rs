// Day-1 integration validation commands (Plan 01-04).
//
// These are DEV-TIME commands that prove the three Phase 1 integration seams
// work INSIDE the Tauri app (not just in a bare terminal or standalone cargo
// project). ROADMAP Phase 1 success criterion 6 requires all three green
// before Phase 2 starts.
//
// They are registered in lib.rs `invoke_handler!` but the frontend only calls
// them from the dev-only `<Day1Validation>` panel (gated on `import.meta.env.DEV`).
//
// Phase 2 is expected to delete or move this file once the integration seams
// are exercised organically by real code paths.

use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Serialize)]
pub struct SpawnResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

/// Phase 1 integration check (a): spawn `claude -p "say hello"` via
/// tauri-plugin-shell.
///
/// Default environment inheritance must carry `HOME` through so the `claude`
/// CLI can locate `~/.claude` auth. MUST be validated both from
/// `npm run tauri dev` (terminal launch) AND a Finder-launched `.app` bundle
/// — macOS launch environments differ (RESEARCH.md Pitfall 4).
#[tauri::command]
pub async fn test_claude_spawn(app: tauri::AppHandle) -> Result<SpawnResult, String> {
    let output = app
        .shell()
        .command("claude")
        .args(["-p", "say hello"])
        .output()
        .await
        .map_err(|e| format!("spawn failed: {e}"))?;

    Ok(SpawnResult {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code(),
    })
}

/// Phase 1 integration check (b): read the day0-captured PostToolUse hook
/// payload fixture AND prove a referenced JSONL transcript containing
/// `input_tokens` exists somewhere under `~/.claude/projects/`.
///
/// Per checker feedback, an absent JSONL must HARD-FAIL — no silent ✓.
///
/// Strategy: search `~/.claude/projects/*/*.jsonl` for any file whose basename
/// matches the fixture's `transcript_path` basename; require at least one
/// match to contain `"input_tokens"`. This survives the case where the
/// original absolute transcript_path no longer exists on a given machine
/// (e.g. after a `~/.claude` cleanup) while still proving the JSONL-side
/// contract required by ROADMAP Phase 1 success criterion 6(b).
#[tauri::command]
pub async fn test_hook_payload_fixture() -> Result<serde_json::Value, String> {
    // day0 fixture lives at a stable absolute path — dev-time validation only, never ships.
    let captures = PathBuf::from("/Users/yang/lahacks/day0/check2-hook-payload/captures");
    let entries = std::fs::read_dir(&captures)
        .map_err(|e| format!("read_dir {captures:?}: {e}"))?;
    let first = entries
        .flatten()
        .find(|e| e.path().extension().is_some_and(|x| x == "json"))
        .ok_or_else(|| "no .json fixture in day0/check2-hook-payload/captures".to_string())?;
    let fixture_path = first.path();
    let text = std::fs::read_to_string(&fixture_path)
        .map_err(|e| format!("read fixture {fixture_path:?}: {e}"))?;
    let v: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("parse fixture JSON: {e}"))?;

    // Assert expected shape per RESEARCH.md Code Examples § PostToolUse Hook Payload.
    for key in [
        "session_id",
        "transcript_path",
        "hook_event_name",
        "tool_name",
        "tool_input",
    ] {
        if v.get(key).is_none() {
            return Err(format!("Check B FAIL: fixture missing required key `{key}`"));
        }
    }

    // Hard requirement per ROADMAP 6(b): the referenced JSONL must exist
    // somewhere and include `input_tokens`. We accept either the fixture's
    // exact absolute path OR any JSONL under `~/.claude/projects/*/` with the
    // same basename (dev machines move).
    let transcript_path = v
        .get("transcript_path")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "Check B FAIL: transcript_path is not a string".to_string())?;

    let basename = Path::new(transcript_path)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| {
            format!("Check B FAIL: cannot extract basename from transcript_path `{transcript_path}`")
        })?;

    // Candidate list: start with the literal path, then walk `~/.claude/projects/*/*.jsonl`.
    let mut candidates: Vec<PathBuf> = Vec::new();
    if Path::new(transcript_path).exists() {
        candidates.push(PathBuf::from(transcript_path));
    }
    let home = std::env::var("HOME").map_err(|e| format!("Check B FAIL: HOME not set: {e}"))?;
    let projects_root = PathBuf::from(&home).join(".claude/projects");
    if projects_root.exists() {
        if let Ok(project_dirs) = std::fs::read_dir(&projects_root) {
            for proj in project_dirs.flatten() {
                let p = proj.path();
                if !p.is_dir() {
                    continue;
                }
                if let Ok(files) = std::fs::read_dir(&p) {
                    for f in files.flatten() {
                        let fp = f.path();
                        if fp.file_name().and_then(|n| n.to_str()) == Some(basename) {
                            candidates.push(fp);
                        }
                    }
                }
            }
        }
    }

    if candidates.is_empty() {
        return Err(format!(
            "Check B FAIL: no JSONL transcript named `{basename}` found at `{transcript_path}` or under `~/.claude/projects/*/` — cannot prove usage.input_tokens per ROADMAP Phase 1 criterion 6(b)"
        ));
    }

    let mut matched: Option<PathBuf> = None;
    for cand in &candidates {
        let body = std::fs::read_to_string(cand).unwrap_or_default();
        if body.contains("input_tokens") {
            matched = Some(cand.clone());
            break;
        }
    }

    let matched_path = matched.ok_or_else(|| {
        format!(
            "Check B FAIL: found {} JSONL candidate(s) for `{basename}` but NONE contained `input_tokens` — ROADMAP 6(b) requires the referenced transcript to include usage.input_tokens",
            candidates.len()
        )
    })?;

    // Attach the resolved transcript path to the returned payload so the UI
    // can display exactly which JSONL satisfied the check.
    let mut out = v;
    if let Some(obj) = out.as_object_mut() {
        obj.insert(
            "_resolved_transcript_path".to_string(),
            serde_json::Value::String(matched_path.to_string_lossy().into_owned()),
        );
        obj.insert(
            "_fixture_path".to_string(),
            serde_json::Value::String(fixture_path.to_string_lossy().into_owned()),
        );
    }
    Ok(out)
}

/// Phase 1 integration check (c): run the day0/check3-pkg-sqlite binary and
/// confirm exit 0.
///
/// Hard-coded to `/Users/yang/lahacks/day0/check3-pkg-sqlite/bin/day0-sqlite`
/// (the verified on-disk 59 MB Mach-O arm64). If missing, rebuild via:
///     cd day0/check3-pkg-sqlite && npm install && npx pkg . --out-path bin
#[tauri::command]
pub async fn test_pkg_sqlite_binary(app: tauri::AppHandle) -> Result<SpawnResult, String> {
    let bin = "/Users/yang/lahacks/day0/check3-pkg-sqlite/bin/day0-sqlite";

    if !Path::new(bin).exists() {
        return Err(format!(
            "Check C FAIL: binary not found at `{bin}` — rebuild via `cd day0/check3-pkg-sqlite && npm install && npx pkg . --out-path bin` (see day0/FINDINGS.md Check 3)"
        ));
    }

    let output = app
        .shell()
        .command(bin)
        .output()
        .await
        .map_err(|e| format!("Check C FAIL: spawn failed: {e}"))?;

    Ok(SpawnResult {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code(),
    })
}
