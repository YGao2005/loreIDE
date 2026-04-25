/**
 * Zustand store for substrate state — TWO concerns layered onto one store:
 *
 *   1) Phase 11 Plan 05: footer counter + first-time toast gate.
 *      - totalCount, firstNodeSeen, seedFromIpc, onSubstrateIngested, markFirstNodeSeen.
 *      - Driven by `substrate:ingested` events from the distiller pipeline.
 *
 *   2) Phase 13 Plan 01: per-uuid substrate state map for canvas coloring.
 *      - nodeStates Map<uuid, SubstrateNodeState>.
 *      - Mirrors useDriftStore (Phase 7) and useRollupStore (Phase 8) shape — each
 *        mutation produces a NEW Map identity so Zustand's referential-inequality
 *        triggers re-renders in the canvas. DO NOT mutate in place.
 *      - SubstrateNodeState ∈ { 'fresh' | 'stale' | 'superseded' | 'intent_drifted' }.
 *      - Hydrated by `getSubstrateStatesForCanvas()` IPC; future events from the
 *        Phase 12 supersession engine will keep it live (plan 13-09).
 *
 * Both slices are independent — Phase 11 work writes ONLY to totalCount/firstNodeSeen;
 * Phase 13 work writes ONLY to nodeStates. Keep them orthogonal.
 *
 * localStorage key: 'substrate.first_node_seen' per CONTEXT delight-moment lock.
 */

import { create } from 'zustand';
import { ipcSubstrate } from '../ipc/substrate';

const STORAGE_KEY = 'substrate.first_node_seen';
const FIRST_NODE_EVENT = 'substrate:first-node-toast';

/**
 * Phase 13 Plan 01: substrate state per contract atom UUID.
 *   - 'fresh'          → no substrate concerns, render normally
 *   - 'stale'          → substrate references this atom but is older than recent activity
 *   - 'superseded'     → atom's anchoring substrate was invalidated by a newer truth
 *                        (muted orange, no pulse)
 *   - 'intent_drifted' → atom is in the cascade of an L0 priority shift (DRIFTED verdict
 *                        from intent_engine.rs; orange + glow + pulse)
 *
 * Precedence vs Phase 7/8 visual states is enforced in `resolveNodeState`:
 *   drifted (red) > intent_drifted (orange + glow) > rollup_stale (amber)
 *   > superseded (orange muted) > rollup_untracked (gray) > healthy
 */
export type SubstrateNodeState = 'fresh' | 'stale' | 'superseded' | 'intent_drifted';

interface SubstrateStore {
  // ─────────────── Phase 11 Plan 05: footer counter + first-toast ───────────────
  /** Total current-truth substrate node count across all sessions. */
  totalCount: number;
  /**
   * Whether the very first substrate node has ever been seen.
   * Initialized from localStorage; set to true on first 0→≥1 transition
   * and never reset to false (even on page reload).
   */
  firstNodeSeen: boolean;

  /** Seed count from IPC on app boot (race-resistant pattern). */
  seedFromIpc: () => Promise<void>;
  /**
   * Called by SubstrateStatusIndicator when a substrate:ingested event fires.
   * delta = event payload count (number of new nodes in this batch).
   * Fires the first-node toast CustomEvent on first 0→≥1 transition.
   */
  onSubstrateIngested: (delta: number) => void;
  /** Persist the first-node-seen flag to localStorage and set store state. */
  markFirstNodeSeen: () => void;

  // ─────────────── Phase 13 Plan 01: per-uuid substrate state map ───────────────
  /**
   * Map keyed by contract atom uuid → substrate state.
   * Each mutation MUST produce a new Map identity (immutable update — Zustand
   * relies on referential inequality to trigger subscriber re-renders).
   * Per Pitfall 1 in 13-RESEARCH.md, do NOT mutate in place.
   */
  nodeStates: Map<string, SubstrateNodeState>;
  /** Set or update a single uuid's substrate state. */
  setNodeState: (uuid: string, state: SubstrateNodeState) => void;
  /**
   * Bulk set/update — used by AppShell hydrate-on-mount and by future Phase 13-09
   * sync events. Atomic: produces a single new Map identity for any number of updates.
   */
  bulkSet: (updates: { uuid: string; state: SubstrateNodeState }[]) => void;
  /** Remove a uuid from the map (state implicitly returns to 'fresh'). */
  clearNodeState: (uuid: string) => void;
  /** Clear ALL substrate states — called on repo switch so the previous repo's
   *  orange/superseded markers don't bleed into the next repo. */
  reset: () => void;
}

export const useSubstrateStore = create<SubstrateStore>((set, get) => ({
  // Phase 11 slice
  totalCount: 0,
  firstNodeSeen:
    typeof window !== 'undefined' &&
    localStorage.getItem(STORAGE_KEY) === 'true',

  seedFromIpc: async () => {
    try {
      const total = await ipcSubstrate.getTotalCount();
      set({ totalCount: total });
      // If we're past the first node already but the flag isn't set,
      // silently mark it seen (app was used before this feature shipped).
      if (total > 0 && !get().firstNodeSeen) {
        get().markFirstNodeSeen();
      }
    } catch (e) {
      console.warn('[SubstrateStore] seedFromIpc failed (non-fatal):', e);
    }
  },

  onSubstrateIngested: (delta: number) => {
    const prev = get().totalCount;
    const next = prev + delta;
    set({ totalCount: next });

    // First-ever 0→≥1 transition across the whole product.
    // Fire the CustomEvent — AppShell listens and shows the toast.
    if (prev === 0 && next > 0 && !get().firstNodeSeen) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(FIRST_NODE_EVENT));
      }
      get().markFirstNodeSeen();
    }
  },

  markFirstNodeSeen: () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, 'true');
    }
    set({ firstNodeSeen: true });
  },

  // Phase 13 slice
  nodeStates: new Map(),

  setNodeState: (uuid, state) =>
    set((s) => {
      // Immutable update — Zustand + React rely on referential inequality
      // to re-render. Mutating the existing Map would NOT trigger updates.
      const next = new Map(s.nodeStates);
      next.set(uuid, state);
      return { nodeStates: next };
    }),

  bulkSet: (updates) =>
    set((s) => {
      // Single Map-identity change for any number of updates → one re-render
      // in subscribers, not N. Critical at the canvas (buildFlowNodes useMemo).
      const next = new Map(s.nodeStates);
      for (const { uuid, state } of updates) next.set(uuid, state);
      return { nodeStates: next };
    }),

  clearNodeState: (uuid) =>
    set((s) => {
      // Avoid creating a new Map identity when nothing changed (prevents a
      // wasted re-render of the canvas useMemo).
      if (!s.nodeStates.has(uuid)) return s;
      const next = new Map(s.nodeStates);
      next.delete(uuid);
      return { nodeStates: next };
    }),

  reset: () => set({ nodeStates: new Map() }),
}));
