// Phase 13 Plan 08 — Affected nodes grouped by participant surface.
//
// Renders the analyze_pr_diff result as a list of affected nodes grouped
// by their parent_uuid (participant). Click a node to focus it in the
// Inspector via useGraphStore.selectNode (canonical setter per checker N7
// in plan 13-01 SUMMARY).
//
// Intent-drifted subset gets an orange ⚠ marker so reviewers can see at a
// glance which file-affected atoms ALSO carry a Phase 12 substrate cascade
// signal. The 30-second-readable target is the design constraint here —
// keep copy compact, no nested explanations, click-through for detail.

import { useMemo } from 'react';
import { useGraphStore } from '@/store/graph';

interface Props {
  result: {
    affected_uuids: string[];
    intent_drifted_uuids: string[];
  };
}

export function PRReviewExplanation({ result }: Props) {
  // Subscribe to the stable nodes array; derive filtered/grouped view via
  // useMemo (Phase 13-06 lesson: NEVER inline .filter() in the selector —
  // returns a fresh reference every render and triggers useSyncExternalStore
  // infinite retry).
  const allNodes = useGraphStore((s) => s.nodes);

  const affectedSet = useMemo(
    () => new Set(result.affected_uuids),
    [result.affected_uuids],
  );
  const driftedSet = useMemo(
    () => new Set(result.intent_drifted_uuids),
    [result.intent_drifted_uuids],
  );

  const grouped = useMemo(() => {
    const affectedNodes = allNodes.filter((n) => affectedSet.has(n.uuid));
    const byParent = new Map<string, typeof allNodes>();
    for (const n of affectedNodes) {
      const key = n.parent_uuid ?? '_root';
      const list = byParent.get(key) ?? [];
      list.push(n);
      byParent.set(key, list);
    }
    return Array.from(byParent.entries());
  }, [allNodes, affectedSet]);

  if (grouped.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic">
        No matching contract atoms — diff hits files outside the contract graph.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Affected by intent
      </h4>
      {grouped.map(([parentUuid, nodes]) => {
        const parent = allNodes.find((n) => n.uuid === parentUuid);
        const parentLabel =
          parent?.name ??
          (parentUuid === '_root' ? 'Root' : parentUuid.slice(0, 8));
        return (
          <div key={parentUuid} className="space-y-1">
            <div className="text-xs font-medium text-foreground/90">
              {parentLabel}
            </div>
            <ul className="space-y-0.5 ml-2 border-l border-border/40 pl-2">
              {nodes.map((n) => {
                const isDrifted = driftedSet.has(n.uuid);
                return (
                  <li
                    key={n.uuid}
                    className="text-[11px] text-muted-foreground flex items-center gap-1.5"
                  >
                    {isDrifted ? (
                      <span
                        className="text-orange-400"
                        title="Intent-drifted (Phase 12 cascade)"
                        aria-label="intent-drifted"
                      >
                        ⚠
                      </span>
                    ) : (
                      <span
                        className="text-muted-foreground/40"
                        aria-hidden
                      >
                        ·
                      </span>
                    )}
                    <button
                      onClick={() =>
                        useGraphStore.getState().selectNode(n.uuid)
                      }
                      className="hover:text-foreground text-left truncate"
                    >
                      {n.name ?? n.uuid.slice(0, 8)}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
