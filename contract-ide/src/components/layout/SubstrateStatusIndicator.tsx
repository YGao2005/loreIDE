/**
 * Phase 11 Plan 05 footer indicator: "K substrate nodes captured".
 *
 * Extends the Phase 10 SessionStatusIndicator pattern by adding a substrate
 * counter next to it in the footer. Same seed-from-IPC + subscribe-to-event
 * pattern for race-resistance.
 *
 * Event subscription:
 *   - Seeds totalCount from get_total_substrate_count IPC on mount.
 *   - Subscribes to substrate:ingested Tauri events from the Plan 11-02
 *     distiller pipeline (event payload: { count: number, episode_id: string,
 *     session_id: string }).
 *   - On first 0→≥1 transition: fires the 'substrate:first-node-toast'
 *     CustomEvent — AppShell listens and shows a one-time toast.
 *
 * The first-time toast logic lives in useSubstrateStore.onSubstrateIngested
 * (not here) so it runs regardless of which component receives the event.
 *
 * CONTEXT lock: footer label "K substrate nodes captured" verbatim.
 */

import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useSubstrateStore } from '@/store/substrate';

interface SubstrateIngestedPayload {
  count: number;
  episode_id: string;
  session_id: string;
}

export function SubstrateStatusIndicator() {
  const totalCount = useSubstrateStore((s) => s.totalCount);
  const seedFromIpc = useSubstrateStore((s) => s.seedFromIpc);
  const onSubstrateIngested = useSubstrateStore((s) => s.onSubstrateIngested);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    // Race-resistant: seed first (handles cold start where substrate:ingested
    // fired before this component mounted), then subscribe.
    void seedFromIpc();

    void listen<SubstrateIngestedPayload>('substrate:ingested', (e) => {
      if (!cancelled) {
        onSubstrateIngested(e.payload.count);
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  // seedFromIpc and onSubstrateIngested are stable Zustand selectors (no deps needed)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nodeLabel =
    totalCount === 1 ? '1 substrate node captured' : `${totalCount} substrate nodes captured`;

  return (
    <div
      className="flex items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground"
      aria-live="polite"
      aria-label={nodeLabel}
      title="Substrate nodes distilled from your team's Claude Code sessions"
    >
      <span aria-hidden className="h-2 w-2 rounded-full bg-violet-500/70 shrink-0" />
      <span>{nodeLabel}</span>
    </div>
  );
}
