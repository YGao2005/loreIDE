import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useReactFlow,
  type Node,
  type Edge,
} from '@xyflow/react';
import { useGraphStore } from '@/store/graph';
import { useDriftStore } from '@/store/drift';
import { useCherrypickStore } from '@/store/cherrypick';
import { useRollupStore } from '@/store/rollup';
import { useMassEditStore } from '@/store/massEdit';
import { useSubstrateStore, type SubstrateNodeState } from '@/store/substrate';
import { useSidebarStore } from '@/store/sidebar';
import { useUiStore } from '@/store/ui';
import { getEdges } from '@/ipc/graph';
import { nodeTypes } from './nodeTypes';
import { FlowChainLayout } from './FlowChainLayout';
import type { ContractNodeData } from './ContractNode';
import type { GroupNodeData } from './GroupNode';
import { layoutNodes } from './layout';
import { resolveNodeState } from './contractNodeStyles';
import { isFlowContract } from '@/ipc/types';
import type { ContractNode as RowContractNode, GraphEdge } from '@/ipc/types';

// Phase 3 Plan 03-03 (dagre drive-by): hierarchical layout now runs through
// `layoutNodes` (dagre two-pass bottom-up → top-down). The previous hand-rolled
// 4-column grid + `extent: 'parent'` clamped children into the parent's fixed
// ~180×40px footprint — with 500 children (100 per L1) that collapsed into a
// visual stack and tanked fps. The new layout sizes each group from its
// subtree bbox + padding so children never need clamping, and drops
// `extent: 'parent'` entirely. Leaf (`contract`) vs container (`group`) node
// type is chosen per-row based on whether any in-set row references it as
// parent.

type FlowNode = Node<ContractNodeData> | Node<GroupNodeData>;

// Phase 13 Plan 01: stable empty Set used to "hide" rollup overlays in Copy
// Mode without introducing a downstream branch. Defined at module scope so
// the reference is stable across renders (useMemo wouldn't catch a fresh
// `new Set()` allocation as equal).
const EMPTY_SET: Set<string> = new Set();

/**
 * Build the React Flow node array from contract rows.
 *
 * Phase 7 Plan 07-03: `driftedUuids` drives the `state` field (drifted/healthy).
 * Phase 8 Plan 08-02: `rollupStaleUuids` + `untrackedUuids` drive `rollupState`.
 * Phase 8 Plan 08-05 (CHRY-01): `targetedNodeUuid` drives the `targeted` field
 * on matching nodes, applying a teal ring glow that bridges graph-selection to
 * inspector focus BEFORE any agent run begins.
 * Phase 9 Plan 09-01 (MASS-01): `massMatchedUuids` drives `state: 'mass_matched'`
 * (amber transient pulse) with staggered animation-delay via --match-delay CSS var.
 *
 * Precedence for visual states (encoded in contractNodeStyles.ts compoundVariants):
 *   drifted (red) > mass_matched (amber transient) > rollup_stale (amber persistent)
 *   > rollup_untracked (gray) > targeted (teal) > healthy
 *
 * L0 nodes are never amber/gray — the Rust engine does not create rollup_derived
 * rows for L0 nodes, so L0 UUIDs will never appear in rollupStaleUuids or
 * untrackedUuids.
 *
 * - Compute layout via `layoutNodes` (dagre two-pass).
 * - Pick node `type` per row: `group` if the row has at least one child in
 *   the same row set, else `contract`.
 * - Preserve `parentId` so React Flow positions children relative to the
 *   group's origin. DO NOT set `extent: 'parent'` — the clamping is what
 *   broke the 500-node render; dagre's bottom-up sizing guarantees the
 *   parent is large enough.
 * - Parents-before-children ordering is handled inside layoutNodes (Pitfall
 *   3 — children before parents triggers "Couldn't find node 'parent-uuid'"
 *   warnings and renders at root z-index).
 */
function buildFlowNodes(
  rows: RowContractNode[],
  driftedUuids: Set<string>,
  rollupStaleUuids: Set<string>,
  untrackedUuids: Set<string>,
  targetedNodeUuid: string | null,
  copyModeActive: boolean,
  massMatchedUuids: Map<string, number>,
  // Phase 13 Plan 01: substrate state map keyed by contract atom uuid.
  // Drives the orange (intent_drifted) and orange-muted (superseded) overlays
  // composed by resolveNodeState. AppShell hydrates this on mount.
  substrateStates: Map<string, SubstrateNodeState>,
): FlowNode[] {
  const laidOut = layoutNodes(rows);
  const byId = new Map<string, RowContractNode>();
  for (const r of rows) byId.set(r.uuid, r);

  return laidOut.map((ln) => {
    const row = byId.get(ln.id);
    if (!row) {
      // Defensive: should not happen — layoutNodes only emits ids from the
      // input rows. Fall back to a leaf with whatever we can render.
      return {
        id: ln.id,
        type: 'contract',
        position: ln.position,
        data: {
          name: ln.id,
          kind: 'unknown',
          state: 'healthy' as const,
          rollupState: 'fresh' as const,
          isCanonical: true,
          level: 'L4',
          targeted: false,
        },
      } as Node<ContractNodeData>;
    }

    // Phase 13 Plan 01: compose visual state via resolveNodeState, then map to
    // the existing CVA (state, rollupState) variant pair.
    //
    // Precedence (top to bottom):
    //   drifted (red) > intent_drifted (orange + glow) > rollup_stale (amber)
    //   > mass_matched (amber transient) > superseded (orange muted)
    //   > rollup_untracked (gray) > healthy
    //
    // mass_matched is INSERTED between rollup_stale and superseded — it's a
    // transient amber pulse triggered by review queue (MASS-01) and we want
    // it to take priority over the substrate "superseded" softer signal but
    // not over drift, intent_drifted, or persistent rollup_stale.
    //
    // Phase 9 Plan 09-03 (NONC-01): when Copy Mode is active, hide amber/gray
    // overlays from non-coders by forcing rollup-state inputs to empty sets.
    const massDelay = massMatchedUuids.get(row.uuid);
    const isMassMatched = massDelay !== undefined;

    // Empty fallbacks honor copyModeActive without adding a branch downstream.
    const effectiveRollupStale = copyModeActive ? EMPTY_SET : rollupStaleUuids;
    const effectiveUntracked = copyModeActive ? EMPTY_SET : untrackedUuids;

    const visual = resolveNodeState(
      row.uuid,
      driftedUuids,
      effectiveRollupStale,
      effectiveUntracked,
      substrateStates,
    );

    // Map NodeVisualState → (state, rollupState) variants used by contractNodeStyles.ts.
    // Phase 9 mass_matched is layered in: only emitted when no higher-priority
    // visual state applies (i.e. visual === 'healthy' or 'rollup_untracked').
    let state:
      | 'healthy'
      | 'drifted'
      | 'mass_matched'
      | 'intent_drifted'
      | 'superseded' = 'healthy';
    let rollupState: 'fresh' | 'stale' | 'untracked' = 'fresh';
    switch (visual) {
      case 'drifted':
        state = 'drifted';
        break;
      case 'intent_drifted':
        state = 'intent_drifted';
        break;
      case 'superseded':
        state = 'superseded';
        break;
      case 'rollup_stale':
        rollupState = 'stale';
        break;
      case 'rollup_untracked':
        rollupState = 'untracked';
        // Allow mass_matched to layer on gray (transient pulse on otherwise
        // untracked node — useful when a fresh node enters the review queue
        // before it's been rolled-up).
        if (isMassMatched) state = 'mass_matched';
        break;
      case 'healthy':
        if (isMassMatched) state = 'mass_matched';
        break;
    }

    // Phase 8 Plan 08-05 (CHRY-01): targeted ring glow.
    // Precedence is enforced in contractNodeStyles.ts compoundVariants so drift/
    // rollup visuals always dominate even if `targeted: true`.
    const targeted = row.uuid === targetedNodeUuid;

    const sharedData = {
      name: row.name,
      kind: row.kind,
      state,
      rollupState,
      isCanonical: row.is_canonical,
      level: row.level,
      targeted,
      // Phase 9 Plan 09-01 (MASS-01): animation delay for staggered amber pulse.
      // ContractNode reads this when state==='mass_matched' and sets inline
      // style { '--match-delay': `${massMatchDelay}ms` } on its outer wrapper.
      massMatchDelay: isMassMatched ? massDelay : undefined,
    };

    if (ln.isGroup) {
      const node: Node<GroupNodeData> = {
        id: ln.id,
        type: 'group',
        position: ln.position,
        // React Flow uses `style.width` + `style.height` to size a node when
        // there's no measured DOM yet — critical for the group variant so
        // edges route correctly around the full box, not the 0-size header.
        style: { width: ln.width, height: ln.height },
        width: ln.width,
        height: ln.height,
        data: sharedData,
      };
      if (ln.parentId) node.parentId = ln.parentId;
      return node;
    }

    const node: Node<ContractNodeData> = {
      id: ln.id,
      type: 'contract',
      position: ln.position,
      data: sharedData,
    };
    if (ln.parentId) node.parentId = ln.parentId;
    return node;
  });
}

export function GraphCanvasInner() {
  // SELECTOR — only re-render when the rows ref changes (refreshNodes()
  // replaces it wholesale). Do NOT subscribe to s.selectedNodeUuid here;
  // the canvas should not re-render on selection.
  const rows = useGraphStore((s) => s.nodes);
  // Phase 13 Plan 06: when a flow contract is selected from the sidebar AND
  // the contract is loaded AND it has members (Phase 9 FLOW-01), swap the
  // default L0/L1/L2/L3/L4 graph for the vertical participant chain.
  // Reading inside the component so this branches per-render without forcing
  // an extra layer in the JSX tree.
  const selectedFlowUuid = useSidebarStore((s) => s.selectedFlowUuid);
  const selectedFlowContract = useMemo(
    () =>
      selectedFlowUuid
        ? rows.find((r) => r.uuid === selectedFlowUuid)
        : undefined,
    [selectedFlowUuid, rows],
  );
  const renderFlowChain =
    Boolean(selectedFlowUuid) &&
    Boolean(selectedFlowContract) &&
    Boolean(selectedFlowContract && isFlowContract(selectedFlowContract));
  // Phase 7 Plan 07-03 (DRIFT-01): read driftedUuids from the drift store.
  // Each mutation produces a new Set reference (immutable update in store),
  // so Zustand's referential inequality check triggers a re-render here.
  // At hackathon scale (~500 nodes) this is sub-frame: the useMemo below
  // only re-runs when rows OR driftedUuids change.
  const driftedUuids = useDriftStore((s) => s.driftedUuids);
  // Phase 8 Plan 08-02 (PROP-02): read rollup state sets for amber/gray visuals.
  const rollupStaleUuids = useRollupStore((s) => s.rollupStaleUuids);
  const untrackedUuids = useRollupStore((s) => s.untrackedUuids);
  // Phase 8 Plan 08-05 (CHRY-01): targeted node UUID for ring glow.
  const targetedNodeUuid = useCherrypickStore((s) => s.targetedNodeUuid);
  // Phase 9 Plan 09-01 (MASS-01): mass-edit match set for staggered amber pulse.
  // Each mutation produces a new Map reference (immutable update in store) so
  // Zustand's referential inequality check triggers a re-render here. Reset via
  // clearMatches() when 09-02's review queue closes.
  const massMatchedUuids = useMassEditStore((s) => s.matchedUuids);
  // Phase 13 Plan 01: substrate state map for orange overlays (intent_drifted +
  // superseded). Each bulkSet/setNodeState produces a new Map identity so
  // Zustand's referential inequality triggers a re-render here. Hydrated by
  // AppShell on mount; future plan 13-09 wires substrate engine events to keep
  // it live during the demo.
  const substrateStates = useSubstrateStore((s) => s.nodeStates);
  // Phase 9 Plan 09-03 (NONC-01): Copy Mode filter — graph shows L4 atoms only.
  const copyModeActive = useUiStore((s) => s.copyModeActive);
  const pushParent = useGraphStore((s) => s.pushParent);
  // Phase 4 Plan 04-01: single-click selects a node for the Inspector.
  // Co-existent with onNodeDoubleClick below (single = select, double =
  // drill) — RESEARCH Pattern 1.
  const selectNode = useGraphStore((s) => s.selectNode);
  const { setCenter, getNode, fitView } = useReactFlow();
  const [edges, setEdges] = useState<Edge[]>([]);

  // Refetch edges whenever the node set changes (lens switch / refresh).
  useEffect(() => {
    let cancelled = false;
    getEdges()
      .then((rs: GraphEdge[]) => {
        if (cancelled) return;
        setEdges(
          rs.map((e) => ({
            id: e.id,
            source: e.source_uuid,
            target: e.target_uuid,
          }))
        );
      })
      .catch((err) => console.warn('[graph] getEdges failed', err));
    return () => {
      cancelled = true;
    };
  }, [rows]);

  const nodes = useMemo<FlowNode[]>(() => {
    // Phase 9 Plan 09-03 (NONC-01): when Copy Mode is active, filter to L4
    // atoms only BEFORE layout so layout receives only the atoms — the canvas
    // behaves like "intent in product language" with code hidden.
    const visibleRows = copyModeActive
      ? rows.filter((r) => r.level === 'L4')
      : rows;
    return buildFlowNodes(
      visibleRows,
      driftedUuids,
      rollupStaleUuids,
      untrackedUuids,
      targetedNodeUuid,
      copyModeActive,
      massMatchedUuids,
      substrateStates,
    );
  }, [
    rows,
    driftedUuids,
    rollupStaleUuids,
    untrackedUuids,
    targetedNodeUuid,
    copyModeActive,
    massMatchedUuids,
    substrateStates,
  ]);

  // RESEARCH §Pitfall 9 — `fitView` prop races with `onlyRenderVisibleElements`
  // because virtualized nodes have no measured dimensions on first paint, so
  // React Flow fits to an empty bbox = blank viewport. Defer fitView to after
  // first paint via setTimeout so at least the initial visible-window nodes
  // have measured. Re-run when row count changes (lens switch / scan).
  //
  // Plan 03-03 dagre drive-by: lower the fitView minZoom floor to 0.05 so the
  // 500-node perf repo (5 wide L1 groups each containing a 10×10-ish grid of
  // L2 leaves) actually fits on first frame. The canvas-level minZoom was
  // also dropped to 0.05 so the user can pinch out far enough to see the
  // whole graph.
  useEffect(() => {
    if (rows.length === 0) return;
    const t = setTimeout(() => {
      fitView({ padding: 0.2, minZoom: 0.05, duration: 400 });
    }, 100);
    return () => clearTimeout(t);
  }, [rows.length, fitView]);

  // Single-click: select the node so the Inspector shows its details, AND set
  // it as the cherrypick target (CHRY-01 — ring glow appears immediately on
  // click, BEFORE any agent run begins).
  //
  // Does NOT drill — L4 atoms can be inspected without a drill, and L0-L3
  // drilling remains on double-click.
  const onNodeClick = useCallback(
    (_evt: unknown, node: Node) => {
      selectNode(node.id);
      // CHRY-01: set the targeted node UUID so the ring glow renders immediately.
      // The ring persists until (a) the user selects a different node or (b) the
      // cherrypick modal is approved/dismissed (CherrypickModal resets this on
      // successful Approve).
      useCherrypickStore.getState().setTarget(node.id);
    },
    [selectNode]
  );

  // Double-click drill-in: animate the viewport to the clicked node AND push
  // it onto parentUuidStack so the breadcrumb updates. L4 atoms do nothing
  // here — Phase 4 Monaco inspector owns that interaction.
  const onNodeDoubleClick = useCallback(
    (_evt: unknown, node: Node) => {
      const data = node.data as ContractNodeData | GroupNodeData;
      if (data.level === 'L4') return;
      const fresh = getNode(node.id);
      if (!fresh) return;
      const w = fresh.measured?.width ?? fresh.width ?? 160;
      const h = fresh.measured?.height ?? fresh.height ?? 60;
      const cx = fresh.position.x + w / 2;
      const cy = fresh.position.y + h / 2;
      setCenter(cx, cy, { zoom: 1.5, duration: 600 });
      pushParent(node.id);
    },
    [getNode, pushParent, setCenter]
  );

  // Phase 13 Plan 06: when the user has selected a flow contract from the
  // sidebar (and the contract is loaded with members), swap the default
  // L0/L1/L2/L3/L4 graph for the vertical participant chain. The default
  // graph hooks above still run unconditionally so that returning to
  // "no flow selected" instantly re-renders without re-fetching state.
  if (renderFlowChain) {
    return <FlowChainLayout />;
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes} // module-level const (Pitfall 1)
      onlyRenderVisibleElements // GRAPH-03 — DAY ONE per STATE.md
      minZoom={0.05}
      maxZoom={2}
      // NOTE: bare `fitView` prop intentionally OMITTED — see Pitfall 9 above.
      // The deferred fitView in useEffect handles initial framing without
      // racing with virtualization. defaultViewport supplies the first frame.
      defaultViewport={{ x: 0, y: 0, zoom: 0.3 }}
      onNodeClick={onNodeClick}
      onNodeDoubleClick={onNodeDoubleClick}
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      <Controls />
    </ReactFlow>
  );
}
