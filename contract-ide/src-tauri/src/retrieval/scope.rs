use sqlx::SqlitePool;

/// Walk parent_uuid edges from `scope_uuid` UP TO L0 + collect siblings (same parent).
/// EXCLUDES cousins per CONTEXT lock.
///
/// Lineage set = scope_uuid itself + its parent + all ancestors up to L0
///             + siblings (children of the target's direct parent).
///
/// Cousins (children of ancestors other than the direct parent) are NEVER included.
/// The returned uuid set is used as a HARD JOIN FILTER in candidates.rs:
/// `json_each(substrate_nodes.anchored_uuids) WHERE je.value IN (lineage_uuids)`.
///
/// Including `scope_uuid` itself ensures substrate nodes anchored directly to the
/// target atom are returned by the candidate-selection JOIN.
pub async fn lineage_scope_uuids(
    pool: &SqlitePool,
    scope_uuid: &str,
) -> Result<Vec<String>, String> {
    // Two parts:
    // 1. ancestors — recursive walk via parent_uuid, starting at scope_uuid (includes itself).
    //    Terminates when parent_uuid IS NULL (L0 root).
    // 2. siblings — children of the target's parent_uuid (includes the target itself).
    //    UNION (dedup) of the two sets gives the full lineage.
    //
    // Cousin exclusion is implicit: the siblings clause only joins on
    // `s.parent_uuid = target.parent_uuid`, never on `ancestor.uuid`. Children of
    // other ancestors (cousins) never enter the result set.
    let rows: Vec<(String,)> = sqlx::query_as(
        r#"
        WITH RECURSIVE ancestors(uuid, parent_uuid) AS (
            SELECT uuid, parent_uuid FROM nodes WHERE uuid = ?1
            UNION ALL
            SELECT n.uuid, n.parent_uuid
            FROM nodes n
            JOIN ancestors a ON n.uuid = a.parent_uuid
            WHERE a.parent_uuid IS NOT NULL
        )
        SELECT uuid FROM ancestors
        UNION
        SELECT s.uuid
        FROM nodes s
        JOIN nodes target ON target.uuid = ?1
        WHERE s.parent_uuid IS NOT NULL
          AND s.parent_uuid = target.parent_uuid
        "#,
    )
    .bind(scope_uuid)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("lineage walk: {e}"))?;

    Ok(rows.into_iter().map(|r| r.0).collect())
}
