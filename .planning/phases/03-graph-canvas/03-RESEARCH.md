# Phase 3: Graph Canvas — Research

**Researched:** 2026-04-24
**Domain:** `@xyflow/react` v12 graph rendering, virtualization, hierarchical/sub-flow layout, zoom transitions, lens projection, command palette (Cmd+K), DATA-05 ghost-ref derivation in SQLite
**Confidence:** HIGH (React Flow 12 APIs verified via reactflow.dev; cmdk verified via repo + GitHub issues; performance patterns triangulated across official docs + Synergy Codes guide + xyflow discussions)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| GRAPH-01 | User sees a zoomable five-level contract graph (L0 Product → L1 Flows → L2 Surfaces → L3 Components → L4 Atoms) rendered with `@xyflow/react` | Standard Stack §`@xyflow/react`; Architecture Patterns §Five-Level Hierarchy via parentId/extent; Code Examples §ReactFlow Bootstrap |
| GRAPH-02 | User zooms into a flow and child nodes reveal with smooth transitions; breadcrumb reflects current zoom position | Architecture Patterns §Zoom-Driven Detail Level; §Breadcrumb from Viewport+Selection; Code Examples §Animated Zoom-to-Node |
| GRAPH-03 | Graph renders performantly with virtualization (`onlyRenderVisibleElements`) for 500+ nodes | Standard Stack §`onlyRenderVisibleElements` flag (DAY-ONE per STATE.md decision); Architecture Patterns §Performance Discipline; Common Pitfalls §nodeTypes Stability |
| GRAPH-04 | Node visually encodes kind (UI / API / data / job), state (healthy / drifted / untested), and canonical vs ghost reference | Architecture Patterns §Custom Node Component; §Visual Encoding Matrix; Code Examples §Custom Node with Variants |
| GRAPH-05 | User filters the graph by lens — Journey (default, fully working), System and Ownership (at least toggleable, even if mocked) | Architecture Patterns §Lens Projection; §Journey Lens via node_flows; Code Examples §Lens Switch Selector |
| SHELL-03 | User opens a command palette with Cmd+K and runs core actions (open repo, toggle lens, focus chat, jump to node) | Standard Stack §`cmdk`; Architecture Patterns §Command Palette Architecture; Code Examples §Cmd+K Binding + Command.Dialog |
| DATA-05 | Canonical + reference model — shared nodes have one sidecar (`is_canonical=1`); ghost references are SQLite-only rows linked by `canonical_uuid`, regenerated from `node_flows` membership on rebuild | Architecture Patterns §Ghost-Ref Generation (rebuild_ghost_refs); Code Examples §rebuild_ghost_refs SQL; Phase 2 02-RESEARCH.md §Pattern 7 (deferred from Phase 2) |
</phase_requirements>

---

## Summary

Phase 3 is the first user-visible product feature: a zoomable five-level graph rendered by `@xyflow/react` v12.10.x, fed by the SQLite cache that Phase 2 already populates from `.contracts/` sidecars. Three classes of work dominate: (1) React Flow setup that is performance-correct from the first commit (`onlyRenderVisibleElements`, memoized `nodeTypes`, Zustand selectors with shallow equality) — STATE.md flags this as a critical Phase 3 day-one decision; (2) hierarchical L0–L4 modeling using React Flow's `parentId` + `extent: 'parent'` sub-flow pattern, with smooth `setCenter({ duration })` zoom transitions when a user drills into a flow; (3) integration plumbing — a Cmd+K command palette via `cmdk`, a Zustand-backed lens switcher (Journey is real, System/Ownership are stubs that don't crash), and a Rust-side `rebuild_ghost_refs()` IPC that derives `is_canonical=0` rows from `node_flows` membership (DATA-05, deferred from Phase 2 by 02-RESEARCH.md Open Question 4).

The data path is already established: Phase 2 ships `get_nodes(level, parent_uuid)` returning real rows, the watcher emits `contracts:updated` events, and the SQLite schema has `nodes`, `edges`, `node_flows`, `is_canonical`, `canonical_uuid` columns. Phase 3 adds `get_edges`, `get_lens_nodes(flow_uuid)`, and `rebuild_ghost_refs()` Rust commands plus the React Flow surface that consumes them. Nothing in Phase 3 requires touching the file watcher or the sidecar parser.

The two highest-risk areas are `cmdk` + React 19 peer-dependency friction (well-known: install with `--legacy-peer-deps` or use `overrides` in package.json — cmdk 1.1.1 works fine at runtime with React 19, only the peer-dep declaration is stale) and the ghost-ref query — getting `rebuild_ghost_refs()` to be idempotent under repeated calls so that the watcher firing during a drill-down doesn't duplicate rows.

**Primary recommendation:** Use `@xyflow/react` 12.10.x with `onlyRenderVisibleElements` set in the JSX from commit one, model L0–L4 via `parentId` + `extent: 'parent'` sub-flows (NOT custom nested ReactFlow instances), use `cmdk` 1.1.1 with explicit Cmd+K listener and React 19 peer-dep override, and ship `rebuild_ghost_refs()` as a single idempotent Rust command called after every scan and after lens membership changes.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@xyflow/react` | 12.10.2 (latest 2026-04) | Five-level zoomable graph canvas with built-in viewport, panning, virtualization | The de-facto React graph lib; `onlyRenderVisibleElements`, `parentId` sub-flows, `useReactFlow().setCenter({duration})` are all first-party — no DIY |
| `cmdk` | 1.1.1 | Cmd+K command palette (SHELL-03) | Industry standard (12.5k stars); used by Linear, Vercel, Raycast UI; unstyled + Tailwind-friendly; fuzzy search via `command-score`; works with Tauri (renders in WebKit identically to Chromium) |
| `zustand` | 5.0.12 (already installed) | Graph store (selected node, lens, zoom level, breadcrumb) | Already in stack from Phase 1; React Flow's own store is also Zustand — patterns transfer |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@xyflow/react`'s built-in store via `useStore`/`useStoreApi` | (bundled) | Subscribe to React Flow internal state with selectors | When you need viewport, transform, or selected-node IDs in components outside the canvas (e.g., breadcrumb) |
| `command-score` | (bundled with cmdk) | Fuzzy match for command palette items | Already inside cmdk; don't install separately |
| `class-variance-authority` (already installed) | 0.7.1 | Variant-driven className for custom node visual states | Phase 1 dep; use for the kind × state × canonical/ghost matrix in `ContractNode.tsx` |

### Deliberately Not Adding

| Library | Reason Not Adding |
|---------|-------------------|
| `dagre` / `elkjs` (auto-layout) | L0–L4 hierarchy is small and hand-curated; we position nodes manually via `parentId` + `extent: 'parent'`. Auto-layout adds 60KB+ and a layout phase that fights manual positioning. Defer to v2 if the graph grows past ~200 hand-positioned nodes. |
| `react-flow-renderer` (legacy) | Renamed to `@xyflow/react` in v11; only use `@xyflow/react`. The old package is unmaintained. |
| `react-cmdk` | Pre-styled, no fuzzy search; doesn't fit our shadcn aesthetic; cmdk wins. |
| `kbar` | Heavier API surface (actions registry); cmdk's component model integrates cleaner with our existing component tree. |
| `react-hotkeys-hook` | One Cmd+K listener inside the palette component is enough; pulling a hook lib for one binding is overkill. Use plain `addEventListener('keydown')`. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@xyflow/react` parentId sub-flows | Custom nested `<ReactFlow>` per level | Nested instances are explicitly documented as a "custom implementation" with disabled pan/zoom on the inner flow — works for grouping, breaks our zoom-into-flow-reveals-children UX; sub-flows via parentId+extent is the supported pattern |
| `cmdk` | Build custom palette on top of Radix `Dialog` | Reinventing fuzzy match + keyboard nav + accessibility; cmdk is 6KB and solves all three |
| Manual node positioning per level | `dagre` for L1+ flow layout | dagre's tree layout produces less control over the demo aesthetic; for ~25 demo nodes hand-positioning wins. Reassess at >100 nodes per level |

**Installation:**

```bash
# Frontend additions (run inside contract-ide/)
npm install @xyflow/react cmdk

# If npm complains about cmdk peer deps under React 19, use overrides:
# package.json:
#   "overrides": { "cmdk": { "react": "^19", "react-dom": "^19" } }
# OR install with: npm install cmdk --legacy-peer-deps
```

**No Rust deps added.** All Phase 3 backend work is new commands + queries against the existing SQLite schema.

---

## Architecture Patterns

### Recommended Project Structure (Phase 3 additions)

```
contract-ide/src/
├── components/
│   ├── graph/                       # NEW: all graph-canvas surface
│   │   ├── GraphCanvas.tsx          # ReactFlowProvider + ReactFlow w/ onlyRenderVisibleElements
│   │   ├── ContractNode.tsx         # Custom node component (memoized) — kind/state/canonical variants
│   │   ├── Breadcrumb.tsx           # Reads from graphStore (level + parent_uuid path)
│   │   ├── LensSwitcher.tsx         # MOVE from Sidebar.tsx if currently mocked there; wire to graphStore
│   │   └── nodeTypes.ts             # Stable nodeTypes map exported as MODULE-LEVEL const (Pitfall 1)
│   ├── command-palette/             # NEW: SHELL-03
│   │   ├── CommandPalette.tsx       # cmdk Command.Dialog + actions registry
│   │   └── actions.ts               # Action definitions (open repo, toggle lens, focus chat, jump to node)
│   └── layout/
│       ├── AppShell.tsx             # EXTEND: mount <CommandPalette /> at root
│       └── GraphPlaceholder.tsx     # REPLACE with real <GraphCanvas /> at end of phase
├── store/
│   ├── graphStore.ts                # NEW: Zustand — currentLens, currentLevel, parentUuidStack, selectedNodeUuid
│   └── (existing stores stay)
├── ipc/
│   ├── nodes.ts                     # EXTEND: add getEdges, getLensNodes wrappers
│   ├── graph.ts                     # NEW: rebuildGhostRefs() wrapper
│   └── types.ts                     # EXTEND: GraphEdge, LensId types
└── hooks/
    └── useGraphData.ts              # NEW: orchestrates getNodes + getEdges per current lens/level

contract-ide/src-tauri/src/
├── commands/
│   ├── nodes.rs                     # EXTEND: get_edges(level, parent_uuid), get_lens_nodes(flow_uuid)
│   └── graph.rs                     # NEW: rebuild_ghost_refs (idempotent — DELETE WHERE is_canonical=0 then INSERT from node_flows)
└── lib.rs                           # EXTEND: register new commands in generate_handler!
```

### Pattern 1: ReactFlow Bootstrap with Day-One Performance Discipline

**What:** A `<GraphCanvas>` component that mounts `<ReactFlow>` with virtualization on, memoized `nodeTypes`, and `<ReactFlowProvider>` wrapping so the breadcrumb (outside the canvas) can use `useReactFlow()` and `useStore()` selectors.
**When to use:** This is the single ReactFlow mount point for the whole app.

```typescript
// src/components/graph/nodeTypes.ts — MUST be module-level constant (Pitfall 1)
import { ContractNode } from './ContractNode';

// Source: https://reactflow.dev/learn/advanced-use/performance — "stable nodeTypes"
export const nodeTypes = {
  contract: ContractNode,
} as const;

// src/components/graph/GraphCanvas.tsx
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';  // REQUIRED — Phase 3 will fail silently without it
import { nodeTypes } from './nodeTypes';
import { useGraphData } from '@/hooks/useGraphData';

export function GraphCanvas() {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner />
    </ReactFlowProvider>
  );
}

function GraphCanvasInner() {
  const { nodes, edges } = useGraphData();  // returns memoized arrays
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}                  // module-level constant
      onlyRenderVisibleElements              // GRAPH-03 — DAY ONE per STATE.md decision
      minZoom={0.1}
      maxZoom={2}
      fitView
      proOptions={{ hideAttribution: true }} // hackathon — we credit in README
    >
      <Background />
      <Controls />
    </ReactFlow>
  );
}
```

### Pattern 2: Five-Level Hierarchy via parentId + extent: 'parent'

**What:** Each node carries `parentId` referencing its parent UUID and `extent: 'parent'` to constrain dragging within the parent box. React Flow renders parents first, children inside — built-in sub-flow support.
**When to use:** Building L0 → L1 → L2 → L3 → L4. The sidecar `parent` field maps directly to React Flow's `parentId`.

```typescript
// Source: https://reactflow.dev/examples/grouping/sub-flows
//         https://reactflow.dev/learn/layouting/sub-flows

const nodes: Node[] = [
  { id: 'L0-product', type: 'contract', data: { level: 'L0', name: 'Product' },
    position: { x: 0, y: 0 } },
  { id: 'L1-checkout', type: 'contract', data: { level: 'L1', name: 'Checkout flow' },
    position: { x: 50, y: 50 }, parentId: 'L0-product', extent: 'parent' },
  { id: 'L2-payment-button', type: 'contract', data: { level: 'L2', name: 'Pay button' },
    position: { x: 100, y: 100 }, parentId: 'L1-checkout', extent: 'parent' },
  // ...
];
```

**Critical:** Parent nodes MUST appear before their children in the `nodes` array. React Flow processes them in order; reversing the order produces "parent not found" warnings and wrong z-indexing. The data layer (Phase 2) already stores `parent_uuid`; the IPC `get_nodes` response should sort by `level ASC` to satisfy this constraint, OR the frontend sorts before passing to ReactFlow.

### Pattern 3: Zoom-Driven Detail Level (GRAPH-02)

**What:** A "drill in" UX where clicking a flow node animates the viewport to center on it and reveals its children. Implemented with `useReactFlow().setCenter(x, y, { zoom, duration })` plus a Zustand action that pushes the parent UUID onto a stack the breadcrumb reads.
**When to use:** On node double-click for L1/L2/L3 nodes (L4 atoms open inspector instead).

```typescript
// Source: https://reactflow.dev/examples/interaction/zoom-transitions
//         https://reactflow.dev/api-reference/types/viewport (duration option)

import { useReactFlow } from '@xyflow/react';
import { useGraphStore } from '@/store/graphStore';

function useDrillInto() {
  const { setCenter, getNode } = useReactFlow();
  const pushParent = useGraphStore((s) => s.pushParent);

  return (nodeId: string) => {
    const n = getNode(nodeId);
    if (!n) return;
    const x = n.position.x + (n.measured?.width ?? 200) / 2;
    const y = n.position.y + (n.measured?.height ?? 100) / 2;
    setCenter(x, y, { zoom: 1.5, duration: 600 });   // smooth transition
    pushParent(nodeId);                                // breadcrumb reflects new level
  };
}
```

The `duration` option on `setCenter`/`setViewport`/`fitView`/`zoomTo` is first-party (since v12.0). Use 400–800ms for the "feels native macOS" feel.

### Pattern 4: Breadcrumb from graphStore + ReactFlow Viewport

**What:** The breadcrumb reads `parentUuidStack` from `graphStore` (the user's drill-in path) AND optionally the live zoom level from React Flow's internal store. Clicking a breadcrumb segment pops the stack and animates back.
**When to use:** Mounted in the header; renders `Product / Checkout / Pay button`.

```typescript
// Source: https://reactflow.dev/api-reference/hooks/use-store (selector pattern)

import { useStore } from '@xyflow/react';
import { useGraphStore } from '@/store/graphStore';

function Breadcrumb() {
  const path = useGraphStore((s) => s.parentUuidStack);
  const zoom = useStore((s) => s.transform[2]);  // [x, y, zoom]
  // render path segments + zoom indicator
}
```

### Pattern 5: Custom Node Component — Visual Encoding Matrix (GRAPH-04)

**What:** A single `ContractNode` component (memoized) whose className is computed from `kind × state × canonical/ghost` via `cva`. This avoids 12+ separate node types in `nodeTypes`.
**When to use:** The single registered node type for all L0–L4 contracts.

```typescript
// src/components/graph/ContractNode.tsx
import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const nodeStyles = cva(
  'rounded-md border-2 px-3 py-2 text-sm font-medium shadow-sm',
  {
    variants: {
      kind: {
        UI:   'border-blue-500 bg-blue-50',
        API:  'border-violet-500 bg-violet-50',
        data: 'border-amber-500 bg-amber-50',
        job:  'border-emerald-500 bg-emerald-50',
      },
      state: {
        healthy:  '',
        drifted:  'ring-2 ring-red-500 animate-pulse',  // Phase 7 will activate this
        untested: 'opacity-70',
      },
      canonical: {
        true:  '',
        false: 'border-dashed opacity-60',  // ghost references look spectral
      },
    },
    defaultVariants: { kind: 'UI', state: 'healthy', canonical: 'true' },
  }
);

interface ContractNodeData {
  name: string;
  kind: 'UI' | 'API' | 'data' | 'job' | 'unknown';
  state: 'healthy' | 'drifted' | 'untested';
  isCanonical: boolean;
  level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
}

export const ContractNode = memo(function ContractNode({
  data,
}: NodeProps<ContractNodeData>) {
  return (
    <div
      className={cn(
        nodeStyles({
          kind: data.kind === 'unknown' ? 'UI' : data.kind,
          state: data.state,
          canonical: data.isCanonical ? 'true' : 'false',
        })
      )}
    >
      <Handle type="target" position={Position.Top} />
      {data.name}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});
```

Source: React Flow performance guide — every custom node component must be wrapped in `React.memo`.

### Pattern 6: Lens Projection (GRAPH-05)

**What:** A lens is a SQL filter over `node_flows`. Journey lens = nodes whose `node_flows.flow_uuid` is in the user's selected flow. System/Ownership lenses are placeholders that just return the same node set without crashing.
**When to use:** When the user toggles a lens in `LensSwitcher`. The `useGraphData` hook re-queries with the new lens parameter.

```typescript
// src/store/graphStore.ts
import { create } from 'zustand';

export type LensId = 'journey' | 'system' | 'ownership';

interface GraphState {
  currentLens: LensId;
  parentUuidStack: string[];          // breadcrumb path
  selectedNodeUuid: string | null;
  setLens: (lens: LensId) => void;
  pushParent: (uuid: string) => void;
  popParent: () => void;
  selectNode: (uuid: string | null) => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  currentLens: 'journey',
  parentUuidStack: [],
  selectedNodeUuid: null,
  setLens: (lens) => set({ currentLens: lens }),
  pushParent: (uuid) => set((s) => ({ parentUuidStack: [...s.parentUuidStack, uuid] })),
  popParent: () => set((s) => ({ parentUuidStack: s.parentUuidStack.slice(0, -1) })),
  selectNode: (uuid) => set({ selectedNodeUuid: uuid }),
}));
```

```rust
// src-tauri/src/commands/nodes.rs — extend
#[tauri::command]
pub async fn get_lens_nodes(
    app: tauri::AppHandle,
    lens: String,
    flow_uuid: Option<String>,
) -> Result<Vec<ContractNode>, String> {
    // Journey: SELECT n.* FROM nodes n JOIN node_flows nf ON n.uuid = nf.node_uuid
    //          WHERE nf.flow_uuid = ?1
    // System / Ownership: for Phase 3, return get_nodes(None, None) (placeholder, no crash)
    // ...
}
```

### Pattern 7: Ghost-Ref Generation (DATA-05) — `rebuild_ghost_refs`

**What:** A single idempotent Rust command that derives ghost-reference rows in `nodes` (`is_canonical=0`, `canonical_uuid=<sidecar_uuid>`) from `node_flows` membership. Called after every full scan and after lens membership changes.
**When to use:** Once at the end of `open_repo` (after scanner completes), and again whenever `node_flows` changes.

```rust
// src-tauri/src/commands/graph.rs (NEW)
use tauri_plugin_sql::DbInstances;
use sqlx::SqlitePool;

#[tauri::command]
pub async fn rebuild_ghost_refs(app: tauri::AppHandle) -> Result<u32, String> {
    let instances = app.state::<DbInstances>();
    let db_map = instances.0.read().await;
    let db_pool = db_map.get("sqlite:contract-ide.db").ok_or("DB not loaded")?;

    // DbPool wraps sqlx::AnyPool; match the variant (Phase 2 STATE.md note)
    let DbPool::Sqlite(pool) = db_pool else { return Err("not sqlite".into()); };

    rebuild_ghost_refs_inner(pool).await.map_err(|e| e.to_string())
}

async fn rebuild_ghost_refs_inner(pool: &SqlitePool) -> anyhow::Result<u32> {
    let mut tx = pool.begin().await?;

    // Step 1: blow away all existing ghosts (idempotency)
    sqlx::query("DELETE FROM nodes WHERE is_canonical = 0").execute(&mut *tx).await?;

    // Step 2: re-derive — for each (canonical_node, flow) in node_flows where the canonical
    // node belongs to MORE THAN ONE flow, create a ghost row per (additional flow).
    // Ghost UUID convention: 'ghost-{canonical_uuid}-{flow_uuid}'
    let result = sqlx::query(r#"
        INSERT INTO nodes (uuid, level, name, kind, parent_uuid, is_canonical,
                           canonical_uuid, code_hash, contract_hash, human_pinned,
                           contract_body, updated_at)
        SELECT
            'ghost-' || nf.node_uuid || '-' || nf.flow_uuid,
            n.level, n.name, n.kind, n.parent_uuid, 0,
            n.uuid, n.code_hash, n.contract_hash, n.human_pinned,
            n.contract_body, datetime('now')
        FROM node_flows nf
        JOIN nodes n ON n.uuid = nf.node_uuid AND n.is_canonical = 1
        WHERE nf.node_uuid IN (
            SELECT node_uuid FROM node_flows GROUP BY node_uuid HAVING COUNT(*) > 1
        )
        AND nf.flow_uuid != (
            -- pick a "primary" flow for the canonical (lowest flow_uuid by lex order)
            SELECT MIN(flow_uuid) FROM node_flows WHERE node_uuid = nf.node_uuid
        )
    "#).execute(&mut *tx).await?;

    tx.commit().await?;
    Ok(result.rows_affected() as u32)
}
```

**Critical idempotency:** Wrapped in transaction. `DELETE WHERE is_canonical = 0` first ensures repeated calls produce the same final state. Ghost UUID is deterministic (`ghost-<canonical>-<flow>`) so any cross-references are stable.

### Pattern 8: Command Palette (SHELL-03)

**What:** `cmdk` `Command.Dialog` mounted at `<AppShell>` root, opened by Cmd+K listener, with action items wired to Zustand actions and IPC calls.
**When to use:** Always available; the Cmd+K binding is global.

```typescript
// src/components/command-palette/CommandPalette.tsx
import { Command } from 'cmdk';
import { useEffect, useState } from 'react';
import { useGraphStore } from '@/store/graphStore';
import { pickAndOpenRepo } from '@/ipc/repo';

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const setLens = useGraphStore((s) => s.setLens);

  useEffect(() => {
    // Source: https://github.com/pacocoursey/cmdk README — "Listen for Cmd+K yourself"
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Command.Dialog open={open} onOpenChange={setOpen} label="Command palette">
      <Command.Input placeholder="Type a command or search nodes..." />
      <Command.List>
        <Command.Empty>No results found.</Command.Empty>
        <Command.Group heading="Repository">
          <Command.Item onSelect={() => { pickAndOpenRepo(); setOpen(false); }}>
            Open repository...
          </Command.Item>
        </Command.Group>
        <Command.Group heading="Lens">
          <Command.Item onSelect={() => { setLens('journey'); setOpen(false); }}>
            Switch to Journey lens
          </Command.Item>
          <Command.Item onSelect={() => { setLens('system'); setOpen(false); }}>
            Switch to System lens
          </Command.Item>
          <Command.Item onSelect={() => { setLens('ownership'); setOpen(false); }}>
            Switch to Ownership lens
          </Command.Item>
        </Command.Group>
        <Command.Group heading="Navigation">
          <Command.Item onSelect={() => { /* focus chat panel */ setOpen(false); }}>
            Focus chat panel
          </Command.Item>
          {/* "Jump to node" populated dynamically from getNodes() */}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
```

### Anti-Patterns to Avoid

- **Inline `nodeTypes={{ contract: ContractNode }}`:** Creates a new object every render → React Flow re-mounts every node every frame. ALWAYS use a module-level `const nodeTypes = {...}`.
- **Defining `ContractNode` inside another component:** Same as above — new function reference each render → full re-mount. Define at module scope.
- **Non-memoized custom node:** Even with stable `nodeTypes`, dragging nodes triggers re-renders that cascade to every node unless each is `React.memo`'d.
- **Using `useStore((s) => s.nodes)`:** Returns a new array reference every change → re-renders subscribed components on every node update. Use specific selectors (`useStore((s) => s.transform[2])` for zoom only, etc.).
- **Skipping `import '@xyflow/react/dist/style.css'`:** Graph renders as broken text blobs with no edges visible. Required since v12.
- **Putting ghost-ref derivation in JS:** The graph reads from SQLite — derivation must happen in Rust before `get_nodes` returns. JS-side ghost generation would race with the watcher.
- **Custom nested `<ReactFlow>` per level:** Documented as a "custom implementation" with disabled inner pan/zoom. Breaks the smooth-zoom UX. Use parentId+extent sub-flows.
- **`onlyRenderVisibleElements` retrofitted later:** STATE.md flags this as a critical day-one decision. The performance budget assumes it's on; switching it on later requires re-validating every node component for off-screen-mount assumptions.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Graph rendering + viewport + pan/zoom | Custom SVG/canvas with manual transform | `@xyflow/react` | Hit-testing, viewport math, edge routing, accessibility, MiniMap — all solved; rebuilding loses 6 months and demo polish |
| Virtualization for off-screen nodes | Custom `IntersectionObserver` over node DOM | `onlyRenderVisibleElements` prop | One boolean prop replaces hundreds of lines; battle-tested in production at Linear, Stripe, etc. |
| Sub-flow / nested grouping | Nested ReactFlow instances | `parentId` + `extent: 'parent'` | First-party sub-flow pattern; nested instances are a known anti-pattern (disabled inner zoom) |
| Smooth zoom-to-node animation | Custom requestAnimationFrame transform interpolation | `setCenter(x, y, { duration })` | First-party since v12.0; matches ease curves React Flow uses elsewhere |
| Command palette | Custom modal + fuzzy search | `cmdk` | 12.5k stars; fuzzy match (`command-score`); keyboard nav; a11y; 6KB |
| Cmd+K binding | Pull `react-hotkeys-hook` for one binding | Plain `addEventListener('keydown')` in `useEffect` | Single line of code; zero deps; cmdk README explicitly recommends it |
| Layout algorithm for 25 hand-curated demo nodes | Add `dagre`/`elkjs` | Manual `position: { x, y }` per node | Auto-layout adds 60KB+ and fights manual positioning; for ≤100 nodes, manual wins. Reassess later |
| Ghost-ref derivation logic in JS | JS query of `node_flows` + filter + insert | Single `rebuild_ghost_refs()` Rust IPC | Single-writer rule (Phase 1 architecture); race-free with watcher |
| Lens projection logic | Loops in TS over the full node set | `get_lens_nodes(flow_uuid)` SQL JOIN | DB does the JOIN faster; less data crossing IPC; FTS5 will need this shape later anyway |

**Key insight:** This phase is 80% wiring `@xyflow/react` correctly and 20% backend. The novel work is the L0–L4 hierarchy mapping, the ghost-ref query, the visual encoding matrix, and integration with the existing Zustand stores. Performance is bought at install time by enabling `onlyRenderVisibleElements` and writing memoized custom nodes from the first commit — not retrofitted later.

---

## Common Pitfalls

### Pitfall 1: `nodeTypes` Re-creation on Every Render

**What goes wrong:** Defining `nodeTypes={{ contract: ContractNode }}` inline in JSX creates a new object each render. React Flow detects "changed types" → unmounts + remounts every node every frame → gradual freeze + the famous "nodeTypes recreated" console warning.
**Why it happens:** It looks idiomatic — every other prop accepts inline objects.
**How to avoid:** Define `nodeTypes` as a module-level `const` (or `useMemo` outside the React Flow component). Same for `edgeTypes`, `defaultEdgeOptions`, `snapGrid`.
**Warning signs:** Console warning `It looks like you've created a new nodeTypes or edgeTypes object`; FPS in 20s; node component re-mount counter explodes.

### Pitfall 2: Missing `import '@xyflow/react/dist/style.css'`

**What goes wrong:** Graph renders, but nodes are unstyled boxes, edges are invisible, controls are unclickable. Phase 3 looks broken on first launch.
**Why it happens:** v12 split CSS out of the JS bundle; older v11 muscle memory says "no CSS import needed."
**How to avoid:** Add the import at the top of `GraphCanvas.tsx` (or globally in `main.tsx`). Verify by checking the rendered DOM — `.react-flow__node` elements should have computed background colors.
**Warning signs:** Nodes are black-on-transparent; edges are 0px wide.

### Pitfall 3: Parent Nodes After Child Nodes in `nodes` Array

**What goes wrong:** `parentId` resolution requires the parent to appear earlier in the array. Out-of-order arrays trigger `[React Flow]: Couldn't find node 'parent-uuid'` warnings; children render at root z-index instead of inside parent box; `extent: 'parent'` constraint is silently ignored.
**Why it happens:** Phase 2's `get_nodes` doesn't sort by level by default; SQL `SELECT` order is implementation-defined.
**How to avoid:** Either add `ORDER BY CASE level WHEN 'L0' THEN 0 WHEN 'L1' THEN 1 ... END` to the SQL, OR sort in `useGraphData` hook before passing to React Flow.
**Warning signs:** Console warning + children floating outside their parent box.

### Pitfall 4: cmdk Peer Dependency Conflict with React 19

**What goes wrong:** `npm install cmdk` fails with `ERESOLVE could not resolve` because cmdk 1.1.1's peer-dep declaration is stale (`react: ^18`).
**Why it happens:** Library hasn't bumped peer-dep range; runtime works fine because the React APIs cmdk uses (`useId`, `useSyncExternalStore`) are stable in 19.
**How to avoid:** Either install with `--legacy-peer-deps` (one-off) OR add `"overrides": { "cmdk": { "react": "^19", "react-dom": "^19" } }` to root `package.json` (persistent, recommended). Verify cmdk renders by mounting `<Command.Dialog>` and pressing Cmd+K.
**Warning signs:** `npm install` exits 1 with ERESOLVE; OR install succeeds but TS complains about React types not matching at the cmdk component boundary.

### Pitfall 5: Ghost-Ref Duplication Under Watcher Re-Fire

**What goes wrong:** If `rebuild_ghost_refs()` only INSERTs without first DELETING `is_canonical=0` rows, every watcher event after the first creates duplicate ghosts (deterministic ghost UUID prevents true duplicates via PRIMARY KEY constraint, but throws SQL errors).
**Why it happens:** Forgetting that watcher events can fire many times during a single user action.
**How to avoid:** Wrap the rebuild in a transaction: `BEGIN → DELETE WHERE is_canonical=0 → INSERT from node_flows → COMMIT`. The deterministic ghost UUID convention (`ghost-{canonical}-{flow}`) is a defense-in-depth.
**Warning signs:** SQL error `UNIQUE constraint failed: nodes.uuid` in logs; ghost count grows on every save instead of stabilizing.

### Pitfall 6: `useStore((s) => s.nodes)` Re-renders on Every Drag Frame

**What goes wrong:** Subscribing to `state.nodes` from React Flow's internal store gets a new array reference on every position update during drag → component re-renders 60 times/second.
**Why it happens:** Treating React Flow's store like a normal Zustand store.
**How to avoid:** Use specific selectors: `useStore((s) => s.transform[2])` for zoom only, `useStore((s) => s.nodes.length)` for count, etc. For the breadcrumb, derive level from our OWN `graphStore` (which only updates on drill-in), NOT from React Flow internal state.
**Warning signs:** Component outside the canvas (breadcrumb, sidebar) re-renders on every node drag.

### Pitfall 7: Cmd+K Conflicts with Browser/WebKit Default

**What goes wrong:** WebKit (and thus Tauri's WKWebView) may intercept Cmd+K for "Search in page" or "Show search bar" depending on platform context. Without `e.preventDefault()`, Cmd+K both opens the palette AND triggers WebKit's behavior.
**Why it happens:** Default browser bindings can leak into Tauri windows.
**How to avoid:** Always call `e.preventDefault()` before `setOpen` in the keydown listener. Verify Cmd+K does NOT trigger any WebKit search affordance.
**Warning signs:** Visible flash of WebKit search overlay before palette appears; or palette doesn't open because WebKit consumes the event first.

### Pitfall 8: `useReactFlow()` Called Outside `<ReactFlowProvider>`

**What goes wrong:** `useReactFlow()` and other hooks (`useStore`, `useViewport`) throw `It looks like you have not used the React Flow Provider` if called from a component mounted outside the provider's children tree.
**Why it happens:** Wrapping `<ReactFlow>` directly without `<ReactFlowProvider>` works for the canvas itself, but breaks once the breadcrumb (or any other component) tries to read viewport state.
**How to avoid:** Mount `<ReactFlowProvider>` at the AppShell level (or at least at a parent that contains both the canvas AND the breadcrumb/header). The provider has zero children of its own — it just exposes context.
**Warning signs:** Crash on mount with "ReactFlowProvider missing"; works in isolation but breaks when integrated.

### Pitfall 9: `onlyRenderVisibleElements` + `useNodesInitialized` Conflict

**What goes wrong:** When `onlyRenderVisibleElements` is on, `useNodesInitialized` returns `false` for off-screen nodes (because their dimensions aren't measured yet). Code that waits for `useNodesInitialized` before running auto-layout or fit-to-view will hang.
**Why it happens:** Documented v12 behavior — virtualized nodes literally don't exist in the DOM until scrolled into view.
**How to avoid:** Don't gate critical bootstrap logic on `useNodesInitialized` when virtualization is on. Use `fitView` (which works without measurement) or set initial positions directly. If you need measurements, temporarily disable virtualization for the measurement pass.
**Warning signs:** Auto-layout never runs; "Loading..." spinner stays forever; only first viewport's nodes appear.

### Pitfall 10: Hand-Rolled Edges Crossing Sub-Flow Boundaries

**What goes wrong:** When using sub-flows (`parentId`), edges between nodes in different parents render with weird routing because React Flow's default edge router doesn't account for parent boundaries.
**Why it happens:** Edge handles compute their position relative to the node, but the node position is relative to its parent — cross-parent edges go through layout calculations that produce visual artifacts.
**How to avoid:** For Phase 3, KEEP EDGES WITHIN THE SAME LEVEL (siblings only). L0→L1 "containment" is implicit via `parentId`, not via explicit edges. If you need cross-parent edges, set `containerNode.style = { width, height }` explicitly and verify visually.
**Warning signs:** Edges drawn on top of parent boxes; edges that disappear when parent is dragged.

---

## Code Examples

Verified patterns from official sources and architecture decisions:

### Cmd+K Listener with WebKit-Safe preventDefault

```typescript
// Source: https://github.com/pacocoursey/cmdk README
// Pitfall 7: must preventDefault before setOpen
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setOpen((o) => !o);
    }
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}, []);
```

### Animated Zoom-to-Node

```typescript
// Source: https://reactflow.dev/api-reference/types/viewport
//         https://reactflow.dev/examples/interaction/zoom-transitions
const { setCenter, getNode } = useReactFlow();
const node = getNode(uuid);
if (node) {
  const cx = node.position.x + (node.measured?.width ?? 200) / 2;
  const cy = node.position.y + (node.measured?.height ?? 100) / 2;
  setCenter(cx, cy, { zoom: 1.5, duration: 600 });
}
```

### Stable nodeTypes Pattern

```typescript
// Source: https://reactflow.dev/learn/advanced-use/performance
// Pitfall 1 prevention — module-level const
import { ContractNode } from './ContractNode';
export const nodeTypes = { contract: ContractNode } as const;

// Then in component:
import { nodeTypes } from './nodeTypes';
<ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} ... />
```

### Memoized Custom Node

```typescript
// Source: https://reactflow.dev/learn/customization/custom-nodes (memo guidance)
import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

export const ContractNode = memo(function ContractNode({ data }: NodeProps<MyData>) {
  return (
    <div>
      <Handle type="target" position={Position.Top} />
      {data.name}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});
```

### rebuild_ghost_refs SQL (transactional + idempotent)

```rust
// Source: SQLite docs + Phase 2 STATE.md DbPool match pattern
async fn rebuild_ghost_refs_inner(pool: &SqlitePool) -> anyhow::Result<u32> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM nodes WHERE is_canonical = 0")
        .execute(&mut *tx).await?;
    let result = sqlx::query(r#"
        INSERT INTO nodes (uuid, level, name, kind, parent_uuid, is_canonical,
                           canonical_uuid, code_hash, contract_hash, human_pinned,
                           contract_body, updated_at)
        SELECT 'ghost-' || nf.node_uuid || '-' || nf.flow_uuid,
               n.level, n.name, n.kind, n.parent_uuid, 0,
               n.uuid, n.code_hash, n.contract_hash, n.human_pinned,
               n.contract_body, datetime('now')
        FROM node_flows nf
        JOIN nodes n ON n.uuid = nf.node_uuid AND n.is_canonical = 1
        WHERE nf.node_uuid IN (
            SELECT node_uuid FROM node_flows GROUP BY node_uuid HAVING COUNT(*) > 1
        )
        AND nf.flow_uuid != (
            SELECT MIN(flow_uuid) FROM node_flows WHERE node_uuid = nf.node_uuid
        )
    "#).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(result.rows_affected() as u32)
}
```

### React 19 + cmdk override in package.json

```json
{
  "dependencies": {
    "cmdk": "^1.1.1"
  },
  "overrides": {
    "cmdk": {
      "react": "^19",
      "react-dom": "^19"
    }
  }
}
```

---

## Phase 2 Inheritance — What Phase 3 Extends

| Phase 2 Asset | Phase 3 Use | Change Required |
|---------------|-------------|-----------------|
| `get_nodes(level, parent_uuid)` IPC | Primary data source for canvas | Likely no change; ensure ORDER BY level so parents precede children |
| `nodes` table with `is_canonical`, `canonical_uuid` columns | Ghost-ref query | New `rebuild_ghost_refs` command writes here |
| `edges` table (already populated by Phase 2 scanner from `neighbors` frontmatter) | Render edges between nodes | New `get_edges(level, parent_uuid)` command — straight SELECT |
| `node_flows` table | Lens projection (Journey) | New `get_lens_nodes(flow_uuid)` command — JOIN |
| `contracts:updated` event from watcher | Trigger React Flow re-fetch | Listen in `useGraphData`, invalidate node/edge query, re-call `rebuild_ghost_refs` |
| `GraphPlaceholder.tsx` | Replace at end of phase with real `<GraphCanvas />` | Delete placeholder; mount real canvas; preserve empty-state UX (no repo open) |
| `tauri-plugin-dialog` `open_repo` flow | Trigger from CommandPalette "Open repository..." | Reuse `pickAndOpenRepo()` from `src/ipc/repo.ts` |
| Existing Zustand stores (`appStore`, `editorStore`) | Coexist with new `graphStore` | No change; `graphStore` is a new slice |
| `tauri-plugin-sql` migrations system | No new migration needed for Phase 3 | All required columns (`is_canonical`, `canonical_uuid`, `kind`, `code_ranges`) already exist from Phase 1 + Phase 2 |

**Key constraint:** `get_nodes` should be extended (or a new `get_nodes_for_canvas` added) to return `is_canonical` and `canonical_uuid` so `ContractNode.tsx` can render the dashed/spectral ghost variant. Phase 2's `ContractNode` TS interface in `src/ipc/types.ts` may not include these — verify and extend.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `react-flow-renderer` package | `@xyflow/react` | v11 → v12 rename (2024) | Use `@xyflow/react` exclusively; the old package is unmaintained |
| Manual `requestAnimationFrame` for viewport transitions | `setCenter(x, y, { duration })` first-party option | v12.0 | One-line API for smooth zooms |
| Nested `<ReactFlow>` for grouping | `parentId` + `extent: 'parent'` sub-flows | v10+ official pattern | Simpler, smoother, supported |
| `notify-debouncer-mini` for file watching (Phase 2 context) | `tauri-plugin-fs` watch (already adopted) | Phase 2 | N/A to Phase 3 |
| `react-cmdk` (pre-styled) | `cmdk` (unstyled, Tailwind-friendly) | cmdk wins on flexibility | shadcn ecosystem standardized on cmdk |

**Deprecated/outdated:**
- `react-flow-renderer`: package renamed; do not install.
- React Flow v11 docs: use v12 docs at reactflow.dev — many APIs changed (`reactFlowInstance` removed, `useReactFlow` is the entry point).
- Custom nested ReactFlow as a primary grouping pattern: still possible but officially discouraged for parent-child semantics.

---

## Open Questions

1. **L0 product node — single root vs. multiple roots?**
   - What we know: ROADMAP describes "L0 Product → L1 Flows → L2 Surfaces → L3 Components → L4 Atoms" implying one L0 root per repo
   - What's unclear: For monorepos with multiple "products" (Phase 9 demo uses `vercel/commerce`, single product), do we always have exactly one L0?
   - Recommendation: Phase 3 assumes ONE L0 root per opened repo. Add a TODO for monorepo support; defer to v2.

2. **Ghost-ref "primary flow" tiebreaker**
   - What we know: When a canonical node belongs to multiple flows, we pick one flow as the canonical's home and create ghosts for the others
   - What's unclear: Lex-min on flow_uuid is deterministic but arbitrary; users may prefer "most recently added" or "first per node_flows.created_at"
   - Recommendation: Lex-min `flow_uuid` for Phase 3 (deterministic, no schema change). If users find ghosts in unexpected flows during demo prep, add `created_at` to `node_flows` and switch tiebreaker.

3. **Smooth-zoom UX on node-doubleclick vs. single-click**
   - What we know: Single-click typically means "select" (open inspector in Phase 4); doubleclick means "drill in"
   - What's unclear: Whether L1/L2 nodes should drill on single-click (since they're containers, not atoms) — depends on Phase 4 inspector design
   - Recommendation: Phase 3 ships doubleclick = drill-in for L1–L3, single-click = select-and-inspect for L4 atoms. Revisit after Phase 4.

4. **Cmd+K "jump to node" — initial population vs. lazy search**
   - What we know: cmdk does fuzzy match in-memory; populating ALL nodes upfront is fine for ≤1000 nodes
   - What's unclear: At 5000+ nodes (post-MVP), do we need to lazy-search via FTS5?
   - Recommendation: Phase 3 populates from `getNodes()` upfront (works for demo's ~25 nodes). Phase 9 mass-edit research already covers FTS5 — reuse that path if scale demands.

5. **System / Ownership lens placeholders — blank graph or shared layout?**
   - What we know: Roadmap says "selectable without crashing even if their layouts are placeholder"
   - What's unclear: Do they show the same nodes with a banner ("Placeholder lens"), or empty?
   - Recommendation: Show the same nodes as Journey but render a sticky banner: "System lens — placeholder layout. Coming v2." Avoids the "blank canvas = bug" reaction during demo.

---

## Sources

### Primary (HIGH confidence)

- `https://reactflow.dev/api-reference/react-flow` — All `<ReactFlow>` props including `onlyRenderVisibleElements`, `nodeTypes`, `fitView`, `minZoom`, `maxZoom`
- `https://reactflow.dev/learn/layouting/sub-flows` — `parentId` + `extent: 'parent'` sub-flow pattern
- `https://reactflow.dev/examples/grouping/sub-flows` — Working sub-flows code example
- `https://reactflow.dev/examples/interaction/zoom-transitions` — `setCenter`/`setViewport` with `duration`
- `https://reactflow.dev/learn/advanced-use/performance` — Stable `nodeTypes`, `React.memo` requirement, `useMemo` for option props
- `https://reactflow.dev/api-reference/hooks/use-store` — Selector pattern for internal store; `useStoreApi` for non-subscribing access
- `https://reactflow.dev/learn/customization/custom-nodes` — Custom node component patterns
- `https://reactflow.dev/api-reference/types/viewport` — `{ duration }` option on viewport mutators
- `https://reactflow.dev/learn/troubleshooting/migrate-to-v12` — v12 breaking changes; required CSS import
- `https://github.com/pacocoursey/cmdk` — cmdk README, `Command.Dialog` API, "do Cmd+K yourself" recommendation
- `https://www.npmjs.com/package/@xyflow/react` — v12.10.2 latest as of 2026-04
- `https://github.com/xyflow/xyflow/issues/4378` — `onlyRenderVisibleElements` known behavior
- `https://github.com/xyflow/xyflow/discussions/4975` — Performance optimization community thread

### Secondary (MEDIUM confidence)

- `https://github.com/shadcn-ui/ui/issues/6200` — cmdk + React 19 peer-dep friction; documented workaround
- `https://medium.com/@lukasz.jazwa_32493/the-ultimate-guide-to-optimize-react-flow-project-performance-42f4297b2b7b` — Synergy Codes performance guide (cross-references official docs)
- `https://dev.to/usman_abdur_rehman/react-flowxyflow-optimization-45ik` — Practical optimization patterns

### Internal (HIGH confidence — same project, validated)

- `.planning/phases/02-contract-data-layer/02-RESEARCH.md` — Phase 2 architecture; `DbPool::Sqlite(pool)` match pattern; `DbInstances` access; ghost-ref deferral to Phase 3 (Open Question 4)
- `.planning/STATE.md` — Critical decision: `onlyRenderVisibleElements` must be set at Phase 3 scaffold time; `DbPool` enum match pattern from Phase 2; sqlx 0.8 as direct dep
- `.planning/REQUIREMENTS.md` — Full requirement text for GRAPH-01..05, SHELL-03, DATA-05
- `.planning/ROADMAP.md` — Phase 3 success criteria; ghost-ref deferral rationale

### Tertiary (LOW confidence — flagged for validation)

- React Flow's exact behavior with `parentId` when using `onlyRenderVisibleElements` and the parent is off-screen — tested patterns suggest the parent renders if any descendant is visible, but verify before relying on it.

---

## Metadata

**Confidence breakdown:**
- `@xyflow/react` v12 stack and APIs: HIGH — verified against current reactflow.dev docs and v12.10.2 npm release
- Performance discipline (`onlyRenderVisibleElements`, memoized nodeTypes, custom node memo): HIGH — triangulated across official docs + multiple community guides + STATE.md prior decision
- Sub-flow hierarchy via parentId + extent: HIGH — official pattern with working code examples
- `cmdk` for command palette: HIGH — package widely deployed; React 19 peer-dep workaround documented
- `rebuild_ghost_refs` SQL design: MEDIUM — pattern is sound but the lex-min tiebreaker for primary flow is a Phase 3 design choice, not a verified-against-docs claim
- Lens projection SQL: HIGH — straight JOIN over `node_flows`, schema already supports it
- Cmd+K WebKit interception: MEDIUM — documented as a defensive `preventDefault()`; haven't observed actual conflict in Tauri WKWebView testing

**Research date:** 2026-04-24
**Valid until:** 2026-05-22 (30 days — `@xyflow/react` v12 line is stable; cmdk 1.1.1 hasn't moved in 6+ months)
**Critical validation before Phase 3 ends:**
1. Verify `cmdk` `npm install` works against the project's React 19 setup with the `overrides` block applied — fail fast if peer-dep workaround is insufficient.
2. Confirm `useNodesInitialized` is NOT in the critical path of any bootstrap logic (Pitfall 9) before relying on virtualization.
3. After `rebuild_ghost_refs()` runs, query `SELECT COUNT(*) FROM nodes WHERE is_canonical=0` twice in a row — must return same number (idempotency check).
