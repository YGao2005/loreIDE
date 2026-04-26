/**
 * Phase 13 Plan 05 — CHIP-01: Parent-layer atom-chip overlay container.
 *
 * Mounts as an absolute-positioned container layered over a ScreenCard's
 * iframe. On iframe `load` and parent window `resize`, queries the iframe
 * DOM for `[data-contract-uuid]` elements via `requestChipRects` and renders
 * an AtomChip at each bounding rect.
 *
 * Why parent layer (not inside the iframe):
 *   1. Cross-origin defence — even though localhost is same-origin today,
 *      we don't want to inject scripts into the user's dev server. Parent
 *      layer chips work without any iframe-side cooperation.
 *   2. Pan/zoom integrity — the iframe content scrolls/scales independently
 *      of the canvas; positioning chips in the parent lets the chain layout
 *      stay correct under react-flow zoom while the iframe content moves
 *      independently.
 *   3. Click intercept — the parent overlay's pointer-events-none container
 *      with pointer-events-auto chips lets clicks land on chips while
 *      passing through to the iframe (when in Interact mode).
 *
 * Empty-element fallback (per CARD-01 spec):
 *   Atoms with NO matching `[data-contract-uuid]` element in the iframe DOM
 *   render nothing TODAY — the full empty-section fallback (place chip at
 *   the bottom of `data-contract-section-uuid` region) is deferred to plan
 *   13-10b once the seeded fixture is in place. This means: until BABEL-01
 *   (Phase 9 SC 6) ships, atoms whose JSX has not been annotated yet won't
 *   appear as chips. Plan 13-11 rehearsal surfaces this as a Phase 9 contract
 *   gap if not yet shipped.
 *
 * Refresh strategy:
 *   - Initial fetch with a 200ms delay after mount (lets HMR + initial
 *     paint settle).
 *   - Re-fetch on iframe `load` event (covers route navigation inside the
 *     iframe).
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

/**
 * Internal merged-chip shape — joins the iframe-DOM rect (from
 * requestChipRects) with the atom contract's display name (from graphStore).
 */
interface MergedChip {
  uuid: string;
  name: string;
  rect: ChipRect['rect'];
}

export function AtomChipOverlay({ iframeRef, parentUuid }: AtomChipOverlayProps) {
  const [chips, setChips] = useState<MergedChip[]>([]);

  // Subscribe to graph nodes — when an L4 atom anchored to this screen is
  // added or removed, we want to re-fetch (the new atom's chip won't appear
  // until requestChipRects runs again).
  //
  // CRITICAL: subscribe to the stable `s.nodes` array reference, then derive
  // the filtered list via useMemo. A `s.nodes.filter(...)` selector returns a
  // NEW array reference on every render, which under React 19 + Zustand 5's
  // useSyncExternalStore triggers the "getSnapshot should be cached" warning
  // and an infinite update loop ("Maximum update depth exceeded"). The store's
  // `nodes` slice is replaced atomically on refresh (graphStore.refreshNodes
  // does `set({ nodes: rows })`), so subscribing to it is identity-stable
  // between fetches.
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
      const rects = await requestChipRects(iframe);
      if (cancelled) return;
      // Join rects with atom display names by uuid. If an atom has no
      // matching JSX element in the iframe, it doesn't appear in `rects`
      // so it doesn't render — see "Empty-element fallback" comment above.
      // TODO(plan 13-10b): when atom has code_ranges.section_uuid but no
      //   JSX element matches, look up the section element
      //   (data-contract-section-uuid) and place chip at section's bottom
      //   region. For now: render nothing for unmatched atoms.
      const merged: MergedChip[] = rects.map((r) => {
        const atom = atoms.find((a) => a.uuid === r.uuid);
        return {
          uuid: r.uuid,
          name: atom?.name ?? r.uuid.slice(0, 8),
          rect: r.rect,
        };
      });
      setChips(merged);
    };

    const onLoad = () => void refresh();
    const onResize = () => void refresh();
    iframe.addEventListener('load', onLoad);
    window.addEventListener('resize', onResize);

    // Initial fetch deferred slightly so any HMR / initial-paint settles
    // before we measure rects. 200ms is the same delay PreviewTab uses
    // implicitly (probe round-trip) and keeps the first-paint feeling
    // synchronous to the user.
    const initialHandle = setTimeout(() => {
      void refresh();
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(initialHandle);
      iframe.removeEventListener('load', onLoad);
      window.removeEventListener('resize', onResize);
    };
    // Re-bind when the count of matching atoms changes (a new atom anchored
    // to this screen was loaded via the watcher / repo reopen). atom-array
    // identity changes every render so we use length as a stable signal.
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
