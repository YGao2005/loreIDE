/**
 * Phase 5 MCP tool: fetch a contract node by UUID.
 *
 * Phase 8 Plan 08-06 extension: annotates the response body with a staleness
 * header when rollup_state ≠ 'fresh' per RESEARCH.md Layer 4 / PROP-04.
 * Downstream agents reading an L2/L3 contract are warned that cited children
 * may have diverged since the last reconcile (W7 phrasing).
 */

import { getDb, decodeNodeRow } from '../db';
import { annotateStaleness } from '../lib/staleness_annotation';
import type { StalenessSummary } from '../lib/staleness_annotation';

/**
 * Fetch a single contract node by UUID. Returns the full ContractNodeRow shape
 * as pretty-printed JSON so Claude Code can render it inline in tool output.
 *
 * When rollup_state === 'stale', the response body is prefixed with a staleness
 * annotation that cites which children may have diverged (PROP-04 Layer 4).
 */
export async function getContract(uuid: string) {
  const db = getDb();
  const row = db
    .prepare(
      `
      SELECT uuid, level, name, kind, code_ranges, parent_uuid, is_canonical,
             code_hash, contract_hash, human_pinned, route, derived_at,
             contract_body
      FROM nodes
      WHERE uuid = ?
      `,
    )
    .get(uuid) as Record<string, unknown> | undefined;

  if (!row) {
    return {
      content: [{ type: 'text' as const, text: `No contract with uuid=${uuid}` }],
    };
  }

  const node = decodeNodeRow(row);

  // Check rollup_derived for staleness.
  const staleness = buildStalenessSummary(db, uuid, node.level);

  // Annotate body when stale — return verbatim when fresh or untracked.
  // (untracked = not configured for rollup tracking — not a staleness signal)
  const annotatedBody = annotateStaleness(node.contract_body ?? '', staleness);

  const annotatedNode = staleness
    ? { ...node, contract_body: annotatedBody }
    : node;

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(annotatedNode, null, 2) }],
  };
}

/**
 * Build a StalenessSummary for a node if its rollup_state is 'stale'.
 * Returns null for fresh, untracked, or L0 nodes.
 *
 * Reads rollup_derived.state + nodes.rollup_inputs_json to build the child list.
 * In v1, all cited children are listed as "may have diverged" — we lack per-
 * generation snapshots to identify exactly which sections changed.
 */
function buildStalenessSummary(
  db: import('bun:sqlite').Database,
  uuid: string,
  level: string,
): StalenessSummary | null {
  // L0 nodes have no rollup mechanics.
  if (level === 'L0') return null;

  // Check rollup_derived for this node's state.
  const derivedRow = db
    .prepare('SELECT state FROM rollup_derived WHERE node_uuid = ?')
    .get(uuid) as { state: string } | undefined;

  if (!derivedRow || derivedRow.state !== 'stale') {
    return null; // fresh or untracked — no annotation
  }

  // Read rollup_inputs_json from nodes to identify cited children.
  const nodeRow = db
    .prepare('SELECT rollup_inputs_json FROM nodes WHERE uuid = ?')
    .get(uuid) as { rollup_inputs_json: string | null } | undefined;

  let rollupInputs: Array<{ child_uuid: string; sections: string[] }> = [];
  if (nodeRow?.rollup_inputs_json) {
    try {
      rollupInputs = JSON.parse(nodeRow.rollup_inputs_json) as typeof rollupInputs;
    } catch {
      rollupInputs = [];
    }
  }

  if (rollupInputs.length === 0) {
    // Stale but no rollup_inputs recorded — generic annotation.
    return {
      level,
      dependent_children_changed: 0,
      child_summaries: [],
    };
  }

  const childSummaries = rollupInputs.map((ri) => ({
    child_uuid: ri.child_uuid,
    sections_changed: ri.sections,
  }));

  return {
    level,
    dependent_children_changed: rollupInputs.length,
    child_summaries: childSummaries,
  };
}
