# Phase 7: Drift Detection (Watcher Path) — Research

**Researched:** 2026-04-23
**Domain:** Rust async file watching (`notify` / `tauri-plugin-fs`), per-key Tokio serialization (DashMap<Uuid, Arc<Mutex>>), SHA-256 source-range re-hashing, Tauri event emission to React, reconcile UX, MCP-mediated "update contract to match code" / "rewrite code to match contract"
**Confidence:** HIGH (every building block — watcher, hash helpers, event emit pattern, sidecar write path, MCP update_contract + write_derived_contract — already exists in the codebase; Phase 7 assembles them)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DRIFT-01 | When code changes without matching contract update (or vice versa), the affected node pulses red in the graph | §Architecture Patterns: Source-File Watcher (Rust), Drift Computation, Graph Red-Pulse Wiring |
| DRIFT-02 | User clicks a drifted node → reconcile panel offers: update contract to match code, rewrite code to match contract, or mark acknowledged | §Architecture Patterns: Reconcile Panel, Three-Path Resolution, MCP-mediated reconcile |
</phase_requirements>

---

## Summary

Phase 7 adds a Rust-side **source-file watcher** (distinct from the existing `.contracts/` sidecar watcher) that observes every file referenced by a node's `code_ranges`, recomputes `code_hash` on change, compares to the stored baseline, and sets `drift_state` accordingly. Drift propagates to the React graph via a `drift:changed` Tauri event so the affected `ContractNode.data.state` flips to `'drifted'` — the CVA class `ring-2 ring-red-500 animate-pulse` is already wired in `contractNodeStyles.ts` and just needs a live data source.

Concurrency is the load-bearing technical detail. SC 2 explicitly requires a **per-node `tokio::sync::Mutex`** so that when the OS fires multiple rapid events against the same file (or the PostToolUse hook lands in Phase 8 alongside this watcher), two concurrent drift evaluations cannot interleave a read and a write against `nodes.code_hash`. The canonical Rust pattern is `DashMap<String /* node uuid */, Arc<tokio::sync::Mutex<()>>>` — one mutex per UUID, lazily inserted on first drift event, never garbage-collected at demo scale. This is NOT a single global mutex (that serializes unrelated nodes and fails the 10-file concurrent stress test's latency ceiling).

The reconcile panel (DRIFT-02) exposes three actions. "Rewrite code to match contract" and "Update contract to match code" both route through the **existing MCP tools** (`update_contract` and `write_derived_contract` respectively, both already enforce the `human_pinned` guard). "Acknowledge" is a pure SQLite write to `drift_state.reconciled_at`. The panel replaces the Phase-4 placeholder "Reconcile flow ships in Phase 7" hint currently wired into `DriftBadge.tsx`.

**Primary recommendation:** Add a `notify` v8 `RecommendedWatcher` managed by Tauri state (NOT a second `tauri-plugin-fs` JS watch — the plugin's JS API watches one directory, but Phase 7 needs to watch an arbitrary set of source files spread across the repo); compute drift inside a per-UUID Tokio Mutex guard; emit `drift:changed` events; reuse the existing MCP update tools for reconcile; ship the reconcile panel as a modal/drawer overlay on the Inspector.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `notify` | 8.2.0 (already in lock) | Rust cross-platform file watcher — FSEvents on macOS | Same crate `tauri-plugin-fs` uses under the hood; already transitively present. Direct use gives us dynamic per-file watch registration which the plugin API does not expose |
| `tokio::sync::Mutex` | bundled with Tauri | Per-node serialization guard | Tauri owns the async runtime; `tokio::sync::Mutex` (NOT `std::sync::Mutex`) is required because the critical section spans `.await` points (DB write). SC 2 calls this out explicitly |
| `dashmap` | 6.x | Concurrent UUID → `Arc<Mutex>` map | Tokio's own docs recommend `DashMap<K, Arc<Mutex<V>>>` as the canonical "mutex-per-key" pattern; avoids a single global mutex across RwLock<HashMap> (write contention) |
| `sha2` + `hex` | 0.11 / 0.4 (in Cargo.toml) | Re-hash source ranges | Already present; Phase 7 consumes the `compute_code_hash` helper already living in `commands/derive.rs` (kept behind `#[allow(dead_code)]` explicitly for Phase 7 per 06-02-SUMMARY.md) |
| `tauri::Emitter` | 2.x | `app.emit("drift:changed", payload)` | Established pattern — `mcp:status`, `derive:progress` (removed in 06 pivot but pattern landed) all used this |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `sqlx` | 0.8 (in Cargo.toml) | `drift_state` writes | Table already exists in Phase 1 migration: `node_uuid PK, current_code_hash, contract_code_hash, drifted_at, reconciled_at` + partial index `idx_drift_drifted` on `reconciled_at IS NULL` |
| `chrono` | — NOT in Cargo.toml | RFC3339 timestamps for `drifted_at` / `reconciled_at` | Phase 6 pivot REMOVED chrono. Use `std::time::SystemTime` + format via `time` crate (also absent) OR re-add `chrono = "0.4"` with `features = ["serde"]`. **Recommend re-add** — matches the `derived_at` format convention the TS MCP writer already uses (`new Date().toISOString()`) |
| `serde_json` | 1 (present) | Serialize `drift:changed` payloads | Already used by every `#[derive(Serialize)]` event payload |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Direct `notify::Watcher` | Second JS-side `tauri-plugin-fs` watch | Plugin watches ONE directory per `watch()` call; Phase 7 needs to watch N source files scattered across the repo (every `CodeRange.file`). Plugin path would require watching the ENTIRE repo recursively and filtering in JS — noisy, wastes FSEvents budget, and duplicates the existing `.contracts/` watcher's debounce. Rust `notify` directly lets us register one watcher that receives events for a curated set of paths |
| `tokio::sync::RwLock<HashMap<Uuid, Mutex>>` | `DashMap<Uuid, Arc<Mutex>>` | RwLock serializes all writers while a reader holds the lock; at 10 rapid events (SC 2 stress test) the writer contention is observable. DashMap shards internally; per-UUID Arc<Mutex> is the idiomatic "mutex per key" answer |
| Single global `Mutex<()>` for drift computation | Per-UUID Mutex via DashMap | Single mutex serializes unrelated nodes — fails SC 2's parallelism intent. The spec says "the watcher cannot read a stale `nodes.code_hash` between concurrent updates" — that's about per-UUID atomicity, not global |
| Watching whole repo recursively | Only paths in `SELECT DISTINCT json_each(code_ranges)` | Whole-repo recursive watch fires on every `node_modules/`, `dist/`, `.git/` change and exhausts FSEvents queue. Curated-path watch is 100–500 files, well under macOS FSEvents limits |
| `update_contract` for "update contract to match code" | `write_derived_contract` | These are different semantics. `update_contract` is user-intent edits (doesn't recompute `code_hash`). `write_derived_contract` is the derivation path — recomputes both hashes, sets `derived_at`. "Update contract to match code" IS a derivation event from the user's perspective → use `write_derived_contract`. See 06-02-SUMMARY decisions §3 |

**Installation (Rust additions):**

```toml
# src-tauri/Cargo.toml — ADD:
notify = { version = "8", default-features = false, features = ["macos_fsevent"] }
dashmap = "6"
chrono = { version = "0.4", features = ["serde"] }  # re-add (removed in 06-02 pivot)
```

No new JS dependencies. No new npm packages. Reconcile panel uses existing shadcn primitives (Dialog or Sheet — only Dialog is installed today, check `components/ui/`).

---

## Architecture Patterns

### Recommended Project Structure

New files added in Phase 7:

```
src-tauri/src/
├── commands/
│   ├── drift.rs               # NEW: start_source_watcher, acknowledge_drift, Tauri cmds
│   └── mod.rs                 # EDIT: pub mod drift;
├── drift/
│   ├── mod.rs                 # NEW: public API
│   ├── watcher.rs             # NEW: notify::RecommendedWatcher wrapper + path registration
│   ├── engine.rs              # NEW: compute_drift(uuid) — the per-UUID Mutex-guarded routine
│   └── state.rs               # NEW: DriftLocks = DashMap<String, Arc<tokio::sync::Mutex<()>>>
├── lib.rs                     # EDIT: .manage(drift::DriftLocks::default()) + spawn watcher in setup()
```

```
src/
├── ipc/
│   └── drift.ts               # NEW: subscribeDriftChanged + acknowledgeDrift + reconcile IPC
├── components/inspector/
│   ├── ReconcilePanel.tsx     # NEW: three-action modal/drawer (DRIFT-02)
│   └── DriftBadge.tsx         # EDIT: replace "ships in Phase 7" hint with real ReconcilePanel trigger
├── components/graph/
│   ├── GraphCanvasInner.tsx   # EDIT: buildFlowNodes sets state='drifted' when node is drifted
│   └── contractNodeStyles.ts  # NO CHANGE (drifted variant already exists: ring-2 ring-red-500 animate-pulse)
├── store/
│   └── drift.ts               # NEW: Zustand slice — driftedUuids: Set<string>, subscribeDriftEvents()
```

### Pattern 1: Source-File Watcher (Rust, notify v8 direct)

**What:** A single `notify::RecommendedWatcher` that watches the set of source files referenced by any node's `code_ranges`. On event, dispatch to per-UUID drift computation.
**When to use:** One watcher per repo-open; reset on `open_repo` (repo switch).

```rust
// src-tauri/src/drift/watcher.rs
// Source: https://docs.rs/notify/8/notify/ (HIGH — crate docs)

use notify::{RecommendedWatcher, RecursiveMode, Watcher, Event, EventKind};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::collections::HashMap;
use tauri::AppHandle;

pub struct SourceWatcher {
    inner: Mutex<Option<RecommendedWatcher>>,
    /// file_path → set of node uuids that reference it (a file may back multiple nodes)
    path_to_uuids: Mutex<HashMap<PathBuf, Vec<String>>>,
}

impl SourceWatcher {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
            path_to_uuids: Mutex::new(HashMap::new()),
        }
    }

    /// Re-register watched paths from the current set of nodes. Called at
    /// open_repo and after any sidecar write (so a new code_range starts
    /// being watched immediately).
    pub fn refresh(&self, app: AppHandle, repo_path: &Path, nodes: &[(String, Vec<String>)]) -> anyhow::Result<()> {
        // nodes: Vec<(uuid, Vec<relative_file_path>)> derived from SELECT uuid, code_ranges FROM nodes

        let mut map: HashMap<PathBuf, Vec<String>> = HashMap::new();
        for (uuid, files) in nodes {
            for rel in files {
                let abs = repo_path.join(rel);
                map.entry(abs).or_default().push(uuid.clone());
            }
        }

        // Dedupe uuids per path
        for v in map.values_mut() {
            v.sort(); v.dedup();
        }

        let app_clone = app.clone();
        let path_to_uuids_snapshot = map.clone();

        let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
            let Ok(event) = res else { return };
            // Filter: we only care about modify events (Content / Data)
            match event.kind {
                EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_) => {}
                _ => return,
            }
            for path in &event.paths {
                if let Some(uuids) = path_to_uuids_snapshot.get(path) {
                    for uuid in uuids {
                        // Spawn per-UUID drift evaluation (each acquires its own mutex).
                        let app2 = app_clone.clone();
                        let uuid2 = uuid.clone();
                        tauri::async_runtime::spawn(async move {
                            crate::drift::engine::compute_and_emit(app2, &uuid2).await;
                        });
                    }
                }
            }
        })?;

        // Watch each unique file. FSEvents coalesces at the directory level, so
        // watching many individual files inside the same dir is cheap (one
        // FSEvents stream per parent dir under the hood).
        for path in map.keys() {
            watcher.watch(path, RecursiveMode::NonRecursive)?;
        }

        *self.inner.lock().unwrap() = Some(watcher);
        *self.path_to_uuids.lock().unwrap() = map;
        Ok(())
    }
}
```

**Key decisions:**
- `RecursiveMode::NonRecursive` — each watched path is a single file; no need for recursive watching (unlike the sidecar watcher which watches `.contracts/` recursively).
- `notify::recommended_watcher` picks `FSEvents` on macOS — the platform-native, debounced watcher. Default ~5ms debounce; sub-2s latency budget for SC 1 is trivially met.
- Store the watcher in Tauri managed state so it survives for the lifetime of the app.
- Refresh path set after EVERY sidecar write (the existing `refresh_nodes` command is the natural hook) — a new node with new `code_ranges` must start being watched.

### Pattern 2: Per-UUID Tokio Mutex (DashMap<Uuid, Arc<Mutex>>)

**What:** Lazily-created per-UUID mutex so drift evaluation is serialized per-node but parallel across nodes.
**When to use:** Inside `compute_and_emit(uuid)` before any DB read/write.

```rust
// src-tauri/src/drift/state.rs
// Source: https://docs.rs/dashmap/6/dashmap/ + Tokio tutorial patterns (HIGH)

use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Per-node serialization guard. One mutex per node UUID, lazily inserted on
/// first drift event. Never garbage-collected (demo scale < 1k nodes; the
/// memory cost is 48 bytes per entry).
#[derive(Default)]
pub struct DriftLocks(pub DashMap<String, Arc<Mutex<()>>>);

impl DriftLocks {
    pub fn for_uuid(&self, uuid: &str) -> Arc<Mutex<()>> {
        self.0
            .entry(uuid.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}
```

```rust
// src-tauri/src/drift/engine.rs — USAGE
use tauri::AppHandle;
use tauri::Manager;

pub async fn compute_and_emit(app: AppHandle, uuid: &str) {
    // 1. Get the per-UUID mutex (fast — no await inside DashMap access)
    let locks = app.state::<crate::drift::state::DriftLocks>();
    let mutex = locks.for_uuid(uuid);

    // 2. Acquire it — this await-point is where a second concurrent event
    //    for the same uuid will queue up. SC 2 stress test (10 rapid edits
    //    to 10 different files) never contends here because each uuid's
    //    mutex is independent. Two edits to the SAME file serialize, which
    //    is exactly the "no lost drift flags" guarantee SC 2 asks for.
    let _guard = mutex.lock().await;

    // 3. Load current sidecar + source, compute drift, write drift_state,
    //    emit `drift:changed`. See Pattern 3.
    // ... (see Pattern 3 below)
}
```

**CRITICAL:** Use `tokio::sync::Mutex`, NOT `std::sync::Mutex`. The guard is held across `.await` points (DB queries). `std::sync::Mutex` is not Send-across-await and panics the scheduler.

### Pattern 3: Drift Computation (Under Mutex)

**What:** The body of the per-UUID evaluation. Read current source, recompute `code_hash`, compare to `nodes.code_hash`, write `drift_state` + emit event.
**When to use:** Inside `compute_and_emit` after mutex acquisition.

```rust
// src-tauri/src/drift/engine.rs (continued)
use tauri::Emitter;
use tauri_plugin_sql::DbInstances;

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DriftChanged {
    pub uuid: String,
    pub drifted: bool,
    pub current_code_hash: Option<String>,
    pub baseline_code_hash: Option<String>,
}

pub async fn compute_and_emit(app: AppHandle, uuid: &str) {
    // --- lock acquisition (Pattern 2) ---
    let locks = app.state::<crate::drift::state::DriftLocks>();
    let mutex = locks.for_uuid(uuid);
    let _guard = mutex.lock().await;

    // --- load repo path (managed state from Phase 2) ---
    let repo_path = {
        let s = app.state::<crate::commands::repo::RepoState>();
        let g = s.0.lock().ok().and_then(|g| g.clone());
        match g { Some(p) => p, None => return }
    };

    // --- load node row (stored baseline) ---
    let instances = app.state::<DbInstances>();
    let map = instances.0.read().await;
    let Some(db) = map.get("sqlite:contract-ide.db") else { return };
    let pool = match db {
        tauri_plugin_sql::DbPool::Sqlite(p) => p,
        _ => return,
    };

    // Fetch code_ranges JSON + stored code_hash
    let row: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT code_ranges, code_hash FROM nodes WHERE uuid = ?1"
    )
    .bind(uuid)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let Some((ranges_json, baseline_hash)) = row else { return };

    let ranges: Vec<crate::sidecar::frontmatter::CodeRange> =
        serde_json::from_str(&ranges_json).unwrap_or_default();

    // --- recompute code_hash from current source ---
    // Reuse the existing helper living in commands/derive.rs
    let current_hash = crate::commands::derive::compute_code_hash(&repo_path, &ranges);

    let drifted = match (&baseline_hash, &current_hash) {
        (Some(base), Some(cur)) => base != cur,
        _ => false, // can't compute → don't pulse red on false positive
    };

    // --- upsert drift_state ---
    if drifted {
        let now = chrono::Utc::now().to_rfc3339();
        let _ = sqlx::query(
            r#"
            INSERT INTO drift_state (node_uuid, current_code_hash, contract_code_hash, drifted_at, reconciled_at)
            VALUES (?1, ?2, ?3, ?4, NULL)
            ON CONFLICT(node_uuid) DO UPDATE SET
                current_code_hash = excluded.current_code_hash,
                drifted_at = excluded.drifted_at,
                reconciled_at = NULL
            "#,
        )
        .bind(uuid)
        .bind(current_hash.as_deref().unwrap_or(""))
        .bind(baseline_hash.as_deref().unwrap_or(""))
        .bind(&now)
        .execute(pool)
        .await;
    } else {
        // Node is back in sync — mark reconciled so the red pulse clears
        let now = chrono::Utc::now().to_rfc3339();
        let _ = sqlx::query(
            "UPDATE drift_state SET reconciled_at = ?2 WHERE node_uuid = ?1"
        )
        .bind(uuid)
        .bind(&now)
        .execute(pool)
        .await;
    }

    // --- emit event to React ---
    let _ = app.emit("drift:changed", DriftChanged {
        uuid: uuid.to_string(),
        drifted,
        current_code_hash: current_hash,
        baseline_code_hash: baseline_hash,
    });
}
```

**Key decisions:**
- Mutex is released when `_guard` drops at end of function. Every DB read and write sits inside the guarded section — no TOCTOU between baseline read and current-hash write.
- "Can't compute → don't pulse red" — missing source file returns `None` from `compute_code_hash`. Treat that as "unknown drift," not "drifted." Avoids spamming red on git branch switch mid-edit.
- Emit happens AFTER DB write so the `drift_state` row is queryable immediately when React handles the event.

### Pattern 4: React Graph Red-Pulse Wiring

**What:** Subscribe to `drift:changed`, maintain a `Set<uuid>` of drifted UUIDs in Zustand, read that set in `buildFlowNodes` to drive the `state` prop.
**When to use:** Mount subscription in `AppShell`; consume Set in `GraphCanvasInner`.

```typescript
// src/store/drift.ts
import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';

interface DriftChangedPayload {
  uuid: string;
  drifted: boolean;
  currentCodeHash: string | null;
  baselineCodeHash: string | null;
}

interface DriftState {
  driftedUuids: Set<string>;
  setDrifted: (uuid: string, drifted: boolean) => void;
}

export const useDriftStore = create<DriftState>((set) => ({
  driftedUuids: new Set(),
  setDrifted: (uuid, drifted) => set((s) => {
    const next = new Set(s.driftedUuids);
    if (drifted) next.add(uuid); else next.delete(uuid);
    return { driftedUuids: next };
  }),
}));

export async function subscribeDriftEvents(): Promise<() => void> {
  const unlisten = await listen<DriftChangedPayload>('drift:changed', (e) => {
    useDriftStore.getState().setDrifted(e.payload.uuid, e.payload.drifted);
  });
  return unlisten;
}
```

```typescript
// src/components/graph/GraphCanvasInner.tsx — EDIT buildFlowNodes
// Add: const driftedUuids = useDriftStore((s) => s.driftedUuids);
// Pass down to buildFlowNodes(rows, driftedUuids)
// In the mapping:
//   state: driftedUuids.has(row.uuid) ? 'drifted' : 'healthy',
```

The `drifted` variant in `contractNodeStyles.ts` is ALREADY defined as `ring-2 ring-red-500 animate-pulse`. No new CSS.

### Pattern 5: Reconcile Panel (DRIFT-02)

**What:** Modal/drawer overlaid on the Inspector exposing the three actions.
**When to use:** Triggered by clicking "Reconcile" button in DriftBadge when state is `drifted`.

```typescript
// src/components/inspector/ReconcilePanel.tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ContractNode } from '@/ipc/types';

interface Props {
  node: ContractNode;
  open: boolean;
  onClose: () => void;
}

export default function ReconcilePanel({ node, open, onClose }: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reconcile {node.name}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2 mt-3">
          <button
            className="text-left rounded-md border p-3 hover:bg-muted"
            onClick={() => runUpdateContractToMatchCode(node)}
          >
            <div className="font-medium text-sm">Update contract to match code</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Re-derive the contract from the current source. Pinned contracts are protected.
            </div>
          </button>
          <button
            className="text-left rounded-md border p-3 hover:bg-muted"
            onClick={() => runRewriteCodeToMatchContract(node)}
          >
            <div className="font-medium text-sm">Rewrite code to match contract</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Hand off to your Claude Code session — copy the rewrite prompt.
            </div>
          </button>
          <button
            className="text-left rounded-md border p-3 hover:bg-muted"
            onClick={() => runAcknowledge(node)}
          >
            <div className="font-medium text-sm">Acknowledge</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Mark the drift as intentional — keeps both versions as-is.
            </div>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

**Three action implementations:**

1. **Update contract to match code** → Copy-to-clipboard a prompt that instructs the user's Claude Code session to call `write_derived_contract({uuid, body})` with freshly-derived body. This matches the Phase 6 MCP-driven derivation pattern (06-02 pivot). The `write_derived_contract` tool's built-in pinned guard protects human-authored contracts.

2. **Rewrite code to match contract** → Copy-to-clipboard a prompt that gives Claude Code the contract body + the file paths in `code_ranges` and asks it to rewrite source. This is a natural Claude Code Edit-tool workflow; it does NOT go through MCP (MCP is for IDE-internal state updates, not for editing source files).

3. **Acknowledge** → New Tauri command `acknowledge_drift(uuid)` sets `drift_state.reconciled_at = now()`. Emit `drift:changed { drifted: false }` so the red pulse clears.

**Why copy-prompt rather than auto-invoke?** Consistent with Phase 6's MCP-driven pivot (06-02-SUMMARY decisions). The IDE doesn't hold an `ANTHROPIC_API_KEY`; the user's active Claude Code session is the LLM. Auto-triggering via subprocess is Phase 9 polish — not needed for SC 3.

### Pattern 6: Acknowledge Command (Rust)

```rust
// src-tauri/src/commands/drift.rs

#[tauri::command]
pub async fn acknowledge_drift(
    app: tauri::AppHandle,
    uuid: String,
) -> Result<(), String> {
    // Acquire the per-UUID mutex so this doesn't race with a concurrent
    // watcher event re-flagging the node as drifted.
    let locks = app.state::<crate::drift::state::DriftLocks>();
    let mutex = locks.for_uuid(&uuid);
    let _guard = mutex.lock().await;

    let instances = app.state::<tauri_plugin_sql::DbInstances>();
    let map = instances.0.read().await;
    let db = map.get("sqlite:contract-ide.db").ok_or("DB not loaded")?;
    let pool = match db {
        tauri_plugin_sql::DbPool::Sqlite(p) => p,
        _ => return Err("only sqlite supported".into()),
    };

    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("UPDATE drift_state SET reconciled_at = ?2 WHERE node_uuid = ?1")
        .bind(&uuid)
        .bind(&now)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    let _ = tauri::Emitter::emit(&app, "drift:changed", serde_json::json!({
        "uuid": uuid,
        "drifted": false,
    }));

    Ok(())
}
```

### Anti-Patterns to Avoid

- **`std::sync::Mutex` for the per-UUID lock:** panics scheduler when held across `.await`. Use `tokio::sync::Mutex`.
- **Single global `Mutex<()>` guarding all drift computation:** serializes unrelated nodes. SC 2's 10-file stress test would show latency stacking 10x instead of running in parallel.
- **Watching the entire repo recursively:** hits `node_modules/` changes, `.git/index.lock` flapping, build artifact noise. Register exact file paths from `SELECT code_ranges FROM nodes`.
- **Emitting `drift:changed` before the DB write commits:** React may query `drift_state` and see stale data. Emit AFTER `sqlx::query(...).execute().await`.
- **Re-registering the watcher on every sidecar write:** calling `notify::Watcher::watch` N times per second hammers FSEvents. Debounce refreshes OR maintain a diff (only register new paths, unregister removed).
- **Forgetting delete events in path_to_uuids:** if a sidecar is deleted, its source paths should stop being watched. The `refresh_nodes` path (repo.rs:76-82) already flags deletes as "TODO(Phase 7)" — Phase 7 is the owner.
- **Reconcile panel blocking the Inspector:** use non-modal Dialog (or Sheet) so user can still see the drift badge / Code tab while reconciling.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File watching | Custom polling / `inotify` wrapper | `notify` 8.x crate (already transitive) | FSEvents/inotify/ReadDirectoryChangesW abstraction; handles all macOS edge cases (atomic saves via temp+rename, coalescing) |
| Per-key mutex map | `RwLock<HashMap<K, Mutex>>` hand-wired | `DashMap<K, Arc<Mutex>>` | DashMap shards internally; canonical Tokio-tutorial pattern for "mutex per key" |
| Re-hashing source | Custom hash comparison | `compute_code_hash` helper already in `commands/derive.rs` | Reference implementation with unit tests (code_hash_covers_only_referenced_lines, code_hash_clamps_end_line_past_file_end). Already allow(dead_code) for this purpose (06-02-SUMMARY §decisions) |
| Contract re-derivation for reconcile | Direct Anthropic API call from Rust | `write_derived_contract` MCP tool (mcp-sidecar) | Phase 6 pivot established this. Tool enforces pinned guard; session has repo context |
| Source rewrite for reconcile | Subprocess `claude -p "..."` | Copy-prompt to Claude Code UI (user paste) | Consistent with Phase 6 MCP pivot; Phase 9 can add subprocess-launch polish |
| Drift state storage | Custom in-memory map | `drift_state` SQLite table (already in v1 migration) | Partial index `idx_drift_drifted` already present; survives restarts |
| Red-pulse CSS | New animation | `contractNodeStyles.ts` `drifted` variant | Already `ring-2 ring-red-500 animate-pulse`; just flip `state: 'drifted'` on the node |
| Timestamp formatting | Manual string build | `chrono::Utc::now().to_rfc3339()` | Matches the TS MCP writer's `new Date().toISOString()` byte-exactly |

**Key insight:** Phase 7 is 90% assembly. Every piece exists — the hash helper is pre-approved for this use (see `commands/derive.rs:8-10` doc comment: "Phase 7 will consume them"), the CSS is wired, the schema exists, the MCP tools for reconcile exist. The NEW code is the watcher registration, the per-UUID mutex, the reconcile UI modal, and the event plumbing.

---

## Common Pitfalls

### Pitfall 1: Using `std::sync::Mutex` Across Await Points

**What goes wrong:** Compiles fine (guard is `Send`), but holding a `std::sync::MutexGuard` across `.await` deadlocks the Tokio scheduler when the future is moved between worker threads, or triggers `Send` violations if the guard isn't `Send`.
**Why it happens:** Developer instinct reaches for `std::sync::Mutex` since it's simpler; async-safety is subtle.
**How to avoid:** Explicitly `use tokio::sync::Mutex;`. Lint check: search for `std::sync::Mutex` in any file under `src-tauri/src/drift/`.
**Warning signs:** Tauri app hangs under load; DB queries take seconds instead of milliseconds; `#[tokio::test]` hangs.

### Pitfall 2: FSEvents Coalescing Swallows Rapid Edits on Same File

**What goes wrong:** macOS FSEvents coalesces rapid writes into a single event. 10 sequential edits to one file may produce 1 event. The SC 2 stress test ("edits 10 files in rapid succession") is safe because it's 10 DIFFERENT files, but a future test editing the SAME file 10 times might see "missing" events.
**Why it happens:** FSEvents is a kernel-level notifier with a debounce budget to avoid event storms.
**How to avoid:** Don't rely on event COUNT; rely on event HAPPENED. One event per file means one drift recomputation, which will pick up the current state. The "no lost drift flags" guarantee requires: if any event fires after an edit, the hash is recomputed from the NOW-current state — that's the mutex's job.
**Warning signs:** Count-based test assertions. The SC 2 test should assert "every file's drift_state reflects its actual on-disk hash at test end" — not "we received 10 events."

### Pitfall 3: `notify` Event Paths Can Be Canonicalized Differently Than Registered

**What goes wrong:** Register `/tmp/repo/src/a.tsx`, receive event with `/private/tmp/repo/src/a.tsx` (macOS symlink canonicalization). `path_to_uuids.get(event_path)` returns `None`; drift never fires.
**Why it happens:** macOS `/tmp` → `/private/tmp`; Phase 2 Plan 02-03 already hit this (STATE.md "Belt-and-braces scope strategy"). FSEvents reports paths in the canonical form.
**How to avoid:** Canonicalize BOTH sides before comparison. Register with `std::fs::canonicalize(path)`. Key the `path_to_uuids` HashMap by canonicalized paths.
**Warning signs:** Events fire (visible in debug log), but no drift recomputation happens on macOS.

### Pitfall 4: Editor Atomic Saves Trigger Create/Remove/Rename Events, Not Modify

**What goes wrong:** VS Code, vim, most modern editors save atomically: write to `file.tmp`, rename over `file`. The watcher may see only `Remove` + `Create`, not `Modify`. If you filter for `EventKind::Modify` only, you miss every real edit.
**Why it happens:** Atomic saves prevent half-written files; they don't emit a "modify" event on the target file — they emit a "create" event on the temp and a "rename" event covering both paths.
**How to avoid:** Accept `Modify(_)`, `Create(_)`, AND `Remove(_)` for the watched file. The hash recomputation is idempotent — if the file is temporarily gone during the rename window, `compute_code_hash` returns `None` and we skip; the follow-up `Create` event re-fires and succeeds.
**Warning signs:** Editing a source file in VS Code produces no drift signal, but editing via `echo >> file.tsx` in terminal does.

### Pitfall 5: `drift_state` Table Has NOT NULL Columns — NULL Binding Fails

**What goes wrong:** Schema declares `current_code_hash TEXT NOT NULL`, but `compute_code_hash` returns `Option<String>`. Binding `None` on a NOT NULL column errors out.
**Why it happens:** Phase 1 migration was overly strict. A node with no `code_ranges` (L0/L1 conceptual) or an unreadable file legitimately has no current hash.
**How to avoid:** Skip the `drift_state` write entirely when `current_code_hash` is `None`. A node without a computable hash can never drift (there's no baseline to compare against either). Alternative: bind empty string `""` as a sentinel, but NULL-via-skip is cleaner. Document this in the drift engine.
**Warning signs:** `SQLite error: NOT NULL constraint failed: drift_state.current_code_hash` in console when deriving empty-ranges nodes.

### Pitfall 6: Reconcile "Rewrite Code" Triggers Watcher, Which Marks Drifted Again

**What goes wrong:** User picks "Rewrite code to match contract." Claude Code rewrites `src/a.tsx`. The watcher fires, recomputes `code_hash`, compares to the baseline (which was computed at DERIVATION time) — they differ. Node is marked drifted AGAIN right after reconcile.
**Why it happens:** The baseline `code_hash` stored in `nodes.code_hash` reflects the DERIVATION moment, not "the current state we want to be synced to." After a rewrite, the baseline is stale.
**How to avoid:** After "rewrite code" completes, the user must re-derive (via the Phase 6 `write_derived_contract` path) OR the reconcile flow must itself update `nodes.code_hash` to match post-rewrite state. Simpler: after successful rewrite, the user clicks "Update contract to match code" (which recomputes both hashes). Document this as a two-step reconcile, not one-step. Alternative for Phase 7: "rewrite code" copies a prompt that includes BOTH the rewrite instruction AND a follow-up `write_derived_contract` call so the baseline is refreshed.
**Warning signs:** Reconcile feels broken — the red pulse reappears within seconds of rewriting code.

### Pitfall 7: Watcher Is Not Rebuilt When a New Sidecar Adds a New code_range File

**What goes wrong:** User opens repo. Watcher registers 42 source files. User derives a new node whose `code_ranges` points to `src/new.tsx`. `src/new.tsx` is not watched. Editing it never fires drift.
**Why it happens:** The watcher snapshot is taken at `open_repo` and never refreshed.
**How to avoid:** Call `SourceWatcher::refresh()` at the end of EVERY `refresh_nodes` invocation (which fires after any sidecar write through the existing Phase 2 watcher). For the `open_repo` path, call it after `scan_contracts_dir` completes. A cheap full rebuild is fine at demo scale.
**Warning signs:** Editing a file that backs a recently-derived node produces no drift event, but editing an older-node's file works.

### Pitfall 8: `chrono` Was Removed in Phase 6 Pivot

**What goes wrong:** 06-02-SUMMARY decisions §"Removed reqwest + chrono". Phase 7 needs RFC3339 timestamps. Re-adding chrono requires a Cargo.toml edit AND a `cargo tree | grep openssl` check to make sure nothing leaked back in.
**Why it happens:** 06 pivot aggressively cleaned up; Phase 7 re-adds.
**How to avoid:** First Phase 7 plan adds `chrono = { version = "0.4", features = ["serde"] }` to Cargo.toml. Verify `cargo tree | grep openssl` still empty. Alternative: use `time` crate (smaller), but `chrono` is more familiar and 06-01-SUMMARY used it.
**Warning signs:** `cargo build` errors `unresolved import chrono` after pivot — expected; fix by re-adding dep.

### Pitfall 9: Source Watcher and Sidecar Watcher Double-Trigger on `.contracts/*.md`

**What goes wrong:** Someone registers `.contracts/<uuid>.md` as a source file (a node's `code_ranges` accidentally pointing at its own sidecar). Both the existing sidecar watcher AND the new source watcher fire. Sidecar watcher upserts; source watcher recomputes hash against the sidecar body; drift_state gets populated against the wrong baseline.
**Why it happens:** `code_ranges.file` is free-form path; nothing prevents self-reference.
**How to avoid:** In the source watcher registration, filter OUT paths under `.contracts/`. A node whose `code_ranges` points at a sidecar is a user bug; don't silently do the wrong thing.
**Warning signs:** Drift fires on a node whose "source code" is a contract sidecar.

### Pitfall 10: Stress Test Must Assert Final State, Not Event Count

**What goes wrong:** SC 2 stress test implementation naively asserts "10 events received." FSEvents coalescing (Pitfall 2) or event-filtering (Pitfall 4) could produce fewer.
**How to avoid:** The test should (a) edit 10 files sequentially with `fs::write`, (b) sleep ~3 seconds for the watcher to catch up (beyond macOS ~1s FSEvents latency), (c) query `SELECT node_uuid FROM drift_state WHERE reconciled_at IS NULL` and assert all 10 UUIDs are present. This is a state-based assertion, not an event-count assertion.
**Warning signs:** Flaky stress test that passes 8/10 times; "race in watcher" is the wrong diagnosis.

---

## Code Examples

### Wiring in lib.rs setup()

```rust
// src-tauri/src/lib.rs — ADD to setup()
.manage(crate::drift::state::DriftLocks::default())
.manage(crate::drift::watcher::SourceWatcher::new())
.setup(|app| {
    // ... existing mcp sidecar launch ...

    // Phase 7: spawn a task that subscribes to open_repo completion.
    // Simpler: the open_repo command itself, after scan_contracts_dir,
    // calls SourceWatcher::refresh. No extra subscription needed.

    Ok(())
})
```

### Refresh Source Watcher After Every Scan/Refresh

```rust
// src-tauri/src/commands/repo.rs — EDIT open_repo (after scan_contracts_dir)
let scan_result = scan_contracts_dir(&app, &path).await.map_err(|e| e.to_string())?;

// Phase 7: register per-file watchers based on the freshly-scanned nodes
let instances = app.state::<tauri_plugin_sql::DbInstances>();
let map = instances.0.read().await;
if let Some(db) = map.get("sqlite:contract-ide.db") {
    if let tauri_plugin_sql::DbPool::Sqlite(pool) = db {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT uuid, code_ranges FROM nodes WHERE code_ranges IS NOT NULL"
        ).fetch_all(pool).await.unwrap_or_default();

        let mut pairs: Vec<(String, Vec<String>)> = Vec::new();
        for (uuid, ranges_json) in rows {
            let ranges: Vec<crate::sidecar::frontmatter::CodeRange> =
                serde_json::from_str(&ranges_json).unwrap_or_default();
            let files: Vec<String> = ranges.into_iter().map(|r| r.file).collect();
            if !files.is_empty() {
                pairs.push((uuid, files));
            }
        }

        let watcher = app.state::<crate::drift::watcher::SourceWatcher>();
        let _ = watcher.refresh(app.clone(), &path, &pairs);
    }
}
drop(map);

Ok(scan_result)
```

### React Subscribe in AppShell

```typescript
// src/components/layout/AppShell.tsx — ADD useEffect
import { subscribeDriftEvents } from '@/store/drift';

useEffect(() => {
  let unsub: (() => void) | undefined;
  subscribeDriftEvents().then((u) => { unsub = u; });
  return () => { unsub?.(); };
}, []);
```

### Replacing the Phase-4 Placeholder in DriftBadge

```typescript
// src/components/inspector/DriftBadge.tsx — EDIT
// Replace the setShowHint(true) branch with:
if (onReconcile) {
  onReconcile();
} else {
  // Open the reconcile panel — state lifted to Inspector
  // (Inspector passes onReconcile={() => setReconcileOpen(true)})
}
```

The Phase 4 plan already wired `onReconcile` as an optional prop; Phase 7 just supplies it.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase 4's `DriftBadge` placeholder ("Reconcile flow ships in Phase 7") | Real reconcile panel with 3 actions | Phase 7 | Placeholder copy removed; onReconcile prop populated |
| No live drift detection (Phase 4 only computes stored `code_hash != contract_hash`) | Live watcher recomputes current `code_hash` from source and compares to stored | Phase 7 | DriftBadge's "drifted" state now reflects source-vs-baseline, not a stale hash comparison |
| `drift_state` table exists but unpopulated | Populated by watcher engine | Phase 7 | `list_drifted_nodes` MCP tool starts returning real data (Phase 5 note "drift is populated once Phase 6 derivation writes code_hash/contract_hash baselines" — that baseline lands in Phase 6; live drift detection lands in Phase 7) |
| `commands/derive.rs` allow(dead_code) hash helpers | Consumed by `drift/engine.rs` | Phase 7 | Dead-code warning removed; the helpers fulfill their documented purpose |

**Deprecated/outdated:**
- `derive:progress` event stream — removed in 06-02 pivot. Do NOT re-introduce; Phase 7 uses its own `drift:changed` stream.

---

## Open Questions

1. **Should "Rewrite code to match contract" auto-update the baseline after rewrite?**
   - What we know: User rewrites code → watcher fires → baseline doesn't match post-rewrite state → drift flags again (Pitfall 6).
   - What's unclear: Is the cleaner UX (a) two-step "rewrite, then re-derive" with a follow-up prompt, or (b) one-shot prompt that calls both `Edit` and `write_derived_contract` in sequence?
   - Recommendation: Option (b) — single combined prompt in the copy-to-clipboard text. The Claude Code session handles both steps. Saves the user a click and prevents the "why is it still red?" confusion.

2. **Should the watcher register individual files or parent directories?**
   - What we know: `notify` watches either individual files or entire directories recursively. Individual files = N watchers; directory = 1 watcher but fires on UNRELATED files in that dir.
   - What's unclear: At hackathon scale (< 200 source files), individual-file watches are cheap. At scale (100k files, 10k watchers) this would exceed FSEvents limits.
   - Recommendation: Individual files for Phase 7 demo. Document "if N > 1000 source files, switch to parent-directory watching + in-process path filtering" as a Phase 9 polish item.

3. **Does `drift:changed` need to flow through the existing sidecar watcher refresh path?**
   - What we know: The sidecar watcher already calls `refreshNodes()` which triggers a full graph re-render. A `drift:changed` event also wants the graph to re-render.
   - What's unclear: Should `drift:changed` piggyback on the same `refreshNodes` call, or stay independent?
   - Recommendation: Stay independent. `refreshNodes` re-fetches from SQLite — the drift store just updates a Set; React's node-data memo picks up the changed `state` prop without a full refetch. Separate stores = cleaner mental model.

4. **How does Phase 8's PostToolUse hook coexist with Phase 7's watcher on the same files?**
   - What we know: ROADMAP Phase 7 goal explicitly says "PostToolUse hook is explicitly deferred to Phase 8 ... avoids a drift_state race between the watcher and hook both writing concurrently." Phase 7 ships watcher-only.
   - What's unclear: Phase 8 will need to coordinate — probably by having the hook call the SAME `compute_and_emit(uuid)` routine and benefit from the same per-UUID mutex.
   - Recommendation: Phase 7 designs the mutex + engine so Phase 8 just has to invoke `compute_and_emit(uuid)` from its hook-receipt handler. This is already the case in this RESEARCH — the engine is self-contained and re-entrant per-UUID. Document this in a code comment.

5. **Does the watcher need to debounce rapid edits to the same file?**
   - What we know: FSEvents itself has ~5ms debouncing. `notify` forwards events 1:1 (no additional debounce by default).
   - What's unclear: If a user saves-on-every-keystroke (some editors), 50 events per second for the same file each triggering a full hash recomputation could noticeably burn CPU.
   - Recommendation: Accept it for Phase 7. `compute_code_hash` over a ~150-line range is sub-millisecond. Per-UUID mutex serializes the writes so no duplicate DB churn. Add a debounce ONLY if CPU profiling during UAT shows waste.

---

## Sources

### Primary (HIGH confidence)

- `contract-ide/src-tauri/src/commands/derive.rs` — hash helpers (compute_code_hash, compute_contract_hash) with unit tests; explicitly scoped for Phase 7 consumption (doc comment lines 1-16, allow(dead_code) rationale lines 17-20)
- `contract-ide/src-tauri/src/db/migrations.rs` — `drift_state` table schema (PK = node_uuid; NOT NULL on current_code_hash + contract_code_hash + drifted_at; partial index on reconciled_at IS NULL)
- `contract-ide/src/components/graph/contractNodeStyles.ts` — `drifted` cva variant already declared as `ring-2 ring-red-500 animate-pulse`; no CSS work needed
- `contract-ide/src/components/inspector/DriftBadge.tsx` — Phase 4 `onReconcile` prop is already optional and the placeholder hint lives on line 83 (to be replaced)
- `contract-ide/mcp-sidecar/src/tools/write_derived_contract.ts` — existing writer tool enforces human_pinned guard, recomputes both hashes, sets derived_at. Consumable for "update contract to match code"
- `contract-ide/src-tauri/Cargo.lock` — `notify = 8.2.0` already transitively present through `tauri-plugin-fs`
- `contract-ide/src-tauri/Cargo.toml` — `sha2 = 0.11`, `hex = 0.4` present; `chrono` ABSENT (removed in 06-02 pivot); `sqlx = 0.8` with sqlite feature
- `.planning/phases/06-contract-derivation/06-02-SUMMARY.md` — decisions §"Retained `compute_code_hash` ... in Rust `commands/derive.rs` behind `#![allow(dead_code)]`. Phase 7's drift path will consume them" confirms the Phase 7 contract with Phase 6
- `.planning/ROADMAP.md` Phase 7 — success criteria 1/2/3 drive this research; SC 2 specifies per-node Tokio Mutex requirement verbatim; PostToolUse deferred to Phase 8
- `notify` crate docs (https://docs.rs/notify/8/) — RecommendedWatcher, RecursiveMode, EventKind

### Secondary (MEDIUM confidence)

- Tokio tutorial "Shared state" section — per-key mutex via `DashMap<K, Arc<Mutex>>` idiom
- `tauri-plugin-fs` source (notify v8 under the hood) — confirms macOS uses FSEvents via `macos_fsevent` feature
- `dashmap` crate docs — confirms `entry().or_insert_with()` is lock-free for hot path

### Tertiary (LOW confidence — validate before implementing)

- FSEvents coalescing behavior (Pitfall 2) — based on general macOS knowledge; specific coalesce window not verified against Apple docs for current macOS version
- macOS `/tmp` vs `/private/tmp` canonicalization (Pitfall 3) — same lesson as Phase 2 Plan 02-03, verified to occur on dev machine; may vary in CI
- VS Code atomic save event sequence (Pitfall 4) — widely reported in notify/chokidar issue trackers but no canonical citation. Validate by editing a file in VS Code during Phase 7 UAT and inspecting the notify event stream

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — notify/dashmap/tokio are established choices; all hash/SQLite building blocks already present in codebase
- Architecture patterns: HIGH — per-UUID mutex is a canonical pattern; source watcher design mirrors existing Phase 2 sidecar watcher pattern
- Concurrency (per-node Tokio Mutex): HIGH — explicitly mandated by SC 2 and by the Phase 8 coexistence note; DashMap<K, Arc<Mutex>> is textbook
- Reconcile UX (three paths): MEDIUM — the three actions are spec'd in SC 3, but the specific "copy-prompt" implementation of paths 1 & 2 follows Phase 6's MCP-pivot pattern which itself was a late design decision; auto-invoke variants exist as open question
- Pitfalls: HIGH — every pitfall listed either derives from observed Phase 2 behavior (path canonicalization, watcher ordering), explicit project decisions (chrono removal), or schema constraints (drift_state NOT NULL)
- Open Questions 1 & 4: MEDIUM — both involve Phase 8 coordination; final answer depends on how Phase 8 structures the PostToolUse receipt handler

**Research date:** 2026-04-23
**Valid until:** 2026-05-23 (30 days — notify/dashmap are stable; the only volatile piece is Phase 8's coexistence contract which will be finalized when Phase 8 is planned)

**Critical validation before Phase 7 plan execution:**
1. Confirm `notify` v8 direct dep adds cleanly alongside `tauri-plugin-fs` v2 (should share the same notify version — check `cargo tree | grep notify`).
2. Re-add `chrono = "0.4"` (features = ["serde"]) and verify `cargo tree | grep openssl` stays empty (the 06-02 pivot was careful about this).
3. Decide Open Question 1 (single-step vs two-step rewrite-code reconcile) before coding the ReconcilePanel.
4. Confirm `components/ui/dialog.tsx` exists (shadcn Dialog) — if not, either add it or use a plain absolute-positioned panel with backdrop.
