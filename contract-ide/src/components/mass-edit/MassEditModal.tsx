/**
 * Phase 9 Plan 09-02 — MassEditModal: the main mass-edit review queue Dialog.
 *
 * Opened by MassEditTrigger after the 3-second amber-pulse hold.
 *
 * Structure:
 *   DialogHeader  — "Mass edit: '{query}'" title +
 *                   "{N} nodes matched — {M} pinned, will skip" predictive count
 *   EMBEDDING_DISABLED notice (when embeddingStatus === 'disabled')
 *   ScrollArea    — one MatchedNodeRow per candidate
 *   Result banner — MassEditResultBanner (visible post-apply)
 *   DialogFooter  — "Select all (non-pinned)" · "Approve N selected" · "Cancel/Close"
 *
 * PREDICTIVE pinned count (must_haves truth #4):
 *   Header shows "{M} pinned, will skip" BEFORE apply, computed as
 *   candidates.filter(c => c.human_pinned).length. Surfaces the skip count
 *   so a "0 nodes applied" post-apply result doesn't look like a bug on camera.
 *
 * EMBEDDING_DISABLED notice (must_haves truth #10 / closes 09-01 truth #5):
 *   When embeddingStatus === 'disabled', renders an inline notice ABOVE the
 *   matched-node list with exact copy:
 *     "semantic similarity unavailable — keyword matches only"
 *   (en-dash between "unavailable" and "keyword"). 09-06 UAT Test 1 grep-
 *   asserts this string verbatim — the copy must not be paraphrased.
 *
 * Approve handler (serial execution):
 *   Iterates selectedUuids serially (one applyMassEdit call per node, awaited).
 *   Serial avoids racing the Rust FSEvents debouncer and SQLite serialization.
 *   V1: body = node.body (no-op write — proves the plumbing). Future phases
 *   will wire an agent-produced delta; for demo dogfood this suffices.
 *
 * POST-APPLY pinned count (must_haves truth #5):
 *   MassEditResultBanner accumulates skipped_pinned from the apply loop.
 *   Note: since we detect pinned CLIENT-SIDE before calling write_contract,
 *   skipped_pinned is counted here not from a SKIPPED-PINNED response prefix
 *   but from applyMassEdit returning status='skipped_pinned'.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useMassEditStore } from '@/store/massEdit';
import { applyMassEdit } from '@/ipc/mass-edit';
import { MatchedNodeRow } from './MatchedNodeRow';
import { MassEditResultBanner } from './MassEditResultBanner';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function MassEditModal({ open, onClose }: Props) {
  const candidates = useMassEditStore((s) => s.candidates);
  const embeddingStatus = useMassEditStore((s) => s.embeddingStatus);
  const selectedUuids = useMassEditStore((s) => s.selectedUuids);
  const toggle = useMassEditStore((s) => s.toggleSelected);
  const setAll = useMassEditStore((s) => s.setAllSelected);
  const applyState = useMassEditStore((s) => s.applyState);
  const setApplyState = useMassEditStore((s) => s.setApplyState);
  const setResult = useMassEditStore((s) => s.setResult);
  const query = useMassEditStore((s) => s.query);

  // PREDICTIVE pinned count — must_haves truth #4.
  // Computed from candidates.filter(human_pinned).length BEFORE any apply runs.
  // 09-01 surfaces human_pinned as a first-class boolean field on each match.
  const pinnedCount = candidates.filter((c) => c.human_pinned).length;

  async function approveSelected() {
    setApplyState('applying');
    const toApply = candidates.filter((c) => selectedUuids.has(c.uuid));

    let applied = 0;
    let skipped_pinned = 0;
    let errors = 0;

    // Serial execution: one applyMassEdit per node, awaited before the next.
    // Avoids hammering the Rust FSEvents debounce + SQLite serialization layer
    // simultaneously. write_contract acquires a per-UUID DriftLock so concurrent
    // calls would contend anyway — serial is the correct model.
    for (const node of toApply) {
      try {
        // V1: body = node.body (no-op write — proves the plumbing end-to-end).
        // The real agent-produced delta path is wired in a future phase.
        // For demo purposes this still exercises the full IPC stack:
        // readContractFrontmatter → pin check → writeContract → cascade trigger.
        const result = await applyMassEdit({ uuid: node.uuid, body: node.body });

        if (result.status === 'applied') {
          applied++;
        } else if (result.status === 'skipped_pinned') {
          skipped_pinned++;
        } else {
          errors++;
          console.error(
            `[MassEditModal] applyMassEdit error for ${node.uuid}:`,
            result.message,
          );
        }
      } catch (e) {
        errors++;
        console.error(`[MassEditModal] applyMassEdit threw for ${node.uuid}:`, e);
      }
    }

    // Store result (POST-APPLY pinned count is in skipped_pinned — must_haves truth #5).
    setResult({
      applied,
      skipped_pinned,
      errors,
      rollupStaleAtApply: 0, // reserved; MassEditResultBanner diffs live from store
    });
    setApplyState('done');
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>Mass edit: &ldquo;{query}&rdquo;</DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {candidates.length} node{candidates.length !== 1 ? 's' : ''} matched
            {pinnedCount > 0 && (
              <span className="text-amber-900">
                {' '}
                — {pinnedCount} pinned, will skip
              </span>
            )}
          </p>
        </DialogHeader>

        {/* EMBEDDING_DISABLED notice — must_haves truth #10.
            Renders ABOVE the matched-node list.
            COPY IS LOCKED — exact string asserted by 09-06 UAT Test 1:
            "semantic similarity unavailable — keyword matches only"
            (en-dash between "unavailable" and "keyword"). Do NOT paraphrase. */}
        {embeddingStatus === 'disabled' && (
          <div
            role="status"
            aria-live="polite"
            className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          >
            semantic similarity unavailable — keyword matches only
          </div>
        )}

        {/* Matched-node list */}
        <ScrollArea className="flex-1 border rounded-md min-h-0 overflow-auto">
          {candidates.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No candidates loaded.
            </div>
          )}
          {candidates.map((c) => (
            <MatchedNodeRow
              key={c.uuid}
              match={c}
              selected={selectedUuids.has(c.uuid)}
              onToggle={() => toggle(c.uuid)}
            />
          ))}
        </ScrollArea>

        {/* Post-apply result banner — visible only when applyState === 'done' */}
        {applyState === 'done' && <MassEditResultBanner />}

        <DialogFooter className="shrink-0 flex-wrap gap-2">
          {applyState !== 'done' && (
            <Button
              variant="outline"
              onClick={() =>
                setAll(
                  candidates.filter((c) => !c.human_pinned).map((c) => c.uuid),
                )
              }
              disabled={applyState === 'applying'}
            >
              Select all (non-pinned)
            </Button>
          )}
          {applyState !== 'done' && (
            <Button
              onClick={() => void approveSelected()}
              disabled={selectedUuids.size === 0 || applyState === 'applying'}
            >
              {applyState === 'applying'
                ? 'Applying…'
                : `Approve ${selectedUuids.size} selected`}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            {applyState === 'done' ? 'Close' : 'Cancel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
