import { invoke } from '@tauri-apps/api/core';

export interface ChatDecisionAnchor {
  file: string;
  line_start: number;
  line_end: number;
  kind: 'code' | 'diff';
  ord: number;
}

export interface ChatDecisionRow {
  uuid: string;
  chat_id: string | null;
  tracking_id: string | null;
  decision: string;
  rationale: string;
  created_at: string;
  anchors: ChatDecisionAnchor[];
}

export interface CodeRegion {
  line_start: number;
  line_end: number;
  total_lines: number;
  text: string;
}

export async function listChatDecisions(filter: {
  chatId?: string | null;
  trackingId?: string | null;
}): Promise<ChatDecisionRow[]> {
  return invoke<ChatDecisionRow[]>('list_chat_decisions', {
    chatId: filter.chatId ?? null,
    trackingId: filter.trackingId ?? null,
  });
}

export async function readCodeRegion(
  file: string,
  lineStart: number,
  lineEnd: number,
): Promise<CodeRegion> {
  return invoke<CodeRegion>('read_code_region', {
    file,
    lineStart,
    lineEnd,
  });
}
