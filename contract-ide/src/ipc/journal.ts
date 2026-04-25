/**
 * Phase 8 Plan 08-03 — Journal IPC wrapper.
 *
 * Reads .contracts/journal/<session>.jsonl files written by the PostToolUse
 * hook (Pass 1 — intent record). Consumed by 08-06's reconcile panel.
 */

import { invoke } from '@tauri-apps/api/core';

export interface JournalEntry {
  schema_version: number;
  ts: string;
  session_id: string;
  tool: string;
  file: string;
  affected_uuids: string[];
  intent: string;
}

export interface ListJournalOpts {
  uuid?: string;
  since_ts?: string;
  limit?: number;
}

export async function listJournalEntries(
  opts: ListJournalOpts = {},
): Promise<JournalEntry[]> {
  return await invoke<JournalEntry[]>(
    'list_journal_entries',
    opts as unknown as Record<string, unknown>,
  );
}
