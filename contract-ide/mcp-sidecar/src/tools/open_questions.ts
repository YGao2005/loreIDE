/**
 * Phase 11 MCP tool: list open questions captured by the substrate distiller.
 *
 * Unlike find_constraints_for_goal / find_decisions_about, open_questions does
 * not require a search query — it lists all open_question substrate nodes,
 * optionally filtered by scope (LIKE-prefix match). Ordered by valid_at DESC
 * (most recent first) so the agent sees the freshest questions first.
 *
 * FTS5 join is not used here because open_question retrieval is list-style,
 * not similarity-search. The scope LIKE filter handles the common case of
 * narrowing to a module or task-pattern context.
 *
 * Filters WHERE invalid_at IS NULL (current-truth only, Phase 12 forward-compat).
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../db.js';

const inputSchema = z.object({
  scope: z.string().optional(),
  limit: z.number().int().positive().max(50).optional().default(5),
});

interface OpenQuestionRow {
  uuid: string;
  text: string;
  applies_when: string | null;
  scope: string | null;
  confidence: string;
  source_session_id: string | null;
  source_turn_ref: number | null;
}

export async function openQuestions(args: z.infer<typeof inputSchema>) {
  const { scope, limit } = inputSchema.parse(args);
  const db = getDb();

  const rows: OpenQuestionRow[] = scope
    ? (db
        .prepare(
          `SELECT uuid, text, applies_when, scope, confidence, source_session_id, source_turn_ref
           FROM substrate_nodes
           WHERE node_type = 'open_question' AND invalid_at IS NULL AND scope LIKE ?
           ORDER BY valid_at DESC
           LIMIT ?`,
        )
        .all(`${scope}%`, limit) as OpenQuestionRow[])
    : (db
        .prepare(
          `SELECT uuid, text, applies_when, scope, confidence, source_session_id, source_turn_ref
           FROM substrate_nodes
           WHERE node_type = 'open_question' AND invalid_at IS NULL
           ORDER BY valid_at DESC
           LIMIT ?`,
        )
        .all(limit) as OpenQuestionRow[]);

  if (rows.length === 0) {
    const filterDesc = scope ? ` (scope: ${scope})` : '';
    return {
      content: [{ type: 'text' as const, text: `No open questions found${filterDesc}.` }],
    };
  }

  const text = rows
    .map(
      (r, i) =>
        `[${i + 1}] ${r.text}\n   applies_when: ${r.applies_when ?? '(none)'}${r.scope ? `\n   scope: ${r.scope}` : ''}`,
    )
    .join('\n\n');

  return { content: [{ type: 'text' as const, text }] };
}

export function registerOpenQuestions(server: McpServer) {
  server.tool(
    'open_questions',
    'List open questions captured by the substrate distiller. Optional scope filter (LIKE-prefix match). Returns most recent first.',
    inputSchema.shape,
    openQuestions,
  );
}
