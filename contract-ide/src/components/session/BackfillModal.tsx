import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  executeBackfill,
  getBackfillPreview,
  getSessionStatus,
  type BackfillPreview,
} from '@/ipc/session';
import { useSessionStore } from '@/store/session';

/**
 * BackfillModal — opt-in historical-session ingestion (Phase 10 SC4).
 *
 * Three-state internal flow:
 *   1. `select`     — list historical session JSONLs in
 *                     `~/.claude/projects/<cwd-key>/` sorted by mtime DESC.
 *                     User checks one or more sessions to include.
 *   2. `preview`    — call `get_backfill_preview` on the selected sessions,
 *                     render estimated tokens + cost per session + total.
 *                     NO INGESTION YET (heuristic chars/4 × Sonnet rate;
 *                     ZERO Claude API calls per Phase 10 invariant).
 *   3. `confirming` — user clicks "Confirm & Ingest"; `execute_backfill`
 *                     runs; shows result count; modal closeable on success.
 *
 * Critical UX (SC4): nothing ingests automatically. The `execute_backfill`
 * IPC fires only after the user clicks the explicit Confirm button on the
 * preview pane. Preview itself is read-only.
 *
 * Native HTML checkboxes (not shadcn Checkbox) — keeps the bundle lean and
 * avoids retrofitting a new shadcn primitive at the demo bar. Phase 13 polish
 * may swap to shadcn Checkbox if the visual delta matters.
 */
type Step = 'select' | 'preview' | 'confirming';

interface SessionFile {
  sessionId: string;
  bytesRaw: number;
  mtime: string;
  lineCount: number;
}

export function BackfillModal() {
  const open = useSessionStore((s) => s.backfillModalOpen);
  const closeModal = useSessionStore((s) => s.closeBackfillModal);

  const [step, setStep] = useState<Step>('select');
  const [files, setFiles] = useState<SessionFile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previews, setPreviews] = useState<BackfillPreview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [resultEpisodes, setResultEpisodes] = useState<number | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);

  // Reset state on close so re-opens start clean.
  useEffect(() => {
    if (!open) {
      setStep('select');
      setFiles([]);
      setSelected(new Set());
      setPreviews([]);
      setError(null);
      setResultEpisodes(null);
      setLoadingFiles(false);
    }
  }, [open]);

  // Fetch historical session list when the modal opens (or returns to
  // select step via Back button).
  useEffect(() => {
    if (!open || step !== 'select') return;
    let cancelled = false;
    setLoadingFiles(true);
    invoke<SessionFile[]>('list_historical_session_files')
      .then((fs) => {
        if (!cancelled) {
          setFiles(fs);
          setLoadingFiles(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(typeof e === 'string' ? e : 'Failed to list sessions');
          setLoadingFiles(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, step]);

  function toggle(sessionId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }

  async function goPreview() {
    if (selected.size === 0) {
      setError('Select at least one session');
      return;
    }
    setError(null);
    try {
      const ids = Array.from(selected);
      const p = await getBackfillPreview(ids);
      setPreviews(p);
      setStep('preview');
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Failed to compute preview');
    }
  }

  async function confirmExecute() {
    setStep('confirming');
    setError(null);
    try {
      const ids = previews.map((p) => p.sessionId);
      const total = await executeBackfill(ids);
      setResultEpisodes(total);
      // Refresh footer count immediately. The Rust execute_backfill emits a
      // null-payload session:status after batch completion to signal refetch,
      // but that path goes through the SessionStatusIndicator's listener;
      // calling here directly keeps the modal-local count in sync without
      // depending on event-listener ordering.
      const st = await getSessionStatus();
      useSessionStore.getState().setStatus(st);
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Backfill failed');
      setStep('preview');
    }
  }

  const totalTokens = previews.reduce((sum, p) => sum + p.estimatedTokens, 0);
  const totalCost = previews.reduce((sum, p) => sum + p.estimatedCostUsd, 0);

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : closeModal())}>
      <DialogContent className="sm:max-w-2xl max-w-2xl">
        <DialogHeader>
          <DialogTitle>Backfill historical sessions</DialogTitle>
          <DialogDescription>
            Ingest past Claude Code sessions from this project into the substrate.
            Phase 10 makes no LLM calls — token estimates are heuristic
            (chars / 4 × Sonnet input rate). Phase 11 distillation runs separately.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded border border-red-500/50 bg-red-500/10 p-3 text-xs text-red-200">
            {error}
          </div>
        )}

        {step === 'select' && (
          <div className="max-h-96 overflow-y-auto rounded border border-border/40">
            {loadingFiles ? (
              <p className="p-4 text-sm text-muted-foreground">Loading sessions…</p>
            ) : files.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                No historical sessions found for this repo. Run{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">claude</code>{' '}
                here to populate.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-popover">
                  <tr className="border-b border-border/40 text-xs text-muted-foreground">
                    <th className="w-8 p-2" />
                    <th className="p-2 text-left font-normal">Session</th>
                    <th className="p-2 text-right font-normal">Lines</th>
                    <th className="p-2 text-right font-normal">Size</th>
                    <th className="p-2 text-left font-normal">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => (
                    <tr
                      key={f.sessionId}
                      className="border-b border-border/20 hover:bg-accent/30 cursor-pointer"
                      onClick={() => toggle(f.sessionId)}
                    >
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={selected.has(f.sessionId)}
                          onChange={() => toggle(f.sessionId)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 cursor-pointer rounded border border-border accent-emerald-500"
                          aria-label={`Select session ${f.sessionId.slice(0, 8)}`}
                        />
                      </td>
                      <td className="p-2 font-mono text-xs">
                        {f.sessionId.slice(0, 8)}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {f.lineCount.toLocaleString()}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {(f.bytesRaw / 1024).toFixed(0)} KB
                      </td>
                      <td className="p-2 text-xs text-muted-foreground">
                        {new Date(f.mtime).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4">
            <div className="rounded border border-border/40 bg-muted/30 p-3 text-sm">
              <div className="font-semibold">Total estimate</div>
              <div className="text-muted-foreground">
                ~{totalTokens.toLocaleString()} tokens · ~${totalCost.toFixed(3)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Heuristic: filtered_chars / 4 × Sonnet input rate ($3 / MTok). No LLM call.
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto rounded border border-border/40">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-popover">
                  <tr className="border-b border-border/40 text-xs text-muted-foreground">
                    <th className="p-2 text-left font-normal">Session</th>
                    <th className="p-2 text-right font-normal">Episodes</th>
                    <th className="p-2 text-right font-normal">Tokens</th>
                    <th className="p-2 text-right font-normal">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {previews.map((p) => (
                    <tr key={p.sessionId} className="border-b border-border/20">
                      <td className="p-2 font-mono text-xs">{p.sessionId.slice(0, 8)}</td>
                      <td className="p-2 text-right tabular-nums">
                        {p.episodeCountEstimate}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {p.estimatedTokens.toLocaleString()}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        ${p.estimatedCostUsd.toFixed(4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {step === 'confirming' && resultEpisodes === null && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Ingesting {previews.length} session{previews.length === 1 ? '' : 's'}…
          </div>
        )}

        {step === 'confirming' && resultEpisodes !== null && (
          <div className="rounded border border-emerald-500/50 bg-emerald-500/10 p-4 text-sm">
            Ingested {resultEpisodes} new episode
            {resultEpisodes === 1 ? '' : 's'} from {previews.length} session
            {previews.length === 1 ? '' : 's'}.
          </div>
        )}

        <DialogFooter>
          {step === 'select' && (
            <>
              <Button variant="ghost" onClick={closeModal}>
                Cancel
              </Button>
              <Button onClick={goPreview} disabled={selected.size === 0}>
                Preview ({selected.size})
              </Button>
            </>
          )}
          {step === 'preview' && (
            <>
              <Button variant="ghost" onClick={() => setStep('select')}>
                Back
              </Button>
              <Button onClick={confirmExecute}>Confirm & Ingest</Button>
            </>
          )}
          {step === 'confirming' && (
            <Button onClick={closeModal} disabled={resultEpisodes === null}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
