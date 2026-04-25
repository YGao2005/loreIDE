/**
 * PlanReviewPanel — Phase 11 Plan 04.
 *
 * "Plan ready — review before dispatch"
 *
 * Shows three groups:
 *   1. Target files (file paths the agent intends to touch)
 *   2. Substrate rules cited (uuid + one-line description)
 *   3. Implicit decisions preview (key + chosen_value — NOT full rationale)
 *
 * Action buttons: [Approve] [Edit prompt] [Cancel]
 *
 * Edit prompt: opens an inline [Preview prompt] expander pre-filled with the
 * assembledPrompt; user edits, clicks Re-plan to re-run delegate_plan with
 * the edited prompt; loops until Approve. Cancel returns to idle (no agent
 * execution; planning is read-only).
 */

import { useState } from 'react';
import type { StructuredPlan } from '../../ipc/delegate';

interface PlanReviewPanelProps {
  plan: StructuredPlan;
  assembledPrompt: string;
  onApprove: () => void;
  onEditAndReplan: (newPrompt: string) => void;
  onCancel: () => void;
}

export function PlanReviewPanel({
  plan,
  assembledPrompt,
  onApprove,
  onEditAndReplan,
  onCancel,
}: PlanReviewPanelProps) {
  const [editedPrompt, setEditedPrompt] = useState(assembledPrompt);
  const [editOpen, setEditOpen] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-background p-4 shadow-lg">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Plan ready — review before dispatch</h3>
      </div>

      {/* Target files */}
      <div className="mb-3">
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          Target files ({plan.target_files.length})
        </div>
        {plan.target_files.length > 0 ? (
          <ul className="space-y-0.5 font-mono text-xs">
            {plan.target_files.map((f) => (
              <li key={f} className="truncate" title={f}>
                {f}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">(none identified)</p>
        )}
      </div>

      {/* Substrate rules cited */}
      <div className="mb-3">
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          Substrate rules cited ({plan.substrate_rules.length})
        </div>
        {plan.substrate_rules.length > 0 ? (
          <ul className="space-y-1 text-xs">
            {plan.substrate_rules.map((r) => (
              <li key={r.uuid} className="flex items-start gap-2">
                <span className="text-muted-foreground" aria-hidden>
                  •
                </span>
                <span>
                  <span className="mr-1.5 font-mono text-muted-foreground">
                    {r.uuid.slice(0, 18)}
                  </span>
                  {r.one_line}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">(none cited)</p>
        )}
      </div>

      {/* Implicit decisions preview */}
      <div className="mb-4">
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          Implicit decisions preview ({plan.decisions_preview.length})
        </div>
        {plan.decisions_preview.length > 0 ? (
          <ul className="space-y-1 text-xs">
            {plan.decisions_preview.map((d) => (
              <li key={d.key} className="flex items-baseline gap-2">
                <span className="font-mono text-muted-foreground">{d.key}:</span>
                <span className="font-medium">{d.chosen_value}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">(none previewed)</p>
        )}
      </div>

      {/* Edit prompt expander — [Preview prompt ▾] */}
      <details
        className="mb-3"
        open={editOpen}
        onToggle={(e) => setEditOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground select-none">
          Preview prompt {editOpen ? '▴' : '▾'}
        </summary>
        <div className="mt-2">
          <textarea
            value={editedPrompt}
            onChange={(e) => setEditedPrompt(e.target.value)}
            rows={12}
            className="w-full rounded border border-border bg-muted/30 p-2 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-border"
            spellCheck={false}
          />
          <button
            onClick={() => onEditAndReplan(editedPrompt)}
            disabled={editedPrompt === assembledPrompt}
            type="button"
            className="mt-2 rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            Re-plan
          </button>
        </div>
      </details>

      {/* Action buttons */}
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          type="button"
          className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted"
        >
          Cancel
        </button>
        <button
          onClick={onApprove}
          type="button"
          className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Approve
        </button>
      </div>
    </div>
  );
}
