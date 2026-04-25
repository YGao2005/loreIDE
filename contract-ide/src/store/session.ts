import { create } from 'zustand';
import type { SessionStatus } from '@/ipc/session';

/**
 * Zustand store for Phase 10 session state — backs the footer
 * SessionStatusIndicator + BackfillModal open/close affordance.
 *
 * Follows the shape of src/store/drift.ts: simple slice + setters,
 * no derived state, no async actions (those live in components).
 */
interface SessionState {
  status: SessionStatus;
  backfillModalOpen: boolean;
  setStatus: (s: SessionStatus) => void;
  openBackfillModal: () => void;
  closeBackfillModal: () => void;
  reset: () => void;
}

const INITIAL: SessionStatus = { watchingSessions: 0, episodesIngested: 0 };

export const useSessionStore = create<SessionState>((set) => ({
  status: INITIAL,
  backfillModalOpen: false,
  setStatus: (status) => set({ status }),
  openBackfillModal: () => set({ backfillModalOpen: true }),
  closeBackfillModal: () => set({ backfillModalOpen: false }),
  reset: () => set({ status: INITIAL, backfillModalOpen: false }),
}));
