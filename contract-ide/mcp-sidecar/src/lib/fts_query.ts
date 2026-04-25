/**
 * Phase 9 Plan 09-01 fix — FTS5 query construction.
 *
 * FTS5's default tokenization treats whitespace-separated terms as implicit
 * AND. A natural-language query like `"add audit logging to every destructive
 * endpoint"` requires every word to appear in the same row, returning 0 hits
 * even when the corpus contains "destructive" / "audit" / "endpoint" in
 * several contracts.
 *
 * `buildFtsQuery()` OR-tokenizes natural-language queries; BM25 ranking
 * demotes common words naturally so OR'ing all tokens (including stopwords)
 * produces the right top-N. Pass-through behavior preserved for already-
 * structured queries (uppercase AND/OR/NOT, NEAR, quoted phrases).
 *
 * Mirrors the Rust IPC helper in `src-tauri/src/commands/mass_edit.rs`.
 * The two paths must agree byte-for-byte on the MATCH expression they bind.
 */

/**
 * English stopwords filtered out of OR-tokenized FTS queries.
 *
 * These appear in nearly every contract body, so OR'ing them in causes the
 * result set to balloon with no signal (e.g., the SC1 query without filtering
 * returns 46/52 nodes; with filtering it returns 25). Conservative list —
 * articles, prepositions, common determiners, basic auxiliary verbs. Action
 * verbs (add, remove, delete, update) are NOT stopwords.
 *
 * MUST be kept in sync with FTS_STOPWORDS in src-tauri/src/commands/mass_edit.rs
 * so the MCP tool path and the frontend Rust IPC path produce identical
 * MATCH expressions for the same user input.
 */
const FTS_STOPWORDS = new Set<string>([
  'a', 'an', 'the',
  'to', 'of', 'in', 'on', 'at', 'by', 'for', 'from', 'with', 'into', 'onto',
  'and', 'or', 'but',
  'every', 'all', 'any', 'each', 'some',
  'this', 'that', 'these', 'those', 'it', 'its',
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'has', 'have', 'had',
]);

/**
 * Build an FTS5 MATCH expression from a free-form user query.
 *
 * - Empty input → empty string (caller should short-circuit before binding)
 * - Already-structured query (contains uppercase AND/OR/NOT, NEAR, or quoted
 *   phrases) → pass through verbatim
 * - Natural-language query → split on any non-alphanumeric, drop stopwords,
 *   FTS5-quote each remaining term, join with " OR "
 * - Stopwords-only query → fall back to no-filter tokenization so the user
 *   still gets a result rather than an empty MATCH
 */
export function buildFtsQuery(userQuery: string): string {
  const trimmed = userQuery.trim();
  if (trimmed.length === 0) return trimmed;

  // Detect structured queries — pass through.
  const upper = trimmed.toUpperCase();
  const hasOperator =
    upper.includes(' AND ') ||
    upper.includes(' OR ') ||
    upper.includes(' NOT ') ||
    upper.includes(' NEAR(') ||
    trimmed.includes('"');
  if (hasOperator) return trimmed;

  const rawTokens = trimmed.split(/[^A-Za-z0-9]+/).filter((t) => t.length > 0);

  // Drop stopwords (case-insensitive), FTS5-quote each remaining term,
  // join with " OR ". "account-button.tsx" → 3 tokens (account, button, tsx).
  const filtered = rawTokens
    .filter((t) => !FTS_STOPWORDS.has(t.toLowerCase()))
    .map((t) => `"${t}"`);

  if (filtered.length > 0) return filtered.join(' OR ');

  // Fallback: every word was a stopword. Re-tokenize WITHOUT the filter so
  // the user gets some result for stopword-only queries.
  const fallback = rawTokens.map((t) => `"${t}"`);
  if (fallback.length === 0) return trimmed;
  return fallback.join(' OR ');
}
