# Architecture Research

**Domain:** Agent-native macOS IDE — semantic contract graph
**Researched:** 2026-04-24
**Confidence:** HIGH (design-level decisions from locked stack; all integration patterns verified against Tauri 2 docs, MCP SDK, and Claude Code hook schema in STACK.md)

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│  TAURI APP PROCESS                                                       │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  FRONTEND (WKWebView — React + TypeScript)                        │   │
│  │  ┌──────────────┐  ┌─────────────┐  ┌──────────────────────┐    │   │
│  │  │ Graph Canvas  │  │  Inspector  │  │  Chat / Receipts     │    │   │
│  │  │ @xyflow/react │  │  Panel      │  │  Panel               │    │   │
│  │  └──────┬───────┘  └──────┬──────┘  └──────────┬───────────┘    │   │
│  │         └─────────────────┴──────────────────────┘               │   │
│  │                     Zustand Store                                  │   │
│  │                  (graph, selection, chat)                          │   │
│  │                     Tauri invoke() / listen()                      │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                          Tauri IPC bridge                                │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  RUST BACKEND (src-tauri)                                         │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────┐   │   │
│  │  │  IPC        │  │  File Watcher │  │  Subprocess Manager   │   │   │
│  │  │  Commands   │  │  (notify)     │  │  (tauri-plugin-shell) │   │   │
│  │  └──────┬──────┘  └──────┬───────┘  └───────────┬───────────┘   │   │
│  │         └────────────────┴───────────────────────┘               │   │
│  │                       SQLite cache                                │   │
│  │                   (tauri-plugin-sql / sqlx)                       │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌─────────────────────────┐   ┌────────────────────────────────────┐   │
│  │  MCP SERVER SIDECAR      │   │  LIVE PREVIEW SIDECAR              │   │
│  │  (TypeScript binary)     │   │  (optional iframe)                 │   │
│  │  stdio ↔ Claude Code     │   │                                    │   │
│  │  better-sqlite3          │   │                                    │   │
│  │  (read-only SQLite conn) │   │                                    │   │
│  └─────────────────────────┘   └────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
         │                                    │
         │ tauri-plugin-shell spawn           │ localhost HTTP
         ▼                                    ▼
┌─────────────────────┐            ┌──────────────────────┐
│  claude CLI          │            │  Target repo dev      │
│  (external process)  │            │  server (npm run dev) │
│  session JSONL →     │            │  spawned as sidecar   │
│  transcript_path     │            └──────────────────────┘
└─────────────────────┘
```

---

## Component Boundaries

| Component | Responsibility | Communicates Via | Owns |
|-----------|---------------|-----------------|------|
| **Frontend** | Graph rendering, inspector UI, chat panel, receipt display, lens switching | Tauri `invoke()` + `listen()` | Zustand state, React component tree |
| **Rust Backend** | SQLite writes, file watcher, `claude` CLI spawn, contract derivation orchestration, hook relay | Tauri IPC commands + events | SQLite DB file (writer), `.contracts/` scanner |
| **MCP Server Sidecar** | Expose `find_by_intent`, `get_contract`, `list_drifted_nodes`, `update_contract` to Claude Code | stdio (MCP protocol) with Claude Code; read-only SQLite connection | Nothing — reads SQLite, writes `.contracts/*.md` only via `update_contract` |
| **Claude Code** | Agent execution, tool use, code edits | MCP stdio to sidecar; JSONL transcript file on disk | `~/.claude/projects/<repo>/` session JSONL |
| **PostToolUse Hook** | Re-derive contracts after `Write`/`Edit` tool calls | Reads stdin JSON, calls Tauri IPC endpoint (or writes a flag file Rust watches) | Nothing persistent |

---

## Source of Truth

**Canonical:** `.contracts/<uuid>.md` sidecar files (YAML frontmatter + markdown body)

**Derived cache:** SQLite — rebuilt from sidecars on startup, updated incrementally when sidecars change.

**Rule:** Nothing writes to SQLite except Rust. Nothing is authoritative except the sidecar `.md` files. If SQLite and sidecar disagree, sidecar wins; Rust reconciles on startup and on file-watcher events.

The MCP server holds a **read-only** SQLite connection. It may call `update_contract` which writes the sidecar `.md`; Rust's file watcher then detects the change and updates SQLite. The MCP server never writes SQLite directly. This eliminates the dual-source-of-truth risk.

---

## Schemas

### Sidecar Frontmatter (`.contracts/<uuid>.md`)

```yaml
---
uuid: "01942b3c-7d8e-4f1a-9c2e-3b4a5d6e7f80"      # stable, random v4 UUID
level: "L3"                                          # L0 | L1 | L2 | L3 | L4
name: "CheckoutConfirmButton"                        # human-readable display name
file_path: "components/checkout/ConfirmButton.tsx"   # metadata only — not identity
export_name: "ConfirmButton"                         # exported symbol (atoms/components)
parent_uuid: "01942b3c-7d8e-0000-0000-aabbccddeeff"  # canonical parent in the graph
is_canonical: true                                   # false = ghost reference node
canonical_uuid: null                                 # if is_canonical=false, points to canonical
flow_uuids: ["uuid-flow-checkout"]                   # which L1 flows this node appears in
code_hash: "sha256:abc123..."                        # hash of AST/source at last derivation
derived_at: "2026-04-24T10:30:00Z"                   # ISO timestamp
derived_by: "claude-opus-4"                          # model used for derivation
tags: ["button", "checkout", "cta"]                  # free-form for find_by_intent search
---

Natural-language contract body. One paragraph describing intent, inputs, outputs,
invariants, and user-visible behavior. Written in present tense. No implementation details.

## Invariants
- Disabled while cart is empty
- Shows spinner while POST /api/checkout is in flight
- On success, navigates to /order-confirmation

## Inputs
- `onConfirm: () => Promise<void>` — async handler injected by parent
- `isLoading: boolean` — controls spinner state

## Outputs
- Calls `onConfirm()` on click
- Emits `checkout:confirmed` analytics event
```

Required fields: `uuid`, `level`, `name`, `file_path`, `is_canonical`, `code_hash`, `derived_at`.
Optional: `export_name`, `parent_uuid`, `canonical_uuid`, `flow_uuids`, `tags`, `derived_by`.

### SQLite Tables

```sql
-- Primary node registry
CREATE TABLE nodes (
  uuid          TEXT PRIMARY KEY,
  level         TEXT NOT NULL CHECK(level IN ('L0','L1','L2','L3','L4')),
  name          TEXT NOT NULL,
  file_path     TEXT,
  export_name   TEXT,
  parent_uuid   TEXT REFERENCES nodes(uuid),
  is_canonical  INTEGER NOT NULL DEFAULT 1,  -- 1=true, 0=false
  canonical_uuid TEXT REFERENCES nodes(uuid),
  code_hash     TEXT,
  derived_at    TEXT,
  derived_by    TEXT,
  contract_body TEXT,                         -- full markdown body (sans frontmatter)
  tags          TEXT,                         -- JSON array string
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Flow membership (many-to-many: nodes can appear in multiple flows)
CREATE TABLE node_flows (
  node_uuid   TEXT NOT NULL REFERENCES nodes(uuid),
  flow_uuid   TEXT NOT NULL REFERENCES nodes(uuid),
  PRIMARY KEY (node_uuid, flow_uuid)
);

-- Graph edges (parent-child and cross-flow references)
CREATE TABLE edges (
  id          TEXT PRIMARY KEY,              -- uuid
  source_uuid TEXT NOT NULL REFERENCES nodes(uuid),
  target_uuid TEXT NOT NULL REFERENCES nodes(uuid),
  edge_type   TEXT NOT NULL CHECK(edge_type IN ('parent_child','reference','canonical_ref')),
  label       TEXT
);

-- Drift state: code has changed since contract was last derived
CREATE TABLE drift_state (
  node_uuid         TEXT PRIMARY KEY REFERENCES nodes(uuid),
  current_code_hash TEXT NOT NULL,   -- hash of code RIGHT NOW
  contract_code_hash TEXT NOT NULL,  -- hash when contract was derived (= nodes.code_hash)
  drifted_at        TEXT NOT NULL,
  reconciled_at     TEXT            -- NULL = still drifted
);

-- Receipt cards produced per claude CLI run
CREATE TABLE receipts (
  id              TEXT PRIMARY KEY,              -- session_id from JSONL
  session_id      TEXT NOT NULL,
  transcript_path TEXT NOT NULL,
  started_at      TEXT,
  finished_at     TEXT,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  cache_read_tokens INTEGER,
  tool_call_count INTEGER,
  nodes_touched   TEXT,                          -- JSON array of uuids
  prompt_chars    INTEGER,
  estimated_cost_usd REAL,
  raw_summary     TEXT,                          -- summary field from JSONL if present
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index: drift detection query
CREATE INDEX idx_drift_drifted ON drift_state(reconciled_at) WHERE reconciled_at IS NULL;
-- Index: nodes by file path (for hook re-derivation)
CREATE INDEX idx_nodes_file_path ON nodes(file_path);
-- Index: nodes by level (for graph loading by zoom level)
CREATE INDEX idx_nodes_level ON nodes(level);
```

### Session JSONL Shape (for receipt parsing)

```typescript
// Top-level envelope — every line
interface JournalEntry {
  type: 'user' | 'assistant' | 'tool_result' | 'system' | 'summary' | 'result' | string;
  uuid: string;
  parentUuid: string | null;
  timestamp: string;      // ISO
  sessionId: string;
  cwd: string;
  message?: AssistantMessage | UserMessage | ToolResultMessage | SummaryMessage | ResultMessage;
}

// What to extract per receipt:
interface ReceiptExtract {
  session_id: string;                    // from any entry.sessionId
  input_tokens: number;                  // sum of entry.message.usage?.input_tokens
  output_tokens: number;                 // sum of entry.message.usage?.output_tokens
  cache_read_tokens: number;             // sum of entry.message.usage?.cache_read_input_tokens ?? 0
  tool_calls: ToolUseBlock[];            // all entry.message.content[] where type === 'tool_use'
  nodes_touched: string[];               // tool_calls where name in MCP tools → extract node uuids
  summary_text: string | null;           // entry where type === 'summary'
}

// Parse defensively — all fields optional chained:
const usage = entry?.message?.usage;
const inputToks = usage?.input_tokens ?? 0;
```

Parse in a streaming pass over the JSONL file (one JSON.parse per line). Do not load the full file into memory. Accumulate counts. The `transcript_path` is provided by the PostToolUse hook stdin — use it directly.

---

## Data Flows

### Flow 1: Contract Derivation

Who calls whom, in order:

```
1. TRIGGER: User clicks "Derive contracts" for a node (or batch for N nodes)
   Frontend → invoke('derive_contracts', { node_uuids: [...], repo_path })

2. Rust: reads file_path for each node_uuid from SQLite
   Rust: reads source file contents from disk

3. Rust: calls LLM (via claude CLI or direct API)
   For MVP: shell out to `claude -p "<prompt>"` with code context
   IMPORTANT: batch nodes — 1 LLM call per file, not per export. A file with
   3 exports gets 1 prompt asking for all 3 contracts. Limits calls for
   100-file repo to ~100 LLM calls not ~300+.

4. Rust: parses LLM response (JSON array of { uuid, contract_body })

5. Rust: updates .contracts/<uuid>.md sidecar (writes new body + updated code_hash + derived_at)

6. Rust file watcher fires on .contracts/ change

7. Rust: updates SQLite nodes row (contract_body, code_hash, derived_at)
   Rust: clears drift_state row for these uuids if drifted

8. Rust: emit Tauri event 'contracts:updated' with { node_uuids }

9. Frontend: receives event → updates Zustand store → graph nodes re-render
   (green pulse → normal; red drift pulse clears)
```

**Cost control for 100-file repo:**
- Derive lazily: only L3/L4 nodes that are visible at current zoom + their L2 parents
- Batch by file: 1 prompt per source file covering all exports in that file
- Cache aggressively: skip derivation if `code_hash` matches current file hash
- Prioritize: derive canonical nodes before ghost references (ghosts inherit from canonical)

### Flow 2: Drift Detection

```
1. TRIGGER A (startup): Rust scans all nodes in SQLite, computes code_hash per file_path
   TRIGGER B (file watcher): notify fires on any source file change in the repo

2. Rust: for each changed file_path, find nodes by index idx_nodes_file_path
   Rust: compute sha256 of the file's relevant export (or whole file for L0-L2)
   Simple hash: sha256(file_content) is sufficient for MVP; AST hash deferred

3. Rust: compare current_hash vs nodes.code_hash
   If different: INSERT OR REPLACE INTO drift_state (node_uuid, current_code_hash, ...)
   If same: DELETE FROM drift_state WHERE node_uuid = ? (no longer drifted)

4. Rust: emit Tauri event 'drift:updated' with { drifted: [uuid,...], resolved: [uuid,...] }

5. Frontend: updates Zustand drift set → @xyflow/react nodes with drifted=true
   get a red CSS ring animation class (no rerender of whole graph — just class toggle)
```

**Implementation note:** Drift is detected at file level for MVP. Per-export AST hashing (tree-sitter) is a stretch goal. File-level hashing catches all real edits; false positives (comment-only changes) are acceptable for a demo.

### Flow 3: Cherrypick Edit

```
1. User: finds node by intent (search or graph click) → selects it
   Frontend: renders Inspector with contract body, Monaco code view, live preview

2. User: edits contract body in Inspector (contenteditable or Monaco)
   Frontend: marks node as "contract dirty" in Zustand (local, not saved yet)

3. User: clicks "Compile" (or "Ask agent to implement")
   Frontend → invoke('run_agent', { node_uuid, instruction: "<diff between old/new contract>" })

4. Rust: spawns `claude` CLI as child process
   Command: claude --project <repo_path> "<instruction>"
   Rust: streams stdout lines back via Tauri event 'agent:stream' for chat panel

5. Claude Code: uses MCP tools (find_by_intent, get_contract) via MCP sidecar
   Claude Code: produces code edits via Write/Edit tool calls
   PostToolUse hook fires → calls Tauri invoke('hook:post_tool_use', {tool_name, file_path, transcript_path})

6. Rust: receives hook event → queues derivation for affected file_path
   Rust: parses transcript_path JSONL (streaming) → constructs receipt

7. Claude Code exits → Rust: emit 'agent:done' with { receipt_id }

8. Frontend: shows Monaco DiffEditor with proposed code changes
   (Contract edit is shown alongside code diff — both pending approval)

9. User: clicks "Approve Both"
   Frontend → invoke('approve_edit', { node_uuid, contract_body, code_patch })

10. Rust: atomic commit:
    a. Write updated .contracts/<uuid>.md
    b. Apply code patch to source file (or confirm it's already written by Claude Code)
    c. UPDATE nodes SET contract_body=..., code_hash=<new_hash>, derived_at=... WHERE uuid=?
    d. DELETE FROM drift_state WHERE node_uuid = ?
    e. Emit 'contracts:updated' + 'drift:updated'
    ATOMICITY: steps a+b are filesystem ops (not transactional); wrap in Rust with
    write-to-temp-then-rename for the sidecar; Claude Code already wrote the source file.
    If sidecar write fails, flag the node as needing re-derivation rather than leaving
    inconsistent state.
```

### Flow 4: Mass Semantic Edit

```
1. User: types intent into mass-edit search ("all CTA buttons should use primary color")
   Frontend → invoke('find_by_intent', { query, level: 'L3', limit: 50 })

2. Rust: full-text search over nodes.contract_body + nodes.tags in SQLite
   (SQLite FTS5 virtual table — add to schema; index contract_body + name + tags)
   Returns ranked list of matching node_uuids

3. Frontend: renders multi-select diff preview — user picks which nodes to include

4. User: clicks "Edit All Selected"
   Frontend → invoke('run_agent_batch', { node_uuids: [...], instruction: "..." })

5. Rust: single `claude` CLI invocation with instruction referencing all N nodes
   Instruction includes UUIDs and contract summaries; Claude Code uses MCP get_contract
   for each node and produces N code patches in one session

6. (Same hook/receipt flow as cherrypick, but receipt.nodes_touched has N entries)

7. Frontend: Monaco DiffEditor shows N file diffs in a tabbed/paged approve-all UI

8. User: "Approve All" → N atomic writes (same as cherrypick x N)
```

**SQLite FTS5 addition:**
```sql
CREATE VIRTUAL TABLE nodes_fts USING fts5(
  uuid UNINDEXED,
  name,
  contract_body,
  tags,
  content='nodes',
  content_rowid='rowid'
);
-- Triggers to keep FTS in sync:
CREATE TRIGGER nodes_ai AFTER INSERT ON nodes BEGIN
  INSERT INTO nodes_fts(rowid, uuid, name, contract_body, tags)
  VALUES (new.rowid, new.uuid, new.name, new.contract_body, new.tags);
END;
CREATE TRIGGER nodes_ad AFTER DELETE ON nodes BEGIN
  INSERT INTO nodes_fts(nodes_fts, rowid, uuid, name, contract_body, tags)
  VALUES ('delete', old.rowid, old.uuid, old.name, old.contract_body, old.tags);
END;
CREATE TRIGGER nodes_au AFTER UPDATE ON nodes BEGIN
  INSERT INTO nodes_fts(nodes_fts, rowid, uuid, name, contract_body, tags)
  VALUES ('delete', old.rowid, old.uuid, old.name, old.contract_body, old.tags);
  INSERT INTO nodes_fts(rowid, uuid, name, contract_body, tags)
  VALUES (new.rowid, new.uuid, new.name, new.contract_body, new.tags);
END;
```

### Flow 5: Receipt Generation

```
1. TRIGGER: 'agent:done' event fires (after `claude` CLI exits)
   Rust has transcript_path from the PostToolUse hook stdin

2. Rust: open transcript_path, stream-parse JSONL line by line
   Extract: session_id, sum(input_tokens), sum(output_tokens), sum(cache_read_tokens),
            all tool_use blocks, summary text

3. Rust: identify nodes_touched from tool_use blocks where tool name is
   'get_contract' or 'update_contract' → extract node_uuid argument

4. Rust: estimate cost:
   cost = (input_tokens * $3/1M) + (output_tokens * $15/1M)  -- adjust per current pricing
   (Parse defensively; use 0 if fields missing)

5. Rust: INSERT INTO receipts (...) with all extracted fields

6. Rust: emit 'receipt:created' with { receipt_id }

7. Frontend: receipt card rendered in side panel with:
   - tokens in/out/cache-read
   - estimated cost
   - tool call count
   - nodes touched (clickable → navigate to node)
   - duration (finished_at - started_at)
```

---

## MCP Server Access Pattern

The MCP server is a TypeScript sidecar process spawned by `tauri-plugin-shell` when the app starts. It holds a **read-only** `better-sqlite3` connection to the same SQLite file Rust owns.

```
sqlite file: <app_data_dir>/contract-ide.db

Rust backend    → readwrite connection (sqlx, via tauri-plugin-sql)
MCP sidecar     → readonly connection (better-sqlite3: new Database(path, { readonly: true }))
```

**No dual source of truth because:**
1. MCP server never INSERTs or UPDATEs SQLite directly.
2. `update_contract` tool writes the sidecar `.md` file only; Rust's file watcher propagates the change to SQLite.
3. `find_by_intent` and `get_contract` are pure reads against the Rust-maintained SQLite.
4. `list_drifted_nodes` is a read of `drift_state` table, also Rust-maintained.

**Cache invalidation:** The MCP server's `better-sqlite3` connection is effectively always fresh because SQLite's WAL mode makes committed writes from Rust immediately visible to other readers without any connection-level cache to invalidate. No polling or notification mechanism needed. SQLite WAL handles this natively.

**Startup sequencing:** Rust opens SQLite and runs migrations first. MCP sidecar is spawned after the Tauri `setup()` hook completes. The sidecar should retry the SQLite open with a 100ms back-off (max 3 retries) if the file doesn't exist yet.

---

## Node Identity Strategy

**Identity:** UUID in frontmatter. The filename (`<uuid>.md`) is redundant with the frontmatter UUID — it exists only for human readability and is not used as a lookup key anywhere in the system.

**File path is metadata, not identity.** When a source file is renamed or moved:
1. `notify` fires a `Rename` event with old and new paths.
2. Rust detects old path in `nodes.file_path` → updates `file_path` in both SQLite and the sidecar frontmatter.
3. UUID does not change. Graph edges are unaffected.
4. Receipt history referencing the node by UUID remains valid.

**Refactor detection pseudocode:**
```rust
// In file watcher event handler:
match event.kind {
  EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => {
    let old_path = &event.paths[0];
    let new_path = &event.paths[1];
    // Update file_path in nodes table and sidecar frontmatter
    update_node_file_path(db, old_path, new_path).await?;
    // Re-hash with new path to check drift
    recompute_drift(db, new_path).await?;
  }
  // ...
}
```

**Symbol-level renames** (export renamed within the same file): detected by drift. The code hash changes, node is marked drifted. User reconciles by running derivation again. The UUID persists through the reconcile. This is acceptable for MVP.

**Ghost reference nodes** share the canonical node's UUID in their `canonical_uuid` field. Ghost nodes do not have their own sidecar files — they are SQLite-only rows with `is_canonical=0`. When the canonical node is updated, all ghost references reflect the change immediately (they read from the canonical row via JOIN). Ghost nodes are re-created from flow membership data on cache rebuild; they do not need their own persistence.

---

## Build Order

Build in dependency order. Each phase unblocks the next.

### Phase 1: SQLite schema + Rust IPC skeleton
**What:** Create migrations, basic `get_nodes`, `get_edges`, emit stub events.
**Why first:** All other components (frontend graph, MCP server, derivation pipeline) read from SQLite. Nothing can be integrated until the schema is stable.
**Deliverable:** `tauri::command` functions that return mock nodes from SQLite; file watcher stub that logs events.

### Phase 2: Sidecar contract file format + scanner
**What:** Define and validate YAML frontmatter schema; write Rust scanner that reads `.contracts/` and populates SQLite on startup.
**Why second:** Contract files are the source of truth. The scanner is needed before any real graph data can flow.
**Deliverable:** `cargo test` for scanner with fixture `.contracts/` directory; SQLite populated from `.md` files.

### Phase 3: Graph canvas + Zustand store
**What:** @xyflow/react graph rendering L0–L4 nodes from SQLite via IPC. Node types: Canonical, Ghost, Drifted.
**Why third:** Needs SQLite schema (Phase 1) but doesn't need derivation or agents.
**Deliverable:** Graph renders hand-curated fixture nodes; zoom navigates levels; click selects.

### Phase 4: Inspector panel + Monaco code view
**What:** Inspector renders selected node's contract body + source code (read-only Monaco). Contract editor (write mode).
**Why fourth:** Needs graph selection (Phase 3) and file reading (Phase 2).
**Deliverable:** Clicking a node shows its contract and code side-by-side.

### Phase 5: MCP server sidecar
**What:** TypeScript MCP server with all four tools; compiled to binary sidecar; spawned at app start.
**Why fifth:** Claude Code needs the MCP server to use the IDE as a tool. Needs SQLite schema stable (Phase 1).
**Deliverable:** `claude` can call `find_by_intent` and `get_contract` against live app data.

### Phase 6: Contract derivation pipeline
**What:** Rust calls LLM (via `claude -p`) to produce contracts for L3/L4 nodes; writes sidecars; fires derivation events.
**Why sixth:** Needs scanner (Phase 2), IPC (Phase 1), MCP tools available is a bonus.
**Deliverable:** "Derive" button in inspector triggers derivation and updates contract body.

### Phase 7: Drift detection + PostToolUse hook
**What:** File watcher computes code hashes; drift_state populated; PostToolUse hook script written and registered.
**Why seventh:** Needs Phase 6 (code_hash baseline from derivation).
**Deliverable:** Editing a source file causes its node to pulse red; hook re-derives after Claude Code edits.

### Phase 8: Agent loop + receipt generation
**What:** `run_agent` IPC command spawns `claude` CLI; streams output to chat panel; receipt JSONL parsing.
**Why eighth:** Needs everything above — nodes, MCP server, hook, SQLite receipts table.
**Deliverable:** Cherrypick flow end-to-end; receipt card appears after agent completes.

### Phase 9: Mass edit + approve-all UI
**What:** FTS5 search, multi-node diff approval, batch agent run.
**Why ninth:** Needs cherrypick flow proven (Phase 8).
**Deliverable:** Mass edit beat works for demo.

### Phase 10: Demo repo seeding + polish
**What:** Hand-curate `vercel/commerce` L0–L2 contracts; lens switcher UI; receipt pinning; vibrancy.
**Deliverable:** 3-minute demo reproducible.

---

## Architectural Risks

### Risk 1: IPC Shape Instability
**Problem:** Tauri `invoke()` returns `Promise<any>`. No compile-time check that Rust command signatures match TypeScript call sites. Breakage is silent until runtime.
**Mitigation:** Create `src/ipc/` module with typed wrappers around every `invoke()` call. Define `interface` types for all payloads that mirror Rust structs. Test IPC commands with integration tests. Consider TauRPC if the IPC surface grows beyond ~10 commands.
**Build gate:** Write all IPC wrappers in Phase 1 before any other component uses them.

### Risk 2: MCP Cache Staleness Window
**Problem:** MCP server reads SQLite; Rust writes SQLite. In WAL mode the window between a Rust write completing and the MCP server seeing it is sub-millisecond (SQLite WAL shared-memory). But if the MCP sidecar opens a long-lived transaction, it blocks visibility.
**Mitigation:** MCP server must use `better-sqlite3` in readonly mode with no explicit transactions (or only immediate read transactions). Never hold open write transactions. Use `db.pragma('journal_mode = WAL')` on both connections to confirm WAL is active.

### Risk 3: Contract Derivation Cost at Scale
**Problem:** A 100-file repo with 3 exports/file = 300 potential nodes. At 1 LLM call/file = 100 calls. At $0.01/call = $1. At $0.10/call (long prompts) = $10. For a demo this is manageable but could block iteration.
**Mitigation:**
- Only derive nodes that are visible in the current graph zoom (lazy derivation).
- Skip derivation if `code_hash` matches — most re-runs cost nothing.
- For `vercel/commerce` demo: hand-curate L0–L2 (10–20 nodes); auto-derive only L3/L4 nodes that appear in the 3 demo flows (~30–50 nodes). Total: ~15–25 LLM calls.
- Use `claude -p` with `--model claude-haiku-4` for derivation (cheaper, fast enough for 1-paragraph contracts).

### Risk 4: Atomicity of Contract + Code Commits
**Problem:** Cherrypick flow writes both the `.contracts/<uuid>.md` sidecar and the source file. If the app crashes between the two writes, state is inconsistent (contract updated, code not updated or vice versa).
**Mitigation:**
- Write sidecar to a `.contracts/<uuid>.md.tmp` temp file first, then `fs::rename` (atomic on macOS HFS+/APFS).
- The source file is written by Claude Code (before the hook fires). By the time the user clicks "Approve", the source file change is already on disk. "Approve" only writes the sidecar. So the race window is: source file written (Claude Code) → user approves → sidecar written (Rust).
- If sidecar write fails: node stays with old contract + `code_hash` mismatch → drift detection flags it immediately → user can re-derive. No data loss, predictable recovery.

### Risk 5: Live Preview Iframe Security
**Problem:** The inspector panel iframe loads `localhost:<port>` (the target repo's dev server). WKWebView's CSP may block cross-origin iframes even for localhost.
**Mitigation:**
- In `tauri.conf.json`: add `"dangerouslyDisableContentSecurityPolicy": false` but add explicit CSP exception for `frame-src http://localhost:*`.
- Actually: spawn the target repo's `npm run dev` as a Tauri sidecar (or just `tauri-plugin-shell` child process), capture the port, then set the iframe `src` to that port after the dev server is ready.
- For demo: hardcode port 3000 for `vercel/commerce`; no dynamic port discovery needed.
- Do NOT use `webview` inside webview (not supported). Use `<iframe>` — WKWebView renders it correctly for localhost with proper CSP.

### Risk 6: Node Identity After Aggressive Refactors
**Problem:** If a developer moves AND renames a file AND renames the export in one commit, the `notify` rename event gives old + new paths, but the export name change is invisible to the file watcher. The code hash changes, drift is flagged, but the node appears to reference a missing export.
**Mitigation:**
- For MVP: accept this edge case. Drift detection will flag it. User reconciles by re-deriving.
- `export_name` field in frontmatter is informational only; the system does not depend on it being accurate for identity resolution.
- Post-MVP: integrate tree-sitter to track export renames, not just file renames.

---

## Project Structure

```
contract-ide/
├── src/                          # React frontend
│   ├── ipc/                      # Typed wrappers around tauri invoke()
│   │   ├── nodes.ts              # get_nodes, derive_contracts, approve_edit
│   │   ├── agent.ts              # run_agent, run_agent_batch
│   │   └── types.ts              # Shared IPC payload types (mirror Rust structs)
│   ├── store/                    # Zustand stores
│   │   ├── graph.ts              # nodes, edges, selection, zoom level, lens
│   │   ├── chat.ts               # messages, streaming state
│   │   └── receipts.ts           # receipt cards
│   ├── components/
│   │   ├── graph/                # @xyflow/react canvas + custom node types
│   │   │   ├── ContractNode.tsx
│   │   │   ├── GhostNode.tsx
│   │   │   └── GraphCanvas.tsx
│   │   ├── inspector/            # Right panel: contract + code + preview + history
│   │   ├── chat/                 # Bottom panel: streaming chat + receipt list
│   │   └── ui/                   # shadcn/ui components
│   └── App.tsx
│
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── main.rs               # Tauri setup, plugin registration (no #[tokio::main])
│   │   ├── commands/             # All #[tauri::command] functions
│   │   │   ├── nodes.rs          # get_nodes, get_node, derive_contracts
│   │   │   ├── agent.rs          # run_agent, approve_edit
│   │   │   └── receipts.rs       # get_receipts
│   │   ├── db/                   # SQLite access layer
│   │   │   ├── migrations/       # SQL migration files (numbered)
│   │   │   └── queries.rs        # Typed query functions
│   │   ├── scanner.rs            # .contracts/ directory scanner
│   │   ├── watcher.rs            # notify file watcher + event dispatch
│   │   ├── drift.rs              # Code hash computation + drift_state management
│   │   ├── receipt.rs            # JSONL parsing for receipts
│   │   └── derivation.rs         # LLM call orchestration (batch, cache-aware)
│   ├── binaries/
│   │   └── mcp-server-aarch64-apple-darwin   # Compiled MCP sidecar binary
│   └── Cargo.toml
│
├── mcp-server/                   # TypeScript MCP sidecar source
│   ├── src/
│   │   ├── index.ts              # StdioServerTransport setup
│   │   ├── tools/
│   │   │   ├── find_by_intent.ts
│   │   │   ├── get_contract.ts
│   │   │   ├── list_drifted_nodes.ts
│   │   │   └── update_contract.ts
│   │   └── db.ts                 # better-sqlite3 readonly connection
│   ├── package.json
│   └── tsconfig.json
│
├── hooks/                        # Claude Code hook scripts
│   └── post-tool-use.sh          # Registered in ~/.claude/settings.json
│
└── .contracts/                   # Sidecar contract files (in the target repo, not here)
    └── <uuid>.md                 # One per node
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: MCP Server Writing SQLite
**What:** MCP sidecar does `INSERT INTO nodes` or `UPDATE drift_state` directly.
**Why bad:** Creates dual source of truth. Rust and MCP server have different connection lifecycles; writes from both can corrupt WAL state or create phantom rows.
**Instead:** MCP `update_contract` writes the `.md` sidecar file only. Rust file watcher updates SQLite. One writer.

### Anti-Pattern 2: UUID Generation in Frontend
**What:** React generates UUIDs for new nodes before the node is persisted.
**Why bad:** If the IPC call fails, frontend has an orphan UUID that never gets a sidecar. UUID generation becomes ambiguous (crypto.randomUUID vs uuid package vs Rust nanoid).
**Instead:** Rust generates UUIDs (`uuid` crate) on `create_node` command, persists both sidecar and SQLite atomically, returns the UUID to the frontend.

### Anti-Pattern 3: Polling for Drift State
**What:** Frontend calls `get_drift_state` on a timer to check for red nodes.
**Why bad:** Unnecessary IPC chatter; 1-second poll = 86,400 IPC calls/day while idle.
**Instead:** Rust emits `drift:updated` event when drift state changes. Frontend subscribes with `listen()` and updates Zustand. Zero-cost when idle.

### Anti-Pattern 4: Full Graph Load on Every IPC Call
**What:** `get_nodes` returns all nodes in SQLite on every graph update.
**Why bad:** At L4 zoom for a 100-file repo, this could be thousands of nodes serialized across IPC.
**Instead:** Load by level and viewport: `get_nodes({ level: 'L3', parent_uuid: selectedL2 })`. The graph canvas loads children lazily as the user zooms. L0–L2 is always loaded (small); L3–L4 loaded on demand.

### Anti-Pattern 5: Blocking the Tauri Main Thread During Derivation
**What:** LLM derivation calls run synchronously in a Tauri command handler.
**Why bad:** Freezes the UI for the duration of 30+ LLM calls.
**Instead:** Use `tauri::async_runtime::spawn()` to run derivation in the background. Emit `derivation:progress` events as each node completes. Frontend shows progress per-node, not a spinner.

---

## Sources

- Tauri IPC docs: https://v2.tauri.app/develop/calling-rust/ — command system, serde requirements
- Tauri sidecar docs: https://v2.tauri.app/learn/sidecar-nodejs/ — binary naming, permissions
- MCP StdioServerTransport: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
- Claude Code PostToolUse hook schema: https://code.claude.com/docs/en/hooks (confirmed in STACK.md)
- SQLite WAL mode: https://www.sqlite.org/wal.html — concurrent reader/writer semantics
- SQLite FTS5: https://www.sqlite.org/fts5.html — full-text search virtual tables
- notify crate events: https://docs.rs/notify/8.2.0/notify/event/enum.EventKind.html — rename semantics
- better-sqlite3 readonly: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md — `{ readonly: true }` option
- APFS atomic rename: POSIX rename(2) is atomic on APFS and HFS+ — applicable to macOS sidecar writes

---
*Architecture research for: Contract IDE — agent-native macOS IDE with semantic contract graph*
*Researched: 2026-04-24*
