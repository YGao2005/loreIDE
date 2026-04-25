---
phase: 08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation
plan: 05
subsystem: ui
tags: [tauri, rust, react, typescript, monaco, zustand, cvа, drift, cherrypick]

# Dependency graph
requires:
  - phase: 07-drift-detection-watcher-path
    provides: DriftLocks per-UUID Tokio mutex (for_uuid pattern), drifted CVA variant, SourceWatcher
  - phase: 03-graph-canvas
    provides: contractNodeStyles CVA, buildFlowNodes, GraphCanvasInner, ContractNode, GroupNode
  - phase: 04-inspector-monaco
    provides: Monaco DiffEditor bundle, shadcn Dialog, Inspector layout pattern
  - phase: 02-contract-data-layer
    provides: write_sidecar/parse_sidecar helpers, ContractFrontmatter
provides:
  - apply_cherrypick Rust IPC: atomic temp+rename write (source files FIRST, sidecar LAST)
  - cherrypick atomic-write tests: 3 unit tests proving Pitfall 6 closed
  - targeted CVA variant: teal ring glow on graph node selection (CHRY-01)
  - CherrypickModal: shadcn Dialog with persistent OrientationHeader + Monaco DiffPanes (CHRY-02)
  - applyCherrypick IPC wrapper: single-call atomic approve (CHRY-03)
  - useCherrypickStore: Zustand store for targeted ring + pending patch lifecycle
affects:
  - phase 08-06 (reconcile + E2E): will consume useCherrypickStore for patch lifecycle
  - phase 09 polish: targeted ring glow visual treatment (teal hue decision)
  - phase 11 delegate-button: will consume applyCherrypick IPC from Delegate flow

# Tech tracking
tech-stack:
  added:
    - thiserror = "1" (unblocks section_parser.rs from 08-01 which referenced it without dep)
  patterns:
    - "apply_cherrypick_inner: testable inner fn accepting repo: &Path, used by Tauri command wrapper — same pattern as other audit-friendly Rust commands"
    - "Pitfall 6 write order: source temps -> source renames -> sidecar temp -> sidecar rename; partial failure leaves drift observable"
    - "DriftLocks acquire arc = locks.for_uuid(&uuid); _guard = arc.lock().await — arc must outlive guard (E0716 fix)"
    - "targeted CVA variant: compoundVariants suppress teal ring when state=drifted OR rollupState!=fresh — enforces red>amber>gray>targeted precedence"
    - "buildFlowNodes accepts targetedNodeUuid: string|null — keeps function pure, useMemo deps explicit"
    - "useCherrypickStore.reset() wired in BOTH pickAndOpenRepo AND openRepo — prevents stale ring across repos"

key-files:
  created:
    - contract-ide/src-tauri/src/commands/cherrypick.rs
    - contract-ide/src-tauri/tests/cherrypick_atomic_tests.rs
    - contract-ide/src/store/cherrypick.ts
    - contract-ide/src/ipc/cherrypick.ts
    - contract-ide/src/components/cherrypick/CherrypickModal.tsx
    - contract-ide/src/components/cherrypick/OrientationHeader.tsx
    - contract-ide/src/components/cherrypick/DiffPane.tsx
  modified:
    - contract-ide/src-tauri/src/commands/mod.rs
    - contract-ide/src-tauri/src/lib.rs
    - contract-ide/src-tauri/Cargo.toml
    - contract-ide/src-tauri/src/sidecar/section_parser.rs
    - contract-ide/src/components/graph/contractNodeStyles.ts
    - contract-ide/src/components/graph/ContractNode.tsx
    - contract-ide/src/components/graph/GroupNode.tsx
    - contract-ide/src/components/graph/GraphCanvasInner.tsx
    - contract-ide/src/components/layout/Inspector.tsx
    - contract-ide/src/components/command-palette/CommandPalette.tsx
    - contract-ide/src/ipc/repo.ts

key-decisions:
  - "Targeted ring glow hue: ring-teal-400/70 with [animation-duration:2000ms] — teal is NOT orange (Phase 13 reserved), NOT amber (08-02 rollup), NOT red (drift); reads as 'this is the focus' without competing with drift pulse"
  - "08-01 compute_section_hashes graceful degradation: apply_cherrypick ships without section_hashes recompute (only contract_hash updated on sidecar write). 08-01 and 08-06 backfill when they land"
  - "commands module promoted to pub mod for integration test access (tests/cherrypick_atomic_tests.rs references contract_ide_lib::commands::cherrypick)"
  - "path-escape fix: resolve_safe uses manual stack walk (lexical normalization) instead of canonicalize on non-existent paths — handles ../../etc/passwd even when intermediate dirs don't exist"
  - "thiserror added to Cargo.toml as Rule 3 (blocking) fix — section_parser.rs from 08-01 referenced it without the dep being declared"
  - "section_parser.rs: #![allow(dead_code)] added module-wide — public API not yet called within crate; will be consumed by 08-06"
  - "Dev affordance location: Inspector header 'Demo' button constructs synthetic PendingPatch from selected node's contract_body — TODO to remove in 08-06 or Phase 9"
  - "cross-filesystem rename: test ignored (#[ignore]) — requires two mount points not available on standard macOS dev; behavior documented as unsupported (return Err)"

requirements-completed: [CHRY-01, CHRY-02, CHRY-03]

# Metrics
duration: 14min
completed: 2026-04-25
---

# Phase 08 Plan 05: Cherrypick Flow Summary

**Atomic single-IPC cherrypick approve (sidecar+source via Pitfall-6-safe temp+rename), targeted teal ring glow on node selection, and Monaco DiffEditor modal with persistent orientation header**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-04-25T06:08:07Z
- **Completed:** 2026-04-25T06:22:17Z
- **Tasks:** 2
- **Files modified:** 18

## Accomplishments

- `apply_cherrypick` Rust IPC: writes N source files THEN sidecar, all via temp+rename; acquires same DriftLocks mutex as Phase 7 watcher; path-escape guard; 3 unit tests pass (incl. mid-rename failure proving Pitfall 6 closed)
- `targeted` CVA variant: teal ring glow (`ring-teal-400/70`, slow 2s pulse) with compoundVariants enforcing `red > amber > gray > targeted` precedence so drift/rollup always dominate visually
- `CherrypickModal`: shadcn Dialog with sticky `OrientationHeader` (`NodeName — intent — N tool calls`) above Monaco DiffEditor panes for contract + per-file code diffs; single Approve fires ONE IPC call (CHRY-03 invariant)
- Dev affordance in Inspector header exercises the full path end-to-end (synthetic PendingPatch → modal → atomic IPC → disk write)

## Task Commits

1. **Task 1: apply_cherrypick Rust IPC + atomic-write tests** — `0d3ba1c` (feat)
2. **Task 2: targeted CVA + cherrypick store/IPC + modal** — `8f1cdca` (feat)

## Files Created/Modified

**Created:**
- `contract-ide/src-tauri/src/commands/cherrypick.rs` — apply_cherrypick IPC + apply_cherrypick_inner testable helper + resolve_safe path guard
- `contract-ide/src-tauri/tests/cherrypick_atomic_tests.rs` — 3 unit tests (success, mid-rename failure, path-escape)
- `contract-ide/src/store/cherrypick.ts` — Zustand cherrypick store (targetedNodeUuid, pendingPatch, modalOpen, reset)
- `contract-ide/src/ipc/cherrypick.ts` — applyCherrypick invoke wrapper
- `contract-ide/src/components/cherrypick/CherrypickModal.tsx` — main modal with OrientationHeader + DiffPanes + Approve
- `contract-ide/src/components/cherrypick/OrientationHeader.tsx` — sticky persistent header above all diff panes
- `contract-ide/src/components/cherrypick/DiffPane.tsx` — Monaco DiffEditor wrapper with auto-language detection

**Modified:**
- `contract-ide/src-tauri/src/commands/mod.rs` — added pub mod cherrypick
- `contract-ide/src-tauri/src/lib.rs` — registered apply_cherrypick + promoted commands to pub mod
- `contract-ide/src-tauri/Cargo.toml` — added thiserror = "1"
- `contract-ide/src-tauri/src/sidecar/section_parser.rs` — added #![allow(dead_code)] to unblock clippy -D warnings
- `contract-ide/src/components/graph/contractNodeStyles.ts` — targeted + rollupState CVA variants + compoundVariants
- `contract-ide/src/components/graph/ContractNode.tsx` — targeted + rollupState in data interface + render
- `contract-ide/src/components/graph/GroupNode.tsx` — targeted ring with precedence logic
- `contract-ide/src/components/graph/GraphCanvasInner.tsx` — targetedNodeUuid subscription + buildFlowNodes update + onNodeClick sets target
- `contract-ide/src/components/layout/Inspector.tsx` — dev Demo affordance + Review changes button + CherrypickModal mounted
- `contract-ide/src/components/command-palette/CommandPalette.tsx` — Cmd+K jump-to-node sets targetedNodeUuid
- `contract-ide/src/ipc/repo.ts` — useCherrypickStore.reset() in pickAndOpenRepo + openRepo

## Decisions Made

- **Targeted ring hue:** `ring-teal-400/70` with `[animation-duration:2000ms]` slow pulse. Teal reads as "focus indicator" without competing with red-pulse drift (red) or rollup amber/gray. Not orange (Phase 13 reserved for `intent_drifted`).
- **section_hashes graceful degradation:** apply_cherrypick updates only `contract_hash` in the sidecar (via existing `hash_text` / `write_sidecar` helpers). No `section_hashes` recompute — 08-01's `compute_section_hashes` is available but integration deferred; lazy migration on next 08-01 write. Document deviation below.
- **Path-escape via lexical normalization:** `resolve_safe` uses a manual component-walk (not `canonicalize` on non-existent paths) to handle `../../etc/passwd` when intermediate dirs don't exist. After normalization, final containment check with `canonicalized_repo.starts_with`.
- **cross-filesystem rename:** test decorated `#[ignore]` with explanation — not simulatable on single-mount macOS dev machines. The Err path is present in the code but not exercised in CI.
- **commands pub mod:** promoted `mod commands` to `pub mod commands` in `lib.rs` so `tests/cherrypick_atomic_tests.rs` can access `contract_ide_lib::commands::cherrypick`. This is consistent with `pub mod drift` and `pub mod sidecar` which were already public for the same reason.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added thiserror = "1" to Cargo.toml**
- **Found during:** Task 1 (cargo check blocked compilation)
- **Issue:** section_parser.rs from 08-01 referenced `use thiserror::Error` and `#[derive(Error)]` but thiserror was not in Cargo.toml — caused `error[E0432]: unresolved import thiserror`
- **Fix:** Added `thiserror = "1"` to [dependencies] in Cargo.toml
- **Files modified:** contract-ide/src-tauri/Cargo.toml
- **Verification:** cargo check clean after add
- **Committed in:** 0d3ba1c (Task 1 commit)

**2. [Rule 3 - Blocking] Fixed section_parser.rs dead-code warnings breaking clippy -D warnings**
- **Found during:** Task 1 (clippy --all-targets -- -D warnings failed)
- **Issue:** section_parser.rs had `heading_end_offset` never-read variable + unused public enum/fns. The first-pass file (from 08-01) had grown without being consumed yet, triggering dead-code lint errors under -D warnings.
- **Fix:** Removed dead `parse_sections` first pass (it called into collect_h2_bounds redundantly), added `#![allow(dead_code)]` at module top with comment explaining API will be consumed by 08-06
- **Files modified:** contract-ide/src-tauri/src/sidecar/section_parser.rs
- **Verification:** cargo clippy --all-targets -- -D warnings clean
- **Committed in:** 0d3ba1c (Task 1 commit)

**3. [Rule 1 - Bug] Fixed E0716 borrow error in apply_cherrypick**
- **Found during:** Task 1 (cargo check error)
- **Issue:** `let _guard = locks.for_uuid(&uuid).lock().await;` — the Arc returned by `for_uuid()` is a temporary dropped before `_guard` is used at function exit (E0716: temporary value freed while still borrowed)
- **Fix:** Bind to a named variable: `let arc = locks.for_uuid(&uuid); let _guard = arc.lock().await;` — arc's lifetime extends to function end
- **Files modified:** contract-ide/src-tauri/src/commands/cherrypick.rs
- **Verification:** cargo check + clippy clean
- **Committed in:** 0d3ba1c (Task 1 commit)

**4. [Rule 1 - Bug] Replaced explicit counter loop with enumerate() in apply_cherrypick_inner**
- **Found during:** Task 1 (clippy::explicit_counter_loop lint under -D warnings)
- **Issue:** `let mut rename_count = 0; for ... { rename_count += 1; }` triggered clippy::explicit_counter_loop
- **Fix:** `for (rename_count, (resolved, tmp)) in source_pairs.iter().enumerate()`
- **Files modified:** contract-ide/src-tauri/src/commands/cherrypick.rs
- **Committed in:** 0d3ba1c (Task 1 commit)

---

**Total deviations:** 4 auto-fixed (2 Rule 3 blocking, 2 Rule 1 bug)
**Impact on plan:** All necessary for compilation and clippy -D warnings. No scope creep.

## CHRY Invariant Verification

- **CHRY-01 — targeted ring glow before agent run:** `useCherrypickStore.getState().setTarget(node.id)` called in `onNodeClick` AND Cmd+K `handleJumpToNode`. Ring renders immediately on click via `buildFlowNodes` useMemo dep on `targetedNodeUuid`. Persists until (a) different node selected, (b) modal approved.
- **CHRY-02 — persistent orientation header:** `OrientationHeader` rendered sticky (`sticky top-0 z-10`) above all DiffPane components in the modal scroll region. `NodeName — intent — N tool calls` format.
- **CHRY-03 — single IPC Approve:** CherrypickModal's `handleApprove` contains exactly ONE `await applyCherrypick(...)` call. No loop over file_patches calling separate writes. Verified by code review.

## Output Spec Answers

- **Final targeted ring hue:** `ring-teal-400/70 animate-pulse [animation-duration:2000ms]` — Tailwind classes, confirmed not orange (Phase 13 reserved) and not amber/gray (08-02 rollup)
- **08-01 compute_section_hashes availability:** Not integrated — graceful degradation. apply_cherrypick updates only `contract_hash` via `hash_text_inner`. Section hashes will be recomputed on next 08-01 write path.
- **Atomic-failure test result:** PASSED — `mid_rename_failure_leaves_drift_observable` test confirms: first source updated, second source untouched, sidecar retains old hash, function returns Err with "partial-cherrypick" message
- **Cross-filesystem rename:** Test decorated `#[ignore]` — not simulatable on this machine (single APFS volume). Code returns Err if rename fails; behavior is present but untested at unit level.
- **Dev affordance location:** Inspector header — small "Demo" button beside the DriftBadge. Constructs synthetic PendingPatch from selected node's contract_body. TODO comment marks for removal in 08-06.
- **Approve click fires exactly ONE applyCherrypick IPC call:** Confirmed by code review — handleApprove contains a single `await applyCherrypick(...)`, no loop. CHRY-03 invariant preserved.
- **Latency target:** Not measurable without running app + seeded repo; on-disk temp write + 1-2 renames for a typical small contract + one source file should be well under 200ms on local NVMe.

## Issues Encountered

- `resolve_safe` initial implementation failed `path_escape_rejected` test because `../../etc/passwd`'s parent `../../etc` doesn't exist in the tempdir, causing `canonicalize` to error before the containment check ran. Fixed with lexical path normalization (manual component stack walk).

## User Setup Required

None — no external services. Requires an open repo in the app to test the IPC path (sidecar write needs a repo root from `RepoState`).

## Next Phase Readiness

- `apply_cherrypick` IPC is ready for 08-04's agent loop to call after a run completes (once JSONL patch extraction lands)
- `useCherrypickStore.pendingPatch` is ready to receive real patches from 08-04
- Dev affordance ("Demo" button) should be removed in 08-06 once real agent loop integration is complete
- The targeted ring glow will persist correctly through any agent run that follows a graph node selection

---
*Phase: 08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation*
*Completed: 2026-04-25*

## Self-Check: PASSED

- All created files verified on disk
- All task commits verified in git log (0d3ba1c, 8f1cdca)
