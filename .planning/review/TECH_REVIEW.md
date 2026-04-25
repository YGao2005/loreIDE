# Technical Review: Contract IDE Planning Documents

**Reviewer:** Independent technical reviewer
**Date:** 2026-04-24
**Scope:** Pre-build review of planning documents — build-order sanity, integration risks, schema soundness, timeline realism, hidden assumptions. Stack and architecture choices are locked and not re-litigated.

---

## 1. Build-Order Sanity Check

The critical path is correctly identified as Phase 1 -> 2 -> 3 -> 4 -> 6 -> 7 -> 8. Phase 5 paralleling Phase 3 is structurally valid, but the parallelization produces a dead-end artifact unless Phase 4 ships on time.

**The Phase 5 / Phase 3 parallelization problem**

Phase 5 (MCP sidecar) can be built in isolation once the SQLite schema is stable — that is true. The sidecar can query nodes, return results, and be verified with a `claude` CLI session calling `find_by_intent`. But the MCP sidecar has no value in the demo until Phase 4 (inspector) is complete, because the demo's agent-loop beats all require the user to first select a node in the inspector and trigger a `run_agent` call. If Phase 5 finishes while Phase 3 is still in progress, the team has a callable MCP tool but no surface to trigger an agent run against it. The risk is that Phase 5 momentum creates pressure to "use" the sidecar by adding premature wiring before Phase 4 exists — which produces integration glue code that gets thrown away or entangles incomplete Phase 3 state. Mitigation: treat Phase 5 completion as a background milestone with a hard rule that no MCP wiring into the agent loop begins until Phase 4's success criterion 1 is met (Monaco confirmed working, inspector renders contract + code).

**Phase 6 depends on a Phase 1 decision that was not made**

Phase 6 (contract derivation) calls `claude -p "<prompt>"` from Rust. The plan shows this as a CLI shell-out. But no Phase 1 decision documents: where does the API key come from? The `claude` CLI requires authentication. If the user has Claude Code installed and authenticated, the CLI uses its existing credential. If not — or if the CLI is running in a subprocess context where the auth token is not inherited — derivation silently fails. This is not the same as the Phase 8 agent-loop which also shells out, because derivation is triggered programmatically (no interactive terminal), while Phase 8 runs in a shell context that may inherit auth. The specific question: does `tauri-plugin-shell`'s `Command::new("claude")` inherit the user's shell environment including `ANTHROPIC_API_KEY` or the Claude Code keychain credential? This is unvalidated. If it does not, derivation returns nothing. There is no rate-limiting strategy documented either — batch derivation for a medium repo could fire 50+ CLI calls in rapid succession, hitting Claude's rate limiter. No backoff or throttle is specified.

**Phase 7 has a race condition on the SQLite writer**

Phase 7 has two independent paths that both terminate in a SQLite write: the `notify` file watcher (manual file edits trigger drift detection, which updates `drift_state`) and the PostToolUse hook (agent writes trigger re-derivation, which updates `nodes` and `drift_state`). The roadmap asserts single-writer rule (only Rust writes SQLite), and that is correct — both paths go through Rust. But both can fire concurrently: a Claude Code session can write a file, which simultaneously triggers the `notify` watcher event AND the PostToolUse hook. If both code paths reach the SQLite write without coordination, the second write will operate on stale in-memory state. The `notify` path updates `drift_state` based on the hash it computed; the hook path re-derives and also writes `drift_state`. These are not sequenced. With `sqlx`'s async interface (used by `tauri-plugin-sql`), two concurrent `INSERT OR REPLACE INTO drift_state` for the same `node_uuid` are safe at the SQLite level due to WAL serialization, but the Rust code computing the drift delta may read `nodes.code_hash` between the two writes and produce an incorrect delta. The mitigation must be explicit: use a per-node Tokio `Mutex` or a channel-based serialization queue for drift state writes, not just SQLite-level safety.

**Phase boundary softness**

Phase 4 -> Phase 6 boundary is soft: Phase 6 adds the "Derive" button to the inspector, which is a Phase 4 surface. Any delay in Phase 4's Monaco validation (the WKWebView worker issue is the highest-risk single item) directly compresses Phase 6. The roadmap treats this as sequential but doesn't flag that Phase 4's success criterion 1 is a WKWebView compatibility test, not a logic test — and WKWebView behavior can only be confirmed on macOS with `cargo tauri dev`, not in any simulator or browser. One unexpected macOS version behavior could cost a full day.

---

## 2. Highest-Risk Integration Seams

**Seam 1: `claude` CLI subprocess environment inheritance in Tauri**

Risk: Phase 6 derivation and Phase 8 agent loop both require shelling out to `claude`. Whether the spawned subprocess inherits the user's shell environment (specifically `ANTHROPIC_API_KEY`, or the Claude Code credential stored in the OS keychain) when launched via `tauri-plugin-shell` `Command::new("claude")` is undocumented. In macOS, app-launched subprocesses do not inherit the interactive shell's `PATH` or environment unless explicitly passed. Claude Code's auth may use a keychain entry that is accessible system-wide (not environment-dependent), or it may require the `~/.claude/` config directory to be readable by the subprocess.

Day-1 validation check: Write a 15-line Rust Tauri command `test_claude_auth` that shells out `Command::new("claude").args(["-p", "say the word hello"]).output()`, captures stdout and stderr, and returns them over IPC to a temporary debug panel. If stdout contains "hello", auth inheritance works. If stderr contains "not authenticated" or "API key", document the exact failure and the fix (pass `ANTHROPIC_API_KEY` explicitly via `.env()` on the `Command`). Run this before writing a single line of the derivation pipeline. This check failing means every LLM-backed feature requires a workaround that touches the core subprocess spawn path.

**Seam 2: Monaco web workers in WKWebView**

Risk: PITFALLS.md documents this as HIGH likelihood. The specific failure mode — `vite-plugin-monaco-editor` not registering worker URLs correctly under Vite 8 + `@monaco-editor/react` 4.7 — is version-specific and may have changed since the research was done. The workaround (two steps: Vite plugin + CSP blob) must be validated in `cargo tauri dev`, not browser dev mode.

Day-1 validation check: Scaffold the Tauri app, install `@monaco-editor/react`, add `vite-plugin-monaco-editor` and the `blob:` CSP entry, render a single read-only `<Editor value="const x = 1" language="typescript" />`, and run `cargo tauri dev`. Open the Tauri dev console (not the browser console — they are different). Search for "Could not create web worker". If absent, the seam is de-risked. If present, resolve before adding any Monaco UI. This check takes 20 minutes. Not doing it first guarantees discovering the issue while building the inspector, at which point it blocks all code-view work.

**Seam 3: `better-sqlite3` in a `pkg`-compiled binary on macOS**

Risk: `better-sqlite3` is a native Node.js addon. When compiled into a `pkg` binary, the native `.node` module must be bundled correctly. `pkg` has a known pattern of failing to include native addons unless explicitly referenced in the `pkg` configuration's `assets` field. The compiled `mcp-server-aarch64-apple-darwin` binary may launch without error but crash on the first `new Database(path)` call with "Could not find module `better_sqlite3.node`". This is a silent runtime failure, not a compile-time failure.

Day-1 validation check: Write a 10-line `mcp-server/test-db.js` that does `const Database = require('better-sqlite3'); const db = new Database('/tmp/test.db', { readonly: false }); db.exec('CREATE TABLE IF NOT EXISTS t (id TEXT)'); console.log('ok')`. Compile it with `pkg test-db.js --target node18-macos-arm64 --output test-db-binary`, run the binary, and confirm it prints "ok". If it fails with a native module error, document the `pkg` assets workaround before building the MCP server. This check takes 30 minutes. If skipped, the failure surfaces in Phase 5 after the full MCP tool logic is written.

**Seam 4: PostToolUse hook calling Tauri IPC from a shell script**

Risk: The PostToolUse hook is a shell script. The plan notes a decision to make during Phase 7: "whether PostToolUse hook calls a Tauri IPC endpoint directly vs. writes a flag file the Rust watcher picks up." Calling Tauri IPC from a shell script requires an HTTP server or socket that the Rust backend exposes. Tauri does not expose an HTTP server by default — its IPC is WebView-based (not network-accessible). Writing a flag file is simpler but adds latency (the `notify` watcher must detect the flag file, which adds at minimum one FSEvents polling interval). The "call Tauri IPC" path requires a localhost HTTP listener in the Rust backend, which is a non-trivial addition that is nowhere in the current architecture or stack.

Day-1 validation check: Decide and prototype the hook communication mechanism before writing any Phase 7 logic. Write a 20-line `hooks/post-tool-use.sh` that does: (1) reads stdin JSON, (2) extracts `file_path` and `transcript_path` via `jq`, (3) writes a JSON payload to `/tmp/contract-ide-hook.json`. Write a 20-line Rust snippet using `notify` to watch `/tmp/contract-ide-hook.json` for changes and log the payload. Run a test that simulates the hook firing by writing to the file manually and confirm the Rust watcher picks it up within 500ms. If this works, the flag-file approach is validated and the architecture is simpler. If it doesn't work (FSEvents delay is unacceptable), document the localhost HTTP listener approach and budget 4 hours for it.

**Seam 5: Claude Code session JSONL `transcript_path` availability in PostToolUse hook**

Risk: The architecture relies on `transcript_path` being present in the PostToolUse hook stdin payload, passed directly to the Rust JSONL parser to generate receipts. STACK.md documents this field as part of the confirmed schema. However, the confirmed schema comes from a single community source (the Medium post from February 2026), not from official Anthropic documentation. If the field name has changed, or if `transcript_path` is only present in some hook event types (e.g., `result` type but not `PostToolUse`), receipt generation silently produces empty receipts. This is the field that connects the agent run to the receipt card — every demo beat ends on a receipt card.

Day-1 validation check: Run an actual Claude Code session against any repo with a PostToolUse hook that writes its entire stdin to `/tmp/hook-payload.json`. Examine the file. Confirm `transcript_path` is present and points to an existing JSONL file. Open that JSONL file and confirm `usage.input_tokens` is populated in at least one line. This takes 20 minutes and requires only Claude Code to be installed (which is a project dependency anyway). Do this before writing a single line of the JSONL parser. If `transcript_path` is absent, the entire receipt architecture needs revision — the JSONL file must be discovered by scanning `~/.claude/projects/` instead, using `session_id` as a key.

---

## 3. Schema Review

### Sidecar Frontmatter

**Missing fields:**

`format_version` is absent. The plan proposes evolving the sidecar format (Phase 6 adds `code_hash`, the drift system adds derivation metadata, future phases may add `confidence`, `reviewed_by`, `route` for preview). Without a `format_version` field, the scanner cannot detect old-format sidecars and must either assume a fixed schema or silently parse garbage. Add `format_version: 1` now. The scanner should reject or warn on sidecars with an unrecognized version, not silently populate partial rows. This is a one-field addition that prevents a class of silent corruption bugs when the format evolves.

`contract_hash` is absent from the frontmatter. REQUIREMENTS.md DATA-01 specifies that sidecars should carry `code_hash` and `contract_hash`. ARCHITECTURE.md's sidecar schema only includes `code_hash`. This is a naming inconsistency: the requirements call for `contract_hash` (a hash of the contract body itself, used to detect human edits vs. derived rewrites), but the schema only stores `code_hash` (a hash of the source file). These are two different things. Drift detection in `drift_state` table stores `contract_code_hash` (the `code_hash` at derivation time) and `current_code_hash` (the current file hash). But nowhere is there a hash of the contract body text itself. Without `contract_hash` in the frontmatter, the system cannot distinguish "this contract was auto-derived from version X of the code" from "this contract was hand-edited by a human." The `human_pinned` flag (DERIVE-03) is mentioned in requirements but absent from the schema. Add `contract_hash` and `human_pinned: false` to the frontmatter schema.

`route` is missing. INSP-02 requires the inspector to show a live preview for UI-surface nodes at a dev server route. The preview URL is `http://localhost:PORT/<route>`. Currently there is no `route` field in the frontmatter schema. This means either (a) the route is hard-coded per demo, (b) it is stored only in SQLite (not in the source-of-truth sidecar), or (c) it gets added in Phase 4 as an ad hoc field. Option (c) is what will actually happen, and it will happen without a `format_version` bump. Add `route` now as an optional field (empty for non-UI nodes).

**Redundant fields:**

`canonical_uuid: null` when `is_canonical: true` is redundant and error-prone. Any code that processes sidecars must handle the case where `is_canonical: true` but `canonical_uuid` is non-null (a bug). Cleaner: omit `canonical_uuid` entirely when `is_canonical: true`. The scanner can enforce: if `is_canonical: false`, `canonical_uuid` is required; if `is_canonical: true`, `canonical_uuid` must be absent. This reduces one class of malformed-sidecar bugs.

**Naming inconsistency:**

`code_hash` in frontmatter vs. `contract_code_hash` and `current_code_hash` in `drift_state` table. The frontmatter uses `code_hash`; the drift table uses two different names for what are conceptually the same field at different points in time. Suggest standardizing: frontmatter uses `code_hash` (fine as-is); drift table uses `baseline_code_hash` (the hash at last derivation, same value as `nodes.code_hash`) and `current_code_hash` (the current file hash). The current `contract_code_hash` name in ARCHITECTURE.md implies this is a hash of the contract, which it is not — it is the code hash at contract-derivation time.

**Indexes that should exist from day 1:**

The current schema declares three indexes: `idx_drift_drifted`, `idx_nodes_file_path`, and `idx_nodes_level`. These cover the core queries but three are missing:

`idx_nodes_parent_uuid` on `nodes(parent_uuid)` — the graph loads children by parent UUID on every zoom. Without this index, `SELECT * FROM nodes WHERE parent_uuid = ?` is a full table scan. At L3 depth with 200+ nodes, this is noticeable.

`idx_receipts_node` on a receipts-to-nodes join. The inspector loads receipt history per node. Currently receipts store `nodes_touched` as a JSON array string, not a normalized join table. This makes "receipts for node X" a full scan of `receipts` with JSON parsing. Either add a `receipt_nodes` join table (preferred) or add a `node_uuid` column to `receipts` for the primary node of each receipt (acceptable for MVP since each cherrypick receipt is associated with one canonical node). Without this, the receipt history tab in the inspector becomes slow.

`idx_node_flows_flow` on `node_flows(flow_uuid)` — the lens switcher queries "all nodes in flow X" to render the journey lens. Without this index, switching lenses does a full scan of `node_flows`.

The FTS5 virtual table (`nodes_fts`) is present in ARCHITECTURE.md's Flow 4 section but is not in the main schema block. It must be added to the Phase 1 migrations, not Phase 9. FTS5 content tables with triggers must be created when the `nodes` table is created — adding FTS5 triggers to an already-populated table requires a manual rebuild (`INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')`). If it is deferred to Phase 9, there will be a migration step that can silently leave FTS5 out of sync.

**Migration strategy:**

No migration strategy is documented. `tauri-plugin-sql` uses sqlx migrations (numbered `.sql` files in `src-tauri/src/db/migrations/`). The plan implicitly assumes the schema is finalized in Phase 1 and never changes. It will change: Phase 6 adds derivation metadata, Phase 7 finalizes drift columns, Phase 9 may add demo-specific fields. The correct approach: add a `schema_version` pragma to the database (SQLite's `PRAGMA user_version`) and implement forward-only migrations numbered 001, 002, etc. `tauri-plugin-sql`'s migration system handles this if migration files are correctly named. The specific risk: if Phase 6 adds a `human_pinned` column to `nodes` without a migration file, existing test databases (created during Phase 1-5 work) will not have the column and Rust query code will panic at runtime with a column-not-found error. Every schema change after Phase 1 must be a numbered migration file. This is a process discipline item, not a code item, but it must be decided before the team starts building in parallel sessions.

---

## 4. What Will Bite Us by Wednesday

**Item 1: 6-10 hours burned on the `notify` + Tauri async bridge**

PITFALLS.md's integration gotchas table notes: "use a `std::sync::mpsc` channel; drain in a `spawn_blocking` thread that calls the Tauri command." This is correct, but the reason it costs time is not the channel pattern — it is the non-obvious interaction between `notify`'s callback thread, `tauri::async_runtime::spawn`, and the `AppHandle` borrow semantics required to emit Tauri events from inside the watcher callback. The `AppHandle` must be cloned and moved into the closure, which requires understanding Tauri's lifetime model. This will work correctly, but developers unfamiliar with Tauri's event system will write three incorrect versions before the correct one. The specific symptom: watcher fires (logs appear), Tauri event is emitted (no error), but the frontend listener never receives it. This happens when the event is emitted on a thread that isn't the Tauri async runtime and the event system silently drops it.

Mitigation: Before Phase 2 watcher work begins, write a single integration test: a Tauri command that starts a `notify` watcher on a temp directory, waits for a file write (from a `spawn_blocking` test thread), and emits a Tauri event. Verify the event arrives in a frontend `listen()` handler. Treat this as Phase 1 exit criterion 6. Budget 3 hours for this test to account for the async bridging discovery.

**Item 2: 8-12 hours burned on vercel/commerce contract seeding because the quality bar is higher than expected**

The plan allocates "4 hours" for seeding with a hard 25-node cap. This is optimistic for one specific reason: writing a genuinely useful contract is harder than it appears. The quality bar ("read each aloud and be able to identify the UI element uniquely") requires behavioral knowledge of `vercel/commerce` that must be acquired by actually running the app and tracing user flows. For each of the ~25 nodes, the writer must: run the dev server, navigate to the relevant route, understand what the node does in context, write a contract that passes the spot-check, and commit the sidecar. The first 5 nodes will take 3x as long as the last 5 because the writer is learning the app and the contract format simultaneously.

Mitigation: Seed the first 3 nodes (L0, one L1 flow, one L2 surface) during Phase 3, not Phase 9. These three nodes are needed for graph rendering work anyway (fixture data). Using real `vercel/commerce` nodes as fixtures kills two problems: the graph canvas is tested with real content, and the seeding learning curve is distributed across the build week rather than crammed into Phase 9. Reserve Phase 9 for the remaining 22 nodes, which go faster once the format and quality bar are internalized.

**Item 3: 4-8 hours burned because the `claude` CLI flag for non-interactive prompt mode has changed or behaves unexpectedly in subprocess context**

Flow 3 (Cherrypick) and Flow 1 (Derivation) both use `claude -p "<prompt>"` as the invocation pattern. SUMMARY.md flags this as an open question: "`claude` CLI `-p` flag behavior in current CLI version — validate before Rust `run_agent` wiring." The `-p` flag is undocumented in the official Claude Code docs (it appears in community usage). In recent Claude Code versions, the correct flag for a non-interactive prompt may be `--print`, `--prompt`, or piped stdin rather than `-p`. Additionally, the subprocess may exit with a non-zero code when rate-limited, and Rust's error handling must distinguish rate-limit errors (retry-able) from auth errors (fatal) from bad-prompt errors (user-visible). None of this error handling is in the plan.

Mitigation: On day 1 of Phase 6, before writing the derivation orchestration, run this exact command in a terminal: `claude -p "respond with only the word hello" 2>&1`. If it works, record the exact flag. If it does not, test `echo "respond with only the word hello" | claude --print` and `claude --prompt "respond with only the word hello"`. Document the working invocation pattern as a constant in `derivation.rs` before building the batch pipeline. Add explicit error matching on exit codes: 0 = success, 1 = model error (log + skip), 2 = auth error (surface to user), 3+ = unknown (log raw stderr).

---

## 5. Ambition Assessment

The plan is over-ambitious for the timeline, but by a targeted amount that can be corrected by one specific cut.

The 39 v1 requirements map to 9 phases in roughly 7 days. The count is not the problem — many requirements are straightforward implementation work. The problem is that the critical path has no slack. Phase 8 (cherrypick end-to-end, the primary demo beat) depends on 7 prior phases all completing without rework. Any phase that requires a second pass — and at least two will (Phase 4's Monaco/WKWebView validation, Phase 7's dual notification path) — compresses the time available for Phase 9 (demo seeding and rehearsal). Phase 9 is the phase most likely to be skipped or rushed, and it is the phase the video depends on entirely.

The specific cut: collapse Phase 7's PostToolUse hook into Phase 8. The PostToolUse hook is not required for Demo Beat 1 (the agent writes a file, the user sees the receipt, they click approve). Drift detection via the `notify` watcher alone is sufficient to demonstrate the red-pulse moat during the demo. The hook adds "live drift after agent writes" — a real capability, but not the demo's primary narrative. Moving it to Phase 8 gives Phase 7 only the `notify`-based drift detection (which is straightforward: file watcher fires, hash compared, `drift_state` updated, event emitted). Phase 8 then adds the hook as a component of the agent loop, because by Phase 8 the agent infrastructure exists. This is actually a better architectural sequence: the hook reads `transcript_path`, which requires the JSONL parsing infrastructure that is Phase 8 work anyway.

If that cut is not made, the minimum buffer addition is: plan for Phase 4 to take 1.5x its estimated time due to WKWebView, and plan for Phase 7 to take 1.5x due to the dual-path notification race. Without that buffer, Phase 9 starts on day 6 with a 2-day budget for seeding, rehearsal, and video production.

---

## 6. Hidden Dependency Nobody Has Called Out

**The demo depends on `vercel/commerce` being runnable locally on the demo machine at the exact moment of filming.**

Every demo beat assumes a live localhost preview pane showing before/after states. Beat 3 (non-coder copy edit) specifically ends on a receipt comparison — but its premise is that the PM can see the live app before and after the copy change. `vercel/commerce` is a Next.js 14+ commerce app with a Shopify backend dependency. Running it locally requires either Shopify API credentials (which are not committed to the repo) or a specific demo mode / mock store configuration. The plan says "start the dev server before filming" and "hardcode port 3000" — but it never asks: can `vercel/commerce` run offline or with mocked credentials on the demo machine?

If the answer is no, the live preview pane shows a blank iframe during the demo. The team discovers this the night before filming, after all the contract seeding and beat rehearsal work is complete.

The validation: clone `vercel/commerce` today, run `npm run dev`, and see what happens on a machine without Shopify credentials. If it requires a `.env` with API keys, identify the minimum keys required (likely a read-only Shopify Storefront API token from a free development store), create a demo store, and commit the `.env.demo` file (with non-secret demo credentials) to the demo repo. This is not a code task — it is a logistics task — but it gates the live preview feature on which Beat 3 depends.

If `vercel/commerce` cannot run without live API calls, the fallback is to replace the live preview pane with a static screenshot comparison (before/after screenshots committed to the demo repo). This is not as compelling but it is reliable. The decision must be made before Phase 4 (live preview pane implementation) begins, not after, because it changes what INSP-02 actually requires the inspector to show.

---

## Summary

The planning documents are exceptionally thorough for a hackathon project. The schema, data flows, and pitfall catalogue represent significantly more pre-build rigor than typical. The execution risks are concentrated in four areas: (1) the Phase 7 concurrent-write race is the only correctness bug in the architecture as designed; (2) the `claude` CLI subprocess auth inheritance is an unvalidated assumption that all LLM-backed features depend on; (3) the `better-sqlite3` native addon in a `pkg` binary is an unvalidated assumption that the MCP sidecar depends on; (4) `vercel/commerce` runnability on the demo machine is unvalidated and gates the live preview feature.

The five day-1 validation checks in Section 2 should be run in this priority order: Claude CLI auth (Seam 1), `transcript_path` in PostToolUse hook (Seam 5), Monaco workers in WKWebView (Seam 2), `better-sqlite3` in pkg binary (Seam 3), flag-file hook communication prototype (Seam 4).

The schema additions with highest priority: add `format_version`, `contract_hash`, `human_pinned`, and `route` to the sidecar frontmatter schema before Phase 2 implementation begins. Add `idx_nodes_parent_uuid`, `idx_node_flows_flow`, and the `receipt_nodes` join table (or `node_uuid` on receipts) to the Phase 1 migrations. Move FTS5 virtual table creation into Phase 1 migrations.

---
*Technical review completed: 2026-04-24*
