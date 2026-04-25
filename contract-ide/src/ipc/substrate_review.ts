/**
 * IPC wrappers for the substrate review queue.
 *
 * Two writers populate `substrate_nodes` with `published_at = NULL`:
 *   1. Post-session distiller (Rust, `distiller/pipeline.rs`)
 *   2. Live agent capture via the MCP tool `record_substrate_rule`
 *
 * Both surface through the same chat banner. Approve flips `published_at`,
 * making the row visible to retrieval / MCP read tools / the canvas. Deny
 * deletes the row outright (the agent may capture it again later, which
 * lands back in the queue under the same idempotent UUID and re-prompts).
 */

import { invoke } from '@tauri-apps/api/core';

export interface PendingSubstrateRow {
  uuid: string;
  node_type: string;
  text: string;
  scope: string | null;
  applies_when: string | null;
  source_quote: string | null;
  source_actor: string | null;
  confidence: string;
  created_at: string;
  /** One-line headline lifted from `text` for the banner row header. */
  name: string;
}

export async function listPendingSubstrate(): Promise<PendingSubstrateRow[]> {
  return invoke<PendingSubstrateRow[]>('list_pending_substrate');
}

export async function approveSubstrate(uuid: string): Promise<void> {
  return invoke<void>('approve_substrate', { uuid });
}

export async function rejectSubstrate(uuid: string): Promise<void> {
  return invoke<void>('reject_substrate', { uuid });
}
