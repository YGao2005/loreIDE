---
phase: 10-session-watcher-filter-pipeline
verified: 2026-04-25T09:15:00Z
status: passed
score: 4/4 must-haves verified
---

# Phase 10: Session Watcher + Filter Pipeline Verification Report

**Phase Goal:** An ambient watcher ingests Claude Code JSONL sessions, filters to conversational content, and chunks into episodes ready for distillation.
**Verified:** 2026-04-25T09:15:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Success Criteria from ROADMAP)

| #   | Truth (SC)                                                                                                                                                                       | Status     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Starting a `claude` session in any watched project directory causes a row to appear in `sessions` table within 2s of the first user message — verified end-to-end against a live session | ✓ VERIFIED | `SessionWatcher::watch_project` (`session/watcher.rs:65`) registers `notify::RecommendedWatcher` with `RecursiveMode::NonRecursive` on `~/.claude/projects/<cwd-key>/`; `EventKind::Modify\|Create` events dispatch to `tauri::async_runtime::spawn(ingest_session_file(...))` (`watcher.rs:125-126`). `open_repo` wires `SessionWatcher::watch_project` after `refresh_source_watcher_from_db` (`commands/repo.rs:71-81`). UAT Step 1 PASSED — 1 session + 2 episodes inserted; footer ticked from 0/0 to 1/2 within seconds. d6f3444 fixed FK ordering bug found during UAT. |
| 2   | Filtering reduces a 1MB JSONL to <50KB conversational text with zero loss of user/assistant message content; regression-tested against the two kernel-experiment fixtures        | ✓ VERIFIED | `filter_session_lines` (`session/ingestor.rs:49`) ports the jq filter rules — keeps non-meta user (plain string not starting with `<`) + assistant text-block content; skips tool_use/tool_result/thinking/system/attachment/last-prompt/queue-operation/file-history-snapshot. Live cargo test results: **5f44** 642KB → 9,824 chars (94% reduction); **efadfcc4** 1,332KB → 24,038 chars (98% reduction) — both well under 50KB. `cargo test --test session_filter_tests`: 6/6 PASS (3 real-fixture content-preservation + 3 synthetic edge cases including offset). |
| 3   | Episode-chunk boundaries (tool-use/response pair = episode) are stable across re-ingestion of the same JSONL — idempotent                                                        | ✓ VERIFIED | `compute_episode_id(session_id, start_line) = sha256(...)` (`ingestor.rs:220`) is deterministic. `INSERT OR IGNORE INTO episodes` PK guards against duplicates (`ingestor.rs:335`). `cargo test --test session_idempotency_tests`: 2/2 PASS (`re_ingesting_same_file_produces_no_duplicate_episodes` + `session_upsert_preserves_started_at_increments_episode_count`). UAT Step 3 PASSED — touch-replay of session JSONL produced 0 new rows. |
| 4   | Opt-in backfill command shows a per-session token-cost preview before running; nothing ingests automatically without confirmation                                                | ✓ VERIFIED | `BackfillModal` (`components/session/BackfillModal.tsx`) implements three-step state machine: `select` → `preview` (calls `getBackfillPreview`) → `confirming` (calls `executeBackfill` only on "Confirm & Ingest" button click at line 299). `get_backfill_preview` Rust IPC (`commands/session.rs:131`) computes `chars/4` heuristic via `spawn_blocking(filter_session_lines)` then estimates cost = `tokens * $3 / 1M`. SC4 opt-in is structurally enforced: `executeBackfill` has only one call site (`confirmExecute()` handler bound to Confirm button). UAT Step 4 PASSED + lsof showed zero Anthropic API connections. |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact                                                                                          | Expected                                                                          | Status     | Details                                                                              |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------ |
| `contract-ide/src-tauri/src/db/migrations.rs`                                                     | v4 migration `phase10_sessions_and_episodes`                                      | ✓ VERIFIED | v1/v2/v3/v4 in order at lines 23/113/131/173; `phase10_sessions_and_episodes` at 174 |
| `contract-ide/src-tauri/src/session/mod.rs`                                                       | Module surface declarations                                                       | ✓ VERIFIED | All 5 sub-modules declared, 21 lines                                                  |
| `contract-ide/src-tauri/src/session/state.rs`                                                     | `SessionLocks` DashMap                                                            | ✓ VERIFIED | `pub struct SessionLocks(pub DashMap<String, Arc<Mutex<()>>>)` + `for_session()`     |
| `contract-ide/src-tauri/src/session/types.rs`                                                     | `FilteredTurn`, `Episode`, `SessionRow`, `BackfillPreview`                        | ✓ VERIFIED | All 4 types present; `SessionRow`/`BackfillPreview` use `#[serde(rename_all = "camelCase")]` |
| `contract-ide/src-tauri/src/session/cwd_key.rs`                                                   | `derive_cwd_key` helper + `claude_projects_dir`                                   | ✓ VERIFIED | Pure helper + 5 unit tests                                                            |
| `contract-ide/src-tauri/src/session/ingestor.rs`                                                  | `filter_session_lines`, `chunk_episodes`, `compute_episode_id`, `ingest_session_file` | ✓ VERIFIED | All 4 public fns + `ensure_session_row` helper; 506 lines (>180 min)                  |
| `contract-ide/src-tauri/src/session/watcher.rs`                                                   | `SessionWatcher::watch_project` with NonRecursive notify                          | ✓ VERIFIED | `pub struct SessionWatcher` + `pub fn watch_project`; 236 lines (>70 min)             |
| `contract-ide/src-tauri/src/commands/session.rs`                                                  | 5 Tauri commands (added list_historical_session_files in 10-04)                   | ✓ VERIFIED | All 5 `#[tauri::command]` annotations; pricing constants present; 441 lines (>150 min) |
| `contract-ide/src-tauri/tests/session_filter_tests.rs`                                            | Filter regression tests (kernel fixtures + synthetic)                             | ✓ VERIFIED | 6/6 tests PASS; 287 lines                                                              |
| `contract-ide/src-tauri/tests/session_idempotency_tests.rs`                                       | Idempotency tests via in-memory SQLite                                            | ✓ VERIFIED | 2/2 tokio tests PASS; 200 lines                                                       |
| `contract-ide/mcp-sidecar/src/tools/list_ingested_sessions.ts`                                    | MCP tool reading `sessions` filtered by `cwd_key`                                 | ✓ VERIFIED | `FROM sessions WHERE cwd_key = ?` + defensive `sqlite_master` probe; 136 lines        |
| `contract-ide/src/ipc/session.ts`                                                                 | 5 TS wrappers + camelCase types                                                   | ✓ VERIFIED | All 5 exports: `getIngestedSessions`, `getBackfillPreview`, `executeBackfill`, `getSessionStatus`, `subscribeSessionStatus` |
| `contract-ide/src/store/session.ts`                                                               | Zustand `useSessionStore` (status + backfillModalOpen)                            | ✓ VERIFIED | Both slices present + 4 actions                                                       |
| `contract-ide/src/components/layout/SessionStatusIndicator.tsx`                                   | Footer indicator: seed-from-IPC + subscribe-to-event                              | ✓ VERIFIED | Both `getSessionStatus` (mount seed) + `subscribeSessionStatus` (event handler) wired; 87 lines |
| `contract-ide/src/components/session/BackfillModal.tsx`                                           | shadcn Dialog three-step UX                                                       | ✓ VERIFIED | Three states `select`/`preview`/`confirming`; "Confirm & Ingest" button gates `executeBackfill`; 311 lines |
| `contract-ide/src/components/layout/AppShell.tsx`                                                 | Mounts `SessionStatusIndicator` + `BackfillModal`                                 | ✓ VERIFIED | Both imported + mounted (lines 23-25, 290, 297)                                       |
| `contract-ide/src-tauri/src/lib.rs`                                                               | `pub mod session` + 5 commands in `generate_handler!` + 2 managed states          | ✓ VERIFIED | `pub mod session` (line 9); `SessionLocks::default()` + `SessionWatcher::new()` managed (lines 33-34); all 5 commands registered (lines 62-66) |
| `contract-ide/src-tauri/src/commands/repo.rs`                                                     | `open_repo` calls `SessionWatcher::watch_project` after Phase 7 watcher refresh   | ✓ VERIFIED | `derive_cwd_key` + `session_watcher.watch_project` at lines 78-81 (Plan 10-03 marker) |
| `contract-ide/src-tauri/src/commands/mod.rs`                                                      | `pub mod session;`                                                                | ✓ VERIFIED | Declared at line 21                                                                   |
| `contract-ide/mcp-sidecar/src/index.ts`                                                           | `list_ingested_sessions` tool registered                                          | ✓ VERIFIED | Import at line 12, registration at lines 99-110                                       |

### Key Link Verification

| From                                                | To                                              | Via                                                                       | Status   | Details                                                                                                                |
| --------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `migrations.rs`                                     | tauri-plugin-sql runtime                        | v4 appended to `get_migrations()` Vec                                     | ✓ WIRED  | v1/v2/v3/v4 in correct order; tables verified live in dev DB per 10-01-SUMMARY                                          |
| `session/state.rs::SessionLocks::for_session`       | `session/ingestor.rs::ingest_session_file`      | `let mutex = locks.for_session(&session_id); let _guard = mutex.lock().await;` | ✓ WIRED  | `for_session` called at `ingestor.rs:259`                                                                              |
| `session/cwd_key.rs::derive_cwd_key`                | `commands/repo.rs::open_repo`                   | `let cwd_key = derive_cwd_key(&path); session_watcher.watch_project(...)` | ✓ WIRED  | Called at `commands/repo.rs:78` then `watch_project` at line 80                                                         |
| `session/watcher.rs::SessionWatcher::watch_project` | `session/ingestor.rs::ingest_session_file`      | `tauri::async_runtime::spawn(ingest_session_file(app, session_id, path))` | ✓ WIRED  | `tauri::async_runtime::spawn` at `watcher.rs:125`; `ingest_session_file` call at line 126                              |
| `session/ingestor.rs::ingest_session_file`          | `episodes` table (idempotency primitive)         | `INSERT OR IGNORE INTO episodes`                                          | ✓ WIRED  | At `ingestor.rs:335`; `ON CONFLICT(session_id) DO UPDATE` for sessions row at line 373                                  |
| `commands/session.rs::execute_backfill`             | `session/ingestor.rs::ingest_session_file`      | `for session_id in session_ids { ingest_session_file(...).await }`        | ✓ WIRED  | Sequential iteration at lines 220-275; emits `session:status` after batch                                              |
| `commands/session.rs::get_backfill_preview`         | `session/ingestor.rs::filter_session_lines`     | `tokio::task::spawn_blocking(filter_session_lines(...))`                  | ✓ WIRED  | At `commands/session.rs:174-175` — sync filter offloaded from async runtime                                            |
| `session/watcher.rs::emit_session_status`           | `session:status` Tauri event                    | `app.emit("session:status", payload)`                                     | ✓ WIRED  | At `watcher.rs:230`                                                                                                    |
| `SessionStatusIndicator`                            | `session:status` Tauri event + `getSessionStatus` IPC | `subscribeSessionStatus + getSessionStatus on mount` (race-resistant)     | ✓ WIRED  | Both seed (line 35) AND subscribe (line 43) per `McpStatusIndicator` pattern                                            |
| `BackfillModal::confirmExecute`                     | `executeBackfill` IPC                           | Wrapped in single handler bound to "Confirm & Ingest" button onClick      | ✓ WIRED  | `setStep('confirming')` + `executeBackfill(ids)` at lines 129-133; sole call site (SC4 structural enforcement)         |
| `mcp-sidecar/list_ingested_sessions.ts`             | `sessions` table (read-only)                    | `getDb()` (bun:sqlite readonly) + `SELECT FROM sessions WHERE cwd_key`    | ✓ WIRED  | Defensive `sqlite_master` probe + read-only SELECT; no INSERT/UPDATE/DELETE; no console.log                            |

### Requirements Coverage

| Requirement | Source Plan(s)              | Description                                                                                                                                       | Status      | Evidence                                                                                                                                                                            |
| ----------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SUB-01      | 10-01, 10-03, 10-04         | Ambient session watcher detects new `~/.claude/projects/<cwd-key>/*.jsonl` files within 2s of first user message; appends row to `sessions` table | ✓ SATISFIED | `SessionWatcher::watch_project` (notify NonRecursive) → `tauri::async_runtime::spawn(ingest_session_file)` → `INSERT OR IGNORE` into `sessions` (after FK fix d6f3444). UAT Step 1 PASSED with row + 2 episodes appearing live; footer ticked. REQUIREMENTS.md marked Complete. |
| SUB-02      | 10-01, 10-02, 10-04         | Filter pipeline reduces 1MB JSONL → <50KB without losing user/assistant content; episode chunking idempotent; opt-in backfill cost preview        | ✓ SATISFIED | (a) Filter: 5f44 642KB→9.6KB (94%), efadfcc4 1.3MB→24KB (98%), 6/6 content-preservation tests PASS. (b) Idempotency: `compute_episode_id` deterministic + `INSERT OR IGNORE` PK; 2/2 tokio tests PASS + UAT Step 3 PASSED touch-replay. (c) Backfill: `BackfillModal` three-step UX gates `executeBackfill` to single Confirm onClick; `get_backfill_preview` is `chars/4 * $3/MTok` arithmetic with no LLM call; UAT Step 4 + lsof PASSED. REQUIREMENTS.md marked Complete. |

**Coverage:** 2/2 declared requirements satisfied. No orphaned requirements — REQUIREMENTS.md only maps SUB-01 + SUB-02 to Phase 10.

### Anti-Patterns Found

| File                                                              | Line | Pattern                                  | Severity | Impact                                                                                                                                                  |
| ----------------------------------------------------------------- | ---- | ---------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contract-ide/src-tauri/src/session/watcher.rs`                   | 179  | "null placeholders" mention (doc only)   | ℹ️ Info  | Doc comment describing the `session:status` null-payload semantics for execute_backfill batch path. Not a stub — documents the explicit refetch protocol. |
| `contract-ide/src-tauri/src/commands/session.rs`                  | 251  | "null placeholders" mention (doc only)   | ℹ️ Info  | Same protocol doc; corresponds to `execute_backfill` post-batch emit. Not a stub.                                                                       |

No blocking or warning anti-patterns. The "return null" hits in `SessionStatusIndicator.tsx` resolve to the null-payload conditional check (`if (ev.watchingSessions === null || ev.episodesIngested === null)`), not stubbed implementations.

### Zero Claude API Calls Verification (Phase 10 SC)

`grep -nE "reqwest|anthropic|claude\.com"` over `session/` + `commands/session.rs`:
- `session/ingestor.rs:12` — `//! SAFETY: this module makes ZERO Claude API calls. No reqwest, no Anthropic`
- `session/ingestor.rs:251` — `/// SAFETY: makes ZERO Claude API calls. No reqwest::Client. Pure parse + DB.`
- `commands/session.rs:16` — `//! summary. No reqwest::Client. No anthropic crate.`

All 3 hits are documentation comments asserting the no-LLM constraint. No actual `reqwest::Client`, Anthropic SDK, or claude.com URL usage. UAT Step 4 user-verified `lsof` confirmed zero outbound Anthropic API connections during ingestion.

### No Tauri Capability Changes (Pitfall 8)

`git diff tauri.conf.json capabilities/default.json` returned empty — Rust notify operates at OS level, no fs scope changes for `~/.claude/`.

### Commits Verified

All 9 phase 10 commits present in `git log`:
- `0035334` — Task 10-01.1 migration v4
- `eb2f36e` — Task 10-01.2 session module scaffold
- `5dce923` — Task 10-02.1 ingestor implementation
- `7c78ec0` — Task 10-03.1 SessionWatcher + open_repo wiring
- `bc11fb8` — Task 10-03.2 four Tauri commands
- `693a374` — Task 10-03.3 list_ingested_sessions MCP tool
- `691c966` — Task 10-04.1 TS IPC + store + footer indicator
- `e74a94d` — Task 10-04.2 BackfillModal + list_historical_session_files
- `d6f3444` — Gap-closure FK fix (caught during UAT Step 1)

### Build Health

- `cd contract-ide/src-tauri && cargo build` → exits 0 (clean)
- `cargo test --test session_filter_tests --test session_idempotency_tests` → **8/8 PASS** (6 filter + 2 idempotency)
- 10-04-SUMMARY documents `cargo build && cargo clippy -- -D warnings && npm run tsc && (cd ../mcp-sidecar && npm run build)` all green at plan close

### Human Verification Already Completed (UAT in 10-04)

All four UAT steps were live-tested by the user during Plan 10-04 Task 3 (blocking checkpoint). User typed "approved":
1. **SC1 live latency** — first user message in fresh `claude` session produced 1 sessions row + 2 episodes within seconds; footer ticked from 0/0 to 1/2 live (after d6f3444 FK fix)
2. **SC2 filter regression** — `cargo test --test session_filter_tests` 6/6 PASS with content-preservation + size targets met
3. **SC3 idempotent re-ingest** — touch-replay produced 0 new rows; in-memory tests 2/2 PASS
4. **SC4 opt-in backfill** — `BackfillModal` two-step preview→confirm executed end-to-end; `lsof` against app + sidecar returned EMPTY for Anthropic endpoints

No additional human verification required.

### Gaps Summary

None. All 4 success criteria, all 20 declared artifacts, all 11 key links, and both declared requirements (SUB-01, SUB-02) are satisfied. The phase delivered the goal: an ambient watcher ingests Claude Code JSONL sessions, filters to conversational content, and chunks into episodes ready for distillation.

The single bug found during UAT (FK constraint ordering in `ingest_session_file` for fresh JSONLs) was fixed inline via commit d6f3444 and re-tested live. Test-coverage gap captured in 10-04-SUMMARY for Phase 13 polish (no-pre-seed test variant for ingestion paths).

Phase 11 distiller has a complete substrate to consume:
- `episodes.filtered_text` formatted as `[User]: ...\n[Assistant]: ...` for prefix-split convenience
- `episodes.episode_id` stable across re-ingest as a re-distill cache key
- `episodes.content_hash` for change-detection on re-distill decisions
- `sessions.cwd_key` for repo-scoped retrieval

---

_Verified: 2026-04-25T09:15:00Z_
_Verifier: Claude (gsd-verifier)_
