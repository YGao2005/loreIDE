/**
 * Phase 13 Plan 05 — CHIP-01: Single atom chip rendered in the parent layer
 * over a ScreenCard's iframe.
 *
 * Each chip sits at an absolute position inside the AtomChipOverlay container,
 * matching the bounding rect of the corresponding `[data-contract-uuid]`
 * element in the iframe DOM. Hover lights the chip; click opens the Inspector
 * for that atom AND sets `focusedAtomUuid` for chip-halo tracking.
 *
 * State coloring uses `resolveNodeState` from plan 13-01 — single source of
 * truth across cards / chips / contract nodes (drifted > intent_drifted >
 * rollup_stale > superseded > rollup_untracked > healthy precedence).
 *
 * Canonical store API (per plan 13-01 SUMMARY checker N7):
 *   - `useGraphStore.getState().selectNode(uuid)` — Inspector target.
 *   - `useGraphStore.getState().setFocusedAtomUuid(uuid)` — chip halo target.
 *   NEVER `setSelectedNode`. NEVER raw `setState({ focusedAtomUuid })`.
 *
 * `pointer-events-auto` on the chip itself; the parent overlay container has
 * `pointer-events-none`. This is the foundation of "Inspect mode" (default):
 * the chip catches clicks; everything else passes through to the iframe (which
 * has `pointer-events: none` while in Inspect mode — flipped by ScreenCard's
 * Inspect/Interact toggle in its header).
 *
 * `data-atom-uuid` + `data-state` DOM attributes mirror plan 13-04's
 * ServiceCardChips so plan 13-07's chat-archaeology citation halo can use the
 * same selector across both card variants.
 */

import { memo } from 'react';
import { cva } from 'class-variance-authority';
import { useGraphStore } from '@/store/graph';
import { useDriftStore } from '@/store/drift';
import { useRollupStore } from '@/store/rollup';
import { useSubstrateStore } from '@/store/substrate';
import { useCitationStore } from '@/store/citation';
import { resolveNodeState, citationHaloClass } from './contractNodeStyles';

/**
 * AtomChip CVA — bounding-rect overlay pill with state-keyed coloring.
 *
 * Shape: a sized box positioned absolutely; clicking it selects the underlying
 * atom. The `state` keys match plan 13-01 NodeVisualState exactly so
 * resolveNodeState's output is valid here.
 *
 * The orange-600 + 8px glow on `intent_drifted` is intentionally identical to
 * the ContractNode and ServiceCard versions of the same state — visual
 * consistency across the canvas surface is a load-bearing demo property
 * (per 13-RESEARCH.md Pitfall 6: amber-500 vs orange-500 collapses under
 * compressed video bitrate; orange-600 + box-shadow is the differentiator).
 *
 * `focused` adds a soft halo when this chip is the target of `focusedAtomUuid`
 * (set by Cmd+P L4 atom-hit landing — plan 13-03). Distinct from `state` so a
 * focused-AND-drifted chip stays red but also gets the focus halo.
 */
const chipStyles = cva(
  'absolute pointer-events-auto inline-flex items-center justify-center rounded-md text-[11px] font-medium border-2 transition-all cursor-pointer overflow-hidden',
  {
    variants: {
      state: {
        healthy:
          'border-blue-400/70 bg-blue-500/10 text-blue-200 hover:border-blue-300 hover:bg-blue-500/20',
        drifted:
          'border-red-500 bg-red-500/20 text-red-100 animate-pulse',
        rollup_stale:
          'border-amber-500 bg-amber-500/20 text-amber-100 animate-pulse',
        rollup_untracked:
          'border-slate-400 bg-slate-500/10 text-slate-300 opacity-60',
        intent_drifted:
          'border-orange-600 bg-orange-500/20 text-orange-100 animate-pulse shadow-[0_0_8px_2px_rgba(234,88,12,0.4)]',
        superseded:
          'border-orange-400 bg-orange-500/10 text-orange-200 opacity-75',
      },
      focused: {
        true: 'ring-2 ring-blue-300 shadow-lg scale-105 z-10',
        false: '',
      },
    },
    defaultVariants: {
      state: 'healthy',
      focused: false,
    },
  },
);

export interface AtomChipProps {
  /** Contract atom uuid — keys into substrate / drift / rollup state stores. */
  uuid: string;
  /** Display name for the chip (atom contract name, truncated to fit). */
  name: string;
  /** Bounding rect in iframe-local coordinates (top/left/width/height). */
  rect: { top: number; left: number; width: number; height: number };
}

function AtomChipImpl({ uuid, name, rect }: AtomChipProps) {
  const drifted = useDriftStore((s) => s.driftedUuids);
  const rollupStale = useRollupStore((s) => s.rollupStaleUuids);
  const untracked = useRollupStore((s) => s.untrackedUuids);
  const substrate = useSubstrateStore((s) => s.nodeStates);
  const focusedAtomUuid = useGraphStore((s) => s.focusedAtomUuid);
  // Phase 13 Plan 07 — citation halo. Orthogonal to `focused` (which is the
  // Cmd+P L4 atom-hit halo) — both can be true simultaneously without
  // conflict because each adds its own additive class.
  const haloUuid = useCitationStore((s) => s.highlightedUuid);
  const state = resolveNodeState(
    uuid,
    drifted,
    rollupStale,
    untracked,
    substrate,
  );
  const focused = focusedAtomUuid === uuid;
  const haloed = haloUuid === uuid;

  return (
    <button
      type="button"
      data-atom-uuid={uuid}
      data-state={state}
      className={[chipStyles({ state, focused }), haloed ? citationHaloClass : '']
        .filter(Boolean)
        .join(' ')}
      style={{
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      }}
      onClick={(e) => {
        // stopPropagation so the click doesn't bubble to the react-flow node
        // and trigger an unintended node-selection in the canvas surface.
        e.stopPropagation();
        // Canonical store API per plan 13-01 SUMMARY (checker N7).
        // NEVER setSelectedNode — that name does not exist on the graph
        // store; the setter is `selectNode`. Likewise never raw
        // setState({ focusedAtomUuid }) — use the typed action.
        useGraphStore.getState().selectNode(uuid);
        useGraphStore.getState().setFocusedAtomUuid(uuid);
      }}
      title={name}
    >
      <span className="truncate px-1">{name}</span>
    </button>
  );
}

/**
 * Memoised at module scope so each chip only re-renders when its own props
 * change — important because AtomChipOverlay re-renders whenever any chip's
 * rect changes, and an unmemoised AtomChip would re-render every chip in the
 * overlay on every load/resize event.
 */
export const AtomChip = memo(AtomChipImpl);
