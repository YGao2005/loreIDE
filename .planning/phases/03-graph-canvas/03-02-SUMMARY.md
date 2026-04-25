---
phase: 03-graph-canvas
plan: 02
subsystem: ui
tags: [react-flow, xyflow, zustand, tauri-ipc, sqlx, ghost-refs, breadcrumb, drill-in]

# Dependency graph
requires:
  - phase: 02-contract-data-layer
    provides: nodes + node_flows + edges tables; scanner.rs populating node_flows from ContractFrontmatter.parent|.route (both L1 anchors); DbPool match pattern + sqlx::query direct usage; ContractNode IPC row type; pickAndOpenRepo + watcher flow
  - phase: 03-graph-canvas
    plan: 01
    provides: @xyflow/react canvas mounted in GraphPlaceholder; ContractNode custom node with cva visual matrix; graphStore.currentLens slice; ReactFlowProvider wrapping GraphCanvas
provides:
  - Three new Tauri commands (`get_edges`, `get_lens_nodes`, `rebuild_ghost_refs`) backed by the existing Phase 2 schema (no migration)
  - Transactional, idempotent DATA-05 ghost-ref derivation with correct anchoring — ghost.parent_uuid = nf.flow_uuid (additional flow's L1), NOT n.parent_uuid
  - Hierarchical React Flow layout via parentId + extent:'parent' (RESEARCH §Pattern 2); parents-before-children sort (Pitfall 3)
  - Double-click drill-in with smooth setCenter({zoom:1.5, duration:600}) animation for L0/L1/L2/L3 nodes (GRAPH-02)
  - Breadcrumb mounted above the canvas reading parentUuidStack from graphStore; click to pop + animate back
  - Lens-aware refreshNodes: journey resolves current L1 via getCurrentFlowUuid(stack, nodes) (Issue 3 fix — stack[0] is L0); system/ownership fall through to all-nodes placeholder
  - Race-safe last-click-wins via fetchGeneration counter (Issue 6 fix — rapid lens-toggle discards stale in-flight results)
  - Ghost rebuild wired into repo.ts after open_repo AND inside the watcher onRefreshed callback so sidecar edits refresh ghosts
  - Sanity-check assertion in rebuild_ghost_refs prints a warning if any ghost shares parent_uuid with its canonical (regression guard for Issue 1)
affects: [03-graph-canvas-03, 04-contract-editor, 07-drift-detection]

# Tech tracking
tech-stack:
  added: []  # no new deps — only new Rust commands + TS wrappers
  patterns:
    - "Shared row-hydration helper pattern: pub fn hydrate_node_rows(rows: Vec<SqliteRow>) -> Result<Vec<ContractNode>, sqlx::Error> extracted from get_nodes so get_lens_nodes can reuse the 14-column decode; every SELECT that feeds it must project the full column set"
    - "Ghost-ref semantics: ghost.parent_uuid = nf.flow_uuid (ADDITIONAL flow's L1 anchor), not n.parent_uuid — renders ghost under the OTHER L1 box to tell GRAPH-04's multi-flow story visually"
    - "Transactional idempotency: BEGIN → DELETE WHERE is_canonical=0 → INSERT → COMMIT (Pitfall 5). Deterministic ghost UUID 'ghost-{canonical}-{flow}' is belt-and-braces against re-entry"
    - "Primary flow selection = lex-min MIN(flow_uuid) OVER (PARTITION BY node_uuid) — deterministic, no schema change required"
    - "Last-click-wins race guard pattern: monotonic integer counter + capture-before-await; each in-flight fetch commits only if the captured value still matches current. Cheaper than AbortController for Tauri invoke() (no cancellation API there)"
    - "L1-resolution helper pattern: for any feature that needs `current L1 flow UUID`, walk parentUuidStack and match node.level === 'L1' from the loaded nodes — stack[0] is always L0 once anything is pushed"
    - "Hierarchical layout: parentId + extent:'parent' sub-flows (NOT nested <ReactFlow> instances which break inner zoom); parents-before-children sort by LEVEL_ORDER (Pitfall 3)"
    - "setCenter drill-in: read fresh node via getNode (measured dims not on the store node), center = position + measured/2, smooth via { zoom, duration } (RESEARCH §Pattern 3)"

key-files:
  created:
    - contract-ide/src-tauri/src/commands/graph.rs
    - contract-ide/src/ipc/graph.ts
    - contract-ide/src/components/graph/Breadcrumb.tsx
  modified:
    - contract-ide/src-tauri/src/commands/mod.rs
    - contract-ide/src-tauri/src/commands/nodes.rs
    - contract-ide/src-tauri/src/lib.rs
    - contract-ide/src/ipc/types.ts
    - contract-ide/src/ipc/repo.ts
    - contract-ide/src/store/graph.ts
    - contract-ide/src/components/graph/GraphCanvas.tsx
    - contract-ide/src/components/graph/GraphCanvasInner.tsx

key-decisions:
  - "Ghost parent_uuid is the ADDITIONAL flow's L1 anchor (nf.flow_uuid), not the canonical's parent_uuid — failing to do this collapses the GRAPH-04 'this node appears in multiple flows' visual story into 'duplicate under the same parent'. Enforced via SQL inspection + a runtime sanity-check that prints a warning if any ghost shares parent_uuid with its canonical."
  - "Primary flow = lex-min flow_uuid (SELECT MIN(flow_uuid) FROM node_flows WHERE node_uuid = ?). Deterministic, no schema change, and stable across re-scans because flow_uuids are content-hashed. Alternative was adding an is_primary BOOL column to node_flows — rejected as over-engineering for the hackathon."
  - "hydrate_node_rows extracted as a pub fn helper rather than re-inlined in get_lens_nodes. Any future SELECT that returns the 14-column contract-node tuple can reuse it. The helper panics gracefully on sqlx::Error (propagated) and falls back to empty Vec on malformed JSON in code_ranges/tags (matches get_nodes's pre-existing behaviour)."
  - "Journey lens at root (no L1 in stack) falls back to getNodes() instead of sending a null flow_uuid to get_lens_nodes. The Rust catch-all ALSO returns all nodes in that case, but the explicit TS fallback documents intent and keeps the invoke payload minimal."
  - "fetchGeneration is global to the store, not per-lens. Rapid mixed clicks (lens-toggle + drill-in + refresh) all share the same counter — last action wins regardless of type. Simpler than per-path generations and the user's mental model is 'most recent thing wins' anyway."
  - "rebuildGhostRefs is called in THREE places (pickAndOpenRepo post-scan, watcher onRefreshed, and graphStore.refreshNodes) — intentional defence-in-depth. The transaction makes it idempotent, so extra calls are harmless. If one of the call sites gets refactored away later, the other two keep ghosts fresh."
  - "GraphCanvas layout is a vertical flex (Breadcrumb pinned top, canvas fills rest) with the Breadcrumb inside <ReactFlowProvider> because its useReactFlow() call requires it. When Plan 03-03 promotes the provider to AppShell, the Breadcrumb can stay where it is (still inside the provider tree) or move alongside."
  - "GraphCanvasInner refetches edges via getEdges() on rows change (lens switch / refresh), NOT via a useGraphStore edge slice. Edges are a view-layer concern; keeping them component-local avoids an extra store slice and extra re-renders on selection changes."

patterns-established:
  - "Pitfall 3 prevention: when using parentId, always sort nodes parents-before-children before handing to ReactFlow. LEVEL_ORDER lookup gives O(n log n) sort by level"
  - "Pitfall 10 prevention: get_edges SQL constrains BOTH source AND target to the same level/parent filter — prevents cross-level edges rendering inside sub-flows"
  - "Issue 3 prevention (L1 resolution): any code that needs 'current L1 flow' must walk parentUuidStack looking for level === 'L1', never take stack[0]"
  - "Issue 6 prevention (async race): every async action that mutates shared state must gate its commit on fetchGeneration — capture at start, check at end. Works for all Tauri invoke() callers since there's no native cancellation"
  - "Double-click drill-in pattern: guard on node.data.level !== 'L4' (atoms go to inspector, not drill), read fresh node via getNode() for measured dims, setCenter with smooth duration, pushParent"

requirements-completed: [GRAPH-02, GRAPH-04, GRAPH-05, DATA-05]

# Metrics
duration: 5 min
completed: 2026-04-24
---

# Phase 03 Plan 02: Hierarchical Graph + Drill-In + Ghost Refs Summary

**Five-level hierarchical React Flow canvas with smooth drill-in zoom, breadcrumb navigation, race-safe lens-aware fetch, and DATA-05 ghost refs anchored under the ADDITIONAL flow's L1 (not the canonical's parent)**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-24T09:12:45Z
- **Completed:** 2026-04-24T09:18:02Z
- **Tasks:** 2
- **Files modified:** 11 (3 created, 8 modified)

## Accomplishments

- Three new Tauri commands (`get_edges`, `get_lens_nodes`, `rebuild_ghost_refs`) land in `commands/graph.rs`, all reading from the existing Phase 2 schema — no migration, no schema change.
- DATA-05 ghost-ref derivation with correct anchoring — `ghost.parent_uuid = nf.flow_uuid` (the additional flow's L1 anchor) so ghosts render under the OTHER L1 box per GRAPH-04's demo story. SQL inspection confirms `nf.flow_uuid,` appears on the line immediately after `n.code_ranges,` in the INSERT. Runtime sanity check logs a warning if any ghost shares parent_uuid with its canonical (regression guard).
- Idempotent rebuild via `BEGIN → DELETE WHERE is_canonical=0 → INSERT → COMMIT`; deterministic ghost UUID (`ghost-{canonical}-{flow}`) adds defence-in-depth so even without the DELETE step, re-runs collapse to the same row set.
- `hydrate_node_rows` extracted as a `pub fn` helper so `get_lens_nodes` reuses the 14-column decode without duplicating it. `get_nodes` now calls the helper — pure refactor, public signature unchanged.
- TS store extended with `parentUuidStack` + `pushParent/popParent/resetParents` drill actions, `getCurrentFlowUuid(stack, nodes)` helper that walks the stack for the first L1 ancestor (Issue 3 fix — stack[0] is always L0 once anything is pushed), and `fetchGeneration` last-click-wins counter (Issue 6 fix — rapid lens toggles commit only the final click).
- `setLens` is now async and re-fetches via the correct lens path. Journey with an L1 in the stack → `getLensNodes({journey, flowUuid})`; Journey at root → `getNodes()` fallback (no zero-row trap); System/Ownership → `getLensNodes` catch-all returns all nodes (placeholder per Phase 3 success criterion 5).
- `GraphCanvasInner` rebuilt with hierarchical layout via `parentId + extent:'parent'`, parents-before-children sort by `LEVEL_ORDER` (Pitfall 3), edge fetch via `getEdges()` on rows change, and double-click drill-in (`setCenter({zoom:1.5, duration:600})` + `pushParent`) for L0–L3 (L4 is a no-op — Phase 4 Monaco inspector owns that). Pitfall 9's deferred-fitView pattern preserved.
- `Breadcrumb` component mounted inside the ReactFlowProvider above the canvas; reads `parentUuidStack` from the store, maps uuids → display names, clicks pop + animate back. `goRoot` does `resetParents + fitView({duration: 500})`.
- `rebuildGhostRefs` wired in three places: `pickAndOpenRepo` post-scan, the watcher `onRefreshed` callback (so sidecar edits refresh ghosts before UI re-fetch), and `graphStore.refreshNodes` (defence-in-depth). The transaction makes it idempotent so extra calls are harmless.
- `cargo check`, `cargo test`, `npx tsc --noEmit`, and `npm run build` all exit 0.

## Task Commits

Each task was committed atomically:

1. **Task 1: Rust commands — get_edges + get_lens_nodes + rebuild_ghost_refs (transactional, idempotent, ghost.parent_uuid = additional flow's L1 anchor)** — `f0c46c8` (feat)
2. **Task 2: TS IPC + repo.ts wiring + hierarchical layout + drill-in zoom + breadcrumb + lens-aware fetch with race-safe last-click-wins** — `6a6471c` (feat)

## Files Created/Modified

- `contract-ide/src-tauri/src/commands/graph.rs` (new) — `get_edges` + `get_lens_nodes` + `rebuild_ghost_refs` with transactional idempotency + sanity-check assertion
- `contract-ide/src-tauri/src/commands/mod.rs` — registered `graph` module
- `contract-ide/src-tauri/src/commands/nodes.rs` — extracted `pub fn hydrate_node_rows` helper; `get_nodes` now calls it; added `use sqlx::sqlite::SqliteRow`
- `contract-ide/src-tauri/src/lib.rs` — added three new commands to `generate_handler!` via fully-qualified paths (Plan 01-02 convention)
- `contract-ide/src/ipc/graph.ts` (new) — `getEdges` / `getLensNodes` / `rebuildGhostRefs` TypeScript wrappers
- `contract-ide/src/ipc/types.ts` — added `GraphEdge` (mirrors Rust) + `LensRequestId` type
- `contract-ide/src/ipc/repo.ts` — imports `rebuildGhostRefs`; calls it after `open_repo` and inside the watcher `onRefreshed`; both non-fatal on failure
- `contract-ide/src/store/graph.ts` — added `parentUuidStack`, `pushParent/popParent/resetParents`, `fetchGeneration`, async `setLens`, `getCurrentFlowUuid` helper, lens-aware `refreshNodes` with last-click-wins gate
- `contract-ide/src/components/graph/GraphCanvasInner.tsx` — hierarchical layout (`buildHierarchicalNodes` with parents-before-children sort), edge fetch on rows change, `onNodeDoubleClick` drill-in, preserves Pitfall 9 mitigation
- `contract-ide/src/components/graph/Breadcrumb.tsx` (new) — drill-in breadcrumb; reads stack from store, click segment pops + animates back, click Root resets + fits
- `contract-ide/src/components/graph/GraphCanvas.tsx` — vertical flex with Breadcrumb above canvas, both inside `<ReactFlowProvider>`

## Decisions Made

- **Ghost parent_uuid = nf.flow_uuid (NOT n.parent_uuid):** this one-line SQL binding is the difference between "ghosts render under the SAME parent as the canonical (indistinguishable duplicate)" and "ghosts render under the OTHER flow's L1 (multi-flow demo story)." Enforced via verify-step grep (`nf.flow_uuid,` must follow `n.code_ranges,`) and a runtime sanity check that prints a WARNING if any ghost shares parent_uuid with its canonical when multi-flow nodes exist.
- **Primary flow = lex-min flow_uuid:** deterministic (content-hashed flow_uuids are stable across re-scans), no schema change (avoided adding `is_primary BOOL` to `node_flows`), and collapses to the same set on repeated calls. Non-primary flows get a ghost per (node, flow) pair.
- **`hydrate_node_rows` as a public helper:** not re-inlined; any future SELECT that returns the 14-column contract-node tuple can reuse it. Decisions about code_ranges/tags JSON defaults inherited verbatim from the original `get_nodes` loop so behaviour is bit-identical.
- **Journey at root falls back to `getNodes()`:** the Rust catch-all ALSO returns all nodes when flow_uuid is null, but the TS fallback keeps intent explicit and minimises the invoke payload. If Phase 4 ever adds real cost to `get_lens_nodes`, the bypass pays off.
- **`fetchGeneration` is global:** one counter for all async actions that mutate `nodes`. Mixed rapid clicks (lens toggle + drill refresh) share a single "most recent wins" semantics — matches the user's mental model and is simpler than per-path counters.
- **`rebuildGhostRefs` called in three places:** `pickAndOpenRepo` (post-scan), watcher `onRefreshed` (sidecar edits can change `node_flows`), and `graphStore.refreshNodes` (defence-in-depth). Transaction ensures idempotency so extra calls are cheap (O(corpus) but < ~1k rows at hackathon scale → sub-ms).
- **Edges fetched component-local, not in store:** `GraphCanvasInner` calls `getEdges()` in a `useEffect([rows])`. Keeping edges out of the store avoids an extra slice, avoids stale-closure bugs in the component, and avoids re-renders on selection changes. If Phase 4 needs edge data elsewhere, promote then.
- **Provider stays at GraphCanvas for now:** plan guidance — Plan 03-03 Task 1 will promote `<ReactFlowProvider>` to AppShell so Cmd+K can call `useReactFlow()`. Added a doc comment flagging the upcoming move so nobody "helpfully" adds a second provider.

## Deviations from Plan

None — plan executed exactly as written.

The plan was unusually defensive: each of the three "Issues" called out by the checker (Issue 1 ghost anchor, Issue 3 L1 resolution, Issue 6 lens race) was front-loaded with the exact fix pattern. The only textual deviation from the skeleton is the `DbPool` match pattern inside `graph.rs` — the plan showed `let DbPool::Sqlte(pool) = db else { ... };` refutable let-else, but to stay consistent with the in-repo style (Phase 02 STATE.md documents `match db { DbPool::Sqlite(p) => p, _ => Err(...) }`) the commands use the match pattern instead. Functional behaviour is identical.

## Issues Encountered

- A pre-existing uncommitted modification to `src-tauri/src/db/scanner.rs` (FTS5 rebuild after upsert — adds `INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')`) is unrelated to this plan and was left unstaged. This is a Phase 2 / Phase 5 concern for `find_by_intent`, not a Plan 03-02 change. Logged as a pending item to track separately.
- No functional bugs surfaced during `cargo check` or `npm run build`. The TS type surface and Rust command shapes matched cleanly on the first pass, including the `rebuildGhostRefs(): Promise<number>` return-type alignment with Rust's `u32`.

## User Setup Required

None — all changes are pure code (Rust commands + TS wrappers + React components). No new dependencies, no new env vars, no new migrations.

## Next Phase Readiness

- **Plan 03-03 (Cmd+K + perf UAT):** can proceed immediately. The `<ReactFlowProvider>` wraps GraphCanvas as documented; Plan 03-03 Task 1 will promote it to AppShell so the global Cmd+K palette shares the provider. Breadcrumb already reads live store state so it will continue to work after the provider move. `fetchGeneration` and `parentUuidStack` are the primitives Cmd+K "jump to node" will ride on.
- **Phase 4 (contract editor):** L4 double-click is a no-op today — Phase 4 will attach the Monaco inspector open handler there. The hook is already in `onNodeDoubleClick` (`if (node.data.level === 'L4') return;` — replace the `return` with the inspector open call).
- **Phase 7 (drift detection):** `ContractNode.state` still defaults to `'healthy'`; Phase 7 populates from `drift_state`. The cva variants (`drifted`, `untested`) from Plan 03-01 are ready.
- **Phase 9 demo:** when seed data includes a multi-flow L3/L4 node, `rebuild_ghost_refs` will materialise ghost rows under the secondary L1 and they'll render with the dashed border + 60% opacity variant. The visual story GRAPH-04 depends on lands end-to-end today.

## Self-Check: PASSED

- FOUND: contract-ide/src-tauri/src/commands/graph.rs
- FOUND: contract-ide/src/ipc/graph.ts
- FOUND: contract-ide/src/components/graph/Breadcrumb.tsx
- FOUND: commit f0c46c8 (Task 1)
- FOUND: commit 6a6471c (Task 2)

---
*Phase: 03-graph-canvas*
*Completed: 2026-04-24*
