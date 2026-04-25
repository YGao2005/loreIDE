/**
 * DeltaBanner — 28px+ banner comparing Contract IDE vs Bare Claude usage.
 *
 * Ships TWO view modes:
 *   - "absolute-stacked" (Beat 2 demo): two rows, monospace, shows both
 *     systems side by side. Exact line format per presentation-script.md § Beat 2:
 *       Contract IDE: ~N,NNN tokens · ~N tool calls · N/5 rules honored
 *       Bare Claude:  ~N,NNN tokens · ~N tool calls · 0/5 rules honored
 *   - "percentage-delta" (developer dogfood): single row summary:
 *       −{N}% tokens · −{N}% tool calls · {rulesHonored} rules honored
 *
 * PHASE 13 FORWARD-COMPAT (Pitfall 9): THREE rows are ALWAYS reserved:
 *   1. tokens
 *   2. tool calls
 *   3. rules honored (N/A placeholder until Phase 13 substrate verifier)
 * The third row renders with muted styling when rulesHonored is "N/A".
 * This reservation ensures Phase 13 cannot cause layout shift.
 *
 * Font: monospace, 28px+ for numerals in absolute-stacked, or the full line
 * in percentage-delta. Separator: · (middle dot, U+00B7).
 */

import { cn } from '@/lib/utils';

export interface DeltaBannerProps {
  contractIde: {
    tokens: number;
    toolCalls: number;
    rulesHonored: string;
  };
  bareClaude: {
    tokens: number;
    toolCalls: number;
    rulesHonored: string;
  };
  view: 'absolute-stacked' | 'percentage-delta';
  className?: string;
}

/** Format a number with comma separators (e.g., 7200 → "7,200"). */
function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * Compute percentage reduction from baseline to new value.
 * Returns e.g. "82" for 82% reduction.
 */
function pctReduction(baseline: number, reduced: number): string {
  if (baseline === 0) return '0';
  const pct = Math.round(((baseline - reduced) / baseline) * 100);
  return Math.max(0, Math.min(100, pct)).toString();
}

export default function DeltaBanner({
  contractIde,
  bareClaude,
  view,
  className,
}: DeltaBannerProps) {
  const isNa = (s: string) => s === 'N/A' || s === '' || s === '0/0';

  if (view === 'absolute-stacked') {
    /**
     * Absolute-stacked view (Beat 2 demo format):
     *
     *   Contract IDE: ~1,400 tokens · ~3 tool calls · 5/5 rules honored
     *   Bare Claude:  ~7,200 tokens · ~22 tool calls · 0/5 rules honored
     *
     * Three rows reserved: [Contract IDE row] [Bare Claude row] [spacer/label row]
     * The third "row" is embedded in each line as the rules-honored field.
     */
    const ideRow =
      `Contract IDE: ~${fmt(contractIde.tokens)} tokens · ` +
      `~${fmt(contractIde.toolCalls)} tool calls · ` +
      `${contractIde.rulesHonored} rules honored`;

    const bareRow =
      `Bare Claude:  ~${fmt(bareClaude.tokens)} tokens · ` +
      `~${fmt(bareClaude.toolCalls)} tool calls · ` +
      `${bareClaude.rulesHonored} rules honored`;

    return (
      <div
        className={cn(
          'w-full rounded-lg bg-muted/60 border border-border/60 px-4 py-3',
          className,
        )}
        data-testid="delta-banner"
        data-view="absolute-stacked"
      >
        {/* Row 1: Contract IDE */}
        <div
          className="font-mono text-[15px] leading-7 text-foreground"
          data-testid="delta-banner-ide-row"
        >
          {ideRow}
        </div>
        {/* Row 2: Bare Claude */}
        <div
          className="font-mono text-[15px] leading-7 text-muted-foreground"
          data-testid="delta-banner-bare-row"
        >
          {bareRow}
        </div>
        {/* Row 3: Phase 13 forward-compat spacer — always at least min-height.
            When rulesHonored = N/A, show a muted explanatory note. */}
        <div
          className={cn(
            'font-mono text-[11px] leading-5',
            isNa(contractIde.rulesHonored)
              ? 'text-muted-foreground/50'
              : 'text-transparent select-none',
          )}
          aria-hidden={!isNa(contractIde.rulesHonored)}
          data-testid="delta-banner-rules-row"
        >
          {isNa(contractIde.rulesHonored)
            ? '· rules-honored rubric available in Phase 13'
            : '\u00a0'}
        </div>
      </div>
    );
  }

  // percentage-delta view (developer dogfood — in-IDE comparison)
  const tokenPct = pctReduction(bareClaude.tokens, contractIde.tokens);
  const toolPct = pctReduction(bareClaude.toolCalls, contractIde.toolCalls);
  const rulesLine = isNa(contractIde.rulesHonored)
    ? 'N/A rules honored'
    : `${contractIde.rulesHonored} rules honored`;

  const summaryRow = `−${tokenPct}% tokens · −${toolPct}% tool calls · ${rulesLine}`;

  return (
    <div
      className={cn(
        'w-full rounded-lg bg-muted/60 border border-border/60 px-4 py-3',
        className,
      )}
      data-testid="delta-banner"
      data-view="percentage-delta"
    >
      {/* Row 1: summary delta line */}
      <div
        className="font-mono text-[15px] leading-7 text-foreground"
        data-testid="delta-banner-pct-row"
      >
        {summaryRow}
      </div>
      {/* Row 2: absolute context (smaller, secondary) */}
      <div className="font-mono text-[11px] leading-5 text-muted-foreground">
        {`Contract IDE: ~${fmt(contractIde.tokens)} tokens · ~${fmt(contractIde.toolCalls)} tool calls`}
      </div>
      {/* Row 3: Phase 13 forward-compat spacer — always reserved */}
      <div
        className={cn(
          'font-mono text-[11px] leading-5',
          isNa(contractIde.rulesHonored)
            ? 'text-muted-foreground/50'
            : 'text-transparent select-none',
        )}
        aria-hidden={!isNa(contractIde.rulesHonored)}
        data-testid="delta-banner-rules-row"
      >
        {isNa(contractIde.rulesHonored)
          ? '· rules-honored rubric available in Phase 13'
          : '\u00a0'}
      </div>
    </div>
  );
}
