use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// The 5 typed substrate node kinds per kernel-experiment schema (SUB-03).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NodeType {
    Constraint,
    Decision,
    OpenQuestion,
    ResolvedQuestion,
    Attempt,
}

impl NodeType {
    pub fn as_db_str(&self) -> &'static str {
        match self {
            NodeType::Constraint => "constraint",
            NodeType::Decision => "decision",
            NodeType::OpenQuestion => "open_question",
            NodeType::ResolvedQuestion => "resolved_question",
            NodeType::Attempt => "attempt",
        }
    }
}

/// Confidence per kernel-experiment binary.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Confidence {
    Explicit,
    Inferred,
}

/// Source actor — who produced the substrate node.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Actor {
    User,
    Claude,
    Derived,
}

/// SubstrateNode mirroring substrate_nodes columns.
/// Phase 12 plan 12-01 will ALTER-add intent_drift_state, intent_drift_confidence,
/// intent_drift_reasoning, intent_drift_judged_at, intent_drift_judged_against — those
/// fields ABSENT here per Phase 11/12 schema coordination.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SubstrateNode {
    pub uuid: String,
    pub node_type: String,
    pub text: String,
    pub scope: Option<String>,
    pub applies_when: Option<String>,

    pub source_session_id: Option<String>,
    pub source_turn_ref: Option<i64>,
    pub source_quote: Option<String>,
    pub source_actor: Option<String>,

    pub valid_at: String,
    pub invalid_at: Option<String>,
    pub expired_at: Option<String>,
    pub created_at: String,

    pub confidence: String,
    pub episode_id: Option<String>,
    pub invalidated_by: Option<String>,

    /// JSON array (string-encoded) of contract atom UUIDs this substrate node speaks to.
    /// Phase 11-03 retrieval JOINs json_each(anchored_uuids) with the lineage uuid set
    /// to filter cousins out at FTS5 candidate-selection time. CONTEXT lock invariant.
    /// Defaults to '[]' if the distiller couldn't infer anchors.
    pub anchored_uuids: String,
}

/// SubstrateEdge mirroring substrate_edges columns.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SubstrateEdge {
    pub id: String,
    pub source_uuid: String,
    pub target_uuid: String,
    pub edge_type: String,
    pub created_at: String,
}

/// One node extracted by the distiller LLM call.
/// Plan 11-02 deserializes this from claude -p --json-schema structured_output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistillerOutputNode {
    #[serde(rename = "type")]
    pub node_type: NodeType,
    pub text: String,
    pub scope: Option<String>,
    pub applies_when: Option<String>,
    pub source: DistillerOutputSource,
    pub confidence: Confidence,
    /// Optional list of contract atom UUIDs the LLM thinks this substrate node anchors to.
    /// Phase 11-02 distiller passes the candidate atom UUIDs in scope as part of the prompt;
    /// LLM emits this field. If absent OR empty, Phase 11-02 falls back to the session's
    /// repo-level lineage rollup (atoms whose parent surfaces appear in touched files).
    #[serde(default)]
    pub anchored_atom_uuids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistillerOutputSource {
    pub quote: String,
    pub actor: Actor,
}

/// Top-level wrapper of distiller LLM output (matches `{"nodes": [...]}` schema).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistillerOutput {
    pub nodes: Vec<DistillerOutputNode>,
}

/// Dead-letter row for episodes that failed distillation.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DeadLetter {
    pub id: String,
    pub episode_id: String,
    pub error_kind: String,
    pub raw_output: Option<String>,
    pub attempt_count: i64,
    pub last_attempt_at: String,
}
