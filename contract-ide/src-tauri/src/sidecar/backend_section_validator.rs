//! BACKEND-FM-01 startup validator: every backend-kind contract must have
//! `## Inputs`, `## Outputs`, `## Side effects` sections present and non-empty.
//!
//! Backend kinds = `API` / `lib` / `data` / `external` / `job` / `cron` / `event`.
//! UI / `flow` kinds are EXEMPT.
//!
//! Reuses Phase 8 PROP-01's canonical `section_parser::parse_sections` — does
//! NOT duplicate parser logic (single source of truth for section detection).

use serde::Serialize;

use crate::sidecar::section_parser::parse_sections;

const REQUIRED_SECTIONS: &[&str] = &["inputs", "outputs", "side effects"];
const BACKEND_KINDS: &[&str] = &["API", "lib", "data", "external", "job", "cron", "event"];

/// Error record for a missing/empty required section on a backend contract.
#[derive(Debug, Serialize, Clone)]
pub struct MissingSectionError {
    pub uuid: String,
    pub source_file: String,
    pub kind: String,
    pub missing: Vec<String>,
}

/// Minimal contract record for validator input. `source_file` is for error
/// messaging only; not used for parsing.
#[derive(Debug, Clone)]
pub struct ContractRecord {
    pub uuid: String,
    pub kind: String,
    pub source_file: String,
    pub body: String,
}

/// For each backend-kind contract, assert `## Inputs`, `## Outputs`,
/// `## Side effects` are all present with non-empty bodies. Returns empty
/// `Vec` on success.
pub fn validate_backend_sections(contracts: &[ContractRecord]) -> Vec<MissingSectionError> {
    let mut errors = Vec::new();
    for c in contracts {
        if !BACKEND_KINDS.iter().any(|&k| k == c.kind) {
            continue;
        }

        let sections = match parse_sections(&c.body) {
            Ok(map) => map,
            Err(e) => {
                errors.push(MissingSectionError {
                    uuid: c.uuid.clone(),
                    source_file: c.source_file.clone(),
                    kind: c.kind.clone(),
                    missing: vec![format!("<parse error: {e}>")],
                });
                continue;
            }
        };

        let missing: Vec<String> = REQUIRED_SECTIONS
            .iter()
            .filter(|&&name| match sections.get(name) {
                None => true,
                Some(text) => text.trim().is_empty(),
            })
            .map(|s| s.to_string())
            .collect();

        if !missing.is_empty() {
            errors.push(MissingSectionError {
                uuid: c.uuid.clone(),
                source_file: c.source_file.clone(),
                kind: c.kind.clone(),
                missing,
            });
        }
    }
    errors
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(kind: &str, body: &str) -> ContractRecord {
        ContractRecord {
            uuid: "u1".into(),
            kind: kind.into(),
            source_file: "f.md".into(),
            body: body.into(),
        }
    }

    #[test]
    fn complete_backend_passes() {
        let body =
            "## Intent\nDo X.\n\n## Inputs\n- foo\n\n## Outputs\n- bar\n\n## Side effects\n- writes db";
        assert!(validate_backend_sections(&[record("API", body)]).is_empty());
    }

    #[test]
    fn missing_inputs_fails() {
        let body = "## Outputs\n- bar\n\n## Side effects\n- writes db";
        let errs = validate_backend_sections(&[record("API", body)]);
        assert_eq!(errs.len(), 1);
        assert!(errs[0].missing.contains(&"inputs".to_string()));
    }

    #[test]
    fn empty_body_fails() {
        let body =
            "## Intent\nDo X.\n\n## Inputs\n\n## Outputs\n- bar\n\n## Side effects\n- writes db";
        let errs = validate_backend_sections(&[record("API", body)]);
        assert_eq!(errs.len(), 1);
        assert!(errs[0].missing.contains(&"inputs".to_string()));
    }

    #[test]
    fn ui_kind_exempt() {
        assert!(validate_backend_sections(&[record("UI", "## Intent\nfoo")]).is_empty());
    }

    #[test]
    fn flow_kind_exempt() {
        assert!(validate_backend_sections(&[record("flow", "## Intent\nfoo")]).is_empty());
    }

    #[test]
    fn lib_kind_required() {
        let body = "## Intent\nDo X.\n\n## Inputs\n- foo";
        let errs = validate_backend_sections(&[record("lib", body)]);
        assert_eq!(errs.len(), 1);
        assert!(errs[0].missing.contains(&"outputs".to_string()));
        assert!(errs[0].missing.contains(&"side effects".to_string()));
    }

    #[test]
    fn external_kind_required() {
        let body = "## Intent\nDo X.";
        let errs = validate_backend_sections(&[record("external", body)]);
        assert_eq!(errs.len(), 1);
        assert_eq!(errs[0].missing.len(), 3);
    }
}
