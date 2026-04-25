// Integration tests for .claude/hooks/post-tool-use.sh.
// Tests shell out to bash and assert the hook's behavior under controlled env:
//   - CONTRACT_IDE_DB_PATH points at a temp sqlite file (or /dev/null).
//   - PATH is prepended with a fixtures dir containing mock-claude.
//   - MOCK_CLAUDE_LOG records each spawned subprocess invocation.
//
// Requires bash, jq, and sqlite3 in PATH (macOS dev box ships all three; CI
// assumption documented in plan).

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;
use tempfile::TempDir;

fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn hook_path() -> PathBuf {
    project_root()
        .parent()
        .unwrap()
        .join(".claude/hooks/post-tool-use.sh")
}

fn mock_claude_dir() -> PathBuf {
    project_root().join("tests/fixtures")
}

/// Build a payload JSON string from the fixture template with placeholders
/// substituted. transcript_path may be empty; file_path is rendered absolute.
fn make_payload(
    cwd: &Path,
    file_rel: &str,
    transcript_path: &str,
    tool: &str,
    session_id: &str,
) -> String {
    let abs_file = cwd.join(file_rel);
    format!(
        r#"{{
  "session_id": "{session}",
  "transcript_path": "{transcript}",
  "cwd": "{cwd}",
  "hook_event_name": "PostToolUse",
  "tool_name": "{tool}",
  "tool_input": {{"file_path": "{file}", "content": "x"}},
  "tool_response": {{"success": true}}
}}"#,
        session = session_id,
        transcript = transcript_path,
        cwd = cwd.display(),
        tool = tool,
        file = abs_file.display(),
    )
}

/// Run the hook with the given payload + env. Returns (status, stdout, stderr,
/// elapsed_ms). MOCK_CLAUDE_LOG is set so we can count spawns; PATH is shimmed.
/// The `shim_holder` keeps the shim dir alive past run_hook's return so
/// backgrounded subshells can still exec it after the hook parent exits.
fn run_hook(
    payload: &str,
    cwd: &Path,
    db_path: &str,
    mock_claude_log: Option<&Path>,
    mock_claude_sleep: Option<&str>,
    shim_holder: &Path,
) -> (i32, String, String, u128) {
    let mut path = std::env::var("PATH").unwrap_or_default();

    // The hook expects the binary to be named `claude`, but we ship
    // `mock-claude.sh`. Write a `claude` shim into shim_holder (caller-owned
    // tempdir, lives past the hook process so backgrounded execs still work).
    if mock_claude_log.is_some() {
        let claude_shim = shim_holder.join("claude");
        fs::write(
            &claude_shim,
            format!(
                "#!/bin/bash\nexec {} \"$@\"\n",
                mock_claude_dir().join("mock-claude.sh").display()
            ),
        )
        .expect("write claude shim");
        let mut perms = fs::metadata(&claude_shim).unwrap().permissions();
        use std::os::unix::fs::PermissionsExt;
        perms.set_mode(0o755);
        fs::set_permissions(&claude_shim, perms).unwrap();
        path = format!("{}:{}", shim_holder.display(), path);
    }

    let mut cmd = Command::new("bash");
    cmd.arg(hook_path())
        .current_dir(cwd)
        .env("PATH", &path)
        .env("CONTRACT_IDE_DB_PATH", db_path);

    if let Some(log) = mock_claude_log {
        cmd.env("MOCK_CLAUDE_LOG", log);
    }
    if let Some(sleep) = mock_claude_sleep {
        cmd.env("MOCK_CLAUDE_SLEEP", sleep);
    }

    let start = Instant::now();
    let output = cmd
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("spawn hook");

    {
        use std::io::Write;
        let mut stdin = output.stdin.as_ref().unwrap();
        stdin.write_all(payload.as_bytes()).expect("write stdin");
    }

    let result = output.wait_with_output().expect("wait hook");
    let elapsed_ms = start.elapsed().as_millis();
    (
        result.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&result.stdout).to_string(),
        String::from_utf8_lossy(&result.stderr).to_string(),
        elapsed_ms,
    )
}

fn read_journal_lines(cwd: &Path, session_id: &str) -> Vec<serde_json::Value> {
    let path = cwd.join(format!(".contracts/journal/{session_id}.jsonl"));
    if !path.exists() {
        return Vec::new();
    }
    fs::read_to_string(&path)
        .expect("read journal")
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str::<serde_json::Value>(l).expect("valid json line"))
        .collect()
}

/// Seed a sqlite DB at db_path with the v3 nodes schema and N nodes whose
/// code_ranges include the given file_rel.
fn seed_db_with_nodes(db_path: &Path, uuids: &[&str], file_rel: &str) {
    let create_sql = r#"
CREATE TABLE nodes (
    uuid TEXT PRIMARY KEY,
    level TEXT NOT NULL,
    name TEXT NOT NULL,
    file_path TEXT,
    parent_uuid TEXT,
    is_canonical INTEGER NOT NULL DEFAULT 1,
    canonical_uuid TEXT,
    code_hash TEXT,
    contract_hash TEXT,
    human_pinned INTEGER NOT NULL DEFAULT 0,
    route TEXT,
    derived_at TEXT,
    contract_body TEXT,
    tags TEXT,
    code_ranges TEXT,
    kind TEXT NOT NULL DEFAULT 'unknown',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"#;
    let status = Command::new("sqlite3")
        .arg(db_path)
        .arg(create_sql)
        .status()
        .expect("sqlite3 create");
    assert!(status.success(), "sqlite3 schema create failed");

    for uuid in uuids {
        let ranges = format!(
            r#"[{{"file":"{}","start_line":1,"end_line":50}}]"#,
            file_rel
        );
        let insert = format!(
            "INSERT INTO nodes (uuid, level, name, code_ranges) VALUES ('{}', 'L3', 'test-{}', '{}');",
            uuid, uuid, ranges
        );
        let status = Command::new("sqlite3")
            .arg(db_path)
            .arg(&insert)
            .status()
            .expect("sqlite3 insert");
        assert!(status.success(), "sqlite3 insert failed for {uuid}");
    }
}

// -------- TESTS --------

#[test]
fn hook_writes_journal_entry_with_correct_shape() {
    let tmp = TempDir::new().unwrap();
    let cwd = tmp.path();
    let session = "session-shape-001";
    let payload = make_payload(cwd, "src/sample.ts", "", "Write", session);

    let (status, stdout, _stderr, _elapsed) =
        run_hook(&payload, cwd, "/dev/null", None, None, cwd);
    assert_eq!(status, 0, "hook exited non-zero");
    assert!(stdout.is_empty(), "hook should be silent on stdout");

    let lines = read_journal_lines(cwd, session);
    assert_eq!(lines.len(), 1, "exactly one journal line expected");
    let entry = &lines[0];
    assert_eq!(entry["schema_version"], 1);
    assert_eq!(entry["session_id"], session);
    assert_eq!(entry["tool"], "Write");
    assert_eq!(entry["file"], "src/sample.ts");
    assert!(entry["affected_uuids"].is_array());
    assert_eq!(entry["affected_uuids"].as_array().unwrap().len(), 0);
    assert!(entry["intent"].is_string());
    let ts = entry["ts"].as_str().unwrap();
    assert!(ts.ends_with('Z'), "ts must be ISO-8601 UTC");
}

#[test]
fn hook_creates_journal_dir_if_missing() {
    let tmp = TempDir::new().unwrap();
    let cwd = tmp.path();
    let journal_dir = cwd.join(".contracts/journal");
    assert!(!journal_dir.exists(), "preconditon: journal dir absent");

    let payload = make_payload(cwd, "src/x.ts", "", "Edit", "sess-mkdir");
    let (status, _stdout, _stderr, _) = run_hook(&payload, cwd, "/dev/null", None, None, cwd);
    assert_eq!(status, 0);
    assert!(journal_dir.exists(), "journal dir was not created");
}

#[test]
fn hook_falls_back_to_headless_intent_for_no_user_prompt() {
    let tmp = TempDir::new().unwrap();
    let cwd = tmp.path();
    let transcript = cwd.join("transcript.jsonl");
    // Assistant-only transcript, no user message.
    fs::write(
        &transcript,
        r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hello"}]}}
"#,
    )
    .unwrap();

    let session = "sess-headless";
    let payload = make_payload(
        cwd,
        "src/y.ts",
        transcript.to_str().unwrap(),
        "Write",
        session,
    );
    let (status, _stdout, _stderr, _) = run_hook(&payload, cwd, "/dev/null", None, None, cwd);
    assert_eq!(status, 0);

    let lines = read_journal_lines(cwd, session);
    assert_eq!(lines.len(), 1);
    let intent = lines[0]["intent"].as_str().unwrap();
    assert!(
        intent.starts_with("(headless: Write on "),
        "expected headless fallback, got: {intent}"
    );
}

#[test]
fn hook_extracts_intent_from_transcript_user_prompt() {
    let tmp = TempDir::new().unwrap();
    let cwd = tmp.path();
    let transcript = cwd.join("transcript.jsonl");
    fs::write(
        &transcript,
        r#"{"type":"user","message":{"role":"user","content":"Make the button blue"}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"OK"}]}}
"#,
    )
    .unwrap();

    let session = "sess-intent";
    let payload = make_payload(
        cwd,
        "src/btn.ts",
        transcript.to_str().unwrap(),
        "Edit",
        session,
    );
    let (status, _, _, _) = run_hook(&payload, cwd, "/dev/null", None, None, cwd);
    assert_eq!(status, 0);
    let lines = read_journal_lines(cwd, session);
    assert_eq!(lines[0]["intent"], "Make the button blue");
}

#[test]
fn hook_skips_writes_outside_cwd() {
    let tmp = TempDir::new().unwrap();
    let cwd = tmp.path();
    let outside = TempDir::new().unwrap();
    let session = "sess-outside";
    let payload = format!(
        r#"{{
  "session_id": "{session}",
  "transcript_path": "",
  "cwd": "{cwd}",
  "tool_name": "Write",
  "tool_input": {{"file_path": "{outside}/escape.ts", "content": "x"}}
}}"#,
        session = session,
        cwd = cwd.display(),
        outside = outside.path().display(),
    );
    let (status, _, _, _) = run_hook(&payload, cwd, "/dev/null", None, None, cwd);
    assert_eq!(status, 0);
    let path = cwd.join(format!(".contracts/journal/{session}.jsonl"));
    assert!(!path.exists(), "no journal entry should be written");
}

#[test]
fn hook_exits_zero_on_missing_db() {
    let tmp = TempDir::new().unwrap();
    let cwd = tmp.path();
    let session = "sess-nodb";
    let mock_log = tmp.path().join("claude.log");
    let payload = make_payload(cwd, "src/z.ts", "", "Write", session);

    let (status, _, _, _) = run_hook(
        &payload,
        cwd,
        "/nonexistent/contract-ide.db",
        Some(&mock_log),
        None,
        cwd,
    );
    assert_eq!(status, 0);
    let lines = read_journal_lines(cwd, session);
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0]["affected_uuids"].as_array().unwrap().len(), 0);
    assert!(
        !mock_log.exists() || fs::read_to_string(&mock_log).unwrap().is_empty(),
        "no rederive spawn expected when DB is missing"
    );
}

#[test]
fn hook_spawns_rederive_per_affected_uuid() {
    let tmp = TempDir::new().unwrap();
    let cwd = tmp.path();
    let db = tmp.path().join("contract-ide.db");
    let file_rel = "src/component.ts";

    let uuids = ["aaaa-1111", "bbbb-2222"];
    seed_db_with_nodes(&db, &uuids, file_rel);

    let mock_log = tmp.path().join("claude.log");
    let session = "sess-spawn";
    let payload = make_payload(cwd, file_rel, "", "Write", session);

    let (status, _, _, _) = run_hook(
        &payload,
        cwd,
        db.to_str().unwrap(),
        Some(&mock_log),
        None,
        cwd,
    );
    assert_eq!(status, 0);

    let lines = read_journal_lines(cwd, session);
    assert_eq!(lines.len(), 1);
    let arr = lines[0]["affected_uuids"].as_array().unwrap();
    assert_eq!(arr.len(), 2, "two affected UUIDs expected");

    // Wait briefly for the backgrounded mock-claude invocations to record.
    // Each invocation is fire-and-forget so we may need a few hundred ms.
    let log_invocations = wait_for_log_lines(&mock_log, 2, 3000);
    assert_eq!(
        log_invocations, 2,
        "mock-claude should be invoked once per affected UUID"
    );

    let log_contents = fs::read_to_string(&mock_log).unwrap();
    assert!(
        log_contents.contains("update_contract"),
        "claude prompt should mention update_contract: got\n{log_contents}"
    );
}

#[test]
fn hook_rederive_spawn_is_backgrounded_not_blocking() {
    let tmp = TempDir::new().unwrap();
    let cwd = tmp.path();
    let db = tmp.path().join("contract-ide.db");
    let file_rel = "src/slow.ts";
    let uuids = ["uuid-a", "uuid-b", "uuid-c"];
    seed_db_with_nodes(&db, &uuids, file_rel);

    let mock_log = tmp.path().join("claude.log");
    let session = "sess-bg";
    let payload = make_payload(cwd, file_rel, "", "Write", session);

    // Mock-claude sleeps 5 seconds. If the hook waits, total > 5000ms; if
    // backgrounded properly, well under 1500ms.
    let (status, _, _, elapsed) = run_hook(
        &payload,
        cwd,
        db.to_str().unwrap(),
        Some(&mock_log),
        Some("5"),
        cwd,
    );
    assert_eq!(status, 0);
    assert!(
        elapsed < 1500,
        "hook should be backgrounded: ran for {elapsed}ms (mock-claude sleeps 5s × 3)"
    );
}

fn wait_for_log_lines(path: &Path, target: usize, timeout_ms: u64) -> usize {
    let deadline = Instant::now() + std::time::Duration::from_millis(timeout_ms);
    loop {
        let count = fs::read_to_string(path)
            .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count())
            .unwrap_or(0);
        if count >= target {
            return count;
        }
        if Instant::now() >= deadline {
            return count;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}
