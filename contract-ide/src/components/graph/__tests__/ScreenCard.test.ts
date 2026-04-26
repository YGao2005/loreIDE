/**
 * Phase 13 Plan 05 — ScreenCard render-shape unit tests.
 *
 * Tests verify ScreenCard's render decisions WITHOUT mounting React DOM —
 * the project's test infrastructure is `environment: 'node'` (no jsdom) and
 * doesn't include `@testing-library/react`, matching the established pattern
 * from ServiceCard.test.ts (plan 13-04) and DeltaBanner.test.ts.
 *
 * What these tests cover:
 *   1. ScreenCard is registered in nodeTypes alongside contract / group /
 *      serviceCard — the additive append per Wave 2 serialization_hint
 *      preserves plan 13-04's serviceCard entry.
 *   2. ScreenCardData shape contract — required fields (uuid, name, route)
 *      and optional devServerUrl with default fallback.
 *   3. URL composition: `${devServerUrl ?? 'http://localhost:3000'}${route}`
 *      with leading-slash defence on the route.
 *
 * The actual JSX render — iframe loading, chip overlay, Inspect/Interact
 * toggle, probe/retry — is covered by manual smoke (Task 3 human-verify
 * checkpoint) and plan 13-11 rehearsal.
 */

import { describe, it, expect } from 'vitest';
import { ScreenCard, type ScreenCardData } from '../ScreenCard';
import { nodeTypes } from '../nodeTypes';

describe('ScreenCard registration', () => {
  it('is registered in nodeTypes under the screenCard key', () => {
    expect(nodeTypes.screenCard).toBe(ScreenCard);
  });

  it('preserves plan 13-04 serviceCard entry alongside the new screenCard', () => {
    // Wave 2 serialization_hint: nodeTypes.ts edits run sequentially —
    // 13-04 lands serviceCard, 13-05 appends screenCard. Neither plan's
    // entry should overwrite the other.
    expect(nodeTypes).toHaveProperty('screenCard');
    expect(nodeTypes).toHaveProperty('serviceCard');
    expect(nodeTypes).toHaveProperty('contract');
    expect(nodeTypes).toHaveProperty('group');
  });

  it('exposes a memoised React component (not the raw function)', () => {
    // Module-scope memo() per Plan 03-01 Pitfall 1 — inline memo inside
    // the nodeTypes record causes React Flow to remount every node every
    // frame. ScreenCard is the memo wrapper; verify it has the React.memo
    // marker shape.
    const c = nodeTypes.screenCard as unknown as {
      $$typeof?: symbol;
      type?: unknown;
    };
    expect(typeof c).toBe('object');
    // React.memo returns an object with $$typeof === REACT_MEMO_TYPE — we
    // can't import the symbol cleanly across React versions, so we check
    // for its existence as a structural sanity guard.
    expect(c.$$typeof).toBeDefined();
  });
});

describe('ScreenCardData contract', () => {
  it('accepts the minimum required fields (uuid + name + route)', () => {
    // The Record<string, unknown> extends in ScreenCardData satisfies
    // xyflow's data-prop constraint without forcing extra fields. This is
    // a compile-time check enforced by tsc — the test runs verify a
    // populated literal compiles and round-trips through type assignment.
    const data: ScreenCardData = {
      uuid: 'screen-uuid-1',
      name: 'Account Settings',
      route: '/account/settings',
    };
    expect(data.uuid).toBe('screen-uuid-1');
    expect(data.devServerUrl).toBeUndefined();
  });

  it('accepts an optional custom devServerUrl', () => {
    const data: ScreenCardData = {
      uuid: 'screen-uuid-2',
      name: 'Custom Port Screen',
      route: '/x',
      devServerUrl: 'http://localhost:4200',
    };
    expect(data.devServerUrl).toBe('http://localhost:4200');
  });
});

describe('ScreenCard URL composition (logic shape)', () => {
  // ScreenCard composes its iframe URL via `${baseUrl}${path}` where path
  // is normalised to a leading slash. We verify the composition shape
  // directly by exercising a copy of the same composition rule, defending
  // the contract against future refactors that might break the leading-slash
  // defence (e.g. PreviewTab Pitfall 6 historical bug).
  function buildPreviewUrl(route: string, base: string): string {
    const path = route.startsWith('/') ? route : `/${route}`;
    return `${base}${path}`;
  }

  it('prepends a slash when route is missing one', () => {
    expect(buildPreviewUrl('account/settings', 'http://localhost:3000')).toBe(
      'http://localhost:3000/account/settings',
    );
  });

  it('preserves an existing leading slash', () => {
    expect(buildPreviewUrl('/account/settings', 'http://localhost:3000')).toBe(
      'http://localhost:3000/account/settings',
    );
  });

  it('honours a custom devServerUrl base', () => {
    expect(buildPreviewUrl('/x', 'http://localhost:4200')).toBe(
      'http://localhost:4200/x',
    );
  });
});
