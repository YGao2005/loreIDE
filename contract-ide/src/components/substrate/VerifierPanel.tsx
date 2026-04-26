/**
 * Phase 13 Plan 09 — Beat 3 streaming verifier panel.
 *
 * Renders the script Beat 3 verifier output:
 *   ✓ N substrate-honored rows (with [source] citation pills)
 *   ℹ Implicit decisions group of 3 hand-crafted rows
 *   ⚠ Parent-surface orange flag, with halo landing on the SCREEN CARD
 *     (parent surface), not on a service card — per script + SC 6.
 *
 * The screen-card halo is driven via useCitationStore.highlight with a longer
 * duration (8s) so the demo audience can see it during the read-out. Halo
 * additivity from plan 13-07's citationHaloClass keeps the orange flag's
 * blue halo composable with whatever ring color the screen card already has
 * (drifted, intent_drifted, etc.).
 */

import { useEffect } from 'react';
import { useVerifierStore } from '@/store/verifier';
import { useCitationStore } from '@/store/citation';
import { ImplicitDecisionsGroup } from './ImplicitDecisionsGroup';
import { SubstrateCitation } from '@/components/inspector/SubstrateCitation';

const SCREEN_CARD_HALO_MS = 8000;

export function VerifierPanel() {
  const open = useVerifierStore((s) => s.open);
  const rows = useVerifierStore((s) => s.rows);
  const implicit = useVerifierStore((s) => s.implicitDecisions);
  const setOpen = useVerifierStore((s) => s.setOpen);
  const highlight = useCitationStore((s) => s.highlight);

  // Halo the parent surface for any flag row when the panel opens. Halo on
  // the SCREEN CARD (parent surface), not on a service card — visually
  // obvious that the conflict lives at parent level per SC 6.
  useEffect(() => {
    if (!open) return;
    const flagRow = rows.find((r) => r.kind === 'flag' && r.parentSurfaceUuid);
    if (flagRow?.parentSurfaceUuid) {
      highlight(flagRow.parentSurfaceUuid, SCREEN_CARD_HALO_MS);
    }
  }, [open, rows, highlight]);

  if (!open) return null;

  const honors = rows.filter((r) => r.kind === 'honor');
  const flags = rows.filter((r) => r.kind === 'flag');

  return (
    <div className="fixed right-4 top-16 w-[380px] rounded-lg border border-border/50 bg-background/95 shadow-xl backdrop-blur z-30 p-3">
      <header className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium">Verify against intent</h4>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-muted-foreground hover:text-foreground"
          aria-label="Close verifier panel"
        >
          ✕
        </button>
      </header>
      <div className="space-y-1.5">
        {honors.map((r, i) => (
          <div key={`honor-${i}`} className="text-xs flex items-start gap-1">
            <span className="text-green-400 mt-0.5">✓</span>
            <div className="flex-1">
              {r.ruleUuid ? (
                <SubstrateCitation uuid={r.ruleUuid} shortLabel={r.ruleName} />
              ) : (
                <span className="font-medium">{r.ruleName}</span>
              )}{' '}
              <span className="text-muted-foreground">— {r.detail}</span>
            </div>
          </div>
        ))}

        <ImplicitDecisionsGroup rows={implicit} />

        {flags.map((r, i) => (
          <div
            key={`flag-${i}`}
            className="mt-2 rounded border border-orange-500/40 bg-orange-500/10 p-2 text-xs"
          >
            <div className="flex items-start gap-1">
              <span className="text-orange-300 mt-0.5">⚠</span>
              <div className="flex-1">
                <div className="text-orange-200 font-medium flex items-center gap-1 flex-wrap">
                  {r.ruleUuid ? (
                    <SubstrateCitation uuid={r.ruleUuid} shortLabel={r.ruleName} />
                  ) : (
                    <span>{r.ruleName}</span>
                  )}
                </div>
                <div className="text-muted-foreground mt-0.5">{r.detail}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
