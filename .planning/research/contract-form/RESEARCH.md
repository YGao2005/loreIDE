# Contract Form Research

**Status:** **ADOPTED 2026-04-24** — production prompts updated in commit 8c0be74; first v2 contracts landed in commit 21f96bd; fixture migration at /tmp/phase6-uat (outside repo) also complete. See DOGFOOD_VERDICT.md for the three-iteration validation log.
**Original draft:** 2026-04-24
**Authors:** Claude (research session) · reviewed by Yang
**Decides:** the canonical shape of the body of `.contracts/<uuid>.md` sidecar files for the remainder of the Contract IDE project.

## Adoption note (2026-04-24)

The recommended v2 form (Option F — sectioned markdown + per-kind/level slot registry + Gherkin Examples) was validated through a three-iteration dogfood test before shipping.

- **Iteration 1** (API L3, write_derived_contract): 7/10 projected compliance. Failed on Intent leakage + Examples-in-API-language.
- **Iteration 2** (same node, refined prompt): 8/10. Category failures eliminated; Role genericism + Inputs meaning-clause leak remained.
- **Iteration 3** (UI L4, DriftBadge — different kind + level to test generalisation): 8/10. Iteration-2 issues did not recur; new small issues surfaced (React-hierarchy leak in Inputs, Outputs/Visual-States overlap).

Shipped on n=2 ≥8/10 across two distinct (kind, level) pairs. Each iteration surfaced DIFFERENT small issues rather than a persistent ceiling — evidence the form is converging, not stuck. The remaining iter-3 refinements (expanded Inputs banwords, Outputs/Visual-States dedup rule, hardened invariant-citation requirement) are baked into the production prompts.

### What's in production

- `contract-ide/mcp-sidecar/src/tools/prompt-v2.ts` — the authoritative `V2_DERIVATION_INSTRUCTIONS` string + `singleNodeDerivationPrompt()` helper. Used by `list_needing_derivation.ts`.
- `contract-ide/src/components/inspector/ContractTab.tsx` — mirrors the spec inline (frontend cannot import from sidecar workspace); tagged with a sync comment.
- Two reference-artifact contracts at `contract-ide/.contracts/11111111-…md` (API L3) and `…/22222222-…md` (UI L4), `format_version: 2`, `human_pinned: true`.

### What's deferred

- **Verification enum** (`verification: verified | example-checked | assumed`) proposed below. Touches Rust + TS types + scanner; independent of body-form change. Follow-up work.
- **Slot registry YAML** (`.planning/contract-schema.yml`) proposed below. Production prompts currently embed per-(kind,level) rules inline; factor into a registry when programmatic validation becomes needed.
- **Inspector per-section rendering / VerificationBadge.** UI polish. Markdown bodies render legibly as-is.

---

## Executive Summary

**Recommendation: Option B+ — Sectioned Markdown with a per-kind slot registry, ADR-style.** The contract body is markdown with a small closed set of H2 section headings (`## Intent`, `## Role`, `## Inputs`, `## Outputs`, `## Invariants`, `## Side Effects`, `## Failure Modes`, `## Notes`), and a small registry (`.planning/contract-schema.yml`) declares which slots are required for each `(level, kind)` pair. Prose is allowed inside each section; sections are optional unless the registry marks them required. A single new frontmatter field, `verification: verified | example-checked | assumed`, replaces / subsumes the existing `human_pinned` boolean.

**Core tradeoff.** Free prose (current state) is cheapest to produce but has no structure for cherrypick diffs, mass-edit matching, non-coder form rendering, or "which nodes are missing invariants?" queries. Full JSON schema maximises structure but distorts human readability, balloons token budget, and fights the LLM on conceptual nodes (L0/L1) that are genuinely prose-shaped. Sectioned markdown is the sweet spot the broader industry has already converged on for this exact problem class (ADRs, model cards, HuggingFace repo READMEs): the frontmatter YAML handles machine-consumable slots; the body handles the 80% that is fundamentally natural-language, but with enough structural affordance to be programmable.

**What this unlocks.** (1) Non-coder mode (NC-01) becomes a per-section form render instead of a blank textarea. (2) Cherrypick (CHRY-02) shows per-section diffs that read as meaning changes, not whitespace noise. (3) Mass edit (MASS-01) can weight FTS matches higher for `## Invariants` hits than `## Notes` hits. (4) Agent prompt assembly (Phase 8) can cheaply drop `## Notes` under token pressure and keep the load-bearing sections. (5) Drift detection (Phase 7) is unaffected — it is hash-based and form-agnostic.

**Academic grounding (2023–2026).** The recommendation is buttressed by four recent arXiv papers. NL2Contract (2025) validates LLM inference of pre+postcondition triads. CodeSpecBench (2026) shows SOTA LLMs hit only 20.2% pass on *executable* specs at repo-level — ruling out full-executable forms (Options D/E) and placing our "structured prose" choice squarely in the compliance sweet spot. VibeContract (2026) independently proposes near-identical product-level thesis, converting the INSPIRATION.md concept from one-author speculation to an emerging research agenda. PACT (2025) shows that *examples* outperform *descriptions* for LLM contract adherence — promoting the `## Examples` slot from "nice-to-have" to "highest-leverage slot in the body for agent-loop quality."

**Migration cost is small.** The two existing fixture contracts are both prose paragraphs that wrap cleanly as `## Intent`. A one-shot migration script + a bumped `format_version: 2` handles the upgrade. The MCP `write_derived_contract` tool is unchanged (it still accepts a `body: string`); the generation prompt simply changes to emit the sectioned form.

---

## Problem Framing

### What the form is for

The `.contracts/<uuid>.md` body is the single surface where natural-language intent lives in this project. Downstream consumers read it for seven distinct purposes, and the form must be adequate for all of them simultaneously:

| Consumer | Phase | What it needs from the body |
|----------|-------|-----------------------------|
| Human read in Inspector | 4 | Scannable; clear Role / Invariants / Inputs at a glance |
| Human edit in Inspector | 4 / 9 | Non-destructive; non-coder can edit without seeing YAML |
| FTS5 intent search | 5 (MCP) | Full-body tokens; optional section-weighted ranking |
| Embedding search | 9 (MASS-01) | Chunkable by semantic unit so similarity is meaningful |
| Agent prompt assembly | 8 | Predictable per-contract size; droppable sections under budget |
| Cherrypick diff UI | 8 (CHRY-02) | Stable line anchors; structured slots diff cleanly |
| Drift detection | 7 | Body hash only — form-agnostic |

The form must also survive two orthogonal axes of variation:

- **Level (L0 Product → L4 Atom).** An L0 Product contract describes the whole product's user journeys; an L4 Atom contract describes "this button says 'Checkout' and calls `onSubmit`". The slot set that makes an L4 contract useful (inputs, outputs, invariants) is actively wrong for an L0 contract — an L0 doesn't have "inputs" in any meaningful sense.
- **Kind (UI, API, data, job).** An API-kind node has `http_method` and `auth` slots a UI node doesn't. A data-kind node has `shape` / `schema`. A job-kind node has `trigger` / `schedule`. A UI-kind node has `interactive_surface` / `visual_state`.

### Why the decision matters now

1. **2-contract scale.** The fixtures cost nothing to migrate; the 25 committed seed contracts for `vercel/commerce` (DEMO-01) are the first scale speed bump. Decide before seeding.
2. **Shapes the Phase 6 prompt.** `list_nodes_needing_derivation` currently emits a one-line instruction ("write a 2–4 sentence contract body"). The prompt *is* the form spec. Every session run between now and the decision hardens the wrong shape.
3. **Phase 8 prompt assembly.** The agent loop (AGENT-01) constructs the prompt from "currently-zoomed node + its contract + its neighbors' contracts." Token budget per neighbor matters; sectioned markdown is a tax but one that pays off if we can drop low-value sections surgically.
4. **Phase 9 mass edit.** Embedding-similarity search needs semantic chunks. Free prose chunks arbitrarily; sectioned markdown chunks cleanly.
5. **Non-coder mode (NONC-01).** The hardest user-facing surface. A form-shaped body ("What must always be true?" → textarea) is drastically easier to build than NLU over free prose.

### What this decision does NOT decide

- **Sound formal verification.** Per INSPIRATION.md, "verified" here means "consistent with LLM's formalisation of intent," not Eiffel-grade. The verification-state vocabulary is a UX calibration knob, not a soundness claim.
- **Intent-capture hooks.** INSPIRATION.md's session-harvesting mechanism is Phase 8+ (MCP-02). We design the form so that hook-proposed contracts slot in naturally, but we do not design the hook here.
- **Authoritative contracts (AUTH-01).** Out of scope for v1.

---

## Prior Art Survey

Thirteen sources surveyed across four categories. Each gets three paragraphs: what it is, what we'd adopt vs. reject, why. Adoption verdicts table at the end.

### Formal & mechanical specification

**Design by Contract (Eiffel, Meyer 1986).** Methods declare `require` (precondition), `ensure` (postcondition), and `invariant` clauses — executable assertions the runtime checks. The three-slot taxonomy (pre / post / invariant) is *the* intellectual ancestor of this project.

*Adopt:* the three-slot mental model as the spine of per-function / per-component contracts. Rename `require`→`Inputs`, `ensure`→`Outputs`, keep `Invariants`. Also adopt Meyer's framing that invariants are load-bearing — they are what the contract promises regardless of input, and they are what a refactor must preserve.

*Reject:* executable semantics. Eiffel contracts are first-class code; ours are prose-plus-structure. A soundness-grade implementation is a multi-year research programme (see Dafny), not a hackathon feature.

*Why:* the pre/post/invariant taxonomy holds across UI, API, data, and job kinds because it is about *what the function promises*, not about how the promise is encoded. That generality is rare and precious.

**TLA+ (Lamport, 2000s).** Temporal-logic specification language; describes system behaviour as a state machine with invariants that hold across all reachable states. Specifies behaviour that transcends any one function — which is closer to our L0/L1 needs than Eiffel's per-method contracts are.

*Adopt:* the mental distinction between *state invariants* (something that's always true of the system) and *transition preconditions* (something required before a specific action fires). For L0 / L1 nodes, "invariant" means the former; for L3 / L4, it usually means the latter.

*Reject:* temporal-logic syntax. Almost no one reads TLA+; non-coders definitely won't.

*Why:* TLA+ confirms that invariants at higher levels of abstraction are different-kind things than invariants at lower levels. We surface this via per-level slot requirements, not via a separate syntax.

**Dafny (Microsoft Research, 2008–).** Verification-aware programming language — preconditions, postconditions, and loop invariants must be proven by a theorem prover before compilation. Same mental model as Eiffel but with actual proof obligations.

*Adopt:* nothing directly.

*Reject:* the entire verification path — out of scope for v1 per INSPIRATION.md "paradigm limits" section.

*Why:* honest uncertainty display (`verification: assumed | example-checked | verified`) is a better return on effort than a verified subset, given that the *corpus* for verification would be LLM-emitted prose, not formal logic.

**Racket Contracts (Findler & Felleisen, 2002).** Run-time contracts attached to module boundaries — when a contract is violated, the checker blames the module that broke the promise. Pragmatic, unopinionated, non-dependent.

*Adopt:* the boundary-blame concept is useful for Phase 8 receipts ("this contract was violated because its upstream neighbour changed shape"). Not in the form, but in the downstream tooling.

*Reject:* module-level granularity. Our granularity is node-level (which maps to function-or-smaller in Racket terms).

*Why:* Racket contracts are the most successful *pragmatic* implementation of Eiffel's vision, and their lesson for us is: the value is in the boundary annotation, not in soundness.

### Interface specification

**OpenAPI / Swagger 3.1.** Industry-standard REST API contract language. Operation objects specify `summary`, `description`, `parameters`, `requestBody`, `responses`, `security`, `tags`. Every field is JSON-serialisable and machine-consumable.

*Adopt:* for API-kind nodes (L3, sometimes L2), the slot set `http_method + route + summary + parameters + request_body + responses + auth` is directly reusable. A contract for an API node is roughly a single OpenAPI Operation Object rewritten as markdown.

*Reject:* full JSON schema for request/response bodies inside the contract body. The *shape* belongs in the code (or in a separate types file); the *contract* describes the shape's *meaning*. Copying JSON schema into a contract duplicates information that will drift.

*Why:* OpenAPI is the one place where this industry has already done the per-slot design work for API-kind nodes. Borrowing its vocabulary costs nothing and earns interoperability if we ever want to export contracts as OpenAPI stubs.

Source: [OpenAPI Specification v3.1.1](https://spec.openapis.org/oas/v3.1.1.html)

**JSON Schema.** The vocabulary underlying OpenAPI's type system. Supports nested objects, enums, one-of, required fields, descriptions inline with types.

*Adopt:* JSON Schema's `description` string field pattern is the *inverse* of what we want — prose lives inside the schema. We invert: schema lives inside the prose (as YAML frontmatter). Same information architecture, different dominant surface.

*Reject:* full-body JSON Schema representation of the contract itself (Option E). Prose-only-in-description-strings is unreadable for L0/L1 conceptual nodes and overkill for L4 atoms.

*Why:* JSON Schema is optimised for machines parsing; our dominant surface is a human reading the Inspector at 3am the night before the demo.

**Protobuf / gRPC IDL.** Schema-first API definition with strict types. Comments above each field serve as prose documentation.

*Adopt:* the convention of "structured field + docstring above it" maps cleanly onto "YAML frontmatter field + `## Intent` paragraph in the body." Same pattern, different syntax.

*Reject:* schema-as-contract. Our contract *describes* the shape; it doesn't define it.

*Why:* protobuf's lesson is that humans tolerate structure when it earns its keep via code generation. We don't generate code from contracts (AUTH-01 is v2), so structure must earn its keep through other means — diffability, search, agent prompts.

**GraphQL SDL.** Schema-first, types defined inline with descriptions. `"""Docstring"""` triple-quoted strings above types and fields. Notably includes prose and structure in the same file, rendered side-by-side in GraphiQL.

*Adopt:* the triple-quote docstring pattern is an existence proof that *prose-above-structure* works. The pattern is psychologically identical to ours (YAML frontmatter + prose body).

*Reject:* nothing directly; SDL syntax doesn't apply to our mixed kinds (UI / data / job are not graph-query shapes).

*Why:* SDL demonstrates that the prose+structure middle path is a stable design point that developers don't drift away from over time.

### Documentation conventions

**JSDoc / TSDoc / rustdoc / pydoc.** Decades of convention on structured per-symbol docs: `@param`, `@returns`, `@throws`, `@example`, `@see`. Rendered into HTML by doc generators.

*Adopt:* the slot set. `@param` ≈ `## Inputs`, `@returns` ≈ `## Outputs`, `@throws` ≈ `## Failure Modes`, `@example` ≈ `## Examples` (for Phase 8 example-checked verification). The @-tag syntax is more terse than H2 headings but less scannable; markdown wins on the Inspector side.

*Reject:* @-tag syntax. Markdown H2 headings render as first-class UI in every tool that opens a `.md` file (Finder preview, GitHub, Obsidian, etc.) without any custom tooling.

*Why:* JSDoc is the single most successful per-symbol documentation convention in software history. What sticks from it (`@param` ≡ "describe the inputs") is the exact slot set we need. What doesn't stick (`@throws` is under-used; devs forget to document error paths) is a warning that the form alone doesn't enforce completeness — we must prompt for it.

**ADRs — Architecture Decision Records (Michael Nygard, 2011).** Markdown file per architecture decision, with conventional H2 sections: `## Context`, `## Decision`, `## Consequences`. Status line tracks lifecycle (proposed / accepted / deprecated / superseded).

*Adopt:* the entire pattern. Sectioned markdown with a small closed set of canonical H2 headings; per-section prose; machine-consumable by tools that care (ADR registries extract H2s as metadata), human-scannable for everyone else. This is the proximate ancestor of our recommendation.

*Reject:* nothing meaningful. The ADR pattern is the right pattern; we adapt the *slot set* from per-decision to per-node, but the structural approach is identical.

*Why:* ADRs are the one part of the industry where sectioned markdown was tried at scale for exactly this problem-class (durable documentation of a specific artefact's design) and they stuck. 15+ years of ADR adoption is a strong prior.

Source: [ADR Templates](https://adr.github.io/adr-templates/) · [Nygard 2011](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions)

**C4 model (Simon Brown).** Architectural abstraction in four levels: Context → Container → Component → Code. Each level is a different kind of diagram with a different audience and vocabulary.

*Adopt:* the insight that *the same thing at different levels needs different vocabulary*. A Container description says "the checkout service"; a Code description says "the `CheckoutButton` React component." C4 names and formalises this and is directly relevant to our L0–L4 taxonomy.

*Reject:* C4's four-level split doesn't map onto ours; we have five levels (Product / Flows / Surfaces / Components / Atoms) with different emphases.

*Why:* C4 gives us the vocabulary to defend per-level slot requirements to reviewers: "an L0 contract has *User Journeys*, not *Inputs*, for the same reason a C4 Context diagram doesn't show function signatures."

**IETF RFC format.** Long-form proposal documents with canonical sections: `Abstract`, `Introduction`, `Terminology`, `Requirements`, `Security Considerations`. Prose-dominant with structural scaffolding.

*Adopt:* nothing new; RFCs are ADRs at a larger scale. The pattern is the same.

*Reject:* section weight. An RFC has 20+ sections; a contract must be orders of magnitude lighter.

*Why:* included for completeness of the survey. RFCs confirm that at *large* scale the industry converges on the same structural answer; our job is to keep our version light.

### Behaviour-driven

**Gherkin / Cucumber (Given / When / Then).** BDD specification language. Each scenario is three sections: `Given <state>, When <action>, Then <assertion>`. Explicitly testable — each step maps to an executable step definition.

*Adopt:* the three-part structure as a sub-form for the `## Examples` section (Phase 8+). `Given` maps to preconditions; `When` to the action; `Then` to the postcondition. A contract can include 0–3 concrete Given/When/Then blocks that are both human-readable examples and hooks for future automated verification.

*Reject:* Gherkin as the *primary* form. It is heavyweight for L0/L1 conceptual nodes and overkill for L4 atoms. Most contracts most of the time are not scenario-shaped.

*Why:* the "example-checked" verification state in INSPIRATION.md wants a home, and Gherkin is the right shape for that one slot. A contract with two Given/When/Then examples is meaningfully harder to have wrong than a contract with none.

Source: [Writing better Gherkin — Cucumber](https://cucumber.io/docs/bdd/better-gherkin/) · [Martin Fowler — GivenWhenThen](https://martinfowler.com/bliki/GivenWhenThen.html)

**Pact (contract testing).** Bidirectional consumer-driven contracts between services. Producer publishes what it emits; consumer publishes what it expects; a broker checks compatibility. Runtime tool, not a doc tool.

*Adopt:* the bidirectional framing for Phase 8's cherrypick flow — when an API node's contract changes, downstream UI nodes with matching expectations should surface as affected. That is out of scope for v1 form; note for v2.

*Reject:* the entire mechanism. Out of scope.

*Why:* Pact teaches that contracts are interesting in *relation* to each other, not just as monoliths. Our `neighbors` frontmatter field already nods to this; the form should make cross-contract references cheap (see "neighbor resolution" in recommended schema).

**Storybook CSF (Component Story Format).** React/Vue/etc. component docs: each component has default export + named stories that render example usages. The stories *are* the documentation.

*Adopt:* the insight that for UI nodes the most useful contract artefact is often an *example render*, not a prose description. The `## Examples` section for UI kind can include MDX-ish usage snippets ("`<CheckoutButton onSubmit={fakeSubmit} />`").

*Reject:* the runtime mechanism (stories are actually rendered; we just document them).

*Why:* CSF validates that prose+structure+examples is the working form for UI components specifically. Our UI-kind contract should have an `Examples` slot by default.

### Natural-language / LLM-adjacent

**Model Cards / Dataset Cards (Mitchell et al., 2019).** Huggingface's standard for ML artefact docs. Structured README.md: YAML frontmatter metadata + markdown body with canonical slots like "Intended uses & limitations," "Training data," "Ethical considerations."

*Adopt:* **the exact information architecture.** YAML frontmatter for metadata + sectioned markdown body for prose. This is the single closest prior art to our system — same dual-source design, same human+machine dual-consumer, same "mostly prose with structural anchors" dominant surface.

*Reject:* the ML-specific slot names; ours are different kinds (UI / API / data / job) with different slot sets.

*Why:* Huggingface model cards are at scale (>1M public cards as of 2026), battle-tested against both human authors and LLM auto-generators, and converge on the same form we are proposing. Strongest single validation in the prior art.

Sources: [Huggingface Model Cards](https://huggingface.co/docs/hub/model-cards) · [Data Cards Playbook](https://research.google/blog/the-data-cards-playbook-a-toolkit-for-transparency-in-dataset-documentation/)

**Semantic parsing / LLM structured-output research.** 2026 landscape: Claude via tool use achieves ~99.8% schema compliance on strict JSON schema; OpenAI ~99.9%; all three major providers support native structured output. Overhead: 150–300 tokens per request for Anthropic tool-use format.

*Adopt:* the empirical fact that structured emission is now reliable. We do not need to hedge the recommendation against "LLMs won't generate valid sectioned markdown." They will.

*Reject:* the implicit argument that because structured output is reliable, we should go full JSON (Option E). Reliability of the *emission* doesn't justify the *readability cost* of the artefact.

*Why:* the 2020-era argument against structure ("LLMs can't reliably produce valid templated output") is dead as of 2024; our decision is cost/value, not reliability.

Sources: [Structured Output and JSON Mode Guide 2026 — TokenMix](https://tokenmix.ai/blog/structured-output-json-guide) · [Anthropic Claude Structured outputs docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)

### Agent / MCP ecosystem

**MCP Tool schemas (Anthropic MCP spec, 2024–).** Our own sidecar uses `zod` + JSON schema for tool-call arguments. Each tool has an `inputSchema` with type definitions and descriptions.

*Adopt:* the registry pattern. A single `contract-schema.yml` that defines which slots are required per `(level, kind)` pair, loadable by the MCP sidecar, the Inspector, the derivation prompt generator, and the agent loop. One source of truth.

*Reject:* JSON Schema as the *body format*. MCP uses it for tool args because tool args are machine-consumed. Contract bodies are human-consumed primarily.

*Why:* we already live inside the MCP ecosystem; the registry pattern is idiomatic here.

### Recent academic literature (Scholar Feed, 2023–2026)

Four papers from the 2023–2026 arXiv corpus bear directly on this decision. All four are post-dated to the current frontier of LLM-driven contract generation, which is the exact mechanism Phase 6 relies on.

**NL2Contract (Richter & Wehrheim, 2025) — [arXiv:2510.12702](https://arxiv.org/abs/2510.12702).** Task: have LLMs translate natural-language hints (function names, comments, docstrings) into formal *functional contracts* — both preconditions AND postconditions — for use in automatic software verifiers. Key finding: LLM-inferred contracts are "generally sound for all possible inputs," are "sufficiently expressive for discriminating buggy from correct behaviour," and — critically — produce *fewer false alarms* when fed to verifiers than postcondition-only approaches.

*Adopt:* the evidence that preconditions + postconditions together (rather than postconditions alone) give more actionable contract semantics. Our `## Inputs` + `## Invariants` + `## Outputs` triad captures this directly. Also confirms that LLM inference of this shape is a *solved* problem at research maturity.

*Why:* the strongest empirical support for our choice to require both pre- and post-shaped slots (Inputs, Invariants, Outputs) rather than just a postcondition-style "what it should return."

**CodeSpecBench (Chen et al., 2026) — [arXiv:2604.12268](https://arxiv.org/abs/2604.12268).** Benchmark: 15 SOTA LLMs evaluated on generating *executable* behavioural specifications at function-level and repository-level. Critical finding: **the best model achieves only a 20.2% pass rate on repository-level tasks**, and "specification generation is substantially more challenging than code generation."

*Adopt:* a deep caveat to the Option E (full JSON-schema contract) path. Forcing *executable* specifications is hard even for frontier models — 80% failure rates at repo-level scale. Our choice to stay in "prose-plus-structure" (Option F) rather than go to executable-schema (toward Option E or D-with-strict-Gherkin) is empirically buttressed by CodeSpecBench: the form we chose sits in the compliance sweet spot where LLMs reliably emit correct output.

*Why:* answers BRIEF.md's explicit concern about "<90% LLM compliance flag." Sectioned markdown is not asking the LLM to produce executable semantics; it is asking for structured prose. That is a very different compliance regime — closer to the structured-output numbers cited earlier (99.8% for tool use) than to the 20.2% executable-spec frontier. Put directly: **we are asking the LLM for something it is known to be reliable at, not something it is known to fail at.**

**VibeContract (Song Wang, 2026) — [arXiv:2603.15691](https://arxiv.org/abs/2603.15691), novelty score 0.85.** Vision paper proposing a QA paradigm for AI-generated code where "high-level natural-language intent is decomposed into explicit task sequences, and task-level contracts are generated to capture expected inputs, outputs, constraints, and behavioural properties. Developers validate these contracts, and traceability is maintained between tasks, contracts, and generated code."

*Adopt:* **this is the closest academic analogue to our product thesis that exists in the literature.** The decomposition (intent → task → contract → generated code), the role of the developer (validate contracts, not verify code), and the traceability claim are all nearly identical to ours. We differentiate by being the *IDE* — the surface where the validation and traceability live, not just the paradigm. Independent validation from a distinct research programme that we are on a defensible path.

*Why:* converts the INSPIRATION.md thesis from "user-supplied design concept" to "instance of an emerging academic research agenda." Strong validator.

**PACT (Lim et al., 2025) — [arXiv:2510.12047](https://arxiv.org/abs/2510.12047).** Finding: existing code-generation benchmarks (HumanEval+, MBPP+) ignore contract adherence. When prompts include contract-*violating* test cases (negative examples), LLMs produce more contract-respecting code than when prompts include contract descriptions alone.

*Adopt:* the insight that *examples outperform descriptions for contract adherence*. This is the strongest single argument for why the `## Examples` slot (with Gherkin-shaped Given/When/Then) is not merely aspirational — it is the highest-leverage slot in the entire contract body for downstream agent quality. Phase 8's agent prompt assembly should prioritise `## Examples` over every other slot when present.

*Why:* PACT validates the F-over-B preference (the Gherkin Examples addition is not cosmetic — it is load-bearing for agent performance) and refines the Phase 8 drop-priority: when token budget forces the assembler to drop sections, `## Examples` should drop *last*, not early. The original draft had `Examples` as mid-priority; PACT bumps it up.

Two cross-cutting implications from the academic corpus:

1. **Our v1 compliance target is realistic.** Sectioned markdown with a schema registry is well inside the "structured prose" regime where 2026-era LLMs hit 99%+ compliance on first pass. It is NOT in the "executable specs at repo-level" regime where compliance collapses to 20%.
2. **Our `verification` enum is on the right side of the literature.** The soundness question ("is the LLM's contract actually correct?") is handled by the calibrated three-state vocabulary (`assumed | example-checked | verified`). NL2Contract / PACT / SpecMind all reinforce that LLM-inferred contracts are useful-but-not-sound; surfacing that gradient honestly is the right UX choice.

### Adoption verdicts table

| Prior art | Adopt | Verdict |
|-----------|-------|---------|
| Design by Contract (Eiffel) | pre/post/invariant slot taxonomy | Adapt |
| TLA+ | state-vs-transition invariant distinction | Adapt |
| Dafny | (soundness) | Reject |
| Racket Contracts | (nothing in form) | Reject for form; Note for Phase 8 |
| OpenAPI 3.1 | API-kind slot set (method/route/params/responses/auth) | Adopt for API-kind |
| JSON Schema | description-inside-schema pattern (we invert it) | Adapt (as inverse) |
| Protobuf/gRPC IDL | (nothing) | Reject |
| GraphQL SDL | prose-above-structure as pattern proof | Adapt (validation only) |
| JSDoc / TSDoc | @param / @returns / @throws slot set | Adapt (as markdown H2s) |
| **ADRs (Nygard)** | **sectioned markdown with canonical H2 set** | **Adopt as spine** |
| C4 model | per-level vocabulary distinction | Adapt (defends per-level slots) |
| IETF RFC | (too heavyweight) | Reject |
| Gherkin / Given-When-Then | Examples sub-form | Adapt (for `## Examples` slot) |
| Pact | (cross-contract, v2) | Note for v2 |
| Storybook CSF | Examples for UI-kind | Adapt (example-bearing UI contracts) |
| **Model Cards / Dataset Cards** | **YAML frontmatter + sectioned body information arch** | **Adopt as whole pattern** |
| LLM structured-output research | empirical reliability | Adopt (rules out one objection) |
| MCP Tool schemas | registry pattern for per-kind slot set | Adopt |
| **NL2Contract (2025)** | **pre+post+invariant triad validation for LLM inference** | **Adopt as empirical support** |
| **CodeSpecBench (2026)** | **rules out full-executable specs (Option E/D) as unreliable** | **Adopt as empirical bound** |
| **VibeContract (2026)** | **paradigm-level validation of the whole Contract IDE thesis** | **Adopt as directional confirmation** |
| **PACT (2025)** | **examples > descriptions for contract adherence → promote Examples slot** | **Adopt (bumps Examples drop priority)** |

---

## Representation Options Analyzed

The same concrete node rendered in all six forms. **Node: the CheckoutButton component at `/tmp/phase6-uat/src/components/CheckoutButton.tsx`** — a UI L3 component that is one of our two real fixture contracts and the target of the current human-pinned prose body.

**Source:**

```tsx
import { useState } from 'react';

export function CheckoutButton({ onSubmit, disabled }: {
  onSubmit: () => Promise<void>;
  disabled?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const click = async () => {
    setLoading(true);
    try { await onSubmit(); } finally { setLoading(false); }
  };
  return <button disabled={disabled || loading} onClick={click}>Checkout</button>;
}
```

### A. Free prose (current state)

```markdown
Renders a "Checkout" button that invokes the caller-provided async `onSubmit`
handler on click, guarding against concurrent submissions by tracking a local
`loading` state. The button is disabled while either the external `disabled`
prop is true or a submission is in flight, and the loading flag is always
cleared after `onSubmit` settles (success or failure). Serving as the cart's
checkout entry point on the `/cart` route, delegating all business/payment
logic to its parent via `onSubmit`.
```

**Scoring:**
- LLM generation ease: **excellent** (trivially easy).
- Human read: **good** for L3/L4; **bad** for L0 (no scan structure).
- Human edit: **ok**; non-coder mode has nowhere specific to "change the button's invariants" — one textarea, no affordance.
- FTS5: **works**; no headings to weight.
- Embedding: **mediocre**; chunking is arbitrary (paragraph boundaries), so similarity search finds "text that is vaguely about buttons" rather than "text whose invariants touch concurrent submissions."
- Diff quality: **bad**. A 2-sentence rewrite re-flows the whole paragraph; line-diff is noise.
- Validation: **impossible**. You cannot ask "which nodes are missing invariants?" over free prose without an LLM classification pass.
- Non-coder UX: **bad**. Form is a single textarea.
- Migration: zero (current state).
- Token cost in prompt: **best** (no overhead).

### B. Sectioned markdown (ADR-style)

```markdown
## Intent
Renders the cart's "Checkout" call-to-action, delegating all business and
payment logic to a caller-provided async handler.

## Role
Cart flow entry point on `/cart`. The last UI surface before the user leaves
the cart for checkout.

## Inputs
- `onSubmit: () => Promise<void>` — async handler invoked on click. Caller
  owns all business logic, side effects, and navigation.
- `disabled?: boolean` — external disable flag (e.g. cart-empty state).

## Outputs
- Renders a single `<button>` element with label "Checkout".
- No direct return value.

## Invariants
- The button is disabled when `disabled === true` OR a submission is in flight.
- The `loading` flag is always cleared after `onSubmit` settles (success or
  failure) — `finally` block guarantees this.
- Concurrent submissions are prevented: a second click during flight is a no-op
  (because `disabled={loading}`).

## Side Effects
- Calls `onSubmit` — any side effect the parent wires up (network, navigation,
  analytics) happens through that handoff.

## Failure Modes
- If `onSubmit` throws, the error propagates to the parent; `loading` still
  resets.
- If `onSubmit` hangs forever, the button stays disabled indefinitely — no
  client-side timeout.

## Notes
Styling is unopinionated — no Tailwind classes in v1.
```

**Scoring:**
- LLM generation ease: **very good** (Claude 4.x hits this reliably with a 1-shot template in the derivation prompt).
- Human read: **excellent**. Same mental structure whether the node is UI or API.
- Human edit: **excellent**. Non-coder mode renders each H2 as a labelled textarea.
- FTS5: **works + can be weighted** (match in `## Invariants` ranks higher than match in `## Notes`).
- Embedding: **good**. Chunk-per-section is a semantically meaningful unit.
- Diff quality: **good**. Changing invariants edits only that section; cherrypick shows "this contract's invariants changed, rest unchanged."
- Validation: **good**. Trivial regex can detect missing required sections.
- Non-coder UX: **excellent**. Form per section.
- Migration: **small** (one-shot script wraps prose body as `## Intent`).
- Token cost in prompt: ~1.6× the free-prose version. Not 2× as BRIEF feared because the prose itself compresses (each section is tighter prose).

### C. Typed header + prose (YAML inside body)

```markdown
\`\`\`yaml
intent: Renders the cart's "Checkout" call-to-action, delegating all business
  and payment logic to a caller-provided async handler.
role: Cart flow entry point on /cart.
inputs:
  - name: onSubmit
    type: () => Promise<void>
    description: Async handler invoked on click.
  - name: disabled
    type: boolean?
    description: External disable flag.
outputs:
  - Renders <button>Checkout</button>
invariants:
  - disabled when prop disabled OR loading
  - loading clears after onSubmit settles (finally block)
  - concurrent submissions prevented
side_effects:
  - calls onSubmit
failure_modes:
  - if onSubmit throws, error propagates, loading still resets
  - if onSubmit hangs, button stays disabled indefinitely
\`\`\`

## Notes
Styling unopinionated — no Tailwind classes in v1.
```

**Scoring:**
- LLM generation ease: **good** (YAML in fenced block; modern models handle it).
- Human read: **mixed**. YAML list-of-strings reads like a bulleted list inside a code fence; the mental mode-switch is jarring.
- Human edit: **bad for non-coders**; YAML syntax errors are silent footguns (trailing space in a list item breaks parsing).
- FTS5: **works** but search token distribution is odd — YAML keys pollute the index.
- Embedding: **ok**; chunking per slot works similarly to B.
- Diff quality: **excellent** (YAML diffs cleanly).
- Validation: **excellent** (schema validation is free).
- Non-coder UX: **unacceptable.** YAML in the body is user-hostile.
- Migration: **medium** (need to re-derive all fixtures).
- Token cost in prompt: ~1.3× free prose. Tighter than B because no prose between slots.

### D. Structured DSL (constrained Gherkin)

```
SCENARIO: User clicks Checkout
GIVEN  the cart page is loaded
  AND  disabled is false
  AND  no submission is in flight
WHEN   the user clicks the Checkout button
THEN   the loading flag becomes true
  AND  the button is disabled
  AND  onSubmit is invoked

SCENARIO: Concurrent click during flight
GIVEN  a submission is in flight
WHEN   the user clicks again
THEN   nothing happens (button disabled)

SCENARIO: onSubmit throws
GIVEN  onSubmit rejects with error E
WHEN   onSubmit settles
THEN   loading returns to false
  AND  error E propagates to the parent
```

**Scoring:**
- LLM generation ease: **medium** (Gherkin is a distinct rule system; more drift potential).
- Human read: **mediocre for non-scenario nodes**. Works great for scenarios. For an L0 Product "describe the product" — no.
- Human edit: **bad for abstract slots** ("what's the product's role?") — Gherkin has nowhere to put it.
- FTS5: **works**.
- Embedding: **mediocre** (Given/When/Then keywords are uninformative; step content varies widely).
- Diff quality: **good**.
- Validation: **rigid** — all slots must look scenario-shaped.
- Non-coder UX: **bad**. Non-coders don't think Given/When/Then.
- Migration: **large** (prose → scenarios requires an LLM rewrite).
- Token cost: roughly equal to B.

Gherkin is the right form for the `## Examples` slot inside B, not for the whole body.

### E. Full JSON / JSON Schema–validated body

```json
{
  "intent": "Renders the cart's \"Checkout\" call-to-action, delegating all business and payment logic to a caller-provided async handler.",
  "role": "Cart flow entry point on /cart.",
  "inputs": [
    {"name": "onSubmit", "type": "() => Promise<void>", "description": "Async handler invoked on click."},
    {"name": "disabled", "type": "boolean?", "description": "External disable flag."}
  ],
  "outputs": [
    {"description": "Renders a single <button> element labelled \"Checkout\"."}
  ],
  "invariants": [
    "Button is disabled when prop disabled OR loading.",
    "loading clears after onSubmit settles (finally block guarantees this).",
    "Concurrent submissions are prevented — second click during flight is a no-op."
  ],
  "side_effects": ["Calls onSubmit; all side effects route through that handoff."],
  "failure_modes": [
    "If onSubmit throws, error propagates; loading still resets.",
    "If onSubmit hangs, button stays disabled indefinitely (no client-side timeout)."
  ],
  "notes": "Styling unopinionated — no Tailwind classes in v1."
}
```

**Scoring:**
- LLM generation: **excellent** (structured output mode hits this at 99.8% compliance in 2026).
- Human read: **unacceptable for L0/L1.** A product description as a JSON blob with a single `intent` string is hostile.
- Human edit: **unacceptable** for anyone who isn't a developer.
- FTS5: **degrades** — JSON syntactic tokens (`"`, `,`, `:`, `[`) pollute the index; needs preprocessing.
- Embedding: **mediocre**. The whole blob as one document; chunking is awkward.
- Diff quality: **excellent**.
- Validation: **excellent**.
- Non-coder UX: **unacceptable.**
- Migration: **large.**
- Token cost: ~1.9× free prose (JSON punctuation overhead).

JSON wins on structure and loses everything else. Full-JSON is the wrong form for a human-facing surface.

### F. Hybrid — sectioned markdown with optional inline Gherkin (the recommendation)

Option B, plus: `## Examples` (when present) is formatted as Given/When/Then blocks. Other sections are prose.

```markdown
## Intent
Renders the cart's "Checkout" call-to-action, delegating all business and
payment logic to a caller-provided async handler.

## Role
Cart flow entry point on /cart.

## Inputs
- `onSubmit: () => Promise<void>` — async handler invoked on click.
- `disabled?: boolean` — external disable flag.

## Outputs
- Renders `<button>Checkout</button>`.

## Invariants
- Button is disabled when `disabled === true` OR a submission is in flight.
- `loading` clears after `onSubmit` settles (`finally` guarantees this).
- Concurrent submissions prevented — second click during flight is a no-op.

## Side Effects
- Calls `onSubmit` — all side effects route through that handoff.

## Failure Modes
- `onSubmit` throws → error propagates; `loading` still resets.
- `onSubmit` hangs → button stays disabled (no client-side timeout).

## Examples
GIVEN the cart page is loaded and no submission is in flight
WHEN  the user clicks the Checkout button
THEN  loading becomes true, the button disables, and onSubmit is invoked

GIVEN a submission is in flight
WHEN  the user clicks Checkout again
THEN  nothing happens — the click is absorbed by `disabled={loading}`
```

**Scoring:** inherits all of B's scores. The Examples slot, when used, is meaningfully testable by Phase 8+ (example-checked verification). Most contracts will not use Examples at first; slot is optional.

### Summary scoreboard

| Criterion | A prose | **B sectioned md** | C yaml+prose | D Gherkin DSL | E JSON | **F = B + Gherkin Examples** |
|-----------|---------|--------------------|--------------|--------------|--------|------------------------------|
| LLM generation | 5 | 5 | 4 | 3 | 5 | 5 |
| Human read | 3 (scales badly) | 5 | 3 | 2 | 1 | 5 |
| Human edit | 3 | 5 | 2 | 2 | 1 | 5 |
| FTS5 compat | 4 | 5 | 3 | 4 | 2 | 5 |
| Embedding (chunkable) | 2 | 5 | 4 | 3 | 3 | 5 |
| Diff quality | 1 | 4 | 5 | 4 | 5 | 4 |
| Validation | 1 | 4 | 5 | 4 | 5 | 4 |
| Non-coder UX | 2 | 5 | 1 | 1 | 1 | 5 |
| Migration cost | 5 (is current) | 4 | 2 | 1 | 1 | 4 |
| Token cost | 5 | 3 | 4 | 3 | 2 | 3 |
| **Total** | 31 | **45** | 33 | 27 | 26 | **46** |

B and F tie within noise; F wins by 1 point because the `## Examples` affordance is cheap and opens the example-checked path. **Recommend F (which is B plus an opt-in Gherkin slot).**

---

## Recommended Schema

### Overview

- **Body format:** markdown with a canonical, closed set of H2 section headings.
- **Per-kind slot registry:** `.planning/contract-schema.yml` declares required / optional slots per `(level, kind)` tuple.
- **Frontmatter unchanged** except two additions (`verification`, `schema_version_of_body`).
- **`format_version: 2`** marks the new body form; scanner upgrades `format_version: 1` bodies on the fly on next read.
- **Validation is soft.** Missing required slots surface as warnings in the Inspector, not parse errors; agent loop and FTS5 never break on a partial contract.

### Canonical slot set (all levels, all kinds)

| Slot | Required by default | Meaning | Typical size |
|------|--------------------|---------|-------------|
| `## Intent` | **Yes, all nodes** | One-to-three sentences: what this exists to do, in product terms. | 1–3 sentences |
| `## Role` | Yes for L0–L2; optional L3–L4 | Where this fits in the broader flow. | 1–2 sentences |
| `## Inputs` | Yes for L3–L4 UI / API; optional elsewhere | Props / params / request parameters. | 1–6 bullets |
| `## Outputs` | Yes for L3–L4 UI / API; optional elsewhere | Rendered output / return values / response shape. | 1–4 bullets |
| `## Invariants` | Yes for L3–L4; optional L0–L2 | Properties always true regardless of inputs. | 1–5 bullets |
| `## Side Effects` | Yes for API / job kinds; optional UI / data | Writes, network calls, filesystem, timing-sensitive behaviour. | 1–4 bullets |
| `## Failure Modes` | Optional | How this fails and what the observable is. | 0–4 bullets |
| `## Examples` | Optional | Gherkin-shaped Given/When/Then blocks; up to 3. | 0–3 blocks |
| `## Notes` | Optional | Free-form overflow. | any |

### Per-kind slot additions

UI, API, data, and job nodes get kind-specific slots *appended* to the canonical set. These live in `contract-schema.yml` and are validated the same soft way.

**UI kind** (adds):
- `## Interaction` — what the user can do here (optional; useful for L3 components and above).
- `## Visual States` — enumerated states (`loading`, `error`, `disabled`, `empty`) and their rendering rules (optional).

**API kind** (adds):
- `## HTTP` — method + route + auth. Required for L3 API nodes.
- `## Request Shape` — inline description; link to type if defined elsewhere (optional, cross-ref frontmatter `code_ranges` preferred).
- `## Response Shape` — same.

**data kind** (adds):
- `## Shape` — required for L3 data nodes; a prose description of the data's structure, keys, types, nullability.
- `## Persistence` — where it lives (SQLite table, blob storage, in-memory).

**job kind** (adds):
- `## Trigger` — required for L3 job nodes; what kicks it off (cron, event, manual).
- `## Schedule` — if cron-triggered, the schedule string and cadence.
- `## Idempotency` — whether repeat runs are safe.

### Per-level slot overrides

- **L0 Product** — canonical set minus `Inputs/Outputs/Invariants/Side Effects`. Required: `Intent`, `Role`, `User Journeys` (L0-specific slot).
- **L1 Flow** — canonical set minus `Inputs/Outputs`. Required: `Intent`, `Role`, `Steps` (L1-specific; ordered list of surfaces the flow traverses).
- **L2 Surface** — canonical set; `Inputs/Outputs` optional; `Invariants` optional.
- **L3 Component** — full canonical set; all kind-specific slots required per kind.
- **L4 Atom** — canonical set minus `Side Effects` (atoms rarely have them) and `Failure Modes` (ditto). `Intent` + `Inputs` + `Outputs` required.

### Frontmatter additions

Two new fields, both backward-compatible (old contracts without them still parse):

```yaml
format_version: 2      # was 1 — bump on migration
verification: assumed  # enum: verified | example-checked | assumed
```

- `verification` replaces `human_pinned` semantically. Mapping:
  - `human_pinned: true` (v1) → `verification: verified` (v2) — user has read and approved.
  - `human_pinned: false` + body set → `verification: assumed` — LLM-derived, not checked.
  - `verification: example-checked` is new, Phase 8+ feature: set when the `## Examples` block has been validated against real behaviour.
- `human_pinned` remains in the serialiser for backwards compat of the `write_derived_contract` tool's pinned guard. It is the boolean form of "verification ≠ assumed". This dual encoding lets us ship v2 format without breaking the existing MCP tool.

---

### Full examples per `(kind, level)`

#### Example 1: **UI · L3** — `CheckoutButton`

(same as representation F above)

```markdown
---
format_version: 2
uuid: dddddddd-dddd-dddd-dddd-dddddddddddd
kind: UI
level: L3
parent: <cart-surface-uuid>
neighbors: [<cart-view-uuid>, <checkout-handler-uuid>]
code_ranges:
  - file: src/components/CheckoutButton.tsx
    start_line: 1
    end_line: 14
code_hash: 995e8d...
contract_hash: 548578...
verification: verified
human_pinned: true
route: /cart
derived_at: 2026-04-24T21:18:37.320Z
---

## Intent
Renders the cart's "Checkout" call-to-action, delegating all business and
payment logic to a caller-provided async handler.

## Role
Cart flow entry point on /cart — last UI surface before the user leaves the
cart for checkout.

## Inputs
- `onSubmit: () => Promise<void>` — async handler invoked on click. Caller
  owns all business logic and side effects.
- `disabled?: boolean` — external disable flag (e.g. cart-empty state).

## Outputs
- Renders a single `<button>` element labelled "Checkout".

## Invariants
- Button is disabled when `disabled === true` OR a submission is in flight.
- `loading` clears after `onSubmit` settles (`finally` block guarantees).
- Concurrent submissions prevented — the second click during flight is a no-op.

## Failure Modes
- If `onSubmit` throws, the error propagates to the parent; `loading` still
  resets to false.
- If `onSubmit` hangs indefinitely, the button stays disabled — no client-side
  timeout.

## Interaction
Clickable. No hover menu, no keyboard shortcut beyond Enter (default button
behaviour).

## Visual States
- `idle` — enabled, label "Checkout".
- `disabled` — when `disabled` prop is true.
- `loading` — during in-flight submission; button remains labelled "Checkout"
  (no spinner in v1).

## Examples
GIVEN the cart page is loaded and no submission is in flight
WHEN  the user clicks the Checkout button
THEN  loading becomes true, the button disables, and onSubmit is invoked
```

#### Example 2: **API · L3** — hypothetical `POST /api/cart/checkout`

```markdown
---
format_version: 2
uuid: <uuid>
kind: API
level: L3
parent: <checkout-flow-uuid>
neighbors: [<cart-data-uuid>, <payment-service-uuid>]
code_ranges:
  - file: app/api/cart/checkout/route.ts
    start_line: 1
    end_line: 42
code_hash: …
contract_hash: …
verification: assumed
human_pinned: false
route: /api/cart/checkout
derived_at: 2026-04-24T22:00:00.000Z
---

## Intent
Converts the current cart into a checkout session and returns a redirect URL
to the payment provider.

## Role
Single server-side entry point for starting checkout from any cart surface.

## HTTP
- Method: POST
- Route: /api/cart/checkout
- Auth: session cookie required; anonymous carts rejected with 401.

## Inputs
- Request body: `{ cartId: string }` — the cart to convert.

## Outputs
- `200` → `{ redirectUrl: string }` — URL to redirect browser to.
- `401` → empty body — unauthenticated.
- `404` → empty body — cart not found.
- `409` → `{ error: "cart_empty" | "cart_stale" }` — cart invalid for checkout.

## Invariants
- Idempotency: a second POST with the same `cartId` within 30 seconds returns
  the same `redirectUrl` (dedup via session table).
- Cart row is not mutated on failure.

## Side Effects
- Writes a new row in `checkout_sessions`.
- Calls Shopify `checkoutCreate` mutation.
- No email sent (that's the downstream webhook's job).

## Failure Modes
- Shopify rate-limit → 503 with `retry_after` header.
- Stale session cookie → 401; client should re-auth and retry.

## Examples
GIVEN an authenticated session with a non-empty cart
WHEN  POST /api/cart/checkout with { cartId: "c_abc" }
THEN  response is 200 with a redirectUrl beginning with "https://checkout..."
```

#### Example 3: **data · L2** — hypothetical `Cart` model

```markdown
---
format_version: 2
uuid: <uuid>
kind: data
level: L2
parent: <commerce-domain-uuid>
neighbors: [<cart-api-uuid>, <product-uuid>, <user-uuid>]
code_ranges:
  - file: lib/shopify/types.ts
    start_line: 40
    end_line: 95
code_hash: …
contract_hash: …
verification: assumed
human_pinned: false
route: null
derived_at: 2026-04-24T22:00:00.000Z
---

## Intent
The in-memory and over-the-wire representation of a user's shopping cart —
the cart is the unit that transitions through the checkout flow.

## Role
Shared shape between the client-side cart store, the Shopify client, and the
checkout API. Single source of shape truth.

## Shape
- `id: string` (Shopify cart GID)
- `lines: CartLine[]` — ordered list of product lines.
- `cost: { subtotalAmount: Money, totalAmount: Money, totalTaxAmount?: Money }`
- `checkoutUrl?: string` — present only after `checkoutCreate`.
- `updatedAt: string` (ISO-8601 UTC).

## Persistence
- Client-side: persisted in `localStorage` under key `cart`.
- Server-side: canonical in Shopify; no local DB copy.

## Invariants
- `lines` is never empty for a cart returned from `/api/cart/add`.
- `cost.totalAmount >= cost.subtotalAmount` (non-negative tax).
- Once `checkoutUrl` is set, the cart is frozen — further `add/remove`
  mutations are rejected.

## Failure Modes
- Stale `updatedAt` (>24h) → cart is treated as expired and cleared on the
  client.
```

#### Example 4: **job · L2** — hypothetical stale-contract sweeper

```markdown
---
format_version: 2
uuid: <uuid>
kind: job
level: L2
parent: <ops-flow-uuid>
neighbors: [<drift-state-table-uuid>]
code_ranges:
  - file: src-tauri/src/jobs/stale_sweeper.rs
    start_line: 1
    end_line: 60
code_hash: …
contract_hash: …
verification: assumed
human_pinned: false
route: null
derived_at: 2026-04-24T22:00:00.000Z
---

## Intent
Marks contracts whose `derived_at` is older than 30 days as stale so the
Inspector can surface a "re-derive recommended" affordance.

## Role
Runs in-process every 6 hours; the one place stale-state is authored.

## Trigger
In-process interval timer, started at app boot.

## Schedule
Every 6 hours (`0 */6 * * *` equivalent).

## Idempotency
Safe to run repeatedly — the job is a pure function of the current
`derived_at` column; re-marking an already-stale row is a no-op.

## Invariants
- Never touches `human_pinned === true` contracts.
- Never writes to sidecar files — only to the `drift_state` SQLite table.
- Single-writer: the job is the only path that sets `drift_state.stale = 1`.

## Failure Modes
- DB lock contention → job logs + skips; next run retries.
- Body-parse failure on a specific contract → that row is logged and skipped;
  other rows process normally.
```

#### Example 5: **L0 Product** — Contract IDE itself

```markdown
---
format_version: 2
uuid: <uuid>
kind: UI
level: L0
parent: null
neighbors: []
code_ranges: []
code_hash: null
contract_hash: …
verification: assumed
human_pinned: false
route: null
derived_at: 2026-04-24T22:00:00.000Z
---

## Intent
An agent-native IDE where every file, surface, component, and atom carries a
versioned natural-language contract; the contract graph — not the file tree
— is the primary navigation and editing surface.

## Role
Sits alongside Claude Code. Claude Code is the primary work surface; Contract
IDE is the semantic index and review environment that makes agent sessions
durable and future sessions smarter.

## User Journeys
- **Cherrypick** — developer locates a node by intent, edits its contract,
  agent produces a scoped code patch, user approves both diffs in one action.
- **Mass edit** — user states a broad intent ("add loading states to every
  button that triggers an async request"), matching nodes are found via FTS +
  embedding, agent produces per-node patches, user approves them all at once.
- **Non-coder copy edit** — non-technical user toggles Copy Mode, selects an
  L4 atom, edits its plaintext, agent writes the code change — no source ever
  shown.

## Invariants
- Every node has a stable UUID; identity survives rename and move.
- Sidecar `.md` files are the source of truth; SQLite is a derived cache.
- User-pinned contracts are never overwritten by LLM derivation.

## Notes
Hackathon timeline, ~1 week to demo; macOS-only v1; shells out to `claude` CLI.
```

#### Example 6: **L1 Flow** — hypothetical checkout flow

```markdown
---
format_version: 2
uuid: <uuid>
kind: UI
level: L1
parent: <product-uuid>
neighbors: [<cart-surface-uuid>, <shipping-surface-uuid>, <payment-surface-uuid>, <confirmation-surface-uuid>]
code_ranges: []
code_hash: null
contract_hash: …
verification: assumed
human_pinned: false
route: null
derived_at: 2026-04-24T22:00:00.000Z
---

## Intent
The path from cart to paid order — four surfaces, three user decisions.

## Role
Highest-revenue flow in the product. Every subcomponent's contract should
state whether it preserves or threatens this flow's completion rate.

## Steps
1. **Cart surface** (`/cart`) — user reviews items and clicks `CheckoutButton`.
2. **Shipping surface** (`/checkout/shipping`) — user enters or confirms
   address.
3. **Payment surface** (`/checkout/payment`) — user enters card, clicks Pay.
4. **Confirmation surface** (`/checkout/thanks`) — order number shown.

## Invariants
- A user who begins step 1 and completes step 4 has exactly one order row
  created. Partial completions create no persistent state.
- Back-button navigation from step 3 to step 2 preserves already-entered
  shipping info.

## Failure Modes
- Payment decline at step 3 → user stays on step 3 with a visible error and
  a way to retry or change card.
- Browser refresh between steps 2 and 3 → the flow resumes at step 2 with
  shipping info intact (server-side session cookie).
```

These six cover all meaningful `(kind, level)` variations for v1. Other combinations (e.g., API-L2, data-L4) follow from the slot-registry rules above.

---

## Verification State Model

### Recommendation

Replace the frontmatter `human_pinned: boolean` with a three-state `verification` enum: `verified | example-checked | assumed`. Keep `human_pinned` as a derived serialisation (`verification !== 'assumed' → human_pinned = true`) so Phase 6 `write_derived_contract` continues to work without code changes.

### State definitions

| State | Meaning | How it's set | Agent-loop effect |
|-------|---------|--------------|-------------------|
| `assumed` | LLM-derived, not checked by a human or by examples. | Default after `write_derived_contract` writes a fresh body. | Phase 8 agent prompt marks this contract as "unverified context — verify before trusting." |
| `example-checked` | Gherkin blocks in `## Examples` have been validated against real behaviour (manually run, or via automated test execution if Phase 8+ adds it). | User clicks a button in the Inspector marking the contract as example-checked. | Phase 8 treats this as stronger evidence than `assumed`; mass-edit matching can weight these higher. |
| `verified` | Human has read the entire body and pinned it. Equivalent to current `human_pinned: true`. | User clicks the pin icon in the Inspector, or hand-edits the sidecar (`write_derived_contract` refuses to overwrite). | Agent treats as ground truth; mass-edit matches preferred; never overwritten by LLM derivation. |

### Transitions (v1)

- `∅ → assumed` — on first derivation.
- `assumed → verified` — on user pin.
- `assumed → example-checked` — on user-initiated example validation (Phase 8+).
- `example-checked → verified` — on user pin (any verified strictly dominates).
- `verified → assumed` — never automatically; only if user explicitly unpins.
- `* → assumed` + `derived_at` updated — only if `write_derived_contract` actually rewrites (which requires `human_pinned=false`).

### Why three states and not more

INSPIRATION.md proposes three; we adopt that ceiling. Adding a fourth ("LLM-self-consistent" or "neighbour-consistent") crosses into research territory (multi-LLM consensus, cross-contract theorem proving) that is not implementable in hackathon time.

### Why three states and not one

Alternative: keep `human_pinned` only. Rejected because:
- The agent loop (Phase 8) benefits from distinguishing "LLM guessed this" from "human read this." Uniform `human_pinned: false` hides that gradient.
- The `## Examples` slot wants a home for its validation status. Tying it to `verification` is the natural place.
- Cheap: adding one frontmatter field and one enum is nearly zero work today vs. retrofitting later.

### Per-slot verification (flagged, NOT adopted for v1)

The full vision (INSPIRATION.md) allows per-slot verification — each `## Invariants` bullet could be `assumed`, each `## Inputs` bullet could be `verified`. This is the right long-term shape but is too heavy for v1. **Flag for v2.** The current single contract-level `verification` field is a crude approximation; when per-slot becomes necessary, the migration is additive (add optional per-slot metadata; default all unspecified slots to the contract-level value).

---

## Open Questions / Flagged Uncertainty

Listed in roughly descending order of how load-bearing they are for v1.

### 1. How strict is "required"? (HIGH)

The recommendation calls some slots "required" (e.g. `## Invariants` for L3). What happens if a contract is missing a required slot?

**Proposed v1 semantics:** soft-required. Missing required slots surface as a yellow warning badge in the Inspector; MCP `find_by_intent` and `get_contract` still return the contract; the agent loop still assembles it into prompts (possibly with an annotation that it is incomplete). No parse errors, no hard rejections — because any hard rejection creates a "how do I fix this?" failure mode in the middle of a demo.

**Uncertainty:** will soft-required degrade to "no one ever fills in required slots"? Medium risk. Mitigation: the Inspector's contract-tab shows a visible completion indicator per slot; the derivation prompt explicitly enumerates required slots.

### 2. Slot-registry drift between Rust scanner, MCP sidecar, and frontend (HIGH)

Three places read contracts (Rust, MCP, React) and each needs the slot registry. The YAML file at `.planning/contract-schema.yml` must be parseable by all three.

**Proposed v1 semantics:** treat the registry as a build-time artefact. Ship a codegen step (`scripts/gen-slot-registry.ts`) that reads the YAML and emits a TypeScript constant + a Rust constant. Not as fancy as runtime loading, but eliminates the drift class.

**Uncertainty:** is this worth the complexity for v1? Alternative: hand-duplicate the registry in Rust / TS / Inspector; add a one-line comment pointing at the YAML. The file is small (~50 lines); drift risk is manageable.

### 3. Chunk size for embedding search (MED)

Phase 9 (MASS-01) wants embedding similarity over contract bodies. Chunking strategy options:
- Whole body per embedding — simplest; what we'd ship today.
- Per-section — one embedding per H2. 3–8× more embeddings per contract; better retrieval granularity.
- Hybrid — one embedding per body + one per section; query against both pools.

**Proposed v1 semantics:** whole-body. Swap to per-section if Phase 9 reveals retrieval quality is poor.

**Uncertainty:** per-section might be necessary from day one to make MASS-01 feel right. Re-evaluate when Phase 9 starts.

### 4. Neighbor resolution in the body (MED)

Should the body explicitly cross-reference neighbours with resolved names (`## Role: Calls the [CartSummary](<uuid>) component`) or just reference neighbour UUIDs in frontmatter and let the body stay UUID-free?

**Proposed v1 semantics:** body references neighbours by *name*, not UUID, in prose. Frontmatter holds UUIDs. The Inspector renders neighbour names as clickable links by matching prose mentions against the name-lookup table (best effort; tolerable miss rate). This is the lightest-weight path.

**Uncertainty:** the Inspector's prose-to-UUID link-rendering is a small but real piece of work. If it slips, falling back to "no link; just text" is fine.

### 5. Gherkin as Examples format vs. free prose (MED)

Some nodes (especially L0/L1) don't benefit from Gherkin — their "examples" are at a level where `GIVEN the user wants to buy a sweater` is awkward. Forcing Gherkin on those nodes produces bad examples.

**Proposed v1 semantics:** `## Examples` section's *format* is a soft hint; when absent, it's fine to write "example: …" bullets. When present, Gherkin is preferred. Phase 8+ (example-checked verification) will only attempt to auto-validate Gherkin-shaped examples; free-prose examples stay as documentation only.

**Uncertainty:** non-technical users may never use Gherkin. That's fine — the slot is optional.

### 6. Token budget under neighbour prompt assembly (MED)

Phase 8's agent prompt includes "currently-zoomed node + neighbours' contracts." A 10-neighbour node with full sectioned-markdown contracts is ~15k tokens of context. Sustainable with Claude's 200k+ context but adds real latency.

**Proposed v1 semantics:** prompt assembler has a droppable-section priority order: `Notes` drops first, then `Failure Modes`, then `Side Effects`, then `Invariants`. `Intent`, `Role`, `Inputs`, `Outputs`, and `Examples` (when present) are load-bearing and never dropped. *Revised from initial draft:* PACT (2025, arXiv:2510.12047) showed that examples outperform descriptions for contract adherence in LLM code generation; when `## Examples` is present, it should drop *last*, not mid.

**Uncertainty:** the "droppable" logic is real Phase 8 work; for v1 form design it is enough to note that the H2 structure *enables* this.

### 7. Migration script robustness (MED-LOW)

Only 2 fixture contracts exist today; the migration script is trivial. Risk goes up if self-contracting starts before v2 lands (each derived contract is in v1 form, must be migrated). If self-contracting begins within the same day the form decision is made, migration is near-zero. If the two are weeks apart, re-derivation is cheaper than migration.

**Proposed v1 semantics:** freeze derivation until v2 lands. Ship v2 first; then self-contract in v2 natively.

### 8. Non-coder mode rendering of Examples (LOW)

Does Copy Mode (NONC-01) show `## Examples`? A Given/When/Then block is arguably technical content even though it is plain-English.

**Proposed v1 semantics:** Copy Mode hides `## Examples`, `## Failure Modes`, and `## Side Effects` by default. Shows `## Intent`, `## Role`, and for L4 atoms only, a simplified text field ("What should this button / label / message say?"). The NONC-01 scope is narrow.

**Uncertainty:** exact slot visibility in Copy Mode is a Phase 9 design decision; form today just makes it possible.

### 9. Hash stability under schema migration (LOW)

`contract_hash = sha256(body.trim())`. Migrating bodies from v1 to v2 changes every hash. Phase 7 drift detection baselines are `code_hash`, not `contract_hash`, so this is not observable in drift — but any `contract_hash`-keyed cache gets invalidated.

**Proposed v1 semantics:** clear caches on migration. Acceptable cost given scale (2 fixtures).

### 10. Interaction with `update_contract` MCP tool (LOW)

The existing `update_contract` MCP tool (Phase 5) accepts a `body: string` and writes it verbatim. No change needed — body format is opaque to the tool.

---

## Implementation Impact

### Files / phases that change

**Schema & frontmatter (small):**
- `contract-ide/src-tauri/src/sidecar/frontmatter.rs` — add `format_version: 2` handling, `verification` enum. Backward-compat: `format_version: 1` bodies parse unchanged.
- `contract-ide/mcp-sidecar/src/types.ts` — mirror Rust frontmatter types (add `verification`).
- `contract-ide/mcp-sidecar/src/tools/write_derived_contract.ts` — already accepts `body: string`; no code change. Behaviour change: set `verification: 'assumed'` on fresh derivations.

**Slot registry (new):**
- `.planning/contract-schema.yml` — new file defining required/optional slots per `(kind, level)`.
- `contract-ide/scripts/gen-slot-registry.ts` — codegen from YAML to TS + Rust constants. Or: hand-duplicate and accept drift risk (see Open Question 2).

**Prompt assembly for derivation (medium):**
- `contract-ide/mcp-sidecar/src/tools/list_needing_derivation.ts` — rewrite the instruction at the end of the payload from the current one-line prose hint into a full template literal that includes the slot set required for that node's `(kind, level)`. This is the single biggest behavioural change — the LLM prompt *is* the form spec.
- `contract-ide/src/components/inspector/ContractTab.tsx` — "Copy derivation prompt" button: hard-code the v2 template for the selected node's `(kind, level)`.

**Body rendering in Inspector (medium):**
- `contract-ide/src/components/inspector/ContractTab.tsx` — render sectioned body as prose today; Phase 9 adds per-section form fields for Copy Mode.
- `contract-ide/src/components/inspector/DriftBadge.tsx` — unaffected (hash-only).
- New: `contract-ide/src/components/inspector/VerificationBadge.tsx` — shows `verified / example-checked / assumed` state in the header.

**Validation (medium, can be deferred):**
- New: `contract-ide/src/lib/contract-slots.ts` — soft-validation helpers: "given a node's `(kind, level)` and a parsed body, which required sections are missing?" Consumed by the Inspector completion indicator.
- Phase 4 Inspector shows yellow-highlighted missing slots when applicable.

**FTS5 & scanner (small):**
- `contract-ide/src-tauri/src/db/scanner.rs` — no change to FTS indexing logic; the body string is indexed in full. A *future* enhancement weights section-specific matches, but that is post-v1.
- No migration SQL needed — schema is unchanged.

**Existing contracts (trivial):**
- `/tmp/phase6-uat/.contracts/dddddddd-*.md` — wrap prose body as `## Intent`.
- `/tmp/phase6-uat/.contracts/eeeeeeee-*.md` — same.
- Both are demo fixtures; no production data at risk.

### Phase-by-phase impact summary

| Phase | Status | Impact of v2 form |
|-------|--------|-------------------|
| 1–3 | Complete | None. |
| 4 (Inspector, in progress) | In progress | Small: ContractTab renders sectioned body; add VerificationBadge; add slot-completion indicator. Fits naturally into Plan 04-04 scope. |
| 5 (MCP) | Complete | None — tool signatures unchanged. |
| 6 (Derivation) | Complete (MCP pivot) | Prompt text in `list_needing_derivation.ts` + Inspector "Copy derivation prompt" both need the v2 slot template. Rewrite ~20 lines. |
| 7 (Drift) | Not started | None — drift is hash-based, form-agnostic. |
| 8 (Agent Loop) | Not started | Medium: prompt assembly benefits from per-section drop priority; cherrypick diff can be per-section. Both are *easier* with v2 than with v1. |
| 9 (Mass edit, Non-Coder, Demo) | Not started | Medium-large: NONC-01 Copy Mode form rendering depends on v2 sections; MASS-01 embedding search can optionally chunk per-section. Both are *blocked without* v2 on a polish dimension, though both could degrade gracefully on v1 prose. |

### Migration path (concrete)

1. **Ship `format_version: 2` + `verification` enum behind a feature flag.** Scanner reads both v1 and v2 bodies; emits v2 on re-derivation.
2. **Write `contract-schema.yml` with the slot registry.** Load in derivation prompt.
3. **Update derivation prompt** in `list_needing_derivation.ts` + Inspector copy-prompt button. Verify output with one CheckoutButton derivation round-trip.
4. **Rewrite the two fixture contracts by hand** (5 minutes) to v2 form. Also pin them (`verification: verified`) so subsequent re-derivations don't touch them.
5. **Seed `vercel/commerce` contracts directly in v2 form.** DEMO-01 is the first scale test.
6. **Flip the feature flag off;** v2 becomes mandatory.

Reversible: if v2 is wrong, every contract is still parseable markdown. We can rewrite the slot set without a schema change. `format_version` is the only hard marker.

---

## Recommended Next Steps

### Small, reversible first step

**Step 0 (now):** commit this `RESEARCH.md`. No code changes.

### Minimum viable v2 (Day 1, ~3 hours of implementation)

1. **Write `contract-schema.yml`** — slot registry YAML. One file, ~40 lines.
2. **Update `list_needing_derivation.ts` instruction block** — embed a slot-aware template per `(kind, level)`. Test: derive a single node via the live Claude Code + MCP flow against `/tmp/phase6-uat`; inspect the emitted `.md`; confirm sections are present and prose is sensible.
3. **Manually rewrite the two fixture contracts** in v2 form with `verification: verified`. Commit.
4. **Add `verification` field to frontmatter** in both Rust + TS; map `human_pinned: true ↔ verification: verified`. One commit.

After step 4: v2 works end-to-end. Inspector still renders bodies as prose (OK; markdown is legible). Drift, FTS5, agent pipeline unchanged.

### Polish (Day 2, ~4 hours)

5. **Sectioned rendering in ContractTab.** Parse H2 headings; render each as a labelled block. Small CSS pass.
6. **VerificationBadge component** in Inspector header.
7. **Slot-completion indicator.** Yellow badge on the contract header when required sections are missing.

### Validation before committing the v2 schema at scale

Before seeding `vercel/commerce` with 25 contracts (DEMO-01):

- **LLM reliability check.** Run `write_derived_contract` 10 times against 10 distinct nodes in a scratch repo; verify that the `## Intent`, `## Role`, `## Inputs`, `## Outputs`, `## Invariants` sections are present in ≥ 9/10. If < 9/10, tighten the prompt. BRIEF's stated threshold (90% first-pass compliance) is my threshold.
- **Diff quality check.** Make a 1-line edit to the invariants section of one contract; view the resulting `git diff`. Confirm the diff is scoped to the invariants block (not re-flowing the whole body). If diff noise is high, the prose style guide in the derivation prompt needs tightening (force hard wrap at 80 columns; one-invariant-per-bullet).
- **Cherrypick diff mockup.** Phase 8 will build the real diff UI. For v1 schema confidence, a static mockup of "contract invariants section diffed" is enough.

### What to watch for (after v2 ships)

- **Section pollution.** If LLMs start emitting `## Summary` or `## Description` or other non-canonical headings, either update the registry or tighten the prompt. Don't silently drop non-canonical headings.
- **Section starvation.** If `## Invariants` is consistently empty, either (a) the slot is mis-named / mis-framed and invariants are landing in `## Intent`, or (b) the prompt is under-emphasising invariants. Look at generation traces, not just outputs.
- **Verification drift.** If `verification: assumed` contracts accumulate and are never pinned, the feature is failing. Mitigation surface: Inspector shows the count of assumed-vs-verified at repo level; makes neglect visible.

### Decisions deferred (intentionally)

- **Per-slot verification.** V2.
- **Cross-contract consistency checks** (Pact-style). V2.
- **Embedding chunk strategy for MASS-01.** Defer to Phase 9 start.
- **Section-weighted FTS5 ranking.** Defer to Phase 9 (MASS-01 tuning).
- **Automated example execution** for example-checked state. Defer to Phase 8 execution or post-demo.
- **Non-canonical heading handling.** Initially: silently preserved; not validated against registry. Revisit if pollution shows up.

---

## Sources

- [OpenAPI Specification v3.1.1](https://spec.openapis.org/oas/v3.1.1.html)
- [Huggingface Model Cards](https://huggingface.co/docs/hub/model-cards)
- [Data Cards Playbook — Google Research](https://research.google/blog/the-data-cards-playbook-a-toolkit-for-transparency-in-dataset-documentation/)
- [ADR Templates (joelparkerhenderson)](https://adr.github.io/adr-templates/)
- [Nygard — Documenting Architecture Decisions (2011)](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
- [Writing better Gherkin — Cucumber](https://cucumber.io/docs/bdd/better-gherkin/)
- [Martin Fowler — GivenWhenThen](https://martinfowler.com/bliki/GivenWhenThen.html)
- [Structured Output and JSON Mode Guide 2026 — TokenMix](https://tokenmix.ai/blog/structured-output-json-guide)
- [Claude API — Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Structured Output Comparison across LLM providers (2026)](https://medium.com/@rosgluk/structured-output-comparison-across-popular-llm-providers-openai-gemini-anthropic-mistral-and-1a5d42fa612a)

### Academic papers (Scholar Feed corpus)

- Richter, C. & Wehrheim, H. (2025). *Beyond Postconditions: Can Large Language Models infer Formal Contracts for Automatic Software Verification?* [arXiv:2510.12702](https://arxiv.org/abs/2510.12702). Introduces NL2Contract; shows LLM-inferred pre+postconditions produce fewer false alarms in verification than postconditions alone.
- Chen, Z. et al. (2026). *CodeSpecBench: Benchmarking LLMs for Executable Behavioral Specification Generation.* [arXiv:2604.12268](https://arxiv.org/abs/2604.12268). 15-LLM evaluation; best model hits 20.2% pass on repo-level executable spec generation — empirical bound against full-executable contract forms.
- Wang, S. (2026). *VibeContract: The Missing Quality Assurance Piece in Vibe Coding.* [arXiv:2603.15691](https://arxiv.org/abs/2603.15691). Vision paper closely matching the Contract IDE thesis; decomposes NL intent into task sequences with contracts, developers validate, traceability maintained.
- Lim, S. et al. (2025). *Do Large Language Models Respect Contracts? Evaluating and Enforcing Contract-Adherence in Code Generation.* [arXiv:2510.12047](https://arxiv.org/abs/2510.12047). PACT framework; empirical result that examples > descriptions for contract adherence — justifies promoting the `## Examples` slot's priority in prompt assembly.

---

*End of document. Draft v1, 2026-04-24. Revise after Implementation Step 4 validates the slot template against live LLM output.*
