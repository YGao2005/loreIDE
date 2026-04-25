/**
 * Phase 13 Plan 04 — CHIP-02: Atom chip side panel for ServiceCard.
 *
 * Renders a vertical column of small pills for L4 atom contracts whose
 * `parent_uuid` matches the participant uuid. Each chip is state-colored via
 * `resolveNodeState` (drifted / intent_drifted / rollup_stale / rollup_untracked
 * / superseded / healthy) so visual signals on chips match those on the parent
 * card.
 *
 * Click semantics: identical to CHIP-01 (Phase 13 Plan 05) — single-click sets
 * `selectedNodeUuid` via the canonical `selectNode` action, opening the
 * Inspector for that atom. The setter is `selectNode` (NOT `setSelectedNode`)
 * per checker N7 / plan 13-01 SUMMARY canonical-API-decision.
 *
 * Composition: rendered as a sibling of the ServiceCard body inside a flex
 * row, so chips sit BESIDE the card (not inside it). This keeps the card's
 * inner schemas/side-effects layout uncluttered and matches CARD-02 spec:
 * "atom chips on the side."
 *
 * State coloring uses the shared `resolveNodeState` from plan 13-01 so the
 * full visual-state precedence (drifted > intent_drifted > rollup_stale >
 * superseded > rollup_untracked > healthy) is enforced consistently across
 * cards, chips, and contract nodes.
 */

import { useGraphStore } from '@/store/graph';
import { useDriftStore } from '@/store/drift';
import { useRollupStore } from '@/store/rollup';
import { useSubstrateStore } from '@/store/substrate';
import { resolveNodeState } from './contractNodeStyles';
import { chipStyles } from './cardStyles';

export interface ServiceCardChipsProps {
  /** UUID of the participant (ServiceCard's owning contract uuid). */
  participantUuid: string;
}

export function ServiceCardChips({ participantUuid }: ServiceCardChipsProps) {
  // SELECTOR — only re-render when the rows ref changes. Filtering happens
  // outside the selector so we don't return a fresh array on every store
  // update; instead we recompute on every render of THIS component, which
  // already only re-renders when one of the subscribed stores changes.
  const allNodes = useGraphStore((s) => s.nodes);
  const driftedSet = useDriftStore((s) => s.driftedUuids);
  const rollupStaleSet = useRollupStore((s) => s.rollupStaleUuids);
  const untrackedSet = useRollupStore((s) => s.untrackedUuids);
  const substrateStates = useSubstrateStore((s) => s.nodeStates);

  // L4 atoms anchored to this participant.
  const atoms = allNodes.filter(
    (n) => n.parent_uuid === participantUuid && n.level === 'L4',
  );

  if (atoms.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 ml-2">
      {atoms.map((atom) => {
        const state = resolveNodeState(
          atom.uuid,
          driftedSet,
          rollupStaleSet,
          untrackedSet,
          substrateStates,
        );
        return (
          <button
            key={atom.uuid}
            type="button"
            data-atom-uuid={atom.uuid}
            data-state={state}
            className={chipStyles({ state })}
            onClick={() => {
              // Canonical setter API per plan 13-01 SUMMARY (checker N7).
              // NEVER use setSelectedNode — that name does not exist on the
              // graph store; the setter is `selectNode`.
              useGraphStore.getState().selectNode(atom.uuid);
            }}
            title={atom.name}
          >
            {atom.name}
          </button>
        );
      })}
    </div>
  );
}
