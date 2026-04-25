import { getDb, decodeNodeRow } from '../db';
import { V2_DERIVATION_INSTRUCTIONS } from './prompt-v2';

/**
 * DERIVE-01 queue: nodes whose contract body is missing or hash baselines are
 * not yet written. Phase 6 calling session uses this to find work — each row
 * is then handed to `write_derived_contract` after the session reads the
 * source and generates a body.
 *
 * `include_pinned: false` (default) hides `human_pinned` rows so the calling
 * session doesn't waste a turn attempting a write that `write_derived_contract`
 * will reject.
 *
 * The instruction block at the end of the payload is the v2 spec: sectioned
 * markdown bodies with canonical H2 headings + per-kind/level slot rules +
 * mandatory invariant line citations + self-review pass. Adopted 2026-04-24
 * after 3-iteration dogfood test (see .planning/research/contract-form/).
 */
export async function listNodesNeedingDerivation({
  include_pinned = false,
  limit = 100,
}: {
  include_pinned?: boolean;
  limit?: number;
}) {
  const db = getDb();
  const pinnedClause = include_pinned ? '' : 'AND human_pinned = 0';
  const rows = db
    .prepare(
      `
      SELECT uuid, level, name, kind, code_ranges, parent_uuid, is_canonical,
             code_hash, contract_hash, human_pinned, route, derived_at,
             contract_body
      FROM nodes
      WHERE (contract_body IS NULL OR trim(contract_body) = ''
             OR code_hash IS NULL)
        ${pinnedClause}
      LIMIT ?
      `,
    )
    .all(limit) as Array<Record<string, unknown>>;

  const nodes = rows.map(decodeNodeRow);
  if (nodes.length === 0) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'No nodes need derivation — every node has a contract body and code_hash baseline.',
        },
      ],
    };
  }

  const lines = nodes.map((n) => {
    const ranges = n.code_ranges
      .map((r) => `${r.file}:${r.start_line}-${r.end_line}`)
      .join(', ');
    return `- ${n.uuid}  ${n.name}  (${n.level} ${n.kind})  [${ranges || 'no source'}]`;
  });

  return {
    content: [
      {
        type: 'text' as const,
        text: `Nodes needing derivation (${nodes.length}):\n${lines.join('\n')}\n\n${V2_DERIVATION_INSTRUCTIONS}`,
      },
    ],
  };
}
