//! Integration tests for Phase 15 Plan 04 — TRUST-03 delete path + impact preview.
//!
//! Proves four key invariants:
//!   (a) delete_writes_tombstone_and_audit_row — atomic tombstone: invalid_at set,
//!       invalidated_reason populated, audit row inserted, FTS no longer matches.
//!   (b) delete_on_tombstoned_row_returns_error — double-tombstone protection:
//!       calling delete on an already-tombstoned row returns clean Err.
//!   (c) delete_with_other_reason_requires_free_text — validation: Other reason_kind
//!       requires non-empty reason_text; success with non-empty text.
//!   (d) get_substrate_impact_counts_atoms_and_recent_receipts — impact preview:
//!       correct atom_count + recent_prompt_count; old receipts (>7 days) excluded.
//!
//! Pattern: same in-memory pool setup as migration_v8_chain_smoke.rs (Plan 15-01)
//! and substrate_trust_refine.rs (Plan 15-03). Tests replicate the SQL logic inline
//! since Tauri AppHandle is not available in integration test context.

use sqlx::{Executor, Row};
use sqlx::sqlite::SqlitePoolOptions;

// ─────────────────────────────────────────────────────────────────────────────
// Schema helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Materialise the v8 substrate schema (substrate_nodes + FTS + audit) in-memory.
async fn setup_v8_pool() -> sqlx::SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(":memory:")
        .await
        .unwrap();

    pool.execute(r#"
        CREATE TABLE substrate_nodes (
            uuid                      TEXT PRIMARY KEY,
            node_type                 TEXT NOT NULL CHECK(node_type IN ('constraint','decision','open_question','resolved_question','attempt')),
            text                      TEXT NOT NULL,
            scope                     TEXT,
            applies_when              TEXT,
            source_session_id         TEXT,
            source_turn_ref           INTEGER,
            source_quote              TEXT,
            source_actor              TEXT,
            valid_at                  TEXT NOT NULL,
            invalid_at                TEXT,
            expired_at                TEXT,
            created_at                TEXT NOT NULL DEFAULT (datetime('now')),
            confidence                TEXT NOT NULL DEFAULT 'inferred',
            episode_id                TEXT,
            invalidated_by            TEXT,
            anchored_uuids            TEXT NOT NULL DEFAULT '[]',
            intent_drift_state        TEXT,
            intent_drift_confidence   REAL,
            intent_drift_reasoning    TEXT,
            intent_drift_judged_at    TEXT,
            intent_drift_judged_against TEXT,
            prev_version_uuid         TEXT,
            invalidated_reason        TEXT
        );
    "#).await.unwrap();

    pool.execute(r#"
        CREATE VIRTUAL TABLE substrate_nodes_fts USING fts5(
            uuid UNINDEXED,
            text,
            applies_when,
            scope,
            content='substrate_nodes',
            content_rowid='rowid'
        );
    "#).await.unwrap();

    // AFTER INSERT trigger — indexes new row in FTS
    pool.execute(r#"
        CREATE TRIGGER substrate_nodes_ai AFTER INSERT ON substrate_nodes BEGIN
            INSERT INTO substrate_nodes_fts(rowid, uuid, text, applies_when, scope)
            VALUES (new.rowid, new.uuid, new.text, new.applies_when, new.scope);
        END;
    "#).await.unwrap();

    // AFTER UPDATE trigger — v8 replacement (FTS tombstone fix).
    // Removes old row from FTS; only re-inserts new row if invalid_at IS NULL.
    pool.execute(r#"
        CREATE TRIGGER substrate_nodes_au AFTER UPDATE ON substrate_nodes BEGIN
            INSERT INTO substrate_nodes_fts(substrate_nodes_fts, rowid, uuid, text, applies_when, scope)
            VALUES ('delete', old.rowid, old.uuid, old.text, old.applies_when, old.scope);
            INSERT INTO substrate_nodes_fts(rowid, uuid, text, applies_when, scope)
            SELECT new.rowid, new.uuid, new.text, new.applies_when, new.scope
            WHERE new.invalid_at IS NULL;
        END;
    "#).await.unwrap();

    // AFTER DELETE trigger
    pool.execute(r#"
        CREATE TRIGGER substrate_nodes_ad AFTER DELETE ON substrate_nodes BEGIN
            INSERT INTO substrate_nodes_fts(substrate_nodes_fts, rowid, uuid, text, applies_when, scope)
            VALUES ('delete', old.rowid, old.uuid, old.text, old.applies_when, old.scope);
        END;
    "#).await.unwrap();

    // substrate_edits audit table — v8
    pool.execute(r#"
        CREATE TABLE substrate_edits (
            edit_id           TEXT PRIMARY KEY,
            rule_uuid         TEXT NOT NULL,
            prev_version_uuid TEXT,
            new_version_uuid  TEXT,
            actor             TEXT NOT NULL,
            edited_at         TEXT NOT NULL,
            before_text       TEXT,
            after_text        TEXT,
            reason            TEXT NOT NULL,
            kind              TEXT NOT NULL CHECK(kind IN ('refine', 'delete', 'restore'))
        );
    "#).await.unwrap();

    pool
}

/// Materialise the v8 schema + nodes + receipts for impact preview tests.
async fn setup_impact_pool() -> sqlx::SqlitePool {
    let pool = setup_v8_pool().await;

    // nodes table — the graph atoms that anchored_uuids points to
    pool.execute(r#"
        CREATE TABLE nodes (
            uuid  TEXT PRIMARY KEY,
            name  TEXT,
            kind  TEXT,
            level INTEGER
        );
    "#).await.unwrap();

    // receipts table with substrate_rules_json column (from Plan 15-01 v8 migration)
    pool.execute(r#"
        CREATE TABLE receipts (
            id                   TEXT PRIMARY KEY,
            session_id           TEXT NOT NULL,
            transcript_path      TEXT NOT NULL DEFAULT '',
            started_at           TEXT,
            finished_at          TEXT,
            input_tokens         INTEGER,
            output_tokens        INTEGER,
            cache_read_tokens    INTEGER,
            tool_call_count      INTEGER,
            nodes_touched        TEXT,
            estimated_cost_usd   REAL,
            raw_summary          TEXT,
            created_at           TEXT NOT NULL DEFAULT (datetime('now')),
            substrate_rules_json TEXT
        );
    "#).await.unwrap();

    pool
}

/// Helper: insert a live substrate_nodes row.
async fn insert_substrate(pool: &sqlx::SqlitePool, uuid: &str, text: &str) {
    sqlx::query(
        "INSERT INTO substrate_nodes \
         (uuid, node_type, text, valid_at, anchored_uuids) \
         VALUES (?1, 'constraint', ?2, datetime('now'), '[]')"
    )
    .bind(uuid)
    .bind(text)
    .execute(pool)
    .await
    .unwrap();
}

/// Helper: insert a live substrate_nodes row with anchored_uuids JSON array.
async fn insert_substrate_with_anchors(pool: &sqlx::SqlitePool, uuid: &str, text: &str, anchored_uuids: &str) {
    sqlx::query(
        "INSERT INTO substrate_nodes \
         (uuid, node_type, text, valid_at, anchored_uuids) \
         VALUES (?1, 'constraint', ?2, datetime('now'), ?3)"
    )
    .bind(uuid)
    .bind(text)
    .bind(anchored_uuids)
    .execute(pool)
    .await
    .unwrap();
}

/// Helper: execute the delete transaction inline (mirrors delete_substrate_rule SQL).
/// Returns Ok(()) or Err(message).
async fn do_delete(
    pool: &sqlx::SqlitePool,
    uuid: &str,
    reason_kind: &str,
    reason_text: &str,
    actor: &str,
) -> Result<(), String> {
    // Validate reason_kind
    let allowed = ["Hallucinated", "Obsolete", "Wrong scope", "Duplicate", "Other"];
    if !allowed.contains(&reason_kind) {
        return Err(format!("invalid reason_kind '{reason_kind}'"));
    }

    // Validate Other requires non-empty free-text
    if reason_kind == "Other" && reason_text.trim().is_empty() {
        return Err("free-text required when reason is Other".to_string());
    }

    // Read old row
    let row = sqlx::query(
        "SELECT text FROM substrate_nodes WHERE uuid = ?1 AND invalid_at IS NULL"
    )
    .bind(uuid)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("fetch: {e}"))?;

    let Some(old_row) = row else {
        return Err(format!("rule {uuid} not found or already tombstoned"));
    };

    let old_text: String = old_row.try_get("text").unwrap();
    let now = chrono::Utc::now().to_rfc3339();
    let invalidated_reason = format!("{reason_kind}: {reason_text}");
    let edit_id = uuid::Uuid::new_v4().to_string();

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    sqlx::query(
        "UPDATE substrate_nodes \
         SET invalid_at = ?1, invalidated_reason = ?2, invalidated_by = ?3 \
         WHERE uuid = ?4 AND invalid_at IS NULL",
    )
    .bind(&now)
    .bind(&invalidated_reason)
    .bind(actor)
    .bind(uuid)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("UPDATE: {e}"))?;

    sqlx::query(
        r#"INSERT INTO substrate_edits
           (edit_id, rule_uuid, prev_version_uuid, new_version_uuid,
            actor, edited_at, before_text, after_text, reason, kind)
           VALUES (?1, ?2, NULL, NULL, ?3, ?4, ?5, NULL, ?6, 'delete')"#,
    )
    .bind(&edit_id)
    .bind(uuid)
    .bind(actor)
    .bind(&now)
    .bind(&old_text)
    .bind(&invalidated_reason)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("INSERT audit: {e}"))?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

/// (a) Delete writes tombstone + audit row in a single transaction; FTS no longer matches.
#[tokio::test]
async fn delete_writes_tombstone_and_audit_row() {
    let pool = setup_v8_pool().await;
    let rule_uuid = "rule-del-001";
    let rule_text = "Soft delete with grace period before permanent removal";
    let actor = "human:test";

    insert_substrate(&pool, rule_uuid, rule_text).await;

    // Verify FTS finds the rule before delete
    let pre_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM substrate_nodes_fts WHERE substrate_nodes_fts MATCH ?1"
    )
    .bind(format!("\"{}\"", "Soft delete with grace"))
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(pre_count, 1, "FTS should find rule before delete");

    // Execute delete
    let result = do_delete(&pool, rule_uuid, "Obsolete", "no longer applies to our scale", actor).await;
    assert!(result.is_ok(), "delete should succeed: {:?}", result);

    // Assert: substrate_nodes row is tombstoned
    let row = sqlx::query(
        "SELECT invalid_at, invalidated_reason, invalidated_by FROM substrate_nodes WHERE uuid = ?1"
    )
    .bind(rule_uuid)
    .fetch_one(&pool)
    .await
    .unwrap();

    let invalid_at: Option<String> = row.try_get("invalid_at").ok().flatten();
    assert!(invalid_at.is_some(), "invalid_at should be set after delete");

    let invalidated_reason: Option<String> = row.try_get("invalidated_reason").ok().flatten();
    assert_eq!(
        invalidated_reason.as_deref(),
        Some("Obsolete: no longer applies to our scale"),
        "invalidated_reason should be 'kind: text'"
    );

    let invalidated_by: Option<String> = row.try_get("invalidated_by").ok().flatten();
    assert_eq!(
        invalidated_by.as_deref(),
        Some("human:test"),
        "invalidated_by should be actor"
    );

    // Assert: 1 audit row in substrate_edits
    let audit_row = sqlx::query(
        "SELECT kind, before_text, after_text, reason, actor FROM substrate_edits WHERE rule_uuid = ?1"
    )
    .bind(rule_uuid)
    .fetch_one(&pool)
    .await
    .unwrap();

    let kind: String = audit_row.try_get("kind").unwrap();
    assert_eq!(kind, "delete");

    let before_text: Option<String> = audit_row.try_get("before_text").ok().flatten();
    assert_eq!(before_text.as_deref(), Some(rule_text), "before_text should be original text");

    let after_text: Option<String> = audit_row.try_get("after_text").ok().flatten();
    assert!(after_text.is_none(), "after_text should be NULL for delete");

    let audit_reason: String = audit_row.try_get("reason").unwrap();
    assert_eq!(audit_reason, "Obsolete: no longer applies to our scale");

    let audit_actor: String = audit_row.try_get("actor").unwrap();
    assert_eq!(audit_actor, "human:test");

    // Assert: FTS5 no longer matches deleted rule's text
    let post_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM substrate_nodes_fts WHERE substrate_nodes_fts MATCH ?1"
    )
    .bind(format!("\"{}\"", "Soft delete with grace"))
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(post_count, 0, "FTS should NOT find rule after delete (tombstone trigger fired)");
}

/// (b) Delete on an already-tombstoned row returns clean Err (no double-tombstone).
#[tokio::test]
async fn delete_on_tombstoned_row_returns_error() {
    let pool = setup_v8_pool().await;
    let rule_uuid = "rule-del-002";
    insert_substrate(&pool, rule_uuid, "Tombstone me twice").await;

    // First delete succeeds
    let first = do_delete(&pool, rule_uuid, "Duplicate", "", "human:test").await;
    assert!(first.is_ok(), "first delete should succeed");

    // Manually verify tombstoned
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM substrate_nodes WHERE uuid = ?1 AND invalid_at IS NOT NULL"
    )
    .bind(rule_uuid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 1, "row should be tombstoned");

    // Second delete must return Err containing "tombstoned"
    let second = do_delete(&pool, rule_uuid, "Duplicate", "", "human:test").await;
    assert!(second.is_err(), "second delete should fail");
    let err_msg = second.unwrap_err();
    assert!(
        err_msg.contains("tombstoned"),
        "error should mention 'tombstoned', got: {err_msg}"
    );

    // Assert: still only 1 audit row (no double write)
    let audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM substrate_edits WHERE rule_uuid = ?1 AND kind = 'delete'"
    )
    .bind(rule_uuid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit_count, 1, "should be exactly 1 audit row, not double-written");
}

/// (c) Delete with reason_kind='Other' requires non-empty free-text.
#[tokio::test]
async fn delete_with_other_reason_requires_free_text() {
    let pool = setup_v8_pool().await;
    let rule_uuid = "rule-del-003";
    insert_substrate(&pool, rule_uuid, "Some rule that needs a reason").await;

    // Empty reason_text with Other — should return Err
    let err_result = do_delete(&pool, rule_uuid, "Other", "", "human:test").await;
    assert!(err_result.is_err(), "Other with empty text should fail");
    assert!(
        err_result.unwrap_err().contains("free-text required"),
        "error message should mention free-text requirement"
    );

    // Verify rule is still live (no partial write)
    let live_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM substrate_nodes WHERE uuid = ?1 AND invalid_at IS NULL"
    )
    .bind(rule_uuid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(live_count, 1, "rule should still be live after validation failure");

    // Now succeed with non-empty reason_text
    let ok_result = do_delete(&pool, rule_uuid, "Other", "because reasons", "human:test").await;
    assert!(ok_result.is_ok(), "Other with non-empty text should succeed: {:?}", ok_result);

    // Verify tombstoned
    let tombstoned_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM substrate_nodes WHERE uuid = ?1 AND invalid_at IS NOT NULL"
    )
    .bind(rule_uuid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(tombstoned_count, 1, "rule should be tombstoned after successful Other delete");

    // Verify audit reason
    let audit_reason: String = sqlx::query_scalar(
        "SELECT reason FROM substrate_edits WHERE rule_uuid = ?1 AND kind = 'delete'"
    )
    .bind(rule_uuid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit_reason, "Other: because reasons");
}

/// (d) get_substrate_impact counts atoms + recent receipts correctly.
///     - 1 substrate rule anchoring 3 nodes (2 linked via anchored_uuids, 1 not)
///     - 2 receipts within 7 days referencing the rule UUID
///     - 1 receipt outside 7-day window (must NOT be counted)
#[tokio::test]
async fn get_substrate_impact_counts_atoms_and_recent_receipts() {
    let pool = setup_impact_pool().await;

    let rule_uuid = "rule-impact-001";
    // Link 2 nodes via anchored_uuids; third node is NOT linked
    let anchored = format!(r#"["node-a","node-b"]"#);
    insert_substrate_with_anchors(&pool, rule_uuid, "Impact preview rule", &anchored).await;

    // Insert 3 graph nodes (nodes a + b linked, c not linked)
    for (uuid, name, kind, level) in [
        ("node-a", "AuthGuard atom", "api", 4),
        ("node-b", "LoginScreen atom", "ui", 4),
        ("node-c", "Unrelated atom", "lib", 3),
    ] {
        sqlx::query(
            "INSERT INTO nodes (uuid, name, kind, level) VALUES (?1, ?2, ?3, ?4)"
        )
        .bind(uuid)
        .bind(name)
        .bind(kind)
        .bind(level)
        .execute(&pool)
        .await
        .unwrap();
    }

    // Insert 2 receipts within 7 days (both contain the rule UUID)
    let rule_json = format!(r#"["{}"]"#, rule_uuid);
    sqlx::query(
        "INSERT INTO receipts (id, session_id, created_at, substrate_rules_json) \
         VALUES (?1, 's1', datetime('now', '-1 day'), ?2)"
    )
    .bind("receipt-recent-1")
    .bind(&rule_json)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO receipts (id, session_id, created_at, substrate_rules_json) \
         VALUES (?1, 's1', datetime('now', '-3 days'), ?2)"
    )
    .bind("receipt-recent-2")
    .bind(&rule_json)
    .execute(&pool)
    .await
    .unwrap();

    // Insert 1 receipt outside 7-day window — must NOT be counted
    sqlx::query(
        "INSERT INTO receipts (id, session_id, created_at, substrate_rules_json) \
         VALUES (?1, 's1', datetime('now', '-10 days'), ?2)"
    )
    .bind("receipt-old-1")
    .bind(&rule_json)
    .execute(&pool)
    .await
    .unwrap();

    // Execute impact queries inline (mirrors get_substrate_impact SQL)
    let atom_count: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*) AS atom_count
        FROM substrate_nodes s, json_each(s.anchored_uuids) je
        WHERE s.uuid = ?1
        "#
    )
    .bind(rule_uuid)
    .fetch_one(&pool)
    .await
    .unwrap();

    let atom_rows = sqlx::query(
        r#"
        SELECT n.uuid, COALESCE(n.name, n.uuid) AS name, COALESCE(n.kind, '') AS kind,
               COALESCE(n.level, 0) AS level
        FROM substrate_nodes s, json_each(s.anchored_uuids) je
        JOIN nodes n ON n.uuid = je.value
        WHERE s.uuid = ?1
        LIMIT 50
        "#
    )
    .bind(rule_uuid)
    .fetch_all(&pool)
    .await
    .unwrap();

    let recent_prompt_count: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*) AS recent_prompt_count
        FROM receipts
        WHERE created_at > datetime('now', '-7 days')
          AND substrate_rules_json IS NOT NULL
          AND substrate_rules_json LIKE '%' || ?1 || '%'
        "#
    )
    .bind(rule_uuid)
    .fetch_one(&pool)
    .await
    .unwrap();

    let recent_prompt_rows = sqlx::query(
        r#"
        SELECT id, created_at, COALESCE(raw_summary, '') AS prompt_excerpt
        FROM receipts
        WHERE created_at > datetime('now', '-7 days')
          AND substrate_rules_json IS NOT NULL
          AND substrate_rules_json LIKE '%' || ?1 || '%'
        ORDER BY created_at DESC
        LIMIT 50
        "#
    )
    .bind(rule_uuid)
    .fetch_all(&pool)
    .await
    .unwrap();

    // Assertions
    assert_eq!(atom_count, 2, "atom_count should be 2 (only node-a and node-b in anchored_uuids)");
    assert_eq!(atom_rows.len(), 2, "atom rows list should have 2 entries");

    let names: Vec<String> = atom_rows.iter()
        .map(|r| r.try_get::<String, _>("name").unwrap())
        .collect();
    assert!(names.contains(&"AuthGuard atom".to_string()), "should include node-a name");
    assert!(names.contains(&"LoginScreen atom".to_string()), "should include node-b name");

    assert_eq!(recent_prompt_count, 2, "recent_prompt_count should be 2 (receipts within 7 days)");
    assert_eq!(recent_prompt_rows.len(), 2, "recent_prompts list should have 2 entries");

    // Verify ordering (most recent first)
    let first_id: String = recent_prompt_rows[0].try_get("id").unwrap();
    let second_id: String = recent_prompt_rows[1].try_get("id").unwrap();
    assert_eq!(first_id, "receipt-recent-1", "most recent receipt should be first");
    assert_eq!(second_id, "receipt-recent-2");

    // Verify old receipt is excluded
    let ids: Vec<String> = recent_prompt_rows.iter()
        .map(|r| r.try_get::<String, _>("id").unwrap())
        .collect();
    assert!(!ids.contains(&"receipt-old-1".to_string()), "old receipt (>7 days) must NOT appear");
}
