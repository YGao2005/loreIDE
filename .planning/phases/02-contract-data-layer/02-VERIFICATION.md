---
phase: 02-contract-data-layer
verified: 2026-04-24T00:00:00Z
status: passed
score: 6/6 must-haves verified
re_verification: false
gaps: []
human_verification: []
---

# Phase 2: Contract Data Layer — Verification Report

**Phase Goal:** Contracts persist as UUID-stable sidecar `.md` files with full frontmatter (including `code_ranges` for fragment coverage), the startup scanner populates SQLite with all indexes + FTS5 from day 1, and the file watcher keeps the cache live.

**Verified:** 2026-04-24
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Startup scan populates `nodes`, `edges`, `node_flows`, and canonical rows; `get_nodes` IPC returns real data | VERIFIED | `scanner.rs:scan_contracts_dir` walks `.contracts/`, upserts via `ON CONFLICT(uuid) DO UPDATE`; `edges` and `node_flows` inserted per neighbor/parent/route; `get_nodes` SELECTs real rows including `code_ranges` and `kind` |
| 2 | `.contracts/<uuid>.md` sidecar with all 13 frontmatter fields round-trips intact | VERIFIED | `frontmatter.rs` defines `ContractFrontmatter` with all DATA-01 fields; `round_trip_preserves_every_field` unit test exercises every field including `code_ranges[{file,start_line,end_line}]` and post-fence horizontal-rule body survival |
| 3 | Renaming a source file updates `nodes.code_ranges[].file` without changing UUID; edge history preserved | VERIFIED | `upsert_node_pub` uses `ON CONFLICT(uuid) DO UPDATE SET code_ranges = excluded.code_ranges` — UUID is the PK, `code_ranges` is metadata that updates in place (`scanner.rs:123–158`) |
| 4 | Editing a sidecar on disk triggers watcher to update SQLite within 2 seconds without app restart | VERIFIED | `watcher.ts:54` passes `{ recursive: true, delayMs: 2000 }` to `watch()`; fires `invoke('refresh_nodes', { paths: mdPaths })`; `repo.rs:refresh_nodes` re-parses + calls `upsert_node_pub`; UAT confirmed 2-second latency |
| 5 | Duplicate UUIDs across `.contracts/` produce a visible error, not silent corruption | VERIFIED | `scanner.rs:74–82` checks `seen.insert(fm.uuid.clone())`, pushes `"Duplicate UUID {} in {}"` to `errors` vec and skips upsert; `GraphPlaceholder.tsx:68–74` renders error state with `ScanResult.errors` when `errorCount > 0` |
| 6 | Schema migrations are numbered files; all four required indexes and FTS5 virtual table present at first launch; no manual DB deletion needed | VERIFIED | `migrations.rs` v1 creates `idx_nodes_parent_uuid` (line 91), `idx_node_flows_flow` (line 94), `idx_receipts_node_uuid` (line 96), and `nodes_fts` FTS5 virtual table (line 101); v2 adds `code_ranges` + `kind` columns additively; `tauri-plugin-sql` tracked by version tuple — editing v1 is explicitly forbidden by file header comment |

**Score:** 6/6 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src-tauri/src/db/migrations.rs` | v1 + v2 migrations; v1 immutable | VERIFIED | v1 `create_core_tables` immutable per file header; v2 `add_code_ranges_and_kind` appended additively at line 112 |
| `src-tauri/src/sidecar/frontmatter.rs` | `ContractFrontmatter`, `CodeRange`, `parse_sidecar`, `write_sidecar`, round-trip tests | VERIFIED | 173 lines; all structs, parser, writer, and 3 unit tests present |
| `src-tauri/src/sidecar/mod.rs` | re-exports `pub mod frontmatter` | VERIFIED | line 8: `pub mod frontmatter` |
| `src-tauri/src/db/scanner.rs` | `scan_contracts_dir`, `upsert_node_pub` with edges+node_flows, dup-UUID detection | VERIFIED | 225 lines; `spawn_blocking` wraps walkdir; single `pub async fn upsert_node_pub`; dup detection via `HashSet`; edges at line 166, node_flows at line 191 |
| `src-tauri/src/commands/repo.rs` | `open_repo`, `get_repo_path`, `refresh_nodes` | VERIFIED | All three commands present; `refresh_nodes` at line 70; `fs_scope.allow_directory()` + macOS `/tmp` canonicalization at lines 40–45 |
| `src-tauri/src/commands/contracts.rs` | `write_contract` single-writer via temp+rename | VERIFIED | Atomic write via `.{uuid}.md.tmp` + `std::fs::rename` at lines 34–35; immediate `upsert_node_pub` at line 43 |
| `src-tauri/src/commands/nodes.rs` | `get_nodes` with real SQLite SELECT; `code_ranges` deserialized | VERIFIED | SELECT includes `code_ranges`, `kind`; JSON deserialization at lines 75–79 |
| `src-tauri/tauri.conf.json` | `plugins.fs.requireLiteralLeadingDot: false` | VERIFIED | Line 44: `"requireLiteralLeadingDot": false` |
| `src-tauri/capabilities/default.json` | `fs:allow-watch`, `fs:scope` with `**` globs | VERIFIED | Lines 15–18: `fs:allow-watch` + `fs:scope` with `{ "path": "**" }, { "path": "**/*" }` |
| `src/ipc/watcher.ts` | `startContractsWatcher`/`stopContractsWatcher`; `delayMs:2000` | VERIFIED | 68 lines; `delayMs: 2000` at line 54; `.md` filter at line 40; `invoke('refresh_nodes')` at line 46 |
| `src/ipc/repo.ts` | `pickAndOpenRepo` starts watcher post-scan | VERIFIED | Watcher started only after `invoke('open_repo')` succeeds (line 30); scan/watch race structurally prevented |
| `src/components/layout/GraphPlaceholder.tsx` | Real data from `getNodes()`; Open Repository button; watcher `onRefreshed` callback | VERIFIED | `getNodes()` called in `useEffect` (line 29); `handleOpenRepo` calls `pickAndOpenRepo` with `onRefreshed` (line 53–62); `stopContractsWatcher` on unmount (line 46) |
| `src/store/graph.ts` | `nodes: ContractNode[]`, `refreshNodes()` action | VERIFIED | `refreshNodes` async action at line 24 |
| `src/ipc/types.ts` | `ContractNode` with `code_ranges`, `kind`; no `file_path` | VERIFIED | `CodeRange` interface (line 7); `ContractNode` with `code_ranges: CodeRange[]` and `kind: string`; `file_path` absent |
| `src/ipc/contracts.ts` | `writeContract()` typed wrapper | VERIFIED | Wrapper invokes `write_contract` with typed `WriteContractParams` |
| `src-tauri/Cargo.toml` | `serde_yaml_ng = "0.10"`, `tauri-plugin-fs` with `watch` feature, `walkdir`, `uuid`, `sha2`, `hex`, `tauri-plugin-dialog` | VERIFIED | All deps present at lines 29–36; `serde_yaml_ng v0.10.0` confirmed via `cargo tree` |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `lib.rs` | `sidecar/frontmatter.rs` | `mod sidecar;` | WIRED | `lib.rs:7: mod sidecar;` |
| `lib.rs` | `commands::repo::refresh_nodes` | `generate_handler!` | WIRED | `lib.rs:31: commands::repo::refresh_nodes` |
| `repo.ts` | `watcher.ts` | `startContractsWatcher` post-scan | WIRED | `repo.ts:4` imports; called at line 30 after `invoke('open_repo')` resolves |
| `GraphPlaceholder.tsx` | `repo.ts` | `pickAndOpenRepo` onClick | WIRED | `GraphPlaceholder.tsx:53: await pickAndOpenRepo(...)` |
| `commands/repo.rs` | `db/scanner.rs` | `scan_contracts_dir` | WIRED | `repo.rs:47: scan_contracts_dir(&app, &path)` |
| `commands/repo.rs` | `db/scanner.rs` | `upsert_node_pub` in `refresh_nodes` | WIRED | `repo.rs:98: crate::db::scanner::upsert_node_pub(db, &fm, &body)` |
| `db/scanner.rs` | `sidecar/frontmatter.rs` | `parse_sidecar` | WIRED | `scanner.rs:7: use crate::sidecar::frontmatter::{parse_sidecar, ContractFrontmatter}` |
| `db/scanner.rs` | `edges` table | `INSERT OR IGNORE INTO edges` | WIRED | `scanner.rs:173–183`: INSERT with `source_uuid`, `target_uuid`, `edge_type` matching v1 schema |
| `db/scanner.rs` | `node_flows` table | `INSERT OR IGNORE INTO node_flows` | WIRED | `scanner.rs:200–218`: parent-flow and route-flow membership |
| `commands/contracts.rs` | `db/scanner.rs` | `crate::db::scanner::upsert_node_pub` | WIRED | `contracts.rs:43: crate::db::scanner::upsert_node_pub(db, &frontmatter, &body)` |
| `commands/nodes.rs` | `DbInstances` managed state | `app.state::<DbInstances>()` | WIRED | `nodes.rs:47: app.state::<DbInstances>()` |
| `migrations.rs` | `tauri-plugin-sql` migration vec | version 2 appended after v1 | WIRED | `migrations.rs:112: Migration { version: 2, description: "add_code_ranges_and_kind" }` |

---

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| SHELL-02 | User can open a repository via folder picker and the app indexes it | SATISFIED | `pickAndOpenRepo` in `repo.ts` invokes native dialog + `open_repo` Rust command; folder picker wired to `GraphPlaceholder` Open Repository button |
| DATA-01 | Contracts persist as `.contracts/<uuid>.md` with full YAML frontmatter including `code_ranges` | SATISFIED | `ContractFrontmatter` struct in `frontmatter.rs` has all 13 specified fields; `parse_sidecar`/`write_sidecar` round-trip verified by unit tests; `code_ranges: Vec<CodeRange>` with `{file, start_line, end_line}` |
| DATA-02 | On startup, app scans `.contracts/` and populates SQLite (`nodes`, `edges`, `node_flows`, `drift_state`, `receipts`, `receipt_nodes`) | SATISFIED | `scan_contracts_dir` in `scanner.rs` walks `.contracts/` via walkdir; upserts `nodes` + `edges` + `node_flows`; all six tables created in v1 migration including `drift_state`, `receipts`, `receipt_nodes` |
| DATA-03 | File watcher keeps SQLite cache in sync as sidecar files change on disk | SATISFIED | `watcher.ts` wraps `@tauri-apps/plugin-fs watch()` with `delayMs:2000`; calls `invoke('refresh_nodes')` on `.md` events; `requireLiteralLeadingDot: false` enables dot-directory watching; UAT confirmed 2s latency |
| DATA-04 | Node identity stable under rename/move — UUID is canonical, `code_ranges.file` is metadata | SATISFIED | `upsert_node_pub` uses `ON CONFLICT(uuid) DO UPDATE SET code_ranges = excluded.code_ranges`; UUID is the PRIMARY KEY; renaming source file path in sidecar updates the metadata row without minting a new UUID |
| DATA-06 | Phase 1 migrations create required indexes and FTS5 virtual table; schema changes ship as numbered migration files | SATISFIED | v1 migration includes `idx_nodes_parent_uuid` (line 91), `idx_node_flows_flow` (line 94), `idx_receipts_node_uuid` (line 96), `nodes_fts USING fts5` (line 101); v2 is a separate numbered migration; v1 immutability enforced by file comment |

**Note:** DATA-05 (ghost-ref generation) is explicitly deferred to Phase 3 per ROADMAP. `scanner.rs:220` contains `// TODO(Phase 3): rebuild_ghost_refs()` confirming this is a tracked deferral, not an omission.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `commands/repo.rs` | 66, 90 | `TODO(Phase 7)` — delete-event propagation to SQLite deferred | INFO | Intended deferral; documented in ROADMAP Phase 7; Phase 2 success criterion for DATA-03 explicitly covers edit events only, not delete events |
| `db/scanner.rs` | 220 | `TODO(Phase 3)` — `rebuild_ghost_refs()` deferred | INFO | Intended deferral per ROADMAP Phase 3; DATA-05 is marked deferred in REQUIREMENTS.md |

No blockers or warnings. Both TODOs are planned deferrals to later phases, not unfinished Phase 2 work.

---

### Schema Alignment Note

The v1 migration schema uses `source_uuid`/`target_uuid` for the `edges` table (`migrations.rs:49–50`). The plan template in `02-02-PLAN.md` initially suggested `from_uuid`/`to_uuid` column names — this was a plan-vs-implementation divergence that was correctly resolved during execution. The actual scanner code at `scanner.rs:166` and `scanner.rs:173` uses `source_uuid`/`target_uuid` matching the migration schema. No runtime error risk.

---

### Human Verification Required

None. All six success criteria are fully verifiable from the codebase. UAT results documented in `02-03-SUMMARY.md` confirm all five UAT steps passed against the running app and live SQLite.

---

## Summary

Phase 2 goal is fully achieved. Every required artifact exists, is substantive (no stubs), and is correctly wired into the call chain. The six ROADMAP success criteria map to verified implementations:

1. Startup scan populates all required SQLite tables; `get_nodes` returns real data via `scanner.rs` + `nodes.rs`
2. Full frontmatter round-trip verified by `frontmatter.rs` unit tests; all 13 DATA-01 fields present
3. UUID-stable upsert via `ON CONFLICT(uuid) DO UPDATE`; `code_ranges` updates without changing UUID
4. 2-second watcher latency via `delayMs:2000` in `watcher.ts`; `refresh_nodes` command in `repo.rs`
5. Duplicate UUID detection in `scan_contracts_dir`; visible error surfaced by `GraphPlaceholder`
6. v1 migration with all four mandated indexes and FTS5 virtual table; v2 as separate numbered migration; immutability enforced

All requirement IDs are physically realized: SHELL-02 (folder picker + scan flow), DATA-01 (frontmatter schema + sidecar I/O), DATA-02 (scanner + all six SQLite tables), DATA-03 (watcher + `requireLiteralLeadingDot:false`), DATA-04 (UUID-stable upsert), DATA-06 (migrations v1+v2 with indexes + FTS5).

---

_Verified: 2026-04-24_
_Verifier: Claude (gsd-verifier)_
