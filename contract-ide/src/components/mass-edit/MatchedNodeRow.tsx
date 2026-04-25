/**
 * Phase 9 Plan 09-02 — MatchedNodeRow: per-node row in the MassEditModal.
 *
 * Shows:
 *   - Checkbox (disabled for pinned nodes; controlled by selectedUuids)
 *   - Node identity: name · level · kind badges
 *   - Matched section pill (matchedSection from FTS5 section detection)
 *   - "pinned — will skip" badge when human_pinned is true (predictive — shown
 *     BEFORE apply runs, surfaces the pin state same as the header count)
 *   - Abbreviated snippet preview with FTS5 bold markers rendered as highlights
 *
 * The dangerouslySetInnerHTML on the snippet is acceptable here — snippet
 * content originates exclusively from the user's own contract bodies in their
 * local SQLite DB (no untrusted XSS surface). The only transformation applied
 * is **bold** → <mark> substitution.
 *
 * Pinned nodes have disabled checkboxes because update_contract's DERIVE-03
 * guard will skip them anyway (Pitfall 1 from 09-RESEARCH.md). Surfacing this
 * predictively means the user sees the skip count in the header BEFORE apply
 * runs, not as a silent omission in the result banner.
 */

import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import type { MassMatchResult } from '@/ipc/mass-edit';

interface Props {
  /** The match result from findByIntentMass (human_pinned is a first-class field). */
  match: MassMatchResult;
  /** Whether this node is currently selected for the batch apply. */
  selected: boolean;
  /** Toggle callback — disabled when match.human_pinned is true. */
  onToggle: () => void;
}

export function MatchedNodeRow({ match, selected, onToggle }: Props) {
  // Render FTS5 snippet **bold** markers as amber highlights.
  const highlightedSnippet = match.snippet.replace(
    /\*\*([^*]+)\*\*/g,
    '<mark class="bg-amber-200 rounded-sm px-0.5">$1</mark>',
  );

  return (
    <div className="flex items-start gap-3 p-3 border-b last:border-0 hover:bg-muted/30 transition-colors">
      <Checkbox
        checked={selected}
        onCheckedChange={match.human_pinned ? undefined : onToggle}
        disabled={match.human_pinned}
        aria-label={
          match.human_pinned
            ? `${match.name} — pinned, will skip`
            : `Select ${match.name}`
        }
        className="mt-0.5 shrink-0"
      />

      <div className="flex-1 min-w-0 space-y-1">
        {/* Identity line */}
        <div className="flex items-center flex-wrap gap-1.5">
          <span className="font-medium text-sm truncate max-w-[200px]">
            {match.name}
          </span>
          <Badge variant="outline" className="text-[10px] font-normal shrink-0">
            {match.level} · {match.kind}
          </Badge>
          {match.matched_section && (
            <Badge
              variant="secondary"
              className="text-[10px] font-normal shrink-0"
            >
              ## {match.matched_section}
            </Badge>
          )}
          {match.human_pinned && (
            <Badge className="text-[10px] font-normal shrink-0 bg-amber-100 text-amber-900 border border-amber-200 hover:bg-amber-100">
              pinned — will skip
            </Badge>
          )}
        </div>

        {/* Snippet preview with FTS5 highlights */}
        <div
          className="text-xs text-muted-foreground leading-relaxed line-clamp-3"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: highlightedSnippet }}
        />
      </div>
    </div>
  );
}
