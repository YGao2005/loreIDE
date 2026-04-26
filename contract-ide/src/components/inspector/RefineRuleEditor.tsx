/**
 * Phase 15 Plan 03 — TRUST-02: Inline refine editor for substrate rules.
 *
 * Rendered inside SourceArchaeologyModal when the user clicks "Refine" (or ⌘E).
 * Pre-populated with the current rule's text + applies_when from the detail fetch.
 * Save is disabled until: reason is non-empty AND text differs from initialText.
 * On error, displays the error inline in red (does not close the editor).
 */

import { useState } from 'react';
import { refineSubstrateRule } from '@/ipc/substrateTrust';

interface Props {
  uuid: string;
  initialText: string;
  initialAppliesWhen: string;
  onSave: (newUuid: string) => void;
  onCancel: () => void;
}

export function RefineRuleEditor({ uuid, initialText, initialAppliesWhen, onSave, onCancel }: Props) {
  const [text, setText] = useState(initialText);
  const [appliesWhen, setAppliesWhen] = useState(initialAppliesWhen);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = reason.trim().length > 0 && text.trim() !== initialText.trim();

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      const newUuid = await refineSubstrateRule(
        uuid,
        text.trim(),
        appliesWhen.trim() || null,
        reason.trim(),
      );
      onSave(newUuid);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 transition-opacity duration-150 animate-in fade-in">
      {/* Rule text */}
      <div className="space-y-1">
        <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Rule text
        </label>
        <textarea
          className="w-full rounded border border-border bg-muted/20 px-3 py-2 text-sm font-mono
                     resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Rule text…"
          disabled={saving}
        />
      </div>

      {/* Applies-when */}
      <div className="space-y-1">
        <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Applies when
          <span className="ml-1 normal-case text-muted-foreground/60">(optional)</span>
        </label>
        <textarea
          className="w-full rounded border border-border bg-muted/20 px-3 py-2 text-sm font-mono
                     resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          rows={3}
          value={appliesWhen}
          onChange={(e) => setAppliesWhen(e.target.value)}
          placeholder="Describes when this rule applies (e.g. 'any destructive action')…"
          disabled={saving}
        />
      </div>

      {/* Reason — required */}
      <div className="space-y-1">
        <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Reason <span className="text-destructive">*</span>
        </label>
        <input
          type="text"
          className="w-full rounded border border-border bg-muted/20 px-3 py-2 text-sm
                     focus:outline-none focus:ring-1 focus:ring-ring"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why are you refining this rule? (e.g., narrowing scope to destructive actions)"
          disabled={saving}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSave();
            }
          }}
        />
      </div>

      {/* Error display */}
      {error && (
        <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={!canSave || saving}
          className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium
                     text-primary-foreground transition-opacity
                     disabled:cursor-not-allowed disabled:opacity-40
                     hover:enabled:opacity-90"
        >
          {saving ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
              Saving…
            </>
          ) : (
            'Save'
          )}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="rounded px-3 py-1.5 text-sm text-muted-foreground
                     transition-colors hover:text-foreground disabled:opacity-40"
        >
          Cancel
        </button>
        {!canSave && reason.trim().length > 0 && text.trim() === initialText.trim() && (
          <span className="text-[11px] text-muted-foreground">
            Change the rule text to enable Save
          </span>
        )}
      </div>
    </div>
  );
}
