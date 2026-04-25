/**
 * IPC wrappers for the chats lifecycle (multi-tab + History panel).
 *
 * A chat = one logical conversation. Each agent run (turn) within a chat shares
 * the same `claudeSessionId` because follow-up turns spawn claude with --resume.
 * Open tabs = chats with `closedAt: null`; History rows = chats with `closedAt`
 * set. Closing a tab is non-destructive (Cursor model — reopenable).
 *
 * Session content (the assistant stream) lives in the claude session JSONL on
 * disk; reopening a closed chat reconstructs from that file (Phase D —
 * `read_chat_jsonl`). The chat row only stores metadata.
 */

import { invoke } from '@tauri-apps/api/core';

export interface ChatRow {
  id: string;
  name: string;
  scope_uuid: string | null;
  claude_session_id: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface ChatSummary {
  chat_id: string;
  turn_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  last_activity_at: string | null;
}

/** Receipt shape returned by get_chat_receipts — mirrors the JSON object Rust
 * emits. Kept loose (Record-typed) to avoid duplicating the receipts.ts type
 * definitions; each call site projects what it needs. */
export type ChatReceipt = Record<string, unknown>;

export async function createChat(args: {
  scopeUuid?: string | null;
  name?: string | null;
}): Promise<ChatRow> {
  return invoke<ChatRow>('create_chat', {
    scopeUuid: args.scopeUuid ?? null,
    name: args.name ?? null,
  });
}

export async function listOpenChats(): Promise<ChatRow[]> {
  return invoke<ChatRow[]>('list_open_chats');
}

export async function listHistoryChats(args: {
  limit?: number;
  offset?: number;
} = {}): Promise<ChatRow[]> {
  return invoke<ChatRow[]>('list_history_chats', {
    limit: args.limit ?? 50,
    offset: args.offset ?? 0,
  });
}

export async function closeChat(chatId: string): Promise<void> {
  return invoke<void>('close_chat', { chatId });
}

export async function reopenChat(chatId: string): Promise<ChatRow> {
  return invoke<ChatRow>('reopen_chat', { chatId });
}

export async function renameChat(chatId: string, name: string): Promise<void> {
  return invoke<void>('rename_chat', { chatId, name });
}

/** Persist the claude session_id captured in agent:complete to the chat row.
 * Rust guards against clobbering a session_id another turn already wrote. */
export async function updateChatSessionId(
  chatId: string,
  sessionId: string,
): Promise<void> {
  return invoke<void>('update_chat_session_id', { chatId, sessionId });
}

/** Bump updated_at — call after each turn so History sorts by recency. */
export async function touchChat(chatId: string): Promise<void> {
  return invoke<void>('touch_chat', { chatId });
}

export async function deleteChat(chatId: string): Promise<void> {
  return invoke<void>('delete_chat', { chatId });
}

export async function getChatReceipts(chatId: string): Promise<ChatReceipt[]> {
  return invoke<ChatReceipt[]>('get_chat_receipts', { chatId });
}

export async function getChatSummaries(
  chatIds: string[],
): Promise<ChatSummary[]> {
  if (chatIds.length === 0) return [];
  return invoke<ChatSummary[]>('get_chat_summaries', { chatIds });
}

/** One turn reconstructed from a closed chat's session JSONL. */
export interface TurnRecord {
  user_prompt: string;
  stream_lines: string[];
  /** Synthetic tracking id (`replay-<chatId>-<turnIdx>`) — stable for React
   * keys; never collides with live tracking ids since real ones are uuids. */
  tracking_id: string;
}

/** Reconstruct conversation turns from a chat's persisted session JSONL.
 * Returns empty array if the chat has no receipts (never sent to) or the
 * JSONL is missing on disk. The History panel calls this on reopen. */
export async function readChatJsonl(chatId: string): Promise<TurnRecord[]> {
  return invoke<TurnRecord[]>('read_chat_jsonl', { chatId });
}
