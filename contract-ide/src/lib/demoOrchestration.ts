/**
 * Phase 13.5 — sync-review reframe.
 *
 * `loadSyncReview(beat)` reads the unified PR-review fixture (sync-review-{beat3,beat4}.json)
 * via the Rust IPC `load_sync_review_fixture` and applies it to useSyncReviewStore.
 * The Review sidebar tab subscribes to the store and hydrates its sections
 * (header → honors → implicit → harvested → flag).
 *
 * Caller is responsible for firing the blast-radius animation in parallel
 * (animateSyncBlastRadius from src/lib/syncBlastRadius.ts) using the
 * payload's blast_radius.participant_uuids. SyncReviewPanel's empty-state
 * Pull button does this automatically.
 *
 * The pre-13.5 helpers (loadBeat3VerifierResults / loadAndApplyBeat3Verifier /
 * triggerBeat4Harvest, useVerifierStore, HarvestPanel, etc.) were removed
 * along with the floating popups they fed.
 */

import { invoke } from '@tauri-apps/api/core';
import { useSyncReviewStore, type SyncReviewPayload } from '@/store/syncReview';

export async function loadSyncReview(
  beat: 'beat3' | 'beat4',
): Promise<SyncReviewPayload> {
  useSyncReviewStore.getState().setPulling(true);
  try {
    const payload = await invoke<SyncReviewPayload>('load_sync_review_fixture', {
      beat,
    });
    useSyncReviewStore.getState().setPayload(payload);
    return payload;
  } catch (err) {
    useSyncReviewStore.getState().setPulling(false);
    throw err;
  }
}

/**
 * Phase 13.5 — Apply constraint narrowing to a substrate node.
 *
 * Writes the user's free-form narrowing into the live substrate row
 * (appends to applies_when, clears intent_drift_state). After this call,
 * the rule is no longer flagged as intent-drifted, and clicking its
 * citation pill shows the narrowed scope.
 *
 * Used by SyncReviewPanel's FlagSection on Accept. Reset hotkey
 * (Cmd+Shift+R) re-applies the seed and re-arms the flag.
 */
export interface NarrowingResult {
  new_applies_when: string;
  previous_applies_when: string | null;
}

export async function applyConstraintNarrowing(
  uuid: string,
  narrowing: string,
): Promise<NarrowingResult> {
  return await invoke<NarrowingResult>('apply_constraint_narrowing', {
    uuid,
    narrowing,
  });
}

declare global {
  interface Window {
    __demo?: {
      loadSyncReview: typeof loadSyncReview;
    };
  }
}

if (typeof window !== 'undefined') {
  window.__demo = {
    ...(window.__demo ?? {}),
    loadSyncReview,
  };
}
