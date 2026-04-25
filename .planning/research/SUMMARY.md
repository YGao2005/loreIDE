# Research Summary: Contract IDE

**Date:** 2026-04-24
**Scope:** Agent-native macOS IDE with semantic contract graph — Tauri 2 + React + TypeScript frontend, Rust backend, TypeScript MCP sidecar, Claude Code CLI integration
**Confidence:** HIGH

---

## Executive Summary

Contract IDE is an agent-native macOS desktop application where a semantic **contract graph** replaces the file tree as the primary navigation surface. Tauri 2 (Rust backend + WKWebView frontend) is the right chassis because it uniquely combines native macOS feel with the web ecosystem — react-flow, Monaco, shadcn/ui — needed to build the graph canvas and code editor within a one-week hackathon.

The architecture is a three-process system:
- **React/TypeScript frontend** in WKWebView
- **Rust backend** — sole SQLite writer, owns filesystem, spawns `claude` CLI subprocess
- **TypeScript MCP sidecar** — read-only SQLite client, exposes `find_by_intent` / `get_contract` / `list_drifted_nodes` / `update_contract` to external Claude Code sessions

Canonical source of truth is `.contracts/<uuid>.md` sidecar files with YAML frontmatter. SQLite is a derived cache rebuilt on startup and kept fresh by the `notify` file watcher. The single-writer rule (only Rust writes SQLite; MCP sidecar writes sidecar `.md` files which Rust picks up via watcher) eliminates dual-source-of-truth bugs.

Build must follow strict dependency order — every phase unblocks the next. The three demo beats (cherrypick, mass edit, non-coder copy edit, each ending on a receipt comparison) are the north star for every scope decision.

---

## Key Findings

### Stack (HIGH confidence)

- **Tauri 2.10.3** — current stable; plugin versions must track core minor (`tauri-plugin-shell` 2.3.5, `tauri-plugin-sql` 2.3.2).
- **`@xyflow/react` 12.10.2** — react-flow was renamed; installing old `reactflow` gets buggy v11.
- **Monaco 0.55.1** — requires `vite-plugin-monaco-editor` and `blob:` CSP exception, or workers silently fail in WKWebView. Single highest-risk integration seam.
- **Do not add `#[tokio::main]`** — Tauri provides the async runtime; shadowing it causes silent task deadlock (GitHub #13330). Use `tauri::async_runtime::spawn()`.
- **MCP SDK** uses `StdioServerTransport`; sidecar binary built with `pkg`, named `mcp-server-<target-triple>`, placed in `src-tauri/binaries/`.
- **`notify` 8.2.0 for file watching** — do not upgrade to v9 during build week.
- **`better-sqlite3` readonly** in the MCP sidecar — SQLite WAL mode makes Rust writes visible immediately; no cache invalidation mechanism needed.

### Features (HIGH/MEDIUM confidence)

**Table stakes** (users expect these from any modern IDE):
Command palette, keyboard-first nav, autosave, undo/redo, theming, settings, error/empty states, git integration surfacing, onboarding, search.

**Differentiators** (the contract-graph moat — the demo depends on these):
Zoomable five-level graph, canonical+reference model, inspector, receipts + side-by-side pinning, drift detection, lens switcher, cherrypick flow, mass semantic edit, non-coder L4 atom mode, live localhost preview.

**Anti-features** (deliberately not built):
File tree in primary UI, cloud sync, multi-provider abstraction, code scaffolding, authoritative contracts (v1 is derived), skills-based Claude Code integration.

**Demo beats → required features:**
- Beat 1 (cherrypick): graph + inspector + contract edit + agent run + receipt
- Beat 2 (mass edit): selection + batch diff + approve-all + receipt
- Beat 3 (non-coder): L4 atom filtering + non-code inspector view + live preview + receipt

### Architecture (HIGH confidence)

- **Five data flows fully specified:** contract derivation, drift detection, cherrypick, mass edit, receipt generation.
- **Node identity:** UUIDs in sidecar frontmatter are canonical; filename/path is metadata. Renames/moves don't break the graph.
- **Canonical + reference:** shared nodes have one sidecar file (`is_canonical=1`); ghost references are SQLite-only rows with `canonical_uuid` FK, regenerated from `node_flows` membership on rebuild.
- **Atomic approve without transactions:** Claude Code writes source file before the hook fires; "Approve" writes sidecar via write-to-temp + `fs::rename` (atomic on APFS). If sidecar write fails, drift detection flags the node — deterministic recovery.
- **Derivation cost manageable:** batch by file (not export), lazy (only visible zoom level), hash-skip (no re-derive if `code_hash` unchanged). `vercel/commerce` demo = ~15–25 LLM calls total.

### Pitfalls (HIGH/MEDIUM confidence)

**Top demo killers, all must be prevented in Phase 1–2:**
1. **Generic contract text** — auto-derived "this is a React component" makes the graph a renamed file tree. Demo repo's 25 nodes must be hand-written; no auto-derivation accepted without review.
2. **Monaco workers fail in WKWebView** — fix with `vite-plugin-monaco-editor` + `blob:` CSP at scaffold time.
3. **`#[tokio::main]` silent deadlock** — 3-character fix if caught on day 1; hours to debug if not.
4. **react-flow stutter past ~500 nodes** — set `onlyRenderVisibleElements` at scaffolding; one-line fix now, painful optimization later.
5. **JSONL parse failure** — schema is community-documented only; parser must be defensive + have a mock fallback. Every demo beat ends on a receipt card; a parse failure kills all three.
6. **Demo repo seeding scope creep** — `vercel/commerce` has ~400 L3 components. Hard 25-node budget + 4-hour timebox before seeding begins.

---

## Roadmap Implications

**Suggested phases: 9**

1. **Foundation — Tauri shell + SQLite schema + native macOS chrome**
   SQLite backbones 7+ features; native chrome (traffic lights, vibrancy, SF Pro) retrofits badly.
2. **Contract file format + scanner**
   Canonical source of truth and UUID-dup detection before graph builds on top.
3. **Graph canvas (five zoom levels, canonical + ghost rendering)**
   Virtualization (`onlyRenderVisibleElements`, `React.memo`) baked in at scaffold.
4. **Inspector panel + Monaco**
   WKWebView worker mitigation validated before editing UI layered on top.
5. **MCP server sidecar (+ build pipeline)**
   Claude Code needs this for every agent run; prove sidecar launch before tool logic.
6. **Contract derivation pipeline**
   Establishes `code_hash` baselines drift detection needs. JSONL parser built here as isolated module.
7. **Drift detection + PostToolUse hook**
   Both paths (hook for agent writes + `notify` for manual edits). Depends on Phase 6 hashes.
8. **Agent loop + receipt generation + cherrypick flow**
   First end-to-end integration (Beat 1). Atomic approve = single Rust command.
9. **Mass edit + non-coder mode + demo polish + seeding**
   Mass edit reuses Phase 8 primitives. Demo repo seeding with hard 25-node budget.

**Parallelization opportunities:**
- Phase 3 (graph canvas) and Phase 5 (MCP server) can run in parallel after Phase 2.
- Demo repo seeding can start during Phase 3 (manual content work, not code-blocked).

**Critical path:** Phase 1 → 2 → 3 → 4 → 6 → 7 → 8. Phases 5 and 9 ride alongside.

---

## Research Flags

**Needs validation during phase planning:**
- Phase 8 — JSONL schema validated against real session file before committing parse logic (MEDIUM confidence on field names).
- Phase 5 — MCP SDK v2 anticipated Q2 2026; assess migration cost if it ships during build week.
- Phase 7 — Official PostToolUse hook output schema has documented inconsistency; confirm exit-0/no-stdout approach still current.
- Phase 9 — Non-coder copy-edit UX claim: test with one non-technical person before demo scripting (LOW confidence).

**Standard patterns (skip research-phase, plan directly):**
- Phase 1 (App shell), Phase 3 (Graph canvas), Phase 4 (Inspector + Monaco), Phase 9 (Mass edit/polish).

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions verified via official release pages; integration seams via GitHub issues |
| Features — table stakes | HIGH | Competitor analysis from Cursor/Zed/Sourcegraph/Figma/Raycast |
| Features — differentiators | MEDIUM | Novel category; no direct comparable product |
| Architecture | HIGH | SQLite WAL semantics, MCP StdioServerTransport, notify — all verified |
| Pitfalls — platform | HIGH | Tauri/WKWebView failures are open GitHub issues |
| Pitfalls — JSONL schema | MEDIUM | Single community source; no official Anthropic schema doc |

---

## Open Questions

- Exact token-field names in Claude Code session JSONL — validate with a real session before Phase 8.
- `claude` CLI `-p` flag behavior in current CLI version — validate before Rust `run_agent` wiring.
- Live preview iframe CSP on macOS Sequoia+ — test on demo machine after Phase 4.
- Token delta benchmarking — run terminal Claude Code baseline **before** seeding contracts so the baseline is genuinely context-free.
- Whether PostToolUse hook calls a Tauri IPC endpoint directly vs. writes a flag file the Rust watcher picks up — decide before Phase 7.

---
*Research synthesized: 2026-04-24 from STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md*
