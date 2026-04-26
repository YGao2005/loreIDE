/**
 * ComposingOverlay — Phase 11 Plan 04.
 *
 * Renders the substrate retrieval state under the Delegate button. Drives off
 * a discrete `stage` so the user sees what's actually happening rather than a
 * generic skeleton:
 *
 *   stage='retrieving'  — compose call in flight; status text + spinner only.
 *   stage='planning'    — plan_review call in flight; status text + the
 *                         retrieved hits (stagger-faded in over ~750ms).
 *   stage='plan-ready'  — plan returned; same hits visible, no spinner.
 *
 * The hits stagger animation only triggers on `hits` reference change, so
 * transitioning planning → plan-ready keeps them visible without re-staggering.
 *
 * [source] click handler: fires Tauri 'source:click' event which AppShell
 * turns into a toast. Phase 13 wires the real chat-archaeology jump.
 */

import { useEffect, useState } from 'react';
import { Loader2Icon } from 'lucide-react';
import { emit } from '@tauri-apps/api/event';
import type { SubstrateHit } from '../../ipc/delegate';

interface ComposingOverlayProps {
  scopeUuid: string;
  /** E.g. 'L2' for the surface-context label. */
  level?: string;
  /** Drives the status label + spinner. */
  stage: 'retrieving' | 'planning' | 'plan-ready';
  /** Populated during 'planning' and 'plan-ready' stages. */
  hits?: SubstrateHit[];
}

export function ComposingOverlay({ level, stage, hits }: ComposingOverlayProps) {
  const [visibleCount, setVisibleCount] = useState(0);

  // Reset visible count whenever a fresh set of hits arrives.
  useEffect(() => {
    setVisibleCount(0);
    if (!hits || hits.length === 0) return;

    let cancelled = false;
    const timers: number[] = [];
    for (let i = 0; i < hits.length; i++) {
      const t = window.setTimeout(() => {
        if (cancelled) return;
        setVisibleCount((c) => Math.max(c, i + 1));
      }, i * 150) as unknown as number; // 150ms stagger — window.setTimeout returns number in browser
      timers.push(t);
    }
    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [hits]);

  const handleSourceClick = (hit: SubstrateHit) => {
    if (hit.source_session_id !== null && hit.source_turn_ref !== null) {
      void emit('source:click', {
        session_id: hit.source_session_id,
        turn_ref: hit.source_turn_ref,
      });
    }
  };

  const shownHits = hits?.slice(0, visibleCount) ?? [];
  const hitCount = hits?.length ?? 0;

  let statusLabel: string;
  let showSpinner = false;
  switch (stage) {
    case 'retrieving':
      statusLabel = `Retrieving substrate from ${level ?? 'lineage'} scope…`;
      showSpinner = true;
      break;
    case 'planning':
      statusLabel = `Planning: contract body + ${hitCount} substrate hits${level ? ` + ${level} surface context` : ''}…`;
      showSpinner = true;
      break;
    case 'plan-ready':
      statusLabel = `Composed: contract body + ${hitCount} substrate hits${level ? ` + ${level} surface context` : ''}`;
      showSpinner = false;
      break;
  }

  return (
    <div className="rounded-lg border border-border bg-background/95 p-3 shadow-lg backdrop-blur">
      <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        {showSpinner && (
          <Loader2Icon className="size-3 animate-spin shrink-0" />
        )}
        <span>{statusLabel}</span>
      </div>
      {shownHits.length > 0 && (
        <div className="space-y-1.5">
          {shownHits.map((hit) => (
            <div
              key={hit.uuid}
              className="flex items-start gap-2 rounded border border-border/50 bg-card px-2 py-1.5 text-xs animate-in fade-in slide-in-from-bottom-1"
              style={{ animationDuration: '300ms' }}
            >
              <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden>
                {hit.node_type === 'constraint'
                  ? '⚖'
                  : hit.node_type === 'decision'
                    ? '✓'
                    : '?'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium" title={hit.text}>
                  {hit.rubric_label}
                </div>
                {hit.applies_when_truncated && (
                  <div
                    className="truncate text-muted-foreground"
                    title={hit.applies_when ?? undefined}
                  >
                    {hit.applies_when_truncated}
                  </div>
                )}
              </div>
              {hit.source_session_id && (
                <button
                  onClick={() => handleSourceClick(hit)}
                  className="shrink-0 text-[10px] text-muted-foreground hover:underline"
                  aria-label={`source session ${hit.source_session_id}`}
                  type="button"
                >
                  [source]
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
