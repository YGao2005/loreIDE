---
phase: 05-mcp-server-sidecar
verified: 2026-04-24T00:00:00Z
status: passed
score: 4/4 success criteria verified
---

# Phase 5: MCP Server Sidecar Verification Report

**Phase Goal:** A compiled TypeScript MCP sidecar launches at app start, exposes all four tools over stdio, and Claude Code can call `find_by_intent` and `get_contract` against live app data.

**Verified:** 2026-04-24
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| # | Truth (Success Criterion) | Status | Evidence |
| - | - | - | - |
| 1 | MCP sidecar binary `mcp-server-<target-triple>` launches as Tauri sidecar; UI health check shows it running | VERIFIED | `contract-ide/src-tauri/binaries/mcp-server-aarch64-apple-darwin` exists (60.7MB, Mach-O arm64, mode 0755); `tauri.conf.json` has `bundle.externalBin: ["binaries/mcp-server"]`; `capabilities/default.json` has object-form `shell:allow-execute` with `sidecar:true`; `commands/mcp.rs` spawns it via `app.shell().sidecar("mcp-server")` in `setup()`; `McpStatusIndicator.tsx` rendered in AppShell.tsx:118 and listens on `mcp:status`; UAT table (05-02-SUMMARY) confirms health pill flipped to `MCP ready` |
| 2 | Claude Code session can call find_by_intent, get_contract, list_drifted_nodes, update_contract against live SQLite | VERIFIED | `.mcp.json` committed at repo root with stdio command + DB/REPO env vars; each tool file contains real SQL (`nodes_fts MATCH`, `WHERE uuid = ?`, drift predicate) or real FS write (`fs.renameSync`); UAT table (05-02-SUMMARY "Observed UAT Results" steps 1–4) confirms all four tools returned correct responses against live SQLite/fixture repo `/tmp/phase5-uat`; user approved via "approved" signal per task gate |
| 3 | Sidecar holds read-only SQLite; update_contract writes .md only; Rust watcher propagates — single-writer rule upheld (MCP-03) | VERIFIED | `db.ts:25` opens DB with `{ readonly: true }` (bun:sqlite); `grep -RIn "prepare.*(INSERT\|UPDATE\|DELETE)" mcp-sidecar/src/tools/` returns zero matches; `update_contract.ts:109-111` uses temp-file + `fs.renameSync` atomic write; UAT Step 4 observed the .md change propagate to SQLite via Plan 02-03 watcher within ~3s; UAT Step 5 confirmed readonly flag still present and zero write SQL |
| 4 | Sidecar held out of main agent loop until Phase 4 ships inspector | VERIFIED | No agent-loop / inspector integration present in Phase 5 code — the sidecar is only reachable via (a) the `.mcp.json`-launched external Claude Code session and (b) its health indicator. Phase 8 is explicitly marked as the integration home via `TODO(Phase 8)` comments in `commands/mcp.rs:67` and `commands/repo.rs:31`. MCP-02 (PostToolUse hook) moved from Phase 5 to Phase 8 per REQUIREMENTS.md line 187. |

**Score:** 4/4 truths verified

### Required Artifacts (from PLAN frontmatter must_haves)

Plan 05-01 artifacts (scaffold + Tauri wiring):

| Artifact | Expected | Status | Details |
| - | - | - | - |
| `contract-ide/mcp-sidecar/package.json` | Node project manifest with MCP SDK, SQLite driver, zod | VERIFIED (adapted) | Present; now pins `@modelcontextprotocol/sdk@^1.29.0`, `yaml@^2.8.3`, `zod@^3.23.0`; runtime swapped from better-sqlite3/pkg to Bun+bun:sqlite per 05-02 pivot. Original plan called for `better-sqlite3` + `@yao-pkg/pkg` but these were ripped out mid-UAT — goal is still met (SHIPPED pipeline produces working binary) |
| `contract-ide/mcp-sidecar/tsconfig.json` | TS config | VERIFIED | Present |
| `contract-ide/mcp-sidecar/src/index.ts` | Entrypoint + McpServer + StdioServerTransport + 4 tools + `[mcp-server] ready` on stderr | VERIFIED | 65 lines, registers all 4 tools via `server.tool()` with Zod schemas, emits ready line on stderr after `server.connect()` (index.ts:58) |
| `contract-ide/mcp-sidecar/src/db.ts` | `getDb()` + `getRepoPath()` + `decodeNodeRow()` helpers | VERIFIED | bun:sqlite `{ readonly: true }` (line 25); `getRepoPath` throws if env unset |
| `contract-ide/mcp-sidecar/src/tools/find_by_intent.ts` | Real FTS5 MATCH query | VERIFIED | `nodes_fts MATCH ?` JOIN against `nodes`, snippet highlighting, ORDER BY rank, 53 lines |
| `contract-ide/mcp-sidecar/src/tools/get_contract.ts` | Real SELECT WHERE uuid = ? | VERIFIED | Full ContractNode column SELECT, decodeNodeRow, JSON-stringified response |
| `contract-ide/mcp-sidecar/src/tools/list_drifted.ts` | DRIFT-01 predicate | VERIFIED | `code_hash IS NOT NULL AND contract_hash IS NOT NULL AND code_hash != contract_hash` |
| `contract-ide/mcp-sidecar/src/tools/update_contract.ts` | Read→patch→atomic-rename .md writer | VERIFIED | Uses `yaml` npm package for parse/serialize, temp-file + `fs.renameSync`, preserves UUID identity (DATA-04), 167 lines |
| `contract-ide/mcp-sidecar/src/types.ts` | Shared TS types mirroring Rust | VERIFIED | `ContractNodeRow`, `ContractFrontmatter`, `CodeRange` matching Rust shapes |
| `contract-ide/mcp-sidecar/scripts/build.mjs` | Build pipeline producing triple-suffixed binary | VERIFIED (adapted) | Now a single `bun build --compile --target=<flavour>` via host-tuple→bun-target map; rename+copy to `src-tauri/binaries/` still present; original esbuild + pkg pipeline replaced (UAT-authorised pivot) |
| `contract-ide/src-tauri/src/commands/mcp.rs` | Launch + McpSidecarHandle + get_mcp_status | VERIFIED | 151 lines; McpSidecarHandle newtype at line 20; `launch_mcp_sidecar` + graceful failure emits `stopped{reason}`; `get_mcp_status` at line 142 |
| `contract-ide/src-tauri/tauri.conf.json` | `bundle.externalBin: ["binaries/mcp-server"]` | VERIFIED | Line 50 |
| `contract-ide/src-tauri/capabilities/default.json` | Object-form shell:allow-execute with sidecar:true | VERIFIED | Present alongside string-form; both coexist |
| `contract-ide/src/ipc/mcp.ts` | subscribeMcpStatus wrapper | VERIFIED | `listen<McpStatusEvent>('mcp:status', …)` at line 14 |
| `contract-ide/src/components/layout/McpStatusIndicator.tsx` | Health pill/dot | VERIFIED | Seeds from `getMcpStatus()` + subscribes to event stream; unknown/running/stopped states |
| `contract-ide/src-tauri/binaries/mcp-server-aarch64-apple-darwin` | Compiled binary | VERIFIED | Mach-O 64-bit arm64 executable, mode 0755, 60.7MB; direct execution emits `[mcp-server] ready` on stderr within <1s |
| `contract-ide/.mcp.json` | Claude Code discovery config | VERIFIED | stdio command → binary path; CONTRACT_IDE_DB_PATH + CONTRACT_IDE_REPO_PATH env; literal target triple |

### Key Link Verification

| From | To | Via | Status | Details |
| - | - | - | - | - |
| `mcp-sidecar/src/index.ts` | `@modelcontextprotocol/sdk` | `McpServer` + `server.tool()` + `server.connect(StdioServerTransport)` | WIRED | All three imports + usage present (index.ts:1-2, 9, 14-49, 53-54) |
| `mcp-sidecar/src/tools/find_by_intent.ts` | `nodes_fts` FTS5 virtual table | `SELECT ... FROM nodes_fts JOIN nodes ... WHERE nodes_fts MATCH ?` | WIRED | Exact pattern present; UAT step 1 confirms live match against fixture body |
| `mcp-sidecar/src/tools/update_contract.ts` | Phase 2 sidecar frontmatter shape | YAML round-trip with canonical field order (format_version first, derived_at last) | WIRED | `serializeSidecar` builds insertion-ordered object; YAML.stringify preserves order |
| `mcp-sidecar/src/tools/update_contract.ts` | filesystem | `fs.writeFileSync(tmp)` + `fs.renameSync(tmp, target)` | WIRED | Lines 109-111 |
| `mcp-sidecar/src/tools/update_contract.ts` | Plan 02-03 watcher | .md write → fs-watcher → refresh_nodes → SQLite update | WIRED | UAT Step 4 observed the round-trip within ~3s; Phase 2 fix `90103f4` ensures FTS5 rebuild on upsert so subsequent `find_by_intent` hits the new body |
| `src-tauri/src/commands/mcp.rs` | `RepoState` managed state | `app.try_state::<RepoState>().and_then(|s| s.0.lock()…)` → `CONTRACT_IDE_REPO_PATH` env | WIRED | mcp.rs:74-85 |
| `src-tauri/src/commands/mcp.rs` | `tauri_plugin_shell::ShellExt` | `app.shell().sidecar("mcp-server").spawn()` | WIRED | mcp.rs:44, 87 |
| `src-tauri/src/commands/mcp.rs` | Tauri managed state | `*state.0.lock().unwrap() = Some(child)` (stores CommandChild, Pitfall 3) | WIRED | mcp.rs:102-103 |
| `src-tauri/src/lib.rs` | `commands::mcp::launch_mcp_sidecar` | `.manage(McpSidecarHandle::default())` before `.setup()` + call inside setup | WIRED | lib.rs:27, 37, 61 |
| `src/components/layout/AppShell.tsx` | `McpStatusIndicator` | Import + JSX render | WIRED | AppShell.tsx:13 (import), 118 (render) |
| `src/ipc/mcp.ts` | `@tauri-apps/api/event` | `listen<McpStatusEvent>('mcp:status', …)` | WIRED | ipc/mcp.ts:14 |
| `contract-ide/.mcp.json` | compiled sidecar binary | `mcpServers.contract-ide.command` → `./src-tauri/binaries/mcp-server-aarch64-apple-darwin` | WIRED | Binary file exists at referenced path; env contains both DB and REPO paths |

All 12 key links verified.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| - | - | - | - | - |
| **MCP-01** | 05-01, 05-02 | A TypeScript MCP server packaged as a Tauri sidecar exposes `find_by_intent`, `get_contract`, `list_drifted_nodes`, and `update_contract` tools over stdio | SATISFIED | All four tools registered in `index.ts` via `server.tool()` with Zod schemas; `StdioServerTransport` connected; sidecar launched by Tauri via `app.shell().sidecar("mcp-server").spawn()`; UAT confirms end-to-end reachability from Claude Code |
| **MCP-03** | 05-02 | MCP sidecar reads the SQLite cache via a read-only connection (single-writer rule upheld by Rust backend) | SATISFIED | Enforced at THREE layers: (a) DB open — `db.ts:25` `new Database(dbPath, { readonly: true })`; (b) code path — zero `prepare.*INSERT/UPDATE/DELETE` SQL in any `mcp-sidecar/src/tools/` file; (c) flow — `update_contract` writes ONLY `.md` via temp+rename, Rust watcher propagates to SQLite (UAT Step 4 observed ~3s propagation). Note: REQUIREMENTS.md line 181 still marks MCP-03 as "Pending" — the table appears to be stale relative to the committed code; the 05-02-SUMMARY `requirements-completed: [MCP-01, MCP-03]` field is authoritative |

**MCP-02 (deferred to Phase 8):** REQUIREMENTS.md line 187 correctly tracks the move. Not in scope for Phase 5. No orphaned requirements.

### Anti-Patterns Found

Scanned all Phase 5 sidecar + Rust files (`mcp-sidecar/src/**`, `commands/mcp.rs`, `src/ipc/mcp.ts`, `McpStatusIndicator.tsx`):

| File | Line | Pattern | Severity | Impact |
| - | - | - | - | - |
| `commands/mcp.rs` | 67 | `TODO(Phase 8)` | Info | Intentional deferral marker for repo-switch — acknowledged in plan + SUMMARY |
| `commands/repo.rs` | 31 | `TODO(Phase 8)` | Info | Same — intentional |

No `console.log` anywhere in `mcp-sidecar/src/` (Pitfall 1 upheld — grep returned zero matches). No stub/placeholder returns. No empty handlers. No blocker or warning-level anti-patterns.

### Deviations from ROADMAP blurb

The Phase 5 ROADMAP entry for Plan 05-01 still reads "better-sqlite3 + esbuild + @yao-pkg/pkg build pipeline". The SHIPPED code uses Bun + bun:sqlite + `bun build --compile`, documented as a four-step mid-UAT pivot in 05-02-SUMMARY. Per verifier instructions, this is a correctly-documented pre-pivot ROADMAP blurb rather than a real gap — the PHASE GOAL (binary launches, four tools over stdio, Claude Code calls find_by_intent/get_contract against live data) is met by the shipped pipeline. The ROADMAP text is lagging, not the implementation.

### Human Verification Already Performed

All five UAT steps in Plan 05-02 Task 3 (blocking human-verify gate) were executed with live Claude Code tool calls and sqlite3 verification against fixture repo `/tmp/phase5-uat`. User approved per the gate's `resume-signal`. See 05-02-SUMMARY "Observed UAT Results" table (all 5 green).

No additional human verification is required for Phase 5 closure.

### Gaps Summary

None. Phase 5 goal achieved end-to-end:
- Compiled binary exists and runs (emits `[mcp-server] ready` on stderr).
- Tauri launches it as a sidecar with CommandChild retained in managed state; UI health pill reflects liveness.
- All four tools registered over stdio and verified reachable via Claude Code's `.mcp.json` discovery.
- `find_by_intent`, `get_contract`, `list_drifted_nodes` hit read-only SQLite; `update_contract` writes atomic .md; Rust watcher round-trips to SQLite within ~3s.
- MCP-03 single-writer invariant enforced at DB, code, and flow levels.

Two Phase 2 regressions surfaced during UAT (scanner FK + FTS rebuild) were fixed under Phase 2 blame (`ba024c3`, `90103f4`) and are NOT Phase 5 debt — they are documented but intentionally attributed upstream.

---

_Verified: 2026-04-24_
_Verifier: Claude (gsd-verifier)_
