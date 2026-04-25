/**
 * Side-by-side receipt comparison view.
 *
 * Layout (top to bottom — SC 4 invariant: DeltaBanner LEADS):
 *   1. <DeltaBanner> FIRST (full width, >= 28px, three rows reserved)
 *   2. View mode toggle: [Absolute stacked] [Percentage delta]
 *      Default: percentage-delta (in-IDE developer dogfood per CONTEXT.md)
 *   3. Side-by-side raw-number table (secondary detail, smaller text)
 *   4. Per-receipt metadata (ts, model, session_id, raw_jsonl_path)
 *
 * Receives two pinned Receipt objects. Assumes caller guarantees exactly 2
 * pinned (ReceiptsTab checks before rendering).
 */

import { useState } from 'react';
import DeltaBanner from './DeltaBanner';
import type { Receipt } from '@/store/receipts';
import { useReceiptsStore } from '@/store/receipts';
import { cn } from '@/lib/utils';

interface ReceiptComparisonProps {
  a: Receipt;
  b: Receipt;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function humanizeMs(ms: number | null): string {
  if (ms == null) return '–';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

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

/**
 * Determine which receipt is the "Contract IDE" run and which is "Bare Claude".
 * Heuristic: the receipt with FEWER tokens is likely the scoped-IDE run.
 * Falls back to temporal order (earlier = first = contractIde, later = bareClaude).
 */
function assignRoles(a: Receipt, b: Receipt): { contractIde: Receipt; bareClaude: Receipt } {
  const totalA = a.input_tokens + a.output_tokens;
  const totalB = b.input_tokens + b.output_tokens;
  if (totalA <= totalB) return { contractIde: a, bareClaude: b };
  return { contractIde: b, bareClaude: a };
}

export function ReceiptComparison({ a, b }: ReceiptComparisonProps) {
  const [viewMode, setViewMode] = useState<'absolute-stacked' | 'percentage-delta'>(
    'percentage-delta',
  );

  const { contractIde, bareClaude } = assignRoles(a, b);

  // Phase 13 placeholder: rulesHonored is always N/A until substrate verifier ships.
  const bannerProps = {
    contractIde: {
      tokens: contractIde.input_tokens + contractIde.output_tokens,
      toolCalls: contractIde.tool_call_count,
      rulesHonored: 'N/A',
    },
    bareClaude: {
      tokens: bareClaude.input_tokens + bareClaude.output_tokens,
      toolCalls: bareClaude.tool_call_count,
      rulesHonored: 'N/A',
    },
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto px-3 py-3 gap-3">
      {/* 1. DeltaBanner FIRST (SC 4 invariant) */}
      <DeltaBanner
        contractIde={bannerProps.contractIde}
        bareClaude={bannerProps.bareClaude}
        view={viewMode}
      />

      {/* 2. View toggle + unpin */}
      <div className="flex items-center gap-2">
        <div className="flex rounded-md border border-border/60 overflow-hidden text-[11px]">
          <button
            type="button"
            onClick={() => setViewMode('absolute-stacked')}
            className={cn(
              'px-2.5 py-1 transition-colors',
              viewMode === 'absolute-stacked'
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Absolute
          </button>
          <button
            type="button"
            onClick={() => setViewMode('percentage-delta')}
            className={cn(
              'px-2.5 py-1 transition-colors border-l border-border/60',
              viewMode === 'percentage-delta'
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            % Delta
          </button>
        </div>
        <button
          type="button"
          onClick={() => useReceiptsStore.getState().clearPins()}
          className="ml-auto text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors"
        >
          Clear comparison
        </button>
      </div>

      {/* 3. Side-by-side raw-number table */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        {([contractIde, bareClaude] as const).map((r, i) => (
          <div
            key={r.id}
            className="rounded-md border border-border/40 bg-muted/20 px-2.5 py-2 flex flex-col gap-1"
          >
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
              {i === 0 ? 'Contract IDE' : 'Bare Claude'}
            </div>
            <div className="font-mono text-foreground/80">
              {fmt(r.input_tokens)} in · {fmt(r.output_tokens)} out
            </div>
            <div className="font-mono text-muted-foreground">
              {fmt(r.tool_call_count)} tool calls
            </div>
            <div className="font-mono text-muted-foreground">
              ${r.estimated_cost_usd.toFixed(4)} · {humanizeMs(r.wall_time_ms)}
            </div>
            {r.parse_status === 'fallback_mock' && (
              <div className="text-[10px] text-muted-foreground/60 border border-border/40 rounded px-1.5 py-0.5 w-fit mt-1">
                mock
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 4. Per-receipt metadata */}
      <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
        {([contractIde, bareClaude] as const).map((r, i) => (
          <div key={r.id} className="flex flex-col gap-0.5">
            <div className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wide">
              {i === 0 ? 'Contract IDE' : 'Bare Claude'}
            </div>
            <div title={r.started_at ?? r.created_at}>
              {relativeTs(r.started_at ?? r.created_at)}
            </div>
            <div className="font-mono text-[10px] truncate" title={r.session_id}>
              {r.session_id.slice(0, 8)}…
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
