/**
 * Phase 13 Plan 03 — Cmd+P precision test fixture (SUB-08).
 *
 * **Purpose:** define the 10 ambient queries from the demo scenario and assert
 * which uuid / name should be top-1 for each. Plan 13-10b's UAT runs this
 * harness against the seeded substrate fixture and gates the demo on
 * ≥80% (8/10) top-1 precision per ROADMAP SC 1.
 *
 * **What this test files ships in plan 13-03:**
 *   - The 10-query fixture (committed scenario from
 *     `.planning/demo/scenario-criteria.md`).
 *   - Structural validation of the fixture (length = 10, all entries shape-
 *     correct) — runs unconditionally.
 *   - The precision harness — runs ONLY when `VITEST_INTEGRATION=1` is set
 *     in the shell (because `findSubstrateByIntent` invokes a Tauri command
 *     and the default `environment: 'node'` test harness has no Tauri
 *     runtime; calling `invoke()` would throw `__TAURI_INTERNALS__ is not
 *     defined`).
 *
 * **Plan 13-10b will:**
 *   - Boot the Tauri dev server with the seeded substrate fixture.
 *   - Run `VITEST_INTEGRATION=1 npx vitest run cmdp-precision`.
 *   - Read the `[Cmd+P precision]` JSON log to see per-query pass/fail.
 *   - Confirm `passed >= 8` (≥80% top-1 precision).
 *
 * **Mitigation per 13-RESEARCH.md Risk 1:** if precision falls below 80% in
 * 13-10b, the fallback documented in 13-03-SUMMARY is to add an FTS5 substring
 * match as a first-pass filter before LLM rerank. The test fixture stays
 * unchanged — only the Rust scoring pipeline mitigates.
 *
 * **Why fuzzy matching against name?** Seed fixtures use stable display names
 * (e.g. "AccountSettings.DangerZone") but the plan-13-10a SQL seed may emit
 * uuids that differ between runs. Matching by name OR uuid OR name-substring
 * keeps the fixture flexible without sacrificing correctness — the contract
 * being asserted is "did the engine return the EXPECTED node first?", not
 * "did it return the EXACT uuid encoded in this file."
 */

import { describe, it, expect } from 'vitest';
import { findSubstrateByIntent } from '@/ipc/substrate';

interface PrecisionQuery {
  /** Raw user-typed query into the Cmd+P input. */
  query: string;
  /** Expected kind on the top-1 hit (`flow`, `contract`, or substrate kind). */
  expected_kind: string;
  /** Expected name OR uuid OR uuid-prefix on the top-1 hit. */
  expected_uuid_or_name: string;
  /** Why this query is in the fixture — traceable back to a demo beat. */
  rationale: string;
}

/**
 * The 10 ambient queries from the committed scenario. Each maps to a
 * recognizable beat or substrate retrieval path the demo exercises.
 *
 * Names track `.planning/demo/scenario-criteria.md` § Committed Scenario;
 * uuid placeholders track plan-13-10a's seed SQL emit. Plan 13-10b can
 * adjust either side if the fixture renames a node.
 */
const QUERIES: PrecisionQuery[] = [
  {
    query: 'account settings danger',
    expected_kind: 'contract',
    expected_uuid_or_name: 'AccountSettings.DangerZone',
    rationale: 'Beat 1 entry — PM types this exact query to land at the L4 atom',
  },
  {
    query: 'delete account flow',
    expected_kind: 'flow',
    expected_uuid_or_name: 'flow-delete-account',
    rationale: 'Flow-level navigation — Beat 2 setup',
  },
  {
    query: 'soft delete grace period',
    expected_kind: 'decision',
    expected_uuid_or_name: 'dec-soft-delete-30day-grace-2026-02-18',
    rationale: 'Substrate decision retrieval — Beat 1 archaeology hop',
  },
  {
    query: 'tax records anonymize',
    expected_kind: 'constraint',
    expected_uuid_or_name: 'con-anonymize-not-delete-tax-held-2026-03-04',
    rationale: 'Substrate constraint retrieval — Beat 2 reasons',
  },
  {
    query: 'stripe customer archive',
    expected_kind: 'constraint',
    expected_uuid_or_name: 'con-stripe-customer-archive-2026-02-22',
    rationale: 'Substrate constraint retrieval — Beat 3 dependencies',
  },
  {
    query: 'workspace delete',
    expected_kind: 'flow',
    expected_uuid_or_name: 'flow-delete-workspace',
    rationale: 'Beat 4 flow navigation',
  },
  {
    query: 'team settings',
    expected_kind: 'contract',
    expected_uuid_or_name: 'TeamSettings',
    rationale: 'Surface-level navigation — basic FTS5 sanity',
  },
  {
    query: 'mailing list suppress',
    expected_kind: 'constraint',
    expected_uuid_or_name: 'con-mailing-list-suppress-not-delete-2026-03-11',
    rationale: 'Substrate constraint retrieval — Beat 4 reasons',
  },
  {
    query: 'email confirmation link',
    expected_kind: 'decision',
    expected_uuid_or_name: 'dec-confirm-via-email-link-2026-02-18',
    rationale: 'Substrate decision retrieval — Beat 2 archaeology',
  },
  {
    query: 'modal interrupts settings',
    expected_kind: 'constraint',
    expected_uuid_or_name: 'con-settings-no-modal-interrupts-2025-Q4',
    rationale: 'Beat 3 orange-flag fixture — must be findable',
  },
];

/**
 * Fuzzy match: strict uuid match, strict name match, or substring of name
 * with hyphens converted to spaces (handles "flow-delete-account" matching
 * "flow delete account" if seed emitter keeps a humanised display name).
 */
function topMatchesExpectation(
  topName: string,
  topUuid: string,
  expected: string,
): boolean {
  if (topUuid === expected) return true;
  if (topName === expected) return true;
  const expectedNormalised = expected.toLowerCase().replace(/-/g, ' ');
  return topName.toLowerCase().includes(expectedNormalised);
}

describe('Cmd+P precision (≥80% top-1) — fixture validation', () => {
  it('fixture has exactly 10 ambient queries', () => {
    expect(QUERIES).toHaveLength(10);
  });

  it('every fixture entry has a non-empty query, kind, and expected_uuid_or_name', () => {
    for (const q of QUERIES) {
      expect(q.query).toBeTruthy();
      expect(q.query.trim().length).toBeGreaterThan(0);
      expect(q.expected_kind).toBeTruthy();
      expect(q.expected_uuid_or_name).toBeTruthy();
      expect(q.rationale).toBeTruthy();
    }
  });

  it('expected_kind is one of the 7 known kinds', () => {
    // Locked enum from `find_substrate_by_intent` Rust IPC's surface_kind branch
    // + the substrate node_type enum.
    const validKinds = new Set([
      'flow',
      'contract',
      'constraint',
      'decision',
      'open_question',
      'resolved_question',
      'attempt',
    ]);
    for (const q of QUERIES) {
      expect(validKinds.has(q.expected_kind)).toBe(true);
    }
  });
});

/**
 * Integration harness — gated behind VITEST_INTEGRATION=1 so the default
 * unit-test run doesn't fail on `invoke is not a function`. Plan 13-10b will
 * boot the Tauri dev server first, then run with the env flag set.
 *
 * The harness emits a per-query JSON log (`[Cmd+P precision]`) so failures
 * are debuggable without re-running individual queries. Plan 13-10b reads
 * this log during demo rehearsal validation.
 */
const RUN_INTEGRATION = process.env.VITEST_INTEGRATION === '1';

describe.skipIf(!RUN_INTEGRATION)(
  'Cmd+P precision (≥80% top-1) — integration against live IPC',
  () => {
    it('hits ≥8/10 expected top-1 results', async () => {
      // REQUIRES: plan 13-10a seed fixture loaded into SQLite at the path
      // `findSubstrateByIntent` reads from. If substrate is empty, this test
      // SHOULD fail — that's the correct signal for "we need to populate the
      // fixture before the demo."
      const results: { query: string; passed: boolean; got: string }[] = [];

      for (const q of QUERIES) {
        const hits = await findSubstrateByIntent(q.query, 5);
        if (hits.length === 0) {
          results.push({ query: q.query, passed: false, got: '<no hits>' });
          continue;
        }
        const top = hits[0];
        const matched = topMatchesExpectation(top.name, top.uuid, q.expected_uuid_or_name);
        results.push({ query: q.query, passed: matched, got: top.name });
      }

      const passed = results.filter((r) => r.passed).length;
      // Log the per-query result table so plan 13-10b can paste into the UAT
      // runbook even when the assertion fails.
      console.log('[Cmd+P precision]', JSON.stringify(results, null, 2));

      expect(passed).toBeGreaterThanOrEqual(8);
    });
  },
);
