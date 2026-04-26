import { useEffect, useState } from 'react';
import { AsyncState, type AsyncStatus } from '@/components/states/AsyncState';
import { pickAndOpenRepo } from '@/ipc/repo';
import { stopContractsWatcher } from '@/ipc/watcher';
import { useGraphStore } from '@/store/graph';
import { GraphCanvas } from '@/components/graph/GraphCanvas';

/**
 * Graph pane placeholder (SHELL-04 / GRAPH-01).
 *
 * Phase 2: wired to real SQLite-backed data via getNodes(). Includes an
 * "Open Repository" button in the empty state that invokes the native
 * folder picker (pickAndOpenRepo), scans .contracts/, and refreshes nodes.
 *
 * Phase 3 Plan 1: the dotted L0/L1/L2/L3 placeholder grid is replaced by the
 * real <GraphCanvas /> (react-flow). Node data lives in the global
 * useGraphStore — this component now uses useGraphStore.getState() inside
 * its async flows so it can drive empty/ready AsyncState transitions without
 * subscribing to node updates itself (the canvas subscribes instead).
 *
 * NOTE: ?force-error URL override removed per Plan 02-02 (Phase 2 has real
 * IPC failure modes via ScanResult.errors; demo infrastructure no longer needed).
 */
export function GraphPlaceholder() {
  const [state, setState] = useState<AsyncStatus>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await useGraphStore.getState().refreshNodes();
        if (cancelled) return;
        const rows = useGraphStore.getState().nodes;
        setState(rows.length === 0 ? 'empty' : 'ready');
      } catch (e: unknown) {
        if (cancelled) return;
        setErrorMsg(String(e));
        setState('error');
      }
    })();

    // Stop the watcher when GraphPlaceholder unmounts (e.g. route change,
    // full app teardown). startContractsWatcher also calls stop internally
    // on the next open-repo, but explicit cleanup is safer.
    return () => {
      cancelled = true;
      stopContractsWatcher();
    };
  }, []);

  async function handleOpenRepo() {
    setState('loading');
    try {
      const result = await pickAndOpenRepo(async (_count, errors) => {
        // Watcher fired — re-fetch nodes from SQLite so the UI reflects the
        // disk change within the 2-second debounce window.
        await useGraphStore.getState().refreshNodes();
        const rows = useGraphStore.getState().nodes;
        setState(rows.length === 0 ? 'empty' : 'ready');
        if (errors.length > 0) {
          console.warn('[watcher] refresh errors:', errors);
        }
      });
      if (result === null) {
        // User cancelled the dialog — return to empty state.
        setState('empty');
        return;
      }
      if (result.errorCount > 0) {
        setErrorMsg(
          `Scan completed with ${result.errorCount} error(s):\n` +
            result.errors.slice(0, 3).join('\n')
        );
        setState('error');
        return;
      }
      await useGraphStore.getState().refreshNodes();
      const rows = useGraphStore.getState().nodes;
      setState(rows.length === 0 ? 'empty' : 'ready');
    } catch (e) {
      setErrorMsg(String(e));
      setState('error');
    }
  }

  const emptyContent = (
    <div className="flex flex-col items-center gap-3 text-muted-foreground text-sm">
      <span>No contracts yet — open a repo</span>
      <button
        onClick={handleOpenRepo}
        className="px-4 py-2 rounded-md border border-border/70 bg-background hover:bg-muted text-foreground text-sm transition-colors"
      >
        Open Repository
      </button>
    </div>
  );

  return (
    <div className="h-full w-full bg-background overflow-hidden relative">
      <AsyncState
        state={state}
        error={errorMsg}
        loading="Indexing contracts…"
        empty={emptyContent}
      >
        {/* Phase 3 Plan 1: real react-flow canvas replaces the dotted L0/L1/L2/L3
            placeholder grid. Canvas subscribes to useGraphStore.nodes directly.
            Switch-Repo affordance now lives in the left sidebar next to Copy
            Mode (see Sidebar.tsx) — keeps the canvas top free for breadcrumb. */}
        <div className="h-full w-full">
          <GraphCanvas />
        </div>
      </AsyncState>
    </div>
  );
}
