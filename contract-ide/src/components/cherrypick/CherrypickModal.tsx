import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { Button } from '@/components/ui/button';
import { useCherrypickStore } from '@/store/cherrypick';
import { applyCherrypick } from '@/ipc/cherrypick';
import { OrientationHeader } from './OrientationHeader';
import { DiffPane } from './DiffPane';

/**
 * CherrypickModal — side-by-side diff modal for the cherrypick approve flow.
 *
 * CHRY-02: Persistent OrientationHeader above all diff panes.
 * CHRY-03: Single-click Approve fires ONE `applyCherrypick` IPC call (atomic).
 *
 * Per CONTEXT.md: functional bar, not demo-polished. Uses shadcn Dialog
 * defaults (no custom entrance/exit animation). Modal layout:
 *
 *   [OrientationHeader — sticky]
 *   [Contract diff pane]
 *   [Per-file code diff panes...]
 *   [Preview diff pane — placeholder for UI nodes]
 *   [Footer: Cancel | Approve]
 *
 * UI-node preview diff: deferred to v2 polish per CONTEXT.md ("skip
 * demo-grade polish on cherrypick"). Phase 8 ships a static placeholder
 * `DiffPane` with "(static preview diff deferred to v2)" content.
 *
 * Error handling: on Approve failure the modal stays open (user can read the
 * error and retry). The error is shown inline in the footer, not a toast
 * (no toast system installed at Phase 8).
 *
 * TODO(08-06 or Phase 9): Remove the synthetic dev affordance button
 * in Inspector.tsx and replace with real JSONL-derived pendingPatch once
 * the agent loop (08-04) populates the store.
 */
export function CherrypickModal() {
  // Individual selectors avoid returning a fresh object literal per render —
  // Zustand + useSyncExternalStore detect "different snapshot every call" and
  // throw the "getSnapshot should be cached" warning into an infinite loop.
  const pendingPatch = useCherrypickStore((s) => s.pendingPatch);
  const modalOpen = useCherrypickStore((s) => s.modalOpen);
  const closeModal = useCherrypickStore((s) => s.closeModal);

  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  // Guard: if no pendingPatch, render nothing (Dialog open={false} would work
  // too but this avoids mounting the Monaco editors unnecessarily).
  if (!pendingPatch || !modalOpen) return null;

  const handleCancel = () => {
    closeModal();
    useCherrypickStore.getState().setPendingPatch(null);
    setApproveError(null);
  };

  const handleApprove = async () => {
    if (approving) return; // idempotent guard
    setApproveError(null);
    setApproving(true);

    try {
      // CHRY-03 invariant: ONE IPC call, never multiple. The Approve click fires
      // exactly one `apply_cherrypick` with the full payload. The Rust side
      // writes sidecar + source files atomically via temp+rename.
      // Self-check: this handler MUST NOT contain a `for` loop calling separate
      // IPC calls — verify there is exactly one `await applyCherrypick(...)`.
      await applyCherrypick({
        uuid: pendingPatch.uuid,
        contractBody: pendingPatch.contractAfter,
        filePatches: pendingPatch.filePatches.map((p) => ({
          file: p.file,
          newContent: p.after,
        })),
      });

      // Success: close modal, clear patch, clear targeted ring (selection lifecycle done).
      closeModal();
      useCherrypickStore.getState().setPendingPatch(null);
      useCherrypickStore.getState().setTarget(null);
      console.info(`[cherrypick] Applied to ${pendingPatch.nodeName}`);
    } catch (err) {
      // Failure: keep modal open so user can read + retry.
      const msg = err instanceof Error ? err.message : String(err);
      setApproveError(msg);
      console.error('[cherrypick] apply_cherrypick failed:', msg);
    } finally {
      setApproving(false);
    }
  };

  // Determine if this is a UI node (kind checks deferred — use nodeName heuristic
  // or a future `nodeKind` field in PendingPatch). For now, show preview pane
  // only when explicitly flagged or always as a deferred placeholder.
  // TODO(v2): replace with real preview diff when preview rendering ships.
  const showPreviewPlaceholder = false; // conservative: only show for UI nodes

  return (
    <Dialog open={modalOpen} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent
        className="max-w-5xl w-full p-0 gap-0 flex flex-col overflow-hidden"
        showCloseButton={false}
        style={{ maxHeight: '85vh' }}
      >
        {/* Radix a11y requires a Title and Description on every DialogContent.
            The OrientationHeader carries the visible heading; we expose a
            screen-reader-only Title + Description for assistive tech. */}
        <VisuallyHidden.Root>
          <DialogTitle>Review and approve cherrypick patch</DialogTitle>
          <DialogDescription>
            Side-by-side diff for {pendingPatch.nodeName} contract and source files.
            Approve writes both atomically; Cancel discards.
          </DialogDescription>
        </VisuallyHidden.Root>

        {/* CHRY-02: Persistent orientation header — sticky above all diff panes */}
        <OrientationHeader
          nodeName={pendingPatch.nodeName}
          intentPhrase={pendingPatch.intentPhrase}
          toolCallCount={pendingPatch.toolCallCount}
        />

        {/* Scrollable diff panes area */}
        <div className="flex-1 overflow-y-auto">
          {/* Contract diff */}
          <DiffPane
            label="Contract"
            original={pendingPatch.contractBefore}
            modified={pendingPatch.contractAfter}
            language="markdown"
          />

          {/* Per-file source code diffs */}
          {pendingPatch.filePatches.map((patch) => (
            <DiffPane
              key={patch.file}
              label={patch.file}
              original={patch.before}
              modified={patch.after}
            />
          ))}

          {/* Preview diff — deferred placeholder for UI nodes */}
          {showPreviewPlaceholder && (
            <DiffPane
              label="Preview"
              original="(static preview diff deferred to v2)"
              modified="(static preview diff deferred to v2)"
              language="plaintext"
            />
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="border-t border-border/50">
          {approveError && (
            <p className="text-xs text-destructive mr-auto max-w-sm truncate" title={approveError}>
              {approveError}
            </p>
          )}
          <Button variant="outline" onClick={handleCancel} disabled={approving}>
            Cancel
          </Button>
          <Button onClick={handleApprove} disabled={approving}>
            {approving ? 'Applying…' : 'Approve'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
