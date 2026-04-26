/**
 * Phase 13 Plan 07 — Source-archaeology modal.
 * Phase 15 Plan 03 — Extended with Detail/History tabs + Refine path (TRUST-02).
 * Phase 15 Plan 04 — Extended with Delete path (TRUST-03): Delete this rule button
 *   opens DeleteRuleConfirmDialog; on success closes modal + fires DOM toast.
 *
 * Renders the verbatim-quote + provenance metadata for a substrate node when
 * a user clicks a `[source]` citation pill. Opens via
 * `useCitationStore.openCitationUuid` and fetches detail via the Phase 13
 * Plan 01 IPC `getSubstrateNodeDetail`.
 *
 * Demo target: ROADMAP SC 7 — "≤5 seconds click-to-readable" — typically
 * <500ms with the IPC; the round-trip is a single SQLite SELECT keyed by uuid.
 *
 * Pitfall 4 (13-RESEARCH.md): hand-seeded fixtures may have NULL
 * `verbatim_quote`. We render an explicit amber warning rather than silently
 * collapsing the section — this surfaces missing fixture data during plan
 * 13-10 demo prep so we don't discover it on stage.
 *
 * Phase 15 Plan 03 additions:
 *   - Detail ↔ History tabs (200ms opacity+translate ease-out per polish bar)
 *   - "Refine" button with ⌘E kbd hint in the header
 *   - ⌘E keyboard shortcut activates Refine when modal is open + Detail tab active
 *   - Escape exits Refine mode (delegated to Dialog's existing Escape handling)
 *   - After Save: fires onRefineSuccess(originalUuid) commit-handshake FIRST,
 *     then re-points modal to new chain head, then switches to History tab
 *   - useCitationStore.onRefineSuccess callback contract for plan 15-06 VerifierPanel
 *
 * Phase 15 Plan 04 additions:
 *   - "Delete this rule" button (destructive variant) in header alongside Refine
 *   - DeleteRuleConfirmDialog opened on click with reason picker + impact preview
 *   - On successful delete: DOM toast "Rule tombstoned — N atoms previously cited it"
 *     (uses project DOM-toast pattern from AppShell, bottom-right position, clear
 *     of the sidebar status indicator which is on the LEFT side)
 *   - Modal closes after delete (closeCitation)
 *   - Toast position: bottom-right — sidebar SubstrateStatusIndicator is on the left,
 *     so bottom-right is unobstructed. Matches AppShell source:click DOM toast style.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCitationStore } from '@/store/citation';
import {
  getSubstrateNodeDetail,
  type SubstrateNodeSummary,
} from '@/ipc/substrate';
import { RefineRuleEditor } from './RefineRuleEditor';
import { SubstrateRuleHistoryTab } from './SubstrateRuleHistoryTab';
import { DeleteRuleConfirmDialog } from './DeleteRuleConfirmDialog';

type ActiveTab = 'detail' | 'history';

export function SourceArchaeologyModal() {
  const openUuid = useCitationStore((s) => s.openCitationUuid);
  const close = useCitationStore((s) => s.closeCitation);
  const openCitation = useCitationStore((s) => s.openCitation);

  const [detail, setDetail] = useState<SubstrateNodeSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('detail');
  const [refining, setRefining] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Stable ref to the uuid at the time Refine was entered — needed for the
  // onRefineSuccess commit-handshake (must fire with the ORIGINAL uuid, not
  // the new chain head returned by the IPC). Cleared when Refine exits.
  const originalUuidRef = useRef<string | null>(null);

  // Reset state when modal opens/closes or uuid changes
  useEffect(() => {
    if (!openUuid) {
      setDetail(null);
      setRefining(false);
      setActiveTab('detail');
      setDeleteDialogOpen(false);
      originalUuidRef.current = null;
      return;
    }
    // When uuid changes (e.g., re-pointed to new chain head after save), reset
    // refining + tab state so we land on Detail with a clean slate.
    setRefining(false);
    setActiveTab('detail');
    setDeleteDialogOpen(false);
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    getSubstrateNodeDetail(openUuid)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[SourceArchaeologyModal] fetch failed:', err);
          setDetail(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [openUuid]);

  // ⌘E keyboard shortcut — activates Refine when modal is open + Detail tab active.
  // Escape while refining exits Refine mode (shadcn Dialog already handles Escape
  // for modal close; we intercept only when refining to prevent full close).
  useEffect(() => {
    if (!openUuid) return;

    function handleKeyDown(e: KeyboardEvent) {
      // ⌘E (macOS Meta+E) — activate Refine if on Detail tab and not already refining
      if ((e.metaKey || e.ctrlKey) && e.key === 'e' && !e.shiftKey) {
        if (activeTab === 'detail' && !refining) {
          e.preventDefault();
          originalUuidRef.current = openUuid;
          setRefining(true);
        }
        return;
      }
      // Escape — exit Refine mode without closing the modal
      if (e.key === 'Escape' && refining) {
        e.preventDefault();
        e.stopPropagation();
        setRefining(false);
        originalUuidRef.current = null;
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [openUuid, activeTab, refining]);

  function handleRefineButtonClick() {
    originalUuidRef.current = openUuid;
    setRefining(true);
  }

  function handleRefineCancel() {
    setRefining(false);
    originalUuidRef.current = null;
  }

  function handleRefineSave(newUuid: string) {
    // (a) Fire commit-handshake FIRST — call onRefineSuccess with the ORIGINAL uuid
    //     (not the new chain-head uuid). Order is load-bearing for 15-06's flag-clear:
    //     VerifierPanel sets the callback at flag-click time; refining commits the
    //     handshake; flag clears. Cmd+P substrate hits leave onRefineSuccess=null
    //     so a refine through that path is silent (no side-effects on panel state).
    const originalUuid = originalUuidRef.current;
    if (originalUuid) {
      const cb = useCitationStore.getState().onRefineSuccess;
      if (cb) {
        cb(originalUuid);
      }
    }

    // (b) Close the editor
    setRefining(false);
    originalUuidRef.current = null;

    // (c) Re-point the modal to the new chain head — triggers useEffect to re-fetch detail
    openCitation(newUuid);

    // (d) Auto-switch to History tab so user sees the new chain immediately.
    //     The 200ms tab transition makes the switch feel intentional (polish bar).
    setActiveTab('history');
  }

  // ── Phase 15 Plan 04 — Delete handlers ─────────────────────────────────────

  function handleDeleteButtonClick() {
    setDeleteDialogOpen(true);
  }

  function handleDeleteCancel() {
    setDeleteDialogOpen(false);
  }

  function handleDeleteConfirmed(atomCount: number) {
    // Close the confirm dialog
    setDeleteDialogOpen(false);
    // Close the modal — user has tombstoned the rule, no more detail to show
    close();
    // Fire DOM toast (project uses inline DOM toast pattern — no toast library installed).
    // Position: bottom-right — sidebar SubstrateStatusIndicator is on the LEFT side,
    // so bottom-right is unobstructed. Toast style matches AppShell source:click toast.
    const el = document.createElement('div');
    el.textContent = `Rule tombstoned — ${atomCount} ${atomCount === 1 ? 'atom' : 'atoms'} previously cited it`;
    el.style.cssText = [
      'position:fixed',
      'bottom:2.5rem',
      'right:2rem',
      'background:var(--background,#1a1a1a)',
      'color:var(--foreground,#fff)',
      'border:1px solid var(--destructive,#e53e3e)',
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
    }, 3500);
  }

  return (
    <>
    <Dialog open={Boolean(openUuid)} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-2xl sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-start justify-between gap-2">
            <DialogTitle className="font-mono text-sm break-all">
              {detail?.name ?? openUuid ?? 'Substrate citation'}
            </DialogTitle>
            {/* Action buttons — only shown when on Detail tab and not already refining */}
            {openUuid && !refining && (
              <div className="flex shrink-0 items-center gap-1.5">
                {/* Refine button */}
                <button
                  onClick={handleRefineButtonClick}
                  className="flex items-center gap-1 rounded border border-border
                             px-2 py-1 text-[11px] text-muted-foreground transition-colors
                             hover:border-foreground/30 hover:text-foreground"
                  title="Refine this rule (⌘E)"
                >
                  Refine
                  <kbd className="rounded bg-muted/50 px-1 py-0.5 font-mono text-[10px]">⌘E</kbd>
                </button>
                {/* Delete button — destructive, paired with Refine */}
                <button
                  onClick={handleDeleteButtonClick}
                  className="flex items-center gap-1 rounded border border-destructive/40
                             px-2 py-1 text-[11px] text-destructive/70 transition-colors
                             hover:border-destructive hover:text-destructive"
                  title="Delete this rule"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </DialogHeader>

        {/* Tab bar — Detail | History */}
        <div className="border-b border-border">
          <div className="flex gap-0" role="tablist">
            {(['detail', 'history'] as const).map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => {
                  if (refining && tab !== 'detail') return; // lock to detail while refining
                  setRefining(false);
                  setActiveTab(tab);
                }}
                className={[
                  'px-4 py-2 text-xs font-medium capitalize transition-colors',
                  activeTab === tab
                    ? 'border-b-2 border-primary text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content — 200ms opacity+translate ease-out per CLAUDE.md polish bar */}
        <div className="relative min-h-[120px]">
          {/* Detail tab */}
          <div
            role="tabpanel"
            className={[
              'transition-[opacity,transform] duration-200 ease-out',
              activeTab === 'detail'
                ? 'translate-y-0 opacity-100'
                : 'pointer-events-none absolute inset-0 -translate-y-1 opacity-0',
            ].join(' ')}
          >
            {/* Refine editor — fades in when refining=true */}
            {refining && openUuid ? (
              <div className="transition-opacity duration-150 animate-in fade-in">
                <RefineRuleEditor
                  uuid={openUuid}
                  initialText={detail?.summary ?? ''}
                  initialAppliesWhen={detail?.applies_when ?? ''}
                  onSave={handleRefineSave}
                  onCancel={handleRefineCancel}
                />
              </div>
            ) : (
              /* Normal Detail view */
              <>
                {loading && (
                  <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                    <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                    Loading…
                  </div>
                )}

                {detail && !loading && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="rounded bg-muted/50 px-2 py-0.5 font-mono">
                        {detail.kind}
                      </span>
                      {detail.state && (
                        <span className="rounded bg-muted/50 px-2 py-0.5 font-mono">
                          {detail.state}
                        </span>
                      )}
                      {detail.actor && <span>actor: {detail.actor}</span>}
                      {detail.confidence && (
                        <span>confidence: {detail.confidence}</span>
                      )}
                    </div>

                    {detail.summary && detail.summary !== detail.name && (
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                        {detail.summary}
                      </p>
                    )}

                    {detail.applies_when && (
                      <div className="text-[11px] text-muted-foreground">
                        <span className="text-muted-foreground/70">Applies when:</span>{' '}
                        <span className="italic">{detail.applies_when}</span>
                      </div>
                    )}

                    {detail.verbatim_quote ? (
                      <div className="rounded border border-border-subtle bg-muted/30 p-3">
                        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                          Verbatim quote
                        </div>
                        <blockquote className="text-sm whitespace-pre-wrap font-mono leading-relaxed text-foreground/90">
                          {detail.verbatim_quote}
                        </blockquote>
                      </div>
                    ) : (
                      <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                        No verbatim quote on this node — was it hand-seeded? (Pitfall 4
                        in 13-RESEARCH.md — plan 13-10 fixture prep must populate
                        verbatim quotes for every demo-clicked uuid.)
                      </div>
                    )}

                    {(detail.session_id || detail.turn_ref) && (
                      <div className="text-[11px] font-mono text-muted-foreground">
                        source: {detail.session_id ?? '<no-session>'}
                        {detail.turn_ref ? `:${detail.turn_ref}` : ''}
                      </div>
                    )}
                  </div>
                )}

                {!detail && !loading && openUuid && (
                  <div className="text-sm text-muted-foreground">
                    No detail found for{' '}
                    <code className="font-mono text-xs">{openUuid}</code>
                  </div>
                )}
              </>
            )}
          </div>

          {/* History tab */}
          <div
            role="tabpanel"
            className={[
              'transition-[opacity,transform] duration-200 ease-out',
              activeTab === 'history'
                ? 'translate-y-0 opacity-100'
                : 'pointer-events-none absolute inset-0 translate-y-1 opacity-0',
            ].join(' ')}
          >
            {openUuid && activeTab === 'history' && (
              <SubstrateRuleHistoryTab uuid={openUuid} />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* Delete confirmation dialog — rendered outside the main Dialog to avoid nesting issues */}
    {deleteDialogOpen && openUuid && (
      <DeleteRuleConfirmDialog
        uuid={openUuid}
        onConfirmed={handleDeleteConfirmed}
        onCancel={handleDeleteCancel}
      />
    )}
  </>
  );
}
