/**
 * Phase 13 Plan 03 — single hit row for the Cmd+P IntentPalette (SUB-08).
 * 2026-04-25 redesign — destination clarity pass per Yang feedback.
 *
 * Each row now answers three questions at a glance:
 *   1. What is this?      → KindIcon + kind badge ("Screen", "API", "Decision")
 *   2. Where does it live? → parent-name breadcrumb under the title
 *   3. What does clicking do? → destination hint at the right edge
 *      ("→ Open screen", "→ Zoom to node", "→ Open rule")
 *
 * The destination hint is the load-bearing piece: users were unable to predict
 * which click would open the iframe, which would zoom into a backend node, and
 * which would pop the rule editor. The hint surfaces that decision before the
 * click instead of after.
 *
 * Layout:
 *   [icon] [name]                                [Kind badge]
 *          [parent breadcrumb · summary]         [→ destination]
 *
 * The right column stacks the kind badge over the destination hint so both
 * stay visible on narrow palette widths. State badge (intent_drifted /
 * superseded) replaces the destination hint on substrate hits where the state
 * is the urgent signal.
 */

import {
  FileText,
  GitBranch,
  CircleAlert,
  ScrollText,
  HelpCircle,
  CheckCircle2,
  Lightbulb,
  Monitor,
  Zap,
  Database,
  Cloud,
  Boxes,
  Component,
  Calendar,
  Bell,
  ArrowRight,
} from 'lucide-react';
import type { IntentSearchHit } from '@/ipc/substrate';
import { useGraphStore } from '@/store/graph';
import {
  destinationHint,
  isSubstrateKind,
  kindLabel,
  resolveDestination,
} from './IntentPalette';

/**
 * Map kind → lucide icon. Differentiated per node_kind for contracts so the
 * row visually clusters by what-it-is at a glance — Screen vs API vs Lib are
 * meaningfully different things and should look different.
 */
function KindIcon({ hit }: { hit: IntentSearchHit }) {
  const className = 'h-4 w-4 text-muted-foreground shrink-0';
  // Substrate kinds first — they have distinct glyphs already.
  switch (hit.kind) {
    case 'flow':
      return <GitBranch className={className} aria-label="flow" />;
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
  }
  // Contract hits — branch on node_kind for kind-specific icons.
  if (hit.kind === 'contract') {
    if (hit.node_kind === 'UI' && hit.level === 'L4') {
      return <Component className={className} aria-label="component" />;
    }
    if (hit.node_kind === 'UI') {
      return <Monitor className={className} aria-label="screen" />;
    }
    if (hit.node_kind === 'API') {
      return <Zap className={className} aria-label="api endpoint" />;
    }
    if (hit.node_kind === 'lib') {
      return <Boxes className={className} aria-label="lib" />;
    }
    if (hit.node_kind === 'data') {
      return <Database className={className} aria-label="data" />;
    }
    if (hit.node_kind === 'external') {
      return <Cloud className={className} aria-label="external" />;
    }
    if (hit.node_kind === 'cron') {
      return <Calendar className={className} aria-label="cron" />;
    }
    if (hit.node_kind === 'event') {
      return <Bell className={className} aria-label="event" />;
    }
  }
  return <FileText className={className} aria-label="result" />;
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
      return { bg: 'rgba(234, 88, 12, 0.20)', ring: 'rgba(234, 88, 12, 0.55)', label: 'drifted' };
    case 'superseded':
      return { bg: 'rgba(251, 146, 60, 0.18)', ring: 'rgba(251, 146, 60, 0.50)', label: 'superseded' };
    case 'stale':
      return { bg: 'rgba(245, 158, 11, 0.18)', ring: 'rgba(245, 158, 11, 0.50)', label: 'stale' };
    default:
      return null;
  }
}

/**
 * Lookup parent name from the loaded contract set. Returns the parent's
 * `name` if present in `useGraphStore.nodes`, else null. Used to render the
 * "in <Parent>" hint under the row title for L4 components and substrate
 * hits where parent context is more useful than the body summary.
 */
function useParentName(parentUuid: string | null): string | null {
  return useGraphStore((s) => {
    if (!parentUuid) return null;
    const parent = s.nodes.find((n) => n.uuid === parentUuid);
    return parent?.name ?? null;
  });
}

/**
 * Single palette row. The OUTER `<Command.Item>` lives in `IntentPalette.tsx`
 * — this component only renders the row contents.
 */
export function IntentPaletteHit({ hit }: { hit: IntentSearchHit }) {
  const stateBadge = badgeStyleFor(hit.state);
  const dest = resolveDestination(hit);
  const parentName = useParentName(hit.parent_uuid);
  const isSub = isSubstrateKind(hit.kind);

  // Secondary line strategy:
  //   - L4 component / substrate hit: parent name (more useful than body —
  //     "DangerZone in Account Settings" beats showing the first 60 chars
  //     of contract body).
  //   - Anything else: body summary (the body IS the useful preview).
  const secondaryLine =
    (hit.kind === 'contract' && hit.node_kind === 'UI' && hit.level === 'L4' && parentName)
      ? `in ${parentName}`
      : isSub && parentName
      ? `on ${parentName}`
      : hit.summary;

  return (
    <div className="flex items-start gap-2.5 py-1 min-w-0">
      <div className="pt-0.5">
        <KindIcon hit={hit} />
      </div>
      <div className="flex flex-col flex-1 min-w-0">
        <span className="text-sm font-medium truncate leading-tight">
          {hit.name}
        </span>
        {secondaryLine && (
          <span className="text-xs text-muted-foreground truncate leading-snug mt-0.5">
            {secondaryLine}
          </span>
        )}
      </div>
      <div className="flex flex-col items-end gap-0.5 shrink-0 pt-0.5">
        {/* Top: kind badge — what is this? */}
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80 leading-none">
          {kindLabel(hit)}
        </span>
        {/* Bottom: state badge wins over destination hint when present
            (intent_drifted / superseded is more urgent than navigation
            preview). Otherwise show the destination hint. */}
        {stateBadge ? (
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wide ring-1 leading-none mt-0.5"
            style={{
              backgroundColor: stateBadge.bg,
              boxShadow: `inset 0 0 0 1px ${stateBadge.ring}`,
              color: stateBadge.ring,
            }}
          >
            {stateBadge.label}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60 leading-none mt-0.5">
            <ArrowRight className="h-2.5 w-2.5" aria-hidden />
            {destinationHint(dest)}
          </span>
        )}
      </div>
    </div>
  );
}
