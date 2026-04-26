---
phase: 15
plan: "04"
subsystem: substrate-trust-surface
tags:
  - trust-03
  - delete-rule
  - impact-preview
  - tombstone
  - audit-trail
  - react-ui
  - sqlx-transaction
dependency_graph:
  requires:
    - Phase 15 Plan 01 (v8 migration: substrate_edits + FTS tombstone fix + receipts.substrate_rules_json)
    - Phase 15 Plan 03 (substrate_trust.rs base + SourceArchaeologyModal with Refine button)
    - Phase 13 Plan 07 (useCitationStore base + SourceArchaeologyModal base)
  provides:
    - delete_substrate_rule Rust IPC (atomic tombstone + audit row in single transaction)
    - get_substrate_impact Rust IPC (atoms-citing + recent-receipts count/list)
    - DeleteRuleConfirmDialog React component (reason picker + free-text + impact preview)
    - SubstrateImpactPreview React component (auto-loaded blast radius)
    - Delete this rule button in SourceArchaeologyModal header (paired with Refine)
    - DOM toast on successful delete (bottom-right, clear of left-side sidebar)
  affects:
    - 15-05 Substrate Health dialog (tombstoned rules have invalidated_reason format '<kind>: <text>')
    - 15-06 Beat 3 demo flow (delete path now exercisable end-to-end)
tech_stack:
  added: []
  patterns:
    - sqlx transaction (same begin/execute/commit pattern as 15-03 refine)
    - json_each(anchored_uuids) for atom-citation count (RESEARCH Pattern 6)
    - receipts.substrate_rules_json LIKE '%uuid%' for prompt-impact count
    - Native HTML radio inputs (RadioGroup shadcn component not in project)
    - DOM inline toast (project pattern from AppShell — no toast library)
key_files:
  created:
    - contract-ide/src-tauri/tests/substrate_trust_delete.rs
    - contract-ide/src/components/inspector/DeleteRuleConfirmDialog.tsx
    - contract-ide/src/components/inspector/SubstrateImpactPreview.tsx
  modified:
    - contract-ide/src-tauri/src/commands/substrate_trust.rs
    - contract-ide/src-tauri/src/lib.rs
    - contract-ide/src/ipc/substrateTrust.ts
    - contract-ide/src/components/inspector/SourceArchaeologyModal.tsx
decisions:
  - "DOM inline toast (not sonner/toast library) — project has no toast library installed; AppShell uses DOM-created elements for source:click + substrate:first-node-toast; Delete toast follows the same pattern at bottom-right position (sidebar is on LEFT, unobstructed)"
  - "Native HTML radio inputs (not shadcn RadioGroup) — @/components/ui/radio-group does not exist in the project's installed shadcn components; native inputs with accent-destructive Tailwind class achieve the same visual and ARIA semantics"
  - "rule_uuid in substrate_edits DELETE row = the deleted UUID (not a new chain row) — delete does NOT create a new chain row; it tombstones the existing row in-place and writes audit with rule_uuid=deleted_uuid, prev/new_version_uuid=NULL"
  - "actor hardcoded to human:yangg40@g.ucla.edu for v1 in deleteSubstrateRule IPC wrapper — consistent with refineSubstrateRule pattern from Plan 15-03; TODO(v2) read from settings"
  - "Toast position: bottom-right — sidebar SubstrateStatusIndicator (15-05 will add tombstone count badge) is on the LEFT side; bottom-right is unobstructed and matches AppShell source:click toast position"
metrics:
  duration: "~15 minutes"
  completed_date: "2026-04-26"
  tasks_completed: 2
  files_modified: 7
---

# Phase 15 Plan 04: TRUST-03 Delete Path Summary

Atomic delete IPC + confirm dialog with reason picker + blast-radius preview. The demo's tangible answer to "what stops the substrate from filling with hallucinated rules?"

## What Was Built

### Task 1: Rust — delete_substrate_rule + get_substrate_impact appended to substrate_trust.rs

**`delete_substrate_rule`** signature (verbatim):
```rust
pub async fn delete_substrate_rule(
    app: tauri::AppHandle,
    uuid: String,
    reason_kind: String,    // "Hallucinated" | "Obsolete" | "Wrong scope" | "Duplicate" | "Other"
    reason_text: String,    // free-text; required when reason_kind == "Other"
    actor: String,          // "human:<email>"
) -> Result<(), String>
```

Transaction steps (all-or-nothing):
1. Validate `reason_kind` in `ALLOWED_REASON_KINDS` — returns `Err("invalid reason_kind")` otherwise
2. Validate `reason_kind == "Other"` implies `!reason_text.trim().is_empty()` — returns `Err("free-text required when reason is Other")`
3. `SELECT text FROM substrate_nodes WHERE uuid = ?1 AND invalid_at IS NULL` — if None, returns `Err("rule {uuid} not found or already tombstoned")`
4. Compose `invalidated_reason = format!("{reason_kind}: {reason_text}")`
5. Transaction: UPDATE invalid_at=now, invalidated_reason, invalidated_by=actor WHERE uuid AND invalid_at IS NULL
6. Transaction: INSERT substrate_edits kind='delete', rule_uuid=uuid, prev/new_version_uuid=NULL, before_text=old_text, after_text=NULL
7. COMMIT — FTS trigger fires automatically, tombstoned row removed from FTS, NOT re-inserted

**`get_substrate_impact`** signature (verbatim):
```rust
pub async fn get_substrate_impact(
    app: tauri::AppHandle,
    uuid: String,
) -> Result<SubstrateImpact, String>
```

SQL blocks (verbatim, for plan 15-05 + 15-06 reference):

```sql
-- Atoms citing the rule via anchored_uuids JSON array (json_each per RESEARCH Pattern 6)
SELECT n.uuid, COALESCE(n.name, n.uuid) AS name, COALESCE(n.kind, '') AS kind,
       COALESCE(n.level, 0) AS level
FROM substrate_nodes s, json_each(s.anchored_uuids) je
JOIN nodes n ON n.uuid = je.value
WHERE s.uuid = ?1
LIMIT 50

-- Atom count
SELECT COUNT(*) AS atom_count
FROM substrate_nodes s, json_each(s.anchored_uuids) je
WHERE s.uuid = ?1

-- Recent prompts (past 7 days) referencing this rule via receipts.substrate_rules_json
SELECT id, created_at, COALESCE(raw_summary, '') AS prompt_excerpt
FROM receipts
WHERE created_at > datetime('now', '-7 days')
  AND substrate_rules_json IS NOT NULL
  AND substrate_rules_json LIKE '%' || ?1 || '%'
ORDER BY created_at DESC
LIMIT 50

-- Recent prompt count
SELECT COUNT(*) AS recent_prompt_count
FROM receipts
WHERE created_at > datetime('now', '-7 days')
  AND substrate_rules_json IS NOT NULL
  AND substrate_rules_json LIKE '%' || ?1 || '%'
```

**`lib.rs`** — 4 substrate_trust entries in order (refine → get_chain → delete → get_impact):
```rust
commands::substrate_trust::refine_substrate_rule,
commands::substrate_trust::get_substrate_chain,
commands::substrate_trust::delete_substrate_rule,
commands::substrate_trust::get_substrate_impact,
```

**Integration tests** (`tests/substrate_trust_delete.rs`) — 4 cases all pass:
- `delete_writes_tombstone_and_audit_row` — invalid_at non-NULL, invalidated_reason='Obsolete: <text>', audit row with before_text=original, after_text=NULL, FTS returns 0 hits
- `delete_on_tombstoned_row_returns_error` — second delete returns Err containing "tombstoned"; audit row count stays at 1
- `delete_with_other_reason_requires_free_text` — empty text → Err("free-text required"); non-empty text → Ok
- `get_substrate_impact_counts_atoms_and_recent_receipts` — atom_count=2 (from anchored_uuids), recent_prompt_count=2 (within 7 days), old receipt excluded

### Task 2: Frontend — IPC wrappers + SubstrateImpactPreview + DeleteRuleConfirmDialog + modal extension

**`src/ipc/substrateTrust.ts`** — appended (verbatim for 15-06 reference):
```ts
export type DeleteReasonKind = 'Hallucinated' | 'Obsolete' | 'Wrong scope' | 'Duplicate' | 'Other';

export async function deleteSubstrateRule(
  uuid: string,
  reasonKind: DeleteReasonKind,
  reasonText: string,
): Promise<void>  // actor hardcoded to 'human:yangg40@g.ucla.edu'

export async function getSubstrateImpact(uuid: string): Promise<SubstrateImpact>
```

**`DeleteRuleConfirmDialog`** component contract:
```tsx
interface Props {
  uuid: string;
  onConfirmed: (atomCount: number) => void;
  onCancel: () => void;
}
```
- 5 radio items with demo-grade labels (NOT raw enum strings):
  - "Wrong (hallucinated)" → wire "Hallucinated"
  - "Outdated" → wire "Obsolete"
  - "Scope mismatch" → wire "Wrong scope"
  - "Duplicate" → wire "Duplicate"
  - "Other reason" → wire "Other"
- Free-text textarea: required when Other selected, optional otherwise (label reflects this)
- SubstrateImpactPreview auto-loaded on mount
- Confirm gate: reason selected AND (if Other) text non-empty
- Spinner on Confirm button while deleting
- Inline error on failure (does NOT close dialog; lets user retry)

**`SubstrateImpactPreview`** component contract:
```tsx
interface Props {
  uuid: string;
  onLoad?: (impact: SubstrateImpact) => void;
}
```
- Calls getSubstrateImpact(uuid) on mount
- Skeleton lines while loading
- Two sections: "Atoms citing this rule" (first 10 + "and N more") + "Recent agent prompts (past 7 days)" (first 5 + "and N more")
- Empty states: "No atoms currently cite this rule." / "No recent agent prompts referenced this rule."
- Error: "Could not load impact preview — <msg>" in muted red + console.warn

**`SourceArchaeologyModal`** extension:
- "Delete this rule" button added to header alongside Refine button (same button-row container)
- Opens DeleteRuleConfirmDialog on click
- `handleDeleteConfirmed(atomCount)`: closes modal + fires DOM toast

**Exact toast string** (for plan 15-06 UAT grep):
```
Rule tombstoned — N atoms previously cited it
```
(where N is `atom_count` from SubstrateImpactPreview; "atom" singular for N=1, "atoms" plural otherwise)

**Toast position:** bottom-right (`right:2rem` CSS). Rationale: SubstrateStatusIndicator (Plan 15-05 will add `🪦 N tombstoned` badge) is in the sidebar on the LEFT side. Bottom-right is unobstructed. Matches AppShell `source:click` DOM-toast position.

## Note for Plan 15-05

Tombstoned rules now have `invalidated_reason` populated in the format `'<reason_kind>: <reason_text>'`.
Example values:
- `"Hallucinated: the rule was inferred from a debug experiment, not a real constraint"`
- `"Obsolete: we moved to a different approach after Q1"`
- `"Wrong scope: applies to admin flows only, not public API"`

The Substrate Health dialog (Plan 15-05) can parse by splitting on the first `: ` to extract `reason_kind` for grouping/display.

## Note for Plan 15-06

The toast string is `Rule tombstoned — N atoms previously cited it`. UAT can grep for `Rule tombstoned` in the DOM to verify.

The delete IPC path is fully wired: UI → deleteSubstrateRule → delete_substrate_rule Rust IPC → atomic transaction → FTS removal. Beat 3 demo can exercise this end-to-end.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] shadcn RadioGroup not installed**
- **Found during:** Task 2 frontend implementation
- **Issue:** `@/components/ui/radio-group` does not exist in the project's shadcn component set (installed components are: badge, button, checkbox, dialog, input, label, resizable, scroll-area, select, separator, textarea)
- **Fix:** Replaced RadioGroup + RadioGroupItem with native `<input type="radio">` elements with `accent-destructive` Tailwind class. Achieves identical visual semantics and ARIA accessibility without introducing a new shadcn dependency that would require `npx shadcn@latest add radio-group`.
- **Files modified:** `DeleteRuleConfirmDialog.tsx` (RadioGroup removed before commit)
- **Commit:** 4d82a8e

## Self-Check: PASSED

- `contract-ide/src-tauri/src/commands/substrate_trust.rs` — FOUND, delete_substrate_rule + get_substrate_impact appended below 15-03's functions
- `contract-ide/src-tauri/src/lib.rs` — FOUND, 4 substrate_trust entries in order (refine → get_chain → delete → get_impact)
- `contract-ide/src-tauri/tests/substrate_trust_delete.rs` — FOUND
- `contract-ide/src/ipc/substrateTrust.ts` — FOUND, deleteSubstrateRule + getSubstrateImpact appended
- `contract-ide/src/components/inspector/DeleteRuleConfirmDialog.tsx` — FOUND
- `contract-ide/src/components/inspector/SubstrateImpactPreview.tsx` — FOUND
- `contract-ide/src/components/inspector/SourceArchaeologyModal.tsx` — FOUND, Delete button + dialog + toast
- Commits: 3b8db9b (Task 1 Rust), 4d82a8e (Task 2 frontend)
- `cargo check`: exit 0
- `cargo test --test substrate_trust_delete`: 4/4 pass
- `cargo test`: all suites pass (155 unit tests + integration suites)
- `pnpm tsc --noEmit`: exit 0
- `pnpm test`: 100 pass / 1 skipped (known VITEST_INTEGRATION gate)
