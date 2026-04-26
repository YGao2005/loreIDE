import { cva } from 'class-variance-authority';
import type { SubstrateNodeState } from '@/store/substrate';

// Visual encoding matrix per GRAPH-04:
// - kind: UI / API / data / job → border + bg color
// - state: healthy / drifted / untested / mass_matched / intent_drifted / superseded
// - canonical: true / false → solid vs dashed border (ghosts look spectral)
//
// Phase 8 Plan 08-02 adds: rollupState (fresh / stale / untracked) → amber / gray
// Phase 8 Plan 08-05 adds: targeted (true / false) → teal ring glow (CHRY-01)
// Phase 9 Plan 09-01 adds: mass_matched state variant → amber ring + staggered
//   animate-pulse using CSS variable --match-delay (set inline by ContractNode).
// Phase 13 Plan 01 adds: intent_drifted (orange-600 + glow + pulse) and
//   superseded (orange-400 + opacity 0.75, no pulse) state variants — derived
//   from the substrate engine. orange-600 is intentionally darker than amber
//   so the visual differentiation survives compressed video bitrate (13-RESEARCH
//   Pitfall 6 — orange-500 is too close to amber-500). The animated box-shadow
//   halo gives intent_drifted a distinct glow that amber lacks; superseded uses
//   a softer ring with opacity 0.75 to read as "touched but not active."
//
// Precedence (highest to lowest):
//   drifted (red)  >  intent_drifted (orange + glow)  >  rollup_stale (amber persistent)
//   >  mass_matched (amber transient)  >  superseded (orange muted)
//   >  rollup_untracked (gray)  >  targeted (teal)  >  healthy
//
// mass_matched vs rollup_stale distinction:
//   - rollup_stale: always-on amber ring while a child section has changed (PROP-02)
//   - mass_matched: transient amber pulse triggered by review queue (MASS-01);
//     persists ≥3s before review queue opens; cleared by clearMatches() on close
//
// The `targeted` variant is suppressed by compoundVariants when state==='drifted'
// OR state==='intent_drifted' OR rollupState is stale/untracked — drift,
// substrate, and rollup signals always dominate.
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
        // Phase 13 Plan 01: intent_drifted (orange-600 + animated glow halo).
        // Lives BETWEEN drifted (red) and rollup_stale (amber) in precedence.
        // The box-shadow halo (8px blur + 2px spread at 0.4 alpha of orange-600)
        // is the visual element that distinguishes orange-from-amber in compressed
        // video — pure ring color alone reads as a single "warning" hue at 720p.
        intent_drifted:
          'ring-2 ring-orange-600 animate-pulse shadow-[0_0_8px_2px_rgba(234,88,12,0.4)]',
        // Phase 13 Plan 01: superseded (orange-400 muted, no pulse, opacity 0.75).
        // The "atom's anchoring substrate was invalidated" state — softer than
        // intent_drifted because the priority shift didn't directly hit this
        // atom; a related decision merely became outdated.
        superseded: 'ring-1 ring-orange-400 opacity-75',
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
      // Phase 13 Plan 01: intent_drifted (orange + glow) dominates targeted.
      {
        state: 'intent_drifted',
        targeted: true,
        class: '!ring-orange-600',
      },
      // Phase 13 Plan 01: superseded (orange muted) also dominates targeted.
      {
        state: 'superseded',
        targeted: true,
        class: '!ring-orange-400',
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
// Phase 13 Plan 01 adds intent_drifted + superseded.
// Precedence in buildFlowNodes (resolveNodeState): drifted > intent_drifted >
//   rollup_stale > mass_matched > superseded > rollup_untracked > healthy.
export type NodeHealthState =
  | 'healthy'
  | 'drifted'
  | 'untested'
  | 'mass_matched'
  | 'intent_drifted'
  | 'superseded';

// Phase 8 Plan 08-02 rollup states.
export type RollupState = 'fresh' | 'stale' | 'untracked';

// Phase 13 Plan 01: composite "what's the visual state of this node?" derived
// from (a) Phase 7 drift (red), (b) Phase 8 rollup state (amber/gray), and
// (c) Phase 12+13 substrate state (orange / orange muted).
//
// LOAD-BEARING for Wave 2: plans 13-04 ServiceCardChips, 13-05 AtomChip, 13-06
// FlowChain, 13-07 citation halo, 13-09 verifier all import { resolveNodeState
// } from '@/components/graph/contractNodeStyles'. Do NOT relocate without
// updating all five plans.
export type NodeVisualState =
  | 'healthy'
  | 'drifted'
  | 'rollup_stale'
  | 'rollup_untracked'
  | 'intent_drifted'
  | 'superseded';

/**
 * Phase 13 Plan 07 — citation halo class.
 *
 * Applied additively (NOT a CVA variant) on top of any existing state ring
 * when `useCitationStore.highlightedUuid` matches the card/chip's uuid.
 * Distinct from substrate-state (orange/amber) and drift (red) signals: this
 * is a TRANSIENT interaction marker (~2s pulse), not a persistent semantic
 * indicator. The two coexist visually — a rollup_stale (amber) atom that's
 * also citation-highlighted shows BOTH the amber ring AND the blue halo.
 *
 * Subscribers: ServiceCard, ScreenCard, AtomChip. Each reads
 * `useCitationStore((s) => s.highlightedUuid)` and appends this class when
 * `highlightedUuid === uuid`.
 *
 * Visual: blue-300 ring + soft glow + slight scale-up so the halo is
 * recognisably "interactive feedback" rather than another semantic state. The
 * 0.4 alpha glow at 12px keeps it readable at compressed video bitrate (same
 * legibility constraint as orange-600 + 8px for intent_drifted, see Pitfall 6
 * in 13-RESEARCH.md).
 */
export const citationHaloClass =
  'ring-2 ring-blue-300 shadow-[0_0_12px_4px_rgba(96,165,250,0.4)] scale-[1.02] transition-all';

/**
 * Compose the visual state for a single uuid from all four upstream signals.
 *
 * Precedence (highest to lowest):
 *   1. drifted (red, animated)         — Phase 7  (code-vs-contract drift)
 *   2. intent_drifted (orange, glow)   — Phase 12 (priority shift cascade)
 *   3. rollup_stale (amber)            — Phase 8  (child section changed)
 *   4. superseded (orange muted)       — Phase 12 (anchoring substrate invalid)
 *   5. rollup_untracked (gray)         — Phase 8  (no rollup signal yet)
 *   6. healthy                         — default
 *
 * The buildFlowNodes function consumes the result and maps it onto the CVA
 * `state` + `rollupState` variants — see GraphCanvasInner.tsx for the wiring.
 *
 * @param uuid              The contract node uuid to resolve state for.
 * @param driftedUuids      Set of uuids in 'drifted' state (Phase 7).
 * @param rollupStaleUuids  Set of uuids whose rollup is amber (Phase 8).
 * @param untrackedUuids    Set of uuids whose rollup is gray (Phase 8).
 * @param substrateStates   Map of uuid → SubstrateNodeState (Phase 13).
 */
export function resolveNodeState(
  uuid: string,
  driftedUuids: Set<string>,
  rollupStaleUuids: Set<string>,
  untrackedUuids: Set<string>,
  substrateStates: Map<string, SubstrateNodeState>,
): NodeVisualState {
  // 1. Code drift (Phase 7) — always wins. Red is the "code reality changed
  //    out from under the contract" signal; nothing supersedes it.
  if (driftedUuids.has(uuid)) return 'drifted';

  // 2. Substrate intent_drifted (Phase 12) — priority-shift cascade. Orange
  //    + glow sits between red and amber per ROADMAP SC 6.
  const sub = substrateStates.get(uuid);
  if (sub === 'intent_drifted') return 'intent_drifted';

  // 3. Rollup stale (Phase 8) — child contract changed beneath this node.
  if (rollupStaleUuids.has(uuid)) return 'rollup_stale';

  // 4. Substrate superseded — softer signal than amber. The atom's anchoring
  //    substrate was invalidated by a newer truth, but no priority shift
  //    cascade hit this atom directly.
  if (sub === 'superseded') return 'superseded';

  // 5. Rollup untracked (Phase 8) — no engine signal yet. Gray ring.
  if (untrackedUuids.has(uuid)) return 'rollup_untracked';

  // 6. Healthy — no overlay.
  return 'healthy';
}
