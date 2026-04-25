import { useEffect } from 'react';
import {
  getSessionStatus,
  subscribeSessionStatus,
} from '@/ipc/session';
import { useSessionStore } from '@/store/session';

/**
 * Phase 10 footer indicator: "N sessions · M episodes" with a pulsing emerald
 * dot when the watcher is active, gray when idle.
 *
 * Mirrors McpStatusIndicator's seed-from-IPC + subscribe-to-event pattern:
 *   1. `getSessionStatus()` on mount handles the race where the Rust watcher
 *      emits a `session:status` event before this component mounts (same
 *      mitigation Plan 05-01 documented in STATE.md).
 *   2. `subscribeSessionStatus` keeps the indicator live as the watcher
 *      ingests new sessions.
 *
 * `null` payload fields from `execute_backfill` (Plan 10-03 decision) signal
 * "refetch via getSessionStatus" — this collapses the per-ingest emits into
 * a single batched UI update after backfill completes.
 *
 * Click target opens the BackfillModal (sibling Plan 10-04 component) so the
 * indicator doubles as the entry point to historical-session ingest.
 */
export function SessionStatusIndicator() {
  const status = useSessionStore((s) => s.status);
  const setStatus = useSessionStore((s) => s.setStatus);
  const openBackfillModal = useSessionStore((s) => s.openBackfillModal);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    getSessionStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        /* ignore — event stream is source of truth */
      });

    subscribeSessionStatus((ev) => {
      // null fields = UI should refetch via getSessionStatus
      // (used by execute_backfill batch path — see ipc/session.ts).
      if (ev.watchingSessions === null || ev.episodesIngested === null) {
        getSessionStatus()
          .then((s) => setStatus(s))
          .catch(() => {});
      } else {
        setStatus({
          watchingSessions: ev.watchingSessions,
          episodesIngested: ev.episodesIngested,
        });
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [setStatus]);

  const isWatching = status.watchingSessions > 0;
  const isEmpty = status.watchingSessions === 0 && status.episodesIngested === 0;
  const dotClass = isWatching ? 'bg-emerald-500' : 'bg-zinc-400';
  const sessionLabel = `${status.watchingSessions} session${status.watchingSessions === 1 ? '' : 's'}`;
  const episodeLabel = `${status.episodesIngested} episode${status.episodesIngested === 1 ? '' : 's'}`;
  const label = `${sessionLabel} · ${episodeLabel}`;

  // Empty state ambiguity: a 0/0 indicator could mean "watcher running, no data
  // yet" OR "watcher deferred because ~/.claude/projects/<cwd-key>/ does not
  // exist yet" (Pitfall 4). The tooltip distinguishes — if there's no data,
  // tell the user the two ways to populate it.
  const tooltip = isEmpty
    ? 'No sessions ingested yet. Run `claude` in this repo (then reopen) or click to backfill historical sessions.'
    : 'Click to backfill historical sessions';

  return (
    <button
      type="button"
      onClick={openBackfillModal}
      className="flex items-center gap-2 px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/40 rounded transition-colors"
      title={tooltip}
      aria-live="polite"
    >
      <span
        className={`h-2 w-2 rounded-full ${dotClass} ${isWatching ? 'animate-pulse' : ''}`}
        aria-hidden
      />
      <span>{label}</span>
    </button>
  );
}
