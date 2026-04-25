/**
 * Phase 9 FLOW-01 layout primitive.
 *
 * Phase 13 CHAIN-01 imports this to render vertical participant chains on
 * the canvas. Pure function — no React, no DOM, no canvas — just
 * deterministic position math.
 *
 * Design:
 *  - The trigger (members[0]) is placed at y = TRIGGER_Y (0).
 *  - Each subsequent participant is placed at y = index * VERTICAL_GAP_PX.
 *  - Members not found in `allNodes` are omitted (dangling UUID — the
 *    repo-load validator should catch these; this function is defensive but
 *    does not throw).
 *
 * Consumer contract:
 *  - Phase 13 CHAIN-01 calls layoutFlowMembers(flow.members, nodesMap)
 *    to obtain the LayoutEntry[] it needs to position cards.
 *  - The x-position of each card is determined by Phase 13 (not here).
 *  - VERTICAL_GAP_PX and TRIGGER_Y are exported so Phase 13 can reference
 *    the same constants without duplication.
 */

/** Vertical distance between adjacent participant cards (px). */
export const VERTICAL_GAP_PX = 120;

/** Y-position of the trigger card (first member). */
export const TRIGGER_Y = 0;

/**
 * One entry in the ordered layout for a flow's participant chain.
 */
export interface LayoutEntry {
  /** UUID of the participant node. */
  uuid: string;
  /** Deterministic y-position in pixels relative to the flow's origin. */
  y: number;
  /** Zero-based index in the members array (trigger = 0). */
  index: number;
  /** Role: trigger (first member) or participant (all others). */
  role: 'trigger' | 'participant';
}

/**
 * Given an ordered members array and a map of all loaded nodes, return the
 * layout entries for the trigger + participants in invocation order with
 * deterministic y-positions.
 *
 * @param members  Ordered UUID array from the flow contract's `members` field.
 *                 members[0] is the trigger. May be empty — returns [].
 * @param allNodes Map of uuid → any object that has a `uuid` property.
 *                 Use the nodes map from the graph store. Members not found
 *                 in this map are silently omitted.
 * @returns        LayoutEntry[] sorted by index ascending (trigger first).
 *
 * @example
 * const entries = layoutFlowMembers(
 *   flowNode.members ?? [],
 *   new Map(nodes.map(n => [n.uuid, n])),
 * );
 * // entries[0].y === 0 (trigger)
 * // entries[1].y === 120
 * // entries[2].y === 240
 */
export function layoutFlowMembers(
  members: string[],
  allNodes: Map<string, { uuid: string }>,
): LayoutEntry[] {
  const out: LayoutEntry[] = [];
  members.forEach((uuid, index) => {
    if (!allNodes.has(uuid)) return; // Omit dangling references defensively.
    out.push({
      uuid,
      index,
      y: index === 0 ? TRIGGER_Y : index * VERTICAL_GAP_PX,
      role: index === 0 ? 'trigger' : 'participant',
    });
  });
  return out;
}
