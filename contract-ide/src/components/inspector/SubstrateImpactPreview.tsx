/**
 * Phase 15 Plan 04 — TRUST-03: Impact preview component.
 *
 * Calls getSubstrateImpact(uuid) on mount. Renders two grouped sections:
 *   1. "Atoms citing this rule" — count + bullet list (first 10 + "and N more")
 *   2. "Recent agent prompts (past 7 days)" — count + bullet list (first 5 + "and N more")
 *
 * Shows skeleton lines while loading. On error, shows muted red text.
 * Bubbles the loaded impact up via onLoad so DeleteRuleConfirmDialog can use
 * atom_count for the success toast.
 */

import { useEffect, useState } from 'react';
import { getSubstrateImpact, type SubstrateImpact } from '@/ipc/substrateTrust';

const ATOM_DISPLAY_LIMIT = 10;
const PROMPT_DISPLAY_LIMIT = 5;

interface Props {
  uuid: string;
  /** Called once when the impact data loads successfully. Parent uses atom_count for toast. */
  onLoad?: (impact: SubstrateImpact) => void;
}

function SkeletonLine({ width = 'w-full' }: { width?: string }) {
  return (
    <div
      className={`h-3 animate-pulse rounded bg-muted/50 ${width}`}
      aria-hidden="true"
    />
  );
}

/** Format ISO timestamp to a readable relative string for display. */
function relativeDate(iso: string): string {
  try {
    const date = new Date(iso);
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return '1 day ago';
    return `${diffDays} days ago`;
  } catch {
    return iso;
  }
}

export function SubstrateImpactPreview({ uuid, onLoad }: Props) {
  const [impact, setImpact] = useState<SubstrateImpact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setImpact(null);
    setError(null);

    getSubstrateImpact(uuid)
      .then((data) => {
        if (cancelled) return;
        setImpact(data);
        onLoad?.(data);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[SubstrateImpactPreview] impact query failed:', msg);
        setError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [uuid]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="space-y-2">
          <SkeletonLine width="w-1/3" />
          <SkeletonLine width="w-2/3" />
          <SkeletonLine width="w-1/2" />
        </div>
        <div className="space-y-2">
          <SkeletonLine width="w-1/3" />
          <SkeletonLine width="w-3/4" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-[11px] text-destructive/70">
        Could not load impact preview — {error}
      </p>
    );
  }

  if (!impact) return null;

  const visibleAtoms = impact.atoms.slice(0, ATOM_DISPLAY_LIMIT);
  const moreAtoms = impact.atom_count - ATOM_DISPLAY_LIMIT;

  const visiblePrompts = impact.recent_prompts.slice(0, PROMPT_DISPLAY_LIMIT);
  const morePrompts = impact.recent_prompt_count - PROMPT_DISPLAY_LIMIT;

  return (
    <div className="rounded border border-border/60 bg-muted/20 p-3 space-y-4 text-[11px]">
      {/* Section 1: Atoms citing this rule */}
      <div className="space-y-1.5">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-semibold tabular-nums text-foreground">
            {impact.atom_count}
          </span>
          <span className="font-medium text-foreground/80">
            {impact.atom_count === 1 ? 'atom cites this rule' : 'atoms cite this rule'}
          </span>
        </div>

        {impact.atom_count === 0 ? (
          <p className="text-muted-foreground">No atoms currently cite this rule.</p>
        ) : (
          <ul className="space-y-0.5 pl-1">
            {visibleAtoms.map((atom) => (
              <li key={atom.uuid} className="flex items-center gap-1.5">
                <span className="text-foreground/90 truncate max-w-[200px]" title={atom.name}>
                  {atom.name}
                </span>
                <span className="text-muted-foreground/70 shrink-0">
                  [{atom.kind} L{atom.level}]
                </span>
              </li>
            ))}
            {moreAtoms > 0 && (
              <li className="text-muted-foreground/60 italic">
                and {moreAtoms} more
              </li>
            )}
          </ul>
        )}
      </div>

      {/* Section 2: Recent agent prompts */}
      <div className="space-y-1.5 border-t border-border/40 pt-3">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-semibold tabular-nums text-foreground">
            {impact.recent_prompt_count}
          </span>
          <span className="font-medium text-foreground/80">
            {impact.recent_prompt_count === 1
              ? 'agent prompt referenced it (past 7 days)'
              : 'agent prompts referenced it (past 7 days)'}
          </span>
        </div>

        {impact.recent_prompt_count === 0 ? (
          <p className="text-muted-foreground">No recent agent prompts referenced this rule.</p>
        ) : (
          <ul className="space-y-1 pl-1">
            {visiblePrompts.map((p) => (
              <li key={p.receipt_id} className="flex items-start gap-1.5">
                <span className="text-foreground/80 leading-tight line-clamp-1 flex-1">
                  {p.prompt_excerpt || (
                    <span className="italic text-muted-foreground">(no excerpt)</span>
                  )}
                </span>
                <span className="text-muted-foreground/60 shrink-0 tabular-nums">
                  {relativeDate(p.created_at)}
                </span>
              </li>
            ))}
            {morePrompts > 0 && (
              <li className="text-muted-foreground/60 italic">
                and {morePrompts} more
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
