/**
 * Phase 13 Plan 09 — demo orchestration helpers.
 *
 * Pure functions that load canonical Beat 3 / Beat 4 fixtures into the in-app
 * stores so the live demo can stage moments deterministically. Plan 13-10b's
 * DemoOrchestrationPanel will call these from a UI affordance; for plan-09
 * verification we expose them on `window.__demo` (in dev) so the user can
 * trigger Beat 3 manually from DevTools.
 *
 * Beat 3 verifier content matches the script verbatim — 6 substrate honors,
 * 3 implicit decisions, 1 orange flag (parent surface). The orange flag's
 * `parentSurfaceUuid` drives an 8s halo on the SCREEN CARD, not a service
 * card, per script + SC 6.
 */

import { invoke } from '@tauri-apps/api/core';
import {
  useVerifierStore,
  type VerifierRow,
  type ImplicitDecisionRow,
} from '@/store/verifier';

/**
 * Load the canonical Beat 3 verifier output (6 honors + 3 implicit + 1 flag).
 *
 * @param parentSurfaceUuid - uuid of the screen card to halo for the orange flag
 */
export function loadBeat3VerifierResults(parentSurfaceUuid: string): void {
  useVerifierStore.getState().setResults(
    [
      {
        kind: 'honor',
        ruleName: 'Matches contract',
        detail: 'Delete Account action present in danger-zone section',
      },
      {
        kind: 'honor',
        ruleUuid: 'dec-soft-delete-30day-grace-2026-02-18',
        ruleName: 'soft-delete-30day-grace',
        detail: 'deletedAt set, no hard delete',
      },
      {
        kind: 'honor',
        ruleUuid: 'con-anonymize-not-delete-tax-held-2026-03-04',
        ruleName: 'anonymize-tax-held',
        detail: 'invoice updateMany present',
      },
      {
        kind: 'honor',
        ruleUuid: 'con-stripe-customer-archive-2026-02-22',
        ruleName: 'stripe-archive',
        detail: 'customers.update with metadata',
      },
      {
        kind: 'honor',
        ruleUuid: 'con-mailing-list-suppress-not-delete-2026-03-11',
        ruleName: 'mailchimp-suppress',
        detail: 'mailchimp suppress call',
      },
      {
        kind: 'honor',
        ruleUuid: 'dec-confirm-via-email-link-2026-02-18',
        ruleName: 'email-link-confirmation',
        detail: 'sendDeletionConfirmationEmail call',
      },
      {
        kind: 'flag',
        ruleUuid: 'con-settings-no-modal-interrupts-2025-Q4',
        ruleName: 'con-settings-no-modal-interrupts-2025-Q4',
        detail:
          '"no modal interrupts on user actions" — derived 2025-Q4 under priority reduce-onboarding-friction. Current priority since 2026-04-24 is compliance-first. The new modal interrupt may be intended; review.',
        parentSurfaceUuid,
      },
    ],
    [
      { field: 'Email link expires in 24h', derivedFrom: 'agent default' },
      {
        field: 'Audit log written to `audit_log` table',
        derivedFrom: 'inferred from project schema',
      },
      {
        field: 'Cleanup runs as background job',
        derivedFrom: 'derived from contract.role "primary action"',
      },
    ],
  );
}

/**
 * Expose demo orchestration helpers on `window.__demo` in dev so the user
 * can trigger Beat 3 manually from DevTools during plan 13-09 verification.
 * Plan 13-10b will replace this with a proper DemoOrchestrationPanel.
 */
declare global {
  interface Window {
    __demo?: {
      loadBeat3VerifierResults: typeof loadBeat3VerifierResults;
    };
  }
}

if (typeof window !== 'undefined') {
  window.__demo = {
    ...(window.__demo ?? {}),
    loadBeat3VerifierResults,
  };
}

/**
 * Plan 13-10b — fixture-driven Beat 3 + Beat 4 triggers.
 *
 * `loadAndApplyBeat3Verifier` reads beat3-verifier.json via the Rust IPC
 * (fixture file shipped by sibling plan 13-10a) and applies the parsed rows
 * to useVerifierStore. This is the demo-rehearsal counterpart to plan 13-09's
 * inline `loadBeat3VerifierResults` (which keeps hardcoded data for DevTools
 * convenience). The fixture-driven path is what plan 13-11 rehearsal uses.
 *
 * `triggerBeat4Harvest` invokes the Rust IPC that emits
 * `substrate:nodes-added` with the harvested_nodes payload from
 * beat4-harvest.json — HarvestPanel's listener (plan 13-09) consumes the
 * event and fires green halos via animateHarvestArrival per N9.
 */

interface Beat3VerifierFixture {
  rows?: VerifierRow[];
  implicitDecisions?: ImplicitDecisionRow[];
  flag?: VerifierRow;
}

export async function loadAndApplyBeat3Verifier(): Promise<void> {
  const fixture = await invoke<Beat3VerifierFixture>(
    'load_beat3_verifier_fixture',
  );
  const rows = fixture.rows ?? [];
  const flagRows = fixture.flag ? [fixture.flag] : [];
  const implicit = fixture.implicitDecisions ?? [];
  useVerifierStore.getState().setResults([...rows, ...flagRows], implicit);
}

export async function triggerBeat4Harvest(): Promise<void> {
  // Rust side reads beat4-harvest.json + emits substrate:nodes-added; the
  // HarvestPanel subscriber (plan 13-09) receives the harvested_nodes array
  // and fires green halos on each attached_to_uuid per N9.
  await invoke('emit_beat4_harvest');
}
