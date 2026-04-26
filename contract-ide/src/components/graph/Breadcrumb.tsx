import { useCallback, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { useGraphStore } from '@/store/graph';
import { cn } from '@/lib/utils';

/**
 * Drill-in breadcrumb for the contract graph (GRAPH-02).
 *
 * Reads `parentUuidStack` from the graph store and renders a single-line
 * trail. When the stack is deep (≥3 segments) the middle entries collapse
 * behind a `…` popover so the bar never wraps and never fills the canvas
 * top with five lines of intent text.
 *
 * Visible-shape contract:
 *   0 entries  → `Root`
 *   1 entry    → `Root / Current`
 *   2 entries  → `Root / Parent / Current`
 *   3+ entries → `Root / … / Parent / Current` (popover lists hidden depths)
 *
 * Clicking any segment pops the stack until that depth is the head and
 * animates the viewport to the corresponding node.
 *
 * MUST be mounted INSIDE the <ReactFlowProvider> tree — `useReactFlow()`
 * throws without a provider. Mounted by GraphCanvas; the provider lives at
 * AppShell level so the global ⌘P palette can share viewport state.
 */
export function Breadcrumb() {
  const stack = useGraphStore((s) => s.parentUuidStack);
  const nodes = useGraphStore((s) => s.nodes);
  const popParent = useGraphStore((s) => s.popParent);
  const resetParents = useGraphStore((s) => s.resetParents);
  const { fitView, setCenter, getNode } = useReactFlow();

  const nameFor = useCallback(
    (uuid: string) => nodes.find((n) => n.uuid === uuid)?.name ?? 'Untitled',
    [nodes]
  );

  const goRoot = useCallback(() => {
    resetParents();
    fitView({ duration: 500 });
  }, [fitView, resetParents]);

  const popTo = useCallback(
    (depth: number) => {
      const popsNeeded = stack.length - (depth + 1);
      for (let i = 0; i < popsNeeded; i++) popParent();
      const targetUuid = stack[depth];
      const target = getNode(targetUuid);
      if (target) {
        const cx = target.position.x + (target.measured?.width ?? 160) / 2;
        const cy = target.position.y + (target.measured?.height ?? 60) / 2;
        setCenter(cx, cy, { zoom: 1.2, duration: 500 });
      }
    },
    [getNode, popParent, setCenter, stack]
  );

  // Decide which segments are visible inline vs hidden behind the …
  // popover. We always keep the last two (parent + current) visible so the
  // user can see "where am I" and "where did I come from" at a glance.
  const COLLAPSE_THRESHOLD = 3;
  const collapsed = stack.length >= COLLAPSE_THRESHOLD;
  const hidden = collapsed ? stack.slice(0, stack.length - 2) : [];
  const tailStart = collapsed ? stack.length - 2 : 0;
  const tail = stack.slice(tailStart);

  return (
    <nav
      aria-label="Graph breadcrumb"
      className="flex items-center gap-1 text-xs text-muted-foreground px-3 py-1.5 border-b border-border/40 min-w-0 whitespace-nowrap"
    >
      <button
        onClick={goRoot}
        className={cn(
          'shrink-0 hover:text-foreground transition-colors',
          stack.length === 0 && 'text-foreground font-medium'
        )}
      >
        Root
      </button>

      {collapsed && (
        <>
          <span aria-hidden className="shrink-0 text-muted-foreground/50">/</span>
          <CollapsedSegmentsPopover
            hidden={hidden}
            nameFor={nameFor}
            onPick={popTo}
          />
        </>
      )}

      {tail.map((uuid, i) => {
        const depth = tailStart + i;
        const isCurrent = depth === stack.length - 1;
        return (
          <span key={uuid} className="flex items-center gap-1 min-w-0">
            <span aria-hidden className="shrink-0 text-muted-foreground/50">/</span>
            <button
              onClick={() => popTo(depth)}
              title={nameFor(uuid)}
              className={cn(
                'truncate max-w-[180px] hover:text-foreground transition-colors',
                isCurrent && 'text-foreground font-medium'
              )}
            >
              {nameFor(uuid)}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

interface CollapsedSegmentsPopoverProps {
  hidden: string[];
  nameFor: (uuid: string) => string;
  onPick: (depth: number) => void;
}

function CollapsedSegmentsPopover({
  hidden,
  nameFor,
  onPick,
}: CollapsedSegmentsPopoverProps) {
  const [open, setOpen] = useState(false);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={`Show ${hidden.length} hidden breadcrumb levels`}
          className="shrink-0 px-1.5 rounded hover:bg-muted/60 hover:text-foreground transition-colors"
        >
          …
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          className="z-50 min-w-[180px] max-w-[320px] rounded-md border border-border bg-popover p-1 text-xs shadow-md outline-none"
        >
          <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
            Hidden levels
          </div>
          {hidden.map((uuid, depth) => (
            <button
              key={uuid}
              onClick={() => {
                onPick(depth);
                setOpen(false);
              }}
              className="block w-full truncate rounded px-2 py-1.5 text-left text-muted-foreground hover:bg-muted hover:text-foreground"
              title={nameFor(uuid)}
            >
              {nameFor(uuid)}
            </button>
          ))}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
