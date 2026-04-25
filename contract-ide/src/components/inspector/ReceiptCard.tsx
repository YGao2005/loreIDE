/**
 * Single receipt summary card.
 *
 * Shows: ts (relative + absolute on hover), input_tokens, output_tokens,
 * tool_call_count, estimated_cost_usd ($X.XX), wall_time_ms (humanized),
 * nodes_touched count, parse_status badge (muted "mock" when FallbackMock —
 * never hidden per spec).
 *
 * "Pin to compare" button → useReceiptsStore.togglePin(receipt.id).
 * When already pinned, shows "Unpin" text.
 */

import { useReceiptsStore } from '@/store/receipts';
import type { Receipt } from '@/store/receipts';
import { cn } from '@/lib/utils';

interface ReceiptCardProps {
  receipt: Receipt;
}

/** Format a number with comma separators. */
function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

/** Humanize wall time: <1000ms → Nms, >=1000ms → N.Ns, >=60000ms → Nm Ns */
function humanizeMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

/** Relative timestamp: "2m ago", "1h ago", "just now". */
function relativeTs(iso: string | null): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return d.toLocaleDateString();
}

/** Count nodes_touched JSON array. Returns 0 on parse error. */
function countNodesTouched(json: string | null): number {
  if (!json) return 0;
  try {
    const arr = JSON.parse(json) as unknown[];
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

export function ReceiptCard({ receipt }: ReceiptCardProps) {
  const pinned = useReceiptsStore((s) => s.pinned);
  const isPinned = pinned[0] === receipt.id || pinned[1] === receipt.id;

  const handleTogglePin = () => {
    useReceiptsStore.getState().togglePin(receipt.id);
  };

  const isMock = receipt.parse_status === 'fallback_mock';
  const nodesTouched = countNodesTouched(receipt.nodes_touched);
  const tsDisplay = relativeTs(receipt.started_at ?? receipt.created_at);
  const tsAbsolute = receipt.started_at
    ? new Date(receipt.started_at).toLocaleString()
    : receipt.created_at
      ? new Date(receipt.created_at).toLocaleString()
      : '–';

  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2.5 text-xs flex flex-col gap-1.5 transition-colors',
        isPinned
          ? 'border-teal-400/60 bg-teal-50/10'
          : 'border-border/60 bg-muted/20 hover:bg-muted/40',
      )}
    >
      {/* Header row: timestamp + parse status badge */}
      <div className="flex items-center gap-2">
        <span
          className="text-muted-foreground font-mono"
          title={tsAbsolute}
        >
          {tsDisplay}
        </span>
        {isMock && (
          <span className="ml-auto text-[10px] rounded px-1.5 py-0.5 bg-muted text-muted-foreground/70 border border-border/40">
            mock
          </span>
        )}
      </div>

      {/* Metrics row */}
      <div className="flex items-center gap-3 font-mono text-foreground/80">
        <span title="Input tokens">{fmt(receipt.input_tokens)} in</span>
        <span className="text-muted-foreground/40">·</span>
        <span title="Output tokens">{fmt(receipt.output_tokens)} out</span>
        <span className="text-muted-foreground/40">·</span>
        <span title="Tool calls">{fmt(receipt.tool_call_count)} tools</span>
      </div>

      {/* Cost + wall time + nodes touched */}
      <div className="flex items-center gap-3 text-muted-foreground">
        <span title="Estimated cost">
          ${receipt.estimated_cost_usd.toFixed(4)}
        </span>
        {receipt.wall_time_ms != null && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span title="Wall time">{humanizeMs(receipt.wall_time_ms)}</span>
          </>
        )}
        {nodesTouched > 0 && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span title="Nodes affected">{nodesTouched} node{nodesTouched !== 1 ? 's' : ''}</span>
          </>
        )}
      </div>

      {/* Pin to compare button */}
      <div className="flex justify-end pt-0.5">
        <button
          type="button"
          onClick={handleTogglePin}
          className={cn(
            'text-[10px] px-2 py-0.5 rounded-md transition-colors',
            isPinned
              ? 'bg-teal-100/30 text-teal-600 hover:bg-teal-100/50'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted',
          )}
        >
          {isPinned ? 'Unpin' : 'Pin to compare'}
        </button>
      </div>
    </div>
  );
}
