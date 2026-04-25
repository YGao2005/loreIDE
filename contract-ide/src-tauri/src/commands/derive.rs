//! Hash utilities consumed by Phase 7 drift detection.
//!
//! Originally scoped to Phase 6 as the Rust-side derivation pipeline (direct
//! Anthropic API call + `derive_contracts` Tauri command). Phase 6 pivoted to
//! an MCP-driven design: the user's active Claude Code session performs
//! derivation via the `write_derived_contract` MCP tool (mcp-sidecar), which
//! owns its own hash computation in TypeScript. The LLM plumbing was removed;
//! these pure helpers stay because Phase 7's drift detection recomputes
//! `code_hash` and compares to the stored baseline — same byte-level semantics
//! as the TS implementation in `mcp-sidecar/src/tools/write_derived_contract.ts`.
//!
//! Hash semantics (MUST stay in sync with the TS implementation):
//! - `code_hash` = SHA-256 over concatenated newline-terminated lines from
//!   every `CodeRange` at derivation time.
//! - `contract_hash` = SHA-256 over `body.trim()` at derivation time.

// Phase 7 will consume these helpers for drift detection. Silencing dead_code
// here rather than deleting the module keeps the Rust-side hash semantics
// under unit-test coverage (the TS port has no tests of its own).
#![allow(dead_code)]

use std::path::Path;

use sha2::{Digest, Sha256};

use crate::sidecar::frontmatter::CodeRange;

/// Compute SHA-256 hex over the SOURCE LINES a node covers (not the whole file).
///
/// Returns `None` for empty ranges, or when any referenced file is unreadable.
/// `end_line` is clamped to the actual file length so sidecars authored before
/// a file-shrinking refactor do not panic.
pub fn compute_code_hash(repo_path: &Path, code_ranges: &[CodeRange]) -> Option<String> {
    if code_ranges.is_empty() {
        return None;
    }
    let mut hasher = Sha256::new();
    for range in code_ranges {
        let file_path = repo_path.join(&range.file);
        let content = std::fs::read_to_string(&file_path).ok()?;
        let lines: Vec<&str> = content.lines().collect();
        let start = (range.start_line as usize).saturating_sub(1);
        let end = (range.end_line as usize).min(lines.len());
        if start >= end {
            continue;
        }
        for line in &lines[start..end] {
            hasher.update(line.as_bytes());
            hasher.update(b"\n");
        }
    }
    Some(hex::encode(hasher.finalize()))
}

/// SHA-256 hex over the contract body text (trimmed). Whitespace around the
/// body must not cause spurious drift signals.
pub fn compute_contract_hash(body: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(body.trim().as_bytes());
    hex::encode(hasher.finalize())
}

/// Extract the source snippet a node covers, capped at `max_lines` lines total
/// across all ranges. Retained for Phase 7 / future Rust-side consumers.
pub fn extract_source(repo_path: &Path, code_ranges: &[CodeRange], max_lines: usize) -> String {
    let mut out = String::new();
    let mut collected = 0usize;
    let mut truncated = 0usize;

    for range in code_ranges {
        if collected >= max_lines {
            truncated +=
                (range.end_line as usize).saturating_sub((range.start_line as usize).saturating_sub(1));
            continue;
        }
        let file_path = repo_path.join(&range.file);
        let Ok(content) = std::fs::read_to_string(&file_path) else {
            continue;
        };
        let lines: Vec<&str> = content.lines().collect();
        let start = (range.start_line as usize).saturating_sub(1);
        let end = (range.end_line as usize).min(lines.len());
        if start >= end {
            continue;
        }

        out.push_str(&format!("// {}\n", range.file));
        for line in &lines[start..end] {
            if collected >= max_lines {
                truncated += end - (start + collected);
                break;
            }
            out.push_str(line);
            out.push('\n');
            collected += 1;
        }
        out.push('\n');
    }

    if truncated > 0 {
        out.push_str(&format!("// ... {truncated} lines truncated\n"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn write_fixture(dir: &Path, rel: &str, contents: &str) {
        let full = dir.join(rel);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&full, contents).unwrap();
    }

    #[test]
    fn code_hash_covers_only_referenced_lines() {
        let tmp = TempDir::new().unwrap();
        write_fixture(tmp.path(), "src/a.rs", "line1\nline2\nline3\nline4\nline5\n");
        let ranges = vec![CodeRange {
            file: "src/a.rs".into(),
            start_line: 2,
            end_line: 4,
        }];
        let h = compute_code_hash(tmp.path(), &ranges).expect("hash");
        let h2 = compute_code_hash(tmp.path(), &ranges).expect("hash");
        assert_eq!(h, h2);
        let ranges2 = vec![CodeRange {
            file: "src/a.rs".into(),
            start_line: 1,
            end_line: 4,
        }];
        let h3 = compute_code_hash(tmp.path(), &ranges2).expect("hash");
        assert_ne!(h, h3);
    }

    #[test]
    fn code_hash_clamps_end_line_past_file_end() {
        let tmp = TempDir::new().unwrap();
        write_fixture(tmp.path(), "src/a.rs", "only_line\n");
        let ranges = vec![CodeRange {
            file: "src/a.rs".into(),
            start_line: 1,
            end_line: 100,
        }];
        assert!(compute_code_hash(tmp.path(), &ranges).is_some());
    }

    #[test]
    fn code_hash_returns_none_for_empty_ranges() {
        let tmp = TempDir::new().unwrap();
        assert_eq!(compute_code_hash(tmp.path(), &[]), None);
    }

    #[test]
    fn contract_hash_trims_whitespace() {
        assert_eq!(
            compute_contract_hash("hello"),
            compute_contract_hash("\nhello\n\n"),
        );
        assert_ne!(compute_contract_hash("hello"), compute_contract_hash("world"));
    }

    #[test]
    fn extract_source_caps_at_max_lines() {
        let tmp = TempDir::new().unwrap();
        write_fixture(
            tmp.path(),
            "src/a.rs",
            &(1..=20).map(|n| format!("line{n}")).collect::<Vec<_>>().join("\n"),
        );
        let ranges = vec![CodeRange {
            file: "src/a.rs".into(),
            start_line: 1,
            end_line: 20,
        }];
        let s = extract_source(tmp.path(), &ranges, 5);
        assert!(s.contains("line1"));
        assert!(s.contains("line5"));
        assert!(!s.contains("line6"));
        assert!(s.contains("lines truncated"));
    }
}
