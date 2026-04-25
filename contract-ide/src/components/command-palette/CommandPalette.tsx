import { useCallback, useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { useReactFlow } from '@xyflow/react';
import { useGraphStore } from '@/store/graph';
import { useCherrypickStore } from '@/store/cherrypick';
import { pickAndOpenRepo } from '@/ipc/repo';
import {
  repositoryActions,
  lensActions,
  navigationActions,
} from './actions';
import './commandPalette.css';

/**
 * Cmd+K command palette (SHELL-03).
 *
 * Mounted at the AppShell root inside the promoted <ReactFlowProvider> (Plan
 * 03-03 Task 1 Step 1) so the Cmd+K keydown listener binds once at the
 * document level and `useReactFlow()` resolves unconditionally.
 *
 * Action groups (future plans extend the arrays in ./actions.ts without
 * touching this JSX): Repository / Lens / Navigation / Jump to node (live
 * from useGraphStore.nodes).
 *
 * Keydown handler preventDefaults BEFORE setOpen so WebKit's default
 * search-in-page behavior does NOT fire (RESEARCH §Pitfall 7).
 *
 * Phase 9 Plan 09-02: "Mass edit by intent…" added to the Repository group.
 * Fires onMassEdit() passed in from AppShell which owns the massEditOpen state.
 */
export interface CommandPaletteProps {
  /**
   * Callback the palette invokes for "Focus chat panel" — passed in by
   * AppShell because chat focus is owned at the layout level (panelRef on
   * the resizable panel). If the chat panel exposes no focus method yet,
   * AppShell can implement this as `chatPanelRef.current?.expand?.()` and
   * Plan 04 tightens when the Monaco chat input lands.
   */
  onFocusChat: () => void;
  /**
   * Phase 9 Plan 09-02: Callback to open the MassEditTrigger flow.
   * Provided by AppShell; closes the palette and flips massEditOpen to true.
   */
  onMassEdit: () => void;
}

export function CommandPalette({ onFocusChat, onMassEdit }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const nodes = useGraphStore((s) => s.nodes);
  const setLens = useGraphStore((s) => s.setLens);
  const selectNode = useGraphStore((s) => s.selectNode);

  // Unconditional hook call — provider lives in AppShell (Plan 03-03 Task 1
  // Step 1). Do NOT wrap in try/catch: React hook errors are not catchable
  // that way and the attempt produces undefined behavior. If this throws
  // "ReactFlowProvider missing", the provider was removed from AppShell —
  // fix the provider scope, not this call site.
  const { getNode, setCenter } = useReactFlow();

  // Cmd+K (or Ctrl+K) toggles the palette. preventDefault BEFORE setOpen so
  // WebKit's "Find in page" cannot fire (RESEARCH §Pitfall 7).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  const handleOpenRepo = useCallback(async () => {
    close();
    try {
      await pickAndOpenRepo();
    } catch (e) {
      console.warn('[CommandPalette] open repo failed:', e);
    }
  }, [close]);

  const handleLens = useCallback(
    async (lens: 'journey' | 'system' | 'ownership') => {
      close();
      await setLens(lens);
    },
    [close, setLens]
  );

  const handleFocusChat = useCallback(() => {
    close();
    onFocusChat();
  }, [close, onFocusChat]);

  // Phase 9 Plan 09-02: open the MassEditTrigger flow (query → pulse → modal).
  const handleMassEdit = useCallback(() => {
    close();
    onMassEdit();
  }, [close, onMassEdit]);

  const handleJumpToNode = useCallback(
    (uuid: string) => {
      close();
      selectNode(uuid);
      // Phase 8 Plan 08-05 (CHRY-01): set targeted UUID so the ring glow
      // appears immediately when a node is selected via Cmd+K palette,
      // matching the behaviour of direct graph-node clicks.
      useCherrypickStore.getState().setTarget(uuid);
      const node = getNode(uuid);
      if (!node) return;
      const cx = node.position.x + (node.measured?.width ?? 160) / 2;
      const cy = node.position.y + (node.measured?.height ?? 60) / 2;
      setCenter(cx, cy, { zoom: 1.5, duration: 600 });
    },
    [close, getNode, setCenter, selectNode]
  );

  return (
    <Command.Dialog open={open} onOpenChange={setOpen} label="Command palette">
      <Command.Input placeholder="Type a command or search nodes…" autoFocus />
      <Command.List>
        <Command.Empty>No results found.</Command.Empty>

        <Command.Group heading="Repository">
          {repositoryActions.map((a) => (
            <Command.Item key={a.id} onSelect={handleOpenRepo}>
              {a.label}
            </Command.Item>
          ))}
          {/* Phase 9 Plan 09-02 — MASS-02: mass edit by intent entry point.
              Selecting this item closes the palette and opens the
              MassEditTrigger query → pulse → modal flow. */}
          <Command.Item value="mass edit by intent" onSelect={handleMassEdit}>
            Mass edit by intent…
          </Command.Item>
        </Command.Group>

        <Command.Group heading="Lens">
          {lensActions.map((a) => (
            <Command.Item key={a.id} onSelect={() => handleLens(a.lens)}>
              {a.label}
            </Command.Item>
          ))}
        </Command.Group>

        <Command.Group heading="Navigation">
          {navigationActions.map((a) => (
            <Command.Item key={a.id} onSelect={handleFocusChat}>
              {a.label}
            </Command.Item>
          ))}
        </Command.Group>

        {nodes.length > 0 && (
          <Command.Group heading="Jump to node">
            {nodes.slice(0, 50).map((n) => (
              <Command.Item
                key={n.uuid}
                value={`${n.name} ${n.level} ${n.kind}`}
                onSelect={() => handleJumpToNode(n.uuid)}
              >
                <span className="text-[10px] uppercase opacity-70 mr-2">
                  {n.level}
                </span>
                {n.name}
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}
