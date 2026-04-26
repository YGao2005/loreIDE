---
phase: 14-codebase-to-contracts-bootstrap-skill-demo-application
plan: 01a
type: execute
wave: 1
depends_on: []
files_modified:
  - .agents/skills/codebase-to-contracts/SKILL.md
  - .agents/skills/codebase-to-contracts/references/output-schema.md
  - .agents/skills/codebase-to-contracts/references/classification-rules.md
  - .agents/skills/codebase-to-contracts/references/jsx-alignment.md
  - .agents/skills/codebase-to-contracts/references/flow-synthesis.md
  - .agents/skills/codebase-to-contracts/schemas/frontmatter.json
  - .agents/skills/codebase-to-contracts/schemas/contract-body.json
  - .agents/skills/codebase-to-contracts/schemas/flow.json
  - .agents/skills/codebase-to-contracts/schemas/classify.json
autonomous: true
requirements:
  - BOOTSTRAP-01  # [proposed] Skill exists, invocable as /codebase-to-contracts <repo>

must_haves:
  truths:
    - "User can invoke the skill via /codebase-to-contracts (or auto-trigger phrasing) inside a Claude Code session — once the SKILL.md package is in place"
    - "Skill auto-suggests on Next.js + Prisma + TS repos and stays silent on non-Next.js codebases (paths frontmatter restriction)"
    - "Skill loads in <500 lines per Anthropic SKILL.md guideline"
    - "Four references/*.md files cover output schema, classification rules, JSX alignment, and flow synthesis with progressive-disclosure"
    - "Four JSON Schemas (frontmatter, contract-body, flow, classify) parse as valid JSON and mirror the Phase 9 Rust struct field set"
  artifacts:
    - path: ".agents/skills/codebase-to-contracts/SKILL.md"
      provides: "Skill entry point with frontmatter (name, description, allowed-tools, paths) per Agent Skills v1 spec"
      contains: "name: codebase-to-contracts"
    - path: ".agents/skills/codebase-to-contracts/schemas/frontmatter.json"
      provides: "JSON Schema for format_version: 3 sidecar frontmatter — drives Stage 2 derivation; mirrors fields on src-tauri/src/sidecar/frontmatter.rs"
    - path: ".agents/skills/codebase-to-contracts/schemas/contract-body.json"
      provides: "JSON Schema for ## Intent / ## Role / ## Inputs / ## Outputs / ## Side effects body — drives Stage 3 derivation"
    - path: ".agents/skills/codebase-to-contracts/references/classification-rules.md"
      provides: "Heuristic kind/level taxonomy — single source for Stage 1 classification rules"
  key_links:
    - from: ".agents/skills/codebase-to-contracts/SKILL.md"
      to: "Anthropic Agent Skills v1 spec"
      via: "frontmatter keys (name, description, allowed-tools, paths)"
      pattern: "name: codebase-to-contracts"
    - from: ".agents/skills/codebase-to-contracts/schemas/frontmatter.json"
      to: "contract-ide/src-tauri/src/sidecar/frontmatter.rs"
      via: "Rust struct field parity — every non-optional Rust field must appear in JSON Schema required[]"
      pattern: "format_version"
---

<objective>
The DOCUMENTATION half of the skill foundation: SKILL.md package, four references/*.md progressive-disclosure docs, and four JSON Schemas. Plan 14-01b ships the executable scaffolding (helpers + Babel templates + package.json + pnpm install) in parallel.

Purpose: BOOTSTRAP-01 — skill discoverable as `/codebase-to-contracts`. Without SKILL.md and the schemas, downstream plans (14-03/04/05) have nothing to validate against. Splitting the docs out from the executable scaffolding (split out per Phase 14 revision Issue 1) lets both halves of the skill foundation run in parallel within Wave 1 and keeps each plan within ~50% context.

Output: SKILL.md (<=500 lines per Anthropic guideline), four references/*.md docs, four JSON Schemas. NO scripts, NO templates, NO node_modules in this plan.
</objective>

<execution_context>
@/Users/yang/.claude/get-shit-done/workflows/execute-plan.md
@/Users/yang/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/STATE.md
@.planning/CANVAS-PURPOSE.md
@.planning/phases/14-codebase-to-contracts-bootstrap-skill-demo-application/14-RESEARCH.md

# The "good output" exemplars — schema must accept these byte-for-byte
@contract-ide-demo/.contracts/a1000000-0000-4000-8000-000000000000.md
@contract-ide-demo/.contracts/ambient/api-account-delete-001.md
@contract-ide-demo/.contracts/flow-delete-account.md

# Source of truth for the Rust struct field set the JSON Schemas must mirror
@contract-ide/src-tauri/src/sidecar/frontmatter.rs
@contract-ide/src-tauri/src/sidecar/jsx_align_validator.rs
@contract-ide/src-tauri/src/sidecar/backend_section_validator.rs
@contract-ide/src-tauri/src/sidecar/section_parser.rs
</context>

<tasks>

<task type="auto">
  <name>Task 1: Author SKILL.md + references/ progressive-disclosure docs</name>
  <files>
    .agents/skills/codebase-to-contracts/SKILL.md
    .agents/skills/codebase-to-contracts/references/output-schema.md
    .agents/skills/codebase-to-contracts/references/classification-rules.md
    .agents/skills/codebase-to-contracts/references/jsx-alignment.md
    .agents/skills/codebase-to-contracts/references/flow-synthesis.md
  </files>
  <action>
    Create the skill directory `.agents/skills/codebase-to-contracts/` (confirm via `ls .agents/skills/` first; create with `mkdir -p` if missing).

    **SKILL.md** (<=500 lines per Anthropic guideline) with this YAML frontmatter (verbatim; do not rename keys):

    ```yaml
    ---
    name: codebase-to-contracts
    description: |
      Bootstrap a `.contracts/` tree (L0-L4 sidecars + flow contracts + Babel
      plugin) from an existing Next.js + Prisma + TypeScript codebase. Run this
      when pointing Contract IDE at a new repo for the first time, when the
      repo has no `.contracts/` directory, or when the user says "bootstrap
      contracts", "set up Contract IDE for this repo", "generate contracts
      from this codebase", or "make this repo Contract IDE-ready". Produces
      validator-passing output (JSX-01 + BACKEND-FM-01) that the IDE loads
      without manual cleanup.
    allowed-tools: Read Glob Grep Bash(claude *) Bash(node *) Bash(pnpm *) Bash(git *) Write Edit
    disable-model-invocation: false
    argument-hint: "[repo-path]"
    arguments: [repo_path]
    paths: "**/.contracts/**, **/*.tsx, **/*.ts, **/route.ts, **/page.tsx, **/schema.prisma, **/next.config.*"
    ---
    ```

    Body content — follow Anthropic skill-creator format with these sections:
    - `# /codebase-to-contracts — Bootstrap Contract IDE for an existing repo` (h1)
    - `## Pre-flight` — verify $repo_path is a Next.js + TS repo (presence of `next.config.{ts,js}` AND >=1 `.tsx` in `app/` or `pages/`); halt with diagnostic if not. Detect prior `.contracts/.staging/` and prompt resume / restart / abort.
    - `## Stage 1: Discover (heuristic-first)` — invoke `node ${CLAUDE_SKILL_DIR}/scripts/discover.mjs $repo_path`. Output is `$repo_path/.contracts/.staging/nodes.json`. Heuristic table (link to references/classification-rules.md for full taxonomy).
    - `## Stage 2: Derive frontmatter` — `claude -p --output-format json --json-schema ${CLAUDE_SKILL_DIR}/schemas/frontmatter.json` per node. Reference references/output-schema.md.
    - `## Stage 3: Derive contract bodies` — same pattern with schemas/contract-body.json. Backend kinds get populated `## Inputs / ## Outputs / ## Side effects`.
    - `## Stage 4: Align JSX code_ranges` — `node ${CLAUDE_SKILL_DIR}/scripts/align-jsx.mjs`. Refuse to proceed if any L4 UI atom can't be aligned. Reference references/jsx-alignment.md.
    - `## Stage 5: Synthesize flows + emit` — flow synthesis, atomic emit, validator gate. Reference references/flow-synthesis.md.
    - `## Output` — on success, summary table; on failure, never write `.contracts/` (only `.contracts/.staging/`).
    - `## Additional resources` — bullet list linking each `references/*.md`.

    Description guidance: "pushy" but specific (Anthropic says combat undertriggering by front-loading trigger phrases). The trigger phrases above ("bootstrap contracts", "set up Contract IDE", "generate contracts") MUST be in the description verbatim — they're how the model decides to auto-suggest.

    **references/output-schema.md** (~150 lines): Document the canonical output shapes. Pull excerpts from the three contract-ide-demo exemplars referenced in <context>:
    - L4 UI atom example (a1000000-...md): minimal frontmatter, ## Intent / ## Role / ## Examples body
    - L3 backend API example (ambient/api-account-delete-001.md): full frontmatter + ## Inputs / ## Outputs / ## Side effects body — this is the BACKEND-FM-01 reference shape
    - Flow contract example (flow-delete-account.md): format_version: 5, kind: flow, members: [...]
    Each excerpt commented inline with what's load-bearing (e.g., "rollup_state: untracked at bootstrap; IDE upgrades to fresh on first PROP-02 recompute").

    **references/classification-rules.md** (~100 lines): The heuristic kind/level taxonomy. Table format:
    | Path glob | kind | level | parent_hint |
    |---|---|---|---|
    | `app/**/page.tsx` | UI | L3 | flow uuid (one per route, derived in Stage 5a) |
    | `app/**/layout.tsx` | UI | L3 | parent route's L3 |
    | `app/api/**/route.ts` | API | L3 | flow uuid |
    | `prisma/schema.prisma` (per model block) | data | L2 | repo L0 |
    | `lib/**/*.ts` exporting fns importing `stripe` / `@mailchimp` / OAuth providers | external | L3 | flow uuid |
    | `lib/**/*.ts` other | lib | L2 (size <100 lines) or L3 (>100 lines) | flow uuid or area L1 |
    | Identifiable JSX inside page.tsx (sectioned by H2/H3 or named const exports) | UI | L4 | parent L3 |
    Then "When LLM fallback fires" rules (file is ambiguous: classify.json schema, single `claude -p` call, top-1 answer).

    **references/jsx-alignment.md** (~120 lines): The Stage 4 algorithm in prose + pseudocode. Cover: parse with `@babel/parser` (config matching Phase 9 plugin EXACTLY: `sourceType: 'module', plugins: ['jsx', 'typescript']`); enumerate JSX elements; filter to outermost contained-in-candidate-range; one match -> emit; zero match -> mark unbootstrappable + abort emit; multi-match -> LLM tiebreak. Cite jsx_align_validator.rs as source of truth — skill MUST emit ranges that pass that Rust validator.

    **references/flow-synthesis.md** (~120 lines): Stage 5a algorithm. For each L3 trigger: resolve imports -> filter to imports of nodes-in-our-nodes.json -> AST-walk for call sites in invocation order -> recurse one level -> LLM verification of `members:` ordering -> emit flow-<slug>.md with format_version: 5. Cross-flow shared services (Stripe, Mailchimp, db.user.update) participate in multiple flows — emit canonical sidecar ONCE; flow contracts reference the same UUID across multiple `members:` lists.

    **DO NOT** load full Phase 9 AGENTS.md or other 100KB+ files — these references are derived from RESEARCH.md and the three exemplar contracts.
  </action>
  <verify>
    `wc -l .agents/skills/codebase-to-contracts/SKILL.md` returns <=500.
    `head -30 .agents/skills/codebase-to-contracts/SKILL.md` shows the frontmatter with all required keys (name, description, allowed-tools, disable-model-invocation, argument-hint, arguments, paths).
    `ls .agents/skills/codebase-to-contracts/references/` shows 4 files (output-schema.md, classification-rules.md, jsx-alignment.md, flow-synthesis.md).
    Each references/*.md exists and is >=80 lines.
    `grep -l "bootstrap contracts" .agents/skills/codebase-to-contracts/SKILL.md` matches (trigger phrase present).
  </verify>
  <done>
    SKILL.md is a valid Agent Skills v1 package. Frontmatter has all required keys; description front-loads the four trigger phrases ("bootstrap contracts", "set up Contract IDE for this repo", "generate contracts from this codebase", "make this repo Contract IDE-ready"); paths field restricts auto-trigger to Next.js-shaped repos. References docs cover the output schema, classification rules, JSX alignment, and flow synthesis with prose + tables + pseudocode.
  </done>
</task>

<task type="auto">
  <name>Task 2: Author four JSON Schemas (frontmatter, contract-body, flow, classify)</name>
  <files>
    .agents/skills/codebase-to-contracts/schemas/frontmatter.json
    .agents/skills/codebase-to-contracts/schemas/contract-body.json
    .agents/skills/codebase-to-contracts/schemas/flow.json
    .agents/skills/codebase-to-contracts/schemas/classify.json
  </files>
  <action>
    **schemas/frontmatter.json** — JSON Schema (draft-07) for sidecar frontmatter, format_version: 3. Required keys (mirroring Phase 8 PROP-01 schema verbatim — read `contract-ide/src-tauri/src/sidecar/frontmatter.rs` to confirm field names): `format_version` (const 3), `uuid` (uuid format), `kind` (enum: UI / API / data / job / cron / event / lib / external / flow), `level` (enum: L0 / L1 / L2 / L3 / L4), `parent` (uuid|null), `neighbors` (array of uuid), `code_ranges` (array of {file, start_line, end_line}), `code_hash` (string|null), `contract_hash` (string|null), `human_pinned` (boolean), `route` (string|null), `derived_at` (string|null), `section_hashes` (object), `rollup_inputs` (array), `rollup_hash` (string|null), `rollup_state` (enum: fresh / stale / untracked), `rollup_generation` (integer >=0). At bootstrap, `code_hash`/`contract_hash`/`derived_at` are null (Phase 6 derivation later fills them); `rollup_state` is "untracked"; `rollup_inputs` is []. Document this in the schema's `description` fields so `claude -p --json-schema` produces the right values.

    **schemas/contract-body.json** — JSON Schema for the structured-output JSON the body-derivation prompt returns. Required: `intent` (string, minLength 50), `role` (string, minLength 30). Conditional on kind:
    - For UI L4 atoms: also `examples` (array of string, default []).
    - For backend kinds (API / lib / data / external / job / cron / event): also `inputs` (array, minItems 1), `outputs` (array, minItems 1), `side_effects` (array, minItems 0). **Each item in inputs/outputs MUST be a string with minLength 5** so empty bullets cannot pass schema validation (Phase 14 revision Issue 6 — JS-fallback validator parity with Rust). Use JSON Schema `allOf` + `if` / `then` to express the conditional.

    **schemas/flow.json** — Schema for `members:` ordering verification: `members` (array of uuid, minItems 2 — trigger + at least one participant), `notes` (string).

    **schemas/classify.json** — Schema for the LLM classification fallback in Stage 1: `kind` (enum same as frontmatter), `level` (enum same), `confidence` (number 0-1), `reasoning` (string).

    **Schema-vs-Rust parity check (per Phase 14 revision Issue 12):** Inline a comment block at the top of `schemas/frontmatter.json` (use `$comment` field — JSON Schema draft-07 supports it) listing every non-optional field on the Rust `Frontmatter` struct in `src-tauri/src/sidecar/frontmatter.rs`. Cross-check against `required[]`. Plan 14-01b's `__tests__/frontmatter-writer.test.mjs` will run a programmatic parity smoke (parse the Rust struct's serde fields via grep, assert each non-Option<T> field appears in the schema's `required`).
  </action>
  <verify>
    `cat .agents/skills/codebase-to-contracts/schemas/frontmatter.json | node -e "JSON.parse(require('fs').readFileSync(0))"` — valid JSON.
    `cat .agents/skills/codebase-to-contracts/schemas/contract-body.json | node -e "JSON.parse(require('fs').readFileSync(0))"` — valid JSON.
    `cat .agents/skills/codebase-to-contracts/schemas/flow.json | node -e "JSON.parse(require('fs').readFileSync(0))"` — valid JSON.
    `cat .agents/skills/codebase-to-contracts/schemas/classify.json | node -e "JSON.parse(require('fs').readFileSync(0))"` — valid JSON.
    `grep -E '"format_version"|"uuid"|"kind"|"level"' .agents/skills/codebase-to-contracts/schemas/frontmatter.json` matches 4+ lines (required fields present).
    `grep -E '"minLength":\s*5' .agents/skills/codebase-to-contracts/schemas/contract-body.json` matches (inputs/outputs items have non-trivial length requirement — Issue 6).
  </verify>
  <done>
    Four JSON Schemas exist as valid draft-07 JSON. frontmatter.json has all 17 fields the Rust struct expects (format_version, uuid, kind, level, parent, neighbors, code_ranges, code_hash, contract_hash, human_pinned, route, derived_at, section_hashes, rollup_inputs, rollup_hash, rollup_state, rollup_generation). contract-body.json enforces non-empty body sections via minLength on each input/output item (Phase 14 revision Issue 6). $comment block in frontmatter.json documents the Rust-vs-JSON parity contract for Plan 14-01b's smoke test.
  </done>
</task>

</tasks>

<verification>
**Plan-level checks:**

1. `wc -l .agents/skills/codebase-to-contracts/SKILL.md` <= 500
2. `find .agents/skills/codebase-to-contracts -type f | wc -l` returns >=9 (1 SKILL.md + 4 references + 4 schemas)
3. `for f in .agents/skills/codebase-to-contracts/schemas/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f', 'utf8'))" || echo "INVALID: $f"; done` returns no INVALID lines
4. SKILL.md frontmatter has: name, description, allowed-tools, disable-model-invocation, argument-hint, arguments, paths

**No subprocess execution this plan** — Plan 14-01a ships docs only; helpers + Babel templates ship in 14-01b.
</verification>

<success_criteria>
1. Skill directory exists at `.agents/skills/codebase-to-contracts/` with the documented tree (1 SKILL.md + references/ + schemas/)
2. SKILL.md is a valid Agent Skills v1 package (<=500 lines, all required frontmatter keys)
3. Four references/*.md docs exist (>=80 lines each), each loaded only on demand per progressive disclosure
4. Four JSON Schemas (frontmatter, contract-body, flow, classify) — all parse as valid JSON
5. contract-body.json enforces non-empty input/output items via minLength 5 (Phase 14 revision Issue 6 — JS-fallback parity with Rust validator)
6. frontmatter.json $comment block documents the Rust-vs-JSON parity contract (Plan 14-01b verifies programmatically)
7. BOOTSTRAP-01 [proposed] partially satisfied (skill discoverable; helpers + templates in 14-01b complete the foundation)
</success_criteria>

<output>
After completion, create `.planning/phases/14-codebase-to-contracts-bootstrap-skill-demo-application/14-01a-SUMMARY.md`. Document:
- SKILL.md frontmatter exactly as written (verbatim — Plan 14-01b will reuse the description's trigger phrases)
- Schemas authored + which Rust struct fields each mirrors
- Rust-vs-JSON parity check approach (the $comment block format) — Plan 14-01b's programmatic smoke verifies this
- Any deviations from RESEARCH.md
</output>
