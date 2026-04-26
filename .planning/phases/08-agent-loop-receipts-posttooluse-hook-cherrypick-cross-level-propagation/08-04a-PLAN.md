---
phase: 08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation
plan: 04a
type: execute
wave: 2
depends_on:
  - "08-01"
files_modified:
  - contract-ide/src-tauri/Cargo.toml
  - contract-ide/src-tauri/capabilities/default.json
  - contract-ide/src-tauri/src/commands/agent.rs
  - contract-ide/src-tauri/src/commands/receipts.rs
  - contract-ide/src-tauri/src/commands/mod.rs
  - contract-ide/src-tauri/src/lib.rs
  - contract-ide/src-tauri/src/agent/prompt_assembler.rs
  - contract-ide/src-tauri/src/agent/mod.rs
  - contract-ide/src-tauri/tests/jsonl_parser_tests.rs
  - contract-ide/src-tauri/tests/fixtures/session_real.jsonl
  - contract-ide/src-tauri/tests/fixtures/session_truncated.jsonl
  - contract-ide/src-tauri/tests/fixtures/session_unknown_types.jsonl
autonomous: true
requirements:
  - AGENT-01
  - AGENT-02
  - AGENT-03

must_haves:
  truths:
    - "Day-1 spike captures a real `claude -p --output-format stream-json --include-partial-messages` session JSONL fixture with at least one tool_use block and non-zero token usage"
    - "Defensive JSONL parser ships as an isolated Rust module with unit tests over the captured real session + two synthetic-malformed fixtures (truncated mid-line, unknown top-level types)"
    - "`run_agent(prompt, scope_uuid)` Tauri command spawns `claude` CLI via tauri-plugin-shell, streams CommandEvent::Stdout via `agent:stream` events, parses session JSONL on Terminated, and persists a receipt to SQLite — clean Rust API that Phase 11's Delegate button can call without re-implementation"
    - "wall_time_ms is measured from `Instant::now()` deltas around `app.shell().command(...).spawn()` — NOT derived from JSONL timestamps (W3 fix)"
    - "Receipt persistence uses the merged column list defined in 08-01 — `tool_call_count` (NOT `tool_calls`), `estimated_cost_usd` (NOT `est_cost_usd`), reusing v1 columns where they exist"
    - "`nodes_touched` v1 column populated from tool_use Write/Edit/MultiEdit `file_path` blocks parsed out of the JSONL — JSON array of UUIDs derived via SQLite lookup against `nodes.code_ranges`. Read tool calls do NOT count (no behavior change)"
    - "Mock fallback receipt is emitted on any parse error so the receipt card never blanks (parse_status = 'fallback_mock')"
    - "Cost-rate constants table hardcoded with model substring lookup (opus-4-7, sonnet-4-5, haiku-4) per Anthropic published rates as of 2026-04"
    - "Prompt assembler reads scope node + neighbors + journal entries from SQLite (NOT whole-repo grep — AGENT-01 invariant)"
    - "`CommandChild` handle is tracked in a Tauri-managed state map keyed by tracking_id (insurance for future kill-switch — I2)"
  artifacts:
    - path: "contract-ide/src-tauri/Cargo.toml"
      provides: "tauri-plugin-shell dep already present (Phase 5); confirm uuid + chrono present"
      contains: "tauri-plugin-shell"
    - path: "contract-ide/src-tauri/capabilities/default.json"
      provides: "shell:allow-spawn capability for streaming claude CLI subprocess"
      contains: "shell:allow-spawn"
    - path: "contract-ide/src-tauri/src/commands/agent.rs"
      provides: "run_agent Tauri command — claude CLI spawn, CommandEvent::Stdout streaming via app.emit('agent:stream'), CommandChild tracking map"
      exports: ["run_agent"]
      min_lines: 80
    - path: "contract-ide/src-tauri/src/commands/receipts.rs"
      provides: "parse_and_persist + list_receipts_for_node + mock_receipt + cost-rate constants table"
      exports: ["parse_and_persist", "list_receipts_for_node", "mock_receipt"]
      min_lines: 100
    - path: "contract-ide/src-tauri/src/agent/prompt_assembler.rs"
      provides: "Prompt assembler reading scope node + neighbors + journal context from SQLite (NOT whole-repo grep)"
      exports: ["assemble_prompt"]
      min_lines: 40
    - path: "contract-ide/src-tauri/tests/jsonl_parser_tests.rs"
      provides: "Defensive parser unit tests over captured real session + two synthetic fixtures + cost-rate test + encode_cwd test"
      min_lines: 60
    - path: "contract-ide/src-tauri/tests/fixtures/session_real.jsonl"
      provides: "Captured real claude session JSONL — load-bearing acceptance fixture"
    - path: "contract-ide/src-tauri/tests/fixtures/session_truncated.jsonl"
      provides: "Synthetic truncated-mid-line fixture for defensive parser test"
    - path: "contract-ide/src-tauri/tests/fixtures/session_unknown_types.jsonl"
      provides: "Synthetic fixture with unknown top-level `type` values + missing `usage` keys"
  key_links:
    - from: "contract-ide/src-tauri/src/commands/agent.rs"
      to: "tauri-plugin-shell::Command::spawn → Receiver<CommandEvent>"
      via: "Streams CommandEvent::Stdout lines via app.emit('agent:stream', { tracking_id, line }); on Terminated, parses session JSONL via commands::receipts::parse_and_persist; wall_time_ms captured via Instant::now() deltas around spawn"
      pattern: "CommandEvent::Stdout|agent:stream|Instant::now"
    - from: "contract-ide/src-tauri/src/commands/agent.rs"
      to: "contract-ide/src-tauri/src/agent/prompt_assembler.rs"
      via: "assemble_prompt(scope_uuid) reads scope node body + neighbors + recent journal entries from SQLite (NOT whole-repo grep — AGENT-01 invariant)"
      pattern: "assemble_prompt"
    - from: "contract-ide/src-tauri/src/commands/receipts.rs"
      to: "Phase 8-01 receipts SQLite table (migration v3 ALTER TABLE additions)"
      via: "INSERT INTO receipts (id, session_id, transcript_path, started_at, finished_at, input_tokens, output_tokens, cache_read_tokens, tool_call_count, nodes_touched, estimated_cost_usd, raw_summary, raw_jsonl_path, parse_status, wall_time_ms) — column names match v1 schema verbatim per 08-01 merged-column-list note"
      pattern: "INSERT INTO receipts"
---

<objective>
Land the Rust agent loop runner — `claude` CLI spawn, defensive JSONL parser, receipt persistence, prompt assembler — as a clean Rust API that Phase 11's `Delegate to agent` Inspector button can call without re-implementation. This is the backend half of Beat 2; 08-04b ships the frontend chat panel + receipt UI on top of these primitives.

Per RESEARCH.md Pitfall 4 + Open Q1: a Day-1 spike validates `claude -p --output-format stream-json --include-partial-messages` behavior end-to-end and captures a real session JSONL fixture as the demo-survival acceptance test. Defensive parser ships with unit tests against truncated + unknown-types fixtures so a malformed session never blanks the receipt card on stage.

Per checker W3: `wall_time_ms` is measured via `Instant::now()` deltas around `app.shell().command(...).spawn()` — NOT derived from JSONL timestamps (which are brittle and prone to skew/clock-drift artifacts).

Per checker B2: receipt persistence uses the merged column list locked in 08-01's migration v3. v1 already shipped `receipts(id, session_id, transcript_path, started_at, finished_at, input_tokens, output_tokens, cache_read_tokens, tool_call_count, nodes_touched, estimated_cost_usd, raw_summary, created_at)`; v3 adds `raw_jsonl_path, parse_status, wall_time_ms` via ALTER TABLE. Code MUST use `tool_call_count` (NOT `tool_calls`) and `estimated_cost_usd` (NOT `est_cost_usd`).

Output: Rust runner + receipts persistence + cost-rate table + isolated parser + 7 Rust unit tests + 3 fixtures. Wave 1 — runs in parallel with 08-01..03 + 08-05. The frontend chat panel + receipt UI lands in 08-04b (depends on this plan).
</objective>

<execution_context>
@/Users/yang/.claude/get-shit-done/workflows/execute-plan.md
@/Users/yang/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/ROADMAP.md
@.planning/phases/08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation/08-CONTEXT.md
@.planning/phases/08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation/08-RESEARCH.md
@.planning/research/contract-form/RESEARCH.md
@.planning/demo/presentation-script.md

# Existing surfaces this plan builds on
@contract-ide/src-tauri/Cargo.toml
@contract-ide/src-tauri/capabilities/default.json
@contract-ide/src-tauri/src/lib.rs
@contract-ide/src-tauri/src/commands/mod.rs
@contract-ide/src-tauri/src/db/migrations.rs
</context>

<tasks>

<task type="auto">
  <name>Task 1: Day-1 spike — verify `claude -p` streaming + capture real session JSONL fixture</name>
  <files>contract-ide/src-tauri/tests/fixtures/session_real.jsonl, contract-ide/src-tauri/tests/fixtures/session_truncated.jsonl, contract-ide/src-tauri/tests/fixtures/session_unknown_types.jsonl</files>
  <action>
    Per RESEARCH.md Pitfall 4 + Open Q1: before building the runner, verify `claude` CLI behavior end-to-end on this machine.

    1. **Streaming format spike.** From the terminal, run:
       ```bash
       claude -p "list 3 colors" --output-format stream-json --include-partial-messages
       ```
       Capture the stdout to `/tmp/claude-spike-stream.jsonl`. Verify each line is parseable JSON. Locate which line carries `session_id` (RESEARCH.md Open Q1 recommendation: first event should expose it). Document the EXACT field path in the SUMMARY.

       Then run the same prompt WITHOUT the flag (`claude -p "list 3 colors"`). Capture stdout to `/tmp/claude-spike-text.txt`. Verify it's plain text.

       DECISION (per RESEARCH.md): use `--output-format stream-json --include-partial-messages` for the runner so session_id is discoverable from the stream. Render the chat panel by extracting the assistant's `delta`/`text` content from the stream-json events (pulling out the human-readable text) — NOT raw JSON. If stream-json doesn't expose session_id reliably (verify in the spike), fallback path: snapshot `~/.claude/projects/<encoded-cwd>/` BEFORE spawn (record file mtimes), spawn, after Terminated rescan and pick the newest JSONL not present in the snapshot. Implement BOTH paths in Task 2; the snapshot-diff is the safety net.

    2. **Capture a real session JSONL fixture.** After the spike, locate the real session JSONL file at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` (the encoded-cwd is the absolute path with `/` replaced by `-`, e.g., `-Users-yang-lahacks-contract-ide`). Copy it to `contract-ide/src-tauri/tests/fixtures/session_real.jsonl`. Verify it contains:
       - At least one `type: "user"` line.
       - At least one `type: "assistant"` line with `message.usage` populated (`input_tokens`, `output_tokens`, optionally `cache_creation_input_tokens`, `cache_read_input_tokens`).
       - At least one `tool_use` content block (run a prompt that triggers tool use, e.g., `claude -p "read README.md and tell me what's in it"`).

       This fixture is the demo-survival acceptance test for the parser (Risk Register row 1).

    3. **Synthesize two malformed fixtures** at `tests/fixtures/`:
       - `session_truncated.jsonl`: Copy the real fixture, then truncate the LAST line at a random byte offset mid-JSON. Parser must NOT crash; must skip the malformed line; must return non-zero counts from the well-formed lines.
       - `session_unknown_types.jsonl`: Take the real fixture, prepend a line `{"type":"some_unknown_event_type","foo":"bar"}` and another `{"type":"assistant","message":{"usage":{"inputTokens":42}}}` (camelCase variant — schema drift simulation). Parser must skip the unknown type and parse the well-formed assistant lines.

    4. **DO NOT commit secrets.** If the captured real session contains absolute home paths, leave them — they're benign. If it contains API keys or shell history snippets, sanitize before commit. Inspect the fixture before committing.

    NOTE: This task produces NO Rust/TS code. It validates assumptions and creates the fixtures Task 2 depends on. If `claude -p --output-format stream-json --include-partial-messages` does NOT exist or behaves unexpectedly, document the deviation in SUMMARY and proceed with the snapshot-diff path as primary.
  </action>
  <verify>
    - `ls contract-ide/src-tauri/tests/fixtures/session_real.jsonl` exists and is parseable: `cat ... | jq -c . | wc -l` matches `wc -l < ...` (every line is valid JSON).
    - `session_real.jsonl` contains at least one assistant line with `usage.input_tokens > 0` (verify: `jq -c 'select(.type=="assistant") | .message.usage' session_real.jsonl | grep input_tokens`).
    - `session_truncated.jsonl` last line errors when piped through `jq -e .` (proves it's truncated).
    - `session_unknown_types.jsonl` first line has `type: "some_unknown_event_type"`.
    - SUMMARY documents the chosen session-id discovery path (stream-json vs snapshot-diff).
  </verify>
  <done>
    Three fixture files committed; real session captures non-zero token usage from at least one assistant message AND at least one tool_use content block; SUMMARY documents the verified `claude` CLI flag set; no secrets in fixtures.
  </done>
</task>

<task type="auto">
  <name>Task 2: Rust agent runner + prompt assembler + isolated defensive JSONL parser + receipts persistence (merged column list, Instant-based wall_time_ms)</name>
  <files>contract-ide/src-tauri/Cargo.toml, contract-ide/src-tauri/capabilities/default.json, contract-ide/src-tauri/src/agent/mod.rs, contract-ide/src-tauri/src/agent/prompt_assembler.rs, contract-ide/src-tauri/src/commands/agent.rs, contract-ide/src-tauri/src/commands/receipts.rs, contract-ide/src-tauri/src/commands/mod.rs, contract-ide/src-tauri/src/lib.rs, contract-ide/src-tauri/tests/jsonl_parser_tests.rs</files>
  <action>
    1. **Capabilities + deps.** Open `contract-ide/src-tauri/capabilities/default.json` — verify `shell:allow-execute` is present (Phase 5 lineage); ADD `shell:allow-spawn` (string form is fine for Tauri 2; per RESEARCH.md "shell:allow-spawn" is required for `Receiver<CommandEvent>` streaming). Verify `tauri-plugin-shell` is in `Cargo.toml` (Phase 5 added it). No new crates needed unless `uuid` isn't a direct dep — if missing, add `uuid = { version = "1", features = ["v4"] }`. Confirm `chrono` is present (Phase 6 derivation likely added it); if absent, add `chrono = { version = "0.4", features = ["serde"] }`.

    2. **Create `src-tauri/src/agent/mod.rs` + `src-tauri/src/agent/prompt_assembler.rs`**:
       - `pub mod prompt_assembler;` in `mod.rs`.
       - `assemble_prompt(app: &tauri::AppHandle, user_prompt: &str, scope_uuid: Option<&str>) -> Result<String, String>` in `prompt_assembler.rs`:
         - If `scope_uuid` is None → return `user_prompt` verbatim with a brief preamble (`"User intent: {prompt}\n\nNo specific node scope; act on the repository at large."`).
         - If `scope_uuid` is Some → SELECT the scope node from `nodes` table (uuid, level, kind, parent_uuid, code_ranges_json), read its sidecar body via the `read_sidecar_file(repo, uuid)` helper added by 08-01, list neighbor UUIDs from the `edges` table (both directions, via `source_uuid` / `target_uuid`), read each neighbor's sidecar body via the same helper. Fetch the latest 5 journal entries for `scope_uuid` (call into 08-03's journal layer; if 08-03 ships before this task, factor out a non-Tauri-command Rust helper `pub async fn read_journal_entries(...)` from `commands::journal` and call it here. If 08-03 hasn't merged when 08-04a lands, stub this with an empty list and a TODO comment — graceful degradation per CONTEXT.md).
         - Compose the prompt body:
           ```
           User intent: {user_prompt}

           Acting on node {scope_uuid} ({level} {kind}). Source files: {code_ranges files joined}.

           ## Contract for {scope_uuid}
           {scope sidecar body}

           ## Neighbor contracts
           {for each neighbor: ## {neighbor_uuid} ({level} {kind})\n{body}}

           ## Recent intent journal (last 5 entries)
           {for each entry: - [ts] tool={tool} file={file} intent={intent}}

           Make minimal, scoped changes. Do NOT modify files outside the scope node's code_ranges or its direct neighbors' code_ranges unless the user explicitly requested it.
           ```
         - **Section-weighted compression (soft):** if the assembled prompt exceeds 80% of an arbitrary token budget (default 32_000 chars as a first cut), drop sections from each contract body in priority order: `## Notes` → `## Examples` (PACT 2025: `## Examples` is load-bearing under token pressure → it's the LAST to drop, NOT the first). Use 08-01's `section_parser::parse_sections` to split each body when present; if 08-01 hasn't merged or the body has no `##` headings, treat the whole body as one block and either include or drop wholesale. Document the dropped-sections list in the prompt as a footer (`[Compressed: dropped ## Notes from {neighbor_uuid}]`).
         - AGENT-01 invariant: this prompt is built from SQLite reads + sidecar reads ONLY. NO whole-repo grep. NO file-system globbing. The neighbor list is the SQLite `edges` table.

    3. **Create `src-tauri/src/commands/receipts.rs`** — the isolated defensive parser + persistence module per RESEARCH.md Pattern 5:
       ```rust
       use serde_json::Value;
       use std::path::{Path, PathBuf};

       pub struct SessionReceipt {
           pub tracking_id: String,
           pub session_id: String,
           pub started_at: Option<String>,    // first user-line ts (ISO-8601)
           pub finished_at: Option<String>,   // last assistant-line ts (ISO-8601)
           pub input_tokens: u64,
           pub output_tokens: u64,
           pub cache_read_tokens: u64,
           pub tool_call_count: u64,           // MERGED COLUMN — not `tool_calls`
           pub estimated_cost_usd: f64,        // MERGED COLUMN — not `est_cost_usd`
           pub raw_jsonl_path: PathBuf,
           pub parse_status: ParseStatus,
           pub wall_time_ms: Option<u64>,      // Instant::now() delta from agent.rs (W3)
           pub model: Option<String>,
           pub nodes_touched_uuids: Vec<String>,  // populated by SQLite lookup against tool_use file_paths in parse_and_persist
           pub touched_files: Vec<String>,        // raw set of relative file paths extracted from tool_use blocks (Write/Edit/MultiEdit) — populated in parse_session_jsonl, used by parse_and_persist to look up affected UUIDs
       }

       pub enum ParseStatus { Ok, FallbackMock }

       pub fn parse_session_jsonl(path: &Path, tracking_id: &str) -> Result<SessionReceipt, ParseError> { ... }
       pub fn mock_receipt(tracking_id: &str, raw_jsonl_path: PathBuf) -> SessionReceipt { ... }
       ```
       Implementation rules (Pitfall 3 lineage):
       - Read line-by-line; each line `serde_json::from_str::<Value>(line)`. Skip lines that fail to parse with `eprintln!` (don't panic).
       - For each `Value`, gate field reads via `.get("foo").and_then(|v| v.as_u64()).unwrap_or(0)`. NEVER use `.unwrap()`.
       - Sum `input_tokens` across all `assistant` lines: `usage.input_tokens + cache_creation_input_tokens.unwrap_or(0) + cache_read_input_tokens.unwrap_or(0)`. Sum `output_tokens` separately. Sum `cache_read_tokens` (cache_read_input_tokens) separately so it persists into the v1 `cache_read_tokens` column.
       - Count `tool_call_count` by walking each assistant line's `message.content` array and counting blocks where `content[i].type == "tool_use"`.
       - **Extract `touched_files` from tool_use blocks** (B-fix — populates v1 `nodes_touched` column instead of dropping it from SC 2). For each `content[i]` where `content[i].type == "tool_use"` AND `content[i].name` is one of `["Write", "Edit", "MultiEdit"]`, read `content[i].input.file_path` (or `content[i].input.path` as fallback) into a `BTreeSet<String>`. Convert absolute paths to repo-relative if possible (strip `cwd` prefix from agent.rs's known repo path; if path is already relative, keep as-is). At end of parse, drain the set into `touched_files: Vec<String>` (alphabetically sorted by BTreeSet ordering). Empty list is acceptable (read-only sessions).
       - Read `model` from the FIRST assistant line that has `.message.model` populated. Default to `"claude-opus-4-7"` if absent (RESEARCH.md Open Q4).
       - Hardcoded cost-rates table (RESEARCH.md Open Q3):
         ```rust
         const COST_RATES: &[(&str, f64, f64)] = &[
             // (model_substring, input_per_1m_tokens_usd, output_per_1m_tokens_usd)
             // Verified at plan time 2026-04 — UPDATE when Anthropic ships rate changes.
             ("opus-4-7", 15.00, 75.00),
             ("sonnet-4-5", 3.00, 15.00),
             ("haiku-4", 1.00, 5.00),
         ];
         ```
         Match by substring; default to opus-4-7 rates if unmatched. Compute `estimated_cost_usd = (input_tokens / 1_000_000) * input_rate + (output_tokens / 1_000_000) * output_rate`.
       - First user-line `timestamp` is `started_at`; last assistant `timestamp` is `finished_at`. **Do NOT compute wall_time_ms from these timestamps** — agent.rs measures it via `Instant::now()` deltas around spawn (W3) and passes it down.
       - On ANY error (file missing, all lines malformed, etc.) → `parse_session_jsonl` returns `Err`; caller calls `mock_receipt(tracking_id, jsonl_path)` which fills zeros + `parse_status: FallbackMock`.

       Persistence:
       ```rust
       pub async fn parse_and_persist(
           app: &tauri::AppHandle,
           tracking_id: &str,
           jsonl_path: &Path,
           scope_uuid: Option<&str>,
           wall_time_ms: Option<u64>,        // measured by agent.rs around spawn (W3)
       ) -> Result<SessionReceipt, String> { ... }
       ```
       INSERT statement (B2 — uses 08-01 merged column list verbatim):
       ```sql
       INSERT INTO receipts (
         id, session_id, transcript_path, started_at, finished_at,
         input_tokens, output_tokens, cache_read_tokens, tool_call_count,
         nodes_touched, estimated_cost_usd, raw_summary,
         raw_jsonl_path, parse_status, wall_time_ms
       ) VALUES (?,?,?,?,?, ?,?,?,?, ?,?,?, ?,?,?)
       ```
       Where `nodes_touched` is a JSON array of UUIDs (alternate to receipt_nodes join — populate BOTH for forward-compat per SC 2 "nodes touched"); `transcript_path` and `raw_jsonl_path` are typically the same string.

       **Affected-UUID resolution (B-fix — populates `nodes_touched` column):** for each file path in `touched_files`, query `SELECT DISTINCT n.uuid FROM nodes n, json_each(n.code_ranges) je WHERE json_extract(je.value, '$.file') = ?`. Collect the union of returned UUIDs into a `BTreeSet<String>`, plus include `scope_uuid` if Some. Convert to a JSON array string via `serde_json::to_string(&uuids_vec)?` and bind it as the `nodes_touched` column value in the INSERT. Same UUIDs are also INSERTed INTO `receipt_nodes` (receipt_id, node_uuid) for the join-table path (forward-compat — Phase 9+ ranking queries may use either). Then `app.emit("receipt:created", json!({...}))`.

       Plus `pub async fn list_receipts_for_node(app, node_uuid) -> Result<Vec<SessionReceipt>, String>` Tauri command — `SELECT … FROM receipts r JOIN receipt_nodes rn ON rn.receipt_id = r.id WHERE rn.node_uuid = ? ORDER BY COALESCE(r.started_at, r.created_at) DESC`. Use the v1 column names verbatim in SELECT.

    4. **Create `src-tauri/src/commands/agent.rs`** — the runner per RESEARCH.md Pattern 4:
       ```rust
       use std::collections::HashMap;
       use std::time::Instant;
       use tauri::async_runtime::{self, Mutex as AsyncMutex};
       use tauri_plugin_shell::process::{CommandChild, CommandEvent};

       /// I2: Tauri-managed map of in-flight agent runs. Future kill-switch UI calls
       /// `state.lock().await.remove(&tracking_id).map(|c| c.kill())`. Insurance for
       /// v2 — no UI consumer in v1.
       pub struct AgentRuns(pub AsyncMutex<HashMap<String, CommandChild>>);

       #[tauri::command]
       pub async fn run_agent(
           app: tauri::AppHandle,
           prompt: String,
           scope_uuid: Option<String>,
       ) -> Result<String, String> { ... }
       ```
       Register `app.manage(AgentRuns(AsyncMutex::new(HashMap::new())))` in `lib.rs` setup.

       - Generate `tracking_id = uuid::Uuid::new_v4().to_string()`.
       - Call `crate::agent::prompt_assembler::assemble_prompt(&app, &prompt, scope_uuid.as_deref()).await?`.
       - **Snapshot `~/.claude/projects/<encoded-cwd>/` mtimes BEFORE spawn** (fallback path for session-id discovery per Open Q1). Use `std::fs::read_dir` to list current `.jsonl` files; record `HashSet<String>` of names.
       - **W3 wall_time_ms measurement:** capture `let spawn_start = Instant::now();` IMMEDIATELY before `.spawn()`. Build the command via `app.shell().command("claude").args(["-p", &assembled, "--output-format", "stream-json", "--include-partial-messages"])`. `.spawn()` returns `(Receiver<CommandEvent>, CommandChild)`.
       - **I2 CommandChild tracking:** insert the `CommandChild` into the `AgentRuns` map keyed by `tracking_id` BEFORE spawning the receiver-drain task. Remove on `Terminated`. No v1 UI consumer; future kill-switch will call `app.state::<AgentRuns>().lock().await.remove(&tid).map(|c| c.kill())`.
       - Spawn a `tauri::async_runtime::spawn` task that drains the receiver:
         - On `CommandEvent::Stdout(line)` → parse the line as JSON (defensive: if it doesn't parse, treat the bytes as raw text); extract any `session_id` field if present and store in a shared `Arc<Mutex<Option<String>>>`; emit `app.emit("agent:stream", { tracking_id, line: <line bytes as utf8>, session_id_known: <bool> })`.
         - On `CommandEvent::Stderr(line)` → log + emit `agent:stream` with stderr flag.
         - On `CommandEvent::Terminated(payload)` → **measure `wall_time_ms = spawn_start.elapsed().as_millis() as u64`** (W3 — authoritative wall-clock). Resolve session_id (read from Arc<Mutex<Option<String>>>; if None, do directory snapshot diff: list `.jsonl` files now, find the one not in the pre-spawn snapshot, take its name as session_id). Build `jsonl_path = ~/.claude/projects/<encoded-cwd>/<session_id>.jsonl`. Call `commands::receipts::parse_and_persist(&app, &tracking_id, &jsonl_path, scope_uuid.as_deref(), Some(wall_time_ms)).await`. On error, build a mock receipt (passing `wall_time_ms` so the mock still has accurate timing) and emit `receipt:created` anyway. Remove tracking_id from `AgentRuns` map. Emit `app.emit("agent:complete", { tracking_id, code: payload.code })`.
       - Return `Ok(tracking_id)` immediately so the frontend has a handle while the run streams.

       NOTE: the encoded-cwd derivation (`/Users/yang/lahacks/contract-ide` → `-Users-yang-lahacks-contract-ide`) needs verification in the spike — write a small helper `encode_cwd(path: &Path) -> String` and unit-test it.

    5. **Register commands** in `src-tauri/src/commands/mod.rs` (`pub mod agent; pub mod receipts;`) and `src-tauri/src/lib.rs` (add `commands::agent::run_agent, commands::receipts::list_receipts_for_node` to `tauri::generate_handler!` via fully-qualified paths — STATE.md Plan 01-02 lineage: pub-use re-exports break generate_handler!). Also `app.manage(commands::agent::AgentRuns(AsyncMutex::new(HashMap::new())))` in setup.

    6. **Create `src-tauri/tests/jsonl_parser_tests.rs`** with at minimum:
       - `parses_real_session_with_nonzero_counts` — load `tests/fixtures/session_real.jsonl`, assert `input_tokens > 0`, `output_tokens > 0`, `tool_call_count > 0`.
       - `tolerates_truncated_last_line` — load `tests/fixtures/session_truncated.jsonl`, assert parse returns Ok with non-zero counts (well-formed lines parsed, truncated line skipped).
       - `tolerates_unknown_types_and_camelcase` — load `tests/fixtures/session_unknown_types.jsonl`, assert no panic, returns non-zero counts from well-formed lines.
       - `mock_fallback_on_missing_file` — call `parse_session_jsonl(Path::new("/nonexistent.jsonl"), "track")` returns Err → caller uses `mock_receipt("track", ...)` which has `parse_status: FallbackMock` and zeros.
       - `cost_calculation_opus_4_7` — input_tokens=1_000_000, output_tokens=500_000, model=Some("claude-opus-4-7"); estimated_cost_usd should equal 1.0 * 15.00 + 0.5 * 75.00 = 52.50.
       - `encode_cwd_strips_leading_slash_and_replaces_separators` — `/Users/yang/foo` → `-Users-yang-foo`.
       - `extracts_touched_files_from_tool_use_blocks` (B-fix) — synthesize a JSONL with assistant lines containing `tool_use` blocks for: (a) `Write` with `input.file_path = "src/foo.ts"`, (b) `Edit` with `input.file_path = "src/bar.ts"`, (c) `MultiEdit` with `input.path = "src/baz.ts"`, (d) `Read` with `input.file_path = "src/skip.ts"` (must NOT appear in touched_files — only Write/Edit/MultiEdit count). Assert `touched_files` is `["src/bar.ts", "src/baz.ts", "src/foo.ts"]` (alphabetical via BTreeSet). Assert `Read`'s file is NOT included.

       Run `cargo test --test jsonl_parser_tests` from `src-tauri/`.

    7. Verify `cargo build --release && cargo clippy --all-targets -- -D warnings && cargo test` clean.
  </action>
  <verify>
    From `contract-ide/src-tauri/`:
    - `cargo build --release` succeeds.
    - `cargo clippy --all-targets -- -D warnings` clean.
    - `cargo test --test jsonl_parser_tests` passes all seven tests.
    - Manually launch `npm run tauri dev`. In the browser console: `await window.__TAURI__.invoke('run_agent', { prompt: 'list 3 colors', scopeUuid: null })` returns a tracking_id; `agent:stream` events fire in the event log; `agent:complete` fires within ~10s; `receipt:created` fires with non-zero `input_tokens`.
    - SQLite check: `sqlite3 <db> "SELECT input_tokens, output_tokens, tool_call_count, wall_time_ms FROM receipts ORDER BY started_at DESC LIMIT 1"` shows non-zero numbers and a non-NULL wall_time_ms (W3 verified).
  </verify>
  <done>
    run_agent + parse_and_persist + list_receipts_for_node commands registered; defensive JSONL parser passes all seven unit tests including the truncated + unknown-types fixtures + tool_use file extraction; mock fallback never panics; cost rate table hardcoded with model lookup; CommandChild tracked in AgentRuns map (I2); wall_time_ms measured via Instant deltas around spawn (W3); manual end-to-end run produces a real receipt row in SQLite using the merged column list (B2 — `tool_call_count` not `tool_calls`, `estimated_cost_usd` not `est_cost_usd`); cargo test + clippy clean.
  </done>
</task>

</tasks>

<verification>
- Day-1 spike captures real session JSONL fixture with at least one tool_use content block; SUMMARY documents verified `claude` CLI flag set.
- Defensive JSONL parser passes all seven Rust unit tests including truncated/unknown-types fixtures + tool_use file extraction; never panics; mock fallback ensures `parse_status: FallbackMock` receipt is emitted on any error path.
- `run_agent` Rust IPC streams stdout via `agent:stream` events; on Terminated, persists a receipt to SQLite + emits `receipt:created`.
- Cost-rate constants table hardcoded with model substring lookup; opus-4-7 cost calculation verified by unit test.
- AGENT-01 invariant: prompt assembler reads from SQLite (nodes + edges) and sidecar files only — no whole-repo grep.
- Receipt persistence uses 08-01 merged column list (`tool_call_count`, `estimated_cost_usd`, etc.) — verified by inspecting INSERT statement.
- wall_time_ms captured via Instant::now() deltas around spawn (W3) — NOT JSONL timestamp diff.
- CommandChild tracked in AgentRuns Tauri-managed state map keyed by tracking_id (I2 insurance).
- cargo build + clippy + test clean.
</verification>

<success_criteria>
- AGENT-01: scoped prompt assembly via SQLite reads, no whole-repo grep.
- AGENT-02: defensive JSONL parser as isolated module with mock fallback, unit-tested against captured real session + 2 synthetic fixtures.
- AGENT-03: receipts persist per node in `receipts` + `receipt_nodes` tables (using 08-01 v3 schema with merged column list), retrievable via `list_receipts_for_node` IPC.
- Runner module exposes `run_agent(prompt, scope_uuid)` Rust API that Phase 11's Delegate button can call without re-implementation.
- W3 closed: wall_time_ms is Instant-based, not JSONL-timestamp-derived.
- I2 closed: CommandChild handle tracked for future kill-switch.
</success_criteria>

<output>
After completion, create `.planning/phases/08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation/08-04a-SUMMARY.md` documenting:
- Verified `claude` CLI flag set (stream-json + include-partial-messages confirmed exposes session_id, OR snapshot-diff fallback used as primary)
- session-id discovery path actually used in shipped code (stream-json field path or snapshot diff)
- encode_cwd helper output format verified against the real `~/.claude/projects/<key>/` directory on this machine
- Cost rates committed (opus-4-7, sonnet-4-5, haiku-4 per-1M-token rates) with date stamp
- Real session JSONL fixture token-count values (as a regression baseline)
- Whether 08-03's `read_journal_entries` Rust helper was available at integration time (or stub used)
- wall_time_ms vs JSONL-derived (started_at − finished_at) delta on a real run — confirmation they're independent (W3)
- Any deviation from RESEARCH.md Pattern 4 streaming code
</output>
