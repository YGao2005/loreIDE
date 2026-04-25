---
phase: 09-mass-edit-non-coder-mode-demo-repo-seeding
plan: 04c
subsystem: flow-contracts
tags: [flow, migration, sqlite, demo-repo, layout-primitive]
dependency_graph:
  requires: [09-04, phase-10-v4-migration]
  provides: [FLOW-01, migration-v5, flow-layout-primitive, 6-seeded-flow-contracts, getFlowMembers-selector]
  affects: [phase-13-CHAIN-01, phase-13-SUB-08, 09-05-reset-script]
tech_stack:
  added: []
  patterns:
    - "kind:flow contracts carry ordered members[] array — first is trigger, rest are participants in invocation order"
    - "Migration v5: ALTER TABLE nodes ADD COLUMN members_json TEXT (nullable) — immutable once applied"
    - "Rust serde(default) + skip_serializing_if = Option::is_none ensures v1-v4 sidecars round-trip unchanged"
    - "layoutFlowMembers(members, allNodes) pure function — y = index * 120px, trigger at y=0"
    - "TypeScript FlowContractNode discriminated union + isFlowContract() type guard for Phase 13 consumers"
key_files:
  created:
    - contract-ide/src/lib/flow-layout.ts
    - contract-ide/src/lib/__tests__/flow-layout.test.ts
    - contract-ide-demo/.contracts/flow-delete-account.md
    - contract-ide-demo/.contracts/flow-delete-workspace.md
    - contract-ide-demo/.contracts/ambient/flow-signup.md
    - contract-ide-demo/.contracts/ambient/flow-checkout.md
    - contract-ide-demo/.contracts/ambient/flow-add-team-member.md
    - contract-ide-demo/.contracts/ambient/flow-password-reset.md
    - contract-ide-demo/.contracts/ambient/lib-send-deletion-confirmation-email-001.md
    - contract-ide-demo/.contracts/ambient/lib-begin-workspace-deletion-001.md
    - contract-ide-demo/.contracts/ambient/lib-send-workspace-deletion-confirmation-001.md
    - contract-ide-demo/.contracts/ambient/lib-validate-signup-001.md
    - contract-ide-demo/.contracts/ambient/lib-send-welcome-email-001.md
    - contract-ide-demo/.contracts/ambient/lib-validate-payment-001.md
    - contract-ide-demo/.contracts/ambient/lib-send-receipt-email-001.md
    - contract-ide-demo/.contracts/ambient/lib-send-invite-email-001.md
    - contract-ide-demo/.contracts/ambient/lib-send-password-reset-email-001.md
    - contract-ide-demo/.contracts/ambient/data-order-001.md
    - contract-ide-demo/.contracts/ambient/data-invite-001.md
  modified:
    - contract-ide/src-tauri/src/db/migrations.rs
    - contract-ide/src-tauri/src/sidecar/frontmatter.rs
    - contract-ide/src-tauri/src/db/scanner.rs
    - contract-ide/src-tauri/src/commands/nodes.rs
    - contract-ide/src-tauri/src/commands/graph.rs
    - contract-ide/src/ipc/types.ts
    - contract-ide/src/store/graph.ts
    - .planning/demo/contract-ide-demo-spec.md
decisions:
  - "Migration v5 added as next slot after Phase 10 v4 — immutable per tauri-plugin-sql versioning rule"
  - "validate_flow_members() added to frontmatter.rs (not a separate file) — consistent with Phase 8 PROP-01 design of keeping validators alongside the parser they validate"
  - "Flow UUIDs use short-form: flow-de1e-...-acc... (not full UUID4) — human-readable, unique in the corpus"
  - "11 new participant contracts added (not 8) — needed to fill all flow chain gaps; data-order and data-invite added in addition to lib contracts"
  - "Ambient flow triggers: signup→f1020100 (SignupForm), checkout→f4020100 (CheckoutButton), add-team-member→f3010100 (MembersTable), password-reset→f1010100 (LoginForm — Forgot password link)"
  - "password-reset flow has 3 members (minimum for chain depth) — simpler than other flows by design"
  - "demo-base tag advanced from 95c1c20 to 9f5029b — 09-05 reset script references the new tag"
metrics:
  duration_minutes: 17
  completed_date: 2026-04-25
  tasks_completed: 2
  tasks_total: 2
  files_created: 20
  files_modified: 8
---

# Phase 9 Plan 04c: FLOW-01 Summary

Landed FLOW-01: `kind: flow` contract type with ordered `members[]` array, migration v5
persisting `members_json`, the frontmatter parser extension, 6 seeded flow contracts
(2 scenario + 4 ambient) committed to the demo repo at the new locked SHA, and the
`layoutFlowMembers()` layout primitive Phase 13 CHAIN-01 will consume.

## Precondition verification

Phase 10 v4 migration (`phase10_sessions_and_episodes`) was present at execution start —
confirmed by reading migrations.rs before modification. v5 was appended after v4 as the
next available slot. Migration sequence is now v1 → v2 → v3 → v4 → v5, monotonic.

## Migration v5 final SQL

```sql
-- Phase 9 FLOW-01: members array for kind:flow contracts.
-- Stored as JSON string array of UUIDs in invocation order.
-- Non-flow contracts have NULL.

ALTER TABLE nodes ADD COLUMN members_json TEXT;

-- Index for the json-array-membership query Phase 13 SUB-08 will run
-- (find flows containing a given participant uuid). SQLite does not
-- index JSON natively; we index the raw text and rely on json_each()
-- in Phase 13's queries.
CREATE INDEX IF NOT EXISTS idx_nodes_members_json ON nodes(members_json) WHERE members_json IS NOT NULL;
```

## Flow contracts authored

| Flow | UUID | Trigger | # members | File |
|------|------|---------|-----------|------|
| delete-account | `flow-de1e-0000-4000-8000-acc000000000` | `a0000000` (Account Settings) | 7 | `.contracts/flow-delete-account.md` |
| delete-workspace | `flow-de1e-0000-4000-8000-wks000000000` | `b0000000` (Team Settings) | 7 | `.contracts/flow-delete-workspace.md` |
| signup | `flow-sgup-0000-4000-8000-auth000000000` | `f1020100` (SignupForm) | 5 | `.contracts/ambient/flow-signup.md` |
| checkout | `flow-chkt-0000-4000-8000-comm000000000` | `f4020100` (CheckoutButton) | 5 | `.contracts/ambient/flow-checkout.md` |
| add-team-member | `flow-atm0-0000-4000-8000-team000000000` | `f3010100` (MembersTable) | 4 | `.contracts/ambient/flow-add-team-member.md` |
| password-reset | `flow-pwrs-0000-4000-8000-auth000000001` | `f1010100` (LoginForm) | 3 | `.contracts/ambient/flow-password-reset.md` |

## delete-account chain UUID resolution (CANVAS-PURPOSE.md:67-93 reference)

Phase 13 CHAIN-01 reads this chain to render the Beat 1/2 vertical chain.

| Position | UUID | Contract name | Kind |
|----------|------|---------------|------|
| 0 (trigger) | `a0000000-0000-4000-8000-000000000000` | Account Settings page | UI L3 |
| 1 | `e1000000-0000-4000-8000-000000000000` | POST /api/account/delete | API L3 |
| 2 | `e2000000-0000-4000-8000-000000000000` | beginAccountDeletion | lib L3 |
| 3 | `e5000000-0000-4000-8000-000000000000` | db.user | data L2 |
| 4 | `e7000000-0000-4000-8000-000000000000` | stripe.customers.update | external L3 |
| 5 | `e8000000-0000-4000-8000-000000000000` | mailchimp.suppress | external L3 |
| 6 | `ec000000-0000-4000-8000-000000000000` | sendDeletionConfirmationEmail | lib L3 |

layoutFlowMembers y-positions: 0, 120, 240, 360, 480, 600, 720 px.

## delete-workspace chain UUID resolution (Beat 4)

| Position | UUID | Contract name | Kind | Shared with delete-account? |
|----------|------|---------------|------|-----------------------------|
| 0 (trigger) | `b0000000-0000-4000-8000-000000000000` | Team Settings page | UI L3 | No |
| 1 | `e4000000-0000-4000-8000-000000000000` | DELETE /api/workspace/[slug] | API L3 | No |
| 2 | `ed000000-0000-4000-8000-000000000000` | beginWorkspaceDeletion | lib L3 | No |
| 3 | `e5000000-0000-4000-8000-000000000000` | db.user | data L2 | **Yes** |
| 4 | `e7000000-0000-4000-8000-000000000000` | stripe.customers.update | external L3 | **Yes** |
| 5 | `e8000000-0000-4000-8000-000000000000` | mailchimp.suppress | external L3 | **Yes** |
| 6 | `ee000000-0000-4000-8000-000000000000` | sendWorkspaceDeletionConfirmationEmail | lib L3 | No |

Ghost references (Phase 13): members 3, 4, 5 are shared — Phase 13 CHAIN-01 renders these as ghost-referenced cards with "also in delete-account" annotations (Beat 4 visual).

## New participant contracts added (to fill flow chain gaps)

11 new ambient contracts authored:

| UUID | Contract | Kind | Flow |
|------|----------|------|------|
| `ec000000` | sendDeletionConfirmationEmail | lib L3 | delete-account |
| `ed000000` | beginWorkspaceDeletion | lib L3 | delete-workspace |
| `ee000000` | sendWorkspaceDeletionConfirmationEmail | lib L3 | delete-workspace |
| `ef000000` | validateSignup | lib L3 | signup |
| `f00000a0` | sendWelcomeEmail | lib L3 | signup |
| `f00000b0` | validatePayment | lib L3 | checkout |
| `f00000c0` | sendReceiptEmail | lib L3 | checkout |
| `f00000d0` | sendInviteEmail | lib L3 | add-team-member |
| `f00000e0` | sendPasswordResetEmail | lib L3 | password-reset |
| `f00000f0` | data-order | data L2 | checkout |
| `f0000100` | data-invite | data L2 | add-team-member |

## validate_flow_members

validate_flow_members() added to `frontmatter.rs` (not a separate file). It:
1. Asserts every `kind: flow` contract has `members: Some(non_empty)`.
2. Asserts every UUID in `members` exists in the loaded contracts set.

The function returns `Vec<String>` of human-readable errors. The scanner's
`scan_contracts_dir` calls it post-parse; errors are appended to `ScanResult.errors`
(surfaced as the startup validation banner per 09-04b pattern).

Validation ran during contract authoring via UUID presence checks — all 6 flow
contracts have valid members. No dangling UUIDs at commit time.

## Locked SHA update

| | SHA |
|-|-----|
| Pre-FLOW-01 (09-04 locked SHA) | `95c1c203ec1e05cdc293ce8ce30c50c9b18d6cdd` |
| Post-FLOW-01 (09-04c locked SHA) | `9f5029b0f4667ef4c5182a5386092b8e201e01af` |
| Tag | `demo-base` (updated to new SHA) |

09-05's reset script references `demo-base` — it will restore the 49-contract
state (35 + 14 new) with an empty `.contracts/` when the demo starts.

## Deviations from Plan

### Auto-added missing functionality

**1. [Rule 2 - Missing critical] 11 participant contracts added (not 8 as anticipated)**
- **Found during:** Task 2 — flow contract authoring
- **Issue:** Ambient flows needed participants that didn't exist in the 09-04 corpus:
  the signup flow needed validateSignup + sendWelcomeEmail; checkout needed validatePayment,
  sendReceiptEmail, and data-order; add-team-member needed sendInviteEmail and data-invite;
  password-reset needed sendPasswordResetEmail
- **Fix:** Authored the 11 missing contracts with proper BACKEND-FM-01 sections
  (Inputs/Outputs/Side effects). UUIDs follow the `f00000XY` scheme to not conflict
  with existing e/f-prefix contracts.
- **Files modified:** 11 new `.contracts/ambient/*.md` files in demo repo
- **Commit:** `9f5029b` (demo repo)

**2. [Rule 1 - Bug] hydrate_node_rows SELECT queries needed members_json added**
- **Found during:** Task 1 — writing the hydration helper
- **Issue:** Both SELECT paths in `graph.rs` projected the old column set; without
  `members_json` in the projection, the column would be absent from SqliteRow and
  `try_get("members_json")` would fail at runtime
- **Fix:** Added `members_json` to both SELECT statements in `graph.rs`
- **Files modified:** `contract-ide/src-tauri/src/commands/graph.rs`
- **Commit:** `72d276b`

## Verification

- `cargo check`: PASSED (clean, no warnings)
- `npx tsc --noEmit`: PASSED (clean)
- `npx vitest run src/lib/__tests__/flow-layout.test.ts`: 7/7 PASSED
- Rust frontmatter tests: 4 new FLOW-01 tests added, all pass with `cargo test`
- demo repo UUID cross-reference: all 6 flow member UUIDs confirmed present via bash script
- No duplicate UUIDs in demo repo (grep -rh "^uuid:" | uniq -d = empty)

## Self-Check: PASSED

Key files exist:
- contract-ide/src/lib/flow-layout.ts: FOUND
- contract-ide/src/lib/__tests__/flow-layout.test.ts: FOUND
- contract-ide-demo/.contracts/flow-delete-account.md: FOUND
- contract-ide-demo/.contracts/flow-delete-workspace.md: FOUND
- contract-ide-demo/.contracts/ambient/flow-signup.md: FOUND
- contract-ide-demo/.contracts/ambient/flow-checkout.md: FOUND
- contract-ide-demo/.contracts/ambient/flow-add-team-member.md: FOUND
- contract-ide-demo/.contracts/ambient/flow-password-reset.md: FOUND
- .planning/demo/contract-ide-demo-spec.md updated with FLOW-01 section: CONFIRMED

Commits:
- 72d276b feat(09-04c): FLOW-01 — migration v5 + kind:flow frontmatter + scanner + TS primitives
- 55d1900 feat(09-04c): FLOW-01 — update demo spec with 6 flow UUIDs + locked SHA
- demo repo 9f5029b feat: seed 6 flow contracts (FLOW-01) — 2 scenario + 4 ambient
