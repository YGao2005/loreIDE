/**
 * Phase 11 MCP tool: find substrate constraints that apply to a given goal.
 *
 * FTS5-only candidate selection over substrate_nodes_fts MATCH query.
 * No LLM rerank — MCP tool calls must be cheap (rerank reserved for Delegate
 * flow in Plan 11-04). Filters WHERE invalid_at IS NULL (current-truth only,
 * Phase 12 forward-compat).
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../db.js';
import { buildFtsQuery } from '../lib/fts_query.js';

const inputSchema = z.object({
  intent: z.string().min(1, 'intent must be non-empty'),
  limit: z.number().int().positive().max(50).optional().default(5),
});

interface SubstrateRow {
  uuid: string;
  text: string;
  applies_when: string | null;
  scope: string | null;
  confidence: string;
  source_session_id: string | null;
  source_turn_ref: number | null;
  source_quote: string | null;
  node_type: string;
}

export async function findConstraintsForGoal(args: z.infer<typeof inputSchema>) {
  const { intent, limit } = inputSchema.parse(args);
  const db = getDb();

  const ftsExpr = buildFtsQuery(intent);
  if (ftsExpr.length === 0) {
    return {
      content: [{ type: 'text' as const, text: `No constraints found matching: ${intent}` }],
    };
  }

  const rows = db
    .prepare(
      `
      SELECT s.uuid, s.text, s.applies_when, s.scope, s.confidence,
             s.source_session_id, s.source_turn_ref, s.source_quote, s.node_type
      FROM substrate_nodes_fts fts
      JOIN substrate_nodes s ON s.uuid = fts.uuid
      WHERE substrate_nodes_fts MATCH ?
        AND s.invalid_at IS NULL
        AND s.node_type = 'constraint'
      ORDER BY fts.rank
      LIMIT ?
      `,
    )
    .all(ftsExpr, limit) as SubstrateRow[];

  if (rows.length === 0) {
    return {
      content: [{ type: 'text' as const, text: `No constraints found matching: ${intent}` }],
    };
  }

  const text = rows
    .map(
      (r, i) =>
        `[${i + 1}] ${r.text}\n   applies_when: ${r.applies_when ?? '(none)'}\n   confidence: ${r.confidence} | source: ${r.source_session_id ?? 'none'}:${r.source_turn_ref ?? '?'}`,
    )
    .join('\n\n');

  return { content: [{ type: 'text' as const, text }] };
}

export function registerFindConstraintsForGoal(server: McpServer) {
  server.tool(
    'find_constraints_for_goal',
    'Find substrate constraints whose applies_when semantically matches the given goal. Returns top-N current-truth constraints (filtered to invalid_at IS NULL).',
    inputSchema.shape,
    findConstraintsForGoal,
  );
}
