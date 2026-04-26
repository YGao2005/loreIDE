// Phase 15 Plan 03 — TRUST-02: Refine substrate rule + chain history IPC.
//
// Two commands:
//   refine_substrate_rule — atomically writes the new chain row, invalidates the
//     old row, and inserts a substrate_edits audit row in a single SQLite
//     transaction. Mirrors the supersession/queries.rs::write_supersession pattern.
//   get_substrate_chain — recursive CTE walk from a given UUID back through
//     prev_version_uuid to the chain origin, returning versions oldest→newest with
//     joined audit metadata (actor, reason) from substrate_edits.
//
// Actor is hardcoded to 'human:yangg40@g.ucla.edu' for v1 (supplied by frontend).
// TODO(v2): read actor from settings / auth session instead of hardcoding on frontend.
//
// Pool-extraction pattern: mirrors commands/substrate.rs pool_clone helper.
// Serialization slot: appended AFTER existing substrate commands in lib.rs
//   (commands::substrate::find_substrate_by_intent) — Wave 3 serialization_hint.

use serde::Serialize;
use sqlx::Row;
use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool};

/// Pool-clone helper (mirrors commands/substrate.rs::pool_clone exactly).
async fn pool_clone(app: &tauri::AppHandle) -> Result<sqlx::SqlitePool, String> {
    let instances = app.state::<DbInstances>();
    let db_map = instances.0.read().await;
    let db = db_map
        .get("sqlite:contract-ide.db")
        .ok_or_else(|| "DB not loaded".to_string())?;
    let pool = match db {
        DbPool::Sqlite(p) => p.clone(),
        #[allow(unreachable_patterns)]
        _ => return Err("expected sqlite pool".into()),
    };
    Ok(pool)
}

/// Wire-shape for a single version in the chain returned by `get_substrate_chain`.
///
/// `version_number` is 1-indexed from oldest — assigned in Rust after the query
/// sorts by `valid_at ASC`.
///
/// `actor`, `before_text`, and `reason` come from a LEFT JOIN on `substrate_edits`
/// for the `refine` edit that PRODUCED this version.  They are NULL for the
/// chain-origin row (no refine produced it).
#[derive(Debug, Serialize)]
pub struct ChainVersion {
    pub version_number: i64,
    pub uuid: String,
    pub text: String,
    pub applies_when: Option<String>,
    pub valid_at: String,
    pub invalid_at: Option<String>,
    pub invalidated_reason: Option<String>,
    pub prev_version_uuid: Option<String>,
    /// Actor who performed the refine that produced this version (NULL for origin).
    pub actor: Option<String>,
    /// Text of the version being refined away (NULL for origin).
    pub before_text: Option<String>,
    /// Human reason supplied at refine time (NULL for origin).
    pub reason: Option<String>,
}

/// Phase 15 Plan 03 — Atomic refine: write new chain row + invalidate old + audit.
///
/// **Transaction steps (all-or-nothing):**
///   1. SELECT old row — if missing or already tombstoned (invalid_at IS NOT NULL),
///      return Err without any write.
///   2. INSERT new row copying non-editable columns from old, overriding text /
///      applies_when / timestamps / prev_version_uuid.
///   3. UPDATE old row: set invalid_at=now, invalidated_reason='refined: <reason>'.
///   4. INSERT substrate_edits audit row (kind='refine').
///   5. COMMIT.
///
/// FTS triggers from Plan 15-01 fire automatically inside the transaction:
///   - substrate_nodes_ai trigger indexes the new row on INSERT.
///   - substrate_nodes_au trigger removes the old row from FTS on UPDATE and
///     suppresses re-insertion because new.invalid_at IS NOT NULL.
///
/// **`before_text` audit field:** stores the old row's `text` only (v1).
/// `applies_when` changes are NOT captured in the before/after audit columns —
/// accepted limitation for v1; text contains the load-bearing rationale content.
/// TODO(v2): store JSON {"text": ..., "applies_when": ...} in before_text/after_text.
///
/// Returns the new chain-head UUID on success.
#[tauri::command]
pub async fn refine_substrate_rule(
    app: tauri::AppHandle,
    uuid: String,
    new_text: String,
    new_applies_when: Option<String>,
    reason: String,
    actor: String,
) -> Result<String, String> {
    let pool = pool_clone(&app).await?;

    // ── Step 1: Read old row ──────────────────────────────────────────────────
    // Fetch the old row's current text for the audit before_text field.
    // If the row doesn't exist or is already tombstoned, return a clean error
    // (distiller race condition — UI surfaces this as a red toast, no partial write).
    let row = sqlx::query(
        "SELECT text, applies_when FROM substrate_nodes WHERE uuid = ?1 AND invalid_at IS NULL",
    )
    .bind(&uuid)
    .fetch_optional(&pool)
    .await
    .map_err(|e| format!("refine_substrate_rule fetch: {e}"))?;

    let Some(old_row) = row else {
        return Err(format!(
            "rule {uuid} not found or already tombstoned — cannot refine"
        ));
    };

    let old_text: String = old_row.try_get("text").map_err(|e| e.to_string())?;

    // ── Step 2: Generate new identifiers ─────────────────────────────────────
    let new_uuid = uuid::Uuid::new_v4().to_string();
    let edit_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let invalidated_reason = format!("refined: {reason}");

    // ── Step 3: Single transaction (read already done above, now write) ──────
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("refine_substrate_rule begin tx: {e}"))?;

    // INSERT new row — copies all structural columns from old row, overrides
    // the editable fields (text, applies_when) and the chain/timestamp fields.
    // SELECT-INSERT pattern ensures we don't have to list every column explicitly
    // — future column additions to substrate_nodes are inherited automatically.
    sqlx::query(
        r#"
        INSERT INTO substrate_nodes (
            uuid, node_type, text, scope, applies_when,
            source_session_id, source_turn_ref, source_quote, source_actor,
            valid_at, invalid_at, expired_at, created_at,
            confidence, episode_id, invalidated_by, anchored_uuids,
            prev_version_uuid
        )
        SELECT
            ?1,          -- new uuid
            node_type,
            ?2,          -- new_text
            scope,
            ?3,          -- new_applies_when
            source_session_id, source_turn_ref, source_quote, source_actor,
            ?4,          -- valid_at = now
            NULL,        -- invalid_at = NULL (this is the new chain head)
            NULL,        -- expired_at = NULL
            ?4,          -- created_at = now
            confidence, episode_id,
            NULL,        -- invalidated_by = NULL
            anchored_uuids,
            ?5           -- prev_version_uuid = old uuid
        FROM substrate_nodes WHERE uuid = ?5
        "#,
    )
    .bind(&new_uuid)
    .bind(&new_text)
    .bind(&new_applies_when)
    .bind(&now)
    .bind(&uuid)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("refine_substrate_rule INSERT new row: {e}"))?;

    // UPDATE old row: stamp invalid_at + invalidated_reason.
    // The WHERE clause includes `AND invalid_at IS NULL` as a double-check
    // against races (another writer could have tombstoned between our SELECT
    // and this UPDATE — rows_affected == 0 means the race happened).
    let result = sqlx::query(
        "UPDATE substrate_nodes SET invalid_at = ?1, invalidated_reason = ?2 WHERE uuid = ?3 AND invalid_at IS NULL",
    )
    .bind(&now)
    .bind(&invalidated_reason)
    .bind(&uuid)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("refine_substrate_rule UPDATE old row: {e}"))?;

    if result.rows_affected() == 0 {
        // Race: another writer tombstoned the row between our SELECT and this UPDATE.
        tx.rollback()
            .await
            .map_err(|e| format!("refine_substrate_rule rollback: {e}"))?;
        return Err(format!(
            "rule {uuid} already tombstoned — cannot refine"
        ));
    }

    // INSERT audit row in substrate_edits.
    // rule_uuid = new_uuid (the rule this edit tracks; the new chain head).
    // before_text = old row's text; after_text = new_text.
    sqlx::query(
        r#"
        INSERT INTO substrate_edits (
            edit_id, rule_uuid, prev_version_uuid, new_version_uuid,
            actor, edited_at, before_text, after_text, reason, kind
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'refine')
        "#,
    )
    .bind(&edit_id)
    .bind(&new_uuid)
    .bind(&uuid)
    .bind(&new_uuid)
    .bind(&actor)
    .bind(&now)
    .bind(&old_text)
    .bind(&new_text)
    .bind(&reason)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("refine_substrate_rule INSERT substrate_edits: {e}"))?;

    tx.commit()
        .await
        .map_err(|e| format!("refine_substrate_rule commit: {e}"))?;

    Ok(new_uuid)
}

/// Phase 15 Plan 03 — Walk the prev_version_uuid chain via recursive CTE.
///
/// The input `uuid` can be any node in the chain (any version — head or historical).
/// The CTE walks BACKWARDS through prev_version_uuid to reach the oldest ancestor,
/// collecting all nodes up to depth 50 (guards against runaway chains in corrupt data).
/// Results are sorted by `valid_at ASC` (oldest first) and version_number assigned
/// 1-indexed in Rust after the query.
///
/// Each row is LEFT JOINed with substrate_edits on `new_version_uuid = chain.uuid AND
/// kind = 'refine'` to surface the actor/reason that produced each version.
/// The chain-origin row has no matching substrate_edits row so actor/reason are NULL.
///
/// Returns Vec<ChainVersion> oldest→newest.
#[tauri::command]
pub async fn get_substrate_chain(
    app: tauri::AppHandle,
    uuid: String,
) -> Result<Vec<ChainVersion>, String> {
    let pool = pool_clone(&app).await?;

    // Recursive CTE: start from the given uuid, then walk prev_version_uuid
    // to collect ALL ancestors up to depth 50.
    // The ORDER BY valid_at ASC in the outer SELECT ensures oldest-first ordering
    // which is required for correct 1-indexed version_number assignment.
    let rows = sqlx::query(
        r#"
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
        SELECT chain.uuid, chain.text, chain.applies_when,
               chain.valid_at, chain.invalid_at, chain.invalidated_reason,
               chain.prev_version_uuid,
               se.actor, se.before_text, se.reason
        FROM chain
        LEFT JOIN substrate_edits se
            ON se.new_version_uuid = chain.uuid
           AND se.kind = 'refine'
        ORDER BY chain.valid_at ASC
        "#,
    )
    .bind(&uuid)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("get_substrate_chain query: {e}"))?;

    let mut versions: Vec<ChainVersion> = Vec::with_capacity(rows.len());
    for (i, row) in rows.iter().enumerate() {
        let uuid_val: String = row.try_get("uuid").map_err(|e| e.to_string())?;
        let text: String = row.try_get("text").map_err(|e| e.to_string())?;
        let applies_when: Option<String> = row.try_get("applies_when").ok().flatten();
        let valid_at: String = row.try_get("valid_at").map_err(|e| e.to_string())?;
        let invalid_at: Option<String> = row.try_get("invalid_at").ok().flatten();
        let invalidated_reason: Option<String> = row.try_get("invalidated_reason").ok().flatten();
        let prev_version_uuid: Option<String> = row.try_get("prev_version_uuid").ok().flatten();
        let actor: Option<String> = row.try_get("actor").ok().flatten();
        let before_text: Option<String> = row.try_get("before_text").ok().flatten();
        let reason: Option<String> = row.try_get("reason").ok().flatten();

        versions.push(ChainVersion {
            version_number: (i + 1) as i64,
            uuid: uuid_val,
            text,
            applies_when,
            valid_at,
            invalid_at,
            invalidated_reason,
            prev_version_uuid,
            actor,
            before_text,
            reason,
        });
    }

    Ok(versions)
}
