---
phase: 07-drift-detection-watcher-path
plan: "01"
subsystem: rust-drift-engine
tags: [rust, drift, watcher, notify, dashmap, tokio, sqlite]
dependency_graph:
  requires:
    - 06-02 (compute_code_hash helper, drift_state schema, DriftLocks pattern)
    - 01-02 (drift_state table schema in migration v1)
  provides:
    - drift::state::DriftLocks (per-UUID tokio::sync::Mutex via DashMap)
    - drift::watcher::SourceWatcher (notify::RecommendedWatcher wrapper + refresh API)
    - drift::engine::compute_and_emit (per-UUID drift computation + drift:changed emit)
  affects:
    - 07-02 (Tauri commands that call SourceWatcher::refresh and acknowledge_drift)
    - 07-03 (React drift:changed subscriber)
    - 07-04 (UAT: 2s red pulse + stress test)
    - 08 (PostToolUse hook reuses compute_and_emit directly)
tech_stack:
  added:
    - notify = 8.2.0 (FSEvents on macOS via macos_fsevent feature)
    - dashmap = 6.1.0 (concurrent per-UUID mutex map)
    - chrono = 0.4.44 (RFC3339 timestamps, re-added after Phase 6 pivot removal)
    - tokio = 1 sync feature (explicit direct dep — was transitive only, required for tokio::sync::Mutex)
  patterns:
    - DashMap<String, Arc<tokio::sync::Mutex<()>>> for per-key mutex (RESEARCH §Pattern 2)
    - notify::recommended_watcher with NonRecursive per-file watches (RESEARCH §Pattern 1)
    - Canonicalize both registration and event paths (Pitfall 3 defence)
    - Fire-and-forget via tauri::async_runtime::spawn (Tauri runtime ownership rule)
key_files:
  created:
    - contract-ide/src-tauri/src/drift/mod.rs
    - contract-ide/src-tauri/src/drift/state.rs
    - contract-ide/src-tauri/src/drift/engine.rs
    - contract-ide/src-tauri/src/drift/watcher.rs
  modified:
    - contract-ide/src-tauri/Cargo.toml (4 new deps: notify, dashmap, chrono, tokio sync)
    - contract-ide/src-tauri/src/lib.rs (pub mod drift; + 2 managed state registrations)
decisions:
  - tokio added as explicit direct dep (was transitive only via tauri; tokio::sync::Mutex requires it as a direct dep for the feature flag to activate)
  - Pure-logic unit test chosen over in-memory sqlite integration test for Task 2 (should_skip_write extracted as named helper; sqlx ON CONFLICT semantics validated by existing db module tests; keeping Task 2 under budget)
  - #[allow(unreachable_patterns)] on DbPool wildcard arm (only sqlite feature compiled; matches existing pattern in db/scanner.rs and commands/nodes.rs)
  - chrono re-added at 0.4 with serde feature; cargo tree | grep openssl stays empty
metrics:
  duration: ~5 minutes
  completed: 2026-04-24
  tasks_completed: 3
  files_changed: 6
---

# Phase 7 Plan 01: Drift Detection Rust Engine — Summary

**One-liner:** Rust `drift/` module with per-UUID `tokio::sync::Mutex` map (`DriftLocks`), `notify::RecommendedWatcher` source-file watcher (`SourceWatcher`), and per-UUID drift computation engine (`compute_and_emit`) wired into Tauri managed state.

## What Was Built

Three source files implement the Phase 7 Rust foundation:

**`drift/state.rs`** — `DriftLocks`: a `DashMap<String, Arc<tokio::sync::Mutex<()>>>` that lazily creates one `tokio::sync::Mutex` per node UUID on first access. SC 2's "no lost drift flags under 10-file concurrent stress" requirement depends on this — per-UUID serialization, not a single global mutex.

**`drift/engine.rs`** — `compute_and_emit(app, uuid)`: acquires the per-UUID mutex, queries `SELECT code_ranges, code_hash FROM nodes`, recomputes `code_hash` via the Phase 6 `commands::derive::compute_code_hash` helper, writes `drift_state` via ON CONFLICT DO UPDATE (drifted) or `UPDATE reconciled_at` (clean), emits camelCase `drift:changed` AFTER the DB write. Respects the `current_code_hash TEXT NOT NULL` constraint by skipping the write entirely when `current_hash` is `None` (empty ranges or unreadable files).

**`drift/watcher.rs`** — `SourceWatcher`: wraps `notify::RecommendedWatcher` with a `refresh(app, repo_path, nodes)` API that builds a canonicalized `HashMap<PathBuf, Vec<String>>` (path → uuids), filters `.contracts/` paths (Pitfall 9), watches each path with `RecursiveMode::NonRecursive`, and dispatches `Modify/Create/Remove` events to `compute_and_emit` via `tauri::async_runtime::spawn`.

Both `DriftLocks::default()` and `SourceWatcher::new()` are registered in Tauri managed state via `lib.rs`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added tokio as explicit direct dependency**
- **Found during:** Task 1 — `cargo build` failed with `use of unresolved module tokio`
- **Issue:** `tokio::sync::Mutex` in `state.rs` requires tokio as a direct dep. Although tokio v1.52.1 was present transitively (via tauri, reqwest, sqlx), it was not a direct dependency in `Cargo.toml`, and the `sync` feature was not guaranteed to be activated without explicit declaration.
- **Fix:** Added `tokio = { version = "1", features = ["sync"] }` to Cargo.toml
- **Files modified:** `contract-ide/src-tauri/Cargo.toml`
- **Commit:** ccb6d94

**2. [Rule 1 - Bug] Fixed unreachable_patterns clippy error in engine.rs**
- **Found during:** Task 2 — `cargo clippy -- -D warnings` failed
- **Issue:** `DbPool::Sqlite(p) => p, _ => return` — with only the sqlite feature compiled, the `_` arm is unreachable and clippy `-D warnings` promotes the warning to error.
- **Fix:** Added `#[allow(unreachable_patterns)]` on the wildcard arm, matching the existing pattern in `db/scanner.rs` and `commands/nodes.rs`
- **Files modified:** `contract-ide/src-tauri/src/drift/engine.rs`
- **Commit:** 64b50c2

## Test Choices (Task 2)

Chose the **pure-logic helper test** (`should_skip_write`) over the in-memory sqlite integration test.

Rationale: (1) Extracting `should_skip_write(&Option<String>) -> bool` makes the NOT NULL constraint explicit and directly testable without any DB setup. (2) The sqlx `ON CONFLICT DO UPDATE` clause is validated by the existing `db` module integration tests and the 07-04 UAT. (3) The in-memory test would require setting up sqlx in test context with async runtime — would balloon past 40 lines. Three pure-logic tests shipped: `skip_write_when_current_hash_is_none`, `no_skip_when_current_hash_is_some`, `empty_string_hash_is_not_none_does_not_skip`.

## chrono Re-add Verification

`cargo tree | grep openssl` produces no output — chrono 0.4 with `features = ["serde"]` does not pull native-tls. Safe to use.

## Exported Symbols for Plans 07-02/03/04

Plans 07-02 through 07-04 depend on these exported symbols:
- `drift::state::DriftLocks` — managed state, accessed via `app.state::<DriftLocks>()`
- `drift::watcher::SourceWatcher` — managed state, call `watcher.refresh(app, repo_path, pairs)` from `open_repo` and `refresh_nodes`
- `drift::engine::compute_and_emit(app: AppHandle, uuid: &str)` — async fn, call via `tauri::async_runtime::spawn`

## Verification Results

All success criteria met:

- `cargo build` green
- `cargo clippy -- -D warnings` clean (whole crate)
- `cargo test` 11/11 pass (8 pre-existing + 3 new engine tests)
- `cargo tree | grep notify` → `notify v8.2.0`
- `cargo tree | grep dashmap` → `dashmap v6.1.0`
- `cargo tree | grep chrono` → `chrono v0.4.44`
- `cargo tree | grep openssl` → empty
- `DriftLocks` and `SourceWatcher` registered in `lib.rs` managed state
- `compute_and_emit` uses `tokio::sync::Mutex` across `.await` points (NOT `std::sync::Mutex`)
- `drift:changed` emitted after DB write with camelCase payload
- `.contracts/` path filter present in `watcher.rs` (Pitfall 9)
- `canonicalize` on both registration and event paths (Pitfall 3)
- `Modify + Create + Remove` events accepted (Pitfall 4)

## Self-Check: PASSED

Files confirmed to exist:
- contract-ide/src-tauri/src/drift/mod.rs
- contract-ide/src-tauri/src/drift/state.rs
- contract-ide/src-tauri/src/drift/engine.rs
- contract-ide/src-tauri/src/drift/watcher.rs

Commits confirmed:
- ccb6d94 (Task 1: deps + skeleton)
- 64b50c2 (Task 2: engine.rs)
- b8f4ec1 (Task 3: watcher.rs + lib.rs)
