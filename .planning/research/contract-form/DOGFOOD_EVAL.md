# Dogfood evaluation — cold-eval instructions

**This document is for a FRESH Claude Code session with no access to the design conversation that produced the v2 contract form.** The eval session's job is to critique the emitted contract against the research spec — independently, not as a rubber-stamp.

---

## Setup for the fresh eval session

Paste the block below into a new Claude Code terminal cd'd to `/Users/yang/lahacks/`. Do NOT paste any of the earlier conversation. The eval session should only see the block below.

---

```
You are performing a cold evaluation of a dogfood test result for the
Contract IDE project's proposed v2 contract form.

CONTEXT
  The project is designing a canonical form for .contracts/<uuid>.md sidecar
  files — markdown bodies that describe the intent/invariants/behaviour of
  nodes in the codebase. A research document recommended a specific sectioned
  form (Option F). A dogfood test was just run: one real node derived using
  the proposed form's prompt template.

  You have no stake in the recommendation. Your job is to read the emitted
  contract honestly and report whether the form delivers what was promised.

READ, IN THIS ORDER
  1. .planning/research/contract-form/RESEARCH.md — especially the
     "Recommended Schema" section (canonical slot set + per-kind additions
     + per-level overrides) and the "Validation before committing the v2
     schema at scale" bullet list.
  2. contract-ide/src/components/inspector/DriftBadge.tsx lines 1–89 —
     the actual source the contract was derived from.
  3. contract-ide/.contracts/22222222-2222-2222-2222-222222222222.md —
     the emitted contract to evaluate.

EVALUATE AGAINST THESE CRITERIA
  A. Slot completeness. Does the body contain every required section for
     (kind=UI, level=L4)? Per RESEARCH.md: Intent, Inputs, Outputs,
     Invariants required at minimum; Role optional at L4; Examples
     optional-but-load-bearing; Side Effects + Failure Modes often
     omitted for atoms; Interaction + Visual States optional UI additions.
     HTTP slot must NOT appear (that's API-only).

  B. Slot discipline. Does each present section do real work, or is it
     filler? Specifically:
       - Intent: product-terms, no framework/library vocabulary, no
         project-coined terms like "sidecar" or "frontmatter"?
       - Role (if present): names a concrete broader flow by noun
         ("the derivation loop", "the inspector's header strip") — NOT
         generic positioning like "sits between X and Y"?
       - Inputs: name/type/meaning triples. The `name: type` may be
         technical; the `— meaning` clause after the em-dash must stay
         in product language (no leaked structural detail like
         "without the leading header block").
       - Outputs: same meaning-clause rule as Inputs.
       - Invariants: MANDATORY line-number citations `(line N)` or
         `(lines M–N)` pointing at source. Each invariant should be
         falsifiable against the cited lines. Uncited invariants or
         citations outside the declared code_range should be flagged.
       - Examples: Given/When/Then shape honoured? Product-language
         (no field names like `human_pinned`, no response prefixes
         like `DONE:` / `ERROR:`)? Scenarios catch real behaviour
         (happy path + at least one guard/edge case)?

  C. Non-leakage. Does Intent stay in product terms, or does it spill
     implementation details ("uses SHA-256", "holds the state machine",
     "calls useEffect")? Do Inputs/Outputs per-bullet meaning clauses
     stay clean? The prompt explicitly forbade framework words AND
     project-coined terms in Intent; did the LLM respect this?

  D. Agent-loop usefulness. Imagine this contract is one of 10 neighbours
     assembled into a Phase 8 agent prompt. Is it self-contained enough
     that the agent could act on it without re-reading the source?
     Specifically: could the agent propose a code change that respects
     the invariants without guessing?

  E. Non-coder readability. Imagine a non-technical user reading only
     ## Intent and ## Examples. Would they understand what this node
     does and when it applies? (Per NONC-01, Copy Mode will hide the
     technical sections.)

  F. Compliance-rate signal. BRIEF.md set a ≥90% first-pass compliance
     threshold. If we generated 10 of these, based on THIS sample, would
     you expect at least 9 to be this good — or is this one a fluke?
     State a point estimate.

OUTPUT FORMAT
  Structured verdict, one section per criterion:
    A. SLOT COMPLETENESS — PASS / PARTIAL / FAIL, with citations.
    B. SLOT DISCIPLINE    — one line per slot, verdict + evidence.
    C. NON-LEAKAGE        — PASS / PARTIAL / FAIL, specific examples.
    D. AGENT USEFULNESS   — PASS / PARTIAL / FAIL, reasoning.
    E. NON-CODER READ     — PASS / PARTIAL / FAIL, reasoning.
    F. PROJECTED COMPLIANCE — a number (e.g. 7/10, 9/10) + 1-line defence.

  Then:
    TOP THREE PROMPT REFINEMENTS — concrete textual changes to the
      prompt in DOGFOOD_PROMPT.md that would most improve the next
      derivation.
    LAUNCH DECISION — one of:
      READY     — v2 can be committed; migrate fixtures + rewrite the
                  derivation prompt for real use.
      REFINE    — the form is right but the prompt needs 1–2 iterations
                  before committing. State what's missing.
      RETHINK   — the form itself is weaker than hoped; specific aspect
                  to reconsider (e.g. "## Examples in Gherkin is wrong
                  for this kind of node").

Be honest. A REFINE verdict is a better outcome than a false READY.
The research document was written by the same agent family that will
critique it; resist confirmation bias.

Write under 600 words total.
```

---

## If you want a second opinion

Run the same eval prompt in a second fresh session — disagreement between two cold evaluators is stronger signal than one. Don't let them see each other's critiques.

## Follow-ups based on the verdict

- **READY:** migrate the two `/tmp/phase6-uat` fixtures to v2 form; rewrite `list_needing_derivation.ts` prompt; flip `format_version: 2`; commit.
- **REFINE:** update `DOGFOOD_PROMPT.md` with the evaluator's top three refinements; re-run the dogfood (delete the emitted body from the stub, re-paste); re-evaluate in a fresh session.
- **RETHINK:** open a design thread in `.planning/research/contract-form/` addressing the specific concern; do not commit v2 yet.
