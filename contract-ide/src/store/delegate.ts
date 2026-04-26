/**
 * Delegate store — Phase 11 Plan 04.
 *
 * State machine: idle → composing(retrieving) → composing(planning) → plan-review → sent → executing → idle
 *
 * Transitions:
 *   startCompose(scope_uuid)        idle               → composing(retrieving)
 *   [compose returns]                composing(retr.)   → composing(planning)
 *   [plan returns]                   composing(plan.)   → plan-review
 *   approve(atomUuid?)               plan-review        → sent → executing
 *                                    [also seeds agent store with kickoff card]
 *   editPrompt(newPrompt)            plan-review        → composing(planning) → plan-review
 *   cancel()                         any                → idle
 *   onAgentTerminated(tracking_id)   executing          → idle
 *
 * AppShell wires onAgentTerminated to Phase 8's agent:complete event so the
 * Inspector button resets when the agent run finishes.
 *
 * On approve, the structured plan is seeded into the agent store as a
 * `kickoff` payload — ChatStream renders a KickoffCard in place of the
 * user-prompt bubble so the agent run reads as a continuous timeline:
 * [plan card] → [agent stream] → [result chip].
 */

import { create } from 'zustand';
import { ipcDelegate, type SubstrateHit, type StructuredPlan } from '../ipc/delegate';
import { useAgentStore } from './agent';
import { createChat as createChatIpc } from '../ipc/chats';

export type DelegateState =
  | { kind: 'idle' }
  | {
      kind: 'composing';
      scope_uuid: string;
      /** Drives the overlay's status label. 'retrieving' = compose call in
       * flight (no hits yet). 'planning' = plan call in flight (hits visible). */
      stage: 'retrieving' | 'planning';
      /** Available once compose returns (during 'planning' stage). */
      hits?: SubstrateHit[];
      /** Available once compose returns (during 'planning' stage). */
      assembledPrompt?: string;
    }
  | {
      kind: 'plan-review';
      scope_uuid: string;
      hits: SubstrateHit[];
      plan: StructuredPlan;
      assembledPrompt: string;
    }
  | { kind: 'sent'; scope_uuid: string }
  | { kind: 'executing'; scope_uuid: string; tracking_id: string };

interface DelegateStore {
  state: DelegateState;
  // Actions
  startCompose: (scope_uuid: string) => Promise<void>;
  approve: (atomUuid?: string) => Promise<void>;
  editPrompt: (newPrompt: string) => Promise<void>;
  cancel: () => void;
  onAgentTerminated: (tracking_id: string) => void;
}

export const useDelegateStore = create<DelegateStore>((set, get) => ({
  state: { kind: 'idle' },

  startCompose: async (scope_uuid: string) => {
    set({ state: { kind: 'composing', scope_uuid, stage: 'retrieving' } });
    try {
      const compose = await ipcDelegate.compose(scope_uuid);
      // Guard: user may have cancelled during the async compose call.
      if (get().state.kind !== 'composing') return;
      // Compose returned — transition to planning stage so the overlay shows
      // the retrieved hits (stagger fade) while plan_review is in flight.
      set({
        state: {
          kind: 'composing',
          scope_uuid,
          stage: 'planning',
          hits: compose.hits,
          assembledPrompt: compose.assembled_prompt,
        },
      });
      const plan = await ipcDelegate.plan(compose.assembled_prompt);
      // Guard again after planning pass (3-5s).
      if (get().state.kind !== 'composing') return;
      set({
        state: {
          kind: 'plan-review',
          scope_uuid,
          hits: compose.hits,
          plan,
          assembledPrompt: compose.assembled_prompt,
        },
      });
    } catch (e) {
      console.error('[delegate] compose/plan failed', e);
      set({ state: { kind: 'idle' } });
    }
  },

  approve: async (atomUuid?: string) => {
    const s = get().state;
    if (s.kind !== 'plan-review') return;
    const { scope_uuid, assembledPrompt, plan } = s;
    set({ state: { kind: 'sent', scope_uuid } });
    try {
      const tracking_id = await ipcDelegate.execute(
        scope_uuid,
        assembledPrompt,
        atomUuid,
      );
      // Delegate runs land in their own chat tab so the kickoff card +
      // streaming output don't shove an existing chat off-screen. The chat
      // is auto-named from the plan's intent / atom; users can rename later.
      const chatRow = await createChatIpc({
        scopeUuid: scope_uuid,
        name: deriveDelegateChatName(plan, atomUuid ?? scope_uuid),
      }).catch((e) => {
        console.warn('[delegate] createChat failed, falling back to active chat', e);
        return null;
      });
      if (chatRow) {
        useAgentStore.getState().upsertChatFromRow(chatRow, { activate: true });
      }
      // Seed the chosen chat with a kickoff payload BEFORE transitioning to
      // executing — ChatStream picks it up and renders the plan as a card at
      // the top of the run, so the agent's stream lands underneath it as a
      // continuous timeline.
      const targetChatId =
        chatRow?.id ?? useAgentStore.getState().activeChatId;
      if (targetChatId) {
        useAgentStore.getState().startRunWithKickoff({
          chatId: targetChatId,
          trackingId: tracking_id,
          scopeUuid: scope_uuid,
          kickoff: {
            plan,
            scopeUuid: scope_uuid,
            atomUuid: atomUuid ?? scope_uuid,
            assembledPrompt,
          },
        });
      } else {
        // No chat to attach to — extremely defensive. Stream events will
        // arrive but appendStream is a no-op without a trackingToChat entry.
        console.error('[delegate] no chat available for kickoff run', tracking_id);
      }
      set({ state: { kind: 'executing', scope_uuid, tracking_id } });
    } catch (e) {
      console.error('[delegate] execute failed', e);
      set({ state: { kind: 'idle' } });
    }
  },

  editPrompt: async (newPrompt: string) => {
    const s = get().state;
    if (s.kind !== 'plan-review') return;
    const { scope_uuid, hits } = s;
    // Re-plan only — skip retrieval. Show 'planning' stage with existing hits
    // so the overlay keeps the rules visible while the new plan is drafted.
    set({
      state: {
        kind: 'composing',
        scope_uuid,
        stage: 'planning',
        hits,
        assembledPrompt: newPrompt,
      },
    });
    try {
      const plan = await ipcDelegate.plan(newPrompt);
      // Guard: user may have cancelled during re-plan.
      if (get().state.kind !== 'composing') return;
      set({
        state: {
          kind: 'plan-review',
          scope_uuid,
          hits, // preserve original hits — only the prompt changed, not retrieval
          plan,
          assembledPrompt: newPrompt,
        },
      });
    } catch (e) {
      console.error('[delegate] re-plan failed', e);
      set({ state: { kind: 'idle' } });
    }
  },

  cancel: () => {
    set({ state: { kind: 'idle' } });
  },

  onAgentTerminated: (tracking_id: string) => {
    // Always read from getState() inside handler — race-resistant.
    const s = useDelegateStore.getState().state;
    if (s.kind === 'executing' && s.tracking_id === tracking_id) {
      set({ state: { kind: 'idle' } });
    }
  },
}));

/** Build a chat tab title for a delegate run. Prefer the first target file
 * (most informative); fall back to a short atom-uuid stamp. Truncated so the
 * tab strip stays readable. */
function deriveDelegateChatName(plan: StructuredPlan, atomUuid: string): string {
  const file = plan.target_files[0];
  if (file) {
    const segments = file.split('/');
    const tail = segments[segments.length - 1] || file;
    return `Delegate · ${tail}`.slice(0, 48);
  }
  return `Delegate · ${atomUuid.slice(0, 8)}`;
}
