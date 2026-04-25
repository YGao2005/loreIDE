# Research Brief: Contract Form

**Created:** 2026-04-24
**Status:** open
**Deciding:** Before self-contracting the IDE / before Phase 7 (drift detection) / before Phase 8 (agent loop consumes contracts in prompts)
**Owner (human):** Yang

---

## Why we're pausing here

Phase 6 pivot just shipped. The derivation pipeline now writes contracts as **free-form prose paragraphs** in the `.contracts/<uuid>.md` body — whatever 2–4 sentences the LLM generates. This is the cheapest form to produce, and the FTS5 index consumes it fine today at 2-node demo scale.

Concern: free prose doesn't scale or maintain well. At 500 nodes you can't systematically ask "which components are missing invariants?" or "show every API surface whose output shape is undocumented." Prose diffs are noisy for cherrypick (CHRY-02). Non-coder mode (NC-01) is harder to build against unstructured text. And contract form shapes *everything* downstream: derivation prompts, FTS weighting, embedding targets, agent prompt assembly, mass-edit matching, cherrypick diffs, verification badges.

**This is likely among the hardest decisions in the project.** Cheap to get right now; expensive to migrate 500 nodes later.

The user supplied an extended design concept (`INSPIRATION.md`) that reframes the IDE as a "semantic index and review environment" sitting alongside Claude Code — with contracts captured as a byproduct of agent sessions, gradual verification states, and multiple semantic surfaces. Parts of that concept extend beyond ROADMAP v1 (hook-based intent capture, intent timeline, tiered verification); read it as framing, not spec.

## What "contract" means in this project right now

- A `.md` sidecar file per node (`.contracts/<uuid>.md`)
- YAML frontmatter with structured metadata: `format_version, uuid, kind, level, parent, neighbors, code_ranges, code_hash, contract_hash, human_pinned, route, derived_at`
- Markdown body: currently **free-form prose**, LLM-generated (`write_derived_contract` MCP tool) or human-edited
- Indexed in SQLite via FTS5 over the body for intent search
- Consumed by: Inspector (human read/edit), agent loop (Phase 8 — assembles into `claude` prompts), mass edit (Phase 9 — FTS + embedding match), drift detection (Phase 7 — hash comparison; form-agnostic)

Node taxonomy:
- **Levels:** L0 Product · L1 Flows · L2 Surfaces · L3 Components · L4 Atoms
- **Kinds:** UI · API · data · job (extensible)

Contract requirements for the form must work across BOTH levels AND kinds — a body that's good for an L0 Product isn't necessarily right for an L4 Atom, and a UI node has different semantics than an API or a data model.

## Core questions to answer (prioritized)

### 1. Representation (HIGH)
What is the body format? Pick one or propose a new one:
- **A. Free prose** (today). Low ceiling, no structure.
- **B. Sectioned markdown** with conventional headers (`## Intent`, `## Inputs`, `## Outputs`, `## Invariants`, `## Role`, `## Notes`). Readable, parseable, LLM-friendly.
- **C. Typed header + prose.** YAML/JSON slots for mechanical fields inside the body, free prose for nuance.
- **D. Structured DSL.** A small purpose-built language (imagine: a constrained Gherkin, or a BDD-style `GIVEN/WHEN/THEN`).
- **E. Full JSON / JSON Schema–validated.** No prose except inside `description` strings.
- **F. Something hybrid we haven't considered.**

Evaluate each against: LLM generation ease, human read/edit ease, FTS5/embedding compatibility, diff quality, validation/completeness checks, non-coder-mode UX, migration cost.

### 2. Canonical slot schema (HIGH)
Whatever representation wins, what are the slots? Candidate set:
- `intent` — one-sentence statement of what this exists to do
- `inputs` — named parameters / args / upstream dependencies
- `outputs` — return values / downstream emissions
- `invariants` — always-true properties
- `side_effects` — writes, network, fs, timing
- `failure_modes` — how this fails and what the observable is
- `role` — where this fits in the broader flow (one sentence)
- `notes` — free-form overflow
- `examples` — concrete scenarios (ties into "example-checked" verification state from INSPIRATION.md)

Which are REQUIRED vs optional? Do required slots differ by level or kind (e.g. L0 Product has `user_journeys` instead of `inputs`; an API node has `http_method + route + auth` that a UI node doesn't)?

### 3. Level and kind variation (MED-HIGH)
Is there a single schema with optional slots, or polymorphic schemas keyed on `kind` (and maybe `level`)? The Liskov trade-off: one schema = easier tooling; polymorphic = less schema distortion per node type. Lean into one, but argue from examples.

### 4. Verification state / tiered trust (MED)
INSPIRATION.md proposes three states: `verified` · `example-checked` · `assumed`. Our current `human_pinned` boolean is adjacent but narrower. Should we adopt a richer verification vocabulary? How does it surface in the Inspector? How does it affect the agent loop (Phase 8) — does an agent trust `assumed` slots less?

### 5. Relationship to neighbors (MED)
Frontmatter has `neighbors: string[]` — UUIDs only. Should contract bodies cross-reference neighbors explicitly (e.g. `## Depends on: [uuid-A] CheckoutButton` with resolved names)? This is load-bearing for agent prompt assembly (Phase 8) — the agent wants neighbor context, not just uuids.

### 6. Evolution / migration (MED)
- How do contracts version when schema changes? `format_version` exists in frontmatter — do we bump per schema change, or is it frozen for v1?
- What's the migration story when we learn the schema is wrong mid-project?
- Stale-contract signal: how does a contract signal decay? (INSPIRATION.md: "stale contracts — worse than no contracts")

### 7. Intent-capture hook integration (LOW for v1, but design for it)
INSPIRATION.md's central mechanism: hooks harvest intent from Claude Code sessions, propose contract-worthy statements. Phase 8 (PostToolUse hook) exists in our ROADMAP. The form decision we make now should not block a future intent-capture path where the source is session dialogue, not source code.

## Prior art to investigate

At least skim each; cite the ones that most inform the decision. Not all are good fits — the research should say so.

### Formal / mechanical specification
- **Design by Contract (Eiffel)** — preconditions, postconditions, invariants; the academic root. Note Eiffel-grade soundness is not our bar.
- **TLA+** — temporal logic; overkill for product behavior but instructive on invariants
- **Dafny** — verified-programs school; same note
- **Contracts (Racket)** — pragmatic runtime contracts; look at their taxonomy

### Interface specification
- **OpenAPI / Swagger** — strongest prior art for API-kind nodes; what slots does it require?
- **JSON Schema** — if we go structured, this is the obvious vocabulary
- **Protobuf / gRPC IDL** — schema-first API design; what does it get right/wrong
- **GraphQL SDL** — includes descriptions inline with types; note the prose+structure balance

### Documentation conventions
- **JSDoc / TSDoc / rustdoc / pydoc** — decades of convention on `@param`, `@returns`, `@throws`. What sticks, what doesn't.
- **ADRs (Architecture Decision Records)** — markdown with conventional sections (Context / Decision / Consequences). A strong fit for the "prose with structure" middle ground.
- **C4 model** — levels of architectural abstraction; informs our L0-L4 taxonomy
- **RFC format** (IETF / internal tech RFCs) — long-form proposals with canonical sections

### Behavior-driven
- **Gherkin / Cucumber (GIVEN/WHEN/THEN)** — structured-but-readable; ties to "example-checked" verification
- **Pact (contract testing)** — bidirectional provider/consumer contracts; different use case but useful framing
- **Storybook CSF** — for UI-kind nodes specifically, how components get described

### Natural-language / LLM-adjacent
- **Model Cards / Dataset Cards (Mitchell et al.)** — structured documentation for ML artifacts; good example of "slots with prose inside"
- **Semantic Parsing / NL→formal research** — if representation needs to survive LLM generation reliably, what's known about LLM compliance with templated output

### Agent / MCP ecosystem
- **MCP Tool schemas** — our own sidecar uses zod + JSON schema; could contracts leverage the same vocabulary
- **Anthropic constitutional AI / tool-use patterns** — how structured output actually behaves in 2026-era models

### Things to watch for (not prior art, but considerations)
- **Token budget for agent prompts.** If contracts become part of Phase 8's prompt assembly, per-contract size matters. Sectioned markdown is ~2x the tokens of bare prose.
- **Diff quality.** Cherrypick (CHRY-02) shows contract diffs to users. Structured slots diff cleanly; flowing prose doesn't.
- **Editability for non-coders.** NC-01 Non-Coder Mode asks non-technical users to edit. A form field ("What invariants does this maintain?") is easier than a blank textarea.
- **The Bitter Lesson.** If the form is too rigid, we fight the LLM; too loose, we lose the structure gain. Find the affordance, not the restriction.

## Deliverable

Produce `.planning/research/contract-form/RESEARCH.md` with the following structure. Be thorough — this is load-bearing. The research session will have a fresh 200k context window; use it.

```markdown
# Contract Form Research

## Executive Summary
[1 paragraph: the recommendation, the core tradeoff, what this unlocks]

## Problem Framing
[Concise restate. Why form matters. What downstream consumers need from it.]

## Prior Art Survey
[Each relevant source: 1 paragraph on what it is, 1 on what we'd borrow/reject, 1 on why. Include a short table at the end with "adopt / adapt / reject" verdicts.]

## Representation Options Analyzed
[A through F from BRIEF.md. Concrete example of the SAME node rendered in each form — pick one real node from .planning/ or contract-ide/ source. Score each against the evaluation criteria.]

## Recommended Schema
[The proposed canonical slot set. Which are required, which optional, per-kind variations. Include a complete example for each kind × level combination that matters (UI-L3, API-L3, data-L2, job-L2, L0 Product, L1 Flow).]

## Verification State Model
[Response to Question 4. If adopting tiered states, define transitions. If sticking with `human_pinned`, justify.]

## Open Questions / Flagged Uncertainty
[What we genuinely don't know. What would need a second pass after implementation. Unresolved tradeoffs.]

## Implementation Impact
[Concrete list of files/phases that would change. Migration path for existing 2 fixture contracts + the self-contracting that's about to start.]

## Recommended Next Steps
[The plan: what to prototype, in what order, how to validate before committing. A "small, reversible first step" that keeps future options open.]
```

## Constraints

- **Hackathon timeline.** We have finite time to demo day. Research should favor implementable, reversible choices over maximally-elegant ones.
- **Existing data.** Two real fixture contracts + whatever the user derives next. Whatever form wins must migrate those or justify a rewrite.
- **LLM reliability.** The form must be something current-gen models can consistently emit. If research finds the preferred form has a <90% compliance rate on first-pass generation, flag it.
- **FTS5 + embedding compatibility.** Don't break `find_by_intent`.
- **Backwards compatibility with pivoted Phase 6.** `write_derived_contract` currently writes `body` as a single string. The new form must be writable via that path (or the tool can be extended — design accordingly).

## How to use this brief

The research session should:
1. Read `INSPIRATION.md` and this brief end-to-end.
2. Read the relevant existing `.planning/` files (`PROJECT.md`, `ROADMAP.md`, `REQUIREMENTS.md`, `.planning/phases/06-contract-derivation/*-SUMMARY.md`, `.planning/phases/02-contract-data-layer/02-01-SUMMARY.md`).
3. Read one or two real sidecars (`contract-ide/.contracts/*.md`) to feel current reality.
4. Use WebFetch / WebSearch / mcp context7 freely for prior-art research.
5. Draft, critique own draft, revise, then commit `RESEARCH.md`.
6. If the research surfaces a second-order decision (e.g. "verification model" branches big enough for its own doc), split it out and signal.

## Ready-to-paste prompt for the new session

```
Read .planning/research/contract-form/BRIEF.md and .planning/research/contract-form/INSPIRATION.md end-to-end. Then produce .planning/research/contract-form/RESEARCH.md exactly per the deliverable spec. Be thorough — take as much context window as you need, do real prior-art research via WebFetch/WebSearch, and don't short-cut the "concrete example of the same node in each form" section. Flag uncertainty explicitly. This doc will drive the canonical contract schema for the rest of the project.
```
