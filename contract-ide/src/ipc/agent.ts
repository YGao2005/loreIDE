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
}

export async function runAgent(
  prompt: string,
  scopeUuid: string | null,
  options: RunAgentOptions = {},
): Promise<string> {
  return invoke<string>('run_agent', {
    prompt,
    scope_uuid: scopeUuid,
    model: options.model,
    effort: options.effort,
  });
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
