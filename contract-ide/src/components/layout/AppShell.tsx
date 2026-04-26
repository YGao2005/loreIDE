import { useCallback, useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { usePanelRef } from 'react-resizable-panels';
import { listen } from '@tauri-apps/api/event';
import { getRepoPath, openRepo, readLastRepoPath } from '@/ipc/repo';
import { useGraphStore } from '@/store/graph';
import { subscribeDriftChanged } from '@/ipc/drift';
import { listRollupStates, subscribeRollupChanged } from '@/ipc/rollup';
import { useRollupStore } from '@/store/rollup';
import { getSubstrateStatesForCanvas } from '@/ipc/substrate';
import { useSubstrateStore, type SubstrateNodeState } from '@/store/substrate';
import { subscribeAgentStream, subscribeAgentComplete } from '@/ipc/agent';
import { subscribeReceiptCreated } from '@/ipc/receipts';
import { useAgentStore } from '@/store/agent';
import { useReceiptsStore } from '@/store/receipts';
import type { Receipt } from '@/store/receipts';
import { useDelegateStore } from '@/store/delegate';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { Sidebar } from './Sidebar';
import { GraphPlaceholder } from './GraphPlaceholder';
import { Inspector } from './Inspector';
import { RightPanel, type RightPanelTab } from './RightPanel';
import { McpStatusIndicator } from './McpStatusIndicator';
import { SessionStatusIndicator } from './SessionStatusIndicator';
import { SubstrateStatusIndicator } from './SubstrateStatusIndicator';
import { BackfillModal } from '@/components/session';
import { CommandPalette } from '@/components/command-palette/CommandPalette';
import { IntentPalette } from '@/components/command-palette/IntentPalette';
import { MassEditTrigger } from '@/components/mass-edit/MassEditTrigger';
import { PRReviewPanel } from '@/components/substrate/PRReviewPanel';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

/**
 * IDE shell layout.
 *
 *   horizontal: [ Sidebar | Center | RightPanel (Chat / Receipts) ]
 *   Center is vertical:     [ Graph ]
 *                           [ Inspector (Contract / Code / Preview, collapsible) ]
 *
 * Sidebar and RightPanel both run full window height. Inspector sits at the
 * bottom of the Center column only — it does not span under the Sidebar
 * (keeps the bottom strip visually balanced).
 *
 * Layout proportions tuned for 1400×900:
 *   Sidebar 18% · Center 54% · RightPanel 28%
 *   inside Center: Graph 70% · Inspector 30%
 *
 * Sidebar is intentionally background-less so whole-window vibrancy from
 * Plan 01-01's `apply_vibrancy` shows through. The graph, inspector, and
 * right panels use `bg-background` to opaquely override the vibrancy.
 *
 * `useKeyboardShortcuts()` installs the global Cmd+S / Cmd+Z handler for
 * the app's entire lifetime — children don't have to opt in.
 *
 * `ReactFlowProvider` is hoisted here (Plan 03-03 Task 1 Step 1) so that
 * BOTH the graph canvas (Breadcrumb + GraphCanvasInner) AND the global
 * Cmd+K CommandPalette can call `useReactFlow()` unconditionally. The
 * provider used to live inside GraphCanvas.tsx; moving it here is the
 * structural fix that replaces the broken try/catch-around-hook pattern
 * — React hook errors are not catchable, so the correct response is
 * "ensure provider is in scope", not "guard the hook call."
 *
 * `CommandPalette` is mounted as a sibling of <ResizablePanelGroup> so
 * it is always rendered (its `Dialog` gates visibility via the `open`
 * state driven by the Cmd+K listener) and it is inside the provider.
 */
export function AppShell() {
  useKeyboardShortcuts();

  // Phase 9 Plan 09-02: mass-edit trigger open state.
  // CommandPalette's "Mass edit by intent…" action flips this to true;
  // MassEditTrigger's onClose callback flips it back to false.
  const [massEditOpen, setMassEditOpen] = useState(false);
  const handleMassEdit = useCallback(() => setMassEditOpen(true), []);
  const handleMassEditClose = useCallback(() => setMassEditOpen(false), []);

  // Phase 13 Plan 08 (SUB-09): PR review intent-drift panel.
  // Cmd+Shift+P toggles open; defensive — distinct from Cmd+P (IntentPalette in 13-03).
  const [prReviewOpen, setPrReviewOpen] = useState(false);
  const handlePrReviewClose = useCallback(() => setPrReviewOpen(false), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() === 'p' &&
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey
      ) {
        e.preventDefault();
        setPrReviewOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Rehydrate `useGraphStore.repoPath` on cold start. Rust's `RepoState` is a
  // `Mutex<Option<PathBuf>>` with no disk backing — it resets to `None` on
  // every process restart, even though SQLite still serves the cached graph.
  // So we try the Rust side first (handles HMR reloads where Rust kept state)
  // and fall back to localStorage (handles cold starts where Rust is empty).
  // On localStorage hit we call `openRepo` so Rust state + the fs watcher
  // reinitialise — without this, save works (write_contract takes repoPath
  // directly) but file-change notifications stop flowing.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rustPath = await getRepoPath();
        if (cancelled) return;
        if (rustPath) {
          console.log('[AppShell] rehydrate repoPath (rust)', rustPath);
          useGraphStore.getState().setRepoPath(rustPath);
          return;
        }
        const stored = readLastRepoPath();
        if (!stored) {
          console.log('[AppShell] no persisted repo path — user must open one');
          return;
        }
        console.log('[AppShell] rehydrate repoPath (localStorage)', stored);
        await openRepo(stored);
      } catch (e) {
        console.error('[AppShell] rehydrate failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Phase 7 Plan 07-03: subscribe to Rust drift:changed events at app mount.
  // AppShell (not GraphCanvas) is the correct mount point — drift state is
  // app-wide (Inspector also reads it), and this subscription survives
  // graph unmount/remount cycles. Cleanup (unlisten) fires on AppShell unmount.
  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | undefined;
    subscribeDriftChanged().then((u) => {
      if (cancelled) {
        u();
      } else {
        unsub = u;
      }
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  // Phase 8 Plan 08-02: seed rollup store on mount + subscribe to rollup:changed.
  // BOTH paths are required — same race guard as subscribeDriftChanged above:
  // rollup:changed events may fire before the subscribe effect runs on first
  // render, so we pre-seed via listRollupStates first.
  useEffect(() => {
    // Seed from current rollup_derived state (handles HMR reloads and cold starts
    // where the DB already has rows from a previous startup recompute).
    listRollupStates()
      .then((rows) => {
        useRollupStore.getState().hydrate(rows);
      })
      .catch((e: unknown) => {
        console.warn('[AppShell] listRollupStates failed (non-fatal):', e);
      });

    // Subscribe to ongoing rollup:changed events from the Rust engine.
    let cancelled = false;
    let unsub: (() => void) | undefined;
    subscribeRollupChanged((payload) => {
      useRollupStore
        .getState()
        .set(payload.uuid, payload.state as 'fresh' | 'stale' | 'untracked');
    }).then((u) => {
      if (cancelled) {
        u();
      } else {
        unsub = u;
      }
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  // Phase 13 Plan 01: hydrate substrate state map for canvas coloring.
  // get_substrate_states_for_canvas reads substrate_nodes (Phase 11 / 12 schema)
  // and returns one SubstrateNodeSummary per row. We feed it into the new
  // useSubstrateStore.bulkSet slice (sibling to the existing footer-counter
  // slice). The IPC is defensive — if substrate_nodes is missing or empty, it
  // returns [] and we set an empty Map.
  //
  // Plan 13-09 will add a substrate:updated event subscription here. For now
  // we hydrate ONCE on mount; if Phase 11/12 distillers run during the session,
  // the canvas will need a manual re-hydration (or repo re-open) until 13-09.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const nodes = await getSubstrateStatesForCanvas();
        if (cancelled) return;
        const updates = nodes.map((n) => ({
          uuid: n.uuid,
          state: n.state as SubstrateNodeState,
        }));
        useSubstrateStore.getState().bulkSet(updates);
      } catch (err) {
        // Non-fatal: app boots without substrate overlays.
        console.warn('[AppShell] getSubstrateStatesForCanvas failed (non-fatal):', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Phase 8 Plan 08-04b: subscribe to agent + receipt events at app boot.
  // Mounted ONCE here (NOT per-tab) so the receipt-event subscription
  // survives tab unmount. Sibling to the existing drift + rollup subscription blocks.
  //
  // StrictMode cancellation pattern: useEffect runs mount → cleanup → mount
  // again in dev. Without a `cancelled` flag, the first effect's awaits resolve
  // AFTER cleanup runs and stash an unsubscribe ref that nothing calls — the
  // listener leaks and every event fires twice. Set `cancelled` in cleanup;
  // each await checks it before storing the unsub, and immediately unsubs if
  // the effect is already torn down.
  useEffect(() => {
    let cancelled = false;
    let unlistenStream: (() => void) | undefined;
    let unlistenComplete: (() => void) | undefined;
    let unlistenReceipt: (() => void) | undefined;
    void (async () => {
      const u1 = await subscribeAgentStream((p) => {
        useAgentStore.getState().appendStream(p.line);
      });
      if (cancelled) {
        u1();
      } else {
        unlistenStream = u1;
      }
      const u2 = await subscribeAgentComplete((p) => {
        useAgentStore.getState().complete(p.code);
      });
      if (cancelled) {
        u2();
      } else {
        unlistenComplete = u2;
      }
      const u3 = await subscribeReceiptCreated((r) => {
        // Convert ReceiptCreatedPayload to Receipt shape for the store.
        // nodes_touched arrives as string[] in event; store expects JSON string.
        const receipt: Receipt = {
          id: r.receipt_id,
          session_id: r.session_id,
          transcript_path: null,
          started_at: null,
          finished_at: null,
          input_tokens: r.input_tokens,
          output_tokens: r.output_tokens,
          cache_read_tokens: 0,
          tool_call_count: r.tool_call_count,
          nodes_touched: JSON.stringify(r.nodes_touched),
          estimated_cost_usd: r.estimated_cost_usd,
          raw_summary: null,
          raw_jsonl_path: null,
          parse_status: r.parse_status,
          wall_time_ms: r.wall_time_ms,
          created_at: new Date().toISOString(),
        };
        useReceiptsStore.getState().addReceipt(receipt);
      });
      if (cancelled) {
        u3();
      } else {
        unlistenReceipt = u3;
      }
    })();
    return () => {
      cancelled = true;
      unlistenStream?.();
      unlistenComplete?.();
      unlistenReceipt?.();
    };
  }, []);

  // Phase 11 Plan 04: wire agent:complete → useDelegateStore.onAgentTerminated.
  // This transitions the executing → idle state so the Inspector button resets
  // when the Phase 8 agent run finishes. Mounted at AppShell level (not Inspector)
  // so the listener survives Inspector panel collapse/resize.
  // Also wire source:click → inline toast (Phase 13 will upgrade to chat-archaeology jump).
  useEffect(() => {
    let cancelled = false;
    let unlistenAgentComplete: (() => void) | undefined;
    let unlistenSourceClick: (() => void) | undefined;

    void (async () => {
      const u1 = await listen<{ tracking_id: string }>('agent:complete', (e) => {
        useDelegateStore.getState().onAgentTerminated(e.payload.tracking_id);
      });
      if (cancelled) {
        u1();
      } else {
        unlistenAgentComplete = u1;
      }

      const u2 = await listen<{ session_id: string; turn_ref: number }>(
        'source:click',
        (e) => {
          // Phase 11 stub: show a console notification. Phase 13 wires the actual
          // chat-archaeology jump. We use a simple DOM toast to avoid adding a
          // toast library dependency.
          const msg = `source: ${e.payload.session_id} turn ${e.payload.turn_ref}`;
          console.info('[source:click]', msg);
          // Emit a brief visible notification using a custom DOM element.
          const el = document.createElement('div');
          el.textContent = msg;
          el.style.cssText = [
            'position:fixed',
            'bottom:2.5rem',
            'left:50%',
            'transform:translateX(-50%)',
            'background:var(--background,#1a1a1a)',
            'color:var(--foreground,#fff)',
            'border:1px solid var(--border,#444)',
            'border-radius:6px',
            'padding:6px 12px',
            'font-size:11px',
            'font-family:monospace',
            'z-index:9999',
            'pointer-events:none',
            'opacity:1',
            'transition:opacity 0.3s ease',
          ].join(';');
          document.body.appendChild(el);
          setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 350);
          }, 2500);
        },
      );
      if (cancelled) {
        u2();
      } else {
        unlistenSourceClick = u2;
      }
    })();

    return () => {
      cancelled = true;
      unlistenAgentComplete?.();
      unlistenSourceClick?.();
    };
  }, []);

  // Phase 11 Plan 05: first-time toast when the very first substrate node lands.
  // useSubstrateStore fires 'substrate:first-node-toast' CustomEvent on the first
  // 0→≥1 transition; AppShell catches it and shows a one-time inline DOM toast.
  // This is the same inline DOM toast pattern established in Plan 11-04 (no toast
  // library dependency). The toast never fires again — localStorage flag persists.
  useEffect(() => {
    const handler = () => {
      const el = document.createElement('div');
      el.innerHTML = [
        '<span style="font-weight:600">Your team\'s reasons started capturing.</span>',
        '<br>',
        '<span style="opacity:0.7;font-size:10px">We\'re distilling typed substrate from your Claude Code sessions.</span>',
      ].join('');
      el.style.cssText = [
        'position:fixed',
        'bottom:3rem',
        'left:50%',
        'transform:translateX(-50%)',
        'background:var(--background,#1a1a1a)',
        'color:var(--foreground,#fff)',
        'border:1px solid var(--border,#444)',
        'border-radius:8px',
        'padding:10px 16px',
        'font-size:11px',
        'font-family:var(--font-geist-sans,sans-serif)',
        'z-index:9999',
        'pointer-events:none',
        'opacity:1',
        'transition:opacity 0.4s ease',
        'max-width:320px',
        'text-align:center',
        'line-height:1.5',
      ].join(';');
      document.body.appendChild(el);
      setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 450);
      }, 6000);
    };

    window.addEventListener('substrate:first-node-toast', handler);
    return () => window.removeEventListener('substrate:first-node-toast', handler);
  }, []);

  const rightPanelRef = usePanelRef();
  const inspectorPanelRef = usePanelRef();
  const [rightTab, setRightTab] = useState<RightPanelTab>('Chat');

  // Auto-collapse the Inspector when no node is selected; auto-expand on
  // selection. Users can still drag the handle to override either state.
  const selectedNodeUuid = useGraphStore((s) => s.selectedNodeUuid);
  useEffect(() => {
    const panel = inspectorPanelRef.current;
    if (!panel) return;
    if (selectedNodeUuid) {
      panel.expand?.();
    } else {
      panel.collapse?.();
    }
  }, [selectedNodeUuid, inspectorPanelRef]);

  // Cmd+K → "Focus chat" — expand the right panel if collapsed AND switch to
  // the Chat tab. Optional chaining handles the case where expand() isn't
  // yet on the ref.
  const handleFocusChat = useCallback(() => {
    rightPanelRef.current?.expand?.();
    setRightTab('Chat');
  }, [rightPanelRef]);

  return (
    <ReactFlowProvider>
      <div className="h-screen w-screen overflow-hidden">
        {/* Drag-region spacer so the overlay titlebar's traffic lights have
            clear real estate above the sidebar — matches Plan 01-01's
            trafficLightPosition { x: 19, y: 24 }. */}
        <div
          data-tauri-drag-region
          className="h-7 w-full"
          aria-hidden="true"
        />

        <ResizablePanelGroup
          orientation="horizontal"
          className="!h-[calc(100vh-1.75rem)]"
        >
          {/* Left: Sidebar (full height). */}
          <ResizablePanel defaultSize="18%" minSize="15%" maxSize="30%">
            <Sidebar />
          </ResizablePanel>

          <ResizableHandle />

          {/* Center: Graph on top, Inspector on bottom (collapsible, center-only). */}
          <ResizablePanel defaultSize="54%" minSize="35%">
            <ResizablePanelGroup orientation="vertical">
              <ResizablePanel defaultSize="70%" minSize="30%">
                <GraphPlaceholder />
              </ResizablePanel>

              <ResizableHandle />

              <ResizablePanel
                panelRef={inspectorPanelRef}
                defaultSize="30%"
                minSize="12%"
                collapsible
                collapsedSize="4%"
              >
                <Inspector />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>

          <ResizableHandle />

          {/* Right: full-height Chat / Receipts surface. */}
          <ResizablePanel
            panelRef={rightPanelRef}
            defaultSize="28%"
            minSize="18%"
            maxSize="45%"
            collapsible
            collapsedSize="3%"
          >
            <RightPanel activeTab={rightTab} onTabChange={setRightTab} />
          </ResizablePanel>
        </ResizablePanelGroup>

        {/* Global Cmd+K command palette (SHELL-03). Mounted here — inside
            the promoted ReactFlowProvider — so (a) Cmd+K binds once at the
            document level and works from any focused pane, and (b) its
            useReactFlow() call for "jump to node" setCenter resolves. */}
        <CommandPalette onFocusChat={handleFocusChat} onMassEdit={handleMassEdit} />

        {/* Phase 13 Plan 03 (SUB-08): Cmd+P semantic intent palette. Sibling
            of CommandPalette — both dialogs render under the ReactFlowProvider
            scope and share commandPalette.css. Cmd+P runs an async FTS5+
            substrate retrieval; Cmd+K runs a static action registry. They
            never conflict because the keybindings differ and each dialog
            owns its own `open` state. The intent palette intentionally has
            no props — its navigation hooks (useGraphStore.pushParent +
            setFocusedAtomUuid + useSidebarStore.setSelectedFlow) are direct
            store imports, not callback props, because the right-panel/Inspector
            doesn't own any palette-triggered behaviour. */}
        <IntentPalette />

        {/* Phase 9 Plan 09-02: MassEditTrigger — opened by CommandPalette's
            "Mass edit by intent…" action. Mounted at AppShell root so the
            amber-pulse + modal flow renders above all panels. The trigger
            handles its own sub-states (query → pulse → modal) internally;
            AppShell only needs to know the open/close boolean. */}
        <MassEditTrigger open={massEditOpen} onClose={handleMassEditClose} />

        {/* Phase 13 Plan 08 (SUB-09): PR review intent-drift panel.
            Cmd+Shift+P toggles open. Distinct from Cmd+P which is the
            IntentPalette (plan 13-03). Slides in from the right edge,
            takes raw diff text, calls analyze_pr_diff IPC, and applies
            transient intent_drifted overlay via useSubstrateStore.bulkSet.
            Cancel restores per-uuid previous substrate state. */}
        <PRReviewPanel open={prReviewOpen} onClose={handlePrReviewClose} />

        {/* Backfill historical sessions (Plan 10-04). Top-level modal —
            opened by clicking the SessionStatusIndicator in the footer.
            Three-step flow (select → preview → confirm) enforces SC4
            opt-in: nothing ingests without explicit user confirmation. */}
        <BackfillModal />

        {/* Status bar footer — MCP health (Plan 05-01) + Session watcher (Plan 10-04)
            + Substrate counter (Plan 11-05). Sits outside the panel group so it is
            never resized away. */}
        <footer className="fixed bottom-0 right-0 z-10 flex items-center gap-2 border-l border-t border-border/40 bg-background/80 backdrop-blur-sm">
          <McpStatusIndicator />
          <span className="h-3 w-px bg-border/60" aria-hidden />
          <SessionStatusIndicator />
          <span className="h-3 w-px bg-border/60" aria-hidden />
          <SubstrateStatusIndicator />
        </footer>
      </div>
    </ReactFlowProvider>
  );
}
