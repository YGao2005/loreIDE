import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import {
  contractNodeStyles,
  normalizeKind,
  type NodeHealthState,
  type RollupState,
} from './contractNodeStyles';

export interface ContractNodeData {
  name: string;
  kind: string; // free-form from sidecar — normalized inside
  state: NodeHealthState;
  isCanonical: boolean;
  level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
  /** Phase 8 Plan 08-02: rollup detection tri-state. Defaults to 'fresh'. */
  rollupState?: RollupState;
  /** Phase 8 Plan 08-05 (CHRY-01): true when this node is the current
   * cherrypick target. Adds a teal ring glow that persists until selection
   * changes or the modal is approved/dismissed. Defaults to false. */
  targeted?: boolean;
  /** Phase 9 Plan 09-01 (MASS-01): animation delay in ms for staggered amber
   * pulse. Set by buildFlowNodes when uuid is in massMatchedUuids Map.
   * ContractNode applies this as inline CSS variable --match-delay.
   * Undefined when node is not a mass-edit match. */
  massMatchDelay?: number;
  [key: string]: unknown;
}

/**
 * Memoized custom node for the contract graph (GRAPH-04).
 *
 * MUST be defined at module scope (not inside another component) and wrapped
 * in React.memo. Combined with the module-level `nodeTypes` const in
 * ./nodeTypes.ts, this prevents React Flow from remounting every node every
 * frame — see RESEARCH §Pitfall 1.
 */
export const ContractNode = memo(function ContractNode({
  data,
}: NodeProps) {
  const d = data as ContractNodeData;
  // Phase 9 Plan 09-01 (MASS-01): apply --match-delay CSS variable for staggered
  // amber pulse when state==='mass_matched'. The CVA class reads this via
  // [animation-delay:var(--match-delay,0ms)].
  // Use `as React.CSSProperties` to satisfy TS — custom properties are not in
  // the CSSProperties type but are valid CSS. This is the established pattern
  // from Phase 8 Plan 08-05 for CSS variable injection.
  const matchDelayStyle =
    d.state === 'mass_matched' && d.massMatchDelay !== undefined
      ? ({ '--match-delay': `${d.massMatchDelay}ms` } as React.CSSProperties)
      : undefined;

  return (
    <div
      className={cn(
        contractNodeStyles({
          kind: normalizeKind(d.kind),
          state: d.state,
          rollupState: d.rollupState ?? 'fresh',
          canonical: d.isCanonical,
          targeted: d.targeted ?? false,
        })
      )}
      style={matchDelayStyle}
      data-level={d.level}
      data-canonical={d.isCanonical ? 'true' : 'false'}
    >
      <Handle type="target" position={Position.Top} />
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">
        {d.level}
      </span>
      {d.name}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});
