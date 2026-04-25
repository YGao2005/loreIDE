/**
 * IPC wrappers for substrate-state reads.
 *
 * Two layers:
 *   - Phase 11 Plan 05: footer counter (`getTotalCount` via `get_total_substrate_count`).
 *   - Phase 13 Plan 01: per-atom state map for canvas coloring
 *     (`getSubstrateStatesForCanvas`, `getSubstrateNodeDetail`).
 *
 * Both surface defensive impls — if `substrate_nodes` is missing or empty, the
 * Rust commands return `0` / `[]` / `null` so the app boots cleanly even before
 * the distiller has populated anything.
 */

import { invoke } from '@tauri-apps/api/core';
import type { SubstrateNodeState } from '@/store/substrate';

export const ipcSubstrate = {
  getTotalCount: (): Promise<number> => invoke<number>('get_total_substrate_count'),
};

/**
 * Wire-shape returned by `get_substrate_states_for_canvas` and `get_substrate_node_detail`.
 *
 * Mapped from the Rust `substrate_nodes` row:
 *   - `kind`           ← `node_type`
 *   - `name`           ← first-line of `text` (cheap label for chips)
 *   - `summary`        ← full `text`
 *   - `state`          ← derived from `intent_drift_state` + `invalid_at` (see substrate.rs)
 *   - `session_id`     ← `source_session_id`
 *   - `turn_ref`       ← `source_turn_ref` stringified
 *   - `verbatim_quote` ← `source_quote`
 *   - `actor`          ← `source_actor`
 *   - `confidence`     ← `confidence`
 */
export interface SubstrateNodeSummary {
  uuid: string;
  kind:
    | 'constraint'
    | 'decision'
    | 'open_question'
    | 'resolved_question'
    | 'attempt'
    | 'contract';
  state: SubstrateNodeState;
  name: string;
  summary: string;
  session_id: string | null;
  turn_ref: string | null;
  verbatim_quote: string | null;
  actor: string | null;
  confidence: string | null;
}

/**
 * Hydrate the per-uuid substrate state map for canvas coloring.
 *
 * Returns one entry per current-truth substrate node. Anchored uuids (the
 * contract atoms each substrate node speaks to) are looked up in
 * `getSubstrateStatesForCanvas`'s implementation — for v1 we just hand the
 * caller substrate-node uuids; AppShell maps state per anchored uuid.
 *
 * Phase 11 may not have populated the table yet — defensive impl returns [].
 */
export async function getSubstrateStatesForCanvas(): Promise<SubstrateNodeSummary[]> {
  return invoke<SubstrateNodeSummary[]>('get_substrate_states_for_canvas');
}

/**
 * Fetch a single substrate node by uuid (consumed by Phase 13 plans 13-04 / 13-05
 * chip detail panels). Returns null if the uuid isn't present.
 */
export async function getSubstrateNodeDetail(
  uuid: string,
): Promise<SubstrateNodeSummary | null> {
  return invoke<SubstrateNodeSummary | null>('get_substrate_node_detail', { uuid });
}
