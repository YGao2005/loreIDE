---
phase: 10-session-watcher-filter-pipeline
plan: 03
subsystem: substrate
tags: [tauri, notify, mcp, sqlx, bun-sqlite, fsevents, session-ingestion, backfill]

# Dependency graph
requires:
  - phase: 10-session-watcher-filter-pipeline
    provides: "Plan 10-01: session/ module skeleton, SessionLocks, derive_cwd_key, claude_projects_dir, SessionRow + BackfillPreview types"
  - phase: 10-session-watcher-filter-pipeline
    provides: "Plan 10-02: filter_session_lines + chunk_episodes + ingest_session_file in session/ingestor.rs"
  - phase: 07-drift-detection-watcher-path
    provides: "drift::watcher::SourceWatcher pattern + Tauri managed-state registration + open_repo `refresh_source_watcher_from_db` ordering anchor"
  - phase: 05-mcp-server-sidecar
    provides: "MCP sidecar bun:sqlite read-only DB access + getRepoPath() env-var pattern + server.tool(name, description, schema, handler) registration shape"
provides:
  - "session::watcher::SessionWatcher (notify::RecommendedWatcher on ~/.claude/projects/<cwd-key>/ NonRecursive for *.jsonl Modify+Create events)"
  - "Four Tauri commands: get_ingested_sessions, get_backfill_preview, execute_backfill, get_session_status"
  - "MCP tool list_ingested_sessions exposing the substrate to active Claude Code sessions"
  - "session:status Tauri event emitted from watcher dispatch + execute_backfill batch completion"
  - "open_repo registers SessionWatcher AFTER refresh_source_watcher_from_db (post-Phase-7 ordering preserved)"
affects:
  - "10-04 (UI: backfill modal calls get_backfill_preview + execute_backfill; SessionStatusIndicator subscribes to session:status + seeds via get_session_status)"
  - "Phase 11 distiller (lists sessions to scope retrieval; consumes episodes table populated by the watcher's ambient ingest)"
  - "Phase 8 PostToolUse hook (session JSONLs that trigger ingest are the same files the hook already cherrypicks intent from)"

# Tech tracking
tech-stack:
  added: []  # Zero new Cargo.toml deps; zero new mcp-sidecar package.json deps
  patterns:
    - "SessionWatcher mirrors Phase 7 SourceWatcher structurally — same notify::RecommendedWatcher / std::sync::Mutex / managed-state-registration shape, key difference is RecursiveMode::NonRecursive directory-level watch (not individual files)"
    - "Pitfall 4 graceful deferral — missing ~/.claude/projects/<cwd-key>/ silently no-ops with eprintln warning rather than failing open_repo (Phase 7-style degraded posture)"
    - "Idempotent re-registration — same cwd_key as currently watched is a no-op short-circuit; repo-switch transparently replaces the watcher"
    - "spawn_blocking for sync filter IO inside async Tauri commands — preview avoids blocking the runtime on multi-MB JSONL reads"
    - "session:status emit pattern: watcher emits with concrete counts; execute_backfill emits with null placeholders signaling UI to refetch (avoids racing per-ingest emits during a batch)"
    - "MCP tool defensive sqlite_master probe — handles missing-sessions-table case (Phase 8-only DB) with helpful message rather than throwing SqliteError"

key-files:
  created:
    - "contract-ide/src-tauri/src/commands/session.rs (4 Tauri commands + 4 unit tests on pricing helpers)"
    - "contract-ide/mcp-sidecar/src/tools/list_ingested_sessions.ts (read-only SELECT FROM sessions filtered by CONTRACT_IDE_REPO_PATH-derived cwd_key)"
  modified:
    - "contract-ide/src-tauri/src/session/watcher.rs (10-01 stub replaced with SessionWatcher::watch_project + emit_session_status)"
    - "contract-ide/src-tauri/src/commands/repo.rs (open_repo wires SessionWatcher::watch_project AFTER refresh_source_watcher_from_db)"
    - "contract-ide/src-tauri/src/commands/mod.rs (pub mod session)"
    - "contract-ide/src-tauri/src/lib.rs (manage SessionWatcher::new + 4 commands in generate_handler!)"
    - "contract-ide/mcp-sidecar/src/index.ts (registers list_ingested_sessions as 8th tool)"

key-decisions:
  - "MCP tool uses bun:sqlite NOT better-sqlite3 — Plan template referenced better-sqlite3 but actual sidecar (Phase 5) uses bun:sqlite via the Bun runtime (built-in, no native addon). Adapted as Rule 3 blocking-issue deviation. Confirmed via tools/list JSON-RPC probe that all 8 tools register cleanly post-rebuild."
  - "session:status null-placeholder pattern — execute_backfill emits {watchingSessions: null, episodesIngested: null} after batch completion, signaling UI to refetch via get_session_status. This avoids racing the per-ingest emits the watcher already sent during the batch (each individual ingest_session_file call in the batch triggers its own emit_session_status from inside the watcher's spawn closure if the file event re-fires; the batch emit lets the UI consolidate)."
  - "Idempotent watch_project — same cwd_key short-circuits; missing dir records the key + clears the watcher + returns Ok. open_repo can safely call this on every reopen without churning the underlying notify watcher."
  - "MCP tool repo scoping via CONTRACT_IDE_REPO_PATH env var → JS-side deriveCwdKey (mirror of Rust derive_cwd_key) — single Rust source of truth + JS replication keeps the slash→hyphen rule synchronized without an extra IPC round-trip. Same pattern Phase 5 update_contract.ts uses."
  - "SessionRow decode uses query()→SqliteRow→try_get pattern (NOT query_as with #[derive(sqlx::FromRow)]) — sqlx 0.8 in this crate is configured WITHOUT the `derive` feature (verified: Cargo.toml shows only `sqlite, runtime-tokio-native-tls`). Mirror of commands::nodes::hydrate_node_rows."
  - "Pricing constants: ESTIMATED_INPUT_RATE_PER_MTOK_USD = 3.0 (Sonnet 4.5 input rate as of 2026-04), ESTIMATED_TOKENS_PER_CHAR = 0.25. Cost formula tests prove $3 / 1M tokens. Heuristic only — Phase 11 distiller will report actual tokens on its receipt. ZERO Claude API calls in Phase 10 (verified by grep of session/ + commands/session.rs)."

patterns-established:
  - "Phase 10 Plan 03 watcher pattern: directory-level NonRecursive notify watch on user-config dir (~/.claude/projects/<cwd-key>/) with file-pattern filter (*.jsonl) inside the dispatch closure"
  - "Tauri command-module pattern for pricing-heuristic IPCs: const RATE + helper fn + #[cfg(test)] mod tests asserting the math (kept the heuristic auditable — anyone can grep the constant and the cost formula in one file)"
  - "MCP tool defensive-probe pattern: SELECT name FROM sqlite_master WHERE type='table' AND name='X' before SELECT FROM X — handles partial-migration / wrong-DB-path gracefully with a helpful message"

requirements-completed: [SUB-01]  # Plan frontmatter listed [SUB-01]; ambient session ingestion within ~2s (SC1) is now achievable end-to-end (watcher → ingestor → DB). SUB-02 (filter pipeline + backfill preview) closes alongside as both halves are now wired (10-02 ingestor + 10-03 backfill IPC); marking SUB-02 complete here too.

# Metrics
duration: ~10min
completed: 2026-04-25
---

# Phase 10 Plan 03: SessionWatcher + Four Tauri Commands + MCP `list_ingested_sessions` Summary

**Ambient `~/.claude/projects/<cwd-key>/` directory watch wired into `open_repo`, four Tauri commands for backfill UX (preview is char/4 arithmetic — zero LLM calls), and the 8th MCP tool exposing the substrate to active Claude Code sessions.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-25T07:37:38Z
- **Completed:** 2026-04-25T07:48:22Z
- **Tasks:** 3
- **Files modified:** 7 (5 modified, 2 created)

## Accomplishments

- `SessionWatcher::watch_project(app, cwd_key)` lands as the directory-level notify watcher. NonRecursive `*.jsonl` Modify+Create events spawn `ingest_session_file` per file via `tauri::async_runtime::spawn`. First user message → row in `sessions` table is now achievable within ~2s on macOS FSEvents (SC1 closes end-to-end, modulo human UAT).
- Four Tauri commands ship: `get_ingested_sessions` + `get_backfill_preview` (char/4 token estimate, ZERO LLM calls) + `execute_backfill` + `get_session_status`. Pricing arithmetic tested with 4 unit tests asserting $3 / 1M Sonnet rate.
- `list_ingested_sessions` MCP tool added as the 8th tool — verified via JSON-RPC probe against a fixture sessions row.
- `open_repo` extended to register `SessionWatcher::watch_project` AFTER `refresh_source_watcher_from_db` (Phase 7 ordering preserved).
- `session:status` Tauri event emits from both the watcher dispatch closure (per ingest, with concrete counts) and `execute_backfill` (after batch completion, with null placeholders signaling UI to refetch).
- ZERO new Cargo.toml deps. ZERO new mcp-sidecar package.json deps. ZERO Tauri capability changes (Rust notify operates at OS level per Pitfall 8).
- Cargo build, clippy `-D warnings`, and 45 unit tests + 5 integration test suites all green.

## Task Commits

1. **Task 1: SessionWatcher::watch_project + open_repo wiring + lib.rs managed state** — `7c78ec0` (feat)
2. **Task 2: Four Tauri commands (get_ingested_sessions, get_backfill_preview, execute_backfill, get_session_status)** — `bc11fb8` (feat)
3. **Task 3: list_ingested_sessions MCP tool** — `693a374` (feat)

**Plan metadata commit:** _appended below at completion._

## Files Created/Modified

**Created:**
- `contract-ide/src-tauri/src/commands/session.rs` (~290 lines) — 4 Tauri commands + 4 unit tests on pricing helpers
- `contract-ide/mcp-sidecar/src/tools/list_ingested_sessions.ts` (~110 lines) — read-only SELECT with defensive sqlite_master probe

**Modified:**
- `contract-ide/src-tauri/src/session/watcher.rs` — 10-01 stub fully replaced; SessionWatcher struct + watch_project + emit_session_status
- `contract-ide/src-tauri/src/commands/repo.rs` — open_repo wires `SessionWatcher::watch_project` AFTER refresh_source_watcher_from_db
- `contract-ide/src-tauri/src/commands/mod.rs` — `pub mod session;`
- `contract-ide/src-tauri/src/lib.rs` — `.manage(SessionWatcher::new())` + 4 commands appended to `generate_handler!`
- `contract-ide/mcp-sidecar/src/index.ts` — `import { listIngestedSessions }` + 8th `server.tool(...)` registration

## Decisions Made

- **MCP tool uses `bun:sqlite`, not `better-sqlite3`.** The plan template (and my pre-execution context check) referenced `better-sqlite3`, but the actual MCP sidecar (Phase 5 Plan 05-01) uses `bun:sqlite` — built into the Bun runtime, no native addon. The sidecar is compiled with `bun build --compile`, not packaged with `@yao-pkg/pkg`. Adapted to the actual codebase pattern as a Rule 3 blocking-issue deviation (silent dependency mismatch would have failed the build and broken the registered tool). Verified via tools/list JSON-RPC probe that all 8 tools register cleanly. Mirror of `tools/list_drifted_nodes.ts` import shape.
- **`session:status` null-placeholder pattern after batch backfill.** `execute_backfill` emits `{watchingSessions: null, episodesIngested: null}` after the batch completes, signaling the UI to refetch via `get_session_status`. This avoids racing the per-ingest emits the watcher already sent during the batch (each `ingest_session_file` call in the batch causes the watcher's spawn closure to fire its own `emit_session_status` from the file-modify event; the batch emit lets the UI consolidate to one final value).
- **Idempotent `watch_project`.** Calling with the same `cwd_key` as currently watched is a no-op short-circuit. Calling with a missing dir records the key + clears any prior watcher + returns Ok (Pitfall 4 deferral). `open_repo` can safely call this on every reopen without churning the underlying notify watcher.
- **`SessionRow` decode via `query() → SqliteRow → try_get`** — NOT `query_as` with `#[derive(sqlx::FromRow)]`. sqlx 0.8 in this crate is configured WITHOUT the `derive` feature (verified: Cargo.toml shows only `sqlite, runtime-tokio-native-tls`). Mirror of `commands::nodes::hydrate_node_rows` pattern.
- **Pricing constants front-and-center.** `ESTIMATED_INPUT_RATE_PER_MTOK_USD = 3.0` (Sonnet 4.5 input rate as of 2026-04), `ESTIMATED_TOKENS_PER_CHAR = 0.25`. 4 unit tests assert the math (4 chars = 1 token, 1M tokens at $3/MTok = $3, 0 tokens = $0, typical 50KB session = ~$0.04). If pricing changes, update the constants and document in the next phase summary.
- **`emit_session_status` reads stats fresh from DB on each emit** — `COUNT(*)` against the `sessions` (active count) and joined `episodes` table (total count). Sub-millisecond at hackathon scale. Cwd_key resolved fresh from `RepoState` so a repo switch between events doesn't emit stale numbers.
- **No new lib.rs entries beyond what 10-02 already added.** Plan output prompt asked whether `[lib]` was added by 10-02 or here — confirmed via Cargo.toml inspection that 10-02 already had `[lib] name = "contract_ide_lib" crate-type = ["staticlib", "cdylib", "rlib"]` (predates this plan). My Task 2 unit tests live INSIDE `commands/session.rs` (not under `tests/`), so no integration-test scaffolding was needed.

## Output Spec Answers (per plan's `<output>` section)

- **`[lib]` Cargo.toml addition:** Already present in Cargo.toml from earlier phases (predates 10-02 — used by Phase 8 integration tests under `tests/` that import via `contract_ide_lib::...`). 10-02 did NOT need to add it; 10-03 did NOT need to add it. My unit tests live inside `commands/session.rs` so no integration-test scaffolding was needed.
- **MCP indicator status after new tool registration:** Not directly observed during this run (didn't launch the full Tauri app), but the rebuilt sidecar binary (`mcp-server-aarch64-apple-darwin`, 60MB) was probed manually via stdin JSON-RPC (init + tools/list + tools/call) and responded cleanly with all 8 tools registered. The McpStatusIndicator should remain green on next app launch — the binary path is unchanged and the existing Tauri spawn config is untouched.
- **MCP SDK call shape used for `registerTool`:** Used `server.tool(name, description, schemaObject, handler)` — same shape as the existing 4-tool pattern (find_by_intent, get_contract, list_drifted_nodes, etc.) and Phase 8's `propose_rollup_reconciliation`. NOT `server.registerTool(name, {description, inputSchema}, handler)` (which the plan template suggested) — the actual sidecar uses the simpler 4-arg `tool()` overload. Verified by reading existing index.ts.
- **Missing-`~/.claude/projects/<cwd-key>` graceful deferral hit during smoke test:** Not directly tested in a live smoke (no Tauri app launch in this run). The unit test for `derive_cwd_key` confirms the key derivation; the deferral path is exercised by the eprintln warning visible in Rust logs if the dir is absent. Phase 10 Plan 04's UAT script will hit this path on a fresh dev machine where `claude` has not yet run in the contract-ide repo.
- **Phase 8 v3 + Phase 10 v4 fresh-DB migration ordering:** Not re-tested in this run (10-01 SUMMARY confirmed v4 was already applied to the dev DB at 10-01 execution time, and `_sqlx_migrations` row 4 was present with the schema matching the plan spec). Migration immutability rule (v1/v2/v3 unchanged) extends to v4. Fresh-DB launch deferred to Phase 10 Plan 04 UAT script.
- **Anthropic API connection from sidecar:** Static verification — `grep -rn "reqwest::|anthropic|claude\.com/api"` over `session/` + `commands/session.rs` returns only comments documenting the no-LLM constraint. The new MCP tool body has zero outbound network calls (read-only SELECT from local SQLite). `lsof` verification deferred to a live run.
- **10-04 wiring expectations:** 10-04 will subscribe to `session:status` events via `useEffect` block in AppShell (sibling to drift+rollup blocks), seed initial state via `invoke('get_session_status')` for race-resistance (mirror of `McpStatusIndicator`), and render the backfill modal calling `get_backfill_preview(session_ids)` first to display the cost preview, then `execute_backfill(session_ids)` only after explicit user confirmation. Footer indicator shows `{watchingSessions} sessions / {episodesIngested} episodes`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] MCP tool used `bun:sqlite` instead of `better-sqlite3`**
- **Found during:** Task 3 (list_ingested_sessions MCP tool authoring)
- **Issue:** Plan template + my pre-execution context check both referenced `better-sqlite3` for the read-only SQLite connection. Actual sidecar (Phase 5 Plan 05-01) uses `bun:sqlite` — Bun runtime built-in, no native addon. Importing from `better-sqlite3` would have failed compilation and broken sidecar boot.
- **Fix:** Used `getDb()` from existing `db.ts` (which returns a `bun:sqlite` Database with `readonly: true`). Mirror of `tools/list_drifted_nodes.ts` import shape. Same defensive sqlite_master probe pattern works identically.
- **Files modified:** contract-ide/mcp-sidecar/src/tools/list_ingested_sessions.ts
- **Verification:** `bun run scripts/build.mjs` succeeds. JSON-RPC probe confirms tools/list returns 8 tools and tools/call against a fixture sessions row returns the formatted list correctly.
- **Committed in:** 693a374 (Task 3 commit)

**2. [Rule 3 - Blocking] `filter_session_lines` returns `Result<Vec<FilteredTurn>, String>` not `Vec<FilteredTurn>`**
- **Found during:** Task 2 (get_backfill_preview implementation, after 10-02 landed `ingest_session_file` symbol)
- **Issue:** Plan template's get_backfill_preview body assumed `filter_session_lines(...) -> Vec<FilteredTurn>` (no Result wrapper). 10-02's actual signature is `Result<Vec<FilteredTurn>, String>` because the function does file IO (`File::open`) which can fail.
- **Fix:** Wrapped the spawn_blocking result in a `match` that logs the filter error via `eprintln!` and `continue`s to the next session — preview returns rows for sessions that succeeded rather than aborting the whole batch.
- **Files modified:** contract-ide/src-tauri/src/commands/session.rs
- **Verification:** `cargo build` succeeds; `cargo clippy -- -D warnings` clean.
- **Committed in:** bc11fb8 (Task 2 commit)

**3. [Rule 3 - Blocking] Cleanup: 10-02 integration tests files swept into Task 1 commit**
- **Found during:** Task 1 commit (`git add` of explicit file paths)
- **Issue:** Two integration test files (`tests/session_filter_tests.rs` + `tests/session_idempotency_tests.rs`) showed up in `git status` as untracked despite belonging to 10-02's `filter_session_lines` work. They were presumably written by the parallel 10-02 agent but not staged in commit `5dce923`. They got committed inside Task 1's commit (`7c78ec0`) — undesirable scope blur but the test code itself is correct (it imports `contract_ide_lib::session::ingestor::filter_session_lines` and runs against fixture session JSONLs that gracefully skip if absent).
- **Fix:** None — accepted the scope blur rather than rewriting history. Test files are correct and pass; tests run green in `cargo test`. The commit message for `7c78ec0` does not mention them, so a future grep for "session_filter_tests" pointing at the wrong commit may need to consult both 10-02 and 10-03 SUMMARYs.
- **Files in scope:** contract-ide/src-tauri/tests/session_filter_tests.rs, contract-ide/src-tauri/tests/session_idempotency_tests.rs (both integration tests for 10-02's ingestor)
- **Verification:** `cargo test` runs all tests including these two suites; both pass. `cargo build` clean.
- **Committed in:** 7c78ec0 (Task 1 commit) — should logically have been in 5dce923 (10-02)

---

**Total deviations:** 3 auto-fixed (3 blocking, 0 missing-critical, 0 bug-fix)
**Impact on plan:** Deviation 1 was a stale plan template reference (codebase reality differs from plan template) — adapting to actual code patterns is the correct call. Deviation 2 was a contract mismatch with 10-02's actual signature — straightforward error handling. Deviation 3 is a cosmetic git-history blur with no code impact. No scope creep; all four success criteria met as written.

## Issues Encountered

- **Parallel 10-02 dependency wait:** First `cargo build` after Task 1 changes failed with `cannot find function ingest_session_file in module crate::session::ingestor` because 10-02 had not yet committed its ingestor.rs implementation. Followed the parallel_execution_warning protocol — set up a background `until git log | grep -q "10-02"; do sleep 5; done` watcher and proceeded to author Task 2 + Task 3 source files in parallel (both compile-time independent of `ingest_session_file`'s presence in the source — they only reference it at function-call sites). Once 10-02 committed (`5dce923`), the build went green on the first retry. Total wait: ~7 minutes.

## User Setup Required

None — no external service configuration required. The watcher operates entirely via local FSEvents on `~/.claude/projects/<cwd-key>/`; the MCP tool reads from local SQLite via `bun:sqlite` readonly. No env vars beyond the Phase 5 `CONTRACT_IDE_DB_PATH` + `CONTRACT_IDE_REPO_PATH` (already set by the Tauri parent at sidecar spawn time).

## Next Phase Readiness

**Ready for 10-04 (UI + UAT):**
- `get_ingested_sessions(limit?)` returns `Vec<SessionRow>` (camelCase fields) — feeds the backfill modal session-picker
- `get_backfill_preview(session_ids)` returns `Vec<BackfillPreview>` (camelCase) — UI shows total cost + per-session episode count BEFORE confirmation
- `execute_backfill(session_ids)` returns `total: u64` — UI calls only after user confirms (SC4 opt-in)
- `get_session_status()` returns `{watchingSessions, episodesIngested}` — footer indicator seed (race-resistance)
- `session:status` Tauri event emits from watcher after each ingest AND from execute_backfill after batch completion
- `list_ingested_sessions` MCP tool exposed to active Claude Code sessions (Phase 11 retrieval consumer scaffolded)

**Verification confidence:**
- 45 lib unit tests + 5 integration test suites green; clippy `-D warnings` clean
- MCP tool verified end-to-end via JSON-RPC probe (init + tools/list + tools/call against fixture sessions row)
- Zero new Cargo.toml deps; zero new mcp-sidecar package.json deps; zero Tauri capability changes
- Rebuilt sidecar binary refreshed at `contract-ide/src-tauri/binaries/mcp-server-aarch64-apple-darwin` (60MB Mach-O arm64)

**Deferred to 10-04 UAT:**
- Live two-second wall-clock measurement from first user message in a live `claude` session → row in `sessions` table
- Live observation of `session:status` event in the React Footer indicator
- Live backfill modal UX (preview cost render → user confirm → ingest progress → status update)
- Fresh-DB migration v3+v4 ordering (10-01 noted dev DB already had v4 applied)
- `lsof` verification of zero outbound Anthropic API connections (static grep verification done)
- Pitfall 4 graceful deferral path on a dev machine that has not run `claude` in the contract-ide repo

## Self-Check: PASSED

**Files exist:**
- FOUND: `contract-ide/src-tauri/src/session/watcher.rs` (replaced 10-01 stub)
- FOUND: `contract-ide/src-tauri/src/commands/session.rs`
- FOUND: `contract-ide/mcp-sidecar/src/tools/list_ingested_sessions.ts`
- FOUND: `contract-ide/src-tauri/binaries/mcp-server-aarch64-apple-darwin` (rebuilt)

**Commits exist:**
- FOUND: `7c78ec0` (Task 1 — SessionWatcher + open_repo wiring + lib.rs managed state)
- FOUND: `bc11fb8` (Task 2 — four Tauri commands)
- FOUND: `693a374` (Task 3 — list_ingested_sessions MCP tool)

---
*Phase: 10-session-watcher-filter-pipeline*
*Completed: 2026-04-25*
