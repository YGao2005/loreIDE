/**
 * Phase 9 Plan 09-01 — Mass-edit retrieval MCP tool (MASS-01 keyword path).
 *
 * Extends find_by_intent with:
 *   1. NO LIMIT (default cap 100; mass edits often touch >10 nodes)
 *   2. Returns FULL contract bodies (review queue needs them for diff preview
 *      without a second round-trip — 09-02's review queue consumes this)
 *   3. Section-weighted re-ranking via the canonical Rust section parser
 *      (section-parser-cli binary, Phase 8 PROP-01)
 *   4. Returns `human_pinned: boolean` per matched node (09-02's review queue
 *      relies on this for predictive pinned-count display BEFORE apply runs)
 *
 * EMBEDDING_DISABLED: embeddings are explicitly deferred in v1 per
 * 09-RESEARCH.md Q1 default. The response carries `embedding_status: 'disabled'`
 * so the review queue can surface "keyword matches only" to the user.
 * Per MASS-01 spec — keyword-only fallback is fully sufficient.
 */

import { getDb } from '../db';
import { buildFtsQuery } from '../lib/fts_query';
import { reRankWithSectionWeight, type FtsResultLike } from '../lib/section_weight';
import path from 'node:path';

/**
 * Mass-edit retrieval — returns the full FTS5 match set (no LIMIT, default
 * cap 100) with section-weighted re-ranking and full contract bodies.
 *
 * The `nodes_fts` virtual table was created by Plan 01-02 migration v1.
 * `contract_body` is joined from `nodes` so we have the full body for
 * section-weighted re-ranking and diff preview.
 *
 * `human_pinned` is surfaced from `nodes.human_pinned` (NULL treated as false)
 * so 09-02's review queue can show predictive pinned-count without a dep loop.
 */
export async function findByIntentMass(query: string, limit = 100) {
  const db = getDb();
  // Joining nodes for body + human_pinned. contract_body is the column
  // indexed in nodes_fts (verified in find_by_intent.ts migrations).
  // OR-tokenize the natural-language query so FTS5 doesn't AND every term
  // (mirrors the Rust IPC fix in commands/mass_edit.rs::build_fts_query).
  const ftsMatch = buildFtsQuery(query);
  const rows = db
    .prepare(
      `
      SELECT n.uuid, n.name, n.level, n.kind, n.contract_body AS body,
             COALESCE(n.human_pinned, 0) AS human_pinned,
             snippet(nodes_fts, -1, '**', '**', '...', 20) AS snippet,
             rank AS ftsRank
      FROM nodes_fts
      JOIN nodes n ON n.uuid = nodes_fts.uuid
      WHERE nodes_fts MATCH ?
      ORDER BY rank
      LIMIT ?
      `,
    )
    .all(ftsMatch, limit) as FtsResultLike[];

  if (rows.length === 0) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        query, embedding_status: 'disabled', matches: []
      })}]
    };
  }

  // Resolve section-parser-cli binary path. The MCP sidecar is bundled
  // alongside the binary by Tauri (Phase 8 PROP-01). Allow override via
  // SECTION_PARSER_CLI_PATH env var (documented in 08-02-SUMMARY.md as
  // the canonical override pattern for the MCP sidecar).
  //
  // Dev mode path: relative from compiled mcp-sidecar dist/ to the
  // src-tauri/binaries/ directory containing the suffixed binary.
  // Bundled mode: Tauri resolves the binary via the externalBin path.
  // We try the unsuffixed path first (symlink set up by build scripts),
  // then the aarch64-apple-darwin suffixed path as fallback for dev.
  const binaryPath = process.env.SECTION_PARSER_CLI_PATH
    ?? path.join(__dirname, '..', '..', '..', 'src-tauri', 'binaries', 'section-parser-cli-aarch64-apple-darwin');

  const ranked = reRankWithSectionWeight(rows, binaryPath);

  return {
    content: [{ type: 'text' as const, text: JSON.stringify({
      query,
      embedding_status: 'disabled',  // MASS-01 keyword-only fallback
      matches: ranked.map(r => ({
        uuid: r.uuid,
        name: r.name,
        level: r.level,
        kind: r.kind,
        snippet: r.snippet,
        body: r.body,
        human_pinned: !!(r.human_pinned),  // SQLite INTEGER → boolean cast
        weightedScore: r.weightedScore,
        matchedSection: (r as FtsResultLike & { matchedSection?: string }).matchedSection,
      }))
    })}]
  };
}
