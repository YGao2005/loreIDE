/**
 * Phase 13 Plan 12 — Inspect-mode highlight + cursor badge.
 *
 * Mounts inside ScreenViewerOverlay's iframe slot. When inspect mode is on:
 *
 *   1. Tells the iframe responder to enable mousemove/click listeners
 *      (`enableInspect`).
 *   2. Subscribes to inspect-hover and inspect-click events from the responder.
 *   3. Renders an absolutely-positioned outline div over the hovered atom's
 *      rect (in the parent DOM, NOT injected into the iframe — keeps the demo
 *      page's DOM clean and survives page navigation).
 *   4. Shows a small badge near the rect with the atom's name + kind.
 *   5. On click, syncs `useGraphStore.selectNode(uuid)` so the existing bottom
 *      Inspector slot in AppShell auto-renders the contract.
 *
 * Rect coordinate system:
 *   The responder reports rects in iframe-local coords (from getBoundingClientRect
 *   inside the iframe). The iframe is sized to fill the slot via `absolute inset-0`,
 *   so iframe-local coords ARE slot-local coords. No scaling.
 *
 * Selected vs hover visual:
 *   - Hover only: blue 2px outline, light translucent fill
 *   - Selected (matches useGraphStore.selectedNodeUuid): orange 2px outline,
 *     stronger fill — Chrome DevTools "preview vs locked" feedback
 */

import { useEffect, useState, type RefObject } from 'react';
import {
  enableInspect,
  disableInspect,
  subscribeInspect,
  type InspectHoverPayload,
} from '@/lib/iframeChipPositioning';
import { useScreenViewerStore } from '@/store/screenViewer';
import { useGraphStore } from '@/store/graph';
import { cn } from '@/lib/utils';

export interface InspectHighlightProps {
  /** Slot the highlights are positioned within. Reserved for future scale math. */
  slotRef: RefObject<HTMLDivElement | null>;
  /** Iframe to inspect — owned by ScreenViewerOverlay. */
  iframeRef: RefObject<HTMLIFrameElement | null>;
}

export function InspectHighlight({
  slotRef: _slotRef,
  iframeRef,
}: InspectHighlightProps) {
  const inspectMode = useScreenViewerStore((s) => s.inspectMode);
  const expandedUuid = useScreenViewerStore((s) => s.expandedScreenUuid);
  const setHover = useScreenViewerStore((s) => s.setHover);
  const hoverUuid = useScreenViewerStore((s) => s.hoverUuid);
  const hoverRect = useScreenViewerStore((s) => s.hoverRect);

  const selectedUuid = useGraphStore((s) => s.selectedNodeUuid);

  const hoverNode = useGraphStore((s) =>
    hoverUuid ? s.nodes.find((n) => n.uuid === hoverUuid) ?? null : null,
  );

  // Wire enable/disable + subscription. The effect re-runs whenever inspect
  // mode flips or the expanded screen changes. Defer enableInspect by 250ms
  // on first run to give the responder script time to load + attach.
  useEffect(() => {
    if (!inspectMode || !expandedUuid) return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    let unsub: (() => void) | null = null;

    const attach = () => {
      const ifr = iframeRef.current;
      if (!ifr) return;
      enableInspect(ifr);
      unsub = subscribeInspect(
        ifr,
        (p: InspectHoverPayload) => {
          if (p.uuid === null) {
            setHover(null, null);
          } else {
            setHover(p.uuid, p.rect);
          }
        },
        (p) => {
          // Sync to graph-store selection. The existing AppShell effect at
          // AppShell.tsx:421-430 listens for selectedNodeUuid changes and
          // expands/collapses the bottom Inspector accordingly.
          useGraphStore.getState().selectNode(p.uuid);
        },
      );
    };

    // If iframe already loaded (contentDocument readyState complete),
    // attach immediately. Otherwise wait for load.
    const ifrDoc = iframe.contentDocument;
    if (ifrDoc && ifrDoc.readyState === 'complete') {
      attach();
    } else {
      const onLoad = () => attach();
      iframe.addEventListener('load', onLoad, { once: true });
      // Fallback timeout in case load already fired
      const t = setTimeout(attach, 600);
      return () => {
        iframe.removeEventListener('load', onLoad);
        clearTimeout(t);
        if (unsub) unsub();
        const ifr = iframeRef.current;
        if (ifr) disableInspect(ifr);
        setHover(null, null);
      };
    }

    return () => {
      if (unsub) unsub();
      const ifr = iframeRef.current;
      if (ifr) disableInspect(ifr);
      setHover(null, null);
    };
  }, [inspectMode, expandedUuid, setHover, iframeRef]);

  const [badgeBelow, setBadgeBelow] = useState(false);
  useEffect(() => {
    if (!hoverRect) {
      setBadgeBelow(false);
      return;
    }
    setBadgeBelow(hoverRect.top < 40);
  }, [hoverRect]);

  if (!inspectMode || !hoverRect) return null;

  const isSelected = hoverUuid !== null && hoverUuid === selectedUuid;

  return (
    <>
      <div
        className={cn(
          'absolute pointer-events-none transition-all duration-75 ease-out',
          'border-2 rounded-sm',
          isSelected
            ? 'border-orange-500 bg-orange-500/10 shadow-[0_0_0_1px_rgba(249,115,22,0.3)]'
            : 'border-blue-500 bg-blue-500/5 shadow-[0_0_0_1px_rgba(59,130,246,0.25)]',
        )}
        style={{
          top: hoverRect.top,
          left: hoverRect.left,
          width: hoverRect.width,
          height: hoverRect.height,
          zIndex: 50,
        }}
      />
      {hoverNode && (
        <div
          className={cn(
            'absolute pointer-events-none px-2 py-1 rounded-md shadow-lg text-[11px]',
            'bg-popover border border-border/60 text-popover-foreground',
            'max-w-xs whitespace-nowrap overflow-hidden text-ellipsis',
          )}
          style={{
            left: hoverRect.left,
            top: badgeBelow
              ? hoverRect.top + hoverRect.height + 4
              : Math.max(0, hoverRect.top - 28),
            zIndex: 50,
          }}
        >
          <span className="font-mono text-muted-foreground">
            {hoverNode.kind}
          </span>
          <span className="text-muted-foreground/50 mx-1.5">·</span>
          <span className="font-medium">{hoverNode.name}</span>
        </div>
      )}
    </>
  );
}
