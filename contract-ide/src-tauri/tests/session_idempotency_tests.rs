//! Phase 10 SC3 regression test — re-ingesting the same JSONL produces zero
//! new episode rows. Validates the INSERT OR IGNORE on episode_id PK + ON
//! CONFLICT DO UPDATE on session_id semantics.
//!
//! Uses in-memory sqlite + manual INSERT calls (not the real ingest_session_file
//! which requires a Tauri AppHandle). Mirrors the contract that ingest_session_file
//! depends on. The schema CREATE statements here MUST stay aligned with
//! `db/migrations.rs` v4 — if the migration evolves, this test must follow.

use sqlx::sqlite::SqlitePoolOptions;

async fn setup_pool() -> sqlx::SqlitePool {
    let pool = SqlitePoolOptions::new()
        .connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");

    // Apply the relevant subset of v4 migration (sessions + episodes only).
    // The CHECK constraint on state must match the production migration text exactly.
    sqlx::query(
        r#"
CREATE TABLE sessions (
    session_id       TEXT PRIMARY KEY,
    cwd_key          TEXT NOT NULL,
    repo_path        TEXT,
    started_at       TEXT NOT NULL,
    last_seen_at     TEXT NOT NULL,
    episode_count    INTEGER NOT NULL DEFAULT 0,
    bytes_raw        INTEGER NOT NULL DEFAULT 0,
    bytes_filtered   INTEGER NOT NULL DEFAULT 0,
    last_line_index  INTEGER NOT NULL DEFAULT 0,
    state            TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','ended','compacted')),
    ingested_at      TEXT NOT NULL
);
"#,
    )
    .execute(&pool)
    .await
    .expect("apply sessions schema");

    sqlx::query(
        r#"
CREATE TABLE episodes (
    episode_id       TEXT PRIMARY KEY,
    session_id       TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    start_line       INTEGER NOT NULL,
    end_line         INTEGER NOT NULL,
    filtered_text    TEXT NOT NULL,
    content_hash     TEXT NOT NULL,
    turn_count       INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT NOT NULL
);
"#,
    )
    .execute(&pool)
    .await
    .expect("apply episodes schema");

    pool
}

#[tokio::test]
async fn re_ingesting_same_file_produces_no_duplicate_episodes() {
    let pool = setup_pool().await;
    let session_id = "test-session";
    let now = "2026-04-25T00:00:00Z";

    // Seed sessions row
    sqlx::query(
        "INSERT INTO sessions (session_id, cwd_key, started_at, last_seen_at, ingested_at)
         VALUES (?1, '-test', ?2, ?2, ?2)",
    )
    .bind(session_id)
    .bind(now)
    .execute(&pool)
    .await
    .unwrap();

    // First ingest: 3 episodes
    for (i, ep_id) in ["ep-a", "ep-b", "ep-c"].iter().enumerate() {
        sqlx::query(
            "INSERT OR IGNORE INTO episodes
             (episode_id, session_id, start_line, end_line, filtered_text, content_hash, turn_count, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7)",
        )
        .bind(ep_id)
        .bind(session_id)
        .bind((i * 2) as i64)
        .bind((i * 2 + 1) as i64)
        .bind(format!("text {ep_id}"))
        .bind(format!("hash{ep_id}"))
        .bind(now)
        .execute(&pool)
        .await
        .unwrap();
    }

    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM episodes")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count.0, 3);

    // Re-ingest: same 3 episodes. INSERT OR IGNORE must skip them.
    for (i, ep_id) in ["ep-a", "ep-b", "ep-c"].iter().enumerate() {
        let res = sqlx::query(
            "INSERT OR IGNORE INTO episodes
             (episode_id, session_id, start_line, end_line, filtered_text, content_hash, turn_count, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7)",
        )
        .bind(ep_id)
        .bind(session_id)
        .bind((i * 2) as i64)
        .bind((i * 2 + 1) as i64)
        .bind(format!("text {ep_id}"))
        .bind(format!("hash{ep_id}"))
        .bind(now)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            res.rows_affected(),
            0,
            "INSERT OR IGNORE should skip duplicate {ep_id}"
        );
    }

    let count_after: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM episodes")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count_after.0, 3, "no new episodes after re-ingest");
}

#[tokio::test]
async fn session_upsert_preserves_started_at_increments_episode_count() {
    let pool = setup_pool().await;
    let session_id = "test-session-2";

    let initial = "2026-04-25T10:00:00Z";
    let later = "2026-04-25T11:00:00Z";

    // First insert
    sqlx::query(
        "INSERT INTO sessions
         (session_id, cwd_key, started_at, last_seen_at, episode_count, last_line_index, state, ingested_at)
         VALUES (?1, '-test', ?2, ?2, 1, 5, 'active', ?2)",
    )
    .bind(session_id)
    .bind(initial)
    .execute(&pool)
    .await
    .unwrap();

    // Insert one episode so the COUNT(*) subquery returns something meaningful
    sqlx::query(
        "INSERT INTO episodes (episode_id, session_id, start_line, end_line, filtered_text, content_hash, turn_count, created_at)
         VALUES ('ep-1', ?1, 0, 4, 't', 'h', 1, ?2)",
    )
    .bind(session_id)
    .bind(initial)
    .execute(&pool)
    .await
    .unwrap();

    // Second insert with ON CONFLICT DO UPDATE — should increment last_line_index, NOT change started_at
    sqlx::query(
        "INSERT INTO sessions
         (session_id, cwd_key, repo_path, started_at, last_seen_at, episode_count, bytes_raw, bytes_filtered, last_line_index, state, ingested_at)
         VALUES (?1, '-test', NULL, ?2, ?2, 2, 100, 50, 12, 'active', ?2)
         ON CONFLICT(session_id) DO UPDATE SET
           last_seen_at = excluded.last_seen_at,
           episode_count = (SELECT COUNT(*) FROM episodes WHERE session_id = ?1),
           bytes_raw = excluded.bytes_raw,
           bytes_filtered = sessions.bytes_filtered + excluded.bytes_filtered,
           last_line_index = MAX(sessions.last_line_index, excluded.last_line_index)",
    )
    .bind(session_id)
    .bind(later)
    .execute(&pool)
    .await
    .unwrap();

    let row: (String, String, i64, i64) = sqlx::query_as(
        "SELECT started_at, last_seen_at, last_line_index, episode_count FROM sessions WHERE session_id = ?1",
    )
    .bind(session_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(row.0, initial, "started_at must be preserved across upsert");
    assert_eq!(row.1, later, "last_seen_at must update");
    assert_eq!(row.2, 12, "last_line_index must take MAX(prior, new)");
    assert_eq!(row.3, 1, "episode_count from COUNT(*) subquery");
}
