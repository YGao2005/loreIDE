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
  /**
   * Phase 15 Plan 02 (folded from 15-03): pre-fill for RefineRuleEditor.
   * Only populated by `get_substrate_node_detail`; canvas bulk-read always returns null.
   */
  applies_when: string | null;
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

/**
 * Phase 13 Plan 03 — Cmd+P semantic intent palette wire shape (SUB-08).
 *
 * Unified result envelope merging contract FTS5 hits (nodes_fts) and substrate
 * hits (substrate_nodes_fts + LIKE fallback). Mirrors `IntentSearchHit` in
 * `src-tauri/src/commands/substrate.rs`.
 *
 * Field semantics:
 *   - `kind`: `'flow' | 'contract' | 'constraint' | 'decision' |
 *     'open_question' | 'resolved_question' | 'attempt'`. Drives the navigation
 *     branch in IntentPalette's `handleSelect`.
 *   - `level`: L0..L4 for contract hits; null for substrate node hits.
 *   - `state`: substrate visual state ('fresh' | 'intent_drifted' | 'superseded')
 *     for substrate hits; null for contracts.
 *   - `parent_uuid`: contract hit → contract.parent_uuid (used for L4
 *     atom-hit landing); substrate hit → first anchored uuid (atom the
 *     substrate node speaks to).
 *   - `score`: positive number, higher = better. Contracts get BM25-derived
 *     scores; substrate hits get a flat 0.5 so contracts dominate the top.
 */
export interface IntentSearchHit {
  uuid: string;
  kind: string;
  /**
   * Underlying `nodes.kind` for contract hits — `'UI' | 'API' | 'lib' | 'data' |
   * 'external' | 'job' | 'cron' | 'event' | 'flow'`. Null for substrate hits
   * (their `kind` field already encodes the substrate node type). Drives the
   * UI-screen vs backend-node routing branch in IntentPalette.
   */
  node_kind: string | null;
  level: string | null;
  name: string;
  summary: string;
  state: string | null;
  parent_uuid: string | null;
  score: number;
}

/**
 * Cmd+P palette retrieval (SUB-08).
 *
 * Aggregates contract FTS5 + substrate retrieval into a single ranked list.
 * The Rust side handles OR-tokenization (so natural-language queries like
 * "account settings danger" don't return zero hits under FTS5 default AND).
 *
 * Defensive: empty/whitespace-only queries return [].
 *
 * Phase 15 Plan 02 (TRUST-01): `kindFilter` parameter added.
 *   - `undefined` / `'all'` → existing behaviour (both contract FTS5 + substrate).
 *   - `'substrate'`         → substrate-only; used by the Substrate chip.
 *   - `'contracts'`         → contracts-only.
 *   - `'code'`              → contracts-only for now (TODO: Phase 16 code filter).
 *
 * Backward-compatible: existing call sites without `kindFilter` continue to
 * behave identically (Rust receives None → "all" mode).
 */
export async function findSubstrateByIntent(
  query: string,
  limit = 10,
  kindFilter?: 'substrate' | 'contracts' | 'code' | 'all',
): Promise<IntentSearchHit[]> {
  return invoke<IntentSearchHit[]>('find_substrate_by_intent', {
    query,
    limit,
    kindFilter,
  });
}
