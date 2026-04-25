//! Standalone copy of the canonical section parser for the section-parser-cli binary.
//!
//! This is kept in sync with `contract-ide/src-tauri/src/sidecar/section_parser.rs`.
//! The CLI is a standalone binary that cannot use a path dependency on the main crate
//! (which has cdylib/staticlib crate types that are incompatible with path deps in bins).

use std::collections::BTreeMap;

use pulldown_cmark::{Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use sha2::{Digest, Sha256};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ParseError {
    #[error("duplicate H2 heading: '{0}'")]
    DuplicateHeading(String),
}

pub fn parse_sections(body: &str) -> Result<BTreeMap<String, String>, ParseError> {
    let sections_with_bounds = collect_h2_bounds(body);

    let mut map: BTreeMap<String, String> = BTreeMap::new();
    let n = sections_with_bounds.len();
    for (i, (name, _heading_line_start, body_start)) in sections_with_bounds.iter().enumerate() {
        let body_end = if i + 1 < n {
            sections_with_bounds[i + 1].1
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
