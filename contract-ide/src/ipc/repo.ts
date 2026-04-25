import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import type { ScanResult } from './types';
import { startContractsWatcher } from './watcher';
import { rebuildGhostRefs } from '@/ipc/graph';
import { useGraphStore } from '@/store/graph';
import { useDriftStore } from '@/store/drift';
import { useCherrypickStore } from '@/store/cherrypick';
import { useRollupStore } from '@/store/rollup';

// Rust `RepoState` is in-memory only, so a full process restart (e.g. any
// `cargo check` + `npm run tauri dev` cycle) wipes it even though SQLite
// still holds the cached nodes. Persist the last-opened path here so
// AppShell can rehydrate on cold start.
const LAST_REPO_KEY = 'contract-ide:last-repo';

function rememberRepoPath(path: string) {
  try {
    localStorage.setItem(LAST_REPO_KEY, path);
  } catch {
    // localStorage may be unavailable in some runtimes; ignore.
  }
}

export function readLastRepoPath(): string | null {
  try {
    return localStorage.getItem(LAST_REPO_KEY);
  } catch {
    return null;
  }
}

/**
 * Open the native folder picker and, if the user selects a folder, invoke
 * the `open_repo` Rust command to scan it. Returns `null` if the user
 * cancels the dialog.
 *
 * If `onRefreshed` is provided, the .contracts/ watcher is started AFTER
 * the initial scan completes (enforcing scan-before-watch ordering — Pitfall 4).
 * Each subsequent on-disk edit within 2000ms debounce window will call
 * `onRefreshed(affectedCount, errors)`.
 *
 * Watcher failure is non-fatal: the scan result is always returned even if the
 * watcher could not be registered (e.g. OS permission denied).
 */
export async function pickAndOpenRepo(
  onRefreshed?: (count: number, errors: string[]) => void,
): Promise<ScanResult | null> {
  const folder = await open({ multiple: false, directory: true });
  if (!folder || typeof folder !== 'string') return null;

  // Phase 4 Plan 04-01: push the repo path into the graph store BEFORE the
  // scan so (a) Inspector + CodeTab subscribers see a live path as soon as
  // the dialog closes, and (b) a scan failure still leaves the path usable
  // for manual retry.
  useGraphStore.getState().setRepoPath(folder);
  useDriftStore.getState().reset(); // Phase 7: clear stale drift pulses on repo switch
  useCherrypickStore.getState().reset(); // Phase 8 Plan 08-05: clear stale targeted ring on repo switch
  useRollupStore.getState().reset(); // Phase 8 Plan 08-02: clear stale amber/gray on repo switch
  rememberRepoPath(folder);

  const result = await invoke<ScanResult>('open_repo', { repoPath: folder });

  // Phase 3 Plan 03-02 / DATA-05: derive ghost-reference rows right after
  // the scan so the canvas sees them on first paint. Non-fatal on failure
  // — the app still works without ghosts, just without the multi-flow
  // visual cue.
  try {
    const ghosts = await rebuildGhostRefs();
    console.debug('[repo] rebuildGhostRefs inserted', ghosts, 'ghost rows');
  } catch (e) {
    console.warn('[repo] rebuildGhostRefs failed (non-fatal):', e);
  }

  // Start watcher only after the scan completes — Pitfall 4 ordering guarantee.
  if (onRefreshed) {
    const contractsPath = `${folder}/.contracts`;
    await startContractsWatcher(contractsPath, {
      onRefreshed: async (count, errors) => {
        // Sidecar edits can change node_flows membership — rebuild ghosts
        // before notifying the UI so downstream getNodes() sees fresh data.
        try {
          await rebuildGhostRefs();
        } catch (e) {
          console.warn('[watcher] rebuildGhostRefs failed (non-fatal):', e);
        }
        onRefreshed(count, errors);
      },
    }).catch((e: unknown) => {
      // Watcher failure is non-fatal — scan already succeeded, app is usable.
      console.warn('[watcher] start failed (non-fatal):', e);
    });
  }

  return result;
}

/**
 * Invoke `open_repo` directly with a known path (for programmatic use or
 * reload — does not show a dialog).
 */
export async function openRepo(repoPath: string): Promise<ScanResult> {
  // Phase 4 Plan 04-01: mirror pickAndOpenRepo's store update so programmatic
  // reopens keep useGraphStore.repoPath in sync with reality.
  useGraphStore.getState().setRepoPath(repoPath);
  useDriftStore.getState().reset(); // Phase 7: clear stale drift pulses on repo switch
  useCherrypickStore.getState().reset(); // Phase 8 Plan 08-05: clear stale targeted ring on repo switch
  useRollupStore.getState().reset(); // Phase 8 Plan 08-02: clear stale amber/gray on repo switch
  rememberRepoPath(repoPath);
  return invoke<ScanResult>('open_repo', { repoPath });
}

/**
 * Return the currently-open repository path, or null if none has been opened.
 */
export async function getRepoPath(): Promise<string | null> {
  return invoke<string | null>('get_repo_path');
}
