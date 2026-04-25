/**
 * Phase 13 Plan 02 — top-level tree component.
 *
 * Renders one `SidebarAreaItem` per area returned by `getSidebarTree()`, with
 * a graceful "No contracts loaded" empty state when the tree is empty (cold
 * start before the user opens a repo, or a repo with no `.contracts/`).
 *
 * **Refresh strategy:** the tree fetches on mount AND on every change to
 * `useGraphStore.nodes` (proxy for "graph state changed — area composition
 * may have shifted"). The graph store's `nodes` array updates after every
 * watcher tick (refresh_nodes IPC) per `pickAndOpenRepo`'s `onRefreshed`
 * callback in GraphPlaceholder, so this gives the sidebar live updates as
 * users edit contracts on disk.
 *
 * In addition, the tree listens for a `sidebar:refresh` CustomEvent so the
 * Phase 13 reset-script (plan 13-10a) can force a re-fetch without going
 * through the graph store. This keeps the demo runbook decoupled from the
 * graph store's update cadence.
 *
 * Plan 13-10a should emit `window.dispatchEvent(new CustomEvent('sidebar:refresh'))`
 * after re-seeding fixture data so the sidebar repopulates without an app
 * reload.
 */

import { useEffect } from 'react';
import { useSidebarStore } from '@/store/sidebar';
import { useGraphStore } from '@/store/graph';
import { getSidebarTree } from '@/ipc/sidebar';
import { SidebarAreaItem } from './SidebarAreaItem';

/**
 * Plan 13-10a contract: dispatch this event from the reset script after
 * re-seeding fixture data so the sidebar repopulates without an app reload.
 */
export const SIDEBAR_REFRESH_EVENT = 'sidebar:refresh';

export function SidebarTree() {
  const tree = useSidebarStore((s) => s.tree);
  const setTree = useSidebarStore((s) => s.setTree);
  // Subscribe to nodes so we re-fetch the tree when the graph state changes.
  // We use the array length as the trigger: it changes on every refresh and
  // on initial scan, which is exactly when area composition might shift.
  // (Subscribing to the array reference would re-fetch on every refreshNodes
  // call even when contents are identical — count is the lighter-weight signal.)
  const nodesCount = useGraphStore((s) => s.nodes.length);

  // Initial hydrate + re-hydrate when nodesCount changes.
  useEffect(() => {
    let cancelled = false;
    getSidebarTree()
      .then((next) => {
        if (cancelled) return;
        setTree(next);
      })
      .catch((e) => {
        // Non-fatal — the sidebar shows the empty state if the IPC fails.
        console.warn('[sidebar] getSidebarTree failed (non-fatal):', e);
      });
    return () => {
      cancelled = true;
    };
  }, [setTree, nodesCount]);

  // Plan 13-10a refresh hook — listen for explicit refresh events.
  useEffect(() => {
    const handler = () => {
      getSidebarTree()
        .then(setTree)
        .catch((e) => console.warn('[sidebar] refresh-event fetch failed:', e));
    };
    window.addEventListener(SIDEBAR_REFRESH_EVENT, handler);
    return () => window.removeEventListener(SIDEBAR_REFRESH_EVENT, handler);
  }, [setTree]);

  if (tree.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-3 py-2 text-xs text-muted-foreground/70">
        No contracts loaded
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {tree.map((area) => (
        <SidebarAreaItem key={area.area} area={area} />
      ))}
    </div>
  );
}
