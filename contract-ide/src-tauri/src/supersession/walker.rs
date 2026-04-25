//! Reverse rollup walker: from an L0 contract uuid, find every transitively
//! rollup-linked descendant SUBSTRATE NODE (decision or constraint).
//!
//! Reuses Phase 8 PROP-02's `nodes.rollup_inputs` JSON column shipped in
//! plan 08-01 + 08-02. Same DAG, traversed DOWN through children whose
//! `rollup_inputs` cite this contract.
//!
//! Substrate nodes anchor to contracts via `derived-from-contract` edges in
//! `substrate_edges` (Phase 11 will populate; we walk that join in v1).
//!
//! Bounded: depth ≤ 5 (L0→L1→L2→L3→L4→atom). Phase 12 v1 stops at
//! depth-1 from priority shift — no transitive drift through
//! already-flagged decisions (v2.5 per evaluation.md failure mode 3).

use crate::supersession::types::{DescendantNode, SubstrateNode};
use sqlx::SqlitePool;
use std::collections::HashSet;

/// Walk descendant substrate nodes anchored to contracts in the subtree
/// rooted at `root_l0_uuid`. Returns at most one DescendantNode per uuid
/// (de-duped). depth recorded for diagnostics; v1 does NOT use depth to
/// gate verdict-propagation beyond the bound check.
pub async fn walk_rollup_descendants(
    pool: &SqlitePool,
    root_l0_uuid: &str,
    max_depth: u32,
) -> Result<Vec<DescendantNode>, String> {
    // Phase 1: BFS over the contract DAG, finding every descendant contract
    // whose rollup_inputs cite a contract in the visited set.
    // The `nodes.rollup_inputs` column shipped in 08-01 is JSON: a list of
    // {child_uuid, sections}. CHILDREN cite the upstream nodes whose
    // sections they ROLL UP FROM. So to walk DOWN from `root_l0_uuid`, we
    // find nodes whose rollup_inputs JSON references the root, recursively.
    //
    // For v1 simplicity, we approximate "rollup_inputs cites X" via the
    // contract DAG's parent_uuid + manual rollup_inputs scan. Two-phase:
    // (a) walk parent_uuid downward (every L1 with parent=root_l0, every
    //     L2 with parent in L1-set, etc.) — captures direct hierarchy
    // (b) ALSO scan rollup_inputs JSON for cross-tree citations — captures
    //     non-strictly-hierarchical rollups
    //
    // Frontier-style BFS, bounded by max_depth.
    let mut frontier: HashSet<String> = HashSet::new();
    frontier.insert(root_l0_uuid.to_string());

    let mut all_contracts: HashSet<String> = HashSet::new();
    all_contracts.insert(root_l0_uuid.to_string());

    let mut depth_map: std::collections::HashMap<String, u32> =
        std::collections::HashMap::new();
    depth_map.insert(root_l0_uuid.to_string(), 0);

    for current_depth in 1..=max_depth {
        if frontier.is_empty() {
            break;
        }
        // Find direct children via parent_uuid.
        let frontier_vec: Vec<String> = frontier.iter().cloned().collect();
        let placeholders = (1..=frontier_vec.len())
            .map(|i| format!("?{i}"))
            .collect::<Vec<_>>()
            .join(",");
        let parent_q = format!(
            "SELECT uuid FROM nodes WHERE parent_uuid IN ({placeholders})"
        );
        let mut q = sqlx::query_as::<_, (String,)>(&parent_q);
        for u in &frontier_vec {
            q = q.bind(u);
        }
        let direct_children: Vec<String> = q
            .fetch_all(pool)
            .await
            .map_err(|e| format!("walker parent query at depth {current_depth}: {e}"))?
            .into_iter()
            .map(|(u,)| u)
            .collect();

        // Find rollup_inputs citations: any node whose rollup_inputs JSON
        // references any frontier uuid as child_uuid. v1: simple LIKE scan
        // (set is small at hackathon scale; v2 may want a parsed-JSON
        // index). The JSON we look for has the form:
        //   [{"child_uuid":"<uuid>","sections":[...]}, ...]
        // so a literal JSON string match is sufficient for v1.
        let mut citation_children: Vec<String> = vec![];
        for u in &frontier_vec {
            // JSON-string match — scope is narrow at hackathon scale.
            let pattern = format!(r#"%"child_uuid":"{u}"%"#);
            let rows: Vec<(String,)> = sqlx::query_as(
                "SELECT uuid FROM nodes WHERE rollup_inputs_json LIKE ?1",
            )
            .bind(&pattern)
            .fetch_all(pool)
            .await
            .map_err(|e| format!("walker rollup_inputs_json scan: {e}"))?;
            citation_children.extend(rows.into_iter().map(|(u,)| u));
        }

        // Merge new frontier.
        let mut next_frontier: HashSet<String> = HashSet::new();
        for child in direct_children.iter().chain(citation_children.iter()) {
            if all_contracts.insert(child.clone()) {
                next_frontier.insert(child.clone());
                depth_map.insert(child.clone(), current_depth);
            }
        }
        frontier = next_frontier;
    }

    // Phase 2: for every contract in `all_contracts`, look up substrate
    // nodes anchored via `derived-from-contract` edges. Anchor records
    // are written by Phase 11 distiller; in v1 the table is empty until
    // Phase 11 ships, so the walker returns [] until then. 12-04
    // adversarial harness will seed test data directly.
    let contracts_vec: Vec<String> = all_contracts.iter().cloned().collect();
    if contracts_vec.is_empty() {
        return Ok(vec![]);
    }
    let placeholders = (1..=contracts_vec.len())
        .map(|i| format!("?{i}"))
        .collect::<Vec<_>>()
        .join(",");
    let q_text = format!(
        r#"
        SELECT s.uuid, s.node_type, s.text, s.scope, s.applies_when,
               s.valid_at, s.invalid_at, s.expired_at, s.invalidated_by,
               e.target_uuid AS anchor
        FROM substrate_nodes s
        JOIN substrate_edges e ON e.source_uuid = s.uuid
        WHERE e.edge_type = 'derived-from-contract'
          AND e.target_uuid IN ({placeholders})
          AND s.invalid_at IS NULL
          AND (s.node_type = 'decision' OR s.node_type = 'constraint')
        "#
    );
    let mut q = sqlx::query::<sqlx::Sqlite>(&q_text);
    for c in &contracts_vec {
        q = q.bind(c);
    }
    let rows = q
        .fetch_all(pool)
        .await
        .map_err(|e| format!("walker substrate-anchor join: {e}"))?;

    let mut out = vec![];
    let mut seen: HashSet<String> = HashSet::new();
    for r in rows {
        use sqlx::Row;
        let uuid: String = r.try_get("uuid").map_err(|e| e.to_string())?;
        if !seen.insert(uuid.clone()) {
            continue; // de-dup: a substrate node anchored to multiple contracts in subtree judged once
        }
        let node = SubstrateNode {
            uuid: uuid.clone(),
            node_type: r.try_get("node_type").map_err(|e| e.to_string())?,
            text: r.try_get("text").map_err(|e| e.to_string())?,
            scope: r.try_get("scope").map_err(|e| e.to_string())?,
            applies_when: r.try_get("applies_when").map_err(|e| e.to_string())?,
            valid_at: r.try_get("valid_at").map_err(|e| e.to_string())?,
            invalid_at: r.try_get("invalid_at").map_err(|e| e.to_string())?,
            expired_at: r.try_get("expired_at").map_err(|e| e.to_string())?,
            invalidated_by: r.try_get("invalidated_by").map_err(|e| e.to_string())?,
        };
        let anchor: String = r.try_get("anchor").map_err(|e| e.to_string())?;
        let depth = depth_map.get(&anchor).copied().unwrap_or(0);
        out.push(DescendantNode {
            node,
            anchor_contract_uuid: anchor,
            depth,
        });
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::SqlitePool;

    async fn fresh_pool() -> SqlitePool {
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        sqlx::query(
            "CREATE TABLE nodes (
               uuid TEXT PRIMARY KEY,
               level TEXT,
               parent_uuid TEXT,
               rollup_inputs_json TEXT
             );",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE substrate_nodes (
               uuid TEXT PRIMARY KEY,
               node_type TEXT NOT NULL,
               text TEXT NOT NULL,
               scope TEXT,
               applies_when TEXT,
               valid_at TEXT NOT NULL,
               invalid_at TEXT,
               expired_at TEXT,
               created_at TEXT NOT NULL DEFAULT (datetime('now')),
               invalidated_by TEXT
             );",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE substrate_edges (
               id TEXT PRIMARY KEY,
               source_uuid TEXT NOT NULL,
               target_uuid TEXT NOT NULL,
               edge_type TEXT NOT NULL
             );",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[tokio::test]
    async fn walker_returns_empty_when_no_descendants() {
        let pool = fresh_pool().await;
        sqlx::query("INSERT INTO nodes (uuid, level) VALUES ('l0', 'L0')")
            .execute(&pool)
            .await
            .unwrap();
        let result = walk_rollup_descendants(&pool, "l0", 5).await.unwrap();
        assert_eq!(result.len(), 0);
    }

    #[tokio::test]
    async fn walker_finds_substrate_via_parent_chain() {
        let pool = fresh_pool().await;
        sqlx::query("INSERT INTO nodes (uuid, level, parent_uuid) VALUES ('l0', 'L0', NULL)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO nodes (uuid, level, parent_uuid) VALUES ('l1', 'L1', 'l0')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO nodes (uuid, level, parent_uuid) VALUES ('l2', 'L2', 'l1')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO substrate_nodes (uuid, node_type, text, valid_at) VALUES ('s1', 'decision', 'd1', '2026-01-01T00:00:00Z')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO substrate_nodes (uuid, node_type, text, valid_at) VALUES ('s2', 'constraint', 'c1', '2026-01-01T00:00:00Z')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO substrate_edges (id, source_uuid, target_uuid, edge_type) VALUES ('e1', 's1', 'l1', 'derived-from-contract')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO substrate_edges (id, source_uuid, target_uuid, edge_type) VALUES ('e2', 's2', 'l2', 'derived-from-contract')")
            .execute(&pool)
            .await
            .unwrap();
        let result = walk_rollup_descendants(&pool, "l0", 5).await.unwrap();
        assert_eq!(result.len(), 2);
        assert!(result.iter().any(|d| d.node.uuid == "s1"));
        assert!(result.iter().any(|d| d.node.uuid == "s2"));
    }

    #[tokio::test]
    async fn walker_respects_max_depth() {
        let pool = fresh_pool().await;
        sqlx::query("INSERT INTO nodes (uuid, level, parent_uuid) VALUES ('l0', 'L0', NULL)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO nodes (uuid, level, parent_uuid) VALUES ('l1', 'L1', 'l0')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO nodes (uuid, level, parent_uuid) VALUES ('l2', 'L2', 'l1')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO nodes (uuid, level, parent_uuid) VALUES ('l3', 'L3', 'l2')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO substrate_nodes (uuid, node_type, text, valid_at) VALUES ('deep', 'decision', 'd', '2026-01-01T00:00:00Z')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO substrate_edges (id, source_uuid, target_uuid, edge_type) VALUES ('ed', 'deep', 'l3', 'derived-from-contract')")
            .execute(&pool)
            .await
            .unwrap();
        // Max depth 2: walker reaches l0->l1->l2 but not l3, so substrate at l3 not found.
        let result = walk_rollup_descendants(&pool, "l0", 2).await.unwrap();
        assert_eq!(result.len(), 0);
        // Max depth 3: reaches l3, finds 'deep'.
        let result = walk_rollup_descendants(&pool, "l0", 3).await.unwrap();
        assert_eq!(result.len(), 1);
    }

    #[tokio::test]
    async fn walker_skips_invalidated_substrate_nodes() {
        let pool = fresh_pool().await;
        sqlx::query("INSERT INTO nodes (uuid, level, parent_uuid) VALUES ('l0', 'L0', NULL)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO nodes (uuid, level, parent_uuid) VALUES ('l1', 'L1', 'l0')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO substrate_nodes (uuid, node_type, text, valid_at, invalid_at) VALUES ('s_active', 'decision', 'a', '2026-01-01T00:00:00Z', NULL)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO substrate_nodes (uuid, node_type, text, valid_at, invalid_at) VALUES ('s_dead', 'decision', 'd', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO substrate_edges (id, source_uuid, target_uuid, edge_type) VALUES ('e1', 's_active', 'l1', 'derived-from-contract')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO substrate_edges (id, source_uuid, target_uuid, edge_type) VALUES ('e2', 's_dead', 'l1', 'derived-from-contract')")
            .execute(&pool)
            .await
            .unwrap();
        let result = walk_rollup_descendants(&pool, "l0", 5).await.unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].node.uuid, "s_active");
    }
}
