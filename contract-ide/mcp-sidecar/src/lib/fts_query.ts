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
 * Build an FTS5 MATCH expression from a free-form user query.
 *
 * - Empty input → empty string (caller should short-circuit before binding)
 * - Already-structured query (contains uppercase AND/OR/NOT, NEAR, or quoted
 *   phrases) → pass through verbatim
 * - Natural-language query → split on any non-alphanumeric, FTS5-quote each
 *   token, join with " OR "
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

  // Split on any non-alphanumeric (whitespace + punctuation), FTS5-quote each
  // term, join with " OR ". This way "account-button.tsx" yields three tokens
  // (account, button, tsx) rather than one merged blob.
  const tokens = trimmed
    .split(/[^A-Za-z0-9]+/)
    .filter((t) => t.length > 0)
    .map((t) => `"${t}"`);

  if (tokens.length === 0) return trimmed;
  return tokens.join(' OR ');
}
