//! Shared SQL helpers for supersession (fact + intent engines).

use crate::supersession::types::SubstrateNode;
use sqlx::SqlitePool;

/// Default current-truth query — applied to EVERY MCP read.
/// Caller may pass node_type to narrow.
pub async fn fetch_current_substrate_nodes(
    pool: &SqlitePool,
    node_type: Option<&str>,
    limit: u32,
) -> sqlx::Result<Vec<SubstrateNode>> {
    match node_type {
        Some(t) => {
            sqlx::query_as::<_, SubstrateNode>(
                "SELECT uuid, node_type, text, scope, applies_when, valid_at, invalid_at, expired_at, invalidated_by \
                 FROM substrate_nodes \
                 WHERE invalid_at IS NULL AND node_type = ?1 \
                 ORDER BY valid_at DESC LIMIT ?2",
            )
            .bind(t)
            .bind(limit)
            .fetch_all(pool)
            .await
        }
        None => {
            sqlx::query_as::<_, SubstrateNode>(
                "SELECT uuid, node_type, text, scope, applies_when, valid_at, invalid_at, expired_at, invalidated_by \
                 FROM substrate_nodes \
                 WHERE invalid_at IS NULL \
                 ORDER BY valid_at DESC LIMIT ?1",
            )
            .bind(limit)
            .fetch_all(pool)
            .await
        }
    }
}

/// History query — returns BOTH current and invalidated versions of a node + supersession chain,
/// ordered by valid_at ASC. Powers the find_substrate_history MCP tool (12-04 backstop).
pub async fn fetch_substrate_history(
    pool: &SqlitePool,
    root_uuid: &str,
) -> sqlx::Result<Vec<SubstrateNode>> {
    sqlx::query_as::<_, SubstrateNode>(
        r#"
        WITH chain AS (
            SELECT uuid, node_type, text, scope, applies_when, valid_at, invalid_at, expired_at, invalidated_by
                FROM substrate_nodes WHERE uuid = ?1
            UNION
            SELECT s.uuid, s.node_type, s.text, s.scope, s.applies_when, s.valid_at, s.invalid_at, s.expired_at, s.invalidated_by
                FROM substrate_nodes s
                JOIN substrate_edges e ON e.target_uuid = s.uuid
                WHERE e.source_uuid = ?1 AND e.edge_type = 'supersedes'
            UNION
            SELECT s.uuid, s.node_type, s.text, s.scope, s.applies_when, s.valid_at, s.invalid_at, s.expired_at, s.invalidated_by
                FROM substrate_nodes s
                JOIN substrate_edges e ON e.source_uuid = s.uuid
                WHERE e.target_uuid = ?1 AND e.edge_type = 'supersedes'
            UNION
            SELECT uuid, node_type, text, scope, applies_when, valid_at, invalid_at, expired_at, invalidated_by
                FROM substrate_nodes WHERE invalidated_by = ?1
        )
        SELECT * FROM chain ORDER BY valid_at ASC
        "#,
    )
    .bind(root_uuid)
    .fetch_all(pool)
    .await
}

/// Single-node read used by fact_engine before invalidation judging.
pub async fn read_substrate_node(pool: &SqlitePool, uuid: &str) -> Result<SubstrateNode, String> {
    sqlx::query_as::<_, SubstrateNode>(
        "SELECT uuid, node_type, text, scope, applies_when, valid_at, invalid_at, expired_at, invalidated_by \
         FROM substrate_nodes WHERE uuid = ?1",
    )
    .bind(uuid)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("read_substrate_node({uuid}): {e}"))
}

/// Apply Graphiti's exact field updates on a stale node:
///   stale.invalid_at  = new.valid_at  (when fact stopped being true, real-world time)
///   stale.expired_at  = utc_now()      (when DB realized contradiction)
///   stale.invalidated_by = new.uuid
/// Caller is responsible for holding DriftLocks::for_uuid(stale_uuid).
pub async fn write_supersession(
    pool: &SqlitePool,
    stale_uuid: &str,
    new_valid_at: &str,
    expired_at_now: &str,
    new_uuid: &str,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE substrate_nodes \
         SET invalid_at = ?1, expired_at = ?2, invalidated_by = ?3 \
         WHERE uuid = ?4 AND invalid_at IS NULL",
    )
    .bind(new_valid_at)
    .bind(expired_at_now)
    .bind(new_uuid)
    .bind(stale_uuid)
    .execute(pool)
    .await
    .map_err(|e| format!("write_supersession({stale_uuid}): {e}"))?;
    Ok(())
}

/// Emit a substrate_edges row with edge_type = 'supersedes' from new -> stale.
/// Idempotent: ON CONFLICT does nothing if (source, target, edge_type) already present.
pub async fn write_supersedes_edge(
    pool: &SqlitePool,
    new_uuid: &str,
    stale_uuid: &str,
) -> Result<(), String> {
    let edge_id = format!("supersedes-{new_uuid}->{stale_uuid}");
    sqlx::query(
        "INSERT OR IGNORE INTO substrate_edges (id, source_uuid, target_uuid, edge_type) \
         VALUES (?1, ?2, ?3, 'supersedes')",
    )
    .bind(&edge_id)
    .bind(new_uuid)
    .bind(stale_uuid)
    .execute(pool)
    .await
    .map_err(|e| format!("write_supersedes_edge: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Set up an in-memory SQLite with the substrate schema needed for these
    /// tests. Mirrors the relevant subset of Phase 11 v6 + Phase 12 v7.
    async fn fresh_pool() -> SqlitePool {
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        sqlx::query(
            r#"
            CREATE TABLE substrate_nodes (
              uuid TEXT PRIMARY KEY,
              node_type TEXT NOT NULL,
              text TEXT NOT NULL,
              scope TEXT,
              applies_when TEXT,
              valid_at TEXT NOT NULL,
              invalid_at TEXT,
              expired_at TEXT,
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              invalidated_by TEXT,
              intent_drift_state TEXT,
              intent_drift_confidence REAL,
              intent_drift_reasoning TEXT,
              intent_drift_judged_at TEXT,
              intent_drift_judged_against TEXT
            );
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"
            CREATE TABLE substrate_edges (
              id TEXT PRIMARY KEY,
              source_uuid TEXT NOT NULL,
              target_uuid TEXT NOT NULL,
              edge_type TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[tokio::test]
    async fn write_supersession_sets_all_three_fields() {
        let pool = fresh_pool().await;
        sqlx::query("INSERT INTO substrate_nodes (uuid, node_type, text, valid_at) VALUES ('stale', 'constraint', 'old', '2025-01-01T00:00:00Z')")
            .execute(&pool).await.unwrap();
        write_supersession(
            &pool,
            "stale",
            "2026-04-24T00:00:00Z",
            "2026-04-24T12:00:00Z",
            "new",
        )
        .await
        .unwrap();
        let row: (String, String, String) = sqlx::query_as(
            "SELECT invalid_at, expired_at, invalidated_by FROM substrate_nodes WHERE uuid='stale'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row.0, "2026-04-24T00:00:00Z");
        assert_eq!(row.1, "2026-04-24T12:00:00Z");
        assert_eq!(row.2, "new");
    }

    #[tokio::test]
    async fn write_supersession_idempotent_on_already_invalidated() {
        let pool = fresh_pool().await;
        sqlx::query("INSERT INTO substrate_nodes (uuid, node_type, text, valid_at, invalid_at) VALUES ('stale', 'constraint', 'old', '2025-01-01T00:00:00Z', '2025-12-01T00:00:00Z')")
            .execute(&pool).await.unwrap();
        write_supersession(
            &pool,
            "stale",
            "2026-04-24T00:00:00Z",
            "2026-04-24T12:00:00Z",
            "new",
        )
        .await
        .unwrap();
        // Already invalidated; the WHERE invalid_at IS NULL guard makes this a no-op.
        let row: (String, String) = sqlx::query_as(
            "SELECT invalid_at, COALESCE(invalidated_by, '') FROM substrate_nodes WHERE uuid='stale'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row.0, "2025-12-01T00:00:00Z"); // unchanged
        assert_eq!(row.1, ""); // unchanged
    }

    #[tokio::test]
    async fn write_supersedes_edge_idempotent() {
        let pool = fresh_pool().await;
        // Insert two stub nodes (FK-friendly even though FK not enforced here)
        sqlx::query("INSERT INTO substrate_nodes (uuid, node_type, text, valid_at) VALUES ('new', 'constraint', 't', '2026-04-24T00:00:00Z')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO substrate_nodes (uuid, node_type, text, valid_at) VALUES ('stale', 'constraint', 't', '2025-01-01T00:00:00Z')")
            .execute(&pool).await.unwrap();
        write_supersedes_edge(&pool, "new", "stale").await.unwrap();
        write_supersedes_edge(&pool, "new", "stale").await.unwrap(); // 2nd call is a no-op
        let count: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM substrate_edges WHERE source_uuid='new' AND target_uuid='stale' AND edge_type='supersedes'"
        ).fetch_one(&pool).await.unwrap();
        assert_eq!(count.0, 1);
    }

    #[tokio::test]
    async fn fetch_current_substrate_nodes_filters_invalidated() {
        let pool = fresh_pool().await;
        sqlx::query("INSERT INTO substrate_nodes (uuid, node_type, text, valid_at) VALUES ('a', 'constraint', 'current', '2026-04-24T00:00:00Z')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO substrate_nodes (uuid, node_type, text, valid_at, invalid_at) VALUES ('b', 'constraint', 'invalidated', '2025-01-01T00:00:00Z', '2025-06-01T00:00:00Z')")
            .execute(&pool).await.unwrap();
        let rows = fetch_current_substrate_nodes(&pool, None, 10).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].uuid, "a");
    }

    #[tokio::test]
    async fn fetch_current_substrate_nodes_filters_by_node_type() {
        let pool = fresh_pool().await;
        sqlx::query("INSERT INTO substrate_nodes (uuid, node_type, text, valid_at) VALUES ('a', 'constraint', 'c', '2026-04-24T00:00:00Z')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO substrate_nodes (uuid, node_type, text, valid_at) VALUES ('b', 'decision', 'd', '2026-04-24T00:00:00Z')")
            .execute(&pool).await.unwrap();
        let rows = fetch_current_substrate_nodes(&pool, Some("constraint"), 10)
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].uuid, "a");
    }

    #[tokio::test]
    async fn fetch_substrate_history_returns_chain_ordered_by_valid_at_asc() {
        let pool = fresh_pool().await;
        // Three-link chain: oldest -> mid -> new
        sqlx::query("INSERT INTO substrate_nodes (uuid, node_type, text, valid_at, invalid_at, invalidated_by) VALUES ('oldest', 'constraint', 'v1', '2025-01-01T00:00:00Z', '2025-06-01T00:00:00Z', 'mid')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO substrate_nodes (uuid, node_type, text, valid_at, invalid_at, invalidated_by) VALUES ('mid', 'constraint', 'v2', '2025-06-01T00:00:00Z', '2026-01-01T00:00:00Z', 'newest')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO substrate_nodes (uuid, node_type, text, valid_at) VALUES ('newest', 'constraint', 'v3', '2026-01-01T00:00:00Z')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO substrate_edges (id, source_uuid, target_uuid, edge_type) VALUES ('e1', 'mid', 'oldest', 'supersedes')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO substrate_edges (id, source_uuid, target_uuid, edge_type) VALUES ('e2', 'newest', 'mid', 'supersedes')")
            .execute(&pool).await.unwrap();

        let rows = fetch_substrate_history(&pool, "mid").await.unwrap();
        assert!(rows.len() >= 2);
        // valid_at ASC ordering — verify oldest comes first
        for w in rows.windows(2) {
            assert!(w[0].valid_at <= w[1].valid_at);
        }
    }

    #[tokio::test]
    async fn read_substrate_node_returns_err_on_missing() {
        let pool = fresh_pool().await;
        let r = read_substrate_node(&pool, "does-not-exist").await;
        assert!(r.is_err());
    }
}
