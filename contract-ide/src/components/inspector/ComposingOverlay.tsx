/**
 * ComposingOverlay — Phase 11 Plan 04.
 *
 * Renders the substrate retrieval progress during the composing phase.
 * 5 rows stream in with a 150ms stagger fade-in (~1.5s total) so the
 * audience sees the Phase 11 retrieval working — the "magic moment" per
 * CANVAS-PURPOSE.md and the presentation script.
 *
 * States:
 *   - hits=undefined → show 5 skeleton rows (compose call in-flight)
 *   - hits=[...] → stagger-fade real rows in, one every 150ms
 *
 * [source] click handler: fires Tauri 'source:click' event which AppShell
 * turns into a toast. Phase 13 wires the real chat-archaeology jump.
 */

import { useEffect, useState } from 'react';
import { emit } from '@tauri-apps/api/event';
import type { SubstrateHit } from '../../ipc/delegate';

interface ComposingOverlayProps {
  scopeUuid: string;
  /** E.g. 'L2' for the surface-context label. */
  level?: string;
  /** Populated when compose returns; otherwise show skeleton rows. */
  hits?: SubstrateHit[];
}

export function ComposingOverlay({ level, hits }: ComposingOverlayProps) {
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

  const isLoading = !hits;
  const shownHits = hits?.slice(0, visibleCount) ?? [];
  const skeletonCount = isLoading ? 5 : 0;
  const hitCount = hits?.length ?? 5;

  return (
    <div className="rounded-lg border border-border bg-background/95 p-3 shadow-lg backdrop-blur">
      <div className="mb-2 text-xs text-muted-foreground">
        {isLoading
          ? `Composing prompt: contract body + 5 substrate hits${level ? ` + ${level} surface context` : ''}…`
          : `Composing prompt: contract body + ${hitCount} substrate hits${level ? ` + ${level} surface context` : ''}…`}
      </div>
      <div className="space-y-1.5">
        {/* Real hits with stagger fade */}
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
        {/* Skeleton rows during loading */}
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <div
            key={`skel-${i}`}
            className="h-8 rounded border border-border/50 bg-muted/30 animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}
