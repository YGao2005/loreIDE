import { create } from 'zustand';

interface DriftState {
  driftedUuids: Set<string>;
  setDrifted: (uuid: string, drifted: boolean) => void;
  /** Reset all drift state — called on repo switch so a stale pulse
   *  from the previous repo doesn't carry over. */
  reset: () => void;
}

export const useDriftStore = create<DriftState>((set) => ({
  driftedUuids: new Set(),
  setDrifted: (uuid, drifted) =>
    set((s) => {
      // Immutable update — Zustand + React rely on referential inequality
      // to re-render. Mutating the existing Set would NOT trigger updates.
      const next = new Set(s.driftedUuids);
      if (drifted) next.add(uuid);
      else next.delete(uuid);
      return { driftedUuids: next };
    }),
  reset: () => set({ driftedUuids: new Set() }),
}));
