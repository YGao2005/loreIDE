import { cn } from '@/lib/utils';
import { useUiStore } from '@/store/ui';
import { SidebarTree } from './SidebarTree';

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

  return (
    <div className="h-full w-full flex flex-col border-r border-border/50 px-3 py-4 gap-3 text-foreground overflow-hidden">
      {/* Copy Mode pill — NONC-01: non-coder mode toggle. Enabled in Phase 9.
          data-copy-mode-pill attribute preserved for test/selection targeting. */}
      <button
        type="button"
        data-copy-mode-pill
        aria-pressed={copyModeActive}
        onClick={toggleCopyMode}
        className={cn(
          'self-start rounded-full border px-3 py-1 text-xs font-medium transition-colors',
          copyModeActive
            ? 'border-primary/60 bg-primary/15 text-primary-foreground/90'
            : 'border-border/60 bg-background/40 text-muted-foreground hover:bg-background/60'
        )}
      >
        Copy Mode
      </button>

      {/* Phase 13 Plan 02: area tree. Replaces the Phase 3 lens switcher +
          L0/L1 placeholder block. Live-updates per-area badge counts via
          Zustand subscriptions to drift / rollup / substrate stores. */}
      <div className="flex-1 overflow-y-auto -mx-1 px-1">
        <SidebarTree />
      </div>
    </div>
  );
}
