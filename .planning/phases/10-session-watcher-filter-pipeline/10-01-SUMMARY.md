---
phase: 10-session-watcher-filter-pipeline
plan: 01
subsystem: substrate
tags: [sqlite, sqlx, dashmap, tokio, tauri, sessions, episodes, jsonl, ambient-ingestion]

# Dependency graph
requires:
  - phase: 08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation
    provides: "v3 migration phase8_propagation_and_receipts present in get_migrations() — Phase 10 v4 appended after, ordering preserved"
  - phase: 07-drift-detection-watcher-path
    provides: "drift::state::DriftLocks pattern (DashMap<String, Arc<tokio::sync::Mutex>>) — mirrored verbatim by SessionLocks; co-registered in lib.rs managed state"
provides:
  - "Migration v4 phase10_sessions_and_episodes — sessions + episodes tables + 4 indexes"
  - "session/ Rust module: state (SessionLocks), types (FilteredTurn, Episode, SessionRow, BackfillPreview), cwd_key (derive_cwd_key, claude_projects_dir)"
  - "Empty stubs ingestor.rs + watcher.rs ready for 10-02 / 10-03 to fill without re-touching mod.rs"
  - "SessionLocks registered in Tauri managed state (.manage(crate::session::state::SessionLocks::default()))"
  - "5-test cwd_key suite locks slash→hyphen rule against the four research-validated path shapes"
affects:
  - "10-02 (ingestor: filter_session_lines, chunk_episodes, ingest_session_file)"
  - "10-03 (watcher: SessionWatcher + Tauri commands list_ingested_sessions, get_backfill_preview, execute_backfill)"
  - "10-04 (UI + UAT)"
  - "Phase 11 distiller (consumes episodes table; content_hash enables change detection)"

# Tech tracking
tech-stack:
  added: []  # No new deps — dashmap v6, tokio (sync feature), sha2 all reused from prior phases
  patterns:
    - "Per-session tokio mutex map mirrors Phase 7 DriftLocks verbatim — guard held across .await DB queries"
    - "Pure helper extraction for cross-call-site invariants — derive_cwd_key is the single source of truth for the four call sites in 10-03"
    - "Stub-then-fill pattern for parallel plans — ingestor.rs + watcher.rs land as documented stubs in 10-01 so 10-02 / 10-03 can fill without re-touching mod.rs"
    - "Forward-looking #[allow(dead_code)] with TODO(Plan N) markers — annotated on every uncalled symbol with the consuming plan number"

key-files:
  created:
    - "contract-ide/src-tauri/src/session/mod.rs (module surface declaration)"
    - "contract-ide/src-tauri/src/session/state.rs (SessionLocks)"
    - "contract-ide/src-tauri/src/session/types.rs (FilteredTurn, Episode, SessionRow, BackfillPreview)"
    - "contract-ide/src-tauri/src/session/cwd_key.rs (derive_cwd_key, claude_projects_dir, 5 unit tests)"
    - "contract-ide/src-tauri/src/session/ingestor.rs (stub, 10-02 fills)"
    - "contract-ide/src-tauri/src/session/watcher.rs (stub, 10-03 fills)"
  modified:
    - "contract-ide/src-tauri/src/db/migrations.rs (appended v4)"
    - "contract-ide/src-tauri/src/lib.rs (pub mod session + .manage(SessionLocks::default()))"

key-decisions:
  - "Migration v4 appended after Phase 8 v3 — pre-flight check confirmed state 1 (v1+v2+v3 all present); zero contention with future Phase 8 boxes that re-apply v3 first"
  - "session::state::SessionLocks structurally identical to drift::state::DriftLocks — same DashMap<String, Arc<tokio::sync::Mutex<()>>> shape, only the key changes (session_id vs uuid). Phase 8 hook + Phase 10 ingest co-exist as siblings, both serialising via per-key tokio mutex"
  - "derive_cwd_key extracted as pure helper before any caller exists — prevents the 'four call sites diverge' bug class flagged in Phase 10 RESEARCH (Pitfall 1: watch wrong dir)"
  - "Empty ingestor.rs / watcher.rs stubs land here so 10-02 + 10-03 can be authored without re-touching mod.rs — keeps plan boundaries strict on file-modified surface"
  - "#[allow(dead_code)] annotations are explicit and TODO-marked with the consuming plan number — eliminates clippy noise without hiding genuine dead code"

patterns-established:
  - "Phase 10 sub-system module layout (mirrors crate::drift): mod / state / types / pure-helper / consumer-1 / consumer-2"
  - "Pre-flight migration ordering check before appending — `grep -nE 'version: [0-9]'` must show contiguous ascending versions"
  - "Forward-declared module surface in mod.rs with stub bodies enables parallel plan execution"

requirements-completed: []  # See "Requirements status" below — plan frontmatter listed [SUB-01, SUB-02], but the user-facing requirement statements include watcher behavior (10-03) and filter pipeline (10-02) which this plan does NOT deliver. Marked as "In Progress" in REQUIREMENTS.md instead — surfaced to user rather than absorbed.
requirements-progressed: [SUB-01, SUB-02]  # Schema and idempotency primitive landed; full requirement closes in 10-02 / 10-03

# Metrics
duration: ~4min
completed: 2026-04-25
---

# Phase 10 Plan 01: Foundation — Migration v4 + session/ Module Scaffold + cwd_key Helper Summary

**SQLite migration v4 (sessions + episodes) + Rust `session/` module skeleton with SessionLocks (DashMap-backed per-session mutex), shared row types, and the slash-to-hyphen cwd_key helper — zero new deps, zero Claude API calls, scaffold-only.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-25T07:25:46Z
- **Completed:** 2026-04-25T07:30:10Z
- **Tasks:** 2
- **Files modified:** 8 (2 modified, 6 created)

## Accomplishments

- Migration v4 `phase10_sessions_and_episodes` appended to `get_migrations()` Vec — `sessions` (11 cols) + `episodes` (8 cols) + 4 indexes; v1/v2/v3 untouched per immutability rule
- `session/` module skeleton lands as a structural mirror of `drift/` — same shape, parallel ownership of per-key tokio mutexes
- `derive_cwd_key` pure helper + 5-test suite locks the slash→hyphen rule (single source of truth for the four 10-03 call sites)
- `SessionLocks` registered in Tauri managed state alongside `DriftLocks` (Phase 7) — Phase 8 hook + Phase 10 ingest will share the runtime cleanly

## Task Commits

1. **Task 1: Add migration v4 (sessions + episodes) to db/migrations.rs** — `0035334` (feat)
2. **Task 2: Create session/ module skeleton + register SessionLocks** — `eb2f36e` (feat)

**Plan metadata commit:** _appended below at completion._

## Files Created/Modified

**Created:**
- `contract-ide/src-tauri/src/session/mod.rs` — module surface (5 sub-modules declared)
- `contract-ide/src-tauri/src/session/state.rs` — `SessionLocks(pub DashMap<String, Arc<tokio::sync::Mutex<()>>>)` + `for_session(id)` accessor
- `contract-ide/src-tauri/src/session/types.rs` — `FilteredTurn`, `Episode`, `SessionRow`, `BackfillPreview` (camelCase Serde for FE-bound types)
- `contract-ide/src-tauri/src/session/cwd_key.rs` — `derive_cwd_key(&Path) -> String` + `claude_projects_dir() -> Result<PathBuf, String>` + 5 unit tests
- `contract-ide/src-tauri/src/session/ingestor.rs` — stub with TODO comments (10-02 fills)
- `contract-ide/src-tauri/src/session/watcher.rs` — stub with TODO comments (10-03 fills)

**Modified:**
- `contract-ide/src-tauri/src/db/migrations.rs` — appended migration v4 (`phase10_sessions_and_episodes`); v1/v2/v3 untouched
- `contract-ide/src-tauri/src/lib.rs` — `pub mod session;` + `.manage(crate::session::state::SessionLocks::default())`

## Decisions Made

- **Phase 8 v3 pre-flight: state 1 confirmed.** `migrations.rs` contained v1, v2, v3 at execution start (`grep -nE 'version: [0-9]'` returned three rows, in order). Appending v4 was safe; no hard-gate STOP needed.
- **Migration v4 already applied to dev DB at execution time.** `_sqlx_migrations` row 4 (`phase10_sessions_and_episodes`) was present and `sessions`/`episodes` tables already existed before this plan ran — confirms a prior `cargo build` or app launch had picked up the in-flight diff. PRAGMA `table_info` matched the spec exactly: 11 sessions cols + 8 episodes cols + all 4 indexes. No re-run of `tauri dev` was necessary; verification gates passed against the live DB.
- **`SessionLocks` mirrors `DriftLocks` 1:1.** Same `DashMap<String, Arc<tokio::sync::Mutex<()>>>` shape, same `entry().or_insert_with().clone()` accessor. Two Locks types co-registered in `lib.rs` `.manage()` chain — Phase 8 hook (UUID-keyed) + Phase 10 ingest (session-id-keyed) will not collide because they hash distinct key spaces.
- **`#[allow(dead_code)]` placement was per-symbol, not blanket.** Each annotation carries an explicit `TODO(Plan N)` comment naming the plan that will remove it. Future grep `rg "TODO\(Plan 10-0[23]\)"` enumerates the cleanup queue precisely.
- **No new Cargo.toml additions.** `dashmap v6`, `tokio` (sync feature already on from Phase 7), `sha2`, and `notify v8` all already present. Confirmed via `cargo tree`.
- **Zero Claude API surface.** `grep -rEn "reqwest|Anthropic|anthropic|claude\\.com"` over `session/` and `db/migrations.rs` returns no matches.

## Requirements Status

The plan frontmatter listed `requirements: [SUB-01, SUB-02]`. Both REQUIREMENTS.md statements have user-facing scope larger than this plan's schema-only deliverable:

- **SUB-01** says "Ambient session watcher detects new files within 2s..." — the watcher (`SessionWatcher::watch_project`) is Plan 10-03, not 10-01. This plan landed the `sessions` table only.
- **SUB-02** says "Filter pipeline reduces 1MB → <50KB...idempotent across re-ingestion...backfill shows preview" — the filter pipeline is Plan 10-02; the backfill preview is Plan 10-03. This plan landed the `episodes` table with `episode_id` PK (the idempotency primitive) only.

Per the project's CONTEXT.md authority rule (planner deviations from CONTEXT.md must surface to Yang, not be absorbed via REQUIREMENTS.md edits), I did NOT mark the requirements complete. They are annotated as "In Progress (10-01: schema landed)" and "In Progress (10-01: idempotency primitive landed)" in REQUIREMENTS.md, with progress notes pointing at the partial-fulfillment scope. They will close completely when 10-02 + 10-03 land their respective surfaces.

## Confirmed Exported Symbols (consumer hand-off)

10-02 / 10-03 will consume:
- `session::state::SessionLocks` (registered in managed state — accessible via `app.state::<SessionLocks>()`)
- `session::types::{FilteredTurn, Episode, SessionRow, BackfillPreview}` (all `Serialize + Deserialize`; FE-bound types use `#[serde(rename_all = "camelCase")]`)
- `session::cwd_key::{derive_cwd_key, claude_projects_dir}`

## `#[allow(dead_code)]` Annotations (cleanup queue)

| Symbol | Annotated in | Removed by |
| --- | --- | --- |
| `SessionLocks::for_session` | `session/state.rs` | Plan 10-02 / 10-03 (first caller wins) |
| `FilteredTurn`, `Episode` | `session/types.rs` | Plan 10-02 (ingestor produces / persists) |
| `SessionRow`, `BackfillPreview` | `session/types.rs` | Plan 10-03 (commands consume) |
| `derive_cwd_key`, `claude_projects_dir` | `session/cwd_key.rs` | Plan 10-03 (watcher + commands) |

## Deviations from Plan

None — plan executed exactly as written.

The plan anticipated three pre-flight states (v3 shipped / v3 missing / unexpected chain) and landed cleanly in state 1. The `npm run tauri dev` step was effectively redundant: the migration was already applied to the dev DB from a prior session at execution time, and all verification gates (`PRAGMA table_info`, `_sqlx_migrations` row count, index list) returned the expected schema without a re-launch. Documented as a decision rather than a deviation since the plan's verify clause explicitly accepts pre-applied state ("After running `npm run tauri dev` once" is a one-time setup, not a re-run requirement).

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Ready for 10-02 (ingestor):**
- `Episode` + `FilteredTurn` types in place
- `episodes` table with `episode_id` PK + `INSERT OR IGNORE` idempotency primitive ready
- `SessionLocks::for_session(session_id)` available for serialising ingest writes per session
- `sha2` crate already in dep tree (used by 06 + 08-01); 10-02 reuses for `episode_id = sha256(session_id + ":" + start_line)`

**Ready for 10-03 (watcher + commands):**
- `derive_cwd_key` + `claude_projects_dir` lock the path-resolution rule
- `SessionRow` + `BackfillPreview` row types ready for command surface
- `notify v8` already present (Phase 7 dep); no Cargo.toml change needed
- `watcher.rs` stub structured to receive `SessionWatcher { inner: std::sync::Mutex<Option<RecommendedWatcher>> }` per the in-file TODO

**Verification confidence:**
- All 38 unit tests + 36 integration tests green; clippy `-D warnings` clean
- Schema verified via live `PRAGMA table_info` against dev DB — column types, defaults, CHECK constraint all match plan spec
- Zero new Cargo.toml deps — keeps dependency surface unchanged for 10-02 / 10-03 / 10-04

## Self-Check: PASSED

**Files exist:**
- FOUND: `contract-ide/src-tauri/src/session/mod.rs`
- FOUND: `contract-ide/src-tauri/src/session/state.rs`
- FOUND: `contract-ide/src-tauri/src/session/types.rs`
- FOUND: `contract-ide/src-tauri/src/session/cwd_key.rs`
- FOUND: `contract-ide/src-tauri/src/session/ingestor.rs`
- FOUND: `contract-ide/src-tauri/src/session/watcher.rs`

**Commits exist:**
- FOUND: `0035334` (Task 1 — migration v4)
- FOUND: `eb2f36e` (Task 2 — session module scaffold)

---
*Phase: 10-session-watcher-filter-pipeline*
*Completed: 2026-04-25*
