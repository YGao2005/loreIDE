/**
 * Phase 9 Plan 09-01/09-02 — Mass-edit Zustand store.
 *
 * 09-01 shipped: matchedUuids Map (uuid → delayMs) for the staggered amber
 * pulse primitive on the graph canvas (mass_matched CVA variant).
 *
 * 09-02 extends with full review-queue state: query, candidates
 * (MassMatchResult[]), embeddingStatus, selectedUuids, applyState,
 * result counters, and rollupStaleAtStart snapshot for upstream-impact diff.
 *
 * PRECEDENCE: drifted (red) > mass_matched (amber transient) > healthy.
 * This store holds raw state; buildFlowNodes applies the precedence rule.
 *
 * Reset path (09-02): MassEditTrigger calls clearMatches() + resetReviewQueue()
 * on modal close — the pulse is transient and intentionally NOT persisted across
 * page reloads.
 */

import { create } from 'zustand';
import type { MassMatchResult } from '@/ipc/mass-edit';

export interface MassEditStore {
  // ─── 09-01: graph pulse primitive ────────────────────────────────────────

  /**
   * Map of uuid → animationDelayMs (50ms staggered per match position).
   * Empty when no mass-match is active.
   */
  matchedUuids: Map<string, number>;
  /**
   * Set the active mass-match result set. Replaces any previous set.
   * uuids are ordered by weightedScore (descending) — the order determines
   * the stagger delay: first result pulses first (0ms), next at 50ms, etc.
   */
  setMatches: (uuids: string[]) => void;
  /**
   * Clear all mass-match highlights. Called by 09-02's review queue on close.
   */
  clearMatches: () => void;

  // ─── 09-02: review queue state ───────────────────────────────────────────

  /** The natural-language query the user typed into MassEditTrigger. */
  query: string;
  /**
   * Full MassMatchResult[] from findByIntentMass — includes human_pinned,
   * body, snippet, matchedSection, etc. so MassEditModal doesn't need a
   * second round-trip.
   */
  candidates: MassMatchResult[];
  /**
   * Mirrors response.embedding_status from findByIntentMass.
   * 'disabled' in Phase 9 v1 (keyword-only fallback per MASS-01 spec).
   * UI reads this to render the inline notice "semantic similarity unavailable
   * — keyword matches only" when value is 'disabled'.
   */
  embeddingStatus: 'disabled' | 'enabled';
  /**
   * Set of UUIDs the user has checked in the review queue.
   * Pinned nodes are pre-deselected and their checkboxes are disabled.
   * Populated by setCandidates (all non-pinned selected by default).
   */
  selectedUuids: Set<string>;
  /** Tracks the modal's apply lifecycle. */
  applyState: 'idle' | 'previewing' | 'applying' | 'done';
  /**
   * Post-apply result counters. null until apply completes.
   * rollupStaleAtApply is a reserved field for a post-apply snapshot
   * (not yet used — MassEditResultBanner computes the diff live from
   * rollupStaleAtStart vs. useRollupStore.rollupStaleUuids.size).
   */
  result: {
    applied: number;
    skipped_pinned: number;
    errors: number;
    rollupStaleAtApply: number;
  } | null;
  /**
   * Snapshot of useRollupStore.rollupStaleUuids.size BEFORE the apply runs.
   * After apply, (rollupStaleUuids.size - rollupStaleAtStart) = upstream
   * contracts that flipped to stale during the batch (MASS-02 cascade visibility).
   */
  rollupStaleAtStart: number;

  setQuery: (q: string) => void;
  setCandidates: (c: MassMatchResult[]) => void;
  setEmbeddingStatus: (s: 'disabled' | 'enabled') => void;
  toggleSelected: (uuid: string) => void;
  setAllSelected: (uuids: string[]) => void;
  setApplyState: (s: MassEditStore['applyState']) => void;
  setResult: (r: MassEditStore['result']) => void;
  /**
   * Reset all review-queue state (NOT the pulse — call clearMatches() too).
   * Called by MassEditTrigger.handleClose() so a new Cmd+K invocation starts
   * fresh.
   */
  resetReviewQueue: () => void;
}

export const useMassEditStore = create<MassEditStore>((set, get) => ({
  // ─── 09-01 pulse state ───────────────────────────────────────────────────
  matchedUuids: new Map(),

  setMatches: (uuids) =>
    set({
      // Immutable update — Zustand + React rely on referential inequality
      // to trigger re-renders. Creating a new Map ensures the useMemo in
      // GraphCanvasInner re-fires when the match set changes.
      matchedUuids: new Map(uuids.map((uuid, i) => [uuid, i * 50])),
    }),

  clearMatches: () => set({ matchedUuids: new Map() }),

  // ─── 09-02 review queue state ────────────────────────────────────────────
  query: '',
  candidates: [],
  embeddingStatus: 'disabled', // Phase 9 v1: keyword-only fallback per MASS-01 spec
  selectedUuids: new Set(),
  applyState: 'idle',
  result: null,
  rollupStaleAtStart: 0,

  setQuery: (q) => set({ query: q }),

  setCandidates: (c) =>
    set({
      candidates: c,
      // Pinned nodes are pre-deselected (they'll be skipped by update_contract's
      // SKIPPED-PINNED guard anyway). Default-select all non-pinned candidates.
      selectedUuids: new Set(c.filter((n) => !isPinned(n)).map((n) => n.uuid)),
    }),

  setEmbeddingStatus: (s) => set({ embeddingStatus: s }),

  toggleSelected: (uuid) => {
    const next = new Set(get().selectedUuids);
    if (next.has(uuid)) {
      next.delete(uuid);
    } else {
      next.add(uuid);
    }
    set({ selectedUuids: next });
  },

  setAllSelected: (uuids) => set({ selectedUuids: new Set(uuids) }),

  setApplyState: (s) => set({ applyState: s }),

  setResult: (r) => set({ result: r }),

  resetReviewQueue: () =>
    set({
      query: '',
      candidates: [],
      embeddingStatus: 'disabled',
      selectedUuids: new Set(),
      applyState: 'idle',
      result: null,
      rollupStaleAtStart: 0,
    }),
}));

/**
 * Whether a candidate is human-pinned.
 *
 * 09-01 surfaces human_pinned: boolean as a first-class field on every
 * MassMatchResult. No fallback — if the field isn't present, that's a 09-01
 * regression to fix there. Dep direction is strictly 09-01 → 09-02 (no
 * back-edits to 09-01 from here).
 */
function isPinned(n: MassMatchResult): boolean {
  return n.human_pinned === true;
}
