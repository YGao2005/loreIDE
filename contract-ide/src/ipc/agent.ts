/**
 * IPC wrappers for the agent runner (08-04a Rust commands).
 *
 * Pattern mirrors ipc/drift.ts + ipc/rollup.ts:
 *   - invoke wrappers return typed results directly
 *   - subscribe* wrappers return UnlistenFn (caller owns cleanup)
 *
 * AppShell mounts subscribeAgentStream + subscribeAgentComplete ONCE at
 * boot (NOT per-tab) so the subscription survives tab unmount cycles.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

// ---------------------------------------------------------------------------
// Event payload shapes (mirrors Rust agent.rs serde_json::json! shapes)
// ---------------------------------------------------------------------------

export interface AgentStreamPayload {
  tracking_id: string;
  line: string;
  is_stderr: boolean;
  session_id_known: boolean;
}

export interface AgentCompletePayload {
  tracking_id: string;
  code: number | null;
  wall_time_ms: number;
  /** Claude session id captured from the run's stream. Pass back as
   * `resumeSessionId` on the next turn to continue the conversation. */
  session_id?: string | null;
}

// ---------------------------------------------------------------------------
// Invoke wrappers
// ---------------------------------------------------------------------------

/**
 * Spawn a claude CLI agent run scoped to a node.
 *
 * Returns the tracking_id immediately — the run streams in the background
 * via agent:stream events and completes via agent:complete + receipt:created.
 *
 * scope_uuid must be derived from useGraphStore(s => s.selectedNodeUuid)
 * (W4 — selectedNodeUuid IS the currently-zoomed node; the graph store
 * does NOT expose a separate currentZoomedNodeUuid field).
 *
 * Latency tuning (optional):
 *   model — claude alias ("haiku" | "sonnet" | "opus") or full id. Defaults
 *           to "haiku" (DEFAULT_AGENT_MODEL in agent.rs) for fast chat turns.
 *   effort — claude `--effort` knob ("low" | "medium" | "high" | "xhigh" |
 *            "max"). Surfaced equivalent of thinking-budget. Defaults to
 *            "low" for chat. Bump for harder questions.
 */
export interface RunAgentOptions {
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** When set, claude resumes the prior session (--resume) and treats `prompt`
   * as the next user turn. The Rust side skips scope assembly in this case
   * since the prior turns already injected the context — UNLESS
   * `previousScopeUuid` differs from `scopeUuid`, in which case the new scope
   * gets re-injected so the agent sees the user's mid-chat focus shift. */
  resumeSessionId?: string | null;
  /** Scope used on the prior turn in this chat (null on the first turn). When
   * combined with `resumeSessionId`, lets the Rust runner detect a canvas
   * focus shift and re-inject the new scope context. */
  previousScopeUuid?: string | null;
}

export async function runAgent(
  prompt: string,
  scopeUuid: string | null,
  options: RunAgentOptions = {},
): Promise<string> {
  // Tauri 2 converts JS camelCase keys → Rust snake_case params automatically.
  // Sending `scope_uuid` (snake_case) here would NOT map to the Rust
  // `scope_uuid` parameter — Tauri expects `scopeUuid` from JS. Mismatch
  // silently drops the value (Rust receives None).
  // Treat empty / whitespace resume ids as absent — claude --resume errors
  // out hard on empty values; Rust also validates JSONL existence so a
  // dangling id just degrades to a fresh session instead of failing.
  const rawResume = options.resumeSessionId;
  const resumeSessionId =
    typeof rawResume === 'string' && rawResume.trim() !== ''
      ? rawResume
      : undefined;
  return invoke<string>('run_agent', {
    prompt,
    scopeUuid,
    model: options.model,
    effort: options.effort,
    resumeSessionId,
    previousScopeUuid: options.previousScopeUuid ?? undefined,
  });
}

/** Send SIGTERM to a running agent. Returns true if a child was found and
 * killed, false if the run had already completed or wasn't tracked. The
 * normal `agent:complete` pipeline still fires (with non-zero exit code). */
export async function stopAgent(trackingId: string): Promise<boolean> {
  return invoke<boolean>('stop_agent', { trackingId });
}

// ---------------------------------------------------------------------------
// Event subscriptions
// ---------------------------------------------------------------------------

/**
 * Subscribe to agent:stream events from the Rust runner.
 * Returns UnlistenFn — caller must call it on unmount.
 * Mount ONCE at AppShell, NOT per-tab.
 */
export async function subscribeAgentStream(
  handler: (payload: AgentStreamPayload) => void,
): Promise<UnlistenFn> {
  return listen<AgentStreamPayload>('agent:stream', (event) => {
    handler(event.payload);
  });
}

/**
 * Subscribe to agent:complete events.
 * Returns UnlistenFn — caller must call it on unmount.
 * Mount ONCE at AppShell, NOT per-tab.
 */
export async function subscribeAgentComplete(
  handler: (payload: AgentCompletePayload) => void,
): Promise<UnlistenFn> {
  return listen<AgentCompletePayload>('agent:complete', (event) => {
    handler(event.payload);
  });
}
