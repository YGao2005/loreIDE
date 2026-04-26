---
phase: 15
plan: "03"
subsystem: substrate-trust-surface
tags:
  - trust-02
  - refine-rule
  - chain-version
  - audit-trail
  - react-ui
  - sqlx-transaction
dependency_graph:
  requires:
    - Phase 15 Plan 01 (v8 migration: substrate_edits + FTS tombstone fix)
    - Phase 15 Plan 02 (SubstrateNodeSummary.applies_when + SourceArchaeologyModal base)
    - Phase 13 Plan 07 (useCitationStore base + SourceArchaeologyModal base)
  provides:
    - refine_substrate_rule Rust IPC (4-step atomic transaction)
    - get_substrate_chain Rust IPC (recursive CTE oldest→newest with audit join)
    - RefineRuleEditor React component (inline editor with reason field)
    - SubstrateRuleHistoryTab React component (chain walk with side-by-side before/after)
    - SourceArchaeologyModal Detail|History tabs with 200ms tab transitions
    - ⌘E shortcut → Refine mode activation
    - useCitationStore.onRefineSuccess commit-handshake for plan 15-06
  affects:
    - 15-04 delete/restore (appends to substrate_trust.rs)
    - 15-06 Beat 3 demo refine (consumes onRefineSuccess commit-handshake)
tech_stack:
  added: []
  patterns:
    - sqlx transaction (begin/execute/commit with rows_affected race guard)
    - SQLite recursive CTE with LEFT JOIN for chain walk + audit join
    - Zustand store extension (new fields without breaking existing consumers)
    - Tailwind transition-[opacity,transform] duration-200 ease-out for tab transitions
    - animate-in fade-in for Refine editor entrance
key_files:
  created:
    - contract-ide/src-tauri/src/commands/substrate_trust.rs
    - contract-ide/src/ipc/substrateTrust.ts
    - contract-ide/src/components/inspector/RefineRuleEditor.tsx
    - contract-ide/src/components/inspector/SubstrateRuleHistoryTab.tsx
    - contract-ide/src-tauri/tests/substrate_trust_refine.rs
  modified:
    - contract-ide/src-tauri/src/commands/mod.rs
    - contract-ide/src-tauri/src/lib.rs
    - contract-ide/src/store/citation.ts
    - contract-ide/src/components/inspector/SourceArchaeologyModal.tsx
decisions:
  - "before_text audit field stores old row text only (v1); applies_when changes not captured in before/after audit columns — text contains the load-bearing rationale content; TODO(v2) store JSON"
  - "Chain history rendered oldest-first (oldest at top, head at bottom) per RESEARCH Pattern 3 SQL ORDER BY valid_at ASC — chronological reading order feels natural"
  - "No diff library for before/after rendering — plain side-by-side <pre> blocks per RESEARCH Open Question 2 decision; sufficient for v1 demo"
  - "originalUuidRef.current (useRef) captures the uuid at Refine-enter time for onRefineSuccess commit-handshake — avoids stale closure over openUuid which is re-pointed after Save"
  - "Tab transitions use CSS translate-y + opacity (Tailwind transition-[opacity,transform] duration-200 ease-out) with pointer-events-none on the hidden tab to prevent ghost clicks"
metrics:
  duration: "~8 minutes"
  completed_date: "2026-04-26"
  tasks_completed: 2
  files_modified: 9
---

# Phase 15 Plan 03: TRUST-02 Refine Path Summary

Atomic refine IPC + inline editor + History tab chain walk. The load-bearing Beat 3 verb: "I disagree with this rule, I refine it with a reason, the audit trail captures the why."

## What Was Built

### Task 1: Rust — substrate_trust.rs module + integration tests

**`commands/substrate_trust.rs`** — 307 lines, two `#[tauri::command]` fns:

**refine_substrate_rule** signature:
```rust
pub async fn refine_substrate_rule(
    app: tauri::AppHandle,
    uuid: String,
    new_text: String,
    new_applies_when: Option<String>,
    reason: String,
    actor: String,
) -> Result<String, String>
```

Transaction steps (all-or-nothing):
1. `SELECT text FROM substrate_nodes WHERE uuid = ?1 AND invalid_at IS NULL` — fetch_optional → if None, return `Err("rule {uuid} not found or already tombstoned — cannot refine")`
2. Generate `new_uuid = Uuid::new_v4()`, `edit_id = Uuid::new_v4()`, `now = Utc::now().to_rfc3339()`
3. `pool.begin()` → INSERT new row copying all columns via SELECT-INSERT pattern, overriding text/applies_when/timestamps/prev_version_uuid
4. `UPDATE substrate_nodes SET invalid_at = ?1, invalidated_reason = 'refined: <reason>' WHERE uuid = ?old AND invalid_at IS NULL` — if rows_affected == 0 → rollback → Err (race guard)
5. `INSERT INTO substrate_edits (kind='refine', before_text=old_text, after_text=new_text, ...)` 
6. `tx.commit()` → `Ok(new_uuid)`

FTS triggers from Plan 15-01 fire automatically inside the transaction — new row indexed on INSERT, old row removed from FTS on UPDATE (WHERE new.invalid_at IS NULL guard suppresses re-insert).

**get_substrate_chain** SQL block:
```sql
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
SELECT chain.uuid, chain.text, ...,
       se.actor, se.before_text, se.reason
FROM chain
LEFT JOIN substrate_edits se
    ON se.new_version_uuid = chain.uuid
   AND se.kind = 'refine'
ORDER BY chain.valid_at ASC
```

`version_number` is assigned 1-indexed in Rust after the query returns sorted rows.

**`commands/mod.rs`**: `pub mod substrate_trust;` added after `pub mod substrate_panel;`

**`lib.rs`**: Appended after `commands::reset_demo::reset_demo_state` per Wave-3 serialization_hint:
```rust
commands::substrate_trust::refine_substrate_rule,
commands::substrate_trust::get_substrate_chain,
```

**Integration tests** (`tests/substrate_trust_refine.rs`) — 583 lines, 3 cases all pass:
- `refine_writes_new_chain_row_invalidates_old_and_audits`
- `refine_on_tombstoned_row_returns_error`
- `get_substrate_chain_returns_versions_oldest_to_newest`

### Task 2: Frontend — IPC wrappers + store extension + modal + components

**`src/ipc/substrateTrust.ts`**:
```ts
export async function refineSubstrateRule(uuid, newText, newAppliesWhen, reason): Promise<string>
export async function getSubstrateChain(uuid): Promise<ChainVersion[]>
```
Actor hardcoded to `human:yangg40@g.ucla.edu` for v1. TODO(v2): read from settings.

**`src/store/citation.ts`** — onRefineSuccess commit-handshake contract:
```ts
onRefineSuccess: ((originalUuid: string) => void) | null;
setOnRefineSuccess: (cb: ((originalUuid: string) => void) | null) => void;
```
- Initial state: `onRefineSuccess: null`
- `closeCitation` now also sets `onRefineSuccess: null` (defensive clear)
- Producers (plan 15-06's VerifierPanel) call `setOnRefineSuccess(acceptFlag)` at modal-open time
- Cmd+P substrate hits leave `onRefineSuccess = null` so refines through that path are silent

**`SourceArchaeologyModal.tsx`** — re-fetching detail after Save:
- `openCitation(newUuid)` re-points the modal to the new chain head
- This re-fires the `useEffect([openUuid])` which calls `getSubstrateNodeDetail(openUuid)` afresh
- The effect also resets `refining=false` and `activeTab='detail'` on uuid change
- `setActiveTab('history')` immediately after `openCitation(newUuid)` means the history tab is active when the new detail fetch completes

**onRefineSuccess invocation order (load-bearing):**
```ts
// In handleRefineSave(newUuid):
const originalUuid = originalUuidRef.current;  // captured at Refine-enter time
const cb = useCitationStore.getState().onRefineSuccess;
if (cb && originalUuid) cb(originalUuid);       // (a) FIRST — with ORIGINAL uuid
setRefining(false);                             // (b) close editor
openCitation(newUuid);                          // (c) re-point to new chain head
setActiveTab('history');                        // (d) switch to History tab
```

**⌘E shortcut wiring location:**
- `useEffect([openUuid, activeTab, refining])` in SourceArchaeologyModal
- Handler scope: `openUuid !== null AND activeTab === 'detail' AND !refining`
- Escape while refining: captured with `{ capture: true }` and `e.stopPropagation()` to prevent Dialog close

**Tab transition timing:**
- `transition-[opacity,transform] duration-200 ease-out` on both tab panels
- Hidden tab: `pointer-events-none absolute inset-0 opacity-0 -translate-y-1 / translate-y-1`
- Active tab: `translate-y-0 opacity-100`
- Total: 200ms — matches CLAUDE.md polish bar requirement

**RefineRuleEditor component contract:**
```tsx
interface Props {
  uuid: string;
  initialText: string;
  initialAppliesWhen: string;
  onSave: (newUuid: string) => void;
  onCancel: () => void;
}
```
Save disabled when: `reason.trim() === ''` OR `text.trim() === initialText.trim()`.
On error: displays red inline (does NOT close editor; lets user fix and retry).

**SubstrateRuleHistoryTab component contract:**
```tsx
interface Props { uuid: string; }
```
Calls `getSubstrateChain(uuid)` on mount. Renders oldest→newest (version 1 at top, head at bottom). For each refine step (before_text != null): side-by-side `<pre>` blocks (no diff library). Head row: `Current` badge + `border-l-2 border-primary`.

## Note for Plan 15-04

`substrate_trust.rs` is now non-empty. Plan 15-04 will append `delete_substrate_rule`, `restore_substrate_rule`, and `get_substrate_impact` BELOW the existing functions (serialization-hint pattern — do NOT insert in the middle). The `pool_clone` helper in this file is private to the module; plan 15-04 should copy the same pool-clone pattern from `commands/substrate.rs`.

## Note for Plan 15-06

The Beat 3 narrowing of `con-settings-no-modal-interrupts-2025-Q4` can now drive through this path:
- Reason: "Destructive actions require confirmation modals; the no-modal rule applies to non-destructive Settings interactions only."
- VerifierPanel sets `useCitationStore.getState().setOnRefineSuccess(acceptFlag(uuid))` at flag-click time
- Refining commits the handshake: `cb(originalUuid)` fires BEFORE modal re-points
- Flag clears via the callback

## Deviations from Plan

None — plan executed exactly as written.

Pre-existing out-of-scope failure: `commands::demo_orchestration::tests::fixture_dir_falls_back_to_crate_relative_seeds` (unchanged from plans 15-01 and 15-02; not caused by this plan's changes).

## Self-Check: PASSED

- `contract-ide/src-tauri/src/commands/substrate_trust.rs` — FOUND (307 lines, ≥180 required)
- `contract-ide/src-tauri/src/commands/mod.rs` — FOUND, `pub mod substrate_trust` present
- `contract-ide/src-tauri/src/lib.rs` — FOUND, two new commands appended after reset_demo_state
- `contract-ide/src/store/citation.ts` — FOUND, onRefineSuccess + setOnRefineSuccess present
- `contract-ide/src/components/inspector/SourceArchaeologyModal.tsx` — FOUND
- `contract-ide/src/components/inspector/RefineRuleEditor.tsx` — FOUND (149 lines, ≥90 required)
- `contract-ide/src/components/inspector/SubstrateRuleHistoryTab.tsx` — FOUND (176 lines, ≥80 required)
- `contract-ide/src/ipc/substrateTrust.ts` — FOUND
- `contract-ide/src-tauri/tests/substrate_trust_refine.rs` — FOUND (583 lines, ≥100 required)
- Commits: a52b1b5 (Task 1 Rust), 69790b1 (Task 2 frontend)
- `cargo check`: exit 0
- `cargo test --test substrate_trust_refine`: 3/3 pass
- `cargo test`: 154 pass / 1 pre-existing fail (fixture_dir_falls_back_to_crate_relative_seeds — out of scope)
- `pnpm tsc --noEmit`: exit 0
- `pnpm test`: 100 pass / 1 skipped (known VITEST_INTEGRATION gate)
