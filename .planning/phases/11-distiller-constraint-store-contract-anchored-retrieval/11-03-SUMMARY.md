---
phase: 11-distiller-constraint-store-contract-anchored-retrieval
plan: "03"
subsystem: retrieval
tags: [rust, retrieval, sqlite, fts5, rrf, llm-rerank, cousin-exclusion]
dependency_graph:
  requires:
    - "11-01: substrate_nodes table + SubstrateNode type"
    - "distiller/types.rs: SubstrateNode, SubstrateEdge"
  provides:
    - "retrieval/mod.rs: SubstrateHit + ScopeUsed exported for Plan 11-04"
    - "retrieval/scope.rs: lineage_scope_uuids() recursive CTE"
    - "retrieval/candidates.rs: candidate_selection() pub fn for Phase 9 reuse"
    - "retrieval/rerank.rs: llm_rerank() listwise LLM rerank"
    - "commands/retrieval.rs: find_substrate_for_atom private Tauri command"
  affects:
    - "Plan 11-04 (Delegate button) calls find_substrate_for_atom to populate composing overlay"
    - "Phase 9 mass-edit will reuse candidate_selection() pub fn (Open Question 4)"
tech_stack:
  added: []
  patterns:
    - "FTS5 + json_each(anchored_uuids) cousin-exclusion JOIN (ancestor lineage HARD filter)"
    - "RRF k=60 multi-source score combination"
    - "Listwise LLM rerank via claude -p --bare, defensive index parser (3-level fallback)"
    - "Zero-hit fallback: ScopeUsed::Broad when anchored JOIN returns <3 candidates"
    - "Canonical async pool extraction (pool key sqlite:contract-ide.db, drop read guard before .await)"
key_files:
  created:
    - contract-ide/src-tauri/src/retrieval/mod.rs
    - contract-ide/src-tauri/src/retrieval/scope.rs
    - contract-ide/src-tauri/src/retrieval/candidates.rs
    - contract-ide/src-tauri/src/retrieval/rerank.rs
    - contract-ide/src-tauri/src/commands/retrieval.rs
    - contract-ide/src-tauri/tests/retrieval_unit_tests.rs
  modified:
    - contract-ide/src-tauri/src/lib.rs
    - contract-ide/src-tauri/src/commands/mod.rs
    - contract-ide/src-tauri/src/distiller/pipeline.rs
decisions:
  - "Cousins excluded at SQL time via json_each(anchored_uuids) JOIN filter — not post-filter — per CONTEXT lock"
  - "RRF k=60 (industry standard per CONTEXT research); single FTS5 source for v1; embedding cosine path implemented but query_embedding=None for v1"
  - "contract_body truncated to 800 chars in rerank prompt (Pitfall 8) to prevent input window blow-up on long L0 rollup-stale contracts"
  - "tracing not in Cargo.toml — replaced tracing::warn! with eprintln! in both rerank.rs and pipeline.rs"
  - "All five retrieval unit tests pass; 66 pre-existing tests untouched"
metrics:
  duration: "13 minutes"
  completed: "2026-04-25"
  tasks_completed: 3
  files_created: 6
  files_modified: 3
---

# Phase 11 Plan 03: Contract-Anchored Retrieval Summary

Three-stage retrieval pipeline (lineage scope → FTS5 + cousin-exclusion JOIN → LLM listwise rerank) with five pure-logic unit tests verifying cousin exclusion on a 50-row substrate fixture.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Lineage scope walker + candidate selection (FTS5 + cousin-exclusion JOIN + RRF) | a367d38 |
| 2 | LLM rerank (listwise) + private find_substrate_for_atom Tauri command | 2bfb7f5 |
| 3 | Pure-logic unit tests (lineage walker, cousin-exclusion JOIN, RRF, defensive parser) | b79ca51 |

## What Was Built

**retrieval/scope.rs** — `lineage_scope_uuids(pool, scope_uuid)` uses a recursive CTE walking `parent_uuid` edges from the target atom up to L0, then UNIONs siblings (children of the same parent). Cousin exclusion is implicit: the sibling clause only joins on `s.parent_uuid = target.parent_uuid`, never on ancestor uuids. Cousins (children of ancestors other than the direct parent) never enter the result set.

**retrieval/candidates.rs** — `candidate_selection()` (exported as `pub fn` for Phase 9 reuse). FTS5 search on `substrate_nodes_fts` JOINed with `json_each(substrate_nodes.anchored_uuids) WHERE je.value IN (lineage_uuids)`. Cousin-anchored substrate rows are excluded at the SQL `EXISTS` predicate — before BM25 ranking. RRF k=60 merges FTS5 and optional embedding cosine scores. Zero-hit fallback: if the anchored JOIN returns <3 candidates, falls back to broad FTS5 over all current-truth substrate and sets `ScopeUsed::Broad`.

**retrieval/rerank.rs** — `llm_rerank()` issues a single `claude -p --bare` call with a listwise rerank prompt. Truncates `contract_body` to 800 chars (Pitfall 8). Defensive index parser handles: (1) raw JSON array, (2) code-fence-wrapped JSON, (3) bracket-extract from preamble. Backfills missing slots from original FTS5 order; falls back to FTS5 order on non-zero claude exit.

**retrieval/mod.rs** — `SubstrateHit` struct with `rubric_label` (60-char truncation of text) + `applies_when_truncated` (60-char truncation) + `scope_used: ScopeUsed`. `ScopeUsed` enum (`Lineage | Broad`) signals to Plan 11-04 overlay when the broad-search badge should fire.

**commands/retrieval.rs** — `find_substrate_for_atom` private Tauri command (NOT in MCP per CONTEXT lock). Composes scope → candidates (top-15) → optional LLM rerank. Uses canonical async pool extraction (pool key `sqlite:contract-ide.db`, drops read guard before `.await`). Registered in `lib.rs` handler list.

**tests/retrieval_unit_tests.rs** — 5 tests:
- `lineage_walker_returns_parent_ancestors_siblings_excludes_cousins` — 3-level fixture graph, asserts cousins absent
- `cousin_exclusion_join_excludes_cousins_at_candidate_selection` — 50-row substrate (5 cousin + 45 lineage), asserts cousin_count=0
- `lineage_walker_handles_l0_with_no_parent` — L0 root returns just self
- `defensive_index_parser_handles_code_fences_and_oob` — raw / code-fence / preamble / invalid / out-of-bounds
- `rrf_combines_two_sources_correctly` — two-source RRF merge with k=60 dedup check

## Verification Results

- `cargo build` — zero errors
- `cargo clippy -D warnings` — zero warnings (all-targets)
- `cargo test` — 5 new tests pass; 66 pre-existing tests untouched

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] clippy::manual_repeat_n in candidates.rs**
- **Found during:** Task 1 clippy run
- **Issue:** `std::iter::repeat("?").take(N)` pattern flagged by clippy as manual_repeat_n
- **Fix:** Replaced with `std::iter::repeat_n("?", N)` in two locations
- **Files modified:** `retrieval/candidates.rs`
- **Commit:** a367d38

**2. [Rule 1 - Bug] Missing `use tauri::Listener` in distiller/pipeline.rs**
- **Found during:** Task 3 test run (was blocking `cargo test` compilation)
- **Issue:** `app.listen(...)` call requires `tauri::Listener` trait in scope
- **Fix:** Added `Listener` to the `use tauri::{...}` import
- **Files modified:** `distiller/pipeline.rs`
- **Commit:** b79ca51

**3. [Rule 3 - Blocking] `tracing::warn!` in distiller/pipeline.rs (tracing not in Cargo.toml)**
- **Found during:** Task 3 test run (was blocking `cargo test` compilation)
- **Issue:** `tracing` crate not listed in Cargo.toml; identical pattern to rerank.rs fix
- **Fix:** Replaced with `eprintln!`
- **Files modified:** `distiller/pipeline.rs`
- **Commit:** b79ca51

**4. [Rule 1 - Bug] `tracing::warn!` in retrieval/rerank.rs (tracing not in Cargo.toml)**
- **Found during:** Task 2 build
- **Issue:** `tracing` crate not available; plan template included it
- **Fix:** Replaced with `eprintln!`
- **Files modified:** `retrieval/rerank.rs`
- **Commit:** 2bfb7f5

**Note on rerank.rs created in Task 1:** The plan separates Task 1 (scope + candidates) and Task 2 (rerank + command). However `retrieval/mod.rs` declares `pub mod rerank`, which requires the file to exist for compilation. A stub was created in Task 1 and completed in Task 2. This is a natural artifact of Rust module declaration semantics, not a deviation in substance.

## Self-Check: PASSED

All 6 created files exist on disk. All 3 task commits verified in git log (a367d38, 2bfb7f5, b79ca51).
