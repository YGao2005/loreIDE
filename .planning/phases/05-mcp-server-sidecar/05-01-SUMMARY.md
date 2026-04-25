---
phase: 05-mcp-server-sidecar
plan: 01
subsystem: infra
tags: [mcp, tauri, sidecar, stdio, better-sqlite3, zod, pkg, esbuild, typescript, rust]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: tauri-plugin-shell registered, generate_handler fully-qualified-path convention, app_data_dir resolved by tauri-plugin-sql for contract-ide.db
  - phase: 02-contract-data-layer
    provides: SQLite schema + migrations (nodes, edges, receipts, nodes_fts) that Plan 05-02 tools will read
provides:
  - Standalone MCP stdio server binary (@modelcontextprotocol/sdk v1.29.0) compiled via @yao-pkg/pkg, placed at src-tauri/binaries/mcp-server-<target-triple>
  - Four MCP tools registered as stubs (find_by_intent, get_contract, list_drifted_nodes, update_contract) ready for Plan 05-02 to swap with real SQLite-backed handlers
  - Tauri sidecar launch wiring (launch_mcp_sidecar + McpSidecarHandle managed state + get_mcp_status command) that keeps CommandChild alive (Pitfall 3 defeated) and forwards stderr [mcp-server] ready into a mcp:status Tauri event
  - Frontend ipc/mcp.ts subscriber + AppShell MCP health pill that flips unknown -> running within seconds of app boot
  - shell:allow-execute object-form capability entry granting sidecar execution (Pitfall 4) alongside the existing string-form permission from Phase 1
  - Graceful-degrade path — missing binary emits mcp:status{stopped,reason:not-found} without crashing the app
affects: [05-02-tool-implementations, 08-agent-integration]

# Tech tracking
tech-stack:
  added: ["@modelcontextprotocol/sdk@1.29.0", "better-sqlite3@12.x", "zod@3.23.x", "@yao-pkg/pkg@5.16.1", "esbuild@0.21.x", "tsx@4.7.x"]
  patterns:
    - "Separate Node workspace (mcp-sidecar/) — NOT mixed into top-level contract-ide/package.json"
    - "CommonJS module target required for @yao-pkg/pkg compatibility"
    - "esbuild --external:better-sqlite3 then pkg — esbuild can't bundle .node files; pkg extracts them at runtime"
    - "Binary rename via `rustc --print host-tuple` matches Tauri's externalBin suffix expectation"
    - "Health signaling via stderr-only (stdout reserved for MCP JSON-RPC framing — Pitfall 1)"
    - "CommandChild stored in Tauri managed state (McpSidecarHandle) — dropping it kills the process (Pitfall 3)"
    - "mcp:status event-stream + seed-on-mount `get_mcp_status` IPC handles the race where ready fires before the UI mounts"
    - "Graceful degrade — binary-missing / spawn-failed paths emit `stopped` events with reason rather than panicking setup()"

key-files:
  created:
    - contract-ide/mcp-sidecar/package.json
    - contract-ide/mcp-sidecar/package-lock.json
    - contract-ide/mcp-sidecar/tsconfig.json
    - contract-ide/mcp-sidecar/.gitignore
    - contract-ide/mcp-sidecar/src/index.ts
    - contract-ide/mcp-sidecar/src/db.ts
    - contract-ide/mcp-sidecar/src/tools/find_by_intent.ts
    - contract-ide/mcp-sidecar/src/tools/get_contract.ts
    - contract-ide/mcp-sidecar/src/tools/list_drifted.ts
    - contract-ide/mcp-sidecar/src/tools/update_contract.ts
    - contract-ide/mcp-sidecar/scripts/build.mjs
    - contract-ide/src-tauri/binaries/.gitkeep
    - contract-ide/src-tauri/src/commands/mcp.rs
    - contract-ide/src/ipc/mcp.ts
    - contract-ide/src/components/layout/McpStatusIndicator.tsx
    - .planning/phases/05-mcp-server-sidecar/deferred-items.md
  modified:
    - contract-ide/.gitignore
    - contract-ide/src-tauri/tauri.conf.json
    - contract-ide/src-tauri/capabilities/default.json
    - contract-ide/src-tauri/src/commands/mod.rs
    - contract-ide/src-tauri/src/lib.rs
    - contract-ide/src/components/layout/AppShell.tsx

key-decisions:
  - "Pinned @modelcontextprotocol/sdk to ^1.29.0 after verifying via `npm show @modelcontextprotocol/sdk version` — v1.x is still the production channel (v2 pre-alpha per STATE.md blocker concern)"
  - "Kept both existing string-form `shell:allow-execute` AND new object-form with sidecar:true — plan guidance accepts coexistence; avoids breaking other Phase 1/2 shell usage"
  - "McpStatusIndicator landed in a fixed-position bottom-right footer OUTSIDE the ResizablePanelGroup — survives panel resize/collapse and can't be hidden by the chat panel"
  - "Launch failures (binary missing, spawn error, no app_data_dir) emit mcp:status{stopped, reason} rather than panicking setup() — app still boots with `MCP offline` pill"
  - "McpStatusIndicator seeds from get_mcp_status on mount AND subscribes — handles the race where the Rust-side `ready` event fires before the React component mounts (verified necessary: Vite was still optimising deps at the moment ready fired)"

patterns-established:
  - "Tauri sidecar launch pattern: managed-state handle declared BEFORE setup() + non-panicking launch_* function called inside setup() with owned AppHandle + CommandEvent rx loop spawned on tauri::async_runtime"
  - "MCP sidecar diagnostic pattern: stderr-only (no console.log anywhere under mcp-sidecar/src/) — stdout owned by JSON-RPC framing"
  - "Frontend-backend liveness signalling: stderr string-match -> Rust Emitter event -> React listener (`mcp:status` is the canonical event name for this app)"

requirements-completed: [MCP-01]

# Metrics
duration: 5min
completed: 2026-04-24
---

# Phase 5 Plan 1: MCP Sidecar Launch Plumbing Summary

**Compiled TypeScript MCP stdio server (SDK v1.29.0) launched as a Tauri sidecar at app start with live `mcp:status` health indicator — four tools registered as stubs, ready for Plan 05-02 to swap in live SQLite-backed handlers.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-24T06:53:28Z
- **Completed:** 2026-04-24T06:58:20Z
- **Tasks:** 2
- **Files created:** 16
- **Files modified:** 6

## Accomplishments

- Standalone `mcp-sidecar/` Node workspace scaffolded with `@modelcontextprotocol/sdk@1.29.0`, `better-sqlite3@12.x`, and `zod@3.23.x` — lockfile committed.
- End-to-end build pipeline (`npm run build`): esbuild bundle → `@yao-pkg/pkg` compile → rename with `rustc --print host-tuple` → copy to `src-tauri/binaries/` → produced a 54 MB Mach-O arm64 executable at `src-tauri/binaries/mcp-server-aarch64-apple-darwin`.
- All four MCP tools (`find_by_intent`, `get_contract`, `list_drifted_nodes`, `update_contract`) registered via `server.tool()` with Zod schemas matching 05-RESEARCH Pattern 1 — handlers return stub placeholder text so Plan 05-02 only edits the handler bodies.
- Sidecar emits `[mcp-server] ready` on stderr after `server.connect(new StdioServerTransport())`; zero `console.log` anywhere in `mcp-sidecar/src/` (Pitfall 1 upheld at plan landing).
- Rust `commands::mcp::launch_mcp_sidecar` spawns the binary inside `setup()`, stores the `CommandChild` in `McpSidecarHandle` managed state (Pitfall 3 defeated — `ps aux` confirms the child survives the setup closure returning), and forwards the sidecar's `[mcp-server] ready` stderr line into a `mcp:status { status: "running" }` Tauri event.
- `capabilities/default.json` gained the object-form `shell:allow-execute` with `{ name: "binaries/mcp-server", sidecar: true }` (Pitfall 4) — preserved alongside the existing string-form entry so Phase 1/2 shell usage is untouched.
- Frontend `src/ipc/mcp.ts` exposes `subscribeMcpStatus` + `getMcpStatus`; `McpStatusIndicator.tsx` renders a dot + label (`MCP…` / `MCP ready` / `MCP offline`) seeded from the IPC query AND live-updated via the event stream; wired into `AppShell` as a fixed-position status-bar footer.
- Runtime smoke test (`npm run tauri dev` for 60s): the Rust log line `[mcp-sidecar] [mcp-server] ready` appeared within ~7 seconds of app boot; sidecar process visible in `ps aux`; Vite loaded `@tauri-apps/api/event` (confirms frontend subscriber path ran).

## Task Commits

1. **Task 1: Scaffold mcp-sidecar/ Node project + MCP server skeleton with stub tools + build pipeline** — `c803f80` (feat)
2. **Task 2: Tauri sidecar launch + managed CommandChild + mcp:status event + UI health indicator** — `fa7def0` (feat)

**Plan metadata:** _(commit pending after SUMMARY + STATE + ROADMAP updates)_

## Files Created/Modified

### Sidecar workspace
- `contract-ide/mcp-sidecar/package.json` — Node manifest pinning MCP SDK v1.29.0, better-sqlite3, zod, plus @yao-pkg/pkg + esbuild + tsx dev deps
- `contract-ide/mcp-sidecar/package-lock.json` — resolved versions (committed for reproducibility)
- `contract-ide/mcp-sidecar/tsconfig.json` — CommonJS / ES2020 / strict; module:commonjs required by pkg
- `contract-ide/mcp-sidecar/.gitignore` — excludes node_modules + dist
- `contract-ide/mcp-sidecar/src/index.ts` — entrypoint wiring McpServer + StdioServerTransport + four `server.tool()` registrations with Zod schemas; emits `[mcp-server] ready` on stderr after `server.connect()`
- `contract-ide/mcp-sidecar/src/db.ts` — lazy `getDb()` opening better-sqlite3 with `{ readonly: true, fileMustExist: true }`, gated on `CONTRACT_IDE_DB_PATH` env var; `getRepoPath()` for update_contract resolution
- `contract-ide/mcp-sidecar/src/tools/find_by_intent.ts` — stub returning `[stub] find_by_intent(...)` text
- `contract-ide/mcp-sidecar/src/tools/get_contract.ts` — stub
- `contract-ide/mcp-sidecar/src/tools/list_drifted.ts` — stub
- `contract-ide/mcp-sidecar/src/tools/update_contract.ts` — stub (arg schema already matches final shape so Plan 05-02 only rewrites the body)
- `contract-ide/mcp-sidecar/scripts/build.mjs` — three-step pipeline; `--external:better-sqlite3` on the esbuild step is load-bearing (esbuild cannot package `.node` addons; pkg handles them)

### Tauri wiring
- `contract-ide/src-tauri/binaries/.gitkeep` — directory marker so `binaries/` exists in git; actual binaries excluded via `mcp-server-*` glob in `contract-ide/.gitignore`
- `contract-ide/src-tauri/src/commands/mcp.rs` — `McpSidecarHandle` managed-state + `launch_mcp_sidecar(AppHandle)` + `#[tauri::command] get_mcp_status`; graceful failure paths for missing binary / no app_data_dir / spawn failure
- `contract-ide/src-tauri/src/commands/mod.rs` — `pub mod mcp;` added
- `contract-ide/src-tauri/src/lib.rs` — `.manage(McpSidecarHandle::default())` declared BEFORE `.setup()`; `commands::mcp::get_mcp_status` wired into `generate_handler!` via fully-qualified path (01-02 convention); `launch_mcp_sidecar(app.handle().clone())` call inside `setup()` AFTER the vibrancy block
- `contract-ide/src-tauri/tauri.conf.json` — `bundle.externalBin: ["binaries/mcp-server"]` added (no other bundle keys changed)
- `contract-ide/src-tauri/capabilities/default.json` — object-form `shell:allow-execute` entry added with `{ name: "binaries/mcp-server", sidecar: true }`; existing string-form entry preserved

### Frontend
- `contract-ide/src/ipc/mcp.ts` — `subscribeMcpStatus(onChange)` wrapping `listen<McpStatusEvent>('mcp:status', ...)`; `getMcpStatus()` invoking the Rust command; `McpStatus` string-union type
- `contract-ide/src/components/layout/McpStatusIndicator.tsx` — dot + label, seeds from `getMcpStatus()` on mount AND subscribes to the event stream; tooltip carries failure reason; `aria-live="polite"` for screen readers
- `contract-ide/src/components/layout/AppShell.tsx` — import + `<footer>` with fixed positioning hosting `<McpStatusIndicator />`; 10-line change, outside the ResizablePanelGroup so it can't be hidden by panel collapse

### Hygiene
- `contract-ide/.gitignore` — `mcp-sidecar/node_modules/` + `mcp-sidecar/dist/` + `src-tauri/binaries/mcp-server-*` (so `.gitkeep` is retained)

## Decisions Made

- **SDK version validated before pin.** `npm show @modelcontextprotocol/sdk version` returned `1.29.0` — v2 pre-alpha has not shipped stable. Pinned to `^1.29.0` (v1.x-compatible range) per STATE.md concern. Import paths use the v1.x form (`@modelcontextprotocol/sdk/server/mcp.js` + `/stdio.js`) so a future v2 migration is isolated to `src/index.ts`.
- **Both string-form and object-form `shell:allow-execute` kept.** The plan explicitly accepts coexistence; removing the string form would risk Phase 1/2 shell usage (`tauri-plugin-shell` `output()` paths in `commands::validation`). The object-form narrows what sidecars are allowed without revoking general shell use.
- **McpStatusIndicator placement.** Landed in a fixed-position bottom-right footer (`className="fixed bottom-0 right-0 ..."`) OUTSIDE the `ResizablePanelGroup`. This survives panel resizing and collapse — Phase 9 polish can relocate if needed. The plan explicitly de-prioritised placement perfection ("smallest viable insertion point; Phase 9 polish may relocate it").
- **Launch failure is non-panicking.** `launch_mcp_sidecar` emits `mcp:status{stopped, reason: ...}` and returns early on any failure path (no app_data_dir / sidecar() Err / spawn() Err) instead of unwrapping. The app still boots and surfaces the state in the UI — matches the "missing-binary scenario" verification criterion.
- **Seed-on-mount + subscribe pattern.** `McpStatusIndicator` seeds from `getMcpStatus()` AND subscribes — because the Rust-side `ready` event fires ~7s after app start, while the React component may mount before or after that moment depending on Vite dep-optimisation. Confirmed during runtime smoke test (`[vite] new dependencies optimized: @tauri-apps/api/event` appeared AFTER the `[mcp-server] ready` line).

## Deviations from Plan

None - plan executed exactly as written. All 12 artifacts listed in `must_haves.artifacts`, all 8 `key_links`, and all 6 `truths` landed as specified.

**Total deviations:** 0 auto-fixed
**Impact on plan:** Clean execution. No scope creep, no architectural decisions required.

## Issues Encountered

- **Pre-existing clippy warning in `src-tauri/src/commands/validation.rs:71`** — `map_or(false, ...)` can be `is_some_and(...)`. NOT triggered by Plan 05-01 changes; `mcp.rs` itself has zero warnings. Left untouched per executor scope rules (only auto-fix issues the current task caused); logged to `.planning/phases/05-mcp-server-sidecar/deferred-items.md`. The `validation.rs` module is already flagged for deletion in Phase 9 polish per STATE.md Pending Todos.

## Authentication Gates

None encountered. No external services accessed during this plan.

## User Setup Required

None — no external service configuration needed. The DB path is resolved dynamically from `app.path().app_data_dir()` at sidecar launch time.

## Stderr messages observed during runtime verification (for Plan 05-02 signal-noise reference)

- `[mcp-sidecar] [mcp-server] ready` — the prefixed canonical ready line (Rust's `[mcp-sidecar]` prefix wrapping the sidecar's stderr write)
- `[vite] (client) ✨ new dependencies optimized: @tauri-apps/api/event` — vite-side, not sidecar stderr — confirms frontend subscribe path ran
- `[vite] (client) ✨ optimized dependencies changed. reloading` — vite HMR reaction to the newly-listed dep

**No stderr noise from the sidecar itself other than the single ready line** — Plan 05-02's tool implementations should preserve this property so UI can distinguish "sidecar is alive" from "sidecar is spewing errors".

## @yao-pkg/pkg target behavior

- `--targets node20` was used as the plan specified.
- Build succeeded without manual override on Apple Silicon (aarch64-apple-darwin).
- `better-sqlite3@12.x` prebuilt for Node 20 on arm64-darwin was picked up cleanly; no ABI override needed. If a future machine hits ABI mismatch (sidecar starts then immediately emits `stopped` on first launch), switch to `--targets node22` per Pitfall 2.

## Target triple observed

`aarch64-apple-darwin` — Apple Silicon. The output binary is `src-tauri/binaries/mcp-server-aarch64-apple-darwin` (54 MB, Mach-O 64-bit executable arm64).

## Capability warnings observed during `tauri dev`

None. The object-form `shell:allow-execute` + string-form coexistence did not produce any warnings in the `cargo run` output during the 60s smoke test.

## Next Phase Readiness

- **Ready for Plan 05-02 (Wave 2, parallel with 03):** all plumbing is in place — binary compiled, Tauri spawn path proven, `mcp:status` event wiring live, four tools registered with the final Zod schemas and handler shapes. Plan 05-02 only needs to swap the four stub handler bodies with real SQLite-backed implementations (FTS5 for `find_by_intent`, simple SELECTs for `get_contract` / `list_drifted_nodes`, file write for `update_contract`).
- **`CONTRACT_IDE_REPO_PATH` env var is NOT yet threaded** — Plan 05-02 (or its companion task) needs to pass it in the `.env(...)` call on the sidecar command; `update_contract` needs it to locate `.contracts/<uuid>.md`. Phase 8 handles repo-switch (Pitfall 7).
- **`.mcp.json` for Claude Code discovery is NOT yet written** — Plan 05-02's integration task owns that.
- **Blockers carried forward from STATE.md:** MCP SDK v2 anticipated Q2 2026 — still relevant; v1.29.0 is current. Re-check before Plan 05-02 execution in case a stable v2 lands between plans.

## Self-Check: PASSED

- `contract-ide/mcp-sidecar/package.json` — FOUND
- `contract-ide/mcp-sidecar/src/index.ts` — FOUND
- `contract-ide/mcp-sidecar/src/db.ts` — FOUND
- `contract-ide/mcp-sidecar/scripts/build.mjs` — FOUND
- `contract-ide/src-tauri/binaries/mcp-server-aarch64-apple-darwin` — FOUND (54MB, 0755)
- `contract-ide/src-tauri/src/commands/mcp.rs` — FOUND
- `contract-ide/src/ipc/mcp.ts` — FOUND
- `contract-ide/src/components/layout/McpStatusIndicator.tsx` — FOUND
- Task 1 commit `c803f80` — FOUND in git log
- Task 2 commit `fa7def0` — FOUND in git log
- Cargo build — PASSED
- `tsc --noEmit` — PASSED (clean)
- Runtime smoke via `npm run tauri dev` — PASSED (sidecar alive in ps; ready line in Rust log within 7s)

---
*Phase: 05-mcp-server-sidecar*
*Completed: 2026-04-24*
