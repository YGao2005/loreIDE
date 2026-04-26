/**
 * Phase 13 Plan 05 — CHIP-01: Parent-layer atom-chip overlay container.
 *
 * Mounts as an absolute-positioned container layered over a ScreenCard's
 * iframe. On iframe `load` and parent window `resize`, queries the iframe
 * DOM for `[data-contract-uuid]` elements via `requestChipRects` and renders
 * an AtomChip at each bounding rect.
 *
 * Why parent layer (not inside the iframe):
 *   1. Cross-origin defence — chips work without injecting scripts into the
 *      user's dev server.
 *   2. Pan/zoom integrity — the iframe content scrolls/scales independently
 *      of the canvas; positioning chips in the parent lets the chain layout
 *      stay correct under react-flow zoom.
 *   3. Click intercept — chips have pointer-events: auto, iframe has
 *      pointer-events: none on canvas; chip clicks fire while wheel/empty
 *      clicks bubble to react-flow.
 *
 * Empty-element fallback (per CARD-01 spec):
 *   Atoms with NO matching `[data-contract-uuid]` element in the iframe DOM
 *   render nothing TODAY — the full empty-section fallback (place chip at
 *   the bottom of `data-contract-section-uuid` region) is deferred to plan
 *   13-10b once the seeded fixture is in place.
 *
 * Refresh strategy:
 *   - Initial fetch deferred 200ms after mount (lets initial paint settle).
 *   - Re-fetch on iframe `load` event (covers route navigation inside iframe).
 *   - Re-fetch on window `resize` event (chip positions track the layout).
 *   - NEVER on every render — would create infinite loops because setChips
 *     triggers re-render.
 */

import { useEffect, useMemo, useState, type RefObject } from 'react';
import {
  requestChipRects,
  type ChipRect,
} from '@/lib/iframeChipPositioning';
import { AtomChip } from './AtomChip';
import { useGraphStore } from '@/store/graph';

export interface AtomChipOverlayProps {
  /**
   * Ref to the iframe element this overlay is layered over. The overlay's
   * positioning is `absolute inset-0` relative to the iframe's stacking
   * context, so the iframe and the overlay container must share a parent
   * with `position: relative` (ScreenCard provides this).
   */
  iframeRef: RefObject<HTMLIFrameElement | null>;
  /**
   * The screen contract uuid. Used to filter atoms (via `parent_uuid`) to
   * just those anchored to THIS screen — sibling atoms anchored to other
   * screens are not rendered here.
   */
  parentUuid: string;
}

interface MergedChip {
  uuid: string;
  name: string;
  rect: ChipRect['rect'];
}

export function AtomChipOverlay({ iframeRef, parentUuid }: AtomChipOverlayProps) {
  const [chips, setChips] = useState<MergedChip[]>([]);

  // Stable selector pattern (per Plan 13-05 — avoids "Maximum update depth"
  // when subscribed selector returns a new array each render).
  const allNodes = useGraphStore((s) => s.nodes);
  const atoms = useMemo(
    () =>
      allNodes.filter(
        (n) => n.parent_uuid === parentUuid && n.level === 'L4',
      ),
    [allNodes, parentUuid],
  );

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    let cancelled = false;
    const refresh = async () => {
      const uuids = atoms.map((a) => a.uuid);
      const rects = uuids.length > 0
        ? await requestChipRects(iframe, uuids)
        : [];
      if (cancelled) return;
      const merged: MergedChip[] = rects.map((r) => {
        const atom = atoms.find((a) => a.uuid === r.uuid);
        return {
          uuid: r.uuid,
          name: atom?.name ?? 'Untitled atom',
          rect: r.rect,
        };
      });
      setChips(merged);
    };

    const onLoad = () => void refresh();
    const onResize = () => void refresh();
    iframe.addEventListener('load', onLoad);
    window.addEventListener('resize', onResize);

    const initialHandle = setTimeout(() => {
      void refresh();
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(initialHandle);
      iframe.removeEventListener('load', onLoad);
      window.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atoms.length, parentUuid]);

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      data-overlay="atom-chips"
    >
      {chips.map((c) => (
        <AtomChip key={c.uuid} uuid={c.uuid} name={c.name} rect={c.rect} />
      ))}
    </div>
  );
}
