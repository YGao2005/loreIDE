import { create } from 'zustand';

interface UiStore {
  /** Copy Mode (NONC-01): non-coder filter — graph shows L4 atoms only,
   *  Inspector simplifies, rollup overlays hidden. Toggled via Sidebar pill. */
  copyModeActive: boolean;
  setCopyMode: (active: boolean) => void;
  toggleCopyMode: () => void;
}

export const useUiStore = create<UiStore>((set, get) => ({
  copyModeActive: false,
  setCopyMode: (active) => set({ copyModeActive: active }),
  toggleCopyMode: () => set({ copyModeActive: !get().copyModeActive }),
}));
