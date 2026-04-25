---
phase: 08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation
plan: "03"
subsystem: posttooluse-hook-and-journal
tags: [hook, journal, mcp-02, prop-03, three-pass-verification, claude-cli, fire-and-forget]
requires: [08-01]
provides: [posttooluse-hook, journal-jsonl, list-journal-entries-ipc, fire-and-forget-rederive]
affects: [08-06]
tech-stack:
  added: []
  patterns:
    - Bash hook reads PostToolUse payload from stdin via jq; tolerates missing fields
    - Per-UUID fire-and-forget claude -p subshells fully detached via `</dev/null >/dev/null 2>&1 & disown`
    - SQLite read-only query against nodes.code_ranges using json_each + json_extract
    - Mock-claude shim pattern for integration tests (PATH-prepended shim records invocations)
    - Permissive Rust JournalEntry struct with #[serde(flatten)] extra for forward-compat
key-files:
  created:
    - contract-ide/.claude/settings.json
    - contract-ide/.claude/hooks/post-tool-use.sh
    - contract-ide/src-tauri/src/commands/journal.rs
    - contract-ide/src-tauri/tests/hook_journal_tests.rs
    - contract-ide/src-tauri/tests/fixtures/hook_payload_write.json
    - contract-ide/src-tauri/tests/fixtures/hook_transcript_sample.jsonl
    - contract-ide/src-tauri/tests/fixtures/mock-claude.sh
    - contract-ide/src/ipc/journal.ts
  modified:
    - contract-ide/src-tauri/src/commands/mod.rs
    - contract-ide/src-tauri/src/lib.rs
decisions:
  - "Hook subshell FD redirection is load-bearing: `() </dev/null >/dev/null 2>&1 & disown`
    fully detaches stdin/stdout/stderr from the parent. Without `</dev/null` and full subshell
    redirection (not just `claude -p > /dev/null`), backgrounded subprocesses inherit the
    parent's stdout/stderr pipes and Rust callers using wait_with_output() block on those FDs
    until the children exit (caught via the timing test that runs mock-claude with sleep 5)."
  - "Mock-claude tests use a per-test shim dir held alive by the caller (TempDir owned by the
    test fn, passed as shim_holder to run_hook). Originally the shim dir was a local TempDir
    inside run_hook — when the parent exited fast (post FD-redirect fix), the shim dir got
    dropped (deleted) before the disowned subshell's exec could find `claude` on PATH.
    Same class of bug as Phase 7 race-safe async store actions — lifecycle of resources must
    survive past the spawn."
  - "Tail-of-transcript intent extraction (`tac` on Linux, `tail -r` on macOS, fallback chain
    detected at runtime) avoids O(N) reads at multi-MB session sizes. The dev machine ships
    `tail -r` (BSD coreutils); `tac` is available via brew but not by default on macOS."
  - "DB path discovery: CONTRACT_IDE_DB_PATH env override (used by tests + headless invocations)
    with fallback to `$HOME/Library/Application Support/com.contract-ide.app/contract-ide.db`.
    Hook tolerates missing DB (returns affected_uuids: []) so first-launch agent runs don't
    crash before the app has booted."
  - "Defensive `set -u` + `trap 'exit 0' ERR` envelope: hook MUST exit 0 on every path so a
    bug in the hook can never break the user's agent flow mid-demo. Risky calls wrapped with
    `|| true`; jq calls write to /dev/null on stderr."
  - "Per-UUID rederive prompt is identical across calls — fresh-eyes Pass 2 fetches the sidecar
    body itself, derives a new contract from observed code, and instructs the LLM to preserve
    `## Intent` and `## Role` verbatim while only rewriting `## Examples` and `## Implicit
    Decisions`. SKIPPED-PINNED short-circuits silently (pinned contracts surface drift, not
    auto-update)."
  - "No new write paths: the hook is a *client* of the existing update_contract MCP tool
    (Phase 5) which is itself a client of the existing write_contract Rust path (Phase 7
    DriftLocks-coordinated). Pitfall 2 reframed — single-writer means mutex coordination,
    not exclusive writer existence. Both writers (hook→claude-p AND active session direct)
    coexist."
metrics:
  duration_minutes: 18
  tasks_completed: 2
  files_changed: 10
  completed_date: "2026-04-25"
  test_count: 13
---

# Phase 08 Plan 03: PostToolUse Hook + Journal IPC

## What shipped

**Task 1 — Hook script + Claude settings + integration tests (commit 20c65bf):**
- `contract-ide/.claude/settings.json` registers `PostToolUse` hooks matching `Write|Edit|MultiEdit` and points at the project-relative `$CLAUDE_PROJECT_DIR/.claude/hooks/post-tool-use.sh`.
- `contract-ide/.claude/hooks/post-tool-use.sh` (118 lines, executable, no shellcheck-blocking warnings) implements the six-phase flow: parse stdin payload → check file_path is inside cwd → mkdir journal dir → SQLite-lookup affected UUIDs → tail-of-transcript intent extraction with headless fallback → JSONL append (Pass 1) → per-UUID detached `claude -p` subshells (Pass 2) → exit 0.
- 8 Rust integration tests in `tests/hook_journal_tests.rs` exercise the hook via `bash` + stdin pipe with a per-test sqlite DB seeded with code_ranges, a per-test `claude` shim that records its invocations to MOCK_CLAUDE_LOG, and a per-test temp cwd. Coverage: journal-line shape (assert each field), mkdir-on-first-call, transcript intent extraction, headless fallback, out-of-cwd skip, missing-DB graceful exit, per-UUID spawn count (asserts 2 spawns for 2 UUIDs), and backgrounded-not-blocking timing (asserts hook returns < 1500ms even when mock-claude sleeps 5s × 3 UUIDs).

**Task 2 — list_journal_entries Rust IPC + TS wrapper (commit 4b1522e):**
- `contract-ide/src-tauri/src/commands/journal.rs` exposes `list_journal_entries(uuid?, since_ts?, limit?) -> Vec<JournalEntry>` via Tauri command. Reads `.contracts/journal/*.jsonl` under the open repo, parses each line with `#[serde(flatten)] extra` capturing unknown fields for Phase 10 forward-compat, skips malformed lines with eprintln warning, filters + sorts descending by ts + truncates to limit (default 50, max 500).
- 5 unit tests cover: unknown-field tolerance, malformed-line skip, uuid filter, since_ts filter, limit truncation.
- `contract-ide/src/ipc/journal.ts` wraps the IPC for the React side. 08-06 will consume directly.
- Registered in `commands/mod.rs` and `lib.rs::generate_handler!`.

## Verification

- `cargo test`: 33 + 8 + 5 + others, all green (full project test suite passes).
- `cargo clippy --all-targets -- -D warnings`: clean.
- `npx tsc --noEmit`: clean.
- Manual smoke (in-orchestrator): seeded a temp DB with 1 node whose code_ranges covered foo.ts, ran the hook against a synthetic payload — journal line written with correct shape, claude shim invoked once with the expected `update_contract` prompt, hook exited within ~50ms.

## Three-pass verification model — what's now live

| Pass | Owner | Status |
|------|-------|--------|
| 1 — subjective truth (intent record) | Hook script JSONL append | ✓ shipped this plan |
| 2 — objective truth (code-derived examples) | Per-UUID `claude -p` → update_contract MCP | ✓ shipped this plan (rederive runs ~10-30s in background) |
| 3 — alignment truth (intent vs observed) | Phase 11 verifier | not yet — Beat 3's "Verify against intent" panel |

## Latency expectations (documented for SUMMARY consumers)

- **Pass 1:** journal line on disk within < 100ms of agent's Write tool call. Tests assert this implicitly (hook total runtime < 1500ms with three 5s-sleeping mock spawns).
- **Pass 2:** rederived contract body on disk within ~10-30s of the agent's write. Visible behavior: graph node briefly pulses red (Phase 7 watcher fires drift on the .ts/.tsx write) then returns to fresh (Pass 2 rederive completes, contract matches code, drift clears).
- **Pinned nodes:** Pass 2 spawn fires, `update_contract` returns SKIPPED-PINNED, contract body unchanged → red drift persists indefinitely until the user manually reconciles.
- **Missing claude CLI:** Pass 2 spawn fails silently (subshell errors swallowed), user sees red drift only — explicit, not silent fake-fresh.

## Manual UAT pending (deferred to 08-06's full Phase 8 UAT script)

The plan called for a manual end-to-end UAT (run `/hooks` in a real Claude Code session, write a real file, observe contract catching up). That UAT is part of 08-06's Phase 8 E2E script — sequenced last so all wiring (rollup amber, agent loop streaming, cherrypick) can be exercised in one demo-bar dry run. Implementation-level verification (`cargo test` + manual smoke) covers the per-plan readiness gate.

## Phase 8 dependency surface for 08-06

- `list_journal_entries` IPC ready for the reconcile panel's DraftPropagationDiff context fetch.
- `JournalEntry.affected_uuids` filter supports per-node history rendering.
- Journal files are append-only and per-session — git merge ordering is unambiguous (PROP-03).
