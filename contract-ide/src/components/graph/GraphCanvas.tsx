import { GraphCanvasInner } from './GraphCanvasInner';
import { Breadcrumb } from './Breadcrumb';
import { ScreenViewerOverlay } from './ScreenViewerOverlay';

/**
 * Public mount point for the contract graph canvas (Phase 3 / GRAPH-01).
 *
 * ReactFlowProvider lives in AppShell.tsx (Plan 03-03 Step 1) so the global
 * Cmd+K palette can call useReactFlow() too. Do NOT re-wrap here — that would
 * create a nested provider and useReactFlow() in CommandPalette would resolve
 * against the OUTER provider while Breadcrumb resolves against the INNER one,
 * silently desynchronizing viewport state.
 *
 * Layout: a vertical flex column — Breadcrumb pinned to the top, canvas
 * filling the remaining space. Both children rely on the AppShell-level
 * <ReactFlowProvider> being in scope; if you see "ReactFlowProvider missing"
 * crashes on boot, the provider was removed from AppShell.
 *
 * The wrapper is `relative` so ScreenViewerOverlay (Phase 13 Plan 12) can use
 * `absolute inset-0` to cover only the Graph area when the user expands a
 * ScreenCard via ⤢ — Sidebar, bottom Inspector, and Chat panel remain visible
 * and interactive.
 */
export function GraphCanvas() {
  return (
    <div className="relative flex flex-col h-full w-full">
      <Breadcrumb />
      <div className="flex-1 min-h-0">
        <GraphCanvasInner />
      </div>
      <ScreenViewerOverlay />
    </div>
  );
}
