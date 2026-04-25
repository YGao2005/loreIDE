---
phase: 03-graph-canvas
plan: 01
subsystem: ui
tags: [react-flow, xyflow, zustand, cva, graph-canvas, virtualization]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: AppShell three-pane layout, Tailwind v4 + shadcn theme, react-resizable-panels percentage-string API
  - phase: 02-contract-data-layer
    provides: useGraphStore.refreshNodes (SQLite-backed), ContractNode IPC row type, pickAndOpenRepo + watcher flow
provides:
  - Real @xyflow/react canvas mounted inside GraphPlaceholder (dotted L0-L3 grid gone)
  - Memoized ContractNode custom component with cva kind/state/canonical variant matrix (GRAPH-04)
  - Module-level nodeTypes const + memo() wrapper — Pitfall 1 prevention baked in day-one
  - onlyRenderVisibleElements enabled from first commit per STATE.md decision (GRAPH-03)
  - defaultViewport + deferred imperative fitView() — Pitfall 9 mitigation for virtualized first-paint
  - graphStore.currentLens + setLens slice; sidebar reads/writes it (no more local useState)
  - ReactFlowProvider wrapping the canvas so future useReactFlow() callers don't blow up (Pitfall 8)
affects: [03-graph-canvas-02, 03-graph-canvas-03, 04-contract-editor, 07-drift-detection]

# Tech tracking
tech-stack:
  added: ["@xyflow/react ^12.10.2"]
  patterns:
    - "Custom node: module-scope component wrapped in React.memo + module-level nodeTypes const (Pitfall 1)"
    - "fitView on virtualized canvas: setTimeout(fitView, 100) from useEffect keyed on row count, never bare `fitView` prop (Pitfall 9)"
    - "defaultViewport always set so first paint is non-blank even before any node measures"
    - "cva variant matrix for visual encoding (kind x state x canonical); boolean canonical key not stringified"
    - "ReactFlowProvider wraps canvas so future breadcrumb/Cmd+K useReactFlow() calls in sibling components work (Pitfall 8)"
    - "GraphPlaceholder drives AsyncState from useGraphStore.getState() in async flows — component itself does not subscribe; the canvas subscribes"

key-files:
  created:
    - contract-ide/src/components/graph/GraphCanvas.tsx
    - contract-ide/src/components/graph/GraphCanvasInner.tsx
    - contract-ide/src/components/graph/ContractNode.tsx
    - contract-ide/src/components/graph/contractNodeStyles.ts
    - contract-ide/src/components/graph/nodeTypes.ts
  modified:
    - contract-ide/package.json
    - contract-ide/package-lock.json
    - contract-ide/src/index.css
    - contract-ide/src/store/graph.ts
    - contract-ide/src/components/layout/GraphPlaceholder.tsx
    - contract-ide/src/components/layout/Sidebar.tsx

key-decisions:
  - "cva `canonical` variant uses boolean keys (true/false), not strings — TypeScript treats stringified variant keys as boolean literals when inferred from variant object so `canonical: 'true'` fails TS2322 at the call site; passed `d.isCanonical` directly instead"
  - "NodeProps is NOT parameterized with ContractNodeData in the function signature — @xyflow/react v12 NodeProps generic changed shape vs v11 and a typed narrow triggered a TS variance error. Keep the prop untyped at the boundary and narrow via `const d = data as ContractNodeData` in the body; revisit when upgrading to 12.11+"
  - "GraphPlaceholder async flows use useGraphStore.getState() (not the hook) so the component is not re-rendered by every node refresh — only AsyncState transitions drive its render. Canvas subscribes to nodes directly"
  - "Provider scope: ReactFlowProvider currently wraps only GraphCanvas; Plan 03-03 Task 1 will promote it to AppShell so the global Cmd+K palette can call useReactFlow() without a secondary provider"
  - "fitView is deferred via setTimeout(..., 100) inside a useEffect keyed on rows.length, NOT the bare `fitView` JSX prop (which races with onlyRenderVisibleElements — virtualized nodes have no measured dimensions on first paint → fits to empty bbox)"
  - "defaultViewport={{x:0,y:0,zoom:0.8}} is load-bearing for Pitfall 9 — without it the first frame is blank while waiting for the deferred fitView"
  - "LENSES array decouples LensId ('journey') from visible label ('Journey') so the store key can be lowercased (API-friendly) while the UI stays capitalised"

patterns-established:
  - "Pitfall 1 prevention pattern: custom node components live at module scope with React.memo(); nodeTypes is a sibling module-level const; JSX passes the const by reference — never inline `{{ contract: ContractNode }}`"
  - "Pitfall 9 prevention pattern: defaultViewport + useEffect(setTimeout(fitView, 100)) keyed on row count replaces the bare `fitView` JSX prop whenever onlyRenderVisibleElements is on"
  - "Data subscription pattern: global store (Zustand) for node rows; the ReactFlow-mounting component subscribes with a narrow selector (rows only); the AsyncState-driving component uses getState() inside async flows to avoid re-renders on every refresh"
  - "Provider promotion pattern: start with ReactFlowProvider wrapping only the canvas in one plan; promote to AppShell in a later plan when a second component needs useReactFlow(). Avoid defensive try/catch around hook throws (not catchable)"

requirements-completed: [GRAPH-01, GRAPH-03, GRAPH-04, GRAPH-05]

# Metrics
duration: ~15min
completed: 2026-04-24
---

# Phase 03 Plan 01: Graph Canvas Scaffold Summary

**Real @xyflow/react canvas mounted in GraphPlaceholder with memoized ContractNode + module-level nodeTypes + onlyRenderVisibleElements + deferred fitView; graphStore extended with currentLens slice wired to sidebar**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-24T08:53:00Z
- **Completed:** 2026-04-24T09:08:07Z
- **Tasks:** 2
- **Files modified:** 11 (5 created, 6 modified)

## Accomplishments

- Dotted L0/L1/L2/L3 placeholder grid replaced by a live react-flow canvas that renders one node per row in useGraphStore.nodes
- Day-one performance discipline in place: `onlyRenderVisibleElements` prop on the ReactFlow component, module-level `nodeTypes` const, `React.memo` on ContractNode (no warning fires, no phantom remounts)
- Pitfall 9 mitigation (defaultViewport + useEffect-deferred imperative fitView) prevents the classic blank-viewport race where virtualization returns zero-dimension nodes on first paint
- Visual encoding matrix via `cva`: kind (UI/API/data/job/unknown) colours, state (healthy/drifted/untested) ring+opacity, canonical/ghost solid vs dashed border — all four variants from GRAPH-04 usable today even though only `healthy`/`canonical=true` data exists in Phase 3
- Lens switcher reads/writes `useGraphStore.currentLens` (Journey default; System/Ownership selectable without crashing) — Plan 03-02 can now drive lens-aware `get_nodes` without retrofitting state
- `ReactFlowProvider` wraps the canvas so Plan 03-02's breadcrumb hover and Plan 03-03's Cmd+K palette can call `useReactFlow()` from sibling mounts
- `npm run build` green end-to-end (tsc + vite)

## Task Commits

Each task was committed atomically:

1. **Task 1: Install @xyflow/react + scaffold graph module + extend graphStore** - `b2f1528` (feat)
2. **Task 2: Mount GraphCanvas in GraphPlaceholder + wire Sidebar lens to graphStore** - `6704370` (feat)

## Files Created/Modified

- `contract-ide/src/components/graph/GraphCanvas.tsx` (new) — public mount point; wraps inner canvas in ReactFlowProvider
- `contract-ide/src/components/graph/GraphCanvasInner.tsx` (new) — ReactFlow mount; onlyRenderVisibleElements + defaultViewport + deferred fitView; empty edges (Plan 03-02 adds get_edges)
- `contract-ide/src/components/graph/ContractNode.tsx` (new) — memoized custom node with Handles + cva-driven styling
- `contract-ide/src/components/graph/contractNodeStyles.ts` (new) — cva matrix for kind/state/canonical variants + normalizeKind helper + NodeHealthState type
- `contract-ide/src/components/graph/nodeTypes.ts` (new) — module-level `{ contract: ContractNode }` const (Pitfall 1)
- `contract-ide/src/index.css` — added `@import '@xyflow/react/dist/style.css'` at top (Pitfall 2)
- `contract-ide/src/store/graph.ts` — added `LensId` type + `currentLens` + `setLens`
- `contract-ide/src/components/layout/GraphPlaceholder.tsx` — replaced dotted L0-L3 grid with `<GraphCanvas />`; async flows now call `useGraphStore.getState().refreshNodes()` instead of local `setNodes`
- `contract-ide/src/components/layout/Sidebar.tsx` — removed local `useState<Lens>`; reads `currentLens` + calls `setLens` from store; LENSES array decouples id from label
- `contract-ide/package.json` + `package-lock.json` — `@xyflow/react ^12.10.2` dependency

## Decisions Made

- **cva boolean variant keys for `canonical`:** plan skeleton used string keys `canonical: 'true' | 'false'` but TypeScript interprets them as boolean literal keys in a cva config, causing TS2322 at both the defaultVariants declaration and the ContractNode call site. Switched to actual booleans and passed `d.isCanonical` directly. Variant values (empty string for canonical, `border-dashed opacity-60` for ghost) unchanged — purely a type-system fix.
- **NodeProps untyped at the function signature:** @xyflow/react v12 changed the NodeProps generic shape vs v11 and `NodeProps<ContractNodeData>` triggers a variance error when passed to `memo()`. Using `NodeProps` without a type parameter and narrowing inside with `const d = data as ContractNodeData` is the idiomatic v12 pattern and compiles clean. Added `[key: string]: unknown` to `ContractNodeData` so it is assignable to xyflow's record constraint.
- **GraphPlaceholder does NOT subscribe to the store:** using `useGraphStore.getState()` inside async flows lets the component drive AsyncState transitions (loading → ready/empty/error) without re-rendering on every refreshNodes. The canvas subscribes to `s.nodes` via selector and is the sole consumer of node data updates.
- **Provider stays at GraphCanvas for now:** per plan guidance, Plan 03-03 Task 1 will move it to AppShell when Cmd+K needs useReactFlow(). Added a doc comment to GraphCanvas.tsx flagging the upcoming move so nobody "helpfully" adds a second provider later.
- **`bare fitView` prop intentionally omitted:** documented in a block comment inside GraphCanvasInner.tsx so a future patch does not reintroduce it. The useEffect+setTimeout pattern produces the same initial-framing result without the virtualization race.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] cva `canonical` variant used string keys that failed TypeScript**
- **Found during:** Task 1 (running `npx tsc --noEmit` after creating contractNodeStyles.ts + ContractNode.tsx)
- **Issue:** Plan skeleton declared `canonical: { true: '', false: 'border-dashed opacity-60' }` and `defaultVariants: { canonical: 'true' }` and the call site passed `canonical: d.isCanonical ? 'true' : 'false'`. `class-variance-authority` 0.7 infers variant keys spelled `true`/`false` as boolean literals — passing the string `'true'` then fails with TS2322: "Type 'string' is not assignable to type 'boolean | null | undefined'".
- **Fix:** Left the variant definition untouched (JavaScript object keys `true`/`false` are fine as identifiers), changed `defaultVariants.canonical` from `'true'` → `true` (boolean), and simplified the call site from `d.isCanonical ? 'true' : 'false'` → `d.isCanonical` (boolean passthrough).
- **Files modified:** contract-ide/src/components/graph/contractNodeStyles.ts, contract-ide/src/components/graph/ContractNode.tsx
- **Verification:** `npx tsc --noEmit` exits 0; all cva variant combinations still produce the intended classnames at runtime (boolean keys in JS object literals round-trip to the string-form lookup cva performs internally).
- **Committed in:** b2f1528 (Task 1 commit)

**2. [Rule 3 — Blocking] `NodeProps<ContractNodeData>` generic incompatible with memo() in @xyflow/react v12**
- **Found during:** Task 1 (TS error cascade after fixing canonical variant)
- **Issue:** Plan skeleton typed the custom node signature as `({ data }: NodeProps<ContractNodeData>)`. @xyflow/react v12's `NodeProps` generic expects a `Record<string, unknown>`-like index-signature, and ContractNodeData lacks one, causing the Node<ContractNodeData> used inside GraphCanvasInner to blow up variance checks when the memo-wrapped component is assigned to `nodeTypes.contract`.
- **Fix:** (a) Added `[key: string]: unknown` to `ContractNodeData` so it is assignable to xyflow's record constraint; (b) dropped the generic parameter from the function signature — kept plain `NodeProps` and narrowed in the body via `const d = data as ContractNodeData`. This is the pattern xyflow v12 uses in its own examples.
- **Files modified:** contract-ide/src/components/graph/ContractNode.tsx
- **Verification:** `npx tsc --noEmit` exits 0; `npm run build` passes; props are still narrowed and field access is typed via `d.name`, `d.kind`, etc.
- **Committed in:** b2f1528 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking TypeScript errors)
**Impact on plan:** Both fixes are adjustments to the plan skeleton's type annotations, not structural changes. The runtime behaviour, file shape, and task boundaries match the plan exactly. The cva variant matrix, memo wrapper, module-level nodeTypes, onlyRenderVisibleElements, and deferred fitView are all in place as specified. Worth noting in STATE.md so Phase 3 Plan 2+3 use the same NodeProps pattern.

## Issues Encountered

- Pre-existing uncommitted local modification to GraphPlaceholder.tsx (Switch Repo button added earlier) was preserved across the Task 2 rewrite — no regression.
- `@import` positioning in index.css: the file already had a non-`@import` rule block (`html, body, #root`) before the existing `@import "tailwindcss"` declarations, pre-dating this plan. Added the xyflow CSS import AT THE VERY TOP (line 1) per plan guidance; existing ordering untouched because `vite`+`tailwindcss` handle this idiom in practice (vite build green).

## User Setup Required

None — `@xyflow/react` is a pure npm dependency, no external services or env vars.

## Next Phase Readiness

- Plan 03-02 (drill-in + ghost refs + real Journey lens): can proceed immediately. `ReactFlowProvider` already wraps the canvas; `currentLens` is already in the store; the flat grid layout in `rowToFlowNode` is the exact shape Plan 03-02 will replace with parentId + `extent:'parent'` hierarchical layout.
- Plan 03-03 (Cmd+K + perf UAT): scaffold is correct for perf UAT. Provider needs to be promoted to AppShell in Plan 03-03 Task 1 before the global palette can call `useReactFlow()`.
- Phase 7 (drift detection): ContractNode.state defaults to `'healthy'` today; Phase 7 populates from `drift_state` column — cva variants `drifted` (ring-2 ring-red-500 animate-pulse) and `untested` (opacity-70) are already defined and ready.
- Phase 9 demo: when seed data includes a non-canonical ghost row (`is_canonical=false`), the dashed border + 60% opacity rendering is automatic — no additional work needed at demo time.

## Self-Check: PASSED

- FOUND: contract-ide/src/components/graph/GraphCanvas.tsx
- FOUND: contract-ide/src/components/graph/GraphCanvasInner.tsx
- FOUND: contract-ide/src/components/graph/ContractNode.tsx
- FOUND: contract-ide/src/components/graph/contractNodeStyles.ts
- FOUND: contract-ide/src/components/graph/nodeTypes.ts
- FOUND: commit b2f1528 (Task 1)
- FOUND: commit 6704370 (Task 2)

---
*Phase: 03-graph-canvas*
*Completed: 2026-04-24*
