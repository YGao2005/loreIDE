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

# /codebase-to-contracts — Bootstrap Contract IDE for an existing repo

This skill produces a complete `.contracts/` tree for a Next.js + Prisma + TypeScript repository in five stages. The output is validator-passing (JSX-01 + BACKEND-FM-01) and loads in Contract IDE without manual cleanup.

The skill is **atomic**: it writes ALL output under `$repo_path/.contracts/.staging/` until every gate passes, then moves the staging directory to `$repo_path/.contracts/` in one filesystem rename. If any gate fails, `.contracts/` is never touched.

## Pre-flight

Before any stage:

1. Confirm `$repo_path` is a Next.js + TypeScript repo:
   - `Glob`: `next.config.{ts,js,mjs}` MUST match >= 1 file at the repo root.
   - `Glob`: `app/**/*.tsx` OR `pages/**/*.tsx` MUST match >= 1 file.
   - `Glob`: `tsconfig.json` MUST match.
   - If any check fails: emit a one-line diagnostic ("not a Next.js + TS repo: missing next.config.*") and HALT. Do NOT proceed; do NOT write `.contracts/.staging/`.
2. Detect prior staging:
   - If `$repo_path/.contracts/.staging/` exists: prompt the user — `resume` (continue from `nodes.json`), `restart` (`rm -rf .staging` then proceed), or `abort` (HALT).
   - If `$repo_path/.contracts/` already exists (non-staging): refuse and exit. The skill is for greenfield bootstraps; PROP-02 + Phase 6 derivation handle ongoing maintenance.
3. Resolve `${CLAUDE_SKILL_DIR}`: this is the absolute path to the directory containing this `SKILL.md`. All script + schema references below are relative to it.

## Stage 1: Discover (heuristic-first)

```bash
node ${CLAUDE_SKILL_DIR}/scripts/discover.mjs $repo_path
```

The script walks the repo and applies the heuristic taxonomy in [references/classification-rules.md](references/classification-rules.md) to produce `$repo_path/.contracts/.staging/nodes.json`. Each entry has at minimum:

```json
{
  "uuid": "<v4>",
  "kind": "UI | API | data | job | cron | event | lib | external",
  "level": "L0 | L1 | L2 | L3 | L4",
  "code_ranges": [{ "file": "...", "start_line": N, "end_line": N }],
  "source": "heuristic | llm-fallback"
}
```

**Heuristic-first principle:** structural classification (path globs + Prisma model blocks + JSX export shape) covers ~85% of nodes deterministically. Only ambiguous files (e.g. `lib/**/*.ts` that exports both a fetch helper and an event emitter) fall back to a single `claude -p --json-schema schemas/classify.json` call returning the top-1 answer. This keeps the LLM budget small and the output deterministic across re-runs of the same codebase.

The full kind/level/parent_hint taxonomy lives in [references/classification-rules.md](references/classification-rules.md).

## Stage 2: Derive frontmatter

For every node in `nodes.json`, derive the sidecar frontmatter:

```bash
claude -p --output-format json --json-schema ${CLAUDE_SKILL_DIR}/schemas/frontmatter.json
```

The model receives the file content + the heuristic classification + the canonical output examples in [references/output-schema.md](references/output-schema.md) and returns a frontmatter object that matches the JSON Schema (which mirrors the Rust `ContractFrontmatter` struct field-for-field).

At bootstrap, the following fields are always set to their initial values (the schema documents this in `description`):

- `format_version`: `3` for non-flow nodes, `5` for `kind: flow`.
- `code_hash`, `contract_hash`, `derived_at`: `null` (Phase 6 derivation fills them on first re-derive).
- `section_hashes`: `{}` (Phase 8 lazy migration computes them on first write).
- `rollup_inputs`: `[]`.
- `rollup_hash`: `null`.
- `rollup_state`: `"untracked"` (the IDE upgrades to `fresh` on first PROP-02 recompute).
- `rollup_generation`: `0`.
- `human_pinned`: `false`.
- `neighbors`: `[]` (Phase 13 sidebar derives from area-tree, not the bootstrap output).

Output is written to `.staging/<uuid>.frontmatter.json`. NO sidecar `.md` file is emitted yet — Stage 5 emits, atomically.

## Stage 3: Derive contract bodies

For every node, derive the structured body (`## Intent`, `## Role`, plus kind-specific sections):

```bash
claude -p --output-format json --json-schema ${CLAUDE_SKILL_DIR}/schemas/contract-body.json
```

The schema enforces:

- **Every** kind: `intent` (>= 50 chars) + `role` (>= 30 chars). Bare placeholders cannot pass.
- **UI L4 atoms**: optional `examples` array.
- **Backend kinds** (`API`, `lib`, `data`, `external`, `job`, `cron`, `event`): `inputs` (>= 1), `outputs` (>= 1), `side_effects` (>= 0). Each input/output item is a string >= 5 chars (Phase 14 revision Issue 6 — JS-fallback parity with Rust `backend_section_validator.rs`).

The renderer composes the markdown body in this fixed section order: `## Intent`, `## Role`, then (if backend) `## Inputs`, `## Outputs`, `## Side effects`, then (if UI L4) `## Examples`. The exact byte-shape of each section is documented in [references/output-schema.md](references/output-schema.md) with annotated excerpts from the contract-ide-demo exemplars.

Output is written to `.staging/<uuid>.body.md`.

## Stage 4: Align JSX `code_ranges`

For every L4 UI atom (and any L3 UI node whose heuristic `code_ranges` covered the whole file rather than a sub-range), tighten `code_ranges` so the start/end lines wrap exactly the JSX element that renders the atom:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/align-jsx.mjs
```

The algorithm uses `@babel/parser` with the EXACT same configuration as the Phase 9 `babel-plugin-contract-data-attrs` plugin (`sourceType: 'module', plugins: ['jsx', 'typescript']`). It enumerates JSX elements inside the heuristic candidate range, filters to outermost-contained, and applies the matcher rules in [references/jsx-alignment.md](references/jsx-alignment.md):

- Exactly one match → emit the tightened range.
- Zero matches → mark the node `unbootstrappable: true` in `.staging/diagnostics.json` and ABORT emit. Do not write the staging body.
- Multiple matches → single `claude -p --json-schema` tiebreak call returning a row index.

The output ranges MUST satisfy the Rust `jsx_align_validator.rs` rule (start_line and end_line refer to a JSX element exactly enclosed by those source lines). The skill never fabricates ranges that the Rust validator would reject; refusal to emit on zero-match is the design.

## Stage 5: Synthesize flows + emit

### 5a. Flow synthesis

For each L3 UI trigger (typically a route's `page.tsx`), build a flow contract by tracing imports + invocation order. The full algorithm lives in [references/flow-synthesis.md](references/flow-synthesis.md). Briefly:

1. Resolve the trigger's import graph.
2. Filter imports to the set of UUIDs already in `nodes.json` (cross-flow shared services like Stripe wrappers will be encountered multiple times — that is expected; emit one canonical sidecar per service and reference it in every flow's `members` list).
3. AST-walk for call sites in source order; recurse one level into helper modules.
4. Single `claude -p --json-schema schemas/flow.json` call to verify member ordering matches expected invocation flow.
5. Write `.staging/flow-<slug>.md` with `format_version: 5`, `kind: flow`, `level: L2`, `members: [...]`.

### 5b. Atomic emit + validator gate

Once every node has a `.frontmatter.json` + `.body.md` + (if applicable) tightened `code_ranges`, AND every flow has a `flow-<slug>.md`:

1. Run the JS-fallback validator (parity with `jsx_align_validator.rs` + `backend_section_validator.rs`). If any node fails: emit `.staging/diagnostics.json` and HALT. `.contracts/` remains untouched.
2. Compose each sidecar (`---\n<yaml>---\n\n<body>`) and write under `.staging/<uuid>.md`.
3. Atomic move: `mv .staging/*.md .contracts/` — the `.contracts/` directory is created in this single filesystem operation. If the move fails (e.g., `.contracts/` was created by another process), preserve `.staging/` and emit a diagnostic.

## Output

**On success**, emit a summary table (one row per emitted contract: uuid, kind, level, file, status). Stdout closes with:

```
✅ Bootstrap complete: <N> contracts written to <repo>/.contracts/
```

**On failure**, NEVER write under `.contracts/`. The skill leaves `.staging/` in place so the user can rerun with `resume`. Stdout closes with the failing gate name and a pointer to `.staging/diagnostics.json`.

## Additional resources

- [references/output-schema.md](references/output-schema.md) — annotated excerpts from the three canonical exemplars (L4 UI atom, L3 backend API, L2 flow). The byte-shape contract for what each stage emits.
- [references/classification-rules.md](references/classification-rules.md) — the heuristic kind/level/parent_hint taxonomy used in Stage 1, plus the LLM-fallback rules.
- [references/jsx-alignment.md](references/jsx-alignment.md) — the Babel parser configuration + matcher algorithm for Stage 4. Cites `jsx_align_validator.rs` as source of truth.
- [references/flow-synthesis.md](references/flow-synthesis.md) — the import-resolution + invocation-order walk + LLM verification used in Stage 5a.

JSON Schemas under `schemas/` (`frontmatter.json`, `contract-body.json`, `flow.json`, `classify.json`) drive every `claude -p --json-schema` call and mirror the Rust struct field set verbatim. The `$comment` block at the top of `schemas/frontmatter.json` documents the Rust-vs-JSON parity contract; Plan 14-01b's `__tests__/frontmatter-writer.test.mjs` verifies it programmatically.
