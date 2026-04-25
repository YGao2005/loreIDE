---
phase: 07-drift-detection-watcher-path
plan: "02"
subsystem: rust-drift-commands
tags: [rust, drift, tauri, sqlite, sqlx, notify, watcher, chrono]
dependency_graph:
  requires:
    - 07-01 (DriftLocks, SourceWatcher, compute_and_emit in managed state)
    - 02-03 (refresh_nodes command, RepoState managed state)
  provides:
    - commands::drift::refresh_source_watcher_from_db (reusable helper, reads nodes from DB, calls SourceWatcher::refresh)
    - commands::drift::acknowledge_drift (Tauri command: per-UUID mutex, UPDATE reconciled_at, emit drift:changed)
    - open_repo now calls refresh_source_watcher_from_db after scan_contracts_dir awaits
    - refresh_nodes now calls refresh_source_watcher_from_db after upserts, with DbInstances lock released first
  affects:
    - 07-03 (React drift:changed subscriber — backend now running and emitting)
    - 07-04 (UAT: 2s red pulse; acknowledge_drift is the "mark acknowledged" third path)
    - 08 (PostToolUse hook can reuse same compute_and_emit path)
tech_stack:
  added: []
  patterns:
    - DbInstances read lock scoped to inner block and dropped before any .await that re-acquires the same lock (prevents deadlock in refresh_nodes)
    - RepoState fetched via app.state::<RepoState>() inside refresh_nodes body (Option A — no signature change)
    - std::sync::MutexGuard scoped to inner block before .await on async fn (clippy -D warnings compliance)
    - acknowledge_drift acquires per-UUID tokio::sync::Mutex before DB work (prevents race with watcher re-flagging)
key_files:
  created:
    - contract-ide/src-tauri/src/commands/drift.rs
  modified:
    - contract-ide/src-tauri/src/commands/mod.rs (pub mod drift added)
    - contract-ide/src-tauri/src/commands/repo.rs (open_repo + refresh_nodes wired)
    - contract-ide/src-tauri/src/lib.rs (acknowledge_drift in generate_handler!)
key-decisions:
  - "refresh_nodes drops DbInstances read lock (explicit inner block scope) before calling refresh_source_watcher_from_db — same lock would deadlock without this"
  - "Option A for refresh_nodes repo path (no signature change): fetch RepoState via app.state::<RepoState>() inline, guard scoped before .await"
  - "Delete-event TODO (refresh_nodes skips non-existent paths) punted to 07-04 UAT — DRIFT-01 core case (edit a file) does not depend on delete handling"
  - "Tasks 1 and 2 committed together (73b8973) because Task 1 alone causes clippy -D warnings dead_code error; call sites in Task 2 resolve it naturally"
  - "acknowledge_drift payload matches DriftChanged camelCase shape: { uuid, drifted, currentCodeHash, baselineCodeHash } — React uses one handler for both paths"
requirements-completed:
  - DRIFT-01
  - DRIFT-02
duration: ~3min
completed: 2026-04-24
---

# Phase 7 Plan 02: Drift Command Wiring — Summary

**`commands/drift.rs` with `acknowledge_drift` Tauri command and `refresh_source_watcher_from_db` helper wired into `open_repo` and `refresh_nodes`, turning the Phase 7-01 drift engine on.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-24T01:02:48Z
- **Completed:** 2026-04-24T01:06:00Z
- **Tasks:** 2 (committed together as 73b8973)
- **Files modified:** 4 + 1 created

## Accomplishments

- `commands/drift.rs` created with `refresh_source_watcher_from_db` (reads full node set from SQLite, calls `SourceWatcher::refresh`) and `acknowledge_drift` Tauri command (per-UUID mutex, `UPDATE drift_state SET reconciled_at`, camelCase `drift:changed` emit)
- `open_repo` now calls `refresh_source_watcher_from_db` after `scan_contracts_dir` awaits — watcher is live before the frontend's next action
- `refresh_nodes` restructured to scope the `DbInstances` read lock to an inner block, drops before calling `refresh_source_watcher_from_db` (prevents deadlock on re-acquisition)
- `lib.rs` `generate_handler!` extended with `commands::drift::acknowledge_drift` fully-qualified

## Task Commits

Tasks committed together (Task 1 alone causes clippy dead_code error until Task 2's call sites exist):

1. **Task 1: Create commands/drift.rs** + **Task 2: Wire SourceWatcher into open_repo/refresh_nodes** - `73b8973` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `contract-ide/src-tauri/src/commands/drift.rs` — `refresh_source_watcher_from_db` helper + `acknowledge_drift` Tauri command
- `contract-ide/src-tauri/src/commands/mod.rs` — `pub mod drift;` added alphabetically after `pub mod derive;`
- `contract-ide/src-tauri/src/commands/repo.rs` — `open_repo` and `refresh_nodes` call watcher refresh after DB writes
- `contract-ide/src-tauri/src/lib.rs` — `commands::drift::acknowledge_drift` in `generate_handler!`
- `contract-ide/src-tauri/Cargo.lock` — updated (Plan 07-01 deps reflected)

## Decisions Made

- **Lock scope in `refresh_nodes`:** The existing code held the `DbInstances` read lock (`db_map`) for the entire function body. `refresh_source_watcher_from_db` also acquires a `DbInstances` read lock (two readers = fine for `RwLock`), but the crucial insight is that `drop(map)` inside the helper releases that inner lock before notify setup. The outer `db_map` in `refresh_nodes` needed an inner block to scope it before the `.await` on `refresh_source_watcher_from_db` — otherwise clippy flags `std::sync::MutexGuard` across `.await`. Resolved with `{ let instances = ...; let db_map = ...; /* loop */ } // db_map drops here`.

- **Option A for repo path in `refresh_nodes`:** No signature change. `app.state::<RepoState>()` fetched inline, `std::sync::MutexGuard` scoped to inner block before `.await`. Consistent with existing `app.state::<DbInstances>()` pattern in the same function.

- **Tasks 1 + 2 committed together:** Task 1 alone (`commands/drift.rs` created, not called) triggers clippy `-D warnings` error: `function refresh_source_watcher_from_db is never used`. Task 2 wires the call sites — together they are one coherent, clean unit.

- **Delete-event TODO punted to 07-04 UAT:** Plan 02-03 left `refresh_nodes` with `TODO(Phase 7): propagate deletes`. The plan asked us to either fix or defer. Distinguishing sidecar-file-deleted vs source-file-deleted requires more surface area than DRIFT-01 needs. Deferred with an explicit comment in `repo.rs`. The `drift_state` delete cleanup can land in 07-04 UAT if needed.

## Deviations from Plan

None — plan executed exactly as written. The DbInstances lock-scope restructure in `refresh_nodes` is what the plan prescribed (Option A, inner block), not a deviation.

## Issues Encountered

None. Build, clippy, and all 11 tests green on first pass.

## Phase 7-02 Output Answers (per plan `<output>` spec)

**Delete-event TODO:** Punted to 07-04 UAT with explicit comment in `repo.rs`. DRIFT-01 success criterion (editing a file produces drift:changed within ~2s) does not depend on delete handling.

**acknowledge_drift payload shape:** `{ uuid, drifted: false, currentCodeHash: null, baselineCodeHash: null }` — matches `drift::engine::DriftChanged` camelCase shape exactly. React can use one `drift:changed` handler for both watcher events (from `compute_and_emit`) and acknowledge events.

**DbInstances lock ordering:** No deadlock encountered. `refresh_source_watcher_from_db` acquires its own read lock, builds the pairs, drops the lock (`drop(map)`) before calling `watcher.refresh`. In `refresh_nodes`, the outer `db_map` read lock is now scoped to an inner block that completes before the `.await` on `refresh_source_watcher_from_db`. Two independent read-lock acquire/release pairs — no contention.

**Plan 07-03 readiness:** `drift:changed` events will flow from a running build. `open_repo` registers the watcher immediately after scan; `refresh_nodes` re-registers after every sidecar write. The React store (`subscribeDriftEvents`) can subscribe to these events in 07-03.

## Next Phase Readiness

- Plan 07-03 (React drift:changed subscriber) can proceed — backend is live, watcher registers on `open_repo`, `acknowledge_drift` command is exposed.
- Plan 07-04 (UAT) can exercise the full flow: open repo → edit source → red pulse → click acknowledge → pulse clears.
- Phase 8 (PostToolUse hook) can call `drift::engine::compute_and_emit(app, uuid)` directly to benefit from the same per-UUID mutex.

---
*Phase: 07-drift-detection-watcher-path*
*Completed: 2026-04-24*
