import { create } from 'zustand';

/**
 * A pending patch produced by an agent run that is awaiting user approval.
 * Contains the before/after content for both the contract sidecar and each
 * source file touched by the run.
 *
 * Phase 08-05: the patch is populated via a dev-only synthetic affordance
 * (proved the modal path works end-to-end). Full integration — populating
 * from real JSONL tool_use blocks — ships in 08-06 or Phase 9 polish.
 */
export interface PendingPatch {
  uuid: string;
  nodeName: string;
  intentPhrase: string;
  toolCallCount: number;
  contractBefore: string;
  contractAfter: string;
  filePatches: Array<{ file: string; before: string; after: string }>;
}

interface CherrypickStore {
  /** CHRY-01: UUID of the node currently targeted by the cherrypick ring glow.
   * Set on graph-node click, Cmd+K jump, or chat-panel scope binding.
   * Cleared on (a) selection change to a different node, (b) modal close
   * after successful Approve, (c) repo switch. */
  targetedNodeUuid: string | null;

  /** Populated after an agent run produces a patch. Drives the diff modal. */
  pendingPatch: PendingPatch | null;

  /** Controls whether the cherrypick diff modal is open. */
  modalOpen: boolean;

  /** Set the targeted node UUID. Pass null to clear the ring glow. */
  setTarget: (uuid: string | null) => void;

  /** Replace the pending patch (called by agent loop on run complete). */
  setPendingPatch: (patch: PendingPatch | null) => void;

  /** Open the cherrypick modal (requires pendingPatch to be set first). */
  openModal: () => void;

  /** Close the cherrypick modal without clearing the pending patch. */
  closeModal: () => void;

  /** Full reset — clears target, patch, and modal state. Used on repo switch
   * so a stale ring glow from the previous repo doesn't carry over. */
  reset: () => void;
}

export const useCherrypickStore = create<CherrypickStore>((set) => ({
  targetedNodeUuid: null,
  pendingPatch: null,
  modalOpen: false,

  setTarget: (uuid) => set({ targetedNodeUuid: uuid }),

  setPendingPatch: (patch) => set({ pendingPatch: patch }),

  openModal: () => set({ modalOpen: true }),

  closeModal: () => set({ modalOpen: false }),

  reset: () => set({ targetedNodeUuid: null, pendingPatch: null, modalOpen: false }),
}));
