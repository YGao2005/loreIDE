import { create } from 'zustand';
import { temporal } from 'zundo';
import type { ContractFrontmatter, ContractNode } from '@/ipc/types';
import { hashText, readContractFrontmatter } from '@/ipc/inspector';
import { writeContract } from '@/ipc/contracts';
import { useGraphStore } from '@/store/graph';

/**
 * Editor store — owns the currently-editing contract text (SHELL-05) and
 * (Phase 4 Plan 04-02) the live `selectedNode` + the real `write_contract`
 * save path with the human_pinned guard.
 *
 * Two-level undo is the explicit SHELL-05 requirement: during demo recording,
 * a stray Cmd+Z should revert the last edit (and one before) but NOT unwind
 * the whole session. `temporal({ limit: 2 })` enforces that boundary.
 *
 * `partialize` is the subtle piece: without it, zundo would snapshot both
 * `contractText` AND `isDirty` on every setState call — then undo would
 * revert the dirty flag too, yo-yo-ing the "saved"/"editing…" status line.
 * Capturing only `contractText` means the undo stack is a clean history of
 * textual edits and the isDirty flag is reapplied by the next setContractText.
 *
 * `loadNode` clears the temporal history so Cmd+Z doesn't jump across nodes
 * (a textarea on node A must not undo into node B's body). `setContractText`
 * does NOT clear history — otherwise every keystroke wipes undo.
 *
 * `saveContract(repoPath, node)` — Phase 4 Plan 04-02 write path:
 *   1. Read the existing sidecar frontmatter (via `read_contract_frontmatter`)
 *      so we preserve server-derived fields (neighbors, format_version,
 *      derived_at) that the user cannot edit. This read is LOAD-BEARING:
 *      `write_contract` triggers `upsert_node_pub` which DELETEs all outgoing
 *      edges for the node before re-inserting from `fm.neighbors`; hardcoding
 *      `neighbors: []` here wipes every edge on every human-pinned save.
 *   2. Hash the new body via Rust `hash_text` so `contract_hash` matches the
 *      derivation pipeline byte-for-byte.
 *   3. Write with `human_pinned: true` (Pitfall 3 — forgetting this makes
 *      Phase 6 derivation silently overwrite the user's edits).
 */
interface EditorState {
  contractText: string;
  isDirty: boolean;
  selectedNode: ContractNode | null;
  lastSavedAt: number | null;

  setContractText: (text: string) => void;
  saveContract: (repoPath: string, node: ContractNode) => Promise<void>;
  loadNode: (node: ContractNode | null) => void;
  resetEditor: () => void;
}

export const useEditorStore = create<EditorState>()(
  temporal(
    (set, get) => ({
      contractText: '',
      isDirty: false,
      selectedNode: null,
      lastSavedAt: null,

      setContractText: (contractText) =>
        set({ contractText, isDirty: true }),

      saveContract: async (repoPath, node) => {
        const { contractText } = get();
        if (!repoPath || !node) return;
        // Allow empty body saves only when they intentionally clear an
        // existing body — the textarea still needs to debounce-fire for a
        // wipe-and-save. Guard against the (repoPath) missing path alone.
        const newContractHash = await hashText(contractText);

        // DATA-CORRUPTION GUARD: `write_contract` is an OVERWRITE (sidecar)
        // + `DELETE FROM edges WHERE source_uuid = ?` followed by re-insert
        // from `fm.neighbors`. We MUST read the existing frontmatter first
        // and preserve server-derived fields the user cannot edit
        // (neighbors, format_version, derived_at) — otherwise every
        // human-pinned save silently wipes Phase 6 derivation output and
        // all outgoing graph edges for this node.
        const existing = await readContractFrontmatter(repoPath, node.uuid);

        const frontmatter: ContractFrontmatter = {
          // Preserved (server-derived — never clobber):
          format_version: existing?.format_version ?? 1,
          neighbors: existing?.neighbors ?? [],
          derived_at: existing?.derived_at ?? node.derived_at ?? null,

          // From ContractNode (current in-memory truth):
          uuid: node.uuid,
          kind: node.kind,
          level: node.level,
          // ContractNode exposes parent as parent_uuid; frontmatter uses
          // `parent` — map explicitly. Normalise empty strings to null so the
          // FK `parent_uuid REFERENCES nodes(uuid)` passes — scanner wrote
          // some rows with empty strings which look non-null but don't match
          // any node.
          parent:
            node.parent_uuid && node.parent_uuid !== ''
              ? node.parent_uuid
              : null,
          code_ranges: node.code_ranges ?? [],
          code_hash: node.code_hash ?? null,
          route: node.route && node.route !== '' ? node.route : null,

          // Always-recomputed / pin markers:
          contract_hash: newContractHash,
          human_pinned: true, // Pitfall 3: ALWAYS true on inspector save
        };

        await writeContract({
          repoPath,
          uuid: node.uuid,
          frontmatter,
          body: contractText,
        });
        set({ isDirty: false, lastSavedAt: Date.now() });

        // Refresh the graph store so selectedNode.contract_body picks up the
        // new body. Without this, switching tabs (or re-clicking the node
        // after deselection) reloads from a stale ContractNode snapshot and
        // the just-saved body appears reverted. The .contracts/ watcher would
        // eventually call refreshNodes via its 2s debounce, but tab switches
        // happen faster than that — and the auto-restore openRepo path doesn't
        // start the watcher at all.
        useGraphStore.getState().refreshNodes().catch((e: unknown) => {
          console.warn('[editor] refreshNodes after save failed (non-fatal):', e);
        });
      },

      loadNode: (node) => {
        set({
          selectedNode: node,
          contractText: node?.contract_body ?? '',
          isDirty: false,
        });
        // Clear zundo history so Cmd+Z doesn't jump across node boundaries.
        // Do NOT put this in setContractText — every keystroke would wipe
        // the undo stack.
        useEditorStore.temporal.getState().clear();
      },

      resetEditor: () =>
        set({
          contractText: '',
          isDirty: false,
          selectedNode: null,
          lastSavedAt: null,
        }),
    }),
    {
      limit: 2, // SHELL-05: two-level undo
      // Only capture text in the undo stack — keep isDirty flag out so
      // "saved"/"editing…" status doesn't oscillate with each undo.
      partialize: (state) => ({ contractText: state.contractText }),
    }
  )
);
