-- Demo seed for the delete-account scenario per .planning/demo/scenario-criteria.md
-- Loaded by demo/reset-demo.sh; replaces in-place after killing the app.
--
-- Inserts:
--   1. The 5 substrate rules (decisions + constraints) from § 6
--   2. The parent-surface constraint con-settings-no-modal-interrupts-2025-Q4 from § 8
--   3. The priority-shift record (Q4-2025 reduce-onboarding-friction → 2026-04-01 compliance-first)
--   4. Ambient padding nodes (~12 unrelated atoms to prove substrate isn't 1-shot demo data)
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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  -- v10 migration adds this on the runtime substrate_nodes table; mirrored
  -- here so the defensive-schema path (fresh DB without migrations) can
  -- run the tail UPDATE that publishes every seeded row.
  published_at TEXT
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

-- Publish every seeded row so retrieval (which filters published_at IS NOT NULL
-- per migration v10) sees these fixtures on first boot. Without this UPDATE, a
-- fresh reset-demo.sh run would leave seed rules unpublished — locking them
-- out of every agent surface until the developer hit Sync, which silently
-- breaks Beat 2 of the demo. Both the defensive CREATE TABLE above and the
-- runtime migrated schema carry published_at, so this UPDATE is always safe.
UPDATE substrate_nodes
SET published_at = COALESCE(published_at, created_at, valid_at, datetime('now'));

PRAGMA user_version = 13;  -- bump so app knows this is the demo seed
