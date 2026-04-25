import { useEffect } from 'react';
import { useEditorStore } from '../store/editor';
import { useGraphStore } from '../store/graph';

/**
 * Global keyboard shortcuts (SHELL-05).
 *
 *   Cmd+S / Ctrl+S → saveContract(repoPath, selectedNode) — global autosave
 *                    trigger. Reads the current selectedNode from the editor
 *                    store and repoPath from the graph store; bails silently
 *                    if either is missing (user hasn't opened a repo yet, or
 *                    has no node selected — both valid pre-edit states).
 *   Cmd+Z / Ctrl+Z → temporal.undo() (store-level undo, two-level capped)
 *
 * The Cmd+Z intercept is deliberate: we replace the native textarea undo
 * with the zundo temporal undo so that every setContractText call shows up
 * in the same stack — demo-recording protection means "one keystroke = one
 * observable revert," regardless of whether focus is inside the textarea or
 * out in the graph pane.
 *
 * Cmd+Shift+Z (redo) is NOT wired in Phase 1 — redo is out of scope for
 * SHELL-05's two-level rollback; Phase 4's Monaco integration can add it.
 *
 * Phase 4 Plan 04-02 note: the Contract tab installs a LOCAL Cmd+S listener
 * that fires alongside this global one. Both call the same `saveContract`;
 * saves are idempotent (hash + write), so double-firing is harmless. The
 * local listener exists so the debounce timer gets pre-empted immediately
 * on Cmd+S, not 400ms later.
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key === 's') {
        e.preventDefault();
        const { selectedNode, saveContract } = useEditorStore.getState();
        const { repoPath } = useGraphStore.getState();
        if (!selectedNode || !repoPath) return;
        void saveContract(repoPath, selectedNode);
        return;
      }

      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        useEditorStore.temporal.getState().undo();
        return;
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
}
