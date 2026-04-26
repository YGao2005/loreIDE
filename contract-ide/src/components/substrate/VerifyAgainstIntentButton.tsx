/**
 * Gap-closure (post-13-11) — `Verify against intent` product affordance.
 *
 * Script Beat 3 (`presentation-script.md` ~line 184) literally calls out:
 *   *"T clicks `Verify against intent` → verifier streams"*
 *
 * Prior to this button the only triggers were:
 *   - DemoOrchestrationPanel (dev-only rehearsal panel, bottom-left)
 *   - `window.__demo.loadBeat3VerifierResults` from DevTools
 *
 * Neither reads as natural product UI on stage. This button sits next to
 * SyncButton in the canvas top-right action cluster — same visual language
 * (shadcn outline pill, accent color), so the two chain-level actions form
 * a coherent toolbar. Orange tint mirrors the verifier panel's flag color
 * and visually distinguishes it from Sync's blue.
 *
 * Click flow:
 *   1. invoke `loadAndApplyBeat3Verifier` (reads beat3-verifier.json fixture
 *      via Rust IPC, writes rows + implicitDecisions into useVerifierStore,
 *      `setResults` flips `open: true` so VerifierPanel mounts).
 *   2. While in flight, button is disabled to prevent double-fire.
 *   3. The verifier panel itself owns dismiss (✕) — re-clicking the button
 *      after dismiss re-opens it (idempotent fixture load).
 *
 * `useVerifierStore.open` drives an "active" tint so the operator can see
 * at a glance whether the verifier panel is currently visible — small
 * affordance, big stage clarity when rehearsing.
 */

import { useState } from 'react';
import { loadAndApplyBeat3Verifier } from '@/lib/demoOrchestration';
import { useVerifierStore } from '@/store/verifier';

export function VerifyAgainstIntentButton() {
  const [running, setRunning] = useState(false);
  const open = useVerifierStore((s) => s.open);

  const onClick = async () => {
    if (running) return;
    setRunning(true);
    try {
      await loadAndApplyBeat3Verifier();
    } catch (err) {
      console.error('[VerifyAgainstIntentButton] verify failed:', err);
    } finally {
      setRunning(false);
    }
  };

  // Active state when panel is open — subtle filled tint vs. the resting
  // outline. Matches SyncButton's hover/active idiom so the two buttons
  // visually group as one toolbar.
  const active = open && !running;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={running}
      className={
        active
          ? 'rounded-md border border-orange-400/70 bg-orange-500/25 px-3 py-1.5 text-xs font-medium text-orange-100 hover:bg-orange-500/30 disabled:opacity-50 transition-colors'
          : 'rounded-md border border-orange-500/40 bg-orange-500/10 px-3 py-1.5 text-xs font-medium text-orange-200 hover:border-orange-400/70 hover:bg-orange-500/20 disabled:opacity-50 transition-colors'
      }
      title="Run intent verifier against the current chain — surfaces substrate honors, implicit defaults, and parent-surface flags."
    >
      {running ? '⟳ Verifying…' : 'Verify against intent'}
    </button>
  );
}
