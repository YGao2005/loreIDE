import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useGraphStore, type LensId } from '@/store/graph';
import { useUiStore } from '@/store/ui';

/**
 * Left sidebar (SHELL-01).
 *
 * Intentionally has NO background color — the whole-window NSVisualEffectView
 * vibrancy applied in Plan 01-01 bleeds through here because the center and
 * right panels have solid `bg-background` overrides (see index.css). Only the
 * sidebar region visually shows vibrancy.
 *
 * Three stub elements:
 *   1. Copy Mode pill — Phase 9 wires this to a real non-coder toggle; Phase 1
 *      renders it disabled with a Phase 9 tooltip, per SHELL-01's "pill
 *      placeholder visible on launch" must-have.
 *   2. Lens switcher — Journey (default) / System / Ownership. Phase 3 Plan 1:
 *      active lens is now sourced from useGraphStore.currentLens (was local
 *      useState). Plan 03-02 uses currentLens to drive lens-aware node fetch.
 *   3. L0/L1 placeholder tree — visual confirmation the sidebar has content.
 */
const LENSES: { id: LensId; label: string }[] = [
  { id: 'journey', label: 'Journey' },
  { id: 'system', label: 'System' },
  { id: 'ownership', label: 'Ownership' },
];

export function Sidebar() {
  const activeLens = useGraphStore((s) => s.currentLens);
  const setLens = useGraphStore((s) => s.setLens);
  const copyModeActive = useUiStore((s) => s.copyModeActive);
  const toggleCopyMode = useUiStore((s) => s.toggleCopyMode);

  return (
    <div className="h-full w-full flex flex-col border-r border-border/50 px-3 py-4 gap-4 text-foreground">
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

      {/* Lens switcher — segmented control (Journey default) */}
      <div
        role="tablist"
        aria-label="Graph lens"
        className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-background/30 p-0.5"
      >
        {LENSES.map((lens) => (
          <Button
            key={lens.id}
            variant="ghost"
            size="xs"
            role="tab"
            aria-selected={activeLens === lens.id}
            onClick={() => setLens(lens.id)}
            className={cn(
              'text-xs',
              activeLens === lens.id &&
                'bg-muted text-foreground shadow-xs'
            )}
          >
            {lens.label}
          </Button>
        ))}
      </div>

      {/* Placeholder tree — confirms the sidebar has content. */}
      <div className="flex flex-col gap-1 text-xs">
        <div className="font-medium text-foreground/90 px-1 py-1">
          L0 · Product
        </div>
        <div className="pl-4 text-muted-foreground py-0.5">L1 · Checkout</div>
        <div className="pl-4 text-muted-foreground py-0.5">L1 · Browse</div>
      </div>

      <div className="mt-auto pt-2 text-[10px] uppercase tracking-wider text-muted-foreground/70">
        {LENSES.find((l) => l.id === activeLens)?.label} lens
      </div>
    </div>
  );
}
