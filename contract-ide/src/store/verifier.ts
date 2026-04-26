/**
 * Phase 13 Plan 09 — Verifier panel state.
 *
 * Drives the Beat 3 VerifierPanel: substrate honors (✓), implicit decisions
 * group (ℹ), and the parent-surface orange flag (⚠). Loaded by
 * `loadBeat3VerifierResults` (in src/lib/demoOrchestration.ts) which plan
 * 13-10b's DemoOrchestrationPanel will call when staging Beat 3.
 *
 * The orange flag's `parentSurfaceUuid` drives a long (8s) citation halo on
 * the screen card per script + SC 6 — the halo lands on the SCREEN CARD
 * (parent surface), not on a service card. VerifierPanel's useEffect performs
 * the highlight call on open.
 */

import { create } from 'zustand';

export interface VerifierRow {
  kind: 'honor' | 'flag' | 'info';
  /** Substrate node uuid for `[source]` pill rendering. Optional for free-form rows. */
  ruleUuid?: string;
  /** Display label (used as pill shortLabel when ruleUuid is set). */
  ruleName: string;
  /** Right-hand explanation text. */
  detail: string;
  /** For flag rows: which screen card uuid to halo. */
  parentSurfaceUuid?: string;
}

export interface ImplicitDecisionRow {
  /** The implicit decision (e.g. 'Email link expires in 24h'). */
  field: string;
  /** Where the value came from (e.g. 'agent default', 'inferred from project schema'). */
  derivedFrom: string;
}

interface VerifierState {
  open: boolean;
  rows: VerifierRow[];
  implicitDecisions: ImplicitDecisionRow[];
  setOpen: (open: boolean) => void;
  setResults: (rows: VerifierRow[], implicit: ImplicitDecisionRow[]) => void;
  clear: () => void;
}

export const useVerifierStore = create<VerifierState>((set) => ({
  open: false,
  rows: [],
  implicitDecisions: [],
  setOpen: (open) => set({ open }),
  setResults: (rows, implicit) =>
    set({ rows, implicitDecisions: implicit, open: true }),
  clear: () => set({ rows: [], implicitDecisions: [], open: false }),
}));
