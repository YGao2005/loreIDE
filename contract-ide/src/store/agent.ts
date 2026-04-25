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
 */

import { create } from 'zustand';

export type AgentRunStatus = 'idle' | 'running' | 'complete' | 'error';

export interface AgentRun {
  trackingId: string;
  scopeUuid: string | null;
  status: AgentRunStatus;
  /** Raw JSONL lines from agent:stream events — each element is one stdout line. */
  streamBuffer: string[];
  startedAt: string;
}

interface AgentStore {
  current: AgentRun | null;
  /** Start a new run — clears any previous run state. */
  start: (trackingId: string, scopeUuid: string | null) => void;
  /** Append one stdout line to the active run's stream buffer. */
  appendStream: (line: string) => void;
  /** Mark run complete or errored based on exit code. */
  complete: (code: number | null) => void;
  /** Reset to idle state (user dismisses completed run, or new repo opened). */
  reset: () => void;
}

export const useAgentStore = create<AgentStore>((set) => ({
  current: null,

  start: (trackingId, scopeUuid) =>
    set({
      current: {
        trackingId,
        scopeUuid,
        status: 'running',
        streamBuffer: [],
        startedAt: new Date().toISOString(),
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
