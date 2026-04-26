/**
 * Phase 13 Plan 09 — Mocked Sync blast-radius animation.
 *
 * Per script Beat 3: trigger card pulses first, then service cards pulse in
 * invocation order down the chain (50ms stagger). Implementation: use the
 * citation halo (blue ring + 12px glow + scale-1.02) from plan 13-07 as the
 * visual pulse, and persist substrate state at the end so cards keep their
 * semantic state after the wave.
 *
 * Real multi-machine sync deferred to v3 per VISION.md — this is a staged
 * affordance for the live demo. Plan 13-10b will swap placeholder uuids in
 * the Rust IPC for fixture-loaded ones.
 *
 * Pulse duration is exported as a constant so plan 13-10b/13-11 can tune it
 * (1500ms is a starting value; rehearsal may bump to 2000ms for camera).
 */

import { useSubstrateStore, type SubstrateNodeState } from '@/store/substrate';
import { useCitationStore } from '@/store/citation';

/** Per-card pulse duration in ms — citation halo lifetime per pulse. */
export const BLAST_PULSE_DURATION_MS = 1500;

/** Default stagger between consecutive participants in ms. */
export const DEFAULT_BLAST_STAGGER_MS = 50;

/**
 * Stagger blast-radius animation across affected uuids.
 *
 * The first uuid in `orderedUuids` is the trigger; subsequent are participants
 * in chain order. Each participant pulses via citation halo (transient blue
 * ring) and persists substrate state at the same time so the card's permanent
 * ring color settles to `finalState` once the halo fades.
 *
 * @param orderedUuids - chain participants top-to-bottom, trigger first
 * @param finalState - state to leave each in after the pulse (default 'fresh')
 * @param staggerMs - delay between consecutive pulses (default 50ms)
 */
export async function animateSyncBlastRadius(
  orderedUuids: string[],
  finalState: SubstrateNodeState = 'fresh',
  staggerMs = DEFAULT_BLAST_STAGGER_MS,
): Promise<void> {
  if (orderedUuids.length === 0) return;

  const citationStore = useCitationStore.getState();
  const substrateStore = useSubstrateStore.getState();

  for (let i = 0; i < orderedUuids.length; i++) {
    const uuid = orderedUuids[i];
    setTimeout(() => {
      // Pulse via citation halo (blue ring + glow + scale, auto-clears)
      citationStore.highlight(uuid, BLAST_PULSE_DURATION_MS);
      // Persist substrate state so the card retains its semantic state
      // after the halo fades.
      substrateStore.setNodeState(uuid, finalState);
    }, i * staggerMs);
  }

  // Resolve after the LAST pulse settles (last delay + halo duration).
  const total = (orderedUuids.length - 1) * staggerMs + BLAST_PULSE_DURATION_MS;
  await new Promise((res) => setTimeout(res, total));
}
