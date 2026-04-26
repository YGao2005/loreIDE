---
phase: 14-codebase-to-contracts-bootstrap-skill-demo-application
plan: 01a
subsystem: skill
tags: [agent-skills, json-schema, claude-skill, bootstrap, anthropic-skills-v1]

requires:
  - phase: 09-mass-edit-non-coder-mode-demo-repo-seeding
    provides: BACKEND-FM-01 + JSX-01 validators (jsx_align_validator.rs, backend_section_validator.rs) + the three contract-ide-demo exemplars whose byte-shape the schemas must accept
  - phase: 02-contract-data-layer
    provides: Rust ContractFrontmatter struct (frontmatter.rs) — the field-set the JSON Schemas mirror

provides:
  - Anthropic Agent Skills v1 package at .agents/skills/codebase-to-contracts/SKILL.md (157 lines, well under 500-line guideline)
  - Four progressive-disclosure references docs (output-schema, classification-rules, jsx-alignment, flow-synthesis)
  - Four draft-07 JSON Schemas (frontmatter, contract-body, flow, classify) driving every claude -p --json-schema call
  - Rust-vs-JSON parity contract documented in $comment block of frontmatter.json (machine-verifiable in 14-01b's writer test)

affects:
  - 14-01b (executable scaffolding plan running in parallel — depends on the schemas to wire up __tests__ + helpers)
  - 14-03/04/05 (downstream plans validate against these schemas)
  - 14-06 (CI smoke test re-runs the skill and asserts byte-identical output)

tech-stack:
  added: [agent-skills-v1, json-schema-draft-07]
  patterns:
    - Progressive disclosure (SKILL.md is ~150 lines; full taxonomy + algorithms live in references/*.md loaded on demand)
    - Heuristic-first classification (path globs + AST shape covers ~85%; LLM fallback only for ambiguous files)
    - Atomic emit (skill writes under .staging/ until every gate passes, then atomic mv to .contracts/)
    - Refusal-on-ambiguity (Stage 4 zero-match aborts emit rather than fabricating ranges that would fail jsx_align_validator.rs)
    - Schema-vs-Rust parity contract via $comment block (machine-checkable in 14-01b's writer test)

key-files:
  created:
    - .agents/skills/codebase-to-contracts/SKILL.md
    - .agents/skills/codebase-to-contracts/references/output-schema.md
    - .agents/skills/codebase-to-contracts/references/classification-rules.md
    - .agents/skills/codebase-to-contracts/references/jsx-alignment.md
    - .agents/skills/codebase-to-contracts/references/flow-synthesis.md
    - .agents/skills/codebase-to-contracts/schemas/frontmatter.json
    - .agents/skills/codebase-to-contracts/schemas/contract-body.json
    - .agents/skills/codebase-to-contracts/schemas/flow.json
    - .agents/skills/codebase-to-contracts/schemas/classify.json
  modified: []

key-decisions:
  - "SKILL.md description uses YAML folded scalar (|) with trigger phrases on dedicated lines so single-line grep can verify each phrase verbatim — 'bootstrap contracts', 'set up Contract IDE for this repo', 'generate contracts from this codebase', 'make this repo Contract IDE-ready'"
  - "frontmatter.json required[] includes ALL 17 Rust struct fields (even Option<T> as nullable and #[serde(default)] as default-able) — the bootstrap output emits the full surface so downstream Rust serde gets a stable shape"
  - "members is conditionally required via allOf if/then/else gated on kind:flow — single-schema design instead of separate flow-frontmatter schema; matches the Rust struct's single ContractFrontmatter type"
  - "contract-body.json items minLength: 5 on inputs/outputs (Phase 14 revision Issue 6) — empty bullets cannot pass; mirrors backend_section_validator.rs"
  - "Refusal-on-ambiguity codified in jsx-alignment.md — zero-match aborts emit, never fabricates ranges. Plan 14-01b's tests will assert this on a fixture with a deleted JSX element"

patterns-established:
  - "Skill package layout: SKILL.md + references/ (progressive disclosure docs) + schemas/ (JSON Schemas) + (Plan 14-01b ships) scripts/ + templates/ + package.json + node_modules"
  - "Trigger-phrase placement: front-loaded in description verbatim; combat undertriggering per Anthropic skill-creator guidance"
  - "$comment block as the schema/Rust parity manifest: lists every Rust field by category (required vs Option<T> vs #[serde(default)]) so 14-01b can grep the Rust file and assert each field appears in required[]"

requirements-completed: [BOOTSTRAP-01]

duration: 5min
completed: 2026-04-25
---

# Phase 14 Plan 01a: codebase-to-contracts Skill Foundation (Documentation Half) Summary

**Anthropic Agent Skills v1 package authored — SKILL.md + 4 progressive-disclosure references + 4 draft-07 JSON Schemas — covering kind/level taxonomy, JSX alignment algorithm, flow synthesis, and the Rust-vs-JSON frontmatter parity contract — ready for Plan 14-01b's executable scaffolding to wire up.**

## Performance

- **Duration:** 5min
- **Started:** 2026-04-25T23:10:36Z
- **Completed:** 2026-04-25T23:16:30Z
- **Tasks:** 2
- **Files created:** 9

## Accomplishments
- SKILL.md (157 lines, well under 500-line Anthropic guideline) with full Skills v1 frontmatter (name, description, allowed-tools, disable-model-invocation, argument-hint, arguments, paths). The description front-loads four trigger phrases verbatim so the model auto-suggests the skill on Next.js + Prisma + TS repos.
- Five-stage execution flow documented in SKILL.md body: Pre-flight → Discover → Derive frontmatter → Derive contract bodies → Align JSX code_ranges → Synthesize flows + atomic emit. Each stage references its corresponding `references/*.md` for full algorithm details (progressive disclosure).
- Four references docs covering output-schema (annotated exemplar excerpts), classification-rules (heuristic kind/level taxonomy), jsx-alignment (Babel parser config + matcher pseudocode), and flow-synthesis (import-resolution + invocation-order walk).
- Four JSON Schemas (frontmatter, contract-body, flow, classify) — all parse as valid draft-07 JSON. Schema-vs-Rust parity contract documented in the $comment block of frontmatter.json for Plan 14-01b's programmatic writer test.

## Task Commits

1. **Task 1: SKILL.md + four references/ progressive-disclosure docs** — `6fdb5a0` (feat)
2. **Task 2: Four JSON Schemas (frontmatter, contract-body, flow, classify)** — `c8af53f` (feat)

## Files Created/Modified
- `.agents/skills/codebase-to-contracts/SKILL.md` — Anthropic Agent Skills v1 entry point with paths-restricted auto-trigger
- `.agents/skills/codebase-to-contracts/references/output-schema.md` — annotated excerpts from the three contract-ide-demo exemplars (L4 UI atom, L3 backend API, L2 flow)
- `.agents/skills/codebase-to-contracts/references/classification-rules.md` — Stage 1 heuristic kind/level/parent_hint taxonomy + LLM-fallback rules
- `.agents/skills/codebase-to-contracts/references/jsx-alignment.md` — Stage 4 Babel parser config + outermost-contained matcher + refusal-on-zero-match
- `.agents/skills/codebase-to-contracts/references/flow-synthesis.md` — Stage 5a import-resolution + invocation-order walk + LLM verification
- `.agents/skills/codebase-to-contracts/schemas/frontmatter.json` — mirrors all 17 ContractFrontmatter fields; conditional kind:flow branch enforces format_version=5 + members[]
- `.agents/skills/codebase-to-contracts/schemas/contract-body.json` — Stage 3 structured output; minLength:5 on inputs/outputs items (Issue 6 parity)
- `.agents/skills/codebase-to-contracts/schemas/flow.json` — Stage 5a.5 LLM members verification; minItems:2
- `.agents/skills/codebase-to-contracts/schemas/classify.json` — Stage 1 LLM-fallback classification with confidence + reasoning

## SKILL.md Frontmatter (verbatim — Plan 14-01b reuses these trigger phrases)

```yaml
---
name: codebase-to-contracts
description: |
  Bootstrap a `.contracts/` tree (L0-L4 sidecars + flow contracts + Babel
  plugin) from an existing Next.js + Prisma + TypeScript codebase. Run this
  when pointing Contract IDE at a new repo for the first time, when the
  repo has no `.contracts/` directory, or when the user says
  "bootstrap contracts", "set up Contract IDE for this repo",
  "generate contracts from this codebase", or "make this repo Contract IDE-ready".
  Produces
  validator-passing output (JSX-01 + BACKEND-FM-01) that the IDE loads
  without manual cleanup.
allowed-tools: Read Glob Grep Bash(claude *) Bash(node *) Bash(pnpm *) Bash(git *) Write Edit
disable-model-invocation: false
argument-hint: "[repo-path]"
arguments: [repo_path]
paths: "**/.contracts/**, **/*.tsx, **/*.ts, **/route.ts, **/page.tsx, **/schema.prisma, **/next.config.*"
---
```

## Schemas Authored — Rust struct field parity

| Schema | Mirrors | Notable invariants |
|---|---|---|
| `frontmatter.json` | `src-tauri/src/sidecar/frontmatter.rs::ContractFrontmatter` (all 17 fields) | required[] includes every field; conditional allOf gates format_version (3 vs 5) + members presence on kind:flow |
| `contract-body.json` | `src-tauri/src/sidecar/backend_section_validator.rs` semantics | intent ≥50 chars, role ≥30 chars, inputs/outputs items ≥5 chars (Issue 6 JS-fallback parity), conditional examples[] for UI L4 |
| `flow.json` | FLOW-01 members ordering (Phase 9) | members minItems:2; notes minLength:30 |
| `classify.json` | n/a (LLM-fallback only — auditability surface) | confidence 0..1 (skill rejects <0.6); reasoning ≥20 chars logged to `.staging/diagnostics.json` |

## Rust-vs-JSON Parity Approach

The `$comment` block at the top of `schemas/frontmatter.json` is the machine-checkable parity manifest. It enumerates every Rust field by category:

- **Required Rust fields** (no Option, no `#[serde(default)]`): `format_version`, `uuid`, `kind`, `level`.
- **Optional Rust fields** (`Option<T>`, may be null): `parent`, `code_hash`, `contract_hash`, `route`, `derived_at`, `rollup_hash`, `rollup_state`, `rollup_generation`, `members`.
- **Default-able Rust fields** (`#[serde(default)]`, absent ⇒ default): `neighbors`=[], `code_ranges`=[], `human_pinned`=false, `section_hashes`={}, `rollup_inputs`=[].

Plan 14-01b's `__tests__/frontmatter-writer.test.mjs` will:
1. Grep `src-tauri/src/sidecar/frontmatter.rs` for serde field declarations.
2. Parse the field set into the three categories above.
3. Assert that `frontmatter.json::required[]` is a superset of categories 1+2+3 (the skill emits the full surface so downstream Rust serde gets a stable shape).
4. Assert that `frontmatter.json::properties[*].type` matches Rust nullability (`Option<T>` ⇒ JSON `["string","null"]`, etc.).

This locks the schema/Rust parity at CI time so refactors of `frontmatter.rs` immediately surface as 14-01a schema diffs.

## Decisions Made

- **Trigger phrases on dedicated YAML scalar lines** (rather than rolled into one line) so single-line grep can verify each phrase verbatim. The YAML folded `|` scalar still presents the description as a single logical string to the model.
- **Single frontmatter.json schema with conditional allOf** instead of separate flow-frontmatter schema: matches the Rust struct's single `ContractFrontmatter` type with the optional `members` field.
- **Refusal-on-ambiguity codified in jsx-alignment.md**: zero-match aborts emit, never fabricates ranges. Better to refuse than to silently break Phase 7 drift detection.
- **Plan-scope discipline**: 14-01b's parallel scaffolding (scripts/, templates/, package.json, node_modules — all already present in the directory from the parallel run) was NOT touched by this plan. Only SKILL.md + references/ + schemas/ are 14-01a's deliverables.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Initial verification grep for "bootstrap contracts" failed because the YAML folded scalar wrapped the phrase across two source lines. Fixed by reformatting the description to keep each trigger phrase on a single source line (still a valid folded scalar; semantics unchanged for the model). Caught in Task 1 verify step before commit.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 14-01b can now reference these schemas from its `__tests__/frontmatter-writer.test.mjs` and `scripts/derive-frontmatter.mjs` — the schema paths are stable.
- Plans 14-03/04/05 have validation targets (the four schemas) and prose specs (the four references docs) to read against.
- BOOTSTRAP-01 partially satisfied (skill discoverable; Plan 14-01b completes the foundation by shipping the executable scaffolding).

## Self-Check: PASSED

Verified all 9 created files exist on disk:
- `.agents/skills/codebase-to-contracts/SKILL.md` ✓
- `.agents/skills/codebase-to-contracts/references/output-schema.md` ✓
- `.agents/skills/codebase-to-contracts/references/classification-rules.md` ✓
- `.agents/skills/codebase-to-contracts/references/jsx-alignment.md` ✓
- `.agents/skills/codebase-to-contracts/references/flow-synthesis.md` ✓
- `.agents/skills/codebase-to-contracts/schemas/frontmatter.json` ✓
- `.agents/skills/codebase-to-contracts/schemas/contract-body.json` ✓
- `.agents/skills/codebase-to-contracts/schemas/flow.json` ✓
- `.agents/skills/codebase-to-contracts/schemas/classify.json` ✓

Verified both task commits exist: `6fdb5a0` (feat 14-01a Task 1), `c8af53f` (feat 14-01a Task 2).

All four JSON Schemas parse as valid draft-07 JSON. SKILL.md is 157 lines (≤500). All four trigger phrases grep-match in SKILL.md. inputs/outputs `minLength: 5` constraint present in contract-body.json. $comment block in frontmatter.json documents Rust-vs-JSON parity contract.

---
*Phase: 14-codebase-to-contracts-bootstrap-skill-demo-application*
*Completed: 2026-04-25*
