// Graph-derived data: edges, lens projections, ghost refs.
//
// rebuild_ghost_refs MUST be idempotent — wrap in BEGIN/DELETE WHERE
// is_canonical=0/INSERT/COMMIT (RESEARCH §Pitfall 5). Calling it twice
// in a row produces the same SELECT COUNT(*) WHERE is_canonical=0.

use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool};

#[derive(Debug, Serialize, Deserialize)]
pub struct GraphEdge {
    pub id: String,
    pub source_uuid: String,
    pub target_uuid: String,
    pub edge_type: String,
}

#[tauri::command]
pub async fn get_edges(
    app: tauri::AppHandle,
    level: Option<String>,
    parent_uuid: Option<String>,
) -> Result<Vec<GraphEdge>, String> {
    let instances = app.state::<DbInstances>();
    let db_map = instances.0.read().await;
    let db = db_map.get("sqlite:contract-ide.db").ok_or("DB not loaded")?;
    let pool = match db {
        DbPool::Sqlite(p) => p,
        #[allow(unreachable_patterns)]
        _ => return Err("only sqlite supported".to_string()),
    };

    // Constrain to edges whose source AND target both match the level/parent
    // filter — keeps cross-level visual artifacts out (RESEARCH §Pitfall 10).
    let rows = sqlx::query(
        r#"
        SELECT e.id, e.source_uuid, e.target_uuid, e.edge_type
        FROM edges e
        JOIN nodes ns ON ns.uuid = e.source_uuid
        JOIN nodes nt ON nt.uuid = e.target_uuid
        WHERE (?1 IS NULL OR (ns.level = ?1 AND nt.level = ?1))
          AND (?2 IS NULL OR (ns.parent_uuid = ?2 AND nt.parent_uuid = ?2))
        "#,
    )
    .bind(level)
    .bind(parent_uuid)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        out.push(GraphEdge {
            id: r.try_get("id").map_err(|e| e.to_string())?,
            source_uuid: r.try_get("source_uuid").map_err(|e| e.to_string())?,
            target_uuid: r.try_get("target_uuid").map_err(|e| e.to_string())?,
            edge_type: r.try_get("edge_type").map_err(|e| e.to_string())?,
        });
    }
    Ok(out)
}

// Lens projection. journey: filter by node_flows.flow_uuid. system/ownership:
// placeholder — return all nodes (Phase 3 ships these as "selectable without
// crashing" per ROADMAP success criterion 5; v2 builds real projections).
//
// IMPORTANT: flow_uuid here is an L1 flow UUID — node_flows.flow_uuid only
// holds L1 UUIDs (per scanner.rs:191-218). The TS caller is responsible for
// resolving the current parent stack to its L1 ancestor before invoking; if
// the user is at L0 (root), the TS caller should call get_nodes() instead
// (Plan 03-02 Task 2 implements this branch in graphStore.refreshNodes).
#[tauri::command]
pub async fn get_lens_nodes(
    app: tauri::AppHandle,
    lens: String,
    flow_uuid: Option<String>,
) -> Result<Vec<crate::commands::nodes::ContractNode>, String> {
    let instances = app.state::<DbInstances>();
    let db_map = instances.0.read().await;
    let db = db_map.get("sqlite:contract-ide.db").ok_or("DB not loaded")?;
    let pool = match db {
        DbPool::Sqlite(p) => p,
        #[allow(unreachable_patterns)]
        _ => return Err("only sqlite supported".to_string()),
    };

    let rows = match (lens.as_str(), flow_uuid.as_deref()) {
        ("journey", Some(flow)) => {
            sqlx::query(
                r#"
                SELECT n.uuid, n.level, n.name, n.kind, n.code_ranges, n.parent_uuid,
                       n.is_canonical, n.code_hash, n.contract_hash, n.human_pinned,
                       n.route, n.derived_at, n.contract_body, n.tags,
                       COALESCE(n.rollup_generation, 0) AS rollup_generation,
                       n.members_json
                FROM nodes n
                JOIN node_flows nf ON nf.node_uuid = n.uuid
                WHERE nf.flow_uuid = ?1
                ORDER BY CASE n.level WHEN 'L0' THEN 0 WHEN 'L1' THEN 1
                         WHEN 'L2' THEN 2 WHEN 'L3' THEN 3 WHEN 'L4' THEN 4 END
                "#,
            )
            .bind(flow)
            .fetch_all(pool)
            .await
        }
        // journey w/o flow_uuid OR system/ownership lenses → return all nodes,
        // sorted by level (parents before children, RESEARCH §Pitfall 3).
        _ => {
            sqlx::query(
                r#"
                SELECT uuid, level, name, kind, code_ranges, parent_uuid,
                       is_canonical, code_hash, contract_hash, human_pinned,
                       route, derived_at, contract_body, tags,
                       COALESCE(rollup_generation, 0) AS rollup_generation,
                       members_json
                FROM nodes
                ORDER BY CASE level WHEN 'L0' THEN 0 WHEN 'L1' THEN 1
                         WHEN 'L2' THEN 2 WHEN 'L3' THEN 3 WHEN 'L4' THEN 4 END
                "#,
            )
            .fetch_all(pool)
            .await
        }
    }
    .map_err(|e| e.to_string())?;

    crate::commands::nodes::hydrate_node_rows(rows).map_err(|e| e.to_string())
}

// DATA-05: derive ghost-reference rows from node_flows membership. A node
// belonging to >1 flow gets a "ghost" row per non-primary flow. Primary flow
// = lex-min flow_uuid (deterministic, no schema change — see RESEARCH §Open
// Question 2). Ghost UUID convention: 'ghost-{canonical}-{flow}' (deterministic
// PK so re-runs hit ON CONFLICT cleanly even if the DELETE step is skipped).
//
// CRITICAL: ghost.parent_uuid = nf.flow_uuid (the L1 anchor of the ADDITIONAL
// flow this ghost represents) — NOT n.parent_uuid (which would be the
// canonical's home L1 → ghosts would render as duplicates under the SAME
// parent, defeating GRAPH-04's "appears in multiple flows" demo story).
//
// node_flows.flow_uuid is always an L1 UUID per scanner.rs:191-218 (populated
// from ContractFrontmatter.parent OR .route, both L1 anchors).
//
// Idempotency: wrapped in a transaction with DELETE WHERE is_canonical=0 first.
// Calling rebuild_ghost_refs() twice in a row MUST produce the same row count.
#[tauri::command]
pub async fn rebuild_ghost_refs(app: tauri::AppHandle) -> Result<u32, String> {
    let instances = app.state::<DbInstances>();
    let db_map = instances.0.read().await;
    let db = db_map.get("sqlite:contract-ide.db").ok_or("DB not loaded")?;
    let pool = match db {
        DbPool::Sqlite(p) => p,
        #[allow(unreachable_patterns)]
        _ => return Err("only sqlite supported".to_string()),
    };

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    sqlx::query("DELETE FROM nodes WHERE is_canonical = 0")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    // For each (node, flow) pair where node belongs to >1 flow AND this flow
    // is NOT the primary (lex-min) flow, insert a ghost row whose parent_uuid
    // is the ADDITIONAL flow's L1 anchor (nf.flow_uuid), NOT the canonical's
    // parent_uuid. This is what makes the ghost render under a DIFFERENT L1
    // parent box than the canonical — visually telling the user "this same
    // component also lives in <other flow>."
    let result = sqlx::query(
        r#"
        INSERT INTO nodes (uuid, level, name, kind, code_ranges, parent_uuid,
                           is_canonical, canonical_uuid, code_hash, contract_hash,
                           human_pinned, route, derived_at, contract_body, tags)
        SELECT
            'ghost-' || nf.node_uuid || '-' || nf.flow_uuid,
            n.level, n.name, n.kind, n.code_ranges,
            nf.flow_uuid,                       -- ghost.parent_uuid = additional L1 anchor
            0, n.uuid, n.code_hash, n.contract_hash,
            n.human_pinned, n.route, n.derived_at, n.contract_body, n.tags
        FROM node_flows nf
        JOIN nodes n ON n.uuid = nf.node_uuid AND n.is_canonical = 1
        WHERE nf.node_uuid IN (
            SELECT node_uuid FROM node_flows GROUP BY node_uuid HAVING COUNT(*) > 1
        )
        AND nf.flow_uuid != (
            SELECT MIN(flow_uuid) FROM node_flows WHERE node_uuid = nf.node_uuid
        )
        "#,
    )
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;

    // SANITY CHECK (development assertion): for any ghost row, its parent_uuid
    // must differ from the canonical's parent_uuid for at least one (canonical,
    // ghost) pair when multi-flow nodes exist. If this assert fails, the
    // INSERT above regressed (someone "fixed" nf.flow_uuid back to n.parent_uuid).
    // Logged as a warning rather than panicking so non-multi-flow repos don't
    // false-fire.
    let sanity = sqlx::query(
        r#"
        SELECT COUNT(*) AS bad
        FROM nodes ghost
        JOIN nodes canon ON canon.uuid = ghost.canonical_uuid
        WHERE ghost.is_canonical = 0
          AND ghost.parent_uuid = canon.parent_uuid
        "#,
    )
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    let bad: i64 = sanity.try_get("bad").unwrap_or(0);
    if bad > 0 {
        eprintln!(
            "[rebuild_ghost_refs] WARNING: {} ghost rows share parent_uuid with their canonical \
             — ghost.parent_uuid should be the additional flow's L1 anchor (nf.flow_uuid), not \
             n.parent_uuid. See plan 03-02 Task 1.",
            bad
        );
    }

    Ok(result.rows_affected() as u32)
}
