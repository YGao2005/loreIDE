//! Shared types for the supersession engines (12-02 + 12-03 + 12-04).
//!
//! Every downstream Phase 12 plan imports from this module — keep it stable.

use serde::{Deserialize, Serialize};

/// Three-way intent-drift verdict per validated `prompt.md`.
/// Confidence calibration: ≥ 0.85 auto-apply / 0.50–0.85 surface / < 0.50 noise.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Verdict {
    Drifted,
    NotDrifted,
    NeedsHumanReview,
}

impl Verdict {
    /// String form used in SQLite CHECK constraint + DB writes.
    pub fn as_db_str(&self) -> &'static str {
        match self {
            Verdict::Drifted => "DRIFTED",
            Verdict::NotDrifted => "NOT_DRIFTED",
            Verdict::NeedsHumanReview => "NEEDS_HUMAN_REVIEW",
        }
    }

    pub fn from_db_str(s: &str) -> Option<Self> {
        match s {
            "DRIFTED" => Some(Verdict::Drifted),
            "NOT_DRIFTED" => Some(Verdict::NotDrifted),
            "NEEDS_HUMAN_REVIEW" => Some(Verdict::NeedsHumanReview),
            _ => None,
        }
    }
}

/// Per-decision verdict parsed from a single LLM batch line.
/// `id` is the placeholder identifier sent to the LLM (e.g., "d1") — caller
/// maps back to substrate_nodes.uuid via the prompt-emitted ordering.
#[derive(Debug, Clone, Serialize)]
pub struct ParsedVerdict {
    pub id: String,
    pub verdict: Verdict,
    pub reasoning: String,
    pub confidence: f64,
}

/// In-memory representation of a substrate_node row, sufficient for both
/// fact engine (read for candidate comparison) and intent engine (read for
/// descendant judging). Mirrors the schema from Phase 11 (v6) + Phase 12 (v7)
/// — does NOT include every column on disk; engines that need more should
/// project additional columns explicitly.
#[derive(Debug, Clone, sqlx::FromRow, Serialize)]
pub struct SubstrateNode {
    pub uuid: String,
    pub node_type: String,
    pub text: String,
    pub scope: Option<String>,
    pub applies_when: Option<String>,
    pub valid_at: String,
    pub invalid_at: Option<String>,
    pub expired_at: Option<String>,
    pub invalidated_by: Option<String>,
}

/// Walker output for `intent_engine` — adds level info from the contract DAG.
#[derive(Debug, Clone)]
pub struct DescendantNode {
    pub node: SubstrateNode,
    /// The contract uuid this substrate node anchors to (for provenance).
    pub anchor_contract_uuid: String,
    /// Depth from the priority-shift's `new_l0_uuid` (1..=max_depth).
    pub depth: u32,
}

/// Aggregate result of one `propagate_intent_drift` run.
#[derive(Debug, Clone, Default, Serialize)]
pub struct IntentDriftResult {
    pub judged: u32,
    pub drifted: u32,
    pub surfaced: u32,
    pub filtered: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verdict_round_trips_through_db_str() {
        for v in [Verdict::Drifted, Verdict::NotDrifted, Verdict::NeedsHumanReview] {
            assert_eq!(Verdict::from_db_str(v.as_db_str()), Some(v));
        }
    }

    #[test]
    fn unknown_verdict_string_is_none() {
        assert_eq!(Verdict::from_db_str("MAYBE"), None);
    }

    #[test]
    fn verdict_serializes_in_screaming_snake_case() {
        let json = serde_json::to_string(&Verdict::NeedsHumanReview).unwrap();
        assert_eq!(json, "\"NEEDS_HUMAN_REVIEW\"");
    }
}
