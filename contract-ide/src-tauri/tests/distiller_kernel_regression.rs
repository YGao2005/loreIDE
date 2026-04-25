//! SC 3 regression test — gates Phase 11 Plan 11-05 UAT.
//!
//! Validates that the distiller prompt (DISTILLER_PROMPT) reliably extracts
//! ≥14 unique constraints across the two kernel-experiment sessions when run
//! through the real `claude -p` CLI. The two fixture JSONL files contain the
//! filtered conversational text from the actual sessions that produced the 14
//! hand-curated constraints in kernel_constraints_expected.json.
//!
//! ## Running
//!
//! Default (cheap, CI-safe): test SKIPS silently.
//! ```
//! cargo test --test distiller_kernel_regression
//! ```
//!
//! Live LLM gate (costs ~$0.05, ~20s per run):
//! ```
//! CI_LLM_LIVE=1 cargo test --test distiller_kernel_regression -- --nocapture
//! ```
//!
//! ## Assertions
//!
//! 1. ≥14 unique constraints emerge across both sessions (text-prefix-50 dedup)
//! 2. ≥5 of the 14 hand-curated expected constraints have ≥3-word semantic
//!    overlap with the extracted set (thematic recall floor from kernel experiment)
//!
//! ## Design notes
//!
//! - Uses std::process::Command to invoke `claude -p` directly, bypassing the
//!   Tauri AppHandle requirement of the production distill_episode(). The full
//!   E2E integration (AppHandle + distill_episode + substrate_nodes insert) is
//!   validated in Plan 11-05 UAT.
//! - The DISTILLER_PROMPT constant is imported from contract_ide_lib::distiller::prompt
//!   so this test always uses the production prompt. Prompt changes break the test
//!   automatically — intentional.
//! - Semantic matching uses ≥3-word overlap with words > 4 chars, matching the
//!   kernel-experiment documented recall floor. Verbatim text equality would be
//!   brittle to LLM rephrasing.

use contract_ide_lib::distiller::prompt::{render_atom_candidates_hint, substrate_node_schema, DISTILLER_PROMPT};
use std::collections::HashSet;
use std::path::PathBuf;

/// SC 3 regression gate: ≥14 unique constraints across two kernel sessions.
/// Gated by CI_LLM_LIVE=1 to keep default `cargo test` cheap.
#[tokio::test]
async fn distiller_reproduces_14_kernel_constraints() {
    if std::env::var("CI_LLM_LIVE").ok().as_deref() != Some("1") {
        eprintln!(
            "SKIPPED distiller_reproduces_14_kernel_constraints — set CI_LLM_LIVE=1 to run live LLM test"
        );
        return;
    }

    // 1. Load fixture files
    let fixtures_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");

    let session_a = std::fs::read_to_string(fixtures_dir.join("kernel_session_a.jsonl"))
        .expect("read kernel_session_a.jsonl — fixture must exist at tests/fixtures/");
    let session_b = std::fs::read_to_string(fixtures_dir.join("kernel_session_b.jsonl"))
        .expect("read kernel_session_b.jsonl — fixture must exist at tests/fixtures/");

    let expected_text =
        std::fs::read_to_string(fixtures_dir.join("kernel_constraints_expected.json"))
            .expect("read kernel_constraints_expected.json");
    let expected: Vec<serde_json::Value> =
        serde_json::from_str(&expected_text).expect("parse kernel_constraints_expected.json");

    assert_eq!(
        expected.len(),
        14,
        "kernel_constraints_expected.json must contain exactly 14 entries; got {}",
        expected.len()
    );

    // 2. Run distiller over each session and collect constraint nodes
    let mut all_constraints: Vec<serde_json::Value> = Vec::new();

    let sessions: &[(&str, &str)] = &[("kernel-a", &session_a), ("kernel-b", &session_b)];

    for (session_id, filtered_text) in sessions {
        eprintln!("[SC3] Distilling session {session_id} ({} chars)...", filtered_text.len());

        // Render the prompt — no candidate atoms for fixture sessions (fallback fires)
        let candidates_hint = render_atom_candidates_hint(&[]);
        let prompt_text = DISTILLER_PROMPT
            .replace("{atom_candidates}", &candidates_hint)
            .replace("{filtered_text}", filtered_text);

        let schema = substrate_node_schema();

        // 3. Invoke claude -p — pipe prompt via stdin (avoids argv size limits +
        // gives EOF signal for newer claude CLI). --bare dropped for OAuth-keychain
        // auth path (same trade-off as production callsites; see plan_review.rs).
        use std::io::Write;
        use std::process::Stdio;
        let mut child = std::process::Command::new("claude")
            .args([
                "-p",
                "--output-format",
                "json",
                "--json-schema",
                &schema.to_string(),
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("failed to spawn `claude` — is it installed and on PATH?");
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(prompt_text.as_bytes())
                .expect("failed to write prompt to claude stdin");
        }
        let output = child
            .wait_with_output()
            .expect("failed to wait on claude subprocess");

        assert!(
            output.status.success(),
            "claude -p exited non-zero for session {session_id}: code={} stderr={:?} stdout_head={:?}",
            output.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&output.stderr),
            String::from_utf8_lossy(&output.stdout).chars().take(400).collect::<String>()
        );

        // 4. Parse response and extract constraint nodes
        let response: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap_or_else(
            |e| panic!("response parse failed for session {session_id}: {e}\nRaw: {}", String::from_utf8_lossy(&output.stdout))
        );

        let nodes = response
            .get("structured_output")
            .and_then(|v| v.get("nodes"))
            .and_then(|v| v.as_array())
            .unwrap_or_else(|| panic!("missing structured_output.nodes for session {session_id}"));

        let session_constraints: Vec<&serde_json::Value> = nodes
            .iter()
            .filter(|n| n.get("type").and_then(|v| v.as_str()) == Some("constraint"))
            .collect();

        eprintln!(
            "[SC3] Session {session_id}: {} total nodes, {} constraints",
            nodes.len(),
            session_constraints.len()
        );

        for c in &session_constraints {
            all_constraints.push((*c).clone());
        }
    }

    // 5. Assert ≥14 unique constraints (text-prefix-50 dedup for LLM phrasing variance)
    let unique_prefixes: HashSet<String> = all_constraints
        .iter()
        .filter_map(|n| n.get("text").and_then(|v| v.as_str()))
        .map(|t| t[..t.len().min(50)].to_lowercase())
        .collect();

    eprintln!(
        "[SC3] Total unique constraints (prefix-50 dedup): {}",
        unique_prefixes.len()
    );
    for (i, p) in unique_prefixes.iter().enumerate() {
        eprintln!("  [{i}] {p}");
    }

    assert!(
        unique_prefixes.len() >= 14,
        "SC 3 FAIL: expected ≥14 unique constraints; got {}: {:?}",
        unique_prefixes.len(),
        unique_prefixes
    );

    // 6. Semantic recall check: ≥5 of the 14 expected constraints have
    //    ≥3-word overlap with the extracted set.
    //    (kernel-experiment documented floor: 4/4 retrieval, 14/14 extraction)
    let extracted_texts: Vec<String> = all_constraints
        .iter()
        .filter_map(|n| n.get("text").and_then(|v| v.as_str()))
        .map(|t| t.to_lowercase())
        .collect();

    let mut hits = 0usize;
    for exp in &expected {
        let exp_text = exp
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase();
        let exp_words: HashSet<&str> =
            exp_text.split_whitespace().filter(|w| w.len() > 4).collect();

        for ext in &extracted_texts {
            let ext_words: HashSet<&str> =
                ext.split_whitespace().filter(|w| w.len() > 4).collect();
            let overlap = exp_words.intersection(&ext_words).count();
            if overlap >= 3 {
                hits += 1;
                break;
            }
        }
    }

    eprintln!("[SC3] Semantic recall: {hits}/14 expected constraints matched (threshold ≥5)");

    assert!(
        hits >= 5,
        "SC 3 FAIL: only {hits}/14 expected constraints had ≥3-word semantic overlap in extracted set. \
         Check DISTILLER_PROMPT quality and fixture text coverage."
    );

    eprintln!("[SC3] PASSED — {unique_prefixes_len} unique constraints, {hits}/14 semantic recall", unique_prefixes_len = unique_prefixes.len());
}
