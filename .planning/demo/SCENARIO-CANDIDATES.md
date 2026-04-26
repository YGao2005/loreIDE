# Demo Scenario Candidates — Investigation + Recommendation

**Status:** Investigation deliverable. Reading session 2026-04-24. The next session commits the recommended scenario into `scenario-criteria.md` § Committed Scenario, replacing the save-changes-button entry there.

**TL;DR:** Recommend **delete-account button** (with workspace-delete as Beat 4). It is the only candidate where (a) vanilla loses on five distinct operational rules, not one UI convention; (b) every one of those rules fires again on the Beat 4 task, with two new rules captured back into the substrate live; and (c) the rules read cleanly as a 5-line on-screen rubric that lets judges literally see what the substrate knows that vanilla doesn't.

---

## 1. Shortlist

Five candidates evaluated against the 8+1 constraints. Rankings are over the field, not absolute. Pass = clearly satisfies; partial = satisfies but with caveats; fail = does not satisfy.

| # | Candidate | Trigger (one line) | Substrate depth (one line) | Beat 4 sibling | C1 verifiable | C2 substrate-only | C3 non-obvious | C4 specific | C5 visible | C6 trigger-fix align | C7 4–5 mixed-visibility decisions | C8 Beat 4 fitness | C9 schema fit |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **A** | **Delete-account button** | Customer ticket: "I clicked Delete and got billed again next month" + GDPR/CCPA backlog | 5 ops rules from one Q1 incident (soft-delete, anonymize, Stripe archive, mailing-list suppress, email-link confirm) | Delete this team workspace (admin) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ 5 rules, 1 UI + 4 backend-invisible | ✅ 5/5 rules fire + 2 captured back live | ✅ |
| **B** | Apply-to-job button | Legal: "We're missing CA pay-transparency disclosures on listings" | 4 regulatory rules (pay-range visible, EEO voluntary self-id, OFCCP source field, EU GDPR consent) | Quick-apply on search-results page | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ 4 rules, 1 UI + 3 compliance | ✅ 4/4 fire on different surface | ✅ |
| **C** | Refund button on order page (prior Option B) | Support: "Customers calling to refund — need self-service" | 4 e-comm rules (CTAButton, confirm modal, idempotency-key, v2 endpoint, legal copy) | Cancel-subscription button | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | partial — 3 transfer cleanly to cancel-sub; idempotency feels e-comm-specific | partial — substrate inheritance is real but less universal | ✅ |
| **D** | Download patient lab results | HIPAA audit: "Patients calling to ask for results — slow turnaround, also we're exposing PHI in URLs" | 4 healthcare rules (signed-URL TTL, audit log w/ purpose, BAA-storage tag, medical disclaimer) | Email lab results to referring provider | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ 4 rules, mostly backend | ✅ all rules + adds receiving-party verification | ✅ |
| **E** | Order-now button (food delivery, alcohol gating) | Compliance: "Alcohol delivered to underage recipients — settlement requires controls" | 4 mixed rules (CTAButton, ID-check flag, allergen disclaimer, FTC explicit-fee display, 21+ self-attest) | Reorder-from-history button | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | partial — 5 rules but reorder may skip ID-check if same items | partial — substrate inheritance is incomplete | ✅ |

**Cuts that didn't make the table:** sportsbook place-bet (judge-relatable but socially awkward for hackathon), telehealth send-prescription (audience too narrow), wire-transfer button (regulatory burden too heavy to spec in 4min).

---

## 2. Recommendation — Candidate A: Delete-account button

**Pick A over B (apply-to-job):** A's substrate is 5 distinct operational scars from a single coherent incident; B's substrate is 4 pieces of regulatory homework. Scars produce a more visceral "we got burned learning this" narrative than compliance checklists. Also, A's vanilla wrong answer is *one line* (`await db.user.delete({where:{id}})`) which makes the side-by-side hit harder than B's plausible-looking form code.

**Pick A over C (refund):** A's Beat 4 fires 5/5 rules on workspace-delete with 2 new rules captured back live (visible substrate compounding). C's Beat 4 fires 3/4 rules on cancel-subscription with weaker transfer (idempotency reads as "e-comm-shaped knowledge" rather than "destructive-action discipline"). The closed-loop payoff is materially stronger in A.

**Pick A over D (lab-results):** A is universally relatable to any judge who has ever clicked "Delete account" or filed a GDPR request. D's domain depth is unmatched but the audience for the wow-moment is narrower — a startup judge with no healthcare background may discount the rules they don't recognize. A doesn't have that risk.

**Pick A over E (food-delivery):** E's rule set is solid but reorder-from-history is a weak Beat 4 sibling — vanilla can plausibly skip the ID-check and allergen disclaimer ("user already accepted last time, right?") which weakens the closed-loop story. A's workspace-delete fires every rule at full strength.

**Why A passes the user-named hard test** (vanilla messes up on *both* the PM prompt and the Beat 4 prompt because of genuine domain knowledge): vanilla's training data covers *what destructive operations look like in code*, not *what destructive operations look like in a SaaS company that's been burned*. Soft-delete-30d, anonymize-tax-held, Stripe-customer-archive, mailing-list-suppress, email-link-confirm — none of these are derivable from grepping a clean codebase. A vanilla agent reading the repo and writing `db.user.delete()` is being a perfectly competent engineer. It is also wrong, twice — once on account-delete, once on workspace-delete — for exactly the same reason. That's the demo.

---

## 3. Full specification — delete-account button

### 3.1 PM-side (Beat 1, NT laptop)

**The PM's prompt** (one line, into Cmd+P or directly typed into the contract Inspector):

```
add a delete-account button to the account settings page
```

**The PM's contract body** — schema-honest sectioned-markdown the PM types into the Inspector. Intent + Role + Examples only; the agent fills Inputs/Outputs/Invariants from implementation post-hoc. Conforms to `prompt-v2.ts` rules (no `useState`, `prop`, `Tailwind`, etc. in Intent/Examples; product language).

```markdown
## Intent
The Account Settings page needs a way for a customer to delete
their own account without contacting support. Today, every delete
request is a manual ticket, and we have a backlog from the GDPR
and CCPA windows. The customer who started the latest thread
clicked "delete" once already, was charged the next month anyway,
and is unhappy. The button must do what the customer expects
("I'm done, stop everything") while keeping us out of the kind of
trouble we hit in the February incident.

## Role
A primary action at the bottom of the danger-zone section of the
Account Settings page. It is the only place a logged-in customer
can self-serve account deletion.

## Examples
GIVEN a logged-in customer on the Account Settings page
WHEN they click Delete Account and confirm via the email link
THEN their account is marked for deletion with a 30-day grace window
  AND they are signed out
  AND a confirmation appears explaining what will and won't be kept

GIVEN a customer who clicked Delete Account by mistake
WHEN they don't click the email confirmation link within 24 hours
THEN nothing changes and their account remains fully active

GIVEN a customer who has past invoices in the system
WHEN their account is purged after the 30-day grace window
THEN the invoices remain readable for tax-records purposes
  AND every personally identifying field on those invoices reads
      as "[deleted user]" instead of their name and email
```

The PM never names a component, library, table, or API. The agent gets the contract atom + retrieved substrate constraints + the `applies_when`-matched scope, then composes the implementation.

### 3.2 Vanilla wrong answer (Beat 2 right pane)

`app/account/settings/page.tsx` — vanilla greps the codebase, finds no specific delete pattern, follows sensible engineering defaults:

```tsx
<button
  onClick={async () => {
    if (!confirm('Delete your account?')) return;
    await fetch('/api/account', { method: 'DELETE' });
    router.push('/');
  }}
  className="bg-red-600 text-white px-4 py-2 rounded"
>
  Delete Account
</button>
```

`app/api/account/route.ts`:

```ts
export async function DELETE(req: Request) {
  const userId = await getUserId(req);
  await db.user.delete({ where: { id: userId } });
  return new Response(null, { status: 204 });
}
```

**Defensibly correct against the code.** The `User` model has a primary key. The fetch reaches a route. The button renders. **Wrong against five rules the team learned the hard way.** Specifically:

1. ❌ Hard-deletes immediately (no grace) — same shape as the February incident
2. ❌ Cascades or hard-deletes invoices that must be retained 7 years for tax
3. ❌ Doesn't archive the Stripe customer; next billing cycle will 404 in prod
4. ❌ Doesn't suppress the email on the marketing list — CAN-SPAM violation if the user is later re-added
5. ❌ Confirms via in-app `confirm()` only — same single-click failure mode as the customer ticket

### 3.3 Contract IDE right answer (Beat 2 left pane)

`app/account/settings/page.tsx`:

```tsx
<DangerActionButton
  onClick={requestDeletion}
  loading={isPending}
  confirmation="email-link"
>
  Delete Account
</DangerActionButton>
```

`app/api/account/route.ts`:

```ts
export async function DELETE(req: Request) {
  const userId = await getUserId(req);
  await beginAccountDeletion(userId);
  return new Response(null, { status: 204 });
}
```

`lib/account/beginAccountDeletion.ts` (the substantive change):

```ts
export async function beginAccountDeletion(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });

  // 1. Soft-delete with 30-day grace (per dec-soft-delete-30day-grace)
  await db.user.update({
    where: { id: userId },
    data: { deletedAt: new Date() },
  });

  // 2. Anonymize tax-held invoices instead of deleting (per con-anonymize-not-delete-tax-held)
  await db.invoice.updateMany({
    where: { userId },
    data: { userName: '[deleted user]', userEmail: '[deleted user]' },
  });

  // 3. Archive Stripe customer, don't delete (per con-stripe-customer-archive)
  if (user.stripeCustomerId) {
    await stripe.customers.update(user.stripeCustomerId, {
      metadata: { archived: 'true', archived_at: new Date().toISOString() },
    });
  }

  // 4. Suppress on mailing list, don't delete (per con-mailing-list-suppress-not-delete)
  await mailchimp.lists.setListMember(MARKETING_LIST_ID, hashEmail(user.email), {
    status: 'unsubscribed',
    status_if_new: 'unsubscribed',
  });

  // 5. Send email-link confirmation (per dec-confirm-via-email-link)
  await sendDeletionConfirmationEmail(user.email, user.id);

  await auditLog('account.deletion_requested', { userId });
}
```

Five files touched (settings page, route, lib function, audit, mailing). Every line is the substrate firing.

### 3.4 The on-screen rubric (Beat 2 visible artifact)

A persistent panel below the side-by-side panes during the recorded segment. Each rubric item is short enough to scan in 1 second. Each agent gets a column; check marks fill in as their code is evaluated against the rule.

```
┌─────────────────────────────────────────────────────────────────┐
│  Team rules — captured Feb 2026, after the deletion incident    │
├──────────────────────────────────────────────┬───────┬──────────┤
│                                              │ Bare  │ Contract │
│                                              │ Claude│ IDE      │
├──────────────────────────────────────────────┼───────┼──────────┤
│  1. Soft-delete with 30-day grace            │   ✗   │    ✓     │
│  2. Keep tax records (anonymize, not delete) │   ✗   │    ✓     │
│  3. Archive Stripe customer (don't delete)   │   ✗   │    ✓     │
│  4. Suppress mailing list (CAN-SPAM)         │   ✗   │    ✓     │
│  5. Email-link confirmation, not just modal  │   ✗   │    ✓     │
└──────────────────────────────────────────────┴───────┴──────────┘
```

Animation note: rules appear as the substrate query returns them on the left pane (~2s in), check marks fill in on each agent's column as their respective code is written. Bare Claude's column ends with 5 ✗; Contract IDE's ends with 5 ✓. Holds on screen for the last ~5s of Beat 2 alongside the receipt-delta banner.

This is the core visual proof. Receipts (tokens, tool calls) tell *how efficiently*. The rubric tells *what specifically*. Judges who don't read code can still read the rubric.

### 3.5 Substrate decisions (5, all required, with rubric labels)

Each constraint includes a short **rubric label** (used on-screen) and the full substrate text + applies_when + justification (the form distilled into SQLite). All five share the same origin story: the **February 2026 deletion incident** — one 2-week thread covering the customer ticket, the March tax-audit fallout, the Stripe API errors, and the CAN-SPAM letter. Single coherent narrative arc; the source-session script in Phase 10 has one conversation to reproduce, not five.

```
─────────────────────────────────────────────────────────────────────
id:           dec-soft-delete-30day-grace-2026-02-18
type:         decision
rubric:       Soft-delete with 30-day grace
text:         Account-level delete is a soft-delete: set deletedAt
              to the request timestamp, sign the user out, send
              confirmation email, and let the nightly purge job hard-
              delete after the 30-day grace window. Never call
              `db.user.delete()` from a request handler.
applies_when: a user-initiated or admin-initiated action removes a
              user, organization, workspace, or any account-shaped
              record
justification: Feb-12 ticket #4471: customer hit Delete by accident
              while scrolling Settings, was charged the following
              month because the request handler had already torn
              down their state but a webhook-triggered payment ran
              against an in-flight subscription. The 30-day grace
              window plus email confirmation eliminates this class
              entirely.

─────────────────────────────────────────────────────────────────────
id:           con-anonymize-not-delete-tax-held-2026-03-04
type:         constraint
rubric:       Keep tax records (anonymize, not delete)
text:         Records subject to tax-record retention (invoices,
              payments, refunds, tax filings) must be anonymized,
              not deleted, when their associated user is purged.
              User-identifying fields (name, email, billing address)
              are overwritten with "[deleted user]"; the financial
              data and timestamps remain intact.
applies_when: an account purge would otherwise cascade-delete a
              record that legal/finance has flagged as held-for-
              retention (current list: Invoice, Payment, Refund,
              TaxFiling, OrgInvoice — see lib/retention/held.ts)
justification: March-3 finding from the IRS audit response: the
              Feb deletion had cascade-deleted three months of the
              customer's invoices. We could not produce them; the
              auditor noted it as a control deficiency. The fix is
              anonymize-in-place; finance signed off on the
              "[deleted user]" placeholder as legally sufficient.

─────────────────────────────────────────────────────────────────────
id:           con-stripe-customer-archive-2026-02-22
type:         constraint
rubric:       Archive Stripe customer (don't delete)
text:         When deleting an account that has a stripeCustomerId,
              call `stripe.customers.update(id, { metadata: { archived:
              'true', archived_at: <iso> } })`. Never call
              `stripe.customers.del()`. Subscriptions must be canceled
              first via `subscriptions.cancel()` with
              `invoice_now: false`, `prorate: false`.
applies_when: an account being purged or deactivated has a Stripe
              customer attached
justification: Feb-19: post-deletion, the next billing-cycle
              webhook fired against the archived card and 404'd in
              prod — the deletion request had not canceled the
              subscription, only torn down our user record. Calling
              `customers.del()` on Stripe prevents future billing
              but also wipes payment-history we need for chargebacks
              and dispute response. Archive with metadata gives
              both: no future billing, full history accessible.

─────────────────────────────────────────────────────────────────────
id:           con-mailing-list-suppress-not-delete-2026-03-11
type:         constraint
rubric:       Suppress mailing list (CAN-SPAM)
text:         When deleting a user, set their email to status
              "unsubscribed" on the marketing list (status_if_new
              also "unsubscribed"). Do not delete the list member.
              The suppression record is what prevents re-add by a
              future bulk import.
applies_when: an account being deleted has any record in
              MARKETING_LIST_ID, TRANSACTIONAL_LIST_ID, or any list
              registered under lib/marketing/lists.ts
justification: March-9: a sales-led re-import of a CSV
              re-subscribed the deleted Feb-12 customer to the
              monthly newsletter. We received a complaint and a
              corrective-action request from the FTC's CAN-SPAM
              enforcement contact, exposing that "deleted" was
              not "remembered as unsubscribed." Mailchimp
              suppression list is what carries that memory.

─────────────────────────────────────────────────────────────────────
id:           dec-confirm-via-email-link-2026-02-18
type:         decision
rubric:       Email-link confirmation, not just modal
text:         Destructive account-level actions require email-link
              confirmation, not in-app modal alone. The modal sends
              the link; the action only proceeds when the user
              clicks the link in their email within 24 hours. After
              24 hours the request expires silently with no state
              change.
applies_when: a UI action will (a) terminate, (b) anonymize, or
              (c) irrevocably remove access to a user, organization,
              workspace, or paid resource
justification: Same Feb-12 ticket as dec-soft-delete-30day-grace:
              the customer's complaint was specifically that one
              accidental click had triggered a permanent action.
              An in-app `confirm()` was insufficient because the
              customer had clicked it as muscle memory while
              scrolling. Email-link confirmation requires a context
              switch that surfaces intent.
```

### 3.6 Beat 4 — workspace-delete (closed-loop)

**The Beat 4 prompt** (T types into Claude Code on T's laptop):

```
add a delete-workspace button to the team settings page
```

**Why it's the right Beat 4:** different surface (Team Admin vs Account Settings), different actor (admin vs end-user), different scope (org with N members vs single account). **Same underlying intent: destructive actions on a unit-of-account must respect retention, billing integrity, and audit trail.** This is the high-level goal that drove the original substrate; it is still load-bearing.

**Substrate propagation matrix.** All five rules captured in the morning's session fire on the afternoon's task. Vanilla on the same prompt would write `await db.workspace.delete({where:{id}})` and miss every one.

| Substrate rule | How it fires on workspace-delete |
|---|---|
| `dec-soft-delete-30day-grace` | `workspace.deletedAt = now()`; nightly purge sweeps after 30d |
| `con-anonymize-not-delete-tax-held` | `OrgInvoice` records anonymized — `org_name = '[deleted org]'`; member-PII fields nulled |
| `con-stripe-customer-archive` | Workspace's Stripe customer (workspaces have subscriptions in this model) archived with `metadata.archived` |
| `con-mailing-list-suppress-not-delete` | All members of the workspace suppressed from org-comms list; member personal lists untouched |
| `dec-confirm-via-email-link` | Email link sent to workspace **owner** (not just any admin); 24-hour window |

**Two new rules captured back to substrate live during Beat 4** (the "compounding" moment — visibly written into the substrate at the end of the beat, ~5s of demo time):

```
─────────────────────────────────────────────────────────────────────
id:           con-cascade-revoke-tokens-on-org-delete-2026-04-25
type:         constraint
rubric:       Revoke member access tokens
text:         When an organization is purged or marked-for-deletion,
              all member API tokens scoped to that org are revoked
              immediately (not at the end of the 30-day grace).
              Members lose access at the moment-of-request.
applies_when: a destructive action targets a multi-actor scope
              (org, workspace, team, project) where access tokens
              outlive the request handler
justification: Surfaced during the workspace-delete implementation:
              soft-delete with grace works for billing/tax retention,
              but leaving tokens live for 30 days lets a removed
              member continue API access even after the org is
              "deleted" in the UI. Access revocation is not
              retention-sensitive and should fire immediately.

─────────────────────────────────────────────────────────────────────
id:           dec-owner-orphan-check-2026-04-25
type:         decision
rubric:       Owner-orphan check before delete
text:         An organization can only be deleted if it has zero
              members other than the requester, OR ownership has
              been transferred to another member who has confirmed
              acceptance. The button is disabled with explanatory
              text when neither condition holds.
applies_when: a delete action targets a multi-actor scope; the
              actor is not the only member
justification: Surfaced during workspace-delete implementation:
              hitting Delete on a workspace with active members
              would orphan their work without warning. Either solo-
              ownership or explicit transfer-then-delete is required.
```

These two rules generalize from "this workspace task" to "any multi-actor-scope destructive action." Next time the team adds delete-project or delete-team-folder, both rules apply automatically. **The substrate is visibly larger at the end of the demo than at the start.** That's the compounding claim made concrete.

### 3.7 Orange-flag fixture for Beat 3 verifier

The Beat 3 verifier must surface one orange flag — a parent-surface decision made under a now-superseded priority. For delete-account, the natural fixture:

**Parent surface:** Account Settings page (L3 surface).
**Stale decision:** `con-settings-no-modal-interrupts-2025-Q4` — derived under Q4 2025 priority `reduce-onboarding-friction`. Text: *"Settings page interactions should be inline and friction-free; no modal interrupts on save or update actions."*
**Why it flags:** the new Delete Account button triggers a confirmation modal (which sends the email link). Modal interrupts violate the parent constraint. But the new constraint `dec-confirm-via-email-link-2026-02-18` was derived under priority `compliance-first`, which superseded `reduce-onboarding-friction` on 2026-04-01.

**Verifier output:**

```
✓ Matches contract — Delete Account action present in danger-zone section
✓ dec-soft-delete-30day-grace honored — deletedAt set, no hard delete
✓ con-anonymize-not-delete-tax-held honored — invoice updateMany present
✓ con-stripe-customer-archive honored — customers.update with metadata
✓ con-mailing-list-suppress-not-delete honored — mailchimp suppress call
✓ dec-confirm-via-email-link honored — sendDeletionConfirmationEmail call
⚠ Parent surface (Account Settings) holds con-settings-no-modal-interrupts-2025-Q4
  ("no modal interrupts on user actions") — derived 2025-Q4 under priority
  `reduce-onboarding-friction`. Current priority since 2026-04-01 is
  `compliance-first`. The new modal interrupt may be intended; review.
```

**Engineer resolution:** T clicks the flag, side panel opens with priority history. T types: *"Destructive actions require confirmation modals; the no-modal rule applies to non-destructive Settings interactions only. Narrowing the scope of the parent constraint."* Clicks Accept. Orange clears. Constraint scope updates in substrate.

This makes the supersession moat (the v2 thesis claim from `VISION.md`) concrete and visible — fact-level memory tools cannot do this kind of priority-shift propagation because they don't have a goal hierarchy.

---

## 4. Open questions — resolved 2026-04-24

Three judgment calls flagged in the original investigation, all resolved per user direction:

1. **Q1 incident date/ticket-number specificity** — locked as written (Feb-12 ticket #4471, March-3 IRS finding, Feb-19 Stripe webhook, March-9 sales import). Source-session script in Phase 10 will reproduce these.
2. **Stripe-archive incident shape** — tightened from "two billing cycles before failing" to "the next billing-cycle webhook fired against the archived card and 404'd in prod." Sharper, less embarrassing for the seeded company.
3. **CAN-SPAM dollar amount** — dropped. Replaced with "complaint and corrective-action request from the FTC's CAN-SPAM enforcement contact." The existence of the complaint is what makes the rule load-bearing; the amount adds nothing.

---

## 5. What this commits us to (downstream, not this session)

Once committed in the next session, the following downstream work follows. None of it happens here.

- `scenario-criteria.md` § Committed Scenario — replace save-changes-button content with delete-account content above
- `runbook-v2.md` — update Scene 3 + reset-procedure references
- `live-scenario.md` — swap prompt + substrate hits + right-answer JSX
- `presentation-script.md` — fill the bracketed placeholders (PM contract body, substrate IDs, Beat 4 prompt, orange-flag content). Add the on-screen rubric (§3.4) as a Beat 2 visible artifact and the harvest-back substrate-write (§3.6) as a Beat 4 visible moment.
- `PITCH.md` — Scene 3 swap to delete-account
- Repo provisioning: Next.js + Auth + Prisma + Stripe + Mailchimp adapter (or thin equivalents). The `User`, `Invoice`, `Workspace` Prisma models must exist; the `MARKETING_LIST_ID` constant + `mailchimp.lists.setListMember()` import path must resolve. No exotic dependencies.
- Source-session script: a single 2-week incident-response thread covering the Feb-12 ticket, March-3 IRS finding, Feb-19 Stripe webhook noise, March-9 sales re-import + CAN-SPAM letter. Distillation produces all 5 substrate rules.
- Reset fixture: SQLite snapshot containing the 5 rules above + the Account Settings L3 surface with `con-settings-no-modal-interrupts-2025-Q4` + the priority-shift record (Q4-2025 `reduce-onboarding-friction` → 2026-04-01 `compliance-first`).
