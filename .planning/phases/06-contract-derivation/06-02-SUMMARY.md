---
phase: 06-contract-derivation
plan: 02
subsystem: mcp-sidecar + frontend
tags: [derivation, mcp, pivot, claude-code-session, sidecar-tool, inspector-ui]
dependency_graph:
  requires: [02-01, 02-02, 05-01, 06-01 (hash helpers)]
  provides:
    - "MCP tool list_nodes_needing_derivation (DERIVE-01 queue)"
    - "MCP tool write_derived_contract (DERIVE-02 hash recompute + DERIVE-03 pinned guard)"
    - "Inspector copy-prompt UX (no in-app LLM call)"
  affects: [07-drift-detection (code_hash baselines now produced by MCP writer)]
tech_stack:
  added: []
  removed:
    - "reqwest 0.12 (from Rust) — Anthropic call moved to Claude Code session"
    - "chrono 0.4 (from Rust) — derived_at now set in TS via Date.toISOString"
    - "src/ipc/derive.ts (deleted) — no Tauri invoke path needed"
    - "src/store/derive.ts (deleted) — no progress stream"
  patterns:
    - "MCP-mediated derivation: IDE exposes tools, user's active Claude Code session drives the LLM call"
    - "Atomic sidecar rewrite via temp+rename in the MCP sidecar (mirrors Plan 02-02 Rust path)"
    - "`human_pinned` guard enforced tool-side, not UI-side"
key_files:
  created:
    - contract-ide/mcp-sidecar/src/tools/list_needing_derivation.ts
    - contract-ide/mcp-sidecar/src/tools/write_derived_contract.ts
  modified:
    - contract-ide/mcp-sidecar/src/index.ts
    - contract-ide/src/components/layout/Inspector.tsx
    - contract-ide/src/components/layout/AppShell.tsx
    - contract-ide/src-tauri/src/commands/derive.rs
    - contract-ide/src-tauri/src/commands/mod.rs
    - contract-ide/src-tauri/Cargo.toml
    - contract-ide/src-tauri/Cargo.lock
    - contract-ide/src-tauri/src/lib.rs
    - .planning/ROADMAP.md
    - .planning/REQUIREMENTS.md
    - .planning/STATE.md
  deleted:
    - contract-ide/src/ipc/derive.ts
    - contract-ide/src/store/derive.ts
decisions:
  - "Pivot to MCP-driven derivation. Original Plan 06-02 called a Rust-side Anthropic API client (Plan 06-01). During UAT prep the user raised: why hand the IDE an ANTHROPIC_API_KEY when the active Claude Code session already has repo context + subscription auth? Pivot agreed: the Tauri app stops being an LLM client; the user's active Claude session is the deriver, talking to the IDE via MCP."
  - "Reuse `contract-ide` MCP server (Phase 5) rather than spin up a second path. Two new tools on the existing server: `list_nodes_needing_derivation` (DERIVE-01 queue) + `write_derived_contract` (DERIVE-02 hash recompute + DERIVE-03 pinned guard)."
  - "`write_derived_contract` is a separate tool from `update_contract` (Phase 5) because their invariants differ. `update_contract` is for user-driven edits (preserves existing hashes, no pinned check). `write_derived_contract` is for fresh derivations (refuses pinned, recomputes fresh code_hash from source, recomputes contract_hash, sets derived_at). Collapsing into one tool would conflate two intents. AMENDED 2026-04-24: the \"no pinned check\" assumption in update_contract held only if the tool were reachable exclusively by the user; an independent concurrency audit showed it is reachable by any Claude session over MCP, so a pin guard matching write_derived_contract's was added (see commit sha: pending). Both writer tools now enforce SKIPPED-PINNED."
  - "Hash semantics (code_hash over concatenated newline-terminated source lines; contract_hash over `body.trim()`) ported verbatim from Rust to TS. Kept in sync by comment in both files. Phase 7 drift detection currently reads the Rust implementation — TS version must match byte-for-byte."
  - "Retained `compute_code_hash` / `compute_contract_hash` / `extract_source` in Rust `commands/derive.rs` behind `#![allow(dead_code)]`. Phase 7's drift path will consume them; the unit tests cover hash determinism + end-line clamp + truncation, giving a canonical reference implementation against which the TS port can be fuzz-checked."
  - "Removed reqwest + chrono from Cargo.toml — no other Rust code used them. `cargo tree | grep openssl` still empty."
  - "Removed the `derive_contracts` Tauri command + `derive:progress` event stream entirely. No shim, no deprecation period — the command was added in the same session, never shipped to any consumer outside this phase, and leaving a dead handler would confuse future readers."
  - "Inspector: Derive button → `Copy derivation prompt` + `Copy batch prompt` buttons. Prompts reference the MCP tools by name so any future renaming shows up as a visible string-mismatch rather than silent breakage. Pinned badge retained (informational)."
  - "AppShell: removed the `derive:progress` subscriber. The Rust fs watcher (Phase 2) already refreshes SQLite when a sidecar changes; no extra event stream needed."
  - "UAT deferred to user-driven session: user registers the `contract-ide` MCP server in their Claude Code config (`.mcp.json` in the managed repo, or `~/.claude.json`), opens Claude Code in the managed repo, pastes the derivation prompt, watches the session call the tools. The pre-pivot UAT fixtures at /tmp/phase6-uat remain reusable."
metrics:
  duration: "~45 min (diagnosis + pivot + implementation + verification)"
  tasks: "pivot (7 subtasks)"
  commits: "pending atomic commit"
  files_changed: "12 (2 created, 9 modified, 2 deleted)"
---

## What was built

A pivot, not an addition. Phase 6 originally proposed: Rust makes an Anthropic API call, emits progress events, Inspector shows a spinner. During the UAT prep the design was reconsidered — the user's active Claude Code session already has repo context, subscription auth, and (most importantly) ongoing conversational state about what the code *means*. Handing that derivation to a fresh, context-free API call from Rust throws away exactly the thing that makes the contracts useful.

So Phase 6 now ships as:

### MCP tools (mcp-sidecar)
- **`list_nodes_needing_derivation({ include_pinned?, limit? })`** — SQL: `contract_body IS NULL OR trim(contract_body) = '' OR code_hash IS NULL`, with a `human_pinned = 0` filter by default. Returns `uuid, name, level, kind, code_ranges` so the calling session can fan out to Read calls without round-tripping back to MCP for each. Emits a reminder string at the end of the payload explaining the expected handoff to `write_derived_contract`.
- **`write_derived_contract({ uuid, body })`** — the derivation-specific writer. Loads the sidecar, short-circuits with `SKIPPED-PINNED` if `fm.human_pinned === true`, recomputes `code_hash` over current source (`null` when `code_ranges` is empty — legitimate for L0/L1 conceptual nodes), recomputes `contract_hash = sha256(body.trim())`, sets `derived_at` to `new Date().toISOString()`, writes atomically via temp+rename. Preserves `uuid` as DATA-04 immutable.

Both tools registered in `index.ts` alongside the existing `find_by_intent` / `get_contract` / `list_drifted_nodes` / `update_contract` handlers.

### Frontend
- **Inspector** (`Inspector.tsx`) — Derive button replaced by `Copy derivation prompt` (per-node) + `Copy batch prompt`. Per-node prompt hard-codes the uuid + level + kind so the paste lands ready. Batch prompt instructs the session to iterate `list_nodes_needing_derivation`. Pinned badge retained (informational; the tool refuses the write).
- **AppShell** (`AppShell.tsx`) — removed the `subscribeDeriveProgress` effect. The Phase 2 fs watcher already refreshes SQLite when sidecars change; no progress stream is needed.
- **Deleted:** `src/ipc/derive.ts`, `src/store/derive.ts` — no consumers remain.

### Rust
- **`commands/derive.rs`** — stripped to the pure hash helpers (`compute_code_hash`, `compute_contract_hash`, `extract_source`) plus unit tests, behind `#![allow(dead_code)]`. Phase 7 will consume these for drift detection; keeping them here (with tests) locks the reference implementation the TS port must match byte-for-byte.
- **`lib.rs`** — removed `commands::derive::derive_contracts` from the handler macro.
- **`Cargo.toml`** — removed `reqwest` and `chrono`. `cargo tree | grep openssl` still empty. `cargo build && cargo clippy -- -D warnings && cargo test` all green; 8 tests pass (5 for hash helpers + 3 pre-existing validation).

## How to use (replaces original UAT)

1. Ensure the `contract-ide` MCP server is registered for your Claude Code session. Either:
   - Add to `.mcp.json` in the managed repo root (e.g. `/tmp/phase6-uat/.mcp.json`):
     ```json
     {
       "mcpServers": {
         "contract-ide": {
           "command": "bun",
           "args": ["run", "/Users/yang/lahacks/contract-ide/mcp-sidecar/src/index.ts"],
           "env": {
             "CONTRACT_IDE_DB_PATH": "/Users/yang/Library/Application Support/com.contract-ide.app/contract-ide.db",
             "CONTRACT_IDE_REPO_PATH": "/tmp/phase6-uat"
           }
         }
       }
     }
     ```
   - Or use the IDE-launched sidecar (Phase 5 already spawns it on repo open, with env wired).
2. Launch the IDE: `cd /Users/yang/lahacks/contract-ide && npm run tauri dev`. Open `/tmp/phase6-uat` via File > Open Repo.
3. Select a node, click `Copy derivation prompt`. Paste into a Claude Code terminal `cd`'d to `/tmp/phase6-uat`.
4. Observe the session call `get_contract` → `write_derived_contract`; the IDE graph refreshes within ~2s via the fs watcher.

### Scenario mapping to original UAT
- **S1 (DERIVE-01 non-blocking):** The IDE was never blocking to begin with — there is no in-app LLM call. The session does the work in the terminal; the IDE stays responsive.
- **S2 (DERIVE-02 hash-skip):** Invoke `write_derived_contract` twice with identical body. Second call returns the same `code_hash` (source unchanged) + regenerates `contract_hash` + `derived_at`. The tool always rewrites; "skip if unchanged" is enforced earlier — by the session NOT calling the tool again when `list_nodes_needing_derivation` no longer returns that uuid. Trade-off: no automatic hash-skip on the tool itself — if the session chooses to re-write with the same body, it's a no-op on disk content (body unchanged) but `derived_at` updates. Future cleanup could add a fast-path comparison.
- **S3 (DERIVE-03 pinned skip):** Invoke `write_derived_contract` on a pinned uuid. Tool returns `SKIPPED-PINNED: <uuid> is human_pinned — sidecar left unchanged.` Disk shasum matches baseline byte-for-byte.

## Consequences for later phases

- **Phase 7 (Drift Detection):** `code_hash` baselines are now populated by the TS writer. Phase 7's Rust drift detector will recompute `code_hash` and compare. The TS and Rust hash implementations must stay aligned — if you modify either, update the other in the same commit.
- **Phase 4 (Inspector + Monaco):** No conflict; the Inspector's derive row is self-contained. If Phase 4 relocates the contract textarea to a proper tab, the derive row moves with it.
- **Phase 9 (Demo polish):** The "click one button and a contract appears" demo is now "paste a prompt and watch your Claude Code session do it" — which is arguably a better narrative for the product thesis (the session-agent-native flow). If a magic-button demo is needed for the camera, a later phase can add a one-click `claude -p` subprocess launch that feeds the prompt to a fresh headless session — same tools, different entry point.

## Issues encountered

- `TS2589: Type instantiation is excessively deep` from `@modelcontextprotocol/sdk` when registering tools under strict tsconfig. Pre-existing (one error on `find_by_intent` already at HEAD); now two errors total (one more on the new tool registrations). The production path is `bun run build` which uses `bun build` — passes cleanly. TypeScript strict check is documentation-quality today; revisit when the SDK tightens its generic.
- Rust dead-code warnings on `compute_code_hash` etc. after the pivot. Addressed with `#![allow(dead_code)]` + a Phase 7 consumer comment. Removing them entirely would drop the unit tests and the Rust reference implementation — worse trade.
- Doc-comment over-indentation clippy nit on the new module header — fixed (two-space to one-space list item indent).

## How Plan 06-01 relates

Plan 06-01 is landed but effectively superseded. The hash helpers it introduced remain in `commands/derive.rs` and their tests remain in the Rust suite. Everything else from 06-01 (the `derive_contracts` Tauri command, `call_anthropic_for_contract`, `derive:progress` events, reqwest + chrono deps) was reverted in this plan's commit. See `06-01-SUMMARY.md` header note.
