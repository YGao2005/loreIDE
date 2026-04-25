---
phase: 12-conflict-supersession-engine
plan: 01
subsystem: database
tags: [sqlite, sqlx, supersession, bitemporal, graphiti, migration, rust]

# Dependency graph
requires:
  - phase: 11-distiller-constraint-store-contract-anchored-retrieval
    provides: substrate_nodes table, substrate_edges table, partial active index, valid_at index, invalidated_by self-FK (Migration v6)
  - phase: 09-mass-edit-non-coder-mode-demo-repo-seeding
    provides: Migration v5 (FLOW-01 members_json) — informed v7 version selection
provides:
  - Migration v7 (phase12_supersession_layer) — intent_drift_* columns on substrate_nodes + priority_shifts table + intent_drift_verdicts table + composite edge-type lookup index
  - supersession::types Rust module — Verdict enum (3-way), ParsedVerdict, SubstrateNode (sqlx::FromRow), DescendantNode, IntentDriftResult
  - REQUIREMENTS.md canonical SUB-06 + SUB-07 entries under "Conflict / Supersession Engine (Phase 12)" subsection (transcribed from 12-RESEARCH.md, no invention)
affects: [12-02-fact-engine, 12-03-intent-engine, 12-04-adversarial-harness, 13-substrate-ui-demo-polish]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Phase 12 migration layered atop Phase 11 via ALTER TABLE ADD COLUMN — strict additive policy; never overwrite an existing migration"
    - "Verdict enum uses serde rename SCREAMING_SNAKE_CASE so the Rust value matches the SQLite CHECK constraint string verbatim"
    - "supersession::types is the SINGLE shared-types module for all four 12-NN plans — every downstream import is `use crate::supersession::types::{...}`"

key-files:
  created:
    - contract-ide/src-tauri/src/supersession/mod.rs
    - contract-ide/src-tauri/src/supersession/types.rs
  modified:
    - .planning/REQUIREMENTS.md
    - contract-ide/src-tauri/src/db/migrations.rs
    - contract-ide/src-tauri/src/lib.rs

key-decisions:
  - "Migration version v7 (not v5 as plan called for) — v5 is taken by Phase 9 FLOW-01, v6 is taken by Phase 11 substrate schema; the plan's coordination comment explicitly anticipated this race"
  - "ALTER TABLE ADD COLUMN strategy (not CREATE TABLE IF NOT EXISTS) — Phase 11 v6 already shipped substrate_nodes/edges + the partial active index + invalidated_by self-FK; v7 only ADDs the intent_drift_* columns + new tables"
  - "Composite edge-type index named idx_substrate_edges_type_lookup (suffix _lookup) to avoid collision with Phase 11 v6's idx_substrate_edges_type"
  - "Stub-form SUB-06/SUB-07 one-liners in the existing Substrate (Phases 10–13) subsection were COLLAPSED into the new canonical detailed entries under the new Conflict / Supersession Engine subsection — no double-entry; one canonical entry per requirement"
  - "Coverage stat 70 total preserved (not decremented to 48 as plan suggested) — total stays at 70 because we collapsed duplicate stubs into canonical entries (no net count change)"

patterns-established:
  - "Pattern: Phase-12 enum-to-DB-string round-trip — Verdict::as_db_str() / from_db_str() pair lives next to the enum, returns Option, and is unit-tested for round-trip identity"
  - "Pattern: Cross-phase migration coordination — Phase 12 layered atop Phase 11 by querying live schema with `sqlite3 contract-ide.db PRAGMA table_info(substrate_nodes)` to confirm what columns Phase 11 ACTUALLY shipped before drafting v7"
  - "Pattern: SCREAMING_SNAKE_CASE serde rename + CHECK constraint match — the Verdict enum serializes EXACTLY as the SQLite CHECK constraint string list, so we never need a separate from_serde-string conversion at the DB boundary"

requirements-completed: []  # SUB-06 + SUB-07 require fact engine (12-02) and intent engine (12-03) to close — 12-01 only landed schema + types foundation. Documented as in-progress in REQUIREMENTS.md status notes.

# Metrics
duration: 5min
completed: 2026-04-25
---

# Phase 12 Plan 01: Conflict / Supersession Engine Foundation Summary

**Migration v7 (intent_drift_* columns on substrate_nodes + priority_shifts log + intent_drift_verdicts audit trail) + supersession::types Rust module exporting Verdict / ParsedVerdict / SubstrateNode / DescendantNode / IntentDriftResult — the load-bearing schema and shared types that 12-02 + 12-03 + 12-04 import from.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-25T19:42:36Z
- **Completed:** 2026-04-25T19:47:52Z
- **Tasks:** 2 of 2
- **Files modified:** 5 (3 modified, 2 created)
- **Tests:** 71 / 71 passing (3 new in supersession::types)
- **Commits:** 2 task commits + 1 final docs commit

## Accomplishments

- **REQUIREMENTS.md transcription** — added new subsection `### Conflict / Supersession Engine (Phase 12 — see ...)` between PROP-04 and NONC-01 with canonical detailed entries for SUB-06 (fact-level supersession via Graphiti pattern) and SUB-07 (intent-level supersession, the moat). Codified verbatim from 12-RESEARCH.md table 14–17 and ROADMAP Phase 12 success criteria 1–4. No requirements invented; transcription only. Stub-form one-liners that were placeholders in the Substrate (Phases 10–13) subsection were collapsed into the new canonical entries.

- **Migration v7 (phase12_supersession_layer)** — adds (a) five intent_drift_* columns on `substrate_nodes` via `ALTER TABLE ADD COLUMN` (`intent_drift_state`, `intent_drift_confidence`, `intent_drift_reasoning`, `intent_drift_judged_at`, `intent_drift_judged_against`); (b) `priority_shifts` table for L0 priority-shift event log (id / old_l0_uuid / new_l0_uuid / valid_at / summary_of_old / summary_of_new / applied_at / created_at); (c) `intent_drift_verdicts` audit-trail table with CHECK constraints on the 3-value verdict enum and confidence ∈ [0.0, 1.0]; (d) composite edge-type lookup index `idx_substrate_edges_type_lookup` for 12-04's history-query UNION; (e) two indexes on `intent_drift_verdicts(node_uuid)` and `(priority_shift_id)`.

- **`supersession::types` Rust module** — `Verdict` enum (Drifted / NotDrifted / NeedsHumanReview) with `as_db_str()` / `from_db_str()` round-trip + serde `SCREAMING_SNAKE_CASE` rename; `ParsedVerdict` (id / verdict / reasoning / confidence) for per-decision LLM batch parsing; `SubstrateNode` (sqlx::FromRow) for Phase 11 (v6) + Phase 12 (v7) row reads; `DescendantNode` (anchor_contract_uuid + depth) for the intent_engine walker output; `IntentDriftResult` (judged / drifted / surfaced / filtered) for `propagate_intent_drift` aggregate output. 3 inline unit tests cover round-trip, unknown-string rejection, and JSON serialization shape.

- **Live schema verification** — applied v7 migration confirmed against the dev SQLite DB (`~/Library/Application Support/com.contract-ide.app/contract-ide.db`): all 4 expected tables present (substrate_nodes, substrate_edges, priority_shifts, intent_drift_verdicts), all 5 expected indexes present, all 5 intent_drift_* columns visible on substrate_nodes via `PRAGMA table_info`. Both CHECK constraints (verdict enum + confidence range) reject malformed inserts.

## Task Commits

1. **Task 1: Transcribe SUB-06 and SUB-07 into REQUIREMENTS.md** — `59fbb4b` (docs)
2. **Task 2: Migration v7 supersession_layer + supersession::types module** — `0a92a68` (feat)

**Plan metadata commit:** to follow

## Files Created/Modified

- `.planning/REQUIREMENTS.md` — added new "Conflict / Supersession Engine (Phase 12)" subsection with canonical SUB-06 + SUB-07 entries; collapsed stub one-liners from Substrate (Phases 10–13) section to avoid double-entry; updated Last-updated footer with transcription rationale
- `contract-ide/src-tauri/src/db/migrations.rs` — appended Migration v7 (phase12_supersession_layer) — ALTER TABLE additions to substrate_nodes + new priority_shifts + intent_drift_verdicts tables + composite edge-type index
- `contract-ide/src-tauri/src/supersession/mod.rs` — module root exporting `pub mod types;` with doc comment naming the engines that 12-02/03/04 will land
- `contract-ide/src-tauri/src/supersession/types.rs` — shared types module: `Verdict` enum + ParsedVerdict + SubstrateNode (sqlx::FromRow) + DescendantNode + IntentDriftResult + 3 unit tests
- `contract-ide/src-tauri/src/lib.rs` — added `pub mod supersession;` alongside other top-level module declarations (no command wiring — 12-02/03 add IPC commands later)

## Decisions Made

- **Migration version v7 (not v5)** — the plan asked for v5 with the comment "leaving room for Phase 11 to land at v4 or ship before us". By the time 12-01 executed, Phase 9 had taken v5 (FLOW-01 members_json) and Phase 11 had taken v6 (phase11_substrate_schema). Auto-fixed via Rule 3 (blocking issue / plan-version-drift) — incremented to v7 and documented the version selection in the migration's WARNING comment.

- **ALTER TABLE strategy (not CREATE TABLE IF NOT EXISTS)** — the plan EXPLICITLY anticipated this case in the Pitfall 8 coordination note ("if Phase 11 has already been planned and shipped a v4 migration that includes substrate_nodes with different columns, this migration's CREATE TABLE IF NOT EXISTS becomes a no-op for the table — but the new columns we expect (intent_drift_*) won't exist"). Phase 11 shipped substrate_nodes WITHOUT the intent_drift_* columns; v7 adds them via `ALTER TABLE ADD COLUMN`. SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — the plan's note in 11-RESEARCH.md ("intent_drift_* columns NOT pre-added on substrate_nodes — SQLite lacks ADD COLUMN IF NOT EXISTS, pre-adding breaks Phase 12-01 migration") confirmed this — so v7 is intentionally NOT idempotent against future re-runs without using migration tracking; the tauri-plugin-sql version table provides the idempotency guarantee at the migration boundary instead.

- **Composite edge index name suffix** — Phase 11 v6 already shipped `idx_substrate_edges_type` (single-column on edge_type). v7 adds a 3-column composite `(edge_type, source_uuid, target_uuid)` for the 12-04 history-query UNION lookup. Avoided collision by suffixing `_lookup`. Both indexes live in parallel; SQLite picks the better one per query.

- **Coverage count stays at 70** — the plan asked to update from "v1 requirements: 46 total" → "v1 requirements: 48 total". By 12-01 execution, the file already said "70 total" because BABEL-01/JSX-01/FLOW-01/BACKEND-FM-01 + visual model lock requirements had shipped between plan authorship and execution. The SUB-06/SUB-07 stubs were ALREADY counted in the 70 — collapsing them into canonical entries is a net-zero count change. Documented in the footer.

- **Verdict enum serde rename** — chose `#[serde(rename_all = "SCREAMING_SNAKE_CASE")]` so that `serde_json::to_string(&Verdict::NeedsHumanReview)` produces `"NEEDS_HUMAN_REVIEW"` — the EXACT string in the SQLite CHECK constraint. Means the LLM's JSON output → Rust enum → DB write path goes through one canonical string at every boundary, no per-layer rename.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Migration version conflict**
- **Found during:** Task 2 (Migration v5 supersession_layer)
- **Issue:** Plan asked for `version: 5`, but v5 had been claimed by Phase 9 Plan 09-04c (`phase9_flow01_members_json`) and v6 by Phase 11 Plan 11-01 (`phase11_substrate_schema`). Adding a duplicate v5 would corrupt the tauri-plugin-sql migration tracking table.
- **Fix:** Incremented to `version: 7`. Plan explicitly anticipated this race in its Pitfall 8 coordination note — fix is the canonical "next free version number" per migration immutability rule (RESEARCH.md Pitfall 5). All subsequent text/comments in the migration entry adjusted to "v7" / "Phase 12".
- **Files modified:** `contract-ide/src-tauri/src/db/migrations.rs`
- **Verification:** Live SQLite DB shows `_sqlx_migrations` row 7 = `phase12_supersession_layer` installed cleanly; rows 1–6 untouched.
- **Committed in:** `0a92a68` (Task 2 commit)

**2. [Rule 3 - Blocking] Phase 11 already shipped substrate_nodes — switched from CREATE TABLE IF NOT EXISTS to ALTER TABLE ADD COLUMN**
- **Found during:** Task 2 (Migration v5 supersession_layer)
- **Issue:** Plan's SQL used `CREATE TABLE IF NOT EXISTS substrate_nodes (...)` with the intent_drift_* columns inline. Phase 11 v6 had ALREADY shipped substrate_nodes WITHOUT those columns — `CREATE TABLE IF NOT EXISTS` would silently no-op and leave the columns missing, breaking 12-02 and 12-03. The plan called this exact case out as an "EDGE CASE" expected to surface a CHECKPOINT, but the resolution path is unambiguous: use ALTER TABLE.
- **Fix:** Switched to `ALTER TABLE substrate_nodes ADD COLUMN intent_drift_*` (5 columns). Removed the redundant `CREATE TABLE IF NOT EXISTS substrate_nodes` and `CREATE TABLE IF NOT EXISTS substrate_edges` blocks — both already shipped in v6. Removed the redundant `idx_substrate_nodes_active`, `idx_substrate_nodes_valid_at` indexes (already in v6). Kept only the new `idx_substrate_edges_type_lookup` composite + the priority_shifts and intent_drift_verdicts tables and their indexes.
- **Files modified:** `contract-ide/src-tauri/src/db/migrations.rs`
- **Verification:** `PRAGMA table_info(substrate_nodes)` shows all 5 intent_drift_* columns present after migration; CHECK constraints on intent_drift_verdicts reject malformed verdict / out-of-range confidence.
- **Committed in:** `0a92a68` (Task 2 commit)

**3. [Rule 3 - Blocking] Coverage stat in REQUIREMENTS.md was already 70, not 46 (as plan assumed)**
- **Found during:** Task 1 (Transcribe SUB-06 / SUB-07)
- **Issue:** Plan asked to bump "v1 requirements: 46 total" → "v1 requirements: 48 total" (and "Mapped to phases: 46" → "48"). By 12-01 execution, both numbers already read 70 because BABEL-01 / JSX-01 / FLOW-01 / BACKEND-FM-01 + visual-model-lock requirements had been added 2026-04-24 / 2026-04-25 between plan authorship (2026-04-24) and execution (2026-04-25). SUB-06 and SUB-07 were ALREADY counted in the 70 — they existed as stubs.
- **Fix:** Did NOT modify the count. Collapsed the stub one-liners in the Substrate (Phases 10-13) subsection into the new canonical entries under "Conflict / Supersession Engine (Phase 12)" — net-zero count change. Footer documents the collapse rationale.
- **Files modified:** `.planning/REQUIREMENTS.md`
- **Verification:** `grep -c "SUB-06"` returns 3 (1 canonical entry, 1 traceability row, 1 footer reference); `grep -n "Conflict / Supersession Engine"` returns the new subsection header line; total `Coverage:` stat unchanged at 70.
- **Committed in:** `59fbb4b` (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (3 Rule 3 blocking issues — all stemming from the plan being authored before Phases 9 / 11 had completed)
**Impact on plan:** All three deviations directly enable the plan's intent: "land Phase 12's foundation so 12-02/03/04 have a stable substrate." None expand scope; all tighten the seam against actually-shipped Phase 9 + Phase 11 state.

## Phase 11 Coordination Disclaimer

**Schema authority:** Phase 11 v6 owns the base shape of `substrate_nodes` and `substrate_edges`. The exact column names that Phase 12 plans (12-02/03/04) read are listed below as the "Phase 11 Pattern 1" we committed to. If a future migration changes any of these column names, the seam is migrations.rs (specifically v7's ALTER TABLE) — not the engines.

**Columns 12-02 / 12-03 read on `substrate_nodes` (must exist post-v7):**
- `uuid` (TEXT PK)
- `node_type` (TEXT, CHECK enum from v6)
- `text` (TEXT)
- `scope` (TEXT, nullable)
- `applies_when` (TEXT, nullable)
- `valid_at` (TEXT, RFC3339; from v6)
- `invalid_at` (TEXT, nullable; from v6 — Phase 12 fact engine writes here)
- `expired_at` (TEXT, nullable; from v6 — Phase 12 fact engine writes here)
- `invalidated_by` (TEXT, self-FK; from v6 — Phase 12 fact engine writes here)
- `intent_drift_state` (TEXT, nullable; **added by v7** — Phase 12 intent engine writes here)
- `intent_drift_confidence` (REAL, nullable; **added by v7**)
- `intent_drift_reasoning` (TEXT, nullable; **added by v7**)
- `intent_drift_judged_at` (TEXT, nullable; **added by v7**)
- `intent_drift_judged_against` (TEXT, nullable; **added by v7**)
- `anchored_uuids` (TEXT NOT NULL DEFAULT '[]'; from v6 — Phase 12 retrieval reuse)

**Columns 12-02 reads on `substrate_edges` (must exist post-v7):**
- `id` (TEXT PK)
- `source_uuid` (TEXT, FK)
- `target_uuid` (TEXT, FK)
- `edge_type` (TEXT — Phase 12 writes `'supersedes'` for fact-level invalidation)

If a future Phase 11.x migration renames any of these (e.g., `node_type` → `kind`), update v7's ALTER TABLE block AND the `SubstrateNode` struct in `supersession::types` simultaneously.

## supersession::types Public API (12-02 / 12-03 / 12-04 import surface)

```rust
use crate::supersession::types::{
    Verdict,            // 3-value enum: Drifted | NotDrifted | NeedsHumanReview
    ParsedVerdict,      // {id, verdict, reasoning, confidence} from LLM batch
    SubstrateNode,      // sqlx::FromRow: uuid, node_type, text, scope, applies_when,
                        //                valid_at, invalid_at, expired_at, invalidated_by
    DescendantNode,     // {node, anchor_contract_uuid, depth}
    IntentDriftResult,  // {judged, drifted, surfaced, filtered}
};

// Helpers on Verdict:
Verdict::as_db_str() -> &'static str   // "DRIFTED" | "NOT_DRIFTED" | "NEEDS_HUMAN_REVIEW"
Verdict::from_db_str(s) -> Option<Verdict>
```

12-02 (fact_engine) will import all five; 12-03 (intent_engine) will import all five plus add a `judge_descendant_drift(...) -> ParsedVerdict` API; 12-04 (harness) will import all five and add fixture-loader types alongside.

## Issues Encountered

None. The Phase 11 coordination case anticipated by the plan (line 383: "if Phase 11 has already been planned and shipped a v4 migration..." — actual outcome: v6 migration) was resolved cleanly by ALTER TABLE strategy. No engine code touched in 12-01; foundation only.

## Next Phase Readiness

- **12-02 (fact_engine):** can begin — schema present, types stable, Phase 11 substrate_nodes shape confirmed
- **12-03 (intent_engine):** can begin in parallel with 12-02 (Wave 2) — relies on the same schema + types
- **12-04 (adversarial harness):** can begin once 12-02 + 12-03 land — depends on the engines, not just schema
- No blockers; no checkpoints; no human verification required for 12-01 (foundation plan)

---
*Phase: 12-conflict-supersession-engine*
*Plan: 01*
*Completed: 2026-04-25*

## Self-Check: PASSED

All claimed files exist on disk; all claimed commits exist in git history.

- FOUND: `.planning/REQUIREMENTS.md` — modified
- FOUND: `contract-ide/src-tauri/src/db/migrations.rs` — modified
- FOUND: `contract-ide/src-tauri/src/supersession/mod.rs` — created
- FOUND: `contract-ide/src-tauri/src/supersession/types.rs` — created
- FOUND: `contract-ide/src-tauri/src/lib.rs` — modified
- FOUND: `.planning/phases/12-conflict-supersession-engine/12-01-SUMMARY.md` — this file
- FOUND: `59fbb4b` — Task 1 commit (REQUIREMENTS.md transcription)
- FOUND: `0a92a68` — Task 2 commit (migration v7 + supersession::types)
