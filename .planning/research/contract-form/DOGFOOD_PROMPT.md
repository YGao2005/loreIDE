# Dogfood derivation prompt — v2 contract form, single-node test

**This is the literal text to paste into a Claude Code session cd'd to `/Users/yang/lahacks/contract-ide/` with the `contract-ide` MCP server registered.** Everything below the fence is the prompt.

**Iteration 3** targets a different-kind node (UI L4 atom) to test generalization — see `DOGFOOD_VERDICT.md` for why.

---

```
You are deriving a contract for a single node in the Contract IDE graph.
This is a DOGFOOD TEST of the proposed v2 sectioned-markdown contract form.
The emitted contract will be read and critiqued by a fresh Claude Code
session, so emit your best honest output rather than something safe.

NODE METADATA
  uuid:  22222222-2222-2222-2222-222222222222
  level: L4
  kind:  UI            (this node is a small visual component — no HTTP slot)
  name:  DriftBadge
  code_ranges:
    - src/components/inspector/DriftBadge.tsx:1-89

STEP 1. Read the file range above (use your Read tool; do not guess source).
STEP 2. Compose a contract body in the exact sectioned-markdown form below.
STEP 3. Call the MCP tool `write_derived_contract` with { uuid, body }.

REQUIRED SECTIONS, in this order, all must appear:
  ## Intent           — 1–3 sentences; what this exists to do, in product
                        terms. Do not mention TypeScript, React, Tailwind,
                        or specific library names in Intent.
  ## Role             — 1 sentence. MUST name the broader flow or surface
                        this participates in by concrete noun — the
                        "derivation loop", "the user's cart flow", "the
                        inspector's header strip", "the drift reconcile
                        pipeline". NOT generic positioning like "sits
                        between X and Y" or "the on-disk thing". If you
                        can't name a concrete flow, this node is probably
                        misclassified.
  ## Inputs           — bullets, each: `name: type — one-line meaning`.
                        The `name: type` pair may use technical tokens
                        (primitives, type names). The `— meaning` clause
                        after the em-dash follows ## Intent's product-
                        language rules: no `sidecar`, `frontmatter`,
                        `hash`, structural layout details ("without the
                        leading header block"), or library names.
  ## Outputs          — bullets; what is returned / emitted / rendered.
                        Same per-bullet meaning rule as Inputs: the
                        literal return-value names may be precise; the
                        meaning clause stays in product language.
  ## Invariants       — bullets; properties ALWAYS true regardless of input.
                        MANDATORY: every invariant bullet MUST end with a
                        line-number citation in the form `(line N)` or
                        `(lines M–N)` pointing at the specific source
                        lines that enforce it. If you cannot cite a
                        specific line, DO NOT write the invariant — it
                        means the property is a hope, not an invariant
                        of THIS code. Uncited invariants will be rejected
                        by the evaluator.
  ## Examples         — 1–3 Given/When/Then blocks (template below). This
                        slot is load-bearing; take time on it. Cover the
                        happy path + at least one guard / edge case.

OPTIONAL (include only if substantive; skip heading otherwise):
  ## Side Effects     — writes, network, fs, timing-sensitive behaviour.
                        Often empty for UI atoms. Skip the heading if so.
  ## Failure Modes    — how this fails and what the observable is.
                        Often empty for UI atoms. Skip the heading if so.
  ## Interaction      — for UI kind. What a user can do here (clickable,
                        keyboard flow, hover behaviour). Optional but
                        valuable for anything with an event handler.
  ## Visual States    — for UI kind. Enumerated rendering states (idle,
                        hover, loading, empty, error, disabled, etc.)
                        with one-line descriptions. Optional but valuable
                        for anything with conditional rendering.
  ## HTTP             — for API kind ONLY. This node is UI; omit entirely.
  ## Notes            — overflow; use sparingly.

EXAMPLES TEMPLATE (literal lowercase keywords):
  GIVEN <precondition state>
  WHEN  <single action>
  THEN  <observable outcome>
    AND <additional outcome, optional>

RULES
- Describe WHAT the code does in product terms, not HOW it is implemented.
- ## INTENT FORBIDDEN VOCABULARY. These tokens may NOT appear anywhere in
  ## Intent: `sidecar`, `frontmatter`, `hash`, `YAML`, `atomic`, `SHA`,
  `tempfile`, `ISO-8601`, `timestamp`, `stamp`, `metadata`, `useState`,
  `useEffect`, `prop`, `callback`, `state machine`, `Tailwind`, `className`,
  `CSS`. Implementation details — including the project's own coined terms
  like `sidecar` — belong in ## Side Effects / ## Invariants / ## HTTP,
  NOT in Intent. A non-technical stakeholder who has never opened the
  repo should be able to read ## Intent and understand what this node
  exists to do, and why it matters.
- Framework / library names are banned in ## Intent AND ## Role. They
  are fine in ## Inputs as `name: type` pairs and in ## Side Effects as
  factual descriptions.
- ## Inputs AND ## Outputs MEANING CLAUSES STAY IN PRODUCT LANGUAGE. The
  `name: type` half of each bullet is technical; the `— meaning` half
  after the em-dash follows ## Intent's rules. Example of bad meaning
  clause: `body: string — the generated body, without the leading header
  block` (leaks structural detail). Better: `body: string — the new
  contract wording to install for this node`.
- ## EXAMPLES MUST BE IN PRODUCT LANGUAGE, NOT API LANGUAGE. Every
  Given/When/Then clause describes what a user or caller is trying to
  accomplish — not internal field names, response prefix strings, or
  boolean flag names. The following tokens MUST NOT appear inside any
  GIVEN / WHEN / THEN clause:
    field names: `human_pinned`, `code_hash`, `contract_hash`, `derived_at`,
                 `code_ranges`, `frontmatter`
    response prefixes: `DONE:`, `SKIPPED-PINNED:`, `ERROR:`
    placeholder identifiers: `uuid U`, `node X`, `sidecar for uuid …`
    structural terms: `the sidecar`, `the frontmatter`, `the YAML`
  Map each to product language:
    `human_pinned: true`      → "a node's contract has been pinned by a human"
    `DONE:` / success return  → "the caller is told the contract was updated"
    `SKIPPED-PINNED:`         → "the writer is told the contract is pinned and was left unchanged"
    `ERROR:` with cause       → "the writer is told the update failed, and why"
    `uuid U` / `node X`       → "a node" / "the node" / "the target node"
  The raw implementation tokens belong in ## Outputs and ## Failure Modes,
  where naming them precisely is the whole point of those sections.
- ## Invariants line citations are MANDATORY (not optional habit). If a
  property is true but no specific source line enforces it, it does not
  belong in Invariants. Move it to Notes, or delete it.
- Each Example block uses one-action-per-WHEN. Multi-step flows go into
  multiple Example blocks, not one block with many WHENs.
- Examples take priority over Notes; when in doubt, write a scenario.

SELF-REVIEW BEFORE EMITTING — MANDATORY
Before you call write_derived_contract, run these two checks:

1. NON-CODER READ CHECK. Re-read ONLY ## Intent and ## Examples (ignore
   every other section for this step). Imagine the reader is a non-
   technical stakeholder — a product manager or designer — who has never
   opened the repo and does not know TypeScript, React, YAML, SHA-256,
   what a "sidecar" is, or how MCP works. Ask yourself:
     - Could they explain, in their own words, what this node exists to do?
     - Could they describe at least one scenario in which it matters?
   If the answer to either is "no," rewrite ## Intent and/or ## Examples
   in product language until it is "yes."

2. INVARIANT CITATION CHECK. Re-read ## Invariants. For every bullet,
   confirm it ends with `(line N)` or `(lines M–N)` and that those line
   numbers fall within the declared code_ranges. Remove any bullet that
   lacks a citation or cites a line outside the range — it is a hope,
   not an invariant.

The other sections stay as-is. These self-review steps are part of the
task — skipping either is a failure mode the evaluator is specifically
watching for.

OUTPUT
Call `write_derived_contract` with the full body — AFTER running both
self-review steps above. Do not wrap it in code fences. The body starts
with `## Intent` on line 1. Do not include the frontmatter — the tool
preserves it.

After the tool returns, STOP. Do not retry, do not second-guess, do not
proactively refine. A human evaluator will critique the output next.
```

---

## After the session runs

1. The stub at `contract-ide/.contracts/22222222-2222-2222-2222-222222222222.md` will have a body.
2. Run: `cat contract-ide/.contracts/22222222-2222-2222-2222-222222222222.md` to see the result.
3. Proceed to `DOGFOOD_EVAL.md` for the cold-eval instructions. **Update the eval prompt's target paths** — it currently references `11111111-...md` and `write_derived_contract.ts:31-98`; swap to `22222222-...md` and `src/components/inspector/DriftBadge.tsx:1-89` before pasting into the eval session.
