import { watch, type UnwatchFn, type WatchEvent } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import type { ScanResult } from './types';

let unwatchFn: UnwatchFn | null = null;

export interface WatcherHandlers {
  /** Called after Rust has re-upserted the changed sidecar(s). Consumers
   *  should refetch graph state here (e.g. call getNodes() + setState). */
  onRefreshed: (affectedCount: number, errors: string[]) => void;
}

/**
 * Start the .contracts/ watcher. Debounced at 2000ms by tauri-plugin-fs
 * (matches DATA-03's "within 2 seconds" latency target). Recursive so any
 * nested .contracts/ sub-directories Phase 9 may add still fire events.
 *
 * MUST be called AFTER open_repo's scan_contracts_dir completes
 * (Pitfall 4 — scan/watch race: if the watcher fires before the initial scan
 * inserts rows, refresh_nodes may try to re-upsert files the scan hasn't seen
 * yet, producing duplicate work or missed rows. Ordering is enforced by
 * calling startContractsWatcher inside pickAndOpenRepo's post-scan branch).
 *
 * Calling this function when a watcher is already running automatically stops
 * the old watcher first (via stopContractsWatcher), so repo-switch is safe.
 */
export async function startContractsWatcher(
  contractsPath: string,
  handlers: WatcherHandlers,
): Promise<void> {
  // Stop any existing watcher before starting a new one (repo switch).
  stopContractsWatcher();

  unwatchFn = await watch(
    contractsPath,
    (event: WatchEvent) => {
      // Filter to .md paths only — skip .DS_Store, lock files, etc.
      // tauri-plugin-fs batches events that occur within the debounce window,
      // so `event.paths` can contain multiple modified paths at once.
      const mdPaths = event.paths.filter((p) => p.endsWith('.md'));
      console.debug('[watcher] event paths:', event.paths, '→ md paths:', mdPaths);
      if (mdPaths.length === 0) return;

      // The watch callback is synchronous; invoke returns a Promise, so we
      // fire-and-forget via .then/.catch rather than awaiting in-line.
      invoke<ScanResult>('refresh_nodes', { paths: mdPaths })
        .then((result) => {
          handlers.onRefreshed(result.nodeCount, result.errors);
        })
        .catch((e: unknown) => {
          handlers.onRefreshed(0, [String(e)]);
        });
    },
    { recursive: true, delayMs: 2000 },
  );
}

/**
 * Stop the currently-running watcher, if any. Safe to call when no watcher
 * is active. The UnwatchFn returned by tauri-plugin-fs watch() is synchronous
 * (returns void, not Promise<void>).
 */
export function stopContractsWatcher(): void {
  if (unwatchFn) {
    unwatchFn();
    unwatchFn = null;
  }
}
