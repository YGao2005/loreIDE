/**
 * Phase 13 Plan 12 — Fullscreen screen viewer overlay.
 *
 * Mounted as a sibling of GraphCanvasInner. When `useScreenViewerStore.expandedScreenUuid`
 * is non-null, slides up over the Graph area only — Sidebar, bottom Inspector,
 * and Chat panel remain visible and interactive.
 *
 * Iframe ownership:
 *   This overlay mounts its OWN iframe (separate from ScreenCard's canvas-mode
 *   iframe). An earlier iteration tried to physically reposition ScreenCard's
 *   iframe via `position: fixed` so state survived canvas ↔ fullscreen, but
 *   react-flow wraps every node in a CSS `transform`, and per CSS spec a
 *   transformed ancestor becomes the containing block for ANY descendant with
 *   `position: fixed`. That meant our `top/left` values (computed in viewport
 *   coords from getBoundingClientRect) were applied in react-flow's transformed
 *   coordinate space — iframe ended up offscreen, user saw the overlay's
 *   background instead.
 *
 *   Trade-off accepted: the page reloads on each fullscreen open. The canvas
 *   iframe is `pointer-events: none` so the user can't fill forms or scroll
 *   it anyway — there's no useful state to lose.
 *
 * Z-index stack:
 *   backdrop  : z-30 (overlay outer div)
 *   iframe    : z-auto (inside slot, just renders normally)
 *   highlights: z-50 (InspectHighlight, above iframe)
 *   toolbar   : z-60 (always reachable)
 *
 * Exit affordances all converge on `useScreenViewerStore.close()`:
 *   - Esc key (handled by useScreenViewerHotkeys; layered with inspect-off)
 *   - ⤢ button in toolbar
 *   - Click on the backdrop (e.target === e.currentTarget guard)
 */

import { useEffect, useRef, useState } from 'react';
import { useScreenViewerStore } from '@/store/screenViewer';
import { useGraphStore } from '@/store/graph';
import { InspectHighlight } from './InspectHighlight';
import { cn } from '@/lib/utils';

const DEFAULT_DEV_PORT = 3000;
const DEFAULT_DEV_BASE = `http://localhost:${DEFAULT_DEV_PORT}`;

function buildPreviewUrl(route: string, base: string): string {
  const path = route.startsWith('/') ? route : `/${route}`;
  return `${base}${path}`;
}

export function ScreenViewerOverlay() {
  const expandedUuid = useScreenViewerStore((s) => s.expandedScreenUuid);
  const close = useScreenViewerStore((s) => s.close);
  const inspectMode = useScreenViewerStore((s) => s.inspectMode);
  const toggleInspect = useScreenViewerStore((s) => s.toggleInspect);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const iframeSlotRef = useRef<HTMLDivElement>(null);

  // Bump to force iframe remount (↻ button).
  const [reloadKey, setReloadKey] = useState(0);

  const screenNode = useGraphStore((s) =>
    expandedUuid ? s.nodes.find((n) => n.uuid === expandedUuid) : null,
  );
  const route = (screenNode as unknown as { route?: string } | null)?.route;
  const fullUrl = route ? buildPreviewUrl(route, DEFAULT_DEV_BASE) : null;

  // Block body scroll while overlay is open.
  useEffect(() => {
    if (!expandedUuid) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [expandedUuid]);

  // Reset reload key when overlay closes so next open starts fresh.
  useEffect(() => {
    if (!expandedUuid) setReloadKey(0);
  }, [expandedUuid]);

  if (!expandedUuid || !fullUrl) return null;

  return (
    <div
      className="absolute inset-0 z-30 flex flex-col bg-background animate-in fade-in slide-in-from-bottom-4 duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="relative z-[60] flex items-center gap-2 px-4 py-2 border-b border-border/40 bg-background/80 backdrop-blur-sm">
        <code
          className="text-xs font-mono text-muted-foreground truncate max-w-[40%]"
          title={fullUrl}
        >
          {fullUrl}
        </code>
        <span className="text-xs text-muted-foreground/50">·</span>
        <span className="text-sm font-medium truncate">
          {screenNode?.name ?? ''}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={toggleInspect}
          className={cn(
            'text-xs px-2.5 py-1 rounded border transition-colors',
            inspectMode
              ? 'bg-primary text-primary-foreground border-primary'
              : 'border-border/50 hover:bg-muted/50',
          )}
          title="Toggle inspect (⌘⇧C)"
          aria-pressed={inspectMode}
          aria-label="Toggle inspect mode"
        >
          Inspect
        </button>
        <button
          type="button"
          onClick={() => setReloadKey((n) => n + 1)}
          className="text-xs px-2 py-1 rounded border border-border/50 hover:bg-muted/50"
          title="Reload page"
          aria-label="Reload page"
        >
          ↻
        </button>
        <button
          type="button"
          onClick={close}
          className="text-xs px-2 py-1 rounded border border-border/50 hover:bg-muted/50"
          title="Exit (Esc)"
          aria-label="Exit fullscreen"
        >
          ⤢
        </button>
      </div>

      <div ref={iframeSlotRef} className="flex-1 relative bg-white">
        <iframe
          ref={iframeRef}
          key={reloadKey}
          src={fullUrl}
          sandbox="allow-scripts allow-same-origin allow-forms"
          title={screenNode?.name ?? 'Screen viewer'}
          className="absolute inset-0 w-full h-full border-0 bg-white"
          data-screen-iframe-overlay={expandedUuid}
        />
        <InspectHighlight slotRef={iframeSlotRef} iframeRef={iframeRef} />
      </div>
    </div>
  );
}
