# Demo Scenario Selection Criteria

**Status:** ✅ **Resolved 2026-04-24 (re-locked).** Scenario locked — see `## Committed Scenario` below. The previously-committed save-changes-button scenario was rejected for trigger-fix mismatch and thin substrate depth (see `HANDOFF-demo-revision.md` for diagnosis, `SCENARIO-CANDIDATES.md` for the re-investigation that produced the current pick). The remainder of this document below the committed-scenario section is preserved as the rationale + rubric that frames the choice.

---

## Committed Scenario

**Headline:** *"Add a delete-account button to the account settings page."* Vanilla writes `await db.user.delete({where:{id}})` — one line, defensibly correct against the code, wrong against five operational rules the team learned the hard way during the February 2026 deletion incident. Contract IDE retrieves all five from substrate and writes a 5-file change that honors every one. Beat 4 demonstrates compounding: the same five rules fire on workspace-delete, plus two new ones get captured back into the substrate live.

### 1. The prompt

```
add a delete-account button to the account settings page
```

One line. Same prompt fed to both vanilla Claude Code and Contract IDE in the Beat 2 recorded comparison; same prompt is what the PM-side Beat 1 contract atom commissions.

### 2. The PM-authored contract body (Beat 1)

What the PM types into the Inspector's Contract tab in v2 sectioned-markdown form. Intent + Role + Examples only; the agent fills Inputs/Outputs/Invariants from implementation post-hoc. Honors `prompt-v2.ts` banword rules (no `useState`, `prop`, `Tailwind`, etc. in Intent/Examples; product language).

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

### 3. Vanilla-Claude wrong answer (Beat 2 right pane)

Vanilla greps the codebase, finds no specific delete pattern, follows sensible engineering defaults.

`app/account/settings/page.tsx`:

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

**Defensibly correct against the code.** The `User` model has a primary key. The fetch reaches a route. The button renders. **Wrong against five rules** — hard-deletes immediately, cascades or hard-deletes tax-held invoices, doesn't archive the Stripe customer (next billing cycle 404s in prod), doesn't suppress the email on the marketing list (CAN-SPAM exposure), confirms via in-app `confirm()` only (the same single-click failure mode the customer ticket reported).

### 4. Contract IDE right answer (Beat 2 left pane)

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

`lib/account/beginAccountDeletion.ts` (the substantive change — every line is a substrate rule firing):

```ts
export async function beginAccountDeletion(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });

  // 1. Soft-delete with 30-day grace
  await db.user.update({
    where: { id: userId },
    data: { deletedAt: new Date() },
  });

  // 2. Anonymize tax-held invoices (don't cascade-delete)
  await db.invoice.updateMany({
    where: { userId },
    data: { userName: '[deleted user]', userEmail: '[deleted user]' },
  });

  // 3. Archive Stripe customer (don't delete)
  if (user.stripeCustomerId) {
    await stripe.customers.update(user.stripeCustomerId, {
      metadata: { archived: 'true', archived_at: new Date().toISOString() },
    });
  }

  // 4. Suppress on mailing list (CAN-SPAM)
  await mailchimp.lists.setListMember(MARKETING_LIST_ID, hashEmail(user.email), {
    status: 'unsubscribed',
    status_if_new: 'unsubscribed',
  });

  // 5. Send email-link confirmation
  await sendDeletionConfirmationEmail(user.email, user.id);

  await auditLog('account.deletion_requested', { userId });
}
```

### 5. The on-screen rubric (Beat 2 visible artifact)

A persistent panel below the side-by-side panes during the recorded segment. Each rubric item is short enough to scan in 1 second. Each agent gets a column; check marks fill in as their code is evaluated against the rule. Bare Claude's column ends with five ✗; Contract IDE's ends with five ✓. Holds on screen for the last ~5s of Beat 2 alongside the receipt-delta banner.

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

Rubric labels are short (3–6 words) and judge-readable without industry jargon. Animation: rules appear as the substrate query returns them on the left pane (~2s in); check marks fill in on each agent's column as their respective code is written. This is the core visual proof — receipts (tokens, tool calls) tell *how efficiently*; the rubric tells *what specifically*. Judges who don't read code can still read the rubric.

### 6. Substrate decisions (5, all required)

Each carries a short rubric label (used on-screen) and the full substrate text + applies_when + justification (the form distilled into SQLite). All five share the same origin story — the **February 2026 deletion incident** — one 2-week thread covering the customer ticket, the March tax-audit fallout, the Stripe webhook noise, and the CAN-SPAM letter. Single coherent narrative arc; the source-session script reproducing them in Phase 10 has one conversation to write, not five.

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
justification: Feb-19: post-deletion, the next billing-cycle webhook
              fired against the archived card and 404'd in prod —
              the deletion request had not canceled the subscription,
              only torn down our user record. Calling `customers.del()`
              on Stripe prevents future billing but also wipes
              payment-history we need for chargebacks and dispute
              response. Archive with metadata gives both: no future
              billing, full history accessible.

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

### 7. Beat 4 — workspace-delete (closed loop, captured-back rules)

**Beat 4 prompt** (T types into Claude Code on T's laptop):

```
add a delete-workspace button to the team settings page
```

**Why it's the right Beat 4:** different surface (Team Admin vs Account Settings), different actor (admin vs end-user), different scope (org with N members vs single account). **Same underlying intent: destructive actions on a unit-of-account must respect retention, billing integrity, and audit trail.**

**Substrate propagation matrix.** All five rules captured in the morning's session fire on the afternoon's task. Vanilla on the same prompt would write `await db.workspace.delete({where:{id}})` and miss every one.

| Substrate rule | How it fires on workspace-delete |
|---|---|
| `dec-soft-delete-30day-grace` | `workspace.deletedAt = now()`; nightly purge sweeps after 30d |
| `con-anonymize-not-delete-tax-held` | `OrgInvoice` records anonymized — `org_name = '[deleted org]'`; member-PII fields nulled |
| `con-stripe-customer-archive` | Workspace's Stripe customer (workspaces have subscriptions in this model) archived with `metadata.archived` |
| `con-mailing-list-suppress-not-delete` | All members of the workspace suppressed from org-comms list; member personal lists untouched |
| `dec-confirm-via-email-link` | Email link sent to workspace **owner** (not just any admin); 24-hour window |

**Two new rules captured back to substrate live during Beat 4.** The "compounding" moment — visibly written into the substrate at the end of the beat, ~5–8 seconds of demo time. These generalize from "this workspace task" to "any multi-actor-scope destructive action."

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

The substrate is visibly larger at the end of the demo than at the start. That's the compounding claim made concrete.

### 8. Orange-flag fixture (Beat 3 verifier)

The Beat 3 verifier surfaces one orange flag — a parent-surface decision made under a now-superseded priority.

- **Parent surface:** Account Settings page (L3 surface)
- **Stale decision:** `con-settings-no-modal-interrupts-2025-Q4` — text: *"Settings page interactions should be inline and friction-free; no modal interrupts on save or update actions."* Derived under Q4 2025 priority `reduce-onboarding-friction`.
- **Why it flags:** the new Delete Account button triggers a confirmation modal (which sends the email link). Modal interrupts violate the parent constraint. But the new constraint `dec-confirm-via-email-link-2026-02-18` was derived under priority `compliance-first`, which superseded `reduce-onboarding-friction` on 2026-04-01.
- **Verifier output:**

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

- **Engineer resolution (on camera):** click flag → side panel opens with priority history → engineer types: *"Destructive actions require confirmation modals; the no-modal rule applies to non-destructive Settings interactions only. Narrowing the scope of the parent constraint."* → Accept → orange clears → constraint scope updates in substrate.

This makes the supersession moat (the v2 thesis claim from `VISION.md`) concrete and visible — fact-level memory tools cannot do this kind of priority-shift propagation because they don't have a goal hierarchy.

### 9. Demo repo choice

**Custom `contract-ide-demo` repo, forked from a Next.js + shadcn dashboard starter with Auth + Prisma + Stripe + Mailchimp adapters.**

The repo must have:
- `User`, `Workspace`, `Invoice`, `OrgInvoice` Prisma models
- `MARKETING_LIST_ID` constant + `mailchimp.lists.setListMember()` import path resolves
- Stripe SDK with `customers.update()` and `subscriptions.cancel()`
- Account Settings page (`app/account/settings/page.tsx`) and Team Settings page (`app/team/[slug]/settings/page.tsx`) scaffolds present, both without delete buttons (the targets of the Beat 1 and Beat 4 prompts)
- `DangerActionButton` component planted at `@/components/ui/danger-action-button`

No exotic dependencies. Specific base TBD in repo-prep work (candidates: `shadcn-ui/next-template`, `t3-oss/create-t3-app`, or freshly-scaffolded `create-next-app` + `shadcn add` + the adapters). Picking the specific base is downstream.

### Why this passes all five criteria + the three from the demo-revision pass

| # | Criterion | How this scenario satisfies it |
|---|---|---|
| 1 | Verifiable correctness | Five specific rules; each rule's presence/absence is greppable in the diff (`db.user.delete` vs `update({deletedAt})`, `customers.del` vs `customers.update`, `confirm()` vs `sendDeletionConfirmationEmail`, etc.). The rubric makes verification one-glance. |
| 2 | Discoverable only in substrate | None of the five rules is derivable from grepping the codebase. Each is operational scar tissue from a specific February incident — substrate-only knowledge. |
| 3 | Non-obvious from code alone | Vanilla writes `db.user.delete()` — perfectly competent engineering against the schema. Contradicts the substrate's hard-won discipline. |
| 4 | Specific, not generic | Exact API calls (`customers.update` not "archive in Stripe"), exact field names (`deletedAt`, `archived` metadata), exact import paths. |
| 5 | Visible on screen | Rubric panel + 5-file diff + receipt banner. Three reinforcing visuals. |
| 6 | Trigger-fix alignment | Customer ticket: "I clicked Delete and got billed again." Fix: a deletion flow that doesn't have that failure mode. Trigger and fix are the same thing. |
| 7 | 4–5 substrate decisions, mixed visibility | Five rules: 1 UI-visible (email-link modal), 4 backend-invisible-until-you-look (soft-delete, anonymize, Stripe archive, mailing suppress). |
| 8 | Beat 4 closed-loop fitness | All 5 rules fire on workspace-delete + 2 new rules captured back to substrate live. Substrate compounding is concrete, not asserted. |

### What this commits us to (downstream, not this session)

- **Repo provisioning** — fork a starter, add Auth + Prisma + Stripe + Mailchimp adapters, plant `DangerActionButton` + Account Settings + Team Settings scaffolds, lock to a commit
- **Source-session script** — write the Claude Code conversation that, when distilled, produces the 5 substrate rules with the right `applies_when` + provenance + the Feb-2026-incident narrative arc
- **Reset fixture** — SQLite snapshot containing the 5 rules + Account Settings L3 surface with `con-settings-no-modal-interrupts-2025-Q4` + the priority-shift record (Q4-2025 `reduce-onboarding-friction` → 2026-04-01 `compliance-first`)
- **Beat 4 staging** — engineer-laptop substrate state pre-loaded so Beat 4's harvest-back of `con-cascade-revoke-tokens-on-org-delete-2026-04-25` and `dec-owner-orphan-check-2026-04-25` is animatable on cue

Phase 10 + Phase 11-slice prep tasks. See `ROADMAP.md` v2 milestone (Phases 10–13) for sequencing.

---

# Demo Scenario Selection Criteria

**Status:** Open decision. Scenario TBD. Error-message / brand-voice scenario considered and rejected for reasons below. Intended to be resolved in a fresh exploratory session against the actual demo repo.

## The concern that killed the brand-voice scenario

"Update error messages to match brand voice" fails a test that matters: **a judge cannot objectively verify that Contract IDE's output is *more correct* than vanilla Claude's.**

- Vanilla: *"Invalid email address."*
- Contract IDE: *"That doesn't look like an email — try again."*

Both are defensible. Which is "better" depends on taste, brand, and whether the judge happens to agree with the voice guide. The demo becomes *"trust us, the decisions matter"* rather than *"watch the delta."*

Anything taste-based has this problem. **The demo scenario must be objectively right-or-wrong.**

## What a viable scenario must be

All five criteria, non-negotiable:

1. **Verifiable correctness.** There is a specific right answer — a hex code, a library name, a utility function, a config value. A judge can check which side got it right without appealing to taste.
2. **Discoverable only in the substrate.** The right answer lives in a prior decision/constraint captured from a historical session, not in code patterns a fresh agent could grep out.
3. **Non-obvious from code alone.** A blank-slate Claude doing thorough exploration would still guess wrong — the right answer contradicts sensible defaults.
4. **Specific, not generic.** A specific utility (`fetchWithAuth()` vs. bare `fetch`), a specific library choice (`@radix-ui/react-dialog` vs. `react-modal`), a specific numeric value (`debounce: 300` vs. `500`). Not "good UX" or "nice copy."
5. **Visible on screen.** The result shows up in the code diff, the preview iframe, or a rendered page — not hidden in behavior you have to probe for.

## What an unintuitive decision looks like when it hits all five

Rough sketch of the shape (not a locked scenario — illustration only):

> **The decision:** *"All primary CTAs use `<PrimaryButton>` from `@/components/buttons`. Never raw `<button>` elements for user actions. Decided 2026-01 after screen-reader audit flagged 14 unlabeled buttons."*
>
> **Vanilla Claude's output:** `<button className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded">Submit</button>`
>
> **Contract IDE's output:** `<PrimaryButton onClick={handleSubmit} loading={isLoading}>Submit</PrimaryButton>`

Both compile. Both render something clickable. **But the code diff is objectively different, and anyone doing PR review immediately sees which one followed team convention.** The substrate knew; the grep didn't.

This kind of scenario passes all five criteria:
- Verifiable (literally grep for `<PrimaryButton` vs. `<button`)
- Discoverable only in the substrate (the component exists but without the decision, an agent has no reason to prefer it over inline styling)
- Non-obvious (the sensible default is "write a button element with tailwind classes")
- Specific (exact component name)
- Visible (code diff; can also be visible in DevTools' element inspector)

## Candidate categories to explore when digging into the repo

Rough list, ordered by "likely to pass all five":

1. **Custom utility preference over generic.** Team wrote `fetchWithAuth()` / `formatCurrency()` / `logEvent()`; agent should use the utility. Verifiable by grep.
2. **Specific library among alternatives.** `@radix-ui/react-dialog` vs `react-modal` vs `@headlessui/dialog`. Verifiable by imports.
3. **Specific component composition.** Team has `<PrimaryButton>`, `<DangerButton>`, `<IconButton>`. Raw `<button>` is wrong for CTAs. Verifiable by component name.
4. **Specific numeric config.** Debounce 300ms, not 500ms. Cache TTL 60s, not 30s. Polling interval 5s, not 10s. Verifiable by value.
5. **Specific file / import path.** Strings go in `src/copy/*`; hooks go in `src/hooks/*`; never inlined. Verifiable by file location.
6. **Specific API endpoint version.** Use `/api/v2/*` not `/api/v1/*`. Verifiable by path.
7. **Specific error-handling pattern.** Always wrap in `Result<T, E>` / `try { ... } catch (err) { logger.error(...) }` — specific logger, specific shape. Verifiable by code shape.
8. **Specific a11y attribute.** All modal close buttons use `aria-label` from `i18n.t('close')`, never literal "Close". Verifiable in devtools.

Most of these are **about agent code-discipline**, not about UX polish. That's the right bias — code discipline is objectively verifiable; UX polish is taste-based.

## The exploration to run (fresh session)

Open the repo. Poke at it. Ask:

1. **What decisions already exist in the code that a first-time agent would NOT guess?** Custom utilities buried in `lib/`. Non-default library imports. Specific component conventions. These are gold — they're *already* in the codebase waiting to be surfaced as substrate decisions.
2. **What's a realistic task whose correct solution depends on one of those decisions?** Not "add a new feature" — something smaller and targeted. "Add a form to page X," "swap the button on Y," "add a toast notification."
3. **Can the wrong solution be written by a vanilla agent in a way that looks plausible?** You want the contrast to be stark — vanilla gets something reasonable-but-different, Contract IDE gets the team-convention answer.
4. **Can the substrate produce 3–5 decisions + constraints that all apply?** One decision is thin. A rich query that returns "use this utility, follow this component pattern, apply this convention" is the story.

## What this document is NOT

- Not a scenario commitment. All candidates above are illustrative; none are locked.
- Not a file-tree design. Repo structure follows scenario choice, not the other way.
- Not a session-scripts plan. Those come after scenario is locked.

## What resolves this

Single deliverable: **one committed scenario** that passes all five criteria, plus the specific list of 3–5 decisions/constraints the substrate must contain for it to work. Once those exist, everything else downstream (session scripts, repo structure, reset fixtures) has a concrete target.

Until then, `runbook-v2.md`, `live-scenario.md`, and `PITCH.md` all hold the brand-green-button example as a **placeholder** — accurate in structure, wrong in content.

---

*When this gets resolved, update all three downstream docs to reference the committed scenario; delete this file or convert it to a "how we picked" retrospective.*
