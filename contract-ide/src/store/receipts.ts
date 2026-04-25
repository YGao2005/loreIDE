/**
 * Zustand store for per-node receipt history + pinned-comparison set.
 *
 * Receipt field names use snake_case to match the Rust IPC layer's
 * serde_json::json!({...}) output (no rename_all = "camelCase" applied —
 * confirmed against list_receipts_for_node in commands/receipts.rs).
 *
 * AppShell wires subscribeReceiptCreated → addReceipt at boot.
 * ReceiptsTab hydrates from listReceiptsForNode on node selection.
 */

import { create } from 'zustand';

/** Receipt shape as returned by list_receipts_for_node + receipt:created event. */
export interface Receipt {
  id: string;
  session_id: string;
  transcript_path: string | null;
  started_at: string | null;
  finished_at: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  tool_call_count: number;
  /** JSON array string of node UUIDs, or null. */
  nodes_touched: string | null;
  estimated_cost_usd: number;
  raw_summary: string | null;
  raw_jsonl_path: string | null;
  /** "ok" | "fallback_mock" */
  parse_status: string | null;
  wall_time_ms: number | null;
  created_at: string;
}

interface ReceiptsStore {
  /** Receipts keyed by node UUID. Each list is reverse-chronological (most recent first). */
  byNode: Map<string, Receipt[]>;
  /**
   * Pinned receipt IDs for side-by-side comparison (max 2).
   * FIFO eviction: adding a 3rd pin removes the 1st.
   */
  pinned: [string | undefined, string | undefined];

  /** Hydrate a node's full receipt list from listReceiptsForNode IPC. */
  hydrate: (nodeUuid: string, receipts: Receipt[]) => void;
  /** Prepend a new receipt from the receipt:created event. */
  addReceipt: (receipt: Receipt) => void;
  /** Toggle pin state for a receipt ID. FIFO eviction at the 3rd pin. */
  togglePin: (receiptId: string) => void;
  /** Clear all pinned receipts. */
  clearPins: () => void;
}

export const useReceiptsStore = create<ReceiptsStore>((set) => ({
  byNode: new Map(),
  pinned: [undefined, undefined],

  hydrate: (nodeUuid, receipts) =>
    set((s) => {
      const next = new Map(s.byNode);
      // Ensure reverse-chrono order (caller should sort, but sort defensively).
      const sorted = [...receipts].sort((a, b) => {
        const ta = a.started_at ?? a.created_at;
        const tb = b.started_at ?? b.created_at;
        return tb.localeCompare(ta);
      });
      next.set(nodeUuid, sorted);
      return { byNode: next };
    }),

  addReceipt: (receipt) =>
    set((s) => {
      // Insert at the front for each node UUID mentioned in nodes_touched,
      // plus the receipt itself (which may have no nodes_touched).
      const next = new Map(s.byNode);

      const affectedUuids: string[] = [];
      if (receipt.nodes_touched) {
        try {
          const parsed = JSON.parse(receipt.nodes_touched) as string[];
          if (Array.isArray(parsed)) affectedUuids.push(...parsed);
        } catch {
          // malformed nodes_touched JSON — ignore
        }
      }

      // If no node association, still store under a synthetic key so the receipt
      // isn't lost — callers can look it up by receipt.id if needed.
      if (affectedUuids.length === 0) {
        // No node association yet — skip indexing (receipt:created fires even for
        // mock receipts with no scope); the receipt will appear when ReceiptsTab
        // calls listReceiptsForNode + hydrate after agent:complete.
        return { byNode: next };
      }

      for (const uuid of affectedUuids) {
        const existing = next.get(uuid) ?? [];
        // Deduplicate: don't add twice if receipt:created fires multiple times.
        if (existing.some((r) => r.id === receipt.id)) continue;
        next.set(uuid, [receipt, ...existing]);
      }

      return { byNode: next };
    }),

  togglePin: (receiptId) =>
    set((s) => {
      const [a, b] = s.pinned;

      // Already pinned — unpin.
      if (a === receiptId) return { pinned: [b, undefined] };
      if (b === receiptId) return { pinned: [a, undefined] };

      // Not pinned — FIFO eviction: if both slots full, drop the first (oldest).
      if (a === undefined) return { pinned: [receiptId, undefined] };
      if (b === undefined) return { pinned: [a, receiptId] };

      // Both slots full: FIFO — evict slot[0], shift slot[1] to slot[0], add new to slot[1].
      return { pinned: [b, receiptId] };
    }),

  clearPins: () => set({ pinned: [undefined, undefined] }),
}));

/**
 * Lookup a single receipt by ID across all byNode lists.
 * Returns null if not found.
 */
export function getReceiptById(store: ReceiptsStore, id: string): Receipt | null {
  for (const receipts of store.byNode.values()) {
    const found = receipts.find((r) => r.id === id);
    if (found) return found;
  }
  return null;
}
