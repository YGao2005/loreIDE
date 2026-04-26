/**
 * IntentPalette routing + chip wiring tests.
 *
 * Covers two pure helpers exported from IntentPalette.tsx:
 *
 *   - `resolveKindFilter(chipFilter)` — chip → IPC kindFilter mapping. The
 *     chip is a *search-scope* toggle (which corpus to query). Tested 4-way.
 *
 *   - `resolveDestination(hit)` — the load-bearing pure routing decision per
 *     hit kind. Drives both the destination hint shown in the row AND the
 *     action chain in `handleSelect`. Substrate hits ALWAYS open the modal
 *     (Yang spec 2026-04-25 — supersedes plan 15-02's chip-conditional
 *     substrate routing).
 *
 *   - `kindLabel(hit)` and `destinationHint(dest)` — UI string helpers; light
 *     coverage to catch missing cases.
 *
 * **Test infrastructure note:** project uses `environment: 'node'` (no jsdom);
 * we test pure helpers and leave React render wiring to manual smoke per the
 * established convention from ServiceCard.test.ts and ScreenCard.test.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveKindFilter,
  resolveDestination,
  destinationHint,
  kindLabel,
  isSubstrateKind,
} from '../IntentPalette';
import type { IntentSearchHit } from '@/ipc/substrate';

// Helper to construct a hit with sane defaults — only override the fields the
// test cares about.
function mkHit(overrides: Partial<IntentSearchHit>): IntentSearchHit {
  return {
    uuid: 'uuid-x',
    kind: 'contract',
    node_kind: null,
    level: null,
    name: 'A hit',
    summary: '',
    state: null,
    parent_uuid: null,
    score: 0.5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// resolveKindFilter — chip → IPC kindFilter mapping
// ---------------------------------------------------------------------------

describe('resolveKindFilter — chip → IPC kindFilter mapping', () => {
  it('All chip produces undefined (no filter sent to Rust)', () => {
    expect(resolveKindFilter('all')).toBeUndefined();
  });
  it('Substrate chip produces "substrate"', () => {
    expect(resolveKindFilter('substrate')).toBe('substrate');
  });
  it('Contracts chip produces "contracts"', () => {
    expect(resolveKindFilter('contracts')).toBe('contracts');
  });
  it('Code chip produces "code"', () => {
    expect(resolveKindFilter('code')).toBe('code');
  });
});

// ---------------------------------------------------------------------------
// resolveDestination — per-hit routing decision (the load-bearing helper)
// ---------------------------------------------------------------------------

describe('resolveDestination — substrate rules ALWAYS open the modal', () => {
  for (const kind of ['constraint', 'decision', 'open_question', 'resolved_question', 'attempt']) {
    it(`${kind} → "modal" (independent of chip filter)`, () => {
      expect(resolveDestination(mkHit({ kind }))).toBe('modal');
    });
  }
});

describe('resolveDestination — flow contract → "flow-chain"', () => {
  it('flow kind opens the L2 chain', () => {
    expect(resolveDestination(mkHit({ kind: 'flow', level: 'L2' }))).toBe('flow-chain');
  });
});

describe('resolveDestination — UI screens vs UI components', () => {
  it('UI L3 (screen page) → "screen"', () => {
    expect(
      resolveDestination(mkHit({ kind: 'contract', node_kind: 'UI', level: 'L3' })),
    ).toBe('screen');
  });
  it('UI L4 (component) → "screen-chip" (parent screen + chip halo)', () => {
    expect(
      resolveDestination(
        mkHit({ kind: 'contract', node_kind: 'UI', level: 'L4', parent_uuid: 'parent-l3' }),
      ),
    ).toBe('screen-chip');
  });
});

describe('resolveDestination — backend nodes → "service-node" (zoom in)', () => {
  for (const node_kind of ['API', 'lib', 'data', 'external', 'job', 'cron', 'event']) {
    it(`${node_kind} → "service-node"`, () => {
      expect(
        resolveDestination(mkHit({ kind: 'contract', node_kind, level: 'L3' })),
      ).toBe('service-node');
    });
  }
});

describe('resolveDestination — fallback to "breadcrumb" for ambiguous contracts', () => {
  it('contract with unknown node_kind → "breadcrumb"', () => {
    expect(
      resolveDestination(mkHit({ kind: 'contract', node_kind: 'unknown', level: 'L2' })),
    ).toBe('breadcrumb');
  });
  it('contract with null node_kind → "breadcrumb"', () => {
    expect(
      resolveDestination(mkHit({ kind: 'contract', node_kind: null, level: 'L1' })),
    ).toBe('breadcrumb');
  });
});

// ---------------------------------------------------------------------------
// destinationHint — short user-facing label per destination
// ---------------------------------------------------------------------------

describe('destinationHint — every destination has a short label', () => {
  it('every destination tag returns a non-empty string', () => {
    const dests = ['modal', 'flow-chain', 'screen', 'screen-chip', 'service-node', 'breadcrumb'] as const;
    for (const d of dests) {
      const hint = destinationHint(d);
      expect(hint).toBeTruthy();
      expect(hint.length).toBeLessThan(20);
    }
  });
});

// ---------------------------------------------------------------------------
// kindLabel — semantic kind badge text
// ---------------------------------------------------------------------------

describe('kindLabel — semantic kind text per hit', () => {
  it('UI L3 → "Screen"', () => {
    expect(kindLabel(mkHit({ kind: 'contract', node_kind: 'UI', level: 'L3' }))).toBe('Screen');
  });
  it('UI L4 → "Component"', () => {
    expect(kindLabel(mkHit({ kind: 'contract', node_kind: 'UI', level: 'L4' }))).toBe('Component');
  });
  it('API → "API"', () => {
    expect(kindLabel(mkHit({ kind: 'contract', node_kind: 'API' }))).toBe('API');
  });
  it('lib → "Lib"', () => {
    expect(kindLabel(mkHit({ kind: 'contract', node_kind: 'lib' }))).toBe('Lib');
  });
  it('flow → "Flow"', () => {
    expect(kindLabel(mkHit({ kind: 'flow', level: 'L2' }))).toBe('Flow');
  });
  it('decision → "Decision"', () => {
    expect(kindLabel(mkHit({ kind: 'decision' }))).toBe('Decision');
  });
  it('constraint → "Constraint"', () => {
    expect(kindLabel(mkHit({ kind: 'constraint' }))).toBe('Constraint');
  });
});

// ---------------------------------------------------------------------------
// isSubstrateKind — kind guard (preserved from previous test surface)
// ---------------------------------------------------------------------------

describe('isSubstrateKind — identifies substrate-node kinds', () => {
  it('returns true for all five substrate node kinds', () => {
    expect(isSubstrateKind('constraint')).toBe(true);
    expect(isSubstrateKind('decision')).toBe(true);
    expect(isSubstrateKind('open_question')).toBe(true);
    expect(isSubstrateKind('resolved_question')).toBe(true);
    expect(isSubstrateKind('attempt')).toBe(true);
  });
  it('returns false for contract / flow / unknown kinds', () => {
    expect(isSubstrateKind('contract')).toBe(false);
    expect(isSubstrateKind('flow')).toBe(false);
    expect(isSubstrateKind('')).toBe(false);
    expect(isSubstrateKind('unknown_kind')).toBe(false);
  });
});
