---
phase: 15
plan: "01"
subsystem: substrate-trust-surface
tags:
  - sqlite-migration
  - fts5
  - chained-version
  - receipts
  - phase15-foundation
dependency_graph:
  requires:
    - Phase 11 v6 substrate schema (substrate_nodes, substrate_nodes_fts, triggers)
    - Phase 12 v7 supersession layer (intent_drift columns)
    - Phase 8 receipts table (id, session_id, ... wall_time_ms)
    - commands/agent.rs run_agent (call chain host)
    - delegate/composer.rs ComposeResult (substrate hits source)
  provides:
    - substrate_nodes.prev_version_uuid self-FK (chain link)
    - substrate_nodes.invalidated_reason (human/agent tombstone note)
    - substrate_edits audit table (TRUST-04)
    - substrate_nodes_au replacement trigger (FTS tombstone fix)
    - receipts.substrate_rules_json column (TRUST-03 source)
    - ComposeResult::substrate_rules_json() helper
    - delegate_execute substrate_rules_json param
    - run_agent substrate_rules_json param
    - parse_and_persist substrate_rules_json param
  affects:
    - 15-02 Cmd+P substrate filter (reads FTS tombstone trigger)
    - 15-03 RefineRuleEditor (writes via substrate_edits)
    - 15-04 SubstrateImpactPreview (reads receipts.substrate_rules_json)
    - 15-05 Restore (writes substrate_edits kind='restore')
    - 15-06 Beat 3 demo refine (fires through full chain)
tech_stack:
  added: []
  patterns:
    - SQLite ALTER TABLE ADD COLUMN (nullable, no DEFAULT needed)
    - FTS5 content table sync trigger replacement (WHERE new.invalid_at IS NULL guard)
    - Rust call-chain parameter threading (composer → delegate_execute → run_agent → parse_and_persist)
    - In-memory SQLite pool for integration tests (SqlitePoolOptions + :memory:)
key_files:
  created:
    - contract-ide/src-tauri/tests/migration_v8_chain_smoke.rs
    - contract-ide/src-tauri/tests/receipts_substrate_rules_json.rs
  modified:
    - contract-ide/src-tauri/src/db/migrations.rs
    - contract-ide/src-tauri/src/delegate/composer.rs
    - contract-ide/src-tauri/src/commands/delegate.rs
    - contract-ide/src-tauri/src/commands/agent.rs
    - contract-ide/src-tauri/src/commands/receipts.rs
decisions:
  - "Option A for substrate_rules_json threading (frontend JSON-stringifies hit UUIDs and passes to delegate_execute as optional String param) — avoids wasteful re-run of FTS+rerank that Option B would require"
  - "Append-only column placement in INSERT INTO receipts (?16 last) — keeps positional order stable for downstream readers"
  - "In-memory schema materialization for integration tests rather than full migration chain runner — faster, self-contained, still exercises the v8 trigger logic"
  - "Smoke test proves FTS tombstone fix by asserting MATCH old text returns ZERO rows post-tombstone — the WHERE new.invalid_at IS NULL guard cannot be bypassed without failing assertion (5a)"
metrics:
  duration: "~9 minutes"
  completed_date: "2026-04-26"
  tasks_completed: 3
  files_modified: 7
---

# Phase 15 Plan 01: Migration v8 Foundation Summary

Migration v8 lands the chained-version primitives, substrate_edits audit table, FTS tombstone trigger fix, and receipts.substrate_rules_json column — the foundation every Phase 15 plan builds on.

## What Was Built

### Task 1: Migration v8 SQL block

Migration v8 appended to `migrations.rs` after the immutable v7 entry. The SQL block (in order):

```sql
-- Phase 15 TRUST-02: chained-version columns
ALTER TABLE substrate_nodes ADD COLUMN prev_version_uuid TEXT REFERENCES substrate_nodes(uuid);
ALTER TABLE substrate_nodes ADD COLUMN invalidated_reason TEXT;

-- Phase 15 TRUST-04: full audit log
CREATE TABLE IF NOT EXISTS substrate_edits (
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
CREATE INDEX IF NOT EXISTS idx_substrate_edits_rule_uuid ON substrate_edits(rule_uuid);
CREATE INDEX IF NOT EXISTS idx_substrate_edits_edited_at ON substrate_edits(edited_at);

-- FTS tombstone fix: DROP old trigger, CREATE replacement with WHERE new.invalid_at IS NULL guard
DROP TRIGGER IF EXISTS substrate_nodes_au;
CREATE TRIGGER substrate_nodes_au AFTER UPDATE ON substrate_nodes BEGIN
    INSERT INTO substrate_nodes_fts(substrate_nodes_fts, rowid, uuid, text, applies_when, scope)
    VALUES ('delete', old.rowid, old.uuid, old.text, old.applies_when, old.scope);
    INSERT INTO substrate_nodes_fts(rowid, uuid, text, applies_when, scope)
    SELECT new.rowid, new.uuid, new.text, new.applies_when, new.scope
    WHERE new.invalid_at IS NULL;
END;

-- Phase 15 TRUST-03: receipt-side hit persistence
ALTER TABLE receipts ADD COLUMN substrate_rules_json TEXT;
```

The seed file (`demo/seeds/substrate.sqlite.seed.sql`) was confirmed untouched — the two new nullable columns keep existing INSERTs valid.

### Task 2: Substrate hit UUID threading (composer → receipts)

Call chain: `delegate/composer.rs` → `commands/delegate.rs::delegate_execute` → `commands/agent.rs::run_agent` → `commands/receipts.rs::parse_and_persist`

- **composer.rs** (line 41–54): `ComposeResult::substrate_rules_json()` helper — serializes hit UUIDs to JSON array string via `serde_json::to_string`, returns `None` when hits empty
- **delegate.rs** (line 46–55): `delegate_execute` gains `substrate_rules_json: Option<String>` — threaded into `run_agent`
- **agent.rs** (line 60–69): `run_agent` gains `substrate_rules_json: Option<String>` — cloned as `substrate_rules_json2`, forwarded to `parse_and_persist` in `CommandEvent::Terminated` branch
- **receipts.rs** (line 306): `parse_and_persist` gains `substrate_rules_json: Option<&str>` — bound as `?16` in extended INSERT INTO receipts statement

### Task 3: Integration smoke test

`tests/migration_v8_chain_smoke.rs` — 193 lines (exceeds 80-line minimum)

Assertions proven:
- **(5a)** `FTS MATCH '"soft delete with grace"'` returns ZERO rows after tombstone — trigger WHERE guard proven load-bearing
- **(5b)** `FTS MATCH '"hard delete"'` returns ONE row — new head indexed on INSERT via substrate_nodes_ai trigger
- **(5c)** `WHERE invalid_at IS NULL` returns ONE row (new_uuid), old row absent
- **(5d)** `substrate_edits` COUNT = 1; kind='refine', actor, before_text, after_text, prev/new UUIDs all correct
- **Phase 12 parity**: exact predicate `WHERE invalid_at IS NULL ORDER BY valid_at DESC LIMIT 10` returns new row, NOT old row

## Deviations from Plan

None — plan executed exactly as written.

### Pre-existing out-of-scope failure (logged per scope-boundary rule)

`commands::demo_orchestration::tests::fixture_dir_falls_back_to_crate_relative_seeds` was already failing before this plan (confirmed by stash/verify). It is not caused by our changes. Logged to deferred-items for Phase 13-11 rehearsal plan to address.

## Downstream Notes for Plans 15-02..15-06

- **15-02** (Cmd+P substrate filter): `substrate_nodes_au` FTS tombstone trigger is active; tombstoned rows with `invalid_at IS NOT NULL` will NOT appear in FTS MATCH results — Cmd+P filter inherits correct chain-head behavior automatically.
- **15-03** (RefineRuleEditor): write to `substrate_edits` with `kind='refine'`; `prev_version_uuid` on the new node; `invalid_at` + `invalidated_reason` on the old node. All columns exist. Use `parse_and_persist` receipt path to thread hit UUIDs automatically.
- **15-04** (SubstrateImpactPreview): query `receipts.substrate_rules_json` — column exists. Use `json_each(substrate_rules_json)` or SQLite `LIKE '%uuid%'` pattern to count receipts containing a given rule UUID. Tolerate NULL (chat-path receipts).
- **15-05** (Restore): write `substrate_edits` with `kind='restore'`; clear `invalid_at` on the restored row. Check: `WHERE invalid_at IS NULL` will now include the restored row, so it re-appears in FTS. The `substrate_nodes_au` trigger handles re-insertion when `invalid_at` is set to NULL via UPDATE.
- **15-06** (Beat 3 demo refine): fires through full chain. `delegate_execute` already threads `substrate_rules_json` from the frontend. Frontend must JSON-stringify the hit UUID array from `delegate_compose` response before passing to `delegate_execute`.

## Self-Check: PASSED

- `contract-ide/src-tauri/src/db/migrations.rs` — exists, version 8 entry present
- `contract-ide/src-tauri/src/delegate/composer.rs` — exists, `substrate_rules_json()` method present
- `contract-ide/src-tauri/src/commands/delegate.rs` — exists, `substrate_rules_json: Option<String>` param present
- `contract-ide/src-tauri/src/commands/agent.rs` — exists, `substrate_rules_json: Option<String>` param present
- `contract-ide/src-tauri/src/commands/receipts.rs` — exists, `?16` bind present in INSERT
- `contract-ide/src-tauri/tests/migration_v8_chain_smoke.rs` — exists
- `contract-ide/src-tauri/tests/receipts_substrate_rules_json.rs` — exists
- Commits: 575d4ca (Task 1), a0824b5 (Task 2), 3d4a3b2 (Task 3)
