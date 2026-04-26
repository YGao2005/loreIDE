/**
 * Phase 13 Plan 07 — `[source]` inline citation pill.
 *
 * Rendered inline in verifier output, intent summaries, and any surface that
 * cites a substrate node. Click → opens the SourceArchaeologyModal AND (when
 * `haloOnClick`, the default) ripples a 2s halo to the corresponding card /
 * chip in the chain via useCitationStore.
 *
 * The script's Beat 3 ("Citation jumps me to the code AND highlights the
 * participant in the chain — two clicks to investigate any decision in this
 * PR.") rests on this dual behaviour. Setting `haloOnClick={false}` is reserved
 * for cases where a citation lives ALREADY on a haloed surface (avoids
 * self-halo).
 */

import { memo } from 'react';
import { useCitationStore } from '@/store/citation';

export interface SubstrateCitationProps {
  /** Substrate node uuid the citation refers to. */
  uuid: string;
  /**
   * Optional short label rendered inside the brackets (e.g. a slug like
   * `dec-soft-delete-30day-grace`). Falls back to the uuid's first 16 chars
   * when omitted — the modal then reveals the canonical name on open.
   */
  shortLabel?: string;
  /**
   * When true (default) clicking the pill ALSO triggers a 2s halo across the
   * canvas. Beat-3-sidebar usage wants this; an in-modal back-reference
   * citation might pass `false` to avoid self-halo loops.
   */
  haloOnClick?: boolean;
}

function SubstrateCitationImpl({
  uuid,
  shortLabel,
  haloOnClick = true,
}: SubstrateCitationProps) {
  const open = useCitationStore((s) => s.openCitation);
  const highlight = useCitationStore((s) => s.highlight);
  const label = shortLabel ?? uuid.slice(0, 16);

  return (
    <button
      type="button"
      onClick={(e) => {
        // stopPropagation so the click doesn't bubble into a parent card and
        // re-trigger node selection — citation pills are a strict overlay
        // affordance, never a selection trigger.
        e.stopPropagation();
        open(uuid);
        if (haloOnClick) highlight(uuid);
      }}
      className="inline-flex items-center gap-0.5 rounded-md border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-mono text-blue-300 hover:border-blue-400/60 hover:bg-blue-500/20 transition-colors"
      title={uuid}
    >
      [{label}]
    </button>
  );
}

export const SubstrateCitation = memo(SubstrateCitationImpl);
