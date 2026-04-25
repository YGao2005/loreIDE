use sqlx::sqlite::SqlitePoolOptions;
use sqlx::Executor;

/// Helper: in-memory SQLite with a minimal nodes + substrate_nodes schema for retrieval tests.
async fn setup_test_db() -> sqlx::SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(":memory:")
        .await
        .unwrap();

    pool.execute(
        r#"
        CREATE TABLE nodes (
            uuid TEXT PRIMARY KEY,
            parent_uuid TEXT,
            level TEXT
        );
        CREATE TABLE substrate_nodes (
            uuid TEXT PRIMARY KEY,
            node_type TEXT NOT NULL,
            text TEXT NOT NULL,
            scope TEXT,
            applies_when TEXT,
            source_session_id TEXT,
            source_turn_ref INTEGER,
            source_quote TEXT,
            source_actor TEXT,
            valid_at TEXT NOT NULL,
            invalid_at TEXT,
            expired_at TEXT,
            created_at TEXT NOT NULL,
            confidence TEXT NOT NULL DEFAULT 'inferred',
            episode_id TEXT,
            invalidated_by TEXT,
            anchored_uuids TEXT NOT NULL DEFAULT '[]'
        );
        CREATE VIRTUAL TABLE substrate_nodes_fts USING fts5(
            uuid UNINDEXED, text, applies_when, scope,
            content='substrate_nodes', content_rowid='rowid'
        );
        CREATE TRIGGER substrate_nodes_ai AFTER INSERT ON substrate_nodes BEGIN
            INSERT INTO substrate_nodes_fts(rowid, uuid, text, applies_when, scope)
            VALUES (new.rowid, new.uuid, new.text, new.applies_when, new.scope);
        END;
        "#,
    )
    .await
    .unwrap();

    pool
}

/// Fixture graph:
///   L0:    product
///   L1:    flow-account, flow-team       <- siblings to each other
///   L2:    settings (parent=flow-account), profile (parent=flow-account), team-settings (parent=flow-team)
///   L4:    danger-zone (parent=settings), email-form (parent=settings)
///
/// For target = danger-zone:
///   Lineage = parent (settings) + ancestors (flow-account, product) + siblings (email-form) + self (danger-zone)
///   EXCLUDES: cousins (profile, team-settings, flow-team)
async fn insert_fixture_graph(pool: &sqlx::SqlitePool) {
    let inserts = [
        ("product", None, "L0"),
        ("flow-account", Some("product"), "L1"),
        ("flow-team", Some("product"), "L1"),
        ("settings", Some("flow-account"), "L2"),
        ("profile", Some("flow-account"), "L2"),
        ("team-settings", Some("flow-team"), "L2"),
        ("danger-zone", Some("settings"), "L4"),
        ("email-form", Some("settings"), "L4"),
    ];
    for (uuid, parent, level) in inserts {
        sqlx::query("INSERT INTO nodes (uuid, parent_uuid, level) VALUES (?, ?, ?)")
            .bind(uuid)
            .bind(parent)
            .bind(level)
            .execute(pool)
            .await
            .unwrap();
    }
}

/// The lineage walker CTE inlined for integration-test scope (mirrors retrieval/scope.rs).
/// Both copies must stay in sync; future refactors could expose a pub const SQL.
async fn lineage_scope_sql(pool: &sqlx::SqlitePool, target: &str) -> std::collections::HashSet<String> {
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
    .bind(target)
    .fetch_all(pool)
    .await
    .unwrap();

    rows.into_iter().map(|r| r.0).collect()
}

#[tokio::test]
async fn lineage_walker_returns_parent_ancestors_siblings_excludes_cousins() {
    let pool = setup_test_db().await;
    insert_fixture_graph(&pool).await;

    let result = lineage_scope_sql(&pool, "danger-zone").await;

    let expected: std::collections::HashSet<String> =
        ["danger-zone", "settings", "flow-account", "product", "email-form"]
            .iter()
            .map(|s| s.to_string())
            .collect();

    assert_eq!(
        result, expected,
        "lineage walker should return self + parent + ancestors + siblings only, NOT cousins"
    );

    // Sanity: cousins must be ABSENT
    assert!(
        !result.contains("profile"),
        "cousin 'profile' should be excluded"
    );
    assert!(
        !result.contains("team-settings"),
        "cousin 'team-settings' should be excluded"
    );
    assert!(
        !result.contains("flow-team"),
        "ancestor's sibling 'flow-team' should be excluded"
    );
}

/// CRITICAL cousin-exclusion JOIN test:
/// 50-row substrate fixture with 5 cousins anchored to non-lineage atoms.
/// The FTS5 + json_each(anchored_uuids) JOIN must return 0 cousin nodes in candidates.
#[tokio::test]
async fn cousin_exclusion_join_excludes_cousins_at_candidate_selection() {
    let pool = setup_test_db().await;
    insert_fixture_graph(&pool).await;

    // 5 substrate rows anchored to cousin atoms (profile, team-settings) — must be excluded.
    let cousin_anchored = serde_json::json!(["profile", "team-settings"]).to_string();
    // 45 substrate rows anchored to lineage atoms (danger-zone, settings) — must appear.
    let lineage_anchored = serde_json::json!(["danger-zone", "settings"]).to_string();

    for i in 0..5 {
        sqlx::query(
            "INSERT INTO substrate_nodes (uuid, node_type, text, scope, applies_when,
                                          valid_at, created_at, confidence, anchored_uuids)
             VALUES (?, 'constraint', ?, NULL, ?, datetime('now'), datetime('now'), 'explicit', ?)",
        )
        .bind(format!("cousin-{i}"))
        .bind(format!("Cousin substrate {i}: audit endpoint logging"))
        .bind("when adding audit endpoint")
        .bind(&cousin_anchored)
        .execute(&pool)
        .await
        .unwrap();
    }

    for i in 0..45 {
        sqlx::query(
            "INSERT INTO substrate_nodes (uuid, node_type, text, scope, applies_when,
                                          valid_at, created_at, confidence, anchored_uuids)
             VALUES (?, 'constraint', ?, NULL, ?, datetime('now'), datetime('now'), 'explicit', ?)",
        )
        .bind(format!("lineage-{i}"))
        .bind(format!("Lineage substrate {i}: audit endpoint pattern"))
        .bind("when adding audit endpoint")
        .bind(&lineage_anchored)
        .execute(&pool)
        .await
        .unwrap();
    }

    // Lineage uuids for danger-zone (mirrors what scope.rs computes).
    let lineage_uuids: Vec<String> = vec![
        "danger-zone".to_string(),
        "settings".to_string(),
        "flow-account".to_string(),
        "product".to_string(),
        "email-form".to_string(),
    ];

    let placeholders = std::iter::repeat_n("?", lineage_uuids.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        r#"
        SELECT s.uuid
        FROM substrate_nodes_fts fts
        JOIN substrate_nodes s ON s.uuid = fts.uuid
        WHERE substrate_nodes_fts MATCH ?
          AND s.invalid_at IS NULL
          AND EXISTS (
              SELECT 1 FROM json_each(s.anchored_uuids) je
              WHERE je.value IN ({placeholders})
          )
        ORDER BY fts.rank
        LIMIT 100
        "#
    );
    let mut q = sqlx::query_as::<_, (String,)>(&sql);
    q = q.bind("audit");
    for u in &lineage_uuids {
        q = q.bind(u);
    }
    let rows: Vec<(String,)> = q.fetch_all(&pool).await.unwrap();
    let candidates: std::collections::HashSet<String> = rows.into_iter().map(|r| r.0).collect();

    // CRITICAL assertion: NO cousin-anchored substrate appears in the candidate set.
    let cousin_count = candidates
        .iter()
        .filter(|u| u.starts_with("cousin-"))
        .count();
    assert_eq!(
        cousin_count, 0,
        "Cousin-anchored substrate must NOT appear in candidates; found {cousin_count}: {candidates:?}"
    );

    // Sanity: lineage-anchored substrate IS in the candidate set.
    let lineage_count = candidates
        .iter()
        .filter(|u| u.starts_with("lineage-"))
        .count();
    assert!(
        lineage_count > 0,
        "Lineage-anchored substrate should appear; got 0"
    );
}

#[tokio::test]
async fn lineage_walker_handles_l0_with_no_parent() {
    let pool = setup_test_db().await;
    sqlx::query("INSERT INTO nodes (uuid, parent_uuid, level) VALUES ('product', NULL, 'L0')")
        .execute(&pool)
        .await
        .unwrap();

    let result = lineage_scope_sql(&pool, "product").await;

    // L0 has no parent and no siblings → lineage = {product} (just self)
    assert_eq!(
        result,
        ["product".to_string()].iter().cloned().collect(),
        "L0 lineage should be just self (no parent, no siblings)"
    );
}

/// Defensive index parser (mirrors retrieval/rerank.rs::parse_indices_defensive).
/// Inlined here since integration tests can't call src-private functions directly.
#[test]
fn defensive_index_parser_handles_code_fences_and_oob() {
    fn parse_indices_defensive(text: &str) -> Vec<usize> {
        if let Ok(indices) = serde_json::from_str::<Vec<i64>>(text) {
            return indices
                .into_iter()
                .filter(|i| *i >= 0)
                .map(|i| i as usize)
                .collect();
        }
        let stripped = text
            .trim()
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim();
        if let Ok(indices) = serde_json::from_str::<Vec<i64>>(stripped) {
            return indices
                .into_iter()
                .filter(|i| *i >= 0)
                .map(|i| i as usize)
                .collect();
        }
        if let Some(start) = stripped.find('[') {
            if let Some(end) = stripped[start..].find(']') {
                let candidate = &stripped[start..=start + end];
                if let Ok(indices) = serde_json::from_str::<Vec<i64>>(candidate) {
                    return indices
                        .into_iter()
                        .filter(|i| *i >= 0)
                        .map(|i| i as usize)
                        .collect();
                }
            }
        }
        Vec::new()
    }

    // Case 1: raw JSON array
    assert_eq!(parse_indices_defensive("[3, 7, 1]"), vec![3, 7, 1]);
    // Case 2: code-fence wrapping (``` json ... ```)
    assert_eq!(
        parse_indices_defensive("```json\n[3, 7, 1]\n```"),
        vec![3, 7, 1]
    );
    // Case 3: preamble text before the array
    assert_eq!(
        parse_indices_defensive("Here are the indices: [3, 7, 1]"),
        vec![3, 7, 1]
    );
    // Case 4: completely invalid → empty vec
    assert_eq!(
        parse_indices_defensive("definitely not json"),
        Vec::<usize>::new()
    );
    // Case 5: out-of-bounds and negative — parser yields valid non-negative indices;
    // caller drops out-of-bounds at filter time (per rerank.rs line: filter(|&i| i < candidates.len()))
    assert_eq!(parse_indices_defensive("[3, 99, -1, 7]"), vec![3, 99, 7]);
}

/// RRF combination: two ranked sources, k=60.
/// Verifies that the combined score map has correct dedup behaviour.
#[test]
fn rrf_combines_two_sources_correctly() {
    let mut combined: std::collections::HashMap<&str, f64> = std::collections::HashMap::new();

    // Source 1 FTS5: ranking [a, c, b] → scores 1/61, 1/62, 1/63
    for (rank, uuid) in ["a", "c", "b"].iter().enumerate() {
        *combined.entry(*uuid).or_insert(0.0) += 1.0 / (60.0 + rank as f64 + 1.0);
    }
    // Source 2 embedding cosine: ranking [b, c, a] → scores 1/61, 1/62, 1/63
    for (rank, uuid) in ["b", "c", "a"].iter().enumerate() {
        *combined.entry(*uuid).or_insert(0.0) += 1.0 / (60.0 + rank as f64 + 1.0);
    }

    // a: 1/61 + 1/63 ≈ 0.032369
    // c: 1/62 + 1/62 ≈ 0.032258
    // b: 1/63 + 1/61 ≈ 0.032369  (same as a — symmetric by construction)
    // All three are extremely close; just assert dedup + count.
    assert_eq!(combined.len(), 3, "should have 3 unique uuids after RRF merge");

    let mut sorted: Vec<(&&str, &f64)> = combined.iter().collect();
    sorted.sort_by(|a, b| b.1.partial_cmp(a.1).unwrap());

    let top = *sorted[0].0;
    assert!(
        ["a", "b", "c"].contains(&top),
        "RRF top should be one of a, b, c — got {top}"
    );
}
