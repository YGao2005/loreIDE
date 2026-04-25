//! Defensive parsers for LLM verdict responses.
//! Same defensive-parsing concern as Phase 8 receipt parser — claude -p
//! occasionally drops or truncates output. Tolerate malformed input;
//! never panic; log skipped lines.

use crate::supersession::types::{ParsedVerdict, Verdict};

/// Parse the invalidation prompt's JSON object response.
/// Expected: {"contradicted_idxs": [int], "reasoning": "..."}.
/// Returns the contradicted candidate indexes; empty vec on parse failure
/// (caller logs and treats as "no contradictions found" — fail-safe).
pub fn parse_invalidation_response(raw: &str) -> Result<Vec<usize>, String> {
    // Strip markdown fences if present (LLMs sometimes wrap JSON despite the prompt).
    let cleaned = raw
        .lines()
        .filter(|l| !l.trim_start().starts_with("```"))
        .collect::<Vec<_>>()
        .join("\n");

    // Try to parse as a JSON object.
    match serde_json::from_str::<serde_json::Value>(cleaned.trim()) {
        Ok(v) => {
            let arr = v
                .get("contradicted_idxs")
                .and_then(|x| x.as_array())
                .ok_or_else(|| {
                    eprintln!(
                        "[supersession] invalidation response missing contradicted_idxs: {raw}"
                    );
                    "missing contradicted_idxs".to_string()
                })?;
            let idxs: Vec<usize> = arr
                .iter()
                .filter_map(|x| x.as_u64().map(|n| n as usize))
                .collect();
            Ok(idxs)
        }
        Err(e) => {
            eprintln!("[supersession] invalidation response parse failed ({e}): {raw}");
            Ok(vec![]) // fail-safe: treat as no-contradictions
        }
    }
}

/// Parse the three-way batch response. One JSON line per decision.
/// Tolerates blank lines, markdown fences, missing fields. On any parse
/// failure for a single line, the line is skipped and logged (no silent loss
/// — caller can compare line-count-out vs decisions-in to detect drops).
pub fn parse_three_way_batch(raw: &str) -> Result<Vec<ParsedVerdict>, String> {
    let mut out = vec![];
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("```") {
            continue;
        }
        match serde_json::from_str::<serde_json::Value>(line) {
            Ok(v) => {
                let id = v
                    .get("id")
                    .and_then(|x| x.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                let verdict_str = v
                    .get("verdict")
                    .and_then(|x| x.as_str())
                    .unwrap_or("NEEDS_HUMAN_REVIEW");
                let verdict =
                    Verdict::from_db_str(verdict_str).unwrap_or(Verdict::NeedsHumanReview);
                let confidence = v
                    .get("confidence")
                    .and_then(|x| x.as_f64())
                    .unwrap_or(0.0)
                    .clamp(0.0, 1.0);
                let reasoning = v
                    .get("reasoning")
                    .and_then(|x| x.as_str())
                    .unwrap_or("(parse fallback)")
                    .to_string();
                out.push(ParsedVerdict {
                    id,
                    verdict,
                    reasoning,
                    confidence,
                });
            }
            Err(e) => {
                eprintln!("[supersession] malformed verdict line ({e}): {line}");
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalidation_response_strips_markdown_fences() {
        let raw = "```json\n{\"contradicted_idxs\": [0, 2], \"reasoning\": \"...\"}\n```";
        assert_eq!(parse_invalidation_response(raw).unwrap(), vec![0, 2]);
    }

    #[test]
    fn invalidation_response_malformed_returns_empty() {
        let raw = "this is not JSON at all";
        assert_eq!(
            parse_invalidation_response(raw).unwrap(),
            Vec::<usize>::new()
        );
    }

    #[test]
    fn three_way_batch_parses_multiple_lines() {
        let raw = r#"{"id":"d1","verdict":"DRIFTED","reasoning":"r1","confidence":0.95}
{"id":"d2","verdict":"NOT_DRIFTED","reasoning":"r2","confidence":0.85}
{"id":"d3","verdict":"NEEDS_HUMAN_REVIEW","reasoning":"r3","confidence":0.5}"#;
        let parsed = parse_three_way_batch(raw).unwrap();
        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0].verdict, Verdict::Drifted);
        assert_eq!(parsed[1].verdict, Verdict::NotDrifted);
        assert_eq!(parsed[2].verdict, Verdict::NeedsHumanReview);
    }

    #[test]
    fn three_way_batch_skips_malformed_lines() {
        let raw = r#"{"id":"d1","verdict":"DRIFTED","reasoning":"ok","confidence":0.9}
not a JSON line at all
{"id":"d2","verdict":"NOT_DRIFTED","reasoning":"ok","confidence":0.8}"#;
        let parsed = parse_three_way_batch(raw).unwrap();
        assert_eq!(parsed.len(), 2); // malformed line skipped, others retained
    }

    #[test]
    fn three_way_batch_unknown_verdict_falls_back_to_needs_review() {
        let raw = r#"{"id":"d1","verdict":"MAYBE","reasoning":"ok","confidence":0.7}"#;
        let parsed = parse_three_way_batch(raw).unwrap();
        assert_eq!(parsed[0].verdict, Verdict::NeedsHumanReview);
    }
}
