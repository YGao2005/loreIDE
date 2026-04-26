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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 15 Plan 04 — TRUST-03: Delete path + impact preview
// ─────────────────────────────────────────────────────────────────────────────

/// Wire-shape for a node that currently cites the substrate rule via anchored_uuids.
#[derive(Debug, Serialize)]
pub struct AtomCitation {
    pub uuid: String,
    pub name: String,
    pub kind: String,
    pub level: i64,
}

/// Wire-shape for a recent receipt that included this rule in substrate_rules_json.
#[derive(Debug, Serialize)]
pub struct RecentPromptSummary {
    pub receipt_id: String,
    pub created_at: String,
    /// Best-effort excerpt (raw_summary if present; empty string otherwise).
    pub prompt_excerpt: String,
}

/// Aggregate returned by `get_substrate_impact`.
#[derive(Debug, Serialize)]
pub struct SubstrateImpact {
    pub atom_count: i64,
    /// Capped at 50 rows — UI shows first 10 + "and N more".
    pub atoms: Vec<AtomCitation>,
    pub recent_prompt_count: i64,
    /// Capped at 50 rows — UI shows first 5 + "and N more".
    pub recent_prompts: Vec<RecentPromptSummary>,
}

/// Allowed wire values for the reason picker (mirrors DeleteRuleConfirmDialog REASONS).
const ALLOWED_REASON_KINDS: &[&str] = &["Hallucinated", "Obsolete", "Wrong scope", "Duplicate", "Other"];

/// Phase 15 Plan 04 — Atomic delete: tombstone substrate_nodes + write audit row.
///
/// **Transaction steps (all-or-nothing):**
///   1. Validate reason_kind is one of the 5 allowed values.
///   2. Validate that reason_kind == "Other" implies non-empty reason_text.
///   3. SELECT the current live row — if None, return clean Err (no double-tombstone).
///   4. Begin transaction.
///   5. UPDATE substrate_nodes SET invalid_at=now, invalidated_reason='<kind>: <text>',
///      invalidated_by=actor WHERE uuid=?1 AND invalid_at IS NULL.
///   6. INSERT substrate_edits row kind='delete' with before_text=old text, after_text=NULL.
///   7. COMMIT.
///
/// FTS trigger fires automatically on UPDATE: removes old row from FTS and does NOT
/// re-insert it (WHERE new.invalid_at IS NULL guard suppresses re-insert).
///
/// Actor format: "human:<email>" (hardcoded to yangg40@g.ucla.edu for v1).
/// TODO(v2): read actor from settings / auth session instead of passing from frontend.
#[tauri::command]
pub async fn delete_substrate_rule(
    app: tauri::AppHandle,
    uuid: String,
    reason_kind: String,  // "Hallucinated" | "Obsolete" | "Wrong scope" | "Duplicate" | "Other"
    reason_text: String,  // free-text; required when reason_kind == "Other"
    actor: String,        // "human:<email>"
) -> Result<(), String> {
    // ── Step 1: Validate reason_kind ─────────────────────────────────────────
    if !ALLOWED_REASON_KINDS.contains(&reason_kind.as_str()) {
        return Err(format!(
            "invalid reason_kind '{}'; must be one of: {}",
            reason_kind,
            ALLOWED_REASON_KINDS.join(", ")
        ));
    }

    // ── Step 2: Validate Other requires non-empty free-text ──────────────────
    if reason_kind == "Other" && reason_text.trim().is_empty() {
        return Err("free-text required when reason is Other".to_string());
    }

    let pool = pool_clone(&app).await?;

    // ── Step 3: Read old row (guards against double-tombstone) ────────────────
    let row = sqlx::query(
        "SELECT text FROM substrate_nodes WHERE uuid = ?1 AND invalid_at IS NULL",
    )
    .bind(&uuid)
    .fetch_optional(&pool)
    .await
    .map_err(|e| format!("delete_substrate_rule fetch: {e}"))?;

    let Some(old_row) = row else {
        return Err(format!(
            "rule {uuid} not found or already tombstoned"
        ));
    };

    let old_text: String = old_row.try_get("text").map_err(|e| e.to_string())?;

    // ── Step 4-7: Transaction ─────────────────────────────────────────────────
    let now = chrono::Utc::now().to_rfc3339();
    let invalidated_reason = format!("{reason_kind}: {reason_text}");
    let edit_id = uuid::Uuid::new_v4().to_string();

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("delete_substrate_rule begin tx: {e}"))?;

    // UPDATE: stamp invalid_at + invalidated_reason + invalidated_by.
    // WHERE includes AND invalid_at IS NULL as a race guard.
    sqlx::query(
        "UPDATE substrate_nodes \
         SET invalid_at = ?1, invalidated_reason = ?2, invalidated_by = ?3 \
         WHERE uuid = ?4 AND invalid_at IS NULL",
    )
    .bind(&now)
    .bind(&invalidated_reason)
    .bind(&actor)
    .bind(&uuid)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("delete_substrate_rule UPDATE: {e}"))?;

    // INSERT audit row.
    // rule_uuid = the deleted row's uuid (no new chain row is created on delete).
    // prev_version_uuid = NULL (delete doesn't follow the chain version link).
    // new_version_uuid  = NULL (no replacement).
    // after_text        = NULL (the rule is gone).
    sqlx::query(
        r#"
        INSERT INTO substrate_edits (
            edit_id, rule_uuid, prev_version_uuid, new_version_uuid,
            actor, edited_at, before_text, after_text, reason, kind
        ) VALUES (?1, ?2, NULL, NULL, ?3, ?4, ?5, NULL, ?6, 'delete')
        "#,
    )
    .bind(&edit_id)
    .bind(&uuid)
    .bind(&actor)
    .bind(&now)
    .bind(&old_text)
    .bind(&invalidated_reason)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("delete_substrate_rule INSERT substrate_edits: {e}"))?;

    tx.commit()
        .await
        .map_err(|e| format!("delete_substrate_rule commit: {e}"))?;

    // FTS UPDATE trigger fires automatically — removes old row from FTS and does NOT
    // re-insert it because new.invalid_at IS NOT NULL (WHERE guard suppresses).

    Ok(())
}

/// Phase 15 Plan 04 — Impact preview: counts + lists of atoms + recent receipts.
///
/// Two independent queries (no transaction needed — reads only):
///   (a) Atoms citing the rule via `substrate_nodes.anchored_uuids` JSON array —
///       uses `json_each()` per RESEARCH §Pattern 6.
///   (b) Recent agent receipts (past 7 days) that included this rule UUID in
///       `receipts.substrate_rules_json` — LIKE '%uuid%' coarse match (acceptable
///       because UUIDs are unique enough that false positives are statistically zero).
///
/// Returns SubstrateImpact { atom_count, atoms[≤50], recent_prompt_count, recent_prompts[≤50] }.
/// UI caps display at 10 atoms + 5 recent prompts; the 50-row fetch avoids a second
/// COUNT(*) query by letting Rust measure the full Vec length before truncation.
#[tauri::command]
pub async fn get_substrate_impact(
    app: tauri::AppHandle,
    uuid: String,
) -> Result<SubstrateImpact, String> {
    let pool = pool_clone(&app).await?;

    // ── (a) Atoms citing via anchored_uuids JSON array ────────────────────────
    // Use json_each(s.anchored_uuids) to expand the JSON array and cross-join
    // with nodes to get atom name/kind/level.  The substrate rule's uuid is in
    // the anchored_uuids array of the SUBSTRATE node that anchors those atoms,
    // OR in the nodes.anchored_uuids if nodes carry their citing rules directly.
    //
    // Per RESEARCH §Pattern 6: substrate_nodes carries anchored_uuids pointing
    // to the GRAPH NODES (atoms) that this rule governs.  So we walk the rule's
    // anchored_uuids to find which atoms cite it.
    let atom_rows = sqlx::query(
        r#"
        SELECT n.uuid, COALESCE(n.name, n.uuid) AS name, COALESCE(n.kind, '') AS kind,
               COALESCE(n.level, 0) AS level
        FROM substrate_nodes s, json_each(s.anchored_uuids) je
        JOIN nodes n ON n.uuid = je.value
        WHERE s.uuid = ?1
        LIMIT 50
        "#,
    )
    .bind(&uuid)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("get_substrate_impact atoms query: {e}"))?;

    // Atom count via a separate COUNT(*) query (avoids fetching all rows just to count).
    let atom_count_row = sqlx::query(
        r#"
        SELECT COUNT(*) AS atom_count
        FROM substrate_nodes s, json_each(s.anchored_uuids) je
        WHERE s.uuid = ?1
        "#,
    )
    .bind(&uuid)
    .fetch_one(&pool)
    .await
    .map_err(|e| format!("get_substrate_impact atom_count query: {e}"))?;

    let atom_count: i64 = atom_count_row.try_get("atom_count").unwrap_or(0);

    let mut atoms: Vec<AtomCitation> = Vec::with_capacity(atom_rows.len());
    for row in &atom_rows {
        atoms.push(AtomCitation {
            uuid: row.try_get("uuid").unwrap_or_default(),
            name: row.try_get("name").unwrap_or_default(),
            kind: row.try_get("kind").unwrap_or_default(),
            level: row.try_get("level").unwrap_or(0),
        });
    }

    // ── (b) Recent receipts (past 7 days) referencing this rule UUID ──────────
    // Reads receipts.substrate_rules_json column from Plan 15-01.
    // COALESCE(raw_summary, '') used as prompt_excerpt (best-effort; may be empty).
    // LIKE '%uuid%' is a coarse string match — acceptable because UUIDs have enough
    // entropy that false-positive matches are statistically negligible.
    let prompt_rows = sqlx::query(
        r#"
        SELECT id, created_at, COALESCE(raw_summary, '') AS prompt_excerpt
        FROM receipts
        WHERE created_at > datetime('now', '-7 days')
          AND substrate_rules_json IS NOT NULL
          AND substrate_rules_json LIKE '%' || ?1 || '%'
        ORDER BY created_at DESC
        LIMIT 50
        "#,
    )
    .bind(&uuid)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("get_substrate_impact prompts query: {e}"))?;

    let recent_prompt_count_row = sqlx::query(
        r#"
        SELECT COUNT(*) AS recent_prompt_count
        FROM receipts
        WHERE created_at > datetime('now', '-7 days')
          AND substrate_rules_json IS NOT NULL
          AND substrate_rules_json LIKE '%' || ?1 || '%'
        "#,
    )
    .bind(&uuid)
    .fetch_one(&pool)
    .await
    .map_err(|e| format!("get_substrate_impact prompt_count query: {e}"))?;

    let recent_prompt_count: i64 = recent_prompt_count_row.try_get("recent_prompt_count").unwrap_or(0);

    let mut recent_prompts: Vec<RecentPromptSummary> = Vec::with_capacity(prompt_rows.len());
    for row in &prompt_rows {
        let excerpt: String = row.try_get("prompt_excerpt").unwrap_or_default();
        // Truncate to ~120 chars for wire-efficiency
        let prompt_excerpt = if excerpt.len() > 120 {
            format!("{}…", &excerpt[..120])
        } else {
            excerpt
        };
        recent_prompts.push(RecentPromptSummary {
            receipt_id: row.try_get("id").unwrap_or_default(),
            created_at: row.try_get("created_at").unwrap_or_default(),
            prompt_excerpt,
        });
    }

    Ok(SubstrateImpact {
        atom_count,
        atoms,
        recent_prompt_count,
        recent_prompts,
    })
}
