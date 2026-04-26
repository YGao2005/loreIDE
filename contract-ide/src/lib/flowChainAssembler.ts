/**
 * Phase 13 Plan 06 — CHAIN-01 / CHAIN-02: Flow chain assembler.
 *
 * Pure synchronous function: takes a flow contract's `members` array (Phase 9
 * FLOW-01 — first element is trigger, rest are participants in invocation
 * order) plus the full set of loaded contracts, and returns react-flow
 * `nodes` + `edges` ready for FlowChainLayout to render.
 *
 * Why pure & sync:
 *   - Deterministic positions (truth: same members → same y-coordinates).
 *   - Cleanly testable via vitest (no DOM, no async, no IPC).
 *   - Plan 13-08 (PR review animation) and plan 13-09 (Sync) replay this
 *     function with edited member sets — both depend on idempotent output.
 *
 * Layout (top → bottom):
 *   - First member is the trigger (kind: 'UI' → ScreenCard; otherwise
 *     ServiceCard). Rendered at y = 0.
 *   - Remaining members are ServiceCards stacked beneath, vertically offset
 *     by ESTIMATED_HEIGHT[card kind] + VERTICAL_GAP.
 *   - Edges connect consecutive participants with `type: 'callShape'` and
 *     `data: CallShape` (label derived from prev `## Outputs` → next
 *     `## Inputs` per Phase 9 BACKEND-FM-01).
 *
 * Beat 4 two-flow case: when this assembler runs for a NON-focused flow
 * (focusedFlowUuid !== thisFlowUuid), every ScreenCard in the result carries
 * `data.isFocused = false` so ScreenCard renders a cached screenshot instead
 * of the live iframe (perf budget: only 1 live iframe in the entire canvas).
 *
 * Defensive behavior:
 *   - Missing member uuids (e.g., flow references a contract that hasn't
 *     loaded yet) are skipped silently — chain still renders the contracts
 *     it knows about.
 *   - Empty `members` returns `{ nodes: [], edges: [] }` — FlowChainLayout
 *     surfaces "Select a flow" empty state.
 *   - `kind` strings are normalised to lowercase for ServiceCard's
 *     ServiceCardKind union (the demo uses `kind: UI` uppercase, `kind: API`
 *     uppercase, but ServiceCard expects `kind: api` lowercase).
 *
 * Card-height estimates (load-bearing for plan 13-09 Sync animation pulse
 * positions): tuned so consecutive cards never overlap in the demo's flow
 * shapes (1 ScreenCard + 6-8 ServiceCards). Adjust here only after measuring
 * real renders — under-estimating overlaps consecutive cards.
 */

import type { Node, Edge } from '@xyflow/react';
import { parseBackendSections } from './backendFrontmatter';
import type { ContractNode } from '@/ipc/types';
import type { ServiceCardData, ServiceCardKind, ServiceCardMethod } from '@/components/graph/ServiceCard';
import type { ScreenCardData } from '@/components/graph/ScreenCard';

/** Vertical pixel gap between consecutive cards in the chain. */
const VERTICAL_GAP = 80;

/**
 * Estimated card heights for vertical layout. Real cards measure slightly
 * different at runtime depending on body content (schemas, side effects), but
 * react-flow only uses position.y for routing — over-estimating slightly is
 * cheaper than under-estimating (overlap). Plan 13-09 Sync animation reads
 * these constants when computing pulse positions, so changes here cascade
 * to the Sync animation timing.
 */
const ESTIMATED_HEIGHT = {
  screen: 440, // ScreenCard: 600x400 iframe + ~36px header
  api: 240, // ServiceCard with method badge + Request + Response schemas
  lib: 200, // ServiceCard with function signature + simpler schemas
  data: 180, // ServiceCard with db.<table>.<op> + minimal schema
  external: 180, // ServiceCard with SDK call + side effects
  job: 180, // ServiceCard with job name + minimal body
  cron: 180, // ServiceCard with schedule
  event: 180, // ServiceCard with event type
} as const;

/** Centered x-offset for cards in the chain. fitView centers the chain. */
const CARD_X = 0;

/**
 * Lower-cases a contract kind from on-disk format (`UI`, `API`, `data`, ...)
 * to ServiceCard's lowercase ServiceCardKind union (`api`, `lib`, `data`, ...).
 * The lowercase forms are also accepted (Phase 9 BACKEND-FM-01 uses lowercase
 * for non-UI/API kinds), so this is idempotent.
 *
 * `UI` is special-cased upstream by `assembleFlowChain` — when the trigger is
 * UI, ScreenCard is mounted instead of ServiceCard.
 */
function normalizeKindForServiceCard(kind: string): ServiceCardKind {
  const lower = kind.toLowerCase();
  switch (lower) {
    case 'api':
    case 'lib':
    case 'data':
    case 'external':
    case 'job':
    case 'cron':
    case 'event':
      return lower;
    default:
      // Defensive default: render unknown kinds as `lib` (function-shaped).
      // The on-disk kind values are documented in scenario-criteria.md; this
      // fallback prevents crashing if a future contract introduces a new kind
      // before we register a ServiceCard variant for it.
      return 'lib';
  }
}

/**
 * Parse method + path from a node's `route` field (used for `kind: API`
 * contracts in the demo — `route: "DELETE /api/account"`).
 *
 * Returns null if the route doesn't match the expected `<METHOD> <path>`
 * format. ServiceCard's render branches handle the missing-method/path case
 * gracefully (header degrades to monospace name).
 */
function parseRouteAsMethodPath(
  route: string | null,
): { method: ServiceCardMethod; path: string } | null {
  if (!route) return null;
  const m = route.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/);
  if (!m) return null;
  return { method: m[1] as ServiceCardMethod, path: m[2] };
}

export interface AssembleFlowChainResult {
  nodes: Node[];
  edges: Edge[];
}

/**
 * Build the react-flow nodes + edges for a vertical participant chain.
 *
 * @param flowMemberUuids   Ordered uuids from the flow contract's `members`
 *                          frontmatter field. First is trigger; rest are
 *                          participants in invocation order.
 * @param allNodes          All loaded contract nodes (from useGraphStore).
 *                          Used to look up each member uuid's metadata.
 * @param focusedFlowUuid   Currently focused flow uuid (single live-iframe
 *                          policy). null when no flow is focused.
 * @param thisFlowUuid      The flow uuid being assembled here. When equal to
 *                          focusedFlowUuid, ScreenCards in this chain render
 *                          live iframes; otherwise they render screenshots.
 */
export function assembleFlowChain(
  flowMemberUuids: string[],
  allNodes: ContractNode[],
  focusedFlowUuid: string | null,
  thisFlowUuid: string,
): AssembleFlowChainResult {
  const nodeMap = new Map(allNodes.map((n) => [n.uuid, n]));
  const isThisFocused = focusedFlowUuid === thisFlowUuid;

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Filter out missing uuids defensively. The flow contract's `members` array
  // could reference a uuid whose contract hasn't loaded yet (race with the
  // watcher) or has been deleted — in either case the chain still renders
  // the contracts it knows about.
  const ordered = flowMemberUuids
    .map((uuid) => nodeMap.get(uuid))
    .filter((n): n is ContractNode => Boolean(n));

  let y = 0;

  for (let i = 0; i < ordered.length; i++) {
    const node = ordered[i];
    const isTrigger = i === 0;
    const isUiTrigger = isTrigger && node.kind.toLowerCase() === 'ui';

    if (isUiTrigger) {
      // Trigger is a UI screen — mount ScreenCard at top.
      const screenData: ScreenCardData = {
        uuid: node.uuid,
        name: node.name,
        // ScreenCard's URL composer will add a leading slash defensively.
        // Empty string fallback if route is null — buildPreviewUrl will
        // produce "<base>/" which is fine for unreachable.
        route: node.route ?? '/',
      };
      nodes.push({
        id: node.uuid,
        type: 'screenCard',
        position: { x: CARD_X, y },
        // Pass isFocused via a parallel data slot the FlowChainLayout layer
        // can read. We do NOT add it to ScreenCardData because the type is
        // a public contract for plan 13-08/09; instead extend the data
        // payload with a sibling key. ScreenCardImpl reads via cast.
        data: {
          ...screenData,
          isFocused: isThisFocused,
        } as Record<string, unknown>,
        // Layout is deterministic; user dragging would break the chain
        // illusion. Disable for clarity.
        draggable: false,
      });
      y += ESTIMATED_HEIGHT.screen + VERTICAL_GAP;
    } else {
      // Backend kind — mount ServiceCard.
      const sKind = normalizeKindForServiceCard(node.kind);
      const serviceData: ServiceCardData = {
        uuid: node.uuid,
        kind: sKind,
        name: node.name,
        body: node.contract_body ?? '',
      };

      // Kind-specific population. The demo seeds encode method+path in the
      // `route` field for kind:API ("DELETE /api/account"). Other kinds
      // don't have a structured method/path; the header branches in
      // ServiceCard handle missing fields gracefully.
      if (sKind === 'api') {
        const mp = parseRouteAsMethodPath(node.route);
        if (mp) {
          serviceData.method = mp.method;
          serviceData.path = mp.path;
        }
      }

      // Cron + event kinds use specific name formats. The seed corpus
      // doesn't yet structure these, so we let ServiceCard fall through to
      // the empty-schedule / event-type branches gracefully.

      nodes.push({
        id: node.uuid,
        type: 'serviceCard',
        position: { x: CARD_X, y },
        data: serviceData as Record<string, unknown>,
        draggable: false,
      });
      y += ESTIMATED_HEIGHT[sKind] + VERTICAL_GAP;
    }

    // Connect to previous participant (if any) with a CallShapeEdge.
    if (i > 0) {
      const prev = ordered[i - 1];
      edges.push({
        id: `${prev.uuid}->${node.uuid}`,
        source: prev.uuid,
        target: node.uuid,
        type: 'callShape',
        // CallShapeEdge reads `data` to render the label. Mismatched / unmappable
        // schemas surface as `?` per CHAIN-02 spec.
        data: deriveCallShape(
          prev.contract_body ?? '',
          node.contract_body ?? '',
        ) as unknown as Record<string, unknown>,
      });
    }
  }

  return { nodes, edges };
}

/**
 * Call-shape descriptor for an edge label. Matched JSON schemas surface as
 * `{ key1, key2 }` (the intersection of prev.outputs[0] keys with
 * next.inputs keys). Unmappable schemas surface as `?` with `matched: false`
 * so CallShapeEdge can render a muted style.
 */
export interface CallShape {
  /** Edge label text. `?` when prev.outputs[0] and next.inputs don't map. */
  label: string;
  /** Whether the schemas mapped cleanly. Drives muted styling for `?` labels. */
  matched: boolean;
}

/**
 * Derive a call-shape label from previous participant's `## Outputs` → next
 * participant's `## Inputs` (Phase 9 BACKEND-FM-01 sections).
 *
 * Matching strategy:
 *   1. Both bodies parsed via `parseBackendSections`.
 *   2. Take prev.outputs[0] (the first output variant — typically 200 OK).
 *   3. Take next.inputs (the single Inputs schema).
 *   4. If both are JSON, intersect the top-level keys; emit `{ k1, k2 }`.
 *   5. If parse fails or no shared keys, emit `?` with `matched: false`.
 *
 * BACKEND-FM-01 contract gap surface: when next.inputs is missing entirely
 * (e.g., the next participant's `## Inputs` section isn't populated yet),
 * we return `?` with `matched: false`. Plan 13-11 rehearsal surfaces this
 * as a Phase 9 contract gap if widespread.
 */
export function deriveCallShape(
  prevBody: string,
  nextBody: string,
): CallShape {
  const prev = parseBackendSections(prevBody);
  const next = parseBackendSections(nextBody);

  const prevOutSchema = prev.outputs[0]?.schema;
  const nextInSchema = next.inputs?.schema;

  if (!prevOutSchema || !nextInSchema) {
    return { label: '?', matched: false };
  }

  // Try parse both as JSON. If both succeed, intersect top-level keys.
  // Any parse failure on either side falls through to `?` per CHAIN-02
  // spec ("never render garbage").
  let prevObj: Record<string, unknown> | null = null;
  let nextObj: Record<string, unknown> | null = null;
  try {
    prevObj = JSON.parse(prevOutSchema);
  } catch {
    prevObj = null;
  }
  try {
    nextObj = JSON.parse(nextInSchema);
  } catch {
    nextObj = null;
  }

  if (
    !prevObj ||
    !nextObj ||
    typeof prevObj !== 'object' ||
    typeof nextObj !== 'object'
  ) {
    return { label: '?', matched: false };
  }

  const prevKeys = Object.keys(prevObj);
  const nextKeys = Object.keys(nextObj);
  const shared = prevKeys.filter((k) => nextKeys.includes(k));

  if (shared.length === 0) {
    return { label: '?', matched: false };
  }

  return { label: `{ ${shared.join(', ')} }`, matched: true };
}
