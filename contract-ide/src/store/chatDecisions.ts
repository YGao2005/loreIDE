/**
 * Chat decision citations — written by the `record_decision` MCP tool, surfaced
 * inline in the ChatStream so the user can expand each anchor to view the code
 * region that implements the decision.
 *
 * Two ingestion paths:
 *   1. Live: AppShell listens to the `chat:decision-recorded` Tauri event
 *      (re-emitted from the MCP sidecar's stderr marker). Each event arrives
 *      with `tracking_id` and `chat_id`; we index by both so the active run's
 *      ChatStream can render the card without a roundtrip.
 *   2. Cold: when a chat tab is reopened from History, ChatPanel calls
 *      `listChatDecisions({chatId})` and feeds the rows into `hydrate`.
 *
 * `byTracking` and `byChat` are kept in lockstep with insertion order (so
 * render order is stable across rerenders). Consumers should subscribe to the
 * uuid-list and `byUuid` slices separately and `useMemo` the join — selecting
 * a mapped array directly inside `useStore` would return a fresh reference
 * each render and trigger an infinite loop via `useSyncExternalStore`.
 */

import { create } from 'zustand';
import type { ChatDecisionAnchor, ChatDecisionRow } from '@/ipc/chatDecisions';

export type Decision = ChatDecisionRow;
export type DecisionAnchor = ChatDecisionAnchor;

interface ChatDecisionsState {
  /** All decisions, keyed by uuid. Source of truth for render bodies. */
  byUuid: Record<string, Decision>;
  /** uuids per tracking_id, in insertion order. */
  byTracking: Record<string, string[]>;
  /** uuids per chat_id, in insertion order. */
  byChat: Record<string, string[]>;
  /** Append a single decision (live event path). De-duped by uuid. */
  upsert: (d: Decision) => void;
  /** Replace all decisions for a chat_id (cold-load path). */
  hydrate: (chatId: string, rows: Decision[]) => void;
  /** Forget every decision for the given chat — used on chat delete. */
  forgetChat: (chatId: string) => void;
}

export const useChatDecisionsStore = create<ChatDecisionsState>((set, get) => ({
  byUuid: {},
  byTracking: {},
  byChat: {},

  upsert: (d) => {
    const state = get();
    const existed = !!state.byUuid[d.uuid];
    const byUuid = { ...state.byUuid, [d.uuid]: d };

    const byTracking = { ...state.byTracking };
    if (d.tracking_id) {
      const list = byTracking[d.tracking_id] ?? [];
      byTracking[d.tracking_id] = existed && list.includes(d.uuid)
        ? list
        : [...list, d.uuid];
    }

    const byChat = { ...state.byChat };
    if (d.chat_id) {
      const list = byChat[d.chat_id] ?? [];
      byChat[d.chat_id] = existed && list.includes(d.uuid)
        ? list
        : [...list, d.uuid];
    }

    set({ byUuid, byTracking, byChat });
  },

  hydrate: (chatId, rows) => {
    const state = get();
    const byUuid = { ...state.byUuid };
    const byTracking = { ...state.byTracking };
    // Drop the prior chat list — cold load is a wholesale replace.
    const byChat = { ...state.byChat, [chatId]: [] as string[] };

    for (const d of rows) {
      byUuid[d.uuid] = d;
      byChat[chatId] = [...byChat[chatId], d.uuid];
      if (d.tracking_id) {
        const t = byTracking[d.tracking_id] ?? [];
        if (!t.includes(d.uuid)) byTracking[d.tracking_id] = [...t, d.uuid];
      }
    }

    set({ byUuid, byTracking, byChat });
  },

  forgetChat: (chatId) => {
    const state = get();
    const uuids = state.byChat[chatId] ?? [];
    if (uuids.length === 0) return;
    const byUuid = { ...state.byUuid };
    const byTracking = { ...state.byTracking };
    for (const u of uuids) {
      const d = byUuid[u];
      delete byUuid[u];
      if (d?.tracking_id) {
        const list = byTracking[d.tracking_id]?.filter((x) => x !== u) ?? [];
        if (list.length === 0) delete byTracking[d.tracking_id];
        else byTracking[d.tracking_id] = list;
      }
    }
    const byChat = { ...state.byChat };
    delete byChat[chatId];
    set({ byUuid, byTracking, byChat });
  },
}));
