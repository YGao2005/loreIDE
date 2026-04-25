/**
 * IPC wrappers for Plan 11-05 substrate footer counter commands.
 *
 * get_total_substrate_count — returns COUNT(*) of current-truth substrate_nodes.
 * Used by SubstrateStatusIndicator on mount (race-resistant seed — mirrors
 * McpStatusIndicator + SessionStatusIndicator seed pattern from Plans 05-01 + 10-04).
 */

import { invoke } from '@tauri-apps/api/core';

export const ipcSubstrate = {
  getTotalCount: (): Promise<number> => invoke<number>('get_total_substrate_count'),
};
