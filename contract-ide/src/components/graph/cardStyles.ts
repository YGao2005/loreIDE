/**
 * Phase 13 Plan 04: CVA variants for ServiceCard / EndpointCard.
 *
 * Three CVA factories:
 *   - methodBadgeStyles: HTTP-method-colored pill (POST green, GET blue, etc.)
 *   - cardKindStyles:    backend-kind border + state ring (api/lib/data/...)
 *   - chipStyles:        small atom chip pill (used by ServiceCardChips)
 *
 * Why duplicate the `state` variants from contractNodeStyles.ts:
 *   ServiceCard has different default sizing/padding than ContractNode.
 *   A clean separate CVA scope avoids state-variant explosion across both.
 *   The `state` keys MUST match exactly so plan 13-01's `resolveNodeState`
 *   produces a key valid here.
 *
 * Color choices:
 *   - Method colors per ROADMAP CARD-02 spec: POST green, GET blue, PUT
 *     orange, PATCH yellow, DELETE red.
 *   - Kind borders: each backend kind gets a distinct border-tone family so
 *     the user can tell at a glance whether they're looking at an HTTP
 *     endpoint (blue) vs a cron job (cyan) vs a webhook event (pink).
 *   - State rings: orange-600 + glow for intent_drifted (Phase 13 Plan 01
 *     established this hex `#ea580c` for compressed-video legibility).
 */

import { cva } from 'class-variance-authority';

/**
 * HTTP method badge — small uppercase pill. Used in EndpointCard header for
 * `kind === 'api'` rows.
 *
 * POST green / GET blue / PUT orange / PATCH yellow / DELETE red per the
 * ROADMAP CARD-02 spec. Borders are a slightly stronger tint of the same hue
 * so the badge reads as solid against the card's dark/light background.
 */
export const methodBadgeStyles = cva(
  'inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold uppercase tracking-wide border',
  {
    variants: {
      method: {
        GET: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
        POST: 'bg-green-500/20 text-green-300 border-green-500/40',
        PUT: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
        PATCH: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
        DELETE: 'bg-red-500/20 text-red-300 border-red-500/40',
      },
    },
    defaultVariants: {
      method: 'GET',
    },
  },
);

/**
 * ServiceCard outer container — rounded panel with kind-toned border + state-
 * driven ring/halo.
 *
 * `state` keys MUST match the NodeVisualState union from contractNodeStyles.ts
 * so that resolveNodeState's output is a valid key here. Phase 13 Plan 01
 * canonicalises:
 *   healthy / drifted / rollup_stale / rollup_untracked / intent_drifted /
 *   superseded
 *
 * The intent_drifted state uses the same orange-600 + 8px glow halo as
 * ContractNode (13-RESEARCH Pitfall 6 — orange-500 vs amber-500 collapses
 * under compressed video bitrate; the box-shadow is the load-bearing visual
 * differentiator at 720p).
 */
export const cardKindStyles = cva(
  'rounded-lg border bg-card/95 shadow-sm transition-colors',
  {
    variants: {
      kind: {
        api: 'border-blue-700/30',
        lib: 'border-violet-700/30',
        data: 'border-green-700/30',
        external: 'border-amber-700/30',
        job: 'border-purple-700/30',
        cron: 'border-cyan-700/30',
        event: 'border-pink-700/30',
      },
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
      kind: 'api',
      state: 'healthy',
    },
  },
);

/**
 * Atom chip pill — used by ServiceCardChips to render L4 atoms beside a
 * ServiceCard. Same state-keyed coloring as the card itself (so a drifted
 * atom chip reads visually consistent with a drifted card).
 *
 * 22px-tall pills with 10px text per the plan spec.
 */
export const chipStyles = cva(
  'inline-flex items-center px-2 h-[22px] rounded-full text-[10px] font-mono whitespace-nowrap border transition-colors hover:opacity-80',
  {
    variants: {
      state: {
        healthy: 'bg-muted/60 text-muted-foreground border-border/60',
        drifted: 'bg-red-500/20 text-red-300 border-red-500/40 animate-pulse',
        rollup_stale:
          'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse',
        rollup_untracked:
          'bg-slate-500/15 text-slate-300 border-slate-500/30 opacity-60',
        intent_drifted:
          'bg-orange-600/20 text-orange-300 border-orange-600/50 animate-pulse shadow-[0_0_4px_1px_rgba(234,88,12,0.4)]',
        superseded: 'bg-orange-400/15 text-orange-300 border-orange-400/30 opacity-75',
      },
    },
    defaultVariants: {
      state: 'healthy',
    },
  },
);
