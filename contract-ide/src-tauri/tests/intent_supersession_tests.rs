//! Adversarial regression harness for intent_engine.
//!
//! Reproduces the 9/10 baseline at `.planning/research/intent-supersession/results.txt`
//! against the 10-decision evaluation fixture (`evaluation_baseline.json`).
//!
//! Gated by CI_LLM_LIVE=1.
//!
//!     CI_LLM_LIVE=1 cargo test --test intent_supersession_tests \
//!         -- --ignored --nocapture
//!
//! Tolerance: ≥ 8/10 exact-match (allows for one LLM-variance flip from
//! the 9/10 validated baseline). d8 (single-region AWS) MUST be either
//! NEEDS_HUMAN_REVIEW or low-confidence DRIFTED — this is the canonical
//! adversarial-judgment-call test from `evaluation.md`.

use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
struct IntentBaseline {
    old_l0: L0Spec,
    new_l0: L0Spec,
    decisions: Vec<DecisionSpec>,
}

#[derive(Debug, Deserialize)]
struct L0Spec {
    #[allow(dead_code)]
    uuid: String,
    #[allow(dead_code)]
    text: String,
    summary: String,
    valid_at: String,
}

#[derive(Debug, Deserialize)]
struct DecisionSpec {
    uuid: String,
    node_type: String,
    text: String,
    applies_when: String,
    expected_verdict: String,
}

fn load_baseline() -> IntentBaseline {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/intent_drift/evaluation_baseline.json");
    let text = std::fs::read_to_string(&p)
        .unwrap_or_else(|e| panic!("read {} failed: {e}", p.display()));
    serde_json::from_str(&text)
        .unwrap_or_else(|e| panic!("parse {} failed: {e}", p.display()))
}

/// Sanity: baseline loads and has the expected 10-decision shape. Runs in
/// plain `cargo test` (no LLM gate) so a broken fixture is caught early.
#[test]
fn baseline_loads_with_ten_decisions_and_expected_verdict_distribution() {
    let bl = load_baseline();
    assert_eq!(
        bl.decisions.len(),
        10,
        "expected exactly 10 decisions in evaluation_baseline.json"
    );
    let drifted = bl
        .decisions
        .iter()
        .filter(|d| d.expected_verdict == "DRIFTED")
        .count();
    let not_drifted = bl
        .decisions
        .iter()
        .filter(|d| d.expected_verdict == "NOT_DRIFTED")
        .count();
    let needs_review = bl
        .decisions
        .iter()
        .filter(|d| d.expected_verdict == "NEEDS_HUMAN_REVIEW")
        .count();
    // Per evaluation.md: 5 DRIFTED, 4 NOT_DRIFTED, 1 NEEDS_HUMAN_REVIEW (d8).
    assert_eq!(
        drifted, 5,
        "expected 5 DRIFTED in baseline, got {drifted}"
    );
    assert_eq!(
        not_drifted, 4,
        "expected 4 NOT_DRIFTED in baseline, got {not_drifted}"
    );
    assert_eq!(
        needs_review, 1,
        "expected 1 NEEDS_HUMAN_REVIEW in baseline, got {needs_review}"
    );
    // d8 specifically — the adversarial judgment call.
    let d8 = bl.decisions.iter().find(|d| d.uuid == "d8").expect("d8");
    assert_eq!(d8.expected_verdict, "NEEDS_HUMAN_REVIEW");
}

#[tokio::test]
#[ignore]
async fn intent_engine_reproduces_9_of_10_evaluation_baseline() {
    if std::env::var("CI_LLM_LIVE").ok().as_deref() != Some("1") {
        eprintln!("[intent_supersession_tests] CI_LLM_LIVE!=1, skipping live LLM call");
        return;
    }

    let bl = load_baseline();
    let nodes: Vec<_> = bl
        .decisions
        .iter()
        .map(|d| contract_ide_lib::supersession::types::SubstrateNode {
            uuid: d.uuid.clone(),
            node_type: d.node_type.clone(),
            text: d.text.clone(),
            scope: Some("global".into()),
            applies_when: Some(d.applies_when.clone()),
            valid_at: bl.new_l0.valid_at.clone(),
            invalid_at: None,
            expired_at: None,
            invalidated_by: None,
        })
        .collect();

    let prompt = contract_ide_lib::supersession::prompt::build_intent_drift_batch_prompt(
        &bl.old_l0.summary,
        &bl.new_l0.summary,
        &nodes,
    );

    let output = tokio::process::Command::new("claude")
        .arg("-p")
        .arg(&prompt)
        .arg("--output-format")
        .arg("text")
        .output()
        .await
        .expect("claude -p subprocess failed — is claude CLI installed?");
    let raw = String::from_utf8_lossy(&output.stdout).to_string();

    if !output.status.success() {
        eprintln!(
            "[intent_supersession_tests] claude -p exit={:?} stderr={}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr),
        );
    }

    let verdicts =
        contract_ide_lib::supersession::verdict::parse_three_way_batch(&raw).unwrap();

    eprintln!(
        "[intent_supersession_tests] received {} verdicts (expected {})",
        verdicts.len(),
        bl.decisions.len()
    );

    let mut matches = 0usize;
    let total = bl.decisions.len();
    for (i, decision) in bl.decisions.iter().enumerate() {
        let placeholder = format!("d{}", i + 1);
        match verdicts.iter().find(|v| v.id == placeholder) {
            Some(v) => {
                let got = v.verdict.as_db_str();
                eprintln!(
                    "[{}] expected={} got={} conf={:.2} reasoning={}",
                    decision.uuid, decision.expected_verdict, got, v.confidence, v.reasoning,
                );
                if got == decision.expected_verdict {
                    matches += 1;
                }
            }
            None => {
                eprintln!(
                    "[{}] NO VERDICT (placeholder {} not found in response)",
                    decision.uuid, placeholder
                );
            }
        }
    }

    eprintln!(
        "[intent_supersession_tests] matches: {}/{} (target ≥ 8)",
        matches, total
    );

    // Per evaluation.md: 9/10 exact match is the validated baseline.
    // Allow some LLM variance: assert ≥ 8/10.
    assert!(
        matches >= 8,
        "Intent baseline: only {matches}/{total} match (target ≥ 8 / 10)"
    );

    // Stricter sub-assertion: confirm d8 (single-region AWS) is
    // NEEDS_HUMAN_REVIEW or low-confidence DRIFTED — this is the
    // adversarial-judgment-call test in evaluation.md.
    let v8 = verdicts.iter().find(|v| v.id == "d8");
    if let Some(v) = v8 {
        let is_review = matches!(
            v.verdict,
            contract_ide_lib::supersession::types::Verdict::NeedsHumanReview
        );
        let is_low_conf_drifted = matches!(
            v.verdict,
            contract_ide_lib::supersession::types::Verdict::Drifted
        ) && v.confidence < 0.85;
        assert!(
            is_review || is_low_conf_drifted,
            "d8 (single-region AWS) should be NEEDS_HUMAN_REVIEW or low-confidence DRIFTED \
             (got verdict={} conf={:.2})",
            v.verdict.as_db_str(),
            v.confidence,
        );
    } else {
        panic!("d8 verdict missing from LLM response");
    }
}
