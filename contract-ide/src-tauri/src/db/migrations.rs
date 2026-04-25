// WARNING: This migration is immutable once it has run against ANY developer's DB.
// Never modify `sql` or `description` on an existing Migration. Add a v2 migration
// for schema changes (RESEARCH.md Pitfall 5 / tauri-plugin-sql versioning rule).
//
// Rationale: tauri-plugin-sql tracks applied migrations by (version, description).
// Editing either field silently orphans the existing row: the plugin sees a "new"
// migration and tries to re-apply it, OR (worse) considers the schema up-to-date
// while our SQL has diverged. In parallel dev sessions we cannot rely on every
// teammate nuking their local DB.

use tauri_plugin_sql::{Migration, MigrationKind};

/// Returns the ordered list of SQL migrations applied by `tauri-plugin-sql` for
/// the primary `sqlite:contract-ide.db` database.
///
/// v1 lays down the full Phase 1 schema (RESEARCH.md Pattern 2) plus the
/// `receipt_nodes` join table, every index DATA-06 mandates, the FTS5 virtual
/// table for intent search, and enables WAL journal mode (via the pragma at
/// the top of the SQL payload) so the Phase 5 MCP sidecar's read-only
/// connection does not block writers (Open Question 2).
pub fn get_migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create_core_tables",
        sql: r#"
PRAGMA journal_mode = WAL;

-- Phase 2 migration will add code_ranges TEXT (JSON) per DATA-01; do NOT edit this migration.
CREATE TABLE IF NOT EXISTS nodes (
  uuid            TEXT PRIMARY KEY,
  level           TEXT NOT NULL CHECK(level IN ('L0','L1','L2','L3','L4')),
  name            TEXT NOT NULL,
  file_path       TEXT,
  parent_uuid     TEXT REFERENCES nodes(uuid),
  is_canonical    INTEGER NOT NULL DEFAULT 1,
  canonical_uuid  TEXT REFERENCES nodes(uuid),
  code_hash       TEXT,
  contract_hash   TEXT,
  human_pinned    INTEGER NOT NULL DEFAULT 0,
  route           TEXT,
  derived_at      TEXT,
  contract_body   TEXT,
  tags            TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS edges (
  id          TEXT PRIMARY KEY,
  source_uuid TEXT NOT NULL REFERENCES nodes(uuid),
  target_uuid TEXT NOT NULL REFERENCES nodes(uuid),
  edge_type   TEXT NOT NULL,
  label       TEXT
);

CREATE TABLE IF NOT EXISTS node_flows (
  node_uuid TEXT NOT NULL REFERENCES nodes(uuid),
  flow_uuid TEXT NOT NULL REFERENCES nodes(uuid),
  PRIMARY KEY (node_uuid, flow_uuid)
);

CREATE TABLE IF NOT EXISTS drift_state (
  node_uuid           TEXT PRIMARY KEY REFERENCES nodes(uuid),
  current_code_hash   TEXT NOT NULL,
  contract_code_hash  TEXT NOT NULL,
  drifted_at          TEXT NOT NULL,
  reconciled_at       TEXT
);

CREATE TABLE IF NOT EXISTS receipts (
  id                 TEXT PRIMARY KEY,
  session_id         TEXT NOT NULL,
  transcript_path    TEXT NOT NULL,
  started_at         TEXT,
  finished_at        TEXT,
  input_tokens       INTEGER,
  output_tokens      INTEGER,
  cache_read_tokens  INTEGER,
  tool_call_count    INTEGER,
  nodes_touched      TEXT,
  estimated_cost_usd REAL,
  raw_summary        TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS receipt_nodes (
  receipt_id TEXT NOT NULL REFERENCES receipts(id),
  node_uuid  TEXT NOT NULL REFERENCES nodes(uuid),
  PRIMARY KEY (receipt_id, node_uuid)
);

CREATE INDEX IF NOT EXISTS idx_nodes_parent_uuid ON nodes(parent_uuid);
CREATE INDEX IF NOT EXISTS idx_nodes_file_path   ON nodes(file_path);
CREATE INDEX IF NOT EXISTS idx_nodes_level       ON nodes(level);
CREATE INDEX IF NOT EXISTS idx_node_flows_flow   ON node_flows(flow_uuid);
-- receipts→nodes goes through the join table; effective index lives on the join.
CREATE INDEX IF NOT EXISTS idx_receipts_node_uuid ON receipt_nodes(node_uuid);
-- Partial index: Phase 5 MCP `list_drifted_nodes` becomes O(drifted) not O(all).
CREATE INDEX IF NOT EXISTS idx_drift_drifted ON drift_state(reconciled_at)
  WHERE reconciled_at IS NULL;

CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
  uuid UNINDEXED,
  name,
  contract_body,
  tags,
  content='nodes',
  content_rowid='rowid'
);
"#,
        kind: MigrationKind::Up,
    },
    Migration {
        version: 2,
        description: "add_code_ranges_and_kind",
        sql: r#"
-- DATA-01: code_ranges replaces the flat file_path column for fragment coverage.
-- Stored as a JSON TEXT blob containing [{file, start_line, end_line}].
ALTER TABLE nodes ADD COLUMN code_ranges TEXT;

-- kind encodes node type (UI | API | data | job). DEFAULT 'unknown' is required
-- because SQLite ALTER TABLE cannot add a NOT NULL column without a default
-- (Pitfall 2 in 02-RESEARCH.md). Existing rows inherit 'unknown'; Phase 6
-- derivation will backfill the real values.
ALTER TABLE nodes ADD COLUMN kind TEXT NOT NULL DEFAULT 'unknown';
"#,
        kind: MigrationKind::Up,
    },
    // WARNING: v3 is immutable once shipped. Do NOT modify sql or description.
    // Phase 8 Plan 08-01 — propagation columns + rollup_derived + receipts extensions.
    Migration {
        version: 3,
        description: "phase8_propagation_and_receipts",
        sql: r#"
-- Add Phase 8 propagation columns to nodes (all nullable; lazy migration —
-- values are populated on first v3 write, NOT bulk-backfilled on startup).
ALTER TABLE nodes ADD COLUMN section_hashes_json TEXT;    -- JSON object {"section_name": "sha256"}
ALTER TABLE nodes ADD COLUMN rollup_inputs_json TEXT;     -- JSON array of {child_uuid, sections[]}
ALTER TABLE nodes ADD COLUMN rollup_hash TEXT;
ALTER TABLE nodes ADD COLUMN rollup_state TEXT;           -- 'fresh' | 'stale' | 'untracked' | NULL (L0/L4)
ALTER TABLE nodes ADD COLUMN rollup_generation INTEGER NOT NULL DEFAULT 0;

-- rollup_derived: computed rollup state per node, mirrors drift_state pattern (Phase 7).
-- Populated by the rollup detection engine (08-02) on startup + watcher + post-write.
CREATE TABLE rollup_derived (
    node_uuid             TEXT PRIMARY KEY REFERENCES nodes(uuid) ON DELETE CASCADE,
    computed_rollup_hash  TEXT NOT NULL,
    stored_rollup_hash    TEXT,
    state                 TEXT NOT NULL,              -- 'fresh' | 'stale' | 'untracked'
    generation_at_check   INTEGER NOT NULL,
    checked_at            TEXT NOT NULL
);

CREATE INDEX idx_rollup_derived_state ON rollup_derived(state);

-- receipts table extensions. The v1 migration already created receipts with:
--   id, session_id, transcript_path, started_at, finished_at,
--   input_tokens, output_tokens, cache_read_tokens, tool_call_count,
--   nodes_touched, estimated_cost_usd, raw_summary, created_at
-- Phase 8 adds three new columns. Canonical column names for 08-04 INSERT/SELECT:
--   tool_call_count (NOT tool_calls), estimated_cost_usd (NOT est_cost_usd).
ALTER TABLE receipts ADD COLUMN raw_jsonl_path TEXT;
ALTER TABLE receipts ADD COLUMN parse_status TEXT NOT NULL DEFAULT 'ok';  -- 'ok' | 'fallback_mock'
ALTER TABLE receipts ADD COLUMN wall_time_ms INTEGER;

-- receipt_nodes join table already exists from v1. Do NOT recreate.
-- idx_receipts_node_uuid on receipt_nodes(node_uuid) already exists from v1.
"#,
        kind: MigrationKind::Up,
    },
    // WARNING: v4 is immutable once shipped. Do NOT modify sql or description.
    // Phase 10 Plan 10-01 — sessions + episodes tables for ambient session ingestion.
    Migration {
        version: 4,
        description: "phase10_sessions_and_episodes",
        sql: r#"
-- Phase 10 SUB-01: ambient session ingestion lands here.
-- `sessions` is one row per Claude Code JSONL session file under
-- ~/.claude/projects/<cwd-key>/<session-id>.jsonl. The watcher (Plan 10-03)
-- INSERTs on first sight, then UPDATEs `last_seen_at`, `last_line_index`,
-- `episode_count`, `bytes_raw`, `bytes_filtered` on each watcher tick.
--
-- The CHECK constraint on `state` enforces the three-value enum
-- ('active','ended','compacted') at the DB level. Phase 10 does NOT
-- transition to 'ended' automatically (research §Open Question 3); `state`
-- is informational. The CHECK is defence-in-depth so a typo in 10-03's
-- INSERT throws.
CREATE TABLE IF NOT EXISTS sessions (
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

CREATE INDEX IF NOT EXISTS idx_sessions_cwd_key ON sessions(cwd_key);
CREATE INDEX IF NOT EXISTS idx_sessions_state   ON sessions(state);

-- Phase 10 SUB-02: one row per episode = (one user prompt + following assistant turns).
-- `episode_id = sha256(session_id + ":" + start_line)` — see 10-RESEARCH.md.
-- `INSERT OR IGNORE` on the PK is the idempotency primitive: re-ingesting the
-- same JSONL with the same start_line set produces no duplicate rows.
-- Do NOT add a UNIQUE(session_id, start_line) — that's redundant with the
-- PK derivation.
--
-- ON DELETE CASCADE on `session_id` FK: episodes go with their session if
-- 10-04+ ships a "delete session" UI. v1 has no delete UI but the constraint
-- costs nothing.
--
-- No FTS5 virtual table for `filtered_text` here — Phase 11's distiller is
-- the consumer; embedding-based retrieval is its concern, not Phase 10's.
CREATE TABLE IF NOT EXISTS episodes (
    episode_id       TEXT PRIMARY KEY,
    session_id       TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    start_line       INTEGER NOT NULL,
    end_line         INTEGER NOT NULL,
    filtered_text    TEXT NOT NULL,
    content_hash     TEXT NOT NULL,
    turn_count       INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_episodes_session_id  ON episodes(session_id);
CREATE INDEX IF NOT EXISTS idx_episodes_created_at  ON episodes(created_at);
"#,
        kind: MigrationKind::Up,
    },
    // WARNING: v5 is immutable once shipped. Do NOT modify sql or description.
    // Phase 9 Plan 09-04c — FLOW-01: members_json column for kind:flow contracts.
    Migration {
        version: 5,
        description: "phase9_flow01_members_json",
        sql: r#"
-- Phase 9 FLOW-01: members array for kind:flow contracts.
-- Stored as JSON string array of UUIDs in invocation order.
-- Non-flow contracts have NULL.

ALTER TABLE nodes ADD COLUMN members_json TEXT;

-- Index for the json-array-membership query Phase 13 SUB-08 will run
-- (find flows containing a given participant uuid). SQLite does not
-- index JSON natively; we index the raw text and rely on json_each()
-- in Phase 13's queries.
CREATE INDEX IF NOT EXISTS idx_nodes_members_json ON nodes(members_json) WHERE members_json IS NOT NULL;
"#,
        kind: MigrationKind::Up,
    },
    // WARNING: v6 is immutable once shipped. Do NOT modify sql or description.
    // Phase 11 Plan 11-01 — substrate schema: typed nodes + bitemporal columns +
    // FTS5 + embeddings + dead-letter queue + anchored_uuids for cousin-exclusion.
    Migration {
        version: 6,
        description: "phase11_substrate_schema",
        sql: r#"
-- Phase 11 SUB-03: typed substrate nodes with full provenance + bitemporal columns.
-- Bitemporal columns (Graphiti pattern): valid_at = real-world; invalid_at = real-world end;
-- expired_at = DB-side invalidation; created_at = first ingestion. invalid_at + expired_at
-- nullable but PRESENT (Phase 12 will USE them; schema is forward-compatible).
-- 5 typed kinds (kernel-experiment schema; SUB-03 explicit list).
CREATE TABLE IF NOT EXISTS substrate_nodes (
    uuid              TEXT PRIMARY KEY,
    node_type         TEXT NOT NULL CHECK(node_type IN ('constraint','decision','open_question','resolved_question','attempt')),
    text              TEXT NOT NULL,
    scope             TEXT,
    applies_when      TEXT,

    -- Provenance (kernel-experiment schema; SUB-03 required all 5 fields)
    source_session_id TEXT,                                    -- references sessions.session_id (Phase 10) but no FK constraint
    source_turn_ref   INTEGER,
    source_quote      TEXT,
    source_actor      TEXT CHECK(source_actor IN ('user','claude','derived') OR source_actor IS NULL),

    -- Bitemporal (Graphiti pattern; valid_at REQUIRED per CONTEXT lock; others NULLable)
    valid_at          TEXT NOT NULL,
    invalid_at        TEXT,
    expired_at        TEXT,
    created_at        TEXT NOT NULL,

    confidence        TEXT NOT NULL DEFAULT 'inferred' CHECK(confidence IN ('explicit','inferred')),

    -- Indexing back-link to Phase 10 episodes (no FK constraint — Phase 10 may not have shipped)
    episode_id        TEXT,

    -- Phase 12 forward-compat self-FK (NULL until Phase 12 fact engine sets it)
    invalidated_by    TEXT REFERENCES substrate_nodes(uuid),

    -- Phase 11-03 cousin-exclusion JOIN target: JSON array of contract atom UUIDs the
    -- substrate node speaks to. Phase 11-02 distiller writes this; Phase 11-03 retrieval
    -- uses `WHERE EXISTS (SELECT 1 FROM json_each(s.anchored_uuids) je WHERE je.value IN (lineage_uuids))`
    -- to exclude cousins BEFORE FTS5 ranking. CONTEXT lock authority preserved.
    anchored_uuids    TEXT NOT NULL DEFAULT '[]'
);

-- Partial index for current-truth queries — every retrieval read filters by this; Phase 12 reuses
CREATE INDEX IF NOT EXISTS idx_substrate_nodes_active   ON substrate_nodes(invalid_at) WHERE invalid_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_substrate_nodes_type     ON substrate_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_substrate_nodes_session  ON substrate_nodes(source_session_id);
CREATE INDEX IF NOT EXISTS idx_substrate_nodes_episode  ON substrate_nodes(episode_id);
CREATE INDEX IF NOT EXISTS idx_substrate_nodes_valid_at ON substrate_nodes(valid_at);

-- anchored_uuids index: JSON1 doesn't support GENERATED column extraction in all SQLite
-- builds; the JOIN performs at the 50-node demo scale without an index. Skip for v1.

-- Typed edges between substrate nodes
CREATE TABLE IF NOT EXISTS substrate_edges (
    id          TEXT PRIMARY KEY,
    source_uuid TEXT NOT NULL REFERENCES substrate_nodes(uuid) ON DELETE CASCADE,
    target_uuid TEXT NOT NULL REFERENCES substrate_nodes(uuid) ON DELETE CASCADE,
    edge_type   TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_substrate_edges_source ON substrate_edges(source_uuid);
CREATE INDEX IF NOT EXISTS idx_substrate_edges_target ON substrate_edges(target_uuid);
CREATE INDEX IF NOT EXISTS idx_substrate_edges_type   ON substrate_edges(edge_type);

-- FTS5 over text + applies_when for keyword candidate selection (mirror nodes_fts pattern from Phase 1)
CREATE VIRTUAL TABLE IF NOT EXISTS substrate_nodes_fts USING fts5(
    uuid UNINDEXED,
    text,
    applies_when,
    scope,
    content='substrate_nodes',
    content_rowid='rowid'
);

-- FTS5 sync triggers (manual sync — same pattern as nodes_fts)
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

-- Embeddings (Float32 BLOB; 384-dim AllMiniLM-L6-v2 = 1536 bytes per row).
-- Sibling table to keep substrate_nodes row-size small + allow embedding-skipped rows.
CREATE TABLE IF NOT EXISTS substrate_embeddings (
    uuid        TEXT PRIMARY KEY REFERENCES substrate_nodes(uuid) ON DELETE CASCADE,
    model       TEXT NOT NULL DEFAULT 'all-MiniLM-L6-v2',
    dim         INTEGER NOT NULL DEFAULT 384,
    vector      BLOB NOT NULL,
    embedded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dead-letter queue — failed distiller runs surface here for manual retry
CREATE TABLE IF NOT EXISTS distiller_dead_letters (
    id              TEXT PRIMARY KEY,
    episode_id      TEXT NOT NULL,
    error_kind      TEXT NOT NULL CHECK(error_kind IN ('claude_exit_nonzero','json_parse','schema_mismatch','timeout')),
    raw_output      TEXT,
    attempt_count   INTEGER NOT NULL DEFAULT 1,
    last_attempt_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dead_letters_episode ON distiller_dead_letters(episode_id);
"#,
        kind: MigrationKind::Up,
    },
    // WARNING: v7 is immutable once shipped. Do NOT modify sql or description.
    // Phase 12 Plan 12-01 — supersession_layer: ALTER substrate_nodes for intent
    // drift state, plus priority_shifts + intent_drift_verdicts tables.
    //
    // Phase 11 (v6) already shipped substrate_nodes, substrate_edges, and the
    // partial active index. v7 layers Phase 12's additions on top:
    //   - intent_drift_* columns on substrate_nodes via ALTER TABLE ADD COLUMN
    //   - priority_shifts (new table) — log of L0 priority-shift events
    //   - intent_drift_verdicts (new table) — full audit trail of drift judgments
    //   - idx_substrate_edges_type — Phase 12 supersession edge lookups
    //
    // See .planning/phases/12-conflict-supersession-engine/12-RESEARCH.md
    // for the schema rationale (Pattern 1) and Pitfall 8 for the coordination
    // strategy with Phase 11.
    Migration {
        version: 7,
        description: "phase12_supersession_layer",
        sql: r#"
-- Phase 12: Supersession schema layer.
-- Phase 11 (v6) shipped substrate_nodes + substrate_edges + the active partial
-- index + the valid_at index + invalidated_by self-FK already; this migration
-- only ADDS what Phase 11 did not provide.

-- 1. Intent-drift state columns on substrate_nodes — only added if not present
--    (SQLite ALTER TABLE has no IF NOT EXISTS for columns, but Phase 11 v6
--    explicitly does NOT include these columns — verified against migrations.rs
--    v6 schema. If Phase 11 ever adds them, drop this migration entirely).
ALTER TABLE substrate_nodes ADD COLUMN intent_drift_state TEXT;
ALTER TABLE substrate_nodes ADD COLUMN intent_drift_confidence REAL;
ALTER TABLE substrate_nodes ADD COLUMN intent_drift_reasoning TEXT;
ALTER TABLE substrate_nodes ADD COLUMN intent_drift_judged_at TEXT;
ALTER TABLE substrate_nodes ADD COLUMN intent_drift_judged_against TEXT;

-- 2. Edge-type lookup index — used by find_substrate_history's UNION query
--    (12-04) to filter for 'supersedes' edges quickly. Phase 11 has source/target
--    indexes but not a (type, source, target) composite. This is additive.
CREATE INDEX IF NOT EXISTS idx_substrate_edges_type_lookup
    ON substrate_edges(edge_type, source_uuid, target_uuid);

-- 3. Priority shift log — owned by Phase 12 (NEW table).
--    Each row records an L0 contract priority-shift event, the seed for the
--    intent-drift cascade in 12-03. summary_of_old/new are LLM-generated
--    one-line summaries used in the judge prompt.
CREATE TABLE IF NOT EXISTS priority_shifts (
    id              TEXT PRIMARY KEY,
    old_l0_uuid     TEXT NOT NULL,
    new_l0_uuid     TEXT NOT NULL,
    valid_at        TEXT NOT NULL,
    summary_of_old  TEXT NOT NULL,
    summary_of_new  TEXT NOT NULL,
    applied_at      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 4. Intent-drift verdict audit log — owned by Phase 12 (NEW table).
--    substrate_nodes.intent_drift_state holds the LATEST verdict (UPSERT pattern);
--    this table is the FULL HISTORY for cost-cache + audit + adversarial harness
--    replay. CHECK constraints prevent malformed writes from 12-03 / 12-04.
CREATE TABLE IF NOT EXISTS intent_drift_verdicts (
    id                TEXT PRIMARY KEY,
    node_uuid         TEXT NOT NULL,
    priority_shift_id TEXT NOT NULL,
    verdict           TEXT NOT NULL CHECK(verdict IN ('DRIFTED', 'NOT_DRIFTED', 'NEEDS_HUMAN_REVIEW')),
    confidence        REAL NOT NULL CHECK(confidence >= 0.0 AND confidence <= 1.0),
    reasoning         TEXT,
    judged_at         TEXT NOT NULL,
    auto_applied      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_intent_drift_verdicts_node
    ON intent_drift_verdicts(node_uuid);
CREATE INDEX IF NOT EXISTS idx_intent_drift_verdicts_shift
    ON intent_drift_verdicts(priority_shift_id);
"#,
        kind: MigrationKind::Up,
    }]
}
