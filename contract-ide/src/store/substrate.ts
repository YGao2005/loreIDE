/**
 * Zustand store for substrate footer counter + first-time toast gate (Plan 11-05).
 *
 * Responsibilities:
 *   - Track total current-truth substrate count (all sessions).
 *   - Subscribe to substrate:ingested events from Plan 11-02 distiller pipeline.
 *   - On first 0→≥1 transition, fire a CustomEvent to trigger the one-time toast.
 *   - Persist the first-node-seen flag via localStorage so the toast never replays.
 *
 * Event subscription is done in SubstrateStatusIndicator (component-level, not here)
 * so cleanup is tied to the React lifecycle. The store tracks the counters and flag only.
 *
 * localStorage key: 'substrate.first_node_seen' per CONTEXT delight-moment lock.
 */

import { create } from 'zustand';
import { ipcSubstrate } from '../ipc/substrate';

const STORAGE_KEY = 'substrate.first_node_seen';
const FIRST_NODE_EVENT = 'substrate:first-node-toast';

interface SubstrateStore {
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
}

export const useSubstrateStore = create<SubstrateStore>((set, get) => ({
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
}));
