import { cva } from 'class-variance-authority';

// Visual encoding matrix per GRAPH-04:
// - kind: UI / API / data / job → border + bg color
// - state: healthy / drifted / untested / mass_matched → ring + opacity
// - canonical: true / false → solid vs dashed border (ghosts look spectral)
//
// Phase 8 Plan 08-02 adds: rollupState (fresh / stale / untracked) → amber / gray
// Phase 8 Plan 08-05 adds: targeted (true / false) → teal ring glow (CHRY-01)
// Phase 9 Plan 09-01 adds: mass_matched state variant → amber ring + staggered
//   animate-pulse using CSS variable --match-delay (set inline by ContractNode).
//
// Precedence (highest to lowest):
//   drifted (red)  >  rollup_stale (amber, persistent)  >  mass_matched (amber, transient)
//   >  rollup_untracked (gray)  >  targeted (teal)  >  healthy
//
// mass_matched vs rollup_stale distinction:
//   - rollup_stale: always-on amber ring while a child section has changed (PROP-02)
//   - mass_matched: transient amber pulse triggered by review queue (MASS-01);
//     persists ≥3s before review queue opens; cleared by clearMatches() on close
//
// The `targeted` variant is suppressed by compoundVariants when state==='drifted'
// OR rollupState is stale/untracked — drift and rollup signals always dominate.
//
// Visual treatment: ring-2 ring-teal-400 animate-pulse (slow pulse at reduced
// opacity — distinguishable from red-pulse drift). Teal is not orange (Phase 13
// reserves orange for intent_drifted) and not amber/gray (Phase 8 rollup states).

export const contractNodeStyles = cva(
  'rounded-md border-2 px-3 py-2 text-sm font-medium shadow-sm bg-background min-w-[140px] text-center',
  {
    variants: {
      kind: {
        UI: 'border-blue-500 bg-blue-50 text-blue-900',
        API: 'border-violet-500 bg-violet-50 text-violet-900',
        data: 'border-amber-500 bg-amber-50 text-amber-900',
        job: 'border-emerald-500 bg-emerald-50 text-emerald-900',
        unknown: 'border-slate-400 bg-slate-50 text-slate-900',
      },
      state: {
        healthy: '',
        drifted: 'ring-2 ring-red-500 animate-pulse',
        untested: 'opacity-70',
        // Phase 9 MASS-01: transient amber ring + staggered pulse.
        // animation-delay is driven by CSS custom property --match-delay which
        // ContractNode sets inline via style={{ '--match-delay': `${delay}ms` }}.
        // Distinct from Phase 8 rollup_stale (always-on; lives in rollupState
        // variant). mass_matched is transient — cleared when review queue closes.
        // Precedence: drifted (red) > mass_matched (amber transient) > healthy.
        mass_matched: 'ring-2 ring-amber-400 animate-pulse [animation-delay:var(--match-delay,0ms)]',
      },
      rollupState: {
        fresh: '',
        stale: 'ring-2 ring-amber-400',
        untracked: 'ring-2 ring-slate-400 opacity-80',
      },
      canonical: {
        true: '',
        false: 'border-dashed opacity-60',
      },
      targeted: {
        true: 'ring-2 ring-teal-400/70 animate-pulse [animation-duration:2000ms]',
        false: '',
      },
    },
    compoundVariants: [
      // Drift (red) dominates — suppress targeted ring when drifted.
      {
        state: 'drifted',
        targeted: true,
        class: '!ring-red-500',
      },
      // Rollup stale (amber) dominates — suppress targeted ring.
      {
        rollupState: 'stale',
        targeted: true,
        class: '!ring-amber-400',
      },
      // Rollup untracked (gray) dominates — suppress targeted ring.
      {
        rollupState: 'untracked',
        targeted: true,
        class: '!ring-slate-400',
      },
    ],
    defaultVariants: {
      kind: 'unknown',
      state: 'healthy',
      rollupState: 'fresh',
      canonical: true,
      targeted: false,
    },
  }
);

// Map a ContractNode.kind string (free-form from sidecar) to a known variant.
// Anything unrecognised gets the neutral 'unknown' slot rather than crashing
// the cva variant lookup.
export function normalizeKind(
  kind: string
): 'UI' | 'API' | 'data' | 'job' | 'unknown' {
  switch (kind) {
    case 'UI':
    case 'API':
    case 'data':
    case 'job':
      return kind;
    default:
      return 'unknown';
  }
}

// Phase 9 Plan 09-01 adds mass_matched to NodeHealthState.
// Precedence in buildFlowNodes: drifted > mass_matched > healthy.
export type NodeHealthState = 'healthy' | 'drifted' | 'untested' | 'mass_matched';

// Phase 8 Plan 08-02 rollup states.
export type RollupState = 'fresh' | 'stale' | 'untracked';
