/**
 * Contract Form v2 — canonical derivation prompt.
 *
 * Adopted 2026-04-24 after a 3-iteration dogfood test:
 *   iter 1 (API L3): 7/10 — Intent + Examples leaked impl vocabulary.
 *   iter 2 (API L3, refined):  8/10 — leakage gone; Role + Inputs nits.
 *   iter 3 (UI L4, refined):   8/10 — form generalises across kinds/levels.
 *
 * See .planning/research/contract-form/RESEARCH.md (recommended schema) and
 * .planning/research/contract-form/DOGFOOD_VERDICT.md (iteration log).
 *
 * One shared instruction string means the three call sites (MCP list tool,
 * Inspector Copy-single button, Inspector Copy-batch button) can never drift
 * apart. If you change this, you change every derivation path.
 */

/**
 * The full v2 instruction block appended to `list_nodes_needing_derivation`
 * output. The caller iterates the node list and reuses this block for every
 * node — (kind, level)-specific rules are included once here, not per-node.
 */
export const V2_DERIVATION_INSTRUCTIONS = `For each node above, derive a contract in v2 sectioned-markdown form.

STEPS PER NODE
  1. Read every file in the node's code_ranges at the specified line numbers.
  2. Compose a body in the sectioned form below.
  3. Run the two SELF-REVIEW checks at the end of this block.
  4. Call \`write_derived_contract\` with { uuid, body }.

REQUIRED SECTIONS, in order, all must appear:
  ## Intent         1–3 sentences; what this exists to do, in product
                    terms. NO library/framework vocabulary; NO project-
                    coined terms (\`sidecar\`, \`frontmatter\`, \`hash\`,
                    \`YAML\`, \`atomic\`, \`SHA\`, \`tempfile\`, \`ISO-8601\`,
                    \`timestamp\`, \`stamp\`, \`metadata\`, \`useState\`,
                    \`useEffect\`, \`prop\`, \`callback\`, \`Tailwind\`,
                    \`className\`, \`CSS\`). A non-technical stakeholder
                    reading only this section should understand what
                    the node exists to do and why it matters.
  ## Role           1 sentence. MUST name the broader flow / surface
                    this participates in by concrete noun — "the cart
                    checkout flow", "the inspector's header strip",
                    "the derivation loop". NOT generic positioning like
                    "sits between X and Y". Optional at L4 if the atom
                    has no meaningful broader flow (e.g. a pure utility).
  ## Inputs         bullets. Each: \`name: type — meaning\`. The
                    \`name: type\` pair may use technical tokens. The
                    \`— meaning\` clause after the em-dash follows Intent
                    banword rules (no \`parent\`/\`caller\`/\`consumer\`/
                    \`hook\`/\`ref\` references to surrounding code
                    structure; use "the surrounding view" / "the caller"
                    mapping to product language). No leaked structural
                    detail like "without the leading header block".
  ## Outputs        bullets; what is returned, emitted, or rendered.
                    Same per-bullet meaning-clause rules as Inputs.
  ## Invariants     bullets; properties ALWAYS true regardless of input.
                    MANDATORY: every invariant bullet MUST end with a
                    line-number citation \`(line N)\` or \`(lines M–N)\`
                    pointing at the specific source lines that enforce
                    it. If you cannot cite specific lines, DO NOT write
                    the invariant — move it to ## Notes, or delete it.
                    Uncited invariants are rejected.
  ## Examples       1–3 Given/When/Then blocks. Load-bearing; take time
                    on this. Cover the happy path + at least one guard
                    or failure case. Use PRODUCT LANGUAGE, not API
                    language. Forbidden inside GIVEN/WHEN/THEN clauses:
                      field names:      human_pinned, code_hash,
                                        contract_hash, derived_at,
                                        code_ranges, frontmatter
                      response strings: DONE:, SKIPPED-PINNED:, ERROR:
                      placeholders:     "uuid U", "node X",
                                        "sidecar for uuid …"
                      structural:       "the sidecar", "the YAML",
                                        "the frontmatter"
                    Map to product language:
                      human_pinned: true
                        → "the node's contract has been pinned by a human"
                      DONE: / success
                        → "the caller is told the contract was updated"
                      SKIPPED-PINNED:
                        → "the writer is told the contract is pinned and
                           was left unchanged"
                      ERROR: with cause
                        → "the writer is told the update failed, and why"
                      uuid U / node X → "a node" / "the target node"
                    The raw implementation tokens belong in ## Outputs
                    and ## Failure Modes, where naming them precisely is
                    the whole point of those sections.

OPTIONAL (include only if substantive; skip the heading otherwise):
  ## Side Effects   writes, network, fs, timing-sensitive behaviour.
                    Often empty for UI atoms and pure functions.
  ## Failure Modes  how this fails and what the observable is.
  ## Interaction    UI kind. What a user can do here (clickable, keyboard
                    flow, hover behaviour). Valuable for anything with
                    an event handler.
  ## Visual States  UI kind. Enumerated rendering states (idle, hover,
                    loading, empty, error, disabled). INCLUDE ONLY IF
                    it adds information beyond ## Outputs; if Outputs
                    already enumerates the render variants, skip this
                    section rather than duplicating.
  ## HTTP           API kind ONLY. For MCP tools, use:
                      Transport: MCP stdio
                      Tool name: <name>
                      Auth: <if any>
                    Keep the ## HTTP heading literal so the registry
                    still recognises the slot.
  ## Shape          data kind. Prose description of the data structure,
                    keys, types, nullability.
  ## Persistence    data kind. Where it lives (SQLite table, blob store,
                    in-memory).
  ## Trigger        job kind. What kicks it off (cron, event, manual).
  ## Schedule       job kind. If cron-triggered: the schedule + cadence.
  ## Idempotency    job kind. Whether repeat runs are safe.
  ## Notes          overflow; use sparingly.

EXAMPLES TEMPLATE (literal lowercase keywords):
  GIVEN <precondition state>
  WHEN  <single action>
  THEN  <observable outcome>
    AND <additional outcome, optional>
Multi-step flows → multiple blocks, not one block with many WHENs.

SELF-REVIEW BEFORE EMITTING — MANDATORY, BOTH CHECKS

  CHECK 1 — non-coder read.
    Re-read ONLY ## Intent and ## Examples. Imagine the reader is a
    product manager or designer who has never opened the repo and does
    not know TypeScript, React, YAML, or what a "sidecar" is.
      - Could they explain what this node exists to do?
      - Could they describe at least one scenario in which it matters?
    If either answer is "no", rewrite ## Intent and/or ## Examples in
    product language. Other sections stay as-is.

  CHECK 2 — invariant citations.
    Re-read ## Invariants. For every bullet, confirm it ends with
    \`(line N)\` or \`(lines M–N)\` AND those lines fall within the
    declared code_ranges. Remove any bullet that lacks a citation or
    cites outside the range — it's a hope, not an invariant.

Skipping either check is a failure mode the form is specifically
designed around. The form assumes both checks ran.

OUTPUT
Call \`write_derived_contract\` with the full body AFTER running both
self-review steps. Do not wrap in code fences. Body starts with
\`## Intent\` on line 1. Do NOT include the frontmatter — the tool
preserves it.

After the tool returns \`DONE:\` or \`SKIPPED-PINNED:\` or \`ERROR:\` for a
node, move on to the next. Report final done / skipped-pinned / error
counts at the end.`;

/**
 * Shorter variant for the Inspector's "Copy single prompt" button — one
 * node, pre-filled metadata, same v2 spec inlined for self-containment.
 * The Inspector can't import from this file (different workspace); the
 * production copy lives in src/components/inspector/ContractTab.tsx and
 * MUST mirror the rules here. Keep the two in sync by hand.
 */
export function singleNodeDerivationPrompt(node: {
  uuid: string;
  name: string;
  level: string;
  kind: string;
}): string {
  return `Derive a contract for this single node in v2 sectioned-markdown form.

NODE
  uuid:  ${node.uuid}
  name:  ${node.name}
  level: ${node.level}
  kind:  ${node.kind}

${V2_DERIVATION_INSTRUCTIONS}`;
}
