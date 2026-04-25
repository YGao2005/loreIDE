/**
 * Phase 13 Plan 03 — single hit row for the Cmd+P IntentPalette (SUB-08).
 *
 * Renders one `IntentSearchHit` with three optional decorations:
 *   - Kind icon: small lucide glyph chosen per `hit.kind` so the user's
 *     visual mental model groups results consistently (FileText for
 *     contracts, GitBranch for flows, distinct icons for the four substrate
 *     kinds).
 *   - Substrate-state badge: a tiny colored dot for substrate hits so an
 *     intent-drifted decision (orange-600) reads visually-distinct from a
 *     fresh constraint (gray) without having to consult the level/kind
 *     header. Hex values mirror plan 13-01 CVA variants exactly so the row
 *     reads as a "preview" of canvas color state.
 *   - Level pill: L0..L4 right-aligned for contract hits; absent for
 *     substrate hits (which have null `level`).
 *
 * Why we keep the icon + badge inline (no shadcn dependency import):
 *   - Sizing must hit the 16px-min sidebar grid established by plan 13-02's
 *     SidebarAreaItem Badge. shadcn's Badge default sizing is too generous
 *     for a palette row.
 *   - Icon + dot mappings are tiny and self-contained — externalising them
 *     would add file weight without reuse value.
 */

import {
  FileText,
  GitBranch,
  CircleAlert,
  ScrollText,
  HelpCircle,
  CheckCircle2,
  Lightbulb,
} from 'lucide-react';
import type { IntentSearchHit } from '@/ipc/substrate';

/**
 * Map kind → lucide icon. Contract / flow get document-style icons; the four
 * substrate kinds each get a kind-specific glyph so the palette row tells the
 * user *what* they're looking at without parsing the name string.
 */
function KindIcon({ kind }: { kind: string }) {
  const className = 'h-4 w-4 text-muted-foreground shrink-0';
  switch (kind) {
    case 'flow':
      return <GitBranch className={className} aria-label="flow" />;
    case 'contract':
      return <FileText className={className} aria-label="contract" />;
    case 'constraint':
      return <CircleAlert className={className} aria-label="constraint" />;
    case 'decision':
      return <ScrollText className={className} aria-label="decision" />;
    case 'open_question':
      return <HelpCircle className={className} aria-label="open question" />;
    case 'resolved_question':
      return <CheckCircle2 className={className} aria-label="resolved question" />;
    case 'attempt':
      return <Lightbulb className={className} aria-label="attempt" />;
    default:
      return <FileText className={className} aria-label="result" />;
  }
}

/**
 * Map substrate state → hex color matching plan 13-01 CVA variants exactly.
 * Returns null when there is no badge to render (contract hits or fresh
 * substrate — fresh state implies "no warning" and gets no decoration).
 */
function badgeStyleFor(state: string | null): { bg: string; ring: string; label: string } | null {
  if (!state || state === 'fresh') return null;
  switch (state) {
    case 'intent_drifted':
      // orange-600 — matches plan 13-01 intent_drifted CVA exactly. The
      // lightest possible visual cue at the palette scale (no glow / pulse —
      // those are reserved for canvas where the visual real-estate supports
      // them).
      return { bg: 'rgba(234, 88, 12, 0.20)', ring: 'rgba(234, 88, 12, 0.55)', label: 'drifted' };
    case 'superseded':
      // orange-400 — softer than intent_drifted. Matches plan 13-01 too.
      return { bg: 'rgba(251, 146, 60, 0.18)', ring: 'rgba(251, 146, 60, 0.50)', label: 'superseded' };
    case 'stale':
      // amber-500 — Phase 13-09 sync may emit this; render preview-style
      // matching plan 13-02 SidebarAreaItem rollup-stale badge.
      return { bg: 'rgba(245, 158, 11, 0.18)', ring: 'rgba(245, 158, 11, 0.50)', label: 'stale' };
    default:
      return null;
  }
}

/**
 * Single palette row. The OUTER `<Command.Item>` lives in `IntentPalette.tsx`
 * — this component only renders the row contents.
 */
export function IntentPaletteHit({ hit }: { hit: IntentSearchHit }) {
  const badge = badgeStyleFor(hit.state);
  return (
    <div className="flex items-center gap-2 py-0.5 min-w-0">
      <KindIcon kind={hit.kind} />
      <div className="flex flex-col flex-1 min-w-0">
        <span className="text-sm font-medium truncate">{hit.name}</span>
        {hit.summary && (
          <span className="text-xs text-muted-foreground truncate">{hit.summary}</span>
        )}
      </div>
      {badge && (
        <span
          className="rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wide ring-1 shrink-0"
          style={{
            backgroundColor: badge.bg,
            // ring-1 with custom color via box-shadow inset — Tailwind's
            // ring-* utilities don't accept arbitrary hex without a custom
            // value, and the substrate hex values are too specific to bake
            // into Tailwind config for one component.
            boxShadow: `inset 0 0 0 1px ${badge.ring}`,
            color: badge.ring,
          }}
        >
          {badge.label}
        </span>
      )}
      {hit.level && (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 shrink-0">
          {hit.level}
        </span>
      )}
    </div>
  );
}
