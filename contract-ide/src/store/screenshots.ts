/**
 * Phase 13 Plan 06 — Screenshot cache for the Beat 4 two-flow case.
 *
 * The canvas-wide perf budget allows ONE live iframe; non-focused flows
 * render a cached PNG instead. ScreenCard (when focused) captures a snapshot
 * of its iframe content via `captureIframeScreenshot` and stores the data URL
 * here; non-focused ScreenCards read by uuid and render an `<img>` instead
 * of mounting another iframe.
 *
 * Storage: a Map<uuid, dataUrl>. Mutations replace the Map identity so
 * Zustand's referential inequality triggers re-renders (mirrors the Set
 * mutation pattern in useDriftStore + useRollupStore).
 *
 * Lifecycle:
 *   - `setScreenshot(uuid, dataUrl)` — called by ScreenCard's iframe `load`
 *     handler when isFocused === true. Subsequent re-captures (file-change
 *     watcher event) overwrite the previous dataUrl.
 *   - `clear(uuid?)` — clears one entry or the entire cache (e.g., when the
 *     user opens a new repo, all cached screenshots are stale).
 *
 * No persistence: the cache is in-memory only. Reloading the app discards
 * cached screenshots; they'll be re-captured on next focus.
 */

import { create } from 'zustand';

interface ScreenshotState {
  /**
   * Map<uuid, dataUrl>. The dataUrl is a `data:image/png;base64,...` string
   * suitable for direct use as an <img src=...>. Identity changes on every
   * mutation so Zustand re-renders subscribers.
   */
  cache: Map<string, string>;

  /**
   * Store a captured screenshot for a contract uuid (typically a UI screen
   * contract). Replaces any previous capture for the same uuid.
   */
  setScreenshot: (uuid: string, dataUrl: string) => void;

  /**
   * Read the cached screenshot for a uuid. Returns null when no capture
   * exists yet — caller should render a placeholder ("capturing…") or fall
   * through to whatever pre-load fixture screenshot is available.
   */
  getScreenshot: (uuid: string) => string | null;

  /**
   * Clear one entry (when its contract changed and the cached screenshot is
   * stale) or the entire cache (when the repo is reset).
   */
  clear: (uuid?: string) => void;
}

export const useScreenshotStore = create<ScreenshotState>((set, get) => ({
  cache: new Map(),

  setScreenshot: (uuid, dataUrl) =>
    set((s) => {
      const next = new Map(s.cache);
      next.set(uuid, dataUrl);
      return { cache: next };
    }),

  getScreenshot: (uuid) => get().cache.get(uuid) ?? null,

  clear: (uuid) =>
    set((s) => {
      if (!uuid) return { cache: new Map() };
      const next = new Map(s.cache);
      next.delete(uuid);
      return { cache: next };
    }),
}));
