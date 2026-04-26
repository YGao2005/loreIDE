/**
 * Phase 13 Plan 10b — Demo orchestration rehearsal panel.
 *
 * Single-click triggers for each demo beat, visible in dev mode only
 * (gated on `import.meta.env.DEV`). Production `tauri build` strips this via
 * dead-code elimination. Plan 13-11 rehearsal verifies the panel does NOT
 * appear in the release `.app` bundle.
 *
 * The panel coexists with PRReviewPanel (plan 13-08), SyncButton +
 * VerifierPanel (plan 13-09), and HarvestPanel (plan 13-09) — fixed
 * positioned bottom-left z-50 to avoid colliding with any of those.
 *
 * Triggers:
 *   - Beat 3 sync: invokes trigger_sync_animation (reads blast-radius.json)
 *   - Beat 3 verifier: loadAndApplyBeat3Verifier (reads beat3-verifier.json)
 *   - Beat 4 harvest: triggerBeat4Harvest (emits substrate:nodes-added from
 *     beat4-harvest.json — HarvestPanel + animateHarvestArrival fire green
 *     halos on attached_to_uuid participants per N9)
 *
 * Per plan policy: never auto-fire on app boot — every trigger is human-driven
 * so the demonstrator controls timing.
 */

import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  loadAndApplyBeat3Verifier,
  triggerBeat4Harvest,
} from '@/lib/demoOrchestration';

export function DemoOrchestrationPanel() {
  const [show, setShow] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const wrap = (label: string, fn: () => Promise<unknown>) => async () => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[DemoOrchestrationPanel] ${label} failed:`, e);
      setError(`${label}: ${msg}`);
    }
  };

  if (!show) return null;

  return (
    <div className="fixed left-4 bottom-4 z-50 w-64 rounded-lg border border-amber-500/40 bg-background/95 p-3 shadow-xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold text-amber-300">
          Demo Orchestration
        </h4>
        <button
          type="button"
          onClick={() => setShow(false)}
          className="text-[11px] leading-none text-muted-foreground hover:text-foreground"
          aria-label="Close demo orchestration panel"
        >
          ×
        </button>
      </div>
      <div className="space-y-1.5">
        <button
          type="button"
          onClick={wrap('Beat 3 sync', () => invoke('trigger_sync_animation'))}
          className="w-full rounded border border-blue-500/40 bg-blue-500/20 px-2 py-1 text-xs text-left hover:bg-blue-500/30 transition"
        >
          Beat 3: Sync animation
        </button>
        <button
          type="button"
          onClick={wrap('Beat 3 verifier', loadAndApplyBeat3Verifier)}
          className="w-full rounded border border-orange-500/40 bg-orange-500/20 px-2 py-1 text-xs text-left hover:bg-orange-500/30 transition"
        >
          Beat 3: Verifier results
        </button>
        <button
          type="button"
          onClick={wrap('Beat 4 harvest', triggerBeat4Harvest)}
          className="w-full rounded border border-green-500/40 bg-green-500/20 px-2 py-1 text-xs text-left hover:bg-green-500/30 transition"
        >
          Beat 4: Harvest panel
        </button>
      </div>
      {error && (
        <div className="mt-2 rounded border border-red-500/40 bg-red-500/10 p-1.5 text-[10px] text-red-300">
          {error}
        </div>
      )}
      <div className="mt-2 text-[10px] text-muted-foreground">
        Dev-only · fixtures from contract-ide/demo/seeds
      </div>
    </div>
  );
}
