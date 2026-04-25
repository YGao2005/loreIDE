# Source Session Narrative: February 2026 Deletion Incident

**File:** `deletion-incident-2026-02.jsonl`
**Session ID:** `sess-2026-02-deletion-incident`
**Date range:** 2026-02-12 through 2026-03-11
**Authored:** 2026-04-25 (synthetic fixture for Phase 10/11 distiller regression)

---

## Overview

This session captures a single coherent narrative arc: the **February 2026 deletion incident** at the team building the demo app. One customer ticket in mid-February triggered a four-month chain of operational lessons, each crystallized into a substrate rule. The arc spans four distinct threads across seven weeks — all linked to customer ticket #4471, submitted by Maya R.

The five substrate rules in `substrate-rules.sql` all trace back to this incident chain. A Phase 10/11 distiller run against this JSONL should extract all five with correct `applies_when` fields and provenance. The turn-ref map in this document is the audit record.

---

## Narrative Threads

### Thread 1 — Feb 12, 2026: Customer Ticket #4471 (Turns 001–010)

**Event:** Maya R. emails support: "I clicked Delete on my account last month and got billed again this month. What happened?"

**Session participants:** An engineer (user role) pulls up the ticket and pairs with Claude Code to trace the deletion flow.

**Discovery:** The `DELETE /api/account` route calls `db.user.delete({where: {id}})` directly. No grace period, no confirmation gate, no Stripe teardown. Maya had scrolled to the danger zone section, caught the Delete button with a muscle-memory click, and the action was irreversible.

**Decisions made:**

1. **`dec-soft-delete-30day-grace-2026-02-18`** — Replace hard-delete with soft-delete: set `deletedAt`, sign out, send email, nightly purge after 30 days. Never call `db.user.delete()` from a request handler.
2. **`dec-confirm-via-email-link-2026-02-18`** — The button itself doesn't delete; it sends an email link. The action proceeds only when the user clicks the link within 24 hours. The context-switch surfaces intent that a modal confirmation doesn't.

Both decisions were named and their applies_when conditions articulated in the same session (turns 001–010, approximately 2026-02-12T09:14Z–2026-02-12T10:45Z). The session ended with the team agreeing on the implementation shape and noting the GDPR/CCPA backlog as the policy pressure driving the grace window design.

---

### Thread 2 — Feb 19, 2026: Stripe Webhook 404 (Turns 011–018)

**Event:** Stripe webhook fires a billing renewal for Maya's deleted account; the local user record is gone; webhook handler 404s in prod. Payment team pings engineering.

**Session participants:** Same engineer, different day. The soft-delete fix from Thread 1 was already merged (or in review) — this is the billing integration side of the same problem.

**Discovery:** The original deletion handler called `db.user.delete()` and nothing else. Stripe subscription was not cancelled; the Stripe customer record was not archived. When the webhook fired after the deletion, the local lookup returned null and the handler threw. Additionally, calling `stripe.customers.del()` would wipe payment history needed for chargebacks.

**Constraint made:**

3. **`con-stripe-customer-archive-2026-02-22`** — When deleting an account with a Stripe customer, call `stripe.customers.update(id, {metadata: {archived: 'true', archived_at: <iso>}})`. Never call `stripe.customers.del()`. Cancel subscriptions first via `subscriptions.cancel()` with `invoice_now: false, prorate: false`.

The constraint was formally named during the follow-up session a few days later (2026-02-22) but the analysis happened on Feb 19. This document uses Feb 22 as the rule's valid_at date per substrate-rules.sql.

---

### Thread 3 — March 3, 2026: IRS Audit Response (Turns 019–027)

**Event:** An IRS audit response arrives. The auditor has flagged that three months of Maya's invoices are missing from the system. The cascade-delete on `db.user.delete()` had torn down Invoice records.

**Session participants:** Engineering + finance rep. Session reviews what was deleted and what should have been retained.

**Discovery:** The original delete cascaded through the Invoice table. Three months of tax records — the exact ones the IRS asked for — are gone. Finance signs off on a fix: anonymize-in-place. Name and email replaced with `[deleted user]`; financial data and timestamps intact.

**Constraint made:**

4. **`con-anonymize-not-delete-tax-held-2026-03-04`** — Records subject to tax-record retention (Invoice, Payment, Refund, TaxFiling, OrgInvoice) must be anonymized, not deleted. User-identifying fields overwritten with `[deleted user]`; financial data kept.

---

### Thread 4 — March 9, 2026: FTC CAN-SPAM Corrective-Action Letter (Turns 028–038)

**Event:** A sales-led CSV import re-subscribed Maya (who is now anonymized but still in the system as `[deleted user]`) to the monthly newsletter. She complained. The FTC's CAN-SPAM enforcement contact sent a corrective-action letter.

**Session participants:** Engineering + marketing ops. The problem: "deleted" didn't mean "remembered as unsubscribed." Bulk import of a CSV list re-added her because Mailchimp had no suppression record.

**Discovery:** The deletion flow had no mailing-list step. Setting status to `deleted` on our side doesn't create a Mailchimp suppression record. Future imports will re-add deleted users unless we explicitly set `status: 'unsubscribed'` on the Mailchimp member (not delete them — the suppression record is what prevents re-add).

**Constraint made:**

5. **`con-mailing-list-suppress-not-delete-2026-03-11`** — When deleting a user, set their email to status `"unsubscribed"` on the marketing list (status_if_new also `"unsubscribed"`). Do not delete the list member. The suppression record prevents re-add by future bulk imports.

---

### Priority Shift (Not a JSONL Turn — Leadership Decision)

The four-thread incident chain was the proximate cause of a leadership decision made in early April 2026: the L0 priority shifted from **Q4 2025 `reduce-onboarding-friction`** to **2026-Q2 `compliance-first`**, effective 2026-04-24.

This shift is referenced narratively in the final turn of the JSONL (turn 039): the engineer signs off noting that "these four months have been an education; we're shifting the L0 priority from reduce-onboarding-friction to compliance-first effective April 1." The shift itself is a leadership decision recorded separately in the substrate as `prio-compliance-first-2026-Q2 supersedes prio-reduce-onboarding-friction-2025-Q4`. Phase 12's supersession engine draws the orange flag from this; Phase 9 makes the connection narratively visible.

---

## Substrate Rule to Turn-Ref Map

This table maps each of the 5 substrate rule IDs to the JSONL turns where the decision/constraint is articulated. A Phase 11 distiller run should cite a turn in this range when it extracts each rule.

| Rule ID | Rule Type | JSONL Turn Range | Key Turn | Verbatim anchor |
|---|---|---|---|---|
| `dec-soft-delete-30day-grace-2026-02-18` | decision | turns 003–006 | turn-004 | "Soft-delete with 30-day grace. Set `deletedAt` to the request timestamp..." |
| `dec-confirm-via-email-link-2026-02-18` | decision | turns 003–006 | turn-004 | "Email-link confirmation. The button doesn't actually delete on click — it sends an email link..." |
| `con-stripe-customer-archive-2026-02-22` | constraint | turns 011–016 | turn-014 | "call `stripe.customers.update(id, { metadata: { archived: 'true'...}})`. Never call `stripe.customers.del()`" |
| `con-anonymize-not-delete-tax-held-2026-03-04` | constraint | turns 019–024 | turn-022 | "records subject to tax-record retention...must be anonymized, not deleted...`[deleted user]`" |
| `con-mailing-list-suppress-not-delete-2026-03-11` | constraint | turns 028–035 | turn-032 | "set their email to status `\"unsubscribed\"` on the marketing list...Do not delete the list member" |

---

## Reproducibility Note

Run `jq-validation.sh` against `deletion-incident-2026-02.jsonl` to verify the file is ingestible by the Phase 10 filter pipeline before placing it at `~/.claude/projects/<encoded-cwd>/`:

```bash
/Users/yang/lahacks/.planning/demo/seeds/source-sessions/jq-validation.sh
```

The script verifies:
1. Every JSONL line is valid JSON (no malformed lines).
2. The Phase 10 filter (`type=user|assistant` + text content extraction) produces non-empty output.
3. All 5 substrate rule IDs appear in the filtered text (distiller anchor tokens).
4. The priority-shift anchor (`compliance-first`) is present.

Expected output: `[validate] PASS` with no `WARNING:` lines.

---

## Authoring Notes

- **Method:** Hand-authored synthetic fixture. More controllable than editing a real session (turn boundaries, verbatim rule text placement, and narrative arc are all intentional). The JSONL is plausible but not a recording of a real session.
- **Schema compliance:** Follows the Phase 10 ingestor's filter logic in `session/ingestor.rs` — `type: "user"` rows have `message.content` as a plain string; `type: "assistant"` rows have `message.content` as an array of `{type: "text", text: ...}` blocks (plus optional `tool_use` blocks for realism). `isMeta` is absent on conversational turns (so the filter keeps them).
- **Verbatim text:** The `text` field of each substrate rule (from `scenario-criteria.md § 6`) is embedded verbatim in the assistant turn that crystallizes the rule. This makes Phase 11's distiller extraction testable against the ground truth.
- **Tool-use blocks:** A few assistant turns include `tool_use` blocks (Read, Bash) for realism. Phase 10's filter skips them; they don't affect the filtered transcript.
- **Session continuity:** The four threads share `session_id: "sess-2026-02-deletion-incident"` to reflect the plan note that this is "a single coherent narrative arc." In a real scenario these might be different sessions on different days, but for distiller regression purposes a single session ID simplifies the test.

---

## Forward Compatibility

The JSONL is the upstream fixture for:

- **Phase 10 session watcher:** placed at `~/.claude/projects/<encoded-cwd>/deletion-incident-2026-02.jsonl`, the watcher will ingest it on next tick.
- **Phase 11 distiller:** the distiller's regression test should extract all 5 rules with correct `applies_when` conditions and provenance citations. The `source.turn_ref` field in each extracted constraint should fall within the ranges in the turn-ref map above.
- **Beat 2/4 demo `[source]` citations:** the `deletion-incident-2026-02.jsonl` session ID is the provenance reference that the substrate rules cite. When a judge clicks `[source]` on a rule in the demo, this is the session they see.
