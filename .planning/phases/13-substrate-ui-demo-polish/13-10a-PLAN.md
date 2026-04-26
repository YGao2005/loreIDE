---
phase: 13-substrate-ui-demo-polish
plan: 10a
type: execute
wave: 5
depends_on: ["13-01", "13-02", "13-03", "13-04", "13-05", "13-06", "13-07", "13-08", "13-09"]
files_modified:
  - contract-ide/demo/reset-demo.sh
  - contract-ide/demo/seeds/substrate.sqlite.seed.sql
  - contract-ide/demo/seeds/contracts/README.md
  - contract-ide/demo/seeds/blast-radius.json
  - contract-ide/demo/seeds/beat3-verifier.json
  - contract-ide/demo/seeds/beat4-harvest.json
autonomous: true
requirements:
  - DEMO-04
must_haves:
  truths:
    - "reset-demo.sh restores deterministic demo state in <15s (target <10s) — kills running app, git resets demo repo to locked commit, applies SQLite seed, relaunches"
    - "substrate.sqlite.seed.sql defensively creates substrate_nodes + l0_priority_history tables (CREATE TABLE IF NOT EXISTS) so it runs cleanly even if Phase 11 migration hasn't shipped"
    - "Seed inserts: 5 demo substrate rules (decisions + constraints) + 1 parent-surface constraint marked state='intent_drifted' (orange-flag fixture per § 8) + priority-history rows + 12 ambient padding nodes (~24 unrelated atoms to prove substrate isn't 1-shot demo data)"
    - "blast-radius.json contains trigger_uuid + 5 participant_uuids (placeholder strings — plan 13-11 substitutes real Phase 9 UUIDs)"
    - "beat3-verifier.json contains 6 honor rows + 3 implicit decisions + 1 flag with parentSurfaceUuid placeholder"
    - "beat4-harvest.json contains 3 harvested_nodes — one with promoted_from_implicit: true + each with attached_to_uuid for N9 halo wiring"
    - "Pure data layer — no UI mounted, no Rust IPC added, no React component changes; this plan ships ONLY shell script + SQL seed + JSON fixtures + sidecar README"
  artifacts:
    - path: "contract-ide/demo/reset-demo.sh"
      provides: "Reset script — kills app, restores DB seed, relaunches"
      contains: "#!/usr/bin/env bash"
    - path: "contract-ide/demo/seeds/substrate.sqlite.seed.sql"
      provides: "SQL seed inserting 5 substrate rules + 1 parent constraint + priority-shift record + ambient padding"
      contains: "INSERT INTO substrate_nodes"
    - path: "contract-ide/demo/seeds/contracts/README.md"
      provides: "Documentation for the .contracts/ sidecar files needed (Phase 9 ships the actual contracts)"
      contains: "Required contracts"
    - path: "contract-ide/demo/seeds/blast-radius.json"
      provides: "Trigger + participant uuids for Sync animation"
      contains: "trigger_uuid"
    - path: "contract-ide/demo/seeds/beat3-verifier.json"
      provides: "Verifier rows + implicit decisions + flag for Beat 3"
      contains: "flag"
    - path: "contract-ide/demo/seeds/beat4-harvest.json"
      provides: "3 harvested nodes including promoted-from-implicit + attached_to_uuid wiring per N9"
      contains: "promoted_from_implicit"
  key_links:
    - from: "reset-demo.sh"
      to: "Application Support / contract-ide.db"
      via: "Replaces .db file with substrate.sqlite.seed.sql output"
      pattern: "substrate.sqlite.seed"
    - from: "blast-radius.json"
      to: "plan 13-10b's IPC reader (load_blast_radius_fixture in commands/sync.rs)"
      via: "JSON file at known path; read at IPC invocation time"
      pattern: "blast-radius.json"
    - from: "beat3-verifier.json + beat4-harvest.json"
      to: "plan 13-10b's load_beat3_verifier_fixture + emit_beat4_harvest IPCs"
      via: "JSON files at known paths; loaded by IPC, deserialized to Tauri event payloads"
      pattern: "beat3-verifier.json|beat4-harvest.json"
---

<objective>
Ship the demo data layer — reset script, SQLite seed, JSON fixtures, sidecar README — that plan 13-10b's UI orchestration consumes. **Pure data; no UI**. Per checker SF5: split from the original 13-10 to keep file ownership clean (13-10a touches `demo/` directory only; 13-10b touches `src-tauri/` + `src/` for IPC + UI). Both run in Wave 5 in parallel.

Purpose: The 4-beat demo MUST run end-to-end 3 times in a row before filming. This requires deterministic state that resets cleanly between runs. Per Pitfall 7 in 13-RESEARCH.md: "reset-demo.sh restores the SQLite file but the in-memory useSubstrateStore retains state from the previous run — solution: full app relaunch." This plan ships the reset script + the fixture data backing every staged demo moment. Plan 13-10b consumes these fixtures via Rust IPC + React orchestration UI.

Wave 5 placement: Depends on ALL prior plans (13-01 through 13-09) because the seed schema must match every store / IPC / component built so far. Runs in parallel with plan 13-10b which builds the UI layer that reads from these files.
</objective>

<execution_context>
@/Users/yang/.claude/get-shit-done/workflows/execute-plan.md
@/Users/yang/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/CANVAS-PURPOSE.md
@.planning/demo/presentation-script.md
@.planning/demo/scenario-criteria.md
@.planning/phases/13-substrate-ui-demo-polish/13-RESEARCH.md
@.planning/phases/13-substrate-ui-demo-polish/13-01-SUMMARY.md
@.planning/phases/13-substrate-ui-demo-polish/13-09-SUMMARY.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Build SQLite seed + JSON fixtures + sidecar README</name>
  <files>
    contract-ide/demo/seeds/substrate.sqlite.seed.sql
    contract-ide/demo/seeds/contracts/README.md
    contract-ide/demo/seeds/blast-radius.json
    contract-ide/demo/seeds/beat3-verifier.json
    contract-ide/demo/seeds/beat4-harvest.json
  </files>
  <action>
**Step 1 — `contract-ide/demo/seeds/substrate.sqlite.seed.sql` — SQL seed.**

Per scenario-criteria.md § 6 (5 substrate decisions, all required), § 7 (Beat 4 closed loop), § 8 (orange-flag fixture), AND scenario-criteria.md "What this commits us to": "SQLite snapshot containing the 5 rules + Account Settings L3 surface with `con-settings-no-modal-interrupts-2025-Q4` + the priority-shift record."

```sql
-- Demo seed for the delete-account scenario per .planning/demo/scenario-criteria.md
-- Loaded by demo/reset-demo.sh; replaces in-place after killing the app.
--
-- Inserts:
--   1. The 5 substrate rules (decisions + constraints) from § 6
--   2. The parent-surface constraint con-settings-no-modal-interrupts-2025-Q4 from § 8
--   3. The priority-shift record (Q4-2025 reduce-onboarding-friction → 2026-04-01 compliance-first)
--   4. Ambient padding nodes (~24 unrelated atoms to prove substrate isn't 1-shot demo data)
--
-- Note: substrate_nodes table is created by Phase 11 distiller migration. If Phase 11 hasn't
-- shipped its migration yet, this seed creates the table defensively (CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS substrate_nodes (
  uuid TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'fresh',
  name TEXT NOT NULL,
  summary TEXT,
  text TEXT,
  applies_when TEXT,
  valid_at TEXT,
  invalid_at TEXT,
  session_id TEXT,
  turn_ref TEXT,
  verbatim_quote TEXT,
  actor TEXT,
  confidence TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS l0_priority_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  priority_name TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  superseded_at TEXT
);

DELETE FROM substrate_nodes;
DELETE FROM l0_priority_history;

-- ---- Priority history (orange-flag fixture per § 8) -------------------------
INSERT INTO l0_priority_history (priority_name, effective_from, superseded_at) VALUES
  ('reduce-onboarding-friction', '2025-10-01', '2026-04-01'),
  ('compliance-first',           '2026-04-01', NULL);

-- ---- 5 demo substrate rules from § 6 ----------------------------------------
INSERT INTO substrate_nodes (uuid, kind, state, name, summary, text, applies_when, valid_at, session_id, turn_ref, verbatim_quote, actor, confidence) VALUES
  (
    'dec-soft-delete-30day-grace-2026-02-18',
    'decision',
    'fresh',
    'Soft-delete with 30-day grace',
    'Account-level delete is a soft-delete: set deletedAt, sign user out, send confirmation email; nightly job hard-deletes after 30 days.',
    'Account-level delete is a soft-delete: set deletedAt to the request timestamp, sign the user out, send confirmation email, and let the nightly purge job hard-delete after the 30-day grace window. Never call db.user.delete() from a request handler.',
    'a user-initiated or admin-initiated action removes a user, organization, workspace, or any account-shaped record',
    '2026-02-18',
    'session-2026-02-18-deletion-incident',
    'turn-12',
    'Feb-12 ticket #4471: customer hit Delete by accident while scrolling Settings, was charged the following month because the request handler had already torn down their state but a webhook-triggered payment ran against an in-flight subscription. The 30-day grace window plus email confirmation eliminates this class entirely.',
    'human',
    'explicit'
  ),
  (
    'con-anonymize-not-delete-tax-held-2026-03-04',
    'constraint',
    'fresh',
    'Keep tax records (anonymize, not delete)',
    'Tax-record-retention rows must be anonymized, not deleted, when their associated user is purged.',
    'Records subject to tax-record retention (invoices, payments, refunds, tax filings) must be anonymized, not deleted, when their associated user is purged. User-identifying fields are overwritten with "[deleted user]"; the financial data and timestamps remain intact.',
    'an account purge would otherwise cascade-delete a record that legal/finance has flagged as held-for-retention (current list: Invoice, Payment, Refund, TaxFiling, OrgInvoice — see lib/retention/held.ts)',
    '2026-03-04',
    'session-2026-03-04-tax-audit',
    'turn-8',
    'March-3 finding from the IRS audit response: the Feb deletion had cascade-deleted three months of the customer''s invoices. We could not produce them; the auditor noted it as a control deficiency. The fix is anonymize-in-place; finance signed off on the [deleted user] placeholder as legally sufficient.',
    'human',
    'explicit'
  ),
  (
    'con-stripe-customer-archive-2026-02-22',
    'constraint',
    'fresh',
    'Archive Stripe customer (don''t delete)',
    'Account purges archive the Stripe customer with metadata; never call customers.del().',
    'When deleting an account that has a stripeCustomerId, call stripe.customers.update(id, { metadata: { archived: true, archived_at: <iso> } }). Never call stripe.customers.del(). Subscriptions must be canceled first via subscriptions.cancel() with invoice_now: false, prorate: false.',
    'an account being purged or deactivated has a Stripe customer attached',
    '2026-02-22',
    'session-2026-02-22-stripe-webhook',
    'turn-15',
    'Feb-19: post-deletion, the next billing-cycle webhook fired against the archived card and 404''d in prod — the deletion request had not canceled the subscription, only torn down our user record. Calling customers.del() prevents future billing but also wipes payment-history we need for chargebacks.',
    'human',
    'explicit'
  ),
  (
    'con-mailing-list-suppress-not-delete-2026-03-11',
    'constraint',
    'fresh',
    'Suppress mailing list (CAN-SPAM)',
    'Set marketing-list status to unsubscribed on user delete; never delete the list member.',
    'When deleting a user, set their email to status "unsubscribed" on the marketing list (status_if_new also "unsubscribed"). Do not delete the list member. The suppression record is what prevents re-add by a future bulk import.',
    'an account being deleted has any record in MARKETING_LIST_ID, TRANSACTIONAL_LIST_ID, or any list registered under lib/marketing/lists.ts',
    '2026-03-11',
    'session-2026-03-11-can-spam',
    'turn-22',
    'March-9: a sales-led re-import of a CSV re-subscribed the deleted Feb-12 customer to the monthly newsletter. We received a corrective-action request from the FTC''s CAN-SPAM enforcement contact, exposing that "deleted" was not "remembered as unsubscribed." Mailchimp suppression list is what carries that memory.',
    'human',
    'explicit'
  ),
  (
    'dec-confirm-via-email-link-2026-02-18',
    'decision',
    'fresh',
    'Email-link confirmation, not just modal',
    'Destructive account-level actions require email-link confirmation, not in-app modal alone.',
    'Destructive account-level actions require email-link confirmation, not in-app modal alone. The modal sends the link; the action only proceeds when the user clicks the link in their email within 24 hours. After 24 hours the request expires silently.',
    'a UI action will (a) terminate, (b) anonymize, or (c) irrevocably remove access to a user, organization, workspace, or paid resource',
    '2026-02-18',
    'session-2026-02-18-deletion-incident',
    'turn-19',
    'Same Feb-12 ticket as dec-soft-delete-30day-grace: the customer''s complaint was specifically that one accidental click had triggered a permanent action. An in-app confirm() was insufficient because the customer had clicked it as muscle memory while scrolling. Email-link confirmation requires a context switch that surfaces intent.',
    'human',
    'explicit'
  );

-- ---- Orange-flag fixture (parent-surface constraint per § 8) ----------------
INSERT INTO substrate_nodes (uuid, kind, state, name, summary, text, applies_when, valid_at, invalid_at, session_id, turn_ref, verbatim_quote, actor, confidence) VALUES
  (
    'con-settings-no-modal-interrupts-2025-Q4',
    'constraint',
    'intent_drifted',
    'No modal interrupts on Settings actions',
    'Settings interactions should be inline and friction-free; no modal interrupts on save/update.',
    'Settings page interactions should be inline and friction-free; no modal interrupts on save or update actions.',
    'a UI action on the Settings page surfaces user-state changes',
    '2025-10-15',
    NULL,
    'session-2025-Q4-onboarding-research',
    'turn-7',
    'Q4 2025 onboarding research: every modal interrupt on Settings caused a measurable drop-off in retained usage. Decision: no modal interrupts on save/update actions. Goal: reduce onboarding friction.',
    'human',
    'explicit'
  );
-- This row's state='intent_drifted' is the trigger for the Beat 3 orange flag halo.
-- Phase 12's supersession engine SHOULD set this state when the parent priority shifts.
-- For demo, we hardcode it in the seed.

-- ---- Ambient padding nodes (~12 unrelated atoms) ---------------------------
-- Inserts variety: constraints, decisions, open questions across unrelated areas.
-- Names are realistic; rationale: substrate doesn't look like 1-shot demo data when judges scroll.
-- Mark these `state = 'fresh'`. They never appear in beats but DO appear in Cmd+P searches.

INSERT INTO substrate_nodes (uuid, kind, state, name, summary, text, session_id, actor, confidence) VALUES
  ('con-tailwind-only-2025-08-02',           'constraint', 'fresh', 'Use Tailwind for all styling', 'No CSS modules; no styled-components; only Tailwind utility classes.', 'Project styling convention: Tailwind utility classes for all production styling. Custom CSS in src/styles/index.css only as last resort.', 'session-2025-08-02-styling-convention', 'human', 'explicit'),
  ('dec-postgres-over-mysql-2025-06-12',     'decision',   'fresh', 'Postgres over MySQL', 'Chose Postgres for JSONB and partial indexes; row-level security weighed in.', 'Decided to use Postgres rather than MySQL for the primary database. Reasons: JSONB column type, better partial-index support, row-level security primitives, and team familiarity.', 'session-2025-06-12-db-selection', 'human', 'explicit'),
  ('con-no-default-exports-2025-09-18',      'constraint', 'fresh', 'No default exports', 'Always use named exports for components and modules.', 'No default exports anywhere in TypeScript code. Always named exports. Refactoring traceability and IDE auto-import accuracy both benefit.', 'session-2025-09-18-style-debate', 'human', 'explicit'),
  ('con-canonicalize-paths-2025-11-05',      'constraint', 'fresh', 'Canonicalize paths in Rust IPC', 'All file-path Rust commands canonicalize via fs::canonicalize before scope check.', 'Path-handling convention: every Rust IPC accepting a file path must canonicalize via fs::canonicalize and verify starts_with(repo_root) before any IO.', 'session-2025-11-05-path-traversal', 'human', 'explicit'),
  ('dec-prefer-rrf-over-vector-only-2026-01-22', 'decision', 'fresh', 'RRF over pure vector search', 'For substrate retrieval, FTS5 + vector via RRF outperforms vector-only.', 'Substrate retrieval ranking: prefer Reciprocal Rank Fusion combining FTS5 keyword and vector embedding rather than vector-only retrieval. Tested on 50 ambient queries.', 'session-2026-01-22-retrieval-bench', 'human', 'explicit'),
  ('open-q-onboarding-funnel-2026-03-22',    'open_question', 'fresh', 'Should signup require email verification?', 'Email verification is friction; spam control argues for it.', 'Open: should the signup flow require email verification before enabling features? Spam control vs friction tension.', 'session-2026-03-22-signup-discussion', 'human', 'inferred'),
  ('con-jose-not-jsonwebtoken-2025-12-04',   'constraint', 'fresh', 'Use jose, not jsonwebtoken', 'jose is the JWT library; jsonwebtoken has CommonJS issues with Edge runtime.', 'JWT handling: use jose library (not jsonwebtoken). The latter has CommonJS module issues that break under Vercel Edge runtime.', 'session-2025-12-04-edge-runtime', 'human', 'explicit'),
  ('dec-radix-over-headless-2025-09-04',     'decision',   'fresh', 'Radix UI over Headless UI', 'Radix UI is the primitive set; Headless UI dropped due to limited shadow-dom support.', 'UI primitives: Radix UI as the foundation. Headless UI was rejected due to limited shadow-DOM and form integration.', 'session-2025-09-04-primitive-eval', 'human', 'explicit'),
  ('con-prisma-explicit-tx-2026-02-08',      'constraint', 'fresh', 'Always use explicit transactions for multi-write', 'Prisma transactions are required for any flow that writes to >1 table.', 'Database constraint: any operation writing to >1 table must use prisma.$transaction. Implicit auto-commits don''t roll back on partial failure.', 'session-2026-02-08-tx-audit', 'human', 'explicit'),
  ('con-stripe-test-clock-for-billing-2026-01-15', 'constraint', 'fresh', 'Use Stripe test clocks for billing tests', 'Manual time travel via test_clocks; never sleep or mock dates in production code.', 'Billing tests: use Stripe Test Clocks for time travel. Never use setTimeout-based delays or date-mocking; the latter only fakes the local app, not Stripe''s side.', 'session-2026-01-15-billing-tests', 'human', 'explicit'),
  ('open-q-rate-limit-strategy-2026-04-02',  'open_question', 'fresh', 'Edge-level vs app-level rate limiting?', 'Vercel KV vs in-process; trade off latency vs DDoS surface.', 'Open: should rate limiting live at edge (Vercel KV) or app level (in-process counters)? Edge is faster for the common case but harder to coordinate cross-region.', 'session-2026-04-02-rate-limit-discussion', 'human', 'inferred'),
  ('dec-zod-over-yup-2025-07-22',            'decision',   'fresh', 'Zod over Yup', 'Zod has better TS inference and tree-shaking.', 'Validation: Zod for all request/response schemas. Yup deprecated in this codebase due to weaker TS inference.', 'session-2025-07-22-validation-eval', 'human', 'explicit');

-- ---- Misc supporting state -------------------------------------------------
-- Phase 11 may add more tables; this seed touches only substrate_nodes and l0_priority_history.

PRAGMA user_version = 13;  -- bump so app knows this is the demo seed
```

**Step 2 — `contract-ide/demo/seeds/contracts/README.md` — sidecar contract index.**

Phase 9 ships the actual sidecar contracts (`.md` files with frontmatter). This README documents what Phase 13 NEEDS from Phase 9, so plan 13-11's rehearsal can verify contracts exist:

```markdown
# Demo Sidecar Contracts — Required Phase 9 Output

Phase 13 plan 13-10a expects the following `.contracts/*.md` files in the demo repo
(`contract-ide-demo`), seeded as part of Phase 9 SC 8 + SC 7. If any are missing,
substrate retrieval and chain rendering will fail during the 4-beat rehearsal.

## Surfaces (L3 contracts)

- `account/settings.md` — Account Settings page (kind: ui, route: /account/settings)
  - Frontmatter: `code_ranges: [{file: 'app/account/settings/page.tsx', startLine: ..., endLine: ...}]`
- `team/settings.md` — Team Settings page (kind: ui, route: /team/[slug]/settings)

## Atom contracts (L4)

- `account/danger-zone-button.md` — kind: ui, parent: account/settings.md, code_ranges anchors to a SECTION (the danger-zone section in page.tsx)

## Backend participants (L3)

- `api/account/delete.md` — kind: api, method: POST, path: /api/account/delete, with `## Inputs` / `## Outputs` / `## Side effects` populated
- `lib/account/begin-account-deletion.md` — kind: lib
- `external/stripe-customers-update.md` — kind: external
- `external/mailchimp-suppress.md` — kind: external
- `lib/account/send-deletion-confirmation-email.md` — kind: lib

## Flow contracts (Phase 9 FLOW-01)

- `flows/delete-account.md` — kind: flow, members: [<account/settings uuid>, <api/account/delete uuid>, <lib/account/begin-account-deletion uuid>, <stripe uuid>, <mailchimp uuid>, <send-email uuid>]
- `flows/delete-workspace.md` — kind: flow (Beat 4)

## Validation

Run plan 13-11's rehearsal harness with `--verify-contracts` flag. Missing contracts
will be listed; Phase 9 must provide before demo runs.
```

**Step 3 — `contract-ide/demo/seeds/blast-radius.json` — Sync animation fixture.**

```json
{
  "demo": "delete-account",
  "trigger_uuid": "<UUID-account-settings-screen>",
  "participant_uuids": [
    "<UUID-api-account-delete>",
    "<UUID-begin-account-deletion-lib>",
    "<UUID-stripe-customers-archive>",
    "<UUID-mailchimp-suppress>",
    "<UUID-send-deletion-email>"
  ],
  "_note": "Replace placeholder UUIDs with the real uuids that Phase 9 generates when it seeds the contracts. Plan 13-11 rehearsal verifies this file resolves to existing nodes."
}
```

The fixture uses placeholder UUID strings. Plan 13-11's rehearsal harness will print the real UUIDs from Phase 9 and the user (or a small helper script) will substitute them in. Document inline.

**Step 4 — `contract-ide/demo/seeds/beat3-verifier.json` — Beat 3 verifier rows.**

```json
{
  "rows": [
    { "kind": "honor", "ruleName": "Matches contract", "detail": "Delete Account action present in danger-zone section" },
    { "kind": "honor", "ruleUuid": "dec-soft-delete-30day-grace-2026-02-18", "ruleName": "soft-delete-30day-grace", "detail": "deletedAt set, no hard delete" },
    { "kind": "honor", "ruleUuid": "con-anonymize-not-delete-tax-held-2026-03-04", "ruleName": "anonymize-tax-held", "detail": "invoice updateMany present" },
    { "kind": "honor", "ruleUuid": "con-stripe-customer-archive-2026-02-22", "ruleName": "stripe-archive", "detail": "customers.update with metadata" },
    { "kind": "honor", "ruleUuid": "con-mailing-list-suppress-not-delete-2026-03-11", "ruleName": "mailchimp-suppress", "detail": "mailchimp suppress call" },
    { "kind": "honor", "ruleUuid": "dec-confirm-via-email-link-2026-02-18", "ruleName": "email-link-confirmation", "detail": "sendDeletionConfirmationEmail call" }
  ],
  "implicitDecisions": [
    { "field": "Email link expires in 24h", "derivedFrom": "agent default" },
    { "field": "Audit log written to `audit_log` table", "derivedFrom": "inferred from project schema" },
    { "field": "Cleanup runs as background job", "derivedFrom": "derived from contract.role \"primary action\"" }
  ],
  "flag": {
    "kind": "flag",
    "ruleUuid": "con-settings-no-modal-interrupts-2025-Q4",
    "ruleName": "Parent surface holds con-settings-no-modal-interrupts-2025-Q4",
    "detail": "(\"no modal interrupts on user actions\") — derived 2025-Q4 under priority `reduce-onboarding-friction`. Current priority since 2026-04-01 is `compliance-first`. The new modal interrupt may be intended; review.",
    "parentSurfaceUuid": "<UUID-account-settings-screen>"
  }
}
```

Same placeholder situation: replace `<UUID-account-settings-screen>` with the real seeded UUID at Phase 9 contract-seeding time.

**Step 5 — `contract-ide/demo/seeds/beat4-harvest.json` — Beat 4 harvest fixture (with N9 attached_to_uuid wiring).**

```json
{
  "harvested_nodes": [
    {
      "uuid": "con-cascade-revoke-tokens-on-org-delete-2026-04-25",
      "kind": "constraint",
      "name": "Revoke member access tokens",
      "text": "Revoke member access tokens immediately on org delete (don't wait for 30-day grace).",
      "promoted_from_implicit": false,
      "attached_to_uuid": "<UUID-revoke-all-member-tokens-lib>"
    },
    {
      "uuid": "dec-owner-orphan-check-2026-04-25",
      "kind": "decision",
      "name": "Owner-orphan check before delete",
      "text": "Org delete requires solo-owner OR explicit ownership transfer.",
      "promoted_from_implicit": false,
      "attached_to_uuid": "<UUID-assert-not-sole-owner-lib>"
    },
    {
      "uuid": "dec-confirmation-timeout-24h-2026-04-25",
      "kind": "decision",
      "name": "Confirmation link timeout 24h",
      "text": "Email confirmation links expire in 24h — agent default this morning, reviewer accepted, now a team rule.",
      "promoted_from_implicit": true,
      "attached_to_uuid": "<UUID-send-deletion-confirmation-email-lib>"
    }
  ]
}
```

**Per checker N9:** each `attached_to_uuid` points at a participant that plan 13-09's HarvestPanel will halo (green) when this fixture emits as a substrate:nodes-added event. Plan 13-11 substitutes these placeholders.

**Avoid:**
- DO NOT run the SQL seed against a live `.db` from inside Tauri — it's a CLI operation invoked by reset-demo.sh against a quit app.
- DO NOT include uuids that don't exist in the demo repo's `.contracts/` — the placeholder pattern is intentional.
- DO NOT inline the fixtures in TypeScript code — JSON files at known paths so plan 13-11's rehearsal can verify integrity by file existence + parse.
  </action>
  <verify>
`ls contract-ide/demo/seeds/` shows all 5 files (substrate.sqlite.seed.sql, contracts/README.md, blast-radius.json, beat3-verifier.json, beat4-harvest.json).
`sqlite3 ":memory:" < contract-ide/demo/seeds/substrate.sqlite.seed.sql` exits 0 — SQL parses cleanly.
`jq . contract-ide/demo/seeds/blast-radius.json` exits 0 — valid JSON.
`jq . contract-ide/demo/seeds/beat3-verifier.json` exits 0 — has 6 honor rows + 3 implicit + 1 flag.
`jq '.harvested_nodes | length' contract-ide/demo/seeds/beat4-harvest.json` returns 3.
`jq '.harvested_nodes[] | select(.promoted_from_implicit == true) | .uuid' contract-ide/demo/seeds/beat4-harvest.json` returns 1 entry.
`jq '.harvested_nodes[] | .attached_to_uuid' contract-ide/demo/seeds/beat4-harvest.json` returns 3 entries (all 3 have attached_to_uuid for N9 halo).
  </verify>
  <done>
SQL seed creates substrate_nodes (defensive table creation), inserts 5 demo rules + parent constraint + priority history + 12 ambient padding rows. Three JSON fixtures (blast-radius, beat3-verifier, beat4-harvest) parse and contain the right data shapes per scenario-criteria.md. beat4-harvest entries each carry attached_to_uuid for N9 green-halo wiring.
  </done>
</task>

<task type="auto">
  <name>Task 2: Build reset-demo.sh — kills app, applies SQL seed, relaunches</name>
  <files>
    contract-ide/demo/reset-demo.sh
  </files>
  <action>
**Step 1 — `contract-ide/demo/reset-demo.sh` — reset script.**

Per Pitfall 7 in 13-RESEARCH.md: full app relaunch (not just dev-server restart) so the in-memory substrate store re-hydrates from SQLite.

```bash
#!/usr/bin/env bash
# Demo reset script — restores deterministic state in <15s (target <10s).
# Per .planning/phases/13-substrate-ui-demo-polish/13-RESEARCH.md Pitfall 7:
#   Must full-relaunch the app so useSubstrateStore re-hydrates from SQLite.
#   Just resetting the .db file isn't enough — in-memory state would persist.

set -euo pipefail

SCRIPT_START=$(date +%s)
REPO_ROOT="${REPO_ROOT:-$HOME/lahacks}"
CONTRACT_IDE_DIR="$REPO_ROOT/contract-ide"
DEMO_REPO_DIR="${DEMO_REPO_DIR:-$HOME/lahacks/contract-ide-demo}"
SEED_DIR="$CONTRACT_IDE_DIR/demo/seeds"
DB_PATH="$HOME/Library/Application Support/com.contract-ide.app/contract-ide.db"
APP_BUNDLE_NAME="contract-ide"  # adapt if Tauri bundle name differs

if [ ! -d "$CONTRACT_IDE_DIR" ]; then
  echo "ERROR: $CONTRACT_IDE_DIR not found"
  exit 1
fi

echo "[reset] Step 1/5: kill running app..."
# Kill any running instance — both Finder-launched and dev-server
pkill -f "$APP_BUNDLE_NAME" || true
pkill -f "tauri dev"        || true
sleep 1  # let processes exit cleanly

echo "[reset] Step 2/5: reset demo repo to locked commit..."
if [ -d "$DEMO_REPO_DIR" ]; then
  cd "$DEMO_REPO_DIR"
  # Reset to the locked commit (set in DEMO_LOCKED_COMMIT env or default to HEAD~0)
  git reset --hard "${DEMO_LOCKED_COMMIT:-HEAD}"
  # Clean any stray new files that wouldn't be tracked
  git clean -fd
else
  echo "[reset] WARNING: $DEMO_REPO_DIR not found — skipping demo repo reset"
fi

echo "[reset] Step 3/5: restore SQLite seed..."
mkdir -p "$(dirname "$DB_PATH")"
# Backup existing DB before replacing — defensive
if [ -f "$DB_PATH" ]; then
  cp "$DB_PATH" "$DB_PATH.before-reset.bak"
fi
# Apply seed: keep the migrated DB structure, just reload substrate_nodes table from seed.
# (App's tauri-plugin-sql migrations run on next launch and create whatever schema is missing.)
sqlite3 "$DB_PATH" < "$SEED_DIR/substrate.sqlite.seed.sql"

echo "[reset] Step 4/5: relaunch app..."
# Launch the production .app bundle (deterministic boot path); fallback to tauri dev.
APP_PATH="$CONTRACT_IDE_DIR/src-tauri/target/release/bundle/macos/$APP_BUNDLE_NAME.app"
if [ -d "$APP_PATH" ]; then
  open "$APP_PATH"
else
  echo "[reset] No release bundle found at $APP_PATH; running tauri dev..."
  cd "$CONTRACT_IDE_DIR"
  npm run tauri dev > /tmp/contract-ide-dev.log 2>&1 &
  disown
  echo "[reset] tauri dev started (logs at /tmp/contract-ide-dev.log)"
fi

echo "[reset] Step 5/5: wait for app boot..."
# Give the app time to hydrate substrate store from SQLite
sleep 3

echo "[reset] Done. Total elapsed: $(($(date +%s) - SCRIPT_START))s"
echo "[reset] Open the demo repo in the IDE; press Cmd+P; type 'account settings'; verify hits."
```

`chmod +x contract-ide/demo/reset-demo.sh`.

**Self-check:** Total time per the script (~5s app kill + 2s git reset + 1s sqlite + 3s relaunch wait) ≈ 11s. Tight on the <10s budget. To shrink: skip `git reset` if the demo repo is already at the locked commit (`git diff --quiet`); preload the .app bundle via `open` async; skip the 3s wait by polling for app readiness instead. Document optimization opportunities; demo budget allows up to 15s in practice.

**Avoid:**
- DO NOT run reset-demo.sh from the app itself — it's a CLI from outside. The Tauri app is being killed by the script.
- DO NOT use `sleep 5` or longer — too slow for the <15s budget. 3s is the minimum sleep that gives the SQLite plugin time to open the file in the relaunched app.
- DO NOT skip the backup step (`.before-reset.bak`) — defensive against partial seed corruption mid-rehearsal.
  </action>
  <verify>
`bash -n contract-ide/demo/reset-demo.sh` — syntax check passes.
`test -x contract-ide/demo/reset-demo.sh` — script is executable (or `chmod +x` succeeded).
Optionally run `bash contract-ide/demo/reset-demo.sh` (manually): verify it kills any running app, applies SQL seed, relaunches, total elapsed <15s.
  </verify>
  <done>
reset-demo.sh executes end-to-end in <15s (under target 10s after optimizations). Plan 13-10b's IPC fixtures will read from the JSON files this plan ships.
  </done>
</task>

</tasks>

<verification>
- All 5 fixture files exist on disk and are valid (SQL parses, JSON validates)
- reset-demo.sh syntax-checks and is executable
- substrate.sqlite.seed.sql defensive (CREATE TABLE IF NOT EXISTS, transactional)
- Three JSON fixtures cover Sync animation, Beat 3 verifier rows + implicit + flag, Beat 4 harvest with promoted badge + attached_to_uuid for N9
- contracts/README.md documents all required Phase 9 outputs for plan 13-11 verification
- This plan touches ZERO files in src-tauri/ or src/ — pure data layer per SF5 split
</verification>

<success_criteria>
- [ ] reset-demo.sh runs in <15s end-to-end (target 10s)
- [ ] substrate.sqlite.seed.sql defensive (CREATE TABLE IF NOT EXISTS, transactional)
- [ ] Three JSON fixtures cover Sync animation, Beat 3 verifier rows + implicit + flag, Beat 4 harvest with promoted badge + attached_to_uuid (N9)
- [ ] contracts/README.md ships Phase 9 verification list
- [ ] Pure data plan — no UI, no Rust IPC, no React component changes
- [ ] Plan 13-10b consumes these fixtures via its IPC + UI layer
</success_criteria>

<output>
After completion, create `.planning/phases/13-substrate-ui-demo-polish/13-10a-SUMMARY.md` documenting:
- Final reset-demo.sh elapsed time (measured)
- Whether Phase 9 contracts existed at this point — if not, what UUID substitution mechanism plan 13-11 needs
- Any deviations from scenario-criteria.md § 6 / § 8 substrate content (should be zero — exact verbatim copy is the spec)
- Confirmation that all 3 JSON fixtures parse and contain the expected shapes
</output>
