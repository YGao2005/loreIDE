---
phase: 05-mcp-server-sidecar
plan: 02
subsystem: mcp
tags: [mcp, bun, bun:sqlite, fts5, yaml, claude-code]

requires:
  - phase: 05-mcp-server-sidecar/01
    provides: Compiled sidecar binary, Tauri spawn plumbing, mcp:status event, health indicator
  - phase: 02-contract-data-layer/01
    provides: nodes + nodes_fts schema, FTS5 virtual table
  - phase: 02-contract-data-layer/02
    provides: ContractNode row shape, scanner pipeline, RepoState managed type
  - phase: 02-contract-data-layer/03
    provides: fs watcher + refresh_nodes (propagates sidecar .md writes to SQLite)
provides:
  - Four production MCP tool handlers (find_by_intent FTS5, get_contract, list_drifted_nodes, update_contract)
  - bun:sqlite read-only DB client (replaces better-sqlite3)
  - YAML-backed sidecar round-trip (preserves code_ranges)
  - .mcp.json for Claude Code discovery
  - CONTRACT_IDE_REPO_PATH threaded through Rust spawn
  - Single-writer invariant proof (readonly:true + zero write SQL in tools)
affects:
  - Phase 6 (derivation — will write real code/contract hashes that list_drifted_nodes queries)
  - Phase 7 (drift UI — consumes list_drifted_nodes over MCP or IPC)
  - Phase 8 (agent loop — repo-switch must restart sidecar to refresh CONTRACT_IDE_REPO_PATH)
  - Phase 9 (mass edit — exercises update_contract at scale; FTS5 rebuild perf becomes relevant)

tech-stack:
  added: [bun, bun:sqlite, bun build --compile, yaml (npm)]
  removed: [better-sqlite3, @types/better-sqlite3, @yao-pkg/pkg, esbuild, tsx]
  patterns:
    - "MCP tools talk to SQLite read-only; writes are filesystem-only via temp+rename (MCP-03 single-writer)"
    - "bun build --compile maps rustc host-tuple → bun target flavour so Tauri's externalBin suffix still matches"
    - "yaml npm package for sidecar frontmatter round-trip (authorised fallback from the hand parser)"

key-files:
  created:
    - contract-ide/mcp-sidecar/src/types.ts
    - contract-ide/.mcp.json
    - contract-ide/mcp-sidecar/bun.lock
  modified:
    - contract-ide/mcp-sidecar/src/db.ts
    - contract-ide/mcp-sidecar/src/tools/find_by_intent.ts
    - contract-ide/mcp-sidecar/src/tools/get_contract.ts
    - contract-ide/mcp-sidecar/src/tools/list_drifted.ts
    - contract-ide/mcp-sidecar/src/tools/update_contract.ts
    - contract-ide/mcp-sidecar/package.json
    - contract-ide/mcp-sidecar/scripts/build.mjs
    - contract-ide/src-tauri/src/commands/mcp.rs
    - contract-ide/src-tauri/src/commands/repo.rs
    - contract-ide/src-tauri/src/db/scanner.rs  # Phase 2 regression fixes
  removed:
    - contract-ide/mcp-sidecar/package-lock.json

key-decisions:
  - "Ripped out @yao-pkg/pkg + better-sqlite3 mid-UAT in favour of bun build --compile + bun:sqlite — pkg's snapshot VFS can't resolve .node native addons at runtime (Pitfall 2)."
  - "Swapped the hand-rolled YAML parser for the `yaml` npm package (~50KB) — authorised by the plan when the hand parser fails on real sidecars."
  - "Fixed two pre-existing Phase 2 scanner bugs surfaced by the fresh UAT fixture: (a) node_flows/edges inserts FK-violate when target UUID isn't yet scanned; (b) nodes_fts external-content shadow index was never rebuilt so MATCH always returned empty. Both shipped as fix commits under Phase 2's blame, not Phase 5."

patterns-established:
  - "Pattern: sidecar build pipeline is a single `bun build --compile --target=<bun-flavour>` — no esbuild, no pkg, no .node smuggling."
  - "Pattern: external-content FTS5 requires an explicit rebuild call (`INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')`) inside the canonical write path — doing it once at upsert covers scanner + watcher + write_contract."

requirements-completed: [MCP-01, MCP-03]

duration: ~60min
completed: 2026-04-24
---

# Phase 5 Plan 2: Real MCP Tools + UAT

**Live Claude Code session exercises all four tools — find_by_intent / get_contract / list_drifted_nodes / update_contract — against a Bun-compiled sidecar and propagates writes through Tauri's watcher to SQLite in under 3s.**

## Performance

- **Duration:** ~60 min (including two mid-UAT pivots: runtime swap + YAML parser swap + two Phase 2 regression fixes)
- **Completed:** 2026-04-24
- **Tasks:** 3 (2 code + 1 human-verify checkpoint)
- **Files modified:** 10 (7 sidecar + 3 Rust)

## Accomplishments

- Four real MCP tool handlers backed by bun:sqlite read-only + filesystem writes
- Runtime migration off @yao-pkg/pkg + better-sqlite3 to Bun native (~60MB compiled binary)
- Single-writer invariant (MCP-03) proven at both DB level (`readonly: true`) and code level (zero write SQL in any tool)
- `.mcp.json` committed with literal `aarch64-apple-darwin` triple and dev-machine paths — Claude Code auto-discovers
- End-to-end round-trip verified: MCP write to `.md` → Tauri watcher → `refresh_nodes` → SQLite + FTS rebuild in ~2s

## Task Commits

1. **Task 1 (original):** Real MCP tool handlers — `e4b9b18` (feat)
2. **Task 2:** CONTRACT_IDE_REPO_PATH + .mcp.json — `6c0df45` (feat)
3. **UAT unblock 1 — scanner FK gate** — `ba024c3` (fix, Phase 2 regression)
4. **UAT unblock 2 — runtime swap to Bun** — `582b20a` (refactor)
5. **UAT unblock 3 — FTS5 rebuild on upsert** — `90103f4` (fix, Phase 2 regression)
6. **UAT unblock 4 — YAML parser swap** — `59fafed` (fix)

## Files Created/Modified

### Sidecar (Node/Bun project)
- `contract-ide/mcp-sidecar/package.json` — drop pkg/esbuild/tsx/better-sqlite3; add yaml + @types/bun; switch scripts to `bun run`
- `contract-ide/mcp-sidecar/bun.lock` — replaces package-lock.json
- `contract-ide/mcp-sidecar/scripts/build.mjs` — single `bun build --compile --target=<bun-flavour>` pipeline; host-triple → bun-target map
- `contract-ide/mcp-sidecar/src/db.ts` — bun:sqlite `Database(path, { readonly: true })`; `getRepoPath()` throws if env unset
- `contract-ide/mcp-sidecar/src/types.ts` — `ContractNodeRow` + `ContractFrontmatter` mirroring Rust shapes
- `contract-ide/mcp-sidecar/src/tools/find_by_intent.ts` — FTS5 MATCH with `snippet(nodes_fts, -1, '**', '**', '...', 20)`
- `contract-ide/mcp-sidecar/src/tools/get_contract.ts` — `SELECT ... FROM nodes WHERE uuid = ?` + `decodeNodeRow()`
- `contract-ide/mcp-sidecar/src/tools/list_drifted.ts` — DRIFT-01 predicate
- `contract-ide/mcp-sidecar/src/tools/update_contract.ts` — `yaml` package for frontmatter; temp + atomic rename; UUID preserved

### Rust (Tauri side)
- `contract-ide/src-tauri/src/commands/mcp.rs` — passes `CONTRACT_IDE_REPO_PATH` at spawn via `try_state::<RepoState>()` + `.0` inner Mutex
- `contract-ide/src-tauri/src/commands/repo.rs` — TODO(Phase 8) pointer at open_repo
- `contract-ide/src-tauri/src/db/scanner.rs` — Phase 2 fixes: (1) EXISTS guards on node_flows/edges inserts; (2) `INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')` at end of upsert_node_pub

### Config
- `contract-ide/.mcp.json` — Claude Code project-scope MCP server config with literal target triple + absolute dev paths

## Decisions Made

- **Runtime swap to Bun (critical pivot).** `@yao-pkg/pkg` bundled better-sqlite3 via `--external` for esbuild but pkg's snapshot VFS can't execute `.node` native addons — the compiled binary crashed at first SQLite call looking up `/snapshot/mcp-sidecar/node_modules/better-sqlite3/build/Release/better_sqlite3.node` (Pitfall 2 made flesh). `bun build --compile` with `bun:sqlite` avoids the native-addon bundling problem entirely — the SQLite engine is inside the Bun runtime that ships with the binary. Plan 05-01 had pinned the pkg pipeline; this is a full rip-replace for the sidecar's build tooling.
- **YAML parser swap.** The hand-rolled walker shipped in the plan dropped indented list items (the condition was `l.startsWith('- ')` but real list items start with `  - ` under the key). `code_ranges` round-tripped to `[]` every time. Plan explicitly authorised the `yaml` npm package fallback; it adds ~50KB for a pure-JS parser and now round-trips fixtures byte-equivalent-enough for the watcher.
- **FTS5 rebuild placement inside upsert_node_pub.** nodes_fts is declared `content='nodes'`; `INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')` is the one call that syncs the shadow index. Putting it inside `upsert_node_pub` (rather than per-caller) means the scanner, the watcher, and `write_contract` all end with a fresh index without each caller needing to know. Cost is O(corpus) per call — fine for hackathon corpus. Phase 6+ should migrate to AFTER INSERT/UPDATE/DELETE triggers for O(1) per row.
- **node_flows/edges EXISTS gate.** Scanner crashed FK-787 when Node A's `route: /cart` was inserted into node_flows (flow_uuid REFERENCES nodes(uuid); `/cart` is not a UUID). Same failure mode for neighbors referencing a not-yet-upserted UUID. Wrapped all three relationship inserts in `WHERE EXISTS (SELECT 1 FROM nodes WHERE uuid = ?)` — a no-op when the target is absent; rescans wire the edge once the target lands. Two-pass scan (nodes first, relationships second) is the cleaner structural fix, deferred.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Runtime swap to Bun**
- **Found during:** UAT Step 1 — live Claude Code tool call crashed at first SQLite open
- **Issue:** `@yao-pkg/pkg` cannot load better-sqlite3's .node native addon from its snapshot VFS; the plan's pipeline produced a binary that booted (Plan 05-01 smoke tests passed because the stubs didn't hit SQLite) but died on any real query.
- **Fix:** Migrated the whole sidecar build pipeline to Bun. Replaced esbuild + pkg with `bun build --compile`; replaced better-sqlite3 with `bun:sqlite`. Binary went from 54MB (pkg+better-sqlite3) to 60MB (bun+bun:sqlite), round-trip JSON-RPC smoke tested green.
- **Files modified:** package.json, bun.lock, scripts/build.mjs, src/db.ts
- **Verification:** Stand-alone stdin JSON-RPC initialize + tools/call returned real Node B row from SQLite before UAT continued
- **Committed in:** `582b20a` (refactor)

**2. [Rule 2 - Missing Critical] YAML parser swap**
- **Found during:** UAT Step 4 — Node C's `code_ranges` rewrote to `[]` after update_contract round-tripped
- **Issue:** Hand parser's nested-list detection expected list items to start with `- ` but real list items are indented as `  - ` under the key, so every indented `- file: ...` fell into the `else { i++ }` skip branch.
- **Fix:** Swapped to the `yaml` npm package (explicitly authorised by the plan's fallback clause). Field order preserved via insertion-ordered object built before `YAML.stringify`.
- **Files modified:** src/tools/update_contract.ts, package.json, bun.lock
- **Verification:** Re-ran update_contract against Node C; `code_ranges` survived byte-for-byte
- **Committed in:** `59fafed` (fix)

### Phase 2 regressions fixed under Phase 5

These are not Phase 5 scope — they are pre-existing Phase 2 bugs surfaced by the fresh UAT fixture. Committed with Phase 2 blame (`fix(02-02): ...`) to preserve traceability.

**3. [Phase 2 regression] Scanner FK on routes/neighbors**
- **Found during:** UAT Step 0 — Open Repository → `/tmp/phase5-uat/` crashed with SQLITE FK 787 on Node A (which had `route: /cart`)
- **Issue:** `upsert_node_pub` inserted `(node_uuid, route_string)` into `node_flows.flow_uuid` which FKs to `nodes.uuid`; a non-UUID route string always violates the constraint. Same failure lurked for neighbors pointing at not-yet-upserted UUIDs.
- **Fix:** Wrapped all three relationship inserts (parent-flow, route-flow, edge-neighbor) with `WHERE EXISTS (SELECT 1 FROM nodes WHERE uuid = ?)`. Deferred two-pass scan as the cleaner structural fix.
- **Files modified:** src-tauri/src/db/scanner.rs
- **Committed in:** `ba024c3` (fix, Phase 2 blame)

**4. [Phase 2 regression] nodes_fts shadow index never rebuilt**
- **Found during:** UAT Step 1 — `find_by_intent "checkout button"` returned empty against a fixture whose body literally contained "The checkout button triggers…"
- **Issue:** `nodes_fts` is declared `content='nodes'`; writing to `nodes` alone populates the external row data but leaves the inverted index empty. Plain `SELECT FROM nodes_fts` worked (it projects through the content reference) but `WHERE nodes_fts MATCH ?` was permanently dead.
- **Fix:** Append `INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')` at the tail of `upsert_node_pub`.
- **Files modified:** src-tauri/src/db/scanner.rs
- **Verification:** `PRAGMA table_info(nodes_fts)` confirmed column layout `[uuid, name, contract_body, tags]`; MATCH on `'checkout'` now returns both Node A (body hit) and Node B (name hit)
- **Committed in:** `90103f4` (fix, Phase 2 blame)

---

**Total deviations:** 4 — 2 auto-fixed under Phase 5 scope + 2 Phase 2 regressions fixed under Phase 2 blame
**Impact on plan:** Substantial — the runtime swap rewrote the build pipeline declared in Plan 05-01. Both Phase 2 fixes were required for the Phase 5 UAT to proceed but belong to Phase 2 technically; logged here because this UAT is where they surfaced.

## Issues Encountered

- **pkg + native addon incompatibility** (Pitfall 2): the original plan's pipeline produced a binary that passed Plan 05-01's stdin-only smoke test because stubs didn't hit SQLite. The real failure mode emerged only at first `better-sqlite3` open inside a tool handler. **Future plans should require a real-DB smoke test of the compiled binary, not just a "ready" handshake.**
- **Watcher pre-restart gotcha:** After the scanner FK fix, Tauri needed restart for the new Rust code to ship. The initial UAT attempt used a stale binary so Step 4's watcher couldn't propagate. Restart-required steps are not obvious to operators — a one-line "what Rust change is in-flight" state indicator would help.
- **MCP SDK version pinned at 1.29.0:** `npm show @modelcontextprotocol/sdk version` returned 1.29.0 as current; v2 pre-alpha has not shipped as of 2026-04-24 (STATE.md's Phase 5 blocker concern resolved).
- **FTS5 column layout (for Phase 6):** `PRAGMA table_info(nodes_fts)` → `uuid UNINDEXED, name, contract_body, tags`. `snippet(nodes_fts, -1, …)` in find_by_intent matches the `-1` all-columns sentinel.

## User Setup Required

None — `.mcp.json` committed with absolute paths that match the dev machine; no additional env setup beyond having the Tauri app running with the repo open.

## Observed UAT Results

| Step | Tool | Result |
|------|------|--------|
| 0 | Tauri repo ingest | 3 nodes scanned, 0 errors (after scanner FK fix) |
| 1 | find_by_intent "checkout button" | Node A returned with body snippet |
| 2 | get_contract B | Full JSON row: kind=API, level=L1, hashes + body intact |
| 3 | list_drifted_nodes | Exactly Node B (A not drifted, C null-hashes) |
| 4 | update_contract C + watcher | SQLite body updated to new text within ~3s; `.md` code_ranges preserved; FTS MATCH on `CheckoutButton` now hits Node C (proves watcher triggered upsert_node_pub → FTS rebuild) |
| 5 | MCP-03 proof | `readonly: true` at db.ts:25; zero `prepare.*(INSERT|UPDATE|DELETE)` in any tool file |

All five steps green. Phase 5 goal met end-to-end.

## Next Phase Readiness

- **Phase 6 (derivation):** nodes_fts column layout confirmed (`uuid, name, contract_body, tags`); drift predicate query shape confirmed; list_drifted_nodes will return real data once derivation populates `code_hash`/`contract_hash`.
- **Phase 7 (drift UI):** list_drifted_nodes is live — Phase 7 consumers can call it over MCP or via an equivalent Tauri command.
- **Phase 8 (agent loop):** repo-switch remains deferred — `CONTRACT_IDE_REPO_PATH` is set at sidecar spawn only. `TODO(Phase 8)` markers in both `commands/mcp.rs` and `commands/repo.rs`.
- **Phase 9 (mass edit):** if the corpus grows past ~1k nodes, the per-upsert FTS rebuild becomes O(n²) for full scans — migrate to AFTER INSERT/UPDATE/DELETE triggers before mass edit ships.

### Open Blockers / Concerns
- Two-pass scan (all nodes first, then relationships) is the structural fix for the FK regression. Current `WHERE EXISTS` gate is correct but means edges/flows may be silently dropped on the first scan and only land on rescan. Document or fix before Phase 7 drift UI depends on complete edge sets.
- FTS rebuild cost at scale (Phase 9) — switch to triggers.

---
*Phase: 05-mcp-server-sidecar*
*Completed: 2026-04-24*
