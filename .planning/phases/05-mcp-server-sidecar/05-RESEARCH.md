# Phase 5: MCP Server Sidecar — Research

**Researched:** 2026-04-24
**Domain:** Tauri sidecar packaging, MCP TypeScript SDK stdio server, better-sqlite3 read-only, Claude Code MCP config
**Confidence:** HIGH (Tauri sidecar docs + MCP SDK verified), MEDIUM (build pipeline native addon challenge flagged)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MCP-01 | A TypeScript MCP server packaged as a Tauri sidecar exposes `find_by_intent`, `get_contract`, `list_drifted_nodes`, and `update_contract` tools over stdio | Architecture Patterns §MCP Server Skeleton; §Tauri Sidecar Launch; Standard Stack §@modelcontextprotocol/sdk |
| MCP-03 | MCP sidecar reads the SQLite cache via a read-only `better-sqlite3` connection (single-writer rule upheld by Rust backend) | Architecture Patterns §Read-Only SQLite Connection; §Single-Writer Invariant; Common Pitfalls §WAL concurrent readers |
</phase_requirements>

---

## Summary

Phase 5 has four distinct subproblems: (1) build the TypeScript MCP server as a `pkg`-compiled standalone binary with target-triple naming, (2) register it in `tauri.conf.json` as an `externalBin` sidecar and spawn it from Rust at app startup via `tauri-plugin-shell`, (3) expose all four tools over stdio using `@modelcontextprotocol/sdk` v1.x with Zod schema validation against the live SQLite DB via a read-only `better-sqlite3` connection, and (4) emit a Tauri frontend event confirming the sidecar is alive so the UI health check works.

The biggest implementation risk is the build pipeline: `better-sqlite3` is a native Node.js addon that requires a compiled `.node` file specific to the Node.js version and CPU architecture. `bun build --compile` cannot include it (incompatible runtime). Node.js SEA (Single Executable Application) can bundle native addons as temporary file assets but is experimental. `@yao-pkg/pkg` handles `.node` files as packaged assets by default — it extracts them to `$HOME/.cache/pkg/` at runtime — and this is the approach the official Tauri sidecar-nodejs guide features. The recommended pipeline is: **TypeScript → esbuild bundle → `@yao-pkg/pkg` compile → rename with `rustc --print host-tuple` → place in `src-tauri/binaries/`**.

For the MCP server itself, `@modelcontextprotocol/sdk` v1.x (`@modelcontextprotocol/sdk/server/mcp.js` + `/server/stdio.js`) with the high-level `McpServer` API is the correct choice. v2 is in pre-alpha; use v1.x for production. The SDK v1.x requires Zod (any version) for `inputSchema`. The four tools operate against the read-only `better-sqlite3` connection; `update_contract` is the one write operation — it writes the `.md` file to disk (never SQLite directly), then Rust's watcher propagates the change within 2s. The DB path is passed from Rust as an environment variable or CLI argument when the sidecar is spawned.

**Primary recommendation:** Use `@yao-pkg/pkg` for standalone binary, `@modelcontextprotocol/sdk` v1.x for MCP, `better-sqlite3` with `{ readonly: true }` for SQLite reads. The sidecar launch is handled by `tauri-plugin-shell` `.sidecar("mcp-server").spawn()` from a Rust setup hook; the UI health check listens for a startup Tauri event emitted after the first sidecar stdout line arrives.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | 1.x (latest stable) | MCP server, tool registration, stdio transport | Official SDK from Anthropic/MCP consortium; McpServer high-level API + StdioServerTransport; v2 pre-alpha — not production ready |
| `better-sqlite3` | 12.x | SQLite reads from the MCP sidecar | Synchronous API matches MCP's synchronous tool handler model; `readonly: true` option enforces single-writer rule; fastest Node.js SQLite driver |
| `zod` | 3.x (or 4.x) | Tool inputSchema validation in MCP SDK | Required by `@modelcontextprotocol/sdk` for tool schema; `z.object({...})` passed as `inputSchema` |
| `@yao-pkg/pkg` | latest | Compile TypeScript → standalone binary with native addons | Only packager that handles `.node` native addons for Tauri sidecars; official Tauri sidecar-nodejs guide uses it; extracts `.node` to cache dir at runtime |
| `esbuild` | latest | Bundle TypeScript → single JS file before pkg | Faster than tsc, strips types, resolves imports; outputs CommonJS for pkg compatibility |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `tauri-plugin-shell` | 2.x (already in project) | Spawn sidecar from Rust, write stdin, read stdout events | Already present in project from Phase 1; `ShellExt` trait enables `.sidecar("mcp-server").spawn()` |
| `tsx` or `ts-node` | latest | Run TypeScript sidecar in dev mode without compile | Dev-time only: `tsx src/index.ts` gives fast iteration; production always uses the compiled binary |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@yao-pkg/pkg` | `bun build --compile` | bun cannot load `better-sqlite3` (native addon ABI mismatch); bun has its own `bun:sqlite` but it's a different API — would require rewriting all SQL queries |
| `@yao-pkg/pkg` | Node.js SEA (`--experimental-sea-config`) | SEA can bundle native addons as temp-file assets (experimental); complex multi-step process; pkg is simpler and the Tauri-official recommended approach |
| `better-sqlite3` | `bun:sqlite` (if using bun runtime) | bun:sqlite only works if runtime is bun; pkg compiles for Node.js runtime; these are incompatible choices |
| `@modelcontextprotocol/sdk` v1.x | v2 pre-alpha | v2 API has breaking changes from v1; STATE.md already flags "MCP SDK v2 anticipated Q2 2026" as a blocker concern — stay on v1.x |

**Installation (new sidecar project — separate package.json in `mcp-sidecar/`):**

```bash
# In mcp-sidecar/ directory
npm install @modelcontextprotocol/sdk better-sqlite3 zod
npm install --save-dev @yao-pkg/pkg esbuild @types/better-sqlite3 typescript tsx
```

No new Rust deps needed — `tauri-plugin-shell` is already registered in `src-tauri/src/lib.rs`.

---

## Architecture Patterns

### Recommended Project Structure

```
contract-ide/
├── mcp-sidecar/                  # NEW: Separate Node project for MCP server
│   ├── package.json              # { "name": "mcp-server", "type": "commonjs" }
│   ├── tsconfig.json             # target: ES2020, module: commonjs
│   ├── src/
│   │   ├── index.ts              # Entrypoint: McpServer setup + server.connect(transport)
│   │   ├── db.ts                 # better-sqlite3 readonly connection + prepared statements
│   │   ├── tools/
│   │   │   ├── find_by_intent.ts # FTS5 query on nodes_fts + contract_body
│   │   │   ├── get_contract.ts   # SELECT by uuid
│   │   │   ├── list_drifted.ts   # SELECT WHERE drift_state = 'drifted'
│   │   │   └── update_contract.ts# Write .md file (never SQLite); path from env
│   │   └── types.ts              # Shared TS types mirroring SQLite schema
│   ├── scripts/
│   │   ├── build.js              # esbuild bundle + pkg compile + rename
│   │   └── rename.js             # rustc --print host-tuple → rename to binaries/
│   └── dist/                     # Intermediate esbuild output (gitignored)
│
├── src-tauri/
│   ├── binaries/                 # NEW: pkg-compiled binaries (gitignored except .gitkeep)
│   │   └── mcp-server-aarch64-apple-darwin  # (example; generated by build)
│   ├── src/
│   │   └── commands/
│   │       └── mcp.rs            # NEW: launch_mcp_sidecar(), get_mcp_status()
│   └── tauri.conf.json           # Add "externalBin": ["binaries/mcp-server"]
│
└── src/
    └── ipc/
        └── mcp.ts                # NEW: launchMcpSidecar(), mcpStatus store
```

### Pattern 1: MCP Server — Tool Registration (McpServer high-level API)

**What:** Register all four tools using `McpServer.tool()` with Zod input schemas
**When to use:** This is the modern high-level API in SDK v1.x; do NOT use the older `Server` + `setRequestHandler` low-level API

```typescript
// Source: @modelcontextprotocol/sdk docs (server.md), SDK v1.x
// mcp-sidecar/src/index.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getDb } from './db.js';
import { findByIntent } from './tools/find_by_intent.js';
import { getContract } from './tools/get_contract.js';
import { listDriftedNodes } from './tools/list_drifted.js';
import { updateContract } from './tools/update_contract.js';

const server = new McpServer({
  name: 'contract-ide-mcp',
  version: '1.0.0',
});

server.tool(
  'find_by_intent',
  'Search contracts by natural-language intent using SQLite FTS5',
  { query: z.string().describe('Natural language search query'), limit: z.number().default(10) },
  async ({ query, limit }) => findByIntent(query, limit)
);

server.tool(
  'get_contract',
  'Retrieve a specific contract node by UUID',
  { uuid: z.string().describe('Contract node UUID') },
  async ({ uuid }) => getContract(uuid)
);

server.tool(
  'list_drifted_nodes',
  'List all nodes where code_hash diverges from contract_hash',
  {},
  async () => listDriftedNodes()
);

server.tool(
  'update_contract',
  'Update a contract sidecar .md file. NEVER writes SQLite directly — Rust watcher propagates.',
  {
    uuid: z.string(),
    body: z.string().describe('New contract body text'),
    frontmatter_patch: z.record(z.unknown()).optional().describe('Fields to merge into frontmatter'),
  },
  async (args) => updateContract(args)
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Signal to Tauri that we are live — this line reaches Rust via stdout event
  process.stderr.write('[mcp-server] ready\n');
}

main().catch((err) => {
  process.stderr.write(`[mcp-server] fatal: ${err}\n`);
  process.exit(1);
});
```

**Critical:** Never use `console.log()` in the sidecar — it writes to stdout and corrupts MCP JSON-RPC framing. Always use `process.stderr.write()` or `console.error()` for diagnostics.

### Pattern 2: SQLite Read-Only Connection

**What:** Open the live SQLite DB file with `{ readonly: true }` in better-sqlite3
**When to use:** Sidecar startup; db path received from Tauri as env var or CLI arg

```typescript
// mcp-sidecar/src/db.ts
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  
  // Path to the live SQLite DB — passed from Tauri sidecar spawn environment
  // Tauri stores DB in: ~/Library/Application Support/<identifier>/contract-ide.db
  const dbPath = process.env.CONTRACT_IDE_DB_PATH
    ?? path.join(os.homedir(), 'Library', 'Application Support', 'com.contract-ide.app', 'contract-ide.db');

  db = new Database(dbPath, {
    readonly: true,     // MCP-03: read-only connection enforces single-writer rule
    fileMustExist: true, // Fail fast if DB isn't initialized by Tauri yet
  });

  // SQLite WAL mode: read-only readers never block the Rust writer and vice versa.
  // No WAL pragma needed — Tauri already set WAL mode when it created the DB.
  return db;
}

// FTS5 search (DATA-06 index created in migration v1):
// SELECT uuid, name, level, kind, contract_body, snippet(nodes_fts, 4, '<b>', '</b>', '...', 20)
// FROM nodes_fts WHERE nodes_fts MATCH ?
```

### Pattern 3: Tauri Sidecar Launch (Rust)

**What:** Spawn the MCP sidecar binary on app startup; keep child alive; emit health event when first stderr line arrives
**When to use:** In the `setup()` callback in `lib.rs`, after plugins are initialized

```rust
// src-tauri/src/commands/mcp.rs
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use tauri::Emitter;

pub fn launch_mcp_sidecar(app: &tauri::AppHandle) {
    let app = app.clone();
    
    // Determine DB path to pass to sidecar
    let db_path = app
        .path()
        .app_data_dir()
        .expect("app data dir")
        .join("contract-ide.db");

    let sidecar = app
        .shell()
        .sidecar("mcp-server")
        .expect("mcp-server binary not found in binaries/")
        .env("CONTRACT_IDE_DB_PATH", db_path.to_string_lossy().as_ref());

    let (mut rx, child) = sidecar
        .spawn()
        .expect("Failed to spawn mcp-server sidecar");

    // Store child handle in Tauri managed state so it stays alive
    // (dropping it would kill the process)
    app.manage(McpSidecarHandle(std::sync::Mutex::new(Some(child))));

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stderr(line) => {
                    let msg = String::from_utf8_lossy(&line);
                    if msg.contains("ready") {
                        // Sidecar is alive — notify the UI health check
                        app.emit("mcp:status", serde_json::json!({ "status": "running" }))
                            .ok();
                    }
                    eprintln!("[mcp-sidecar] {msg}");
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[mcp-sidecar] terminated: {:?}", payload);
                    app.emit("mcp:status", serde_json::json!({ "status": "stopped" })).ok();
                }
                _ => {}
            }
        }
    });
}

#[derive(Default)]
pub struct McpSidecarHandle(pub std::sync::Mutex<Option<tauri_plugin_shell::process::CommandChild>>);
```

**Register in `lib.rs` setup:**

```rust
// In setup() callback — after all plugins are initialized
.setup(|app| {
    // ... existing vibrancy code ...
    crate::commands::mcp::launch_mcp_sidecar(app.handle());
    Ok(())
})
// Also manage the state type (needed even before launch fills it)
.manage(commands::mcp::McpSidecarHandle::default())
```

### Pattern 4: `tauri.conf.json` externalBin Configuration

**What:** Declare the sidecar binary stem; Tauri appends target triple at build time
**When to use:** Required for Tauri to bundle the binary with the app

```json
// src-tauri/tauri.conf.json — add to "bundle" object
{
  "bundle": {
    "active": true,
    "targets": "all",
    "externalBin": ["binaries/mcp-server"],
    "icon": ["..."]
  }
}
```

Tauri looks for `src-tauri/binaries/mcp-server-aarch64-apple-darwin` (on Apple Silicon) or `mcp-server-x86_64-apple-darwin` (Intel). The exact suffix is determined by `rustc --print host-tuple`.

### Pattern 5: Shell Capability for Sidecar

**What:** Allow the sidecar to be executed — specific `sidecar: true` permission entry required
**When to use:** The generic `shell:allow-execute` in `capabilities/default.json` is NOT sufficient for sidecars

```json
// src-tauri/capabilities/default.json — replace or supplement shell:allow-execute
{
  "permissions": [
    "core:default",
    "opener:default",
    "shell:allow-spawn",
    {
      "identifier": "shell:allow-execute",
      "allow": [{ "name": "binaries/mcp-server", "sidecar": true }]
    },
    "sql:default",
    "dialog:allow-open",
    "fs:allow-read-text-file",
    "fs:allow-watch",
    { "identifier": "fs:scope", "allow": [{ "path": "**" }, { "path": "**/*" }] }
  ]
}
```

### Pattern 6: Build Pipeline (TypeScript → Binary)

**What:** esbuild bundle → pkg compile → rename with target triple → place in `src-tauri/binaries/`
**When to use:** Every time the MCP sidecar source changes; add to `package.json` build scripts

```javascript
// mcp-sidecar/scripts/build.js
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const __dirname = new URL('.', import.meta.url).pathname;
const root = path.join(__dirname, '..');
const sidecarBinDir = path.join(__dirname, '../../src-tauri/binaries');

// Step 1: Bundle TypeScript with esbuild
execSync('npx esbuild src/index.ts --bundle --platform=node --format=cjs --outfile=dist/index.cjs', {
  cwd: root, stdio: 'inherit'
});

// Step 2: Compile with pkg (handles native .node addons)
execSync('npx pkg dist/index.cjs --output dist/mcp-server --targets node20', {
  cwd: root, stdio: 'inherit'
});

// Step 3: Get target triple and rename for Tauri
const ext = process.platform === 'win32' ? '.exe' : '';
const targetTriple = execSync('rustc --print host-tuple').toString().trim();
if (!targetTriple) throw new Error('rustc --print host-tuple returned empty');

fs.mkdirSync(sidecarBinDir, { recursive: true });
const dest = path.join(sidecarBinDir, `mcp-server-${targetTriple}${ext}`);
fs.copyFileSync(`${root}/dist/mcp-server${ext}`, dest);
fs.chmodSync(dest, 0o755);
console.log(`Built: ${dest}`);
```

```json
// mcp-sidecar/package.json
{
  "name": "mcp-server",
  "version": "1.0.0",
  "type": "commonjs",
  "scripts": {
    "build": "node scripts/build.js",
    "dev": "tsx src/index.ts"
  }
}
```

### Pattern 7: `update_contract` Tool — Single-Writer Invariant

**What:** `update_contract` reads the existing sidecar, patches the frontmatter and/or body, writes the `.md` file to disk — then Rust's watcher propagates it to SQLite within 2s
**When to use:** This is the ONLY write operation in the MCP sidecar; it never touches SQLite

```typescript
// mcp-sidecar/src/tools/update_contract.ts
import fs from 'fs';
import path from 'path';
import { getDb } from '../db.js';

export async function updateContract({ uuid, body, frontmatter_patch }: {
  uuid: string;
  body: string;
  frontmatter_patch?: Record<string, unknown>;
}) {
  const db = getDb();

  // Locate the sidecar file path from the repo path (passed as env var)
  // Strategy: resolve via the repo_path env var that Tauri passes at sidecar spawn
  const repoPath = process.env.CONTRACT_IDE_REPO_PATH;
  if (!repoPath) {
    return { content: [{ type: 'text' as const, text: 'ERROR: CONTRACT_IDE_REPO_PATH not set' }] };
  }

  const sidecarPath = path.join(repoPath, '.contracts', `${uuid}.md`);
  if (!fs.existsSync(sidecarPath)) {
    return { content: [{ type: 'text' as const, text: `ERROR: sidecar not found: ${sidecarPath}` }] };
  }

  // Read → patch frontmatter → write (atomic: write to temp then rename)
  const content = fs.readFileSync(sidecarPath, 'utf-8');
  const patched = patchSidecar(content, body, frontmatter_patch ?? {});
  
  const tmpPath = `${sidecarPath}.tmp`;
  fs.writeFileSync(tmpPath, patched, 'utf-8');
  fs.renameSync(tmpPath, sidecarPath);  // atomic on same filesystem

  return { content: [{ type: 'text' as const, text: `Updated: ${uuid}` }] };
}
```

**Key invariant:** `update_contract` writes `.md` files only. It NEVER opens a writable `better-sqlite3` connection. The `readonly: true` flag on the DB connection enforces this at the Node.js level — any attempt to write would throw immediately.

**Repo path threading:** Tauri passes `CONTRACT_IDE_REPO_PATH` as an environment variable when spawning the sidecar. This must be updated when the user opens a different repo. Two approaches: (a) restart the sidecar with new env var on repo switch, or (b) use a `set_repo_path` MCP tool (internal management tool not exposed to Claude Code).

### Pattern 8: Claude Code `.mcp.json` Configuration

**What:** Project-level `.mcp.json` committed to the repo so Claude Code auto-discovers the sidecar
**When to use:** At Phase 5 completion; the file describes how to launch the compiled binary

```json
// .mcp.json — at project root (committed to git)
{
  "mcpServers": {
    "contract-ide": {
      "type": "stdio",
      "command": "/path/to/contract-ide/src-tauri/binaries/mcp-server-aarch64-apple-darwin",
      "args": [],
      "env": {
        "CONTRACT_IDE_DB_PATH": "~/Library/Application Support/com.contract-ide.app/contract-ide.db",
        "CONTRACT_IDE_REPO_PATH": "${workspaceFolder}"
      }
    }
  }
}
```

**Note:** For demo purposes, Claude Code can also be configured via `claude mcp add contract-ide --transport stdio -- /path/to/binary`. The `.mcp.json` file makes it reproducible for any machine that clones the repo.

**Important distinction:** Claude Code launches its OWN instance of the sidecar for its agent session (via `.mcp.json`). The Tauri app ALSO launches a sidecar instance for UI health check purposes. These are TWO separate processes pointing at the same read-only SQLite file — which is safe in WAL mode. Both are read-only readers; only Rust's `write_contract` command writes SQLite.

### Anti-Patterns to Avoid

- **`console.log()` in the MCP sidecar:** Corrupts JSON-RPC framing on stdout. Use `process.stderr.write()` or `console.error()`. One `console.log` in the wrong place silently breaks all MCP communication.
- **Writing SQLite from the MCP sidecar:** `update_contract` writes `.md` files only. If the sidecar ever opens `new Database(path, {})` (without `readonly: true`), it can corrupt the WAL file by being a second writer. Enforce this with the `readonly: true` option — it throws on any write attempt.
- **Passing `AppHandle` before plugins are initialized:** `launch_mcp_sidecar()` calls `app.shell()` via `ShellExt` — the shell plugin must be registered before `setup()` runs. This is already the case in Phase 1/2 `lib.rs` but the order matters if you reorder plugin registration.
- **Dropping the `child` handle:** If `child` is dropped (goes out of scope), Tauri kills the process. Store it in `Tauri::managed` state. Do NOT store it in a local variable in `setup()`.
- **Using `shell:allow-execute` without sidecar flag:** The generic `shell:allow-execute` permission does NOT cover sidecar binaries. You need `{ "identifier": "shell:allow-execute", "allow": [{ "name": "binaries/mcp-server", "sidecar": true }] }`.
- **Running the sidecar binary path with a Node runtime externally:** The pkg-compiled binary is self-contained. Do NOT invoke it with `node mcp-server`. Just execute it directly: `./mcp-server-aarch64-apple-darwin`.
- **Hardcoding DB path in the sidecar:** The DB path is platform-specific and depends on the Tauri app identifier. Always pass it via env var from Tauri at spawn time using `app.path().app_data_dir()`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP JSON-RPC protocol framing | Custom stdio line-reader | `StdioServerTransport` from `@modelcontextprotocol/sdk` | MCP protocol has specific framing requirements (Content-Length headers, JSON-RPC 2.0 envelope); any deviation breaks client compatibility |
| Tool input validation | Manual JSON schema checks | Zod schemas passed to `server.tool()` | SDK generates MCP tool schema from Zod automatically; manual validation duplicates work and misses edge cases |
| Standalone Node.js binary with native addons | Custom pkg script from scratch | `@yao-pkg/pkg` following the official Tauri sidecar-nodejs guide | pkg handles native `.node` extraction, cross-platform target selection, and Node.js runtime embedding |
| Read-only SQLite guard | Application-level write checks | `new Database(path, { readonly: true })` | The `readonly` option opens with `SQLITE_OPEN_READONLY` at the OS level — write attempts throw even if code has bugs |
| Sidecar lifecycle management | Custom process manager | `tauri_plugin_shell::process::CommandEvent` rx loop | The rx channel delivers Stdout/Stderr/Terminated events; just match on them |

**Key insight:** The MCP SDK and `@yao-pkg/pkg` together abstract away all protocol and packaging complexity. The novel work is the four tool implementations and the Tauri sidecar wiring — not the transport or binary format.

---

## Common Pitfalls

### Pitfall 1: `console.log()` Corrupts MCP stdout

**What goes wrong:** Any `console.log()` in the sidecar process writes to stdout, which the MCP client (Claude Code) reads as a JSON-RPC response. Non-JSON bytes break the framing — the client silently drops the message or throws a parse error, making tools appear to hang or return empty results.
**Why it happens:** TypeScript developers default to `console.log()` for debugging.
**How to avoid:** Add a `tsconfig.json` that enables `noImplicitAny` and establish the pattern of `process.stderr.write('[mcp] ...\n')` from the start. Never use `console.log` in any file in `mcp-sidecar/`.
**Warning signs:** Claude Code calls a tool and gets no response; the sidecar process doesn't crash but calls timeout.

### Pitfall 2: `better-sqlite3` Native Addon ABI Mismatch

**What goes wrong:** `better-sqlite3` prebuilt binaries are tied to a specific Node.js version and CPU architecture. If `@yao-pkg/pkg` compiles with a different Node version than the prebuilt binary, the extraction succeeds but the `.node` file fails to load at runtime (`Error: The module was compiled against a different Node.js version`).
**Why it happens:** pkg ships its own Node.js runtime; the version must match the `better-sqlite3` prebuilt binary version. `better-sqlite3@12.x` ships prebuilt binaries for Node 20, 22, and 24.
**How to avoid:** Pin the pkg target to `node20` (or whichever version has a prebuilt binary for the current platform). Use `@yao-pkg/pkg dist/index.cjs --output dist/mcp-server --targets node20-macos-arm64` on Apple Silicon. Verify with `./mcp-server-aarch64-apple-darwin --version` before trusting the build.
**Warning signs:** Sidecar launches and immediately crashes; Tauri emits `mcp:status` `stopped` event immediately after `running`.

### Pitfall 3: Sidecar Child Handle Dropped

**What goes wrong:** The `CommandChild` returned by `.spawn()` is dropped when the `setup()` closure returns. Tauri kills the child process when its handle is dropped.
**Why it happens:** Rust's ownership semantics — if `child` is not moved into managed state, it goes out of scope at the end of `setup()`.
**How to avoid:** Wrap the child in `Tauri::managed` state: `app.manage(McpSidecarHandle(Mutex::new(Some(child))))` — and make sure `McpSidecarHandle` is registered in `.manage()` BEFORE `setup()` runs (Tauri managed state must be declared before the app runs).
**Warning signs:** The sidecar starts (you see the stderr "ready" line) but disappears within milliseconds.

### Pitfall 4: Shell Capability Missing `sidecar: true`

**What goes wrong:** Tauri refuses to spawn the sidecar with "not allowed" error even though `shell:allow-execute` is present.
**Why it happens:** The capability permission for sidecar binaries requires the `sidecar: true` flag in the `allow` list entry. Generic `shell:allow-execute` covers regular shell commands, not sidecar binaries.
**How to avoid:** Use `{ "identifier": "shell:allow-execute", "allow": [{ "name": "binaries/mcp-server", "sidecar": true }] }` in `capabilities/default.json`.
**Warning signs:** Rust panics at `app.shell().sidecar("mcp-server").expect(...)` with a capability error; or `.spawn()` returns an error variant.

### Pitfall 5: DB Path Mismatch Between Tauri and Sidecar

**What goes wrong:** The MCP sidecar opens a `better-sqlite3` connection to a different DB file than the one Tauri is actively writing to, so tools return stale or empty data.
**Why it happens:** The DB path is platform-specific and depends on the Tauri app identifier (`com.contract-ide.app`). Hardcoding it, or using a default that doesn't match the live app, causes the mismatch.
**How to avoid:** In the Rust `launch_mcp_sidecar()`, use `app.path().app_data_dir()` to get the authoritative path and pass it as `CONTRACT_IDE_DB_PATH` env var when spawning. Verify the path matches `sqlite:contract-ide.db` in the preload config.
**Warning signs:** `get_contract` returns empty; `list_drifted_nodes` returns 0 even when known drifted nodes exist.

### Pitfall 6: WAL Reader Blocking Checkpoint

**What goes wrong:** A long-running `better-sqlite3` query (e.g., a slow FTS5 search) holds a read transaction open. Meanwhile, Rust's watcher keeps writing to the WAL file. Eventually the WAL file grows and SQLite needs to run a checkpoint — which requires exclusive access. If the reader holds its transaction too long, the checkpoint is blocked, WAL grows unbounded, and write performance degrades.
**Why it happens:** better-sqlite3 keeps transactions open by default for prepared statements.
**How to avoid:** All four tools should complete their SQL queries synchronously and promptly. Do not hold open transactions across async boundaries. The tools are synchronous (better-sqlite3 is sync-only), so this is naturally avoided. Do NOT add `begin transaction` / `commit` wrappers unless necessary.
**Warning signs:** WAL file (`contract-ide.db-wal`) grows continuously and never shrinks.

### Pitfall 7: `update_contract` Writes to Wrong Path When Repo Changes

**What goes wrong:** User opens repo A, then opens repo B. The MCP sidecar was spawned with `CONTRACT_IDE_REPO_PATH` pointing to repo A. Claude Code calls `update_contract` — it writes to repo A's `.contracts/` directory.
**Why it happens:** The sidecar process is launched once at startup with the initial repo path; it doesn't know when the user picks a different repo.
**How to avoid:** Three options: (a) restart the sidecar on repo switch (cleanest but adds latency), (b) expose a management tool `set_repo_path` that updates an in-memory variable in the sidecar process, (c) always resolve the repo path from a shared file (e.g., a small JSON file that `open_repo` updates) rather than env var. For Phase 5 (Phase 4 not yet complete), only option (a) or (b) is needed — Phase 8 is when agent writes actually flow through `update_contract`.
**Warning signs:** Contract updates appear in the wrong repo's `.contracts/` directory.

---

## Code Examples

Verified patterns from official sources:

### Tool Registration — find_by_intent (FTS5)

```typescript
// mcp-sidecar/src/tools/find_by_intent.ts
import { getDb } from '../db.js';

export function findByIntent(query: string, limit: number = 10) {
  const db = getDb();
  
  // FTS5 MATCH query — nodes_fts created in Phase 1 migration v1
  // Columns indexed: uuid, level, name, contract_body (DATA-06)
  const rows = db.prepare(`
    SELECT n.uuid, n.name, n.level, n.kind, n.contract_body,
           snippet(nodes_fts, 4, '**', '**', '...', 20) AS snippet
    FROM nodes_fts
    JOIN nodes n ON n.uuid = nodes_fts.uuid
    WHERE nodes_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(query, limit);

  if (rows.length === 0) {
    return { content: [{ type: 'text' as const, text: 'No contracts found matching: ' + query }] };
  }

  const text = rows.map((r: any) =>
    `UUID: ${r.uuid}\nName: ${r.name} (${r.level} ${r.kind})\n${r.snippet}`
  ).join('\n---\n');

  return { content: [{ type: 'text' as const, text }] };
}
```

### McpServer Tool API — Correct Import Paths (v1.x)

```typescript
// Source: @modelcontextprotocol/sdk v1.x package
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
// Note the .js extension — required for ESM-style imports even in CJS
```

### Tauri `shell:allow-execute` for Sidecar (Verified Pattern)

```json
// src-tauri/capabilities/default.json — exact format required
{
  "identifier": "shell:allow-execute",
  "allow": [{ "name": "binaries/mcp-server", "sidecar": true }]
}
```

### Sidecar Binary Build + Rename (Complete Script)

```javascript
// mcp-sidecar/scripts/build.js
import { execSync } from 'child_process';
import { mkdirSync, copyFileSync, chmodSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const root = join(__dirname, '..');
const binDir = join(__dirname, '../../src-tauri/binaries');
const ext = process.platform === 'win32' ? '.exe' : '';

// 1. Bundle
execSync('npx esbuild src/index.ts --bundle --platform=node --format=cjs --outfile=dist/index.cjs --external:better-sqlite3', { cwd: root, stdio: 'inherit' });
// Note --external:better-sqlite3 is REQUIRED — pkg handles native addons; esbuild cannot

// 2. pkg compile (node20 for prebuilt better-sqlite3 compatibility)
execSync(`npx @yao-pkg/pkg dist/index.cjs --output dist/mcp-server --targets node20`, { cwd: root, stdio: 'inherit' });

// 3. Rename with target triple
const triple = execSync('rustc --print host-tuple').toString().trim();
mkdirSync(binDir, { recursive: true });
copyFileSync(join(root, `dist/mcp-server${ext}`), join(binDir, `mcp-server-${triple}${ext}`));
chmodSync(join(binDir, `mcp-server-${triple}${ext}`), 0o755);

console.log(`Binary: src-tauri/binaries/mcp-server-${triple}`);
```

**CRITICAL:** Pass `--external:better-sqlite3` to esbuild. esbuild cannot handle native `.node` files — they must be left as external and let pkg handle them. pkg then discovers the `.node` file in `node_modules/better-sqlite3/` and packages it as an asset that gets extracted to a temp directory at runtime.

### UI Health Check — Frontend Listener

```typescript
// src/ipc/mcp.ts
import { listen } from '@tauri-apps/api/event';

export type McpStatus = 'unknown' | 'running' | 'stopped';

export async function subscribeMcpStatus(onChange: (status: McpStatus) => void) {
  const unlisten = await listen<{ status: string }>('mcp:status', (event) => {
    onChange(event.payload.status as McpStatus);
  });
  return unlisten;
}
```

```typescript
// In a React component (e.g., StatusBar):
useEffect(() => {
  let unlisten: (() => void) | undefined;
  subscribeMcpStatus((s) => setMcpStatus(s)).then(u => { unlisten = u; });
  return () => { unlisten?.(); };
}, []);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Low-level `Server` + `setRequestHandler` (MCP SDK) | High-level `McpServer` with `server.tool()` | SDK v0.6+ / v1.x | Much simpler; Zod schema is passed directly; no manual request handler routing |
| MCP SDK v2 (pre-alpha) | MCP SDK v1.x for production | Q1 2026 (v2 not stable yet) | STATE.md flags v2 as blocker concern; stay on v1.x until stable |
| Original `pkg` (archived) | `@yao-pkg/pkg` (active fork) | 2023 | Original pkg is archived; yao-pkg is the maintained fork; same API, same `--targets` syntax |
| `bun build --compile` | `@yao-pkg/pkg` for native addon projects | N/A | bun cannot load `better-sqlite3` at runtime; don't mix runtimes |

**Deprecated/outdated:**
- Original `pkg` npm package (not `@yao-pkg/pkg`): archived and unmaintained. Always use `@yao-pkg/pkg`.
- `Server` + `setRequestHandler` pattern: still works in v1.x but is the low-level API; `McpServer.tool()` is the recommended high-level approach.

---

## Open Questions

1. **`update_contract` repo path when user switches repos**
   - What we know: Sidecar spawned once at startup with initial `CONTRACT_IDE_REPO_PATH`; Phase 5 success criterion #4 says "sidecar wiring held out of main agent loop until Phase 4 ships inspector" — so `update_contract` doesn't need to handle repo switching for Phase 5 itself
   - What's unclear: Whether Phase 5 should pre-wire the repo-path update mechanism or defer to Phase 8
   - Recommendation: Phase 5 — pass initial repo path at spawn time; add `// TODO Phase 8: update CONTRACT_IDE_REPO_PATH on open_repo` comment; Phase 8 agent loop will need to address this

2. **Two sidecar instances (Tauri-launched vs Claude Code-launched) sharing WAL**
   - What we know: WAL mode allows unlimited concurrent readers; `readonly: true` prevents both instances from writing; Rust's `write_contract` is the only writer
   - What's unclear: Whether two separate `better-sqlite3` read-only connections reading simultaneously cause any observable issues (WAL checkpoint, lock contention)
   - Recommendation: This is safe by SQLite WAL design — unlimited read-only readers never block each other. Document as verified behavior; no mitigation needed.

3. **MCP SDK v2 migration cost**
   - What we know: v2 is pre-alpha in Q1 2026; STATE.md already flags this as a concern; import path changes (`@modelcontextprotocol/server` vs `@modelcontextprotocol/sdk/server/mcp.js`) observed in different sources
   - What's unclear: Exact API surface differences between v1.x and v2
   - Recommendation: Build on v1.x import paths (`@modelcontextprotocol/sdk/server/mcp.js`). Isolate SDK imports in `src/index.ts` only — migration would be a single-file change if v2 ships during build week.

4. **pkg target for Node 22 vs Node 20 and better-sqlite3 prebuilts**
   - What we know: `better-sqlite3@12.x` ships prebuilts for Node 20, 22, 24; `@yao-pkg/pkg` supports these targets
   - What's unclear: Which Node version the dev machine's `@yao-pkg/pkg` will default to; whether ARM64 prebuilts are consistently available
   - Recommendation: Explicitly pass `--targets node20-macos-arm64` (or `-arm64` suffix) in the build script. Test the built binary with `./mcp-server-aarch64-apple-darwin` before trusting it. If it crashes immediately, the ABI mismatch is the culprit — try `node22`.

---

## Phase 5 Plan Sequencing Recommendation

Based on the research, the natural plan split is:

**Plan 05-01 (Foundation):** MCP sidecar project scaffold (`mcp-sidecar/`) — TypeScript setup, `better-sqlite3` connection module, DB path env var pattern, read-only connection verified, stub tools returning hardcoded text, esbuild + pkg build pipeline verified, binary placed in `src-tauri/binaries/` with correct target triple, `tauri.conf.json` `externalBin` configured, shell capability updated, Rust `launch_mcp_sidecar()` spawns and receives "ready" stderr event, frontend `mcp:status` listener shows "running" in UI.

**Plan 05-02 (Tool Implementation + Claude Code Integration):** Implement all four real tools against live SQLite (`find_by_intent` FTS5, `get_contract`, `list_drifted_nodes`, `update_contract` file write), create `.mcp.json` for Claude Code discovery, human-verify end-to-end: Claude Code session calls all four tools and gets correct responses against a real repo's `.contracts/` data.

---

## Sources

### Primary (HIGH confidence)

- `https://v2.tauri.app/develop/sidecar/` — externalBin config, target triple naming, Rust spawn code with `CommandEvent` rx loop, `child.write()` for stdin, shell capability format with `sidecar: true`
- `https://v2.tauri.app/learn/sidecar-nodejs/` — `@yao-pkg/pkg` workflow, rename script with `rustc --print host-tuple`, binary placement, full pipeline for Node.js sidecar
- `https://v2.tauri.app/reference/javascript/shell/` — `Child.write()` API, `CommandEvents` types (close/error), `OutputEvents` (data from stdout/stderr), `spawn()` returns `Promise<Child>`
- `https://github.com/modelcontextprotocol/typescript-sdk` — SDK v1.x confirmed; `McpServer` + `StdioServerTransport`; `server.tool()` API with Zod; import paths `/server/mcp.js` + `/server/stdio.js`; `process.stderr.write` logging requirement
- `https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md` — `new Database(path, { readonly: true })` option confirmed; `fileMustExist: true` option

### Secondary (MEDIUM confidence)

- `https://scottspence.com/posts/configuring-mcp-tools-in-claude-code` — `.mcp.json` project-scope format; `type: "stdio"`, `command`, `args`, `env` fields; project-level file read automatically by Claude Code
- WebSearch findings on `@yao-pkg/pkg` + native addons — pkg packages `.node` files as assets extracted to cache; `--external:better-sqlite3` needed in esbuild step; `node20` target for better-sqlite3 prebuilt compatibility
- WebSearch findings on WAL concurrent readers — unlimited readers safe; `readonly: true` at DB open level; checkpoint only blocked by long-running readers (mitigated by synchronous query completion)

### Tertiary (LOW confidence — validate before implementing)

- Import path format for `@modelcontextprotocol/sdk` v1.x vs v2: one source showed `@modelcontextprotocol/server` (v2 package) vs `@modelcontextprotocol/sdk/server/mcp.js` (v1). Verify `npm show @modelcontextprotocol/sdk version` to confirm which version is current stable before installing.
- `--external:better-sqlite3` in esbuild step: standard practice for native addons with esbuild; not officially documented in the Tauri sidecar guide but consistent with esbuild's documented limitations on native modules.

---

## Metadata

**Confidence breakdown:**
- Tauri sidecar mechanics (externalBin, spawn, capability): HIGH — verified from official v2 docs
- MCP SDK tool registration API (McpServer, StdioServerTransport): HIGH — verified from SDK repo docs
- Build pipeline (esbuild + pkg): MEDIUM — pattern documented by Tauri; native addon handling via pkg is established but version-specific ABI matching needs build-time verification
- better-sqlite3 `readonly: true` option: HIGH — confirmed from official API docs
- Claude Code `.mcp.json` discovery: MEDIUM — confirmed from community sources; official docs page was partially rendered React

**Research date:** 2026-04-24
**Valid until:** 2026-05-22 (30 days — MCP SDK v2 could ship sooner; re-check npm before Phase 5 execution)
**Critical validation before Phase 5 plan execution:** Run `npm show @modelcontextprotocol/sdk version` to confirm v1.x is still the production version; run the build pipeline end-to-end on the dev machine (`node20-macos-arm64` pkg target) and execute the binary before wiring the Tauri sidecar launch.
