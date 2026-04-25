# Stack Research

**Domain:** Agent-native desktop IDE — semantic contract graph over Tauri 2 + React
**Researched:** 2026-04-24
**Confidence:** HIGH (core stack verified via official docs and multiple sources; integration seam warnings verified via official Tauri issues and community reports)

---

## Recommended Stack

### Core Technologies (Locked — Version-Pinned)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Tauri | **2.10.3** | Desktop shell, Rust backend, IPC, bundling | Latest stable as of 2026-03-04. Owns the process model, file system, subprocess spawn. |
| React | **19.2.5** | UI framework | Latest stable. shadcn/ui, @xyflow/react 12 and react-resizable-panels 4 all require React 19 for correct peer dep resolution. |
| TypeScript | **6.0.x** | Type safety across frontend + MCP server | Current stable on npm. Use strict mode; Tauri IPC serde roundtrip will surface type errors immediately. |
| Vite | **8.0.x** | Frontend build/dev server | Official Tauri-recommended bundler. v8 is current stable; Tauri's create-project template ships it. |
| Tailwind CSS | **v4.x** | Styling | shadcn/ui CLI now generates v4-compatible components by default; `tailwind.config.js` replaced by CSS-first `@theme` in CSS file. |
| shadcn/ui | **CLI v4 (April 2026)** | Component library | CLI generates React 19 + Tailwind v4 components. Uses unified `radix-ui` package (not individual `@radix-ui/react-*`). Run `npx shadcn@latest init`. |
| @xyflow/react | **12.10.2** | Graph canvas | Package renamed from `reactflow` to `@xyflow/react` in v12. Current stable. Works with shadcn/ui and Tailwind v4. |
| Monaco Editor | **0.55.1** (stable) / **0.56.0-dev** | Code view + diff viewer | `@monaco-editor/react` 4.7.0 is the React wrapper. Built-in `DiffEditor` component handles the approve-both-diffs UX. |

### Frontend Supporting Libraries

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `zustand` | **5.0.12** | Global state (graph nodes, selected node, chat messages, receipts) | Centralized store with middleware. v5 drops React 18 dependency on use-sync-external-store; native React 19 `useSyncExternalStore`. Simpler than Jotai for cross-panel shared state. Does NOT use Context so no WKWebView-specific React Context provider bugs. |
| `@xyflow/react` | **12.10.2** | Graph canvas (react-flow v12) | Five-level zoomable graph, custom node types for Contract/Ghost nodes, onlyRenderVisibleElements for performance. |
| `@dagrejs/dagre` | **3.0.0** | Auto-layout for graph initial positioning | Actively maintained fork (`@dagrejs/dagre`, not the stale `dagre@0.8.5`). Directed graph layout: compact, fast, minimal config. Use for startup layout; user can then drag. |
| `elkjs` | **0.11.1** | Advanced layout (optional, stretch) | More configurable than dagre; use if hierarchy-collapse UX needs proper sub-graph layout. Heavier (Java port). Skip for week-1 unless dagre produces unusable layouts. |
| `react-resizable-panels` | **4.10.0** | IDE panel layout (graph canvas / inspector / chat) | bvaughn's library; shadcn/ui ships a `Resizable` component built on it. Version 4 supports pixel + percentage + rem sizing. |
| `react-markdown` | **10.1.0** | Render contract `.md` bodies in inspector panel | v10 is current stable (not v9). Remark/rehype ecosystem; use with `remark-gfm` for GitHub Markdown. |
| `@monaco-editor/react` | **4.7.0** | React wrapper for Monaco | Handles Worker creation via `loader` utility; critical for WKWebView worker issue (see integration seams). |
| `gray-matter` | **4.0.3** | Parse/write YAML frontmatter in `.contracts/*.md` | Industry standard (Gatsby, Astro, Vitepress, Shopify). Regex-free parser; handles nested YAML and fenced code blocks correctly. TypeScript-compatible. |
| `ignore` | **7.0.5** | `.gitignore` rule filtering when scanning repos | Used by ESLint, Prettier. Follows gitignore spec 2.22.1 exactly. Use when building the contract scanner so it respects the target repo's `.gitignore`. |
| `@modelcontextprotocol/sdk` | **1.29.0** | TypeScript MCP server (find_by_intent, get_contract, etc.) | Official Anthropic SDK. Use `StdioServerTransport` — the MCP server is spawned as a sidecar child process; stdio is correct for local tools. |
| `uuid` | **^11** | Generate stable UUIDs for new contract nodes | Trivial dep; v4 random UUID from `crypto.randomUUID()` preferred but `uuid` package needed for browser polyfill environments. |
| `date-fns` | **^4** | Format timestamps in receipt cards | Lightweight, tree-shakeable, no locale download needed for basic formatting. |

### MCP Server (Separate TypeScript Process — Sidecar)

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `@modelcontextprotocol/sdk` | **1.29.0** | MCP server framework | Official SDK. `StdioServerTransport` for local process spawn. Implements `find_by_intent`, `get_contract`, `list_drifted_nodes`, `update_contract`. |
| `better-sqlite3` | **^11** | SQLite queries from MCP server | Synchronous SQLite for Node.js; correct for stdio-serialized MCP request handling (no async hell, no connection pool needed). |
| `gray-matter` | **4.0.3** | Parse/write contracts from MCP server | Shared with frontend; keeps frontmatter parsing identical across both processes. |
| `zod` | **^3** | Runtime validation of MCP tool inputs | MCP SDK supports Zod schemas directly for tool input validation. |

### Rust Backend (src-tauri)

| Crate | Version | Purpose | Why |
|-------|---------|---------|-----|
| `tauri` | **2.10.3** | App runtime + IPC commands | Core. Use `tauri::async_runtime::spawn()` for background tasks — do NOT add `#[tokio::main]` to main.rs; Tauri owns the Tokio runtime. |
| `tauri-plugin-shell` | **2.3.5** | Spawn `claude` CLI subprocess + MCP sidecar | Shell plugin required for `Command::sidecar()` and `Command::new("claude")`. Streaming stdout via `CommandChild::stdout`. |
| `tauri-plugin-fs` | **2.x** | Filesystem access (scan `.contracts/` dirs) | Official plugin; use for reads from Rust side. JS side can use `@tauri-apps/plugin-fs` directly. |
| `tauri-plugin-sql` | **2.3.2** | SQLite cache (derived contracts, drift state, receipts) | Official plugin backed by sqlx with `sqlite` feature. Manages migrations. Exposes DB to both Rust commands and frontend JS via `@tauri-apps/plugin-sql`. |
| `notify` | **8.2.0** | File system watching for `.contracts/` changes | Cross-platform; macOS uses FSEvents. v9 RC exists but 8.2.0 is latest stable. MSRV 1.88. |
| `serde` + `serde_json` | **1.x** | Serialize/deserialize IPC payloads and JSONL lines | Required by all Tauri commands; all command params need `Deserialize`, return types need `Serialize`. |
| `tokio` | **1.x** (Tauri-managed) | Async runtime | Do not declare separately; Tauri pulls it in. Use `tauri::async_runtime::spawn` to run background futures. |
| `window-vibrancy` | **0.7.1** | macOS NSVisualEffectView sidebar effect | `apply_vibrancy(&window, NSVisualEffectMaterial::Sidebar, ...)` for the native translucent panel feel. Requires transparent window. |
| `anyhow` | **^1** | Error handling in Rust commands | Ergonomic error propagation; use `anyhow::Result` in Tauri commands and convert with `.map_err(|e| e.to_string())` at the IPC boundary. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `create-tauri-app` | Scaffold Tauri + React + TS + Vite + Tailwind project | Run once: `npm create tauri-app@latest`. Pick React + TypeScript template. |
| `pkg` (yao-pkg fork) | Compile MCP TypeScript server to binary for sidecar | Official Tauri sidecar-nodejs guide recommends it. Output binary to `src-tauri/binaries/mcp-server-<target-triple>`. Alternative: `esbuild` + `node` bundled via Tauri's Node.js sidecar pattern, but `pkg` produces a self-contained binary. |
| `vite-plugin-monaco-editor` | Bundle Monaco workers correctly in Vite | Required to avoid the WKWebView web worker creation failure (see integration seams). Registers worker URLs so Monaco can import them as blob URLs. |
| `@tauri-apps/cli` | Build + dev commands | `cargo tauri dev`, `cargo tauri build`. |
| `rust-analyzer` | Rust IDE support in VS Code / Claude Code | Background type checking for Rust; critical for Tauri command type errors. |

---

## Installation

```bash
# Bootstrap project
npm create tauri-app@latest contract-ide -- --template react-ts
cd contract-ide

# Frontend core
npm install @xyflow/react zustand react-resizable-panels
npm install react-markdown remark-gfm
npm install gray-matter uuid date-fns
npm install ignore @dagrejs/dagre

# Monaco
npm install @monaco-editor/react monaco-editor
npm install -D vite-plugin-monaco-editor

# shadcn/ui (run after Tailwind v4 init)
npx shadcn@latest init
# Then add components:
npx shadcn@latest add button card dialog separator resizable scroll-area

# MCP server (in /mcp-server subdirectory)
npm install @modelcontextprotocol/sdk better-sqlite3 gray-matter zod
npm install -D @types/better-sqlite3 typescript pkg

# Dev tools
npm install -D @types/uuid
```

```toml
# src-tauri/Cargo.toml additions
[dependencies]
tauri = { version = "2", features = ["unstable"] }
tauri-plugin-shell = "2"
tauri-plugin-fs = "2"
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
notify = "8"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
anyhow = "1"
window-vibrancy = "0.7"
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| State mgmt | Zustand 5 | Jotai, Redux Toolkit | Jotai is better for fine-grained atom reactivity but adds complexity; Redux is overkill; Zustand's flat store model maps well to graph selection + chat state. |
| State mgmt | Zustand 5 | Valtio | Valtio proxies are elegant but TypeScript ergonomics are worse for complex nested state (contract map, node selection). |
| Graph layout | @dagrejs/dagre | elkjs | ElkJS is more powerful but significantly more complex to configure; dagre is sufficient for 5-level hierarchical layout in week 1. |
| SQLite (Rust) | tauri-plugin-sql (sqlx) | rusqlite directly | tauri-plugin-sql gives a migration system and JS-side query API for free; using rusqlite directly requires writing the JS bridge. Use raw rusqlite only if you need transactions the plugin doesn't support. |
| Markdown render | react-markdown 10 | MDXEditor | MDXEditor is a full WYSIWYG; we need read-only rendering in the inspector. react-markdown is minimal and correct. |
| Markdown render | react-markdown 10 | marked | marked lacks the remark/rehype plugin ecosystem for syntax highlighting and GFM. |
| Diff view | Monaco DiffEditor (built-in) | diff2html | Monaco's built-in DiffEditor is already embedded; using it for diffs avoids a second large dep. |
| YAML frontmatter | gray-matter | js-yaml + manual split | gray-matter wraps js-yaml correctly and handles edge cases (nested objects, fenced blocks with fake frontmatter). |
| File ignore | ignore 7 | fast-glob + custom filter | `ignore` implements the gitignore spec exactly; fast-glob has its own glob semantics that diverge subtly. |
| MCP transport | StdioServerTransport | StreamableHTTPServerTransport | Stdio is correct for a locally-spawned sidecar. HTTP transport is for remote/network MCP servers. No port management, no CORS, no URL coordination needed. |
| Frontend build | Vite 8 | esbuild standalone | Vite is the Tauri-recommended toolchain and handles HMR correctly with the Tauri dev server proxy. |
| Panel layout | react-resizable-panels 4 | allotment, react-split | react-resizable-panels is shadcn/ui's official `Resizable` primitive; v4 supports pixel+% constraints needed for a sidebar with fixed min-width. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `reactflow` (old package name) | Unmaintained; v12 renamed to `@xyflow/react`. Installing old package gives v11 with known bugs. | `@xyflow/react` |
| `dagre` (npm, not `@dagrejs/dagre`) | Abandoned at 0.8.5 (6 years ago). Has known memory leaks and TypeScript types are wrong. | `@dagrejs/dagre` ^3.0.0 |
| `#[tokio::main]` in Tauri main.rs | Tauri owns and initializes the Tokio runtime; adding `#[tokio::main]` causes a conflict that silently corrupts async task scheduling (GitHub issue #13330). | Use `tauri::async_runtime::spawn()` |
| `react-monaco-editor` (the community package) | Stale; `@monaco-editor/react` (by suren-atoyan) is better maintained and handles worker loading via `loader` utility. | `@monaco-editor/react` ^4.7.0 |
| Redux Toolkit | Heavyweight for a single-window desktop app with no SSR, hydration, or time-travel debugging needs. | Zustand 5 |
| SSE (`SseServerTransport`) for MCP | Deprecated in MCP spec; replaced by Streamable HTTP for remote, and stdio for local. Claude Code docs confirm stdio is the correct transport for locally-spawned servers. | `StdioServerTransport` |
| `tauri-plugin-rusqlite2` (community fork) | Unmaintained third-party; missing migration support. | `tauri-plugin-sql` with `sqlite` feature |
| Calling `window.addEventListener` for Tauri events without cleanup | Memory leak in SPA; Tauri event listeners accumulate across React re-mounts. | Use `useEffect` cleanup + the `unlisten` function returned by `listen()` |
| Hardcoding Claude Code JSONL schema fields | The JSONL schema is undocumented and unstable. The `usage` object fields (`cache_creation`, ephemeral tier breakdowns) have changed before. | Access JSONL via `transcript_path` from the PostToolUse hook payload; parse defensively with optional chaining; log unknown top-level `type` values for forward compat. |

---

## Integration Seams — Known-Fragile Points

### 1. Monaco Editor Web Workers in WKWebView (CRITICAL)

**Problem:** Monaco uses Web Workers for language services (syntax highlighting, completions). WKWebView on macOS applies strict origin checks — creating a worker from a blob URL fails if the Tauri `csp` config is too restrictive or if `script-src` doesn't include `blob:`.

**Symptom:** "Could not create web worker(s)" in console. Monaco falls back to main-thread mode causing UI jank.

**Mitigation:**
- Install `vite-plugin-monaco-editor` — it registers worker entry points as Vite chunks, giving Monaco actual URLs instead of dynamic blob construction.
- In `tauri.conf.json`, add `"script-src": "'self' blob:"` to CSP (or if using the config API: `csp: { "script-src": ["'self'", "blob:"] }`).
- Test on macOS specifically; workers work fine in WebView2 (Windows/Chromium-based) but fail on WebKit.

**Confidence:** HIGH — documented in Tauri GitHub Discussion #9595 and Monaco FAQ.

---

### 2. Tauri IPC Type Safety Gap (MODERATE)

**Problem:** Tauri's `invoke()` returns `Promise<any>` unless you manually add TypeScript generics. There's no compile-time verification that the Rust `#[tauri::command]` signature matches the TS call site.

**Mitigation:**
- Use `TauRPC` (crates.io, v0.5.2) if type safety across the IPC boundary is critical. It generates TypeScript types from Rust command signatures at runtime.
- Alternatively, write thin typed wrapper functions around `invoke<ReturnType>()` in a `src/ipc/` module; at least type errors surface in the TS layer.
- For week-1 speed: write wrapper functions, validate manually, defer TauRPC if it slows scaffold.

**Confidence:** HIGH — Tauri docs confirm `invoke` returns `unknown`; TauRPC is official-adjacent (MatsDK).

---

### 3. MCP Server Sidecar Binary Naming and Signing (MODERATE)

**Problem:** Tauri sidecar binaries must be named `<name>-<target-triple>` and placed in `src-tauri/binaries/`. On macOS, notarization requires binaries to be signed. In dev mode, unsigned binaries work; in production bundle they do not.

**Mitigation:**
- For hackathon: use dev mode only; don't bundle for distribution. The MCP server runs fine as an unsigned sidecar in dev.
- Name the compiled binary: `mcp-server-aarch64-apple-darwin` (M1/M2/M3 Macs) or `mcp-server-x86_64-apple-darwin` (Intel). Check with `rustc -Vv | grep host`.
- In `tauri.conf.json` add `"externalBin": ["binaries/mcp-server"]` and the corresponding shell capability permission.

**Confidence:** HIGH — Tauri sidecar-nodejs official docs.

---

### 4. Claude Code JSONL Schema Stability (MODERATE-HIGH RISK)

**Problem:** The session JSONL format at `~/.claude/projects/<encoded-path>/<session-uuid>.jsonl` is undocumented and has no stability guarantee. Schema has already changed (ephemeral cache tier fields added post-launch).

**Known structure (as of 2026-02):**
- Top-level envelope: `{ type, uuid, parentUuid, timestamp, sessionId, cwd, message }`
- Message types: `user`, `assistant`, `tool_result`, `system`, `summary`, `result`, `file-history-snapshot`
- Token usage in assistant turns: `usage.input_tokens`, `usage.output_tokens`, `usage.cache_read_input_tokens`, `usage.cache_creation` (with optional ephemeral tier sub-fields)

**Mitigation:**
- Parse defensively: use `?.` optional chaining on all fields beyond the envelope.
- Log and store the raw JSONL line when a parse fails; don't crash the receipt pipeline.
- Only extract: `usage.input_tokens`, `usage.output_tokens`, total cost estimate, and the list of `tool_use` blocks (for "tool calls" count in receipt card). Everything else is bonus.
- `transcript_path` is provided in the PostToolUse hook stdin — use it directly rather than scanning `~/.claude/projects/` yourself.

**Confidence:** MEDIUM — structure documented by community analysis (Medium post Feb 2026); no official Anthropic schema doc exists.

---

### 5. PostToolUse Hook JSON Schema Docs Inconsistency (LOW-MODERATE RISK)

**Problem:** Official Claude Code hook docs have a documented inconsistency: `PreToolUse` docs deprecate root-level `decision`/`reason` keys in favor of `hookSpecificOutput`, but `PostToolUse` examples still use root-level keys. This may cause silent failures if you target the wrong output format.

**PostToolUse stdin (confirmed schema):**
```json
{
  "session_id": "...",
  "transcript_path": "/Users/.../.claude/projects/.../session.jsonl",
  "cwd": "...",
  "permission_mode": "default",
  "hook_event_name": "PostToolUse",
  "tool_name": "Write",
  "tool_input": { "file_path": "...", "content": "..." },
  "tool_response": { "filePath": "...", "success": true },
  "tool_use_id": "toolu_01..."
}
```

**Mitigation:**
- For the PostToolUse hook that re-derives contracts: the hook only needs to fire and call Tauri IPC. It does not need to return anything to block Claude Code. Keep hook output empty (exit 0, no stdout JSON needed).
- Register hook in `~/.claude/settings.json` targeting only `Write` and `Edit` tool names to limit firing frequency.

**Confidence:** MEDIUM — PostToolUse input schema confirmed from official docs fetch; output schema inconsistency documented in GitHub issue #19115.

---

### 6. Tauri Async Runtime Conflict (HIGH SEVERITY if triggered)

**Problem:** If you annotate `main.rs` with `#[tokio::main]`, Tauri will try to initialize a second Tokio runtime on top of yours, causing panics or silent deadlocks in background tasks (GitHub issue #13330, still open as of 2026).

**Mitigation:**
- Remove `#[tokio::main]` from `main.rs` entirely. Tauri handles runtime init.
- For background work: `tauri::async_runtime::spawn(async { ... })`.
- For CPU-bound work: `tauri::async_runtime::spawn_blocking(|| { ... })`.

**Confidence:** HIGH — Tauri official docs + open GitHub issue.

---

### 7. Tailwind v4 Config Migration (LOW RISK — known steps)

**Problem:** Tailwind v4 removes `tailwind.config.js`. All configuration moves to a CSS `@theme {}` block. `tailwindcss-animate` is deprecated in favor of `tw-animate-css`. The shadcn/ui CLI handles this correctly on fresh init, but if you scaffold and then manually tweak the config, it's easy to create a hybrid that breaks.

**Mitigation:**
- Let `npx shadcn@latest init` manage the Tailwind setup. Don't manually create a `tailwind.config.js`.
- Replace any `tailwindcss-animate` usage with `tw-animate-css`.
- Run `npx @tailwindcss/upgrade@next` if migrating from v3 components.

**Confidence:** HIGH — shadcn/ui changelog February 2026 + Tailwind v4 migration guide.

---

## Version Compatibility Matrix

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@xyflow/react` ^12.10 | React ^19, Tailwind v4, shadcn/ui CLI v4 | react-flow UI components explicitly updated to React 19 + TW4 in Oct 2025 |
| `react-resizable-panels` ^4 | React ^19 | v4 breaking: sizing API changed from % only to mixed units |
| `@monaco-editor/react` ^4.7 | `monaco-editor` ^0.55, React ^19 | Keep monaco-editor and wrapper in sync; mismatched versions cause "editor already disposed" errors |
| `tauri-plugin-shell` ^2.3 | `tauri` ^2.10 | Shell plugin version must track Tauri core minor; don't mix e.g. plugin 2.0 with Tauri 2.10 |
| `tauri-plugin-sql` ^2.3 | `tauri` ^2.10, `sqlx` (internal) | SQLite feature: add `features = ["sqlite"]` in Cargo.toml |
| `notify` ^8.2 | MSRV Rust 1.88 | v9 RC exists but is unstable; stay on 8.2.0 for the week |
| `@modelcontextprotocol/sdk` ^1.29 | Node.js 18+, TypeScript 5+/6 | v2 anticipated Q2 2026; 1.x receives security patches; safe to ship |
| `gray-matter` ^4 | Node.js 16+, works in both browser (via bundler) and Node | Used in both React frontend (via Vite bundle) and MCP server (Node) — identical behavior |
| Zustand ^5 | React ^19 | v5 drops React <18; native `useSyncExternalStore`, no external dep |

---

## Sources

- Tauri 2 release page: https://v2.tauri.app/release/ — version 2.10.3 confirmed
- Tauri sidecar-nodejs docs: https://v2.tauri.app/learn/sidecar-nodejs/ — pkg toolchain, binary naming, permissions
- Tauri IPC docs: https://v2.tauri.app/develop/calling-rust/ — serde requirements, invoke type safety
- Tauri Web Worker Discussion: https://github.com/orgs/tauri-apps/discussions/9595 — Monaco worker failure in WKWebView confirmed
- Tauri async runtime issue: https://github.com/tauri-apps/tauri/issues/13330 — #[tokio::main] conflict
- React Flow what's new: https://reactflow.dev/whats-new — @xyflow/react 12.10.2 confirmed
- React Flow performance: https://reactflow.dev/learn/advanced-use/performance — onlyRenderVisibleElements
- @dagrejs/dagre npm: https://www.npmjs.com/package/@dagrejs/dagre — v3.0.0 (active fork)
- shadcn/ui changelog: https://ui.shadcn.com/docs/changelog — CLI v4, Tailwind v4, React 19
- shadcn/ui Tailwind v4: https://ui.shadcn.com/docs/tailwind-v4 — migration details
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk — v1.29.0
- MCP transports: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports — stdio vs Streamable HTTP
- Claude Code hooks reference: https://code.claude.com/docs/en/hooks — PostToolUse schema confirmed
- Claude Code hook schema inconsistency: https://github.com/anthropics/claude-code/issues/19115
- Claude Code JSONL format analysis: https://databunny.medium.com/inside-claude-code-the-session-file-format-and-how-to-inspect-it-b9998e66d56b
- window-vibrancy crate: https://crates.io/crates/window-vibrancy — v0.7.1
- tauri-plugin-shell: https://docs.rs/crate/tauri-plugin-shell/latest — v2.3.5
- tauri-plugin-sql: https://docs.rs/crate/tauri-plugin-sql/latest — v2.3.2
- notify crate: https://docs.rs/crate/notify/latest — v8.2.0
- Zustand v5 announcement: https://pmnd.rs/blog/announcing-zustand-v5/
- react-resizable-panels: https://www.npmjs.com/package/react-resizable-panels — v4.10.0
- react-markdown: https://www.npmjs.com/package/react-markdown — v10.1.0
- gray-matter: https://www.npmjs.com/package/gray-matter — v4.0.3
- ignore: https://www.npmjs.com/package/ignore — v7.0.5
- Monaco editor: https://www.npmjs.com/package/monaco-editor — v0.55.1
- @monaco-editor/react: https://www.npmjs.com/package/@monaco-editor/react — v4.7.0
- Vite releases: https://vite.dev/releases — v8.0.9
- TypeScript npm: https://www.npmjs.com/package/typescript — v6.0.x current
- React npm: https://www.npmjs.com/package/react — v19.2.5 current
- rusqlite: https://crates.io/crates/rusqlite — v0.38.0 (used by tauri-plugin-sql internally)

---
*Stack research for: Contract IDE — agent-native macOS IDE with semantic contract graph*
*Researched: 2026-04-24*
