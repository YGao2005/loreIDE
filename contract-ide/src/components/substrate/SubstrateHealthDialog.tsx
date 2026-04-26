/**
 * Phase 15 Plan 05 — SubstrateHealthDialog.
 *
 * Reachable from the SubstrateStatusIndicator footer (tombstone badge).
 * Lists chain-head tombstoned rules (RESEARCH Pitfall 5 semantic — NOT mid-chain).
 * Each row exposes a Restore action that calls restore_substrate_rule Rust IPC.
 *
 * Success path: row disappears from local state + DOM toast "Rule restored —
 *   '<name>' is active again".
 * Error path: inline red message on the row; row stays visible; user can retry.
 *
 * Does NOT close the dialog on restore success — user may want to restore multiple.
 * The parent (SubstrateStatusIndicator) refreshes the tombstone count on dialog close.
 *
 * Design: shadcn Dialog, max-w-2xl. Uses project DOM-toast pattern (no toast library).
 * Reason parsing: split invalidated_reason on first ': ' → reason_kind + reason_text.
 * Relative time: simple "X minutes/hours/days ago" helper (no external lib).
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { listTombstonedRules, restoreSubstrateRule, type TombstonedRule } from '@/ipc/substrateTrust';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Simple relative-time formatter — no external lib required. */
function relativeTime(isoString: string | null): string {
  if (!isoString) return 'unknown time';
  const delta = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours === 1 ? '1 hour' : `${hours} hours`} ago`;
  const days = Math.floor(hours / 24);
  return `${days === 1 ? '1 day' : `${days} days`} ago`;
}

/** Parse '<kind>: <text>' into two parts; fallback to raw if no separator. */
function parseReason(reason: string | null): { kind: string; text: string } {
  if (!reason) return { kind: '', text: '' };
  const idx = reason.indexOf(': ');
  if (idx === -1) return { kind: '', text: reason };
  return { kind: reason.slice(0, idx), text: reason.slice(idx + 2) };
}

/** Fire a DOM toast (project pattern — no toast library). Bottom-right position. */
function showToast(message: string, variant: 'default' | 'success' = 'default') {
  const el = document.createElement('div');
  el.textContent = message;
  const borderColor =
    variant === 'success'
      ? 'var(--primary,#7c3aed)'
      : 'var(--border,#333)';
  el.style.cssText = [
    'position:fixed',
    'bottom:2.5rem',
    'right:2rem',
    'background:var(--background,#1a1a1a)',
    'color:var(--foreground,#fff)',
    `border:1px solid ${borderColor}`,
    'border-radius:6px',
    'padding:8px 14px',
    'font-size:11px',
    'font-family:var(--font-geist-sans,sans-serif)',
    'z-index:9999',
    'pointer-events:none',
    'opacity:1',
    'transition:opacity 0.3s ease',
  ].join(';');
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 350);
  }, 4000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Row sub-component
// ─────────────────────────────────────────────────────────────────────────────

interface RowProps {
  rule: TombstonedRule;
  onRestored: (uuid: string) => void;
}

function TombstonedRuleRow({ rule, onRestored }: RowProps) {
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { kind: reasonKind, text: reasonText } = parseReason(rule.invalidated_reason);

  async function handleRestore() {
    setRestoring(true);
    setError(null);
    try {
      await restoreSubstrateRule(rule.uuid);
      onRestored(rule.uuid);
      showToast(`Rule restored — '${rule.name}' is active again`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Could not restore: ${msg}`);
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-border/50 last:border-0">
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        {/* Line 1: kind badge + rule name */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
            {rule.kind || 'rule'}
          </span>
          <span className="text-sm font-medium truncate">{rule.name}</span>
        </div>

        {/* Line 2: parsed reason */}
        {rule.invalidated_reason && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {reasonKind ? (
              <>
                <span className="font-medium">{reasonKind}</span>
                {reasonText && <> · {reasonText}</>}
              </>
            ) : (
              rule.invalidated_reason
            )}
          </p>
        )}

        {/* Line 3: relative timestamp + actor */}
        <p className="text-[10px] text-muted-foreground/70 mt-0.5">
          Tombstoned {relativeTime(rule.invalidated_at)}
          {rule.invalidated_by && (
            <> by <span className="font-mono">{rule.invalidated_by}</span></>
          )}
        </p>

        {/* Inline error (active-successor guard or other failure) */}
        {error && (
          <p className="text-[10px] text-destructive mt-1 leading-snug">{error}</p>
        )}
      </div>

      {/* Restore button */}
      <Button
        variant="outline"
        size="sm"
        className="shrink-0 h-7 text-xs"
        onClick={handleRestore}
        disabled={restoring}
      >
        {restoring ? 'Restoring…' : 'Restore'}
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main dialog
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SubstrateHealthDialog({ open, onOpenChange }: Props) {
  const [rules, setRules] = useState<TombstonedRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await listTombstonedRules();
      setRules(list);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadError(`Could not load tombstoned rules: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load when dialog opens
  useEffect(() => {
    if (open) {
      void load();
    } else {
      // Clear state on close so next open starts fresh
      setRules([]);
      setLoadError(null);
    }
  }, [open, load]);

  function handleRestored(uuid: string) {
    // Optimistically remove the row from local state
    setRules((prev) => prev.filter((r) => r.uuid !== uuid));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Substrate Health</DialogTitle>
          <DialogDescription>
            Tombstoned rules — review or restore
          </DialogDescription>
        </DialogHeader>

        {/* Body */}
        <div className="max-h-[55vh] overflow-y-auto -mx-1 px-1">
          {loading && (
            <div className="flex flex-col gap-2 py-4">
              {/* Skeleton lines */}
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex gap-3 items-start py-3 border-b border-border/50">
                  <div className="flex flex-col gap-1.5 flex-1">
                    <div className="h-3 w-24 bg-muted/60 rounded animate-pulse" />
                    <div className="h-3 w-3/4 bg-muted/40 rounded animate-pulse" />
                    <div className="h-2.5 w-40 bg-muted/30 rounded animate-pulse" />
                  </div>
                  <div className="h-7 w-16 bg-muted/40 rounded animate-pulse shrink-0" />
                </div>
              ))}
            </div>
          )}

          {!loading && loadError && (
            <p className="text-sm text-destructive py-4 text-center">{loadError}</p>
          )}

          {!loading && !loadError && rules.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 gap-1.5">
              <p className="text-sm font-medium">Nothing tombstoned.</p>
              <p className="text-xs text-muted-foreground">Your substrate is healthy.</p>
            </div>
          )}

          {!loading && !loadError && rules.length > 0 && (
            <div>
              {rules.map((rule) => (
                <TombstonedRuleRow
                  key={rule.uuid}
                  rule={rule}
                  onRestored={handleRestored}
                />
              ))}
            </div>
          )}
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
