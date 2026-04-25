---
phase: 01-foundation
plan: 04
subsystem: infra
tags: [tauri-plugin-shell, claude-cli, posttooluse-hook, better-sqlite3, pkg, monaco, wkwebview, integration-validation]

# Dependency graph
requires:
  - phase: 01-foundation (Plan 01)
    provides: Tauri shell, CSP with blob:, Monaco CSP + vite-plugin-monaco-editor, tauri-plugin-shell registration
  - phase: 01-foundation (Plan 02)
    provides: SQLite schema + typed IPC skeleton (commands::get_nodes pattern)
  - phase: 01-foundation (Plan 03)
    provides: AppShell rendering surface (pill + panel mount point)
provides:
  - Dev-only Day-1 Validation panel in Tauri app running all four integration checks on demand
  - Three registered #[tauri::command] functions for integration validation (test_claude_spawn, test_hook_payload_fixture, test_pkg_sqlite_binary)
  - Written validation record (01-04-DAY1-VALIDATION.md) with 8-cell pass matrix (A/B/C/D × terminal/Finder launch)
  - Empirical proof that tauri-plugin-shell default env inheritance carries HOME/PATH correctly on this dev machine under BOTH launch modes — Pitfall-4 cleared without workaround
affects: [phase-02-contract-data-layer, phase-08-agent-loop-receipts-hook]

# Tech tracking
tech-stack:
  added: []   # no new runtime deps; only exercises Plans 01/02/03 surface + day0 artifacts
  patterns:
    - "Integration-validation dev panel pattern: Rust commands that wrap subprocess/fs checks, TS wrappers under src/ipc/, a collapsible dev panel mounted from App.tsx — deleted or moved in later phase"
    - "Check B hard-fail contract: a missing/empty JSONL must surface as Err, never a silent ✓ — prevents a false-green Phase 1 gate"
    - "Dev-panel visibility policy: gate NOTHING on import.meta.env.DEV when the panel must reach --debug builds; mark component for removal in a tracked follow-up instead"

key-files:
  created:
    - contract-ide/src-tauri/src/commands/validation.rs
    - contract-ide/src/ipc/validation.ts
    - contract-ide/src/components/dev/Day1Validation.tsx
    - .planning/phases/01-foundation/01-04-DAY1-VALIDATION.md
  modified:
    - contract-ide/src-tauri/src/commands/mod.rs
    - contract-ide/src-tauri/src/lib.rs
    - contract-ide/src/App.tsx

key-decisions:
  - "Pill/panel gate on import.meta.env.DEV removed — vite builds in production mode under `tauri build --debug`, which hid the panel in the exact mode needed to test Pitfall-4 from a Finder-launched .app. Trade-off: dev-only widget is visible in debug builds until explicit removal in Phase 9 polish."
  - "Pitfall-4 (subprocess env inheritance under Finder-launched .app) cleared with zero workaround on this machine — default tauri-plugin-shell output() inherits HOME + PATH correctly. Absence of a workaround documented as load-bearing (future debug starting point if a different machine fails)."
  - "`tauri build -- --debug` DMG packaging step failed but .app bundle built fine; .app is the artifact used for the Finder-launch gate, so DMG failure is logged as non-blocking noise deferred to Phase 9 distribution work."
  - "Check B (PostToolUse hook fixture + transcript input_tokens) enforces a hard-fail on missing JSONL or missing input_tokens; no silent-success fallback — the gate must be provable, not assumed."
  - "Check C binary path hard-coded to /Users/yang/lahacks/day0/check3-pkg-sqlite/bin/day0-sqlite per day0/FINDINGS.md — matches the verified on-disk artifact; rebuild instructions live alongside the binary."

patterns-established:
  - "Pattern: integration-validation dev panel as a dev-time-only harness — Rust commands + TS wrappers + a single React panel file, all marked for deletion/move in a later phase rather than quarantined behind a build-mode gate that fails in --debug mode"
  - "Pattern: cross-machine Finder-launch validation for every macOS subprocess feature added in later phases — terminal-launch is a necessary but insufficient test"

requirements-completed: [SHELL-01, SHELL-04, SHELL-05]

# Metrics
duration: ~30min
completed: 2026-04-24
---

# Phase 1 Plan 4: Day-1 Integration Validation Summary

**Four integration checks (claude subprocess, PostToolUse hook fixture with transcript input_tokens proof, pkg-compiled better-sqlite3, Monaco WKWebView workers) proven green from both terminal and Finder-launched Tauri app — ROADMAP Phase 1 entry criterion (6) fully satisfied; Phase 2 unblocked.**

## Performance

- **Duration:** ~30 min (Rust/TS implementation + tauri build --debug + human verification across both launch modes + pill-gate fix + documentation)
- **Started:** 2026-04-24 (single-session execution)
- **Completed:** 2026-04-24
- **Tasks:** 2 (1 implementation, 1 checkpoint:human-verify)
- **Files modified:** 7 (4 created, 3 modified)

## Accomplishments

- Three `#[tauri::command]` integration-validation functions wired into `commands::{validation}` and registered in the invoke handler alongside `get_nodes`
- Three typed TS IPC wrappers (`testClaudeSpawn`, `testHookPayloadFixture`, `testPkgSqliteBinary`) under `src/ipc/validation.ts`
- Day-1 Validation dev panel with 4 rows (A/B/C hardware checks + D Monaco visual check), collapsible `<pre>` output per check, shown via a floating pill in App.tsx
- Check B enforces a hard-fail contract on missing JSONL or missing `input_tokens` — no silent ✓; resolved transcript path surfaced to the UI on success
- Check C points at the verified on-disk day0 pkg artifact at `day0/check3-pkg-sqlite/bin/day0-sqlite`
- Human verification record (`01-04-DAY1-VALIDATION.md`) with 8/8 PASS matrix across A/B/C/D × terminal/Finder launch — Pitfall-4 (subprocess env under Finder launch) cleared without workaround

## Task Commits

1. **Task 1: test_claude_spawn + Day1Validation panel + IPC wrappers + UI pill** — `d951583` (feat)
2. **Task 2: checkpoint:human-verify — Day-1 integration validation** — human-driven; no code commit from the checkpoint itself
3. **In-checkpoint deviation: remove import.meta.env.DEV gate on the pill** — `7217684` (fix)

**Plan metadata commit:** to be added by the final `docs(01-04)` commit covering SUMMARY/STATE/ROADMAP/VALIDATION-record changes.

## Files Created/Modified

- `contract-ide/src-tauri/src/commands/validation.rs` — three `#[tauri::command]` functions wrapping claude spawn, hook-payload fixture parsing with transcript `input_tokens` proof, and pkg+sqlite binary spawn via tauri-plugin-shell; all return `Result<…, String>` with captured stdout/stderr/exit_code where applicable
- `contract-ide/src-tauri/src/commands/mod.rs` — registered validation module + re-exports
- `contract-ide/src-tauri/src/lib.rs` — extended `generate_handler!` to include the three new commands alongside `get_nodes`
- `contract-ide/src/ipc/validation.ts` — typed TS wrappers + `SpawnResult` interface
- `contract-ide/src/components/dev/Day1Validation.tsx` — 4-row dev panel with status icons (● / ✓ / ✗), collapsible output blocks, `[Mount Monaco]` visual check
- `contract-ide/src/App.tsx` — floating pill toggle + mounted panel; `import.meta.env.DEV` gate REMOVED during human-verify so the pill is reachable in `tauri build --debug` (where vite is in production mode)
- `.planning/phases/01-foundation/01-04-DAY1-VALIDATION.md` — permanent validation record with 8-cell pass matrix

## Decisions Made

- **Pill-gate removal:** `import.meta.env.DEV` is false under `tauri build --debug`. The Finder-launch leg of the Phase-1 entry criterion REQUIRES a `.app` bundle, which is produced by `tauri build --debug`. Gating the panel on `DEV` made Pitfall-4 untestable in the mode that needs testing. Removed the gate entirely; panel + pill render unconditionally. Widget is Phase-1-only, explicitly marked for removal before any user-facing ship (tracked as a Phase 9 polish follow-up).
- **Pitfall-4 outcome (no workaround needed):** All speculative fallbacks in the plan (hard-code HOME, absolute claude path, `zsh -l -c` wrapper) turned out unnecessary on this machine. Default `tauri-plugin-shell` `output()` carried HOME + PATH correctly. The absence of a workaround is itself load-bearing documentation — future Phase 8 debug on a different machine should start from "which env var is now missing" rather than "rebuild the subprocess pipeline."
- **DMG bundle noise is non-blocking:** `bundle_dmg.sh` failed during `tauri build -- --debug`; the `.app` bundle (used for Finder-launch verification) built fine. Logged for Phase 9 distribution work rather than blocking Phase 2.

## Bug-fix story

**`fix(01-04): show day-1 validation pill in --debug builds (gate removed)` — commit `7217684`**

During the checkpoint:human-verify task, the first Finder-launch attempt revealed that the floating "day-1 checks" pill did not render inside the `.app` bundle. Root cause: `App.tsx` gated the pill and panel on `import.meta.env.DEV`, which is `false` under `tauri build --debug` (vite runs its production build regardless of the Tauri-side `--debug` flag). Without the pill, Check A under Finder launch — the entire point of Pitfall-4 validation — was unreachable through the UI.

Fix applied: removed the `isDev` branch entirely; pill and panel render unconditionally. The panel is explicitly Phase-1-only dev infrastructure and is tracked for deletion in Phase 9 polish. This trade-off (panel briefly visible in non-dev modes until Phase 9) is acceptable because the app is not user-facing during Phases 1–8.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed `import.meta.env.DEV` gate on Day-1 Validation pill**
- **Found during:** Task 2 (checkpoint:human-verify)
- **Issue:** Pill + panel gated on `import.meta.env.DEV`, which is `false` under `tauri build --debug` (vite uses production mode). This hid the panel in the exact launch mode needed to test Pitfall-4 (Finder-launched `.app` env inheritance).
- **Fix:** Removed the `isDev` branch in `App.tsx`; pill and panel always render.
- **Files modified:** `contract-ide/src/App.tsx`
- **Verification:** Rebuilt `.app` via `tauri build -- --debug`, launched from Finder, pill visible, all four Finder-launch check cells passed.
- **Commit:** `7217684`

---

**Total deviations:** 1 auto-fixed (1 Rule-1 bug)
**Impact on plan:** Fix was necessary for the Finder-launch verification leg to be possible at all. Panel visibility in non-dev modes is documented as accepted until Phase 9 polish removes the widget entirely. No scope creep.

## Issues Encountered

- **DMG packaging failure in `tauri build -- --debug`:** `bundle_dmg.sh` failed, but the `.app` bundle (the artifact actually used for Finder-launch verification) built successfully. Logged as known build-noise and deferred to Phase 9 distribution work. Not a Phase 1 blocker.

## Authentication Gates

None. The `claude` CLI auth was already configured on the host machine before Plan 01-04 started (Check A relies on this prerequisite; verified by the operator in the "how-to-verify" preflight step).

## User Setup Required

None — no external service configuration required for Phase 1.

## Requirements Closure

This plan is the explicit integration gate for Phase 1 success criterion (6) — the criterion is now satisfied. It does NOT introduce any new requirement closures; the requirements listed in the plan's frontmatter (SHELL-01, SHELL-04, SHELL-05) were already closed by Plans 01-01 through 01-03. Re-asserting them here is correct given the plan's frontmatter, but no new traceability rows are created by this plan.

## Follow-ups (carry into later phases)

- **Phase 9 polish:** Remove `Day1Validation` panel + pill + Rust validation commands before any user-facing ship. The panel is dev-only hackathon infrastructure.
- **Plan 01-01 carry-over (still open):** Rename Tauri bundle identifier away from the `.app` suffix (`com.contract-ide.app` → e.g., `com.contract-ide.ide`) — surfaced as a build warning in 01-01; non-blocking for Phase 2.
- **Phase 9 distribution:** Fix `bundle_dmg.sh` failure under `tauri build -- --debug`. Non-blocking until we actually need distributable DMGs.

## Next Phase Readiness

**Phase 2 is unblocked.** ROADMAP Phase 1 success criterion (6) — the explicit Day-1 integration gate — has all four checks green from BOTH launch modes on this dev machine. The subprocess auth inheritance risk, which is the single largest Phase 8 dependency, is now empirically de-risked against the real Tauri process (not just day0 bench tests). Phase verification itself is owned by the orchestrator (`/gsd:verify-work 01`), not this plan; no phase-complete action taken here.

---
*Phase: 01-foundation*
*Completed: 2026-04-24*

## Self-Check: PASSED

All key-files verified on disk; both per-task commits (`d951583`, `7217684`) present in `git log`. Plan-metadata commit follows from this record.

