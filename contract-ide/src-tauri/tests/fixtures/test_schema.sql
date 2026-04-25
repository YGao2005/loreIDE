-- Test schema for distiller kernel regression test (standalone — no migrations runner).
-- Mirrors Phase 10 sessions/episodes tables + Phase 11 substrate_nodes schema.
-- Keep in sync with db/migrations.rs phase10_session_watcher_schema and
-- phase11_substrate_schema when those migrations change.

-- Phase 10 sessions table
CREATE TABLE IF NOT EXISTS sessions (
    session_id      TEXT PRIMARY KEY,
    cwd_key         TEXT NOT NULL,
    started_at      TEXT,
    last_seen_at    TEXT,
    episode_count   INTEGER NOT NULL DEFAULT 0,
    bytes_raw       INTEGER NOT NULL DEFAULT 0,
    bytes_filtered  INTEGER NOT NULL DEFAULT 0,
    last_line_index INTEGER NOT NULL DEFAULT 0,
    state           TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','ended','error'))
);

-- Phase 10 episodes table
CREATE TABLE IF NOT EXISTS episodes (
    episode_id    TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL,
    start_line    INTEGER NOT NULL DEFAULT 0,
    end_line      INTEGER NOT NULL DEFAULT 0,
    filtered_text TEXT NOT NULL DEFAULT '',
    content_hash  TEXT,
    turn_count    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_episodes_session ON episodes(session_id);

-- Phase 11 substrate_nodes table (full schema from migration v6)
CREATE TABLE IF NOT EXISTS substrate_nodes (
    uuid              TEXT PRIMARY KEY,
    node_type         TEXT NOT NULL CHECK(node_type IN ('constraint','decision','open_question','resolved_question','attempt')),
    text              TEXT NOT NULL,
    scope             TEXT,
    applies_when      TEXT,
    source_session_id TEXT,
    source_turn_ref   INTEGER,
    source_quote      TEXT,
    source_actor      TEXT CHECK(source_actor IN ('user','claude','derived') OR source_actor IS NULL),
    valid_at          TEXT NOT NULL,
    invalid_at        TEXT,
    expired_at        TEXT,
    created_at        TEXT NOT NULL,
    confidence        TEXT NOT NULL DEFAULT 'inferred' CHECK(confidence IN ('explicit','inferred')),
    episode_id        TEXT,
    invalidated_by    TEXT REFERENCES substrate_nodes(uuid),
    anchored_uuids    TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_substrate_nodes_active   ON substrate_nodes(invalid_at) WHERE invalid_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_substrate_nodes_type     ON substrate_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_substrate_nodes_session  ON substrate_nodes(source_session_id);
CREATE INDEX IF NOT EXISTS idx_substrate_nodes_episode  ON substrate_nodes(episode_id);
CREATE INDEX IF NOT EXISTS idx_substrate_nodes_valid_at ON substrate_nodes(valid_at);

-- FTS5 virtual table for substrate_nodes
CREATE VIRTUAL TABLE IF NOT EXISTS substrate_nodes_fts USING fts5(
    uuid UNINDEXED,
    text,
    applies_when,
    scope,
    content='substrate_nodes',
    content_rowid='rowid'
);

-- FTS5 sync triggers
CREATE TRIGGER IF NOT EXISTS substrate_nodes_ai AFTER INSERT ON substrate_nodes BEGIN
    INSERT INTO substrate_nodes_fts(rowid, uuid, text, applies_when, scope)
    VALUES (new.rowid, new.uuid, new.text, new.applies_when, new.scope);
END;
CREATE TRIGGER IF NOT EXISTS substrate_nodes_au AFTER UPDATE ON substrate_nodes BEGIN
    INSERT INTO substrate_nodes_fts(substrate_nodes_fts, rowid, uuid, text, applies_when, scope)
    VALUES ('delete', old.rowid, old.uuid, old.text, old.applies_when, old.scope);
    INSERT INTO substrate_nodes_fts(rowid, uuid, text, applies_when, scope)
    VALUES (new.rowid, new.uuid, new.text, new.applies_when, new.scope);
END;
CREATE TRIGGER IF NOT EXISTS substrate_nodes_ad AFTER DELETE ON substrate_nodes BEGIN
    INSERT INTO substrate_nodes_fts(substrate_nodes_fts, rowid, uuid, text, applies_when, scope)
    VALUES ('delete', old.rowid, old.uuid, old.text, old.applies_when, old.scope);
END;

-- Dead-letter queue
CREATE TABLE IF NOT EXISTS distiller_dead_letters (
    id              TEXT PRIMARY KEY,
    episode_id      TEXT NOT NULL,
    error_kind      TEXT NOT NULL CHECK(error_kind IN ('claude_exit_nonzero','json_parse','schema_mismatch','timeout')),
    raw_output      TEXT,
    attempt_count   INTEGER NOT NULL DEFAULT 1,
    last_attempt_at TEXT NOT NULL DEFAULT (datetime('now'))
);
