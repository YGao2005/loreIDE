/**
 * IPC wrappers for the receipt layer (08-04a Rust commands/receipts.rs).
 *
 * Pattern mirrors ipc/drift.ts + ipc/rollup.ts:
 *   - listReceiptsForNode: invoke, returns typed Receipt[]
 *   - subscribeReceiptCreated: returns UnlistenFn (caller owns cleanup)
 *
 * Receipt field names use snake_case — confirmed against
 * commands/receipts.rs list_receipts_for_node and parse_and_persist
 * which both use explicit snake_case keys in their serde_json::json! macros.
 * No #[serde(rename_all = "camelCase")] attribute present.
 *
 * AppShell mounts subscribeReceiptCreated ONCE at boot.
 * ReceiptsTab calls listReceiptsForNode on node selection to hydrate the store.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Receipt } from '@/store/receipts';

// ---------------------------------------------------------------------------
// receipt:created event payload
// ---------------------------------------------------------------------------

/**
 * Payload from the receipt:created Rust event (parse_and_persist).
 * Matches the serde_json::json! shape in commands/receipts.rs.
 *
 * NOTE: This is a subset of the full Receipt — it contains the computed
 * summary fields but not started_at/finished_at/transcript_path etc.
 * The store uses this for real-time updates; listReceiptsForNode provides
 * the full row for ReceiptHistoryTab.
 */
export interface ReceiptCreatedPayload {
  receipt_id: string;
  tracking_id: string;
  session_id: string;
  input_tokens: number;
  output_tokens: number;
  tool_call_count: number;
  estimated_cost_usd: number;
  parse_status: string;
  wall_time_ms: number | null;
  /** JSON array of node UUIDs that were affected. */
  nodes_touched: string[];
}

// ---------------------------------------------------------------------------
// Invoke wrappers
// ---------------------------------------------------------------------------

/**
 * Fetch all receipts for a node UUID, ordered most-recent-first.
 * Returns the full row set from the receipts + receipt_nodes join.
 */
export async function listReceiptsForNode(nodeUuid: string): Promise<Receipt[]> {
  return invoke<Receipt[]>('list_receipts_for_node', { nodeUuid });
}

// ---------------------------------------------------------------------------
// Event subscriptions
// ---------------------------------------------------------------------------

/**
 * Subscribe to receipt:created events.
 * Returns UnlistenFn — caller must call it on unmount.
 * Mount ONCE at AppShell so receipt events survive tab switches.
 */
export async function subscribeReceiptCreated(
  handler: (payload: ReceiptCreatedPayload) => void,
): Promise<UnlistenFn> {
  return listen<ReceiptCreatedPayload>('receipt:created', (event) => {
    handler(event.payload);
  });
}
