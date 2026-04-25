import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useDriftStore } from '@/store/drift';

/**
 * Payload shape emitted by src-tauri/src/drift/engine.rs (DriftChanged).
 * `#[serde(rename_all = "camelCase")]` is load-bearing — Rust emits
 * `currentCodeHash` not `current_code_hash`.
 */
export interface DriftChangedPayload {
  uuid: string;
  drifted: boolean;
  currentCodeHash: string | null;
  baselineCodeHash: string | null;
}

/**
 * Subscribe to the Rust `drift:changed` event stream. Returns an unlisten
 * handle — caller owns cleanup. Mount exactly once at AppShell.
 */
export async function subscribeDriftChanged(): Promise<() => void> {
  const unlisten = await listen<DriftChangedPayload>('drift:changed', (event) => {
    useDriftStore.getState().setDrifted(event.payload.uuid, event.payload.drifted);
  });
  return unlisten;
}

/** Tauri invoke wrapper for acknowledge_drift (Plan 07-02). */
export async function acknowledgeDrift(uuid: string): Promise<void> {
  await invoke('acknowledge_drift', { uuid });
}
