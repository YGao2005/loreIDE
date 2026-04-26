/**
 * Phase 13 Plan 09 — Mocked Sync affordance for the two-laptop demo.
 *
 * Click triggers the `trigger_sync_animation` Rust IPC, which returns the
 * pre-known trigger + participant uuids for the staged delete-account flow.
 * The JS then runs `animateSyncBlastRadius` to stagger 50ms pulses down the
 * chain (citation halo per pulse + persisted substrate state at `fresh`).
 *
 * Real multi-machine sync deferred to v3 per VISION.md. Without this button,
 * Beat 3 of the live demo doesn't open.
 */

import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  animateSyncBlastRadius,
  DEFAULT_BLAST_STAGGER_MS,
} from '@/lib/syncBlastRadius';

interface SyncTriggerResult {
  trigger_uuid: string;
  participant_uuids: string[];
}

export function SyncButton() {
  const [running, setRunning] = useState(false);

  const onClick = async () => {
    if (running) return;
    setRunning(true);
    try {
      const result = await invoke<SyncTriggerResult>('trigger_sync_animation');
      const ordered = [result.trigger_uuid, ...result.participant_uuids];
      await animateSyncBlastRadius(ordered, 'fresh', DEFAULT_BLAST_STAGGER_MS);
    } catch (err) {
      console.error('[SyncButton] sync failed:', err);
    } finally {
      setRunning(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={running}
      className="rounded-md border border-blue-500/40 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-200 hover:border-blue-400/70 hover:bg-blue-500/20 disabled:opacity-50 transition-colors"
      title="Mocked sync — animates blast radius across the chain against pre-loaded substrate state"
    >
      {running ? '⟳ Syncing…' : '⟲ Sync'}
    </button>
  );
}
