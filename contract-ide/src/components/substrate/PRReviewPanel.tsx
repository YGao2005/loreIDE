// Phase 13 Plan 08 — PR-review intent-drift sliding panel.
//
// User pastes a unified-diff (output of `git diff`), clicks Analyze, the
// panel calls analyze_pr_diff IPC, and the canvas highlights affected
// nodes via useSubstrateStore.bulkSet (transient overlay — cleared on
// Cancel). Explanation sidebar lists affected nodes grouped by participant.
//
// The "intent_drifted" overlay is applied to ALL affected uuids (not just
// the drifted subset) for demo simplicity — reviewers see the orange-glow
// CVA variant on every atom touched by the diff, with a `⚠` marker in the
// explanation for the substrate-state-drifted subset. This is the demo
// affordance described in PITCH.md ("Paste a PR link. Canvas lights up.").
//
// Cancel snapshots and restores the previous substrate state per uuid so
// no transient overlay leaks across review sessions.
//
// Keyboard binding: Cmd+Shift+P (defensive — distinct from Cmd+P which is
// the IntentPalette in plan 13-03).

import { useState, useRef, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { parseDiffHunks } from '@/lib/diffToNodeMapper';
import {
  useSubstrateStore,
  type SubstrateNodeState,
} from '@/store/substrate';
import { PRReviewExplanation } from './PRReviewExplanation';

interface PrReviewResult {
  affected_uuids: string[];
  intent_drifted_uuids: string[];
  hunk_count: number;
  file_count: number;
}

interface DiffHunkInput {
  file_path: string;
  new_start: number;
  new_lines: number;
}

export function PRReviewPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [diffText, setDiffText] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<PrReviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Snapshot of previous substrate states so Cancel restores them cleanly.
  // Using a ref (not state) because we don't render this map and we want it
  // mutable across handlers without re-renders.
  const previousStatesRef = useRef<
    Map<string, SubstrateNodeState | null>
  >(new Map());

  const restorePreviousStates = useCallback(() => {
    const sub = useSubstrateStore.getState();
    for (const [uuid, prevState] of previousStatesRef.current) {
      if (prevState === null) {
        sub.clearNodeState(uuid);
      } else {
        sub.setNodeState(uuid, prevState);
      }
    }
    previousStatesRef.current.clear();
  }, []);

  // Defensive: if the panel is closed via Esc / unmount while an overlay is
  // applied, still restore.
  useEffect(() => {
    return () => {
      if (previousStatesRef.current.size > 0) {
        restorePreviousStates();
      }
    };
  }, [restorePreviousStates]);

  if (!open) return null;

  const onAnalyze = async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const hunks = parseDiffHunks(diffText);
      if (hunks.length === 0) {
        setResult({
          affected_uuids: [],
          intent_drifted_uuids: [],
          hunk_count: 0,
          file_count: 0,
        });
        return;
      }
      const inputHunks: DiffHunkInput[] = hunks.map((h) => ({
        file_path: h.filePath,
        new_start: h.newStart,
        new_lines: h.newLines,
      }));
      const r = await invoke<PrReviewResult>('analyze_pr_diff', {
        hunks: inputHunks,
      });

      // Restore any prior overlay before applying a new one (re-Analyze
      // without Cancel between).
      if (previousStatesRef.current.size > 0) {
        restorePreviousStates();
      }

      setResult(r);

      // Snapshot previous substrate states so Cancel can restore them.
      const sub = useSubstrateStore.getState();
      const snapshot = new Map<string, SubstrateNodeState | null>();
      for (const uuid of r.affected_uuids) {
        snapshot.set(uuid, sub.nodeStates.get(uuid) ?? null);
      }
      previousStatesRef.current = snapshot;

      // Apply intent_drifted overlay to all affected uuids — demo simplicity.
      // The explanation sidebar distinguishes intent_drifted subset via ⚠.
      sub.bulkSet(
        r.affected_uuids.map((uuid) => ({
          uuid,
          state: 'intent_drifted' as const,
        })),
      );
    } catch (err) {
      console.error('[PRReviewPanel] analyze failed:', err);
      setError(typeof err === 'string' ? err : 'Analyze failed.');
    } finally {
      setAnalyzing(false);
    }
  };

  const onCancel = () => {
    restorePreviousStates();
    setDiffText('');
    setResult(null);
    setError(null);
    onClose();
  };

  return (
    <div
      className="fixed right-0 top-7 bottom-0 w-[420px] bg-background border-l border-border/40 shadow-2xl z-40 flex flex-col"
      data-pr-review-panel
      role="dialog"
      aria-label="PR Review — Intent Drift"
    >
      <header className="flex items-center justify-between px-3 py-2 border-b border-border/40 bg-muted/20">
        <div className="flex flex-col">
          <h3 className="text-sm font-medium leading-tight">
            PR Review — Intent Drift
          </h3>
          <span className="text-[10px] text-muted-foreground leading-tight">
            ⌘⇧P · Paste raw diff
          </span>
        </div>
        <button
          onClick={onCancel}
          className="text-xs text-muted-foreground hover:text-foreground rounded px-1.5 py-0.5 hover:bg-muted/50"
          aria-label="Close PR review"
        >
          ✕
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div>
          <label className="text-[11px] text-muted-foreground block mb-1">
            Raw diff — output of{' '}
            <code className="font-mono text-[10px] bg-muted/40 px-1 py-0.5 rounded">
              git diff
            </code>
            . Pasting a GitHub PR URL will not work — paste the diff text.
          </label>
          <textarea
            value={diffText}
            onChange={(e) => setDiffText(e.target.value)}
            placeholder={'diff --git a/path b/path\n--- a/path\n+++ b/path\n@@ -1,3 +1,4 @@\n...'}
            className="w-full h-40 rounded border border-border/50 bg-muted/30 p-2 text-[11px] font-mono leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-primary/40"
            spellCheck={false}
          />
        </div>
        <button
          onClick={onAnalyze}
          disabled={analyzing || !diffText.trim()}
          className="w-full rounded bg-primary text-primary-foreground py-1.5 text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
        >
          {analyzing ? 'Analyzing…' : 'Analyze diff'}
        </button>
        {error && (
          <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">
            {error}
          </div>
        )}
        {result && (
          <div className="text-[11px] text-muted-foreground border-t border-border/30 pt-2">
            {result.hunk_count} hunk{result.hunk_count === 1 ? '' : 's'}{' '}
            across {result.file_count} file
            {result.file_count === 1 ? '' : 's'} · affecting{' '}
            <span className="text-foreground font-medium">
              {result.affected_uuids.length}
            </span>{' '}
            atom{result.affected_uuids.length === 1 ? '' : 's'}
            {result.intent_drifted_uuids.length > 0 && (
              <span className="text-orange-400">
                {' '}
                ({result.intent_drifted_uuids.length} intent-drifted)
              </span>
            )}
          </div>
        )}
        {result && result.affected_uuids.length > 0 && (
          <PRReviewExplanation result={result} />
        )}
      </div>
      <footer className="border-t border-border/40 px-3 py-2 flex justify-end gap-2 bg-muted/10">
        <button
          onClick={onCancel}
          className="text-xs px-3 py-1 rounded border border-border/60 hover:bg-muted/40"
        >
          Cancel review
        </button>
      </footer>
    </div>
  );
}
