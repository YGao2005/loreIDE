import { create } from 'zustand';
import type { ContractNode } from '@/ipc/types';
import { getNodes } from '@/ipc/nodes';
import { getLensNodes, rebuildGhostRefs } from '@/ipc/graph';
import { isFlowContract } from '@/ipc/types';

/**
 * Graph store for Phase 2+.
 *
 * Phase 2 adds `nodes` (real SQLite-backed data) and `refreshNodes` so
 * GraphPlaceholder and the watcher (Plan 02-03) share a single source of
 * truth.
 *
 * Phase 3 Plan 1 adds `currentLens` + `setLens`. The canvas / sidebar read
 * and write the active lens here so Plan 03-02's lens-aware data fetch can
 * pull from a single source of truth. Journey is the default.
 *
 * Phase 3 Plan 2 adds:
 *  - `parentUuidStack` + `pushParent`/`popParent`/`resetParents` — the
 *    breadcrumb drill-in path. `stack[0]` is always L0 once anything has
 *    been pushed; L1 is `stack[1]` at the earliest.
 *  - `fetchGeneration` — a monotonic counter that guards `set({nodes})` so
 *    rapid lens-toggle clicks commit ONLY the last click's result (Issue 6:
 *    race-safe last-click-wins).
 *  - `setLens` is now ASYNC and re-fetches via the correct lens path.
 */
export type LensId = 'journey' | 'system' | 'ownership';

interface GraphState {
  nodes: ContractNode[];
  selectedNodeUuid: string | null;
  currentLens: LensId;
  // Drill-in stack: parentUuidStack[0] is the L0 root; subsequent entries are
  // the user's drill path (L1, L2, L3...). The breadcrumb maps each entry to
  // its node.name for display.
  parentUuidStack: string[];
  // Last-click-wins generation counter. Incremented by setLens + refreshNodes;
  // each in-flight fetch captures the value at start and only commits if the
  // captured value still matches `fetchGeneration` at completion. Prevents
  // rapid lens-toggle race conditions (Issue 6 from checker).
  fetchGeneration: number;
  // Phase 4 Plan 04-01: single source of truth for the open repo path,
  // populated at repo-open time by pickAndOpenRepo (and openRepo for
  // programmatic reopens). Consumed by the Inspector + CodeTab + (later)
  // PreviewTab so they don't each call getRepoPath() IPC and race with the
  // scan events. Null before the user opens a repo.
  repoPath: string | null;

  selectNode: (uuid: string | null) => void;
  setLens: (lens: LensId) => Promise<void>;
  pushParent: (uuid: string) => void;
  popParent: () => void;
  resetParents: () => void;
  refreshNodes: () => Promise<void>;
  setRepoPath: (path: string | null) => void;
  /**
   * Phase 9 FLOW-01: return the ordered member uuids for a flow node, or []
   * if the node doesn't exist or is not a flow kind.
   * Phase 13 CHAIN-01 + Cmd+P-to-flow nav (Phase 13 SUB-08) consume this.
   */
  getFlowMembers: (flowUuid: string) => string[];
}

/**
 * Resolve the current L1 flow UUID from the parent stack.
 *
 * `node_flows.flow_uuid` only stores L1 UUIDs (per scanner.rs:191-218 —
 * populated from ContractFrontmatter.parent or .route, both of which are L1
 * anchors). `parentUuidStack[0]` is always L0 (the product root) once the
 * user has drilled at all, so passing stack[0] to get_lens_nodes returns
 * zero rows.
 *
 * This helper walks the stack and returns the FIRST L1 ancestor's uuid by
 * looking each stack entry up in the loaded nodes set and matching `level`.
 * Returns null if the stack is empty or contains no L1 entry yet — the
 * caller (refreshNodes) treats null as "no journey filter, return all
 * nodes."
 */
export function getCurrentFlowUuid(
  stack: string[],
  allNodes: ContractNode[]
): string | null {
  for (const uuid of stack) {
    const node = allNodes.find((n) => n.uuid === uuid);
    if (node?.level === 'L1') return uuid;
  }
  return null;
}

export const useGraphStore = create<GraphState>((set, get) => ({
  nodes: [],
  selectedNodeUuid: null,
  currentLens: 'journey',
  parentUuidStack: [],
  fetchGeneration: 0,
  repoPath: null,

  selectNode: (selectedNodeUuid) => set({ selectedNodeUuid }),
  setRepoPath: (repoPath) => set({ repoPath }),

  getFlowMembers: (flowUuid: string) => {
    const node = get().nodes.find((n) => n.uuid === flowUuid);
    if (!node || !isFlowContract(node)) return [];
    return node.members;
  },

  // setLens is async — switching lenses re-fetches via getLensNodes so the
  // node set actually changes. Race-safe via fetchGeneration: if a second
  // setLens lands before the first's invoke completes, the first's commit
  // is discarded (last-click-wins).
  setLens: async (lens) => {
    set({ currentLens: lens });
    await get().refreshNodes();
  },

  pushParent: (uuid) =>
    set((s) => ({ parentUuidStack: [...s.parentUuidStack, uuid] })),
  popParent: () =>
    set((s) => ({ parentUuidStack: s.parentUuidStack.slice(0, -1) })),
  resetParents: () => set({ parentUuidStack: [] }),

  refreshNodes: async () => {
    // Increment + capture the generation BEFORE the await so this fetch's
    // commit is gated on no newer fetch having started in the meantime.
    const myGen = get().fetchGeneration + 1;
    set({ fetchGeneration: myGen });

    const { currentLens, parentUuidStack, nodes: currentNodes } = get();
    // Lens-aware fetch. Journey lens needs an L1 flow_uuid context — we
    // resolve it from the parent stack via getCurrentFlowUuid (NOT via
    // parentUuidStack[0], which is always L0 — see Issue 3 in checker).
    let rows: ContractNode[];
    if (currentLens === 'journey') {
      const flowUuid = getCurrentFlowUuid(parentUuidStack, currentNodes);
      if (flowUuid) {
        rows = await getLensNodes({ lens: 'journey', flowUuid });
      } else {
        // No L1 in stack yet (user is at root) — show everything.
        rows = await getNodes();
      }
    } else {
      // System / Ownership lenses fall through to the catch-all in Rust
      // (return all nodes) — Phase 3 ships them as "selectable without
      // crash."
      rows = await getLensNodes({ lens: currentLens });
    }

    // Defense-in-depth: ensure ghosts are fresh on every refresh. Non-fatal
    // on failure — the fetched rows are still usable without ghosts.
    try {
      await rebuildGhostRefs();
    } catch (e) {
      console.warn('[graphStore] rebuildGhostRefs failed (non-fatal):', e);
    }

    // LAST-CLICK-WINS: only commit if no newer refresh has started.
    if (get().fetchGeneration !== myGen) {
      console.debug(
        '[graphStore] discarding stale fetch result (gen',
        myGen,
        'vs',
        get().fetchGeneration,
        ')'
      );
      return;
    }
    set({ nodes: rows });
  },
}));
