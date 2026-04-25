import { useEffect, useState } from 'react';
import { probeRoute } from '@/ipc/inspector';
import type { ContractNode } from '@/ipc/types';

/**
 * Live preview pane (Phase 4 Plan 04-03).
 *
 * Renders a localhost iframe for UI-surface nodes whose `route` field is set,
 * provided a dev server is reachable at http://localhost:3000{route}. The
 * probe runs through Rust reqwest (probeRoute IPC) — NEVER a frontend fetch,
 * which is CORS-blocked because tauri://localhost is a distinct origin from
 * http://localhost:3000 (Pitfall 6).
 *
 * States:
 *   - `idle`        — no node selected OR node has no route
 *   - `probing`     — probe in flight; UI shows "Checking <url>…"
 *   - `reachable`   — probe returned true; iframe renders
 *   - `unreachable` — probe returned false; "Start dev server" prompt + Retry
 *
 * The probe re-runs on node.route change AND on Retry click (via probeCount
 * bump). The iframe's `key={probeCount}` forces an unmount/remount on Reload
 * — cleanest full-navigation reload without touching src.
 */

const DEFAULT_DEV_PORT = 3000;

function buildPreviewUrl(node: ContractNode): string | null {
  if (!node.route) return null;
  const path = node.route.startsWith('/') ? node.route : `/${node.route}`;
  return `http://localhost:${DEFAULT_DEV_PORT}${path}`;
}

type ProbeState = 'idle' | 'probing' | 'reachable' | 'unreachable';

export default function PreviewTab({ node }: { node: ContractNode | null }) {
  const [state, setState] = useState<ProbeState>('idle');
  // Bumping this retries the probe (and, when reachable, force-reloads the iframe).
  const [probeCount, setProbeCount] = useState(0);

  const previewUrl = node ? buildPreviewUrl(node) : null;

  useEffect(() => {
    if (!previewUrl) {
      setState('idle');
      return;
    }
    let cancelled = false;
    setState('probing');
    probeRoute(previewUrl)
      .then((ok) => {
        if (!cancelled) setState(ok ? 'reachable' : 'unreachable');
      })
      .catch(() => {
        if (!cancelled) setState('unreachable');
      });
    return () => {
      cancelled = true;
    };
  }, [previewUrl, probeCount]);

  if (!node) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Select a node to preview.
      </div>
    );
  }
  if (!previewUrl) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        This node has no <code>route</code>. Preview is only available for
        UI-surface nodes with a route set in the contract.
      </div>
    );
  }
  if (state === 'probing' || state === 'idle') {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Checking {previewUrl}…
      </div>
    );
  }
  if (state === 'unreachable') {
    return (
      <div className="p-4 flex flex-col gap-3 text-sm">
        <div className="text-muted-foreground">
          No dev server reachable at <code>{previewUrl}</code>.
        </div>
        <div className="text-xs text-muted-foreground">
          Start the dev server (e.g. <code>npm run dev</code> in your target
          repo) and retry.
        </div>
        <button
          className="self-start px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90"
          onClick={() => setProbeCount((n) => n + 1)}
        >
          Retry probe
        </button>
      </div>
    );
  }
  // reachable
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-1.5 text-xs font-mono bg-muted/30 flex items-center justify-between">
        <span>{previewUrl}</span>
        <button
          className="text-xs hover:underline"
          onClick={() => setProbeCount((n) => n + 1)}
        >
          Reload
        </button>
      </div>
      <iframe
        key={probeCount}
        src={previewUrl}
        className="w-full flex-1 border-0 bg-white"
        // allow-same-origin + allow-scripts + allow-forms: the minimum set
        // Next.js dev bundles need (hot reload uses scripts + same-origin XHR).
        // Dropping allow-same-origin causes blank iframe renders. Do NOT remove.
        sandbox="allow-scripts allow-same-origin allow-forms"
      />
    </div>
  );
}
