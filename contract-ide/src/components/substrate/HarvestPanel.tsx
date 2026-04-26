/**
 * Phase 13 Plan 09 — Beat 4 harvest notification panel.
 *
 * Subscribes to the `substrate:nodes-added` Tauri event AND polls every 2s as
 * a fallback (per 13-RESEARCH.md Open Question 3). Renders newly-harvested
 * substrate rules bottom-right; rows whose `promoted_from_implicit` is true
 * carry an amber `[⌃ promoted from implicit]` badge — the agent-default that
 * the reviewer accepted, now formal team rule.
 *
 * Plan 13-10b's DemoOrchestrationPanel will emit the event manually for Beat
 * 4 staging. The 2s poll fallback gracefully handles the case where the
 * `list_recent_substrate_additions` IPC isn't deployed yet — failure is
 * silent (returns no new nodes; HarvestPanel keeps whatever it has).
 */

import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

export interface HarvestedNode {
  uuid: string;
  name: string;
  kind: string;
  text: string;
  /** True when this rule was promoted from an implicit agent default. */
  promoted_from_implicit?: boolean;
  /** Participant uuid the rule attaches to (for chain context). */
  attached_to_uuid?: string;
}

const POLL_INTERVAL_MS = 2000;
const POLL_LOOKBACK_SECONDS = 60;

export function HarvestPanel() {
  const [recentNodes, setRecentNodes] = useState<HarvestedNode[]>([]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    // Primary path: subscribe to substrate:nodes-added Tauri event.
    listen<HarvestedNode[]>('substrate:nodes-added', (e) => {
      const payload = e.payload ?? [];
      setRecentNodes((prev) => {
        const existing = new Set(prev.map((n) => n.uuid));
        const fresh = payload.filter((n) => !existing.has(n.uuid));
        return fresh.length > 0 ? [...prev, ...fresh] : prev;
      });
    }).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });

    // Fallback path: poll every 2s for nodes added in the last 60s.
    // IPC may not exist yet (deferred to Phase 10 work) — silently ignore.
    const handle = setInterval(async () => {
      try {
        const recent = await invoke<HarvestedNode[]>(
          'list_recent_substrate_additions',
          { since_seconds: POLL_LOOKBACK_SECONDS },
        );
        if (!Array.isArray(recent) || recent.length === 0) return;
        setRecentNodes((prev) => {
          const existing = new Set(prev.map((n) => n.uuid));
          const fresh = recent.filter((n) => !existing.has(n.uuid));
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
      } catch {
        // IPC not registered yet — graceful degradation.
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      clearInterval(handle);
    };
  }, []);

  if (recentNodes.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 max-w-[400px] rounded-lg border border-blue-500/40 bg-background/95 p-3 shadow-xl backdrop-blur animate-in slide-in-from-bottom">
      <div className="text-sm font-medium mb-2">
        {recentNodes.length} {recentNodes.length === 1 ? 'node' : 'nodes'}{' '}
        captured from this session
      </div>
      <ul className="space-y-1.5">
        {recentNodes.map((n) => (
          <li key={n.uuid} className="text-xs">
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-green-400">+</span>
              <span className="font-mono text-blue-300">{n.name}</span>
              {n.promoted_from_implicit && (
                <span className="ml-1 rounded bg-amber-500/20 border border-amber-500/40 px-1.5 py-0.5 text-[9px] font-medium text-amber-200">
                  ⌃ promoted from implicit
                </span>
              )}
            </div>
            {n.text && (
              <div className="text-muted-foreground italic ml-3 mt-0.5">
                "{n.text}"
              </div>
            )}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => setRecentNodes([])}
        className="mt-2 text-[10px] text-muted-foreground hover:text-foreground"
      >
        Dismiss
      </button>
    </div>
  );
}
