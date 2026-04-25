import { getDb, decodeNodeRow } from '../db';

/**
 * List nodes where code_hash and contract_hash both exist and disagree — the
 * DRIFT-01 predicate. Phase 5 can only return an empty set on a fresh repo
 * because derivation (Phase 6) hasn't populated the baselines yet; Phase 7's
 * consumer still depends on this shape landing now.
 */
export async function listDriftedNodes() {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT uuid, level, name, kind, code_ranges, parent_uuid, is_canonical,
             code_hash, contract_hash, human_pinned, route, derived_at,
             contract_body
      FROM nodes
      WHERE code_hash IS NOT NULL
        AND contract_hash IS NOT NULL
        AND code_hash != contract_hash
      `,
    )
    .all() as Array<Record<string, unknown>>;

  const nodes = rows.map(decodeNodeRow);
  if (nodes.length === 0) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'No drifted nodes. (Note: drift is populated once Phase 6 derivation writes code_hash/contract_hash baselines.)',
        },
      ],
    };
  }
  const text = nodes
    .map((n) => `- ${n.uuid}  ${n.name} (${n.level} ${n.kind})`)
    .join('\n');
  return {
    content: [
      { type: 'text' as const, text: `Drifted nodes (${nodes.length}):\n${text}` },
    ],
  };
}
