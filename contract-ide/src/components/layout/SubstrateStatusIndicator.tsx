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
 *
 * Phase 15 Plan 05 extension:
 *   - Appends a tombstone badge "🪦 N tombstoned" when N > 0 (hidden when N = 0).
 *   - Badge count sourced via listTombstonedRules() on mount + after dialog close.
 *   - Clicking the badge opens SubstrateHealthDialog (local useState boolean).
 */

import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useSubstrateStore } from '@/store/substrate';
import { listTombstonedRules } from '@/ipc/substrateTrust';
import { SubstrateHealthDialog } from '@/components/substrate/SubstrateHealthDialog';

interface SubstrateIngestedPayload {
  count: number;
  episode_id: string;
  session_id: string;
}

export function SubstrateStatusIndicator() {
  const totalCount = useSubstrateStore((s) => s.totalCount);
  const seedFromIpc = useSubstrateStore((s) => s.seedFromIpc);
  const onSubstrateIngested = useSubstrateStore((s) => s.onSubstrateIngested);

  // Phase 15 Plan 05 — tombstone badge state
  const [tombstoneCount, setTombstoneCount] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);

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

  // Load tombstone count on mount
  useEffect(() => {
    void listTombstonedRules()
      .then((rules) => setTombstoneCount(rules.length))
      .catch(() => {
        // Silently ignore — tombstone badge is non-critical
      });
  }, []);

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open) {
      // Refresh the tombstone count when the dialog closes (after potential restores)
      void listTombstonedRules()
        .then((rules) => setTombstoneCount(rules.length))
        .catch(() => {
          // Silently ignore
        });
    }
  }

  const nodeLabel =
    totalCount === 1 ? '1 substrate node captured' : `${totalCount} substrate nodes captured`;

  return (
    <>
      <div
        className="flex items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground"
        aria-live="polite"
        aria-label={nodeLabel}
        title="Substrate nodes distilled from your team's Claude Code sessions"
      >
        <span aria-hidden className="h-2 w-2 rounded-full bg-violet-500/70 shrink-0" />
        {/* CONTEXT lock: "K substrate nodes captured" verbatim — Phase 11 P05 */}
        <span>{nodeLabel}</span>

        {/* Phase 15 Plan 05: tombstone badge — hidden when count is 0 */}
        {tombstoneCount > 0 && (
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="ml-1 text-[10px] text-muted-foreground/70 hover:text-foreground transition-colors cursor-pointer underline underline-offset-2 decoration-dotted"
            title={`${tombstoneCount} tombstoned rule${tombstoneCount === 1 ? '' : 's'} — click to review or restore`}
            aria-label={`${tombstoneCount} tombstoned substrate rules. Click to open Substrate Health dialog.`}
          >
            🪦 {tombstoneCount} tombstoned
          </button>
        )}
      </div>

      <SubstrateHealthDialog open={dialogOpen} onOpenChange={handleDialogOpenChange} />
    </>
  );
}
