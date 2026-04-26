---
phase: 14-codebase-to-contracts-bootstrap-skill-demo-application
plan: 01b
subsystem: skill-bootstrap
tags: [skill, babel, uuid, yaml, frontmatter, pnpm, bundled-deps]

# Dependency graph
requires:
  - phase: 09
    provides: "Verbatim Babel webpack loader (contract-ide-demo/contract-uuid-plugin/index.js) — copied byte-for-byte into skill templates"
  - phase: 02
    provides: "Frontmatter reader (serde_yaml_ng) — parity target for js-yaml writer fence convention"
provides:
  - "Skill package.json + bundled node_modules (5 runtime deps; ~8.5MB committed)"
  - "Four helper modules: deterministic-uuid, claude-cli-bridge, frontmatter-writer, babel-parser-bridge"
  - "Three Babel-loader templates: loader.js (verbatim), plugin package.json, next-config snippet with insertion markers"
  - "Three test suites: UUID stability (6), frontmatter round-trip (4 — TWO real Phase 9 fixtures), schema-vs-Rust parity (1, conditional)"
  - "Root .gitignore negation override so skill's bundled deps stay tracked"
affects: [14-01a, 14-03, 14-04, 14-05, 14-06]

tech-stack:
  added: [tinyglobby, js-yaml, "@babel/parser", "@babel/traverse", "@babel/generator"]
  patterns:
    - "Bundled-deps: skill ships node_modules so it's self-contained at clone time"
    - "Three-tier dep resolution: skill-bundled -> target node_modules -> target pnpm virtual store"
    - "Deterministic UUIDv5 from (repo, path, ast_anchor) using RFC 4122 §C.2 URL namespace"
    - "Verbatim-copy templates with header-only diff + sync-strategy comment"
    - "Insertion markers (BOOTSTRAP-INSERT-START/-END) for idempotent re-run splicing"
    - "BOOTSTRAP_TEST_MODE=1 short-circuit on subprocess wrappers"

key-files:
  created:
    - ".agents/skills/codebase-to-contracts/package.json"
    - ".agents/skills/codebase-to-contracts/.gitignore"
    - ".agents/skills/codebase-to-contracts/scripts/helpers/deterministic-uuid.mjs"
    - ".agents/skills/codebase-to-contracts/scripts/helpers/claude-cli-bridge.mjs"
    - ".agents/skills/codebase-to-contracts/scripts/helpers/frontmatter-writer.mjs"
    - ".agents/skills/codebase-to-contracts/scripts/helpers/babel-parser-bridge.mjs"
    - ".agents/skills/codebase-to-contracts/scripts/helpers/__tests__/deterministic-uuid.test.mjs"
    - ".agents/skills/codebase-to-contracts/scripts/helpers/__tests__/frontmatter-writer.test.mjs"
    - ".agents/skills/codebase-to-contracts/scripts/helpers/__tests__/schema-rust-parity.test.mjs"
    - ".agents/skills/codebase-to-contracts/templates/contract-uuid-plugin-loader.js"
    - ".agents/skills/codebase-to-contracts/templates/contract-uuid-plugin-package.json"
    - ".agents/skills/codebase-to-contracts/templates/next-config-snippet.ts"
  modified:
    - ".gitignore"  # negation override for skill's node_modules

key-decisions:
  - "Bundled-deps strategy ratified: node_modules IS committed (~8.5MB) — self-contained skill at clone time, no setup step"
  - "Root .gitignore negation override applied: !.agents/skills/codebase-to-contracts/node_modules/** so global node_modules/ rule doesn't strip bundled deps"
  - "Babel loader template = verbatim cp + 5-line provenance header. Single diff hunk at top. v1 = copy + manual sync; symlink-vs-copy strategy (Open Question 6) deferred for Yang's ratification"
  - "Schema-vs-Rust parity test SKIPS gracefully when 14-01a's schemas/frontmatter.json is absent — wave-1 plans run in parallel and 14-01a may not have shipped yet"
  - "Node 24 test runner needed explicit glob: `node --test 'scripts/helpers/__tests__/*.test.mjs'` (bare directory arg fails with MODULE_NOT_FOUND)"

patterns-established:
  - "Self-contained skill: bundled node_modules + pnpm-lock.yaml committed; works at clone time with no `pnpm install`"
  - "Three-tier dep resolution in babel-parser-bridge.mjs (mirrors Phase 9 resolvePnpmDep verbatim for tier 3)"
  - "Round-trip parity tested against two REAL Phase 9 fixtures (UI L4 + backend L3 ambient) — not synthetic samples"

requirements-completed:
  - BOOTSTRAP-01  # [proposed] — apparatus half (14-01a ships SKILL.md to complete)

# Metrics
duration: 5min
completed: 2026-04-25
---

# Phase 14 Plan 01b: codebase-to-contracts skill apparatus Summary

**Self-contained skill apparatus — bundled deps (8.5MB committed), 4 helper modules, 3 verbatim Babel-loader templates, and 10 passing tests covering UUIDv5 stability + frontmatter round-trip parity against two real Phase 9 fixtures.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-25T23:10:45Z
- **Completed:** 2026-04-25T23:15:41Z
- **Tasks:** 4
- **Files modified:** 13 (12 created in skill, 1 modified — root .gitignore)

## Accomplishments

- Skill is now invocable as a self-contained unit: `pnpm test` exits 0 immediately after clone, no `pnpm install` setup step (bundled-deps strategy per RESEARCH Pattern 5)
- Three load-bearing primitives for re-run idempotency are in place: deterministic UUIDv5, round-trip-safe frontmatter writer, verbatim Babel loader template
- Phase 14 revision Issue 2 closed (skill has its own package.json + deps)
- Phase 14 revision Issue 12 closed (schema-vs-Rust parity smoke ships; gates on 14-01a's schema)
- BOOTSTRAP-01's apparatus half done — 14-01a ships SKILL.md + schemas in parallel to complete the requirement

## Task Commits

1. **Task 1: package.json + .gitignore + pnpm install + commit node_modules** — `07f2964` (chore)
2. **Task 2: four helper modules (deterministic-uuid, claude-cli-bridge, frontmatter-writer, babel-parser-bridge)** — `fd1b1eb` (feat)
3. **Task 3: Babel webpack loader templates (verbatim copy + provenance header)** — `19d4be7` (feat)
4. **Task 4: three parity test suites + package.json scripts.test fix** — `bfb819d` (test)

**Plan metadata commit:** pending below.

## pnpm install outcome

```
Packages: +23
Resolved versions:
  + @babel/generator 7.29.1
  + @babel/parser    7.29.2
  + @babel/traverse  7.29.0
  + js-yaml          4.1.1
  + tinyglobby       0.2.16
  Total dep tree: 23 packages (5 direct + 18 transitive)
  node_modules size: 8.5 MB
  Time: 1s (warm pnpm cache)
```

## Helper script unit-test results

```
$ pnpm test
✔ same inputs produce the same UUID (deterministic) (0.5ms)
✔ different astAnchor produces different UUIDs (0.08ms)
✔ different filePath produces different UUIDs (0.07ms)
✔ different repoName produces different UUIDs (0.06ms)
✔ output matches UUIDv5 regex (version 5, RFC 4122 variant) (0.12ms)
✔ output is stable across multiple invocations (regression baseline) (0.10ms)
✔ round-trip parity: contract-ide-demo UI L4 exemplar (a1000000-...) (3.36ms)
✔ round-trip parity: contract-ide-demo backend L3 exemplar (api-account-delete-001) (0.54ms)
✔ output uses correct fence pattern (---\n on both sides) (0.07ms)
✔ empty arrays serialize as [] not bare key: (0.09ms)
﹣ schema-vs-Rust parity: every non-Option Rust field appears in JSON Schema  # SKIP — schemas/frontmatter.json missing (Plan 14-01a not yet executed)

ℹ tests 11
ℹ pass 10
ℹ fail 0
ℹ skipped 1
ℹ duration_ms 50.9
```

## Schema-vs-Rust parity test outcome

**Status:** SKIPPED at this plan's execution time (Plan 14-01a runs in wave 1 in parallel with 14-01b; 14-01a's `schemas/frontmatter.json` had not yet been written). The test detects this missing-fixture case and skips with a clear message rather than failing.

**Behavior once 14-01a lands:** the test parses the Rust `Frontmatter` struct in `contract-ide/src-tauri/src/sidecar/frontmatter.rs` via regex, walks each field, classifies it (`Option` / `serde(default)` / `Vec`/`HashMap` / required), and asserts:
- Every required field appears in `schemas/frontmatter.json` `required[]`
- Every field appears in `properties`

**Parity table format** (printed at test end for posterity):

```
| Rust field          | kind                 | in required[]        | in properties        | match?               |
| <field>             | required             | true                 | true                 | OK                   |
...
```

The expected outcome once 14-01a's schema is in place is `pass 11 / fail 0 / skipped 0`. If a future Phase 9 struct change adds a required field without a matching schema update, the parity gate fails with a precise error like `<field> is required in Rust but missing from JSON Schema required[]`.

## Babel loader copy method

**Method used:** shell `cat` redirection (header lines `printf` + verbatim source body via `cat`):

```bash
{ printf '<header>\n\n'; cat contract-ide-demo/contract-uuid-plugin/index.js; } > .agents/skills/codebase-to-contracts/templates/contract-uuid-plugin-loader.js
diff contract-ide-demo/contract-uuid-plugin/index.js .agents/skills/codebase-to-contracts/templates/contract-uuid-plugin-loader.js  # one hunk at top, header-only
```

Resulting line count: 350 (345 source + 5 header). Diff confirms a single hunk at the top containing only the provenance header — body is byte-identical.

**Sync strategy noted inline at top of `contract-uuid-plugin-loader.js`:** when the source plugin in contract-ide-demo evolves, re-run `cat` redirect + `diff` to verify. Future CI step: assert SHA-256 hash of the body (lines 6+ of template == all of source) on every commit.

## Open Question 6 (symlink vs copy for plugin sync)

**Current approach:** copy + manual sync (v1).

**Trade-off:** symlinking would couple the skill to contract-ide-demo's existence at the same relative path — works for in-repo clone, breaks when the skill is extracted to a standalone repo. Copy + manual sync keeps the skill location-independent at the cost of a re-copy chore when the source plugin evolves.

**Status:** deferred for Yang's ratification. The current copy+diff workflow is documented in the loader template's header so the convention is discoverable without consulting RESEARCH.md.

## .gitignore audit outcome

**Pre-existing rule that needed override:** YES — line 2 of root `.gitignore` had a global `node_modules/` ignore that was suppressing the skill's freshly-installed bundled deps. Verified via `git check-ignore -v` returning the matching rule.

**Fix applied:** added a negation override at the top of root `.gitignore`:

```gitignore
# Exception: skill ships bundled deps per Phase 14 RESEARCH Pattern 5
# (self-contained at clone time — no `pnpm install` setup step).
!.agents/skills/codebase-to-contracts/node_modules/
!.agents/skills/codebase-to-contracts/node_modules/**
```

Re-verified post-fix: `git status --short .agents/skills/codebase-to-contracts/node_modules` reports `??` (untracked, ready to add) instead of being silently ignored. Task 1 commit `07f2964` includes 580+ files of node_modules content alongside the package.json and pnpm-lock.yaml.

## Files Created/Modified

- `.agents/skills/codebase-to-contracts/package.json` — skill manifest, 5 runtime deps
- `.agents/skills/codebase-to-contracts/.gitignore` — explicit note that node_modules IS committed
- `.agents/skills/codebase-to-contracts/pnpm-lock.yaml` — pinned dep versions
- `.agents/skills/codebase-to-contracts/node_modules/**` — 580+ files, ~8.5MB bundled
- `.agents/skills/codebase-to-contracts/scripts/helpers/deterministic-uuid.mjs` — UUIDv5 helper
- `.agents/skills/codebase-to-contracts/scripts/helpers/claude-cli-bridge.mjs` — `claude -p` wrapper with test-mode short-circuit
- `.agents/skills/codebase-to-contracts/scripts/helpers/frontmatter-writer.mjs` — round-trip-safe YAML writer
- `.agents/skills/codebase-to-contracts/scripts/helpers/babel-parser-bridge.mjs` — three-tier resolution
- `.agents/skills/codebase-to-contracts/scripts/helpers/__tests__/deterministic-uuid.test.mjs` — 6 tests
- `.agents/skills/codebase-to-contracts/scripts/helpers/__tests__/frontmatter-writer.test.mjs` — 4 tests, two real fixtures
- `.agents/skills/codebase-to-contracts/scripts/helpers/__tests__/schema-rust-parity.test.mjs` — 1 conditional test
- `.agents/skills/codebase-to-contracts/templates/contract-uuid-plugin-loader.js` — verbatim copy + 5-line header
- `.agents/skills/codebase-to-contracts/templates/contract-uuid-plugin-package.json` — verbatim copy + provenance comment
- `.agents/skills/codebase-to-contracts/templates/next-config-snippet.ts` — webpack hook with insertion markers
- `.gitignore` (root) — negation override for skill's bundled deps

## Decisions Made

See key-decisions in frontmatter. Highlights:

1. **Bundled deps committed** per RESEARCH Pattern 5 + Issue 2 — chose this over `pnpm install` setup step to keep the skill working at clone time.
2. **Root `.gitignore` negation override** rather than relocating the skill outside an ignored path — keeps skill in canonical `.agents/skills/` location.
3. **`pnpm test` glob fix** — Node 24's `node --test <dir>` regression required explicit `*.test.mjs` glob.
4. **schema-rust-parity test SKIPS gracefully** when 14-01a hasn't shipped — needed because 14-01b and 14-01a are wave-1 parallel plans with no inter-dependency declared.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated `pnpm test` glob for Node 24 compatibility**
- **Found during:** Task 4 (running tests after writing them)
- **Issue:** `node --test scripts/helpers/__tests__/` failed with `MODULE_NOT_FOUND` because Node 24 treats the bare directory as a module path rather than a directory to scan.
- **Fix:** Updated `package.json` `scripts.test` to `node --test 'scripts/helpers/__tests__/*.test.mjs'`.
- **Files modified:** `.agents/skills/codebase-to-contracts/package.json`
- **Verification:** `pnpm test` now runs 10 tests, all pass; 1 skipped.
- **Committed in:** `bfb819d` (Task 4 commit)

**2. [Rule 3 - Blocking] Added negation rule in root `.gitignore` for skill's bundled deps**
- **Found during:** Task 1 (the plan's own anti-pattern guard verification step)
- **Issue:** Plan called for `git check-ignore` audit and said "edit the parent .gitignore to add a negation if it IS ignored." Audit confirmed root rule `node_modules/` was ignoring the skill's deps. This was an expected-and-handled deviation per the plan, but it's a Rule 3 fix because the bundled-deps strategy can't function otherwise.
- **Fix:** Added two negation lines under the global `node_modules/` rule.
- **Files modified:** `.gitignore` (root, line 5–8)
- **Verification:** `git check-ignore -v` matched the negation rule; `git status` showed deps as untracked-staging-ready.
- **Committed in:** `07f2964` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 blocking)
**Impact on plan:** Both fixes were called out in the plan as conditional anti-pattern guards. The Node 24 glob fix was a runtime discovery — minor and isolated to package.json. No scope creep.

## Issues Encountered

- Node 24 `--test` directory arg regression (covered above as Rule 3 deviation)
- 14-01a schemas not yet shipped at this plan's execution time — designed-for case; parity test skips gracefully

## User Setup Required

None — no external service configuration. The skill is self-contained at clone time.

## Next Phase Readiness

**Ready:**
- Plans 14-03, 14-04, 14-05, 14-06 can `import` from the four helper modules without setup
- Templates are ready for 14-05's emit script to copy into target repos
- Tests pass; CI gate is green (modulo the conditional schema-vs-Rust skip pending 14-01a)

**Pending:**
- 14-01a (parallel wave-1 plan) ships `schemas/frontmatter.json` — once it lands, `pnpm test` should report 11 pass / 0 skip
- BOOTSTRAP-01 requirement is half-complete here; 14-01a's SKILL.md is the other half

---
*Phase: 14-codebase-to-contracts-bootstrap-skill-demo-application*
*Plan: 01b*
*Completed: 2026-04-25*


## Self-Check: PASSED

All 13 files exist on disk; all 4 task commits present in git log.
