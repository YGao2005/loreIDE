/**
 * Phase 8 Plan 08-06 — UnpinnedAmberActions (PROP-04, unpinned-amber path).
 *
 * Three actions when a rollup-stale node is NOT pinned:
 *   1. Draft propagation for review — force-shown diff before any commit
 *   2. Accept as-is — one-line justification (REQUIRED for L1, optional L2/L3)
 *   3. Edit manually — close modal, let user edit in Monaco contract editor
 *
 * Pin-aware branching fires in ReconcilePanel BEFORE this component is rendered,
 * so SKIPPED-PINNED is unreachable from this path (PROP-04 invariant).
 */

import { useState } from 'react';
import type { ContractNode } from '@/ipc/types';
import { acceptRollupAsIs, draftPropagationDiff } from '@/ipc/reconcile';
import type { DraftPropagationContext } from '@/ipc/reconcile';
import DraftPropagationDiff from './DraftPropagationDiff';

interface Props {
  node: ContractNode;
  /** Calling panel's rollup_generation at render time (passed to avoid an extra read) */
  rollupGeneration: number;
  onClose: () => void;
}

type View = 'actions' | 'draft-diff';

export default function UnpinnedAmberActions({
  node,
  rollupGeneration,
  onClose,
}: Props) {
  const [view, setView] = useState<View>('actions');
  const [diffContext, setDiffContext] = useState<DraftPropagationContext | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const [justification, setJustification] = useState('');
  const [acceptLoading, setAcceptLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isL1 = node.level === 'L1';

  // ── Draft propagation for review ─────────────────────────────────────────

  const handleDraftPropagation = async () => {
    setDiffLoading(true);
    setError(null);
    try {
      const ctx = await draftPropagationDiff(node.uuid);
      setDiffContext(ctx);
      setView('draft-diff');
    } catch (e) {
      setError(`Failed to load diff context: ${String(e)}`);
    } finally {
      setDiffLoading(false);
    }
  };

  // ── Accept as-is ──────────────────────────────────────────────────────────

  const handleAccept = async () => {
    if (isL1 && !justification.trim()) {
      setError('Justification is required for L1 contracts.');
      return;
    }
    setAcceptLoading(true);
    setError(null);
    try {
      await acceptRollupAsIs({
        uuid: node.uuid,
        expectedGeneration: rollupGeneration,
        justification: justification.trim() || undefined,
        keepPin: false,
      });
      onClose();
    } catch (e) {
      const msg = String(e);
      if (msg.includes('rollup_generation mismatch')) {
        setError('Rollup state changed while panel was open — please close and reopen.');
      } else {
        setError(`Accept failed: ${msg}`);
      }
    } finally {
      setAcceptLoading(false);
    }
  };

  // ── Edit manually ─────────────────────────────────────────────────────────

  const handleEditManually = () => {
    // Close the reconcile modal — user lands back on the inspector with the
    // Contract tab visible so they can edit in the Monaco editor.
    onClose();
  };

  // ─────────────────────────────────────────────────────────────────────────

  if (view === 'draft-diff' && diffContext) {
    return (
      <DraftPropagationDiff
        context={diffContext}
        upstreamUuid={node.uuid}
        onBack={() => setView('actions')}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2 mt-1">
      {error && (
        <div className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1.5">
          {error}
        </div>
      )}

      {/* Action 1: Draft propagation for review */}
      <button
        type="button"
        disabled={diffLoading}
        onClick={handleDraftPropagation}
        className="text-left rounded-md border p-3 hover:bg-muted disabled:opacity-50"
      >
        <div className="font-medium text-sm">
          {diffLoading ? 'Loading context…' : 'Draft propagation for review'}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          Review what changed in cited child sections before deciding how to update
          this contract. Copies a proposed-edit prompt for your Claude Code session.
        </div>
      </button>

      {/* Action 2: Accept as-is */}
      <div className="rounded-md border p-3">
        <div className="font-medium text-sm mb-2">Accept as-is</div>
        <div className="text-xs text-muted-foreground mb-2">
          Mark the rollup as fresh without editing this contract body. Children may
          have changed, but this contract still accurately describes its purpose.
          {isL1 && (
            <span className="text-amber-600 font-medium"> Justification required for L1.</span>
          )}
        </div>
        <input
          type="text"
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          placeholder={
            isL1
              ? 'Justification (required for L1)…'
              : 'Justification (optional)…'
          }
          className="w-full text-xs border rounded px-2 py-1.5 mb-2 bg-background"
        />
        <button
          type="button"
          disabled={acceptLoading || (isL1 && !justification.trim())}
          onClick={handleAccept}
          className="w-full rounded-md bg-secondary text-secondary-foreground text-xs px-3 py-1.5 hover:bg-secondary/80 disabled:opacity-50 transition-colors"
        >
          {acceptLoading ? 'Accepting…' : 'Accept as-is'}
        </button>
      </div>

      {/* Action 3: Edit manually */}
      <button
        type="button"
        onClick={handleEditManually}
        className="text-left rounded-md border p-3 hover:bg-muted"
      >
        <div className="font-medium text-sm">Edit manually</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          Close this panel and edit the contract body in the Monaco editor. Saving
          will recompute section_hashes and trigger upstream propagation.
        </div>
      </button>
    </div>
  );
}
