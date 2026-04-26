/**
 * Phase 13 Plan 05 — CARD-01: ScreenCard react-flow node type.
 *
 * UI-mode L3 trigger card. Embeds an iframe at the screen contract's `route`
 * (Phase 4 PreviewTab pattern) and renders absolutely-positioned atom chips
 * in the PARENT layer — NOT inside the iframe — to sidestep cross-origin and
 * pan/zoom interference.
 *
 * Architecture:
 *
 *   ┌─────────────────────────── ScreenCard (rounded panel) ──────────────┐
 *   │ ┌─ header ────────────────────────────────────────────────────────┐ │
 *   │ │  /account/settings   Account Settings           [Inspect/Interact] │
 *   │ └────────────────────────────────────────────────────────────────┘  │
 *   │ ┌─ relative wrapper ───────────────────────────────────────────────┐ │
 *   │ │   ┌─ iframe (loaded at fullUrl) ─────────────────────────┐       │ │
 *   │ │   │  ... rendered React app ...                          │       │ │
 *   │ │   │  <DangerZone data-contract-uuid="atom-1">  ...       │       │ │
 *   │ │   └──────────────────────────────────────────────────────┘       │ │
 *   │ │   ┌─ AtomChipOverlay (absolute inset-0, pointer-events-none) ─┐  │ │
 *   │ │   │   [chip 'Delete Account' at rect of atom-1]              │  │ │
 *   │ │   └──────────────────────────────────────────────────────────┘  │ │
 *   │ └──────────────────────────────────────────────────────────────────┘ │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 * Inspect mode (default):
 *   - iframe pointer-events: none → iframe content cannot receive clicks
 *   - chips pointer-events: auto  → chips intercept clicks
 *   - clicks on iframe whitespace are no-ops; clicks on chips select the atom
 *
 * Interact mode (toggle in header):
 *   - iframe pointer-events: auto → iframe content receives clicks
 *   - chips pointer-events: auto BUT visually faded to 0.4 opacity so the
 *     user knows they're not the active interaction surface
 *   - clicks land on the iframe; user can interact with the live app
 *
 * Probe + retry pattern (Phase 4 Plan 04-03):
 *   - Probe via Rust reqwest IPC (probe_route command) — NOT a frontend
 *     fetch (CORS-blocked because tauri://localhost ≠ http://localhost:3000).
 *   - Probe states: probing / reachable / unreachable.
 *   - Retry button re-runs probe by bumping a probeCount key.
 *
 * State coloring uses `resolveNodeState` from plan 13-01 — single source of
 * truth across cards / chips / contract nodes (drifted > intent_drifted >
 * rollup_stale > superseded > rollup_untracked > healthy precedence).
 *
 * Phase 3 patterns (per Plan 03-01 decisions):
 *   - Plain `NodeProps` (no generic) in the function signature; cast to
 *     ScreenCardData via `data as` inside the body. Parameterising NodeProps<T>
 *     triggers a variance error through memo() + nodeTypes.
 *   - `[key: string]: unknown` extends the data interface to satisfy
 *     xyflow's Record constraint.
 *   - `memo()` wrapper at module scope per Pitfall 1 (inline memo in JSX
 *     remounts every node every frame).
 *
 * Wave 2 placement: this component renders ONE card in isolation. Plan 13-06's
 * vertical-chain assembler (FlowChain) composes multiple ScreenCard /
 * ServiceCard instances into a participant chain — chain composition is
 * explicitly out of scope here.
 */

import { memo, useEffect, useRef, useState } from 'react';
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
import { useScreenshotStore } from '@/store/screenshots';
import { captureIframeScreenshot } from '@/lib/iframeScreenshot';

const DEFAULT_DEV_PORT = 3000;
const DEFAULT_DEV_BASE = `http://localhost:${DEFAULT_DEV_PORT}`;

export interface ScreenCardData extends Record<string, unknown> {
  /** Contract uuid — keys into substrate / drift / rollup state stores. */
  uuid: string;
  /** Display name (e.g. 'Account Settings'). */
  name: string;
  /**
   * Path the iframe loads (e.g. '/account/settings'). MUST start with '/'
   * (a leading slash is added defensively if missing).
   */
  route: string;
  /**
   * Optional dev-server base. Defaults to http://localhost:3000. Plan 13-06's
   * flow-chain assembler may pass a different port if the user's dev server
   * isn't on the standard port.
   */
  devServerUrl?: string;
  /**
   * Phase 13 Plan 06 Beat 4 single-iframe budget. When `true` (default), this
   * card renders a live iframe and captures screenshots on iframe load for
   * non-focused twins to consume. When `false` (set by FlowChainLayout when
   * this flow is NOT the focused flow), this card renders a cached screenshot
   * from useScreenshotStore instead — a placeholder ("capturing…") shows when
   * no screenshot is cached yet.
   *
   * Default true preserves the plan 13-05 isolation behavior (ScreenCard
   * mounted alone always gets a live iframe). FlowChainLayout's assembler
   * passes false explicitly for non-focused flows.
   */
  isFocused?: boolean;
}

type ProbeState = 'probing' | 'reachable' | 'unreachable';

function buildPreviewUrl(route: string, base: string): string {
  const path = route.startsWith('/') ? route : `/${route}`;
  return `${base}${path}`;
}

function ScreenCardImpl({ data }: NodeProps) {
  const d = data as ScreenCardData;
  // Default `true` preserves plan 13-05's isolation behavior (ScreenCard mounted
  // alone always gets a live iframe). FlowChainLayout's assembler explicitly
  // passes `false` for non-focused flows in two-flow scenarios (Beat 4).
  const isFocused = d.isFocused !== false;
  const baseUrl = d.devServerUrl ?? DEFAULT_DEV_BASE;
  const fullUrl = buildPreviewUrl(d.route, baseUrl);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [loadState, setLoadState] = useState<ProbeState>('probing');
  // Inspect (default) vs Interact mode toggle. ROADMAP optional polish —
  // ships even if not used in the demo because the foundation (chip click
  // intercept) requires the iframe to ignore pointer events by default.
  const [interactMode, setInteractMode] = useState(false);
  // Bump to force a re-probe (Retry button) and re-mount the iframe so the
  // browser re-runs the load lifecycle (mirrors PreviewTab key={probeCount}).
  const [probeCount, setProbeCount] = useState(0);

  // Compose visual state from drift / substrate / rollup signals — same
  // precedence as ContractNode + ServiceCard.
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

  // Phase 13 Plan 07 — citation halo. Stable primitive selector; coexists with
  // any existing state ring (haloed superseded screen reads as both orange-
  // muted AND blue glow simultaneously, by design).
  const haloUuid = useCitationStore((s) => s.highlightedUuid);
  const haloed = haloUuid === d.uuid;

  // Phase 13 Plan 06: cached screenshot for non-focused twin rendering. Reading
  // by uuid keeps re-renders gated on this specific entry's identity (Map
  // mutation produces new identity per useScreenshotStore contract).
  const cachedScreenshot = useScreenshotStore((s) => s.cache.get(d.uuid));
  const setScreenshot = useScreenshotStore((s) => s.setScreenshot);

  useEffect(() => {
    // Non-focused twin: skip the network probe entirely. The probe is only
    // useful when we're going to mount an iframe; non-focused cards render
    // from the cached screenshot. Setting loadState to 'reachable' lets the
    // existing render path show the cached image (or its capturing placeholder).
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

  return (
    <div
      className={cn(
        screenCardStyles({ state: visualState }),
        haloed && citationHaloClass,
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
        </div>
        <button
          type="button"
          onClick={() => setInteractMode((m) => !m)}
          className={cn(
            'shrink-0 text-[10px] px-2 py-0.5 rounded border border-border/50 transition-colors',
            interactMode
              ? 'bg-primary/15 text-primary border-primary/40'
              : 'hover:bg-muted/50',
          )}
          title="Inspect mode: chips intercept clicks. Interact mode: iframe receives clicks."
        >
          {interactMode ? 'Interact' : 'Inspect'}
        </button>
      </header>

      <div
        className="relative"
        style={{ height: 'calc(100% - 36px)', minHeight: 360 }}
      >
        {loadState === 'reachable' && isFocused && (
          <>
            <iframe
              ref={iframeRef}
              key={probeCount}
              src={fullUrl}
              // allow-same-origin + allow-scripts + allow-forms: the minimum
              // set Next.js dev bundles need (hot reload uses scripts +
              // same-origin XHR). Dropping allow-same-origin causes blank
              // iframe renders. Do NOT remove. Matches PreviewTab exactly.
              sandbox="allow-scripts allow-same-origin allow-forms"
              className="w-full h-full bg-white"
              style={{
                border: 0,
                // Inspect mode (default): iframe ignores pointer events so
                // chips intercept clicks. Interact mode: iframe receives
                // clicks so the user can interact with the live app.
                pointerEvents: interactMode ? 'auto' : 'none',
              }}
              title={d.name}
              // Phase 13 Plan 06 Beat 4: capture a screenshot of the iframe
              // content as soon as it loads so non-focused twins (a second
              // ScreenCard for the OTHER flow in plan 13-09's side-by-side
              // view) can render from cache instead of mounting a 2nd iframe.
              // Defer the capture by one frame so layout/paint settles
              // (capture-too-early returns blank). Failures (cross-origin
              // taint, parse errors) silently log in dev — non-fatal.
              onLoad={() => {
                const iframe = iframeRef.current;
                if (!iframe) return;
                // Defer one frame so layout/paint completes before capture.
                requestAnimationFrame(() => {
                  void captureIframeScreenshot(iframe, fullUrl).then(
                    (dataUrl) => {
                      if (dataUrl) setScreenshot(d.uuid, dataUrl);
                    },
                  );
                });
              }}
            />
            <div
              // Fade the chip overlay in Interact mode so the user knows
              // chips are not the active interaction surface (chips remain
              // clickable so click-to-select still works as a power-user
              // affordance, but the visual signal says "iframe is the focus").
              style={{
                opacity: interactMode ? 0.4 : 1,
                transition: 'opacity 150ms ease-out',
              }}
              className="absolute inset-0 pointer-events-none"
            >
              {/* AtomChipOverlay is itself absolute inset-0 +
                  pointer-events-none on the container, with pointer-events-auto
                  on each chip. */}
              <AtomChipOverlay iframeRef={iframeRef} parentUuid={d.uuid} />
            </div>
          </>
        )}

        {/* Phase 13 Plan 06 Beat 4 single-iframe budget: non-focused flow
            renders a cached screenshot instead of a live iframe. The cached
            dataUrl is populated by the focused twin (when it last mounted).
            If no screenshot is cached yet, render a "capturing…" placeholder
            so the slot doesn't collapse. */}
        {loadState === 'reachable' && !isFocused && (
          <div className="relative w-full h-full bg-white">
            {cachedScreenshot ? (
              <img
                src={cachedScreenshot}
                className="w-full h-full object-cover"
                alt={d.name}
                draggable={false}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
                Capturing screenshot…
              </div>
            )}
            {/* Subtle "screenshot" badge so the user can tell at a glance
                that this card is not live. */}
            <div className="absolute top-2 right-2 px-2 py-0.5 rounded text-[10px] font-mono bg-slate-900/80 text-slate-300 border border-slate-700/40 pointer-events-none">
              screenshot
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

/**
 * Memoised at module scope per Plan 03-01 Pitfall 1 — inline memo inside the
 * nodeTypes record causes React Flow to remount every node every frame.
 */
export const ScreenCard = memo(ScreenCardImpl);
