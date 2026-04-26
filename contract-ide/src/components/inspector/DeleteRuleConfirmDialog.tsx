/**
 * Phase 15 Plan 04 — TRUST-03: Delete confirmation dialog.
 *
 * Three required sections:
 *   1. Reason picker — shadcn RadioGroup with 5 options using demo-grade copy
 *      (labels are visual-only; wire values are what the IPC validates).
 *   2. Free-text amplification textarea — required when Other selected, optional otherwise.
 *   3. SubstrateImpactPreview — auto-loaded on dialog mount; shows blast radius.
 *
 * Confirm button disabled until: reason selected AND (if Other) free-text non-empty.
 * On success: calls onConfirmed(atomCount) for the parent to fire a toast + close modal.
 *
 * Demo-grade copy: labels use natural language, not raw enum strings.
 * Wire values (sent to Rust IPC): "Hallucinated" | "Obsolete" | "Wrong scope" | "Duplicate" | "Other"
 */

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { deleteSubstrateRule, type DeleteReasonKind, type SubstrateImpact } from '@/ipc/substrateTrust';
import { SubstrateImpactPreview } from './SubstrateImpactPreview';

/** Mapping: user-facing display copy → wire value sent to Rust IPC. */
const REASONS: { label: string; value: DeleteReasonKind }[] = [
  { label: 'Wrong (hallucinated)',  value: 'Hallucinated' },
  { label: 'Outdated',              value: 'Obsolete'     },
  { label: 'Scope mismatch',        value: 'Wrong scope'  },
  { label: 'Duplicate',             value: 'Duplicate'    },
  { label: 'Other reason',          value: 'Other'        },
];

interface Props {
  uuid: string;
  /** Called after successful delete. Parent uses atomCount for the sonner/DOM toast. */
  onConfirmed: (atomCount: number) => void;
  onCancel: () => void;
}

export function DeleteRuleConfirmDialog({ uuid, onConfirmed, onCancel }: Props) {
  const [reasonKind, setReasonKind] = useState<DeleteReasonKind | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [impact, setImpact] = useState<SubstrateImpact | null>(null);

  // Confirm button gate: reason must be selected; if Other, free-text must be non-empty
  const canConfirm =
    reasonKind !== null &&
    (reasonKind !== 'Other' || reasonText.trim().length > 0);

  async function handleConfirm() {
    if (!canConfirm || !reasonKind) return;
    setConfirming(true);
    setError(null);
    try {
      await deleteSubstrateRule(uuid, reasonKind, reasonText);
      onConfirmed(impact?.atom_count ?? 0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setConfirming(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-lg sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-destructive">Delete this rule?</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* Section 1: Reason picker — native radio inputs, styled to match project tokens */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground/80">Reason</p>
            <div className="space-y-1.5">
              {REASONS.map(({ label, value }) => (
                <div key={value} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="delete-reason"
                    id={`delete-reason-${value}`}
                    value={value}
                    checked={reasonKind === value}
                    onChange={() => setReasonKind(value)}
                    className="shrink-0 accent-destructive cursor-pointer"
                  />
                  <Label
                    htmlFor={`delete-reason-${value}`}
                    className="cursor-pointer text-sm font-normal"
                  >
                    {label}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          {/* Section 2: Free-text amplification */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground/80">
              Details{' '}
              <span className="text-muted-foreground font-normal">
                {reasonKind === 'Other' ? '(required)' : '(optional)'}
              </span>
            </p>
            <textarea
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              placeholder="Why? (e.g., this rule was inferred from a one-off thread, not a real team decision)"
              className={[
                'w-full rounded border bg-muted/20 px-3 py-2 text-sm leading-relaxed',
                'placeholder:text-muted-foreground/60 resize-none outline-none',
                'focus:ring-1 focus:ring-ring transition-colors',
                reasonKind === 'Other' && reasonText.trim().length === 0
                  ? 'border-destructive/60'
                  : 'border-border',
              ].join(' ')}
              rows={3}
            />
          </div>

          {/* Section 3: Impact preview — auto-loaded on mount */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground/80">Impact preview</p>
            <SubstrateImpactPreview
              uuid={uuid}
              onLoad={(data) => setImpact(data)}
            />
          </div>

          {/* Error feedback (shown below impact, above footer) */}
          {error && (
            <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1.5">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={confirming}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!canConfirm || confirming}
            className="min-w-[80px]"
          >
            {confirming ? (
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                Deleting…
              </span>
            ) : (
              'Confirm'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
