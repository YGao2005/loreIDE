/**
 * Receipts tab for the Inspector.
 *
 * PROP SIGNATURE PRESERVED (W5): `function ReceiptsTab({ node }: { node: ContractNode | null })`
 * Inspector.tsx calls `<ReceiptsTab node={selectedNode} />` — do NOT change to nodeUuid.
 *
 * Behavior:
 * - On node selection, calls listReceiptsForNode IPC and hydrates the store.
 * - Renders ReceiptHistoryTab (list) when 0 or 1 receipts are pinned.
 * - Renders ReceiptComparison when exactly 2 receipts are pinned.
 *
 * NOTE: The receipt-event subscription is mounted at AppShell (NOT here) so
 * it survives tab switches. This component only hydrates from the DB on mount.
 */

import { useEffect } from 'react';
import type { ContractNode } from '@/ipc/types';
import { listReceiptsForNode } from '@/ipc/receipts';
import { useReceiptsStore, getReceiptById } from '@/store/receipts';
import { ReceiptHistoryTab } from './ReceiptHistoryTab';
import { ReceiptComparison } from './ReceiptComparison';

export default function ReceiptsTab({
  node,
}: {
  node: ContractNode | null;
}) {
  const pinned = useReceiptsStore((s) => s.pinned);
  const byNode = useReceiptsStore((s) => s.byNode);

  // Hydrate receipt list from DB when node changes.
  useEffect(() => {
    if (!node?.uuid) return;
    void listReceiptsForNode(node.uuid)
      .then((rows) => {
        useReceiptsStore.getState().hydrate(node.uuid, rows);
      })
      .catch((e: unknown) => {
        console.warn('[ReceiptsTab] listReceiptsForNode failed:', e);
      });
  }, [node?.uuid]);

  // Clear comparison pins when node changes (stale pins from other node).
  useEffect(() => {
    useReceiptsStore.getState().clearPins();
  }, [node?.uuid]);

  // When exactly 2 receipts pinned, show comparison view.
  // Use byNode from the reactive selector to ensure lookup is fresh.
  if (pinned[0] !== undefined && pinned[1] !== undefined) {
    // Build a temporary store snapshot for getReceiptById lookup.
    const storeSnapshot = { byNode, pinned } as Parameters<typeof getReceiptById>[0];
    const receiptA = getReceiptById(storeSnapshot, pinned[0]);
    const receiptB = getReceiptById(storeSnapshot, pinned[1]);

    if (receiptA && receiptB) {
      return (
        <div className="flex-1 flex flex-col min-h-0">
          <ReceiptComparison a={receiptA} b={receiptB} />
        </div>
      );
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ReceiptHistoryTab node={node} />
    </div>
  );
}
