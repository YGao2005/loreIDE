import { useEffect, useState } from 'react';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { useGraphStore } from '@/store/graph';
import { useEditorStore } from '@/store/editor';
import { useCherrypickStore } from '@/store/cherrypick';
import { useUiStore } from '@/store/ui';
import { openInEditor } from '@/ipc/inspector';
import { cn } from '@/lib/utils';
import ContractTab from '@/components/inspector/ContractTab';
import CodeTab from '@/components/inspector/CodeTab';
import PreviewTab from '@/components/inspector/PreviewTab';
import DriftBadge from '@/components/inspector/DriftBadge';
import ReconcilePanel from '@/components/inspector/ReconcilePanel';
import { CherrypickModal } from '@/components/cherrypick/CherrypickModal';
import { SimplifiedInspector } from '@/components/inspector/SimplifiedInspector';
import { DelegateButton } from '@/components/inspector/DelegateButton';

/**
 * Right-hand inspector panel (SHELL-01 + SHELL-05 + INSP-01 + INSP-05).
 *
 * Plan 04-01 Task 2 refactored this into a thin container:
 *   - Subscribes to useGraphStore.selectedNodeUuid / nodes / repoPath.
 *   - Renders a header strip with the node's name + level + kind badges.
 *   - Delegates every tab body to its own component in @/components/inspector.
 *
 * Tab strip uses the existing BUTTON-BASED pattern (not shadcn Tabs — that
 * component is not installed in this project; the button pattern matches the
 * rest of the UI and keeps bundle weight down). Switching nodes resets the
 * active tab back to Contract via a useEffect on selectedNodeUuid.
 *
 * Derivation flow (Phase 6 pivot): the user copies a prompt from the Contract
 * tab and runs it in their active Claude Code session, which uses the
 * `contract-ide` MCP server tools (`list_nodes_needing_derivation` +
 * `write_derived_contract`) to do the actual derivation. The Rust fs watcher
 * (Phase 2) picks up the sidecar change and refreshes SQLite; the graph
 * re-renders automatically.
 *
 * Phase 8 Plan 08-05 (CHRY-01..03): the Inspector now renders:
 *   - CherrypickModal (Dialog overlay outside tab body)
 *   - Dev-only "Demo cherrypick" affordance in the header for end-to-end
 *     testing of the modal + atomic IPC path without waiting on 08-04
 *     patch-extraction integration.
 *
 * TODO(08-06 or Phase 9): Remove the "Demo cherrypick" button once the agent
 * loop (08-04) populates pendingPatch from real JSONL tool_use blocks.
 */
type InspectorTab = 'Contract' | 'Code' | 'Preview';
const TABS: InspectorTab[] = ['Contract', 'Code', 'Preview'];

export function Inspector() {
  const [activeTab, setActiveTab] = useState<InspectorTab>('Contract');
  const [reconcileOpen, setReconcileOpen] = useState(false);

  const selectedNodeUuid = useGraphStore((s) => s.selectedNodeUuid);
  const nodes = useGraphStore((s) => s.nodes);
  const repoPath = useGraphStore((s) => s.repoPath);
  const selectedNode =
    nodes.find((n) => n.uuid === selectedNodeUuid) ?? null;

  // Phase 9 Plan 09-03 (NONC-01): Copy Mode — when active and node is L4, render SimplifiedInspector.
  const copyModeActive = useUiStore((s) => s.copyModeActive);

  // Jump back to Contract whenever the user selects a new node. The user's
  // last active tab is NOT preserved across selection — the Contract tab is
  // the most-used surface and the least-confusing default.
  useEffect(() => {
    setActiveTab('Contract');
  }, [selectedNodeUuid]);

  // Pitfall 3 from 09-RESEARCH.md: when Copy Mode activates and the Code tab
  // was open, switch to Contract — the Code tab disappears in Copy Mode and
  // leaving activeTab='Code' causes stale state in the four-tab layout if the
  // user later deactivates Copy Mode while still on the same node.
  useEffect(() => {
    if (copyModeActive && activeTab === 'Code') {
      setActiveTab('Contract');
    }
  }, [copyModeActive, activeTab]);

  // Close the reconcile panel when the selected node changes — prevents
  // stale panel referencing the previous node if user clicks another node
  // while the dialog is open.
  useEffect(() => {
    setReconcileOpen(false);
  }, [selectedNodeUuid]);

  // Phase 4 Plan 04-02: seed the editor store's text + selectedNode slice
  // whenever the user clicks a different node. `loadNode` clears the zundo
  // temporal history so Cmd+Z doesn't jump across node boundaries.
  //
  // Guard against re-entry: `selectedNode` is `nodes.find(...)` — a new object
  // reference every time the `nodes` array updates (file watcher rescan, our
  // own save-triggered rescan). Without the UUID-match check below, the effect
  // refires mid-edit and overwrites `contractText` with stale `node.contract_body`,
  // reverting the user's typing and kicking the cursor to the bottom.
  useEffect(() => {
    const editorUuid = useEditorStore.getState().selectedNode?.uuid ?? null;
    if (editorUuid === selectedNodeUuid) return;
    useEditorStore.getState().loadNode(selectedNode);
  }, [selectedNodeUuid, selectedNode]);

  // Cmd+R / Cmd+O shortcuts: active only while the Code tab is focused and
  // a node with code_ranges is selected. The listener is mounted at the
  // Inspector level (not CodeTab) so tab switches don't thrash the binding.
  // preventDefault() runs BEFORE invoke — without it Cmd+R reloads WebKit
  // and the handler never fires (Plan 03-03 Cmd+K pattern).
  //
  // Multi-file nodes: the shortcut always targets code_ranges[0] (the first
  // file). The Reveal/Open buttons ON each file strip inside the Code tab
  // remain the way to reach additional files.
  useEffect(() => {
    if (activeTab !== 'Code') return;
    if (!selectedNode || !repoPath) return;
    if (!selectedNode.code_ranges || selectedNode.code_ranges.length === 0) {
      return;
    }
    const first = selectedNode.code_ranges[0];
    const filePath = `${repoPath}/${first.file}`;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      if (e.key === 'r') {
        e.preventDefault();
        void revealItemInDir(filePath).catch(console.error);
      } else if (e.key === 'o') {
        e.preventDefault();
        void openInEditor(filePath, first.start_line).catch(console.error);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTab, selectedNode, repoPath]);

  /**
   * Phase 8 Plan 08-05 — dev-only "Demo cherrypick modal" affordance.
   *
   * Opens the CherrypickModal with a SYNTHETIC PendingPatch constructed from:
   *   - The selected node's current contract body as `contractBefore`
   *   - A synthetic "append intent stub" as `contractAfter`
   *   - A synthetic FilePatch pointing at `code_ranges[0].file` (or a fallback)
   *
   * Proves the modal + DiffPane layout + single-IPC Approve path works
   * end-to-end without waiting on Phase 8 Plan 08-04's JSONL extraction.
   *
   * TODO(08-06 or Phase 9): Remove this button. The agent loop (08-04) will
   * populate useCherrypickStore.pendingPatch directly from the JSONL tool_use
   * blocks after each agent run.
   */
  const handleDemoCherrypick = () => {
    if (!selectedNode || !repoPath) return;

    const contractBefore = selectedNode.contract_body ?? '(no contract body)';
    const contractAfter = contractBefore + '\n\n## Updated by Demo\n\nThis is a synthetic patch for testing the cherrypick flow.';

    const firstFile = selectedNode.code_ranges?.[0]?.file ?? 'README.md';

    useCherrypickStore.getState().setPendingPatch({
      uuid: selectedNode.uuid,
      nodeName: selectedNode.name,
      intentPhrase: 'synthetic demo patch',
      toolCallCount: 3,
      contractBefore,
      contractAfter,
      filePatches: [
        {
          file: firstFile,
          before: '// original content (synthetic)',
          after: '// updated content (synthetic demo cherrypick)',
        },
      ],
    });
    useCherrypickStore.getState().openModal();
  };

  const pendingPatch = useCherrypickStore((s) => s.pendingPatch);
  const targetedNodeUuid = useCherrypickStore((s) => s.targetedNodeUuid);
  const isTargetedAndHasPatch =
    selectedNode !== null &&
    targetedNodeUuid === selectedNode?.uuid &&
    pendingPatch !== null;

  // Phase 9 Plan 09-03 (NONC-01): Copy Mode + L4 atom → render SimplifiedInspector.
  // The onDelegate prop is intentionally undefined in Phase 9 — Phase 11 passes
  // a real handler here without modifying SimplifiedInspector.
  if (copyModeActive && selectedNode !== null && selectedNode.level === 'L4') {
    return (
      <div className="h-full w-full bg-background border-l border-border/50 flex flex-col">
        <SimplifiedInspector node={selectedNode} />
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-background border-l border-border/50 flex flex-col">
      {/* Header: node identity + drift status (INSP-04) */}
      {selectedNode ? (
        <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
          <span className="text-xs font-medium text-foreground truncate">
            {selectedNode.name}
          </span>
          <span className="text-[10px] rounded bg-muted px-1.5 py-0.5 text-muted-foreground shrink-0">
            {selectedNode.level}
          </span>
          <span className="text-[10px] rounded bg-muted/60 px-1.5 py-0.5 text-muted-foreground shrink-0">
            {selectedNode.kind}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {/* Phase 8 Plan 08-05: "Review changes" button when a patch is pending */}
            {isTargetedAndHasPatch && (
              <button
                type="button"
                onClick={() => useCherrypickStore.getState().openModal()}
                className="text-[10px] px-2 py-0.5 rounded-md bg-teal-100 text-teal-800 hover:bg-teal-200 transition-colors"
              >
                Review changes
              </button>
            )}
            {/* Phase 8 Plan 08-05 DEV-ONLY: synthetic demo affordance */}
            {selectedNode && (
              <button
                type="button"
                onClick={handleDemoCherrypick}
                className="text-[10px] px-2 py-0.5 rounded-md bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Dev: open demo cherrypick modal (TODO: remove in 08-06)"
              >
                Demo
              </button>
            )}
            <DriftBadge
              node={selectedNode}
              onReconcile={() => setReconcileOpen(true)}
            />
          </div>
        </div>
      ) : (
        <div className="border-b border-border/50 px-3 py-2 text-xs text-muted-foreground">
          Select a node
        </div>
      )}

      {/* Tab strip — button-based pattern (shadcn Tabs is NOT installed) */}
      <div className="flex items-center gap-1 border-b border-border/50 px-3 py-2">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={cn(
              'text-xs px-2.5 py-1 rounded-md transition-colors',
              activeTab === tab
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div className="flex-1 flex flex-col min-h-0">
        {activeTab === 'Contract' && <ContractTab node={selectedNode} />}
        {activeTab === 'Code' && (
          <CodeTab node={selectedNode} repoPath={repoPath} />
        )}
        {activeTab === 'Preview' && <PreviewTab node={selectedNode} />}
      </div>

      {/* Reconcile panel — Dialog overlay, outside tab body so it overlays the full inspector */}
      <ReconcilePanel
        node={selectedNode}
        open={reconcileOpen}
        onClose={() => setReconcileOpen(false)}
      />

      {/* Phase 8 Plan 08-05: Cherrypick modal — Dialog overlay */}
      <CherrypickModal />

      {/* Phase 11 Plan 04: Delegate button — ALWAYS-VISIBLE footer regardless of active tab.
          Lives in the Inspector container (not the tab body) so it survives tab switches.
          Contextual to the NODE not the tab per CONTEXT lock. */}
      {selectedNode && (
        <div className="shrink-0 border-t border-border bg-muted/20 p-3">
          <DelegateButton
            scopeUuid={selectedNode.uuid}
            level={selectedNode.level}
            atomUuid={selectedNode.uuid}
          />
        </div>
      )}
    </div>
  );
}
