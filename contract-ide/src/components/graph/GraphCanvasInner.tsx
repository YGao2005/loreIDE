/**
 * Canvas surface — always renders the vertical participant chain via
 * `FlowChainLayout`. The legacy abstract L0/L1/L2/L3/L4 grouped-graph render
 * was removed: it predated CANVAS-PURPOSE.md (which collapsed L0/L1 into the
 * sidebar and reframed L2 as a vertical flow chain) and only fired when no
 * flow was selected, leaving users staring at nested boxes that had no
 * purchase on the agent-decision-verification framing.
 *
 * Empty-state coverage lives inside `FlowChainLayout` itself:
 *   - No `selectedFlowUuid`               → "Select a flow from the sidebar"
 *   - Selected flow contract not loaded   → "Loading flow contract…"
 *   - Flow has no `members` array        → "This flow has no members yet"
 *
 * Entry points that drive `selectedFlowUuid`:
 *   - Sidebar flow row click            (SidebarAreaItem.tsx)
 *   - Cmd+P flow / L3 / L4 hits         (IntentPalette.tsx — resolves the
 *                                        owning flow via `members` lookup)
 *
 * If a future surface wants to navigate the canvas, it must call
 * `useSidebarStore.setSelectedFlow(flowUuid)` — pushing onto the parent stack
 * alone (legacy Breadcrumb signal) does NOT change the canvas.
 */

import { FlowChainLayout } from './FlowChainLayout';

export function GraphCanvasInner() {
  return <FlowChainLayout />;
}
