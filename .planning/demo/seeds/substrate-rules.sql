-- Phase 9 substrate seed for DEMO-02.
-- Schema is forward-compatible with Phase 11's substrate_nodes table — Phase 11 will
-- ALTER TABLE to add columns. Per 09-RESEARCH.md Q2: use the minimum-required column
-- set so Phase 11's migration becomes a no-op when the table already exists.

CREATE TABLE IF NOT EXISTS substrate_nodes (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL,           -- decision | constraint | open_question | resolved_question | attempt | priority
  text          TEXT NOT NULL,
  applies_when  TEXT,
  justification TEXT,
  valid_at      TEXT NOT NULL,
  invalid_at    TEXT,
  session_id    TEXT,
  turn_ref      TEXT,
  actor         TEXT,
  confidence    REAL DEFAULT 1.0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS substrate_edges (
  id        TEXT PRIMARY KEY,
  from_id   TEXT NOT NULL,
  to_id     TEXT NOT NULL,
  edge_type TEXT NOT NULL,             -- supersedes | derived_from | related_to | applies_to
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(from_id) REFERENCES substrate_nodes(id),
  FOREIGN KEY(to_id) REFERENCES substrate_nodes(id)
);

CREATE INDEX IF NOT EXISTS idx_substrate_nodes_type ON substrate_nodes(type);
CREATE INDEX IF NOT EXISTS idx_substrate_nodes_valid ON substrate_nodes(valid_at, invalid_at);
CREATE INDEX IF NOT EXISTS idx_substrate_edges_type ON substrate_edges(edge_type);

-- ============================================================
-- 5 SUBSTRATE RULES — per scenario-criteria.md § 6 (verbatim text)
-- ============================================================

INSERT INTO substrate_nodes (id, type, text, applies_when, justification, valid_at, session_id, turn_ref, actor, confidence) VALUES
(
  'dec-soft-delete-30day-grace-2026-02-18',
  'decision',
  'Account-level delete is a soft-delete: set deletedAt to the request timestamp, sign the user out, send confirmation email, and let the nightly purge job hard-delete after the 30-day grace window. Never call db.user.delete() from a request handler.',
  'a user-initiated or admin-initiated action removes a user, organization, workspace, or any account-shaped record',
  'Feb-12 ticket #4471: customer hit Delete by accident while scrolling Settings, was charged the following month because the request handler had already torn down their state but a webhook-triggered payment ran against an in-flight subscription. The 30-day grace window plus email confirmation eliminates this class entirely.',
  '2026-02-18',
  'sess-2026-02-12-deletion-incident',
  'turn-014',
  'team',
  1.0
),
(
  'con-anonymize-not-delete-tax-held-2026-03-04',
  'constraint',
  'Records subject to tax-record retention (invoices, payments, refunds, tax filings) must be anonymized, not deleted, when their associated user is purged. User-identifying fields (name, email, billing address) are overwritten with "[deleted user]"; the financial data and timestamps remain intact.',
  'an account purge would otherwise cascade-delete a record that legal/finance has flagged as held-for-retention (current list: Invoice, Payment, Refund, TaxFiling, OrgInvoice — see lib/retention/held.ts)',
  'March-3 finding from the IRS audit response: the Feb deletion had cascade-deleted three months of the customer''s invoices. We could not produce them; the auditor noted it as a control deficiency. The fix is anonymize-in-place; finance signed off on the "[deleted user]" placeholder as legally sufficient.',
  '2026-03-04',
  'sess-2026-02-12-deletion-incident',
  'turn-047',
  'team',
  1.0
),
(
  'con-stripe-customer-archive-2026-02-22',
  'constraint',
  'When deleting an account that has a stripeCustomerId, call stripe.customers.update(id, { metadata: { archived: ''true'', archived_at: <iso> } }). Never call stripe.customers.del(). Subscriptions must be canceled first via subscriptions.cancel() with invoice_now: false, prorate: false.',
  'an account being purged or deactivated has a Stripe customer attached',
  'Feb-19: post-deletion, the next billing-cycle webhook fired against the archived card and 404''d in prod — the deletion request had not canceled the subscription, only torn down our user record. Calling customers.del() on Stripe prevents future billing but also wipes payment-history we need for chargebacks and dispute response. Archive with metadata gives both: no future billing, full history accessible.',
  '2026-02-22',
  'sess-2026-02-12-deletion-incident',
  'turn-029',
  'team',
  1.0
),
(
  'con-mailing-list-suppress-not-delete-2026-03-11',
  'constraint',
  'When deleting a user, set their email to status "unsubscribed" on the marketing list (status_if_new also "unsubscribed"). Do not delete the list member. The suppression record is what prevents re-add by a future bulk import.',
  'an account being deleted has any record in MARKETING_LIST_ID, TRANSACTIONAL_LIST_ID, or any list registered under lib/marketing/lists.ts',
  'March-9: a sales-led re-import of a CSV re-subscribed the deleted Feb-12 customer to the monthly newsletter. We received a complaint and a corrective-action request from the FTC''s CAN-SPAM enforcement contact, exposing that "deleted" was not "remembered as unsubscribed." Mailchimp suppression list is what carries that memory.',
  '2026-03-11',
  'sess-2026-02-12-deletion-incident',
  'turn-061',
  'team',
  1.0
),
(
  'dec-confirm-via-email-link-2026-02-18',
  'decision',
  'Destructive account-level actions require email-link confirmation, not in-app modal alone. The modal sends the link; the action only proceeds when the user clicks the link in their email within 24 hours. After 24 hours the request expires silently with no state change.',
  'a UI action will (a) terminate, (b) anonymize, or (c) irrevocably remove access to a user, organization, workspace, or paid resource',
  'Same Feb-12 ticket as dec-soft-delete-30day-grace: the customer''s complaint was specifically that one accidental click had triggered a permanent action. An in-app confirm() was insufficient because the customer had clicked it as muscle memory while scrolling. Email-link confirmation requires a context switch that surfaces intent.',
  '2026-02-18',
  'sess-2026-02-12-deletion-incident',
  'turn-018',
  'team',
  1.0
);

-- ============================================================
-- PARENT SURFACE CONSTRAINT — orange-flag fixture (Beat 3)
-- ============================================================
INSERT INTO substrate_nodes (id, type, text, applies_when, justification, valid_at, session_id, turn_ref, actor, confidence) VALUES
(
  'con-settings-no-modal-interrupts-2025-Q4',
  'constraint',
  'Settings page interactions should be inline and friction-free; no modal interrupts on save or update actions.',
  'a UI element on a Settings page surfaces a result for a Settings interaction',
  'Q4 2025 design-system review under priority `reduce-onboarding-friction`: too many modal interrupts in Settings flows were causing customers to abandon partially-saved profile edits.',
  '2025-10-15',
  'sess-2025-Q4-design-system-review',
  'turn-082',
  'team',
  1.0
);

-- ============================================================
-- PRIORITY-SHIFT RECORDS — L0 priorities with supersession edge
-- ============================================================
INSERT INTO substrate_nodes (id, type, text, valid_at, invalid_at, actor, confidence) VALUES
(
  'prio-reduce-onboarding-friction-2025-Q4',
  'priority',
  'L0 priority Q4 2025: reduce onboarding friction. Optimize for the time-to-first-value path; minimize interrupts and confirmation steps.',
  '2025-10-01',
  '2026-04-24',
  'leadership',
  1.0
),
(
  'prio-compliance-first-2026-Q2',
  'priority',
  'L0 priority Q2 2026: compliance-first. Destructive actions and data-handling decisions take regulatory and audit-trail concerns over speed.',
  '2026-04-24',
  NULL,
  'leadership',
  1.0
);

INSERT INTO substrate_edges (id, from_id, to_id, edge_type) VALUES
('edge-priority-shift-2026-04-24', 'prio-compliance-first-2026-Q2', 'prio-reduce-onboarding-friction-2025-Q4', 'supersedes');

-- The parent-surface constraint was derived UNDER the now-superseded priority,
-- so it inherits intent-drift status. Phase 12's intent-supersession engine will
-- compute this; Phase 9 just makes the relation queryable for Beat 3 staging.
INSERT INTO substrate_edges (id, from_id, to_id, edge_type) VALUES
('edge-no-modal-rule-derived-from-q4-priority',
 'con-settings-no-modal-interrupts-2025-Q4',
 'prio-reduce-onboarding-friction-2025-Q4',
 'derived_from');
