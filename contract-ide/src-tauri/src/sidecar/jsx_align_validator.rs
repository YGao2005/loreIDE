//! JSX-01 startup validator: asserts every L4 UI contract's `code_ranges`
//! covers exactly one JSX element in the referenced .tsx file.
//!
//! # Parser strategy
//!
//! Uses a structural bracket-counting approach (not a full AST parser) to
//! detect whether the line range covers exactly one top-level JSX element.
//! This approach is sufficient for the single-element invariant check and
//! avoids adding `swc_ecma_parser` as a Tauri dependency (which would add
//! significant compile time). A full AST upgrade can land in a follow-up
//! if edge cases require it. Parser choice documented in 09-04b-SUMMARY.md.
//!
//! # Empty-range exception
//!
//! L4 atoms with empty `code_ranges` (e.g., a1000000 / b1000000 at the start
//! of Beat 1) are always valid — the validator only fires on non-empty ranges.
//!
//! # Missing file handling
//!
//! If the referenced source file does not exist, the check is silently skipped
//! (warning to stderr). This handles ambient contracts referencing future
//! scaffolding (files not yet created for demo density).

use serde::Serialize;

/// Error record for a JSX alignment violation.
#[derive(Debug, Serialize, Clone)]
pub struct JsxAlignmentError {
    pub uuid: String,
    pub file: String,
    pub start_line: usize,
    pub end_line: usize,
    pub reason: String,
}

/// Minimal contract record for validator input.
#[derive(Debug, Clone)]
pub struct ContractRecord {
    pub uuid: String,
    pub kind: String,
    pub level: String,
    pub body: String,
    pub source_file: String,
    pub code_ranges: Vec<CodeRange>,
}

/// A single code range within a contract.
#[derive(Debug, Clone)]
pub struct CodeRange {
    pub file: String,
    pub start_line: usize,
    pub end_line: usize,
}

/// For each L4 UI contract, assert the cited `code_ranges` cover exactly one
/// JSX element. Backend-kind contracts (API / lib / data / external / job /
/// cron / event) are EXEMPT — they don't have JSX targets.
///
/// Returns `Vec<JsxAlignmentError>` (empty = all OK).
pub fn validate_jsx_alignment(
    repo_root: &std::path::Path,
    contracts: &[ContractRecord],
) -> Vec<JsxAlignmentError> {
    let mut errors = Vec::new();

    for c in contracts {
        if c.level != "L4" || c.kind != "UI" {
            continue;
        }
        // Empty code_ranges = exempt (Beat 1 a1000000 starts with empty body/ranges).
        if c.code_ranges.is_empty() {
            continue;
        }

        for range in &c.code_ranges {
            let file_path = repo_root.join(&range.file);

            // Missing file = silent skip (ambient contracts may reference
            // future scaffolding not yet created in the demo repo).
            let source = match std::fs::read_to_string(&file_path) {
                Ok(s) => s,
                Err(_) => {
                    eprintln!(
                        "[jsx-align] skipping missing file: {} (uuid: {})",
                        file_path.display(),
                        c.uuid
                    );
                    continue;
                }
            };

            if let Err(reason) =
                check_single_jsx_element(&source, range.start_line, range.end_line)
            {
                errors.push(JsxAlignmentError {
                    uuid: c.uuid.clone(),
                    file: range.file.clone(),
                    start_line: range.start_line,
                    end_line: range.end_line,
                    reason,
                });
            }
        }
    }

    errors
}

/// Check that lines `[start_line, end_line]` (1-indexed, inclusive) in
/// `source` contain exactly one top-level JSX element.
///
/// Returns `Ok(())` on success or `Err(reason)` on violation.
fn check_single_jsx_element(source: &str, start: usize, end: usize) -> Result<(), String> {
    let lines: Vec<&str> = source.lines().collect();
    let total_lines = lines.len();

    if start == 0 || start > total_lines {
        return Err(format!(
            "start_line {} is out of range (file has {} lines)",
            start, total_lines
        ));
    }

    let start_idx = start - 1;
    let end_idx = (end - 1).min(total_lines - 1);
    let range_text = lines[start_idx..=end_idx].join("\n");

    let element_count = count_top_level_jsx_elements(&range_text);

    match element_count {
        0 => Err(format!(
            "lines {}-{}: range covers no JSX element (0 top-level elements found)",
            start, end
        )),
        1 => Ok(()),
        n => Err(format!(
            "lines {}-{}: range covers {} top-level JSX elements (must be exactly 1)",
            start, end, n
        )),
    }
}

/// Count top-level JSX elements in `text` using a depth counter.
///
/// Structural scan (not a full parser). Handles:
/// - `<Tag>...</Tag>` paired open/close
/// - `<Tag />` self-closing
/// - `{/* JSX comments */}` (brace-expression skip)
/// - `<!-- HTML comments -->` (comment skip)
/// - String literals (quote-pair skip)
///
/// Limitations: does not validate tag name matching; uses syntactic depth
/// only. Sufficient for the single-element invariant.
fn count_top_level_jsx_elements(text: &str) -> usize {
    let chars: Vec<char> = text.chars().collect();
    let len = chars.len();
    let mut i = 0;
    let mut depth: i32 = 0;
    let mut top_level_count: usize = 0;

    while i < len {
        // Skip string literals.
        if chars[i] == '"' || chars[i] == '\'' || chars[i] == '`' {
            let quote = chars[i];
            i += 1;
            while i < len {
                if chars[i] == '\\' {
                    i += 2;
                    continue;
                }
                if chars[i] == quote {
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }

        // Skip brace expressions `{...}` (includes `{/* JSX comments */}`).
        if chars[i] == '{' {
            let mut brace_depth: i32 = 1;
            i += 1;
            while i < len && brace_depth > 0 {
                if chars[i] == '{' {
                    brace_depth += 1;
                } else if chars[i] == '}' {
                    brace_depth -= 1;
                }
                i += 1;
            }
            continue;
        }

        // Skip `<!-- HTML comment -->`.
        if i + 3 < len
            && chars[i] == '<'
            && chars[i + 1] == '!'
            && chars[i + 2] == '-'
            && chars[i + 3] == '-'
        {
            i += 4;
            while i + 2 < len {
                if chars[i] == '-' && chars[i + 1] == '-' && chars[i + 2] == '>' {
                    i += 3;
                    break;
                }
                i += 1;
            }
            continue;
        }

        // JSX close tag `</…>` — decrement depth.
        if i + 1 < len && chars[i] == '<' && chars[i + 1] == '/' {
            i += 2;
            while i < len && chars[i] != '>' {
                i += 1;
            }
            if i < len {
                i += 1;
            }
            depth -= 1;
            if depth < 0 {
                depth = 0;
            }
            continue;
        }

        // JSX open tag `<Letter…` — increment depth or detect self-closing.
        if chars[i] == '<' && i + 1 < len && chars[i + 1].is_ascii_alphabetic() {
            // Scan to end of tag, watching for `/>` (self-closing).
            i += 1; // skip `<`
            let mut self_closing = false;
            while i < len {
                if chars[i] == '/' && i + 1 < len && chars[i + 1] == '>' {
                    // Self-closing: `/>`.
                    i += 2;
                    self_closing = true;
                    break;
                }
                if chars[i] == '>' {
                    i += 1;
                    break;
                }
                i += 1;
            }

            if self_closing {
                // Self-closing at root level = one complete element.
                if depth == 0 {
                    top_level_count += 1;
                }
            } else {
                // Normal open tag.
                if depth == 0 {
                    top_level_count += 1;
                }
                depth += 1;
            }
            continue;
        }

        i += 1;
    }

    top_level_count
}

#[cfg(test)]
mod tests {
    use super::*;

    const ACCOUNT_SETTINGS: &str = r#"export default function AccountSettingsPage() {
  return (
    <main className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-semibold mb-6">Account Settings</h1>
      <section className="space-y-4">
        <div>
          <label>Email</label>
          <input type="email" defaultValue="user@example.com" />
        </div>
      </section>
      <section className="mt-12 pt-8 border-t border-red-200">
        <h2 className="text-lg font-semibold text-red-700 mb-3">Danger zone</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Permanent actions affecting your account.
        </p>
        {/* Beat 1: agent adds button here */}
      </section>
    </main>
  )
}"#;

    #[test]
    fn single_section_element_passes() {
        // Lines 11-17 cover the <section className="mt-12..."> ... </section>
        let result = check_single_jsx_element(ACCOUNT_SETTINGS, 11, 17);
        assert!(result.is_ok(), "single section should pass: {:?}", result);
    }

    #[test]
    fn two_sections_fails() {
        // Lines 5-11 cover two <section> elements (space-y-4 section + partial mt-12 section).
        // Actually test a contrived two-top-level case.
        let two_elements = "<div>foo</div><div>bar</div>";
        let result = check_single_jsx_element(two_elements, 1, 1);
        assert!(result.is_err(), "two top-level divs should fail");
        let err = result.unwrap_err();
        assert!(err.contains("2 top-level"), "error should mention count: {}", err);
    }

    #[test]
    fn self_closing_element_passes() {
        let self_closing = "<input type=\"email\" />";
        let result = check_single_jsx_element(self_closing, 1, 1);
        assert!(result.is_ok(), "self-closing element should pass: {:?}", result);
    }

    #[test]
    fn empty_code_ranges_exempt() {
        let records = vec![ContractRecord {
            uuid: "a1000000-0000-4000-8000-000000000000".to_string(),
            kind: "UI".to_string(),
            level: "L4".to_string(),
            body: String::new(),
            source_file: String::new(),
            code_ranges: vec![],
        }];
        let errors = validate_jsx_alignment(std::path::Path::new("/tmp"), &records);
        assert!(errors.is_empty(), "empty code_ranges must not produce errors");
    }

    #[test]
    fn backend_kind_exempt() {
        let records = vec![ContractRecord {
            uuid: "api-uuid".to_string(),
            kind: "API".to_string(),
            level: "L3".to_string(),
            body: String::new(),
            source_file: "some/api.ts".to_string(),
            code_ranges: vec![CodeRange {
                file: "does/not/exist.tsx".to_string(),
                start_line: 1,
                end_line: 10,
            }],
        }];
        let errors = validate_jsx_alignment(std::path::Path::new("/tmp"), &records);
        assert!(errors.is_empty(), "API kind should be exempt from JSX-01");
    }

    #[test]
    fn missing_file_skipped_silently() {
        let records = vec![ContractRecord {
            uuid: "ambient-uuid".to_string(),
            kind: "UI".to_string(),
            level: "L4".to_string(),
            body: "## Intent\nSome intent.".to_string(),
            source_file: String::new(),
            code_ranges: vec![CodeRange {
                file: "src/app/nonexistent/page.tsx".to_string(),
                start_line: 1,
                end_line: 10,
            }],
        }];
        // Non-existent file should not produce an error (silent skip).
        let errors = validate_jsx_alignment(std::path::Path::new("/tmp"), &records);
        assert!(
            errors.is_empty(),
            "missing file should be skipped, not errored: {:?}",
            errors
        );
    }
}
