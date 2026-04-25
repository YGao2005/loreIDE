import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

export type McpStatus = 'unknown' | 'running' | 'stopped';

export interface McpStatusEvent {
  status: McpStatus;
  reason?: string;
}

export async function subscribeMcpStatus(
  onChange: (event: McpStatusEvent) => void,
): Promise<UnlistenFn> {
  return listen<McpStatusEvent>('mcp:status', (tauriEvent) => {
    onChange(tauriEvent.payload);
  });
}

export async function getMcpStatus(): Promise<McpStatus> {
  const raw = await invoke<string>('get_mcp_status');
  return (['unknown', 'running', 'stopped'].includes(raw) ? raw : 'unknown') as McpStatus;
}
