//! Integration tests for Phase 15 Plan 03 — TRUST-02 refine path.
//!
//! Proves three key invariants:
//!   (a) refine writes a new chain row, invalidates the old row, and inserts
//!       a substrate_edits audit row — all in a single transaction.
//!       FTS5: old text → 0 matches; new text → 1 match.
//!   (b) refine on an already-tombstoned row returns Err containing "tombstoned"
//!       with no partial write (no new rows in either table).
//!   (c) get_substrate_chain returns all versions oldest→newest with correct
//!       version_number (1-indexed), and the substrate_edits LEFT JOIN populates
//!       actor/reason on refined versions but not on the chain origin.
//!
//! Pattern: same in-memory pool setup as migration_v8_chain_smoke.rs (Plan 15-01).
//! Tests call Rust logic directly (not via IPC) — the two public commands
//! refine_substrate_rule and get_substrate_chain are invoked by constructing
//! the pool manually and calling the query logic inline, since Tauri's AppHandle
//! is not available outside the app process in integration tests.
//!
//! NOTE: Because we cannot call the Tauri #[tauri::command] fns without an
//! AppHandle, these tests replicate the SQL logic inline.  The SQL blocks are
//! verbatim from substrate_trust.rs (same transaction pattern), so any drift
//! between the test and the production code is intentionally kept visible.

use sqlx::{Executor, Row};
use sqlx::sqlite::SqlitePoolOptions;

// ─────────────────────────────────────────────────────────────────────────────
// Schema helper (same as migration_v8_chain_smoke.rs)
// ─────────────────────────────────────────────────────────────────────────────

/// Materialise the v8 substrate schema in an in-memory pool.
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
            invalidated_by            TEXT REFERENCES substrate_nodes(uuid),
            anchored_uuids            TEXT NOT NULL DEFAULT '[]',
            intent_drift_state        TEXT,
            intent_drift_confidence   REAL,
            intent_drift_reasoning    TEXT,
            intent_drift_judged_at    TEXT,
            intent_drift_judged_against TEXT,
            prev_version_uuid         TEXT REFERENCES substrate_nodes(uuid),
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
    // Removes old row from FTS and only re-inserts new row if invalid_at IS NULL.
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
        CREATE INDEX idx_substrate_edits_rule_uuid ON substrate_edits(rule_uuid);
        CREATE INDEX idx_substrate_edits_edited_at ON substrate_edits(edited_at);
    "#).await.unwrap();

    pool
}

/// Helper: insert a seed substrate_nodes row.
async fn insert_seed(pool: &sqlx::SqlitePool, uuid: &str, text: &str, applies_when: Option<&str>, valid_at: &str) {
    sqlx::query(
        "INSERT INTO substrate_nodes (uuid, node_type, text, applies_when, valid_at, invalid_at, prev_version_uuid) \
         VALUES (?1, 'constraint', ?2, ?3, ?4, NULL, NULL)"
    )
    .bind(uuid)
    .bind(text)
    .bind(applies_when)
    .bind(valid_at)
    .execute(pool)
    .await
    .unwrap();
}

/// Helper: execute the refine transaction inline (mirrors substrate_trust.rs logic).
/// Returns Ok(new_uuid) or Err(message).
async fn do_refine(
    pool: &sqlx::SqlitePool,
    old_uuid: &str,
    new_text: &str,
    new_applies_when: Option<&str>,
    reason: &str,
    actor: &str,
) -> Result<String, String> {
    // Read old row
    let row = sqlx::query(
        "SELECT text FROM substrate_nodes WHERE uuid = ?1 AND invalid_at IS NULL"
    )
    .bind(old_uuid)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    let Some(old_row) = row else {
        return Err(format!("rule {} not found or already tombstoned — cannot refine", old_uuid));
    };

    let old_text: String = old_row.try_get("text").map_err(|e| e.to_string())?;

    let new_uuid = uuid::Uuid::new_v4().to_string();
    let edit_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let invalidated_reason = format!("refined: {reason}");

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // INSERT new row
    sqlx::query(r#"
        INSERT INTO substrate_nodes (
            uuid, node_type, text, scope, applies_when,
            source_session_id, source_turn_ref, source_quote, source_actor,
            valid_at, invalid_at, expired_at, created_at,
            confidence, episode_id, invalidated_by, anchored_uuids,
            prev_version_uuid
        )
        SELECT ?1, node_type, ?2, scope, ?3,
               source_session_id, source_turn_ref, source_quote, source_actor,
               ?4, NULL, NULL, ?4,
               confidence, episode_id, NULL, anchored_uuids, ?5
        FROM substrate_nodes WHERE uuid = ?5
    "#)
    .bind(&new_uuid)
    .bind(new_text)
    .bind(new_applies_when)
    .bind(&now)
    .bind(old_uuid)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("INSERT new row: {e}"))?;

    // UPDATE old row
    let result = sqlx::query(
        "UPDATE substrate_nodes SET invalid_at = ?1, invalidated_reason = ?2 WHERE uuid = ?3 AND invalid_at IS NULL"
    )
    .bind(&now)
    .bind(&invalidated_reason)
    .bind(old_uuid)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("UPDATE old row: {e}"))?;

    if result.rows_affected() == 0 {
        tx.rollback().await.ok();
        return Err(format!("rule {} already tombstoned — cannot refine", old_uuid));
    }

    // INSERT substrate_edits
    sqlx::query(r#"
        INSERT INTO substrate_edits (
            edit_id, rule_uuid, prev_version_uuid, new_version_uuid,
            actor, edited_at, before_text, after_text, reason, kind
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'refine')
    "#)
    .bind(&edit_id)
    .bind(&new_uuid)
    .bind(old_uuid)
    .bind(&new_uuid)
    .bind(actor)
    .bind(&now)
    .bind(&old_text)
    .bind(new_text)
    .bind(reason)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("INSERT substrate_edits: {e}"))?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(new_uuid)
}

// ─────────────────────────────────────────────────────────────────────────────
// Test cases
// ─────────────────────────────────────────────────────────────────────────────

/// (a) Refine writes new chain row, invalidates old row, inserts audit row in single transaction.
///
/// Asserts:
///   - substrate_nodes has exactly 2 rows after refine
///   - old row has invalid_at IS NOT NULL and invalidated_reason='refined: <reason>'
///   - new row has invalid_at IS NULL and prev_version_uuid = old_uuid
///   - substrate_edits has 1 row with kind='refine', before_text=old_text, after_text=new_text
///   - FTS MATCH on old text returns 0 rows (tombstone trigger fired)
///   - FTS MATCH on new text returns 1 row (new head indexed on INSERT)
#[tokio::test]
async fn refine_writes_new_chain_row_invalidates_old_and_audits() {
    let pool = setup_v8_pool().await;

    let old_uuid = "test-old-uuid-0001";
    let old_text = "Stripe customers must not be deleted immediately";
    let new_text = "Stripe customers must not be deleted immediately; archive only via scheduled job";
    let reason = "narrowing to destructive actions requires archival not hard delete";
    let actor = "human:yangg40@g.ucla.edu";
    let valid_at = "2026-01-01T10:00:00Z";

    insert_seed(&pool, old_uuid, old_text, Some("any delete operation"), valid_at).await;

    // Pre-condition: old text in FTS
    let fts_pre: Vec<(String,)> = sqlx::query_as(
        "SELECT uuid FROM substrate_nodes_fts WHERE substrate_nodes_fts MATCH '\"Stripe\"'"
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(fts_pre.len(), 1, "seed row must appear in FTS before refine");

    let new_uuid = do_refine(&pool, old_uuid, new_text, Some("any destructive action"), reason, actor)
        .await
        .expect("refine should succeed");

    // Assert: 2 rows in substrate_nodes
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM substrate_nodes")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count.0, 2, "must have exactly 2 substrate_nodes rows after refine");

    // Assert: old row is tombstoned with correct invalidated_reason
    let old_row = sqlx::query(
        "SELECT invalid_at, invalidated_reason FROM substrate_nodes WHERE uuid = ?1"
    )
    .bind(old_uuid)
    .fetch_one(&pool)
    .await
    .unwrap();
    let invalid_at: Option<String> = old_row.try_get("invalid_at").ok().flatten();
    let invalidated_reason: Option<String> = old_row.try_get("invalidated_reason").ok().flatten();
    assert!(invalid_at.is_some(), "old row must have invalid_at set after refine");
    assert_eq!(
        invalidated_reason.as_deref(),
        Some("refined: narrowing to destructive actions requires archival not hard delete"),
        "old row invalidated_reason must match 'refined: <reason>'"
    );

    // Assert: new row is chain head with prev_version_uuid = old_uuid
    let new_row = sqlx::query(
        "SELECT invalid_at, prev_version_uuid FROM substrate_nodes WHERE uuid = ?1"
    )
    .bind(&new_uuid)
    .fetch_one(&pool)
    .await
    .unwrap();
    let new_invalid_at: Option<String> = new_row.try_get("invalid_at").ok().flatten();
    let prev_version_uuid: Option<String> = new_row.try_get("prev_version_uuid").ok().flatten();
    assert!(new_invalid_at.is_none(), "new row must have invalid_at = NULL (chain head)");
    assert_eq!(prev_version_uuid.as_deref(), Some(old_uuid), "new row prev_version_uuid must point to old_uuid");

    // Assert: substrate_edits has 1 row with correct fields
    let audit_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM substrate_edits")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(audit_count.0, 1, "must have exactly 1 substrate_edits row");

    let audit_row = sqlx::query(
        "SELECT kind, before_text, after_text, actor, reason FROM substrate_edits"
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let kind: String = audit_row.try_get("kind").unwrap();
    let before_text: Option<String> = audit_row.try_get("before_text").ok().flatten();
    let after_text: Option<String> = audit_row.try_get("after_text").ok().flatten();
    let audit_actor: String = audit_row.try_get("actor").unwrap();
    let audit_reason: String = audit_row.try_get("reason").unwrap();
    assert_eq!(kind, "refine", "substrate_edits.kind must be 'refine'");
    assert_eq!(before_text.as_deref(), Some(old_text), "before_text must be old row text");
    assert_eq!(after_text.as_deref(), Some(new_text), "after_text must be new_text");
    assert_eq!(audit_actor, actor, "audit actor must match");
    assert_eq!(audit_reason, reason, "audit reason must match");

    // Assert: FTS tombstone — old text no longer matches
    let fts_old: Vec<(String,)> = sqlx::query_as(
        "SELECT uuid FROM substrate_nodes_fts WHERE substrate_nodes_fts MATCH '\"immediately\"'"
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    // The new text also contains "immediately" so we need to check by uuid
    // that only the new uuid is present (old uuid removed from FTS by the au trigger)
    let old_uuid_in_fts = fts_old.iter().any(|(u,)| u == old_uuid);
    assert!(!old_uuid_in_fts, "old uuid must NOT be in FTS after tombstone (tombstone trigger fix from plan 15-01)");
    assert!(fts_old.iter().any(|(u,)| u == &new_uuid), "new uuid must be in FTS after INSERT");

    // Assert: FTS MATCH on unique new text returns the new uuid
    // "scheduled" only appears in the new_text (not in old_text)
    let fts_new: Vec<(String,)> = sqlx::query_as(
        "SELECT uuid FROM substrate_nodes_fts WHERE substrate_nodes_fts MATCH '\"scheduled\"'"
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(fts_new.len(), 1, "new unique word must appear in FTS exactly once");
    assert_eq!(fts_new[0].0, new_uuid, "FTS result must be the new chain head uuid");

    // Assert: WHERE invalid_at IS NULL returns only the new uuid
    let chain_head: Vec<(String,)> = sqlx::query_as(
        "SELECT uuid FROM substrate_nodes WHERE invalid_at IS NULL"
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(chain_head.len(), 1, "only 1 chain head after refine");
    assert_eq!(chain_head[0].0, new_uuid, "chain head must be the new uuid");
}

/// (b) Refine on a tombstoned row returns Err containing "tombstoned" with no partial write.
///
/// Seeds a row, manually sets invalid_at to simulate a prior tombstone (e.g., distiller
/// raced ahead), then calls do_refine and asserts:
///   - returns Err with "tombstoned" in the message
///   - substrate_nodes count remains 1 (no new row inserted)
///   - substrate_edits count remains 0 (no audit row inserted)
#[tokio::test]
async fn refine_on_tombstoned_row_returns_error() {
    let pool = setup_v8_pool().await;

    let old_uuid = "test-tombstoned-uuid-0001";
    let now = chrono::Utc::now().to_rfc3339();
    insert_seed(&pool, old_uuid, "some constraint text", None, &now).await;

    // Manually tombstone the row (simulate distiller race)
    sqlx::query("UPDATE substrate_nodes SET invalid_at = ?1 WHERE uuid = ?2")
        .bind(&now)
        .bind(old_uuid)
        .execute(&pool)
        .await
        .unwrap();

    // Attempt refine — must fail
    let result = do_refine(
        &pool,
        old_uuid,
        "new text that should not land",
        None,
        "this should fail",
        "human:yangg40@g.ucla.edu",
    ).await;

    assert!(result.is_err(), "refine on tombstoned row must return Err");
    let err_msg = result.unwrap_err();
    assert!(
        err_msg.contains("tombstoned"),
        "error message must contain 'tombstoned', got: {err_msg}"
    );

    // No new rows in substrate_nodes
    let node_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM substrate_nodes")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(node_count.0, 1, "substrate_nodes count must still be 1 after failed refine");

    // No rows in substrate_edits
    let audit_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM substrate_edits")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(audit_count.0, 0, "substrate_edits must remain empty after failed refine");
}

/// Helper: execute the get_substrate_chain CTE inline (mirrors substrate_trust.rs logic).
async fn do_get_chain(pool: &sqlx::SqlitePool, uuid: &str) -> Vec<(i64, String, Option<String>, Option<String>)> {
    // Returns (version_number, uuid, actor, reason) sorted oldest→newest
    let rows = sqlx::query(r#"
        WITH RECURSIVE chain(uuid, text, applies_when, valid_at, invalid_at,
                              invalidated_reason, prev_version_uuid, depth) AS (
            SELECT uuid, text, applies_when, valid_at, invalid_at,
                   invalidated_reason, prev_version_uuid, 0
            FROM substrate_nodes WHERE uuid = ?1
            UNION ALL
            SELECT s.uuid, s.text, s.applies_when, s.valid_at, s.invalid_at,
                   s.invalidated_reason, s.prev_version_uuid, c.depth + 1
            FROM substrate_nodes s
            JOIN chain c ON s.uuid = c.prev_version_uuid
            WHERE c.depth < 50
        )
        SELECT chain.uuid, chain.valid_at, chain.invalid_at,
               se.actor, se.reason
        FROM chain
        LEFT JOIN substrate_edits se
            ON se.new_version_uuid = chain.uuid
           AND se.kind = 'refine'
        ORDER BY chain.valid_at ASC
    "#)
    .bind(uuid)
    .fetch_all(pool)
    .await
    .unwrap();

    rows.iter().enumerate().map(|(i, row)| {
        let version_number = (i + 1) as i64;
        let uuid_val: String = row.try_get("uuid").unwrap();
        let actor: Option<String> = row.try_get("actor").ok().flatten();
        let reason: Option<String> = row.try_get("reason").ok().flatten();
        (version_number, uuid_val, actor, reason)
    }).collect()
}

/// (c) get_substrate_chain returns versions oldest→newest with correct version_number.
///
/// Seeds a row, refines it twice creating a 3-version chain, then calls
/// get_substrate_chain on the head UUID and asserts:
///   - returned Vec has length 3
///   - version_numbers are [1, 2, 3] in order
///   - valid_at is monotonically increasing (oldest to newest)
///   - the head version (version 3) has invalid_at = NULL
///   - versions 1 and 2 have invalid_at != NULL
///   - LEFT JOIN populated actor/reason on versions 2 and 3 (NOT on version 1 — chain origin)
#[tokio::test]
async fn get_substrate_chain_returns_versions_oldest_to_newest() {
    let pool = setup_v8_pool().await;

    // Use distinct timestamps to ensure stable valid_at ordering
    let v1_uuid = "chain-v1-uuid-0001";
    let v1_text = "Initial constraint: no modal interrupts";
    let v1_time = "2026-01-01T10:00:00Z";

    insert_seed(&pool, v1_uuid, v1_text, None, v1_time).await;

    // Small delay between refinements to ensure distinct valid_at values
    // In tests we use hardcoded timestamps via a small increment trick:
    // We override valid_at in the INSERT by using the helper which uses Utc::now().
    // To get distinct timestamps, sleep 10ms between refinements.
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;

    let v2_uuid = do_refine(
        &pool,
        v1_uuid,
        "No modal interrupts in settings (non-destructive only)",
        None,
        "clarifying scope to non-destructive actions",
        "human:yangg40@g.ucla.edu",
    ).await.expect("first refine must succeed");

    tokio::time::sleep(std::time::Duration::from_millis(10)).await;

    let v3_uuid = do_refine(
        &pool,
        &v2_uuid,
        "No modal interrupts in settings; destructive actions require confirmation modal",
        Some("applies to any non-destructive settings interaction"),
        "destructive actions still need confirmation — narrowing the rule",
        "human:yangg40@g.ucla.edu",
    ).await.expect("second refine must succeed");

    // Verify 3 rows in substrate_nodes
    let node_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM substrate_nodes")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(node_count.0, 3, "must have 3 substrate_nodes rows after 2 refinements");

    // Walk chain from the head (v3_uuid)
    let chain = do_get_chain(&pool, &v3_uuid).await;
    assert_eq!(chain.len(), 3, "chain must have 3 versions");

    // version_numbers are [1, 2, 3]
    let version_numbers: Vec<i64> = chain.iter().map(|(n, _, _, _)| *n).collect();
    assert_eq!(version_numbers, vec![1, 2, 3], "version_numbers must be [1, 2, 3] oldest→newest");

    // UUIDs are in order v1 → v2 → v3
    let uuids: Vec<&str> = chain.iter().map(|(_, u, _, _)| u.as_str()).collect();
    assert_eq!(uuids[0], v1_uuid, "version 1 must be the chain origin (v1_uuid)");
    assert_eq!(uuids[1], v2_uuid, "version 2 must be v2_uuid");
    assert_eq!(uuids[2], v3_uuid, "version 3 must be v3_uuid (chain head)");

    // version 3 (head) must have invalid_at = NULL
    let head_row = sqlx::query("SELECT invalid_at FROM substrate_nodes WHERE uuid = ?1")
        .bind(&v3_uuid)
        .fetch_one(&pool)
        .await
        .unwrap();
    let head_invalid_at: Option<String> = head_row.try_get("invalid_at").ok().flatten();
    assert!(head_invalid_at.is_none(), "chain head (v3) must have invalid_at = NULL");

    // versions 1 and 2 must have invalid_at != NULL
    for (i, tombstoned_uuid) in [&v1_uuid.to_string(), &v2_uuid].iter().enumerate() {
        let row = sqlx::query("SELECT invalid_at FROM substrate_nodes WHERE uuid = ?1")
            .bind(tombstoned_uuid.as_str())
            .fetch_one(&pool)
            .await
            .unwrap();
        let invalid_at: Option<String> = row.try_get("invalid_at").ok().flatten();
        assert!(
            invalid_at.is_some(),
            "version {} (uuid={}) must be tombstoned after refinement",
            i + 1, tombstoned_uuid
        );
    }

    // LEFT JOIN: version 1 (chain origin) must have actor=None and reason=None
    let (_, _, v1_actor, v1_reason) = &chain[0];
    assert!(v1_actor.is_none(), "chain origin (version 1) must have actor=NULL (no refine produced it)");
    assert!(v1_reason.is_none(), "chain origin (version 1) must have reason=NULL");

    // LEFT JOIN: version 2 and 3 must have actor and reason populated
    let (_, _, v2_actor, v2_reason) = &chain[1];
    assert!(v2_actor.is_some(), "version 2 must have actor from substrate_edits LEFT JOIN");
    assert_eq!(v2_actor.as_deref(), Some("human:yangg40@g.ucla.edu"));
    assert!(v2_reason.is_some(), "version 2 must have reason from substrate_edits LEFT JOIN");
    assert_eq!(v2_reason.as_deref(), Some("clarifying scope to non-destructive actions"));

    let (_, _, v3_actor, v3_reason) = &chain[2];
    assert!(v3_actor.is_some(), "version 3 must have actor from substrate_edits LEFT JOIN");
    assert_eq!(v3_actor.as_deref(), Some("human:yangg40@g.ucla.edu"));
    assert!(v3_reason.is_some(), "version 3 must have reason from substrate_edits LEFT JOIN");
    assert_eq!(v3_reason.as_deref(), Some("destructive actions still need confirmation — narrowing the rule"));

    // Also verify 2 substrate_edits rows (one per refine)
    let audit_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM substrate_edits")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(audit_count.0, 2, "must have exactly 2 substrate_edits rows for 2 refinements");
}
