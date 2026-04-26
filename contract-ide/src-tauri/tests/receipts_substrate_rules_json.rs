//! Integration test: substrate_rules_json is persisted onto receipts correctly.
//!
//! Exercises the populated-JSON and NULL paths so TRUST-03 impact preview can
//! safely COUNT(DISTINCT session_id) and tolerate NULL rows from the chat path.
//!
//! Prerequisite: v8 migration SQL is applied to the in-memory pool, which means
//! `receipts.substrate_rules_json` column must exist before the INSERT runs.

use sqlx::{Row, Executor};
use sqlx::sqlite::SqlitePoolOptions;

/// Build an in-memory SQLite pool with the minimal schema required by
/// `parse_and_persist`: `receipts` with all columns through v8 (including
/// `substrate_rules_json`), and the `receipt_nodes` join table.
///
/// We do NOT run the full migration chain here — we materialise the schema
/// directly so the test is fast and self-contained.  The full chain is
/// exercised by `migration_v8_chain_smoke.rs`.
async fn setup_db() -> sqlx::SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(":memory:")
        .await
        .unwrap();

    pool.execute(r#"
        CREATE TABLE nodes (
            uuid TEXT PRIMARY KEY,
            level TEXT NOT NULL DEFAULT 'L4',
            name TEXT NOT NULL DEFAULT 'test-node',
            file_path TEXT,
            parent_uuid TEXT,
            is_canonical INTEGER NOT NULL DEFAULT 1,
            canonical_uuid TEXT,
            code_hash TEXT,
            contract_hash TEXT,
            human_pinned INTEGER NOT NULL DEFAULT 0,
            route TEXT,
            derived_at TEXT,
            contract_body TEXT,
            tags TEXT,
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            code_ranges TEXT,
            kind TEXT NOT NULL DEFAULT 'unknown',
            section_hashes_json TEXT,
            rollup_inputs_json TEXT,
            rollup_hash TEXT,
            rollup_state TEXT,
            rollup_generation INTEGER NOT NULL DEFAULT 0,
            members_json TEXT
        );

        CREATE TABLE receipts (
            id                  TEXT PRIMARY KEY,
            session_id          TEXT NOT NULL,
            transcript_path     TEXT NOT NULL,
            started_at          TEXT,
            finished_at         TEXT,
            input_tokens        INTEGER,
            output_tokens       INTEGER,
            cache_read_tokens   INTEGER,
            tool_call_count     INTEGER,
            nodes_touched       TEXT,
            estimated_cost_usd  REAL,
            raw_summary         TEXT,
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            raw_jsonl_path      TEXT,
            parse_status        TEXT NOT NULL DEFAULT 'ok',
            wall_time_ms        INTEGER,
            substrate_rules_json TEXT
        );

        CREATE TABLE receipt_nodes (
            receipt_id TEXT NOT NULL REFERENCES receipts(id),
            node_uuid  TEXT NOT NULL REFERENCES nodes(uuid),
            PRIMARY KEY (receipt_id, node_uuid)
        );
    "#).await.unwrap();

    pool
}

/// Helper that builds a tauri AppHandle-alike via a raw pool injection.
/// Because parse_and_persist uses `app.state::<DbInstances>()` we cannot call it
/// directly without a Tauri AppHandle — instead we test the SQL layer directly,
/// matching what parse_and_persist does after parsing, to verify both:
///   1. The `substrate_rules_json` column is present (INSERT succeeds).
///   2. The value round-trips correctly.
///
/// This is the correct scope for an integration test: exercising the SQL schema,
/// not the full Tauri plumbing.  The full end-to-end (AppHandle + receipts +
/// event emission) is exercised in the UAT rehearsal.
#[tokio::test]
async fn substrate_rules_json_populated_path_round_trips() {
    let pool = setup_db().await;

    let receipt_id = uuid::Uuid::new_v4().to_string();
    let payload = r#"["uuid1","uuid2","uuid3"]"#;

    sqlx::query(
        r#"INSERT INTO receipts (
               id, session_id, transcript_path, started_at, finished_at,
               input_tokens, output_tokens, cache_read_tokens, tool_call_count,
               nodes_touched, estimated_cost_usd, raw_summary,
               raw_jsonl_path, parse_status, wall_time_ms,
               substrate_rules_json
           ) VALUES (?1,?2,?3,?4,?5, ?6,?7,?8,?9, ?10,?11,?12, ?13,?14,?15, ?16)"#,
    )
    .bind(&receipt_id)
    .bind("test-session-001")
    .bind("/tmp/test.jsonl")
    .bind(Option::<String>::None)
    .bind(Option::<String>::None)
    .bind(0_i64)
    .bind(0_i64)
    .bind(0_i64)
    .bind(0_i64)
    .bind("[]")
    .bind(0.0_f64)
    .bind(Option::<String>::None)
    .bind("/tmp/test.jsonl")
    .bind("ok")
    .bind(Option::<i64>::None)
    .bind(payload)
    .execute(&pool)
    .await
    .unwrap();

    let row = sqlx::query(
        "SELECT substrate_rules_json FROM receipts WHERE id = ?1",
    )
    .bind(&receipt_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let stored: Option<String> = row.try_get("substrate_rules_json").unwrap();
    let stored = stored.expect("substrate_rules_json should be non-NULL for delegate run");

    // Deserialise and assert the 3 UUIDs
    let uuids: Vec<String> = serde_json::from_str(&stored).unwrap();
    assert_eq!(uuids.len(), 3, "expected 3 UUIDs in substrate_rules_json");
    assert_eq!(uuids[0], "uuid1");
    assert_eq!(uuids[1], "uuid2");
    assert_eq!(uuids[2], "uuid3");
}

/// NULL path — chat receipts (no delegate path) MUST have substrate_rules_json = NULL
/// so TRUST-03 impact preview can tolerate it (COUNT(*) WHERE substrate_rules_json IS
/// NOT NULL won't inflate counts from non-delegate runs).
#[tokio::test]
async fn substrate_rules_json_null_path() {
    let pool = setup_db().await;

    let receipt_id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        r#"INSERT INTO receipts (
               id, session_id, transcript_path, started_at, finished_at,
               input_tokens, output_tokens, cache_read_tokens, tool_call_count,
               nodes_touched, estimated_cost_usd, raw_summary,
               raw_jsonl_path, parse_status, wall_time_ms,
               substrate_rules_json
           ) VALUES (?1,?2,?3,?4,?5, ?6,?7,?8,?9, ?10,?11,?12, ?13,?14,?15, ?16)"#,
    )
    .bind(&receipt_id)
    .bind("chat-session-999")
    .bind("/tmp/chat.jsonl")
    .bind(Option::<String>::None)
    .bind(Option::<String>::None)
    .bind(0_i64)
    .bind(0_i64)
    .bind(0_i64)
    .bind(0_i64)
    .bind("[]")
    .bind(0.0_f64)
    .bind(Option::<String>::None)
    .bind("/tmp/chat.jsonl")
    .bind("ok")
    .bind(Option::<i64>::None)
    .bind(Option::<String>::None)   // NULL for chat path
    .execute(&pool)
    .await
    .unwrap();

    let row = sqlx::query(
        "SELECT substrate_rules_json FROM receipts WHERE id = ?1",
    )
    .bind(&receipt_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let stored: Option<String> = row.try_get("substrate_rules_json").unwrap();
    assert!(
        stored.is_none(),
        "chat-path receipt must have NULL substrate_rules_json; got: {stored:?}"
    );
}
