---
phase: 11-distiller-constraint-store-contract-anchored-retrieval
plan: "01"
subsystem: database
tags: [sqlite, sqlx, rust, migration, fts5, bitemporal, distiller, substrate]

requires:
  - phase: 10-session-watcher-filter-pipeline
    provides: episodes.filtered_text + episode_id stable PK + sessions.session_id (TEXT ref only — no FK due to Phase 10 shipping optionality)

provides:
  - substrate_nodes table: bitemporal quartet (valid_at/invalid_at/expired_at/created_at) + anchored_uuids + invalidated_by FK (Phase 12 forward-compat) + provenance columns
  - substrate_edges table: typed directed edges between substrate nodes
  - substrate_nodes_fts: FTS5 virtual table + AI/AU/AD sync triggers
  - substrate_embeddings: Float32 BLOB sibling table (384-dim AllMiniLM-L6-v2)
  - distiller_dead_letters: failed distiller run queue
  - distiller Rust module: mod.rs + state.rs (DistillerLocks) + types.rs (SubstrateNode/SubstrateEdge/NodeType/DistillerOutput/DeadLetter)
  - DistillerLocks managed in Tauri app state

affects:
  - phase 11-02 (pipeline.rs uses DistillerLocks + distiller::types)
  - phase 11-03 (retrieval uses SubstrateNode + anchored_uuids JOIN)
  - phase 12-01 (ALTER-adds intent_drift_* columns onto substrate_nodes)

tech-stack:
  added: []
  patterns:
    - "Dynamic migration versioning: max-existing + 1 (mirrors Phase 10)"
    - "DistillerLocks: DashMap<String, Arc<tokio::sync::Mutex<()>>> per-session mutex (mirrors Phase 7 DriftLocks)"
    - "Bitemporal schema: valid_at NOT NULL, invalid_at/expired_at NULLable, partial index WHERE invalid_at IS NULL"
    - "FTS5 content table with manual sync triggers (AI/AU/AD)"

key-files:
  created:
    - contract-ide/src-tauri/src/distiller/mod.rs
    - contract-ide/src-tauri/src/distiller/state.rs
    - contract-ide/src-tauri/src/distiller/types.rs
  modified:
    - contract-ide/src-tauri/src/db/migrations.rs
    - contract-ide/src-tauri/src/lib.rs
    - contract-ide/src-tauri/src/sidecar/frontmatter.rs
    - contract-ide/src-tauri/src/commands/mass_edit.rs
    - contract-ide/src-tauri/src/db/scanner.rs

key-decisions:
  - "anchored_uuids ships as TEXT NOT NULL DEFAULT '[]' on substrate_nodes — Phase 11-03 cousin-exclusion JOIN depends on it at candidate-selection time (CONTEXT lock)"
  - "Phase 12 schema coordination: intent_drift_* columns NOT pre-added; Phase 12-01 ALTER-adds them. SQLite ADD COLUMN IF NOT EXISTS unavailable, pre-adding breaks Phase 12"
  - "Phase 10 coordination: source_session_id is TEXT only (no FK to sessions) — Phase 10 may not have shipped when Phase 11 first runs"
  - "episode_id on substrate_nodes has no FK to episodes — same Phase 10 optionality reason"
  - "node_type stored as String on SubstrateNode (not enum) to match sqlx::FromRow TEXT column mapping; NodeType enum used for app-layer logic"

patterns-established:
  - "DistillerLocks mirrors DriftLocks verbatim: DashMap<String, Arc<Mutex<()>>> with entry().or_insert_with() clone pattern"
  - "Migration append-only: new entry at max(version) + 1, no edits to existing entries"

requirements-completed:
  - SUB-03

duration: 25min
completed: 2026-04-25
---

# Phase 11 Plan 01: Substrate Schema Migration + Distiller Module Skeleton Summary

**SQLite substrate schema (5 tables + FTS5 + bitemporal columns + anchored_uuids) and distiller Rust module skeleton (DistillerLocks + SubstrateNode/NodeType/DeadLetter types) wired into Tauri app state**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-25T09:05:08Z
- **Completed:** 2026-04-25T09:30:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Migration v6 (`phase11_substrate_schema`) appended to `get_migrations()` — substrate_nodes with full bitemporal quartet, anchored_uuids for cousin-exclusion, invalidated_by Phase 12 forward-compat FK, provenance columns, episode_id back-link
- FTS5 virtual table substrate_nodes_fts with AI/AU/AD content-table sync triggers; substrate_embeddings sibling table; distiller_dead_letters queue; partial index WHERE invalid_at IS NULL
- Phase 12 coordination enforced: intent_drift_* columns NOT pre-added; Phase 10 coordination enforced: no FK constraint on source_session_id or episode_id
- distiller Rust module created: state.rs (DistillerLocks per-session mutex), types.rs (SubstrateNode+SubstrateEdge+NodeType+Confidence+Actor+DistillerOutput+DistillerOutputNode+DeadLetter), registered in lib.rs
- cargo build + clippy -D warnings + cargo test (6 tests) all pass clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Add phase11_substrate_schema migration** - `d1ba20c` (feat)
2. **Task 2: Create distiller module skeleton and register in lib.rs** - `6749fda` (feat)

## Files Created/Modified
- `contract-ide/src-tauri/src/db/migrations.rs` - Phase 11 substrate schema migration (v6) appended
- `contract-ide/src-tauri/src/distiller/mod.rs` - Module root re-exporting state + types
- `contract-ide/src-tauri/src/distiller/state.rs` - DistillerLocks (DashMap per-session mutex)
- `contract-ide/src-tauri/src/distiller/types.rs` - SubstrateNode/SubstrateEdge/NodeType/Confidence/Actor/DistillerOutput/DistillerOutputNode/DeadLetter
- `contract-ide/src-tauri/src/lib.rs` - Registered pub mod distiller + DistillerLocks::default() managed state
- `contract-ide/src-tauri/src/sidecar/frontmatter.rs` - Auto-fixed invalid match guard (Rule 1)
- `contract-ide/src-tauri/src/commands/mass_edit.rs` - Auto-fixed clippy::type_complexity (Rule 1)
- `contract-ide/src-tauri/src/db/scanner.rs` - Auto-fixed redundant_closure (Rule 1)

## Decisions Made
- anchored_uuids ships as `TEXT NOT NULL DEFAULT '[]'` — CONTEXT lock authority: Phase 11-03 cousin-exclusion must happen BEFORE FTS5 ranking, at candidate-selection time, via `json_each(s.anchored_uuids)` JOIN
- node_type stored as `String` on SubstrateNode struct (not `NodeType` enum) — sqlx::FromRow maps TEXT column as String; app-layer code uses NodeType enum via NodeType::as_db_str()
- Phase 12 intent_drift_* columns deliberately NOT pre-added — SQLite lacks ADD COLUMN IF NOT EXISTS; pre-adding would break Phase 12's migration

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed invalid OR-pattern match guard in frontmatter.rs**
- **Found during:** Task 1 (migration build verification)
- **Issue:** `None | Some(v) if v.is_empty()` is invalid Rust — `v` is not bound in the `None` arm, producing E0408/E0004 compile errors
- **Fix:** Split into two separate match arms: `None =>` and `Some(v) if v.is_empty() =>`
- **Files modified:** contract-ide/src-tauri/src/sidecar/frontmatter.rs
- **Verification:** cargo build passes clean
- **Committed in:** d1ba20c (Task 1 commit)

**2. [Rule 1 - Bug] Fixed clippy::type_complexity in mass_edit.rs**
- **Found during:** Task 1 (clippy verification)
- **Issue:** Large tuple type `Vec<(String, String, String, String, String, i64, String, f64)>` triggers clippy::type_complexity with -D warnings
- **Fix:** Added `#[allow(clippy::type_complexity)]` at the binding site — tuple shape is locked to the sqlx query_as column list; refactoring to a named struct is Phase 9 follow-up work
- **Files modified:** contract-ide/src-tauri/src/commands/mass_edit.rs
- **Verification:** clippy passes clean
- **Committed in:** d1ba20c (Task 1 commit)

**3. [Rule 1 - Bug] Fixed clippy::redundant_closure in scanner.rs**
- **Found during:** Task 1 (clippy verification)
- **Issue:** `.map(|m| serde_json::to_string(m))` is a redundant closure — clippy suggests `.map(serde_json::to_string)`
- **Fix:** Replaced closure with direct function reference
- **Files modified:** contract-ide/src-tauri/src/db/scanner.rs
- **Verification:** clippy passes clean
- **Committed in:** d1ba20c (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (3x Rule 1 - pre-existing bugs in modified files blocking clippy -D warnings)
**Impact on plan:** All fixes necessary for clippy -D warnings compliance. All were in files already modified before this plan (per git status). No scope creep.

## Issues Encountered
None beyond the three auto-fixed pre-existing clippy/compile errors in already-modified files.

## Next Phase Readiness
- Plan 11-02 (distiller pipeline) can now compile against `crate::distiller::types::*` and `crate::distiller::state::DistillerLocks`
- Plan 11-03 (retrieval) can now reference SubstrateNode with anchored_uuids field
- Phase 12-01 (intent supersession) has forward-compat schema: substrate_nodes has the full bitemporal quartet + invalidated_by FK; Phase 12 adds intent_drift_* columns via ALTER TABLE ADD COLUMN

---
*Phase: 11-distiller-constraint-store-contract-anchored-retrieval*
*Completed: 2026-04-25*
