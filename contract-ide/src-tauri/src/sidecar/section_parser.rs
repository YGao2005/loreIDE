//! Canonical Rust section parser for contract bodies (PROP-01).
//!
//! Parses H2-level sections from contract markdown using `pulldown_cmark`'s
//! offset_iter — which provides source-byte ranges rather than re-generated
//! text — so section bodies are source-faithful slices of the input.
//!
//! `BTreeMap` output is alphabetically sorted by section name regardless of
//! the order H2 headings appear in the input (Pitfall 1 fix: order independence
//! for stable `section_hashes`).
//!
//! Fenced-code-aware: `pulldown_cmark` only emits `Tag::Heading` for real
//! ATX/Setext headings — `## ` lines inside ` ``` ` fences do NOT trigger a
//! `Heading` event. No extra logic needed.

// Phase 8 Plan 08-01 ships this parser. It is consumed by Phase 8 Plan 08-05
// (cherrypick) and Plan 08-06 (reconcile). Allow dead-code lints on the public
// API surface that isn't called yet within this crate — it will be called once
// the remaining plans land.
#![allow(dead_code)]

use std::collections::BTreeMap;

use pulldown_cmark::{Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use sha2::{Digest, Sha256};
use thiserror::Error;

/// Errors that can occur while parsing a contract body.
#[derive(Debug, Error)]
pub enum ParseError {
    /// Two H2 sections share the same normalised name. Callers must either
    /// reject the document or merge them; this crate does neither.
    #[error("duplicate H2 heading: '{0}'")]
    DuplicateHeading(String),
}

/// Parse a contract markdown body into a `BTreeMap<section_name, section_body>`.
///
/// Keys are lowercased, trimmed H2 heading titles. Values are the
/// source-faithful bytes (trimmed) between consecutive H2 boundaries.
///
/// Returns `Err(ParseError::DuplicateHeading)` if two H2 headings share the
/// same normalised name.
pub fn parse_sections(body: &str) -> Result<BTreeMap<String, String>, ParseError> {
    let sections_with_bounds = collect_h2_bounds(body);

    let mut map: BTreeMap<String, String> = BTreeMap::new();
    let n = sections_with_bounds.len();
    for (i, (name, _heading_line_start, body_start)) in sections_with_bounds.iter().enumerate() {
        // Section body runs from body_start to the start of the next heading
        // line (or EOF).
        let body_end = if i + 1 < n {
            sections_with_bounds[i + 1].1 // heading_line_start of the next section
        } else {
            body.len()
        };

        let section_text = body[*body_start..body_end].trim().to_string();

        if map.insert(name.clone(), section_text).is_some() {
            return Err(ParseError::DuplicateHeading(name.clone()));
        }
    }

    Ok(map)
}

/// Internal: collect (normalised_name, heading_line_start, body_start) triples.
///
/// `heading_line_start` is the byte offset of the `##` character that opens
/// the heading — used as the end boundary for the *preceding* section's body.
/// `body_start` is the byte offset right after the heading's closing newline.
fn collect_h2_bounds(body: &str) -> Vec<(String, usize, usize)> {
    let parser = Parser::new_ext(body, Options::all()).into_offset_iter();

    let mut result: Vec<(String, usize, usize)> = Vec::new();
    let mut inside_h2 = false;
    let mut heading_title_buf = String::new();
    let mut heading_line_start: usize = 0;

    for (event, range) in parser {
        match event {
            Event::Start(Tag::Heading {
                level: HeadingLevel::H2,
                ..
            }) => {
                inside_h2 = true;
                heading_title_buf.clear();
                heading_line_start = range.start;
            }
            Event::Text(text) if inside_h2 => {
                heading_title_buf.push_str(&text);
            }
            Event::Code(text) if inside_h2 => {
                heading_title_buf.push_str(&text);
            }
            Event::End(TagEnd::Heading(_)) if inside_h2 => {
                inside_h2 = false;
                let body_start = range.end;
                let name = heading_title_buf.trim().to_lowercase();
                result.push((name, heading_line_start, body_start));
            }
            _ => {}
        }
    }

    result
}

/// Compute stable SHA-256 hashes for each H2 section in a contract body.
///
/// Returns a `BTreeMap<section_name, sha256_hex>` where keys are alphabetically
/// sorted (BTreeMap invariant) regardless of section order in the source.
/// This guarantees order-independent stability required by PROP-01.
pub fn compute_section_hashes(body: &str) -> Result<BTreeMap<String, String>, ParseError> {
    let sections = parse_sections(body)?;
    let hashes = sections
        .into_iter()
        .map(|(name, text)| {
            let digest = Sha256::digest(text.as_bytes());
            (name, hex::encode(digest))
        })
        .collect();
    Ok(hashes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_simple_h2_sections() {
        let body = "## Alpha\n\nFirst section text.\n\n## Beta\n\nSecond section text.\n\n## Gamma\n\nThird.\n";
        let sections = parse_sections(body).expect("parse should succeed");
        // BTreeMap keys should be alphabetically sorted.
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
        let body = "## Real Section\n\nContent.\n\n```\n## Not a heading\n```\n\n## Another Real\n\nMore.\n";
        let sections = parse_sections(body).expect("parse should succeed");
        assert_eq!(sections.len(), 2);
        assert!(sections.contains_key("real section"));
        assert!(sections.contains_key("another real"));
        assert!(!sections.contains_key("not a heading"));
    }

    #[test]
    fn compute_hashes_are_stable_across_two_calls() {
        let body = "## Intent\n\nHello world.\n\n## Examples\n\nworld\n";
        let h1 = compute_section_hashes(body).expect("first call");
        let h2 = compute_section_hashes(body).expect("second call");
        assert_eq!(h1, h2);
    }

    #[test]
    fn compute_hashes_sorted_alphabetically() {
        let body = "## Zebra\n\nZ content.\n\n## Alpha\n\nA content.\n\n## Mango\n\nM content.\n";
        let hashes = compute_section_hashes(body).expect("hashes");
        let keys: Vec<&str> = hashes.keys().map(|s| s.as_str()).collect();
        assert_eq!(keys, ["alpha", "mango", "zebra"]);
    }
}
