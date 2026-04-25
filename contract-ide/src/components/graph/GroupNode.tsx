import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { normalizeKind, type NodeHealthState, type RollupState } from './contractNodeStyles';

// Data shape for the group container variant. Shares the level/kind/etc. of
// the underlying contract row so the header renders identically to the leaf
// node's title, but the render treats it as a sized bordered rectangle with
// a header label and children positioned inside via React Flow's parentId.
export interface GroupNodeData {
  name: string;
  kind: string;
  state: NodeHealthState;
  isCanonical: boolean;
  level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
  /** Phase 8 Plan 08-02: rollup detection tri-state. Defaults to 'fresh'. */
  rollupState?: RollupState;
  /** Phase 8 Plan 08-05 (CHRY-01): true when this node is the current
   * cherrypick target. Adds a teal ring glow (suppressed by drift/rollup). */
  targeted?: boolean;
  [key: string]: unknown;
}

// Color map for the group border — lifted from contractNodeStyles.ts so the
// two variants read as the same family. Dashed when ghost (non-canonical).
const GROUP_KIND_BORDER: Record<string, string> = {
  UI: 'border-blue-400',
  API: 'border-violet-400',
  data: 'border-amber-400',
  job: 'border-emerald-400',
  unknown: 'border-slate-400',
};
const GROUP_KIND_BG: Record<string, string> = {
  UI: 'bg-blue-50/30',
  API: 'bg-violet-50/30',
  data: 'bg-amber-50/30',
  job: 'bg-amber-50/30',
  unknown: 'bg-slate-50/30',
};

/**
 * Memoized group container node (Plan 03-03 dagre drive-by).
 *
 * Rendered for any row with ≥1 in-set child. Width/height are driven by
 * layout.ts from the dagre-computed subtree bbox + padding, so the container
 * is always big enough for its children without needing `extent: 'parent'`
 * clamping (which was the bug the layout fix is replacing).
 *
 * Module-scope + React.memo (Pitfall 1) — same discipline as ContractNode.
 */
export const GroupNode = memo(function GroupNode({ data }: NodeProps) {
  const d = data as GroupNodeData;
  const kind = normalizeKind(d.kind);
  const isDrifted = d.state === 'drifted';
  const isRollupStale = d.rollupState === 'stale';
  const isRollupUntracked = d.rollupState === 'untracked';
  const isTargeted = d.targeted === true;

  // Precedence: drifted > rollupStale > rollupUntracked > targeted.
  // Targeted ring only renders when no higher-priority state applies.
  const showTargetedRing = isTargeted && !isDrifted && !isRollupStale && !isRollupUntracked;

  return (
    <div
      className={cn(
        'relative w-full h-full rounded-lg border-2',
        GROUP_KIND_BORDER[kind],
        GROUP_KIND_BG[kind],
        !d.isCanonical && 'border-dashed opacity-70',
        isDrifted && 'ring-2 ring-red-500',
        isRollupStale && !isDrifted && 'ring-2 ring-amber-400',
        isRollupUntracked && !isDrifted && !isRollupStale && 'ring-2 ring-slate-400 opacity-80',
        showTargetedRing && 'ring-2 ring-teal-400/70 animate-pulse [animation-duration:2000ms]',
        d.state === 'untested' && 'opacity-70'
      )}
      data-level={d.level}
      data-canonical={d.isCanonical ? 'true' : 'false'}
    >
      {/* Header label — absolute top-left so it sits in the GROUP_PADDING_TOP
          strip reserved by layout.ts, never overlaps children. */}
      <div className="absolute top-2 left-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider pointer-events-none">
        <span className="opacity-70">{d.level}</span>
        <span className="normal-case tracking-normal text-foreground">{d.name}</span>
      </div>
      {/* Handles kept so cross-group edges have somewhere to connect. */}
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  );
});
