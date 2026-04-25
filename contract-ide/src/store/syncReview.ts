/**
 * Phase 13.5 — Sync Review surface state.
 *
 * Holds the parsed payload for the right-sidebar Review tab. Hydrated by
 * loadSyncReview(beat) in src/lib/demoOrchestration.ts. One payload at a
 * time; second Pull (Beat 4) replaces Beat 3.
 */

import { create } from 'zustand';

export interface SyncReviewCommit {
  author: string;
  author_email?: string;
  message: string;
  sha?: string;
  files_changed: number;
  timestamp: string;
}

export interface SyncReviewBlastRadius {
  trigger_uuid: string;
  participant_uuids: string[];
}

export interface SyncReviewHonor {
  kind: 'honor';
  ruleUuid?: string;
  ruleName: string;
  detail: string;
}

export interface SyncReviewVerifyResponse {
  stream_delay_ms: number;
  tokens: string[];
}

export interface SyncReviewImplicit {
  id: string;
  field: string;
  derivedFrom: string;
  verify_response?: SyncReviewVerifyResponse;
}

export interface SyncReviewHarvested {
  uuid: string;
  kind: 'constraint' | 'decision';
  name: string;
  text: string;
  promoted_from_implicit: boolean;
  attached_to_uuid: string;
  attached_to_name?: string;
}

export interface SyncReviewPriorityHistoryEntry {
  priority: string;
  from: string;
  to: string | null;
}

export interface SyncReviewFlag {
  kind: 'flag';
  ruleUuid: string;
  ruleName: string;
  detail: string;
  parentSurfaceUuid: string;
  priority_history?: SyncReviewPriorityHistoryEntry[];
}

export interface SyncReviewPayload {
  beat: 'beat3' | 'beat4';
  commit: SyncReviewCommit;
  blast_radius: SyncReviewBlastRadius;
  honors: SyncReviewHonor[];
  implicit_decisions: SyncReviewImplicit[];
  harvested_rules: SyncReviewHarvested[];
  flag: SyncReviewFlag | null;
}

interface SyncReviewState {
  payload: SyncReviewPayload | null;
  pulling: boolean;
  /** Set after Accept+Merge so the panel can show the finish view. */
  merged: boolean;
  /** The user's narrowing text from the Flag section, echoed into the
   *  finish view + captured card so the input is visibly load-bearing. */
  capturedNarrowing: string | null;
  /** Number of beats already merged this session — used so the EmptyState
   *  knows whether to show pre-Beat-3 or post-Beat-3 copy. */
  mergedCount: number;
  setPulling: (pulling: boolean) => void;
  setPayload: (payload: SyncReviewPayload) => void;
  setCapturedNarrowing: (text: string) => void;
  markMerged: () => void;
  /** Dismiss the finish view → return to empty state, ready for next Pull. */
  dismissFinish: () => void;
  clear: () => void;
}

export const useSyncReviewStore = create<SyncReviewState>((set) => ({
  payload: null,
  pulling: false,
  merged: false,
  capturedNarrowing: null,
  mergedCount: 0,
  setPulling: (pulling) => set({ pulling }),
  setPayload: (payload) =>
    set({ payload, merged: false, capturedNarrowing: null, pulling: false }),
  setCapturedNarrowing: (text) => set({ capturedNarrowing: text }),
  markMerged: () =>
    set((s) => ({ merged: true, mergedCount: s.mergedCount + 1 })),
  dismissFinish: () =>
    set({ payload: null, merged: false, capturedNarrowing: null }),
  clear: () =>
    set({
      payload: null,
      merged: false,
      capturedNarrowing: null,
      mergedCount: 0,
      pulling: false,
    }),
}));
