import { invoke } from '@tauri-apps/api/core';
import type { ContractNode } from './types';

/**
 * Typed wrapper around the `get_nodes` Rust IPC command.
 *
 * Phase 1 always resolves to `[]` (the backend returns an empty Vec);
 * Phase 2 populates from SQLite. All frontend graph/inspector code must
 * route through this function rather than calling `invoke()` directly —
 * bare `invoke('get_nodes')` returns `any` and defeats the type contract
 * with the Rust side.
 */
export async function getNodes(params?: {
  level?: string;
  parent_uuid?: string;
}): Promise<ContractNode[]> {
  return invoke<ContractNode[]>('get_nodes', params ?? {});
}
