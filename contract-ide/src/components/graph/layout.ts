import * as dagre from '@dagrejs/dagre';
import type { ContractNode as RowContractNode } from '@/ipc/types';

// Hierarchical dagre layout for the contract graph.
//
// The prior hand-rolled 4-column grid layout (buildHierarchicalNodes in
// GraphCanvasInner.tsx) stacked all children at the same screen position when
// combined with `extent: 'parent'` — clamp to ~180×40px parent footprint with
// 100 children = visual overdraw + fps collapse. This module replaces it with
// a two-pass dagre layout:
//
//   PASS 1 (bottom-up): for each node with children, run dagre on its direct
//   children. Record child positions (relative to parent origin) and compute
//   the subtree bbox → set parent's width/height from that bbox + padding.
//
//   PASS 2 (top-down): run dagre on the roots (L0 nodes, or L1s in the perf
//   repo which has no L0). Record root absolute positions.
//
// Return a flat list of `{ id, position, width, height, parentId? }`. Callers
// feed this into React Flow's node array — children carry `parentId` (so React
// Flow positions them relative to their parent) and `extent: 'parent'` is
// NEVER set (the clamping was the original bug; dagre's bottom-up sizing
// guarantees the parent is large enough for its children without needing
// extent clamping).
//
// Edges are intentionally NOT passed to dagre at any level. Dagre still
// produces clean grid-ish distributions without edge constraints, and graph
// edges cross level boundaries in our model (L2→L2 siblings, but also
// cross-parent neighbors), which would confuse a per-level layout. This is an
// acceptable simplification at demo scale — revisit if edge-aware layout
// becomes necessary.

export const LEAF_WIDTH = 180;
export const LEAF_HEIGHT = 56;
// Padding INSIDE a group: space between the group's border and its children's
// laid-out bbox. Top value is larger to make room for the group header label.
export const GROUP_PADDING_X = 24;
export const GROUP_PADDING_TOP = 36;
export const GROUP_PADDING_BOTTOM = 24;
// Dagre layout knobs per level.
const NODESEP = 40;
const RANKSEP = 60;

export interface LayoutNode {
  id: string;
  /**
   * Position. For top-level (no parent) nodes this is absolute canvas space.
   * For children with parentId set, this is relative to the parent node's
   * origin (React Flow's sub-flow convention).
   */
  position: { x: number; y: number };
  width: number;
  height: number;
  parentId?: string;
  /** True when this node has at least one child — render as group container. */
  isGroup: boolean;
}

/**
 * Bottom-up + top-down dagre layout for a hierarchical row set.
 *
 * Safe to call on any row set: single-level, multi-level, or mixed. If a row
 * references a parent_uuid that isn't in the passed rows, the row is treated
 * as a root (so partial views don't crash).
 */
export function layoutNodes(rows: RowContractNode[]): LayoutNode[] {
  if (rows.length === 0) return [];

  // Index rows + build children adjacency (only counting in-set parents so
  // orphan references fall back to root).
  const byId = new Map<string, RowContractNode>();
  for (const row of rows) byId.set(row.uuid, row);

  const childrenOf = new Map<string | null, string[]>();
  for (const row of rows) {
    const parent =
      row.parent_uuid && byId.has(row.parent_uuid) ? row.parent_uuid : null;
    const bucket = childrenOf.get(parent);
    if (bucket) bucket.push(row.uuid);
    else childrenOf.set(parent, [row.uuid]);
  }

  // Accumulator: id → partial LayoutNode. Fill width/height + position bottom-up.
  const layoutById = new Map<string, LayoutNode>();

  // Topological-ish order: visit deepest nodes first. We approximate this by
  // sorting by depth computed from a walk down from roots.
  const depthOf = new Map<string, number>();
  function computeDepth(id: string, d: number) {
    depthOf.set(id, d);
    const kids = childrenOf.get(id) ?? [];
    for (const k of kids) computeDepth(k, d + 1);
  }
  for (const rootId of childrenOf.get(null) ?? []) computeDepth(rootId, 0);

  // Process IDs deepest → shallowest so parents see their children's sizes.
  const ids = rows.map((r) => r.uuid).sort((a, b) => {
    return (depthOf.get(b) ?? 0) - (depthOf.get(a) ?? 0);
  });

  for (const id of ids) {
    const kids = childrenOf.get(id) ?? [];
    if (kids.length === 0) {
      // Leaf — fixed size, position filled in by the parent's dagre pass or
      // (for top-level leaves) by the roots pass below.
      layoutById.set(id, {
        id,
        position: { x: 0, y: 0 },
        width: LEAF_WIDTH,
        height: LEAF_HEIGHT,
        isGroup: false,
      });
      continue;
    }

    // Decide: dagre (few children) vs grid (many children without edges).
    //
    // Dagre without edge inputs has no ranking information, so every child
    // lands at rank 0 — a single horizontal row. For the 500-node perf repo
    // (100 L2 children per L1) that's a 22,000px-wide group. Use dagre only
    // for small child counts (where a single row reads fine); fall back to a
    // square-ish grid above the threshold.
    const DAGRE_THRESHOLD = 12;
    const positions = new Map<string, { left: number; top: number }>();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    if (kids.length <= DAGRE_THRESHOLD) {
      const g = new dagre.graphlib.Graph({ multigraph: false, compound: false });
      g.setGraph({ rankdir: 'TB', nodesep: NODESEP, ranksep: RANKSEP });
      g.setDefaultEdgeLabel(() => ({}));
      for (const kidId of kids) {
        const k = layoutById.get(kidId)!;
        g.setNode(kidId, { width: k.width, height: k.height });
      }
      dagre.layout(g);
      for (const kidId of kids) {
        const n = g.node(kidId) as { x: number; y: number };
        const k = layoutById.get(kidId)!;
        const left = n.x - k.width / 2;
        const top = n.y - k.height / 2;
        positions.set(kidId, { left, top });
        if (left < minX) minX = left;
        if (top < minY) minY = top;
        if (left + k.width > maxX) maxX = left + k.width;
        if (top + k.height > maxY) maxY = top + k.height;
      }
    } else {
      // Square-ish grid. Compute cols = ceil(sqrt(n)) so a 100-child group
      // becomes a 10×10 grid, a 25-child group becomes 5×5, etc. Use the
      // max child width/height to keep rows aligned even if mixed sizes.
      const cols = Math.ceil(Math.sqrt(kids.length));
      let maxW = 0;
      let maxH = 0;
      for (const kidId of kids) {
        const k = layoutById.get(kidId)!;
        if (k.width > maxW) maxW = k.width;
        if (k.height > maxH) maxH = k.height;
      }
      const stepX = maxW + NODESEP;
      const stepY = maxH + NODESEP;
      kids.forEach((kidId, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const left = col * stepX;
        const top = row * stepY;
        const k = layoutById.get(kidId)!;
        positions.set(kidId, { left, top });
        if (left < minX) minX = left;
        if (top < minY) minY = top;
        if (left + k.width > maxX) maxX = left + k.width;
        if (top + k.height > maxY) maxY = top + k.height;
      });
    }

    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const groupW = contentW + GROUP_PADDING_X * 2;
    const groupH = contentH + GROUP_PADDING_TOP + GROUP_PADDING_BOTTOM;

    // Record the group's size; position is filled in by its own parent (or
    // the roots pass).
    layoutById.set(id, {
      id,
      position: { x: 0, y: 0 },
      width: groupW,
      height: groupH,
      isGroup: true,
    });

    // Assign children RELATIVE-to-parent positions. Re-anchor by subtracting
    // (minX, minY) so the leftmost/topmost child sits at (GROUP_PADDING_X,
    // GROUP_PADDING_TOP) inside the group.
    for (const kidId of kids) {
      const pos = positions.get(kidId)!;
      const k = layoutById.get(kidId)!;
      k.position = {
        x: pos.left - minX + GROUP_PADDING_X,
        y: pos.top - minY + GROUP_PADDING_TOP,
      };
      k.parentId = id;
    }
  }

  // Top-down pass: lay out the roots in absolute canvas coordinates.
  const roots = childrenOf.get(null) ?? [];
  if (roots.length > 0) {
    const g = new dagre.graphlib.Graph({ multigraph: false, compound: false });
    // Roots laid out left-to-right so multiple L1 groups read as parallel
    // lanes rather than a tall stack (important when the repo has no L0 and
    // the 5 perf-repo L1s are all roots).
    g.setGraph({ rankdir: 'LR', nodesep: NODESEP * 2, ranksep: RANKSEP });
    g.setDefaultEdgeLabel(() => ({}));
    for (const rootId of roots) {
      const r = layoutById.get(rootId)!;
      g.setNode(rootId, { width: r.width, height: r.height });
    }
    dagre.layout(g);
    for (const rootId of roots) {
      const n = g.node(rootId) as { x: number; y: number; width: number; height: number };
      const r = layoutById.get(rootId)!;
      r.position = {
        x: n.x - r.width / 2,
        y: n.y - r.height / 2,
      };
    }
  }

  // Return in the original row order so callers can rely on stable ordering
  // for React keys / memoization, but with children after parents (Pitfall 3
  // — React Flow processes the array in order and looks up parentIds as it
  // goes, so a child before its parent triggers a "parent not found" warning
  // and renders at root z-index). Sort by depth ascending.
  const ordered = rows
    .map((r) => layoutById.get(r.uuid)!)
    .sort((a, b) => (depthOf.get(a.id) ?? 0) - (depthOf.get(b.id) ?? 0));
  return ordered;
}
