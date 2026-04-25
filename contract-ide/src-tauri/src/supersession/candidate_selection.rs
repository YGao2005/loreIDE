//! FTS5 candidate selection for fact_engine. Returns top-K substrate nodes
//! likely to overlap with a new node — without this filter, fact_engine
//! would LLM-judge new × ALL existing nodes (100x cost). See
//! 12-RESEARCH.md Pattern 4.
//!
//! NOTE on FTS5 table coordination:
//!   Phase 11 (migration v6) ships `substrate_nodes_fts` (virtual FTS5 table)
//!   with columns `uuid UNINDEXED, text, applies_when, scope` and
//!   `content='substrate_nodes', content_rowid='rowid'` — the EXACT shape this
//!   module needs. Phase 12 plan 12-02 originally proposed shipping a v8
//!   "backstop" migration but that would either (a) collide on the trigger
//!   names if Phase 11 had not landed, or (b) be a no-op IF NOT EXISTS once
//!   Phase 11 had landed. Since Phase 11 v6 has shipped, we DO NOT ship the
//!   backstop migration. The fact_engine reads from Phase 11's FTS5 table
//!   directly. Documented in 12-02-SUMMARY.md.

use crate::supersession::types::SubstrateNode;
use sqlx::SqlitePool;

/// Find substrate nodes overlapping with `(node_type, scope, text + applies_when)`.
/// Filters: node_type match, scope overlap (exact OR prefix), invalid_at IS NULL,
/// excluded uuid `exclude_uuid`. Top-K = 10 hardcoded (validated in research/intent-supersession/).
pub async fn find_overlapping(
    pool: &SqlitePool,
    node_type: &str,
    scope: Option<&str>,
    text: &str,
    applies_when: Option<&str>,
    exclude_uuid: &str,
    top_k: u32,
) -> Result<Vec<SubstrateNode>, String> {
    // Build FTS5 query string from text + applies_when. Sanitize: strip
    // SQL/FTS5 meta-chars (parentheses, quotes, colons) to keep the query
    // string parseable. Defensive — bail to a simple bag-of-words tokenization
    // if the query would be malformed.
    let query_raw = format!("{} {}", text.trim(), applies_when.unwrap_or("").trim());
    let sanitized: String = query_raw
        .chars()
        .map(|c| match c {
            '"' | '\'' | '(' | ')' | ':' => ' ',
            _ => c,
        })
        .collect();
    let tokens: Vec<&str> = sanitized
        .split_whitespace()
        .filter(|t| t.len() >= 2)
        .take(20) // bound query length
        .collect();
    if tokens.is_empty() {
        return Ok(vec![]);
    }
    // OR-style FTS5 query — match any token, ranked by BM25.
    let query = tokens.join(" OR ");

    let rows: Vec<SubstrateNode> = match scope {
        Some(s) => {
            sqlx::query_as::<_, SubstrateNode>(
                r#"
                SELECT s.uuid, s.node_type, s.text, s.scope, s.applies_when,
                       s.valid_at, s.invalid_at, s.expired_at, s.invalidated_by
                FROM substrate_nodes_fts f
                JOIN substrate_nodes s ON s.rowid = f.rowid
                WHERE substrate_nodes_fts MATCH ?1
                  AND s.invalid_at IS NULL
                  AND s.node_type = ?2
                  AND (s.scope = ?3 OR s.scope LIKE ?3 || '%' OR ?3 LIKE s.scope || '%')
                  AND s.uuid != ?4
                ORDER BY rank
                LIMIT ?5
                "#,
            )
            .bind(&query)
            .bind(node_type)
            .bind(s)
            .bind(exclude_uuid)
            .bind(top_k)
            .fetch_all(pool)
            .await
            .map_err(|e| format!("candidate_selection FTS5 query failed: {e}"))?
        }
        None => {
            sqlx::query_as::<_, SubstrateNode>(
                r#"
                SELECT s.uuid, s.node_type, s.text, s.scope, s.applies_when,
                       s.valid_at, s.invalid_at, s.expired_at, s.invalidated_by
                FROM substrate_nodes_fts f
                JOIN substrate_nodes s ON s.rowid = f.rowid
                WHERE substrate_nodes_fts MATCH ?1
                  AND s.invalid_at IS NULL
                  AND s.node_type = ?2
                  AND s.uuid != ?3
                ORDER BY rank
                LIMIT ?4
                "#,
            )
            .bind(&query)
            .bind(node_type)
            .bind(exclude_uuid)
            .bind(top_k)
            .fetch_all(pool)
            .await
            .map_err(|e| format!("candidate_selection FTS5 query failed: {e}"))?
        }
    };

    Ok(rows)
}

#[cfg(test)]
mod tests {
    // Integration test that requires a populated SQLite is in 12-04's
    // adversarial harness; this module is exercised via fact_engine tests.
}
