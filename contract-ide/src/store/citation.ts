/**
 * Phase 13 Plan 07 — Citation halo + modal coordination store.
 *
 * Single Zustand store that powers two coordinated UI behaviours when a user
 * clicks a `[source]` substrate citation:
 *
 *   1. `openCitationUuid` — drives the SourceArchaeologyModal (verbatim quote
 *      + provenance metadata fetched via getSubstrateNodeDetail IPC).
 *   2. `highlightedUuid`  — drives a transient "citation halo" across the
 *      canvas chain — ServiceCard / ScreenCard / AtomChip subscribe to this
 *      slice and apply `citationHaloClass` (blue ring + scale) for ~2s before
 *      it auto-clears.
 *
 * Why ONE store rather than two:
 *   The citation pill click sets BOTH (modal open + halo flash) atomically. A
 *   single store keeps the action surface small (`openCitation` / `highlight`)
 *   and avoids subscribers seeing half-updated state across rerenders.
 *
 * Halo timing:
 *   `highlight()` schedules an automatic clear after `durationMs` (default
 *   2000). Repeated calls cancel the previous timeout (so rapid clicks always
 *   produce a fresh 2s pulse rather than a clipped one). The closure-scoped
 *   `timeoutHandle` is intentionally non-reactive — it doesn't drive renders;
 *   only the `set({ highlightedUuid })` does.
 *
 * Pattern note (per 13-06 SUMMARY): selectors that read a single primitive
 * slice (`(s) => s.highlightedUuid`) return stable references, so this store
 * is safe to subscribe from many components without the useSyncExternalStore
 * infinite-loop hazard the AtomChipOverlay hit.
 */

import { create } from 'zustand';

interface CitationState {
  /** When set, halo subscribers (ServiceCard / ScreenCard / AtomChip) light up. */
  highlightedUuid: string | null;
  /** When set, SourceArchaeologyModal is open and fetches detail for this uuid. */
  openCitationUuid: string | null;
  /** Set highlightedUuid for `durationMs` (default 2000), then auto-clear. */
  highlight: (uuid: string, durationMs?: number) => void;
  /** Open the SourceArchaeologyModal for this uuid. */
  openCitation: (uuid: string) => void;
  /** Close the modal. */
  closeCitation: () => void;
  /** Clear the halo immediately (cancels any pending auto-clear timeout). */
  clearHighlight: () => void;
  /**
   * Phase 15 Plan 03 — optional callback fired by SourceArchaeologyModal AFTER
   * a successful refine, BEFORE re-pointing openCitationUuid to the new chain head.
   *
   * Receives the ORIGINAL uuid (the rule that was refined, not the new chain head).
   *
   * Producers (e.g., VerifierPanel from plan 15-06) set this at modal-open time
   * to receive a commit-handshake — direct callback over post-hoc inference.
   * Cleared on closeCitation so stale producers cannot fire on unrelated refines.
   *
   * Cmd+P substrate hits (plan 15-02) leave this null — refining through that
   * entry point has no side-effects on any panel state.
   */
  onRefineSuccess: ((originalUuid: string) => void) | null;
  setOnRefineSuccess: (cb: ((originalUuid: string) => void) | null) => void;
}

export const useCitationStore = create<CitationState>((set) => {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  return {
    highlightedUuid: null,
    openCitationUuid: null,
    onRefineSuccess: null,
    highlight: (uuid, durationMs = 2000) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      set({ highlightedUuid: uuid });
      timeoutHandle = setTimeout(() => {
        set({ highlightedUuid: null });
        timeoutHandle = null;
      }, durationMs);
    },
    openCitation: (uuid) => set({ openCitationUuid: uuid }),
    closeCitation: () =>
      // Clear onRefineSuccess on every modal close — defensive: ensures a
      // stale producer (e.g., VerifierPanel that unmounted without closing
      // the modal) cannot fire its callback on the next unrelated refine.
      set({ openCitationUuid: null, onRefineSuccess: null }),
    clearHighlight: () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      set({ highlightedUuid: null });
      timeoutHandle = null;
    },
    setOnRefineSuccess: (cb) => set({ onRefineSuccess: cb }),
  };
});
