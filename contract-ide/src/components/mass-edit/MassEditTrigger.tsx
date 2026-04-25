/**
 * Phase 9 Plan 09-02 — MassEditTrigger: the entry flow for mass-edit.
 *
 * Three-stage state machine:
 *   'query'      → text input dialog asking "What do you want to change?"
 *   'pulsing'    → confirmation overlay while amber pulse holds ≥3s on canvas
 *   'modal'      → MassEditModal opens (this component hides)
 *   'no-results' → empty-state within the query dialog
 *
 * Flow:
 *   1. User opens via Cmd+K → "Mass edit by intent…"
 *   2. Enters a query; clicks "Find matches"
 *   3. findByIntentMass(query) fires; on response:
 *      - setCandidates / setEmbeddingStatus / setMatches on the store
 *      - Snapshot rollupStaleAtStart from useRollupStore (MASS-02 cascade diff)
 *   4. "Pulsing" overlay shows "{N} nodes match — reviewing in 3s…"
 *   5. After 3 000 ms, stage advances to 'modal' → MassEditModal renders
 *   6. On modal close, clearMatches() + resetReviewQueue() + onClose() called
 *
 * The ≥3s pulse hold is the on-camera "search feels systematic, not crashed"
 * signal per MASS-01 spec truth #2. The amber pulse itself is driven by
 * setMatches() triggering the mass_matched CVA variant in ContractNode (09-01).
 */

import { useState } from 'react';
import { useMassEditStore } from '@/store/massEdit';
import { useRollupStore } from '@/store/rollup';
import { findByIntentMass } from '@/ipc/mass-edit';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { MassEditModal } from './MassEditModal';

// Input component may not be installed yet — if it's missing we inline a
// bare <input> as a Rule 3 fallback below. Check at build time; tsc will
// catch the import error if the file doesn't exist.

interface Props {
  /** Whether the trigger dialog is open (controlled by CommandPalette / AppShell). */
  open: boolean;
  /** Called when the user dismisses at any stage (no-results Cancel, modal X, etc.) */
  onClose: () => void;
}

type Stage = 'query' | 'pulsing' | 'modal' | 'no-results';

export function MassEditTrigger({ open, onClose }: Props) {
  const [stage, setStage] = useState<Stage>('query');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Store actions
  const setQuery = useMassEditStore((s) => s.setQuery);
  const setCandidates = useMassEditStore((s) => s.setCandidates);
  const setEmbeddingStatus = useMassEditStore((s) => s.setEmbeddingStatus);
  const setMatches = useMassEditStore((s) => s.setMatches);
  const clearMatches = useMassEditStore((s) => s.clearMatches);
  const resetReviewQueue = useMassEditStore((s) => s.resetReviewQueue);

  // Candidate count from store (for the pulsing overlay)
  const candidates = useMassEditStore((s) => s.candidates);

  async function handleSubmit() {
    if (!draft.trim()) return;
    setLoading(true);
    setError(null);
    setQuery(draft.trim());

    try {
      const response = await findByIntentMass(draft.trim(), 100);

      if (response.matches.length === 0) {
        setLoading(false);
        setStage('no-results');
        return;
      }

      // Populate review-queue state BEFORE calling setMatches so that when
      // ContractNode reads massMatchDelay from the store it can already see
      // the candidates list (not strictly needed but keeps store consistent).
      setCandidates(response.matches);

      // Capture embedding_status so MassEditModal can render the keyword-only
      // notice. Must happen BEFORE modal opens (must_haves truth #10).
      setEmbeddingStatus(response.embedding_status);

      // Start the amber pulse by populating matchedUuids (09-01 primitive).
      setMatches(response.matches.map((m) => m.uuid));

      // Snapshot rollup stale count BEFORE apply so MassEditResultBanner can
      // diff against the post-apply count (MASS-02 upstream-impact visibility).
      useMassEditStore.setState({
        rollupStaleAtStart: useRollupStore.getState().rollupStaleUuids.size,
      });

      setLoading(false);
      setStage('pulsing');

      // Hold the pulse for 3 seconds — must_haves truth #2.
      setTimeout(() => setStage('modal'), 3000);
    } catch (e) {
      setLoading(false);
      setError(String(e));
    }
  }

  function handleClose() {
    // Stop amber pulse + clear review queue so next Cmd+K invocation starts fresh.
    clearMatches();
    resetReviewQueue();
    setStage('query');
    setDraft('');
    setError(null);
    onClose();
  }

  // Once in 'modal' stage, hand off entirely to MassEditModal.
  // Pass the same onClose so the modal's X button propagates through here
  // and calls clearMatches() + resetReviewQueue().
  if (stage === 'modal') {
    return <MassEditModal open onClose={handleClose} />;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handleClose();
      }}
    >
      <DialogContent className="max-w-md">
        {stage === 'query' && (
          <>
            <DialogHeader>
              <DialogTitle>Mass edit by intent</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 pt-1">
              <p className="text-sm text-muted-foreground">
                Describe the change you want to make across multiple contracts.
                Matching nodes will pulse amber on the canvas.
              </p>
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="add audit logging to every destructive endpoint"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !loading) void handleSubmit();
                }}
                autoFocus
                disabled={loading}
              />
              {error && (
                <p className="text-xs text-red-600">{error}</p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={handleClose} disabled={loading}>
                  Cancel
                </Button>
                <Button
                  onClick={() => void handleSubmit()}
                  disabled={!draft.trim() || loading}
                >
                  {loading ? 'Searching…' : 'Find matches'}
                </Button>
              </div>
            </div>
          </>
        )}

        {stage === 'pulsing' && (
          <div className="py-8 text-center space-y-3">
            <DialogHeader>
              <DialogTitle>Scanning contracts…</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {candidates.length} node{candidates.length !== 1 ? 's' : ''} match
              {candidates.length === 1 ? 'es' : ''} — reviewing in 3s…
            </p>
            {/* Minimal spinner to indicate activity without hiding the pulse */}
            <div className="flex justify-center">
              <div className="h-4 w-4 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
            </div>
          </div>
        )}

        {stage === 'no-results' && (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>No matches found</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              No contracts matched "{draft}". Try a different query or broader
              keywords.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStage('query')}>
                Try another query
              </Button>
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
