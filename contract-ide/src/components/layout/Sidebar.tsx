import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/store/ui';
import { switchRepoFromUi } from '@/ipc/repo';
import { SidebarTree } from './SidebarTree';
import { McpStatusIndicator } from './McpStatusIndicator';
import { SessionStatusIndicator } from './SessionStatusIndicator';
import { SubstrateStatusIndicator } from './SubstrateStatusIndicator';

/**
 * Left sidebar (SHELL-01 + SIDEBAR-01).
 *
 * Phase 13 Plan 02: the Phase 3 lens switcher (Journey/System/Ownership) was
 * REMOVED here — lenses don't apply to vertical participant chains, and the
 * sidebar is now the canonical L0/L1 navigation surface (the canvas renders
 * only L2 vertical chains + L3 trigger cards). Per ROADMAP SC 5 + SIDEBAR-01,
 * the area tree carries the information density that L0/L1 abstract zoom used
 * to provide.
 *
 * Intentionally has NO background color — the whole-window NSVisualEffectView
 * vibrancy applied in Plan 01-01 bleeds through here because the center and
 * right panels have solid `bg-background` overrides (see index.css). Only the
 * sidebar region visually shows vibrancy.
 *
 * Two stub elements + the tree:
 *   1. Copy Mode pill — Phase 9 wires this to a real non-coder toggle; Phase 1
 *      renders it disabled with a Phase 9 tooltip, per SHELL-01's "pill
 *      placeholder visible on launch" must-have.
 *   2. SidebarTree — area-grouped repo navigation (Phase 13 Plan 02). Each
 *      area is expandable and shows per-area drift / rollup-stale /
 *      intent-drifted badge counts. Clicking a flow drives the canvas to
 *      that flow's L2 vertical chain (plan 13-06 builds the chain layout).
 *
 * The `currentLens` slice on `useGraphStore` is intentionally retained as
 * unused — removing it cascades into Phase 3 lens-aware code paths (Plan
 * 03-02 lens-aware fetch, Breadcrumb lens display). Cleanup deferred to
 * Phase 14 per Plan 13-02 frontmatter (DEPRECATED 2026-04-25).
 */
export function Sidebar() {
  const copyModeActive = useUiStore((s) => s.copyModeActive);
  const toggleCopyMode = useUiStore((s) => s.toggleCopyMode);
  const [switchingRepo, setSwitchingRepo] = useState(false);

  async function handleSwitchRepo() {
    if (switchingRepo) return;
    setSwitchingRepo(true);
    try {
      const result = await switchRepoFromUi();
      if (result.outcome === 'error') {
        console.warn('[sidebar] switch repo failed:', result.error);
      }
    } finally {
      setSwitchingRepo(false);
    }
  }

  return (
    <div className="h-full w-full flex flex-col bg-background border-r border-border/50 px-3 py-4 gap-3 text-foreground overflow-hidden">
      {/* Top action row — Copy Mode + Switch Repo live together so the canvas
          top bar stays free for the breadcrumb. */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Copy Mode pill — NONC-01: non-coder mode toggle. Enabled in Phase 9.
            data-copy-mode-pill attribute preserved for test/selection targeting. */}
        <button
          type="button"
          data-copy-mode-pill
          aria-pressed={copyModeActive}
          onClick={toggleCopyMode}
          className={cn(
            'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
            copyModeActive
              ? 'border-primary/60 bg-primary/15 text-primary-foreground/90'
              : 'border-border/60 bg-background/40 text-muted-foreground hover:bg-background/60'
          )}
        >
          Copy Mode
        </button>
        <button
          type="button"
          onClick={handleSwitchRepo}
          disabled={switchingRepo}
          className={cn(
            'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
            'border-border/60 bg-background/40 text-muted-foreground hover:bg-background/60',
            switchingRepo && 'opacity-60 cursor-wait'
          )}
          title="Open a different repository"
        >
          {switchingRepo ? 'Switching…' : 'Switch Repo'}
        </button>
      </div>

      {/* Phase 13 Plan 02: area tree. Replaces the Phase 3 lens switcher +
          L0/L1 placeholder block. Live-updates per-area badge counts via
          Zustand subscriptions to drift / rollup / substrate stores. */}
      <div className="flex-1 overflow-y-auto -mx-1 px-1">
        <SidebarTree />
      </div>

      {/* Status row — MCP / Session / Substrate. Lives in the sidebar so it
          doesn't overlay the right-panel chat (previously a fixed footer). */}
      <div className="flex flex-col gap-1.5 border-t border-border/40 pt-2 -mx-1 px-1">
        <McpStatusIndicator />
        <SessionStatusIndicator />
        <SubstrateStatusIndicator />
      </div>
    </div>
  );
}
