---
phase: 08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation
plan: "04a"
subsystem: agent-loop
tags: [agent-runner, jsonl-parser, receipts, prompt-assembler, AGENT-01, AGENT-02, AGENT-03, W3, I2]
requires: [08-01]
provides: [run_agent-command, parse_session_jsonl, parse_and_persist, list_receipts_for_node, assemble_prompt, encode_cwd]
affects: [08-04b, 11-delegate-button]
tech-stack:
  added: []
  patterns:
    - defensive-jsonl-parser (line-by-line, never panics, mock fallback on any error)
    - Instant::now() delta wall_time_ms (W3 fix - not JSONL-timestamp-derived)
    - CommandChild tracking in Tauri-managed state (I2 insurance)
    - session-id dual-path discovery (stream-json field + snapshot-diff fallback)
    - SQLite edges table for neighbor lookup (AGENT-01 - no whole-repo grep)
key-files:
  created:
    - contract-ide/src-tauri/src/agent/mod.rs
    - contract-ide/src-tauri/src/agent/prompt_assembler.rs
    - contract-ide/src-tauri/src/commands/agent.rs
    - contract-ide/src-tauri/src/commands/receipts.rs
    - contract-ide/src-tauri/tests/jsonl_parser_tests.rs
    - contract-ide/src-tauri/tests/fixtures/session_real.jsonl
    - contract-ide/src-tauri/tests/fixtures/session_truncated.jsonl
    - contract-ide/src-tauri/tests/fixtures/session_unknown_types.jsonl
  modified:
    - contract-ide/src-tauri/src/commands/mod.rs
    - contract-ide/src-tauri/src/lib.rs
decisions:
  - "CLI flag set confirmed: claude -p --output-format stream-json --verbose (NOT --include-partial-messages). The --include-partial-messages flag is NOT recognized by this version of claude CLI (v2.1.119) when combined with --print mode. The --verbose flag is required for stream-json to work with -p."
  - "session_id discovery primary path: stream-json events expose session_id at .session_id field on system/init and result lines. Both stream discovery and snapshot-diff fallback implemented — stream-json is primary since it's available from the first event."
  - "Session JSONL file format (real file): uses camelCase sessionId (not session_id), usage is nested under .message.usage, tool_use blocks are in .message.content[i]. This differs from the streaming output format which uses .session_id snake_case. Parser reads real file format."
  - "encode_cwd verified against real ~/.claude/projects/ directory: /Users/yang/lahacks/contract-ide maps to -Users-yang-lahacks-contract-ide (leading / becomes -, all / become -)."
  - "Cost rates committed 2026-04: opus-4-7 (15.00/75.00 per 1M), sonnet-4-5 (3.00/15.00 per 1M), haiku-4 (1.00/5.00 per 1M) per Anthropic published rates."
  - "08-03 journal integration: stub used (empty list). Journal layer was not available at 08-04a integration time. Prompt assembler has a TODO comment for 08-03 integration — graceful degradation per CONTEXT.md."
  - "W3 confirmed: wall_time_ms measured via Instant::now() around spawn. The JSONL started_at and finished_at timestamps are available independently as receipt metadata but wall_time_ms is explicitly the Instant delta, not their difference."
  - "B-fix implemented: touched_files extracted from Write/Edit/MultiEdit tool_use blocks (not Read). nodes_touched column populated via SQLite lookup against code_ranges. receipt_nodes join table also populated for forward-compat."
metrics:
  duration_minutes: 35
  tasks_completed: 2
  files_changed: 10
  completed_date: "2026-04-25"
---

# Phase 08 Plan 04a: Rust Agent Runner + Defensive JSONL Parser + Receipts Persistence Summary

**One-liner:** claude CLI runner with stream-json streaming, defensive JSONL parser with mock fallback, cost-rate constants, prompt assembler reading from SQLite edges/nodes + sidecars (AGENT-01 invariant), and receipt persistence using 08-01 merged column list (tool_call_count, estimated_cost_usd).

## What Was Built

### Task 1: Day-1 Spike — claude CLI Verification + Fixtures

**Verified CLI flag set:**

```bash
claude -p "prompt" --output-format stream-json --verbose
```

Key findings:
- `--include-partial-messages` is NOT valid for `-p` mode in claude v2.1.119. The correct flag is `--verbose` which enables stream-json output with `-p`.
- `session_id` is exposed in stream events at `.session_id` (snake_case) on the `system` and `result` type lines — present from the FIRST event.
- The real session JSONL files at `~/.claude/projects/<encoded-cwd>/` use a DIFFERENT format from the streaming output: `sessionId` (camelCase), usage under `.message.usage`, tool_use in `.message.content[i]`.

**Session JSONL file format (what parse_session_jsonl reads):**
```json
{
  "type": "assistant",
  "sessionId": "72dbfbf7-...",
  "message": {
    "model": "claude-opus-4-7",
    "content": [{"type": "tool_use", "name": "Write", "input": {"file_path": "..."}}],
    "usage": {"input_tokens": 6, "cache_creation_input_tokens": 16582, "output_tokens": 144, ...}
  },
  "timestamp": "2026-04-25T..."
}
```

**Fixtures created:**
- `session_real.jsonl`: 7-line session with user→assistant(Read tool_use)→user(tool_result)→assistant(Write tool_use)→user(tool_result)→assistant(text) flow. Non-zero token usage, two tool_use blocks (Read + Write).
- `session_truncated.jsonl`: 3 valid lines + truncated 4th line (missing closing brace). Parser must skip the truncated line and return Ok with non-zero counts from valid lines.
- `session_unknown_types.jsonl`: first line has `type: "some_unknown_event_type"`, second has camelCase usage keys. Parser must skip both non-"assistant" and malformed-usage lines.

**encode_cwd verified:** `/Users/yang/lahacks/contract-ide` → `-Users-yang-lahacks-contract-ide`

### Task 2: Rust Agent Runner + Prompt Assembler + Parser + Receipts

#### `src/agent/prompt_assembler.rs`

**assemble_prompt(app, user_prompt, scope_uuid) → Result<String, String>:**
- None scope_uuid → simple unscoped prompt.
- Some scope_uuid → reads from SQLite (nodes + edges) and sidecar files:
  - Fetches scope node level/kind/code_ranges from `nodes` table.
  - Reads sidecar body via `read_sidecar_file(repo, scope_uuid)`.
  - Fetches neighbor UUIDs from `edges` table (both source AND target directions) — AGENT-01 invariant: no file-system globbing.
  - Reads each neighbor's sidecar body.
  - Stub for journal entries (08-03 not merged at integration time).
  - Section-weighted compression: drops `## Notes` first, then `## Examples` last, with footer documenting omissions.

#### `src/commands/receipts.rs`

**parse_session_jsonl(path, tracking_id) → Result<SessionReceipt, ParseError>:**
- Line-by-line, `serde_json::from_str::<Value>(line)` — skip + eprintln on parse error.
- Per assistant line: accumulates input_tokens + cache_creation_input_tokens, output_tokens, cache_read_input_tokens; counts tool_use blocks (all types); extracts file_path from Write/Edit/MultiEdit blocks into BTreeSet<String> (alphabetically sorted by BTreeSet ordering).
- Read tool calls do NOT appear in touched_files.
- Model from first assistant line with model set; defaults to "claude-opus-4-7".
- Returns Err if no lines parseable.

**Cost-rate constants (verified 2026-04):**
```rust
const COST_RATES: &[(&str, f64, f64)] = &[
    ("opus-4-7",   15.00, 75.00),  // per 1M tokens
    ("sonnet-4-5",  3.00, 15.00),
    ("haiku-4",     1.00,  5.00),
];
```

**parse_and_persist(app, tracking_id, jsonl_path, scope_uuid, wall_time_ms):**
- Calls parse_session_jsonl with mock fallback on error.
- Injects wall_time_ms from agent.rs (W3 — not derived from timestamps).
- Resolves affected UUIDs via SQLite: `SELECT DISTINCT n.uuid FROM nodes n, json_each(n.code_ranges) je WHERE json_extract(je.value, '$.file') = ?`.
- INSERT INTO receipts uses **08-01 merged column list verbatim**: `tool_call_count` (not `tool_calls`), `estimated_cost_usd` (not `est_cost_usd`).
- INSERT INTO receipt_nodes for each UUID (forward-compat for Phase 9 ranking).
- Emits `receipt:created` event.

**list_receipts_for_node(app, node_uuid) → Tauri command:** SELECT via receipt_nodes join, ORDER BY COALESCE(started_at, created_at) DESC.

#### `src/commands/agent.rs`

**AgentRuns struct:** Tauri-managed `AsyncMutex<HashMap<String, CommandChild>>` — I2 insurance for future kill-switch.

**run_agent(app, prompt, scope_uuid) → Result<String, String>:**
1. Generates UUID tracking_id.
2. Calls assemble_prompt (AGENT-01 invariant).
3. Snapshots `~/.claude/projects/<encoded-cwd>/` JSONL names (snapshot-diff fallback).
4. `let spawn_start = Instant::now();` — immediately before .spawn() (W3).
5. Spawns `claude -p <assembled> --output-format stream-json --verbose`.
6. Inserts CommandChild into AgentRuns map keyed by tracking_id (I2).
7. Spawns drain task:
   - Stdout: parses JSON for session_id (`.session_id` field), emits `agent:stream`.
   - Stderr: logs + emits `agent:stream` with `is_stderr: true`.
   - Terminated: measures wall_time_ms via Instant delta, resolves session_id (stream then snapshot-diff), calls parse_and_persist, emits `receipt:created` + `agent:complete`.
8. Returns tracking_id immediately.

#### `tests/jsonl_parser_tests.rs`

All 7 tests pass:
1. `parses_real_session_with_nonzero_counts` — input_tokens>0, output_tokens>0, tool_call_count>0, touched_files non-empty.
2. `tolerates_truncated_last_line` — Ok despite malformed last line.
3. `tolerates_unknown_types_and_camelcase` — no panic, non-zero counts from valid lines.
4. `mock_fallback_on_missing_file` — Err on missing file, FallbackMock with zeros.
5. `cost_calculation_opus_4_7` — 1M input + 500k output = $52.50.
6. `encode_cwd_strips_leading_slash_and_replaces_separators` — `/Users/yang/foo` → `-Users-yang-foo`.
7. `extracts_touched_files_from_tool_use_blocks` — Write/Edit/MultiEdit included, Read excluded; alphabetical BTreeSet order.

## Deviations from Plan

### Auto-fixed Issues

**[Rule 1 - Bug] Fixed `--include-partial-messages` → `--verbose` in agent.rs**
- **Found during:** Task 1 spike
- **Issue:** The plan specified `--include-partial-messages` flag but claude CLI v2.1.119 returns "When using --print, --output-format=stream-json requires --verbose". The `--include-partial-messages` flag does not exist or has a different signature in this version.
- **Fix:** Used `--verbose` instead. Session-id is still exposed in the stream-json events and the fallback snapshot-diff path is also implemented.
- **Files modified:** `src/commands/agent.rs`
- **Commit:** a798af5

**[Rule 2 - Missing functionality] Added `use tauri::Emitter;` imports**
- **Found during:** Task 2 cargo check
- **Issue:** `app.emit()` method is from the `tauri::Emitter` trait which must be explicitly imported in Tauri 2.
- **Fix:** Added `use tauri::{Emitter, Manager};` to both agent.rs and receipts.rs.
- **Files modified:** `contract-ide/src-tauri/src/commands/agent.rs`, `contract-ide/src-tauri/src/commands/receipts.rs`
- **Commit:** a798af5

**[Rule 1 - Bug] Fixed `try_state` return type in prompt_assembler.rs**
- **Found during:** Task 2 cargo check
- **Issue:** `app.try_state::<T>()` returns `Option<State<T>>` not `Result<State<T>, _>`. Used `if let Ok(state) = ...` pattern which is wrong.
- **Fix:** Changed to `.and_then()` chain on the Option.
- **Files modified:** `contract-ide/src-tauri/src/agent/prompt_assembler.rs`
- **Commit:** a798af5

**[Rule 1 - Bug] Fixed `Option<PathBuf>` pattern match for `if let Some(ref repo)`**
- **Found during:** Task 2 cargo check
- **Issue:** Rust E0277 — `Path` is not `Sized`, cannot be matched directly in `if let Some(ref repo)`. Need `repo_path.as_ref()`.
- **Fix:** Changed to `if let Some(repo) = repo_path.as_ref()`.
- **Files modified:** `contract-ide/src-tauri/src/agent/prompt_assembler.rs`
- **Commit:** a798af5

**[Rule 2 - Missing functionality] Fixed clippy doc comment style in test file**
- **Found during:** Task 2 clippy pass
- **Issue:** `clippy::empty_line_after_doc_comments` — outer doc comment `///` with empty line before `use` statement. Test files use inner doc comments `//!`.
- **Fix:** Changed `///` to `//!` at the top of jsonl_parser_tests.rs.
- **Files modified:** `contract-ide/src-tauri/tests/jsonl_parser_tests.rs`
- **Commit:** a798af5

## CLI Spike Findings (documented per plan output spec)

**session_id discovery path used in shipped code:**
- **Primary:** stream-json events expose `session_id` at `.session_id` field. Discovered on `system` event (first event). `Arc<AsyncMutex<Option<String>>>` shared between emit loop and terminated handler.
- **Fallback (snapshot-diff):** list `.jsonl` files in `~/.claude/projects/<encoded-cwd>/` before spawn, diff after Terminated. Names the file not in the pre-spawn set.
- **Both paths implemented** as the plan required.

**wall_time_ms vs JSONL-derived delta (W3 confirmation):**
- wall_time_ms: `spawn_start.elapsed().as_millis() as u64` — measured by Rust `std::time::Instant`, captures the full subprocess lifetime from `.spawn()` to `CommandEvent::Terminated`.
- JSONL started_at / finished_at: ISO-8601 timestamps from the first user line and last assistant line in the session file. These are subject to clock-drift, session-overhead gaps, and may be absent in mock receipts.
- They are independent. The real session spike showed started_at = "2026-04-25T06:27:46.457Z", finished_at = "2026-04-25T06:27:52.100Z" (5.6s) while Instant-based wall_time was 5.2s — different measurements as expected.

**08-03 journal integration:** stub used. `read_journal_entries` was not available at 08-04a integration time. Prompt assembler has a `TODO(08-03)` comment; the integration falls back to empty journal section — graceful degradation per CONTEXT.md.

**Real session JSONL fixture token baseline:**
- Session `72dbfbf7-e57f-4912-8b4a-96a46512d422` (contract-ide context, Read + Write tool calls)
- Total input_tokens (summed across assistant turns): 8 (from fixture — production sessions will be much higher due to cache_creation_input_tokens)
- Total output_tokens: 248 (3 assistant turns: 144 + 58 + 22 output)
- tool_call_count: 2 (one Read, one Write)
- touched_files: ["/tmp/test-output.txt"] (the Write target)
- Note: cache_creation_input_tokens from real production session was ~16582 per turn — the fixture was constructed to have only the token values needed for testing, not to mirror real production traffic volumes.

## Self-Check: PASSED

Files exist:
- `contract-ide/src-tauri/src/agent/mod.rs` — FOUND
- `contract-ide/src-tauri/src/agent/prompt_assembler.rs` — FOUND
- `contract-ide/src-tauri/src/commands/agent.rs` — FOUND
- `contract-ide/src-tauri/src/commands/receipts.rs` — FOUND
- `contract-ide/src-tauri/tests/jsonl_parser_tests.rs` — FOUND
- `contract-ide/src-tauri/tests/fixtures/session_real.jsonl` — FOUND
- `contract-ide/src-tauri/tests/fixtures/session_truncated.jsonl` — FOUND
- `contract-ide/src-tauri/tests/fixtures/session_unknown_types.jsonl` — FOUND

Commits verified:
- `bb3c229` — feat(08-04a): Day-1 spike fixtures — FOUND
- `a798af5` — feat(08-04a): Rust agent runner + defensive JSONL parser + receipts persistence — FOUND

Key content verified:
- agent.rs: `run_agent`, `AgentRuns`, `Instant::now()`, `CommandEvent::Stdout`, `agent:stream`
- receipts.rs: `parse_session_jsonl`, `mock_receipt`, `parse_and_persist`, `list_receipts_for_node`, `INSERT INTO receipts`, `tool_call_count`, `estimated_cost_usd`, `COST_RATES`
- prompt_assembler.rs: `assemble_prompt`, SQLite `edges` query, `read_sidecar_file`
- All 7 tests pass; cargo build --release clean; cargo clippy -D warnings clean
