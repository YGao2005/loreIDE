# Phase 1: Foundation — Research

**Researched:** 2026-04-24
**Domain:** Tauri v2 app scaffold + macOS native chrome + SQLite schema + typed Rust IPC + Monaco CSP + Claude CLI subprocess + autosave/undo primitives
**Confidence:** HIGH (core Tauri/SQLite/vibrancy patterns verified via official docs and live day0 validation; JSONL schema verified from captured real session file)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SHELL-01 | User launches the app and sees a three-pane layout with native traffic lights, sidebar vibrancy (Copy Mode pill placeholder), SF Pro font rendering — not a plain web page in a frame | Architecture Patterns §Tauri Window Config, §window-vibrancy; Code Examples §macOS Native Chrome |
| SHELL-04 | App shows loading, empty, and error states for async operations without freezing or silent failures | Architecture Patterns §Async State Pattern; Don't Hand-Roll §async state UI |
| SHELL-05 | Contract edits autosave on blur + Cmd+S; two-level Cmd+Z undo reverts most recent contract edit (validated against a stub) | Architecture Patterns §Autosave/Undo; Standard Stack §zundo; Code Examples §Undo Primitive |
</phase_requirements>

---

## Summary

Phase 1 is the foundation every later phase builds on. It has six distinct technical subproblems: (1) scaffolding a Tauri v2 project with native macOS chrome, (2) standing up a stable SQLite schema with migrations from day 1, (3) creating typed Rust IPC commands the frontend can call safely, (4) installing Monaco Editor with the correct CSP/worker config before the inspector panel needs it, (5) wiring `tauri-plugin-shell` to spawn `claude -p` as a subprocess with inherited auth, and (6) implementing autosave/undo primitives at the store layer.

The day0 validation work already completed three of the six riskiest integration checks. Check 2 (PostToolUse hook payload) confirmed the exact JSON schema and proved `transcript_path` + JSONL `usage` fields are present in a live session. Check 3 (better-sqlite3 + pkg) confirmed the MCP sidecar binary build path works with a Node 18 runtime embed. Check 1 (claude CLI) confirmed basic invocation but the Tauri-subprocess auth inheritance check (whether `tauri-plugin-shell` passes `HOME` through) was explicitly deferred to Phase 1 Day 1 as the first entry criterion. All three pass, meaning Phase 1 starts with significantly reduced risk.

The two remaining high-severity concerns are the Monaco WKWebView worker issue (must install `vite-plugin-monaco-editor` + `blob:` CSP at scaffold time, not retrofitted) and the Tauri async runtime conflict (`#[tokio::main]` must never appear in `main.rs`). Both are prevention-by-convention items with zero-cost fixes when applied early and expensive debugging if missed.

**Primary recommendation:** Scaffold `create-tauri-app` (React + TypeScript template), apply all four macOS native chrome items immediately, write migrations in Rust as `Migration` structs inline in `main.rs`, install Monaco + `vite-plugin-monaco-editor` in the same session, then run the Tauri-subprocess auth inheritance validation as the first IPC smoke test.

---

## Standard Stack

### Core (all version-pinned in prior STACK.md research)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `tauri` | 2.10.3 | Desktop shell, IPC, bundling | Current stable; plugin versions must match core minor |
| `tauri-plugin-shell` | 2.3.5 | Spawn `claude -p` subprocess with inherited env | Only Tauri-native way to inherit HOME/PATH without manual env passthrough |
| `tauri-plugin-sql` | 2.3.2 | SQLite + migrations in Rust | Gives migration system + JS-side query API; avoids hand-rolling the bridge |
| `window-vibrancy` | 0.7.1 | macOS NSVisualEffectView sidebar effect | Required for `apply_vibrancy(NSVisualEffectMaterial::Sidebar)` |
| `anyhow` | ^1 | Ergonomic Rust error handling | `.map_err(|e| e.to_string())` at IPC boundary converts to strings Tauri can serialize |
| `serde` + `serde_json` | 1.x | IPC payload serialization | Required by all `#[tauri::command]` params and return types |
| React | 19.2.5 | UI framework | Peer dep for shadcn/ui + @xyflow/react 12 |
| TypeScript | 6.0.x | Type safety | Strict mode; IPC serde roundtrip surfaces errors immediately |
| Vite | 8.0.x | Frontend build | Tauri-recommended; HMR works with Tauri dev proxy |
| Tailwind CSS | v4.x | Styling | shadcn/ui CLI generates v4-compatible components by default |
| shadcn/ui | CLI v4 (April 2026) | Component library | Unified `radix-ui` package; run `npx shadcn@latest init` |
| `zustand` | 5.0.12 | Global state | Native React 19 `useSyncExternalStore`; no Context → no WKWebView Context bugs |
| `zundo` | 2.3.0 | Undo/redo middleware for Zustand | `temporal` middleware; `useTemporalStore` gives `undo()`, `pastStates`, `canUndo` |
| `react-resizable-panels` | 4.10.0 | Three-pane IDE layout | shadcn/ui `Resizable` primitive; v4 supports mixed pixel + % sizing |
| `@monaco-editor/react` | 4.7.0 | Monaco React wrapper | Handles worker loading via `loader` utility; critical for WKWebView worker issue |
| `monaco-editor` | 0.55.1 | Core Monaco | Must stay in sync with wrapper version |
| `vite-plugin-monaco-editor` | latest | Bundle Monaco workers in Vite | Prevents "Could not create web worker" in WKWebView at scaffold time |

### Phase 1-Specific Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@tauri-apps/plugin-sql` | 2.x | Frontend JS query API for SQLite | Connect frontend to SQLite DB — `Database.load('sqlite:contract-ide.db')` |
| `@tauri-apps/plugin-shell` | 2.x | Frontend JS shell API | Needed for any JS-side subprocess spawning (Rust-side preferred for claude CLI) |
| `pkg` (npm) | 5.8.1 | Compile MCP TS sidecar to binary | Day0 confirmed it works with Node 18 target on arm64; use `node18-macos-arm64` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `tauri-plugin-sql` | Raw `rusqlite` crate | rusqlite gives more control (transactions, WAL pragma) but requires writing the JS query bridge from scratch; use rusqlite only if plugin falls short |
| `zundo` middleware | Custom undo stack in Zustand | zundo is 700 bytes and battle-tested; hand-rolling saves nothing; use zundo |
| `window-vibrancy` crate | Tauri `WindowEffectsConfig` | Tauri v2 added built-in `WindowEffect` API (undocumented in stable docs); `window-vibrancy` crate is the verified path for `NSVisualEffectMaterial::Sidebar` |
| `vite-plugin-monaco-editor` (vdesjs) | `@tomjs/vite-plugin-monaco-editor` | Both work; vdesjs is older/more popular; either resolves the WKWebView worker issue |

**Installation:**
```bash
# Scaffold (one-time)
npm create tauri-app@latest contract-ide -- --template react-ts
cd contract-ide

# Frontend core
npm install zustand zundo react-resizable-panels
npm install @monaco-editor/react monaco-editor
npm install -D vite-plugin-monaco-editor

# shadcn/ui
npx shadcn@latest init
npx shadcn@latest add button separator resizable scroll-area

# Tauri JS plugins
npm install @tauri-apps/plugin-sql @tauri-apps/plugin-shell
```

```toml
# src-tauri/Cargo.toml additions
[dependencies]
tauri = { version = "2", features = ["unstable"] }
tauri-plugin-shell = "2"
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
window-vibrancy = "0.7"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
anyhow = "1"
```

---

## Architecture Patterns

### Recommended Project Structure (Phase 1 skeleton)

```
contract-ide/
├── src/                            # React frontend
│   ├── ipc/
│   │   ├── types.ts                # Shared IPC payload interfaces (mirror Rust structs)
│   │   └── nodes.ts                # Typed wrappers: get_nodes, etc.
│   ├── store/
│   │   ├── graph.ts                # Zustand: nodes, edges, selection
│   │   └── editor.ts               # Zustand + zundo: contract edit text, undo stack
│   ├── components/
│   │   ├── layout/
│   │   │   └── AppShell.tsx        # ResizablePanelGroup: sidebar | graph | inspector
│   │   └── ui/                     # shadcn/ui components
│   └── App.tsx
│
├── src-tauri/
│   ├── src/
│   │   ├── main.rs                 # Tauri setup, plugin registration — NO #[tokio::main]
│   │   ├── commands/
│   │   │   ├── mod.rs
│   │   │   └── nodes.rs            # get_nodes IPC command stub
│   │   └── db/
│   │       └── migrations.rs       # Migration vec — all schemas defined here
│   ├── capabilities/
│   │   └── default.json            # shell:allow-execute, sql permissions
│   └── Cargo.toml
│
└── vite.config.ts                  # vite-plugin-monaco-editor registered here
```

### Pattern 1: Tauri Window Config for macOS Native Chrome

**What:** Configure `tauri.conf.json` for transparent overlay titlebar + traffic lights + vibrancy
**When to use:** At project scaffold time, before any React components are written

```json
// src-tauri/tauri.conf.json — windows section
{
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "Contract IDE",
        "width": 1400,
        "height": 900,
        "decorations": true,
        "transparent": true,
        "titleBarStyle": "Overlay",
        "trafficLightPosition": { "x": 19, "y": 24 },
        "hiddenTitle": true
      }
    ],
    "macOSPrivateApi": true
  }
}
```

```rust
// src-tauri/src/main.rs — apply vibrancy in setup hook
// Source: https://crates.io/crates/window-vibrancy v0.7.1

use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

tauri::Builder::default()
    .setup(|app| {
        let window = app.get_webview_window("main").unwrap();
        #[cfg(target_os = "macos")]
        apply_vibrancy(&window, NSVisualEffectMaterial::Sidebar, None, None)
            .expect("apply_vibrancy failed");
        Ok(())
    })
```

```css
/* src/index.css — required for transparent window to show through */
html, body, #root {
  background: transparent;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", sans-serif;
}
```

### Pattern 2: Rust Migration Definitions (tauri-plugin-sql)

**What:** Inline Migration structs in Rust — not numbered SQL files. This is how tauri-plugin-sql v2 works.
**When to use:** In `main.rs` before `tauri::Builder::default()` call

```rust
// Source: https://v2.tauri.app/plugin/sql/
use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

fn get_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_core_tables",
            sql: r#"
                CREATE TABLE IF NOT EXISTS nodes (
                  uuid          TEXT PRIMARY KEY,
                  level         TEXT NOT NULL CHECK(level IN ('L0','L1','L2','L3','L4')),
                  name          TEXT NOT NULL,
                  file_path     TEXT,
                  parent_uuid   TEXT REFERENCES nodes(uuid),
                  is_canonical  INTEGER NOT NULL DEFAULT 1,
                  canonical_uuid TEXT REFERENCES nodes(uuid),
                  code_hash     TEXT,
                  contract_hash TEXT,
                  human_pinned  INTEGER NOT NULL DEFAULT 0,
                  route         TEXT,
                  derived_at    TEXT,
                  contract_body TEXT,
                  tags          TEXT,
                  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
                );
                CREATE TABLE IF NOT EXISTS edges (
                  id          TEXT PRIMARY KEY,
                  source_uuid TEXT NOT NULL REFERENCES nodes(uuid),
                  target_uuid TEXT NOT NULL REFERENCES nodes(uuid),
                  edge_type   TEXT NOT NULL,
                  label       TEXT
                );
                CREATE TABLE IF NOT EXISTS node_flows (
                  node_uuid   TEXT NOT NULL REFERENCES nodes(uuid),
                  flow_uuid   TEXT NOT NULL REFERENCES nodes(uuid),
                  PRIMARY KEY (node_uuid, flow_uuid)
                );
                CREATE TABLE IF NOT EXISTS drift_state (
                  node_uuid          TEXT PRIMARY KEY REFERENCES nodes(uuid),
                  current_code_hash  TEXT NOT NULL,
                  contract_code_hash TEXT NOT NULL,
                  drifted_at         TEXT NOT NULL,
                  reconciled_at      TEXT
                );
                CREATE TABLE IF NOT EXISTS receipts (
                  id                  TEXT PRIMARY KEY,
                  session_id          TEXT NOT NULL,
                  transcript_path     TEXT NOT NULL,
                  started_at          TEXT,
                  finished_at         TEXT,
                  input_tokens        INTEGER,
                  output_tokens       INTEGER,
                  cache_read_tokens   INTEGER,
                  tool_call_count     INTEGER,
                  nodes_touched       TEXT,
                  estimated_cost_usd  REAL,
                  raw_summary         TEXT,
                  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
                );
                CREATE INDEX IF NOT EXISTS idx_nodes_parent_uuid ON nodes(parent_uuid);
                CREATE INDEX IF NOT EXISTS idx_nodes_file_path ON nodes(file_path);
                CREATE INDEX IF NOT EXISTS idx_nodes_level ON nodes(level);
                CREATE INDEX IF NOT EXISTS idx_node_flows_flow ON node_flows(flow_uuid);
                CREATE INDEX IF NOT EXISTS idx_receipts_node_uuid ON receipts(id);
                CREATE INDEX IF NOT EXISTS idx_drift_drifted ON drift_state(reconciled_at)
                  WHERE reconciled_at IS NULL;
                CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
                  uuid UNINDEXED, name, contract_body, tags,
                  content='nodes', content_rowid='rowid'
                );
            "#,
            kind: MigrationKind::Up,
        }
    ]
}

// In main():
tauri::Builder::default()
    .plugin(
        SqlBuilder::default()
            .add_migrations("sqlite:contract-ide.db", get_migrations())
            .build(),
    )
```

**Critical:** Migrations run automatically on both plugin init and on frontend `Database.load()`. Never manually delete the DB to "reset" migrations during dev — add a new migration version instead.

### Pattern 3: Typed IPC Wrapper Pattern

**What:** All `invoke()` calls wrapped in typed functions in `src/ipc/`
**When to use:** Write all wrappers before any component uses them — IPC surface is the integration contract

```typescript
// src/ipc/types.ts
export interface ContractNode {
  uuid: string;
  level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
  name: string;
  file_path: string | null;
  parent_uuid: string | null;
  is_canonical: boolean;
  code_hash: string | null;
  contract_body: string | null;
  tags: string[];
}

// src/ipc/nodes.ts
import { invoke } from '@tauri-apps/api/core';
import type { ContractNode } from './types';

export async function getNodes(params?: { level?: string; parent_uuid?: string }): Promise<ContractNode[]> {
  return invoke<ContractNode[]>('get_nodes', params ?? {});
}
```

```rust
// src-tauri/src/commands/nodes.rs
use tauri_plugin_sql::DbPool;
use serde::Serialize;

#[derive(Serialize)]
pub struct ContractNode {
    pub uuid: String,
    pub level: String,
    pub name: String,
    pub file_path: Option<String>,
    pub parent_uuid: Option<String>,
    pub is_canonical: bool,
    pub code_hash: Option<String>,
    pub contract_body: Option<String>,
    pub tags: Vec<String>,
}

#[tauri::command]
pub async fn get_nodes(level: Option<String>, parent_uuid: Option<String>) -> Result<Vec<ContractNode>, String> {
    // Phase 1: return empty list — migrations ran = success
    Ok(vec![])
}
```

### Pattern 4: tauri-plugin-shell Subprocess Spawning

**What:** Spawn `claude -p` from Rust; environment inherited by default
**When to use:** Phase 1 Day 1 integration validation, then Phase 8 for the full agent loop

```rust
// Source: https://docs.rs/tauri-plugin-shell/latest/tauri_plugin_shell/
// CommandEvent::Stdout streaming pattern

use tauri_plugin_shell::ShellExt;
use tauri::Manager;

#[tauri::command]
pub async fn test_claude_spawn(app: tauri::AppHandle) -> Result<String, String> {
    let shell = app.shell();
    let output = shell
        .command("claude")
        .args(["-p", "say hello"])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}
```

```json
// src-tauri/capabilities/default.json — required permission
{
  "permissions": [
    "shell:allow-execute",
    "shell:allow-spawn",
    "sql:allow-load",
    "sql:allow-execute",
    "sql:allow-select"
  ]
}
```

**Auth inheritance:** `tauri-plugin-shell` inherits the parent process environment by default (including `HOME`). Claude Code reads auth from `~/.claude/` which is located via `HOME`. Auth works without any explicit env passthrough — but validate in `cargo tauri dev` not just bare terminal.

### Pattern 5: Monaco CSP + vite-plugin-monaco-editor

**What:** Register Monaco workers as Vite chunks; add `blob:` to CSP as fallback
**When to use:** At scaffold time, before any Monaco editor component is added

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import monacoEditor from 'vite-plugin-monaco-editor';

export default defineConfig({
  plugins: [
    react(),
    monacoEditor({
      languageWorkers: ['editorWorkerService', 'typescript', 'json', 'css', 'html'],
    }),
  ],
});
```

```json
// src-tauri/tauri.conf.json — CSP section
{
  "app": {
    "security": {
      "csp": {
        "default-src": ["'self'"],
        "script-src": ["'self'", "blob:"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:", "asset:", "https://asset.localhost"]
      }
    }
  }
}
```

**Test:** Run `cargo tauri dev`, open Monaco editor, check for "Could not create web worker" in Tauri dev console (not browser dev console — different environment).

### Pattern 6: Autosave + Two-Level Undo (zundo)

**What:** Editor store with zundo temporal middleware; `saveContract` on blur/Cmd+S; `undo()` on Cmd+Z
**When to use:** Wire at store setup time; validate against stub before Phase 2

```typescript
// src/store/editor.ts
// Source: https://github.com/charkour/zundo (zundo 2.3.0)
import { create } from 'zustand';
import { temporal } from 'zundo';

interface EditorState {
  contractText: string;
  isDirty: boolean;
  setContractText: (text: string) => void;
  saveContract: () => Promise<void>;
}

export const useEditorStore = create<EditorState>()(
  temporal(
    (set, get) => ({
      contractText: '',
      isDirty: false,
      setContractText: (text) => set({ contractText: text, isDirty: true }),
      saveContract: async () => {
        const { contractText } = get();
        // Phase 1: stub — just mark not dirty
        set({ isDirty: false });
      },
    }),
    { limit: 2 }   // two-level undo as per SHELL-05
  )
);

// Undo hook usage in component:
export const useEditorUndo = () => useEditorStore.temporal.getState().undo;
```

```typescript
// In the editor component — keyboard bindings
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      useEditorStore.getState().saveContract();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      e.preventDefault();
      useEditorStore.temporal.getState().undo();
    }
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}, []);
```

### Pattern 7: Tauri Event Listener with Cleanup

**What:** Subscribe to Tauri backend events in React with proper cleanup
**When to use:** Every `listen()` call; memory leak if unlisten is not called

```typescript
// Source: Tauri v2 docs — event system
import { listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';

function useNodeUpdates(onUpdate: (nodeUuids: string[]) => void) {
  useEffect(() => {
    const unlisten = listen<{ node_uuids: string[] }>('contracts:updated', (event) => {
      onUpdate(event.payload.node_uuids);
    });
    return () => { unlisten.then(f => f()); };
  }, [onUpdate]);
}
```

### Anti-Patterns to Avoid

- **`#[tokio::main]` in main.rs:** Causes silent Tauri async runtime conflict (GitHub #13330). Add a lint comment in `main.rs`: `// NEVER add #[tokio::main] — Tauri owns the runtime. Use tauri::async_runtime::spawn().`
- **Polling drift state:** Never call `get_drift_state` on a timer. Use `listen('drift:updated')` + Zustand.
- **Two-step IPC for approve:** Never `invoke('write_contract')` then `invoke('write_code')`. Single atomic Rust command for any multi-file write.
- **Typed invoke without generics:** `invoke('get_nodes')` returns `any`. Always `invoke<ContractNode[]>('get_nodes')`.
- **`listen()` without cleanup:** Always return `unlisten.then(f => f())` from `useEffect`.
- **`tailwind.config.js` manual creation:** Let `npx shadcn@latest init` manage Tailwind v4 setup; CSS-first `@theme` block, not `tailwind.config.js`.
- **Using old `reactflow` package:** Package renamed to `@xyflow/react` in v12. Installing `reactflow` gives buggy v11.
- **`macOSPrivateApi: false` with vibrancy:** `apply_vibrancy` requires `macOSPrivateApi: true` + `transparent: true` in `tauri.conf.json`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQLite migrations | Custom migration runner | `tauri-plugin-sql` `Migration` struct | Handles version tracking, up/down, runs on every DB open automatically |
| Undo/redo stack | `pastStates: T[]` in Zustand | `zundo` temporal middleware | 700 bytes; handles limit, partial state, concurrent updates |
| Monaco worker bundling | Custom Vite worker config | `vite-plugin-monaco-editor` | WKWebView blob URL restrictions; plugin handles the URL resolution correctly |
| IDE panel layout | Custom CSS grid/flex resize | `react-resizable-panels` + shadcn `Resizable` | Drag handles, min/max constraints, persistence — weeks of work for a slider |
| macOS vibrancy effect | Custom NSVisualEffectView via Tauri JS | `window-vibrancy` Rust crate | Correct NSVisualEffectView lifecycle tied to Tauri window events |
| Typed IPC codegen | String-matching Rust/TS types manually | TauRPC or typed wrappers in `src/ipc/` | At minimum write typed wrappers; TauRPC generates TS from Rust for bigger surfaces |
| JSONL token field access | Direct field access on parsed JSON | Optional chaining: `usage?.input_tokens ?? 0` | Schema is not versioned; fields change without notice |

**Key insight:** Phase 1's infrastructure is almost entirely composed of well-solved problems. The only novel work is the schema design and integration wiring. Hand-rolling any of these items would cost days and produce worse results.

---

## Common Pitfalls

### Pitfall 1: `#[tokio::main]` Silent Deadlock
**What goes wrong:** Adding `#[tokio::main]` to `main.rs` causes a double-runtime initialization. Background Tauri tasks silently drop — file watcher callbacks fire but Tauri events never reach the frontend. IPC commands return `Ok` but the UI never updates.
**Why it happens:** Every Rust async tutorial shows `#[tokio::main]`. Tauri's scaffolded `main.rs` does not include it but it's easy to add.
**How to avoid:** Leave `main.rs` exactly as scaffolded. Add comment: `// NEVER #[tokio::main] — Tauri owns the runtime.`
**Warning signs:** `git grep tokio::main src-tauri/` returns anything.

### Pitfall 2: Monaco Workers Fail in WKWebView
**What goes wrong:** Monaco silently falls back to single-threaded mode. Editor is sluggish; diff highlights stutter; "Could not create web worker" in Tauri console (invisible in browser dev mode).
**Why it happens:** Default WKWebView CSP blocks `new Worker(URL.createObjectURL(...))`. Chrome dev mode is not WKWebView — workers work in browser, fail in `cargo tauri dev`.
**How to avoid:** `vite-plugin-monaco-editor` + `blob:` in `script-src`. Install at scaffold time; test in `cargo tauri dev` explicitly before Phase 4.
**Warning signs:** Worker error in `cargo tauri dev` console. Works in `npm run dev` browser mode. This is the tell.

### Pitfall 3: Transparent Window Not Working After Build
**What goes wrong:** Vibrancy and transparency work in `cargo tauri dev` but revert to solid white after `cargo tauri build`.
**Why it happens:** `macOSPrivateApi: true` is required in `tauri.conf.json` for transparent webview windows in production builds (GitHub issue #13415).
**How to avoid:** Set `"macOSPrivateApi": true` in tauri.conf.json from day 1. Test with `cargo tauri build` not just `cargo tauri dev` before considering vibrancy "done."
**Warning signs:** Solid sidebar in production build; translucent in dev. Look for `macOSPrivateApi` in tauri.conf.json.

### Pitfall 4: Tauri-Subprocess Auth Inheritance Not Tested
**What goes wrong:** `claude -p "say hello"` works in terminal but fails inside `tauri-plugin-shell` because `HOME` or PATH is different in the Tauri process environment.
**Why it happens:** Tauri's process environment on macOS may differ from the interactive shell environment — especially on first launch from Finder/Dock vs. from terminal.
**How to avoid:** Run the `test_claude_spawn` IPC command as the **first** Day 1 validation check. Do not assume terminal behavior = Tauri behavior.
**Warning signs:** Command returns stderr about missing auth or "not logged in" when launched from Finder; works when launched from terminal.

### Pitfall 5: SQLite Migration Version Conflict
**What goes wrong:** Adding a new field to an existing migration breaks the migration system — it's already been applied at version 1. The DB never gets the new column.
**Why it happens:** Migrations are versioned. Version 1 is immutable once applied.
**How to avoid:** Never modify an existing migration's `sql` field. Add a new `Migration { version: 2, ... }` for schema changes. During development, if you need to reset: delete the DB file from `$APP_DATA_DIR/contract-ide.db` (not your source directory). Document the DB path location.
**Warning signs:** New column appears in migration SQL but doesn't exist in the live DB; SELECT fails with "no such column."

### Pitfall 6: Tailwind v4 Config Hybrid
**What goes wrong:** Manually creating `tailwind.config.js` alongside a CSS-first `@theme {}` block causes silent style failures — some config is respected, some ignored.
**Why it happens:** Tailwind v4 removed `tailwind.config.js`. If you scaffold and then create one manually, you get a hybrid.
**How to avoid:** Let `npx shadcn@latest init` create the Tailwind setup. Do not create `tailwind.config.js`. Use `@theme {}` in your main CSS file.

---

## Code Examples

### JSONL Token Fields (from live captured session — Day0 Check 2)

The exact `usage` fields confirmed in a live Claude Code 2.1.111 session JSONL:

```json
{
  "type": "assistant",
  "message": {
    "usage": {
      "input_tokens": 6,
      "cache_creation_input_tokens": 15874,
      "cache_read_input_tokens": 20038,
      "output_tokens": 120,
      "server_tool_use": { "web_search_requests": 0, "web_fetch_requests": 0 },
      "service_tier": "standard",
      "cache_creation": {
        "ephemeral_1h_input_tokens": 15874,
        "ephemeral_5m_input_tokens": 0
      },
      "inference_geo": "",
      "iterations": [ ... ],
      "speed": "standard"
    }
  }
}
```

**Safe receipt extraction (Phase 8 will use this; install defensive parse pattern now):**
```typescript
const inputToks = entry?.message?.usage?.input_tokens ?? 0;
const outputToks = entry?.message?.usage?.output_tokens ?? 0;
const cacheRead = entry?.message?.usage?.cache_read_input_tokens ?? 0;
const cacheCreation = entry?.message?.usage?.cache_creation_input_tokens ?? 0;
```

### PostToolUse Hook Payload (confirmed from day0 validation)

```json
{
  "session_id": "c39b839d-...",
  "transcript_path": "/Users/yang/.claude/projects/<encoded-path>/<session-id>.jsonl",
  "cwd": "<workspace>",
  "permission_mode": "default",
  "hook_event_name": "PostToolUse",
  "tool_name": "Write",
  "tool_input": { "file_path": "...", "content": "..." },
  "tool_response": {
    "type": "create",
    "filePath": "...",
    "structuredPatch": [],
    "originalFile": null,
    "userModified": false
  },
  "tool_use_id": "toolu_01..."
}
```

Hook must exit 0 with no stdout. Settings registration:
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "/path/to/hook.sh" }]
      }
    ]
  }
}
```

### Autosave on Blur Pattern

```typescript
// In contract textarea/Monaco component
<textarea
  value={contractText}
  onChange={(e) => setContractText(e.target.value)}
  onBlur={() => saveContract()}   // autosave on focus loss
/>
```

### tauri-plugin-sql Frontend Query Pattern

```typescript
// Source: https://v2.tauri.app/plugin/sql/
import Database from '@tauri-apps/plugin-sql';

const db = await Database.load('sqlite:contract-ide.db');
// Migrations run automatically on load()
const nodes = await db.select<ContractNode[]>(
  'SELECT * FROM nodes WHERE level = $1',
  ['L0']
);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `reactflow` npm package | `@xyflow/react` (v12 rename) | v12, Oct 2024 | Installing old package gives buggy v11 — use new name |
| `tailwind.config.js` | CSS-first `@theme {}` block | Tailwind v4, Jan 2025 | Let shadcn CLI manage; no manual config file |
| `@radix-ui/react-*` individual packages | Unified `radix-ui` package | shadcn CLI v4, Feb 2026 | One install, not 15 separate packages |
| `pkg@5` + Node 18 | `@yao-pkg/pkg` for Node 20+ | ongoing | Day0 confirmed: pkg@5.8.1 max Node 18; fine for hackathon |
| SSE transport for MCP | stdio transport for local sidecar | MCP spec 2025-03-26 | SSE deprecated; StdioServerTransport is correct for sidecar |
| `#[tokio::main]` + Tauri | `tauri::async_runtime::spawn()` | Tauri v2 | Runtime conflict; zero tolerance |

**Deprecated/outdated:**
- `dagre` (npm, v0.8.5): abandoned. Use `@dagrejs/dagre` ^3.0.0.
- `react-monaco-editor` (community): stale. Use `@monaco-editor/react` by suren-atoyan.
- `tailwindcss-animate`: replaced by `tw-animate-css` in Tailwind v4.
- `tauri-plugin-rusqlite2`: unmaintained, no migration support. Use `tauri-plugin-sql`.

---

## Day 0 Integration Validation — Phase 1 Entry Criteria

These are the three checks from the Phase 1 success criterion (Day-1 integration validation). Two are fully validated; one deferred to Phase 1 Day 1:

| Check | Status | Required Action |
|-------|--------|-----------------|
| (a) `claude -p "say hello"` via `tauri-plugin-shell` receives stdout | **Deferred to Phase 1 Day 1** — basic CLI pass, Tauri subprocess not yet tested | Wire `test_claude_spawn` IPC command as first task; test launched from Finder, not terminal |
| (b) PostToolUse hook receives `transcript_path`; JSONL has `usage.input_tokens` | **Confirmed ✅** — full schema captured in `/Users/yang/lahacks/day0/check2-hook-payload/captures/` | Field names confirmed: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` |
| (c) `better-sqlite3` in `pkg`-compiled binary runs without module-not-found | **Confirmed ✅** — Node18/arm64 12MB binary passes | Pin `pkg@5.8.1`, target `node18-macos-arm64`; migrate to `@yao-pkg/pkg` post-demo for Node 20 |

---

## Open Questions

1. **Tauri subprocess env on Finder launch vs terminal launch**
   - What we know: `HOME` is inherited by default from parent process environment
   - What's unclear: Whether Finder-launched Tauri (macOS `open` mechanism) passes the same shell environment as terminal launch; `claude` reads auth from `~/.claude/` which needs `HOME`
   - Recommendation: Phase 1 Task 1 — `test_claude_spawn` IPC command; test by launching from Finder specifically, not from terminal

2. **`tauri-plugin-sql` WAL mode default**
   - What we know: `tauri-plugin-sql` uses sqlx under the hood; SQLite default is DELETE journal mode
   - What's unclear: Whether WAL mode is enabled automatically or needs a migration pragma
   - Recommendation: Add `PRAGMA journal_mode = WAL;` as the first SQL in migration version 1; this enables WAL for both the Rust connection and the read-only MCP sidecar connection

3. **Phase 1 schema vs. REQUIREMENTS.md mismatch for `code_ranges`**
   - What we know: REQUIREMENTS.md DATA-01 specifies `code_ranges` as `list of {file, start_line, end_line}` instead of a flat `file_path` column
   - What's unclear: DATA-01 is a Phase 2 requirement; Phase 1 schema needs to be forward-compatible
   - Recommendation: Phase 1 migration uses flat `file_path TEXT` for now; Phase 2 migration adds `code_ranges TEXT` (JSON) column and drops/deprecates `file_path` — document this in migration comments

4. **Vibrancy sidebar region scoping**
   - What we know: `apply_vibrancy` applies the effect to the whole window
   - What's unclear: Whether the three-pane layout (sidebar vibrancy, center graph non-vibrancy) can be achieved with whole-window vibrancy + CSS background override for non-sidebar panels
   - Recommendation: Apply `NSVisualEffectMaterial::Sidebar` whole-window; set `background-color: var(--background)` on graph canvas panel to override the transparency; sidebar gets the effect for free

---

## Sources

### Primary (HIGH confidence)
- `https://v2.tauri.app/plugin/sql/` — Migration struct, `add_migrations()`, frontend `Database.load()` API
- `https://v2.tauri.app/learn/window-customization/` — titleBarStyle, decorations, trafficLightPosition
- `https://v2.tauri.app/reference/config/` — WindowConfig fields: titleBarStyle valid values ("Visible", "Transparent", "Overlay"), trafficLightPosition type, transparent, decorations
- `https://docs.rs/window-vibrancy/latest/window_vibrancy/` — `apply_vibrancy()` signature, `NSVisualEffectMaterial` enum (Sidebar, AppearanceBased, HudWindow, Titlebar)
- `https://docs.rs/tauri-plugin-shell/latest/tauri_plugin_shell/` — CommandEvent variants (Stdout, Stderr), env() method, spawn(), default env inheritance
- `/Users/yang/lahacks/day0/FINDINGS.md` — Live validation: PostToolUse payload schema, JSONL usage fields, pkg/better-sqlite3 on Node18/arm64
- `/Users/yang/lahacks/day0/check2-hook-payload/captures/payload-1776844307.json` — Actual captured hook payload with full `tool_response.structuredPatch` schema
- Live JSONL session at `~/.claude/projects/...` — Confirmed `usage` fields: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `cache_creation.ephemeral_1h_input_tokens`

### Secondary (MEDIUM confidence)
- `https://github.com/charkour/zundo` — zundo 2.3.0 temporal middleware; `useTemporalStore`, `undo()`, `limit` option
- `https://github.com/tauri-apps/tauri/issues/13415` — Transparent window solid white after DMG build; `macOSPrivateApi: true` required
- `https://github.com/tauri-apps/tauri/issues/13330` — `#[tokio::main]` Tauri runtime conflict (still open 2026)
- `https://github.com/vdesjs/vite-plugin-monaco-editor` — Worker URL resolution for WKWebView; `languageWorkers` config
- Prior STACK.md research (`/Users/yang/lahacks/.planning/research/STACK.md`) — All version-pinned dependencies, integration seam notes

### Tertiary (LOW confidence)
- WebSearch results re: Tauri subprocess env inheritance — No official documentation found; inferred from `tauri-plugin-shell` default behavior; validate empirically in Phase 1 Day 1

---

## Metadata

**Confidence breakdown:**
- Standard stack versions: HIGH — version-pinned from prior research verified 2026-04-24 via official release pages
- macOS native chrome config: HIGH — titleBarStyle/trafficLightPosition from official Tauri config ref; vibrancy from docs.rs
- SQLite migration pattern: HIGH — fetched directly from v2.tauri.app/plugin/sql/ showing exact Migration struct
- JSONL schema: HIGH — captured from a live Claude Code 2.1.111 session in day0 check, not inferred
- PostToolUse hook payload: HIGH — captured actual payload in day0 check2
- Autosave/undo: HIGH — zundo 2.3.0 API confirmed from GitHub repo; limit:2 behavior verified
- Subprocess auth inheritance: MEDIUM — default behavior inferred; empirical validation required Phase 1 Day 1
- Vibrancy sidebar scoping: MEDIUM — whole-window vibrancy behavior; CSS override approach is standard but not explicitly documented

**Research date:** 2026-04-24
**Valid until:** 2026-05-22 (30 days — stable stack; Tauri releases are stable cadence)
**Critical validation before Phase 1 ends:** Run `test_claude_spawn` IPC command from Finder-launched app to confirm auth inheritance.
