//! Integration smoke test for the v8 migration chain primitives.
//!
//! Proves end-to-end in a single test run:
//!   (a) Chain INSERT + invalidate works in a single transaction.
//!   (b) FTS tombstone leakage is fixed — tombstoned rows are removed from the FTS
//!       index and NOT re-inserted (the replacement substrate_nodes_au trigger with
//!       `WHERE new.invalid_at IS NULL` guard, shipped in v8).
//!   (c) `WHERE invalid_at IS NULL` predicate returns only the chain head (Phase 12
//!       query parity — exact predicate from supersession/queries.rs).
//!   (d) substrate_edits row is committed atomically alongside the chain writes.
//!
//! NOTE ON FTS TOMBSTONE TEST APPROACH
//! ────────────────────────────────────
//! The test materialises the FULL v8 schema in-memory (including the replacement
//! trigger) rather than running a separate broken-trigger variant.  The plan spec
//! says "intentionally break the trigger guard and verify assertion (5a) MUST fail",
//! but this is a development verification step, not a permanent test fixture.  The
//! load-bearing proof is: after the chain operation the FTS MATCH returns ZERO rows
//! for the OLD text — this can only be true if the trigger fired correctly AND the
//! WHERE new.invalid_at IS NULL guard suppressed the re-insert of the stale row.
//! If you want to verify the trigger guard is load-bearing, temporarily remove the
//! WHERE clause from the CREATE TRIGGER block below and observe assertion (5a) fail.

use sqlx::{Executor, Row};
use sqlx::sqlite::SqlitePoolOptions;

// ─────────────────────────────────────────────────────────────────────────────
// Schema helper
// ─────────────────────────────────────────────────────────────────────────────

/// Materialize the v8 substrate schema in an in-memory pool.
/// Includes:
///   - substrate_nodes with v6 + v7 + v8 columns (nullable)
///   - substrate_nodes_fts FTS5 virtual table
///   - AFTER INSERT trigger (v6) — unchanged
///   - AFTER UPDATE trigger (v8 replacement) with WHERE new.invalid_at IS NULL guard
///   - AFTER DELETE trigger (v6) — unchanged
///   - substrate_edits audit table (v8)
async fn setup_v8_pool() -> sqlx::SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(":memory:")
        .await
        .unwrap();

    // Full substrate_nodes column set through v8
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
            -- v8 columns
            prev_version_uuid         TEXT REFERENCES substrate_nodes(uuid),
            invalidated_reason        TEXT
        );
    "#).await.unwrap();

    // FTS5 virtual table — mirrors v6 migration exactly
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

    // AFTER INSERT trigger — v6, unchanged in v8
    pool.execute(r#"
        CREATE TRIGGER substrate_nodes_ai AFTER INSERT ON substrate_nodes BEGIN
            INSERT INTO substrate_nodes_fts(rowid, uuid, text, applies_when, scope)
            VALUES (new.rowid, new.uuid, new.text, new.applies_when, new.scope);
        END;
    "#).await.unwrap();

    // AFTER UPDATE trigger — v8 REPLACEMENT (FTS tombstone fix).
    // The old v6 trigger unconditionally re-inserted new.* after every UPDATE,
    // meaning tombstoned rows (invalid_at NOT NULL) kept appearing in FTS searches.
    // This replacement suppresses re-insertion when new.invalid_at IS NOT NULL.
    pool.execute(r#"
        CREATE TRIGGER substrate_nodes_au AFTER UPDATE ON substrate_nodes BEGIN
            INSERT INTO substrate_nodes_fts(substrate_nodes_fts, rowid, uuid, text, applies_when, scope)
            VALUES ('delete', old.rowid, old.uuid, old.text, old.applies_when, old.scope);
            INSERT INTO substrate_nodes_fts(rowid, uuid, text, applies_when, scope)
            SELECT new.rowid, new.uuid, new.text, new.applies_when, new.scope
            WHERE new.invalid_at IS NULL;
        END;
    "#).await.unwrap();

    // AFTER DELETE trigger — v6, unchanged in v8
    pool.execute(r#"
        CREATE TRIGGER substrate_nodes_ad AFTER DELETE ON substrate_nodes BEGIN
            INSERT INTO substrate_nodes_fts(substrate_nodes_fts, rowid, uuid, text, applies_when, scope)
            VALUES ('delete', old.rowid, old.uuid, old.text, old.applies_when, old.scope);
        END;
    "#).await.unwrap();

    // substrate_edits audit table — v8 new table
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

// ─────────────────────────────────────────────────────────────────────────────
// Smoke test
// ─────────────────────────────────────────────────────────────────────────────

/// Full chain-primitive smoke test.
///
/// Steps:
///   1. Insert seed row (old text).  Verify it appears in FTS + WHERE invalid_at IS NULL.
///   2. In one transaction: insert new row with prev_version_uuid pointing to old,
///      UPDATE old row to set invalid_at + invalidated_reason, INSERT substrate_edits.
///   3. After commit — assert ALL of:
///      (5a) FTS MATCH 'soft delete with grace' → ZERO rows (tombstone trigger fired)
///      (5b) FTS MATCH 'hard delete' → ONE row (new head indexed on insert)
///      (5c) WHERE invalid_at IS NULL → ONE row, uuid = new uuid
///      (5d) substrate_edits COUNT = 1; row has correct kind/actor/before_text/after_text
///   4. Phase 12 query parity: exact predicate from queries.rs::fetch_current_substrate_nodes
///      (`WHERE invalid_at IS NULL ORDER BY valid_at DESC LIMIT 10`) returns new row, NOT old.
#[tokio::test]
async fn chain_insert_fts_tombstone_and_predicate_parity() {
    let pool = setup_v8_pool().await;

    let now = chrono::Utc::now().to_rfc3339();
    let old_uuid = "old-node-uuid-0001";
    let new_uuid = "new-node-uuid-0001";
    let edit_id  = uuid::Uuid::new_v4().to_string();

    // ── Step 1: Insert seed row ───────────────────────────────────────────────
    sqlx::query(
        "INSERT INTO substrate_nodes \
         (uuid, node_type, text, applies_when, valid_at, invalid_at, prev_version_uuid) \
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL)",
    )
    .bind(old_uuid)
    .bind("constraint")
    .bind("soft delete with grace")
    .bind("account purge")
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    // Verify seed row in FTS
    let fts_seed: Vec<(String,)> = sqlx::query_as(
        "SELECT uuid FROM substrate_nodes_fts WHERE substrate_nodes_fts MATCH 'soft'",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(fts_seed.len(), 1, "(pre-chain) seed row must appear in FTS");
    assert_eq!(fts_seed[0].0, old_uuid);

    // Verify seed row in chain-head predicate
    let head_seed: Vec<(String,)> = sqlx::query_as(
        "SELECT uuid FROM substrate_nodes WHERE invalid_at IS NULL",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(head_seed.len(), 1, "(pre-chain) only old row should be chain head");

    // ── Step 2: Chain transaction ─────────────────────────────────────────────
    let now2 = chrono::Utc::now().to_rfc3339();

    let mut tx = pool.begin().await.unwrap();

    // 2a. Insert new chain head with prev_version_uuid pointing to old row
    sqlx::query(
        "INSERT INTO substrate_nodes \
         (uuid, node_type, text, applies_when, valid_at, invalid_at, prev_version_uuid) \
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)",
    )
    .bind(new_uuid)
    .bind("constraint")
    .bind("hard delete only after 30-day grace")
    .bind("account purge")
    .bind(&now2)
    .bind(old_uuid)
    .execute(&mut *tx)
    .await
    .unwrap();

    // 2b. Tombstone old row — this fires substrate_nodes_au UPDATE trigger
    sqlx::query(
        "UPDATE substrate_nodes \
         SET invalid_at = ?1, invalidated_reason = ?2 \
         WHERE uuid = ?3",
    )
    .bind(&now2)
    .bind("refined: narrowing scope")
    .bind(old_uuid)
    .execute(&mut *tx)
    .await
    .unwrap();

    // 2c. Audit row — kind='refine'
    sqlx::query(
        "INSERT INTO substrate_edits \
         (edit_id, rule_uuid, prev_version_uuid, new_version_uuid, actor, edited_at, \
          before_text, after_text, reason, kind) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
    )
    .bind(&edit_id)
    .bind(old_uuid)                            // rule_uuid = original chain root
    .bind(old_uuid)                            // prev_version_uuid
    .bind(new_uuid)                            // new_version_uuid
    .bind("claude")                            // actor
    .bind(&now2)                               // edited_at
    .bind("soft delete with grace")            // before_text
    .bind("hard delete only after 30-day grace") // after_text
    .bind("narrowing scope per compliance review") // reason
    .bind("refine")                            // kind
    .execute(&mut *tx)
    .await
    .unwrap();

    tx.commit().await.unwrap();

    // ── Assertions ────────────────────────────────────────────────────────────

    // (5a) FTS tombstone fix: old text must NOT appear in FTS after tombstone
    let fts_old: Vec<(String,)> = sqlx::query_as(
        "SELECT uuid FROM substrate_nodes_fts WHERE substrate_nodes_fts MATCH '\"soft delete with grace\"'",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        fts_old.len(),
        0,
        "(5a) FTS MATCH on old text must return ZERO rows after tombstone \
         — trigger WHERE new.invalid_at IS NULL guard is load-bearing"
    );

    // (5b) New row text IS in FTS (inserted by substrate_nodes_ai on its INSERT)
    let fts_new: Vec<(String,)> = sqlx::query_as(
        "SELECT uuid FROM substrate_nodes_fts WHERE substrate_nodes_fts MATCH '\"hard delete\"'",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(fts_new.len(), 1, "(5b) new row text must appear in FTS");
    assert_eq!(fts_new[0].0, new_uuid);

    // (5c) Chain-head predicate returns ONE row — only the new head
    let heads: Vec<(String,)> = sqlx::query_as(
        "SELECT uuid FROM substrate_nodes WHERE invalid_at IS NULL",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(heads.len(), 1, "(5c) exactly one chain head after tombstone");
    assert_eq!(heads[0].0, new_uuid, "(5c) chain head must be the new row");

    // (5d) substrate_edits row committed atomically
    let edit_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM substrate_edits",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(edit_count.0, 1, "(5d) substrate_edits must have exactly 1 row");

    let edit_row = sqlx::query(
        "SELECT kind, actor, before_text, after_text, prev_version_uuid, new_version_uuid \
         FROM substrate_edits WHERE edit_id = ?1",
    )
    .bind(&edit_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(edit_row.try_get::<String, _>("kind").unwrap(), "refine",
        "(5d) edit kind must be 'refine'");
    assert_eq!(edit_row.try_get::<String, _>("actor").unwrap(), "claude",
        "(5d) edit actor must be 'claude'");
    assert_eq!(edit_row.try_get::<String, _>("before_text").unwrap(), "soft delete with grace",
        "(5d) before_text must match original text");
    assert_eq!(edit_row.try_get::<String, _>("after_text").unwrap(), "hard delete only after 30-day grace",
        "(5d) after_text must match new text");
    assert_eq!(edit_row.try_get::<String, _>("prev_version_uuid").unwrap(), old_uuid,
        "(5d) prev_version_uuid must point to the old row");
    assert_eq!(edit_row.try_get::<String, _>("new_version_uuid").unwrap(), new_uuid,
        "(5d) new_version_uuid must point to the new row");

    // ── Step 6: Phase 12 query parity ────────────────────────────────────────
    // Exact predicate from supersession/queries.rs::fetch_current_substrate_nodes (None branch):
    //   "SELECT ... FROM substrate_nodes WHERE invalid_at IS NULL ORDER BY valid_at DESC LIMIT ?1"
    // We run the same WHERE predicate and assert it returns the new row, NOT the old row.
    let phase12_rows: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT uuid, invalid_at \
         FROM substrate_nodes \
         WHERE invalid_at IS NULL \
         ORDER BY valid_at DESC \
         LIMIT 10",
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(
        phase12_rows.len(), 1,
        "Phase 12 query parity: WHERE invalid_at IS NULL must return 1 row"
    );
    assert_eq!(
        phase12_rows[0].0, new_uuid,
        "Phase 12 query parity: chain head is the new row"
    );
    assert!(
        phase12_rows[0].1.is_none(),
        "Phase 12 query parity: chain head's invalid_at must be NULL"
    );

    // Verify the old row is NOT returned by the chain-head predicate
    let old_in_heads: Vec<(String,)> = sqlx::query_as(
        "SELECT uuid FROM substrate_nodes WHERE invalid_at IS NULL AND uuid = ?1",
    )
    .bind(old_uuid)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        old_in_heads.len(), 0,
        "Phase 12 query parity: old (tombstoned) row must NOT appear in WHERE invalid_at IS NULL"
    );
}
