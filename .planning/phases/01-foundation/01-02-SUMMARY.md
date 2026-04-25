---
phase: 01-foundation
plan: 02
subsystem: data-layer
tags: [sqlite, tauri-plugin-sql, migrations, fts5, wal, ipc, serde, typed-invoke]

# Dependency graph
requires:
  - "Plan 01-01: Tauri v2 scaffold (tauri-plugin-sql 2.4.0 declared; shell-capable capabilities file; lib.rs builder)"
provides:
  - "Migration v1 (immutable, description=create_core_tables) creating nodes, edges, node_flows, drift_state, receipts, receipt_nodes"
  - "All six DATA-06 indexes: idx_nodes_parent_uuid, idx_nodes_file_path, idx_nodes_level, idx_node_flows_flow, idx_receipts_node_uuid (on receipt_nodes.node_uuid), partial idx_drift_drifted"
  - "nodes_fts FTS5 virtual table (content='nodes', content_rowid='rowid') ready for Phase 2 intent search"
  - "WAL journal mode on contract-ide.db (Open Question 2 resolved — MCP sidecar read-only conn will not block writers)"
  - "Typed IPC skeleton: ContractNode Rust struct + TypeScript interface, #[tauri::command] async get_nodes(level, parent_uuid) -> Result<Vec<ContractNode>, String> returning Ok(Vec::new())"
  - "src/ipc/{types.ts,nodes.ts}: typed getNodes() wrapper; no bare invoke() in the frontend"
  - "tauri.conf.json plugins.sql.preload = [\"sqlite:contract-ide.db\"]: migrations run at plugin setup, not deferred to first frontend Database.load()"
  - "capabilities/default.json grants sql:default (allow-close, allow-load, allow-select) for Phase 2 frontend queries"
affects: [01-03, 01-04, 02, 03, 04, 05, 06, 07, 08, 09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "tauri-plugin-sql migrations: single Rust Vec<Migration> in src-tauri/src/db/migrations.rs; description IS part of migration identity — never edit once applied (Pitfall 5)"
    - "Preload-driven migration execution: tauri.conf.json plugins.sql.preload triggers DbPool::connect + Migrator at setup hook, so DB + schema are guaranteed present before any IPC"
    - "Typed IPC: Rust ContractNode struct mirrored field-for-field by TS ContractNode interface; getNodes() wrapper forces invoke<ContractNode[]> generic — bare invoke('get_nodes') returning `any` is eliminated by convention"
    - "Command path resolution: generate_handler![commands::nodes::get_nodes] uses the full path; `pub use` re-exports DO NOT re-export the #[tauri::command]-generated __cmd__ shim"

key-files:
  created:
    - "/Users/yang/lahacks/contract-ide/src-tauri/src/db/mod.rs"
    - "/Users/yang/lahacks/contract-ide/src-tauri/src/db/migrations.rs"
    - "/Users/yang/lahacks/contract-ide/src-tauri/src/commands/mod.rs"
    - "/Users/yang/lahacks/contract-ide/src-tauri/src/commands/nodes.rs"
    - "/Users/yang/lahacks/contract-ide/src/ipc/types.ts"
    - "/Users/yang/lahacks/contract-ide/src/ipc/nodes.ts"
  modified:
    - "/Users/yang/lahacks/contract-ide/src-tauri/src/lib.rs"
    - "/Users/yang/lahacks/contract-ide/src-tauri/tauri.conf.json"
    - "/Users/yang/lahacks/contract-ide/src-tauri/capabilities/default.json"
    - "/Users/yang/lahacks/contract-ide/src/App.tsx"

key-decisions:
  - "preload the SQLite DB via tauri.conf.json plugins.sql.preload so migrations run at Tauri setup — not deferred to the frontend's first Database.load(); backend-side migrations fail fast at startup if the SQL is broken"
  - "receipt_nodes is the effective join between receipts and nodes; idx_receipts_node_uuid indexes the join table's node_uuid column (DATA-02 / DATA-06 — corrects the RESEARCH.md Pattern 2 variant that indexed receipts.id)"
  - "get_nodes(level, parent_uuid) signature frozen in Phase 1 even though Phase 1 ignores both params — shape matches Phase 3 graph filter needs so later phases add no breaking IPC change"
  - "Migration description string 'create_core_tables' declared immutable; any future schema change ships as Migration { version: 2, ... }"
  - "Phase 1 nodes.file_path stays flat (single-file coverage); Phase 2 DATA-01 migration adds code_ranges TEXT (JSON) and deprecates file_path — documented in-SQL with a forward-pointing comment"

patterns-established:
  - "Rust module layout: src-tauri/src/{db,commands}/{mod.rs,*.rs}; lib.rs declares `mod db; mod commands;` and wires plugins + handler in the builder"
  - "Frontend IPC layout: src/ipc/{types.ts,*.ts}; types.ts holds shared interfaces mirroring Rust structs with a KEEP IN SYNC banner"
  - "Every tauri::command goes in src-tauri/src/commands/<module>.rs and gets registered via full path commands::<module>::<fn> in generate_handler!"

requirements-completed:
  - "DATA-06 (Phase 1 contribution: schema scaffold, all required indexes, FTS5 table present; Phase 2 will honor the no-manual-DB-deletion rule when adding code_ranges via a v2 migration)"

# Metrics
duration: ~15min
completed: 2026-04-24
---

# Phase 1 Plan 2: SQLite Schema + Typed Rust IPC Skeleton Summary

**SQLite schema (nodes/edges/node_flows/drift_state/receipts/receipt_nodes + all six DATA-06 indexes + `nodes_fts` FTS5 + WAL journal mode) provisioned via a single immutable `create_core_tables` migration that runs on Tauri launch, with `get_nodes` IPC roundtripping end-to-end to a typed TypeScript wrapper returning `ContractNode[]`.**

## Performance

- **Duration:** ~15 min (all three tasks autonomous; single screenshot loop to verify the IPC-roundtrip text once a stale production-bundle process was identified and killed)
- **Started:** 2026-04-24T22:24:10Z
- **Completed:** 2026-04-24T22:39:53Z
- **Tasks:** 3 (all `type="auto"`, no checkpoints)
- **Files touched:** 10 (6 created, 4 modified)

## Accomplishments

- Migration v1 (`create_core_tables`, version 1, immutable) lands the full Phase 1 schema in a single transaction
- All six DATA-06 indexes visible to `EXPLAIN QUERY PLAN`; the partial `idx_drift_drifted WHERE reconciled_at IS NULL` makes Phase 5's MCP `list_drifted_nodes` tool O(drifted)
- `nodes_fts` FTS5 virtual table present from day 1 so Phase 2's intent search plugs in without a migration
- `PRAGMA journal_mode = WAL` active on first open — `.db-wal` and `.db-shm` sidecars visible on disk (MCP sidecar's read-only connection in Phase 5 will not block writers)
- `get_nodes` Rust `#[tauri::command]` compiled with the exact signature Phase 3 graph filtering needs; returns `Ok(Vec::new())` so migration success + IPC roundtrip are provable today without populating data
- Typed TS wrapper `getNodes(params?)` uses `invoke<ContractNode[]>(...)` — bare string-typed invokes eliminated from the frontend by convention before any component mounts
- End-to-end roundtrip screenshot-verified: window renders "get_nodes returned 0 rows"

## Task Commits

1. **Task 1: migration v1 with full schema + indexes + FTS5 + WAL** — `21982eb` (feat)
2. **Task 2: get_nodes Rust command + typed TS IPC wrappers** — `6667cbb` (feat)
3. **Task 3: wire SQL plugin + handler + App.tsx smoke test** — `60e896f` (feat)

**Plan metadata commit:** pending (this commit)

## Files Created / Modified

**Created**
- `contract-ide/src-tauri/src/db/mod.rs` — re-exports `get_migrations`
- `contract-ide/src-tauri/src/db/migrations.rs` — top-of-file immutability warning + single-Migration vec (full SQL below)
- `contract-ide/src-tauri/src/commands/mod.rs` — declares `pub mod nodes` and documents the macro-resolution quirk
- `contract-ide/src-tauri/src/commands/nodes.rs` — `ContractNode` Serialize/Deserialize struct + `#[tauri::command] pub async fn get_nodes(...)` stub
- `contract-ide/src/ipc/types.ts` — `ContractLevel` union + `ContractNode` interface mirroring the Rust struct
- `contract-ide/src/ipc/nodes.ts` — `getNodes(params?)` typed wrapper

**Modified**
- `contract-ide/src-tauri/src/lib.rs` — added `mod commands; mod db;` + `SqlBuilder::default().add_migrations(...)` + `generate_handler![commands::nodes::get_nodes]`
- `contract-ide/src-tauri/tauri.conf.json` — added `plugins.sql.preload = ["sqlite:contract-ide.db"]`
- `contract-ide/src-tauri/capabilities/default.json` — appended `"sql:default"`
- `contract-ide/src/App.tsx` — Plan 01-02 smoke test calling `getNodes()` on mount (to be replaced in Plan 01-03)

## Migration v1 SQL (verbatim)

```sql
PRAGMA journal_mode = WAL;

-- Phase 2 migration will add code_ranges TEXT (JSON) per DATA-01; do NOT edit this migration.
CREATE TABLE IF NOT EXISTS nodes (
  uuid            TEXT PRIMARY KEY,
  level           TEXT NOT NULL CHECK(level IN ('L0','L1','L2','L3','L4')),
  name            TEXT NOT NULL,
  file_path       TEXT,
  parent_uuid     TEXT REFERENCES nodes(uuid),
  is_canonical    INTEGER NOT NULL DEFAULT 1,
  canonical_uuid  TEXT REFERENCES nodes(uuid),
  code_hash       TEXT,
  contract_hash   TEXT,
  human_pinned    INTEGER NOT NULL DEFAULT 0,
  route           TEXT,
  derived_at      TEXT,
  contract_body   TEXT,
  tags            TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS edges (
  id          TEXT PRIMARY KEY,
  source_uuid TEXT NOT NULL REFERENCES nodes(uuid),
  target_uuid TEXT NOT NULL REFERENCES nodes(uuid),
  edge_type   TEXT NOT NULL,
  label       TEXT
);

CREATE TABLE IF NOT EXISTS node_flows (
  node_uuid TEXT NOT NULL REFERENCES nodes(uuid),
  flow_uuid TEXT NOT NULL REFERENCES nodes(uuid),
  PRIMARY KEY (node_uuid, flow_uuid)
);

CREATE TABLE IF NOT EXISTS drift_state (
  node_uuid           TEXT PRIMARY KEY REFERENCES nodes(uuid),
  current_code_hash   TEXT NOT NULL,
  contract_code_hash  TEXT NOT NULL,
  drifted_at          TEXT NOT NULL,
  reconciled_at       TEXT
);

CREATE TABLE IF NOT EXISTS receipts (
  id                 TEXT PRIMARY KEY,
  session_id         TEXT NOT NULL,
  transcript_path    TEXT NOT NULL,
  started_at         TEXT,
  finished_at        TEXT,
  input_tokens       INTEGER,
  output_tokens      INTEGER,
  cache_read_tokens  INTEGER,
  tool_call_count    INTEGER,
  nodes_touched      TEXT,
  estimated_cost_usd REAL,
  raw_summary        TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS receipt_nodes (
  receipt_id TEXT NOT NULL REFERENCES receipts(id),
  node_uuid  TEXT NOT NULL REFERENCES nodes(uuid),
  PRIMARY KEY (receipt_id, node_uuid)
);

CREATE INDEX IF NOT EXISTS idx_nodes_parent_uuid ON nodes(parent_uuid);
CREATE INDEX IF NOT EXISTS idx_nodes_file_path   ON nodes(file_path);
CREATE INDEX IF NOT EXISTS idx_nodes_level       ON nodes(level);
CREATE INDEX IF NOT EXISTS idx_node_flows_flow   ON node_flows(flow_uuid);
CREATE INDEX IF NOT EXISTS idx_receipts_node_uuid ON receipt_nodes(node_uuid);
CREATE INDEX IF NOT EXISTS idx_drift_drifted ON drift_state(reconciled_at)
  WHERE reconciled_at IS NULL;

CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
  uuid UNINDEXED,
  name,
  contract_body,
  tags,
  content='nodes',
  content_rowid='rowid'
);
```

**Diff from RESEARCH.md Pattern 2:** two material corrections.

1. Added the `receipt_nodes` join table (REQUIREMENTS.md DATA-02) so `idx_receipts_node_uuid` points to a real column — Pattern 2 in RESEARCH.md indexed `receipts(id)` which was wrong (that's already the PK).
2. Added `PRAGMA journal_mode = WAL` as the first statement (Open Question 2 resolution).

## Verification Artifacts

**DB on disk:** `/Users/yang/Library/Application Support/com.contract-ide.app/contract-ide.db`
(Downstream phases — especially the Phase 5 MCP sidecar's read-only `better-sqlite3` connection — connect to this exact path.)

**`.tables` output:**
```
_sqlx_migrations   node_flows         nodes_fts_config   nodes_fts_idx
drift_state        nodes              nodes_fts_data     receipt_nodes
edges              nodes_fts          nodes_fts_docsize  receipts
```
(All six core tables + `receipt_nodes` join + `nodes_fts` FTS5 + its four FTS5 shadow tables + `_sqlx_migrations` tracker.)

**`.indexes` (idx_%):**
```
idx_drift_drifted
idx_node_flows_flow
idx_nodes_file_path
idx_nodes_level
idx_nodes_parent_uuid
idx_receipts_node_uuid
```

**`PRAGMA journal_mode`:** `wal`

**`_sqlx_migrations`:** `1 | create_core_tables | 1` (version 1, description "create_core_tables", success=1)

**`EXPLAIN QUERY PLAN` spot checks:**
- `SELECT * FROM nodes WHERE parent_uuid = ?` → `SEARCH nodes USING INDEX idx_nodes_parent_uuid`
- `SELECT * FROM drift_state WHERE reconciled_at IS NULL` → `SEARCH drift_state USING INDEX idx_drift_drifted` (partial index used)
- `SELECT * FROM receipt_nodes WHERE node_uuid = ?` → `SEARCH receipt_nodes USING INDEX idx_receipts_node_uuid`

**IPC roundtrip:** Window screenshot (captured mid-verification) shows the Monaco-CSP-compatible blurred translucent pane with centered text `get_nodes returned 0 rows` — proves (a) migrations ran, (b) Rust command registered and callable, (c) serde roundtrips `Vec::<ContractNode>::new()` to a JS array with `.length === 0`.

## Permission File Discovery

`sql:default` exists (source: `tauri-plugin-sql-2.4.0/permissions/default.toml`) and grants `allow-close, allow-load, allow-select`. We used the aggregate permission rather than listing granular names; sufficient for Phase 2's `Database.load` + read queries. If Phase 2 wants writes via frontend (it will not — writes go through Rust commands per the single-writer rule), we'd need `sql:allow-execute` added explicitly.

## Decisions Made

1. **`plugins.sql.preload` in tauri.conf.json.** `tauri-plugin-sql` runs migrations at two points: (a) for every DB URL listed in `PluginConfig.preload` during the plugin's setup hook, or (b) when the frontend calls `Database.load()`. Preload gives us fail-fast semantics (broken SQL panics at startup, not at first IPC) and guarantees the DB file + schema exist before anything tries to `invoke('get_nodes')`. Cost: the backend briefly blocks on sqlx connection open during startup. Benefit: deterministic ordering, and backend Rust code in later phases can `app.state::<DbInstances>()` without racing a frontend load.
2. **Fully-qualified command path in `generate_handler!`.** The `#[tauri::command]` proc macro emits a sibling `__cmd__<name>` shim. `generate_handler![commands::get_nodes]` (after `pub use nodes::get_nodes;` in `commands/mod.rs`) compiles the macro as `commands::__cmd__get_nodes` — but re-exports don't carry the shim. Diagnosis: compiler E0433 "could not find `__cmd__get_nodes` in `commands`". Fix: use `generate_handler![commands::nodes::get_nodes]` directly and drop the `pub use` re-export. Documented inline in `commands/mod.rs` so the next person adding a command avoids the same trap.
3. **Receipt-node join indexed on the join table, not on `receipts`.** RESEARCH.md Pattern 2 had `CREATE INDEX idx_receipts_node_uuid ON receipts(id)` which is vacuous (`receipts.id` is already the PRIMARY KEY). Corrected to `idx_receipts_node_uuid ON receipt_nodes(node_uuid)` — the index that actually accelerates "find all receipts for node X" queries Phase 8 will issue from the Inspector.
4. **`get_nodes(level, parent_uuid)` signature over `get_nodes()`.** Even though Phase 1 ignores the params, committing to the shape today means Phase 3's graph filter doesn't need a breaking IPC change — it just removes the `#[allow(unused_variables)]` and uses them.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 – Blocking] `plugins.sql.preload` required to trigger migrations at startup**
- **Found during:** Task 3 (first `tauri dev` run)
- **Issue:** `SqlBuilder::default().add_migrations(...)` in lib.rs registers the migration vec but `tauri-plugin-sql`'s setup hook only runs migrations for DB URLs in `PluginConfig.preload`. Without preload, migrations are deferred to the frontend's `Database.load()` call — which the Phase 1 smoke test doesn't make (it just calls `invoke('get_nodes')`). Result: DB file never created on launch, `sqlite3 .tables` finds nothing.
- **Fix:** Added `"plugins": { "sql": { "preload": ["sqlite:contract-ide.db"] } }` to `tauri.conf.json`. Migrations now run deterministically at plugin setup; a broken migration panics at startup, not at first IPC.
- **Files modified:** `contract-ide/src-tauri/tauri.conf.json`
- **Verification:** After fix, `$HOME/Library/Application Support/com.contract-ide.app/contract-ide.db` appears within ~1s of window launch with full schema.
- **Committed in:** `60e896f`

**2. [Rule 3 – Blocking] `generate_handler!` needs fully-qualified command path (re-exports break the macro shim)**
- **Found during:** Task 3 (first `cargo build` after wiring `generate_handler![commands::get_nodes]`)
- **Issue:** `error[E0433]: could not find '__cmd__get_nodes' in 'commands'`. The `#[tauri::command]` macro emits `__cmd__<name>` as a sibling in the module where the command fn lives, NOT where it's re-exported. `pub use nodes::get_nodes;` in `commands/mod.rs` re-exports the fn but leaves the shim in `commands::nodes::__cmd__get_nodes`, unreachable via `commands::__cmd__get_nodes`.
- **Fix:** Changed `generate_handler![commands::get_nodes]` → `generate_handler![commands::nodes::get_nodes]` and dropped the `pub use` re-export in `commands/mod.rs` (replaced with a doc comment explaining the quirk).
- **Files modified:** `contract-ide/src-tauri/src/lib.rs`, `contract-ide/src-tauri/src/commands/mod.rs`
- **Verification:** `cargo build` exits 0 clean (no warnings).
- **Committed in:** `60e896f`

**3. [Rule 1 – Bug] `idx_receipts_node_uuid` indexed the wrong column in RESEARCH.md Pattern 2**
- **Found during:** Task 1 (writing migration SQL)
- **Issue:** RESEARCH.md Pattern 2 has `CREATE INDEX idx_receipts_node_uuid ON receipts(id)` — but `receipts.id` is already the primary key, and the column we need indexed for "list receipts for node X" is `receipt_nodes.node_uuid` (the join table).
- **Fix:** Created `receipt_nodes` as a first-class table (REQUIREMENTS.md DATA-02 calls for it anyway) and indexed `receipt_nodes(node_uuid)` instead. EXPLAIN QUERY PLAN confirms the planner uses it.
- **Files modified:** `contract-ide/src-tauri/src/db/migrations.rs`
- **Committed in:** `21982eb`

---

**Total deviations:** 3 auto-fixed (2 Rule 3 – Blocking, 1 Rule 1 – Bug). **Impact on plan:** all deviations were narrow corrections needed to make the plan's own verification criteria (DB file exists, IPC roundtrips, EXPLAIN uses indexes) pass. No scope creep.

## Issues Encountered

- **Stale production-bundle process held the old App.tsx text.** A `target/debug/bundle/macos/contract-ide.app/Contents/MacOS/contract-ide` process left over from Plan 01-01's production-build vibrancy verification was still running and kept appearing in AppleScript "activate" calls, so the first few screenshots showed "Contract IDE — Phase 1 scaffold" (the old copy) rather than the new dev-build text. Resolved by killing PID 84575 and deleting the `.app` bundle directory. **Follow-up hygiene:** future human-verify checkpoints that build a production `.app` should also quit it before the next plan starts.
- **No direct headless way to verify IPC roundtrip text.** Confirmation required a screenshot via `screencapture -R`. Consider adding a tiny Rust-side `Result`-logging `tracing::info!` in `get_nodes` before returning so future autonomous executors can confirm "IPC was called" from the dev log alone.

## User Setup Required

None. First launch creates the DB at `~/Library/Application Support/com.contract-ide.app/contract-ide.db` automatically.

## Next Phase Readiness

- **Plan 01-03** (three-pane AppShell + Copy Mode pill + AsyncState + autosave/zundo) builds on `src/ipc/types.ts` — any store that reads nodes will import `ContractNode` from here.
- **Plan 01-04** (Day-1 integration validation) is unblocked; no dependency from this plan.
- **Phase 2** (DATA-01 through DATA-06): schema scaffolding is done; the Phase 2 scanner just needs to INSERT rows (single-writer rule: writes go through a Rust command, not frontend JS). Phase 2's `code_ranges` addition ships as a numbered v2 Migration — immutability of v1's `create_core_tables` enforced by the inline warning at the top of `migrations.rs`.
- **Phase 5** (MCP sidecar) can connect to the same DB path in read-only mode; WAL pragma already enables concurrent reader.

---
*Phase: 01-foundation*
*Completed: 2026-04-24*

## Self-Check: PASSED

All 6 key-files verified present on disk. All 3 referenced task commits (`21982eb`, `6667cbb`, `60e896f`) present in git history.
