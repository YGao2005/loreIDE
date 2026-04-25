/**
 * Phase 8 Plan 08-02 — Rollup IPC wrappers.
 *
 * Mirrors the ipc/drift.ts pattern (Plan 07-03):
 *   - listRollupStates: seeds useRollupStore on app boot (invoke once, hydrate)
 *   - subscribeRollupChanged: streams rollup:changed events into the store
 *
 * AppShell uses BOTH: seed-on-mount + subscribe-to-events.
 * Removing either path reintroduces the mount race (first event may fire
 * before React's effect runs and subscribes — Plan 07-03 lineage).
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/** Row shape returned by the list_rollup_states Rust command. */
export interface RollupStateRow {
  node_uuid: string;
  state: string;
}

/** Payload emitted by compute_rollup_and_emit on rollup:changed. */
export interface RollupChangedPayload {
  uuid: string;
  state: string;
  generation: number;
}

/**
 * Fetch all current rollup states from rollup_derived.
 * Returns a snapshot that can be passed to useRollupStore.getState().hydrate().
 */
export async function listRollupStates(): Promise<RollupStateRow[]> {
  return invoke<RollupStateRow[]>('list_rollup_states');
}

/**
 * Subscribe to the Rust rollup:changed event stream.
 * Returns an unlisten handle — caller owns cleanup.
 * Mount exactly once at AppShell (mirrors subscribeDriftChanged in ipc/drift.ts).
 */
export function subscribeRollupChanged(
  handler: (payload: RollupChangedPayload) => void,
): Promise<UnlistenFn> {
  return listen<RollupChangedPayload>('rollup:changed', (event) => {
    handler(event.payload);
  });
}
