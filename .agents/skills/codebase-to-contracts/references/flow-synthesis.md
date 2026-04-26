# references/flow-synthesis.md — Stage 5a algorithm

Stage 5a synthesizes `flow-<slug>.md` contracts from the L3 trigger nodes produced in Stages 1-4. A flow's `members` list is the trigger followed by every backend node it transitively invokes, in source-code invocation order.

The output is a flow contract with `format_version: 5`, `kind: flow`, `level: L2`, and a `members:` array of >= 2 UUIDs. See [output-schema.md](output-schema.md) for the canonical flow shape.

## Inputs

- `nodes.json` from Stage 1 (every classified node with `{ uuid, kind, level, code_ranges }`).
- The frontmatter + body output from Stages 2-3 (so the LLM verification step in 5a.4 has Intent text to reason against).
- The repository's import graph (resolved on-the-fly via `@babel/parser` + path resolution, NOT precomputed — the typical 200-file Next.js repo has small enough imports that on-demand resolution is fast).

## Algorithm

### 5a.1 Identify triggers

A trigger is any node with:

- `kind: UI` AND `level: L3`, OR
- `kind: cron` (cron jobs are flow triggers), OR
- `kind: API` AND `level: L3` *if* it has no UI parent in `nodes.json` (i.e. webhook-style entry points).

For each trigger, the skill emits one flow contract (whose first `members` entry is the trigger).

### 5a.2 Resolve imports

For the trigger's source file, parse with the same Babel config from [jsx-alignment.md](jsx-alignment.md). Collect every `ImportDeclaration` source. Resolve each to an absolute file path using:

1. `paths` aliases from the repo's `tsconfig.json` (e.g., `@/lib/*` → `lib/*`).
2. Next.js conventional resolution (`./foo` → `./foo.ts` then `./foo/index.ts`).
3. Skip node_modules imports — they're external dependencies, not flow members. (Exception: explicitly-marked `external` kind nodes for Stripe, Mailchimp, etc. — those WERE classified in Stage 1 and DO appear in `nodes.json` as wrapping `lib/` files.)

### 5a.3 Filter to known UUIDs

For each resolved import path, look up the node in `nodes.json` whose `code_ranges[0].file` matches. If found, the import is a flow-relevant edge. Drop unmatched imports — they're either utility helpers below the contract threshold or out-of-scope.

### 5a.4 AST-walk for invocation order

Within the trigger's source file, walk the AST in source order and collect call sites (`CallExpression` nodes) whose callee resolves to one of the imported flow members. Append each unique callee UUID to the candidate `members` list as it's first encountered.

Then **recurse one level**: for each backend member, repeat 5a.2-5a.3 starting from that member's source file. Append newly discovered UUIDs in invocation order. Stop after one level — deeper recursion produces flows that are technically complete but unreadable. Phase 13's `FlowChainLayout` renders flows as a vertical chain; a 5+ deep chain is a UX liability.

Cross-flow shared services (e.g., Stripe wrappers, `db.user.update` helpers) participate in multiple flows. They are emitted ONCE as canonical sidecars (during Stage 2-3) and referenced by the same UUID in every flow's `members` list. This is the design — the canvas's "this service participates in N flows" view depends on UUID stability across flows.

### 5a.5 LLM verification

The naive AST-walk produces a *plausible* member ordering, but real codebases have early-returns, conditional branches, and async fan-out that obscure invocation order. To catch the worst mis-orderings, run a single `claude -p --json-schema schemas/flow.json` call:

```text
Prompt:
  Given the trigger's ## Intent text, the candidate members list with each
  member's ## Intent, and the source code of the trigger file, return a
  member ordering that matches the actual invocation flow.

Schema (flow.json):
  { members: [uuid...], notes: string }
```

The model returns either the same ordering (most common) or a re-ordered list. The skill ALSO accepts the `notes` field which becomes the `## Notes` body section of the flow contract (the human-readable invocation walkthrough — see the delete-account exemplar for the format).

If the LLM-returned ordering doesn't match the AST-walked ordering as a subset (i.e., it adds or drops UUIDs), the skill prefers the AST result and notes the disagreement in `.staging/diagnostics.json`. This guards against hallucinated members.

### 5a.6 Emit

Write `.staging/flow-<slug>.md` with:

- `format_version: 5`, `kind: flow`, `level: L2`.
- `uuid`: deterministic v5 from `flow:` + trigger uuid.
- `parent`: the area L1 the trigger belongs to.
- `members`: the verified ordered list.
- Body: `## Intent` (synthesized from the trigger's intent + "this flow runs when…"), `## Role`, `## Notes` (numbered invocation walkthrough from 5a.5).

## Edge cases

- **No backend imports** (a trigger that's purely presentational). Skip flow emission for this trigger; pure-UI screens don't need a flow contract.
- **Multiple triggers share the same downstream chain** (e.g., two pages both call `beginAccountDeletion`). Each trigger gets its own flow contract; the shared services appear in both flows' `members`. This is correct — flows are user-intent-shaped, not code-shape-shaped.
- **A trigger calls another trigger** (cron → API endpoint). Treat the second trigger as a regular backend member of the first flow (don't recurse into emitting another flow from inside this one).
- **Async fan-out** (`Promise.all([...])`). The order within the `Promise.all` array is the source-code order, which the AST walk preserves. Good enough for v1.

## Determinism

Flow synthesis is deterministic (modulo the LLM verification step) because:

- AST walk is in source-code order (stable).
- UUID assignment is `v5(flow: + trigger_uuid)` (stable).
- The LLM call's `members` output is verified to be a subset of the AST-walked candidates; on disagreement the AST result wins.

The single source of LLM nondeterminism is the `notes:` body text. Plan 14-04's CI smoke test asserts that re-running the skill produces byte-identical FRONTMATTER (including `members:` order); body-text diffs in the Notes section are acceptable.
