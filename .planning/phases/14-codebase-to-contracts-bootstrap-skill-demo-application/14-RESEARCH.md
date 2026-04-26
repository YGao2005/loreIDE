# Phase 14: Codebase-to-Contracts Bootstrap (Skill + Demo Application) — Research

**Researched:** 2026-04-25
**Domain:** Codebase-to-contracts bootstrap pipeline; Claude Code Skill packaging (Agent Skills v1 / SKILL.md); demo target codebase selection
**Confidence:** HIGH on stack/patterns/skill format/existing primitives; MEDIUM on demo target codebase selection (one-of-many viable options); LOW on absolute LLM cost / latency budget for arbitrary repos (highly stack-dependent)

> **Process note (no CONTEXT.md exists):** Yang skipped `/gsd:discuss-phase` for Phase 14. The roadmap entry is title-only (no goal, no SCs, no requirement IDs). This document **derives scope** from the title, the surrounding planning corpus, and the four hypotheses the orchestrator asked me to validate. Treat the recommended phase goal + SCs as opinionated proposals, not locked contract — they need a final read-through before planning starts. Scope-relevant deviations from these recommendations should surface back to Yang per the `feedback_context_md_authority` memory rule, not be silently absorbed.

---

## Summary

Phase 14's title unpacks into two coupled deliverables: **(1) a Claude Code Skill** (an `.agents/skills/codebase-to-contracts/SKILL.md` package, plus scripts) that takes any existing codebase and produces a complete, validator-passing `.contracts/` tree (L0–L4 sidecars + flow contracts + populated `## Inputs`/`## Outputs`/`## Side effects` sections + JSX-aligned `code_ranges` + Babel-plugin-ready output), and **(2) a demo application** — a separate target codebase the Skill is run against in front of a judge, demonstrating "point this at any repo and the IDE can render it." The Skill is the artifact; the demo application is the proof. Both must trace back to the demo (CLAUDE.md rule). The strongest demo arc — and the one this research recommends — is **closing the loop**: the bootstrap skill being the on-ramp the pitch already promises ("Day 0 bootstraps from existing CLAUDE.mds, ADRs… via importers" — `PITCH.md` Q&A "What's the ingestion period?"). Phase 14 makes "point this at any repo" stop being narrative and start being a demoed affordance.

The phase is ~70% **assembly of existing primitives** and ~30% net-new work. The reusable primitives are large: Phase 6 derivation (`compute_code_hash` + `claude -p` Anthropic call + `write_sidecar`), Phase 9 demo-repo seeding (the canonical "good output" exemplar — `contract-ide-demo/.contracts/` is what the skill must produce), Phase 9 plan 09-04b's webpack loader (the Babel plugin scaffold the skill must emit into the target repo's `next.config.ts`), Phase 9 sidecar validators (`jsx_align_validator.rs` + `backend_section_validator.rs` — the skill's correctness criterion is "passes both validators"), Phase 11's `claude -p --json-schema` subprocess pattern (the skill emits typed JSON contracts, not free prose), and Phase 8 PROP-01's `format_version: 3` schema. The **net-new** work is: the multi-pass orchestration (discover → classify → derive → align → validate → write), the JSX-alignment search (mapping atom intent to a single outermost JSX element via Babel/SWC AST), the flow-contract synthesis (walking handler → lib → data → external call chains to populate `members:`), and the Skill packaging itself (SKILL.md format, scripts, progressive disclosure).

The **canvas-purpose divergence** flagged in the orchestrator's brief is real and worth surfacing: `CANVAS-PURPOSE.md` § "v2 extension — the broader manifest + 2-pass auditor" provisionally names a Phase 14 around **"Implementation Decisions Manifest, full coverage"** — that is a different phase. The roadmap's actual Phase 14 ("Codebase-to-Contracts Bootstrap") is **broader**: bootstrapping covers the entire L0–L4 hierarchy + flow contracts + Babel plugin wiring, not just the per-atom decisions manifest. The implementation-decisions-manifest scope might later land on top of bootstrap as Phase 15 (or as a sub-skill the bootstrap skill calls), but **this Phase 14, per the title, is the broader operation**. Recommendation: name this distinction explicitly in PLAN.md so future readers don't confuse the two scopes.

**Primary recommendation:** Frame Phase 14 as a **Claude Code Skill that runs as a subagent (`context: fork`) against a target repo**, orchestrating a 5-stage pipeline (discover → classify → derive → JSX-align → validate-and-emit) that reuses Phase 6's `claude -p` derivation pattern, Phase 11's `--json-schema` typed extraction, and Phase 9's webpack loader template. Pick a **small, real Next.js + Prisma open-source app** (~50–150 .tsx files, ~10 API routes, with at least one external integration like Stripe or Auth) as the demo target — `payloadcms/templates` `next-pages` example or a small SaaS starter — so the demo lands credibly without becoming a multi-day exercise in repo prep. Surface the divergence with `CANVAS-PURPOSE.md` Phase 14 provisional name explicitly in the phase goal and consider whether to absorb the implementation-decisions manifest as one of the 5 stages or split it to Phase 15.

---

<phase_requirements>
## Phase Requirements

**No requirement IDs were listed in `ROADMAP.md` for Phase 14.** The phase requirement table normally maps existing `REQUIREMENTS.md` IDs to research findings. For Phase 14, no IDs are pre-allocated — and crucially, the existing v1 requirements set is **already 70/70 mapped to phases 1–13** (per REQUIREMENTS.md § Coverage). This means Phase 14 either:

1. **Introduces new requirement IDs** (e.g., `BOOTSTRAP-01` through `BOOTSTRAP-NN`) that get added to REQUIREMENTS.md as part of phase planning, or
2. **Lands as the first v2 phase**, addressing one or more existing v2 IDs from the v2 Requirements section (most relevant candidates below).

**Most relevant existing v2 candidates the planner could map to:**

| Existing v2 ID | Description (from REQUIREMENTS.md) | Phase 14 relevance |
|---|---|---|
| AUTH-01 | "Contracts become the source of truth; code is generated from contracts on demand" | Tangential — bootstrap is the *inverse* direction (code → contracts) but lays the data substrate AUTH-01 needs |
| AUTH-03 | "CI integration that blocks PRs whose code changes lack matching contract changes" | Adjacent — once a repo has a contract tree (Phase 14 output), AUTH-03 becomes installable |
| IDE-02 | "File tree fallback for power users" | Unrelated |
| (none directly) | "Bootstrap an existing repo into a Contract IDE-ready repo" | **No existing requirement ID covers this.** Net-new family `BOOTSTRAP-*` is the cleanest fit |

**Recommendation:** During planning, propose a new `BOOTSTRAP-*` requirement family (e.g., `BOOTSTRAP-01` skill exists and runs as `/bootstrap-contracts`, `BOOTSTRAP-02` produces validator-passing L0–L4 hierarchy, `BOOTSTRAP-03` synthesizes flow contracts, `BOOTSTRAP-04` injects Babel plugin into demo-target's build config, `BOOTSTRAP-05` demo target is bootstrapped end-to-end live or recorded as a Phase 14 SC). Add these to REQUIREMENTS.md as part of phase 14's first plan. Treat this as a **scope decision Yang should ratify** before plan execution starts — do not silently invent the IDs in `gsd-planner` output.
</phase_requirements>

---

## Standard Stack

### Core (locked or strict — already shipped, reuse mandatory)

| Library / Primitive | Version | Purpose | Why Standard |
|---|---|---|---|
| `tauri-plugin-shell` (or direct `claude` CLI invocation from skill scripts) | 2 (existing) | Spawn `claude -p` subprocess for derivation passes — same pattern as Phase 6 (post-MCP-pivot) and Phase 11 (`claude -p --output-format json --json-schema`). No `ANTHROPIC_API_KEY` (subscription auth) | **Locked.** Phase 6, 11, 12 all use this — Phase 14 must not re-invent the LLM call layer |
| `claude` CLI with `--json-schema` flag | system-installed | Produces structured-output JSON validated against a JSON Schema. Phase 11 RESEARCH.md confirms this verbatim ("Anthropic's `--json-schema` flag … validates output against a JSON Schema and exposes it in the `structured_output` field") | **Locked.** All schema-constrained derivation passes (frontmatter generation, `## Inputs`/`## Outputs`/`## Side effects` extraction, atom classification) must use `--json-schema` not free-form parse |
| Phase 6 `compute_code_hash` + `compute_contract_hash` (sha2 + hex) | 0.11 / 0.4 (existing) | Bootstrap-output sidecars need real `code_hash` / `contract_hash` so Phase 7 drift detection works on day 1 | **Locked.** Phase 6 already computes both; skill must call into the same logic (or re-implement with bit-identical semantics — line-by-line concatenation, trim before hashing body) |
| Phase 8 PROP-01 `section_parser.rs` (canonical fenced-code-aware parser) | (existing) | Bootstrap-emitted contracts must round-trip through `section_parser` so `section_hashes` are computable. The skill ships untracked rollups (`rollup_state: untracked`) and lets the IDE upgrade to `format_version: 3` lazily on first write — **identical strategy** to Phase 9's seeded-contract approach | **Locked** — the seeded contracts in `contract-ide-demo/.contracts/` already follow this pattern; new bootstrap output must match byte-for-byte |
| Phase 9 webpack loader template (`contract-ide-demo/contract-uuid-plugin/index.js`) | (existing — 09-04b) | The skill's last stage must emit a copy of this loader into the target repo's `contract-uuid-plugin/` directory and wire `next.config.ts` to use it | **Locked** — Phase 9's BABEL-01 spike PASSED with this loader; cloning it is the conservative choice. Re-implementation introduces unjustified risk |
| Phase 9 sidecar validators — `jsx_align_validator.rs` + `backend_section_validator.rs` | (existing — 09-04b) | The skill's exit gate is "the IDE successfully loads the bootstrapped repo." That means JSX-01 + BACKEND-FM-01 startup validators must PASS. The skill must not emit anything that fails these | **Locked** — pass these or the demo doesn't run |
| `@babel/parser` + `@babel/generator` + `js-yaml` (Node 20+) | (existing in demo repo's pnpm tree) | The bootstrap skill's JSX-alignment stage parses every `.tsx` in the target repo, identifies outermost JSX elements per route/component, and produces `code_ranges` that the validator will accept. Same parser stack the webpack loader uses | **Locked** — using a different AST parser (`swc-parser-wasm`, `tree-sitter-typescript`) introduces source-span representation drift that will be a footgun at JSX alignment |
| Claude Code Skill format (`SKILL.md` + YAML frontmatter, Agent Skills open standard, Dec 2025 spec) | v1 (live as of 2026-04) | The deliverable's packaging format. `SKILL.md` with `name`, `description`, optional `allowed-tools`, `context: fork`, optional `agent` field, `disable-model-invocation`, `paths`, `arguments` etc. Progressive disclosure: SKILL.md is loaded on invocation; bundled `references/` and `scripts/` load on demand | **Locked by ecosystem** — the skill must be invocable by `/codebase-to-contracts <repo-path>` (or similar) inside a Claude Code session running in the **target repo's** working directory |

### Supporting (recommended — discretion to planner)

| Library | Version | Purpose | When to Use |
|---|---|---|---|
| `tree-sitter-typescript` | latest stable (verify via Context7 at plan time) | Alternative AST stack if the JSX-alignment stage needs language-agnostic parsing (e.g., adding Python/Go support later). For the v1 demo stack (Next.js + TS + Prisma), `@babel/parser` is sufficient and matches the Phase 9 webpack loader exactly | Phase 14 v1 demo only needs `@babel/parser`. Tree-sitter is a v2 generalization affordance — flag in OpenQuestions, do not adopt for v1 |
| Anthropic prompt caching (`cache_control: ephemeral` / 5min default TTL) | API feature (live) | The bootstrap pipeline reads the same N source files repeatedly across 5 derivation stages. Without caching, cost is N × file-content × stages. With caching at the system-prompt + file-content boundary, ~90% cache-read discount applies on stages 2–5 | **Recommended for Plan-level** if total cost exceeds $0.50 per bootstrap run on a 100-file repo. Validate during plan execution; fall back to non-cached if the skill ships before adopting it |
| `--allowedTools` / `--disallowedTools` flags on `claude -p` | CLI flags (live) | Limit the bootstrap-Skill subagent to read-only tools during analysis stages (Read, Glob, Grep, Bash for read-only commands) and only allow Write during the emit stage. Reduces accidental scope expansion | Plan-level — surface as constraint in the SKILL.md `allowed-tools` field |
| `Explore` built-in subagent | (Claude Code built-in) | If the bootstrap skill uses `context: fork`, `Explore` is the right `agent:` field — read-only tool set, optimized for codebase exploration. Fits the "discover stage" of the pipeline | Use for the discovery stages (1–2). The emit stage (5) needs Write access, so it can't run inside `Explore` — see "Pattern 1" below |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|---|---|---|
| Skill packaged as `SKILL.md` + scripts | Bash CLI / Node CLI tool (`bin/bootstrap-contracts`) | Skill format gives Claude-Code-native invocation (`/codebase-to-contracts`), discoverability via `description`, automatic loading when relevant phrasing matches, integration with `--add-dir`. CLI tool requires user to know it exists. **Skill wins** for the "point at any repo" demo affordance |
| Skill running in `context: fork` (subagent) | Skill running in the parent context | Subagent isolation prevents the bootstrap session from polluting the user's main conversation with N=hundreds of file reads. Trade-off: subagent loses access to user's earlier conversation — but bootstrap is a fresh action, doesn't need it. **Subagent wins** |
| Single mega-prompt that derives all contracts at once | 5-stage pipeline with separate `claude -p` calls | Single-prompt fails on repos > ~50 files (context window). 5-stage pipeline is more LLM calls but each is bounded; failure on one stage doesn't waste the others; idempotent re-runs are possible. **Pipeline wins** |
| Custom AST walker per language | Tree-sitter generalization | For the v1 demo stack (Next.js + TS), the existing `@babel/parser` setup from Phase 9 is the correct dep. Tree-sitter is the v2 polyglot move. Don't over-engineer |
| Bootstrap regenerates everything on every run | Hash-skip on existing sidecars (re-derive only when source changed) | Mirrors Phase 6's `should_derive` guard. Allows re-running the skill on the demo repo iteratively during prep. **Hash-skip wins** — reuse Phase 6's logic |
| LLM-only classification of node kind (`UI`/`API`/`data`/`external`/`lib`) | Heuristic-first, LLM-fallback (file path patterns: `app/**/page.tsx` → UI L3, `app/api/**/route.ts` → API L3, `prisma/schema.prisma` → data, etc.) | Heuristics are deterministic and free; LLM is for the ambiguous middle (`lib/payments.ts` could be `lib` or `external`). **Heuristic-first wins** — cheaper, faster, less drift across re-runs |
| Generate all UUIDs fresh on every run | Deterministic UUIDs from a hash of `(repo-name, file-path, ast-anchor)` | Non-deterministic UUIDs break re-runs (every run produces a different `.contracts/` tree, defeating hash-skip and confusing version control). Deterministic UUIDs make the bootstrap reproducible. **Deterministic UUIDs wins** — load-bearing for re-runs |

**Installation (delivered as part of the skill, not as runtime deps on the IDE):**

```bash
# The skill ships as a directory under .agents/skills/codebase-to-contracts/
# (or distributable via plugin / personal skills folder)
# No npm install on the IDE side. The skill scripts may invoke @babel/parser
# in the TARGET repo's node_modules at runtime.

# Skill-time (one-time, on target repo):
cd <target-repo>
# Skill scripts must verify @babel/parser, @babel/generator, js-yaml are
# available either in the target's node_modules or a fallback bundled
# in the skill's scripts/ directory.
```

---

## Architecture Patterns

### Recommended Project Structure

```
.agents/skills/codebase-to-contracts/        # ← lives in contract-ide repo OR distributed standalone
├── SKILL.md                                 # entry point; ≤500 lines per Anthropic guideline
├── references/                              # progressive-disclosure references
│   ├── output-schema.md                    # canonical L0–L4 + flow contract shapes (excerpts from Phase 9 contract-ide-demo)
│   ├── classification-rules.md             # heuristic kind/level taxonomy + when LLM fallback fires
│   ├── jsx-alignment.md                    # how to map atom intent → outermost JSX element
│   └── flow-synthesis.md                   # how to walk handler→lib→data→external chains
├── scripts/
│   ├── discover.mjs                        # Stage 1: enumerate files, classify, propose nodes (heuristic-first)
│   ├── derive-contracts.mjs                # Stage 2-3: per-node `claude -p --json-schema` derivation
│   ├── align-jsx.mjs                       # Stage 4: AST-walk every .tsx, set L4 code_ranges
│   ├── synthesize-flows.mjs                # Stage 5a: trace endpoint → lib → data → external chains
│   ├── emit.mjs                            # Stage 5b: write .contracts/ + plugin scaffold
│   ├── validate.mjs                        # Run JSX-01 + BACKEND-FM-01 equivalents in JS
│   └── helpers/
│       ├── babel-parser-bridge.mjs         # Loads @babel/parser via pnpm-store fallback (mirrors 09-04b loader logic)
│       ├── deterministic-uuid.mjs          # SHA-256 → UUIDv5 namespacing
│       ├── frontmatter-writer.mjs          # write_sidecar equivalent in JS (matches Rust round-trip)
│       └── claude-cli-bridge.mjs           # Spawn `claude -p --output-format json --json-schema`
├── schemas/
│   ├── frontmatter.json                    # JSON Schema for sidecar frontmatter (format_version: 3)
│   ├── contract-body.json                  # JSON Schema for ## Intent / ## Role / ## Inputs / ## Outputs / ## Side effects
│   └── flow.json                           # JSON Schema for flow contract members
├── templates/
│   ├── contract-uuid-plugin-loader.js      # Verbatim copy of contract-ide-demo/contract-uuid-plugin/index.js
│   ├── next-config-snippet.ts              # Insertion-ready next.config.ts wiring
│   └── package.json.fragment               # Plugin's local-workspace package.json
└── prompts/
    ├── classify-atom.txt                   # System prompt for stage 1 LLM fallback
    ├── derive-frontmatter.txt              # Stage 2: per-node frontmatter generation
    ├── derive-body.txt                     # Stage 3: ## Intent / ## Role / ## Examples / ## Inputs / ## Outputs / ## Side effects
    └── synthesize-flow.txt                 # Stage 5a: flow members ordering

bootstrap-demo-target/                       # the demo APPLICATION (separate repo, like contract-ide-demo)
├── (Next.js + Prisma + Auth + Stripe small SaaS app — see "Demo Target Selection" below)
└── (NO .contracts/ until skill runs)
```

### Pattern 1: Five-Stage Pipeline (the skill's orchestration spine)

**What:** Decompose bootstrap into 5 stages, each a separate `claude -p` call (or set of parallel calls per file). Each stage takes the prior stage's output as input. Idempotent: hash-skip per file/node so re-runs only re-do changed inputs.

**When to use:** The entire skill execution. Single mega-prompt fails on repos >~50 files (context window). Pipeline stages are bounded.

```
Stage 1 — DISCOVER  (heuristic-first, deterministic)
  Walk target repo. Classify each file by path + extension into a candidate node:
    app/**/page.tsx                → kind: UI, level: L3 (one per route)
    app/**/layout.tsx              → kind: UI, level: L3 (alongside page if exists)
    app/api/**/route.ts            → kind: API, level: L3 (one per HTTP method)
    prisma/schema.prisma → models  → kind: data, level: L2 (one per Prisma model)
    lib/**/*.ts (exports fn)       → kind: lib, level: L2 or L3 depending on size
    lib/**/*Adapter.ts / Stripe / Mailchimp / OAuth callbacks → kind: external, level: L3
    cron/scheduled-tasks           → kind: cron / job, level: L3
    Identifiable JSX components inside page.tsx → kind: UI, level: L4 (atoms)
  Output: nodes.json — list of { uuid (deterministic), kind, level, file, candidate_lines, parent_hint }

Stage 2 — DERIVE FRONTMATTER  (per-node, parallel-by-file, claude -p --json-schema)
  For each candidate node, send file contents (with prompt-cache on the system prompt) to
  claude -p with the frontmatter.json schema. Output: validated YAML frontmatter
  (uuid, kind, level, parent, neighbors, code_ranges, route, format_version: 3,
   rollup_state: untracked, rollup_inputs: [], all rollup_* zeroed).

Stage 3 — DERIVE BODY  (per-node, batched by L3 surface, claude -p --json-schema)
  For each L3 surface (or L2 root), derive the contract body sections. Backend kinds
  (API/lib/data/external/job/cron/event) MUST get populated ## Inputs / ## Outputs /
  ## Side effects (BACKEND-FM-01). UI L3 surfaces get ## Intent / ## Role / ## Notes.
  L4 atoms get ## Intent / ## Role / ## Examples (the latter empty — Beat-1-style human
  authoring leaves a placeholder).

Stage 4 — ALIGN JSX CODE_RANGES  (deterministic AST walk, no LLM)
  For every L4 UI atom: parse the parent .tsx with @babel/parser; find the outermost JSX
  element whose source span best matches the atom's intent description (heuristic + LLM
  tiebreak only if multiple candidates score equally). Update code_ranges to the JSX
  element's exact line span. Refuse to emit any L4 UI atom whose AST search returns
  zero matches (loud warning, mark for human review). Backend kinds skipped (JSX-01 exempt).

Stage 5a — SYNTHESIZE FLOW CONTRACTS  (per-flow, claude -p)
  For each L3 trigger (UI page or API endpoint): trace its handler → lib → data → external
  call chain via static analysis (resolve imports + call sites) + LLM verification.
  Emit a flow contract per chain with members: [trigger_uuid, ...participants_in_order].
  format_version: 5 (matches Phase 9 flow contracts).

Stage 5b — EMIT  (write .contracts/, install Babel plugin, run validators)
  Write all sidecars atomically (temp + rename, mirrors Phase 6 pattern).
  Copy contract-uuid-plugin/ scaffold from skill templates/ → target repo.
  Patch next.config.ts to wire the loader.
  Run validate.mjs (JSX-01 + BACKEND-FM-01 equivalents in JS).
  If any validator fails: revert all writes, surface error, do not commit.
  If all pass: skill returns success with summary "{N L0–L4 sidecars + M flow contracts +
  plugin installed}".
```

**Key insight:** Stages 2 and 3 are the LLM-heavy, parallelizable work. Stage 4 is deterministic. Stage 5 is the safety gate. **Don't run stage 5b if stage 4 fails** — emit nothing if any L4 UI atom can't be aligned.

### Pattern 2: Skill packaged as `context: fork` subagent

**What:** The SKILL.md uses `context: fork` and `agent: Explore` (or a custom agent) for the discovery stages. The emit stage (5b) requires Write — handle by either (a) running the entire skill in a non-fork context (loses isolation), or (b) splitting the skill into two: a `discover-and-derive` subagent that returns proposed contracts as JSON, and an `emit` action in the parent context that writes them. **Recommendation: option (b)** — the user sees the proposal before any writes, can cancel cleanly.

**Source:** Claude Code Skills docs — https://code.claude.com/docs/en/skills (Pattern: "Skills and subagents work together in two directions").

```yaml
# .agents/skills/codebase-to-contracts/SKILL.md
---
name: codebase-to-contracts
description: |
  Bootstrap a `.contracts/` tree (L0–L4 sidecars + flow contracts + Babel plugin)
  from an existing Next.js + Prisma + TypeScript codebase. Run this when pointing
  Contract IDE at a new repo for the first time, when the repo has no `.contracts/`
  directory, or when the user says "bootstrap contracts", "set up Contract IDE for
  this repo", "generate contracts from this codebase", or "make this repo
  Contract IDE-ready". Produces validator-passing output that the IDE can load
  without manual cleanup.
allowed-tools: Read Glob Grep Bash(claude *) Bash(node *) Bash(pnpm *) Write Edit
disable-model-invocation: false
argument-hint: [repo-path]
arguments: [repo_path]
paths: "**/.contracts/**, **/*.tsx, **/*.ts, **/route.ts, **/page.tsx, **/schema.prisma"
---

# /codebase-to-contracts — Bootstrap Contract IDE for an existing repo

Run a 5-stage bootstrap pipeline on `$repo_path` (or current working directory if no arg)
that produces a complete `.contracts/` tree the IDE can load without manual cleanup.

[... rest of SKILL.md per Anthropic skill-creator guidelines ...]
```

**Key fields explained:**
- `description` — Anthropic's docs are explicit: "Make descriptions somewhat 'pushy' to combat undertriggering." Front-load trigger phrases.
- `allowed-tools` — pre-approved set so the skill doesn't prompt mid-bootstrap. The `Bash(claude *)` permission is what lets the skill spawn `claude -p` subprocesses.
- `paths` — restricts auto-loading. The skill only auto-suggests when working with .tsx/.ts/Prisma files (i.e., the user is clearly in a Next.js codebase).
- `disable-model-invocation: false` (default) — Claude can auto-suggest the skill when it detects the user wants to bootstrap.
- `argument-hint` — shows in `/` autocomplete: `/codebase-to-contracts [repo-path]`.

### Pattern 3: Deterministic UUIDs (UUIDv5 from a stable namespace)

**What:** Every node UUID is derived from `SHA-256(repo_name + file_path + ast_anchor)`. Re-runs of the skill produce the same UUIDs for the same code. Deletes a file → its UUID disappears; rename → new UUID (with optional migration heuristic to detect "this is the same node, renamed" — defer to v2).

**When to use:** Every node UUID generation. Never `crypto.randomUUID()`.

```javascript
// scripts/helpers/deterministic-uuid.mjs
import { createHash } from 'node:crypto';

const NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // standard URL namespace, RFC 4122 §C.2

export function deterministicUuid(repoName, filePath, astAnchor) {
  // astAnchor is e.g. "page.tsx::default-export" or "page.tsx::JSXElement@L60-65"
  const input = `${repoName}::${filePath}::${astAnchor}`;
  // UUIDv5: namespace + input → SHA-1 → format
  const hash = createHash('sha1').update(NAMESPACE).update(input).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '5' + hash.slice(13, 16),                    // version 5
    ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20), // variant
    hash.slice(20, 32),
  ].join('-');
}
```

**Why this matters:** If the user runs the skill twice, hash-skip works on stage 2/3 (re-derivation only fires when `code_hash` changed). Without deterministic UUIDs, every run produces fresh sidecars — the user's git history fills with spurious churn, and no cache helps.

### Pattern 4: Stage 4 JSX-alignment search (the deterministic risk)

**What:** For each L4 UI atom (proposed in Stage 1, derived in Stage 2/3), find the outermost JSX element in the parent `.tsx` file whose semantic role matches the atom's `## Intent`.

**The hard part:** Stage 1's heuristic produces a *candidate line range* (e.g., "danger zone section, lines 49–55"). Stage 2/3 derives an `## Intent` and `## Role` for that candidate. Stage 4 must:

1. Parse the .tsx with `@babel/parser` (matching Phase 9's webpack loader exactly so the validators agree).
2. Find all JSX elements whose source span overlaps the candidate range.
3. Filter to outermost (no parent JSX element fully contains it within the same range).
4. If exactly one match → that's the `code_ranges`.
5. If zero matches → mark the atom unbootstrappable, surface a warning, do not emit it (continue with siblings).
6. If multiple matches → use intent text to disambiguate (LLM tiebreak via `claude -p`, single call, top-1 choice).

```javascript
// scripts/align-jsx.mjs (sketch)
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import { readFileSync } from 'node:fs';

export function alignAtomToJsx(atomCandidate, parentFileSource) {
  const ast = parse(parentFileSource, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
  });
  const matches = [];
  traverse.default(ast, {
    JSXOpeningElement(path) {
      const start = path.node.loc?.start.line;
      const end = path.parent.loc?.end.line ?? start;
      // Match if the JSX element's span is FULLY contained in the candidate range
      if (start >= atomCandidate.candidate_lines.start_line &&
          end <= atomCandidate.candidate_lines.end_line) {
        // Check outermost: no ancestor JSX element is also fully contained
        const isOutermost = !path.findParent((p) => {
          if (p.type !== 'JSXElement') return false;
          const ps = p.node.loc?.start.line;
          const pe = p.node.loc?.end.line;
          return ps >= atomCandidate.candidate_lines.start_line &&
                 pe <= atomCandidate.candidate_lines.end_line;
        });
        if (isOutermost) {
          matches.push({ start_line: start, end_line: end, node: path.node });
        }
      }
    },
  });
  if (matches.length === 0) return { error: 'no_match', atomCandidate };
  if (matches.length === 1) return { code_ranges: [{ file: atomCandidate.file, ...matches[0] }] };
  // Multi-match: LLM tiebreak — extract each candidate JSX as a snippet, ask claude to
  // pick the one matching atomCandidate.intent.
  return { needs_tiebreak: matches, atomCandidate };
}
```

**Critical validation:** Run JSX-01 validator (`jsx_align_validator.rs`) on the bootstrapped repo as the final step of stage 5b. If any L4 UI atom fails alignment, **abort the entire emit** — do not write a partial `.contracts/` tree.

### Pattern 5: Backend section derivation (`## Inputs` / `## Outputs` / `## Side effects`)

**What:** For backend kinds (API, lib, data, external, job, cron, event), Stage 3 must populate three required sections. The validator (`backend_section_validator.rs`) refuses to load the repo otherwise.

**How:** A `claude -p --json-schema` call per node with this schema:

```json
{
  "type": "object",
  "required": ["intent", "role", "inputs", "outputs", "side_effects"],
  "properties": {
    "intent": { "type": "string", "minLength": 50 },
    "role": { "type": "string", "minLength": 30 },
    "inputs": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
    "outputs": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
    "side_effects": { "type": "array", "items": { "type": "string" }, "minItems": 0 }
  }
}
```

`side_effects` minItems is 0 (some pure functions have none); validator only checks the *section header* exists, not that it has bullets. Inputs and outputs must be non-empty (the validator likewise checks for sections, not non-emptiness — but our skill enforces stricter to avoid awkward empty sections).

**Reference template** — match the Phase 9 seeded contract style exactly. Example from `contract-ide-demo/.contracts/ambient/api-account-delete-001.md`:

```markdown
## Inputs
- `Authorization: Bearer <token>` — session token of the authenticated user
- Request body: `{}` — no body required; the user is derived from the session

## Outputs
- `204 No Content` — deletion initiated successfully
- `401 { error: 'unauthorized' }` — no valid session
- `409 { error: 'already_deleted' }` — user already has a deletedAt set

## Side effects
- Calls beginAccountDeletion(userId) which:
  - Sets User.deletedAt (soft-delete)
  - Anonymizes Invoice records (...)
```

The bootstrap output should match this prose density — bullets + inline code spans + cross-references to other contracts (when known).

### Pattern 6: Flow contract synthesis (Stage 5a)

**What:** A flow contract has `format_version: 5`, `kind: flow`, `members: [trigger_uuid, p1_uuid, p2_uuid, ...]` in invocation order. Phase 9's seeded `flow-delete-account.md` is the canonical exemplar.

**How:** For each L3 trigger node from Stage 1:
1. Resolve all imports in the trigger's source file (`@babel/parser` again).
2. Filter to imports of nodes that exist in our `nodes.json` (i.e., callees we have contracts for).
3. Walk the AST to find call sites in invocation order.
4. Recurse one level (callee's callees) to capture the chain.
5. LLM verification (`claude -p`) on the synthesized chain — pass the source + the proposed `members:` list and ask "is this the actual invocation order?" — accept the LLM's reordering.
6. Emit `flow-<slug>.md` with `format_version: 5` and `members:` set.

**Caveat:** Cross-flow shared services (Stripe, Mailchimp, db.user.update) are participants in multiple flows. The skill should detect and **not** introduce duplicate sidecars — same UUID across multiple flow `members:` lists. Phase 9's data model handles ghost references via SQLite (DATA-05); the skill just needs to emit canonical sidecars once.

### Anti-Patterns to Avoid

- **One mega-prompt that does everything.** Will fail on any repo > ~50 files. Pipeline by stage; stage by file/node.
- **Random UUIDs.** Re-runs are unusable. UUIDv5 from `(repo, file, ast-anchor)`.
- **Skipping the validators.** The skill's exit gate is "the IDE loads the bootstrapped repo without errors." Anything less ships a footgun.
- **Re-deriving on every run.** Wastes LLM cost; mirrors Phase 6's `should_derive` guard via `code_hash` skip.
- **Partial emit on validator failure.** A `.contracts/` directory missing some atoms is worse than no `.contracts/`. All-or-nothing.
- **Inventing requirement IDs in `gsd-planner` output.** Yang explicitly flagged this — propose new `BOOTSTRAP-*` IDs in the plan, surface to him for ratification before adding to REQUIREMENTS.md.
- **Hard-coding the contract output style.** Use `references/output-schema.md` to pin to Phase 9's exemplar files; if Phase 9's style evolves, update the reference, not the prompts.
- **Ignoring CANVAS-PURPOSE.md's other Phase 14 framing.** The "Implementation Decisions Manifest" is a *different* phase. Document the divergence in PLAN.md.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| LLM call to Claude | Direct `https://api.anthropic.com/v1/messages` reqwest from skill scripts | `claude -p --output-format json --json-schema` subprocess (Phase 6 + Phase 11 pattern) | Subscription auth, no API key juggling, structured output validated against schema, prompt caching opt-in via flags |
| YAML frontmatter parse + write | Custom YAML stringifier in JS | `js-yaml` (already a transitive dep in Next.js apps; the Phase 9 webpack loader already uses it via pnpm-store fallback resolution) | Round-trip safety — drift between custom serialization and `serde_yaml_ng` round-trip in Rust will eventually corrupt sidecars |
| TypeScript/JSX parsing | Regex-based JSX detection | `@babel/parser` + `@babel/traverse` (matches Phase 9 webpack loader exactly) | JSX has nested-tag corner cases that regex never handles; using a different parser introduces source-span representation drift between skill output and validator |
| SHA-256 hashing | Custom hash | Node `crypto.createHash('sha256')` (built-in) | Match Phase 6's `code_hash` semantics exactly: line-by-line concatenation, `\n` between lines, trim before body hashing |
| UUID generation | `crypto.randomUUID()` | Deterministic UUIDv5 via SHA-1 + namespace | Re-run idempotency depends on stable UUIDs; random kills hash-skip and pollutes git diffs |
| Babel plugin generation | Author a fresh webpack loader from scratch | **Copy `contract-ide-demo/contract-uuid-plugin/index.js` verbatim** + parameterize repo-root path | Phase 9 spike PASSED for a reason; rewriting risks reintroducing pnpm-store-resolution bugs the original solved |
| Validator invocation | Re-implement JSX-01 / BACKEND-FM-01 in JS | Spawn the IDE binary's validator commands as a subprocess, OR re-implement with EXACT same AST library + section parser semantics | If the skill's validator and the IDE's validator disagree, the skill emits "passing" output that the IDE rejects on load — worst kind of bug |
| Flow `members:` ordering | Hand-pick callees from imports | AST call-graph extraction + LLM verification | Static analysis catches what the LLM misses (every call site); LLM catches what static analysis misses (control flow, conditionals); both together catch most |
| Skill packaging | Custom CLI tool | `SKILL.md` per Agent Skills v1 spec | Skill format is the standard; anything else loses Claude-Code-native discoverability |

**Key insight:** Phase 14 is gluework over Phase 6 / Phase 9 / Phase 11 primitives. The temptation will be to "rebuild it cleaner" — resist. Reuse byte-for-byte where possible. The skill's correctness is measured by "does the IDE load the bootstrapped repo?" — that gates everything else.

---

## Common Pitfalls

### Pitfall 1: LLM determinism across re-runs

**What goes wrong:** Run the skill twice on the same repo. Get two different `## Intent` bodies for the same atom. Git diff is enormous; user thinks the skill is broken.

**Why it happens:** Default LLM temperature > 0; same prompt produces different outputs. Even at temperature 0, model versions drift across releases.

**How to avoid:**
- Set `temperature: 0` on every `claude -p` call.
- Hash-skip on existing sidecars: if `code_hash` matches the current source, **don't re-derive** (mirrors Phase 6 `should_derive`).
- Pin `--model` to a specific version (e.g., `claude-sonnet-4-6` not `claude-sonnet-latest`).
- Treat re-runs as additive only: a node missing from prior runs gets derived; a node present stays unless its source changed.

**Warning signs:** User reports "I ran the skill twice and got 200 line of git diff for unchanged files."

### Pitfall 2: UUID instability across re-runs

**What goes wrong:** Re-run produces fresh UUIDs; old `.contracts/<old-uuid>.md` orphaned; SQLite cache (DATA-02) keeps both. Sidebar shows duplicates. Beat 1 click resolves to the wrong atom.

**How to avoid:** UUIDv5 from `(repo_name, file_path, ast_anchor)`. **Never** `crypto.randomUUID()`. See Pattern 3 above.

**Warning signs:** Skill output diff shows N new files added + N old files deleted (instead of N modified).

### Pitfall 3: Babel plugin auto-generation breaks pnpm hoist

**What goes wrong:** Skill writes `contract-uuid-plugin/index.js` to target repo. Plugin tries to require `@babel/parser`, but pnpm doesn't hoist deps to the root `node_modules` — it lives in `node_modules/.pnpm/...`. Plugin fails at build time.

**How to avoid:** **Copy the existing pnpm-store-fallback resolver from Phase 9's plugin** verbatim. The 09-04b plan's loader already solved this — `resolvePnpmDep()` walks `node_modules/.pnpm/` looking for the right virtual store entry. Don't simplify it.

**Warning signs:** Target repo `pnpm build` fails with `Cannot find module '@babel/parser'` from inside `contract-uuid-plugin/`.

### Pitfall 4: Idempotency on partial-failure re-runs

**What goes wrong:** Skill fails mid-stage (LLM rate limit, network blip). Repo has half-written `.contracts/`. Re-run doesn't know which files completed.

**How to avoid:**
- Atomic emit: write to `.contracts/.staging/` first; rename to `.contracts/` only on full-pipeline success.
- If `.contracts/.staging/` exists at start of new run, prompt user: "Previous bootstrap incomplete. Resume / restart / abort?"
- Per-stage progress JSON (`.contracts/.staging/_progress.json`) tracks which nodes are at what stage. Resume picks up at first incomplete stage.

**Warning signs:** Repo has both `.contracts/.staging/` and `.contracts/` directories simultaneously without a clear story.

### Pitfall 5: Large-repo cost / latency blowup

**What goes wrong:** User points the skill at a 500-file Next.js monorepo. ~200 candidate L3 nodes × Stage 2 + Stage 3 = 400 LLM calls @ ~$0.05 each = $20+. Skill runs for 30+ minutes. User abandons mid-run.

**How to avoid:**
- **Anthropic prompt caching** at the system-prompt boundary — `cache_control: ephemeral` on the prompt + on file contents that get re-read across stages. Cuts cost ~80% on stages 2–5 (90% off cache hits per Anthropic Apr-2026 pricing).
- Pre-flight cost estimator: before stage 2 fires, count candidate nodes × estimated $/node, surface to user as "Estimated cost: $X. Estimated time: Ymin. Continue?" — same UX as Phase 10's BackfillModal three-step opt-in.
- For demo target: pick a small repo (50–150 files) — cost stays under $1.50, time under 8 minutes.
- Parallelize stages 2 + 3 across files (claude CLI handles concurrent invocations).

**Warning signs:** Skill on a large repo takes >15 minutes per stage; user kills it before completion.

### Pitfall 6: Skill auto-trigger spam (description too aggressive)

**What goes wrong:** Skill description is "pushy" per Anthropic's recommendation. Triggers every time the user types "show me this codebase" or "explain this app." User annoyed, disables the skill.

**How to avoid:**
- Use `paths` field to restrict auto-trigger to repos that have `next.config.ts` / `.tsx` files / `prisma/schema.prisma` (clearly Next.js-app shaped).
- Description should mention **bootstrap** explicitly, not vague phrasings like "set up the IDE."
- Set `disable-model-invocation: false` (default) but be specific in the description's "when to use" — "when the user has just opened a new repo for the first time, when there is no existing `.contracts/` directory, or when the user explicitly says 'bootstrap contracts.'"

**Warning signs:** User reports "the skill keeps firing when I just want to read code."

### Pitfall 7: Validator drift between skill and IDE

**What goes wrong:** Skill's JS-side `validate.mjs` says "all OK." User opens repo in IDE. Rust-side `jsx_align_validator.rs` says "L4 atom xyz123 has multi-element range, REFUSING TO LOAD." User loses faith.

**How to avoid:**
- **Treat the IDE's Rust validators as source of truth.** Skill must spawn the IDE binary or a CLI exposing the validator (`contract-ide validate <repo>`) as the final gate before declaring success.
- Or: re-implement validator in JS using the **same** `@babel/parser` config and section-parsing rules. Test parity with a fixture set covering the JSX-01 edge cases (multi-element ranges, partial-tag ranges, fragment children).

**Warning signs:** User runs skill, runs IDE, sees a startup error.

### Pitfall 8: Demo target too large or too "clean"

**What goes wrong:** Pick a famous open-source app (`vercel/commerce`, `t3-app`). Bootstrap takes 20 minutes; result is overwhelming; demo can't show the bootstrap end-to-end on stage. OR — pick a too-perfect repo and the bootstrap output is so smooth that judges think it's hand-curated.

**How to avoid:**
- Demo target = small (50–150 .tsx files, 10–20 API routes), real (open-source or yang-built), with at least one external integration (Stripe / Auth / Mailchimp) so flow contracts demonstrate value.
- For a **live** Phase 14 demo: bootstrap a small repo on stage in <5 minutes (cost <$1), or pre-record the bootstrap and play it back as a recorded segment.
- For a **recorded** demo: any repo size works, but pick one with a clear product story (a small SaaS, not a low-code generator).

**Warning signs:** Bootstrap demo runs over 5 minutes on stage; judges visibly bored.

---

## Code Examples

### SKILL.md skeleton (verified against Anthropic skill-creator format)

```markdown
---
name: codebase-to-contracts
description: |
  Bootstrap a `.contracts/` tree (L0–L4 sidecars + flow contracts + Babel plugin) from
  an existing Next.js + Prisma + TypeScript codebase. Run this when pointing Contract
  IDE at a new repo for the first time, when the repo has no `.contracts/` directory,
  or when the user says "bootstrap contracts", "set up Contract IDE for this repo",
  "generate contracts from this codebase", or "make this repo Contract IDE-ready".
  Produces validator-passing output that the IDE can load without manual cleanup.
allowed-tools: Read Glob Grep Bash(claude *) Bash(node *) Bash(pnpm *) Bash(git *) Write Edit
disable-model-invocation: false
argument-hint: "[repo-path]"
arguments: [repo_path]
paths: "**/.contracts/**, **/*.tsx, **/*.ts, **/route.ts, **/page.tsx, **/schema.prisma, **/next.config.*"
---

# /codebase-to-contracts — Bootstrap Contract IDE for an existing repo

Run a 5-stage bootstrap pipeline on $repo_path that produces a complete `.contracts/`
tree the IDE can load without manual cleanup. The pipeline is idempotent — re-running
on the same repo only re-derives nodes whose source changed.

## Pre-flight

Verify $repo_path is set; default to current working directory if absent. Verify the
target is a Next.js + TypeScript repo (presence of `next.config.ts` or `next.config.js`
+ at least one `.tsx` file in `app/` or `pages/`). If not, halt and surface to user.

If `$repo_path/.contracts/.staging/` exists, prior run was incomplete. Ask user:
resume / restart / abort.

## Stage 1: Discover (heuristic-first)

Run `node ${CLAUDE_SKILL_DIR}/scripts/discover.mjs $repo_path`. Output is
`$repo_path/.contracts/.staging/nodes.json` — list of candidate nodes with deterministic
UUIDs.

Use heuristic classification:
- `app/**/page.tsx` → `kind: UI, level: L3`
- `app/api/**/route.ts` → `kind: API, level: L3` (one per HTTP method)
- `prisma/schema.prisma` models → `kind: data, level: L2`
- `lib/**/*Adapter.ts` or files importing `stripe` / `@mailchimp` / OAuth providers → `kind: external, level: L3`
- `lib/**/*.ts` (other) → `kind: lib, level: L2 or L3` (size-based)

For ambiguous files, defer to LLM via `claude -p --json-schema $CLAUDE_SKILL_DIR/schemas/classify.json`.

## Stage 2: Derive frontmatter

For each candidate node, run `claude -p --output-format json --json-schema $CLAUDE_SKILL_DIR/schemas/frontmatter.json` with the prompt at `$CLAUDE_SKILL_DIR/prompts/derive-frontmatter.txt`.
Pass file contents with `cache_control: ephemeral` on the file-content blocks.

[... see references/derivation-pipeline.md for full per-stage detail ...]

## Stage 3: Derive contract bodies

[... per Pattern 5 above ...]

## Stage 4: Align JSX code_ranges

`node ${CLAUDE_SKILL_DIR}/scripts/align-jsx.mjs $repo_path`. Refuse to proceed if any L4 UI
atom can't be aligned to an outermost JSX element.

## Stage 5: Synthesize flows + emit

`node ${CLAUDE_SKILL_DIR}/scripts/synthesize-flows.mjs $repo_path`
`node ${CLAUDE_SKILL_DIR}/scripts/emit.mjs $repo_path`
`node ${CLAUDE_SKILL_DIR}/scripts/validate.mjs $repo_path`

If validate succeeds, atomic-rename `.contracts/.staging/` → `.contracts/`. Surface summary.
If any stage fails, do not write to `.contracts/`. Surface diagnostic.

## Additional resources

- Output schema and exemplars: [references/output-schema.md](references/output-schema.md)
- Classification taxonomy: [references/classification-rules.md](references/classification-rules.md)
- JSX alignment internals: [references/jsx-alignment.md](references/jsx-alignment.md)
- Flow synthesis algorithm: [references/flow-synthesis.md](references/flow-synthesis.md)

## Output

On success: prints summary table — N L3 surfaces, M L4 atoms, K flow contracts, plugin
installed, validators passed. Prints next-step instructions: "Open Contract IDE → File →
Open Repo → select $repo_path".
```

### `claude -p --json-schema` invocation (verified pattern from Phase 11)

```bash
# Stage 2: derive frontmatter for one node
claude -p \
  --output-format json \
  --json-schema "$CLAUDE_SKILL_DIR/schemas/frontmatter.json" \
  --append-system-prompt "$(cat $CLAUDE_SKILL_DIR/prompts/derive-frontmatter.txt)" \
  --allowedTools Read \
  "Generate the frontmatter for the file at path: $TARGET_FILE. The candidate node has uuid: $NODE_UUID, kind: $KIND, level: $LEVEL. Output only the structured_output JSON."
```

### Deterministic UUIDv5 in Node (no external deps)

See Pattern 3 above (`scripts/helpers/deterministic-uuid.mjs`).

### Validator parity test (skill-side vs IDE-side)

```javascript
// Test fixture: a known-good Phase 9 exemplar contract.
// Skill's validate.mjs MUST agree with IDE's jsx_align_validator.rs on this fixture.
import { strict as assert } from 'node:assert';
import { validateJsxAlignment } from '../scripts/validate.mjs';

// Fixture: copy of contract-ide-demo/.contracts/a1000000-...md + the parent .tsx
const result = await validateJsxAlignment({
  contractPath: 'fixtures/a1000000.md',
  sourceFile: 'fixtures/page.tsx',
});
assert.equal(result.errors.length, 0, 'Phase 9 exemplar must pass JSX-01');

// Inverse: a known bad fixture (multi-element range)
const bad = await validateJsxAlignment({
  contractPath: 'fixtures/multi-element-bad.md',
  sourceFile: 'fixtures/page.tsx',
});
assert.equal(bad.errors.length, 1);
assert.match(bad.errors[0].message, /multi-element|partial/);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Per-tool memory CLIs (custom one-offs) | Agent Skills open standard (`SKILL.md`) | Dec 2025 | Anthropic + OpenAI standardized; skills work across Claude Code, Cursor, Codex, Gemini CLI. Phase 14 must ship as a Skill, not a bespoke CLI |
| Free-form `claude -p` + manual JSON parse | `claude -p --output-format json --json-schema` | 2026-04 (Phase 11 RESEARCH.md verified live) | Schema-validated structured output eliminates defensive parsing in skill scripts |
| Hand-authored `.contracts/` per repo | Bootstrap skill | Phase 14 (this phase) | "Point at any repo" stops being narrative, becomes demoable affordance |
| Babel plugin written from scratch per repo | Skill ships a verbatim copy of Phase 9's spiked loader | Phase 14 | Reduces risk; the spike PASSED for a reason |
| Random UUIDs per derivation run | Deterministic UUIDv5 from `(repo, file, ast-anchor)` | Phase 14 | Re-run idempotency; clean git diffs; hash-skip works |

**Deprecated / outdated:**
- Hand-rolled HTTP calls to `https://api.anthropic.com/v1/messages` from skill scripts — always use `claude -p` subprocess for subscription-auth + structured-output flags.
- `tree-sitter` for the v1 demo stack — `@babel/parser` matches Phase 9 exactly. Tree-sitter is a v2 polyglot move only.
- Direct `crypto.randomUUID()` for node UUIDs — kills re-run idempotency.

---

## Demo target codebase selection (the "Demo Application" half)

The orchestrator brief asks: what properties should the demo target have so the bootstrap demo lands? This research recommends:

### Required properties

| Property | Range | Why |
|---|---|---|
| **Stack** | Next.js 14+ App Router + TypeScript + Tailwind + Prisma + at least one external integration (Stripe / Auth / Mailchimp / SendGrid) | Matches the validator stack (BABEL-01 + JSX-01 + BACKEND-FM-01 are all Next.js-shaped). Phase 9 plumbing reuses 1:1. Other stacks (SvelteKit, Remix, Vue) can come in v2 |
| **Size** | 50–150 .tsx files, 10–25 API routes, 3–8 Prisma models | Bootstrap runs in <5 min on stage; cost stays under ~$1.50; output stays demoable (sidebar + Cmd+P land "feels populated, not overwhelming") |
| **Realism** | Real product surfaces (a small SaaS, blog with comments, indie tool — not a hello-world or a low-code generator) | The "real product, real flows" angle is what makes "point at any repo" credible; a contrived target reads as cherry-picked |
| **Provenance** | Open-source OR Yang-built (clear license) | Ability to commit + re-run; legal clarity; demo recording rights |
| **Distinct from `contract-ide-demo`** | Yes — Phase 9's seeded repo has hand-crafted contracts; the bootstrap demo target must NOT carry those (otherwise it's not a bootstrap, it's a re-derivation of seeded content) | Beats 1–4 of the canonical demo run on `contract-ide-demo`; Phase 14's demo runs on a SECOND repo (the bootstrap target) to demonstrate generalization |

### Candidate options (to be ratified during planning)

| Candidate | Pros | Cons | Recommendation |
|---|---|---|---|
| **Yang-built micro-SaaS** (e.g., a single-feature SaaS Yang scaffolds in 1–2h: notes app, time tracker, expense splitter — Next.js + Prisma + Auth + Stripe checkout) | Yang has full provenance; size is dialable; can plant 1–2 deliberate "interesting" implicit decisions for the demo to surface; matches contract-ide-demo's stack exactly | 1–2h up-front cost in addition to skill build | **STRONG** — recommend this. Yang knows the codebase, can guarantee no surprises, easiest to pre-record bootstrap on a fixed commit |
| **`vercel/commerce` or its templates** | Famous; recognizable; well-engineered Next.js | Probably too large (>500 files in some configurations); slow bootstrap; output overwhelming | **WEAK** — over-sized; the famous repo angle isn't worth the runtime cost |
| **Small open-source SaaS starter** (e.g., `Documenso` clone, `cal.com` micro-fork, an indie SaaS template) | Real codebase, third-party provenance is genuine | Vetting any specific candidate for size/license takes a research pass that hasn't happened; risk of last-minute "this repo doesn't quite fit" | **MEDIUM** — viable, but adds a research-and-vet phase to Phase 14 planning. Defer to plan-time |
| **`shadcn/ui` example app** | Authoritative shadcn stack matches Phase 9 exactly | These are usually too small (single-page demos), no real backend flows | **WEAK** — too small to demonstrate flow synthesis |
| **A second copy of `contract-ide-demo`** (without seeded contracts, run skill, compare to the hand-crafted versions) | A/B comparison of skill output vs hand-crafted contracts is highly informative as a Phase 14 SC | Loses the "any repo" narrative — same product, same surface, no generalization shown | **MEDIUM** — useful as an internal QA gate (skill output ≅ Phase 9 hand-crafted), poor as a demo target |

**Strong recommendation:** Yang-built micro-SaaS. Spec out 1 page; run create-next-app + Prisma init; ship 8–12 page.tsx + 5–10 route.ts + 2–3 Prisma models + 1–2 external integrations (Stripe checkout test mode, Resend email). Total scaffold: 1–2 hours. The bootstrap demo then feels like "real product → contracts in 4 minutes" rather than "scripted toy → scripted toy contracts."

---

## Validation of the orchestrator's hypothesis

> **Hypothesis:** Phase 14's purpose is "make 'point this at any repo' a real demo affordance" — strengthening the broader product story.

**Verdict: SUPPORTED.** The pitch already promises this in three places:

1. **`PITCH.md` § "Market — Wedge: individual developer using Claude Code":** *"Download the IDE. Point it at a repo. Substrate populates from prior sessions. Constraint injection makes every future session 3× more effective."* — but **without Phase 14**, "point it at a repo" requires the user to hand-author L0–L4 contracts. Phase 14 makes the wedge real.
2. **`PITCH.md` Q&A § "What's the ingestion period? Cold start before this is useful?":** *"Day 0 bootstraps from existing CLAUDE.mds, ADRs, design docs, and recent PR descriptions via importers."* — Phase 14 is one of those importers (specifically: code → contracts).
3. **`VISION.md` § "The two-source pattern":** *"Code-based seeding bootstraps the substrate on install: derive proposed constraints from code patterns (framework usage, import conventions, file naming), present as a curated list for human accept/reject. Solves the cold-start problem."* — VISION names this exact bootstrap as the cold-start solution.

**Net:** Phase 14 isn't a tangent. It's the operationalization of three existing pitch claims. Without it, the pitch is selling a behavior the product can't deliver outside `contract-ide-demo`. The CLAUDE.md rule ("don't introduce work that doesn't trace back to the demo") is satisfied — the demo's pitch hinges on this affordance being real.

**Caveat:** The locked 4-beat presentation script (`demo/presentation-script.md`) does NOT currently include a Phase 14 beat. The 4-beat structure runs on `contract-ide-demo` end-to-end. Phase 14's demo affordance is therefore either:
- **(A)** A new pre-beat or post-beat showcase: "before we run the 4 beats, here's how we got the contracts in the first place" (~30s recorded segment), OR
- **(B)** Q&A-only material: judges who ask "does this work on any repo?" get a 1-minute live demo of the skill running against a small target.

Recommendation: **Option B** for v1 — Phase 14 ships the skill, Yang prepares a 60–90s standalone bootstrap demo on a small target, but the 4-beat script stays untouched. Adding a 5th beat risks demo overrun and dilutes the existing arc. Surface this scope question to Yang at plan-time.

---

## Divergence with `CANVAS-PURPOSE.md` (orchestrator-flagged)

The orchestrator brief asked: `CANVAS-PURPOSE.md` mentions a "Phase 14 — Implementation Decisions Manifest, full coverage" provisional name. The actual roadmap title is "Codebase-to-Contracts Bootstrap." Are these the same phase?

**Verdict: NO. They are two different phases.** Read carefully:

- **`CANVAS-PURPOSE.md` § "v2 extension — the broader manifest + 2-pass auditor"** describes a phase about **production-grade `decisions.json` emission for arbitrary atoms** (not just the two demo atoms hand-crafted in Phase 11), plus a **2-pass auditor** that re-reads code to surface negative-space decisions. Schema additions: `decisions` field on atom-level frontmatter, auditor agent, AST analyzer, decisions diff in receipt cards. **Per-atom scope.**
- **`ROADMAP.md` Phase 14 (current)** is "Codebase-to-Contracts Bootstrap (Skill + Demo Application)" — bootstrapping the **entire L0–L4 hierarchy + flow contracts + Babel plugin** for an existing repo. **Repo-wide scope.**

These are orthogonal:
- Bootstrap (this phase) produces the contracts.
- Implementation Decisions Manifest (a future phase) annotates atoms with implicit decisions.

A bootstrapped repo has empty `## Implicit Decisions` sections (or absent — Phase 11 ships these only for two demo atoms via fixture). A future implementation-decisions-manifest phase fills them in across the repo.

**Recommendation for planner:**
1. Phase 14's PLAN.md should explicitly call out this divergence — quote both texts, name the distinction.
2. Propose that the implementation-decisions-manifest scope land as **Phase 15** (or as a separate sub-skill the bootstrap skill optionally calls during stage 3).
3. **Do not absorb implementation-decisions emission into Phase 14's bootstrap pipeline** — it doubles the scope and the bootstrap risk surface, both of which are already substantial.

If Yang explicitly decides to absorb implementation-decisions into Phase 14, that's his call to make at planning gate; surface the choice rather than absorbing silently.

---

## Open Questions

1. **Requirement IDs: invent new `BOOTSTRAP-*` family or reuse v2 candidates?**
   - What we know: Existing v1 IDs are 70/70 mapped; no current ID covers "bootstrap an existing repo."
   - What's unclear: Does Yang want to grow the requirement set (new family added to REQUIREMENTS.md as Phase 14's first plan output), or treat this as the first v2 phase (in which case the milestone close definition shifts)?
   - Recommendation: Propose `BOOTSTRAP-01` through `BOOTSTRAP-05` (or similar) as part of the first PLAN.md. Surface to Yang for ratification before adding to REQUIREMENTS.md. This is a scope decision, not a research finding — the planner cannot land it unilaterally.

2. **Skill packaging: ship inside `contract-ide` repo (`.agents/skills/`) or distributed standalone (Anthropic skills marketplace)?**
   - What we know: Personal skills live at `~/.claude/skills/`; project skills at `.claude/skills/`; plugins at `<plugin>/skills/`.
   - What's unclear: Where does the bootstrap skill live? If shipped inside `contract-ide` repo, it doesn't help users who don't have the repo (which is most users). If shipped to a marketplace, distribution is decoupled but versioning across IDE / skill / Phase 9 plugin scaffold becomes a maintenance burden.
   - Recommendation: For v1, ship inside `contract-ide` repo at `.agents/skills/codebase-to-contracts/` (project skill scope) AND copy to `~/.claude/skills/codebase-to-contracts/` on first IDE launch (auto-install on first run). Document the IDE-version → skill-version pinning in PLAN.md.

3. **Demo target codebase: Yang-built micro-SaaS vs open-source SaaS starter?**
   - What we know: Yang-built is the recommended option (control, size, no surprises, 1–2h scaffold).
   - What's unclear: Does Yang have the cycles to scaffold an additional small SaaS? Or does an existing repo of his (one of the demo-repo siblings already in `/Users/yang/lahacks/`) qualify?
   - Recommendation: At plan-time, Yang names the candidate target. If "existing project of his," the planner adds a small upstream-validation task to confirm size + integrations match the demo target spec. If "I'll scaffold one," the first Phase 14 plan absorbs that scaffold work.

4. **Demo posture: 5th beat in presentation-script vs Q&A-only material?**
   - What we know: Current 4-beat script runs on `contract-ide-demo` exclusively. Adding a 5th beat risks demo overrun.
   - What's unclear: Whether judges will ask "does this work on any repo?" and whether the answer should be "let me show you" (live skill demo) or "yes, here's a recording" (pre-recorded inset).
   - Recommendation: Q&A-only for v1, pre-recorded 60–90s inset of the skill running against a small target. Yang holds the inset ready to play if asked. Don't modify the locked 4-beat script.

5. **Cost / latency budget: pre-flight estimator + cancel?**
   - What we know: 100-file Next.js repo bootstrap costs ~$0.50–$2.00 with prompt caching; 500-file unbounded.
   - What's unclear: Should the skill ship with a hard cost ceiling (refuse to run on repos >Nx files) or a soft ceiling (warn but allow)?
   - Recommendation: Soft ceiling with explicit "Estimated cost: $X. Continue?" prompt before stage 2 (mirrors Phase 10 BackfillModal pattern). Hard ceiling only on truly absurd repos (>1000 files of `.tsx` — almost certainly a monorepo or vendored deps).

6. **Babel plugin verbatim copy: how to keep it in sync with `contract-ide-demo/contract-uuid-plugin/index.js`?**
   - What we know: The skill ships a copy in `templates/contract-uuid-plugin-loader.js`. Phase 9's plugin may evolve.
   - What's unclear: When Phase 9's plugin is updated (bug fix, perf improvement), how does the skill's copy stay current?
   - Recommendation: Symlink in dev (skill's `templates/contract-uuid-plugin-loader.js` → `contract-ide-demo/contract-uuid-plugin/index.js`); on skill release, materialize the symlink to a copy. CI step in skill-build pipeline that asserts symlink target matches expected hash. Document in PLAN.md.

7. **Validator parity (skill JS-side vs IDE Rust-side): re-implementation or subprocess?**
   - What we know: The IDE's Rust validators are source of truth; skill needs equivalent semantics.
   - What's unclear: Is it acceptable to spawn the IDE binary as a subprocess from the skill (requires the IDE to be installed on the user's machine — usually true, but adds a coupling), or does the skill ship its own JS-side validators (parity drift risk)?
   - Recommendation: Subprocess invocation. The skill's whole purpose is to make the IDE work on a repo — assuming the IDE binary is available is reasonable. Add `contract-ide validate-repo <path>` as a CLI subcommand on the IDE binary if it doesn't already exist. Falls back to JS-side validators if IDE binary not on PATH (with a loud "skill is using degraded validators — install Contract IDE for stronger guarantees" warning).

---

## Sources

### Primary (HIGH confidence)

- **`CANVAS-PURPOSE.md`** (read 2026-04-25) — confirmed the divergence between bootstrap (this phase) and "Implementation Decisions Manifest" (a different phase, provisional name only). Verified L0–L4 data model preserved; visual treatment evolved in Phase 13.
- **`PITCH.md` § Market + § Q&A "What's the ingestion period?"** (read 2026-04-25) — confirmed the bootstrap operation is part of the existing pitch's Day-0 promise.
- **`VISION.md` § "The two-source pattern"** (read 2026-04-25) — confirmed code-based seeding is the named cold-start primitive in the long-term thesis.
- **`REQUIREMENTS.md`** (read 2026-04-25) — confirmed 70/70 v1 IDs are mapped; Phase 14 introduces a new family or addresses v2 IDs; verified BABEL-01, JSX-01, BACKEND-FM-01, FLOW-01, format_version: 3 / format_version: 5 schema details.
- **`ROADMAP.md` Phase 14 entry** (read 2026-04-25, lines 339–346) — confirmed the title-only entry; Yang skipped discussion; this research derives scope.
- **`STATE.md` line 95** — confirmed Phase 14 was added to roadmap recently; line 332 mentions "currentLens slice retained on graphStore for Phase 14 cleanup" suggesting Phase 14 also picks up some Phase 13 follow-ups (minor).
- **Phase 6 RESEARCH.md** (read full, 2026-04-25) — verified `claude -p` subprocess pattern, `compute_code_hash`/`compute_contract_hash` semantics, `write_sidecar` round-trip, atomic emit pattern, ANTHROPIC_API_KEY pitfalls.
- **Phase 9 plan 09-04 + 09-04b** (read partial, 2026-04-25) — verified the canonical seeded contracts, the Babel plugin that PASSED the Day-1 spike, the `jsx_align_validator.rs` + `backend_section_validator.rs` exit-gate pattern.
- **Phase 11 RESEARCH.md** (read partial, 2026-04-25) — verified `claude -p --output-format json --json-schema` pattern, `--append-system-prompt` planning-pass technique, the cousin-exclusion pattern (relevant if bootstrap derives `anchored_uuids` for substrate).
- **`contract-ide-demo/.contracts/` exemplar files** (read directly, 2026-04-25) — `a1000000-...md` (L4 UI atom), `a0000000-...md` (L3 UI surface with rollup_inputs), `ambient/api-account-delete-001.md` (backend with populated Inputs/Outputs/Side effects), `ambient/data-user-001.md` (data L2), `ambient/external-stripe-001.md` (external L3), `flow-delete-account.md` + `flow-delete-workspace.md` (format_version: 5 flow contracts with members:). These are the canonical "good output" target for the skill.
- **`contract-ide-demo/contract-uuid-plugin/index.js`** (read 2026-04-25) — verified the actual webpack loader implementation: `@babel/parser` + `@babel/generator` + `js-yaml` with pnpm-store fallback resolution. Skill must ship a verbatim copy.
- **Anthropic `code.claude.com/docs/en/skills` documentation** (fetched 2026-04-25) — verified all SKILL.md frontmatter fields (`name`, `description`, `allowed-tools`, `disable-model-invocation`, `argument-hint`, `arguments`, `paths`, `context: fork`, `agent`, etc.), skill directory locations (enterprise > personal > project precedence), live change detection, progressive disclosure (≤500 line guideline), context lifecycle (re-attached on auto-compaction with 5K/25K token budgets).
- **Anthropic `github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md`** (fetched 2026-04-25) — verified the canonical SKILL.md format, `references/` and `scripts/` and `assets/` directory conventions, progressive disclosure, "pushy" description guidance.

### Secondary (MEDIUM confidence — verified across multiple sources)

- **Anthropic Agent Skills open standard (Dec 2025 release):** Multiple sources confirm Anthropic + OpenAI standardized on the same SKILL.md format; live across Claude Code, Cursor, Codex CLI, Gemini CLI, Antigravity IDE. https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
- **Claude prompt caching pricing (April 2026):** Cache read at ~10% of standard input price; 5-minute default TTL (dropped from 1h in early April 2026). Sources: https://www.xda-developers.com/anthropic-quietly-nerfed-claude-code-hour-cache-token-budget/, https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- **Tree-sitter for AST extraction (alternative considered, not adopted for v1):** Mature parser generator with battle-tested grammars across 19+ languages; viable for a v2 polyglot bootstrap. https://tree-sitter.github.io/, https://graphify.net/tree-sitter-ast-extraction.html
- **Existing reverse-engineering skills as prior art:** `Reverse Engineer Skill for Claude Code` (system-archeology) on `mcpmarket.com`; `kalil0321/reverse-api-engineer` on GitHub; `ComeOnOliver/claude-code-analysis` reverse-engineers Claude Code itself across 82 docs. https://mcpmarket.com/es/tools/skills/system-archeology-reverse-engineering, https://github.com/kalil0321/reverse-api-engineer

### Tertiary (LOW confidence — flagged for plan-time validation)

- **Specific demo-target candidate repos** (vercel/commerce, t3-app, Documenso, etc.) — not verified for size/license fit. Plan-time pass should narrow candidates if Yang rejects the "Yang-built micro-SaaS" recommendation.
- **Cost estimate per stage** ($0.05/node Stage 2, $0.10/node Stage 3) — extrapolated from Phase 11 RESEARCH cost estimates; actual costs depend on file sizes, model choice, and prompt-cache hit rate. Plan-time pre-flight estimator gates the user on real numbers.
- **Skill auto-trigger reliability with `paths` field** — Anthropic docs describe the field but don't quantify trigger precision. Plan-time UAT should empirically verify the skill triggers on Next.js repos and stays silent on non-Next.js codebases.

---

## Metadata

**Confidence breakdown:**

- **Standard stack:** HIGH — every primitive is either already-shipped (Phase 6/9/11 reuse) or part of an open standard with current docs (Agent Skills v1, Anthropic API)
- **Architecture (5-stage pipeline + skill packaging):** HIGH — pipeline derives from prior-phase patterns; skill packaging follows official Anthropic guidelines verbatim
- **Demo target selection:** MEDIUM — Yang-built micro-SaaS is a strong recommendation but assumes ~1–2h of upstream scaffold work. Open-source candidate vetting deferred to plan-time
- **Pitfalls:** HIGH — every pitfall derived from observed behavior in prior Contract IDE phases (UUID stability from Phase 9 seed contracts; cost discipline from Phase 10 BackfillModal; validator parity from Phase 9 09-04b spike; idempotency from Phase 6 hash-skip)
- **Hypothesis validation (Phase 14 = pitch's "point at any repo" affordance):** HIGH — three explicit pitch quotes confirm
- **CANVAS-PURPOSE.md divergence flag:** HIGH — quoted both texts directly; the two phases are clearly orthogonal
- **Skill format details (frontmatter fields, paths, context: fork, etc.):** HIGH — fetched live from official docs 2026-04-25
- **LLM cost / latency for arbitrary repo sizes:** LOW — extrapolated from Phase 11 numbers; actual costs vary by repo shape; pre-flight estimator gates this at runtime

**Research date:** 2026-04-25
**Valid until:** 2026-05-25 (30 days; Agent Skills v1 spec is stable; `claude -p` flags stable since early 2026; Phase 9 / 6 / 11 patterns settled)
**Critical validations before plan execution:**

1. Yang ratifies the proposed `BOOTSTRAP-*` requirement family (or names the alternative — v2 ID re-purposing).
2. Yang names the demo target codebase (Yang-built scaffold vs existing repo vs open-source candidate).
3. Yang ratifies the demo posture (Q&A-only inset vs 5th beat in presentation-script).
4. Yang ratifies the Phase 14 / Phase 15 split for the implementation-decisions-manifest scope.
5. Plan-time UAT confirms `claude -p --json-schema` is reliably structured-output-compliant for the contract schemas.
6. Plan-time UAT confirms the skill's JS-side validators agree with the Rust IDE validators on a fixture set.
