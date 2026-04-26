/**
 * DelegateButton — Phase 11 Plan 04.
 *
 * Always-visible in the Inspector footer regardless of active tab
 * (Contract / Code / Preview / Receipts). Contextual to the NODE, not the tab.
 *
 * State machine (driven by useDelegateStore):
 *   idle                       → "Delegate to agent" button enabled
 *   composing(retrieving)      → "Retrieving substrate…" + ComposingOverlay (status only)
 *   composing(planning)        → "Planning…" + ComposingOverlay (status + retrieved hits)
 *   plan-review                → "Plan ready — review below" + ComposingOverlay + PlanReviewPanel
 *   sent / executing           → "Agent running… view in chat ↗" (overlay closes; kickoff card
 *                                renders in chat panel via useAgentStore.kickoff)
 *   → idle                     → on agent:complete (wired in AppShell)
 *
 * On Approve, the structured plan is seeded into useAgentStore as a `kickoff`
 * payload — the chat panel renders a KickoffCard at the top of the run so the
 * agent's stream lands underneath it as a continuous timeline.
 *
 * [source] click on overlay rows fires Tauri 'source:click' event → toast in AppShell.
 * Phase 13 wires the actual chat-archaeology jump per CONTEXT lock.
 *
 * Abort during execution is delegated to Phase 8's chat-panel cancel — no
 * separate abort UI added here per CONTEXT lock.
 */

import { useDelegateStore } from '../../store/delegate';
import type { SubstrateHit } from '../../ipc/delegate';
import { ComposingOverlay } from './ComposingOverlay';
import { PlanReviewPanel } from './PlanReviewPanel';

interface DelegateButtonProps {
  /** The node UUID to use as the delegate scope. */
  scopeUuid: string;
  /** E.g. 'L2' for surface-context label in the composing overlay copy. */
  level?: string;
  /** Optional atom UUID — defaults to scopeUuid. */
  atomUuid?: string;
}

export function DelegateButton({ scopeUuid, level, atomUuid }: DelegateButtonProps) {
  const state = useDelegateStore((s) => s.state);
  const startCompose = useDelegateStore((s) => s.startCompose);
  const approve = useDelegateStore((s) => s.approve);
  const editPrompt = useDelegateStore((s) => s.editPrompt);
  const cancel = useDelegateStore((s) => s.cancel);

  const isComposing = state.kind === 'composing' && state.scope_uuid === scopeUuid;
  const isPlanReview = state.kind === 'plan-review' && state.scope_uuid === scopeUuid;
  const isSent = state.kind === 'sent' && state.scope_uuid === scopeUuid;
  const isExecuting = state.kind === 'executing' && state.scope_uuid === scopeUuid;

  // Derive the overlay's stage + hits from the state machine.
  // Composing overlay shows during composing (any stage) and plan-review.
  let overlayStage: 'retrieving' | 'planning' | 'plan-ready' | null = null;
  let overlayHits: SubstrateHit[] | undefined;
  if (isComposing && state.kind === 'composing') {
    overlayStage = state.stage;
    overlayHits = state.hits;
  } else if (isPlanReview && state.kind === 'plan-review') {
    overlayStage = 'plan-ready';
    overlayHits = state.hits;
  }

  const handleClick = () => {
    if (state.kind === 'idle') {
      void startCompose(scopeUuid);
    }
  };

  // Determine button label based on state.
  let buttonLabel = 'Delegate to agent';
  if (isComposing) {
    buttonLabel = state.kind === 'composing' && state.stage === 'planning'
      ? 'Planning…'
      : 'Retrieving substrate…';
  } else if (isPlanReview) buttonLabel = 'Plan ready — review below';
  else if (isSent) buttonLabel = 'Sent to agent';
  else if (isExecuting) buttonLabel = 'Agent running… view in chat ↗';

  return (
    <div className="space-y-3">
      <button
        onClick={handleClick}
        disabled={state.kind !== 'idle'}
        type="button"
        className="w-full rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {buttonLabel}
      </button>

      {/* Composing overlay — drives off `stage` for the status label */}
      {overlayStage && (
        <ComposingOverlay
          scopeUuid={scopeUuid}
          level={level}
          stage={overlayStage}
          hits={overlayHits}
        />
      )}

      {/* Plan-review panel — shown after compose + plan both complete */}
      {isPlanReview && state.kind === 'plan-review' && (
        <PlanReviewPanel
          plan={state.plan}
          assembledPrompt={state.assembledPrompt}
          onApprove={() => void approve(atomUuid)}
          onEditAndReplan={(newPrompt) => void editPrompt(newPrompt)}
          onCancel={() => cancel()}
        />
      )}
    </div>
  );
}
