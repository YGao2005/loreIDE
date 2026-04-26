/**
 * Phase 13 Plan 05 — CARD-01: CVA for ScreenCard outer container.
 *
 * Mirrors plan 13-04's `cardKindStyles` (ServiceCard) shape — same `state`
 * keys matching plan 13-01's NodeVisualState union exactly so that
 * `resolveNodeState`'s output is a valid key here.
 *
 * Why a SEPARATE CVA scope (vs reusing cardKindStyles):
 *   ScreenCard has different default sizing (600x400 minimum to host an
 *   iframe + chip overlay), no kind-tone border (the iframe is the visual
 *   focus, not a card chrome), and `overflow-hidden` to clip iframe
 *   scrollbars. Sharing CVA with ServiceCard would fight the iframe-as-content
 *   model.
 *
 * Color choices follow plan 13-01's load-bearing constraint: orange-600
 * (`#ea580c`) is the canonical intent_drifted hue + 8px glow; orange-400 muted
 * is superseded; amber-500 is rollup_stale. The hex values match
 * contractNodeStyles.ts and cardStyles.ts byte-for-byte to keep the demo's
 * visual language consistent across cards / chips / contract nodes.
 */

import { cva } from 'class-variance-authority';

export const screenCardStyles = cva(
  'rounded-lg border bg-card/95 shadow-md overflow-hidden transition-colors',
  {
    variants: {
      state: {
        healthy: '',
        drifted: 'ring-2 ring-red-500 animate-pulse',
        rollup_stale: 'ring-2 ring-amber-500 animate-pulse',
        rollup_untracked: 'ring-1 ring-slate-400 opacity-60',
        intent_drifted:
          'ring-2 ring-orange-600 animate-pulse shadow-[0_0_8px_2px_rgba(234,88,12,0.4)]',
        superseded: 'ring-1 ring-orange-400 opacity-75',
      },
    },
    defaultVariants: {
      state: 'healthy',
    },
  },
);
