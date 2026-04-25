---
phase: 03-graph-canvas
plan: 03
subsystem: ui
tags: [cmdk, command-palette, react-flow-provider, dagre, hierarchical-layout, group-nodes, perf]
status: complete

# Dependency graph
requires:
  - phase: 03-graph-canvas
    plan: 01
    provides: @xyflow/react canvas scaffold; module-level nodeTypes; ContractNode memo wrapper; onlyRenderVisibleElements; deferred fitView; graphStore.currentLens
  - phase: 03-graph-canvas
    plan: 02
    provides: hierarchical parentId layout (superseded by dagre); drill-in + breadcrumb; lens-aware fetch with fetchGeneration race guard; DATA-05 ghost refs
provides:
  - Cmd+K global command palette (cmdk 1.1.1) — Repository / Lens / Navigation / Jump-to-node action groups
  - ReactFlowProvider promoted from GraphCanvas to AppShell (single atomic commit — no intermediate state where palette mounts without provider in scope)
  - CommandPalette calls useReactFlow() unconditionally (no try/catch around hook calls — structural fix replaces broken defensive pattern)
  - Dagre-based two-pass hierarchical layout (bottom-up bbox sizing → top-down LR root distribution) — drive-by fix on top of Task 1
  - GroupNode variant for any row with in-set children; leaves keep ContractNode
  - extent:'parent' removed — dagre's bbox sizing makes clamping unnecessary; removing it fixed the 500-node stack-collapse bug
affects: [03-graph-canvas-checkpoint, 04-contract-editor, 07-drift-detection]

# Tech tracking
tech-stack:
  added:
    - "cmdk ^1.1.1 (with React 19 peer-dep override)"
    - "@dagrejs/dagre ^3.0.0 (ships own types, sync, ~13KB gzip)"
  patterns:
    - "Cmd+K global listener: document-level keydown with preventDefault BEFORE setOpen (Pitfall 7 — WebKit 'Search in page' consumption)"
    - "Provider promotion: ReactFlowProvider at AppShell root so all siblings (canvas + palette + breadcrumb + future Phase 4 inspector) resolve useReactFlow() from one provider — no nested providers"
    - "Unconditional hook call (no try/catch): Rules of Hooks require unconditional calls; try/catch around React hook errors is undefined behavior — the fix is structural (provider in scope), not defensive"
    - "cmdk React 19 override: package.json `overrides.cmdk.react: ^19` — runtime works, peer-dep is stale"
    - "Dagre two-pass layout: bottom-up computes each container's bbox from direct children; top-down lays out roots LR. Groups sized to fit children + padding — no extent:'parent' clamping needed"
    - "Grid fallback above dagre threshold: dagre without edge input collapses to a single rank (ugly for 100-child groups). Threshold = 12; above that, square-ish grid (cols = ceil(sqrt(n)))"
    - "Group node variant: bordered sized rectangle with absolute-positioned header; Handles kept invisible for edge-routing connectivity"

key-files:
  created:
    - contract-ide/src/components/command-palette/CommandPalette.tsx
    - contract-ide/src/components/command-palette/actions.ts
    - contract-ide/src/components/command-palette/commandPalette.css
    - contract-ide/src/components/graph/layout.ts
    - contract-ide/src/components/graph/GroupNode.tsx
  modified:
    - contract-ide/package.json
    - contract-ide/package-lock.json
    - contract-ide/src/components/layout/AppShell.tsx
    - contract-ide/src/components/graph/GraphCanvas.tsx
    - contract-ide/src/components/graph/GraphCanvasInner.tsx
    - contract-ide/src/components/graph/nodeTypes.ts
    - contract-ide/src/components/layout/ChatPanel.tsx

key-decisions:
  - "ReactFlowProvider lives in AppShell (not GraphCanvas) so the global Cmd+K palette can call useReactFlow() without either (a) a nested-provider state desync or (b) a try/catch around the hook call (undefined behavior). Breadcrumb + canvas still resolve from the same provider tree — zero functional change beyond scope"
  - "useReactFlow() in CommandPalette is unconditional — no try/catch. React hook errors are not catchable that way; the correct fix is provider-scope hoisting (Step 1), not defensive wrapping"
  - "cmdk 1.1.1 peer-dep override in package.json vs. --legacy-peer-deps: override is persistent (survives `npm install` in fresh clones); one-off flag doesn't"
  - "Dagre replaces hand-rolled 4-column grid (Plan 03-02) — the grid was acceptable at ~25 demo nodes but collapsed when combined with extent:'parent' at 500 children per parent. RESEARCH §Don't Hand-Roll flagged auto-layout as deferrable; drive-by lifts the deferral now that perf UAT needs it"
  - "Group node is a separate node type (not same-type-different-render) because leaf and container have fundamentally different shapes: leaves are fixed 180×56 with a styled label; containers are dagre-sized with an absolute-positioned header and children inside. Splitting the types keeps the memo invalidation boundaries clean"
  - "Drop extent:'parent' entirely — the clamping was the stack-collapse bug. Dagre's bottom-up sizing ensures parents are always ≥ their children's bbox + padding, so children never need clamping. If a future change introduces a parent that could undersize, the children render outside their parent (visibly broken) rather than silently stacking — preferred failure mode"
  - "Grid fallback at kids.length > 12: dagre without edge input puts all children at rank 0 (single row). 100 children × 220px step = 22,000px wide — unusable. Fallback to sqrt-cols grid; still produces dagre's desired 'orderly rectangle' aesthetic at scale without the single-rank collapse"
  - "Graph visual design polish (node typography, group header treatment, edge styling, color palette refinement) explicitly deferred to a future polish phase per user decision during checkpoint — NOT a Phase 3 gap. Phase 3 ships functional graph with dagre layout; visual polish is a Phase 9 (demo polish) concern"

requirements-completed: [SHELL-03, GRAPH-03]

# Metrics
duration: ~45min (Task 1 + drive-by dagre fix + checkpoint UAT + finalization)
completed: 2026-04-24
---

# Phase 03 Plan 03: Cmd+K Palette + Dagre Layout Fix Summary

**Cmd+K command palette (cmdk 1.1.1 + React 19 override) mounted at AppShell with promoted ReactFlowProvider; drive-by dagre hierarchical layout + group-container node variant fixed the 500-node stack-collapse bug surfaced during UAT; Phase 3 end-to-end human-verify checkpoint approved 2026-04-24.**

## Status

**Complete.** All three tasks landed. Task 1 (CommandPalette + provider hoist) committed `cad67b5`; drive-by dagre layout committed `60d2417`; Task 2 (Phase 3 end-to-end UAT human-verify checkpoint) approved by user on 2026-04-24.

## Accomplishments

### Task 1 — Command palette + provider promotion (commit `cad67b5`)

- `ReactFlowProvider` lifted from `GraphCanvas.tsx` to `AppShell.tsx` in a single atomic commit so there is no intermediate state where `CommandPalette` mounts without a provider in scope and crashes with "ReactFlowProvider missing."
- `cmdk` 1.1.1 installed with a persistent React 19 peer-dep override in `package.json` (Pitfall 4 — cmdk's stale `react: ^18` peer-dep would otherwise ERESOLVE on a fresh install).
- `CommandPalette` calls `useReactFlow()` unconditionally — no `try/catch` around the hook. React hook errors are not catchable that way (the pattern is undefined behavior); the structural fix is provider scope, now guaranteed by Step 1.
- Action groups: **Repository** (Open repository…), **Lens** (Journey / System / Ownership — calls `useGraphStore.getState().setLens`), **Navigation** (Focus chat panel — calls `chatPanelRef.current?.expand?.()`), **Jump to node** (populated from `useGraphStore.nodes`, on select calls `selectNode` + `setCenter`).
- Global keydown listener calls `e.preventDefault()` BEFORE `setOpen` so WebKit's "Find in page" cannot race the palette open (Pitfall 7).

### Drive-by — Dagre hierarchical layout + group-container nodes (commit `60d2417`)

See "Drive-by: dagre layout fix" section below.

### Task 2 — Phase 3 end-to-end UAT human-verify checkpoint (approved 2026-04-24)

**Human-verified 2026-04-24. Cmd+K functional checks passed. 500-node perf tested; layout bug surfaced and fixed via drive-by dagre commit. Visual design polish deferred to future phase per user — not a Phase 3 gap.**

Specifically:
- SHELL-03 functional sweep (steps 2-8): Cmd+K toggles cleanly on macOS; WebKit "Find in page" does not flash; `journey` / `open` / `focus` / node-name filters all filter and select correctly; Escape + re-Cmd+K toggle path works.
- Plan 03-02 hierarchical / drill-in / breadcrumb sanity (steps 9-11): L2 children visibly render inside L1 group rectangles; double-click drill-in animates smoothly; breadcrumb pops on root click and resets to fit-view.
- DATA-05 ghost-ref sanity (step 12): dashed-border ghost copies anchor under SECONDARY flow's L1 (not under canonical's parent); no "WARNING: N ghost rows share parent_uuid" stderr messages.
- GRAPH-03 500-node perf (steps 13-17): after the dagre drive-by fix, 5 L1 groups × 100 L2 children each render as side-by-side ~2200×1000 rectangles with 10×10 grid interiors. Pan/zoom remains smooth at real demo scale; `onlyRenderVisibleElements` virtualization keeps mounted DOM count low. User-approved — visible stutter from the pre-fix stack collapse is eliminated.
- `rebuild_ghost_refs` idempotency (step 18): two sequential invocations return identical row counts; no SQL errors.

Deferred-to-future-phase (per user decision during checkpoint, NOT a Phase 3 gap):
- Graph visual design polish (node typography weights, group header styling, edge stroke treatment, refined color palette, selected-state ring visuals). Phase 3 ships a functional graph with correct dagre layout; visual polish is a Phase 9 (demo polish) concern.

## Task Commits

| Task | Name | Commit |
|------|------|--------|
| 1 | CommandPalette + ReactFlowProvider hoist to AppShell | `cad67b5` |
| Drive-by | Dagre hierarchical layout + GroupNode variant | `60d2417` |
| — | Stub mid-execution SUMMARY (pre-checkpoint) | `996bc2d` |
| 2 | Phase 3 end-to-end UAT (human-verify) | *no code commit — approval noted inline; finalization commit follows* |

---

## Drive-by: dagre layout fix

**Trigger.** During Plan 03-03 checkpoint UAT prep (500-node perf repo at `/tmp/phase3-perf` with 5 L1 parents × 100 L2 children), all 500 L2 children stacked at one screen position and the canvas dropped well below 50fps.

**Root cause.** `extent: 'parent'` in `buildHierarchicalNodes` (Plan 03-02) clamped children into the L1 parent's fixed rectangle. But parents were small `<ContractNode>` cards (~180×40px). 100 children clamped into that footprint → visual stack + overdraw. The hand-rolled 4-column grid was acceptable at 25 demo nodes but did not generalize.

**RESEARCH reference.** Plan 03-02's research deferred auto-layout ("Don't Hand-Roll" table) to v2 on the assumption of <100 hand-curated nodes per level. The perf checkpoint lifts that assumption, so the deferral is lifted too. Dagre is synchronous, typed, ~13KB gzip, and is the industry standard for this shape of layout — no other candidate.

**Fix.**

- **`contract-ide/src/components/graph/layout.ts` (new).** Two-pass layout:
  - **Pass 1 (bottom-up).** For each node with children, either run dagre on its direct children (≤12 children) OR lay them out in a square-ish grid (>12 children). The threshold exists because dagre without edge input puts every node at rank 0 — a single-row horizontal strip, which is unusable at 100+ children. Grid at scale is both faster and visually cleaner. Container is sized to the children's bbox + padding (`GROUP_PADDING_X` / `GROUP_PADDING_TOP` / `GROUP_PADDING_BOTTOM`).
  - **Pass 2 (top-down).** Roots (nodes with no parent in the row set) laid out LR with dagre — for the perf repo which has no L0, this places the 5 L1 groups side-by-side in parallel lanes instead of a tall stack.
  - Output: flat `LayoutNode[]` with absolute coords for roots, relative-to-parent coords for children, `isGroup` hint per node, sorted parents-before-children for Pitfall 3 safety.
- **`contract-ide/src/components/graph/GroupNode.tsx` (new).** `group` node variant — bordered/sized rectangle with an absolute-positioned header label (level + name). Handles kept (`!opacity-0`) so cross-group edges still have endpoints. Module-level + `React.memo` (Pitfall 1).
- **`contract-ide/src/components/graph/nodeTypes.ts` (modified).** Added `group: GroupNode` to the module-level const.
- **`contract-ide/src/components/graph/GraphCanvasInner.tsx` (rewritten).**
  - `buildFlowNodes` replaces `buildHierarchicalNodes` — feeds rows through `layoutNodes`, picks `contract` vs `group` type based on `isGroup`, carries `width`/`height`/`style` on group nodes so React Flow routes edges around the full container rather than a 0-size header.
  - **`extent: 'parent'` removed entirely.** `parentId` preserved so React Flow keeps the nested-sub-flow semantics (drag-together, child positions relative to parent).
  - `minZoom` dropped from `0.1` → `0.05` + `defaultViewport.zoom` from `0.8` → `0.3` so the ~11,000px-wide 5-L1 perf layout fits on first paint and the user can pinch out far enough to see the whole graph.
  - Double-click drill-in uses `measured ?? width ?? fallback` for the center calc so group nodes (which carry explicit `width`) zoom correctly.
- **`contract-ide/package.json`.** `@dagrejs/dagre ^3.0.0` added.

**Files modified.**

- `contract-ide/package.json` + `package-lock.json` (dagre dep)
- `contract-ide/src/components/graph/layout.ts` (created)
- `contract-ide/src/components/graph/GroupNode.tsx` (created)
- `contract-ide/src/components/graph/nodeTypes.ts` (added `group` type)
- `contract-ide/src/components/graph/GraphCanvasInner.tsx` (rewrote layout path)

**Verification.**

- `cd contract-ide && npx tsc --noEmit` exits 0
- `cd contract-ide && npm run build` exits 0 (bundle +0.4KB gzipped — dagre tree-shook cleanly)
- `cargo check` exits 0 (no Rust changes)
- Checkpoint confirmed on running dev Tauri window: 5 visible L1 groups each containing 100 L2 leaves, no stacking; pan/zoom smooth under screen recording.

**Perf observation.**

The prior failure mode (all 500 children at one screen position with overdraw pinning CPU) is structurally impossible now: each L1 group's bbox is computed from the 10×10 grid + padding, so children land at distinct coordinates with no clamping in play. Combined with `onlyRenderVisibleElements` (already on since Plan 03-01), the canvas sustains the demo-perf target under pan/zoom because virtualization only keeps the viewport's subset mounted at any moment. 500 leaves rendered across ~11,000 horizontal px at default zoom means any single viewport-sized region contains well under 100 mounted DOM nodes.

**Scope kept narrow.** No changes to `graphStore` (fetchGeneration, refreshNodes, lens-aware fetch all untouched); no changes to Rust IPC; no changes to Breadcrumb, CommandPalette, AppShell, or drill-in logic beyond the measured-dimension fallback in `onNodeDoubleClick`. The drive-by is purely a layout-pipeline replacement.

**Commit:** `60d2417` — `fix(03-03): dagre hierarchical layout + group container nodes`

---

## Deviations from Plan

### Drive-by (discovered during checkpoint UAT prep)

- **[Rule 1 — Bug] Replaced hand-rolled 4-column grid + `extent:'parent'` with dagre.** See "Drive-by: dagre layout fix" above. Fix was unavoidable for GRAPH-03 perf criterion; cannot pass checkpoint step 13-16 (500-node sub-flow perf sweep) with the broken clamping in place. RESEARCH §Don't Hand-Roll had flagged auto-layout as deferrable; 500-node UAT lifted that assumption. Committed as `60d2417` inside Plan 03-03 rather than a new plan because the fix is within the plan's files-modified envelope (adds to the same `contract-ide/src/components/graph/` surface) and Task 2 hadn't been closed yet.

### Task 1 (committed in `cad67b5`)

*(Task 1 landed without deviations per its commit note — ReactFlowProvider hoist + cmdk install + CommandPalette mount all executed exactly per plan Steps 1-6.)*

### Task 2 (checkpoint UAT — approved 2026-04-24)

Approved with one user-directed scope note: graph visual design polish (node typography, group header treatment, edge styling, refined palette) is explicitly deferred to a future polish phase (Phase 9 demo polish). Not treated as a Phase 3 gap — Phase 3 ships functional graph with correct dagre layout and all success criteria satisfied.

---

## Issues Encountered

- Dagre 3.0 without edge input places every node at rank 0 — a single 100-wide horizontal row for the perf repo's L2 children. Caught during design review of `layout.ts`; resolved by switching to a square-ish grid above `DAGRE_THRESHOLD = 12`. If future work adds real neighbor edges, dagre's edge-aware ranking will kick in for small child counts; large groups stay on the grid path regardless.
- `@dagrejs/dagre` 3.0's types ship the `dagre.graphlib.Graph` constructor on the default export, not a named `Graph` export — usage is `new dagre.graphlib.Graph({ ... })`. Documented inline in `layout.ts` via the `import * as dagre` pattern.
- 500-node layout stack-collapse bug surfaced during UAT (not caught by build verification in Plan 03-02). Addressed inline via the dagre drive-by; RESEARCH note updated that auto-layout deferral assumptions need recheck whenever a perf checkpoint lifts the hand-curated-scale assumption.

## User Setup Required

None — `@dagrejs/dagre` is a pure npm dep, no external service, no env vars.

## Follow-ups / Deferred

- **Graph visual design polish** (user-directed, 2026-04-24): node typography weights, group header treatment, edge stroke styling, refined color palette, selected-state ring visuals. Deferred to Phase 9 (demo polish). NOT a Phase 3 gap — filed here for traceability only.

---

## Self-Check: PASSED

- FOUND: contract-ide/src/components/command-palette/CommandPalette.tsx
- FOUND: contract-ide/src/components/command-palette/actions.ts
- FOUND: contract-ide/src/components/command-palette/commandPalette.css
- FOUND: contract-ide/src/components/graph/layout.ts
- FOUND: contract-ide/src/components/graph/GroupNode.tsx
- FOUND: contract-ide/src/components/graph/nodeTypes.ts (group type added)
- FOUND: contract-ide/src/components/graph/GraphCanvasInner.tsx (rewrote layout path)
- FOUND: contract-ide/package.json (cmdk + dagre deps + React 19 override)
- FOUND: commit `cad67b5` (Task 1 — palette + provider hoist)
- FOUND: commit `60d2417` (drive-by — dagre layout + GroupNode)
- FOUND: commit `996bc2d` (stub mid-execution SUMMARY)
- VERIFIED: Task 2 checkpoint approved by user 2026-04-24 (no code commit — approval noted inline above)

*Phase: 03-graph-canvas*
*Plan: 03 — complete 2026-04-24 (Task 1 + drive-by + UAT checkpoint all landed)*
