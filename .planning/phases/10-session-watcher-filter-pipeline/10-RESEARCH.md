# Phase 10: Session Watcher + Filter Pipeline - Research

**Researched:** 2026-04-24
**Domain:** Claude Code JSONL session lifecycle, Rust notify watcher extension, SQLite schema, jq filtering, episode chunking
**Confidence:** HIGH

---

## Summary

Phase 10 is the ingestion half of the harvest-first substrate pipeline: an ambient `SessionWatcher` watches `~/.claude/projects/<cwd-key>/*.jsonl` for session activity, filters the raw JSONL to conversational text (~97% size reduction, zero content loss), chunks into episodes, and persists to new SQLite `sessions` + `episodes` tables. Phase 11 reads these episodes and runs the LLM distiller. Nothing in Phase 10 itself calls an LLM.

The kernel experiment (`.planning/research/constraint-distillation/`) validated the entire pipeline end-to-end: the single `jq` filter reduces a 627KB JSONL to 12KB, and the 1.3MB JSONL to 27KB, with zero loss of user/assistant text. The fixture files (`extracted-5f44f5af.json`, `extracted-efadfcc4.json`) are the regression test targets Phase 10 must reproduce at the filtering step.

The implementation extends, not rewrites, Phase 7's `SourceWatcher` infrastructure. A second `notify::RecommendedWatcher` instance (`SessionWatcher`) watches the Claude projects directory. The `cwd-key` derivation rule is confirmed: replace every `/` in the cwd path with `-` (e.g., `/Users/yang/lahacks` → `-Users-yang-lahacks`). The Rust `notify` library operates at OS level and requires no Tauri capability scope adjustments to watch `~/.claude/` paths.

**Primary recommendation:** Ship `SessionWatcher` as a parallel `notify::RecommendedWatcher` in a new `session/` Rust module (mirrors `drift/watcher.rs`), filter in Rust with a `serde_json`-based loop (same as jq semantics but native, no subprocess), chunk by turn-pair boundary, and expose a `list_ingested_sessions()` MCP tool + footer `SessionStatusIndicator` using the established `mcp:status`/`drift:changed` event pattern.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SUB-01 | Sessions table + SessionWatcher: ambient ingestion of Claude Code JSONL sessions into SQLite within 2s of first user message | Session lifecycle validated (user messages land on disk immediately, append-only, no compaction delay); notify::RecommendedWatcher fires on FSEvents Modify/Create within ~1s on macOS |
| SUB-02 | Filter pipeline + episode chunking: reduce JSONL to conversational text (<50KB from 1MB), idempotent episode chunks, opt-in backfill with cost preview | Kernel experiment confirms 97.7% reduction; episode boundary definition derived from JSONL structure analysis; cost preview = filtered_chars / 4 * LLM_RATE |
</phase_requirements>

---

## User Constraints

No CONTEXT.md exists for Phase 10 yet. Constraints flow from CLAUDE.md and ROADMAP.md:

**Locked decisions from ROADMAP.md Phase 10 planning notes:**
- Rust `SessionWatcher` extends existing `SourceWatcher` from Phase 7 — same `notify::RecommendedWatcher` infrastructure
- Filter implementation can shell out to `jq` initially; port to native Rust if hot-path latency demands
- No new external services — all storage is local SQLite, all watching is local `notify`
- No LLM calls in Phase 10 (Phase 11 does distillation)
- Anything that fires a Claude API call MUST go through `tauri-plugin-shell` → `claude -p` MCP-pattern (no ANTHROPIC_API_KEY) — but Phase 10 makes no Claude calls

**Out of scope:**
- LLM distillation of episodes into typed nodes (Phase 11)
- Graphiti bitemporal storage (Phase 12)
- Substrate UI (Phase 13)
- Embedding generation, semantic retrieval (Phase 11)

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `notify` | 8 (already in Cargo.toml) | FSEvents-backed file watcher for `~/.claude/projects/` | Already ships in Phase 7 SourceWatcher; same version, zero new dep |
| `serde_json` | (transitive, already present) | Parse JSONL lines, filter to conversational content | Already used throughout codebase for contract parsing |
| `tauri-plugin-sql` / `sqlx` | 0.8 (already in Cargo.toml) | Write `sessions` + `episodes` rows | Established DB pattern from Phase 1/2 |
| `chrono` | 0.4 (already in Cargo.toml) | RFC3339 timestamps on session rows | Already added in Phase 7 for `drift_state.drifted_at` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `dashmap` | 6 (already in Cargo.toml) | Per-session processing lock | Reuse Phase 7's DashMap pattern for per-session serialization guard |
| `std::env::var("HOME")` | stdlib | Resolve `~/.claude/projects/` path | No `dirs` crate needed; `$HOME` is reliable on macOS, set by login shell |
| MCP sidecar TypeScript | existing | `list_ingested_sessions()` tool | Follows existing MCP tool pattern from Phase 5 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native Rust filter | Shell out to `jq` subprocess | `jq` is simpler to prototype but adds process overhead per file change. Native Rust with serde_json is ~5x faster and avoids jq-not-installed failures. The kernel experiment's jq filter logic is simple to port (see Code Examples below). Recommend native Rust for v1 — no subprocess overhead, no `jq` dependency assumption |
| Per-session `tokio::Mutex` | Global Mutex | Same reason as Phase 7: per-session granularity prevents re-ingestion of session A from blocking session B's update |
| Recursive directory watch on `~/.claude/projects/<cwd-key>/` | Watch individual files | Recursive watch on the project subdirectory is cleaner than individual-file watches for JSONL — new session files are created dynamically and can't be pre-registered |

**Installation:** No new deps required. All needed crates are already in `Cargo.toml` from Phases 7/8.

---

## Claude Code JSONL Session File Lifecycle

**VALIDATED from direct inspection of `~/.claude/projects/-Users-yang-lahacks/` files.**

### File creation and location

```
~/.claude/projects/<cwd-key>/<session-id>.jsonl
```

- **`cwd-key` derivation:** Replace every `/` in the cwd absolute path with `-`. Leading `/` becomes leading `-`. Examples:
  - `/Users/yang/lahacks` → `-Users-yang-lahacks`
  - `/Users/yang/lahacks/contract-ide` → `-Users-yang-lahacks-contract-ide`
  - `/Users/yang/lahacks/contract-ide/src-tauri` → `-Users-yang-lahacks-contract-ide-src-tauri`
- Each Claude Code session creates one `.jsonl` file at session start.
- The file is **append-only** during a session. Lines grow as the session progresses.
- Session UUID is in the filename and also in every line's `sessionId` field.

### Line types (from direct inspection)

| Line `type` | Top-level fields | Role for Phase 10 |
|-------------|-----------------|-------------------|
| `file-history-snapshot` | `type, messageId, snapshot, isSnapshotUpdate` | **Skip** — not conversational |
| `user` | `type, message, uuid, timestamp, sessionId, cwd, gitBranch, version, isMeta, userType, entrypoint, parentUuid, isSidechain, promptId` | **Filter** — keep non-meta lines where `message.content` is a plain string |
| `assistant` | `type, message, uuid, timestamp, sessionId, cwd, gitBranch, version, parentUuid, isSidechain, requestId` — `message.content` is an array | **Filter** — keep text-type content blocks only |
| `system` | `type, subtype, content, level, timestamp, ...` | **Skip** |
| `attachment` | `type, attachment, uuid, timestamp, ...` | **Skip** |
| `last-prompt` | `type, lastPrompt, sessionId` | **Skip** |
| `queue-operation` | `type, operation, timestamp, sessionId, content` | **Skip** |

### User message content shapes

A `user` line's `message.content` can be:
- **Plain string:** This is the actual human prompt. Extract it. Example: `"how much do I need to do and how much can you check yourself"`
- **Array with `tool_result` items:** This is Claude Code feeding back tool output. **Skip for filtering** — contains no human conversational text.
- **String starting with `<`:** Preamble/system injection (e.g., `<local-command-caveat>...`). Skip if `isMeta: true`.

Check `isMeta: true` first. If `isMeta` is set, skip regardless of content shape.

### Assistant message content shapes

`message.content` is always an array. Items can be:
- `{ type: "text", text: "..." }` — **Keep** — Claude's conversational response
- `{ type: "tool_use", id, name, input, caller }` — **Skip** — not conversational text
- `{ type: "thinking", thinking: "..." }` — **Skip** — internal chain-of-thought

`message.usage` contains `{ input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, ... }` — used for receipt parsing (Phase 8) but **not needed for Phase 10 filtering**.

### Session file growth rate

From the two kernel experiment sessions:
- 5f44f5af: 185 lines, 627KB — 4 plain user prompts, 45 tool-result user lines, 24 assistant-text items
- efadfcc4: 429 lines, 1.3MB — 14 plain user prompts, 117 tool-result user lines, 37 assistant-text items

**Stat: conversational content is 2–3% of raw JSONL by bytes.** The 95%+ reduction claim is real.

### Session lifecycle edge cases (risk: race conditions)

**First user message:** The first non-meta user line with a plain-string content appears very early in the file (line 2-3, after the initial `file-history-snapshot`). The notify watcher will fire on the first `Modify(Data(Content))` event within ~1s of the first append. This satisfies SC1 (2s latency from first user message).

**`/clear` command:** Creates a NEW session file with a new UUID. The old session file is preserved on disk unchanged. The watcher picks up the new file as a `Create` event. No compaction of the existing file.

**`/compact` command:** Claude Code writes a summary back as a user message in the CURRENT session file, then continues. Based on directory inspection: the UUID directories (e.g., `5f44f5af.../`) contain only a `subagents/` subdirectory, not a compacted summary file. The main `.jsonl` file is not rewritten during compaction — it is appended to. Race risk is **LOW**: notify fires on append events, the watcher re-processes the file from a tracked line offset, and idempotency guards (content hash on `episode_id`) prevent duplicate entries.

**Session end:** The JSONL file stays on disk indefinitely after session end. No cleanup or compaction. The file is effectively immutable after the session terminates.

**Concurrent sessions:** Multiple `claude` processes can run simultaneously in different cwds. Each writes to its own project-key subdirectory and own UUID file. No cross-session race.

---

## Filter Strategy: Native Rust (Recommended)

### The exact filter logic (derived from kernel experiment + JSONL structure analysis)

The jq equivalent in pseudocode:

```
for each line in session.jsonl:
  obj = parse_json(line)
  if obj.type == "user":
    if obj.isMeta == true: skip
    content = obj.message.content
    if content is a string:
      if not content.starts_with("<"): emit {role: "user", text: content, ts: obj.timestamp, uuid: obj.uuid}
    if content is an array:
      for item in content:
        if item.type == "text": emit {role: "user", text: item.text, ts: obj.timestamp, uuid: obj.uuid}
        # tool_result items: skip
  if obj.type == "assistant":
    content = obj.message.content  # always array
    for item in content:
      if item.type == "text": emit {role: "assistant", text: item.text, ts: obj.timestamp, uuid: obj.uuid}
      # tool_use, thinking: skip
  # all other types: skip
```

### Why native Rust over jq subprocess

1. **No `jq` dependency** — jq is not guaranteed on all macOS installs; `brew install jq` is a dev assumption not a user assumption.
2. **No subprocess overhead** — Spawning a subprocess per file-change event adds 20-100ms latency. The 2s SC1 target has margin but subprocess overhead is unnecessary.
3. **Simpler error handling** — No stdout parsing, no exit-code checking, no PATH discovery.
4. **The logic is trivial** — The filter is ~30 lines of `serde_json::Value` walking. This is not complex enough to warrant a specialized tool.
5. **Regression test purity** — The fixture comparison works directly in Rust test code without shelling out.

**Migration path if perf ceiling hit:** Add a `jq` subprocess path as a compile-time feature flag. In practice, at <5MB per session (confirmed from real files: 627KB, 1.3MB, 808KB), serde_json parsing is microseconds-per-line, not a bottleneck.

### Debounce settings from Phase 7

Phase 7's `SourceWatcher` does NOT use explicit debounce — it relies on notify's native FSEvents coalescing and fires `compute_and_emit` on every `Modify/Create/Remove` event. For `SessionWatcher`, debounce matters more because a single agent turn can trigger 10+ `Modify` events as the JSONL grows. Recommended approach: use notify's built-in event batching (`notify::Config::default()`) and process on every batch, but track the last-processed line offset per session to avoid re-scanning the entire file on each event.

---

## Episode Chunk Boundary Definition

**Episode = one user prompt + all assistant turns + tool interactions that follow, ending at the next user prompt.**

From direct JSONL analysis of the kernel experiment sessions:
- A "conversational turn" is one `user` plain-string message + the `assistant` text response(s) that follow
- Tool-use blocks (`tool_use`, `tool_result`) are mechanical scaffolding, not conversational content (per kernel experiment finding: "Tool-use content not required — Claude narrates its reasoning enough in conversational text")
- An **episode boundary** is at each new non-meta `user` plain-string message

**Concrete episode rule:**
```
episode starts: at a non-meta user message with plain-string content
episode ends: just before the NEXT non-meta user message with plain-string content
            OR at the end of the file
episode content: the filtered text of that user message + all assistant text blocks until the boundary
```

**Episode identifier for idempotency:**
```
episode_id = sha256(session_id + ":" + start_line_index.to_string())
```

Using `start_line_index` (the 0-based line number of the first `user` message that opens the episode) rather than a content hash prevents collisions if the same text appears twice in a session. Combined with `session_id`, this is globally unique and deterministic.

**Re-ingestion idempotency:** Use `INSERT OR IGNORE INTO episodes ...` with `episode_id` as PRIMARY KEY. Re-ingesting the same JSONL produces identical episode IDs at identical line offsets → zero duplicate writes. New episodes appended since last ingest have higher line offsets → new rows.

**Plain conversational turns with no tool use:** Yes, these are episodes too. A user question followed by an assistant explanation (no tool calls) is a valid episode and often the highest-quality source for constraints/decisions (per kernel experiment finding: "Bug-fix sessions are highest-density source — every bug fixed = a reusable rule").

---

## SQLite Schema

### Migration sequencing

Current: v1 (`create_core_tables`), v2 (`add_code_ranges_and_kind`)
Phase 8 adds: v3 (`phase8_receipts_and_journal` — extends receipts, adds `rollup_derived`)
Phase 9: no new tables (uses existing schema)
Phase 10: v4 (`phase10_sessions_and_episodes` — new `sessions` + `episodes` tables)

Phase 10's migration is **version 4**. It must be added to `get_migrations()` in `src-tauri/src/db/migrations.rs` following the immutable-migration rule (never edit existing versions).

### `sessions` table

```sql
CREATE TABLE IF NOT EXISTS sessions (
    session_id       TEXT PRIMARY KEY,         -- Claude's UUID from filename
    cwd_key          TEXT NOT NULL,            -- e.g. '-Users-yang-lahacks'
    repo_path        TEXT,                     -- resolved absolute path for this cwd_key
    started_at       TEXT NOT NULL,            -- ISO-8601 UTC — from first user message timestamp
    last_seen_at     TEXT NOT NULL,            -- ISO-8601 UTC — updated on each ingest cycle
    episode_count    INTEGER NOT NULL DEFAULT 0,
    bytes_raw        INTEGER NOT NULL DEFAULT 0,   -- raw JSONL file size at last ingest
    bytes_filtered   INTEGER NOT NULL DEFAULT 0,   -- filtered text size at last ingest
    last_line_index  INTEGER NOT NULL DEFAULT 0,   -- last processed line (for incremental ingest)
    state            TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'ended' | 'compacted'
    ingested_at      TEXT NOT NULL              -- ISO-8601 UTC — when first ingested
);
CREATE INDEX IF NOT EXISTS idx_sessions_cwd_key ON sessions(cwd_key);
CREATE INDEX IF NOT EXISTS idx_sessions_state ON sessions(state);
```

**`last_line_index`** is critical for incremental re-ingest. On each watcher event, read the file starting from `last_line_index`, process new lines only, append to episodes, update `last_line_index + episode_count + bytes_*`.

### `episodes` table

```sql
CREATE TABLE IF NOT EXISTS episodes (
    episode_id       TEXT PRIMARY KEY,         -- sha256(session_id + ":" + start_line)
    session_id       TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    start_line       INTEGER NOT NULL,         -- 0-based line index of opening user message
    end_line         INTEGER NOT NULL,         -- 0-based line index of last line in episode
    filtered_text    TEXT NOT NULL,            -- concatenated user+assistant text, newline-separated
    content_hash     TEXT NOT NULL,            -- sha256(filtered_text) — for change detection
    turn_count       INTEGER NOT NULL DEFAULT 1, -- number of user turns in this episode
    created_at       TEXT NOT NULL             -- ISO-8601 UTC
);
CREATE INDEX IF NOT EXISTS idx_episodes_session_id ON episodes(session_id);
CREATE INDEX IF NOT EXISTS idx_episodes_created_at ON episodes(created_at);
```

**Why no `role` column:** The filtered text preserves `[User]: ...` / `[Assistant]: ...` prefixes so Phase 11's distiller can distinguish speakers without an extra join.

**Why no embedding column:** Phase 11 adds embedding support. Phase 10 stores raw filtered text only.

---

## Architecture Patterns

### Recommended Project Structure

```
src-tauri/src/
├── drift/            # Phase 7 SourceWatcher (unchanged)
│   ├── engine.rs
│   ├── state.rs
│   └── watcher.rs
├── session/          # NEW Phase 10 module
│   ├── mod.rs        # pub mod state; pub mod ingestor; pub mod watcher;
│   ├── state.rs      # SessionLocks — per-session tokio::Mutex (mirrors drift/state.rs)
│   ├── ingestor.rs   # filter_session(), chunk_episodes(), upsert_session(), upsert_episodes()
│   └── watcher.rs    # SessionWatcher — notify::RecommendedWatcher for ~/.claude/projects/<cwd-key>/
├── commands/
│   └── session.rs    # NEW — list_ingested_sessions(), trigger_backfill() Tauri commands
└── db/
    └── migrations.rs # EXTEND — add v4 migration for sessions + episodes
```

### Pattern 1: SessionWatcher (mirrors SourceWatcher exactly)

**What:** A second `notify::RecommendedWatcher` instance watching the per-project Claude session directory. Completely separate from `SourceWatcher` — parallel, not shared.

**When to use:** Parallel watcher, NOT shared. Rationale: `SourceWatcher` watches source files inside the repo; `SessionWatcher` watches `~/.claude/projects/<cwd-key>/` which is OUTSIDE the repo. Different path domains, different callback logic, different managed state. Mixing them creates cross-cutting concerns. The `notify` library is cheap — multiple `RecommendedWatcher` instances each use a separate FSEvents subscription.

```rust
// src-tauri/src/session/watcher.rs
// Source: mirrors drift/watcher.rs pattern exactly

pub struct SessionWatcher {
    inner: std::sync::Mutex<Option<notify::RecommendedWatcher>>,
}

impl SessionWatcher {
    pub fn new() -> Self {
        Self { inner: std::sync::Mutex::new(None) }
    }

    /// Set (or replace) the watched directory when a repo is opened.
    /// Watches ~/.claude/projects/<cwd-key>/ recursively for *.jsonl changes.
    pub fn watch_project(&self, app: AppHandle, cwd_key: &str) -> anyhow::Result<()> {
        let projects_dir = claude_projects_dir()?.join(cwd_key);
        if !projects_dir.exists() {
            // Session dir doesn't exist yet — not an error (user may not have run claude here)
            eprintln!("[session] projects dir {:?} not found — deferring watch", projects_dir);
            return Ok(());
        }

        let app_cb = app.clone();
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            let Ok(event) = res else { return };
            match event.kind {
                notify::EventKind::Modify(_) | notify::EventKind::Create(_) => {}
                _ => return,
            }
            for path in &event.paths {
                if path.extension().and_then(|e| e.to_str()) != Some("jsonl") { continue; }
                let session_id = path.file_stem()
                    .and_then(|s| s.to_str())
                    .map(str::to_string);
                let Some(session_id) = session_id else { continue };
                let app2 = app_cb.clone();
                let path2 = path.clone();
                tauri::async_runtime::spawn(async move {
                    crate::session::ingestor::ingest_session_file(app2, session_id, path2).await;
                });
            }
        })?;

        watcher.watch(&projects_dir, notify::RecursiveMode::NonRecursive)?;
        *self.inner.lock().unwrap() = Some(watcher);
        Ok(())
    }
}

/// Resolve ~/.claude/projects/ path
fn claude_projects_dir() -> anyhow::Result<std::path::PathBuf> {
    let home = std::env::var("HOME").map_err(|_| anyhow::anyhow!("HOME not set"))?;
    Ok(std::path::PathBuf::from(home).join(".claude").join("projects"))
}
```

**Key differences from SourceWatcher:**
- Watches a directory non-recursively (all session files are at the top level of `<cwd-key>/`)
- Filters to `.jsonl` extension in the callback
- Dispatches to `ingest_session_file` instead of `compute_and_emit`
- Uses `NonRecursive` on the session project dir (not individual files) — new session files created mid-watch are picked up because we watch the directory

### Pattern 2: Filter + Ingest (pure Rust, no jq subprocess)

```rust
// src-tauri/src/session/ingestor.rs

/// Filter a JSONL session file to conversational text.
/// Returns Vec<(role, text, line_index)> for lines after `start_from_line`.
pub fn filter_session_lines(
    path: &Path,
    start_from_line: usize,
) -> anyhow::Result<Vec<FilteredTurn>> {
    let file = std::fs::File::open(path)?;
    let reader = std::io::BufReader::new(file);
    let mut results = Vec::new();

    for (i, line_result) in reader.lines().enumerate() {
        if i < start_from_line { continue; }
        let Ok(line) = line_result else { continue };
        let Ok(obj) = serde_json::from_str::<serde_json::Value>(&line) else { continue };

        match obj.get("type").and_then(|t| t.as_str()) {
            Some("user") => {
                // Skip meta messages
                if obj.get("isMeta").and_then(|m| m.as_bool()).unwrap_or(false) { continue; }
                let content = obj.get("message").and_then(|m| m.get("content"));
                match content {
                    Some(serde_json::Value::String(s)) if !s.starts_with('<') => {
                        results.push(FilteredTurn {
                            role: "user".into(),
                            text: s.clone(),
                            line_index: i,
                            timestamp: obj.get("timestamp").and_then(|t| t.as_str()).unwrap_or("").into(),
                        });
                    }
                    Some(serde_json::Value::Array(items)) => {
                        for item in items {
                            if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                                if let Some(t) = item.get("text").and_then(|t| t.as_str()) {
                                    results.push(FilteredTurn { role: "user".into(), text: t.into(), line_index: i, timestamp: "".into() });
                                }
                            }
                            // tool_result items: skip
                        }
                    }
                    _ => {}
                }
            }
            Some("assistant") => {
                if let Some(serde_json::Value::Array(items)) = obj.get("message").and_then(|m| m.get("content")) {
                    for item in items {
                        if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                            if let Some(t) = item.get("text").and_then(|t| t.as_str()) {
                                results.push(FilteredTurn { role: "assistant".into(), text: t.into(), line_index: i, timestamp: "".into() });
                            }
                        }
                        // tool_use, thinking: skip
                    }
                }
            }
            _ => {} // skip all other types
        }
    }

    Ok(results)
}
```

### Pattern 3: Episode Chunking

```rust
/// Chunk filtered turns into episodes by user-prompt boundaries.
/// Episode = one user turn + all following assistant turns until the next user turn.
pub fn chunk_episodes(
    turns: &[FilteredTurn],
    session_id: &str,
) -> Vec<Episode> {
    let mut episodes = Vec::new();
    let mut current_user_line: Option<usize> = None;
    let mut current_texts: Vec<String> = Vec::new();
    let mut start_line: usize = 0;
    let mut end_line: usize = 0;

    for turn in turns {
        if turn.role == "user" {
            // Flush previous episode
            if current_user_line.is_some() && !current_texts.is_empty() {
                let filtered_text = current_texts.join("\n");
                let episode_id = compute_episode_id(session_id, start_line);
                episodes.push(Episode {
                    episode_id,
                    session_id: session_id.into(),
                    start_line,
                    end_line,
                    filtered_text,
                });
                current_texts.clear();
            }
            start_line = turn.line_index;
            current_user_line = Some(turn.line_index);
            current_texts.push(format!("[User]: {}", turn.text));
        } else {
            current_texts.push(format!("[Assistant]: {}", turn.text));
        }
        end_line = turn.line_index;
    }
    // Flush final episode
    if !current_texts.is_empty() && current_user_line.is_some() {
        let filtered_text = current_texts.join("\n");
        let episode_id = compute_episode_id(session_id, start_line);
        episodes.push(Episode { episode_id, session_id: session_id.into(), start_line, end_line, filtered_text });
    }

    episodes
}

fn compute_episode_id(session_id: &str, start_line: usize) -> String {
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(format!("{}:{}", session_id, start_line));
    format!("{:x}", hasher.finalize())
}
```

### Pattern 4: Watcher Integration with open_repo

Following Phase 7's `refresh_source_watcher_from_db` pattern, `SessionWatcher::watch_project()` must be called from `open_repo` after `scan_contracts_dir` completes:

```rust
// In commands/repo.rs open_repo, AFTER existing watcher refresh:
let cwd_key = derive_cwd_key(&path);
let session_watcher = app.state::<crate::session::watcher::SessionWatcher>();
if let Err(e) = session_watcher.watch_project(app.clone(), &cwd_key) {
    eprintln!("[session] watcher failed to start: {e}");
    // Non-fatal — repo still opens, substrate collection degrades gracefully
}

fn derive_cwd_key(path: &Path) -> String {
    path.to_str()
        .unwrap_or("")
        .replace('/', "-")
}
```

### Pattern 5: Footer SessionStatusIndicator

Mount alongside `McpStatusIndicator` in the same `<footer>` element in `AppShell.tsx`:

```tsx
// AppShell.tsx footer (existing):
<footer className="fixed bottom-0 right-0 z-10 flex items-center gap-2 border-l border-t border-border/40 bg-background/80 backdrop-blur-sm">
  <McpStatusIndicator />
  <SessionStatusIndicator />  {/* NEW — Phase 10 */}
</footer>
```

The `SessionStatusIndicator` subscribes to a new `session:status` Tauri event with payload `{ watching_sessions: number, episodes_ingested: number }`. Emitted by the watcher on each ingest cycle. UI: `"N sessions · M episodes"` with a small dot indicator (green = watching, gray = no session dir found).

This mirrors `McpStatusIndicator` exactly — subscribe to event + seed from `get_session_status` IPC on mount.

### Anti-Patterns to Avoid

- **DO NOT** add `SessionWatcher` as a field on `SourceWatcher`. They are separate concerns (repo source files vs. user's Claude sessions). Keep them in separate modules.
- **DO NOT** shell out to `jq`. Native Rust serde_json parsing is faster, has no external dependency, and is already used throughout the codebase.
- **DO NOT** watch `~/.claude/projects/` globally (all projects). Watch only `~/.claude/projects/<cwd-key>/` for the currently-open repo. Avoids ingesting sessions from unrelated projects and keeps privacy surface minimal.
- **DO NOT** auto-ingest historical sessions. Backfill is strictly opt-in (SC4). The watcher only ingests sessions that are active or newly created after the repo is opened.
- **DO NOT** hold the watcher across `open_repo` calls without resetting. When a new repo is opened, call `watch_project` with the new cwd-key (this replaces the inner watcher via `Mutex<Option<RecommendedWatcher>>`).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Home directory path | Custom platform detection | `std::env::var("HOME")` | Set by macOS login shell; `dirs` crate would be a new dep; `HOME` is reliable |
| Content hash for episode_id | Custom hash | `sha2::Sha256` (already in `Cargo.toml` via `commands/derive.rs`) | Same crate already used for `code_hash` computation |
| Per-session processing lock | ad-hoc check | `DashMap<String, Arc<tokio::sync::Mutex<()>>>` (same `DriftLocks` pattern) | Per-session mutex prevents concurrent re-ingestion of the same file |
| Atomic file writes for sessions DB | Raw sqlx | `INSERT OR REPLACE` / `INSERT OR IGNORE` on `episode_id PK` | SQLite handles the idempotency; no custom locking needed |
| Tauri event subscription in React | Custom fetch loop | `listen<SessionStatusEvent>('session:status', ...)` (same pattern as `mcp:status`) | Established pattern, works at hackathon scale |

---

## Common Pitfalls

### Pitfall 1: Watching at the Wrong Granularity

**What goes wrong:** Watch `~/.claude/projects/` at the top level → picks up session files from ALL other projects on the machine, not just the open repo. Privacy issue + performance issue.

**Why it happens:** Temptation to build a "global session watcher" for future extensibility.

**How to avoid:** Watch `~/.claude/projects/<cwd-key>/` only. Derive cwd-key from the currently-open `repo_path`. Reset the watcher when the repo changes.

**Warning signs:** `session:status` shows far more sessions than expected; sessions from unrelated projects appear in `list_ingested_sessions()`.

### Pitfall 2: FSEvents Coalescing on Rapid JSONL Growth

**What goes wrong:** A busy `claude` session writing many tool-use turns triggers 10+ FSEvents in quick succession. If the callback re-processes the full file each time, it scans N lines on the first event and N+delta lines on all subsequent events that fired before the first completed → O(N*events) total work.

**Why it happens:** Naive "re-read the whole file on any event."

**How to avoid:** Persist `last_line_index` per session in the `sessions` table. On each watcher event, start reading from `last_line_index`. Update `last_line_index` after processing. This makes each event O(new_lines_since_last_check) — typically a handful.

**Warning signs:** App stutters when a busy Claude session is active; CPU spike in the Rust backend.

### Pitfall 3: Race Between Multiple Events for the Same Session

**What goes wrong:** Two concurrent `ingest_session_file` calls for the same session_id can both read `last_line_index = 50`, process lines 50–60, and both try to insert duplicate episode rows.

**Why it happens:** `notify` can fire multiple events close together; `tauri::async_runtime::spawn` starts them concurrently.

**How to avoid:** Per-session `tokio::sync::Mutex` via `DashMap<session_id, Arc<tokio::sync::Mutex<()>>>` (SessionLocks, same pattern as DriftLocks). Acquire the lock before reading `last_line_index`. Even if `INSERT OR IGNORE` handles duplicates, the lock prevents unnecessary redundant DB reads.

### Pitfall 4: cwd-key Missing the Project Directory

**What goes wrong:** The `~/.claude/projects/<cwd-key>/` directory doesn't exist yet (user has never run `claude` in this repo). The watcher registration silently fails or panics.

**Why it happens:** First time the app is opened for a repo where Claude Code hasn't been used yet.

**How to avoid:** In `watch_project`, check if the directory exists. If not, log and return `Ok(())`. The watcher will not start, but that's correct behavior — there are no sessions to ingest. When the user first runs `claude` in this directory, Claude Code creates the directory, but the watcher won't pick up the new directory because it wasn't watching `~/.claude/projects/` globally.

**Resolution:** Two options: (1) Also watch `~/.claude/projects/` top-level for `Create` events that match the expected cwd-key, re-registering `watch_project` when the directory appears. (2) Require the user to reopen the repo after first running `claude`. Option 1 is more seamless; Option 2 is simpler. Recommend Option 1 for demo polish, but Option 2 is acceptable for Phase 10.

### Pitfall 5: `/clear` Creates a New Session UUID

**What goes wrong:** User runs `/clear` mid-session. A new `.jsonl` file with a new UUID appears in the project directory. If the watcher only watches the specific file registered at repo-open time, it misses the new file.

**Why it happens:** Individual-file watching (like SourceWatcher does for source files) vs. directory-level watching.

**How to avoid:** Watch the `<cwd-key>/` **directory** with `RecursiveMode::NonRecursive` (not individual `.jsonl` files). Directory-level watching in notify automatically picks up new files created in the watched directory. This is the correct approach for JSONL files since they are created dynamically.

### Pitfall 6: Backfill Token Preview Must NOT Make a Claude API Call

**What goes wrong:** Building a "real" token estimation by calling the Claude tokenization API.

**Why it happens:** Temptation to get exact counts.

**How to avoid:** Token preview = `filtered_bytes / 4` (chars to tokens approximation). This is accurate within 20% for English text and sufficient for a UI preview. The distiller (Phase 11) will report actual tokens on the receipt; Phase 10 just needs a ballpark. No API calls, no ANTHROPIC_API_KEY.

**Calculation for typical sessions:**
- 627KB raw → ~12KB filtered → ~3,000 tokens → ~$0.01 at current Sonnet rates
- 1.3MB raw → ~27KB filtered → ~6,700 tokens → ~$0.02 at current Sonnet rates

### Pitfall 7: Backfill IPC Surface

**What goes wrong:** Implementing `POST /ingest-backfill` as an HTTP endpoint — the IDE has no HTTP server.

**Why it happens:** The ROADMAP spec says "POST /ingest-backfill" which is shorthand notation.

**How to avoid:** Implement as a **Tauri IPC command** `trigger_backfill(session_ids: Vec<String>) -> Result<Vec<BackfillPreview>, String>`. The frontend calls it via `invoke('trigger_backfill', { session_ids })`. The UI shows the preview (estimated token cost per session) and asks for confirmation before calling `execute_backfill(session_ids: Vec<String>)`. Two-step: preview command, then execute command.

### Pitfall 8: notify Does NOT Need Tauri Capability Scope

**What goes wrong:** Assuming `tauri-plugin-fs` capability scopes restrict Rust-level `notify` watching.

**Why it happens:** The `requireLiteralLeadingDot = false` and `fs:scope` settings in `tauri.conf.json` and `capabilities/default.json` only affect the JS-layer file APIs (`fs:allow-read-text-file`, etc.). Rust code using `notify::RecommendedWatcher` directly calls macOS FSEvents APIs — no Tauri sandboxing applies.

**How to avoid:** No capability changes needed for Phase 10. The Rust watcher will work on `~/.claude/projects/` with zero config. Confirm by checking: `SourceWatcher` already watches `repo_path` (outside `$APPDATA`) with no special capabilities.

---

## Code Examples

### Regression Test Against Kernel Experiment Fixtures

```rust
// src-tauri/tests/session_filter_tests.rs
// Regression test: filter_session_lines against the two kernel experiment JSONLs
// must produce filtered text that, when passed to the extraction prompt,
// reproduces the extracted-5f44f5af.json and extracted-efadfcc4.json fixtures.

#[test]
fn filter_5f44_reduces_to_conversational_content() {
    let session_path = home_dir()
        .join(".claude/projects/-Users-yang-lahacks/5f44f5af-7a03-4baf-ac3c-d01ce89aba67.jsonl");
    let turns = filter_session_lines(&session_path, 0).expect("filter failed");
    let total_chars: usize = turns.iter().map(|t| t.text.len()).sum();
    // Kernel experiment: 627KB → ~12KB filtered. Tolerance: < 50KB (SC2).
    assert!(total_chars < 50_000, "filtered text too large: {}", total_chars);
    // Must have at least 1 user turn and 1 assistant turn
    assert!(turns.iter().any(|t| t.role == "user"), "no user turns");
    assert!(turns.iter().any(|t| t.role == "assistant"), "no assistant turns");
    // Zero loss: every non-meta user plain-string message must appear in output
    // (verified by presence of known prompt text from kernel experiment)
}

#[test]
fn filter_efad_reduces_to_conversational_content() {
    // Same check for the 1.3MB fixture → < 50KB
}

#[test]
fn episode_chunks_are_stable_across_re_ingest() {
    let session_path = /* path to 5f44 fixture */;
    let turns_1 = filter_session_lines(&session_path, 0).unwrap();
    let episodes_1 = chunk_episodes(&turns_1, "5f44f5af-test");
    let turns_2 = filter_session_lines(&session_path, 0).unwrap();
    let episodes_2 = chunk_episodes(&turns_2, "5f44f5af-test");
    assert_eq!(episodes_1.len(), episodes_2.len(), "episode count unstable");
    for (e1, e2) in episodes_1.iter().zip(&episodes_2) {
        assert_eq!(e1.episode_id, e2.episode_id, "episode_id unstable");
    }
}
```

### `list_ingested_sessions()` MCP Tool Return Shape

```typescript
// mcp-sidecar/src/tools/list_ingested_sessions.ts
// Following existing MCP tool pattern from Phase 5

interface IngestedSession {
  session_id: string;
  cwd_key: string;
  repo_path: string | null;
  started_at: string;       // ISO-8601 UTC
  last_seen_at: string;     // ISO-8601 UTC
  episode_count: number;
  bytes_raw: number;
  bytes_filtered: number;
  state: 'active' | 'ended' | 'compacted';
}

// Tool returns: IngestedSession[]
// Query: SELECT * FROM sessions ORDER BY last_seen_at DESC LIMIT 50
// Filtered by cwd_key if CONTRACT_IDE_REPO_PATH env set (same pattern as existing tools)
```

### Tauri Command for Backfill Preview

```rust
#[tauri::command]
pub async fn get_backfill_preview(
    app: tauri::AppHandle,
    session_ids: Vec<String>,
) -> Result<Vec<BackfillPreview>, String> {
    // For each session_id, find the JSONL file, filter it, estimate token count
    let projects_dir = claude_projects_dir().map_err(|e| e.to_string())?;
    let repo_state = app.state::<crate::commands::repo::RepoState>();
    let repo_path = { repo_state.0.lock().ok().and_then(|g| g.clone()) };
    let Some(repo_path) = repo_path else { return Err("No repo open".into()); };
    let cwd_key = derive_cwd_key(&repo_path);

    let mut previews = Vec::new();
    for session_id in &session_ids {
        let jsonl_path = projects_dir.join(&cwd_key).join(format!("{}.jsonl", session_id));
        if !jsonl_path.exists() { continue; }
        let turns = filter_session_lines(&jsonl_path, 0).unwrap_or_default();
        let total_chars: usize = turns.iter().map(|t| t.text.len()).sum();
        let estimated_tokens = total_chars / 4;
        // Sonnet 3.5 input rate $3/MTok as of 2026-04. Verify before shipping.
        let estimated_cost_usd = estimated_tokens as f64 * 3.0 / 1_000_000.0;
        previews.push(BackfillPreview {
            session_id: session_id.clone(),
            estimated_tokens,
            estimated_cost_usd,
            episode_count_estimate: turns.windows(2)
                .filter(|w| w[0].role == "assistant" && w[1].role == "user")
                .count() + 1,
        });
    }
    Ok(previews)
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual jq scripts for session analysis | Native Rust serde_json filter pipeline | Phase 10 | No external jq dependency; testable with cargo test |
| Watching individual files | Directory-level notify::NonRecursive watch | Phase 10 (vs Phase 7 per-file watch) | Automatically picks up new session files created mid-watch |
| Polling for new content | notify::RecommendedWatcher FSEvents | Phase 7 + Phase 10 reuse | Sub-second latency; no polling overhead |

**Pattern evolution from Phase 7:** Phase 7's `SourceWatcher` watches individual files non-recursively. Phase 10's `SessionWatcher` watches a directory non-recursively. This is the right adaptation: source files are a known set (derived from `nodes.code_ranges`); session JSONL files are dynamically created and can't be pre-enumerated.

---

## Open Questions

1. **What is the first user message latency exactly?**
   - What we know: `file-history-snapshot` is line 0; first non-meta user message is typically line 2-3. Notify fires within ~1s on macOS FSEvents. Total path to DB row: notify (~1s) + filter (~10ms) + DB write (~5ms) = ~1.1s. Within SC1's 2s window.
   - What's unclear: Does Claude Code create the `.jsonl` file before or after the first user message? If created at session-start with just the snapshot line, the watcher fires once on Create (line 0), then again on first user message (Modify). The first `ingest_session_file` at Create time finds no user content and writes no episode. The second (at first user message) finds the first user prompt. This is correct behavior but adds ~1s to latency if the Create fires before the Modify.
   - Recommendation: Validate end-to-end against a fresh `claude` session during Plan 10-01 development. If the timing is tight, add a small backoff retry in `ingest_session_file` (wait 200ms and re-read if the filter finds no user content on a non-empty file).

2. **Backfill command: what session IDs to show the user?**
   - What we know: Historical session files in `~/.claude/projects/<cwd-key>/` go back months. We can list them by scanning the directory.
   - What's unclear: How to present them usefully (by date? by size? by project?). Which ones to include in the backfill list.
   - Recommendation: Show all `.jsonl` files in `<cwd-key>/` sorted by mtime descending, with file size and estimated cost from `get_backfill_preview`. Let user select which to include. Cap at last 30 days by default.

3. **Session `state` transition: active → ended**
   - What we know: No explicit "session ended" signal in the JSONL. The file simply stops growing.
   - What's unclear: When to mark a session as `ended`. After N minutes of no new events? After the watcher goes quiet?
   - Recommendation: Use `last_seen_at` + a staleness threshold (e.g., 30 minutes of no new events → mark `state: 'ended'` lazily on next app startup or manual `list_ingested_sessions` call). For Phase 10, `state` is informational and doesn't block Phase 11's distiller.

---

## Sources

### Primary (HIGH confidence)
- Direct inspection of `~/.claude/projects/-Users-yang-lahacks/*.jsonl` — JSONL structure, line types, content shapes, file sizes. Validated on files: 0e005afe (small, 3 lines), 19487070 (535KB, full session), 5f44f5af (627KB, kernel experiment), efadfcc4 (1.3MB, kernel experiment).
- `.planning/research/constraint-distillation/README.md` — validated size reduction stats (627KB → 12KB, 1.3MB → 27KB), jq filter concept, episode concept
- `.planning/research/constraint-distillation/extraction-prompt.md` — filter semantics (keep user text + assistant text, skip tool content)
- `.planning/research/constraint-distillation/schema.json` — constraint node shape for downstream consumer
- `.planning/phases/07-drift-detection-watcher-path/07-01-PLAN.md` — SourceWatcher implementation pattern to mirror exactly
- `.planning/phases/07-drift-detection-watcher-path/07-02-PLAN.md` — Rust command wiring pattern for `open_repo` + `refresh_nodes`
- `contract-ide/src-tauri/src/db/migrations.rs` — confirmed v1 + v2 exist; Phase 10 is v4 (Phase 8 adds v3)
- `contract-ide/src-tauri/capabilities/default.json` + `tauri.conf.json` — confirmed `requireLiteralLeadingDot: false`, fs scope `**`; no new capability config needed for Rust notify

### Secondary (MEDIUM confidence)
- `.planning/phases/08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation/08-RESEARCH.md` lines 420-440 — JSONL schema corroboration for `user.timestamp`, `assistant.message.usage`, `tool_use` block shape
- `.planning/phases/08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation/08-03-PLAN.md` — journal schema `{schema_version, ts, session_id, tool, file, affected_uuids, intent}` that Phase 10 reads
- Inferred from `projects/` directory listing that cwd-key derivation is: replace `/` with `-`, so leading `/` becomes leading `-`

### Tertiary (LOW confidence)
- Session lifecycle around `/compact`: no explicit evidence found that compaction appends to same JSONL (vs. rewrites). Assumption that it appends is based on the `last_line_index` tracking strategy being robust regardless (if the file is rewritten, `last_line_index` is reset naturally because the file starts fresh).

---

## Metadata

**Confidence breakdown:**
- JSONL schema / session lifecycle: HIGH — directly inspected from real files
- Filter strategy (native Rust): HIGH — straightforward port of validated jq semantics
- Episode boundary definition: HIGH — derived from JSONL structure analysis + kernel experiment findings
- cwd-key derivation: HIGH — validated against real `~/.claude/projects/` directory names
- `sessions` / `episodes` table schema: HIGH — designed to match Phase 11's documented consumption pattern
- notify watch scope (directory vs individual files): HIGH — required by session file creation lifecycle
- Tauri capability requirements: HIGH — confirmed notify bypasses Tauri fs scope
- Backfill token cost estimation: MEDIUM — heuristic chars/4, not validated against Anthropic tokenizer

**Research date:** 2026-04-24
**Valid until:** 2026-05-24 (30 days) — stable domain; Claude Code JSONL format could change with Claude Code updates, validate against live session before shipping
