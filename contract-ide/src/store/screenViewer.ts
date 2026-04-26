/**
 * Phase 13 Plan 12 — Screen viewer overlay state.
 *
 * Holds which ScreenCard is currently expanded into the fullscreen overlay,
 * whether inspect mode is active inside the overlay, and the current hover
 * state (for the highlight outline + cursor badge).
 *
 * `inspectMode` always defaults to `false` on `expand()` — matches Chrome
 * DevTools behaviour where the inspect cursor isn't on by default when you
 * open the panel. Users opt in per overlay session via the toolbar toggle
 * or ⌘⇧C.
 *
 * The store does NOT touch graph-store selection: inspect-mode click syncs
 * to `useGraphStore.setSelectedNodeUuid` directly so the existing bottom
 * Inspector reacts. `close()` preserves the last selection so the bottom
 * Inspector stays populated after the overlay closes.
 */

import { create } from 'zustand';

export interface ViewerRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface ScreenViewerState {
  /** Uuid of the screen contract whose overlay is open, or null when closed. */
  expandedScreenUuid: string | null;
  /** Whether inspect-mode listeners are active in the iframe. */
  inspectMode: boolean;
  /** Currently-hovered atom uuid, or null when cursor isn't over any atom. */
  hoverUuid: string | null;
  /** Rect of the currently-hovered atom in iframe-local coordinates. */
  hoverRect: ViewerRect | null;

  /** Open the overlay on a given screen. Always resets inspect+hover. */
  expand: (uuid: string) => void;
  /** Close the overlay. Preserves graph-store selection. */
  close: () => void;
  /** Flip inspect mode. Clears hover state when toggling. */
  toggleInspect: () => void;
  /** Force inspect mode to a specific value (used by Esc to force-off). */
  setInspect: (on: boolean) => void;
  /** Update hover state from a responder inspect-hover event. */
  setHover: (uuid: string | null, rect: ViewerRect | null) => void;
}

export const useScreenViewerStore = create<ScreenViewerState>((set) => ({
  expandedScreenUuid: null,
  inspectMode: false,
  hoverUuid: null,
  hoverRect: null,

  expand: (uuid) =>
    set({
      expandedScreenUuid: uuid,
      inspectMode: false,
      hoverUuid: null,
      hoverRect: null,
    }),

  close: () =>
    set({
      expandedScreenUuid: null,
      inspectMode: false,
      hoverUuid: null,
      hoverRect: null,
    }),

  toggleInspect: () =>
    set((s) => ({
      inspectMode: !s.inspectMode,
      hoverUuid: null,
      hoverRect: null,
    })),

  setInspect: (on) =>
    set({
      inspectMode: on,
      hoverUuid: null,
      hoverRect: null,
    }),

  setHover: (uuid, rect) => set({ hoverUuid: uuid, hoverRect: rect }),
}));
