/**
 * Phase 8 Plan 08-02 — Rollup detection Zustand store.
 *
 * Mirrors useDriftStore shape (Plan 07-03 lineage):
 *   - rollupStaleUuids: Set of UUIDs whose rollup state is 'stale' (amber pulse)
 *   - untrackedUuids: Set of UUIDs whose rollup state is 'untracked' (gray ring)
 *   - 'fresh' UUIDs are absent from both sets (no extra ring)
 *
 * PRECEDENCE: red (drift) > amber (rollup_stale) > gray (rollup_untracked)
 * is enforced in contractNodeStyles.ts compoundVariants + GraphCanvasInner.tsx.
 * This store holds raw state; consumers apply the precedence rule themselves.
 *
 * Reset is wired in BOTH pickAndOpenRepo AND openRepo (ipc/repo.ts) so that
 * a stale amber/gray ring from the previous repo never leaks to the next one
 * (same pattern as useDriftStore.reset() — Plan 07-03 STATE.md decision).
 */

import { create } from 'zustand';

export interface RollupStore {
  rollupStaleUuids: Set<string>;
  untrackedUuids: Set<string>;
  /**
   * Update a single UUID's rollup state.
   * Removes the UUID from BOTH sets first to ensure a previous state is
   * fully cleared before inserting into the new bucket.
   */
  set: (uuid: string, state: 'fresh' | 'stale' | 'untracked') => void;
  /**
   * Bulk-replace from list_rollup_states response on app boot.
   * Replaces the full store contents atomically.
   */
  hydrate: (rows: Array<{ node_uuid: string; state: string }>) => void;
  /**
   * Clear all rollup state — called on pickAndOpenRepo AND openRepo to
   * prevent stale amber/gray from the previous repo bleeding through.
   */
  reset: () => void;
}

export const useRollupStore = create<RollupStore>((set) => ({
  rollupStaleUuids: new Set(),
  untrackedUuids: new Set(),

  set: (uuid, state) =>
    set((s) => {
      // Immutable update — Zustand + React rely on referential inequality to
      // trigger re-renders. Mutating the existing Set would NOT trigger updates.
      const nextStale = new Set(s.rollupStaleUuids);
      const nextUntracked = new Set(s.untrackedUuids);
      // Remove from both sets first (state may have changed from stale→fresh,
      // untracked→stale, etc.)
      nextStale.delete(uuid);
      nextUntracked.delete(uuid);
      // Insert into the correct bucket.
      if (state === 'stale') nextStale.add(uuid);
      else if (state === 'untracked') nextUntracked.add(uuid);
      // 'fresh' → no insertion (uuid absent from both sets)
      return { rollupStaleUuids: nextStale, untrackedUuids: nextUntracked };
    }),

  hydrate: (rows) =>
    set(() => {
      const nextStale = new Set<string>();
      const nextUntracked = new Set<string>();
      for (const row of rows) {
        if (row.state === 'stale') nextStale.add(row.node_uuid);
        else if (row.state === 'untracked') nextUntracked.add(row.node_uuid);
        // 'fresh' → no insertion
      }
      return { rollupStaleUuids: nextStale, untrackedUuids: nextUntracked };
    }),

  reset: () => set({ rollupStaleUuids: new Set(), untrackedUuids: new Set() }),
}));
