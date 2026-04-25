/**
 * Phase 13 Plan 02 — Sidebar tree state.
 *
 * Holds three slices:
 *   - `tree`: the per-area sidebar data fetched from `get_sidebar_tree`.
 *             Replaced atomically on each fetch so subscribers re-render on
 *             a single Set identity change.
 *   - `expandedAreas`: Set of area names the user has manually expanded.
 *                      Mutations produce a NEW Set identity (Zustand pattern).
 *   - `selectedFlowUuid`: which flow's L2 chain the canvas is currently
 *                         driving toward. Null when no flow has been clicked
 *                         since repo open. Plan 13-06 reads this to render
 *                         the chain layout.
 *
 * Reset is intentionally NOT wired here — the tree is hydrated on every
 * sidebar:refresh event so a stale tree from a previous repo overwrites
 * cleanly without an explicit reset call.
 */

import { create } from 'zustand';
import type { SidebarArea } from '@/ipc/sidebar';

interface SidebarState {
  /** Per-area tree fetched from `get_sidebar_tree`. */
  tree: SidebarArea[];
  /**
   * Areas the user has expanded. Stored as a Set so membership-check is O(1)
   * and re-renders are gated on referential inequality.
   */
  expandedAreas: Set<string>;
  /**
   * Currently selected flow's uuid. Null until the user clicks a flow row.
   * Plan 13-06 (FlowChain) reads this; this plan only writes it as a hook.
   */
  selectedFlowUuid: string | null;

  /** Replace the full tree atomically. Called on mount + sidebar:refresh. */
  setTree: (tree: SidebarArea[]) => void;
  /** Toggle an area's expanded state — produces a new Set identity. */
  toggleArea: (area: string) => void;
  /** Set or clear the currently selected flow. */
  setSelectedFlow: (uuid: string | null) => void;
}

export const useSidebarStore = create<SidebarState>((set) => ({
  tree: [],
  expandedAreas: new Set(),
  selectedFlowUuid: null,

  setTree: (tree) => set({ tree }),

  toggleArea: (area) =>
    set((s) => {
      // Immutable update — Zustand uses referential inequality to trigger
      // re-renders. Mutating the existing Set would be invisible to React.
      const next = new Set(s.expandedAreas);
      if (next.has(area)) next.delete(area);
      else next.add(area);
      return { expandedAreas: next };
    }),

  setSelectedFlow: (selectedFlowUuid) => set({ selectedFlowUuid }),
}));
