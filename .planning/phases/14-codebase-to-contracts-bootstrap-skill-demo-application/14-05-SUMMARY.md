---
phase: 14-codebase-to-contracts-bootstrap-skill-demo-application
plan: 05
subsystem: skill-pipeline
tags: [bootstrap, flow-synthesis, atomic-emit, babel-install, validator-gate, idempotent, schema-allof, watchdog]

# Dependency graph
requires:
  - phase: 14
    plan: 01a
    provides: "schemas/flow.json (Stage 5a's structured-output schema) + schemas/frontmatter.json (allOf flow guard re-asserted post-hoc)"
  - phase: 14
    plan: 01b
    provides: "templates/contract-uuid-plugin-loader.js + templates/next-config-snippet.ts (verbatim Babel scaffold installer copies them) + helpers/babel-parser-bridge.mjs (3-tier resolution) + helpers/frontmatter-writer.mjs (writeFrontmatter — Phase 9 round-trip parity)"
  - phase: 14
    plan: 04
    provides: ".staging/<uuid>.frontmatter.json + .staging/<uuid>.body.json (Stages 2+3+4 outputs feed Stage 5a flow synth + Stage 5b emit) + claude-cli-bridge.mjs schema-stripper (the top-level allOf guards stripped at API boundary that Stage 5b's validate.mjs re-asserts here)"
  - phase: 9
    provides: "jsx_align_validator.rs + backend_section_validator.rs (Rust source-of-truth validators that validate.mjs dispatches to via subprocess when contract-ide binary on PATH; falls back to JS reimplementation otherwise) + contract-uuid-plugin/index.js (the Babel webpack-loader the installer copies verbatim)"
provides:
  - "scripts/synthesize-flows.mjs (Stage 5a — import-graph walk + AST call-site extraction + LLM verification with watchdog + static-chain fallback)"
  - "scripts/emit.mjs (Stage 5b — compose .md sidecars from .staging/ JSON intermediates → install Babel plugin → validator gate → atomic .staging/ → .contracts/ rename)"
  - "scripts/install-babel-plugin.mjs (idempotent installer — verbatim plugin scaffold copy + BOOTSTRAP-INSERT-START/END marker-bracketed next.config.{ts,js,mjs} patch)"
  - "scripts/validate.mjs (Rust IDE-binary subprocess preferred → JS-side fallback with degraded-mode warning + schema allOf re-assertion + JSX-01 + BACKEND-FM-01)"
  - "prompts/synthesize-flow.txt (118 lines — Phase 9 flow-delete-account.md ## Notes exemplar embedded as the prose-density target)"
  - "Three unit-test suites: synthesize-flows (6 tests) + emit (4 tests) + validate (5 tests) — 15 new tests, total skill suite at 42/42 green"
  - "Watchdog timeout in claude-cli-bridge.mjs (default 120s, BOOTSTRAP_CLAUDE_TIMEOUT_MS env override + per-call timeoutMs option) — converts Plan 14-04-style silent hangs into surfaceable errors"
affects:
  - "Plan 14-06 (end-to-end demo recording — fires the full pipeline incl. Stage 5a flow synth + Stage 5b emit against Marginalia at full scale; pnpm build smoke verifies BABEL-01 replication on the bootstrapped target)"
  - "Plan 14-07 (in-IDE bootstrap CTA — orchestrator spawns these scripts and consumes their stderr JSONL events)"

tech-stack:
  added: []
  patterns:
    - "Idempotent plugin install via BOOTSTRAP-INSERT-START / -END marker-bracketed find-and-replace (re-running NEVER duplicates the snippet — single source of truth for the install boundary)"
    - "Atomic-rename emit pattern — staging .json intermediates → composed .md → validator gate → .staging/*.md to .contracts/*.md only on validator-pass; .staging/ tree preserved on failure for debugging"
    - "Schema allOf re-assertion — bridge strips top-level allOf at the API boundary (claude-cli-bridge.mjs::stripUnsupportedTopLevel); validate.mjs re-asserts those exact constraints post-hoc on emitted .md files (defense in depth, not bypass)"
    - "Hard SIGKILL watchdog on claude -p subprocess — converts silent hangs (Plan 14-04 path-mode bug + future variants) into surfaceable errors; per-call timeoutMs override + BOOTSTRAP_CLAUDE_TIMEOUT_MS env"
    - "Validator-dispatch with degraded-mode warning — IDE binary subprocess preferred (source of truth Rust validators); JS reimplementation falls through when binary isn't on PATH or doesn't recognize `validate-repo` subcommand (RESEARCH Open Question 7)"
    - "Flow-slug HTTP-method prefix — multi-verb route.ts files (GET/POST/PUT/DELETE) emit distinct flow contracts via lowercased method-prefixed slug (caught + fixed during smoke deviation)"
    - "Cross-check on LLM verification — synthesize-flows requires every returned member to be a SUBSET of the AST-walked candidate set; rejects out-of-set returns and falls through to static chain (defends against hallucinated UUIDs)"

key-files:
  created:
    - .agents/skills/codebase-to-contracts/scripts/synthesize-flows.mjs
    - .agents/skills/codebase-to-contracts/scripts/install-babel-plugin.mjs
    - .agents/skills/codebase-to-contracts/scripts/emit.mjs
    - .agents/skills/codebase-to-contracts/scripts/validate.mjs
    - .agents/skills/codebase-to-contracts/prompts/synthesize-flow.txt
    - .agents/skills/codebase-to-contracts/scripts/__tests__/synthesize-flows.test.mjs
    - .agents/skills/codebase-to-contracts/scripts/__tests__/emit.test.mjs
    - .agents/skills/codebase-to-contracts/scripts/__tests__/validate.test.mjs
    - .agents/skills/codebase-to-contracts/scripts/__tests__/fixtures/api-route-with-imports.ts
    - .agents/skills/codebase-to-contracts/scripts/__tests__/fixtures/lib-payments.ts
  modified:
    - .agents/skills/codebase-to-contracts/scripts/helpers/claude-cli-bridge.mjs

key-decisions:
  - "Watchdog timeout is OPT-OUT, not opt-in — every callClaude() invocation is wrapped in a 120s SIGKILL timer (override via BOOTSTRAP_CLAUDE_TIMEOUT_MS). Plan 14-04 SUMMARY's `Recommended for Plan 14-05` mitigation lands as Rule 2 missing-critical hardening (not as a deviation — the plan's important_context block flagged it as a success criterion)"
  - "validate.mjs re-asserts the FULL frontmatter.json allOf constraints (kind=flow ⇒ format_version=5 + level=L2 + members[]≥2; kind≠flow ⇒ format_version=3 + no members[]) — defense in depth on the bridge's API-boundary strip. Without this, the strip would silently relax the constraint on emitted files; with this, the validator catches any frontmatter that violates the constraint regardless of how it got there"
  - "JSX-01 fallback is permissive on the structural single-element check — the JS validator catches empty/malformed code_ranges + invalid line numbers + missing files (silent skip, mirrors Rust validator), but doesn't reimplement count_top_level_jsx_elements. Rationale: the Rust validator is the source of truth on the structural check; the JS fallback's job is the broader well-formedness gate"
  - "synthesize-flows recursion is hard-capped at ONE level — the trigger's imports + each direct member's imports. Deeper recursion would compound noise (helper of helper of helper rarely belongs in the flow's members ordering). Phase 13 sidebar can derive deeper transitive relationships separately if needed"
  - "LLM verification cross-check rejects out-of-candidate-set returns — even if the LLM returns valid-shaped UUIDs, if any UUID isn't in the proposed members[] OR if members[0] isn't the trigger, we discard the LLM output and use the static chain. Cardinal: never let the LLM invent UUIDs that don't exist in the codebase"
  - "Slug includes HTTP method prefix for API triggers — multi-verb route.ts files (GET/POST/PUT/PATCH/DELETE on the same file) now produce distinct flow contracts. Discovered during smoke deviation; without the fix, 16 candidate flows on Marginalia collapsed to 13 unique UUIDs (3 silently overwritten)"
  - "emit.mjs refuses to clobber a populated .contracts/ tree by default — opt-in via { allowClobber: true } option. Rationale: bootstrap is for greenfield repos; ongoing maintenance is Phase 6's job, not the skill's"
  - "Staging JSON intermediates archive to .contracts/.bootstrap-staging-archive/ rather than getting deleted — gives Phase 14-06 + future re-runners a forensic record of what each Stage emitted before the final compose"
  - "validate.mjs detects 'unrecognized subcommand' / 'unknown subcommand' on the IDE binary subprocess and falls through to the JS path WITHOUT marking it as a failure — accommodates the today-state where contract-ide doesn't have validate-repo yet (RESEARCH Open Question 7 still deferred)"

patterns-established:
  - "Pattern: BOOTSTRAP-INSERT-START/-END marker-bracketed insertion — single regex to find/replace; re-runs are idempotent by construction. Useful any time the skill needs to splice into a user-owned config file"
  - "Pattern: SIGKILL watchdog on every long-running CLI subprocess — `setTimeout` clears in close-handler + error-handler; never let the subprocess + parent both sit forever waiting for each other. Generalize to any subprocess where a hung child is plausible"
  - "Pattern: validator-dispatch with degraded-mode warning — preferred path is the strongest validator (here: Rust subprocess); fallback is the weaker JS reimplementation; the warning makes the degraded-mode state visible to operators so they don't mistake it for the primary"
  - "Pattern: schema constraint re-assertion at the validator stage — when the upstream API rejects a schema feature (e.g., top-level allOf), strip at the boundary AND re-assert post-hoc on the emitted artifact. Bypass becomes defense in depth"

requirements-completed:
  - BOOTSTRAP-02  # [proposed] Validator-passing L0–L4 hierarchy — closed by Stage 5b's validate gate
  - BOOTSTRAP-03  # [proposed] Skill synthesizes flow contracts with correct member ordering — Stage 5a
  - BOOTSTRAP-04  # [proposed] Skill installs Babel webpack loader scaffold + wires next.config — Stage 5b's install-babel-plugin sub-step

# Metrics
duration: 13 min
completed: 2026-04-26
---

# Phase 14 Plan 05: Bootstrap Pipeline Stages 5a (Flow Synthesis) + 5b (Atomic Emit + Babel Install + Validator Gate) Summary

**Stage 5a synthesizes flow contracts via import-graph walk + AST call-site extraction in source order + single LLM verification call (60s watchdog, fallback to static chain on error); Stage 5b composes .md sidecars from staging JSON intermediates, installs the contract-uuid-plugin scaffold idempotently into the target's next.config, runs the validator gate (IDE Rust binary subprocess preferred; JS reimplementation with allOf re-assertion + JSX-01 + BACKEND-FM-01 fallback), and atomically promotes .staging/ → .contracts/ ONLY on validator-pass.**

## Performance

- **Duration:** 13 min wall (Tasks 1+2 implementation including in-flight slug-collision Rule 1 fix)
- **Started:** 2026-04-26T01:41:40Z
- **Completed:** 2026-04-26T01:55:16Z
- **Tasks:** 2 (both auto)
- **Files created:** 10 (4 scripts + 1 prompt + 3 test suites + 2 fixtures)
- **Files modified:** 1 (claude-cli-bridge.mjs — watchdog timeout)
- **Tests added:** 15 (synthesize-flows: 6, emit: 4, validate: 5)
- **Test suite total:** 42/42 green via `node --test scripts/__tests__/*.test.mjs`

## Accomplishments

- **Stage 5a (`synthesize-flows.mjs`)** shipped at 470 lines: walks each L3 trigger's import graph + AST call-sites in source order, recurses one level into each member's imports + call-sites, dedups by UUID preserving first-call ordering, and emits a flow contract (format_version=5, kind=flow, level=L2) with deterministic UUIDv5 from `(repoName, 'flow-<slug>', 'L2:flow')`. Slug includes HTTP method prefix for API triggers so multi-verb route.ts files emit distinct flows.
- **LLM verification with watchdog + cross-check.** Single `claude -p --json-schema flow.json` call per flow with 60s SIGKILL watchdog + cross-check that every returned member exists in the proposed candidate set + members[0] === trigger.uuid. On any failure (timeout / non-JSON / out-of-set / missing trigger) we fall through to the static chain — cardinal: every L3 trigger that has ≥1 imported participant produces a flow contract, even when LLM verification fails.
- **`prompts/synthesize-flow.txt`** (~118 lines): Phase 9 `flow-delete-account.md` ## Notes exemplar embedded as the prose-density target. Rules section 2 codifies "use only UUIDs from the candidate set" — the LLM cannot invent UUIDs that don't exist in the codebase.
- **Stage 5b (`emit.mjs`)** shipped at 237 lines: composes .md sidecars from .staging/ JSON intermediates (frontmatter.json + body.json) via `writeFrontmatter` (Phase 9 round-trip parity), runs the validator gate, archives staging .json artifacts to `.contracts/.bootstrap-staging-archive/`, and atomically promotes .staging/*.md → .contracts/*.md ONLY on validator-pass. Refuses to clobber an existing populated .contracts/ tree by default.
- **`install-babel-plugin.mjs`** (175 lines): byte-copies `templates/contract-uuid-plugin-loader.js` (verbatim provenance header preserved) + `templates/contract-uuid-plugin-package.json` (with `_comment` provenance stripped from emitted JSON) into `<repo>/contract-uuid-plugin/`. Patches `next.config.{ts,js,mjs}` with the BOOTSTRAP-INSERT-START / -END marker-bracketed snippet — re-running REPLACES the block (single regex find-and-replace) rather than duplicating it. Auto-injects `webpack: contractUuidWebpackHook` into the nextConfig literal when no webpack hook exists.
- **`validate.mjs`** (302 lines): three-layer dispatcher.
  1. **IDE binary subprocess** preferred — `contract-ide validate-repo <path>`. Falls through gracefully on "unrecognized subcommand" stderr (the binary doesn't ship validate-repo today; Open Question 7 follow-up).
  2. **JS-side fallback** with stderr "Skill is using degraded JS-side validators" warning per RESEARCH Open Question 7. Implements:
     - **JSX-01**: L4 UI atoms must have non-empty code_ranges with valid line numbers + existing source files (silent skip on missing files mirrors Rust validator)
     - **BACKEND-FM-01**: backend kinds (API/lib/data/external/job/cron/event) must have ## Inputs / ## Outputs / ## Side effects sections present and non-empty
  3. **Schema allOf re-assertion** (per Plan 14-04 SUMMARY mitigation, defense in depth): re-applies the top-level allOf guards from `schemas/frontmatter.json` that `claude-cli-bridge.mjs::stripUnsupportedTopLevel` strips at the API boundary. `kind=flow ⇒ format_version=5 + level=L2 + members[]≥2`; `kind≠flow ⇒ format_version=3 + members absent`.
- **Watchdog timeout in `claude-cli-bridge.mjs`.** Per Plan 14-04 SUMMARY's recommended mitigation: every `callClaude()` invocation is wrapped in a hard SIGKILL timer (default 120s, override via `BOOTSTRAP_CLAUDE_TIMEOUT_MS` env or per-call `{ timeoutMs }`). On timeout the child is `SIGKILL`'d and the promise rejects with a substantive error message (resolved-model + bytes-captured-on-stdout/stderr) so callers can decide. Converts the Plan 14-04 path-mode silent-hang failure mode into surfaceable errors.
- **Test discipline.** Three new test suites cover the load-bearing invariants:
  - `synthesize-flows.test.mjs` (6 tests): static-chain extraction in invocation-order (NOT import-order) + format_version=5 frontmatter shape + flow UUID determinism + shared-service dedup (one sidecar referenced by multiple flows) + slug derivation including HTTP-method prefix
  - `emit.test.mjs` (4 tests): compose+promote happy path + plugin install + idempotent re-install (no duplicate BOOTSTRAP-INSERT block) + validator-failure abort
  - `validate.test.mjs` (5 tests): BACKEND-FM-01 missing-Outputs + JSX-01 empty code_ranges + both schema allOf branches (kind=flow with wrong format_version + non-flow with members[]) + all-good staging passes
- **Smoke against bootstrap-demo-target (Marginalia).** Ran `BOOTSTRAP_TEST_MODE=1 node synthesize-flows.mjs` — 16 flow contracts synthesized (was 13 pre-fix; surfaced and corrected the slug-collision bug). Final staging composition: 18 UI + 12 API + 6 data + 2 lib + 2 external + 16 flow = 56 frontmatter files. Each flow has 3-4 members on average reflecting the import chains in Marginalia.

## Task Commits

1. **Task 1: synthesize-flows.mjs (Stage 5a) + claude-cli-bridge watchdog + tests + fixtures** — `ae2dc7e` (feat)
2. **Task 2: emit.mjs + install-babel-plugin.mjs + validate.mjs (Stage 5b) + tests** — `61cd49a` (feat)
3. **In-flight Rule 1 fix: flow slug must include HTTP method to disambiguate multi-verb route.ts** — `0107f1a` (fix)

## Files Created/Modified

- `.agents/skills/codebase-to-contracts/scripts/synthesize-flows.mjs` — Stage 5a flow synthesizer
- `.agents/skills/codebase-to-contracts/scripts/install-babel-plugin.mjs` — Idempotent Babel scaffold installer
- `.agents/skills/codebase-to-contracts/scripts/emit.mjs` — Stage 5b atomic emit
- `.agents/skills/codebase-to-contracts/scripts/validate.mjs` — Validator dispatcher (Rust subprocess + JS fallback)
- `.agents/skills/codebase-to-contracts/prompts/synthesize-flow.txt` — Stage 5a system prompt with Phase 9 exemplar
- `.agents/skills/codebase-to-contracts/scripts/__tests__/synthesize-flows.test.mjs` — 6 tests, all pass
- `.agents/skills/codebase-to-contracts/scripts/__tests__/emit.test.mjs` — 4 tests, all pass
- `.agents/skills/codebase-to-contracts/scripts/__tests__/validate.test.mjs` — 5 tests, all pass
- `.agents/skills/codebase-to-contracts/scripts/__tests__/fixtures/api-route-with-imports.ts` — invocation-order fixture
- `.agents/skills/codebase-to-contracts/scripts/__tests__/fixtures/lib-payments.ts` — recursion-depth fixture
- `.agents/skills/codebase-to-contracts/scripts/helpers/claude-cli-bridge.mjs` — watchdog timeout addition

## Smoke against bootstrap-demo-target (Marginalia)

```
$ BOOTSTRAP_TEST_MODE=1 node scripts/synthesize-flows.mjs /Users/yang/lahacks/bootstrap-demo-target
Stage 5a complete: 16 flow contracts synthesized, 0 reordered by LLM, 16 fell through to static chain
```

(BOOTSTRAP_TEST_MODE=1 short-circuits the LLM call so all 16 reflect pure static-chain output. Plan 14-06 fires the actual `claude -p` calls and captures the LLM-reorder count + cost.)

Final `.staging/` composition after Stage 5a:

| kind     | count |
|----------|-------|
| UI       | 18    |
| API      | 12    |
| flow     | 16    |
| data     | 6     |
| lib      | 2     |
| external | 2     |
| **Total** | **56** |

Of the 16 flows, the breakdown by trigger pattern:
- **8 API L3 page flows** for the 6 distinct routes that have HTTP methods (login/logout/signup/account/checkout/portal/webhook with multiple methods on some routes)
- **3 API L3 dynamic-route flows** for `[id]` parameterized notes (GET/PUT/DELETE flow-get/put/delete-api-notes-id; the slug-collision fix made these distinct)
- **3 UI L3 page flows** for /notes, /notes/[id], and the /account/settings page
- **2 misc flows** for routes that consolidate multiple verbs (api/auth/* etc.)

Each flow has 3-4 members on average reflecting Marginalia's import depth: trigger → auth/session-check → core lib → external (Stripe/Resend) when applicable.

## Validator-source on the demo target

The `contract-ide` binary on Yang's PATH does NOT yet have a `validate-repo` subcommand (RESEARCH Open Question 7 — TODO). When validate.mjs ran against the staging tree, it correctly fell through to the JS-side reimplementation with the loud "Skill is using degraded JS-side validators" stderr warning. Plan 14-06 will run the full pipeline against Marginalia and capture the same fallback behavior in production.

**Decision for Open Question 7 follow-up:** v1 ships with the JS fallback as the de-facto validator for users without Contract IDE installed. Adding `validate-repo` to the IDE binary is a Phase 14 follow-up (or could defer to v2) — Yang to ratify after Plan 14-06 records actual user-friction with the degraded-mode warning. The JS fallback is comprehensive enough (allOf re-assertion + JSX-01 + BACKEND-FM-01) that it's not a v1 blocker.

## Idempotency verification

Verified emit's idempotency in `install-babel-plugin: re-running replaces (not duplicates) the BOOTSTRAP-INSERT block` test. Manual smoke also confirms: re-running `synthesize-flows` produces byte-identical flow UUIDs (deterministic UUIDv5 contract). Re-running `installBabelPlugin` keeps exactly ONE BOOTSTRAP-INSERT block in `next.config.ts` (verified via `match(/BOOTSTRAP-INSERT-START/g)?.length === 1` assertion).

## Decisions Made

See `key-decisions` in frontmatter. Highlights:

1. **Watchdog is opt-out, not opt-in.** Plan 14-04 SUMMARY's recommended mitigation lands as Rule-2 missing-critical hardening on every `callClaude()` invocation. Default 120s with env-var + per-call overrides. Plan 14-04 burned 25/40 silent-hang frontmatter calls because no watchdog existed; Plan 14-05 makes that failure mode impossible.
2. **Defense-in-depth on the schema allOf strip.** The bridge's `stripUnsupportedTopLevel` is at the API boundary; `validate.mjs` re-asserts the FULL schema constraint post-hoc on emitted .md files. This is explicitly NOT a bypass — every emitted file must still satisfy the kind=flow ⇔ format_version=5 + level=L2 + members[]≥2 invariant. The validator catches violations regardless of how a malformed file got into staging.
3. **Cross-check on LLM verification rejects out-of-set returns.** synthesize-flows requires every returned member to be a SUBSET of the AST-walked candidate set + members[0]==trigger.uuid. Even if the LLM returns valid-shaped UUIDs, if ANY UUID isn't in the proposal we discard the LLM output and use the static chain. Defense against hallucinated UUIDs that don't exist in nodes.json.
4. **HTTP-method prefix on the flow slug.** Surfaced during smoke as a Rule 1 bug (3 of 16 flow UUIDs collided when GET/PUT/DELETE on the same `route.ts` produced the same slug). Fix: prepend the HTTP method when `trigger.route` starts with `(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)`. Method-less slug is preserved for UI triggers. Tested for `flow-get-api-notes-id` / `flow-put-api-notes-id` / `flow-delete-api-notes-id` distinct outputs.
5. **JS fallback on JSX-01 is permissive on the structural single-element check.** The Rust validator's `count_top_level_jsx_elements` is the source of truth on "exactly one JSX element"; the JS fallback catches the broader "empty / malformed / out-of-range" failures. When the IDE binary IS installed and exposes `validate-repo`, the Rust check kicks in and gives full coverage.
6. **emit refuses to clobber populated `.contracts/` by default.** Bootstrap is a one-time greenfield op; ongoing maintenance is Phase 6's job. Operators can opt-in via `{ allowClobber: true }` to overwrite (intentional escape hatch for re-bootstrapping a repo whose .contracts/ went stale).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Watchdog timeout on `callClaude()` was a stated success criterion but not a literal task**

- **Found during:** Plan setup (`<important_context>` block stated "Watchdog timeout added to callClaude (or equivalent mitigation)" as a success criterion; Plan 14-04 SUMMARY's "Recommended for Plan 14-05" reinforced this)
- **Issue:** Plan 14-04's debrief documented that `claude -p` could silently hang on path-mode schema bugs (25/40 calls hung indefinitely). With Stage 5a's per-flow LLM verification call, an unbounded subprocess wait would risk the same hang on every flow synthesis.
- **Fix:** Added a hard SIGKILL watchdog to `callClaude()` — every invocation gets a default 120s timer (override via `BOOTSTRAP_CLAUDE_TIMEOUT_MS` env or per-call `{ timeoutMs }`). On timeout the child is killed and the promise rejects with `claude -p watchdog timeout after Nms (model=X). Bytes captured: stdout=N, stderr=N. Override via …`. `setTimeout` cleared in close-handler + error-handler so successful calls don't fire the watchdog after settle.
- **Files modified:** `.agents/skills/codebase-to-contracts/scripts/helpers/claude-cli-bridge.mjs`
- **Verification:** Existing test suite (3 derive-frontmatter + 4 derive-body + 4 align-jsx + 6 synthesize-flows tests) all pass via BOOTSTRAP_TEST_MODE=1 path which short-circuits before the watchdog fires.
- **Committed in:** `ae2dc7e` (Task 1 commit — bundled with synthesize-flows since this is Task 1's load-bearing dependency)

**2. [Rule 1 - Bug] Flow slug collisions on multi-verb route.ts files**

- **Found during:** Smoke run on bootstrap-demo-target (Marginalia)
- **Issue:** `synthesize-flows` reported 16 flows synthesized but only 13 unique UUIDs landed on disk. Three triggers (GET/PUT/DELETE on `api/notes/[id]/route.ts`; multi-verb `api/notes/route.ts`) collapsed to the same flow UUID because the original `flowSlugFromTrigger` keyed only off the file path. Last write wins → 3 flows silently lost.
- **Fix:** Prepend the HTTP method (lowercased) to the slug when `trigger.route` starts with one of `GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS`. UI triggers (route is `/path` or null) keep the method-less slug. Also normalize Next.js dynamic segments `[id]` → `id` so they survive the path-separator collapse without becoming empty after the bracket-strip.
- **Files modified:** `.agents/skills/codebase-to-contracts/scripts/synthesize-flows.mjs`, `.agents/skills/codebase-to-contracts/scripts/__tests__/synthesize-flows.test.mjs`
- **Verification:** Re-ran smoke; 16 flows synthesized → 16 unique slugs + 16 unique UUIDs (zero collisions). Added test case `flow-get-/put-/delete-api-notes-id` distinctness.
- **Committed in:** `0107f1a` (in-flight fix attributed to 14-05 — the plan whose smoke surfaced it)

---

**Total deviations:** 2 auto-fixed (1 missing-critical hardening, 1 blocking bug). **Impact on plan:** The watchdog is foundational for any future `claude -p` caller — every plan in 14-* using `callClaude()` benefits. The slug fix prevents 3/16 flows from being silently lost on the demo target — its absence would have masked all multi-verb route flows in Plan 14-06's recording.

## Authentication Gates

None — Stage 5a's LLM verification call uses the same `claude -p` machinery as 14-03/04, all of which Yang has already authenticated. Plan 14-06 will fire the actual subprocess against Marginalia.

## Issues Encountered

- **Pre-existing test failure (out of scope, deferred):** `pnpm test` reports 1 failure in `scripts/helpers/__tests__/schema-rust-parity.test.mjs` because the test greps for `pub struct Frontmatter` while the Rust struct is `pub struct ContractFrontmatter` (line 40 of `frontmatter.rs`). Pre-existing condition logged in Plan 14-03's `deferred-items.md`; out of scope for 14-05 per scope-boundary rule. Plan 14-05's own tests run via `node --test scripts/__tests__/*.test.mjs` and pass 42/42.
- **`.contracts/.staging/` orphan flow files from pre-slug-fix smoke run.** Identified 10 orphan flow files (UUIDs from the pre-fix slug-collision run that wouldn't be regenerated post-fix). Cleaned up with a small bash filter so the staging tree's flow count matches the synthesizer's `flows.length` exactly. Final state: 16 flow files = `flows.length`. Mechanical cleanup; no code change needed.

## User Setup Required

None — Stage 5a + 5b run with `BOOTSTRAP_TEST_MODE=1` for unit tests; full LLM smoke happens in Plan 14-06's end-to-end recording.

## Next Phase Readiness

**Ready for Plan 14-06 (end-to-end demo recording):**
- All 5 stages of the bootstrap pipeline are now plumbed end-to-end (`discover → derive-frontmatter → derive-body → align-jsx → synthesize-flows → emit`).
- Plan 14-06 will run the full pipeline against Marginalia at full LLM scale and verify:
  1. `_progress.json` shows stage_5a + stage_5b completion timestamps
  2. `.contracts/` contains ≥20 .md sidecars + ≥3 (likely ≥16) flow .md files
  3. `contract-uuid-plugin/` exists with the verbatim Babel loader
  4. `next.config.ts` has the BOOTSTRAP-INSERT block
  5. `cd /Users/yang/lahacks/bootstrap-demo-target && pnpm install && pnpm build` succeeds (BABEL-01 replication on the bootstrapped target)
- Watchdog is in place — silent hangs surface as `claude -p watchdog timeout after Nms` errors that Plan 14-06 can act on (retry / lower batch / skip node).
- LLM verification cross-check defends against hallucinated UUIDs in `members:` arrays.
- IDE startup test (does the bootstrapped repo open in the actual IDE without errors?) is the ultimate exit criterion for BOOTSTRAP-02 — happens in Plan 14-06's final smoke.

**Pending in 14-05's scope, deferred to 14-06:**
- LLM verification reorder count + cost per flow (smoke ran in BOOTSTRAP_TEST_MODE; real LLM count happens in 14-06)
- Cases where LLM verification reordered members vs static chain (zero in test mode; production pipeline records the count)
- `pnpm build` smoke against the bootstrapped Marginalia (actual BABEL-01 replication test)

**Open Question 7 status:** **Deferred (still). Decision for v1: ship JS fallback as the default validator; user-friction recorded in Plan 14-06. Adding `validate-repo` to the IDE binary is a Phase 14 follow-up — Yang ratifies after seeing real user behavior in Plan 14-06's recording.**

**Phase 14 progress: 5/7 plans complete (waves 1+2+3a + 5a/5b shipped). Remaining: 14-06 (full LLM run + IDE smoke + recording), 14-07 (in-IDE bootstrap CTA — pivots 14-06's recording target), 14-08 (Stage 0.5 historical artifact ingestion).**

---
*Phase: 14-codebase-to-contracts-bootstrap-skill-demo-application*
*Plan: 05*
*Completed: 2026-04-26*

## Self-Check: PASSED

Verified all 11 created/modified files exist on disk:
- `.agents/skills/codebase-to-contracts/scripts/synthesize-flows.mjs` FOUND
- `.agents/skills/codebase-to-contracts/scripts/install-babel-plugin.mjs` FOUND
- `.agents/skills/codebase-to-contracts/scripts/emit.mjs` FOUND
- `.agents/skills/codebase-to-contracts/scripts/validate.mjs` FOUND
- `.agents/skills/codebase-to-contracts/prompts/synthesize-flow.txt` FOUND
- `.agents/skills/codebase-to-contracts/scripts/__tests__/synthesize-flows.test.mjs` FOUND
- `.agents/skills/codebase-to-contracts/scripts/__tests__/emit.test.mjs` FOUND
- `.agents/skills/codebase-to-contracts/scripts/__tests__/validate.test.mjs` FOUND
- `.agents/skills/codebase-to-contracts/scripts/__tests__/fixtures/api-route-with-imports.ts` FOUND
- `.agents/skills/codebase-to-contracts/scripts/__tests__/fixtures/lib-payments.ts` FOUND
- `.agents/skills/codebase-to-contracts/scripts/helpers/claude-cli-bridge.mjs` FOUND (watchdog timeout added)

Verified all 3 task commits exist:
- `ae2dc7e` (feat 14-05 Task 1 — synthesize-flows + claude-cli-bridge watchdog)
- `61cd49a` (feat 14-05 Task 2 — emit + install-babel-plugin + validate)
- `0107f1a` (fix 14-05 — flow-slug method-prefix; Rule 1 deviation)

Verified test suite green:
- `node --test scripts/__tests__/{synthesize-flows,emit,validate}.test.mjs` — 15/15 pass
- `node --test scripts/__tests__/*.test.mjs` (full skill suite) — 42/42 pass

Verified Stage 5a smoke on bootstrap-demo-target produced expected output:
- 16 flow contracts synthesized in `.staging/` (ls confirms 16 frontmatter.json files with kind=flow)
- All 16 unique slugs + UUIDs (verified via dedup check; no collisions post-fix)
- _progress.json has stage_5a_completed_at + stage_5a_flows_synthesized=16 fields

Verified Plan 14-04 SUMMARY mitigations landed:
- Watchdog timeout in callClaude (default 120s SIGKILL via setTimeout, env override BOOTSTRAP_CLAUDE_TIMEOUT_MS)
- validate.mjs re-includes the top-level allOf guards (kind=flow ⇒ format_version=5+level=L2+members[]≥2; kind≠flow ⇒ format_version=3 + no members[])
