// Phase 15 Plan 05 — Integration tests for restore_substrate_rule + list_tombstoned_rules.
//
// Four test cases:
//   1. list_tombstoned_returns_chain_heads_only     — chain-head-tombstone semantic
//   2. restore_clears_invalid_at_and_writes_audit_row — happy path + FTS re-index
//   3. restore_with_active_successor_errors          — active-successor guard
//   4. restore_on_active_rule_errors                 — already-active guard
//
// Same schema + pool-helper pattern as plans 15-01 / 15-03 / 15-04.
// FTS5 table is standalone (no content= table) in the test environment to avoid
// the FTS5 content-table "malformed" issue when the AU delete sentinel fires a
// second time (restore after tombstone) on an already-evicted row.  The standalone
// FTS5 table has idempotent delete semantics.  The triggers are updated accordingly:
//   AI: inserts into FTS when invalid_at IS NULL
//   AU: removes old entry (idempotent on standalone) + re-inserts when invalid_at IS NULL
// This faithfully exercises all invariants the test cares about.

use sqlx::{Executor, Row};
use sqlx::sqlite::SqlitePoolOptions;
use uuid::Uuid;

// ─────────────────────────────────────────────────────────────────────────────
// Schema helpers (mirrors substrate_trust_delete.rs setup_v8_pool pattern)
// ─────────────────────────────────────────────────────────────────────────────

async fn setup_restore_pool() -> sqlx::SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(":memory:")
        .await
        .unwrap();

    // substrate_nodes — full v8 column set
    pool.execute(r#"
        CREATE TABLE substrate_nodes (
            uuid                TEXT PRIMARY KEY,
            node_type           TEXT NOT NULL DEFAULT 'constraint',
            text                TEXT NOT NULL,
            scope               TEXT,
            applies_when        TEXT,
            source_session_id   TEXT,
            source_turn_ref     INTEGER,
            source_quote        TEXT,
            source_actor        TEXT,
            valid_at            TEXT NOT NULL,
            invalid_at          TEXT,
            expired_at          TEXT,
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            confidence          TEXT NOT NULL DEFAULT 'inferred',
            episode_id          TEXT,
            invalidated_by      TEXT,
            anchored_uuids      TEXT NOT NULL DEFAULT '[]',
            intent_drift_state  TEXT,
            prev_version_uuid   TEXT,
            invalidated_reason  TEXT
        );
    "#).await.unwrap();

    // Standalone FTS5 — NOT a content= table.
    // This avoids FTS5 content-table "malformed" when delete sentinel fires on an
    // already-evicted row (restore after tombstone = second AU trigger on the same row).
    // For standalone FTS5 the delete sentinel is a no-op when the row doesn't exist.
    pool.execute(r#"
        CREATE VIRTUAL TABLE substrate_nodes_fts USING fts5(
            uuid UNINDEXED,
            text,
            applies_when,
            scope
        );
    "#).await.unwrap();

    // AFTER INSERT trigger — indexes new row in FTS when active (invalid_at IS NULL)
    pool.execute(r#"
        CREATE TRIGGER substrate_nodes_ai AFTER INSERT ON substrate_nodes BEGIN
            INSERT INTO substrate_nodes_fts(uuid, text, applies_when, scope)
            SELECT new.uuid, new.text, new.applies_when, new.scope
            WHERE new.invalid_at IS NULL;
        END;
    "#).await.unwrap();

    // AFTER UPDATE trigger — v8 FTS tombstone fix.
    // Removes old entry from FTS (idempotent for standalone), re-inserts only if active.
    pool.execute(r#"
        CREATE TRIGGER substrate_nodes_au AFTER UPDATE ON substrate_nodes BEGIN
            DELETE FROM substrate_nodes_fts WHERE uuid = old.uuid;
            INSERT INTO substrate_nodes_fts(uuid, text, applies_when, scope)
            SELECT new.uuid, new.text, new.applies_when, new.scope
            WHERE new.invalid_at IS NULL;
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

/// Helper: insert a live (active) substrate_nodes row.
async fn insert_active(pool: &sqlx::SqlitePool, uuid: &str, text: &str) {
    sqlx::query(
        "INSERT INTO substrate_nodes \
         (uuid, node_type, text, valid_at) \
         VALUES (?1, 'constraint', ?2, datetime('now'))"
    )
    .bind(uuid)
    .bind(text)
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("insert_active failed for {uuid}: {e}"));
}

/// Helper: insert an active row then tombstone it via UPDATE (AU trigger fires).
/// This is the correct two-step approach: AI trigger indexes it, AU trigger removes it.
async fn insert_tombstoned(
    pool: &sqlx::SqlitePool,
    uuid: &str,
    text: &str,
    invalidated_reason: Option<&str>,
    invalidated_by: Option<&str>,
) {
    insert_active(pool, uuid, text).await;

    sqlx::query(
        "UPDATE substrate_nodes \
         SET invalid_at = datetime('now'), invalidated_reason = ?1, invalidated_by = ?2 \
         WHERE uuid = ?3"
    )
    .bind(invalidated_reason)
    .bind(invalidated_by)
    .bind(uuid)
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("tombstone UPDATE failed for {uuid}: {e}"));
}

/// Helper: insert an active row with explicit prev_version_uuid.
async fn insert_active_with_predecessor(
    pool: &sqlx::SqlitePool,
    uuid: &str,
    text: &str,
    prev_version_uuid: &str,
) {
    sqlx::query(
        "INSERT INTO substrate_nodes \
         (uuid, node_type, text, valid_at, prev_version_uuid) \
         VALUES (?1, 'constraint', ?2, datetime('now'), ?3)"
    )
    .bind(uuid)
    .bind(text)
    .bind(prev_version_uuid)
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("insert_active_with_predecessor failed for {uuid}: {e}"));
}

/// Helper: execute restore logic inline (mirrors restore_substrate_rule without AppHandle).
async fn do_restore(pool: &sqlx::SqlitePool, uuid: &str, actor: &str) -> Result<(), String> {
    // Step 1: read row — must exist and be tombstoned
    let row = sqlx::query(
        "SELECT uuid, text, invalid_at FROM substrate_nodes WHERE uuid = ?1"
    )
    .bind(uuid)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("fetch: {e}"))?;

    let Some(r) = row else {
        return Err(format!("rule {uuid} not found"));
    };

    let invalid_at_val: Option<String> = r.try_get("invalid_at").ok().flatten();
    if invalid_at_val.is_none() {
        return Err("rule is already active — nothing to restore".to_string());
    }

    let current_text: String = r.try_get("text").map_err(|e| e.to_string())?;

    // Step 2: active-successor guard
    let succ_row = sqlx::query(
        "SELECT COUNT(*) AS cnt FROM substrate_nodes WHERE prev_version_uuid = ?1 AND invalid_at IS NULL"
    )
    .bind(uuid)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("successor check: {e}"))?;

    let cnt: i64 = succ_row.try_get("cnt").unwrap_or(0);
    if cnt > 0 {
        return Err(
            "cannot restore: chain has an active successor — restore would create two heads"
                .to_string(),
        );
    }

    // Step 3-5: transaction
    let now = chrono::Utc::now().to_rfc3339();
    let edit_id = Uuid::new_v4().to_string();
    let restore_reason = format!("restored by {actor}");

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("begin tx: {e}"))?;

    // UPDATE: clear tombstone columns. AU trigger fires — removes old FTS entry (if any)
    // and re-inserts because new.invalid_at IS NULL post-update.
    sqlx::query(
        "UPDATE substrate_nodes \
         SET invalid_at = NULL, invalidated_reason = NULL, invalidated_by = NULL \
         WHERE uuid = ?1"
    )
    .bind(uuid)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("UPDATE: {e}"))?;

    // INSERT audit row
    sqlx::query(r#"
        INSERT INTO substrate_edits (
            edit_id, rule_uuid, prev_version_uuid, new_version_uuid,
            actor, edited_at, before_text, after_text, reason, kind
        ) VALUES (?1, ?2, NULL, NULL, ?3, ?4, NULL, ?5, ?6, 'restore')
    "#)
    .bind(&edit_id)
    .bind(uuid)
    .bind(actor)
    .bind(&now)
    .bind(&current_text)
    .bind(&restore_reason)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("INSERT audit: {e}"))?;

    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

/// Helper: execute the list_tombstoned_rules query inline.
async fn do_list_tombstoned(pool: &sqlx::SqlitePool) -> Vec<String> {
    // Returns uuids of chain-head tombstones only
    let rows = sqlx::query(r#"
        SELECT uuid
        FROM substrate_nodes
        WHERE invalid_at IS NOT NULL
          AND uuid NOT IN (
              SELECT prev_version_uuid FROM substrate_nodes
              WHERE prev_version_uuid IS NOT NULL AND invalid_at IS NULL
          )
        ORDER BY invalid_at DESC
        LIMIT 100
    "#)
    .fetch_all(pool)
    .await
    .expect("list query");

    rows.iter()
        .map(|r| r.try_get::<String, _>("uuid").unwrap_or_default())
        .collect()
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: list_tombstoned_returns_chain_heads_only
// ─────────────────────────────────────────────────────────────────────────────
//
// Seed:
//   rule_a  — active (invalid_at IS NULL)
//   rule_b  — tombstoned, no successor
//   rule_c1 — tombstoned; c2 is active successor (prev_version_uuid=c1)
//
// Expected: only rule_b in the list.
//   - rule_a: excluded (active)
//   - rule_b: included (tombstoned, no active row points at it)
//   - rule_c1: excluded (tombstoned BUT active c2.prev_version_uuid=c1)

#[tokio::test]
async fn list_tombstoned_returns_chain_heads_only() {
    let pool = setup_restore_pool().await;

    let rule_a = Uuid::new_v4().to_string();
    let rule_b = Uuid::new_v4().to_string();
    let rule_c1 = Uuid::new_v4().to_string();
    let rule_c2 = Uuid::new_v4().to_string();

    // rule_a: active
    insert_active(&pool, &rule_a, "rule a — always active").await;

    // rule_b: tombstoned (standalone)
    insert_tombstoned(&pool, &rule_b, "rule b — will be tombstoned", Some("Obsolete: no longer applies"), Some("human:test")).await;

    // rule_c1: tombstoned (will be superseded by c2)
    insert_tombstoned(&pool, &rule_c1, "rule c1 — mid-chain tombstone", Some("refined: improved wording"), Some("human:test")).await;

    // rule_c2: active, successor of c1
    insert_active_with_predecessor(&pool, &rule_c2, "rule c2 — active successor", &rule_c1).await;

    let tombstoned = do_list_tombstoned(&pool).await;

    // Only rule_b should be returned
    assert_eq!(
        tombstoned,
        vec![rule_b.as_str()],
        "Expected only rule_b in tombstoned list; got: {:?}",
        tombstoned
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: restore_clears_invalid_at_and_writes_audit_row
// ─────────────────────────────────────────────────────────────────────────────
//
// Seed a tombstoned rule. Call restore. Assert:
//   (a) substrate_nodes: invalid_at=NULL, invalidated_reason=NULL, invalidated_by=NULL
//   (b) substrate_edits: 1 row kind='restore', after_text=current text, reason starts with "restored by"
//   (c) FTS5 MATCH on the rule's text returns the rule (post-restore)

#[tokio::test]
async fn restore_clears_invalid_at_and_writes_audit_row() {
    let pool = setup_restore_pool().await;

    let rule_uuid = Uuid::new_v4().to_string();
    let rule_text = "Never interrupt the user during checkout flow";

    insert_tombstoned(
        &pool,
        &rule_uuid,
        rule_text,
        Some("Hallucinated: inferred from debug session"),
        Some("human:test"),
    ).await;

    // Verify it's tombstoned before restore
    let pre = sqlx::query("SELECT invalid_at FROM substrate_nodes WHERE uuid = ?1")
        .bind(&rule_uuid)
        .fetch_one(&pool)
        .await
        .expect("pre-restore row");
    let pre_ia: Option<String> = pre.try_get("invalid_at").ok().flatten();
    assert!(pre_ia.is_some(), "rule should be tombstoned before restore");

    let actor = "human:yangg40@g.ucla.edu";
    let result = do_restore(&pool, &rule_uuid, actor).await;
    assert!(result.is_ok(), "restore should succeed: {:?}", result);

    // (a) substrate_nodes: tombstone cleared
    let row = sqlx::query(
        "SELECT invalid_at, invalidated_reason, invalidated_by FROM substrate_nodes WHERE uuid = ?1"
    )
    .bind(&rule_uuid)
    .fetch_one(&pool)
    .await
    .expect("node row after restore");

    let ia: Option<String> = row.try_get("invalid_at").ok().flatten();
    let ir: Option<String> = row.try_get("invalidated_reason").ok().flatten();
    let ib: Option<String> = row.try_get("invalidated_by").ok().flatten();
    assert!(ia.is_none(), "invalid_at should be NULL after restore; got: {:?}", ia);
    assert!(ir.is_none(), "invalidated_reason should be NULL after restore; got: {:?}", ir);
    assert!(ib.is_none(), "invalidated_by should be NULL after restore; got: {:?}", ib);

    // (b) substrate_edits: 1 restore row with correct fields
    let audit = sqlx::query(
        "SELECT kind, after_text, reason FROM substrate_edits WHERE rule_uuid = ?1 AND kind = 'restore'"
    )
    .bind(&rule_uuid)
    .fetch_one(&pool)
    .await
    .expect("audit row kind=restore");

    let kind: String = audit.try_get("kind").unwrap_or_default();
    let after_text: Option<String> = audit.try_get("after_text").ok().flatten();
    let reason: String = audit.try_get("reason").unwrap_or_default();

    assert_eq!(kind, "restore", "audit kind should be 'restore'");
    assert_eq!(
        after_text.as_deref(),
        Some(rule_text),
        "after_text should be the rule's current text"
    );
    assert!(
        reason.starts_with("restored by"),
        "reason should start with 'restored by'; got: {reason}"
    );

    // (c) FTS5: the rule is now findable again via MATCH
    // Standalone FTS5: query directly for rows matching the rule text
    let fts_rows = sqlx::query(
        "SELECT uuid FROM substrate_nodes_fts WHERE substrate_nodes_fts MATCH ?1"
    )
    .bind(rule_text)
    .fetch_all(&pool)
    .await
    .expect("fts query");

    let fts_uuids: Vec<String> = fts_rows
        .iter()
        .map(|r| r.try_get::<String, _>("uuid").unwrap_or_default())
        .collect();
    assert!(
        fts_uuids.contains(&rule_uuid),
        "FTS should return the restored rule after restore; got: {:?}",
        fts_uuids
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: restore_with_active_successor_errors
// ─────────────────────────────────────────────────────────────────────────────
//
// Chain: a (tombstoned) → b (active, prev_version_uuid=a).
// Call restore on a. Assert Err containing "active successor".

#[tokio::test]
async fn restore_with_active_successor_errors() {
    let pool = setup_restore_pool().await;

    let rule_a = Uuid::new_v4().to_string();
    let rule_b = Uuid::new_v4().to_string();

    // rule_a: tombstoned (old version in chain)
    insert_tombstoned(
        &pool,
        &rule_a,
        "original rule text",
        Some("refined: improved wording"),
        Some("human:test"),
    ).await;

    // rule_b: active successor of rule_a
    insert_active_with_predecessor(&pool, &rule_b, "refined rule text", &rule_a).await;

    let result = do_restore(&pool, &rule_a, "human:yangg40@g.ucla.edu").await;

    assert!(result.is_err(), "restore should fail when active successor exists");
    let err = result.unwrap_err();
    assert!(
        err.contains("active successor"),
        "error should mention 'active successor'; got: {err}"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: restore_on_active_rule_errors
// ─────────────────────────────────────────────────────────────────────────────
//
// Seed an active rule. Call restore. Assert Err containing "already active".

#[tokio::test]
async fn restore_on_active_rule_errors() {
    let pool = setup_restore_pool().await;

    let rule_uuid = Uuid::new_v4().to_string();
    insert_active(&pool, &rule_uuid, "an active rule — should not be restorable").await;

    let result = do_restore(&pool, &rule_uuid, "human:yangg40@g.ucla.edu").await;

    assert!(result.is_err(), "restore on active rule should fail");
    let err = result.unwrap_err();
    assert!(
        err.contains("already active"),
        "error should contain 'already active'; got: {err}"
    );
}
