/**
 * Phase 13 Plan 12 — Keyboard shortcuts for ScreenViewerOverlay.
 *
 * Hotkeys:
 *   ⌘.     Expand the currently-selected screen (UI L3) into fullscreen.
 *          No-op if no screen is selected.
 *   ⌘⇧C   Toggle inspect mode (only when overlay is open).
 *   Esc    Layered exit:
 *            - inspect mode on  → turn inspect off (keep last selection)
 *            - inspect mode off → close overlay (preserve graph selection)
 *
 * Closing the overlay does NOT touch graph-store selection — whichever atom
 * the user last clicked in inspect mode remains selected, so the existing
 * bottom Inspector continues to show its contract after exit.
 *
 * Esc inside the iframe (e.g., closing a modal in the demo page) does NOT
 * propagate to this listener: the keydown listener attached to the parent
 * document doesn't receive events from inside the iframe (different document).
 */

import { useEffect } from 'react';
import { useScreenViewerStore } from '@/store/screenViewer';
import { useGraphStore } from '@/store/graph';

function getFocusedScreenUuid(): string | null {
  const { selectedNodeUuid, nodes } = useGraphStore.getState();
  if (!selectedNodeUuid) return null;
  const node = nodes.find((n) => n.uuid === selectedNodeUuid);
  if (!node) return null;
  // ScreenCard renders L3 UI nodes (per Phase 13 Plan 05). We accept either
  // the explicit kind === 'UI' OR a kind that begins with 'screen' for
  // forward-compat with future kind taxonomy revisions.
  if (node.level !== 'L3') return null;
  if (node.kind === 'UI' || node.kind.toLowerCase().startsWith('screen')) {
    return selectedNodeUuid;
  }
  return null;
}

export function useScreenViewerHotkeys() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const store = useScreenViewerStore.getState();
      const isMeta = e.metaKey || e.ctrlKey;

      // ⌘. — expand the currently-selected screen
      if (isMeta && !e.shiftKey && e.key === '.') {
        const uuid = getFocusedScreenUuid();
        if (uuid) {
          e.preventDefault();
          store.expand(uuid);
        }
        return;
      }

      // ⌘⇧C — toggle inspect mode (only when overlay open)
      if (
        isMeta &&
        e.shiftKey &&
        e.key.toLowerCase() === 'c' &&
        store.expandedScreenUuid
      ) {
        e.preventDefault();
        store.toggleInspect();
        return;
      }

      // Esc — layered exit (only when overlay open)
      if (e.key === 'Escape' && store.expandedScreenUuid) {
        e.preventDefault();
        if (store.inspectMode) {
          store.setInspect(false);
        } else {
          store.close();
        }
        return;
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
}
