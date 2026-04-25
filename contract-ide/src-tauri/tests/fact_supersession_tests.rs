//! Adversarial regression harness for fact_engine.
//!
//! Per RESEARCH.md Pattern 5: recall ≥ 80%, precision ≥ 85% on 5
//! contradiction fixtures.
//!
//! Gated by CI_LLM_LIVE=1 env flag (real `claude -p` call costs subscription
//! tokens). The test is also marked `#[ignore]` so plain `cargo test --tests`
//! never spawns the subprocess; the user / UAT must opt in explicitly:
//!
//!     CI_LLM_LIVE=1 cargo test --test fact_supersession_tests \
//!         -- --ignored --nocapture
//!
//! What this exercises:
//! - The exact `build_invalidation_prompt` template shipped in Plan 12-02
//!   (any whitespace / wording change in `prompt.rs` will be caught here).
//! - The `parse_invalidation_response` defensive parser (Plan 12-02).
//! - Real `claude -p` LLM judgment against five real contradiction pairs.
//!
//! What this DOES NOT exercise (covered by lib unit tests + 12-UAT.md):
//! - Sqlite `write_supersession` + `write_supersedes_edge` (queries.rs tests).
//! - DriftLocks per-UUID serialization (drift::state tests).
//! - Tauri AppHandle integration (full app harness too heavy here — UAT
//!   covers it on the live build).

use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
struct FactFixture {
    scenario: String,
    seed_nodes: Vec<FixtureNode>,
    new_node: FixtureNode,
    expected_invalidated: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct FixtureNode {
    uuid: String,
    node_type: String,
    text: String,
    #[serde(default)]
    scope: Option<String>,
    #[serde(default)]
    applies_when: Option<String>,
    valid_at: String,
}

fn load_fixtures() -> Vec<FactFixture> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/fact_contradictions");
    let mut out = vec![];
    for entry in std::fs::read_dir(&dir).unwrap_or_else(|e| {
        panic!("read_dir({}) failed: {e}", dir.display())
    }) {
        let path = entry.unwrap().path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            let text = std::fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("read {} failed: {e}", path.display()));
            let fx: FactFixture = serde_json::from_str(&text)
                .unwrap_or_else(|e| panic!("parse {} failed: {e}", path.display()));
            out.push(fx);
        }
    }
    assert!(
        !out.is_empty(),
        "No fact_contradictions fixtures found at {}",
        dir.display()
    );
    out
}

fn fixture_to_substrate_node(
    n: &FixtureNode,
) -> contract_ide_lib::supersession::types::SubstrateNode {
    contract_ide_lib::supersession::types::SubstrateNode {
        uuid: n.uuid.clone(),
        node_type: n.node_type.clone(),
        text: n.text.clone(),
        scope: n.scope.clone(),
        applies_when: n.applies_when.clone(),
        valid_at: n.valid_at.clone(),
        invalid_at: None,
        expired_at: None,
        invalidated_by: None,
    }
}

/// Sanity: fixtures load and have the expected shape. Runs in plain
/// `cargo test` (no LLM gate) so a broken fixture is caught early.
#[test]
fn fixtures_load_and_each_has_one_seed_and_one_expected() {
    let fixtures = load_fixtures();
    assert_eq!(
        fixtures.len(),
        5,
        "expected exactly 5 fact-contradiction fixtures, got {}",
        fixtures.len()
    );
    for fx in &fixtures {
        assert_eq!(
            fx.seed_nodes.len(),
            1,
            "[{}] expected 1 seed node",
            fx.scenario
        );
        assert_eq!(
            fx.expected_invalidated.len(),
            1,
            "[{}] expected 1 expected_invalidated entry",
            fx.scenario
        );
        assert_eq!(
            fx.expected_invalidated[0],
            fx.seed_nodes[0].uuid,
            "[{}] expected_invalidated should reference the seed uuid",
            fx.scenario
        );
    }
}

/// Skipped unless CI_LLM_LIVE=1 — exercises real `claude -p` subprocess.
/// Ungating: `CI_LLM_LIVE=1 cargo test --test fact_supersession_tests -- --ignored --nocapture`
#[tokio::test]
#[ignore]
async fn fact_engine_recall_at_least_80_percent_precision_at_least_85_percent() {
    if std::env::var("CI_LLM_LIVE").ok().as_deref() != Some("1") {
        eprintln!("[fact_supersession_tests] CI_LLM_LIVE!=1, skipping live LLM call");
        return;
    }

    let fixtures = load_fixtures();
    let mut total_positives = 0usize;
    let mut hits = 0usize;
    let mut false_positives = 0usize;

    // For each fixture: build the invalidation prompt directly via the
    // public API in contract_ide_lib::supersession::prompt, run claude -p,
    // parse with parse_invalidation_response, count hits / false-positives
    // against expected_invalidated.
    //
    // This exercises the LOAD-BEARING components (prompt template + LLM
    // judge + verdict parser) without standing up a full Tauri app harness.
    // The lock + DB-write paths are unit-tested separately under
    // contract_ide_lib::supersession::queries.

    for fx in &fixtures {
        total_positives += fx.expected_invalidated.len();

        let new_node = fixture_to_substrate_node(&fx.new_node);
        let candidates: Vec<_> = fx
            .seed_nodes
            .iter()
            .map(fixture_to_substrate_node)
            .collect();

        let prompt = contract_ide_lib::supersession::prompt::build_invalidation_prompt(
            &new_node,
            &candidates,
        );

        // Run claude -p directly (mirrors fact_engine's run_claude_judge
        // behavior for the prompt path).
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
                "[{}] claude -p exit={:?} stderr={}",
                fx.scenario,
                output.status.code(),
                String::from_utf8_lossy(&output.stderr),
            );
        }

        let idxs = contract_ide_lib::supersession::verdict::parse_invalidation_response(&raw)
            .unwrap_or_default();

        // Map idx → uuid via the candidates vector.
        let invalidated: Vec<String> = idxs
            .iter()
            .filter_map(|i| candidates.get(*i).map(|c| c.uuid.clone()))
            .collect();

        eprintln!(
            "[{}] expected={:?} got={:?} raw_len={}",
            fx.scenario,
            fx.expected_invalidated,
            invalidated,
            raw.len(),
        );

        for got in &invalidated {
            if fx.expected_invalidated.contains(got) {
                hits += 1;
            } else {
                false_positives += 1;
            }
        }
    }

    let recall = if total_positives > 0 {
        hits as f64 / total_positives as f64
    } else {
        1.0
    };
    let predicted_positives = hits + false_positives;
    let precision = if predicted_positives > 0 {
        hits as f64 / predicted_positives as f64
    } else {
        1.0
    };

    eprintln!(
        "Recall:    {:.2} ({}/{})",
        recall, hits, total_positives
    );
    eprintln!(
        "Precision: {:.2} ({}/{})",
        precision, hits, predicted_positives
    );
    assert!(
        recall >= 0.80,
        "Recall {recall:.2} < 0.80 threshold (target: research/intent-supersession baseline)"
    );
    assert!(
        precision >= 0.85,
        "Precision {precision:.2} < 0.85 threshold"
    );
}
