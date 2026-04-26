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

Each substrate node must be **net-new and portable**. Substrate is what the team is committing
to *now* that a future agent on a *different task* in this codebase would benefit from knowing.

**The hard test.** "If I read this node on an unrelated future task, would it change what I
do?" If no, drop it. Substrate that only makes sense inside this exact session, file, or demo
beat is noise — it erodes trust in the harvest surface.

**Skip orientation Q&A.** When the user's question is "what is X?", "how does Y work?", or
"explain Z," the agent's answer is documentation, not substrate. Do not extract nodes unless
the answer surfaces a NEW rule the team is committing to going forward.

**Skip session/demo logistics.** "Implement X live during Beat 4," "leave this empty until the
demo," "user is currently reviewing Y" — these are task-specific scheduling, not rules.

**Skip recap of already-documented state.** If the transcript merely restates what's in
CLAUDE.md, planning docs, demo scripts, or existing code, it is not net-new — drop it.
"Feature A reuses the 5 rules from feature B" is a consequence; capture the underlying rule
once where it was made, not every place it applies.

For `constraint` / `decision`: prefer ZERO nodes over weak nodes.

For `open_question` / `resolved_question`: capture only when the question itself, OR its
resolution, would matter on a *different* task. Pure scheduling questions ("should I do this
now or later?") and questions about the user's intent in the current chat are not substrate.

When in doubt: drop it.

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
