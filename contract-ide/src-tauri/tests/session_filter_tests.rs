//! Phase 10 SC2 regression tests against the two kernel-experiment session
//! JSONLs. Tests skip gracefully if the source files are not present on the
//! test runner — they live under `~/.claude/projects/-Users-yang-lahacks/`
//! which is user-local, not in the repo.
//!
//! Strategy: content-preservation assertion. We re-derive the expected user +
//! assistant text set from the raw JSONL using the same filter rules and
//! compare against `filter_session_lines` output. Byte-equivalence proves
//! "zero loss of conversational content" (SC2). Size check proves the 95%+
//! reduction (SC2 size target).
//!
//! Why content-preservation rather than snapshot-from-fixture:
//! The two `extracted-*.json` artifacts in the kernel-experiment capture
//! constraint extractions (LLM output), NOT filtered text. A snapshot-from-self
//! strategy would give zero signal (filter bug → snapshot updates → still
//! "passes"). The content-preservation assertion is intrinsically defined by
//! the filter rules, so it CAN'T catch a wrong rule, but it WILL catch a
//! regression — and the rule itself was validated in the kernel experiment
//! (extracted-*.json files prove the filter LLM extracts useful constraints).
//! Phase 11's distiller will be the consumer-level validation surface.

use contract_ide_lib::session::ingestor::filter_session_lines;
use std::path::PathBuf;

fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .expect("HOME must be set")
}

fn fixture_path(session_id: &str) -> PathBuf {
    home_dir()
        .join(".claude/projects/-Users-yang-lahacks")
        .join(format!("{session_id}.jsonl"))
}

fn skip_if_missing(p: &PathBuf, name: &str) -> bool {
    if !p.exists() {
        eprintln!("[skip] {name}: fixture not present at {p:?}");
        true
    } else {
        false
    }
}

/// Re-derive the expected filtered text set directly from the raw JSONL using
/// the same filter rules. Returns (user_texts, assistant_texts).
fn redev_expected_texts(path: &PathBuf) -> (Vec<String>, Vec<String>) {
    use std::io::BufRead;
    let f = std::fs::File::open(path).expect("open fixture");
    let mut user = Vec::new();
    let mut asst = Vec::new();
    for line in std::io::BufReader::new(f).lines() {
        let Ok(line) = line else { continue };
        let Ok(obj) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        let ty = obj.get("type").and_then(|t| t.as_str()).unwrap_or("");
        if ty == "user" {
            if obj
                .get("isMeta")
                .and_then(|m| m.as_bool())
                .unwrap_or(false)
            {
                continue;
            }
            let content = obj.get("message").and_then(|m| m.get("content"));
            match content {
                Some(serde_json::Value::String(s)) if !s.starts_with('<') => {
                    user.push(s.clone());
                }
                Some(serde_json::Value::Array(items)) => {
                    for item in items {
                        if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                            if let Some(t) = item.get("text").and_then(|t| t.as_str()) {
                                user.push(t.into());
                            }
                        }
                    }
                }
                _ => {}
            }
        } else if ty == "assistant" {
            if let Some(serde_json::Value::Array(items)) =
                obj.get("message").and_then(|m| m.get("content"))
            {
                for item in items {
                    if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                        if let Some(t) = item.get("text").and_then(|t| t.as_str()) {
                            asst.push(t.into());
                        }
                    }
                }
            }
        }
    }
    (user, asst)
}

#[test]
fn filter_5f44_preserves_all_user_assistant_text_under_50kb() {
    let path = fixture_path("5f44f5af-7a03-4baf-ac3c-d01ce89aba67");
    if skip_if_missing(&path, "5f44 fixture") {
        return;
    }

    let turns = filter_session_lines(&path, 0).expect("filter must not fail on real fixture");

    let (expected_user, expected_asst) = redev_expected_texts(&path);

    // SC2 byte-size: filtered text under 50KB
    let total_chars: usize = turns.iter().map(|t| t.text.len()).sum();
    assert!(
        total_chars < 50_000,
        "5f44 filtered text size = {total_chars} bytes, expected < 50_000"
    );

    // Smoke: at least 1 user + 1 assistant
    assert!(
        turns.iter().any(|t| t.role == "user"),
        "5f44 has no user turns"
    );
    assert!(
        turns.iter().any(|t| t.role == "assistant"),
        "5f44 has no assistant turns"
    );

    // Zero loss: every expected user/assistant text appears in the filter output
    let actual_user: std::collections::HashSet<&str> = turns
        .iter()
        .filter(|t| t.role == "user")
        .map(|t| t.text.as_str())
        .collect();
    let actual_asst: std::collections::HashSet<&str> = turns
        .iter()
        .filter(|t| t.role == "assistant")
        .map(|t| t.text.as_str())
        .collect();

    for u in &expected_user {
        assert!(
            actual_user.contains(u.as_str()),
            "5f44 user text missing: {:?}",
            &u[..u.len().min(60)]
        );
    }
    for a in &expected_asst {
        assert!(
            actual_asst.contains(a.as_str()),
            "5f44 assistant text missing: {:?}",
            &a[..a.len().min(60)]
        );
    }

    eprintln!(
        "[ok] 5f44: {} turns ({} user, {} assistant), {} chars filtered",
        turns.len(),
        actual_user.len(),
        actual_asst.len(),
        total_chars
    );
}

#[test]
fn filter_efadfcc4_preserves_all_user_assistant_text_under_50kb() {
    // Locate the efadfcc4 file by partial match — the kernel experiment's
    // session id has additional bytes (efadfcc4-f76b-498c-96d1-d017947c0e1f).
    let dir = home_dir().join(".claude/projects/-Users-yang-lahacks");
    if !dir.exists() {
        eprintln!("[skip] efadfcc4: projects dir missing");
        return;
    }
    let path = std::fs::read_dir(&dir)
        .expect("read dir")
        .flatten()
        .find(|e| {
            let n = e.file_name();
            let n = n.to_string_lossy();
            n.starts_with("efadfcc4") && n.ends_with(".jsonl")
        })
        .map(|e| e.path());
    let Some(path) = path else {
        eprintln!("[skip] efadfcc4: no .jsonl fixture starting with efadfcc4 in projects dir");
        return;
    };

    let turns = filter_session_lines(&path, 0).expect("filter must not fail on real fixture");
    let total_chars: usize = turns.iter().map(|t| t.text.len()).sum();
    assert!(
        total_chars < 50_000,
        "efadfcc4 filtered text size = {total_chars} bytes, expected < 50_000"
    );
    assert!(turns.iter().any(|t| t.role == "user"));
    assert!(turns.iter().any(|t| t.role == "assistant"));

    let (expected_user, expected_asst) = redev_expected_texts(&PathBuf::from(&path));
    let actual_user: std::collections::HashSet<&str> = turns
        .iter()
        .filter(|t| t.role == "user")
        .map(|t| t.text.as_str())
        .collect();
    let actual_asst: std::collections::HashSet<&str> = turns
        .iter()
        .filter(|t| t.role == "assistant")
        .map(|t| t.text.as_str())
        .collect();
    for u in &expected_user {
        assert!(
            actual_user.contains(u.as_str()),
            "efadfcc4 user text missing"
        );
    }
    for a in &expected_asst {
        assert!(
            actual_asst.contains(a.as_str()),
            "efadfcc4 assistant text missing"
        );
    }
    eprintln!(
        "[ok] efadfcc4: {} turns, {} chars filtered",
        turns.len(),
        total_chars
    );
}

#[test]
fn filter_skips_meta_messages() {
    // Synthetic: a JSONL with one isMeta:true user line, one isMeta:false user
    // line, one assistant line. Should output 2 turns (1 user + 1 assistant).
    let tmp = std::env::temp_dir().join(format!("phase10-meta-{}.jsonl", std::process::id()));
    let content = r#"{"type":"user","isMeta":true,"message":{"content":"caveat"},"timestamp":"t1"}
{"type":"user","isMeta":false,"message":{"content":"hello"},"timestamp":"t2"}
{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]},"timestamp":"t3"}
"#;
    std::fs::write(&tmp, content).unwrap();
    let turns = filter_session_lines(&tmp, 0).unwrap();
    assert_eq!(turns.len(), 2);
    assert_eq!(turns[0].role, "user");
    assert_eq!(turns[0].text, "hello");
    assert_eq!(turns[1].role, "assistant");
    assert_eq!(turns[1].text, "hi");
    let _ = std::fs::remove_file(&tmp);
}

#[test]
fn filter_skips_preamble_strings() {
    // user content starting with "<" is preamble injection — skip
    let tmp = std::env::temp_dir().join(format!("phase10-preamble-{}.jsonl", std::process::id()));
    let content = r#"{"type":"user","isMeta":false,"message":{"content":"<local-command-caveat>blah"},"timestamp":"t"}
{"type":"user","isMeta":false,"message":{"content":"real prompt"},"timestamp":"t"}
"#;
    std::fs::write(&tmp, content).unwrap();
    let turns = filter_session_lines(&tmp, 0).unwrap();
    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].text, "real prompt");
    let _ = std::fs::remove_file(&tmp);
}

#[test]
fn filter_skips_tool_use_and_thinking_blocks() {
    let tmp = std::env::temp_dir().join(format!("phase10-tools-{}.jsonl", std::process::id()));
    let content = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"reasoning"},{"type":"tool_use","id":"a","name":"X","input":{}},{"type":"thinking","thinking":"private"},{"type":"text","text":"answer"}]},"timestamp":"t"}
"#;
    std::fs::write(&tmp, content).unwrap();
    let turns = filter_session_lines(&tmp, 0).unwrap();
    assert_eq!(turns.len(), 2);
    assert_eq!(turns[0].text, "reasoning");
    assert_eq!(turns[1].text, "answer");
    let _ = std::fs::remove_file(&tmp);
}

#[test]
fn filter_starts_from_offset() {
    let tmp = std::env::temp_dir().join(format!("phase10-offset-{}.jsonl", std::process::id()));
    let content = r#"{"type":"user","isMeta":false,"message":{"content":"first"},"timestamp":"t"}
{"type":"user","isMeta":false,"message":{"content":"second"},"timestamp":"t"}
{"type":"user","isMeta":false,"message":{"content":"third"},"timestamp":"t"}
"#;
    std::fs::write(&tmp, content).unwrap();
    let turns = filter_session_lines(&tmp, 1).unwrap();
    assert_eq!(turns.len(), 2);
    assert_eq!(turns[0].text, "second");
    assert_eq!(turns[1].text, "third");
    let _ = std::fs::remove_file(&tmp);
}
