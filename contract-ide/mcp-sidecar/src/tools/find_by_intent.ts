/**
 * Phase 5 MCP tool: natural-language search over contract nodes via FTS5.
 *
 * Phase 8 Plan 08-06 extension: for each result that is rollup-stale, wraps
 * the snippet with a staleness annotation per RESEARCH.md Layer 4 / PROP-04.
 * Downstream agents reading search results for an L2/L3 contract are warned
 * that cited children may have diverged since the last reconcile (W7 phrasing).
 */

import { getDb } from '../db';
import { annotateStaleness, type StalenessSummary } from '../lib/staleness_annotation';

/**
 * Natural-language search over contract nodes via SQLite FTS5.
 *
 * The `nodes_fts` virtual table was created by Plan 01-02 migration v1 (DATA-06).
 * This query joins back to `nodes` so we can surface UUID + level + kind
 * alongside the snippet; FTS5's `snippet()` highlights matched terms in the
 * indexed text with `**bold**` delimiters.
 *
 * Stale nodes (rollup_state ≠ fresh) have their snippet prefixed with a staleness
 * header so downstream agents know they may be reading stale context.
 */
export async function findByIntent(query: string, limit: number) {
  const db = getDb();
  // nodes_fts MATCH is FTS5's bm25-ranked search. Columns in the virtual table
  // come from Plan 01-02 migration v1; if the FTS column layout differs from
  // this query, the handler will throw and we'll swap based on the observed
  // PRAGMA table_info(nodes_fts) output logged in SUMMARY.
  const rows = db
    .prepare(
      `
      SELECT n.uuid, n.name, n.level, n.kind,
             snippet(nodes_fts, -1, '**', '**', '...', 20) AS snippet
      FROM nodes_fts
      JOIN nodes n ON n.uuid = nodes_fts.uuid
      WHERE nodes_fts MATCH ?
      ORDER BY rank
      LIMIT ?
      `,
    )
    .all(query, limit) as Array<{
      uuid: string;
      name: string;
      level: string;
      kind: string;
      snippet: string;
    }>;

  if (rows.length === 0) {
    return {
      content: [
        { type: 'text' as const, text: `No contracts found matching: ${query}` },
      ],
    };
  }

  const text = rows
    .map((r) => {
      // Check if this result is rollup-stale and annotate if so.
      const staleness = buildStalenessSummaryForResult(db, r.uuid, r.level);
      const annotatedSnippet = annotateStaleness(r.snippet, staleness);

      return `UUID: ${r.uuid}\nName: ${r.name} (${r.level} ${r.kind})\n${annotatedSnippet}`;
    })
    .join('\n---\n');

  return { content: [{ type: 'text' as const, text }] };
}

/**
 * Check rollup_derived for a single UUID and build a StalenessSummary.
 * Returns null when state is fresh, untracked, or absent.
 */
function buildStalenessSummaryForResult(
  db: import('bun:sqlite').Database,
  uuid: string,
  level: string,
): StalenessSummary | null {
  if (level === 'L0') return null;

  const derivedRow = db
    .prepare('SELECT state FROM rollup_derived WHERE node_uuid = ?')
    .get(uuid) as { state: string } | undefined;

  if (!derivedRow || derivedRow.state !== 'stale') return null;

  // Read rollup_inputs_json for the cited children.
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

  return {
    level,
    dependent_children_changed: rollupInputs.length,
    child_summaries: rollupInputs.map((ri) => ({
      child_uuid: ri.child_uuid,
      sections_changed: ri.sections,
    })),
  };
}
