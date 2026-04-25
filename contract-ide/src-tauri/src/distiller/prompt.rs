//! Distillation prompt + JSON schema for the claude -p substrate-node extraction pass.
//!
//! Adapted from kernel-experiment `extraction-prompt.md` (`.planning/research/
//! constraint-distillation/extraction-prompt.md`), expanded to cover all 5 typed
//! kinds and emit the optional `anchored_atom_uuids` field (Phase 11-02 load-bearing
//! for Plan 11-03's cousin-exclusion JOIN).
//!
//! IMPORTANT: `{atom_candidates}` and `{filtered_text}` are placeholder tokens
//! replaced at call-site by `distill_episode()` via `.replace()`. Do NOT use
//! Rust format strings (`{...}` with no preceding `format!`) — the braces are
//! literal template markers, not Rust interpolation.

/// The distillation prompt injected as `-p <prompt>` to `claude --bare`.
///
/// Template placeholders (replaced at call-site):
/// - `{atom_candidates}` — rendered by `render_atom_candidates_hint()`
/// - `{filtered_text}` — the episode's filtered conversational text
pub const DISTILLER_PROMPT: &str = r#"You are extracting reusable SUBSTRATE NODES from a software-development session transcript.

A substrate node is a typed observation that should guide future work on this codebase. Substrate nodes are
**reusable** — they would save time or prevent bugs if automatically surfaced to a future
agent on a relevant task.

## Five node types

- **constraint**: A rule that must hold (e.g., "Always canonicalize file paths from JS in Rust commands")
- **decision**: A choice the team made and committed to (e.g., "We use soft-delete with 30-day grace")
- **open_question**: A question raised but not resolved in this session (e.g., "Should we cache contract bodies in MCP?")
- **resolved_question**: A question raised AND answered in this session (e.g., "Q: Use shadcn-Tabs? A: No, button strips")
- **attempt**: A pattern that was tried but didn't fully work — useful as a "don't repeat this exactly" signal

## Output schema

For each substrate node, emit ONE JSON object matching:

{
  "type": "constraint" | "decision" | "open_question" | "resolved_question" | "attempt",
  "text": "imperative or declarative statement, ONE sentence",
  "scope": "global" | "module:<path-pattern>" | "task-pattern:<short>",
  "applies_when": "semantic trigger for retrieval — be specific enough to avoid false positives, broad enough to catch paraphrases",
  "source": {
    "quote": "verbatim quote from transcript justifying this node",
    "actor": "user" | "claude" | "derived"
  },
  "confidence": "explicit" | "inferred",
  "anchored_atom_uuids": ["<atom-uuid>", ...]   // OPTIONAL — see "Anchoring" below
}

## Anchoring (load-bearing for retrieval)

Below this section is a list of CANDIDATE CONTRACT ATOM UUIDs in scope of this session — these are
contract atoms whose code or surfaces were touched during the work. For each substrate node you
extract, populate `anchored_atom_uuids` with the SUBSET of these candidates that the node directly
speaks to. Only include candidates whose contract surface or behavior the node would constrain or
inform. If the node is global (applies to no specific atom), leave `anchored_atom_uuids` empty —
a system fallback will infer it from the session's touched files.

## Quality bar

Each substrate node should answer: "Would I want this injected automatically into a future
session whose goal matches `applies_when`?" If no, drop it.

For constraint and decision nodes, prefer fewer high-quality nodes over many low-quality ones.

For open_question and resolved_question nodes, capture them whenever a question gets raised
or settled — these are higher-volume but cheap to keep.

## Candidate atom UUIDs in scope

{atom_candidates}

## Input transcript

<transcript>
{filtered_text}
</transcript>

Output: a JSON object {"nodes": [...]} containing all substrate nodes you extracted.
"#;

/// JSON schema for the `--json-schema` flag passed to `claude -p`.
/// Validates the `{"nodes": [...]}` envelope and each node's required fields.
/// The `anchored_atom_uuids` field is optional — absence triggers the repo-level
/// lineage fallback in `pipeline::distill_episode()`.
pub fn substrate_node_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "nodes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["type", "text", "applies_when", "source", "confidence"],
                    "properties": {
                        "type": {
                            "type": "string",
                            "enum": ["constraint", "decision", "open_question", "resolved_question", "attempt"]
                        },
                        "text": { "type": "string", "minLength": 1 },
                        "scope": { "type": ["string", "null"] },
                        "applies_when": { "type": "string", "minLength": 1 },
                        "source": {
                            "type": "object",
                            "required": ["quote", "actor"],
                            "properties": {
                                "quote": { "type": "string", "minLength": 1 },
                                "actor": {
                                    "type": "string",
                                    "enum": ["user", "claude", "derived"]
                                }
                            }
                        },
                        "confidence": {
                            "type": "string",
                            "enum": ["explicit", "inferred"]
                        },
                        "anchored_atom_uuids": {
                            "type": "array",
                            "items": { "type": "string" }
                        }
                    }
                }
            }
        },
        "required": ["nodes"]
    })
}

/// Render the candidate-atom-uuids hint block injected into the prompt at
/// `{atom_candidates}`. Returns a bullet-list of `(uuid, level, name)` tuples
/// or a no-candidates message if the session has no scoped atoms.
///
/// # Arguments
/// * `candidates` — Vec of `(uuid, level, name)` tuples from the nodes table,
///   capped at 50 by `load_session_atom_candidates()`.
pub fn render_atom_candidates_hint(candidates: &[(String, String, String)]) -> String {
    if candidates.is_empty() {
        return "(none — leave anchored_atom_uuids empty; system fallback applies)".to_string();
    }
    candidates
        .iter()
        .map(|(uuid, level, name)| format!("- {uuid} ({level}: {name})"))
        .collect::<Vec<_>>()
        .join("\n")
}
