/**
 * Multi-chat agent store.
 *
 * The store holds **open** chats only — each is a tab in the right panel.
 * Closed chats live in SQLite (closed_at IS NOT NULL) and are loaded on
 * demand by the History panel; reopening a closed chat pushes it back into
 * `chats[]` here with its content reconstructed from the session JSONL.
 *
 * Each chat owns its own conversation: a `history` of completed runs plus
 * the in-flight `current` run. ChatPanel reads the active chat to render the
 * timeline; the tab strip reads `chats[]` for the tabs themselves.
 *
 * Multi-run dispatch: agent:stream / agent:complete events are global, but
 * `trackingToChat` maps a run's tracking_id to the chat that owns it, so
 * background tabs continue to receive their stream even when not active.
 *
 * Delegate kickoff: when a run is launched via the Inspector's Delegate
 * button, the AgentRun is seeded with a structured `kickoff` payload — the
 * KickoffCard renders in place of the user-prompt bubble at the top of the
 * run, so the chat scrollback reads "[plan card] → [agent stream]" as a
 * continuous timeline.
 */

import { create } from 'zustand';
import type { StructuredPlan } from '../ipc/delegate';
import type { ChatRow, TurnRecord } from '../ipc/chats';

export type AgentRunStatus =
  | 'idle'
  | 'running'
  | 'complete'
  | 'error'
  /** User pressed Stop. Distinct from 'error' so the UI can render
   * "Stopped" instead of "Run failed" — the agent:complete event from the
   * killed claude process won't override this back to 'error'. */
  | 'stopped';

export interface KickoffPayload {
  plan: StructuredPlan;
  scopeUuid: string;
  atomUuid: string;
  assembledPrompt: string;
}

export interface AgentRun {
  trackingId: string;
  scopeUuid: string | null;
  /** Original user prompt — rendered as a bubble in the chat. Empty for
   * Delegate-launched runs (the kickoff card replaces the prompt bubble). */
  prompt: string;
  status: AgentRunStatus;
  /** Raw JSONL lines from agent:stream events — each element is one stdout line. */
  streamBuffer: string[];
  /** Lines emitted on stderr. When claude exits non-zero (auth failure,
   * credit balance, missing API key, etc.) the actionable message is here.
   * ChatPanel surfaces these in an inline "Error output" block when
   * `status === 'error'`. */
  errorBuffer: string[];
  startedAt: string;
  /** Claude session id captured from the run's stream (set when the run
   * completes). The chat's `claudeSessionId` mirrors this — runs in a chat
   * all share one session because follow-ups use claude --resume. */
  sessionId?: string | null;
  /** Set when the run was launched via the Delegate button — renders a
   * structured plan card at the top of the run instead of the prompt bubble. */
  kickoff?: KickoffPayload | null;
}

/** A live (open) chat in the right panel. Maps 1:1 to a `chats` row in
 * SQLite plus the in-memory conversation content. */
export interface ChatSession {
  /** Chat row id from SQLite (e.g. `chat-abc123…`). */
  id: string;
  name: string;
  scopeUuid: string | null;
  /** Claude session id, written once the first turn completes. While null,
   * runs in this chat start fresh; once set, follow-ups pass it as
   * `resumeSessionId` to runAgent so claude continues the conversation. */
  claudeSessionId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Completed turns, oldest → newest. */
  history: AgentRun[];
  /** In-flight or just-completed run for this chat. Null when the chat has
   * no run yet (just created) or the previous run was archived to history
   * by a new turn starting (rare — usually the latest run stays as
   * `current` until the next send). */
  current: AgentRun | null;
}

interface AgentStore {
  /** Open chats — order = tab strip order (left to right). */
  chats: ChatSession[];
  /** Currently-displayed chat in ChatPanel. Null = empty state ("+ to start"). */
  activeChatId: string | null;
  /** trackingId → chatId. Populated on startRun; consulted on
   * appendStream/completeRun so dispatch lands on the right chat even when
   * a different tab is active. */
  trackingToChat: Record<string, string>;

  // ── Hydration ──────────────────────────────────────────────────────────
  /** Load open chats from SQLite (`list_open_chats`). Replaces `chats[]`
   * wholesale — call once on AppShell boot. Keeps activeChatId only if it
   * still resolves; otherwise picks the last chat or null. */
  hydrate: (rows: ChatRow[]) => void;

  // ── Tab lifecycle ──────────────────────────────────────────────────────
  /** Append a chat (from createChat IPC or a reopen flow) and make it active. */
  upsertChatFromRow: (
    row: ChatRow,
    opts?: { history?: AgentRun[]; current?: AgentRun | null; activate?: boolean },
  ) => void;
  setActive: (chatId: string | null) => void;
  /** Remove from `chats[]` (after close_chat IPC). If the removed chat was
   * active, picks the right neighbor or leaves activeChatId null. */
  removeChat: (chatId: string) => void;
  applySessionId: (chatId: string, sessionId: string) => void;
  applyName: (chatId: string, name: string) => void;

  // ── Run lifecycle ──────────────────────────────────────────────────────
  /** Start a fresh run on a chat. Pushes the chat's prior `current` (if any
   * and complete) into `history`. Registers trackingId in `trackingToChat`. */
  startRun: (args: {
    chatId: string;
    trackingId: string;
    scopeUuid: string | null;
    prompt: string;
  }) => void;
  /** Delegate-launched variant — same lifecycle, but seeds the kickoff
   * payload and clears `prompt` so KickoffCard renders in the user-bubble
   * slot. */
  startRunWithKickoff: (args: {
    chatId: string;
    trackingId: string;
    scopeUuid: string | null;
    kickoff: KickoffPayload;
  }) => void;
  /** Append one stream line to the chat that owns `trackingId`. Stderr
   * lines go to `errorBuffer`; stdout lines go to `streamBuffer`. No-op if
   * the chat was closed mid-run. */
  appendStream: (trackingId: string, line: string, isStderr: boolean) => void;
  /** Mark the run complete + capture session_id. No-op if chat closed. */
  completeRun: (
    trackingId: string,
    code: number | null,
    sessionId: string | null,
  ) => void;
  /** Optimistically mark a run 'stopped'. Called before stopAgent IPC
   * resolves so the UI updates immediately; the trailing agent:complete is
   * absorbed by completeRun without downgrading status to 'error'. */
  markStopped: (trackingId: string) => void;

  // ── Reset ──────────────────────────────────────────────────────────────
  /** Clear all in-store chats (e.g., on repo switch). Does NOT touch the DB. */
  reset: () => void;
}

/** Convert reconstructed TurnRecords (from `read_chat_jsonl`) into AgentRuns
 * suitable for `upsertChatFromRow({ history })`. Reopened chats are always
 * marked `complete` — there's no in-flight run to attach to. Fields that
 * weren't persisted (scopeUuid, startedAt) get null/empty defaults; the UI
 * doesn't surface them for replayed runs. */
export function turnsToAgentRuns(turns: TurnRecord[]): AgentRun[] {
  return turns.map((t) => ({
    trackingId: t.tracking_id,
    scopeUuid: null,
    prompt: t.user_prompt,
    status: 'complete' as const,
    streamBuffer: t.stream_lines,
    errorBuffer: [],
    startedAt: '',
    sessionId: null,
    kickoff: null,
  }));
}

function rowToSession(row: ChatRow): ChatSession {
  return {
    id: row.id,
    name: row.name,
    scopeUuid: row.scope_uuid,
    claudeSessionId: row.claude_session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    history: [],
    current: null,
  };
}

export const useAgentStore = create<AgentStore>((set) => ({
  chats: [],
  activeChatId: null,
  trackingToChat: {},

  hydrate: (rows) =>
    set((s) => {
      const chats = rows.map(rowToSession);
      // Preserve activeChatId if it still resolves; otherwise pick the last
      // chat (most recently created) so the user lands on something useful.
      const stillActive = chats.find((c) => c.id === s.activeChatId);
      const nextActive = stillActive
        ? s.activeChatId
        : chats.length > 0
          ? chats[chats.length - 1].id
          : null;
      return { chats, activeChatId: nextActive };
    }),

  upsertChatFromRow: (row, opts) =>
    set((s) => {
      const session: ChatSession = {
        ...rowToSession(row),
        history: opts?.history ?? [],
        current: opts?.current ?? null,
      };
      const idx = s.chats.findIndex((c) => c.id === row.id);
      const chats =
        idx === -1
          ? [...s.chats, session]
          : s.chats.map((c, i) => (i === idx ? session : c));
      const activate = opts?.activate ?? true;
      return {
        chats,
        activeChatId: activate ? row.id : s.activeChatId,
      };
    }),

  setActive: (chatId) =>
    set((s) =>
      // Defensive: ignore if the chat isn't in the list (caller bug).
      chatId === null || s.chats.some((c) => c.id === chatId)
        ? { activeChatId: chatId }
        : s,
    ),

  removeChat: (chatId) =>
    set((s) => {
      const idx = s.chats.findIndex((c) => c.id === chatId);
      if (idx === -1) return s;
      const chats = s.chats.filter((c) => c.id !== chatId);
      let nextActive: string | null = s.activeChatId;
      if (s.activeChatId === chatId) {
        // Prefer the right neighbor; fall back to the new last chat.
        if (idx < chats.length) nextActive = chats[idx].id;
        else if (chats.length > 0) nextActive = chats[chats.length - 1].id;
        else nextActive = null;
      }
      // Also drop trackingToChat entries pointing at the removed chat —
      // appendStream/completeRun will safely no-op for the orphaned run.
      const trackingToChat: Record<string, string> = {};
      for (const [tid, cid] of Object.entries(s.trackingToChat)) {
        if (cid !== chatId) trackingToChat[tid] = cid;
      }
      return { chats, activeChatId: nextActive, trackingToChat };
    }),

  applySessionId: (chatId, sessionId) =>
    set((s) => ({
      chats: s.chats.map((c) =>
        c.id === chatId ? { ...c, claudeSessionId: sessionId } : c,
      ),
    })),

  applyName: (chatId, name) =>
    set((s) => ({
      chats: s.chats.map((c) =>
        c.id === chatId ? { ...c, name } : c,
      ),
    })),

  startRun: ({ chatId, trackingId, scopeUuid, prompt }) =>
    set((s) => {
      const idx = s.chats.findIndex((c) => c.id === chatId);
      if (idx === -1) return s;
      const chat = s.chats[idx];
      // Roll the prior current into history so the new turn appears below it
      // in the timeline. If current was somehow still 'running' (shouldn't
      // happen — UI guards against concurrent sends in the same chat) we
      // still archive it; the orphaned run will eventually emit complete and
      // appendStream calls will land on this chat's history entry via the
      // older trackingId — accept the visual oddity (uncommon path).
      const newHistory = chat.current
        ? [...chat.history, chat.current]
        : chat.history;
      const next: ChatSession = {
        ...chat,
        scopeUuid: scopeUuid ?? chat.scopeUuid,
        history: newHistory,
        current: {
          trackingId,
          scopeUuid,
          prompt,
          status: 'running',
          streamBuffer: [],
          errorBuffer: [],
          startedAt: new Date().toISOString(),
          sessionId: null,
          kickoff: null,
        },
      };
      const chats = s.chats.map((c, i) => (i === idx ? next : c));
      return {
        chats,
        trackingToChat: { ...s.trackingToChat, [trackingId]: chatId },
      };
    }),

  startRunWithKickoff: ({ chatId, trackingId, scopeUuid, kickoff }) =>
    set((s) => {
      const idx = s.chats.findIndex((c) => c.id === chatId);
      if (idx === -1) return s;
      const chat = s.chats[idx];
      const newHistory = chat.current
        ? [...chat.history, chat.current]
        : chat.history;
      const next: ChatSession = {
        ...chat,
        scopeUuid: scopeUuid ?? chat.scopeUuid,
        history: newHistory,
        current: {
          trackingId,
          scopeUuid,
          prompt: '',
          status: 'running',
          streamBuffer: [],
          errorBuffer: [],
          startedAt: new Date().toISOString(),
          sessionId: null,
          kickoff,
        },
      };
      const chats = s.chats.map((c, i) => (i === idx ? next : c));
      return {
        chats,
        trackingToChat: { ...s.trackingToChat, [trackingId]: chatId },
      };
    }),

  appendStream: (trackingId, line, isStderr) =>
    set((s) => {
      const chatId = s.trackingToChat[trackingId];
      if (!chatId) return s;
      const idx = s.chats.findIndex((c) => c.id === chatId);
      if (idx === -1) return s;
      const chat = s.chats[idx];
      const append = (run: AgentRun): AgentRun =>
        isStderr
          ? { ...run, errorBuffer: [...run.errorBuffer, line] }
          : { ...run, streamBuffer: [...run.streamBuffer, line] };
      // Lines can target either current (most common) or the latest history
      // entry (if startRun rolled a still-running prior turn into history —
      // edge case). Match by trackingId to be precise.
      if (chat.current?.trackingId === trackingId) {
        const next: ChatSession = { ...chat, current: append(chat.current) };
        return {
          chats: s.chats.map((c, i) => (i === idx ? next : c)),
        };
      }
      const histIdx = chat.history.findIndex(
        (r) => r.trackingId === trackingId,
      );
      if (histIdx === -1) return s;
      const next: ChatSession = {
        ...chat,
        history: chat.history.map((r, i) => (i === histIdx ? append(r) : r)),
      };
      return {
        chats: s.chats.map((c, i) => (i === idx ? next : c)),
      };
    }),

  completeRun: (trackingId, code, sessionId) =>
    set((s) => {
      const chatId = s.trackingToChat[trackingId];
      if (!chatId) return s;
      const idx = s.chats.findIndex((c) => c.id === chatId);
      if (idx === -1) {
        // Chat was closed mid-run — drop the trackingId mapping and move on.
        const trackingToChat = { ...s.trackingToChat };
        delete trackingToChat[trackingId];
        return { trackingToChat };
      }
      const chat = s.chats[idx];

      // Determine target run upfront so we can preserve a prior 'stopped'
      // mark — markStopped sets status before the killed claude emits its
      // non-zero exit, and we don't want completeRun to downgrade it back
      // to 'error'.
      const finalize = (run: AgentRun): AgentRun => {
        const next: AgentRunStatus =
          run.status === 'stopped'
            ? 'stopped'
            : code === 0
              ? 'complete'
              : 'error';
        return {
          ...run,
          status: next,
          sessionId: sessionId ?? run.sessionId ?? null,
        };
      };

      let next: ChatSession = chat;
      if (chat.current?.trackingId === trackingId) {
        next = { ...chat, current: finalize(chat.current) };
      } else {
        const histIdx = chat.history.findIndex(
          (r) => r.trackingId === trackingId,
        );
        if (histIdx !== -1) {
          next = {
            ...chat,
            history: chat.history.map((r, i) =>
              i === histIdx ? finalize(r) : r,
            ),
          };
        } else {
          // No matching run — drop the mapping and bail.
          const trackingToChat = { ...s.trackingToChat };
          delete trackingToChat[trackingId];
          return { trackingToChat };
        }
      }

      // Promote the chat-level claudeSessionId on first session_id capture.
      if (sessionId && !next.claudeSessionId) {
        next = { ...next, claudeSessionId: sessionId };
      }

      const trackingToChat = { ...s.trackingToChat };
      delete trackingToChat[trackingId];
      return {
        chats: s.chats.map((c, i) => (i === idx ? next : c)),
        trackingToChat,
      };
    }),

  markStopped: (trackingId) =>
    set((s) => {
      const chatId = s.trackingToChat[trackingId];
      if (!chatId) return s;
      const idx = s.chats.findIndex((c) => c.id === chatId);
      if (idx === -1) return s;
      const chat = s.chats[idx];
      // Same dispatch as appendStream — match by trackingId across current
      // and history so a Stop on a backgrounded run still lands.
      if (chat.current?.trackingId === trackingId) {
        const next: ChatSession = {
          ...chat,
          current: { ...chat.current, status: 'stopped' as const },
        };
        return { chats: s.chats.map((c, i) => (i === idx ? next : c)) };
      }
      const histIdx = chat.history.findIndex((r) => r.trackingId === trackingId);
      if (histIdx === -1) return s;
      const next: ChatSession = {
        ...chat,
        history: chat.history.map((r, i) =>
          i === histIdx ? { ...r, status: 'stopped' as const } : r,
        ),
      };
      return { chats: s.chats.map((c, i) => (i === idx ? next : c)) };
    }),

  reset: () =>
    set({ chats: [], activeChatId: null, trackingToChat: {} }),
}));
