/**
 * Phase 13 Plan 06 — CHAIN-02: Custom react-flow edge with call-shape label.
 *
 * Renders a smooth-step edge between consecutive flow chain participants with
 * a small monospace label that describes the call shape — `{ field1, field2 }`
 * for matched JSON schemas, `?` for unmappable ones.
 *
 * Why a custom edge type:
 *   - react-flow's default edges don't support arbitrary positioned labels
 *     with our typography requirements (monospace pill, muted variant).
 *   - The `data: CallShape` payload from the assembler carries the label
 *     content + `matched: boolean` — both feed render decisions here.
 *
 * Visual treatment:
 *   - Matched (matched: true): white-ish text on slate background — reads as
 *     a confident "this passes through".
 *   - Mismatched (matched: false): muted slate-400 text — reads as "we tried
 *     but couldn't map" rather than alarming.
 *
 * Pointer events: NONE on the label so clicks pass through to the canvas
 * (panning + selection still work). The label is purely visual.
 *
 * Memoised at module scope per Plan 03-01 Pitfall 1 — every edge would
 * remount on each render otherwise.
 */

import { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';
import { cn } from '@/lib/utils';
import type { CallShape } from '@/lib/flowChainAssembler';

function CallShapeEdgeImpl({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });

  // The assembler stamps `data: CallShape` on every CallShape edge; defensive
  // fallback in case an edge mutation drops the data slot.
  const shape = data as CallShape | undefined;
  const label = shape?.label ?? '';
  const matched = shape?.matched ?? false;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          strokeWidth: 1.5,
          stroke: 'rgba(148, 163, 184, 0.6)',
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            // Stable selector hooks for plan 13-08 / 13-09 (PR review +
            // sync animations). data-callshape-matched also drives the
            // muted vs solid styling differentiation.
            data-callshape-matched={matched ? 'true' : 'false'}
            data-edge-id={id}
            className={cn(
              'absolute pointer-events-none rounded px-2 py-0.5 text-[11px] font-mono select-none',
              matched
                ? 'bg-slate-800/90 text-slate-100 border border-slate-700/50'
                : 'bg-slate-800/70 text-slate-400 border border-slate-700/30 italic',
            )}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            title={
              matched
                ? `Call shape: ${label}`
                : 'No matching call shape — schemas could not be reconciled'
            }
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/**
 * Memoised at module scope per Plan 03-01 Pitfall 1. Inline memo inside
 * edgeTypes record causes react-flow to remount every edge on every render.
 */
export const CallShapeEdge = memo(CallShapeEdgeImpl);
