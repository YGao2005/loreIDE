//! Defensive JSONL parser unit tests.
//!
//! Tests cover:
//!   1. parses_real_session_with_nonzero_counts
//!   2. tolerates_truncated_last_line
//!   3. tolerates_unknown_types_and_camelcase
//!   4. mock_fallback_on_missing_file
//!   5. cost_calculation_opus_4_7
//!   6. encode_cwd_strips_leading_slash_and_replaces_separators
//!   7. extracts_touched_files_from_tool_use_blocks

use contract_ide_lib::commands::receipts::{
    encode_cwd, mock_receipt, parse_session_jsonl, ParseStatus,
};
use std::path::{Path, PathBuf};

fn fixtures_dir() -> PathBuf {
    // Integration tests run from the crate root (src-tauri/).
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures")
}

// ---------------------------------------------------------------------------
// Test 1: parses_real_session_with_nonzero_counts
// ---------------------------------------------------------------------------
#[test]
fn parses_real_session_with_nonzero_counts() {
    let path = fixtures_dir().join("session_real.jsonl");
    let receipt = parse_session_jsonl(&path, "test-track-1").expect("should parse successfully");

    assert!(
        receipt.input_tokens > 0,
        "input_tokens should be > 0, got {}",
        receipt.input_tokens
    );
    assert!(
        receipt.output_tokens > 0,
        "output_tokens should be > 0, got {}",
        receipt.output_tokens
    );
    assert!(
        receipt.tool_call_count > 0,
        "tool_call_count should be > 0, got {}",
        receipt.tool_call_count
    );
    assert_eq!(receipt.parse_status, ParseStatus::Ok);
    // The real fixture includes a Write tool call.
    assert!(
        !receipt.touched_files.is_empty(),
        "touched_files should have at least one Write/Edit/MultiEdit file"
    );
}

// ---------------------------------------------------------------------------
// Test 2: tolerates_truncated_last_line
// ---------------------------------------------------------------------------
#[test]
fn tolerates_truncated_last_line() {
    let path = fixtures_dir().join("session_truncated.jsonl");
    // Parser must NOT panic or return Err — well-formed lines parse fine.
    let receipt = parse_session_jsonl(&path, "test-track-2").expect(
        "should parse successfully despite truncated last line",
    );

    // The fixture has 3 well-formed lines and 1 truncated line.
    // Well-formed lines include one assistant line with non-zero tokens.
    assert!(
        receipt.input_tokens > 0,
        "input_tokens from well-formed lines should be > 0, got {}",
        receipt.input_tokens
    );
    assert_eq!(receipt.parse_status, ParseStatus::Ok);
}

// ---------------------------------------------------------------------------
// Test 3: tolerates_unknown_types_and_camelcase
// ---------------------------------------------------------------------------
#[test]
fn tolerates_unknown_types_and_camelcase() {
    let path = fixtures_dir().join("session_unknown_types.jsonl");
    // Parser must NOT panic; returns non-zero counts from well-formed lines.
    let receipt = parse_session_jsonl(&path, "test-track-3").expect(
        "should parse despite unknown types and camelCase usage keys",
    );

    // session_unknown_types.jsonl has one valid assistant line with usage.
    assert!(
        receipt.input_tokens > 0,
        "should have parsed tokens from the valid assistant line, got {}",
        receipt.input_tokens
    );
    // Line 2 has camelCase usage: {"type":"assistant","message":{"inputTokens":42}}
    // Our parser reads .message.usage.input_tokens (snake_case). The camelCase line
    // has no .message.usage so no tokens are summed from it — this is correct
    // (schema drift simulation: parser ignores fields it doesn't understand).
}

// ---------------------------------------------------------------------------
// Test 4: mock_fallback_on_missing_file
// ---------------------------------------------------------------------------
#[test]
fn mock_fallback_on_missing_file() {
    let result = parse_session_jsonl(Path::new("/nonexistent_path_for_test.jsonl"), "test-track-4");
    assert!(result.is_err(), "missing file should return Err");

    // Caller uses mock_receipt on Err.
    let fallback = mock_receipt("test-track-4", PathBuf::from("/nonexistent_path_for_test.jsonl"));
    assert_eq!(fallback.parse_status, ParseStatus::FallbackMock);
    assert_eq!(fallback.input_tokens, 0);
    assert_eq!(fallback.output_tokens, 0);
    assert_eq!(fallback.tool_call_count, 0);
    assert_eq!(fallback.estimated_cost_usd, 0.0);
}

// ---------------------------------------------------------------------------
// Test 5: cost_calculation_opus_4_7
// ---------------------------------------------------------------------------
#[test]
fn cost_calculation_opus_4_7() {
    // Create a minimal fixture in a temp file with known token counts.
    // input_tokens = 1_000_000, output_tokens = 500_000, model = claude-opus-4-7
    // Expected cost = (1.0 * 15.00) + (0.5 * 75.00) = 15.00 + 37.50 = 52.50
    use std::io::Write;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("cost_test.jsonl");

    let user_line = r#"{"type":"user","message":{"role":"user","content":"test"},"sessionId":"cost-test-001","timestamp":"2026-04-25T06:00:00.000Z","uuid":"cost-uuid-001"}"#;
    let assistant_line = r#"{"type":"assistant","message":{"model":"claude-opus-4-7","id":"msg_cost","type":"message","role":"assistant","content":[{"type":"text","text":"answer"}],"stop_reason":"end_turn","usage":{"input_tokens":1000000,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":500000}},"type":"assistant","uuid":"cost-uuid-002","timestamp":"2026-04-25T06:00:01.000Z","sessionId":"cost-test-001"}"#;

    let mut file = std::fs::File::create(&path).unwrap();
    writeln!(file, "{user_line}").unwrap();
    writeln!(file, "{assistant_line}").unwrap();
    drop(file);

    let receipt = parse_session_jsonl(&path, "cost-track").expect("parse should succeed");

    assert_eq!(receipt.input_tokens, 1_000_000);
    assert_eq!(receipt.output_tokens, 500_000);

    let expected_cost = 1_000_000_f64 / 1_000_000.0 * 15.00 + 500_000_f64 / 1_000_000.0 * 75.00;
    let delta = (receipt.estimated_cost_usd - expected_cost).abs();
    assert!(
        delta < 0.001,
        "cost mismatch: expected {expected_cost:.4}, got {:.4}",
        receipt.estimated_cost_usd
    );
}

// ---------------------------------------------------------------------------
// Test 6: encode_cwd_strips_leading_slash_and_replaces_separators
// ---------------------------------------------------------------------------
#[test]
fn encode_cwd_strips_leading_slash_and_replaces_separators() {
    let path = Path::new("/Users/yang/foo");
    let encoded = encode_cwd(path);
    assert_eq!(encoded, "-Users-yang-foo");
}

// ---------------------------------------------------------------------------
// Test 7: extracts_touched_files_from_tool_use_blocks
// ---------------------------------------------------------------------------
#[test]
fn extracts_touched_files_from_tool_use_blocks() {
    use std::io::Write;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("tool_use_test.jsonl");

    // Synthesize assistant lines with Write, Edit, MultiEdit, and Read tool_use blocks.
    let assistant_write = r#"{"type":"assistant","message":{"model":"claude-opus-4-7","id":"msg_w","type":"message","role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Write","input":{"file_path":"src/foo.ts","content":"x"}},{"type":"tool_use","id":"t2","name":"Read","input":{"file_path":"src/skip.ts"}}],"stop_reason":"tool_use","usage":{"input_tokens":10,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":5}},"uuid":"w-uuid-001","timestamp":"2026-04-25T06:00:01.000Z","sessionId":"tool-test-001"}"#;
    let assistant_edit = r#"{"type":"assistant","message":{"model":"claude-opus-4-7","id":"msg_e","type":"message","role":"assistant","content":[{"type":"tool_use","id":"t3","name":"Edit","input":{"file_path":"src/bar.ts","old_string":"a","new_string":"b"}}],"stop_reason":"tool_use","usage":{"input_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":2}},"uuid":"e-uuid-001","timestamp":"2026-04-25T06:00:02.000Z","sessionId":"tool-test-001"}"#;
    let assistant_multi = r#"{"type":"assistant","message":{"model":"claude-opus-4-7","id":"msg_m","type":"message","role":"assistant","content":[{"type":"tool_use","id":"t4","name":"MultiEdit","input":{"path":"src/baz.ts","edits":[]}}],"stop_reason":"tool_use","usage":{"input_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":2}},"uuid":"m-uuid-001","timestamp":"2026-04-25T06:00:03.000Z","sessionId":"tool-test-001"}"#;

    let mut file = std::fs::File::create(&path).unwrap();
    writeln!(file, "{assistant_write}").unwrap();
    writeln!(file, "{assistant_edit}").unwrap();
    writeln!(file, "{assistant_multi}").unwrap();
    drop(file);

    let receipt = parse_session_jsonl(&path, "tool-track").expect("parse should succeed");

    // touched_files should contain Write, Edit, MultiEdit paths (alphabetically sorted).
    // Read's file (src/skip.ts) must NOT appear.
    let expected: Vec<String> = vec![
        "src/bar.ts".to_string(),
        "src/baz.ts".to_string(),
        "src/foo.ts".to_string(),
    ];
    assert_eq!(
        receipt.touched_files, expected,
        "touched_files should be [bar, baz, foo] alphabetically; got {:?}",
        receipt.touched_files
    );

    // Verify tool_call_count includes ALL tool_use blocks (Read counts too).
    assert_eq!(
        receipt.tool_call_count, 4,
        "tool_call_count should be 4 (Write + Read + Edit + MultiEdit), got {}",
        receipt.tool_call_count
    );
}
