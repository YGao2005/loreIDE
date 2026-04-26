# Phase 15: Substrate Trust Surface — Research

**Researched:** 2026-04-25
**Domain:** SQLite chained-version versioning, React modal extension, FTS5 tombstone management, Rust single-transaction IPC, demo fixture wiring
**Confidence:** HIGH (all findings from direct codebase inspection)

---

## Summary

Phase 15 makes every substrate rule searchable by rationale, refinable with a chained-version audit trail, and deletable with a mandatory reason picker and impact preview. The architecture decision is locked: chained immutable versions (each refine creates a new `substrate_nodes` row with `prev_version_uuid` pointing backward; the old row gets `invalid_at = now`). The existing `WHERE invalid_at IS NULL` retrieval pattern continues unchanged.

The codebase arriving at Phase 15 is well-prepared. Migration v7 is the latest; Phase 15 claims v8. The `substrate_nodes` table already has `invalid_at`, `invalidated_by`, `expired_at` (Phase 12 pattern) — Phase 15 adds only `prev_version_uuid` (FK self-ref) and the new `substrate_edits` audit table. Phase 13 already ships `SourceArchaeologyModal`, `IntentPalette` with filter chips, and `find_substrate_by_intent` — Phase 15 extends all three without replacing them.

The key build risk is the FTS5 tombstone pattern: the existing UPDATE trigger deletes the old FTS5 row and inserts the new one. When Phase 15 calls `invalid_at = now` on the old row via refine/delete, the UPDATE trigger fires and re-indexes the now-tombstoned row (still visible in FTS). A new `WHERE invalid_at IS NULL` join guard must be confirmed or the FTS delete-trigger extended to tombstone-detection logic. The `current_substrate_view` SQL view is recommended: it's a trivial one-line `WHERE invalid_at IS NULL` alias and lets Phase 12 callers migrate cleanly without changing every SQL predicate.

**Primary recommendation:** Implement v8 migration (prev_version_uuid + substrate_edits + current_substrate_view), extend FTS5 update trigger to remove tombstones, add Refine/Delete/Restore buttons to the existing `SourceArchaeologyModal`, and extend `IntentPalette` with a `Substrate` filter chip calling `find_substrate_by_intent` with `kind_filter: 'substrate'`.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TRUST-01 | Cmd+P `Substrate` filter chip + FTS5 + rerank opens SourceArchaeologyModal in <2s | `find_substrate_by_intent` IPC already ships; filter chip is a minor UI addition to `IntentPalette`; routing to `SourceArchaeologyModal` via `useCitationStore.openCitationUuid` already wired |
| TRUST-02 | Refine button in SourceArchaeologyModal: editable text/applies_when + reason field → atomic Rust IPC writes new chain row + invalidates old + audit row | SourceArchaeologyModal is a plain Dialog; Refine path adds inline editor + `refine_substrate_rule` Rust command; Phase 12 `write_supersession` pattern is the template for the chained-write |
| TRUST-03 | Delete button with reason picker + impact preview + tombstone IPC; Substrate Health sidebar with Restore | Impact preview requires two queries: `json_each(anchored_uuids)` join for atom count + receipts scan (no dedicated receipt-rule join exists — raw_summary or a new column needed, see §Open Questions); Substrate Health sidebar is a new sidebar surface; Restore IPC clears `invalid_at` |
| TRUST-04 | `substrate_edits` audit table written atomically with every refine/delete/restore in single Rust transaction; table survives reset-demo.sh | `reset-demo.sh` only runs `substrate.sqlite.seed.sql` which operates on `substrate_nodes` and `l0_priority_history`; `substrate_edits` table is untouched → survives reset by default |

</phase_requirements>

---

## Standard Stack

### Core (all already present in codebase — no new deps required)

| Component | Version/Location | Purpose | Notes |
|-----------|-----------------|---------|-------|
| `sqlx` + `SqlitePool` | `src-tauri/Cargo.toml` | Single-transaction Rust writes | Pattern: `pool.begin()` → writes → `tx.commit()` |
| `tauri::command` + `tauri::Manager` | Tauri 2 | IPC command registration | Mirror `commands/substrate.rs` pattern |
| `shadcn/ui Dialog` | Already used in SourceArchaeologyModal | Modal shell | `Refine` expands the existing Dialog in-place |
| `shadcn/ui Tabs` | Already used in Inspector | History tab inside modal | Standard Tabs component |
| `cmdk` Command.Dialog | Already used in IntentPalette.tsx | Filter chip addition | Add a `filterChip` state slice to IntentPalette |
| FTS5 (SQLite) | Migration v6 | Substrate text search | `substrate_nodes_fts` over `text`, `applies_when`, `scope` |
| DeepSeek reranker | `retrieval/rerank.rs` | Listwise rerank for Substrate filter | Already accepts `candidates: &[SubstrateHit]` — Phase 15 reuses unchanged |
| Zustand | All stores | UI state | `useCitationStore`, `useGraphStore` already have the opening semantics |

### New additions (Phase 15 scope)

| Component | Purpose | Where |
|-----------|---------|-------|
| `substrate_edits` SQLite table | Audit log for refine/delete/restore | Migration v8 |
| `prev_version_uuid` column on `substrate_nodes` | Self-referential FK for chain walking | Migration v8 ALTER TABLE |
| `current_substrate_view` SQL VIEW | `WHERE invalid_at IS NULL` alias | Migration v8 CREATE VIEW |
| `refine_substrate_rule` Rust IPC | Atomic refine: new row + invalidate old + audit row | `commands/substrate_trust.rs` (new file) |
| `delete_substrate_rule` Rust IPC | Tombstone: set invalid_at + audit row + FTS remove | same file |
| `restore_substrate_rule` Rust IPC | Clear invalid_at + audit row + FTS re-index | same file |
| `get_substrate_chain` Rust IPC | Walk `prev_version_uuid` chain for History tab | same file |
| `get_substrate_impact` Rust IPC | Atom count + recent-receipt count for delete preview | same file |
| `SubstrateHealthView` React component | Sidebar surface for tombstoned rules + Restore | `src/components/substrate/SubstrateHealthView.tsx` |

---

## Architecture Patterns

### Pattern 1: Chained Immutable Versions (locked 2026-04-25)

```
refine(uuid_old, new_text, new_applies_when, reason):
  BEGIN TRANSACTION
    uuid_new = new_uuid()
    INSERT substrate_nodes ... prev_version_uuid = uuid_old
    UPDATE substrate_nodes SET invalid_at = now(), invalidated_reason = 'refined: <reason>'
      WHERE uuid = uuid_old AND invalid_at IS NULL
    INSERT substrate_edits (edit_id, rule_uuid=uuid_new, prev_version_uuid=uuid_old,
      new_version_uuid=uuid_new, actor, before_text, after_text, reason, kind='refine')
    -- FTS5: UPDATE trigger fires on substrate_nodes → removes uuid_old from index,
    --       INSERT trigger fires on new row → adds uuid_new to index
  COMMIT
```

**Key insight:** The FTS5 UPDATE trigger (migration v6) already handles index maintenance on the OLD row. When `invalid_at` is set on the old row, the UPDATE trigger fires `DELETE + INSERT` on that row — but the INSERT re-adds the (now-tombstoned) row to FTS with its new `invalid_at` value. The FTS content table still returns it for MATCH queries because `content='substrate_nodes'` re-reads the row. This is a **tombstone leakage bug** that Phase 15 must fix (see §Common Pitfalls).

### Pattern 2: Single-Transaction Rust IPC (mirrors Phase 12 pattern)

```rust
// In commands/substrate_trust.rs
#[tauri::command]
pub async fn refine_substrate_rule(
    app: tauri::AppHandle,
    uuid: String,
    new_text: String,
    new_applies_when: Option<String>,
    reason: String,
) -> Result<String, String> {
    let pool = pool_clone(&app).await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    
    // 1. Read old row (validate it exists + get before_text)
    // 2. INSERT new row with prev_version_uuid = uuid
    // 3. UPDATE old row: invalid_at = now(), invalidated_reason = 'refined: <reason>'
    // 4. INSERT substrate_edits audit row
    // (FTS triggers fire on INSERT + UPDATE within the transaction)
    
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(new_uuid)
}
```

The Phase 12 `write_supersession` function (`supersession/queries.rs:97-113`) is the direct template — it updates `invalid_at` on a stale row inside a caller-managed transaction.

### Pattern 3: History Tab Chain Walk

Two approaches:

**Option A: Recursive CTE (SQL-side)**
```sql
WITH RECURSIVE chain(uuid, text, applies_when, valid_at, invalid_at, prev_version_uuid, depth) AS (
    SELECT uuid, text, applies_when, valid_at, invalid_at, prev_version_uuid, 0
    FROM substrate_nodes WHERE uuid = ?1
    UNION ALL
    SELECT s.uuid, s.text, s.applies_when, s.valid_at, s.invalid_at, s.prev_version_uuid, c.depth+1
    FROM substrate_nodes s JOIN chain c ON s.uuid = c.prev_version_uuid
    WHERE c.depth < 50
)
SELECT * FROM chain ORDER BY valid_at ASC
```

**Option B: App-side loop (simpler)**
```rust
let mut current_uuid = start_uuid;
let mut chain = vec![];
while let Some(row) = fetch_by_uuid(&pool, &current_uuid).await? {
    chain.push(row.clone());
    match row.prev_version_uuid { Some(prev) => current_uuid = prev, None => break }
}
```

**Recommendation: Option A (recursive CTE).** SQLite supports recursive CTEs fully. The `depth < 50` guard prevents runaway on malformed chains. App-side loop requires N round-trips. At demo scale (chains of length 2-3) either works; CTE is one SQL call.

### Pattern 4: FTS5 Tombstone Fix

The existing UPDATE trigger (`substrate_nodes_au`) fires `DELETE + INSERT` — but the `content='substrate_nodes'` virtual table re-reads the row's current `text` and `applies_when` even for tombstoned rows. Tombstoned rows WILL appear in FTS MATCH results.

**Fix: extend the UPDATE trigger (in migration v8) to conditionally skip the re-INSERT when the row is being tombstoned:**

```sql
-- Migration v8: Replace substrate_nodes_au trigger to skip FTS re-index on tombstone
DROP TRIGGER IF EXISTS substrate_nodes_au;
CREATE TRIGGER IF NOT EXISTS substrate_nodes_au AFTER UPDATE ON substrate_nodes BEGIN
    -- Always remove the old FTS entry
    INSERT INTO substrate_nodes_fts(substrate_nodes_fts, rowid, uuid, text, applies_when, scope)
    VALUES ('delete', old.rowid, old.uuid, old.text, old.applies_when, old.scope);
    -- Only re-insert if the row is not being tombstoned (invalid_at going from NULL to non-NULL)
    SELECT CASE
        WHEN new.invalid_at IS NULL THEN (
            INSERT INTO substrate_nodes_fts(rowid, uuid, text, applies_when, scope)
            VALUES (new.rowid, new.uuid, new.text, new.applies_when, new.scope)
        )
    END;
END;
```

**Note:** SQLite triggers don't support conditional INSERTs inside SELECT CASE directly. The clean approach is to DROP the trigger and recreate it with two separate triggers: one for tombstone writes (only DELETE from FTS) and one for non-tombstone UPDATEs (DELETE + INSERT). Or use a single trigger with `WHERE new.invalid_at IS NULL` on the INSERT via a subquery guard.

**Practical clean implementation:**

```sql
DROP TRIGGER IF EXISTS substrate_nodes_au;
CREATE TRIGGER IF NOT EXISTS substrate_nodes_au AFTER UPDATE ON substrate_nodes BEGIN
    -- Remove old FTS entry regardless
    INSERT INTO substrate_nodes_fts(substrate_nodes_fts, rowid, uuid, text, applies_when, scope)
    VALUES ('delete', old.rowid, old.uuid, old.text, old.applies_when, old.scope);
    -- Re-insert only if the row is still active (not being tombstoned)
    INSERT INTO substrate_nodes_fts(rowid, uuid, text, applies_when, scope)
    SELECT new.rowid, new.uuid, new.text, new.applies_when, new.scope
    WHERE new.invalid_at IS NULL;
END;
```

`INSERT INTO ... SELECT ... WHERE` is standard SQLite FTS5 content-sync syntax (verified against Phase 11 trigger pattern in migrations v6).

### Pattern 5: `current_substrate_view` SQL View

```sql
CREATE VIEW IF NOT EXISTS current_substrate_view AS
    SELECT * FROM substrate_nodes WHERE invalid_at IS NULL;
```

All 8 existing `WHERE invalid_at IS NULL` predicates in Phase 11/12 code can continue using their current SQL; the view is an _optional_ convenience alias. Recommended to create it in v8 migration so Phase 15 plans can reference it consistently.

### Pattern 6: Impact Preview Queries

```sql
-- Atoms citing the rule (via anchored_uuids JSON array)
SELECT COUNT(*) AS atom_count
FROM substrate_nodes s
JOIN nodes n ON EXISTS (
    SELECT 1 FROM json_each(s.anchored_uuids) je WHERE je.value = n.uuid
)
WHERE s.uuid = ?1 AND s.invalid_at IS NULL;

-- Recent receipts referencing the rule (past 7 days)
-- NOTE: receipts.raw_summary is NULL in current schema; substrate_hits not stored per-receipt.
-- See §Open Questions — impact preview for recent prompts requires a new column or JSON scan.
```

---

## Existing Code Inventory

### 1. `substrate_nodes` Schema (Migration v6 + v7 additions)

Confirmed columns (from `src-tauri/src/db/migrations.rs`):

| Column | Type | Phase | Notes |
|--------|------|-------|-------|
| `uuid` | TEXT PK | v6 | |
| `node_type` | TEXT CHECK | v6 | constraint/decision/open_question/resolved_question/attempt |
| `text` | TEXT NOT NULL | v6 | the rule text |
| `scope` | TEXT | v6 | |
| `applies_when` | TEXT | v6 | in FTS5 index |
| `source_session_id` | TEXT | v6 | |
| `source_turn_ref` | INTEGER | v6 | |
| `source_quote` | TEXT | v6 | verbatim quote — NOT in FTS5 |
| `source_actor` | TEXT | v6 | |
| `valid_at` | TEXT NOT NULL | v6 | |
| `invalid_at` | TEXT | v6 | NULL = active; non-NULL = tombstoned/superseded |
| `expired_at` | TEXT | v6 | DB-side invalidation timestamp |
| `created_at` | TEXT NOT NULL | v6 | |
| `confidence` | TEXT | v6 | explicit/inferred |
| `episode_id` | TEXT | v6 | |
| `invalidated_by` | TEXT self-FK | v6 | UUID of superseding node |
| `anchored_uuids` | TEXT DEFAULT '[]' | v6 | JSON array of contract atom UUIDs |
| `intent_drift_state` | TEXT | v7 | DRIFTED/NOT_DRIFTED/NEEDS_HUMAN_REVIEW |
| `intent_drift_confidence` | REAL | v7 | |
| `intent_drift_reasoning` | TEXT | v7 | |
| `intent_drift_judged_at` | TEXT | v7 | |
| `intent_drift_judged_against` | TEXT | v7 | |

**Missing from current schema (Phase 15 adds):**
- `prev_version_uuid TEXT REFERENCES substrate_nodes(uuid)` — self-FK for chain walking
- `invalidated_reason TEXT` — human-readable reason for invalidation (set on refine/delete)

**Note:** The seed SQL (`substrate.sqlite.seed.sql`) uses a different schema than the migrations (it has `kind`, `state`, `name`, `summary` columns not present in the real table). The seed is for demo-only; the real table from migrations is what Phase 15 works against. The seed's `kind` maps to `node_type`; `name` and `summary` don't exist in the real table (they're derived from `text` at read time in `commands/substrate.rs:first_line()`).

### 2. FTS5 Virtual Table: `substrate_nodes_fts`

Indexed columns (from migrations v6): `uuid UNINDEXED`, `text`, `applies_when`, `scope`.

**NOT indexed:** `source_quote`, `verbatim_quote`, `node_type`.

TRUST-01 requires searching across `verbatim_quote + summary + applies_when`. The current FTS5 table does NOT include `verbatim_quote` (= `source_quote` in the real schema). Phase 15 must either:
- **Option A:** Add `source_quote` to `substrate_nodes_fts` columns in migration v8 (ALTER VIRTUAL TABLE — supported in SQLite FTS5 for `ALTER TABLE ... RENAME` but not add-column; requires DROP + RECREATE of the FTS table).
- **Option B:** Accept that `verbatim_quote` is NOT FTS-indexed and rely on `text + applies_when` for keyword match + reranker for semantic precision.

**Recommendation: Option B** — the reranker (`retrieval/rerank.rs`) already handles semantic alignment between query and rule text. Adding `source_quote` to FTS would require dropping and recreating the FTS table (risky migration on a populated DB) and would add noise (verbatim_quote is raw session text, not curated rule text). The TRUST-01 requirement says "FTS5 + DeepSeek listwise rerank" — this is already the Phase 11 retrieval primitive. The reranker naturally surfaces rules where the verbatim_quote aligns with the query.

### 3. `SourceArchaeologyModal` (Phase 13 Plan 07)

File: `/Users/yang/lahacks/contract-ide/src/components/inspector/SourceArchaeologyModal.tsx`

**Current state:**
- Opens via `useCitationStore.openCitationUuid`
- Calls `getSubstrateNodeDetail(uuid)` IPC (returns `SubstrateNodeSummary`)
- Renders: kind badge, state badge, actor, confidence, summary text, verbatim quote block, session/turn ref
- No tabs; flat layout

**Phase 15 extensions needed:**
- Add `Refine` button and `Delete this rule` button to the modal header/footer
- Add a `History` tab (alongside a new `Detail` tab — current flat layout becomes the Detail tab)
- Expand inline when Refine is clicked: `text` and `applies_when` become textareas; reason field (required)
- Delete dialog: reason picker (shadcn RadioGroup) + free-text + impact preview section
- `SubstrateNodeSummary` type does NOT currently include `applies_when` or `text` separately from `summary` — the Rust IPC returns `summary = full text`. Phase 15 needs to expose `applies_when` as a separate field on the detail IPC for inline editing.

### 4. `IntentPalette` (Phase 13 Plan 03)

File: `/Users/yang/lahacks/contract-ide/src/components/command-palette/IntentPalette.tsx`

**Current state:**
- cmdk Command.Dialog with `shouldFilter={false}` (IPC is the ranker)
- Query debounce 300ms → `findSubstrateByIntent(query, 10)` IPC
- Hits include both contracts AND substrate hits (no filter chip yet)
- Navigation: flow→L2 / L4 atom→L3+chip-halo / contract→pushParent / substrate→selectNode(parent_uuid)

**Phase 15 additions:**
- Add filter chips: `All | Contracts | Code | Substrate` (currently `Contracts | Code` from original design; `Substrate` is new per TRUST-01)
- When `Substrate` chip is active: modify query to pass `kind_filter = 'substrate'` to the IPC (or post-filter client-side by `hit.kind` being a substrate kind)
- TRUST-01 says "substrate hit → opens SourceArchaeologyModal". Current behavior opens atom inspector via `selectNode(parent_uuid)`. For substrate-only hits from the Substrate filter, route instead to `useCitationStore.openCitationUuid(hit.uuid)` to open the archaeology modal directly.

**Note on existing filter chips:** REQUIREMENTS.md TRUST-01 says "New `Substrate` filter chip joins existing `Contracts` / `Code` chips." The current `IntentPalette.tsx` does NOT show filter chips — it's a plain search input. The `Contracts / Code` chips referenced in TRUST-01 must be planned as part of Phase 15 plan 15-02. This is a UI-only addition.

### 5. Phase 12 Supersession Queries (`WHERE invalid_at IS NULL`)

All 8 occurrences found in:

| File | Line | Pattern | Phase 15 impact |
|------|------|---------|-----------------|
| `supersession/candidate_selection.rs` | 64, 89 | `AND s.invalid_at IS NULL` | Chained versions: the NEW row has `invalid_at IS NULL`, the OLD row has it set. Pattern continues correctly. |
| `supersession/queries.rs` | 18, 30, 100, 221 | Same | Same — new head row is always `NULL`; old rows are not. |
| `supersession/walker.rs` | 131 | Same | Same |
| `retrieval/candidates.rs` | 81, 114, 176 | Same | Same |
| `commands/substrate.rs` | FTS MATCH + `s.invalid_at IS NULL` | Phase 13 Cmd+P | Same |

**Verdict: All Phase 12 supersession queries and Phase 11/13 retrieval queries continue working correctly under chained versions.** The `WHERE invalid_at IS NULL` predicate always selects the current (head) row of a chain. The only risk is the FTS5 tombstone leakage bug described in §Common Pitfalls.

### 6. `atom_substrate_refs` / Impact Preview

**No dedicated link table exists.** The atom→substrate link is via `anchored_uuids` (JSON array on `substrate_nodes`). This is the Phase 11 distiller's output.

For impact preview (atoms citing the rule):
```sql
SELECT COUNT(*) FROM nodes n
WHERE EXISTS (
    SELECT 1 FROM substrate_nodes s, json_each(s.anchored_uuids) je
    WHERE s.uuid = ?1 AND je.value = n.uuid
)
```

For impact preview (recent prompts referencing the rule):
**No column exists on `receipts` that stores which substrate_node UUIDs were included in the agent prompt.** The `raw_summary` column is NULL (not used in Phase 8). The `nodes_touched` column stores contract node UUIDs (not substrate rule UUIDs). 

This is a known gap. Two options:
- **Option A (v1 acceptable):** Skip the "recent prompts" count. Show only atoms-citing count. Requirement says "recent agent prompts in past 7 days that included the rule (count)" — approximate via `receipts.created_at > (now - 7 days)` with no rule-filtering (show total recent receipts, not rule-specific). This is misleading.
- **Option B (correct):** Add a new `substrate_rules_json` column to `receipts` table (migration v8 ALTER TABLE) and populate it from `delegate/composer.rs` when a `Delegate to agent` run fires. The composer already has the `SubstrateHit` list it passes to the prompt.

**Recommendation: Option B** for correctness; add `substrate_rules_json TEXT` to `receipts` in v8 migration and update `delegate/composer.rs` to persist the hit UUIDs alongside the receipt. If time is tight, Option A shows "N recent sessions touched the same area" as a proxy.

### 7. Sidebar Pattern for Substrate Health

File: `/Users/yang/lahacks/contract-ide/src/components/layout/Sidebar.tsx`

The Sidebar renders: Copy Mode pill → SidebarTree (area tree) → status row (MCP/Session/Substrate indicators). There is no per-icon sidebar navigation (unlike VS Code's activity bar).

**Adding "Substrate Health" surface:** The roadmap says "accessible from a sidebar icon". Looking at Sidebar.tsx, there is no icon-based navigation bar — the sidebar IS the tree view. Three options:
1. Add a button/link in the status row at the bottom of the sidebar.
2. Add a new "Substrate Health" section/accordion inside the sidebar tree (below SidebarTree).
3. Open SubstrateHealthView as a Panel within the Inspector (new Inspector tab).

Given the sidebar has no icon nav and the Inspector already has tabs (Contract/Code/Preview/Receipts), **Option 3 (new Inspector panel)** is the path of least resistance and consistent with existing patterns. Alternatively, add a small "🗑 N tombstoned" link in the SubstrateStatusIndicator in the status row that opens the health view as a Dialog.

**Recommendation:** Add a `Substrate Health` button to `SubstrateStatusIndicator` that opens a Dialog listing tombstoned rules. This avoids adding a new sidebar surface entirely and is consistent with the status-indicator pattern already in place.

### 8. `reset-demo.sh` Semantics

File: `/Users/yang/lahacks/contract-ide/demo/reset-demo.sh`

The reset script:
1. Kills the app
2. Resets demo repo to locked commit
3. Runs `sqlite3 "$DB_PATH" < "$SEED_DIR/substrate.sqlite.seed.sql"`
4. Relaunches app

The seed SQL only operates on `substrate_nodes` and `l0_priority_history` (DELETE + INSERT). It does NOT touch `substrate_edits`.

**Result: `substrate_edits` table SURVIVES reset by default** — the seed SQL does not delete it. This satisfies TRUST-04's "audit table survives reset-demo.sh" without any additional change.

However, if the demo wants a clean audit slate after reset (e.g., no pre-existing audit rows from the previous demo run), the seed SQL should optionally truncate `substrate_edits`. TRUST-04 says the table "survives" — meaning it's not wiped. This is correct: the audit trail should persist across demo resets so history is available in the History tab. The seed script's substrate_nodes DELETE/INSERT effectively resets the content but the `substrate_edits` rows remain as historical evidence.

### 9. Beat 3 Fixture → Real Path (SC 7)

**Current implementation (Phase 13):**
The Beat 3 narrowing of `con-settings-no-modal-interrupts-2025-Q4` is purely fixture-based:
- `loadBeat3VerifierResults()` in `src/lib/demoOrchestration.ts` hardcodes the verifier rows including the orange flag
- The orange flag fires `useCitationStore` + `useVerifierStore.flag` via the VerifierPanel
- When T accepts, the current `ScopeRefinementPanel` (if it ships in 13-09) writes a note

**Phase 15's real path (SC 7):**
T opens Cmd+P → types "no modal interrupts" → `Substrate` filter chip → hits `con-settings-no-modal-interrupts-2025-Q4` → opens `SourceArchaeologyModal` → clicks `Refine` → edits `applies_when` to narrow scope → types reason → Save → new substrate row created with `prev_version_uuid`.

This replaces the staged animation with a real database write. The verifier orange flag still fires (same fixture path for Beat 3's opening), but the *resolution* action is now a real refine call rather than a local store mutation. The audit row in `substrate_edits` is visible in the History tab post-edit.

**Demo timing concern:** The refine path adds one extra IPC round-trip vs. the current fixture animation (~500ms for the Rust write vs. ~0ms for the local store mutation). At demo scale this is imperceptible; the round-trip completes in <300ms on localhost SQLite.

### 10. IPC Registration Pattern

New Rust commands in `commands/substrate_trust.rs` must be registered in `lib.rs` `generate_handler![]`. Current pattern (from `commands/substrate.rs`):

```rust
// lib.rs — inside generate_handler! macro
commands::substrate::get_substrate_states_for_canvas,
commands::substrate::get_substrate_node_detail,
commands::substrate::find_substrate_by_intent,
// Phase 15 adds:
commands::substrate_trust::refine_substrate_rule,
commands::substrate_trust::delete_substrate_rule,
commands::substrate_trust::restore_substrate_rule,
commands::substrate_trust::get_substrate_chain,
commands::substrate_trust::get_substrate_impact,
```

---

## Common Pitfalls

### Pitfall 1: FTS5 Tombstone Leakage (HIGH RISK)

**What goes wrong:** Phase 15 sets `invalid_at = now()` on the old row via an UPDATE. The existing `substrate_nodes_au` trigger fires on every UPDATE — it removes the old FTS entry and re-inserts it. Since `content='substrate_nodes'` reads the current row values, the re-inserted FTS entry reflects the updated `invalid_at` value — but FTS5 content tables do NOT filter on non-FTS columns. The tombstoned row REMAINS searchable.

**Verification:** Run `SELECT * FROM substrate_nodes_fts WHERE substrate_nodes_fts MATCH 'soft delete'` after tombstoning `dec-soft-delete-30day-grace`. Without the fix, the deleted rule still appears.

**Fix:** Replace the UPDATE trigger (see §Architecture Patterns Pattern 4). The `INSERT INTO fts ... SELECT ... WHERE new.invalid_at IS NULL` syntax is the correct guard.

### Pitfall 2: Self-Referential FK on Empty Chain Head

**What goes wrong:** New `prev_version_uuid TEXT REFERENCES substrate_nodes(uuid)` — when the initial row is inserted (no prior version), `prev_version_uuid = NULL`. FK constraint permits NULL. But if a refine is attempted on a row that has already been tombstoned (`invalid_at IS NOT NULL`), the write should fail with a clear error, not silently succeed with a dangling chain.

**Fix:** In the `refine_substrate_rule` IPC, guard with `WHERE uuid = ?1 AND invalid_at IS NULL` on the pre-read. If the row returns nothing, return an error "rule already tombstoned — cannot refine."

### Pitfall 3: Race Between Distiller and Human Refine

**What goes wrong:** The Phase 11 distiller ingests a new episode, calls `ingest_substrate_node_with_invalidation` (which calls `write_supersession`), and sets `invalid_at` on an existing rule while a human is mid-refine in the modal. Last-writer-wins on the chain — both writes succeed but the human's refine may point `prev_version_uuid` at the distiller's new row (not the original). The chain becomes: `original → distiller-new → human-refined`.

**Impact:** The History tab shows a correct chain but the human refinement is now two steps from the origin. This is acceptable for v1 (ROADMAP planning notes say "last-writer-wins on the chain is acceptable for v1").

**No fix needed for v1.** Document in plan frontmatter.

### Pitfall 4: Seed SQL Schema Mismatch

**What goes wrong:** `demo/seeds/substrate.sqlite.seed.sql` uses columns `kind`, `state`, `name`, `summary` that don't exist in the real `substrate_nodes` table from migrations. The seed also uses `CREATE TABLE IF NOT EXISTS` with a different schema, so if Phase 11 migrations have run (adding the real columns), the seed's `CREATE TABLE IF NOT EXISTS` is a no-op and the INSERT uses the correct migration schema. But the seed's `DELETE FROM substrate_nodes` still clears everything including `prev_version_uuid` and `invalidated_reason` added by Phase 15.

**Fix:** After Phase 15's v8 migration ships, update the seed SQL to include `prev_version_uuid = NULL` and `invalidated_reason = NULL` in its INSERT statements (or rely on the column defaults). The seed's `DELETE FROM substrate_nodes` is fine — it resets for a clean demo state. The `substrate_edits` table is not touched.

### Pitfall 5: Restore on a Mid-Chain Row

**What goes wrong:** A rule has chain: `v1 (tombstoned) → v2 (tombstoned) → v3 (active)`. User finds v1 in the tombstoned list and clicks Restore. Restoring v1 sets `v1.invalid_at = NULL` — now TWO rows are active (`v1` and `v3`). The `WHERE invalid_at IS NULL` retrieval returns both.

**Fix:** Restore should only apply to rows where the ENTIRE chain forward is tombstoned (i.e., `v3` doesn't exist or is itself tombstoned). In v1: Restore only lists rules where the rule's UUID has no active successor. Query: `WHERE uuid = ?1 AND NOT EXISTS (SELECT 1 FROM substrate_nodes WHERE prev_version_uuid = ?1 AND invalid_at IS NULL)`.

Actually, looking at TRUST-03: "Restore brings back the most recent tombstoned version (`invalid_at` cleared), not arbitrary historical versions." This means the Substrate Health view only shows the CURRENT head of each chain (most recent `invalid_at IS NOT NULL` row, where `prev_version_uuid` points at no later active row). It does not show all historical versions. This is the correct semantics.

---

## Code Examples

### Migration v8 (claim after v7)

```rust
Migration {
    version: 8,
    description: "phase15_substrate_trust_surface",
    sql: r#"
-- Phase 15 TRUST-02/04: chained-version support on substrate_nodes
ALTER TABLE substrate_nodes ADD COLUMN prev_version_uuid TEXT REFERENCES substrate_nodes(uuid);
ALTER TABLE substrate_nodes ADD COLUMN invalidated_reason TEXT;

-- Phase 15 TRUST-04: audit table for every refine/delete/restore
CREATE TABLE IF NOT EXISTS substrate_edits (
    edit_id           TEXT PRIMARY KEY,
    rule_uuid         TEXT NOT NULL,      -- uuid of the NEW row (for refine) or affected row (for delete/restore)
    prev_version_uuid TEXT,               -- uuid of the previous row in the chain (refine only)
    new_version_uuid  TEXT,               -- uuid of the new row created (refine only)
    actor             TEXT NOT NULL,      -- 'human:<email>'
    edited_at         TEXT NOT NULL,
    before_text       TEXT,
    after_text        TEXT,
    reason            TEXT NOT NULL,
    kind              TEXT NOT NULL CHECK(kind IN ('refine', 'delete', 'restore'))
);

CREATE INDEX IF NOT EXISTS idx_substrate_edits_rule_uuid ON substrate_edits(rule_uuid);
CREATE INDEX IF NOT EXISTS idx_substrate_edits_edited_at ON substrate_edits(edited_at);

-- Phase 15: current-substrate view for Phase 12 audit + Phase 15 health queries
CREATE VIEW IF NOT EXISTS current_substrate_view AS
    SELECT * FROM substrate_nodes WHERE invalid_at IS NULL;

-- Phase 15 TRUST-01: fix FTS5 tombstone leakage — replace UPDATE trigger
-- to skip re-insertion when the row is being tombstoned.
DROP TRIGGER IF EXISTS substrate_nodes_au;
CREATE TRIGGER IF NOT EXISTS substrate_nodes_au AFTER UPDATE ON substrate_nodes BEGIN
    -- Always remove old FTS entry
    INSERT INTO substrate_nodes_fts(substrate_nodes_fts, rowid, uuid, text, applies_when, scope)
    VALUES ('delete', old.rowid, old.uuid, old.text, old.applies_when, old.scope);
    -- Re-index only if the row remains active after this update
    INSERT INTO substrate_nodes_fts(rowid, uuid, text, applies_when, scope)
    SELECT new.rowid, new.uuid, new.text, new.applies_when, new.scope
    WHERE new.invalid_at IS NULL;
END;

-- Optional: add source_quote to receipts for impact preview (TRUST-03)
ALTER TABLE receipts ADD COLUMN substrate_rules_json TEXT;
    "#,
    kind: MigrationKind::Up,
}
```

### `refine_substrate_rule` Rust IPC (core pattern)

```rust
#[tauri::command]
pub async fn refine_substrate_rule(
    app: tauri::AppHandle,
    uuid: String,
    new_text: String,
    new_applies_when: Option<String>,
    reason: String,
    actor: String,  // "human:yangg40@g.ucla.edu"
) -> Result<String, String> {
    let pool = pool_clone(&app).await?;
    
    // Read old row
    let old = sqlx::query("SELECT text, applies_when FROM substrate_nodes WHERE uuid = ?1 AND invalid_at IS NULL")
        .bind(&uuid)
        .fetch_optional(&pool)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("rule {uuid} not found or already tombstoned"))?;
    
    let new_uuid = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let invalidated_reason = format!("refined: {reason}");
    
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    
    // 1. INSERT new row (copies all columns, sets prev_version_uuid)
    sqlx::query(r#"INSERT INTO substrate_nodes (uuid, node_type, text, scope, applies_when,
        source_session_id, source_turn_ref, source_quote, source_actor, valid_at, invalid_at,
        expired_at, created_at, confidence, episode_id, invalidated_by, anchored_uuids,
        prev_version_uuid)
        SELECT ?1, node_type, ?2, scope, ?3,
               source_session_id, source_turn_ref, source_quote, source_actor, ?4, NULL,
               NULL, ?4, confidence, episode_id, NULL, anchored_uuids,
               ?5
        FROM substrate_nodes WHERE uuid = ?5"#)
        .bind(&new_uuid)
        .bind(&new_text)
        .bind(&new_applies_when)
        .bind(&now)
        .bind(&uuid)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    
    // 2. Invalidate old row
    sqlx::query("UPDATE substrate_nodes SET invalid_at = ?1, invalidated_reason = ?2 WHERE uuid = ?3 AND invalid_at IS NULL")
        .bind(&now)
        .bind(&invalidated_reason)
        .bind(&uuid)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    
    // 3. Write audit row
    let before_text: String = old.try_get("text").map_err(|e| e.to_string())?;
    sqlx::query("INSERT INTO substrate_edits (edit_id, rule_uuid, prev_version_uuid, new_version_uuid, actor, edited_at, before_text, after_text, reason, kind)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'refine')")
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(&new_uuid)
        .bind(&uuid)
        .bind(&new_uuid)
        .bind(&actor)
        .bind(&now)
        .bind(&before_text)
        .bind(&new_text)
        .bind(&reason)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(new_uuid)
}
```

### History Tab Chain Walk (CTE approach)

```sql
WITH RECURSIVE chain(uuid, text, applies_when, valid_at, invalid_at, invalidated_reason, prev_version_uuid, depth) AS (
    SELECT uuid, text, applies_when, valid_at, invalid_at, invalidated_reason, prev_version_uuid, 0
    FROM substrate_nodes WHERE uuid = ?1
    UNION ALL
    SELECT s.uuid, s.text, s.applies_when, s.valid_at, s.invalid_at, s.invalidated_reason, s.prev_version_uuid, c.depth+1
    FROM substrate_nodes s JOIN chain c ON s.uuid = c.prev_version_uuid
    WHERE c.depth < 50
)
SELECT * FROM chain ORDER BY valid_at ASC
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Diff between two text versions in History tab | Custom diff implementation | Simple character diff via `text-diff` npm package or just a side-by-side `<pre>` with manual char comparison | At demo scale (short rule texts), visual diff is optional; side-by-side before/after in `<pre>` blocks is sufficient and zero deps |
| FTS5 query building | Custom tokenizer | `build_fts_or_query()` in `commands/substrate.rs` — reuse verbatim | Already handles stopwords, OR-tokenization, pass-through for structured queries |
| LLM reranker | DeepSeek API client | `retrieval/rerank.rs::llm_rerank()` — reuse verbatim | Phase 11 already ships this with 15s timeout, graceful degradation, defensive parser |
| Transaction management | Manual SQLx execute calls | `pool.begin()` → `tx.commit()` (sqlx transaction API) | Phase 12 uses this pattern in `fact_engine.rs`; mirrors Phase 8 cherrypick's atomic write |
| UUID generation | Custom random strings | `uuid::Uuid::new_v4().to_string()` (already in Cargo.toml) | |
| Timestamp formatting | Custom formatting | `chrono::Utc::now().to_rfc3339()` (Graphiti issue #893 guard — timezone-naive footgun) | Phase 12 already uses this pattern everywhere |

---

## Open Questions

1. **Impact preview — recent prompts count (TRUST-03)**
   - **What we know:** `receipts` table does not store which substrate rule UUIDs were included in the Delegate-to-agent prompt. `raw_summary` is NULL. `nodes_touched` stores contract UUIDs only.
   - **What's unclear:** Best v1 approach — add `substrate_rules_json` to `receipts` in v8 migration (requires updating `delegate/composer.rs` to persist it) vs. show total recent receipts count as a proxy.
   - **Recommendation:** Add `substrate_rules_json TEXT` in v8 migration (trivial ALTER TABLE); update `delegate/composer.rs` to bind the substrate hit UUIDs JSON on `parse_and_persist`. Impact preview count then becomes a real count. Migration cost is one ALTER TABLE + one field in the INSERT — low effort for correctness.

2. **Diff rendering in History tab**
   - **What we know:** No diff library is currently installed in the frontend.
   - **What's unclear:** Is a visual diff required (TRUST-02 says "renders each version with a diff against the prior") or is side-by-side before/after sufficient?
   - **Recommendation:** Side-by-side `<pre>` blocks with the `before_text` / `after_text` from `substrate_edits` is sufficient for v1. A character-level diff with highlight would require adding `diff` or `fast-diff` (~4KB), which is trivial but not necessary. At demo scale, the change between rule versions is typically one paragraph of text; judges can read the side-by-side.

3. **FTS5 verbatim_quote indexing (TRUST-01: "FTS5 + DeepSeek listwise rerank")**
   - **What we know:** `source_quote` is NOT in `substrate_nodes_fts` (indexed columns: `text`, `applies_when`, `scope`).
   - **What's unclear:** Is the requirement asking for FTS5 to search verbatim_quote, or is the reranker the mechanism that surfaces verbatim-quote relevance?
   - **Recommendation:** The reranker is the right mechanism. Phase 11's retrieval already covers this via semantic alignment. Do NOT add `source_quote` to FTS5 (would require DROP + RECREATE of the virtual table, risky on a populated DB). The requirement text says "FTS5 + DeepSeek listwise rerank" — interpret this as: FTS5 generates candidates, reranker surfaces the most verbatim-quote-relevant hits. No FTS5 schema change needed.

4. **`current_substrate_view` vs. predicate-everywhere**
   - **What we know:** All 8 `WHERE invalid_at IS NULL` occurrences are in separate files, all correct.
   - **What's unclear:** Is the view worth creating, or does it add pointless indirection?
   - **Recommendation:** Create the view in v8 — it's a single `CREATE VIEW` line, costs nothing at runtime, and gives Phase 15's new queries a clean surface to read from. Phase 12 queries can migrate to it opportunistically; there's no migration deadline.

---

## Sources

### Primary (HIGH confidence — direct codebase inspection)

- `/Users/yang/lahacks/contract-ide/src-tauri/src/db/migrations.rs` — full migration history v1-v7; latest migration is v7; Phase 15 claims v8
- `/Users/yang/lahacks/contract-ide/src-tauri/src/commands/substrate.rs` — `find_substrate_by_intent` IPC + FTS5 query pattern + `SubstrateNodeSummary` wire shape
- `/Users/yang/lahacks/contract-ide/src-tauri/src/retrieval/rerank.rs` — DeepSeek listwise reranker; reuse unchanged in Phase 15
- `/Users/yang/lahacks/contract-ide/src-tauri/src/supersession/queries.rs` — Phase 12 `write_supersession` / `fetch_current_substrate_nodes` patterns; template for Phase 15 invalidation writes
- `/Users/yang/lahacks/contract-ide/src/components/inspector/SourceArchaeologyModal.tsx` — current modal shape; Phase 15 extends in-place
- `/Users/yang/lahacks/contract-ide/src/components/command-palette/IntentPalette.tsx` — current palette; Phase 15 adds filter chips
- `/Users/yang/lahacks/contract-ide/src/components/layout/Sidebar.tsx` — sidebar structure; no icon nav bar; Substrate Health recommended as status-indicator Dialog
- `/Users/yang/lahacks/contract-ide/demo/reset-demo.sh` — seed file only touches `substrate_nodes` and `l0_priority_history`; `substrate_edits` survives
- `/Users/yang/lahacks/contract-ide/demo/seeds/substrate.sqlite.seed.sql` — demo seed structure and content
- `/Users/yang/lahacks/contract-ide/src/lib/demoOrchestration.ts` — Beat 3 current fixture-based narrowing; Phase 15 SC 7 replaces with real refine call
- `.planning/REQUIREMENTS.md` — TRUST-01..04 full text
- `.planning/ROADMAP.md` Phase 15 section — architecture decision, 6 plans, 7 success criteria

---

## Metadata

**Confidence breakdown:**
- Schema / migration analysis: HIGH — from direct code inspection
- FTS5 tombstone fix: HIGH — SQLite FTS5 content-table behavior is well-documented
- IPC transaction pattern: HIGH — Phase 12 template is identical
- Impact preview receipts gap: HIGH (gap confirmed); recommendation is MEDIUM (schema change feasibility not tested)
- Sidebar Health surface placement: MEDIUM — status-indicator Dialog is a pragmatic call; icon nav would require layout change not present in codebase

**Research date:** 2026-04-25
**Valid until:** Stable for Phase 15 planning; schema findings are current against HEAD.
