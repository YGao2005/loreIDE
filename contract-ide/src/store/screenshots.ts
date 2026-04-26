/**
 * Phase 13 Plan 06 + 12 — Screenshot + chip-rect cache.
 *
 * Originally the canvas-wide perf budget allowed ONE live iframe; non-focused
 * flows rendered a cached PNG instead. Phase 13 Plan 12 extends this: even
 * the focused screen renders the cached PNG on canvas (so wheel events flow
 * to react-flow without iframe-gesture conflicts). The live iframe is mounted
 * hidden offscreen, captures snapshot+rects on load, then stays hidden until
 * the user clicks ⤢ to enter ScreenViewerOverlay.
 *
 * Cache value is now a richer entry (`ScreenshotEntry`) that pairs the PNG
 * data URL with the chip rects captured in the same frame. This lets
 * AtomChipOverlay render chips on a screenshot when no live iframe is
 * available, while staying temporally consistent (chips drawn at positions
 * that match the screenshot).
 *
 * Storage: a Map<uuid, ScreenshotEntry>. Mutations replace the Map identity
 * so Zustand's referential inequality triggers re-renders (mirrors the Set
 * mutation pattern in useDriftStore + useRollupStore).
 *
 * Lifecycle:
 *   - `setEntry(uuid, entry)` — called by ScreenCard's iframe `load` handler
 *     after `requestSnapshot` returns. Subsequent re-captures (↻ button)
 *     overwrite the previous entry.
 *   - `clear(uuid?)` — clears one entry or the entire cache (e.g., when the
 *     user opens a new repo, all cached screenshots are stale).
 *
 * No persistence: the cache is in-memory only. Reloading the app discards
 * cached screenshots; they'll be re-captured on next focus.
 */

import { create } from 'zustand';
import type { ChipRect } from '@/lib/iframeChipPositioning';

export interface ScreenshotEntry {
  /** PNG data URL — `data:image/png;base64,...`. Use directly as <img src=...>. */
  dataUrl: string;
  /**
   * Chip rects captured in the same frame as the screenshot, in iframe-local
   * coordinates (the iframe's full target dimensions, e.g. 1280×800). Consumers
   * scale these to display dimensions when rendering chip overlays on the
   * cached <img>.
   */
  rects: ChipRect[];
  /** `Date.now()` at capture — for "snapshot N seconds old" affordances. */
  capturedAt: number;
}

interface ScreenshotState {
  /**
   * Map<uuid, ScreenshotEntry>. Identity changes on every mutation so Zustand
   * re-renders subscribers.
   */
  cache: Map<string, ScreenshotEntry>;

  /** Store a captured snapshot + rects for a screen contract uuid. */
  setEntry: (uuid: string, entry: ScreenshotEntry) => void;

  /** Read the cached entry for a uuid. Returns null when no capture exists. */
  getEntry: (uuid: string) => ScreenshotEntry | null;

  /** Convenience accessor for the dataUrl (backwards-compatible). */
  getScreenshot: (uuid: string) => string | null;

  /** Convenience accessor for the cached rects. */
  getCachedRects: (uuid: string) => ChipRect[] | null;

  /** Clear one entry or the entire cache. */
  clear: (uuid?: string) => void;
}

export const useScreenshotStore = create<ScreenshotState>((set, get) => ({
  cache: new Map(),

  setEntry: (uuid, entry) =>
    set((s) => {
      const next = new Map(s.cache);
      next.set(uuid, entry);
      return { cache: next };
    }),

  getEntry: (uuid) => get().cache.get(uuid) ?? null,

  getScreenshot: (uuid) => get().cache.get(uuid)?.dataUrl ?? null,

  getCachedRects: (uuid) => get().cache.get(uuid)?.rects ?? null,

  clear: (uuid) =>
    set((s) => {
      if (!uuid) return { cache: new Map() };
      const next = new Map(s.cache);
      next.delete(uuid);
      return { cache: next };
    }),
}));
