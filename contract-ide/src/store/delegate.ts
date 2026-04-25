/**
 * Delegate store — Phase 11 Plan 04.
 *
 * State machine: idle → composing → plan-review → sent → executing → idle
 *
 * Transitions:
 *   startCompose(scope_uuid)        idle         → composing
 *   [compose+plan succeed]           composing    → plan-review
 *   approve(atomUuid?)               plan-review  → sent → executing
 *   editPrompt(newPrompt)            plan-review  → composing → plan-review
 *   cancel()                         any          → idle
 *   onAgentTerminated(tracking_id)   executing    → idle
 *
 * AppShell wires onAgentTerminated to Phase 8's agent:complete event so the
 * Inspector button resets when the agent run finishes.
 */

import { create } from 'zustand';
import { ipcDelegate, type SubstrateHit, type StructuredPlan } from '../ipc/delegate';

export type DelegateState =
  | { kind: 'idle' }
  | { kind: 'composing'; scope_uuid: string }
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
    set({ state: { kind: 'composing', scope_uuid } });
    try {
      const compose = await ipcDelegate.compose(scope_uuid);
      // Guard: user may have cancelled during the async compose call.
      if (get().state.kind !== 'composing') return;
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
    const { scope_uuid, assembledPrompt } = s;
    set({ state: { kind: 'sent', scope_uuid } });
    try {
      const tracking_id = await ipcDelegate.execute(
        scope_uuid,
        assembledPrompt,
        atomUuid,
      );
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
    // Re-plan with new prompt; transition through composing visually.
    set({ state: { kind: 'composing', scope_uuid } });
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
