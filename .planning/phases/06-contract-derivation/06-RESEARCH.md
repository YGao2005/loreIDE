# Phase 6: Contract Derivation — Research

**Researched:** 2026-04-24
**Domain:** LLM API (Anthropic SDK), Tauri async IPC + event emission, SHA-256 file hashing, sidecar YAML mutation, React optimistic state update
**Confidence:** HIGH (architecture is fully specified by prior phases; the only moving part is LLM SDK and prompt design)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DERIVE-01 | When a new repo is opened or a new file appears, the app runs an LLM-backed derivation to produce a natural-language contract per node (batched by file, hash-skipped if unchanged, lazy for unseen zoom levels) | §Architecture Patterns: Derivation Pipeline; §Code_Hash Computation; §Skipping Unchanged Nodes |
| DERIVE-02 | Derivation stores `code_hash` and `contract_hash` on each sidecar for drift detection | §Sidecar Schema Changes; §Hash Storage Pattern |
| DERIVE-03 | User can manually edit a contract; the app pins it and never overwrites human-authored text on re-derivation | §Pinning Semantics; §Human-Pinned Guard |
</phase_requirements>

---

## Summary

Phase 6 is a Rust-side async pipeline that: (1) hashes the source files referenced by a node's `code_ranges`, (2) skips derivation if the hash matches `nodes.code_hash`, (3) calls the Anthropic Messages API to generate contract text for nodes that are new or changed, (4) writes the sidecar `.md` via the existing `write_sidecar()` + `upsert_node_pub()` path, and (5) emits Tauri progress events the React UI listens to. The "Derive" button in the inspector triggers a Tauri command that spawns a `tauri::async_runtime::spawn` task so the UI stays non-blocking. Human-pinned contracts are protected by checking `fm.human_pinned` before any LLM write.

The LLM call is a straightforward Anthropic Messages API call from Rust using the `reqwest` HTTP client (already a transitive dep through Tauri; can be added as a direct dep). No new Anthropic-specific Rust crate is needed — the API surface is a simple JSON POST. The API key comes from the env var `ANTHROPIC_API_KEY` which is already present on the developer's machine (it's what `claude` CLI uses). Alternatively, the derivation can run in the MCP sidecar (TypeScript + `@anthropic-ai/sdk` npm package) — but that path introduces unnecessary complexity for a feature the user triggers from the Tauri UI. **The recommended approach is: Rust backend handles hashing + LLM HTTP call + sidecar write; React frontend shows progress via a `derive:progress` Tauri event.**

The key open question from prior phases is "who computes `code_hash`?" — confirmed by reading the codebase: `code_hash` is declared in the schema and frontmatter struct but is **never computed anywhere in the current code**. Every node in SQLite has `code_hash = NULL` today (the scanner passes `fm.code_hash` from the sidecar frontmatter, which is NULL for all hand-authored sidecars). Phase 6 is the first code that actually computes it.

**Primary recommendation:** Add `reqwest` (with `json` + `rustls-tls` features) as a direct Rust dep; implement `derive_contracts` as a non-blocking Tauri command using `tauri::async_runtime::spawn`; emit per-node `derive:progress` events; write completed sidecars via the existing `write_sidecar` + `upsert_node_pub` write path.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `reqwest` | 0.12.x | HTTP client for Anthropic Messages API | Most widely used async Rust HTTP client; already transitively present in the Tauri dependency tree; `json` feature enables `.json()` response deserialization; `rustls-tls` avoids OpenSSL dependency on macOS |
| `@anthropic-ai/sdk` (npm) | 0.90.0 | Anthropic SDK for TypeScript | Confirmed `npm show @anthropic-ai/sdk version` = 0.90.0 as of 2026-04-24. Available if the derivation pipeline runs in the MCP sidecar instead; not needed for the Rust path |
| `sha2` | 0.11 | SHA-256 of source file bytes | Already a direct dep in Cargo.toml; same crate used for `code_hash` / `contract_hash` computation intent from Phase 2 scaffold |
| `hex` | 0.4 | Encode SHA-256 bytes to hex string | Already a direct dep in Cargo.toml |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `serde_yaml_ng` | 0.10 | Already in Cargo.toml; used by `write_sidecar` | Not adding — already present. Phase 6 uses `write_sidecar()` which routes through it |
| `tokio::sync::Mutex` | (tokio bundled with Tauri) | Per-node derivation serialization guard | Phase 7 requires a per-node Tokio Mutex for the watcher; Phase 6 should use the same pattern to avoid races |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Rust `reqwest` for LLM call | MCP sidecar TypeScript `@anthropic-ai/sdk` | Sidecar path requires spawning a separate process, threading the API key, and coordinating progress events across a process boundary. Rust reqwest is simpler for a UI-triggered one-shot pipeline |
| Rust `reqwest` for LLM call | Tauri `http` plugin (`tauri-plugin-http`) | `tauri-plugin-http` exposes HTTP to the *frontend* (JS), not to Rust. Not applicable here |
| Direct Anthropic API call | Shelling out to `claude -p "..."` | Already validated in Phase 1 day-0 validation. Simpler but gives less structured output; no streaming; harder to parse JSON contract shape from. Direct API call is preferred |

**Installation (Rust side only — no new JS deps):**

```toml
# src-tauri/Cargo.toml
reqwest = { version = "0.12", features = ["json", "rustls-tls"], default-features = false }
```

No new npm deps needed for the Rust-driven approach.

---

## Architecture Patterns

### Recommended Project Structure

New files added in Phase 6:

```
src-tauri/src/
├── commands/
│   ├── derive.rs          # NEW: derive_contracts Tauri command + progress events
│   └── mod.rs             # EDIT: add `pub mod derive;`
├── db/
│   └── scanner.rs         # EDIT: expose hash_file() helper as pub
├── lib.rs                 # EDIT: register derive_contracts command + manage DeriveState
```

```
src/
├── ipc/
│   └── derive.ts          # NEW: deriveContracts() invoke wrapper + derive:progress listener
├── store/
│   └── derive.ts          # NEW (optional): per-node derivation progress state
├── components/layout/
│   └── Inspector.tsx      # EDIT: add Derive button + progress display per node
```

### Pattern 1: SHA-256 Code Hash Computation

**What:** Hash the concatenated bytes of all files in a node's `code_ranges`. For a node spanning multiple files (e.g., a component + its CSS), the hash covers all ranges concatenated in order.
**When to use:** Before every derivation call; also as the contract_hash computation after writing the new body.

```rust
// src-tauri/src/commands/derive.rs
use sha2::{Digest, Sha256};
use std::path::Path;

/// Compute SHA-256 over the source lines a node covers.
/// `code_ranges` is the Vec<CodeRange> from ContractFrontmatter.
/// Returns None if any file is unreadable (caller should skip derivation).
pub fn compute_code_hash(
    repo_path: &Path,
    code_ranges: &[crate::sidecar::frontmatter::CodeRange],
) -> Option<String> {
    let mut hasher = Sha256::new();
    for range in code_ranges {
        let file_path = repo_path.join(&range.file);
        let content = std::fs::read_to_string(&file_path).ok()?;
        let lines: Vec<&str> = content.lines().collect();
        // Clamp: sidecar end_line may lag if file shrinks between derivation passes.
        let start = (range.start_line as usize).saturating_sub(1);
        let end = (range.end_line as usize).min(lines.len());
        for line in &lines[start..end] {
            hasher.update(line.as_bytes());
            hasher.update(b"\n");
        }
    }
    Some(hex::encode(hasher.finalize()))
}

/// Compute SHA-256 over the contract body string (for contract_hash).
pub fn compute_contract_hash(body: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(body.trim().as_bytes());
    hex::encode(hasher.finalize())
}
```

**Key decisions:**
- Hash covers the LINE RANGE (start_line..end_line), not the whole file. Two nodes covering different functions in the same file get independent hashes.
- `end_line` is clamped to actual file length — sidecars written before a refactor may reference lines that no longer exist.
- `contract_hash` is hash of the body text (trimmed), not the whole sidecar. This matches the drift detection predicate in `list_drifted_nodes` (`code_hash != contract_hash`) — where "drift" means source changed relative to the contract derivation baseline.

### Pattern 2: Skip-If-Unchanged Guard

**What:** Check `nodes.code_hash` against freshly-computed hash. If they match AND the node already has a `contract_body`, return early — no LLM call.
**When to use:** First step of every derivation attempt.

```rust
// The hash-skip guard — DERIVE-02 success criterion #2
pub async fn should_derive(
    repo_path: &Path,
    fm: &ContractFrontmatter,
    existing_code_hash: Option<&str>,
    existing_body: Option<&str>,
) -> bool {
    // No code_ranges — nothing to hash, nothing to derive
    if fm.code_ranges.is_empty() {
        return false;
    }
    // No existing body — always derive (first time)
    if existing_body.map(|b| b.trim().is_empty()).unwrap_or(true) {
        return true;
    }
    // Compute fresh hash and compare
    match compute_code_hash(repo_path, &fm.code_ranges) {
        None => false, // file unreadable; skip gracefully
        Some(fresh_hash) => {
            // Derive only if hash changed
            existing_code_hash.map_or(true, |old| old != fresh_hash)
        }
    }
}
```

### Pattern 3: Human-Pinned Guard (DERIVE-03)

**What:** Never overwrite a contract where `human_pinned = true`. This is checked from the sidecar frontmatter.
**When to use:** After the skip-if-unchanged check; before the LLM call.

```rust
// DERIVE-03: human-pinned contracts are never overwritten
if fm.human_pinned {
    emit_progress(app, uuid, "skipped-pinned");
    continue;
}
```

**Where is `human_pinned` set?** Two ways:
1. When the user edits a contract in the inspector (Phase 4's Monaco editor), the save action must set `human_pinned = true` in the frontmatter. This is the Phase 4 responsibility — Phase 6 just reads and respects it.
2. Phase 6 should NOT auto-detect divergence and auto-pin. The spec says user explicitly edits → pin. Phase 6 only reads `fm.human_pinned`.

**What Phase 4 must do (cross-phase contract):** When the user blurs/saves the inspector text area, the `write_contract` IPC must set `human_pinned: true` in the frontmatter. Phase 4 is not yet built, but Phase 6's plan must document this as a requirement. For the Phase 6 demo, pinning can be tested by manually editing a sidecar frontmatter to `human_pinned: true`.

### Pattern 4: Non-Blocking Derivation via Tauri Events

**What:** `derive_contracts` Tauri command returns immediately (fire-and-forget); background task emits per-node progress events.
**When to use:** User clicks "Derive" in the inspector; batch derive on repo open (DERIVE-01 "lazy for unseen zoom levels" means this is optional for demo purposes).

```rust
// src-tauri/src/commands/derive.rs

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DeriveProgress {
    uuid: String,
    status: String, // "running" | "done" | "skipped" | "skipped-pinned" | "error"
    message: Option<String>,
}

/// Trigger derivation for one or more node UUIDs (non-blocking).
/// Returns immediately; progress is emitted via `derive:progress` events.
#[tauri::command]
pub async fn derive_contracts(
    app: tauri::AppHandle,
    uuids: Vec<String>,
) -> Result<(), String> {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        for uuid in &uuids {
            // 1. Load sidecar from disk (the filesystem is the source of truth)
            // 2. compute_code_hash
            // 3. should_derive guard
            // 4. human_pinned guard
            // 5. build LLM prompt + call Anthropic Messages API
            // 6. write_sidecar + upsert_node_pub
            // 7. emit derive:progress { uuid, status: "done" }
            let _ = app.emit("derive:progress", DeriveProgress {
                uuid: uuid.clone(),
                status: "done".into(),
                message: None,
            });
        }
    });
    Ok(()) // Return immediately — task runs in background
}
```

**Critical:** `tauri::async_runtime::spawn` is already the established pattern in `commands/mcp.rs`. The `derive_contracts` command is NOT `async fn` on the handler side — it spawns a task and returns Ok(()). The JS caller resolves immediately.

### Pattern 5: Anthropic Messages API Call (reqwest)

**What:** POST to `https://api.anthropic.com/v1/messages` with the source code as context and ask for a contract.
**When to use:** After guards pass; per-node.

```rust
// Anthropic Messages API — minimal call pattern
// Source: https://docs.anthropic.com/en/api/messages (verified 2026-04-24)

use reqwest::Client;
use serde_json::json;

pub async fn call_anthropic_for_contract(
    source_snippet: &str,
    uuid: &str,
    file_path: &str,
    api_key: &str,
) -> anyhow::Result<String> {
    let client = Client::new();

    let system_prompt = "You are a contract writer for a Contract IDE. \
        Given a source code snippet, produce a concise natural-language contract body \
        (2-4 sentences) describing: what this code DOES (behaviour), its key inputs/outputs, \
        any invariants it maintains, and its role in the larger system. \
        Output ONLY the contract body text — no YAML, no fences, no header.";

    let user_prompt = format!(
        "File: {file_path}\nUUID: {uuid}\n\n```\n{source_snippet}\n```"
    );

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&json!({
            "model": "claude-haiku-4-5",
            "max_tokens": 256,
            "system": system_prompt,
            "messages": [{ "role": "user", "content": user_prompt }]
        }))
        .send()
        .await?;

    let body: serde_json::Value = resp.json().await?;
    let text = body["content"][0]["text"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("unexpected Anthropic response shape: {body}"))?;

    Ok(text.trim().to_string())
}
```

**Model choice:** `claude-haiku-4-5` — fastest and cheapest; contract bodies are short (2-4 sentences). For a hackathon demo, Haiku gives sub-2s latency per call. Use `claude-sonnet-4-5` only if output quality is visibly poor.

**API key:** `ANTHROPIC_API_KEY` env var — same as the dev machine's `claude` CLI. In the Tauri app, read from `std::env::var("ANTHROPIC_API_KEY")` at command invocation time (not at startup). This is inherited from the shell when launched via `npm run tauri dev`; under a Finder-launched `.app` it requires the env var to be set in `~/.zshenv` (same lesson as Phase 1's `claude subprocess in Finder launch` validation).

**Source snippet construction:** Concatenate the lines from `code_ranges` (already computed during hash pass) into a single string. Max ~150 lines to keep prompt within token budget. If ranges exceed 150 lines, truncate with a `// ... N lines truncated` comment.

### Pattern 6: Progress Emission + React Store Update

**What:** React subscribes to `derive:progress` Tauri events and updates per-node state in Zustand. Graph re-render happens via `refreshNodes()` after a "done" event.
**When to use:** Inspector shows per-node spinner; graph shows updated node state.

```typescript
// src/ipc/derive.ts
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

export interface DeriveProgress {
  uuid: string;
  status: 'running' | 'done' | 'skipped' | 'skipped-pinned' | 'error';
  message?: string;
}

export async function deriveContracts(uuids: string[]): Promise<void> {
  // Returns immediately — progress arrives via events
  await invoke('derive_contracts', { uuids });
}

export async function subscribeDeriveProgress(
  onChange: (ev: DeriveProgress) => void
): Promise<() => void> {
  return listen<DeriveProgress>('derive:progress', (e) => onChange(e.payload));
}
```

React side — after receiving `status: "done"`:
1. Call `useGraphStore.getState().refreshNodes()` to pull the updated `contract_body` from SQLite.
2. The inspector's contract display automatically reflects the new body.

This is the same event-driven re-render pattern as `mcp:status` — established and working.

### Pattern 7: Sidecar Write Path (Reuse Existing)

**What:** After LLM call, update frontmatter fields (`code_hash`, `contract_hash`, `derived_at`) and body, then write via existing `write_sidecar()` + `upsert_node_pub()`.
**When to use:** After successful LLM response.

```rust
// Update frontmatter fields post-derivation
fm.code_hash = Some(fresh_code_hash.clone());
fm.contract_hash = Some(compute_contract_hash(&llm_body));
fm.derived_at = Some(chrono::Utc::now().to_rfc3339());

// Write sidecar (existing helper in src-tauri/src/sidecar/frontmatter.rs)
let new_content = crate::sidecar::frontmatter::write_sidecar(&fm, &llm_body)?;
let sidecar_path = repo_path.join(".contracts").join(format!("{uuid}.md"));
let tmp = sidecar_path.with_extension("md.tmp");
std::fs::write(&tmp, &new_content)?;
std::fs::rename(&tmp, &sidecar_path)?; // atomic

// Upsert SQLite (existing helper in src-tauri/src/db/scanner.rs)
upsert_node_pub(db, &fm, &llm_body).await?;
// upsert_node_pub already calls FTS rebuild — no extra step needed
```

**`chrono` dep:** Not currently in Cargo.toml. Options: (a) add `chrono = { version = "0.4", features = ["serde"] }`, or (b) use Rust std to format the RFC3339 string manually (fragile). Use `chrono`.

### Anti-Patterns to Avoid

- **Calling `write_sidecar` from a sync context inside `spawn_blocking`:** `upsert_node_pub` is async (uses sqlx). Derivation must run inside `tauri::async_runtime::spawn`, not `spawn_blocking`.
- **Re-scanning the whole `.contracts/` dir after derivation:** Too slow and causes FTS rebuild O(n²). Write + upsert per-node; the per-node upsert already does `INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')` — this is already in `upsert_node_pub` from the Phase 5 UAT fix.
- **Blocking the Tauri command handler:** Never `await` inside the `#[tauri::command]` handler body. Spawn and return immediately. The handler returning `Ok(())` before the work is done is intentional.
- **Single shared `reqwest::Client` vs per-call:** Create the client once in the spawn closure, not per-LLM call — `Client` is cheaply cloned and internally pools connections. One `Client::new()` per `derive_contracts` invocation is fine; one per node is wasteful for batches.
- **Passing the entire file to the LLM:** Source files can be thousands of lines. Extract only the lines in `code_ranges` (already needed for hashing). 150-line cap prevents token budget overflow.
- **Not checking `human_pinned` BEFORE the LLM call:** An LLM call that produces output that is then discarded wastes time and tokens. Guard order: skip-if-unchanged → skip-if-pinned → LLM call.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP client for Anthropic API | Custom TCP socket or `curl` subprocess | `reqwest` crate | Handles TLS, connection pooling, JSON serde, async; Anthropic API is a simple JSON POST |
| SHA-256 hashing | MD5 or CRC32 | `sha2` + `hex` (already in Cargo.toml) | Already present; SHA-256 is the right collision resistance for drift detection |
| Progress reporting across Rust→React | Polling IPC command | Tauri `app.emit("derive:progress", ...)` | Established pattern from Phase 5 `mcp:status` — works reliably |
| YAML frontmatter write | Custom string builder | `write_sidecar()` in `sidecar/frontmatter.rs` | Already battle-tested with round-trip unit tests; DO NOT rewrite |
| Atomic file write | `std::fs::write` direct-to-target | `write(tmp) + rename(tmp → target)` | Same pattern as `write_contract` (02-02) and MCP `update_contract` (05-02) — prevents corrupt sidecars |

**Key insight:** Phase 6 assembles existing building blocks (sha2/hex for hashing, write_sidecar for writing, upsert_node_pub for SQLite, Tauri events for progress). The novel work is the LLM call and the prompt design.

---

## Common Pitfalls

### Pitfall 1: `ANTHROPIC_API_KEY` Not Inherited by Finder-Launched App

**What goes wrong:** App works under `npm run tauri dev` (inherits shell env) but derivation silently fails under a Finder-launched `.app` because `ANTHROPIC_API_KEY` is not in `launchctl` env.
**Why it happens:** Phase 1 day-0 validation (Plan 01-04) confirmed that `claude` subprocess inherits `HOME + PATH` correctly via `tauri-plugin-shell`. However, `ANTHROPIC_API_KEY` is a custom env var that is NOT set in the default macOS GUI session env.
**How to avoid:** Read `ANTHROPIC_API_KEY` from `std::env::var` inside the command handler; if missing, return a user-visible error via the `derive:progress` event (`status: "error", message: "ANTHROPIC_API_KEY not set — set it in ~/.zshenv"`). Add `~/.zshenv` setup to the Phase 6 UAT checklist. For the demo: launch via terminal, not Finder.
**Warning signs:** Derivation returns `status: "error"` with an HTTP 401 or "env var not set" message immediately.

### Pitfall 2: `contract_hash` and `code_hash` Semantics Confusion

**What goes wrong:** Developer swaps which hash is which, causing drift detection (Phase 7) to fire incorrectly.
**Why it happens:** The naming is counterintuitive: `code_hash` = SHA-256 of the SOURCE code at derivation time; `contract_hash` = SHA-256 of the CONTRACT BODY at derivation time. Phase 7's drift condition is `code_hash != contract_hash` — but this works ONLY because they are computed at the SAME derivation moment (same baseline). After derivation, both hashes will be equal (source and contract in sync). Drift occurs when source is later edited (Phase 7 recomputes `code_hash` and finds it no longer matches).

Wait — actually, the REQUIREMENTS.md says drift detection checks for "contract vs. code hash divergence." The correct implementation:
- `code_hash` = hash of source lines at derivation time. Phase 7 recomputes this after a source file change and compares.
- `contract_hash` = hash of the contract body. Updated when the user edits the contract (Phase 4) OR when derivation runs.

The `list_drifted_nodes` query in Phase 5 (`code_hash != contract_hash`) conflates two different drift signals. For Phase 6, follow the DATA-01 spec strictly: both fields record the state AT DERIVATION TIME. They should be EQUAL after derivation. Phase 7 will recompute `code_hash` from the current file and compare to the stored value — which is the drift signal.

**How to avoid:** After derivation, set `code_hash = compute_code_hash(...)` AND `contract_hash = compute_contract_hash(llm_body)`. They will typically be different values (one hashes source, one hashes the body) but both are set at the same moment — this is the baseline.
**Warning signs:** Phase 7 drift detection fires immediately on nodes that were just derived.

### Pitfall 3: FTS5 Rebuild on Every Upsert is O(corpus) — Already Fixed

**What goes wrong:** Phase 5 UAT fixed the FTS5 never-rebuilding bug by adding `INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')` to `upsert_node_pub`. For a batch derivation of N nodes, this runs N times, each O(corpus). At hackathon scale (< 200 nodes) this is fine. At 1k+ nodes it becomes O(N²).
**How to avoid:** For Phase 6 demo (< 200 nodes), accept the O(n²) cost. Document a Phase 9 TODO to migrate to AFTER INSERT/UPDATE/DELETE triggers on `nodes` (the canonical FTS5 external-content pattern from the Phase 5 SUMMARY). Do NOT refactor now — it's out of scope and risks breaking Phase 5's working FTS.

### Pitfall 4: Concurrent Derivation + Watcher Race

**What goes wrong:** User clicks "Derive" while the Phase 2 watcher is also processing a file change. Both try to write to the same sidecar file.
**Why it happens:** Phase 6's derivation writes `.md` files, and Phase 2's watcher picks up any `.md` change and calls `upsert_node_pub`. If derivation and a concurrent watcher event overlap, the watcher may overwrite derivation results or vice versa.
**How to avoid:** Phase 7 will add a per-node Tokio Mutex for exactly this reason. For Phase 6 (Phase 7 not yet built), the risk is low in practice because the demo flow is sequential (user derives, then modifies source). Document as a known issue for Phase 7 to close. The atomic `rename` in the write path prevents partial-file reads at minimum.
**Warning signs:** After derive, `code_hash` in SQLite reverts to NULL — the watcher re-processed the sidecar before the FTS upsert committed.

### Pitfall 5: reqwest TLS on macOS — Use rustls-tls, Not native-tls

**What goes wrong:** `native-tls` feature on macOS requires OpenSSL or SecureTransport linking. On Tauri, `rustls-tls` is the recommended approach — no system OpenSSL dependency, no link conflict with Tauri's own TLS stack.
**How to avoid:** `reqwest = { version = "0.12", features = ["json", "rustls-tls"], default-features = false }` — `default-features = false` prevents accidental `native-tls` activation. Verify with `cargo build` and check `cargo tree | grep openssl` returns empty.

### Pitfall 6: `chrono::Utc::now().to_rfc3339()` — Add chrono Dep

**What goes wrong:** `derived_at` needs an ISO 8601 timestamp. Rust std has no built-in RFC3339 formatter.
**How to avoid:** Add `chrono = { version = "0.4", features = ["serde"] }` to Cargo.toml. `chrono::Utc::now().to_rfc3339()` produces `"2026-04-24T12:34:56.789012345+00:00"` — matches the existing fixture values in `frontmatter.rs` test (`"2026-04-24T12:00:00Z"`).

### Pitfall 7: Batch Derivation Rate Limiting

**What goes wrong:** Deriving all nodes in a large repo in parallel hits Anthropic API rate limits (429 Too Many Requests).
**How to avoid:** For the hackathon demo, derive nodes sequentially (one at a time in a loop). Sequential is fine for < 50 nodes. Document "add concurrency with semaphore if > 50 nodes" as a Phase 9 polish item. Do NOT add a semaphore for Phase 6 — it's over-engineering.

---

## Code Examples

### Full Derivation Loop Skeleton

```rust
// src-tauri/src/commands/derive.rs — full skeleton

use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};
use crate::sidecar::frontmatter::{parse_sidecar, write_sidecar};
use crate::db::scanner::upsert_node_pub;

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeriveProgress {
    pub uuid: String,
    pub status: String,
    pub message: Option<String>,
}

fn emit_progress(app: &AppHandle, uuid: &str, status: &str, msg: Option<String>) {
    let _ = app.emit("derive:progress", DeriveProgress {
        uuid: uuid.to_string(),
        status: status.to_string(),
        message: msg,
    });
}

#[tauri::command]
pub async fn derive_contracts(
    app: AppHandle,
    uuids: Vec<String>,
) -> Result<(), String> {
    // Non-blocking: spawn and return immediately.
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        let api_key = match std::env::var("ANTHROPIC_API_KEY") {
            Ok(k) => k,
            Err(_) => {
                for uuid in &uuids {
                    emit_progress(&app_clone, uuid, "error",
                        Some("ANTHROPIC_API_KEY not set".into()));
                }
                return;
            }
        };

        let repo_path: Option<PathBuf> = app_clone
            .try_state::<crate::commands::repo::RepoState>()
            .and_then(|s| s.0.lock().ok().and_then(|g| g.clone()));

        let repo_path = match repo_path {
            Some(p) => p,
            None => {
                for uuid in &uuids {
                    emit_progress(&app_clone, uuid, "error",
                        Some("No repo open".into()));
                }
                return;
            }
        };

        let db = {
            let instances = app_clone.state::<DbInstances>();
            let map = instances.0.read().await;
            // Note: DbPool is not Clone; get the pool reference inline
            // and perform work while the read lock is held per upsert.
            // Alternative: use a channel to send work to a single DB task.
            // For Phase 6 (sequential, low volume): inline is fine.
            drop(map); // drop read lock before async work
        };

        let http = reqwest::Client::new();

        for uuid in &uuids {
            emit_progress(&app_clone, uuid, "running", None);

            let sidecar_path = repo_path.join(".contracts").join(format!("{uuid}.md"));
            let content = match std::fs::read_to_string(&sidecar_path) {
                Ok(c) => c,
                Err(e) => {
                    emit_progress(&app_clone, uuid, "error",
                        Some(format!("read sidecar: {e}")));
                    continue;
                }
            };

            let (mut fm, existing_body) = match parse_sidecar(&content) {
                Ok(pair) => pair,
                Err(e) => {
                    emit_progress(&app_clone, uuid, "error",
                        Some(format!("parse sidecar: {e}")));
                    continue;
                }
            };

            // Guard 1: human-pinned
            if fm.human_pinned {
                emit_progress(&app_clone, uuid, "skipped-pinned", None);
                continue;
            }

            // Guard 2: hash-skip
            let fresh_hash = compute_code_hash(&repo_path, &fm.code_ranges);
            if let Some(ref h) = fresh_hash {
                if fm.code_hash.as_deref() == Some(h.as_str())
                    && !existing_body.trim().is_empty()
                {
                    emit_progress(&app_clone, uuid, "skipped", None);
                    continue;
                }
            }

            // LLM call
            let source_snippet = extract_source(&repo_path, &fm.code_ranges, 150);
            let file_label = fm.code_ranges.first()
                .map(|r| r.file.as_str())
                .unwrap_or("unknown");

            let llm_body = match call_anthropic(
                &http, &source_snippet, uuid, file_label, &api_key
            ).await {
                Ok(b) => b,
                Err(e) => {
                    emit_progress(&app_clone, uuid, "error",
                        Some(format!("LLM call: {e}")));
                    continue;
                }
            };

            // Update frontmatter
            if let Some(h) = fresh_hash {
                fm.code_hash = Some(h);
            }
            fm.contract_hash = Some(compute_contract_hash(&llm_body));
            fm.derived_at = Some(chrono::Utc::now().to_rfc3339());

            // Write sidecar (atomic)
            let new_content = match write_sidecar(&fm, &llm_body) {
                Ok(c) => c,
                Err(e) => {
                    emit_progress(&app_clone, uuid, "error",
                        Some(format!("write_sidecar: {e}")));
                    continue;
                }
            };
            let tmp = sidecar_path.with_extension("md.tmp");
            if let Err(e) = std::fs::write(&tmp, &new_content)
                .and_then(|_| std::fs::rename(&tmp, &sidecar_path)) {
                emit_progress(&app_clone, uuid, "error",
                    Some(format!("write: {e}")));
                continue;
            }

            // Upsert SQLite
            {
                let instances = app_clone.state::<DbInstances>();
                let map = instances.0.read().await;
                if let Some(db) = map.get("sqlite:contract-ide.db") {
                    if let Err(e) = upsert_node_pub(db, &fm, &llm_body).await {
                        emit_progress(&app_clone, uuid, "error",
                            Some(format!("upsert: {e}")));
                        continue;
                    }
                }
            }

            emit_progress(&app_clone, uuid, "done", None);
        }
    });
    Ok(())
}
```

### Anthropic Messages API Response Shape

The Anthropic Messages API (`/v1/messages`) returns:

```json
{
  "id": "msg_...",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "The contract body text here..." }],
  "model": "claude-haiku-4-5-...",
  "stop_reason": "end_turn",
  "usage": { "input_tokens": 120, "output_tokens": 45 }
}
```

Extract: `body["content"][0]["text"].as_str()`. No streaming needed — wait for the full response. `max_tokens: 256` is sufficient for 2-4 sentence contracts.

### LLM Prompt Design

System prompt (fixed):
```
You are a contract writer for a Contract IDE.
Given a source code snippet, write a concise 2-4 sentence natural-language contract body describing:
1. What this code does (behaviour, not implementation)
2. Key inputs and outputs
3. Any invariants it maintains (e.g. "always returns a non-empty list")
4. Its role in the larger system

Output ONLY the contract body — no YAML, no code fences, no headers. Plain prose.
```

User prompt (per-node):
```
File: {file_path}
Node UUID: {uuid}
Level: {level} ({kind})

```{source_lines}```
```

This prompt produces output like:
> The CheckoutButton component renders a primary action button that submits the cart to the payment flow when clicked. It accepts an `onSubmit` callback and a `disabled` flag; when `disabled` is true the button is visually inert and no click handler fires. The component shows a loading spinner during the async submission and re-enables only after the promise settles. Used exclusively within the CartSummary surface (L2) as the final user action before payment redirect.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual contract authoring (current state) | LLM-backed derivation with hash-skip and pin protection | Phase 6 | Sidecars get `code_hash` + `contract_hash` baselines for the first time |
| Anthropic `reqwest` raw HTTP | Could use `anthropic` Rust crate (if it existed stable) | N/A | No stable Rust Anthropic SDK exists as of 2026-04-24; raw reqwest is the standard |
| Derive on full repo scan | Lazy derivation (only when user zooms in / clicks Derive) | Phase 6 spec | DERIVE-01 says "lazy for unseen zoom levels" — batch-on-open is optional for demo |

**Confirmed absent from codebase:**
- `code_hash` is NEVER computed anywhere in the current Rust source — scanner passes `fm.code_hash` from the sidecar as-is, which is NULL for all hand-authored nodes. Phase 6 is the first to compute it.
- `sha2` and `hex` ARE already in Cargo.toml (added in Phase 2 scaffold "for future use") — no new deps needed for hashing.
- `reqwest` is NOT in Cargo.toml — must be added.
- `chrono` is NOT in Cargo.toml — must be added for `derived_at` RFC3339 timestamp.

---

## Open Questions

1. **Phase 4 (Inspector) not built yet — where does the "Derive" button live?**
   - What we know: Phase 4 builds the inspector with Contract/Code/Preview/Receipts tabs and Monaco contract editor. Phase 6 success criterion says "User clicks Derive in the inspector." Phase 4 is a hard dependency if the button needs to be in the inspector.
   - What's unclear: Can Phase 6 ship a Derive button in a temporary location (e.g., a floating action or right-click menu on a graph node) so the demo works before Phase 4 is complete? The ROADMAP says Phase 6 depends on Phase 2 (not Phase 4 explicitly).
   - Recommendation: Phase 6 can add a "Derive" button directly to the Phase 3 graph node click handler (e.g., in the currently-stub inspector or as a node context action) for the demo. The button moves to the proper inspector location in Phase 4. This avoids Phase 4 being a hard blocker for Phase 6.

2. **Where does `human_pinned` get set? Phase 4 is the owner.**
   - What we know: `human_pinned` is in the frontmatter struct and the SQLite schema. Phase 4's Monaco editor + `write_contract` must set it to `true` when the user manually saves a contract. Phase 6 only reads it.
   - What's unclear: For Phase 6 UAT, `human_pinned` can only be tested by manually editing a sidecar's YAML frontmatter to `human_pinned: true`.
   - Recommendation: Phase 6 plan documents this cross-phase contract. The UAT step creates a fixture sidecar with `human_pinned: true`, derives it, and confirms it is skipped.

3. **Batch derivation trigger on repo open (DERIVE-01 "lazy for unseen zoom levels")**
   - What we know: DERIVE-01 says derivation runs "when a new repo is opened or a new file appears." The "lazy for unseen zoom levels" clause defers derivation of L3/L4 nodes until they are zoomed into.
   - What's unclear: Implementing lazy derivation requires knowing which nodes have been zoomed into (Phase 3 parentUuidStack). This is complex for the demo.
   - Recommendation: For Phase 6 demo, skip lazy semantics. Derive only when user explicitly clicks "Derive" for one or more nodes. Auto-derive on repo open is a stretch goal. The three success criteria in the ROADMAP are all about the user-triggered path — auto-derive is not in any of the three criteria.

4. **`contract_hash` semantic — body hash or source hash?**
   - What we know: DATA-01 says both `code_hash` and `contract_hash` are stored. The MCP `list_drifted_nodes` query checks `code_hash != contract_hash`. Phase 5 SUMMARY says "drift is populated once Phase 6 derivation writes code_hash/contract_hash baselines."
   - The potential confusion: if `code_hash` = hash of source lines and `contract_hash` = hash of contract body, then after derivation they will ALWAYS be different values (different content). The drift predicate `code_hash != contract_hash` would be ALWAYS true, which is wrong.
   - Recommendation: Reinterpret `contract_hash` as "SHA-256 of the contract body AT THE TIME OF DERIVATION." Phase 7's drift detection should compare the CURRENT `code_hash` (recomputed from the source file) against the STORED `code_hash` (computed at derivation time). `contract_hash` is used only to detect if the user EDITED the contract since derivation. The drift predicate should be: "source file has changed since derivation" = current_code_hash != stored_code_hash. This requires Phase 7 to recompute `code_hash` live — not compare two stored values. The Phase 5 MCP `list_drifted_nodes` query may need to be reconsidered in Phase 7. For Phase 6: write both fields accurately and let Phase 7 clarify.

---

## Sources

### Primary (HIGH confidence)

- Codebase direct inspection — `src-tauri/src/sidecar/frontmatter.rs`, `src-tauri/src/db/scanner.rs`, `src-tauri/src/commands/nodes.rs`, `src-tauri/src/commands/mcp.rs` (verified code_hash is never computed; sha2/hex are in Cargo.toml; emit pattern is established)
- `.planning/phases/05-mcp-server-sidecar/05-02-SUMMARY.md` — confirmed bun:sqlite pivot, yaml package, FTS5 column layout, write path pattern
- `.planning/phases/02-contract-data-layer/02-01-SUMMARY.md` — confirmed `write_sidecar` round-trip, `serde_yaml_ng`, `sha2`/`hex` deps
- `https://docs.anthropic.com/en/api/messages` — Messages API endpoint, request shape, response shape, model names
- `contract-ide/src-tauri/Cargo.toml` — confirmed reqwest and chrono are absent; sha2/hex present

### Secondary (MEDIUM confidence)

- `npm show @anthropic-ai/sdk version` → 0.90.0 (run live during research, 2026-04-24) — confirmed for TypeScript path if needed
- reqwest 0.12 + rustls-tls on macOS — confirmed as the standard approach in Tauri projects; native-tls has known OpenSSL link conflicts

### Tertiary (LOW confidence — validate before implementing)

- `claude-haiku-4-5` model latency for 2-4 sentence contracts: estimated sub-2s based on general Haiku benchmarks. Validate during Phase 6 UAT — if output quality is poor, promote to `claude-sonnet-4-5`.
- Anthropic rate limits for Messages API: standard tier allows 5 req/s. Sequential derivation of < 50 nodes at demo scale will not hit limits. Not verified against current tier docs.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — reqwest + sha2/hex all confirmed from Cargo.toml; Anthropic SDK npm version verified live
- Architecture patterns: HIGH — derivation pipeline follows the exact same Tauri event + spawn pattern as Phase 5's MCP sidecar launch; write path reuses `write_sidecar` + `upsert_node_pub` which are battle-tested
- `code_hash` / `contract_hash` semantics: MEDIUM — schema says both fields exist but their exact intended semantics are ambiguous from the codebase; Open Question 4 flags this for planner clarification
- LLM prompt quality: LOW — prompt design is speculative; validate with real source snippets during UAT
- Pitfalls: HIGH — all pitfalls derived from observed behaviour in prior phases (Phase 1 env var inheritance lesson, Phase 5 bun build pivot lesson, Phase 2 FTS5 rebuild lesson)

**Research date:** 2026-04-24
**Valid until:** 2026-05-23 (30 days; Anthropic API response shape is stable; reqwest and chrono versions are conservative)
**Critical validation before Phase 6 plan execution:**
1. Confirm `reqwest` adds cleanly to Cargo.toml with `rustls-tls` + no OpenSSL link error: `cargo build` must stay green.
2. Confirm `ANTHROPIC_API_KEY` is set on dev machine and inherited by `npm run tauri dev`.
3. Run one manual Anthropic API call via `curl` to confirm the request/response shape matches before writing Rust code.
