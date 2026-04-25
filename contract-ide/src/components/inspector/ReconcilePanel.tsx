/**
 * Phase 7 DRIFT-02 + Phase 8 Plan 08-06 PROP-04: ReconcilePanel.
 *
 * Branch ORDER per CONTEXT.md: red (drift) > amber (rollup_stale) > gray/healthy.
 *
 * Existing Phase 7 drift branch is UNCHANGED (PROPAGATION.md "no retroactive
 * changes" mandate). The rollup-stale (amber) paths are SIBLING RENDERS added
 * alongside the drift branch — NOT a rewrite.
 *
 * Pin-aware branching fires BEFORE any writer call:
 *   rollupState === 'stale' AND human_pinned  → PinnedAmberActions
 *   rollupState === 'stale' AND !human_pinned → UnpinnedAmberActions
 * SKIPPED-PINNED is unreachable from both UI paths (Pitfall 5 / PROP-04 invariant).
 *
 * Prop signature PRESERVED (B3):
 *   (node: ContractNode | null, open: boolean, onClose: () => void)
 * Inspector.tsx passes the looked-up node object; this component does NOT pull
 * from useGraphStore (selectedNodeUuid only, no selectedNode).
 */

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ContractNode } from '@/ipc/types';
import { acknowledgeDrift } from '@/ipc/drift';
import { useDriftStore } from '@/store/drift';
import { useRollupStore } from '@/store/rollup';
import UnpinnedAmberActions from '@/components/reconcile/UnpinnedAmberActions';
import PinnedAmberActions from '@/components/reconcile/PinnedAmberActions';

interface Props {
  node: ContractNode | null;
  open: boolean;
  onClose: () => void;
}

export default function ReconcilePanel({ node, open, onClose }: Props) {
  if (!node) return null;

  // Read drift + rollup state from their stores by uuid.
  // human_pinned comes from the node prop (Inspector.tsx does the lookup and passes it down).
  // DO NOT pull from useGraphStore here — selectedNode is not exposed on the graph store.
  const isDrifted = useDriftStore((s) => s.driftedUuids.has(node.uuid));
  const rollupState = useRollupStore((s) =>
    s.rollupStaleUuids.has(node.uuid)
      ? ('stale' as const)
      : s.untrackedUuids.has(node.uuid)
        ? ('untracked' as const)
        : ('fresh' as const),
  );
  const isPinned = node.human_pinned ?? false;

  // ── Phase 7 DRIFT BRANCH — UNCHANGED ──────────────────────────────────────
  // This is the red-state path. It fires FIRST per the red > amber > gray
  // precedence. The body below is byte-identical to Phase 7's shipped code.

  if (isDrifted) {
    const files = (node.code_ranges ?? []).map((r) => r.file).join(', ');

    const derivationPrompt = `Use the \`contract-ide\` MCP server to update the contract at uuid=${node.uuid} to match its current source code.

1. Call \`get_contract({ uuid: "${node.uuid}" })\` to read the current sidecar.
2. Read each file listed in its \`code_ranges\`: ${files || '(no code_ranges)'}.
3. Derive a concise contract body describing what the code DOES (inputs, outputs, invariants, examples). Keep it under 40 lines.
4. Call \`write_derived_contract({ uuid: "${node.uuid}", body: "<derived body>" })\`. If it returns SKIPPED-PINNED, stop and report — this contract is human-pinned.`;

    const rewritePrompt = `Rewrite source code to match contract uuid=${node.uuid}.

1. Call \`get_contract({ uuid: "${node.uuid}" })\` to read the contract body — this is the spec.
2. Edit the source files listed in the contract's \`code_ranges\`: ${files || '(no code_ranges)'}.
3. Confirm the rewrite satisfies every invariant and example in the contract.
4. After the rewrite, call \`write_derived_contract({ uuid: "${node.uuid}", body: <unchanged spec> })\` so the IDE's \`code_hash\` baseline refreshes against the new source and the drift flag clears.`;

    const copy = async (text: string) => {
      await navigator.clipboard.writeText(text);
    };

    const onAcknowledge = async () => {
      try {
        await acknowledgeDrift(node.uuid);
        onClose();
      } catch (e) {
        console.error('acknowledge_drift failed', e);
      }
    };

    return (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reconcile {node.name ?? node.uuid.slice(0, 8)}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 mt-3">
            <button
              type="button"
              className="text-left rounded-md border p-3 hover:bg-muted"
              onClick={() => copy(derivationPrompt)}
            >
              <div className="font-medium text-sm">Update contract to match code</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Copies a derivation prompt for your Claude Code session. Pinned contracts are
                protected.
              </div>
            </button>
            <button
              type="button"
              className="text-left rounded-md border p-3 hover:bg-muted"
              onClick={() => copy(rewritePrompt)}
            >
              <div className="font-medium text-sm">Rewrite code to match contract</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Copies a rewrite prompt — paste into your Claude Code session.
              </div>
            </button>
            <button
              type="button"
              className="text-left rounded-md border p-3 hover:bg-muted"
              onClick={onAcknowledge}
            >
              <div className="font-medium text-sm">Acknowledge</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Mark the drift as intentional — keeps both versions as-is.
              </div>
            </button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Phase 8 ROLLUP-STALE BRANCH — SIBLING RENDER (PROP-04) ───────────────
  // Fires SECOND (after drift check). Pin-aware branching here ensures
  // SKIPPED-PINNED is unreachable from both action paths.

  if (rollupState === 'stale') {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Reconcile {node.name ?? node.uuid.slice(0, 8)}
              <span className="ml-2 text-xs font-normal text-amber-500">
                {isPinned ? 'pinned · rollup stale' : 'rollup stale'}
              </span>
            </DialogTitle>
          </DialogHeader>
          {isPinned ? (
            <PinnedAmberActions
              node={node}
              rollupGeneration={node.rollup_generation ?? 0}
              onClose={onClose}
            />
          ) : (
            <UnpinnedAmberActions
              node={node}
              rollupGeneration={node.rollup_generation ?? 0}
              onClose={onClose}
            />
          )}
        </DialogContent>
      </Dialog>
    );
  }

  // ── Healthy / untracked state — no reconcile needed ───────────────────────

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reconcile {node.name ?? node.uuid.slice(0, 8)}</DialogTitle>
        </DialogHeader>
        <div className="py-4 text-sm text-muted-foreground text-center">
          {rollupState === 'untracked'
            ? 'This contract has no rollup inputs configured — nothing to propagate.'
            : 'No reconciliation needed — contract and code are in sync.'}
        </div>
      </DialogContent>
    </Dialog>
  );
}
