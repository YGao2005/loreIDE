# Phase 13 — Display-name polish (UUID-as-name elimination)

**Status:** complete · 2026-04-25
**Driver:** the live 4-beat demo. Sidebar / canvas / breadcrumb / atom chips
should never surface a raw UUID slice as a contract's display name (Yang
caught `flow-de1e-0000-4000-8000-wks000000000` rendering as a flow name and
`e700000` rendering as a connector under `prisma/schema.prisma`).

## Part 1 — Rust derivation chain

### `ContractFrontmatter` gains an optional `name`

`contract-ide/src-tauri/src/sidecar/frontmatter.rs:55-61` adds:

```rust
#[serde(default, skip_serializing_if = "Option::is_none")]
pub name: Option<String>,
```

Backwards-compatible: legacy v2/v3/v5 sidecars without `name` continue to
parse (serde defaults to `None`). The 12 in-file struct literals + the v3
JSON Schema (`.agents/skills/codebase-to-contracts/schemas/frontmatter.json`)
were updated in lockstep.

### Scanner derivation order (was vs now)

Before — `contract-ide/src-tauri/src/db/scanner.rs:201-211`:

```rust
let name = fm.code_ranges
    .first()
    .map(|r| Path::new(&r.file).file_name()...unwrap_or(&fm.uuid))
    .unwrap_or_else(|| fm.uuid.clone());     // ← drops to bare UUID
```

After — same file, `upsert_node_pub`:

```rust
let name = fm.name.clone()
    .filter(|s| !s.trim().is_empty())
    .or_else(|| derive_from_route(&fm.route))
    .or_else(|| derive_from_intent_first_sentence(body))
    .or_else(|| derive_from_file_basename(&fm.code_ranges))
    .unwrap_or_else(|| format!("untitled-{}", &fm.uuid[..8]));
```

Helpers added at the bottom of `scanner.rs`:

- `derive_from_route` — `/account/settings` → "Account Settings"; HTTP-verb
  routes pass through (`DELETE /api/account`); dynamic `[slug]` / `:id` /
  `{id}` segments are dropped.
- `derive_from_intent_first_sentence` — pulls the lead clause from the
  `## Intent` H2 (or first body paragraph), capped at 50 chars at a word
  boundary. Mirrors the substrate distiller's `derive_node_name`.
- `derive_from_file_basename` — Next.js conventions (`page.tsx` → parent
  dir name); `schema.prisma` → "Schema (Prisma)"; CamelCase /
  kebab-case / snake_case split → Title Case.

14 unit tests in `db::scanner::derive_name_tests` cover route, intent, and
basename derivations including the dynamic-segment, HTTP-verb-pass-through,
and Next.js-page-parent-rewrite edge cases.

### Last-resort placeholder

When all four strategies return `None`, the scanner emits `"untitled-<8>"`
(e.g. `untitled-a0000000`). Still includes a UUID slice but is explicitly
prefixed with `untitled-` so it reads as a placeholder. This should never
trigger for any contract in `contract-ide-demo` after Part 2.

## Part 2 — UI fallback elimination

`grep -rn "uuid\.slice(0, 8)" contract-ide/src/ --include='*.tsx' --include='*.ts'`
returns **0** matches.

| File | Line | Before | After |
|---|---|---|---|
| `components/graph/AtomChipOverlay.tsx` | 92 | `atom?.name ?? r.uuid.slice(0, 8)` | `atom?.name ?? 'Untitled atom'` |
| `components/graph/Breadcrumb.tsx` | 28 | `node?.name ?? uuid.slice(0, 8)` | `node?.name ?? 'Untitled'` |
| `components/inspector/ReconcilePanel.tsx` | 89,139,169 | `Reconcile {node.name ?? node.uuid.slice(0, 8)}` | `Reconcile {node.name ?? 'Untitled contract'}` |
| `components/substrate/PRReviewExplanation.tsx` | 104 | `{n.name ?? n.uuid.slice(0, 8)}` | `{n.name ?? 'Untitled'}` |
| `components/reconcile/ChildrenChangesView.tsx` | 67 | `{d.child_uuid.slice(0, 8)} :: {d.section_name}` | `{nameForChild(d.child_uuid)} · {d.section_name}` (graph store lookup) |
| `components/reconcile/DraftPropagationDiff.tsx` | 99 | `{s.child_uuid.slice(0, 8)} :: {s.section_name}` | `{nameForChild(s.child_uuid)} · {s.section_name}` (graph store lookup) |

`components/graph/ScreenViewerOverlay.tsx:100` already fell through to `''`
— left unchanged per the original task spec.

## Part 3 — `contract-ide-demo` author pass

`contract-ide-demo/scripts/add-names.mjs` walks `.contracts/` (excluding
`.archive/`), looks up each contract by UUID or filename, and writes a
`name:` field via the same `writeFrontmatter` round-trip helper used by the
codebase-to-contracts skill. 55 contracts written; round-trip parity test
(`frontmatter-writer.test.mjs`) passes against the rewritten exemplars.

### Demo-arc names (verified against the 4-beat script)

```
Beat 1 — Account Settings PM flow
  a0000000-…       → Account Settings
  a1000000-…       → Danger Zone
  a2000000-…       → Profile
  a3000000-…       → Email Preferences
  a4000000-…       → Notifications

Beat 2 — Delete-account flow execution
  flow-de1e-…-acc  → Delete Account Flow
  e1000000-…       → DELETE /api/account
  e2000000-…       → beginAccountDeletion
  e7000000-…       → Stripe Customer Adapter
  e8000000-…       → Mailchimp Suppression Adapter
  e5000000-…       → User
  e6000000-…       → Invoice
  ec000000-…       → sendDeletionConfirmationEmail

Beat 4 — Workspace delete
  b0000000-…       → Team Settings
  b1000000-…       → Workspace Danger Zone
  flow-de1e-…-wks  → Delete Workspace Flow
  e4000000-…       → DELETE /api/team/[slug]
  ed000000-…       → beginWorkspaceDeletion
  ee000000-…       → sendWorkspaceDeletionConfirmationEmail
  f00000f0-…       → Order
  f0000100-…       → Invite
```

### Full UUID → name table

| UUID | Name | File |
|---|---|---|
| a0000000-0000-4000-8000-000000000000 | Account Settings | a0000000-….md |
| a1000000-0000-4000-8000-000000000000 | Danger Zone | a1000000-….md |
| a2000000-0000-4000-8000-000000000000 | Profile | a2000000-….md |
| a3000000-0000-4000-8000-000000000000 | Email Preferences | a3000000-….md |
| a4000000-0000-4000-8000-000000000000 | Notifications | a4000000-….md |
| b0000000-0000-4000-8000-000000000000 | Team Settings | b0000000-….md |
| b1000000-0000-4000-8000-000000000000 | Workspace Danger Zone | b1000000-….md |
| f3010100-0000-4000-8000-000000000000 | Members Table | f3010100-….md |
| f4020101-0000-4000-8000-000000000000 | Pay Button | f4020101-….md |
| flow-de1e-0000-4000-8000-acc000000000 | Delete Account Flow | flow-delete-account.md |
| flow-de1e-0000-4000-8000-wks000000000 | Delete Workspace Flow | flow-delete-workspace.md |
| e1000000-0000-4000-8000-000000000000 | DELETE /api/account | ambient/api-account-delete-001.md |
| ea000000-0000-4000-8000-000000000000 | POST /api/checkout | ambient/api-checkout-001.md |
| e3000000-0000-4000-8000-000000000000 | POST /api/session | ambient/api-session-create-001.md |
| e4000000-0000-4000-8000-000000000000 | DELETE /api/team/[slug] | ambient/api-workspace-delete-001.md |
| f0000100-0000-4000-8000-000000000000 | Invite | ambient/data-invite-001.md |
| e6000000-0000-4000-8000-000000000000 | Invoice | ambient/data-invoice-001.md |
| f00000f0-0000-4000-8000-000000000000 | Order | ambient/data-order-001.md |
| e5000000-0000-4000-8000-000000000000 | User | ambient/data-user-001.md |
| eb000000-0000-4000-8000-000000000000 | Stripe Payment Webhook | ambient/event-payment-webhook-001.md |
| e8000000-0000-4000-8000-000000000000 | Mailchimp Suppression Adapter | ambient/external-mailchimp-001.md |
| e7000000-0000-4000-8000-000000000000 | Stripe Customer Adapter | ambient/external-stripe-001.md |
| f1000000-0000-4000-8000-000000000000 | Auth Flow | ambient/f1000000-….md |
| f1010000-0000-4000-8000-000000000000 | Login | ambient/f1010000-….md |
| f1010100-0000-4000-8000-000000000000 | Login Form | ambient/f1010100-….md |
| f1010101-0000-4000-8000-000000000000 | Login Button | ambient/f1010101-….md |
| f1020000-0000-4000-8000-000000000000 | Signup | ambient/f1020000-….md |
| f1020100-0000-4000-8000-000000000000 | Signup Form | ambient/f1020100-….md |
| f1020101-0000-4000-8000-000000000000 | Signup Button | ambient/f1020101-….md |
| f2000000-0000-4000-8000-000000000000 | Account Flow | ambient/f2000000-….md |
| f2010000-0000-4000-8000-000000000000 | Billing | ambient/f2010000-….md |
| f2010100-0000-4000-8000-000000000000 | Profile Settings | ambient/f2010100-….md |
| f3000000-0000-4000-8000-000000000000 | Team Admin Flow | ambient/f3000000-….md |
| f3010000-0000-4000-8000-000000000000 | Team Members | ambient/f3010000-….md |
| f3010101-0000-4000-8000-000000000000 | Member Role Selector | ambient/f3010101-….md |
| f3020000-0000-4000-8000-000000000000 | Workspace Settings | ambient/f3020000-….md |
| f4000000-0000-4000-8000-000000000000 | Commerce Flow | ambient/f4000000-….md |
| f4010000-0000-4000-8000-000000000000 | Cart | ambient/f4010000-….md |
| f4020000-0000-4000-8000-000000000000 | Checkout | ambient/f4020000-….md |
| f4020100-0000-4000-8000-000000000000 | Checkout Button | ambient/f4020100-….md |
| flow-atm0-…-team000000000 | Add Team Member Flow | ambient/flow-add-team-member.md |
| flow-chkt-…-comm000000000 | Checkout Flow | ambient/flow-checkout.md |
| flow-pwrs-…-auth000000001 | Password Reset Flow | ambient/flow-password-reset.md |
| flow-sgup-…-auth000000000 | Signup Flow | ambient/flow-signup.md |
| e9000000-0000-4000-8000-000000000000 | Nightly Purge Job | ambient/job-nightly-purge-001.md |
| e2000000-0000-4000-8000-000000000000 | beginAccountDeletion | ambient/lib-begin-account-deletion-001.md |
| ed000000-0000-4000-8000-000000000000 | beginWorkspaceDeletion | ambient/lib-begin-workspace-deletion-001.md |
| ec000000-0000-4000-8000-000000000000 | sendDeletionConfirmationEmail | ambient/lib-send-deletion-confirmation-email-001.md |
| f00000d0-0000-4000-8000-000000000000 | sendInviteEmail | ambient/lib-send-invite-email-001.md |
| f00000e0-0000-4000-8000-000000000000 | sendPasswordResetEmail | ambient/lib-send-password-reset-email-001.md |
| f00000c0-0000-4000-8000-000000000000 | sendReceiptEmail | ambient/lib-send-receipt-email-001.md |
| f00000a0-0000-4000-8000-000000000000 | sendWelcomeEmail | ambient/lib-send-welcome-email-001.md |
| ee000000-0000-4000-8000-000000000000 | sendWorkspaceDeletionConfirmationEmail | ambient/lib-send-workspace-deletion-confirmation-001.md |
| f00000b0-0000-4000-8000-000000000000 | validatePayment | ambient/lib-validate-payment-001.md |
| ef000000-0000-4000-8000-000000000000 | validateSignup | ambient/lib-validate-signup-001.md |

## Verification

- `cargo build --manifest-path contract-ide/src-tauri/Cargo.toml` — exit 0
- `cargo clippy --manifest-path contract-ide/src-tauri/Cargo.toml --all-targets -- -D warnings` — exit 0 (4 lints fixed: 1 pre-existing `map_or` → `is_none_or`, 3 in new helper code)
- `cargo test --lib derive_name_tests` — 14 / 14 pass
- `cargo test --lib sidecar` — 31 / 31 pass (round-trip exemplars untouched in spirit)
- `pnpm --filter contract-ide tsc --noEmit` — exit 0
- `node --test .agents/skills/codebase-to-contracts/scripts/helpers/__tests__/frontmatter-writer.test.mjs` — 4 / 4 pass against the rewritten exemplars
- `grep -rn "uuid\.slice(0, 8)" contract-ide/src/ --include='*.tsx' --include='*.ts'` — 0 matches
- 55 / 55 contracts in `contract-ide-demo/.contracts/` (excluding `.archive/`) carry a non-empty `name:` field; verified via Python YAML walk

### Manual 4-beat walkthrough

Not performed in this session. The IDE binary needs to be launched against
`contract-ide-demo` for the visual verification step. Yang to perform on
next demo dry-run; if any node still surfaces `untitled-XXXXXXXX` it
indicates a derivation gap (likely a missing entry in
`contract-ide-demo/scripts/add-names.mjs::NAMED` or `AMBIENT_BY_BASENAME`).

## Out of scope (deferred)

- Substrate `con-*` / `dec-*` node display names (per task spec — Phase 13
  substrate UI owns those).
- `bootstrap-demo-target/` — the bootstrap pipeline (Phase 14) will emit
  `name` from the LLM's classify pass; the schema update lands the contract
  ahead of that work.
- The pre-existing `commands::demo_orchestration::tests::fixture_dir_*` env
  var race is unrelated and unchanged.
