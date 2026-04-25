/**
 * Phase 13 Plan 02 — single-area row + per-flow row.
 *
 * Renders a click-to-toggle area row showing the area name (or italic "Root"
 * for ROOT_AREA), three optional badges (drift / rollup-stale / intent-drifted
 * counts), and an expand chevron. When expanded, child flow rows render below
 * indented; clicking a flow updates the sidebar store + graph store parent
 * stack so plan 13-06's FlowChain can render the L2 vertical chain.
 *
 * **Performance discipline:** the three badge counts are computed via Zustand
 * selectors (one per store) so the row only re-renders when the relevant Set
 * identity changes. `area.member_uuids` is a stable array reference per render
 * (it's part of the memoized SidebarArea object from the IPC). We `.filter()`
 * inside the selector to keep the read tight — the alternative (selecting the
 * whole Set + filtering in the body) would re-render every row whenever any
 * uuid in any Set flips.
 *
 * **Visual consistency:** badge colors mirror the CVA variants from plan 13-01:
 *   - drift           → red-500   (matches contractNodeStyles.state.drifted)
 *   - rollup-stale    → amber-500 (matches contractNodeStyles.rollupState.stale)
 *   - intent-drifted  → orange-600 (matches contractNodeStyles.state.intent_drifted)
 *
 * Using inline span pills (not shadcn Badge) keeps the dep weight zero and
 * lets us tune the 16px width / 10px text without overriding shadcn defaults.
 */

import { ChevronRightIcon } from 'lucide-react';
import { useDriftStore } from '@/store/drift';
import { useRollupStore } from '@/store/rollup';
import { useSubstrateStore } from '@/store/substrate';
import { useSidebarStore } from '@/store/sidebar';
import { useGraphStore } from '@/store/graph';
import { ROOT_AREA, type SidebarArea, type SidebarFlow } from '@/ipc/sidebar';
import { cn } from '@/lib/utils';

interface AreaItemProps {
  area: SidebarArea;
}

export function SidebarAreaItem({ area }: AreaItemProps) {
  const expanded = useSidebarStore((s) => s.expandedAreas.has(area.area));
  const toggle = useSidebarStore((s) => s.toggleArea);

  // Badge counts — selectors compute the per-area count by filtering
  // `area.member_uuids` against each store's Set/Map. The selector returns a
  // primitive number, so referential equality works without a custom equality
  // fn — Zustand re-fires the selector on every store change but only triggers
  // a re-render when the count value changes.
  const driftCount = useDriftStore((s) =>
    area.member_uuids.reduce((acc, u) => acc + (s.driftedUuids.has(u) ? 1 : 0), 0),
  );
  const rollupStaleCount = useRollupStore((s) =>
    area.member_uuids.reduce((acc, u) => acc + (s.rollupStaleUuids.has(u) ? 1 : 0), 0),
  );
  const intentDriftedCount = useSubstrateStore((s) =>
    area.member_uuids.reduce(
      (acc, u) => acc + (s.nodeStates.get(u) === 'intent_drifted' ? 1 : 0),
      0,
    ),
  );

  const displayName = area.area === ROOT_AREA ? 'Root' : area.area;
  const isRoot = area.area === ROOT_AREA;

  return (
    <div data-area={area.area} className="select-none">
      <button
        type="button"
        onClick={() => toggle(area.area)}
        aria-expanded={expanded}
        className={cn(
          'group flex w-full items-center gap-1 rounded-md px-2 py-1 text-xs',
          'text-foreground/85 hover:bg-muted/40 transition-colors',
        )}
      >
        <ChevronRightIcon
          className={cn(
            'h-3 w-3 shrink-0 text-muted-foreground/70 transition-transform duration-150',
            expanded && 'rotate-90',
          )}
          aria-hidden
        />
        <span
          className={cn(
            'truncate',
            isRoot && 'italic text-muted-foreground',
          )}
        >
          {displayName}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {driftCount > 0 && (
            <Badge variant="drift" title={`${driftCount} drifted`}>
              {driftCount}
            </Badge>
          )}
          {rollupStaleCount > 0 && (
            <Badge variant="rollup" title={`${rollupStaleCount} rollup stale`}>
              {rollupStaleCount}
            </Badge>
          )}
          {intentDriftedCount > 0 && (
            <Badge variant="intent" title={`${intentDriftedCount} intent drifted`}>
              {intentDriftedCount}
            </Badge>
          )}
        </span>
      </button>
      {expanded && (
        <div className="ml-4 mt-0.5 border-l border-border/40 pl-2">
          {area.flows.length > 0 ? (
            area.flows.map((flow) => (
              <SidebarFlowItem key={flow.uuid} flow={flow} />
            ))
          ) : (
            <div className="px-2 py-1 text-[10px] italic text-muted-foreground/70">
              No flows yet
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Per-flow row inside an expanded area. Click selects the flow, updates the
 * sidebar store's `selectedFlowUuid`, AND drives the graph canvas toward this
 * flow's L2 chain via `useGraphStore.pushParent(flow.uuid)`.
 *
 * Plan 13-06 will refine the canvas response (the FlowChain renderer) — for
 * now we just hook up the navigation so the parent stack is correct.
 */
function SidebarFlowItem({ flow }: { flow: SidebarFlow }) {
  const selectedFlowUuid = useSidebarStore((s) => s.selectedFlowUuid);
  const setSelectedFlow = useSidebarStore((s) => s.setSelectedFlow);
  const isSelected = selectedFlowUuid === flow.uuid;

  return (
    <button
      type="button"
      onClick={() => {
        setSelectedFlow(flow.uuid);
        // Push onto the graph store's parent stack so the canvas drills into
        // this flow's L2 view. Phase 13-06 will refine what that view shows;
        // today the canvas re-fetches with the new parent context.
        useGraphStore.getState().pushParent(flow.uuid);
      }}
      data-flow-uuid={flow.uuid}
      data-selected={isSelected}
      className={cn(
        'block w-full rounded px-2 py-0.5 text-left text-[11px] transition-colors',
        isSelected
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
      )}
    >
      <span className="truncate">{flow.name}</span>
    </button>
  );
}

/**
 * Inline pill badge — 16px-min width, 10px text, color-coded per variant.
 *
 * Hex values intentionally match contractNodeStyles.ts so the sidebar reads as
 * a "preview" of canvas state (drift = red-500, rollup-stale = amber-500,
 * intent_drifted = orange-600 — all from CVA variants in plan 13-01).
 */
function Badge({
  variant,
  children,
  title,
}: {
  variant: 'drift' | 'rollup' | 'intent';
  children: React.ReactNode;
  title?: string;
}) {
  const variantClasses = {
    drift: 'bg-red-500/15 text-red-400 ring-1 ring-red-500/40',
    rollup: 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/40',
    intent: 'bg-orange-600/15 text-orange-400 ring-1 ring-orange-600/40',
  }[variant];

  return (
    <span
      title={title}
      data-badge-variant={variant}
      className={cn(
        'inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums',
        variantClasses,
      )}
    >
      {children}
    </span>
  );
}
