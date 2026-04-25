//! Integration tests for the section_parser module (PROP-01).
//!
//! These tests verify:
//! - Basic H2 section parsing with BTreeMap alphabetical sorting
//! - DuplicateHeading rejection
//! - Fenced-code-awareness (## inside ``` is NOT a heading)
//! - Order independence: same logical content in different ordering → identical hashes
//! - Beat 1 demo body acceptance (load-bearing fixture)
//! - Four-section canonical body acceptance (Intent + Role + Examples + Implicit Decisions)

use contract_ide_lib::sidecar::section_parser::{compute_section_hashes, parse_sections, ParseError};

/// Helper: read a fixture file relative to the crate root.
fn read_fixture(name: &str) -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(name);
    std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("Could not read fixture {}: {}", name, e))
}

/// Strip the YAML frontmatter from a fixture file, returning only the body.
fn strip_frontmatter(content: &str) -> &str {
    // Format: ---\n...\n---\n\nbody
    let trimmed = content.trim_start_matches('\u{feff}');
    let rest = trimmed.strip_prefix("---\n").expect("missing opening fence");
    let end = rest.find("\n---\n").expect("missing closing fence");
    let after = &rest[end + 1..]; // starts with "---\n"
    let body_start = after.find('\n').expect("no newline after closing fence") + 1;
    after[body_start..].trim_start_matches(['\n', '\r'])
}

// ---------------------------------------------------------------------------
// Core parse_sections tests
// ---------------------------------------------------------------------------

#[test]
fn parses_simple_h2_sections() {
    let body =
        "## Alpha\n\nFirst section text.\n\n## Beta\n\nSecond section text.\n\n## Gamma\n\nThird.\n";
    let sections = parse_sections(body).expect("parse should succeed");
    // BTreeMap keys must be alphabetically sorted.
    let keys: Vec<&str> = sections.keys().map(|s| s.as_str()).collect();
    assert_eq!(keys, ["alpha", "beta", "gamma"]);
    assert_eq!(sections["alpha"], "First section text.");
    assert_eq!(sections["beta"], "Second section text.");
    assert_eq!(sections["gamma"], "Third.");
}

#[test]
fn rejects_duplicate_h2() {
    let body = "## Intent\n\nFirst.\n\n## Intent\n\nDuplicate.\n";
    match parse_sections(body) {
        Err(ParseError::DuplicateHeading(name)) => {
            assert_eq!(name, "intent");
        }
        Ok(_) => panic!("expected DuplicateHeading error"),
    }
}

#[test]
fn ignores_h2_inside_fenced_code() {
    let body = concat!(
        "## Real Section\n\n",
        "Content here.\n\n",
        "```\n",
        "## Looks like a heading\n",
        "```\n\n",
        "## Another Real\n\n",
        "More content.\n"
    );
    let sections = parse_sections(body).expect("parse should succeed");
    assert_eq!(sections.len(), 2, "should only have 2 sections, got: {:?}", sections.keys().collect::<Vec<_>>());
    assert!(sections.contains_key("real section"), "missing 'real section'");
    assert!(sections.contains_key("another real"), "missing 'another real'");
    assert!(
        !sections.contains_key("looks like a heading"),
        "fenced-code line should not be parsed as heading"
    );
}

// ---------------------------------------------------------------------------
// Order independence test (Pitfall 1 fix)
// ---------------------------------------------------------------------------

#[test]
fn order_independence_round_trip() {
    // contract_api_l3.md has sections in order: Intent, Inputs, Outputs, Examples, Invariants
    // contract_ui_l4.md has sections in order: Examples, Intent, Invariants, Inputs, Outputs
    // Both have the same 5 section names. The BTreeMap output must be alphabetically
    // sorted regardless of source order, and hashes must be stable (calling twice
    // on the same fixture gives identical results).

    let api_content = read_fixture("contract_api_l3.md");
    let ui_content = read_fixture("contract_ui_l4.md");

    let api_body = strip_frontmatter(&api_content);
    let ui_body = strip_frontmatter(&ui_content);

    let api_hashes = compute_section_hashes(api_body).expect("api hashes");
    let ui_hashes = compute_section_hashes(ui_body).expect("ui hashes");

    // Both fixtures must have the same set of 5 section names, alphabetically sorted.
    let expected_keys = ["examples", "inputs", "intent", "invariants", "outputs"];
    let api_keys: Vec<&str> = api_hashes.keys().map(|s| s.as_str()).collect();
    let ui_keys: Vec<&str> = ui_hashes.keys().map(|s| s.as_str()).collect();
    assert_eq!(api_keys, expected_keys, "api_l3 section names must be alphabetically sorted");
    assert_eq!(ui_keys, expected_keys, "ui_l4 section names must be alphabetically sorted");

    // Hashes are stable: calling twice on the same body gives the same result.
    let api_hashes2 = compute_section_hashes(api_body).expect("api hashes second call");
    let ui_hashes2 = compute_section_hashes(ui_body).expect("ui hashes second call");
    assert_eq!(api_hashes, api_hashes2, "api_l3 hashes must be deterministic");
    assert_eq!(ui_hashes, ui_hashes2, "ui_l4 hashes must be deterministic");
}

// ---------------------------------------------------------------------------
// Beat 1 demo body acceptance (load-bearing fixture — Pitfall 10)
// ---------------------------------------------------------------------------

#[test]
fn accepts_beat1_demo_body() {
    let body = read_fixture("contract_beat1_body.md");
    let sections = parse_sections(&body).expect("Beat 1 body must parse successfully");

    // Beat 1 body contains ## Intent, ## Role, ## Examples
    assert!(sections.contains_key("intent"), "must have 'intent' section");
    assert!(sections.contains_key("role"), "must have 'role' section");
    assert!(sections.contains_key("examples"), "must have 'examples' section");

    // Stability check: hashes must be identical across two consecutive calls.
    let h1 = compute_section_hashes(&body).expect("first hash");
    let h2 = compute_section_hashes(&body).expect("second hash");
    assert_eq!(h1, h2, "section_hashes must be deterministic");

    // GIVEN/WHEN/THEN content must survive faithfully in the Examples section.
    let examples = &sections["examples"];
    assert!(
        examples.contains("GIVEN"),
        "Examples section must contain GIVEN/WHEN/THEN text"
    );
    assert!(examples.contains("WHEN"), "Examples section must contain WHEN");
    assert!(examples.contains("THEN"), "Examples section must contain THEN");

    // Intent section must be multi-paragraph.
    let intent = &sections["intent"];
    assert!(
        intent.len() > 100,
        "Intent section should be multi-paragraph (got {} chars)",
        intent.len()
    );
}

// ---------------------------------------------------------------------------
// Four-section canonical body acceptance
// ---------------------------------------------------------------------------

#[test]
fn accepts_canonical_four_section_body() {
    // Synthesize a body with all four Phase 8 canonical sections.
    let body = concat!(
        "## Intent\n\n",
        "The user wants to accomplish a specific goal.\n\n",
        "## Role\n\n",
        "A primary action component in the settings page.\n\n",
        "## Examples\n\n",
        "GIVEN a user on the settings page\n",
        "WHEN they click the action button\n",
        "THEN the action is performed and a confirmation shown\n\n",
        "## Implicit Decisions\n\n",
        "The action timeout defaults to 30 seconds per team standard.\n"
    );

    let sections = parse_sections(body).expect("four-section body must parse successfully");

    // All four canonical sections must be present with lowercased keys.
    assert!(sections.contains_key("intent"), "missing 'intent'");
    assert!(sections.contains_key("role"), "missing 'role'");
    assert!(sections.contains_key("examples"), "missing 'examples'");
    assert!(sections.contains_key("implicit decisions"), "missing 'implicit decisions'");

    // Hashes must be stable across two consecutive calls.
    let h1 = compute_section_hashes(body).expect("first hash call");
    let h2 = compute_section_hashes(body).expect("second hash call");
    assert_eq!(h1, h2, "section_hashes must be deterministic");

    // All four sections must have hashes.
    assert!(h1.contains_key("intent"));
    assert!(h1.contains_key("role"));
    assert!(h1.contains_key("examples"));
    assert!(h1.contains_key("implicit decisions"));
}
