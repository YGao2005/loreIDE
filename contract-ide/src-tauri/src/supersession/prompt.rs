//! Verbatim port of Graphiti's resolve_edge_contradictions prompt + the
//! validated intent-drift prompt from research/intent-supersession/prompt.md.
//! These templates are LOAD-BEARING — variations risk losing the explicit
//! "focus on the DECISION/CLAIM, not the rationale's wording" instructions
//! that prevent adversarial keyword false positives. Do not modify without
//! re-running the adversarial harness in 12-04 and confirming recall ≥ 80%
//! / precision ≥ 85%.

use crate::supersession::types::SubstrateNode;

/// Verbatim port of Graphiti's dedupe/invalidation prompt.
/// Source: getzep/graphiti/graphiti_core/prompts/dedupe_edges.py.
pub fn build_invalidation_prompt(
    new_node: &SubstrateNode,
    candidates: &[SubstrateNode],
) -> String {
    let candidates_block = candidates
        .iter()
        .enumerate()
        .map(|(i, c)| {
            format!(
                "  idx {i}: type={ntype} text={text:?} applies_when={aw:?} valid_at={va}",
                ntype = c.node_type,
                text = c.text,
                aw = c.applies_when,
                va = c.valid_at,
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "You are evaluating whether a NEW substrate node contradicts any of the\n\
         EXISTING_CANDIDATES below.\n\
         \n\
         A node contradicts an existing node if:\n\
         - Both make claims about the same thing AND those claims are mutually exclusive, OR\n\
         - The new node states a rule, decision, or constraint whose validity REPLACES the existing one, OR\n\
         - They disagree on a binary choice (use X vs use Y; cache TTL N vs cache TTL M)\n\
         \n\
         A node DOES NOT contradict an existing node if:\n\
         - Both can be true simultaneously\n\
         - They cover different scopes or different applies_when conditions\n\
         - The new node refines or extends without negating the existing one\n\
         \n\
         Focus on the CLAIM, not on incidental wording overlap. A node mentioning\n\
         the same keywords as another but making a different claim is NOT a contradiction.\n\
         \n\
         NEW_NODE:\n\
           type: {new_type}\n\
           text: {new_text:?}\n\
           applies_when: {new_when:?}\n\
           valid_at: {new_valid_at}\n\
         \n\
         EXISTING_CANDIDATES (idx 0..{n}):\n\
         {candidates}\n\
         \n\
         Output a JSON object with this exact shape (no markdown, no commentary):\n\
         {{\"contradicted_idxs\": [<idx values>], \"reasoning\": \"<one sentence per contradicted idx>\"}}\n\
         ",
        new_type = new_node.node_type,
        new_text = new_node.text,
        new_when = new_node.applies_when,
        new_valid_at = new_node.valid_at,
        n = candidates.len(),
        candidates = candidates_block,
    )
}

/// Verbatim system prompt from research/intent-supersession/prompt.md.
/// Used by 12-03 intent_engine. Lives here so both engines source from the
/// same module.
pub const INTENT_DRIFT_SYSTEM_PROMPT: &str = r#"You are evaluating whether a historical engineering decision is INTENT-DRIFTED under a priority shift — i.e., whether a new L0 priority would plausibly lead a reasonable team to revisit or reverse the decision.

A decision is DRIFTED if:
- It explicitly traded off against something the new L0 now values, OR
- It violates a constraint the new L0 establishes

A decision is NOT_DRIFTED if:
- It's priority-neutral (independent of either L0), OR
- It's aligned with both old and new priorities, OR
- Its rationale mentions priority-related keywords but the decision itself doesn't conflict with the new L0

Focus on the DECISION, not the rationale's wording. A rationale mentioning "faster" or "simpler" is not sufficient evidence of drift — the decision itself must conflict with the new L0."#;

/// Batch intent-drift prompt — used by 12-03. Defined here for shared access.
/// 10 decisions per call (validated batch size in research/intent-supersession/batch-prompt.txt).
pub fn build_intent_drift_batch_prompt(
    old_l0_text: &str,
    new_l0_text: &str,
    decisions: &[SubstrateNode],
) -> String {
    let decisions_block = decisions
        .iter()
        .enumerate()
        .map(|(i, d)| {
            format!(
                "d{idx}. {text}\n   rationale: {rat}",
                idx = i + 1,
                text = d.text,
                rat = d.applies_when.as_deref().unwrap_or("(none)"),
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    format!(
        "{system}\n\
         \n\
         OLD_L0: {old}\n\
         \n\
         NEW_L0: {new}\n\
         \n\
         For EACH of the {n} decisions below, output ONE JSON line in this exact format:\n\
         {{\"id\": \"d1\", \"verdict\": \"DRIFTED|NOT_DRIFTED|NEEDS_HUMAN_REVIEW\", \"reasoning\": \"<one sentence>\", \"confidence\": <float 0-1>}}\n\
         \n\
         Output exactly {n} JSON lines, nothing else. No markdown fences, no commentary.\n\
         \n\
         DECISIONS:\n\
         \n\
         {decisions}\n\
         ",
        system = INTENT_DRIFT_SYSTEM_PROMPT,
        old = old_l0_text,
        new = new_l0_text,
        n = decisions.len(),
        decisions = decisions_block,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::supersession::types::SubstrateNode;

    fn fixture_node(uuid: &str, text: &str) -> SubstrateNode {
        SubstrateNode {
            uuid: uuid.into(),
            node_type: "constraint".into(),
            text: text.into(),
            scope: Some("global".into()),
            applies_when: Some("test".into()),
            valid_at: "2026-04-24T00:00:00Z".into(),
            invalid_at: None,
            expired_at: None,
            invalidated_by: None,
        }
    }

    #[test]
    fn invalidation_prompt_includes_new_node_and_candidates() {
        let new = fixture_node("u-new", "use gRPC for service-to-service");
        let cands = vec![fixture_node("u-old", "use REST for all internal RPCs")];
        let p = build_invalidation_prompt(&new, &cands);
        assert!(p.contains("use gRPC"));
        assert!(p.contains("use REST"));
        assert!(p.contains("contradicted_idxs"));
        assert!(p.contains("Focus on the CLAIM"));
    }

    #[test]
    fn intent_drift_batch_prompt_numbers_decisions() {
        let decisions = vec![
            fixture_node("u1", "decision one"),
            fixture_node("u2", "decision two"),
        ];
        let p = build_intent_drift_batch_prompt("old", "new", &decisions);
        assert!(p.contains("d1. decision one"));
        assert!(p.contains("d2. decision two"));
        assert!(p.contains("focus on the DECISION") || p.contains("Focus on the DECISION"));
        assert!(p.contains("OLD_L0: old"));
        assert!(p.contains("NEW_L0: new"));
    }
}
