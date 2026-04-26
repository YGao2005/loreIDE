/**
 * Phase 13 Plan 06 — CHAIN-01 / CHAIN-02: Vertical participant chain layout.
 *
 * Top-level component that swaps in for the default L0/L1/L2/L3/L4 graph
 * when a flow contract is selected from the sidebar. Reads
 * `useSidebarStore.selectedFlowUuid`, looks up the flow contract's `members`
 * array (Phase 9 FLOW-01), feeds it through `assembleFlowChain`, and renders
 * a react-flow surface with deterministic top-to-bottom positioning.
 *
 * Mounting condition (decided by GraphCanvasInner):
 *   - `selectedFlowUuid` is non-null AND the flow contract is loaded AND it
 *     has a non-empty `members` array → render this component.
 *   - Otherwise: GraphCanvasInner falls through to its existing default
 *     layout (parent stack drill-in).
 *
 * Two-flow case (Beat 4): when this layout is the focused chain (i.e.,
 * `selectedFlowUuid` is the focused signal), `assembleFlowChain` flags
 * each ScreenCard with `isFocused: true` so it renders a live iframe.
 * For Beat 4's side-by-side comparison view, plan 13-09 will mount a second
 * FlowChainLayout instance for the non-focused flow with `isFocused: false`,
 * driving ScreenCards into the screenshot-fallback branch.
 *
 * Performance: react-flow's `onlyRenderVisibleElements` is enabled (matches
 * GraphCanvasInner's setting) so off-screen cards don't cost render. The
 * iframe perf budget (1 live + 6-8 ServiceCards @ 50fps) is validated in
 * Task 3's checkpoint.
 *
 * Empty state: "Select a flow from the sidebar" message renders when:
 *   - No `selectedFlowUuid` (sidebar hasn't been clicked yet).
 *   - The flow contract isn't in `useGraphStore.nodes` (still loading or deleted).
 *   - The flow has empty `members` (Phase 9 FLOW-01 hasn't shipped on this repo).
 */

import { useMemo } from 'react';
import { ReactFlow, Background, Controls } from '@xyflow/react';
import { useSidebarStore } from '@/store/sidebar';
import { useGraphStore } from '@/store/graph';
import { isFlowContract } from '@/ipc/types';
import { nodeTypes } from './nodeTypes';
import { edgeTypes } from './edgeTypes';
import { assembleFlowChain } from '@/lib/flowChainAssembler';

export function FlowChainLayout() {
  // Source signals: which flow is selected (from sidebar) + the loaded
  // contract set (from graphStore).
  const selectedFlowUuid = useSidebarStore((s) => s.selectedFlowUuid);
  const allNodes = useGraphStore((s) => s.nodes);

  const flowContract = useMemo(
    () =>
      selectedFlowUuid
        ? allNodes.find((n) => n.uuid === selectedFlowUuid)
        : null,
    [selectedFlowUuid, allNodes],
  );

  const memberUuids = useMemo<string[]>(() => {
    if (!flowContract) return [];
    if (!isFlowContract(flowContract)) return [];
    return flowContract.members;
  }, [flowContract]);

  const { nodes, edges } = useMemo(() => {
    if (!flowContract || memberUuids.length === 0) {
      return { nodes: [], edges: [] };
    }
    // Single-iframe policy: the currently selected flow IS the focused
    // flow; ScreenCards inside this chain render live iframes. Plan 13-09's
    // side-by-side view will pass a different focusedFlowUuid for the
    // non-focused twin.
    return assembleFlowChain(
      memberUuids,
      allNodes,
      selectedFlowUuid,
      flowContract.uuid,
    );
  }, [flowContract, memberUuids, allNodes, selectedFlowUuid]);

  // Empty state — decoupled from the react-flow canvas so users see a clear
  // signal when their click landed but the contract is missing or empty.
  if (!flowContract || memberUuids.length === 0) {
    // Diagnostic: when selectedFlowUuid is set but the contract isn't in the
    // loaded node set, the sidebar is showing flows from `get_sidebar_tree`
    // (walks .contracts/ on disk) while the canvas reads `useGraphStore.nodes`
    // (lens-aware SQLite fetch). A mismatch usually means the lens filtered
    // the flow out, or the initial scan hasn't completed. Surface both sides
    // so the user can see which.
    if (selectedFlowUuid && !flowContract) {
      console.warn(
        '[FlowChainLayout] selectedFlowUuid set but flow contract missing from useGraphStore.nodes',
        {
          selectedFlowUuid,
          loadedNodeCount: allNodes.length,
          loadedFlowUuids: allNodes.filter((n) => n.kind === 'flow').map((n) => n.uuid),
          firstFewNodeUuids: allNodes.slice(0, 5).map((n) => n.uuid),
        },
      );
    }
    return (
      <div className="flex h-full w-full items-center justify-center px-6">
        <div className="max-w-md text-center text-sm text-muted-foreground space-y-2">
          {!selectedFlowUuid && (
            <p>Select a flow from the sidebar to view its participant chain.</p>
          )}
          {selectedFlowUuid && !flowContract && (
            <>
              <p>Flow contract not found in loaded set.</p>
              <p className="font-mono text-[10px] break-all opacity-70">
                {selectedFlowUuid}
              </p>
              <p className="text-[11px] opacity-70">
                {allNodes.length === 0
                  ? 'No contracts loaded yet — open a repo or wait for the initial scan.'
                  : `${allNodes.length} contracts loaded, but none match this uuid. Lens filter may be excluding it.`}
              </p>
            </>
          )}
          {selectedFlowUuid && flowContract && memberUuids.length === 0 && (
            <p>This flow has no members yet (Phase 9 FLOW-01 not populated on this repo).</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      // Same flag GraphCanvasInner uses — gates virtualisation per RESEARCH
      // §Pitfall 9. With a chain of 8-12 cards the virtualisation savings are
      // modest, but the flag also makes plan 13-08's PR-review animation
      // pulse-only-visible-cards optimization possible.
      onlyRenderVisibleElements
      minZoom={0.3}
      maxZoom={1.5}
      // Deterministic layout means we know the chain extent up-front; do an
      // initial fitView to frame the whole chain. Padding is generous so the
      // call-shape edge labels at the chain edges aren't clipped.
      fitView
      fitViewOptions={{ padding: 0.2, minZoom: 0.3, maxZoom: 1.0 }}
      // Cards are deterministically positioned; dragging would break the
      // chain illusion. Connection drag and selection-on-drag also off.
      nodesDraggable={false}
      nodesConnectable={false}
      panOnDrag
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
