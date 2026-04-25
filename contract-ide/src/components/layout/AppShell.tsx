import { useCallback, useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { usePanelRef } from 'react-resizable-panels';
import { listen } from '@tauri-apps/api/event';
import { getRepoPath, openRepo, readLastRepoPath } from '@/ipc/repo';
import { useGraphStore } from '@/store/graph';
import { subscribeDriftChanged } from '@/ipc/drift';
import { listRollupStates, subscribeRollupChanged } from '@/ipc/rollup';
import { useRollupStore } from '@/store/rollup';
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
import { BackfillModal } from '@/components/session';
import { CommandPalette } from '@/components/command-palette/CommandPalette';
import { MassEditTrigger } from '@/components/mass-edit/MassEditTrigger';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

/**
 * IDE shell layout.
 *
 *   horizontal: [ LeftCol | RightPanel (Chat / Receipts) ]
 *   LeftCol is vertical:    [ TopRow ]
 *                           [ Inspector (Contract / Code / Preview, collapsible) ]
 *   TopRow is horizontal:   [ Sidebar | Graph ]
 *
 * RightPanel runs full window height (intuitive AI surface, mirrors VS Code /
 * Cursor). Inspector lives at the bottom and spans Sidebar + Graph width so
 * Code/Contract editors get max horizontal real-estate.
 *
 * Layout proportions tuned for 1400×900:
 *   LeftCol 72% · RightPanel 28%
 *   inside LeftCol: TopRow 70% · Inspector 30%
 *   inside TopRow:  Sidebar 25% · Graph 75% (≈ 18% / 54% of full width)
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

  const rightPanelRef = usePanelRef();
  const [rightTab, setRightTab] = useState<RightPanelTab>('Chat');

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
          {/* Left column: Sidebar+Graph on top, Inspector on bottom (spanning both). */}
          <ResizablePanel defaultSize="72%" minSize="50%">
            <ResizablePanelGroup orientation="vertical">
              <ResizablePanel defaultSize="70%" minSize="30%">
                <ResizablePanelGroup orientation="horizontal">
                  <ResizablePanel defaultSize="25%" minSize="18%" maxSize="40%">
                    <Sidebar />
                  </ResizablePanel>

                  <ResizableHandle />

                  <ResizablePanel defaultSize="75%" minSize="40%">
                    <GraphPlaceholder />
                  </ResizablePanel>
                </ResizablePanelGroup>
              </ResizablePanel>

              <ResizableHandle />

              <ResizablePanel
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

          {/* Right column: full-height Chat / Receipts surface. */}
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

        {/* Phase 9 Plan 09-02: MassEditTrigger — opened by CommandPalette's
            "Mass edit by intent…" action. Mounted at AppShell root so the
            amber-pulse + modal flow renders above all panels. The trigger
            handles its own sub-states (query → pulse → modal) internally;
            AppShell only needs to know the open/close boolean. */}
        <MassEditTrigger open={massEditOpen} onClose={handleMassEditClose} />

        {/* Backfill historical sessions (Plan 10-04). Top-level modal —
            opened by clicking the SessionStatusIndicator in the footer.
            Three-step flow (select → preview → confirm) enforces SC4
            opt-in: nothing ingests without explicit user confirmation. */}
        <BackfillModal />

        {/* Status bar footer — MCP health (Plan 05-01) + Session watcher (Plan 10-04).
            Sits outside the panel group so it is never resized away. */}
        <footer className="fixed bottom-0 right-0 z-10 flex items-center gap-2 border-l border-t border-border/40 bg-background/80 backdrop-blur-sm">
          <McpStatusIndicator />
          <span className="h-3 w-px bg-border/60" aria-hidden />
          <SessionStatusIndicator />
        </footer>
      </div>
    </ReactFlowProvider>
  );
}
