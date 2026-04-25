import { cn } from '@/lib/utils';
import type { ContractNode } from '@/ipc/types';
import { useDriftStore } from '@/store/drift';

/**
 * DriftBadge — visible indicator of drift state (INSP-04, Phase 4 Plan 04-02).
 *
 * Two signals OR'd together:
 *   - Static (SQLite): `code_hash` vs. `contract_hash` columns on the node row.
 *     Lags behind file changes until the next sidecar rescan / derive.
 *   - Live (Phase 7 watcher): `useDriftStore.driftedUuids` — fed by the
 *     `drift:changed` event from the Rust engine within ~2s of a source edit.
 *
 * Live drift trumps the static read so the badge stays in sync with the graph
 * pulse: a node that is pulsing red MUST show the Reconcile affordance, even
 * if `nodes.code_hash` hasn't been refreshed yet.
 */
type DriftState = 'synced' | 'drifted' | 'untracked';

function staticDriftState(node: ContractNode): DriftState {
  if (!node.code_hash || !node.contract_hash) return 'untracked';
  return node.code_hash === node.contract_hash ? 'synced' : 'drifted';
}

export default function DriftBadge({
  node,
  onReconcile,
}: {
  node: ContractNode | null;
  onReconcile?: () => void;
}) {
  const liveDrifted = useDriftStore((s) =>
    node ? s.driftedUuids.has(node.uuid) : false,
  );
  if (!node) return null;
  const staticState = staticDriftState(node);
  // Live drift event from the watcher overrides any static state — it is the
  // freshest evidence we have. Acknowledge clears it via setDrifted(false).
  const state: DriftState = liveDrifted ? 'drifted' : staticState;

  if (state === 'untracked') {
    return (
      <span className="text-[10px] text-muted-foreground shrink-0">
        Not derived
      </span>
    );
  }

  const isDrift = state === 'drifted';
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium shrink-0',
        isDrift
          ? 'bg-red-500/20 text-red-400'
          : 'bg-green-500/20 text-green-400',
      )}
    >
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full',
          isDrift ? 'bg-red-400 animate-pulse' : 'bg-green-400',
        )}
      />
      {isDrift ? 'Drifted' : 'Synced'}
      {isDrift ? (
        <button
          type="button"
          className="ml-1 underline hover:no-underline"
          onClick={() => onReconcile?.()}
        >
          Reconcile
        </button>
      ) : null}
    </div>
  );
}
