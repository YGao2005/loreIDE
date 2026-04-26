/**
 * Zustand store for the active agent run.
 *
 * Tracks the in-flight run (at most one at a time in Phase 8; Phase 11 may
 * allow multiple), the streaming output buffer, run status, and the
 * tracking_id returned by the Rust run_agent command.
 *
 * AppShell mounts subscribeAgentStream + subscribeAgentComplete at boot and
 * calls appendStream / complete here. ChatPanel reads from this store to
 * render the streaming pane.
 *
 * Delegate kickoff: when the run is launched via the Inspector's Delegate
 * button, the run is seeded with a `kickoff` payload (the approved structured
 * plan + assembled prompt). ChatStream renders a KickoffCard in place of the
 * user-prompt bubble so the chat scrollback reads "[plan card] → [agent stream]"
 * as a continuous timeline.
 */

import { create } from 'zustand';
import type { StructuredPlan } from '../ipc/delegate';

export type AgentRunStatus = 'idle' | 'running' | 'complete' | 'error';

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
  startedAt: string;
  /** Set when the run was launched via the Delegate button — renders a
   * structured plan card at the top of the run instead of the prompt bubble. */
  kickoff?: KickoffPayload | null;
}

interface AgentStore {
  current: AgentRun | null;
  /** Start a new run from the chat panel — clears any previous run state. */
  start: (trackingId: string, scopeUuid: string | null, prompt: string) => void;
  /** Start a new run from the Delegate button — seeds a structured kickoff
   * payload (rendered as a card in chat) and clears the prompt-bubble field. */
  startWithKickoff: (args: {
    trackingId: string;
    scopeUuid: string | null;
    kickoff: KickoffPayload;
  }) => void;
  /** Append one stdout line to the active run's stream buffer. */
  appendStream: (line: string) => void;
  /** Mark run complete or errored based on exit code. */
  complete: (code: number | null) => void;
  /** Reset to idle state (user dismisses completed run, or new repo opened). */
  reset: () => void;
}

export const useAgentStore = create<AgentStore>((set) => ({
  current: null,

  start: (trackingId, scopeUuid, prompt) =>
    set({
      current: {
        trackingId,
        scopeUuid,
        prompt,
        status: 'running',
        streamBuffer: [],
        startedAt: new Date().toISOString(),
        kickoff: null,
      },
    }),

  startWithKickoff: ({ trackingId, scopeUuid, kickoff }) =>
    set({
      current: {
        trackingId,
        scopeUuid,
        prompt: '',
        status: 'running',
        streamBuffer: [],
        startedAt: new Date().toISOString(),
        kickoff,
      },
    }),

  appendStream: (line) =>
    set((s) => {
      if (!s.current) return s;
      return {
        current: {
          ...s.current,
          streamBuffer: [...s.current.streamBuffer, line],
        },
      };
    }),

  complete: (code) =>
    set((s) => {
      if (!s.current) return s;
      return {
        current: {
          ...s.current,
          status: code === 0 ? 'complete' : 'error',
        },
      };
    }),

  reset: () => set({ current: null }),
}));
