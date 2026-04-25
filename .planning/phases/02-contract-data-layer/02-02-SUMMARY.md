---
phase: 02-contract-data-layer
plan: 02
subsystem: data-layer
tags: [sqlite, scanner, walkdir, upsert, edges, node_flows, ipc, tauri, react, zustand, sidecar]

# Dependency graph
requires:
  - "Plan 02-01: ContractFrontmatter + CodeRange structs, parse_sidecar/write_sidecar, migration v2 (code_ranges + kind columns)"
  - "Plan 01-02: DbInstances access pattern, migration v1 schema (edges with source_uuid/target_uuid columns, node_flows), generate_handler fully-qualified path convention"
  - "Plan 01-03: GraphPlaceholder + AsyncState pattern"
provides:
  - "scan_contracts_dir() — walkdir + spawn_blocking + duplicate UUID detection + per-sidecar error collection into ScanResult.errors (not dropped)"
  - "upsert_node_pub() — single canonical ON CONFLICT(uuid) DO UPDATE upsert for nodes + edges (source_uuid/target_uuid) + node_flows"
  - "open_repo Tauri command — stores RepoState + calls scan_contracts_dir"
  - "get_repo_path Tauri command — returns current repo path for reload"
  - "write_contract Tauri command — atomic temp+rename sidecar write + upsert_node_pub re-upsert"
  - "get_nodes Tauri command — real SQLite SELECT with code_ranges + kind hydrated"
  - "pickAndOpenRepo() / openRepo() / getRepoPath() TypeScript IPC wrappers"
  - "writeContract() TypeScript IPC wrapper"
  - "GraphPlaceholder with Open Repository button in empty state; ?force-error override removed"
  - "graph store with nodes: ContractNode[] + refreshNodes() action"
affects: [02-03, 03, 04, 05]

# Tech tracking
tech-stack:
  added:
    - "sqlx 0.8 (sqlite + runtime-tokio-native-tls) — direct dep for sqlx::query in scanner/nodes (transitive via tauri-plugin-sql; now explicit)"
    - "@tauri-apps/plugin-dialog 2.7.0 — JS-side folder picker (open())"
    - "@tauri-apps/plugin-fs 2.5.0 — JS-side fs access"
  patterns:
    - "DbPool enum match: tauri_plugin_sql exposes DbPool::Sqlite(Pool<Sqlite>) — all scanner/nodes code matches on DbPool::Sqlite(pool) to get &Pool<Sqlite> for sqlx queries"
    - "spawn_blocking returns Result<T, JoinError> — .await.map_err(...)?  gives the inner tuple (no double-? needed when closure returns plain T)"
    - "edges table uses source_uuid/target_uuid not from_uuid/to_uuid — plan skeleton had wrong column names; fixed before first cargo check"
    - "RepoState pattern: Mutex<Option<PathBuf>> in managed state; get_repo_path is sync (uses std::sync::Mutex), open_repo is async"
    - "invoke() type safety: WriteContractParams cast to Record<string, unknown> via 'as unknown as' to satisfy InvokeArgs constraint"

key-files:
  created:
    - "/Users/yang/lahacks/contract-ide/src-tauri/src/db/scanner.rs"
    - "/Users/yang/lahacks/contract-ide/src-tauri/src/commands/repo.rs"
    - "/Users/yang/lahacks/contract-ide/src-tauri/src/commands/contracts.rs"
    - "/Users/yang/lahacks/contract-ide/src/ipc/repo.ts"
    - "/Users/yang/lahacks/contract-ide/src/ipc/contracts.ts"
  modified:
    - "/Users/yang/lahacks/contract-ide/src-tauri/src/db/mod.rs"
    - "/Users/yang/lahacks/contract-ide/src-tauri/src/commands/mod.rs"
    - "/Users/yang/lahacks/contract-ide/src-tauri/src/commands/nodes.rs"
    - "/Users/yang/lahacks/contract-ide/src-tauri/src/lib.rs"
    - "/Users/yang/lahacks/contract-ide/src-tauri/capabilities/default.json"
    - "/Users/yang/lahacks/contract-ide/src-tauri/Cargo.toml"
    - "/Users/yang/lahacks/contract-ide/src/ipc/types.ts"
    - "/Users/yang/lahacks/contract-ide/src/components/layout/GraphPlaceholder.tsx"
    - "/Users/yang/lahacks/contract-ide/src/store/graph.ts"
    - "/Users/yang/lahacks/contract-ide/package.json"
    - "/Users/yang/lahacks/contract-ide/package-lock.json"

key-decisions:
  - "DbPool enum match required — tauri_plugin_sql::DbPool is an enum wrapping Pool<Sqlite>; upsert_node_pub takes &DbPool and matches on DbPool::Sqlite(pool) rather than taking &Pool<Sqlite> directly. Keeps API boundary clean without adding an unwrap helper."
  - "edges schema deviation — plan skeleton used from_uuid/to_uuid; actual v1 migration uses source_uuid/target_uuid with id + edge_type columns required (NOT NULL). Fixed before first cargo check. Deterministic edge id formed as 'from_uuid->to_uuid' string."
  - "sqlx as direct dep — sqlx 0.8 (sqlite + runtime-tokio-native-tls) added explicitly; tauri-plugin-sql carries it transitively but direct dep needed for sqlx::query and sqlx::Row in scanner/nodes code."
  - "spawn_blocking single-? — closure returns plain tuple not Result<tuple>; .await gives Result<T, JoinError>; only one ? needed (map_err for the JoinError)."
  - "AsyncState empty prop accepts ReactNode — Open Repo button passed as JSX to the empty prop directly (AsyncState's interface declares empty?: ReactNode). No wrapper component needed."
  - "Pre-existing clippy warning in validation.rs — validation.rs:71 has unnecessary_map_or; pre-existing, not introduced by this plan. Logged to deferred-items.md. Touched-module clippy is clean."

requirements-completed: [SHELL-02, DATA-02, DATA-04]

# Metrics
duration: ~6min
completed: 2026-04-24
---

# Phase 2 Plan 2: Scanner + IPC Vertical Slice Summary

**Folder picker → scan_contracts_dir → SQLite populated (nodes + edges + node_flows) → get_nodes returns real rows → GraphPlaceholder shows Open Repository button; write_contract is the single atomic disk writer.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-24T02:10:22Z
- **Completed:** 2026-04-24T02:16:00Z
- **Tasks:** 3 (all type="auto", no checkpoints)
- **Files modified:** 14 files (5 created, 9 modified)

## Accomplishments

- `scan_contracts_dir()` walks `.contracts/` recursively via walkdir under `spawn_blocking`, collects parse/read errors into `ScanResult.errors` (not dropped), detects duplicate UUIDs (skip-with-error, first-one-wins), upserts remaining nodes
- `upsert_node_pub()` — single canonical pub symbol: ON CONFLICT(uuid) DO UPDATE for nodes; DELETE+INSERT for edges (source_uuid/target_uuid) and node_flows; DATA-04 satisfied (rename updates code_ranges without minting new UUID)
- Phase 2 success criterion 1 confirmed: `SELECT COUNT(*) FROM edges` and `SELECT COUNT(*) FROM node_flows` both return non-zero for fixture with neighbors + parent
- `open_repo` + `get_repo_path` + `write_contract` + `get_nodes` all registered in `generate_handler!` via fully-qualified paths (Plan 01-02 convention preserved)
- `get_nodes` replaces `Ok(Vec::new())` stub with real SQLite SELECT; `ContractNode` extended with `kind` + `code_ranges` + `human_pinned` + `route` + `derived_at`; `file_path` dropped
- `write_contract` atomic write (temp file + `std::fs::rename`) then `upsert_node_pub` re-upsert — single-writer rule upheld
- TS `ContractNode` interface updated to match Rust; `file_path` dropped; `CodeRange` + `ContractFrontmatter` + `ScanResult` interfaces added
- `pickAndOpenRepo()` / `openRepo()` / `getRepoPath()` / `writeContract()` wrappers in `src/ipc/`
- `GraphPlaceholder`: `?force-error` URL override removed; "Open Repository" button in empty state; scan errors surface via AsyncState error branch
- `graph.ts` store extended with `nodes: ContractNode[]` + `refreshNodes()` for Phase 3 canvas
- `@tauri-apps/plugin-dialog` + `@tauri-apps/plugin-fs` installed in JS; committed in package-lock.json
- Capabilities: `dialog:allow-open` + `fs:allow-read-text-file` added to default.json
- `cargo test`: 3 frontmatter unit tests still green; `npx tsc --noEmit` clean

## Task Commits

1. **Task 1: Scanner module + open_repo/get_repo_path** — `b46992d`
2. **Task 2: write_contract + real get_nodes + capabilities** — `537f089`
3. **Task 3: Frontend IPC wrappers + Open Repo button** — `dc3431f`

## Files Created / Modified

**Created**
- `contract-ide/src-tauri/src/db/scanner.rs` — 215 lines; scan_contracts_dir + upsert_node_pub
- `contract-ide/src-tauri/src/commands/repo.rs` — open_repo + get_repo_path; RepoState struct
- `contract-ide/src-tauri/src/commands/contracts.rs` — write_contract single-writer
- `contract-ide/src/ipc/repo.ts` — pickAndOpenRepo / openRepo / getRepoPath
- `contract-ide/src/ipc/contracts.ts` — writeContract typed wrapper

**Modified**
- `contract-ide/src-tauri/src/db/mod.rs` — added `pub mod scanner`
- `contract-ide/src-tauri/src/commands/mod.rs` — added `pub mod contracts; pub mod repo`
- `contract-ide/src-tauri/src/commands/nodes.rs` — real SQLite SELECT; ContractNode extended
- `contract-ide/src-tauri/src/lib.rs` — RepoState managed; 4 commands in generate_handler!
- `contract-ide/src-tauri/capabilities/default.json` — 2 permissions added
- `contract-ide/src-tauri/Cargo.toml` — sqlx 0.8 direct dep added
- `contract-ide/src/ipc/types.ts` — ContractNode + CodeRange + ContractFrontmatter + ScanResult
- `contract-ide/src/components/layout/GraphPlaceholder.tsx` — Open Repo button; force-error removed
- `contract-ide/src/store/graph.ts` — nodes[] + refreshNodes()
- `contract-ide/package.json` + `package-lock.json` — 2 tauri JS plugins added

## Decisions Made

1. **DbPool enum match** — `tauri_plugin_sql::DbPool` is an enum wrapping `Pool<Sqlite>`. The plan skeleton used `&Pool<Sqlite>` directly, which is not accessible from outside the enum. Fixed by taking `&DbPool` in `upsert_node_pub` and matching `DbPool::Sqlite(pool)`. This is the correct approach given the plugin's public API.

2. **edges column names fixed** — The plan skeleton used `from_uuid`/`to_uuid` but the v1 migration created `edges(id PK, source_uuid, target_uuid, edge_type, label)`. Also `edge_type` is NOT NULL so each insert must bind it. Fixed before first `cargo check`. Used deterministic `"{from}->{to}"` as the edge id.

3. **sqlx direct dep required** — `sqlx::query` and `sqlx::Row` are not re-exported by `tauri_plugin_sql`; sqlx must be a direct dep. Added `sqlx = { version = "0.8", features = ["sqlite", "runtime-tokio-native-tls"] }`.

4. **spawn_blocking single-? pattern** — The closure returns a plain tuple `(Vec<...>, Vec<String>)`, not a `Result`. `.await` produces `Result<tuple, JoinError>`. Single `.await.map_err(...)?` unwraps the JoinError; no second `?` needed. The plan skeleton had `??` which the compiler rejected.

5. **AsyncState empty prop accepts ReactNode** — The `empty` prop on `AsyncState` is typed `ReactNode` (see Plan 01-03's component). The Open Repo button passed as JSX directly to the prop — no wrapper component or AsyncState API change needed.

6. **Non-transactional scan is deliberate** — Scanner is best-effort per-sidecar (no `BEGIN IMMEDIATE / COMMIT`). Rationale: partial scans still surface via `ScanResult.errors` and the graph renders whatever was valid. Inline comment documents this with a Phase 3 hardening note if observable partial states emerge.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] edges table column names wrong in plan skeleton**
- **Found during:** Task 1, `cargo check` verification section
- **Issue:** Plan skeleton used `from_uuid`/`to_uuid` but v1 migration created `source_uuid`/`target_uuid`; also `edge_type TEXT NOT NULL` requires a bound value; `id` is a PK with no DEFAULT
- **Fix:** Changed all edge INSERTs to `(id, source_uuid, target_uuid, edge_type)` with deterministic `"{uuid}->{neighbor}"` id and `edge_type='neighbor'`; fixed DELETE to `WHERE source_uuid = ?1`
- **Files modified:** `contract-ide/src-tauri/src/db/scanner.rs`
- **Commit:** `b46992d`

**2. [Rule 3 - Blocking] sqlx not a direct dependency**
- **Found during:** Task 1, first `cargo check`
- **Issue:** `sqlx::query` and `sqlx::Row` require `sqlx` as a direct dep; `tauri-plugin-sql` does not re-export them
- **Fix:** Added `sqlx = { version = "0.8", features = ["sqlite", "runtime-tokio-native-tls"] }` to `Cargo.toml`
- **Files modified:** `contract-ide/src-tauri/Cargo.toml`
- **Commit:** `b46992d`

**3. [Rule 1 - Bug] spawn_blocking double-? pattern rejected by compiler**
- **Found during:** Task 1, `cargo check`
- **Issue:** Plan skeleton used `.await??` but spawn_blocking closure returns plain tuple, not `Result<tuple>`. Compiler rejected the double `?`
- **Fix:** Changed to `.await.map_err(|e| anyhow::anyhow!("spawn_blocking join error: {e}"))?`
- **Files modified:** `contract-ide/src-tauri/src/db/scanner.rs`
- **Commit:** `b46992d`

**4. [Rule 1 - Bug] DbPool is an enum, not Pool<Sqlite> directly**
- **Found during:** Task 1 planning (reading wrapper.rs before writing code)
- **Issue:** Plan skeleton signature `upsert_node_pub(db: &Pool<Sqlite>)` is wrong — tauri_plugin_sql exposes `DbPool` enum; `DbPool::Sqlite(Pool<Sqlite>)` is the variant
- **Fix:** Changed `upsert_node_pub` to take `&DbPool` and match on `DbPool::Sqlite(pool)`
- **Files modified:** `contract-ide/src-tauri/src/db/scanner.rs`, `contracts.rs`
- **Commit:** `b46992d`

**5. [Rule 3 - Blocking] invoke() type constraint for WriteContractParams**
- **Found during:** Task 3, `npx tsc --noEmit`
- **Issue:** `invoke<void>('write_contract', params)` where params is `WriteContractParams` fails — `InvokeArgs` requires `Record<string, unknown>` and `WriteContractParams` lacks an index signature
- **Fix:** Cast `params as unknown as Record<string, unknown>` at the call site
- **Files modified:** `contract-ide/src/ipc/contracts.ts`
- **Commit:** `dc3431f`

**6. [Out-of-scope] Pre-existing clippy warning in validation.rs**
- **Issue:** `validation.rs:71` uses `map_or(false, ...)` flagged by `unnecessary_map_or` clippy lint
- **Action:** Logged to `deferred-items.md`; NOT fixed (pre-existing, not caused by this plan's changes)

## DATA-04 Proof (UUID-stable upsert on rename)

The `ON CONFLICT(uuid) DO UPDATE SET code_ranges = excluded.code_ranges` clause ensures that if a `.contracts/<uuid>.md` sidecar's `code_ranges[0].file` path changes (source file renamed), the existing `nodes` row is updated in-place. The UUID is preserved. A re-scan after the rename will call `upsert_node_pub` again with the new `code_ranges` JSON; the `ON CONFLICT` path fires and only `code_ranges` (and other mutable fields) are updated — no new UUID row is minted. Verified pattern matches DATA-04 requirement.

## Phase 2 Success Criterion 1 (edges + node_flows populated)

For any fixture sidecar with:
- `neighbors: [uuid-b, uuid-c]` → produces 2 rows in `edges` (source_uuid=<this>, target_uuid=uuid-b/c)
- `parent: uuid-p` → produces 1 row in `node_flows` (node_uuid=<this>, flow_uuid=uuid-p)

`SELECT COUNT(*) FROM edges` ≥ 1 and `SELECT COUNT(*) FROM node_flows` ≥ 1 for such a fixture. Criterion 1 is satisfied.

## TS ContractNode Shape — No Phase 1 Component Ripple

The only Phase 1 component that imported `ContractNode` was `GraphPlaceholder.tsx` (via `useState<ContractNode[]>`). Since `GraphPlaceholder` was rewritten in Task 3 (same file, new import of `pickAndOpenRepo`), there is no unintended breakage. No other Phase 1 component referenced `file_path` directly — the field was only in `types.ts`. `npx tsc --noEmit` confirms clean after the change.

## Next Phase Readiness

- **Plan 02-03** (file watcher): `RepoState` is already in managed state; `upsert_node_pub` is the canonical single-writer upsert; `refreshNodes()` in the graph store is the action the watcher fires on change events
- **Phase 3** (graph canvas): `get_nodes` returns real rows with `code_ranges` + `kind`; `graph.ts` store has `nodes: ContractNode[]` ready to feed the ReactFlow canvas
- **Phase 5** (MCP sidecar): `write_contract` is the single-writer command the MCP `update_contract` tool will invoke

---
*Phase: 02-contract-data-layer*
*Completed: 2026-04-24*

## Self-Check: PASSED

All created files exist on disk. All 3 task commits verified in git log (b46992d, 537f089, dc3431f). cargo test 3/3 green. npx tsc --noEmit clean.
