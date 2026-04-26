/**
 * Phase 13 Plan 07 — Source-archaeology modal.
 *
 * Renders the verbatim-quote + provenance metadata for a substrate node when
 * a user clicks a `[source]` citation pill. Opens via
 * `useCitationStore.openCitationUuid` and fetches detail via the Phase 13
 * Plan 01 IPC `getSubstrateNodeDetail`.
 *
 * Demo target: ROADMAP SC 7 — "≤5 seconds click-to-readable" — typically
 * <500ms with the IPC; the round-trip is a single SQLite SELECT keyed by uuid.
 *
 * Pitfall 4 (13-RESEARCH.md): hand-seeded fixtures may have NULL
 * `verbatim_quote`. We render an explicit amber warning rather than silently
 * collapsing the section — this surfaces missing fixture data during plan
 * 13-10 demo prep so we don't discover it on stage.
 */

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCitationStore } from '@/store/citation';
import {
  getSubstrateNodeDetail,
  type SubstrateNodeSummary,
} from '@/ipc/substrate';

export function SourceArchaeologyModal() {
  const openUuid = useCitationStore((s) => s.openCitationUuid);
  const close = useCitationStore((s) => s.closeCitation);
  const [detail, setDetail] = useState<SubstrateNodeSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!openUuid) {
      // Reset on close so the next open starts blank rather than flashing the
      // previous citation's content while the new fetch is in flight.
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    getSubstrateNodeDetail(openUuid)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
      })
      .catch((err) => {
        // Defensive: getSubstrateNodeDetail already returns null for missing
        // rows, so a thrown error here means an actual IPC failure (DB not
        // ready, table missing, etc.). Log and render the "no detail" branch.
        if (!cancelled) {
          console.error('[SourceArchaeologyModal] fetch failed:', err);
          setDetail(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [openUuid]);

  return (
    <Dialog open={Boolean(openUuid)} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm break-all">
            {detail?.name ?? openUuid ?? 'Substrate citation'}
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="text-sm text-muted-foreground">Loading…</div>
        )}

        {detail && !loading && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span className="rounded bg-muted/50 px-2 py-0.5 font-mono">
                {detail.kind}
              </span>
              {detail.state && (
                <span className="rounded bg-muted/50 px-2 py-0.5 font-mono">
                  {detail.state}
                </span>
              )}
              {detail.actor && <span>actor: {detail.actor}</span>}
              {detail.confidence && (
                <span>confidence: {detail.confidence}</span>
              )}
            </div>

            {detail.summary && detail.summary !== detail.name && (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {detail.summary}
              </p>
            )}

            {detail.verbatim_quote ? (
              <div className="rounded border border-border/40 bg-muted/30 p-3">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Verbatim quote
                </div>
                <blockquote className="text-sm whitespace-pre-wrap font-mono leading-relaxed text-foreground/90">
                  {detail.verbatim_quote}
                </blockquote>
              </div>
            ) : (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                No verbatim quote on this node — was it hand-seeded? (Pitfall 4
                in 13-RESEARCH.md — plan 13-10 fixture prep must populate
                verbatim quotes for every demo-clicked uuid.)
              </div>
            )}

            {(detail.session_id || detail.turn_ref) && (
              <div className="text-[11px] font-mono text-muted-foreground">
                source: {detail.session_id ?? '<no-session>'}
                {detail.turn_ref ? `:${detail.turn_ref}` : ''}
              </div>
            )}
          </div>
        )}

        {!detail && !loading && openUuid && (
          <div className="text-sm text-muted-foreground">
            No detail found for{' '}
            <code className="font-mono text-xs">{openUuid}</code>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
