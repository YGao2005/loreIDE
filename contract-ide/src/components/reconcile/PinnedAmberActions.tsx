/**
 * Phase 8 Plan 08-06 — PinnedAmberActions (PROP-04, pinned-amber path).
 *
 * Three actions when a rollup-stale node IS pinned:
 *   1. Review children's changes — read-only diff showing what drifted
 *   2. Unpin and reconcile — two-step: unpin via saveContract, then re-open
 *      as UnpinnedAmberActions automatically (isPinned is now false)
 *   3. Accept as-is, keep pin — justification required for L1; optional L2/L3
 *
 * Pin-aware branching fires in ReconcilePanel BEFORE this component renders,
 * so SKIPPED-PINNED is unreachable from this path (PROP-04 invariant).
 * accept_rollup_as_is re-checks pin state under DriftLocks at write time
 * as a belt-and-braces guard (Pitfall 5).
 */

import { useState } from 'react';
import type { ContractNode } from '@/ipc/types';
import { acceptRollupAsIs, readChildrenSectionDiffs } from '@/ipc/reconcile';
import type { ChildSectionDiff } from '@/ipc/reconcile';
import ChildrenChangesView from './ChildrenChangesView';
import { writeContract } from '@/ipc/contracts';
import { useGraphStore } from '@/store/graph';
import { readContractFrontmatter, hashText } from '@/ipc/inspector';

interface Props {
  node: ContractNode;
  rollupGeneration: number;
  onClose: () => void;
}

type View = 'actions' | 'children-changes';

export default function PinnedAmberActions({ node, rollupGeneration, onClose }: Props) {
  const [view, setView] = useState<View>('actions');
  const [childDiffs, setChildDiffs] = useState<ChildSectionDiff[]>([]);
  const [diffsLoading, setDiffsLoading] = useState(false);

  const [justification, setJustification] = useState('');
  const [acceptLoading, setAcceptLoading] = useState(false);
  const [unpinLoading, setUnpinLoading] = useState(false);
  const [unpinStep, setUnpinStep] = useState<'idle' | 'confirming'>('idle');
  const [error, setError] = useState<string | null>(null);

  const isL1 = node.level === 'L1';

  // ── Action 1: Review children's changes ───────────────────────────────────

  const handleReviewChildren = async () => {
    setDiffsLoading(true);
    setError(null);
    try {
      const diffs = await readChildrenSectionDiffs(node.uuid);
      setChildDiffs(diffs);
      setView('children-changes');
    } catch (e) {
      setError(`Failed to load children diffs: ${String(e)}`);
    } finally {
      setDiffsLoading(false);
    }
  };

  // ── Action 2: Unpin and reconcile (two-step) ──────────────────────────────

  const handleUnpinStart = () => {
    setUnpinStep('confirming');
  };

  const handleUnpinConfirm = async () => {
    setUnpinLoading(true);
    setError(null);
    try {
      const repoPath = useGraphStore.getState().repoPath;
      if (!repoPath) throw new Error('no repo open');

      // Merge-read pattern: read existing frontmatter to preserve server-derived
      // fields (neighbors, format_version, derived_at) before overwriting.
      const existing = await readContractFrontmatter(repoPath, node.uuid);
      const contractBody = node.contract_body ?? '';
      const newContractHash = await hashText(contractBody);

      await writeContract({
        repoPath,
        uuid: node.uuid,
        frontmatter: {
          format_version: existing?.format_version ?? 3,
          uuid: node.uuid,
          kind: node.kind,
          level: node.level,
          parent: node.parent_uuid && node.parent_uuid !== '' ? node.parent_uuid : null,
          neighbors: existing?.neighbors ?? [],
          code_ranges: node.code_ranges ?? [],
          code_hash: node.code_hash ?? null,
          contract_hash: newContractHash,
          human_pinned: false, // toggle: unpin
          route: node.route && node.route !== '' ? node.route : null,
          derived_at: existing?.derived_at ?? node.derived_at ?? null,
        },
        body: contractBody,
      });

      // Close modal — ReconcilePanel re-opens with isPinned=false → shows
      // UnpinnedAmberActions automatically on next open.
      onClose();
    } catch (e) {
      setError(`Unpin failed: ${String(e)}`);
      setUnpinStep('idle');
    } finally {
      setUnpinLoading(false);
    }
  };

  // ── Action 3: Accept as-is, keep pin ─────────────────────────────────────

  const handleAcceptKeepPin = async () => {
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
        keepPin: true,
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

  // ─────────────────────────────────────────────────────────────────────────

  if (view === 'children-changes') {
    return (
      <ChildrenChangesView
        diffs={childDiffs}
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

      {/* Action 1: Review children's changes */}
      <button
        type="button"
        disabled={diffsLoading}
        onClick={handleReviewChildren}
        className="text-left rounded-md border p-3 hover:bg-muted disabled:opacity-50"
      >
        <div className="font-medium text-sm">
          {diffsLoading ? 'Loading diffs…' : 'Review children\'s changes'}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          Read-only view of what changed in cited child sections since the last
          rollup commit. Helps decide whether to accept or reconcile.
        </div>
      </button>

      {/* Action 2: Unpin and reconcile */}
      <div className="rounded-md border p-3">
        <div className="font-medium text-sm mb-1">Unpin and reconcile</div>
        <div className="text-xs text-muted-foreground mb-2">
          Remove the manual pin and open the standard reconcile flow. Re-deriving
          may overwrite your manual edits to this contract body.
        </div>
        {unpinStep === 'idle' ? (
          <button
            type="button"
            onClick={handleUnpinStart}
            className="w-full rounded-md border text-xs px-3 py-1.5 hover:bg-muted transition-colors text-left"
          >
            Unpin this contract…
          </button>
        ) : (
          <div className="flex gap-2 items-center">
            <span className="text-xs text-amber-600 flex-1">
              Unpin this contract? Re-deriving may overwrite manual edits.
            </span>
            <button
              type="button"
              disabled={unpinLoading}
              onClick={handleUnpinConfirm}
              className="rounded-md bg-destructive text-destructive-foreground text-xs px-3 py-1.5 hover:bg-destructive/90 disabled:opacity-50"
            >
              {unpinLoading ? 'Unpinning…' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={() => setUnpinStep('idle')}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Action 3: Accept as-is, keep pin */}
      <div className="rounded-md border p-3">
        <div className="font-medium text-sm mb-1">Accept as-is, keep pin</div>
        <div className="text-xs text-muted-foreground mb-2">
          Mark the rollup as fresh while preserving your manual pin. Children may
          have changed, but this contract remains your authoritative version.
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
              : 'Justification (encouraged for pinned)…'
          }
          className="w-full text-xs border rounded px-2 py-1.5 mb-2 bg-background"
        />
        <button
          type="button"
          disabled={acceptLoading || (isL1 && !justification.trim())}
          onClick={handleAcceptKeepPin}
          className="w-full rounded-md bg-secondary text-secondary-foreground text-xs px-3 py-1.5 hover:bg-secondary/80 disabled:opacity-50 transition-colors"
        >
          {acceptLoading ? 'Accepting…' : 'Accept as-is, keep pin'}
        </button>
      </div>
    </div>
  );
}
