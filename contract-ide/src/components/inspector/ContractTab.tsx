import { useEffect, useRef } from 'react';
import { useEditorStore } from '@/store/editor';
import { useGraphStore } from '@/store/graph';
import type { ContractNode } from '@/ipc/types';

/**
 * Contract tab — the textual contract editor (INSP-03).
 *
 * Phase 4 Plan 04-02 rebuild:
 *   - Save on blur (always fires if dirty).
 *   - Save on Cmd+S (local listener, pre-empts debounce immediately).
 *   - Debounced autosave while typing (400ms after last keystroke).
 *   - Every save routes through `useEditorStore.saveContract(repoPath, node)`,
 *     which hardcodes `human_pinned: true` (Pitfall 3 guard — without this,
 *     Phase 6 derivation would silently overwrite the user's edits).
 *
 * The global Cmd+S in `useKeyboardShortcuts` fires too; both call the same
 * idempotent save, so double-firing is harmless. The local listener exists
 * so Cmd+S pre-empts the 400ms debounce timer the moment the user presses it.
 *
 * The textarea is INTENTIONALLY plain (not Monaco) — per 04-RESEARCH.md,
 * contract editing is prose-first; Monaco is code-only (Code tab).
 */
const DEBOUNCE_MS = 400;

export default function ContractTab({ node }: { node: ContractNode | null }) {
  const contractText = useEditorStore((s) => s.contractText);
  const isDirty = useEditorStore((s) => s.isDirty);
  const setContractText = useEditorStore((s) => s.setContractText);
  const saveContract = useEditorStore((s) => s.saveContract);
  const repoPath = useGraphStore((s) => s.repoPath);
  const debounceRef = useRef<number | null>(null);

  // Debounced autosave on typing. Fires `DEBOUNCE_MS` after the last
  // keystroke (or sooner if `isDirty` flips again during the window, in
  // which case the effect re-runs and resets the timer).
  useEffect(() => {
    if (!isDirty || !node || !repoPath) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      saveContract(repoPath, node).catch(console.error);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [contractText, isDirty, node, repoPath, saveContract]);

  // Local Cmd+S — pre-empts the debounce the moment the user asks. The
  // global Cmd+S in useKeyboardShortcuts fires too; saves are idempotent
  // so the double-fire is harmless (just one extra hash + write).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (node && repoPath) void saveContract(repoPath, node);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [node, repoPath, saveContract]);

  return (
    <>
      {node ? (
        <div className="border-b border-border/50 px-3 py-2 flex items-center gap-2">
          <span className="text-xs font-medium text-foreground truncate">
            {node.name}
          </span>
          {node.human_pinned ? (
            <span
              className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 shrink-0"
              title="Human-pinned — write_derived_contract will skip this node"
            >
              pinned
            </span>
          ) : null}
        </div>
      ) : null}

      <textarea
        value={contractText}
        onChange={(e) => setContractText(e.target.value)}
        onBlur={() => {
          if (node && repoPath && isDirty) void saveContract(repoPath, node);
        }}
        placeholder={
          node
            ? 'Describe what this node does — behaviour, inputs, outputs…'
            : 'Select a node to edit its contract…'
        }
        spellCheck={false}
        className="flex-1 resize-none bg-transparent px-4 py-3 text-sm text-foreground outline-none font-mono leading-relaxed"
      />
      <div className="border-t border-border/50 px-4 py-1.5 text-[11px] text-muted-foreground flex items-center justify-between">
        <span data-autosave-status={isDirty ? 'dirty' : 'saved'}>
          {isDirty ? 'editing…' : 'saved'}
        </span>
        <span className="text-muted-foreground/60">
          Cmd+S to save · Cmd+Z to undo
        </span>
      </div>
    </>
  );
}
