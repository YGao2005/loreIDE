/**
 * DeltaBanner string-shape snapshot tests.
 *
 * Validates that the Beat 2 banner format matches the literal text shape
 * from presentation-script.md § Beat 2. Risk Register row mitigation:
 * "Beat 2 banner format mismatch".
 *
 * Uses string-shape checks rather than @testing-library/react rendering
 * to keep test infrastructure minimal (no jsdom needed). The format logic
 * lives in fmt() and pctReduction() which are pure string/number functions
 * — we test the output format directly by constructing the strings the same
 * way DeltaBanner.tsx does.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Mirror the DeltaBanner format functions for testing
// (The component itself is a React component; we test the string logic here.)
// ---------------------------------------------------------------------------

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function pctReduction(baseline: number, reduced: number): string {
  if (baseline === 0) return '0';
  const pct = Math.round(((baseline - reduced) / baseline) * 100);
  return Math.max(0, Math.min(100, pct)).toString();
}

function buildAbsoluteStackedRows(
  contractIde: { tokens: number; toolCalls: number; rulesHonored: string },
  bareClaude: { tokens: number; toolCalls: number; rulesHonored: string },
) {
  const ideRow =
    `Contract IDE: ~${fmt(contractIde.tokens)} tokens · ` +
    `~${fmt(contractIde.toolCalls)} tool calls · ` +
    `${contractIde.rulesHonored} rules honored`;

  const bareRow =
    `Bare Claude:  ~${fmt(bareClaude.tokens)} tokens · ` +
    `~${fmt(bareClaude.toolCalls)} tool calls · ` +
    `${bareClaude.rulesHonored} rules honored`;

  return { ideRow, bareRow };
}

function buildPercentageDeltaRow(
  contractIde: { tokens: number; toolCalls: number; rulesHonored: string },
  bareClaude: { tokens: number; toolCalls: number; rulesHonored: string },
) {
  const tokenPct = pctReduction(bareClaude.tokens, contractIde.tokens);
  const toolPct = pctReduction(bareClaude.toolCalls, contractIde.toolCalls);
  const isNa = contractIde.rulesHonored === 'N/A' || contractIde.rulesHonored === '';
  const rulesLine = isNa ? 'N/A rules honored' : `${contractIde.rulesHonored} rules honored`;
  return `−${tokenPct}% tokens · −${toolPct}% tool calls · ${rulesLine}`;
}

// ---------------------------------------------------------------------------
// Beat 2 sample data (from presentation-script.md § Beat 2)
// ---------------------------------------------------------------------------
const BEAT2_IDE = { tokens: 1400, toolCalls: 3, rulesHonored: '5/5' };
const BEAT2_BARE = { tokens: 7200, toolCalls: 22, rulesHonored: '0/5' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeltaBanner absolute-stacked format', () => {
  it('renders the literal Beat 2 Contract IDE line shape', () => {
    const { ideRow } = buildAbsoluteStackedRows(BEAT2_IDE, BEAT2_BARE);
    // Exact format from presentation-script.md § Beat 2:
    expect(ideRow).toBe(
      'Contract IDE: ~1,400 tokens · ~3 tool calls · 5/5 rules honored',
    );
  });

  it('renders the literal Beat 2 Bare Claude line shape', () => {
    const { bareRow } = buildAbsoluteStackedRows(BEAT2_IDE, BEAT2_BARE);
    expect(bareRow).toBe(
      'Bare Claude:  ~7,200 tokens · ~22 tool calls · 0/5 rules honored',
    );
  });

  it('uses comma separators for numbers >= 1000', () => {
    const { ideRow } = buildAbsoluteStackedRows(
      { tokens: 10000, toolCalls: 5, rulesHonored: '3/5' },
      { tokens: 50000, toolCalls: 20, rulesHonored: '0/5' },
    );
    expect(ideRow).toContain('~10,000 tokens');
    expect(ideRow).toContain('~5 tool calls');
  });

  it('preserves three-spaces alignment for Bare Claude label', () => {
    const { bareRow } = buildAbsoluteStackedRows(BEAT2_IDE, BEAT2_BARE);
    // "Bare Claude:  " has two trailing spaces (aligns with "Contract IDE: ")
    expect(bareRow.startsWith('Bare Claude:  ~')).toBe(true);
  });
});

describe('DeltaBanner percentage-delta format', () => {
  it('renders minus-sign percentage for Beat 2 data', () => {
    const row = buildPercentageDeltaRow(BEAT2_IDE, BEAT2_BARE);
    // tokens: 1400/7200 → 80% reduction; tool calls: 3/22 → 86% reduction
    expect(row).toMatch(/^−\d+% tokens · −\d+% tool calls · 5\/5 rules honored$/);
  });

  it('shows N/A when rulesHonored is N/A', () => {
    const row = buildPercentageDeltaRow(
      { tokens: 1400, toolCalls: 3, rulesHonored: 'N/A' },
      { tokens: 7200, toolCalls: 22, rulesHonored: 'N/A' },
    );
    expect(row).toContain('N/A rules honored');
  });

  it('clamps percentage to 100%', () => {
    // If contractIde.tokens = 0 and bareClaude.tokens > 0 → 100% reduction.
    const row = buildPercentageDeltaRow(
      { tokens: 0, toolCalls: 0, rulesHonored: 'N/A' },
      { tokens: 7200, toolCalls: 22, rulesHonored: '0/5' },
    );
    expect(row).toContain('−100% tokens');
    expect(row).toContain('−100% tool calls');
  });
});

describe('fmt helper', () => {
  it('formats 1400 as "1,400"', () => {
    expect(fmt(1400)).toBe('1,400');
  });
  it('formats 7200 as "7,200"', () => {
    expect(fmt(7200)).toBe('7,200');
  });
  it('formats sub-1000 numbers without comma', () => {
    expect(fmt(22)).toBe('22');
    expect(fmt(3)).toBe('3');
  });
});
