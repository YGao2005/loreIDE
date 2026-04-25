pub mod candidates;
pub mod rerank;
pub mod scope;

use crate::distiller::types::SubstrateNode;
use serde::{Deserialize, Serialize};

/// Hit returned to Plan 11-04 Delegate UI overlay rows.
/// Includes the rubric_label (first 60 chars of text) and truncated applies_when (60 chars)
/// per CONTEXT lock for the composing-overlay row format.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubstrateHit {
    pub uuid: String,
    pub node_type: String,
    pub rubric_label: String,             // first 60 chars of text
    pub applies_when_truncated: String,   // first 60 chars of applies_when
    pub text: String,
    pub applies_when: Option<String>,
    pub scope: Option<String>,
    pub confidence: String,
    pub source_session_id: Option<String>,
    pub source_turn_ref: Option<i64>,
    pub source_quote: Option<String>,
    pub scope_used: ScopeUsed,
}

/// Which retrieval scope was used to produce these candidates.
/// Exposed on SubstrateHit so the Plan 11-04 overlay can render
/// the 'Broad search — no scoped hits' badge when Broad fires.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScopeUsed {
    /// Scoped retrieval succeeded (anchored JOIN returned >= 3 candidates).
    Lineage,
    /// Zero-hit fallback fired (anchored JOIN returned < 3); fell back to
    /// broad FTS5 search across ALL current-truth substrate.
    Broad,
}

impl SubstrateHit {
    pub fn from_node(node: SubstrateNode, scope_used: ScopeUsed) -> Self {
        let rubric_label = node.text.chars().take(60).collect::<String>();
        let applies_when_truncated = node
            .applies_when
            .as_deref()
            .unwrap_or("")
            .chars()
            .take(60)
            .collect::<String>();
        Self {
            uuid: node.uuid,
            node_type: node.node_type,
            rubric_label,
            applies_when_truncated,
            text: node.text,
            applies_when: node.applies_when,
            scope: node.scope,
            confidence: node.confidence,
            source_session_id: node.source_session_id,
            source_turn_ref: node.source_turn_ref,
            source_quote: node.source_quote,
            scope_used,
        }
    }
}
