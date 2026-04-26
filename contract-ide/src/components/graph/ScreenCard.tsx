/**
 * Phase 13 Plan 05/12 — CARD-01: ScreenCard react-flow node type.
 *
 * UI-mode L3 trigger card. Embeds an iframe at the screen contract's `route`.
 * Per Phase 13 Plan 12, the iframe is ALWAYS pointer-events: none on canvas —
 * wheel events flow to react-flow (zoom), clicks pass through. The user opens
 * an interactive view via the ⤢ button (or ⌘.) which mounts ScreenViewerOverlay
 * that re-positions THIS iframe via CSS-fixed and flips pointer-events to auto
 * for the overlay duration. No iframe re-attachment = no page reload = scroll
 * and form state are preserved across canvas ↔ fullscreen transitions.
 *
 * Why no screenshot? An earlier iteration tried capturing a static screenshot
 * via SVG-foreignObject + canvas inside the iframe. It doesn't work for
 * Next.js (or any non-trivial framework): external CSS doesn't load inside
 * the SVG image context, web fonts don't load, scripts don't execute. The
 * captured image is unstyled garbage. Live iframe with pointer-events: none
 * gives the same end-user UX (can't interact on canvas, wheel zooms canvas)
 * with always-fresh content and no capture pipeline.
 *
 * Architecture:
 *
 *   ┌─────────────────────────── ScreenCard (rounded panel) ───────────────┐
 *   │ ┌─ header ─────────────────────────────────────────────────────────┐ │
 *   │ │  /account/settings   Account Settings              [↻] [⤢]      │ │
 *   │ └──────────────────────────────────────────────────────────────────┘ │
 *   │ ┌─ relative wrapper ───────────────────────────────────────────────┐ │
 *   │ │   <iframe pointer-events: none />                                │ │
 *   │ │   ┌─ AtomChipOverlay (chips at live rects, pointer-events: auto)┐ │
 *   │ │   │   [chip 'Delete Account' at queried rect]                   │ │
 *   │ │   └─────────────────────────────────────────────────────────────┘ │
 *   │ └──────────────────────────────────────────────────────────────────┘ │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 * Single-iframe budget (`isFocused` prop):
 *   Only the focused screen mounts an iframe. Non-focused screens render a
 *   placeholder card. Per Phase 13 Plan 06, FlowChainLayout enforces this
 *   for two-flow scenarios; standalone ScreenCard mounts default to focused.
 *
 * Probe + retry pattern (Phase 4 Plan 04-03):
 *   Probe via Rust reqwest IPC (probeRoute) — frontend fetch is CORS-blocked.
 *   Retry button bumps probeCount which re-mounts the iframe.
 *
 * State coloring uses `resolveNodeState` from Plan 13-01 — single source of
 * truth across cards / chips / contract nodes.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import { probeRoute } from '@/ipc/inspector';
import { cn } from '@/lib/utils';
import { screenCardStyles } from './screenCardStyles';
import { AtomChipOverlay } from './AtomChipOverlay';
import { resolveNodeState, citationHaloClass } from './contractNodeStyles';
import { useDriftStore } from '@/store/drift';
import { useRollupStore } from '@/store/rollup';
import { useSubstrateStore } from '@/store/substrate';
import { useCitationStore } from '@/store/citation';
import { useScreenViewerStore } from '@/store/screenViewer';
import { ChatScopeBadge } from './ChatScopeBadge';

const DEFAULT_DEV_PORT = 3000;
const DEFAULT_DEV_BASE = `http://localhost:${DEFAULT_DEV_PORT}`;

export interface ScreenCardData extends Record<string, unknown> {
  uuid: string;
  name: string;
  route: string;
  devServerUrl?: string;
  isFocused?: boolean;
}

type ProbeState = 'probing' | 'reachable' | 'unreachable';

function buildPreviewUrl(route: string, base: string): string {
  const path = route.startsWith('/') ? route : `/${route}`;
  return `${base}${path}`;
}

function ScreenCardImpl({ data }: NodeProps) {
  const d = data as ScreenCardData;
  const isFocused = d.isFocused !== false;
  const baseUrl = d.devServerUrl ?? DEFAULT_DEV_BASE;
  const fullUrl = buildPreviewUrl(d.route, baseUrl);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [loadState, setLoadState] = useState<ProbeState>('probing');
  // Bump to force iframe re-mount (Retry button + ↻ refresh).
  const [probeCount, setProbeCount] = useState(0);

  const drifted = useDriftStore((s) => s.driftedUuids);
  const rollupStale = useRollupStore((s) => s.rollupStaleUuids);
  const untracked = useRollupStore((s) => s.untrackedUuids);
  const substrate = useSubstrateStore((s) => s.nodeStates);
  const visualState = resolveNodeState(
    d.uuid,
    drifted,
    rollupStale,
    untracked,
    substrate,
  );

  const haloUuid = useCitationStore((s) => s.highlightedUuid);
  const haloed = haloUuid === d.uuid;

  const expand = useScreenViewerStore((s) => s.expand);
  const isExpanded = useScreenViewerStore(
    (s) => s.expandedScreenUuid === d.uuid,
  );

  useEffect(() => {
    if (!isFocused) {
      setLoadState('reachable');
      return;
    }
    let cancelled = false;
    setLoadState('probing');
    probeRoute(fullUrl)
      .then((reachable) => {
        if (cancelled) return;
        setLoadState(reachable ? 'reachable' : 'unreachable');
      })
      .catch(() => {
        if (!cancelled) setLoadState('unreachable');
      });
    return () => {
      cancelled = true;
    };
  }, [fullUrl, probeCount, isFocused]);

  // ↻ button — remounts the iframe (forces fresh page load + fresh responder
  // script fetch). Useful when the iframe got into a bad state OR when the
  // demo page changed and we want to see the new version.
  const reloadIframe = useCallback(() => {
    setProbeCount((n) => n + 1);
  }, []);

  return (
    <div
      className={cn(
        screenCardStyles({ state: visualState }),
        haloed && citationHaloClass,
        'group',
      )}
      style={{ width: 600, minHeight: 400 }}
      data-uuid={d.uuid}
      data-kind="screen"
    >
      <Handle type="target" position={Position.Top} />

      <header className="flex items-center justify-between px-3 py-2 border-b border-border/40 bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <code
            className="text-xs font-mono text-muted-foreground truncate"
            title={fullUrl}
          >
            {d.route}
          </code>
          <span className="text-sm font-medium truncate">{d.name}</span>
          <ChatScopeBadge uuid={d.uuid} variant="card" />
        </div>
        {/* Hover-only buttons. Gated on isFocused because both actions require
            a live iframe. Click stops propagation so react-flow doesn't treat
            the click as a node-select. */}
        {loadState === 'reachable' && isFocused && (
          <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                reloadIframe();
              }}
              className="text-[10px] px-2 py-0.5 rounded border border-border/50 hover:bg-muted/50"
              title="Reload iframe"
              aria-label="Reload iframe"
            >
              ↻
            </button>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                expand(d.uuid);
              }}
              className="text-[10px] px-2 py-0.5 rounded border border-border/50 hover:bg-muted/50"
              title="Expand (⌘.)"
              aria-label="Expand to fullscreen"
            >
              ⤢
            </button>
          </div>
        )}
      </header>

      <div
        className="relative bg-white overflow-hidden"
        style={{ height: 'calc(100% - 36px)', minHeight: 360 }}
      >
        {loadState === 'reachable' && isFocused && (
          <>
            <iframe
              ref={iframeRef}
              key={probeCount}
              src={fullUrl}
              sandbox="allow-scripts allow-same-origin allow-forms"
              className={cn(
                'w-full h-full border-0 bg-white',
                // pointer-events: none on canvas (wheel/click → react-flow);
                // ScreenViewerOverlay imperatively flips this to auto when
                // the user expands. The iframe element itself is reused
                // (no remount) so contentDocument state survives.
                !isExpanded && 'pointer-events-none',
              )}
              title={d.name}
              data-screen-iframe-host={d.uuid}
            />
            <AtomChipOverlay iframeRef={iframeRef} parentUuid={d.uuid} />
          </>
        )}

        {loadState === 'reachable' && !isFocused && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-xs gap-1">
            <div>{d.name}</div>
            <div className="text-muted-foreground/60">
              Focus this flow to preview
            </div>
          </div>
        )}

        {loadState === 'probing' && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Probing dev server at {baseUrl}…
          </div>
        )}

        {loadState === 'unreachable' && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-sm">
            <div className="text-muted-foreground">
              Dev server unreachable at <code>{baseUrl}</code>
            </div>
            <div className="text-xs text-muted-foreground/80">
              Start the dev server (e.g. <code>npm run dev</code> in your
              target repo) and retry.
            </div>
            <button
              type="button"
              onClick={() => setProbeCount((n) => n + 1)}
              className="mt-1 text-xs px-3 py-1 rounded bg-primary text-primary-foreground hover:opacity-90"
            >
              Retry
            </button>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export const ScreenCard = memo(ScreenCardImpl);
