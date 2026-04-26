---
phase: 13-substrate-ui-demo-polish
plan: 10b
subsystem: demo-ui-orchestration
tags: [tauri-ipc, fixture-loading, demo-orchestration, dev-affordance, beat3, beat4]

# Dependency graph
requires:
  - 13-09 (SyncButton + VerifierPanel + HarvestPanel + window.__demo.loadBeat3VerifierResults; trigger_sync_animation IPC with locked SyncTriggerResult shape)
  - 13-10a (sibling Wave 5: blast-radius.json + beat3-verifier.json + beat4-harvest.json fixtures with PLACEHOLDER-* uuid strings)
  - 13-08 (PRReviewPanel z-index coexistence)
provides:
  - trigger_sync_animation extended to read blast-radius.json from disk (replaces 13-09 hardcoded placeholder uuids; fallback to empty arrays if fixture missing; honors CONTRACT_IDE_DEMO_FIXTURE_DIR env override)
  - load_beat3_verifier_fixture Rust IPC — reads beat3-verifier.json, returns parsed JSON to TS layer
  - emit_beat4_harvest Rust IPC — reads beat4-harvest.json, emits substrate:nodes-added Tauri event with harvested_nodes array (each carrying attached_to_uuid for HarvestPanel green-halo wiring per 13-09 N9)
  - loadAndApplyBeat3Verifier TS wrapper (src/lib/demoOrchestration.ts) — invokes load_beat3_verifier_fixture + applies via useVerifierStore.setResults
  - triggerBeat4Harvest TS wrapper (src/lib/demoOrchestration.ts) — invokes emit_beat4_harvest; HarvestPanel's substrate:nodes-added subscription consumes the emitted event
  - DemoOrchestrationPanel (src/components/dev/DemoOrchestrationPanel.tsx) — bottom-left z-50 dev affordance; three single-click triggers ("Beat 3: Sync animation", "Beat 3: Verifier results", "Beat 4: Harvest panel"); error surface with dismissible × button; gated on import.meta.env.DEV
affects:
  - 13-11 (rehearsal — substitutes real Phase 9 uuids into 13-10a's PLACEHOLDER-* fixtures, runs 4-beat demo end-to-end 3 times via DemoOrchestrationPanel triggers, validates ≥8/10 cmdp-precision gate against seeded substrate)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fixture-loaded IPC with env-var path override — CONTRACT_IDE_DEMO_FIXTURE_DIR overrides compile-time CARGO_MANIFEST_DIR-relative default; lets demo `.app` bundle and dev runs resolve different paths without rebuild"
    - "Graceful fixture-load fallback — sync.rs returns empty trigger/participants arrays + logs to stderr if blast-radius.json read fails; demo orchestrator (13-11) catches missing fixtures during pre-flight rather than the IPC blowing up the UI"
    - "Stable IPC response shape across staging → fixture transition — trigger_sync_animation body extended to read JSON without changing SyncTriggerResult, so 13-09's SyncButton wiring requires zero changes (pattern from 13-09 staging → 13-10b fixture transition realized)"
    - "Dev-only mount via import.meta.env.DEV — production builds tree-shake the panel out via dead-code elimination; 13-11 rehearsal verifies on release `.app` bundle (per 13-10b plan note: tauri build --debug builds in production mode, so `?demo=1` URL param OR config flag may be needed if rehearsal needs it on release builds)"

key-files:
  created:
    - "contract-ide/src-tauri/src/commands/demo_orchestration.rs (load_beat3_verifier_fixture + emit_beat4_harvest + fixture_dir helper)"
    - "contract-ide/src/components/dev/DemoOrchestrationPanel.tsx (bottom-left z-50 dev affordance)"
  modified:
    - "contract-ide/src-tauri/src/commands/sync.rs (replaced 13-09 hardcoded placeholders with load_blast_radius_fixture reading blast-radius.json; preserves SyncTriggerResult shape)"
    - "contract-ide/src-tauri/src/commands/mod.rs (registered pub mod demo_orchestration)"
    - "contract-ide/src-tauri/src/lib.rs (appended commands::demo_orchestration::load_beat3_verifier_fixture + commands::demo_orchestration::emit_beat4_harvest to generate_handler! AFTER 13-09's commands::sync::trigger_sync_animation per Wave 5 serialization compliance)"
    - "contract-ide/src/lib/demoOrchestration.ts (added loadAndApplyBeat3Verifier + triggerBeat4Harvest exports alongside 13-09's window.__demo wiring)"
    - "contract-ide/src/components/layout/AppShell.tsx (mounted DemoOrchestrationPanel additively alongside 13-08 PRReviewPanel + 13-09 SyncButton/VerifierPanel/HarvestPanel; gated on import.meta.env.DEV)"

key-decisions:
  - "Task 3 full visual + cmdp-precision verification DEFERRED to plan 13-11 by user direction — 13-11 rehearsal is the natural test surface where real Phase 9 uuid substitution into 13-10a's PLACEHOLDER-* fixtures happens, where the 4-beat demo runs end-to-end 3 times with rehearsal-log entries, and where the cmdp-precision ≥8/10 gate naturally executes against the seeded substrate. Pre-substituting uuids and smoke-testing now would duplicate 13-11's work and require Phase 14 data-realism (in flight in parallel)"
  - "Wave 5 serialization compliance — appended load_beat3_verifier_fixture + emit_beat4_harvest to lib.rs handler-list AFTER 13-09's trigger_sync_animation (which itself was appended AFTER 13-08's analyze_pr_diff); modified existing 13-09 files (sync.rs, demoOrchestration.ts) without locking in placeholder values; created new demo_orchestration.rs + DemoOrchestrationPanel.tsx; AppShell.tsx mount additive alongside 13-08's PRReviewPanel + 13-09's SyncButton/VerifierPanel/HarvestPanel"
  - "Pre-existing tsc error at AppShell.tsx:425 (`panel.expand?.(50)`) flagged as out-of-scope local edit (git blame: 'Not Committed Yet' — predates this run) — logged to deferred-items.md per Rules scope-boundary; plan 13-11 should resolve before final rehearsal commit OR fold into rehearsal fixes commit"

patterns-established:
  - "Fixture-loaded IPC with env-var path override — CONTRACT_IDE_DEMO_FIXTURE_DIR pattern reusable for any future demo-fixture-driven Rust IPC; mirrors `.app` bundle vs dev-run path resolution divergence cleanly"
  - "Three-button dev orchestration panel as universal demo entry point — single bottom-left panel beats scattering triggers across DevTools console invocations; DemoOrchestrationPanel + 13-09's window.__demo.loadBeat3VerifierResults coexist (panel for production demo flow, window.__demo for ad-hoc DevTools)"

requirements-completed: []  # DEMO-04 progress only — full completion gates on 13-11 rehearsal validation (3x end-to-end + cmdp-precision ≥8/10)

# Metrics
duration: ~12 min (Tasks 1+2 prior session) + docs finalization this run
tasks: 2 implementation + 1 checkpoint (deferred to 13-11)
files: 7 (2 created + 5 modified)
completed: 2026-04-25
---

# Phase 13 Plan 10b: Demo UI Orchestration Summary

**Pure UI/IPC layer for the 4-beat live demo — three Rust IPCs that read 13-10a's fixture JSON files (`trigger_sync_animation` extended to read `blast-radius.json`, new `load_beat3_verifier_fixture` + `emit_beat4_harvest`), TS wrappers (`loadAndApplyBeat3Verifier` + `triggerBeat4Harvest`), and `DemoOrchestrationPanel` bottom-left dev affordance with three single-click beat triggers — visual + cmdp-precision verification deferred to plan 13-11's rehearsal natural test surface.**

## What shipped

- **`commands/sync.rs`** — Replaced 13-09's hardcoded placeholder list with `load_blast_radius_fixture` reading `blast-radius.json` (env var `CONTRACT_IDE_DEMO_FIXTURE_DIR` overrides compile-time `CARGO_MANIFEST_DIR`-relative default `<repo>/contract-ide/demo/seeds/blast-radius.json`). Graceful fallback returns empty `SyncTriggerResult` on read/parse failure with stderr log; the IPC response shape is unchanged so 13-09's SyncButton wiring needs no modification.
- **`commands/demo_orchestration.rs`** — New module. `load_beat3_verifier_fixture` reads `beat3-verifier.json` and returns parsed `serde_json::Value` to the TS layer. `emit_beat4_harvest` reads `beat4-harvest.json`, extracts the `harvested_nodes` array, and emits `substrate:nodes-added` Tauri event for HarvestPanel's primary subscription path (each node carries `attached_to_uuid` per N9 for green-halo wiring through 13-09's `animateHarvestArrival`). Both honor the same `CONTRACT_IDE_DEMO_FIXTURE_DIR` env override via shared `fixture_dir()` helper.
- **`commands/mod.rs` + `lib.rs`** — Registered `pub mod demo_orchestration`; appended `commands::demo_orchestration::load_beat3_verifier_fixture` + `commands::demo_orchestration::emit_beat4_harvest` to `tauri::generate_handler!` AFTER 13-09's `commands::sync::trigger_sync_animation` per Wave 5 serialization. 13-10a touches no Rust source — no Wave-5 internal serialization needed.
- **`src/lib/demoOrchestration.ts`** — Added `loadAndApplyBeat3Verifier` (invokes `load_beat3_verifier_fixture`, calls `useVerifierStore.getState().setResults([...rows, flag], implicitDecisions)`) and `triggerBeat4Harvest` (invokes `emit_beat4_harvest`; HarvestPanel's `listen('substrate:nodes-added')` subscriber from 13-09 picks it up). Coexists with 13-09's `window.__demo.loadBeat3VerifierResults` (the inline-payload path remains for ad-hoc DevTools testing; this plan's IPC-driven path is for demo rehearsal).
- **`src/components/dev/DemoOrchestrationPanel.tsx`** — Bottom-left fixed-position panel (`z-50`, amber-bordered with `bg-background/95` backdrop-blur). Three single-click triggers: "Beat 3: Sync animation" (invokes `trigger_sync_animation`), "Beat 3: Verifier results" (calls `loadAndApplyBeat3Verifier`), "Beat 4: Harvest panel" (calls `triggerBeat4Harvest`). Dismissible via × button. Error surface for failed invocations. Gated on `import.meta.env.DEV` so production builds tree-shake out.
- **`src/components/layout/AppShell.tsx`** — Mounted `<DemoOrchestrationPanel />` additively behind `import.meta.env.DEV`, alongside 13-08's PRReviewPanel + 13-09's SyncButton/VerifierPanel/HarvestPanel; non-colliding z-indexes (top-right z-30 / top-right top-16 z-30 / bottom-right z-40 / bottom-left z-50).

## Task Commits

1. **Task 1: sync.rs reads blast-radius.json + new demo_orchestration.rs IPCs (load_beat3_verifier_fixture + emit_beat4_harvest); registered in mod.rs + lib.rs** — `4d648fd` (feat)
2. **Task 2: TS wrappers (loadAndApplyBeat3Verifier + triggerBeat4Harvest) + DemoOrchestrationPanel + AppShell mount via import.meta.env.DEV** — `f6f6f8d` (feat)
3. **Task 3: full visual + cmdp-precision verification** — DEFERRED to plan 13-11 by user direction (no commit)

_Plan metadata commit follows this SUMMARY (docs)._

## Decisions Made

### Verification deferred to plan 13-11

User direction: defer Task 3 full verification (visual smoke-test of all three beats end-to-end with real Phase 9 uuids substituted into 13-10a's PLACEHOLDER-* fixtures, plus the `npx vitest run cmdp-precision` ≥8/10 gate from plan 13-03) to plan 13-11's rehearsal. **Rationale:** Plan 13-11 is the natural test surface — its job is exactly to substitute real Phase 9 uuids into the JSON fixtures, run the 4-beat demo end-to-end 3 times with rehearsal-log entries, and validate the cmdp-precision gate against the seeded substrate. Pre-substituting uuids and smoke-testing now would duplicate 13-11's work and require an in-flight Phase 14 data-realism dependency (Phase 14 is shipping in parallel and feeds 13-11). Setting up custom intermediate fixtures for 13-10b isolation alone is wasted scope when 13-11's rehearsal is the canonical demo entry point.

### Wave 5 serialization compliance

Per the plan's `serialization_hint` frontmatter, 13-10b is the only Wave 5 plan modifying `lib.rs`; 13-10a touches `demo/` only. Within 13-10b, the two new IPCs (`load_beat3_verifier_fixture` + `emit_beat4_harvest`) appended to `tauri::generate_handler!` AFTER 13-09's `trigger_sync_animation` (which itself was appended after 13-08's `analyze_pr_diff` in Wave 4). 13-09's existing `sync.rs` body modified in-place to swap hardcoded placeholders for fixture reads — the preserved `SyncTriggerResult` struct shape means no consumer (SyncButton, animateSyncBlastRadius) requires changes. AppShell.tsx mount is additive alongside 13-08 + 13-09 surfaces with non-colliding z-indexes.

### Fixture-loaded IPC pattern with env-var path override

`CONTRACT_IDE_DEMO_FIXTURE_DIR` overrides the compile-time `CARGO_MANIFEST_DIR`-relative default. This lets the demo `.app` bundle (where fixtures sit alongside the binary in a known location) and dev runs (where fixtures sit at `<repo>/contract-ide/demo/seeds/`) resolve different paths without a rebuild. Plan 13-11's rehearsal harness will likely set this env var when launching the locked `.app`. Read failures fall back gracefully (empty arrays + stderr log) so missing fixtures are caught at pre-flight rather than blowing up the UI mid-demo.

### Pre-existing AppShell.tsx:425 tsc error flagged out-of-scope

`contract-ide/src/components/layout/AppShell.tsx:425` — `panel.expand?.(50)` calls `expand` with an argument but the type expects 0 arguments. `git blame` shows "Not Committed Yet" (predates this plan). Per deviation Rules scope-boundary, logged to `deferred-items.md` rather than fixed inline. Plan 13-11 should resolve before final rehearsal commit OR fold into a rehearsal fixes commit.

## Deviations from Plan

None — plan executed exactly as written. Task 3 deferral per user direction is not a deviation (it's an explicit user-approved checkpoint outcome documented in resume instructions).

## Issues Encountered

None during implementation. Verification deferred to plan 13-11's rehearsal surface.

## User Setup Required

None for this plan. Plan 13-11 will require:
- Real Phase 9 uuids substituted into the three 13-10a fixtures (`blast-radius.json`, `beat3-verifier.json`, `beat4-harvest.json`) — `grep PLACEHOLDER- contract-ide/demo/seeds/*.json` enumerates substitution sites.
- Demo repo present with locked commit (per 13-10a's `reset-demo.sh` env vars).
- `.app` bundle built (or `tauri dev` for fallback) for the cmdp-precision gate.

## Downstream Contracts for Plan 13-11

1. **Fixture placeholders to substitute.** All three JSON fixtures at `contract-ide/demo/seeds/{blast-radius,beat3-verifier,beat4-harvest}.json` use `PLACEHOLDER-*` uuid strings. Run `grep PLACEHOLDER- contract-ide/demo/seeds/*.json` to enumerate every site that needs a real Phase 9 uuid before the 3x rehearsal.
2. **Env-var path override.** `trigger_sync_animation` (and the two `demo_orchestration` IPCs) honor `CONTRACT_IDE_DEMO_FIXTURE_DIR` for fixture path resolution. Useful if the demo `.app` bundle and dev runs need different paths.
3. **DemoOrchestrationPanel UX.** Bottom-left `z-50`; three single-click triggers ("Beat 3: Sync", "Beat 3: Verifier", "Beat 4: Harvest"); error surface with dismissible × button. Demonstrator drives all timing — no auto-fire on app boot.
4. **cmdp-precision gate (from 13-03).** Run `cd contract-ide && npx vitest run cmdp-precision` against the seeded substrate. SC-1 ≥80% top-1 (≥8/10). Mitigation per `13-RESEARCH.md` Risk 1 if precision falls below threshold: add FTS5 substring match as first-pass filter before LLM rerank.
5. **Pre-existing AppShell.tsx:425 tsc error.** Logged in `deferred-items.md`. Resolve before final rehearsal commit OR fold into rehearsal fixes commit.
6. **N9 green-halo wiring contract.** `emit_beat4_harvest` emits `substrate:nodes-added` Tauri event with `harvested_nodes` array; each carries `attached_to_uuid`. HarvestPanel's listener (from 13-09) calls `animateHarvestArrival` on each — green halos stagger ~200ms apart per N9. Verified contract-shape; visual fidelity validated in 13-11 rehearsal.

## Next Phase Readiness

**Plan 13-11 (Wave 6 — final plan):**
- Runbook v2 rewrite + `live-scenario.md` replacement.
- Real Phase 9 uuid substitution into 13-10a's `PLACEHOLDER-*` fixtures.
- 3x end-to-end rehearsal via DemoOrchestrationPanel + reset-demo.sh between runs.
- cmdp-precision ≥8/10 gate validation against seeded substrate.
- `13-UAT.md` covering all 11 SCs.
- Resolve pre-existing AppShell.tsx:425 tsc error.

Phase 13 closes when 13-11 lands; milestone closes when Phase 14 (codebase-to-contracts skill + demo target) lands its UAT.

---
*Phase: 13-substrate-ui-demo-polish*
*Completed: 2026-04-25 (verification deferred to 13-11)*

## Self-Check: PASSED

- contract-ide/src-tauri/src/commands/demo_orchestration.rs — present (created in Task 1, commit `4d648fd`)
- contract-ide/src/components/dev/DemoOrchestrationPanel.tsx — present (created in Task 2, commit `f6f6f8d`)
- Commit `4d648fd` (Task 1) — FOUND in git log
- Commit `f6f6f8d` (Task 2) — FOUND in git log
- Task 3 verification deferred to plan 13-11 per user direction (no commit expected)
- Documentation-only finalization run — no source files modified
