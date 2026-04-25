import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useGraphStore } from '@/store/graph';
import { cn } from '@/lib/utils';

/**
 * Drill-in breadcrumb for the contract graph (GRAPH-02).
 *
 * Reads `parentUuidStack` from the graph store and maps each entry to the
 * corresponding node's display name. Clicking "Root" resets the stack and
 * fits the viewport; clicking a segment pops until that depth is the head
 * and animates the viewport to the segment's node.
 *
 * MUST be mounted INSIDE the <ReactFlowProvider> tree — `useReactFlow()`
 * throws without a provider. Plan 03-02 mounts Breadcrumb inside
 * GraphCanvas; Plan 03-03 will promote the provider to AppShell so the
 * global Cmd+K palette can share it.
 */
export function Breadcrumb() {
  const stack = useGraphStore((s) => s.parentUuidStack);
  const nodes = useGraphStore((s) => s.nodes);
  const popParent = useGraphStore((s) => s.popParent);
  const resetParents = useGraphStore((s) => s.resetParents);
  const { fitView, setCenter, getNode } = useReactFlow();

  const nameFor = useCallback(
    (uuid: string) =>
      nodes.find((n) => n.uuid === uuid)?.name ?? uuid.slice(0, 8),
    [nodes]
  );

  const goRoot = useCallback(() => {
    resetParents();
    fitView({ duration: 500 });
  }, [fitView, resetParents]);

  const popTo = useCallback(
    (depth: number) => {
      // Pop until stack length == depth+1 (the clicked segment is the new head).
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

  return (
    <nav
      aria-label="Graph breadcrumb"
      className="flex items-center gap-1 text-xs text-muted-foreground px-3 py-1.5 border-b border-border/40"
    >
      <button
        onClick={goRoot}
        className={cn(
          'hover:text-foreground transition-colors',
          stack.length === 0 && 'text-foreground font-medium'
        )}
      >
        Root
      </button>
      {stack.map((uuid, i) => (
        <span key={uuid} className="flex items-center gap-1">
          <span aria-hidden>/</span>
          <button
            onClick={() => popTo(i)}
            className={cn(
              'hover:text-foreground transition-colors',
              i === stack.length - 1 && 'text-foreground font-medium'
            )}
          >
            {nameFor(uuid)}
          </button>
        </span>
      ))}
    </nav>
  );
}
