/**
 * Reverse-chronological list of all receipts for the selected node.
 *
 * Reads from useReceiptsStore(s => s.byNode.get(node.uuid)).
 * Renders a list of ReceiptCard components with pin checkboxes (max 2).
 * Empty state if no receipts yet.
 *
 * NOTE: This component only renders the list. The receipt-event subscription
 * is mounted at AppShell (NOT here) — see AppShell.tsx. This keeps the
 * subscription alive across tab switches.
 */

import { useReceiptsStore, type Receipt } from '@/store/receipts';
import { ReceiptCard } from './ReceiptCard';
import type { ContractNode } from '@/ipc/types';

interface ReceiptHistoryTabProps {
  node: ContractNode | null;
}

const EMPTY_RECEIPTS: Receipt[] = [];

export function ReceiptHistoryTab({ node }: ReceiptHistoryTabProps) {
  const receipts = useReceiptsStore((s) =>
    node?.uuid ? (s.byNode.get(node.uuid) ?? EMPTY_RECEIPTS) : EMPTY_RECEIPTS,
  );
  const pinned = useReceiptsStore((s) => s.pinned);
  const pinnedCount = pinned.filter(Boolean).length;

  if (!node) {
    return (
      <div className="flex-1 flex items-center justify-center py-8">
        <span className="text-xs text-muted-foreground">Select a node to see receipts</span>
      </div>
    );
  }

  if (receipts.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-8 gap-2">
        <span className="text-xs text-muted-foreground">No receipts yet</span>
        <span className="text-[11px] text-muted-foreground/60">
          Run an agent on this node to generate a receipt
        </span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Pin count indicator */}
      {pinnedCount > 0 && (
        <div className="px-3 py-1.5 border-b border-border/40 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            {pinnedCount === 1
              ? '1 pinned — pin one more to compare'
              : '2 pinned — switch to comparison view'}
          </span>
          {pinnedCount > 0 && (
            <button
              type="button"
              onClick={() => useReceiptsStore.getState().clearPins()}
              className="text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors"
            >
              Clear pins
            </button>
          )}
        </div>
      )}

      {/* Scrollable receipt list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-2">
        {receipts.map((receipt) => (
          <ReceiptCard key={receipt.id} receipt={receipt} />
        ))}
      </div>
    </div>
  );
}
