# 4-Minute Presentation Script — Contract IDE

**Runtime:** 4:00 — closed-loop demo across two physical laptops + one full-screen recorded segment
**Speakers:** **NT** = non-technical (PM persona, NT laptop) · **T** = technical (developer persona, T laptop)
**Staging:** two laptops on stage, **both visible simultaneously** on the projector (split-screen feed). NT laptop primary in Beat 1. Full-screen recording takes over for Beat 2. Both laptops back in frame for Beats 3–4 — T's laptop is the focus, but NT's laptop stays visible so the audience can see the partner's commit "live" before T pulls it. Speaker switching mirrors role switching between PM and developer.
**Scenario:** ✅ Locked 2026-04-24 — delete-account button (Account Settings page → workspace-delete on Beat 4). Full spec in `scenario-criteria.md` § Committed Scenario; investigation rationale in `SCENARIO-CANDIDATES.md`.
**Visual model:** ✅ Locked 2026-04-24 — vertical flow chain on canvas with rendered iframe trigger + structured backend cards. Full spec in `../CANVAS-PURPOSE.md`. The PM in Beat 1 clicks the rendered danger-zone region directly; the section-level UUID chain (`data-contract-uuid` ↔ `code_ranges`) guarantees the agent edit lands in that section.

---

## 0:00–0:15 — Hook

**ON SCREEN:** speakers in frame, both laptops on the table.

**NT:** "AI agents are powerful. They still hit real limits — they don't remember what your team has decided."

**T:** "Claude, Devin, Windsurf — every coding agent starts every task blind. CLAUDE.mds, Slack threads, architectural decisions — they don't have any of it. We built the substrate that fixes that. One closed loop. Two laptops. Watch."

---

## 0:15–0:50 — Beat 1: PM trigger (NT laptop primary)

**ON SCREEN:** projector cuts to NT's laptop. A support-ticket excerpt flashes on screen briefly:

> *Ticket #4471 — "I clicked Delete on my account last month and I just got charged again. Is anyone there? — Maya R."*

**NT:** "Real customer trigger. I'm a PM — I don't write code. I navigate by intent."

**ON SCREEN:** NT opens Contract IDE. Already in Copy Mode (PM default). Sidebar shows surfaces grouped by area; main canvas shows an empty state inviting Cmd+P. NT hits `⌘P`, types `account settings danger`. Three ranked hits surface (`AccountSettings.DangerZone`, `AccountSettings.Profile`, `Billing.PaymentMethod`). NT picks `AccountSettings.DangerZone`.

**NT:** "Cmd+P, semantic search by intent."

**ON SCREEN:** Canvas transitions to the L3 trigger view for the Account Settings page — a rendered iframe of `app/account/settings/page.tsx` running on localhost. Atom overlay chips are visible on each section (Profile, Email Preferences, Notifications, Danger Zone). The Danger Zone chip auto-focuses with a soft halo and shows ⚪ "empty — no atoms" since the Delete button doesn't exist yet.

**NT:** "Now I'm looking at the page Maya was on. The danger zone exists but the button doesn't yet — that's why her ticket languished in support. I click the section directly."

**ON SCREEN:** NT moves cursor over the iframe; chips light up on hover. NT clicks the Danger Zone chip directly. Inspector slides in from the right with the simplified Copy Mode editor (Inputs / Outputs / Invariants hidden — Given/When/Then primary). NT types Intent + Role + two Given/When/Then examples — schema-honest sectioned markdown:

```markdown
## Intent
The Account Settings page needs a way for a customer to delete
their own account without contacting support. Today, every delete
request is a manual ticket, and we have a backlog from the GDPR
and CCPA windows. The customer who started the latest thread
clicked "delete" once already, was charged the next month anyway,
and is unhappy.

## Role
A primary action at the bottom of the danger-zone section of the
Account Settings page.

## Examples
GIVEN a logged-in customer on the Account Settings page
WHEN they click Delete Account and confirm via the email link
THEN their account is marked for deletion with a 30-day grace window
  AND they are signed out

GIVEN a customer who clicked Delete Account by mistake
WHEN they don't click the email confirmation link within 24 hours
THEN nothing changes and their account remains fully active
```

**NT:** "Intent in product language. I never named a database, an API, or which Stripe call to make — that's the team's discipline, not my job. The `## Role` line — *primary action at the bottom of the danger-zone section* — tells the agent where to put the button. My click told the system *which contract*; the role tells it *where in the section*."

**ON SCREEN:** NT clicks the **`Delegate to agent`** button at the bottom of the Inspector. A small overlay appears briefly: *"Composing prompt: contract body + 5 substrate hits + L2 surface context..."* Then transitions to a `Sent to agent` status pill.

**NT:** "Delegate to agent. The system reads my contract atom, walks its position in the graph, pulls the constraints that apply, composes the agent's prompt — and dispatches. The agent never gets a vague request."

**ON SCREEN:** Inspector chat field stays open. NT types one follow-up line and hits enter:

> *"And per the design system — destructive primary actions use #FF0000, not a Tailwind red variant. Treat that as a team rule going forward."*

A subtle "Captured to substrate" chip appears next to the message — the distiller has read it as a portable team commitment.

**NT:** "One sentence stated as a team rule, not a personal aside. The substrate captures it the same way it captures any rule from a Claude Code session — and you'll see it carry forward this afternoon."

---

## 0:50–2:05 — Beat 2: Agent execution (full-screen recording)

**ON SCREEN:** projector cuts to a full-screen recording. Recording shows two panes throughout:

- **Left pane:** Contract IDE — the rendered Account Settings iframe stays visible at the top of the canvas; agent panel below shows substrate query streaming + execution
- **Right pane:** bare Claude Code in a terminal — same task, no substrate, no preview

A brief on-screen annotation appears at the top of the left pane for the first ~10 seconds:

> **Retrieval (graph-anchored, not text-fuzzy):**
> 1. Match `applies_when` against the contract's intent
> 2. Scope candidates via graph edges from the contract's lineage
> 3. Re-rank with LLM grounded on the contract body

**T:** [over recording, first 30s] "Here's what happens after the partner hit Delegate. This isn't fuzzy semantic search over chat history — that's what claude-mem and graphiti do, and it's what every judge will ask about first. Our retrieval is *contract-anchored*. The contract atom has a position in our graph hierarchy. We retrieve constraints whose `applies_when` field matches the contract's intent AND whose scope reaches this atom via graph edges. Then we re-rank with the LLM using the contract body as grounding. The agent gets the rules that apply to *this work* — not 'things that vaguely sound related.'"

**ON SCREEN:** left pane — five substrate hits stream in with provenance arrows back to source sessions:
- `dec-soft-delete-30day-grace-2026-02-18`
- `con-anonymize-not-delete-tax-held-2026-03-04`
- `con-stripe-customer-archive-2026-02-22`
- `con-mailing-list-suppress-not-delete-2026-03-11`
- `dec-confirm-via-email-link-2026-02-18`

All five trace back to the same February 2026 deletion-incident thread. Right pane — bare Claude greps the codebase, finds no specific delete pattern, follows sensible defaults.

**T:** [over recording, next ~25s] "Five substrate hits, all from one incident-response thread the team had two months ago — captured automatically from the team's Claude Code sessions via a PostToolUse hook. No one wrote a CLAUDE.md. Bare Claude on the right has none of that — greps, finds nothing specific, defaults to `db.user.delete()`. One line. Defensibly correct against the schema. Wrong against five rules the team got burned learning."

**ON SCREEN:** left — agent reads target file once, writes a 5-file change first try (settings page + API route + `beginAccountDeletion` lib + audit + mailing). **The iframe at the top of the left pane re-renders live: a Delete Account button appears in the danger-zone section, rendered in #FF0000 per the just-captured design-system rule, with the email-link confirmation modal wired up. Annotation `applied [6] design-system #FF0000` flashes inline as the agent writes the className.** Right — bare Claude writes the one-line `db.user.delete()` against the schema, no preview at all.

**ON SCREEN:** **rubric panel slides up across the bottom of the recording (persists ~10s)** — the team rules being checked against each agent's output:

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

Animation: rules pop in as the substrate query returns them; ✓/✗ marks fill in per agent as their code is written. Bare Claude ends 0/5; Contract IDE ends 5/5.

**ON SCREEN:** receipt comparison banner appears alongside the rubric, persists same ~10s:

> **Contract IDE: ~3 tool calls · ~30k context read · 5/5 rules honored**
> **Bare Claude: 10 tool calls · 661k context read · 1/5 rules honored\***
>
> <sub>\* rule 5 accidentally honored — bare Claude picked `confirmation="email-link"` from a 2-option TypeScript enum without team-rule reasoning. See `demo/baselines/README.md` for the full audit.</sub>

**T:** [over recording, last ~10s] "Receipts tell you how efficiently. The rubric tells you what specifically. Five rules the team learned by getting burned in February — every one of them invisible from the code. The substrate carries the team. And our side actually shows the working button — bare Claude shows you a one-line diff."

**ON SCREEN:** end of recording.

---

## 2:05–3:15 — Beat 3: Developer review (T laptop primary)

**ON SCREEN:** both laptops remain visible. NT's laptop shows the post-Delegate state from Beat 1. T's laptop comes into focus on the right — Contract IDE open at the L2 flow view for the delete-account flow. Vertical participant chain visible on the canvas top-to-bottom:

```
   [ ▒ Account Settings — rendered iframe with new Delete button ▒ ]
                          │
                          │  click → POST { confirmation_token }
                          ▼
   [ POST /api/account/delete ]
                          │  beginAccountDeletion({ userId, token })
                          ▼
   [ beginAccountDeletion — lib ]
                          │  { userId, deletedAt, graceEnd }
                          ▼
   [ db.user.update — data ]
                          │  { customerId }
                          ▼
   [ stripe.customers.update — external ]
                          │  { listId, email }
                          ▼
   [ mailchimp.suppress — external ]
                          │  { userId, gracePeriodEnds }
                          ▼
   [ sendDeletionConfirmationEmail — lib ]
```

The trigger card at top is the live iframe. The right sidebar has two tabs: **Inspector** and **Review**. The Review tab is selected and shows an empty state — "No incoming changes" with a primary **`Pull incoming changes`** button.

**T:** "Now I'm the engineer. My machine, on the right. My partner just pushed — let me pull."

**ON SCREEN:** T clicks **`Pull incoming changes`**. Brief spinner (~500ms — represents `git pull`; staging note: substrate is pre-loaded, the click hydrates from a fixture, AND `publish_pending_substrate` flips `published_at` from NULL → now() on the morning's PM-captured rule so it becomes retrievable on this laptop). Three things animate simultaneously:

- **Right sidebar:** Review tab populates with a PR-review-shaped surface, hydrated top-to-bottom (header → compact chain → honors → implicit decisions → harvested-from-upstream → flag). The harvested-from-upstream section carries one chip: `con-design-system-destructive-ff0000-2026-04-25` — *"Destructive primary actions use #FF0000 per the design system"* (captured during PM session this morning, just synced).
- **Main canvas:** blast-radius animation pulses through the chain — trigger card first (the new Delete button glows), then service cards in invocation order down the chain. The flow itself is the blast radius made visible.
- **Substrate panel** (bottom-left of canvas): "+1 from upstream" badge increments — visible confirmation that the rule wasn't here a moment ago.

**T:** "Pull. New rule from this morning's session lands first — design-system color for destructive actions, captured when the PM stated it. The review surface lands on the right; the chain on my canvas pulses top-to-bottom. Blast radius — visible. I'm not opening a diff file."

**ON SCREEN:** the Review tab settles. Header shows commit metadata (author: partner persona; message: *"Add Delete Account action to Settings danger zone"*; 5 files). Below the header, a **What rules were honored** section lists 6 ✓ rows, each with a `[source]` citation pill:

```
✓ Matches contract — Delete Account action in danger-zone section            [source]
✓ dec-soft-delete-30day-grace honored — deletedAt set, no hard delete         [source]
✓ con-anonymize-not-delete-tax-held honored — invoice updateMany present     [source]
✓ con-stripe-customer-archive honored — customers.update with metadata       [source]
✓ con-mailing-list-suppress-not-delete honored — mailchimp suppress call     [source]
✓ dec-confirm-via-email-link honored — sendDeletionConfirmationEmail call    [source]
```

T clicks `[source]` next to the Stripe-archive line. **The center pane opens Monaco** and scrolls to the `stripe.customers.update(... { metadata: { archived: 'true' }})` call in `lib/account/beginAccountDeletion.ts`. **Simultaneously the corresponding service card in the chain on the canvas gains a soft halo.** The Review sidebar stays anchored on the right — no popups, nothing replaced.

**T:** "Six rules honored, all from the same February incident thread. Click a citation — Monaco in the center, halo on the participant in the chain, review stays put on the right. Two clicks to investigate any decision."

**ON SCREEN:** T scrolls the Review tab to the next section: **Implicit decisions surfaced** — agent defaults that no team rule covered. Three rows, each with a freeform textarea labeled *"Verify with agent"*:

```
ℹ Email link expires in 24h — agent default                          [Verify with agent ▾]
ℹ Audit log written to `audit_log` table — inferred from schema      [Verify with agent ▾]
ℹ Cleanup runs as background job — from contract.role "primary"      [Verify with agent ▾]
```

T clicks the first row's textarea, types: *"show me where the agent set this and why."* Hits enter. The row expands inline; an agent response streams below the question (composed from the implicit-decision text + atom context + relevant code citations):

```
The 24-hour expiry is set in lib/account/beginAccountDeletion.ts:42 via
TOKEN_EXPIRY_HOURS = 24. No team rule covered link expiry, so the agent
chose 24h based on the contract's "30-day grace" framing — a confirmation
flow shorter than the grace window. Want me to derive a candidate rule
from this? [Promote to substrate]
```

**T:** "Implicit decisions are where most tools stop — they show you a list and walk away. Mine lets me interrogate any of them, inline. The agent answers with the code reference and its reasoning. That's verification — not just summary."

**ON SCREEN:** T scrolls to the bottom of the Review tab: **Needs attention** — one orange ⚠ row:

```
⚠ Parent surface (Account Settings) holds con-settings-no-modal-interrupts-2025-Q4
  ("no modal interrupts on user actions") — derived 2025-Q4 under priority
  `reduce-onboarding-friction`. Current priority since 2026-04-24 is
  `compliance-first`. The new modal interrupt may be intended; review.
```

**On the canvas, an orange halo lands on the Account Settings trigger card itself** — the parent surface where the conflicting constraint lives. The level of the conflict is visible at a glance.

**T:** "And there's one orange flag — halo's on the screen card, not a service. Parent-surface issue: no-modal-interrupts rule from Q4, made under the old reduce-friction priority. We shifted to compliance-first three weeks ago. Stale priority. Tests didn't catch it. CI didn't catch it. No fact-level memory tool can do this — they don't know what changed and when. This is the moat."

**ON SCREEN:** T clicks the flag. The row expands inline with priority history (Q4-2025 `reduce-onboarding-friction` → 2026-04-24 `compliance-first`) and a narrowing textarea. T types: *"Destructive actions require confirmation modals; the no-modal rule applies to non-destructive Settings interactions only. Narrowing the parent constraint."* Clicks Accept. Orange halo on the screen card clears. T clicks **Merge**. The Review tab collapses; canvas chain settles green.

**T:** "Scope narrowed. Note captured into the substrate. Merge."

---

## 3:15–3:50 — Beat 4: Closed loop (T laptop + brief recorded inset)

**ON SCREEN:** with the Beat 3 review merged, the Review tab on T's laptop returns to its empty state ("No incoming changes · `Pull incoming changes`"). A brief capture toast slides in over the canvas:

```
5 nodes captured from this session
  • AccountSettings.DangerZone contract atom
  • Reviewer note: "Destructive actions require confirmation
    modals; no-modal rule narrowed to non-destructive."
  • Scope refinement on con-settings-no-modal-interrupts-2025-Q4
  • Provenance: ticket #4471 (Maya R., GDPR/CCPA backlog)
  • Provenance: PR #1182 merge 2026-04-25
```

**NT:** "Everything from this morning is in the substrate. The contract atom, my reasoning, the reviewer's note, the customer ticket that started it."

**ON SCREEN:** new ticket flashes briefly:

> *Yesterday's ticket — Enterprise customer wants to delete their team workspace, not just their personal account.*

**NT:** "Different page. Different actor. Watch what the substrate does."

**ON SCREEN:** T opens a Claude Code terminal on their laptop. Types:

```
add a delete-workspace button to the team settings page
```

Substrate query streams. **All five incident rules from this morning surface again** — `dec-soft-delete-30day-grace`, `con-anonymize-not-delete-tax-held`, `con-stripe-customer-archive`, `con-mailing-list-suppress-not-delete`, `dec-confirm-via-email-link` — **plus** `con-design-system-destructive-ff0000-2026-04-25` (the rule that synced in moments ago when T hit Pull), plus the just-derived `AccountSettings.DangerZone` contract as a recent reference. Agent reads `app/team/[slug]/settings/page.tsx` once, writes a 5-file change first try (workspace-scoped deletion mirroring the morning's pattern; org invoices anonymized, workspace Stripe customer archived, member tokens revoked, owner-orphan check added). **The Delete Workspace button materializes in #FF0000 — exact hex, not a Tailwind variant — without anyone in this prompt asking for a color.** Receipt: **~2 tool calls · ~25k context read · 6/6 rules honored.**

**ON SCREEN:** the canvas updates — a new L2 flow renders for `Team Settings → Delete Workspace`, vertical chain similar to the morning's but with the workspace-scoped variations:

```
   [ ▒ Team Settings — rendered iframe with new Delete Workspace button ▒ ]
                          │
                          ▼
   [ POST /api/team/[slug]/delete ]
                          ▼
   [ beginWorkspaceDeletion — lib ]
                          ▼
   [ db.workspace.update — data ]
                          ▼
   [ stripe.customers.update ]    ← ghost-ref shared with morning's flow
                          ▼
   [ mailchimp.suppress ]         ← ghost-ref shared with morning's flow
                          ▼
   [ revokeAllMemberTokens — lib ]    ← NEW
                          ▼
   [ assertNotSoleOwner — lib ]       ← NEW
```

The two ghost-ref participants (`stripe.customers.update`, `mailchimp.suppress`) render with a faded outline and the morning's atom chips still attached — visually obvious that the same services are being reused. The two new lib cards (`revokeAllMemberTokens`, `assertNotSoleOwner`) render fresh.

**T:** "Agent finished. Same gesture — pull."

**ON SCREEN:** T clicks **`Pull incoming changes`** in the empty Review tab. The same review surface hydrates again on the right — second visit, fresh payload. Header shows the new commit (author: T's local agent run; message: *"Add Delete Workspace action to Team Settings"*; 5 files). Honors section lists **the same 5 rules cited again** from the morning's substrate, each with `[source]` pills. Then a new section appears: **New rules learned** — three harvested atom rows that animate into the sidebar AND drop chips onto the canvas participants they attach to:

```
+ con-cascade-revoke-tokens-on-org-delete-2026-04-25       →  attached to revokeAllMemberTokens
  "Revoke member access tokens immediately on org delete (don't
   wait for 30-day grace)."

+ dec-owner-orphan-check-2026-04-25                        →  attached to assertNotSoleOwner
  "Org delete requires solo-owner OR explicit ownership transfer."

+ dec-confirmation-timeout-24h-2026-04-25  [⌃ promoted]    →  attached to sendDeletionConfirmationEmail
  "Email confirmation links expire in 24h — agent default this morning,
   reviewer accepted, now a team rule."
```

**NT:** "Different surface. Same intent. The agent never re-discovered any of it. Stripe and Mailchimp show up as ghosts on the canvas — same services we taught it about this morning. The five morning rules cited again on the right. And three new rules harvested, each landing on the participant it lives on. And look — the button is red. Same hex I asked for once this morning. The substrate carried it. No CLAUDE.md edit, no design-system import, no second prompt."

**ON SCREEN:** ⏵ Brief recorded inset (8s, full-screen): bare Claude on the same prompt. Greps for `Workspace`, writes a `<DangerActionButton confirmation="modal">` that calls `fetch('/api/team/${slug}', { method: 'DELETE' })` against an endpoint that doesn't exist. Same shape of failure as this morning, on a new surface. Receipt: **15 tool calls · 743k context read · 0/5 rules honored.**

**T:** [over inset] "Vanilla on the same task. Starts blind. Same one-line wrong answer. The substrate compounds three different ways — rules cited, services reused, new rules harvested. Vanilla doesn't compound at all."

---

## 3:50–4:00 — Close

**ON SCREEN:** speakers back in frame. T's laptop held in background.

**T:** "Devin re-derives context every task. Windsurf re-reads your codebase every session. We're an MCP server — plug Devin, Windsurf, Cursor, any agent into our substrate. They inherit your team's reasoning instantly. No CLAUDE.md authoring. No session retraining."

**NT:** "GitHub stores your code. We store your reasons."

**NT:** "Happy to take questions."

---

## What's locked vs. open in this version

**Locked (everything below is canonical for production):**
- Two-laptop physical staging
- Hook + Beat 1 (NT laptop) + Beat 2 (recording) + Beat 3 (T laptop) + Beat 4 (T laptop + recorded inset) + Close
- **Visual model: vertical flow chain with rendered iframe trigger + structured backend cards** (locked 2026-04-24, see `../CANVAS-PURPOSE.md`)
- **Beat 1 interaction: Cmd+P entry → land at L3 trigger view (rendered iframe) → click danger-zone chip directly → simplified Copy Mode Inspector**. The click on the rendered region is the visceral moment; the section-level UUID chain (`data-contract-uuid` ↔ `code_ranges`) guarantees the agent edit lands in that section.
- `Delegate to agent` button as the Beat 1 → Beat 2 transition
- Beat 2 fully recorded (not live agent execution)
- Retrieval-mechanism narration content (graph-anchored, applies-when matching, LLM re-ranking)
- **Beat 2 visual addition: live iframe re-render on the IDE side as the agent completes** (Delete button materializes in the danger-zone section in real time during the recording)
- **Sync as `Pull incoming changes` button inside the Review sidebar tab's empty state** (represents `git pull`; mocked from fixture, real multi-machine sync deferred). No standalone Sync button on the canvas.
- **Beat 3 / Beat 4 review surface: right-sidebar Review tab** that hydrates with a PR-review-shaped layout (header → honors → implicit decisions → flag in Beat 3; header → honors → harvested rules in Beat 4). Replaces the prior `VerifierPanel` / `HarvestPanel` floating popups. Citations and "Where in code?" open Monaco in the center pane while the Review tab stays anchored on the right.
- **Beat 3 blast-radius animation on Pull: chain in the sidebar hydrates top-to-bottom AND service cards on the canvas pulse in invocation order**
- Two-clicks-to-investigate citation pattern: `[source]` opens Monaco in center + halos the participant on canvas; sidebar review stays put
- **Beat 3 implicit-decisions group includes per-row `Verify with agent` textareas** that expand inline with a streaming agent response (fixture-streamed for v1 determinism). This is the moment the audience sees verification *happen*, not just sees output.
- **Beat 3 orange-flag placement: halo lands on the screen card itself** (parent-surface conflict is visually obvious at the level it lives); flag row expands inline with priority history + narrowing textarea (no separate modal)
- **Beat 4 reuses the same Review tab** — second `Pull incoming changes` click hydrates the workspace-delete review with the 5 morning rules cited again + 3 newly harvested rules. Same surface, different payload — proves it's reusable, not a one-off.
- Devin/Windsurf complementary close
- **Scenario: delete-account → workspace-delete** (per `scenario-criteria.md` § Committed Scenario)
- **PM contract body** (Intent + Role + 2 Examples) — see Beat 1 above; the `## Role` line is what positions the button at the bottom of the section
- **5 substrate decisions** (`dec-soft-delete-30day-grace`, `con-anonymize-not-delete-tax-held`, `con-stripe-customer-archive`, `con-mailing-list-suppress-not-delete`, `dec-confirm-via-email-link`) — full schema in `scenario-criteria.md` § 6
- **On-screen rubric panel** (Beat 2, 5-row team-rules checklist with ✓/✗ columns)
- **Beat 4 prompt** (`add a delete-workspace button to the team settings page`) and harvest-back of 3 new rules — 2 code-derived (`con-cascade-revoke-tokens-on-org-delete-2026-04-25`, `dec-owner-orphan-check-2026-04-25`) + 1 promoted-from-implicit (`dec-confirmation-timeout-24h-2026-04-25`)
- **Beat 4 visual: shared services render as ghost-ref participants in the new flow chain; new atom chips animate onto the specific participant they live on** (not into a generic harvest panel)
- **Beat 3 implicit-decisions group** in verifier output — 3 hand-crafted rows (24h email-link expiry, `audit_log` destination, async cleanup) inserted between substrate honors and the orange flag, surfacing agent defaults that no team rule covered
- **Orange-flag fixture** (parent surface holds `con-settings-no-modal-interrupts-2025-Q4` under superseded `reduce-onboarding-friction` priority; current is `compliance-first` since 2026-04-24)
- **Design-system #FF0000 thread** — PM follow-up message in Beat 1 captures `con-design-system-destructive-ff0000-2026-04-25` via the live distiller (no fixture). The rule is written `published_at = NULL` until T's Pull click in Beat 3 fires `publish_pending_substrate`, flipping it to retrievable. Beat 4's workspace-delete agent receives the rule alongside the 5 incident rules and renders the new button in `#FF0000` exactly. The composer prompt's "exact values are exact" clause prevents Tailwind-variant substitution. Verification checklist in `.planning/demo/ff0000-thread-verification.md`.

**Open (production work, downstream):**
- Repo provisioning: `contract-ide-demo` fork with Auth + Prisma + Stripe + Mailchimp adapters; planted `DangerActionButton`; Account Settings + Team Settings scaffolds with danger-zone sections present (empty body, ready for the agent to fill)
- **Babel/SWC plugin in the demo repo** — injects `data-contract-uuid` from `.contracts/*.md` frontmatter onto matching JSX elements; enables the Beat 1 click-to-contract chain (Phase 9, see `../ROADMAP.md` Phase 9 SC additions)
- **Flow contracts** — the delete-account and delete-workspace flows are themselves seeded contracts with `members: [uuid, uuid, ...]` listing trigger + participants in invocation order (Phase 9 seed addition)
- **Backend frontmatter sections** — `## Inputs` / `## Outputs` / `## Side effects` populated on all backend participant contracts (renders as the structured-card body content)
- **Layout positions per flow** — vertical chain with explicit y-ordering for participants; call-shape edge labels render between them (rendered from each participant's `## Outputs` → next participant's `## Inputs`)
- Source-session script reproducing the Feb-2026 incident-thread that distills to the 5 substrate rules
- Reset-fixture SQLite snapshot containing the 5 rules + parent-surface constraint + priority-shift record + flow contracts + ~24 ambient atom contracts with JSX-aligned `code_ranges`
- Beat 4 staging: engineer-laptop preloaded substrate so harvest-back animates on cue

**Optional polish (slack permitting, not load-bearing):**
- Beat 3 bonus: T clicks the rendered Delete button on the iframe → atom inspector opens for the agent-derived button atom (showing the agent's auto-derived contract). Adds 5–8s; demonstrates the auto-rederive loop and gives "the agent's contract is itself reviewable" a visible moment. Cut if Beat 3 runs long.
- Inspect/Interact mode toggle visible in the canvas toolbar (default Inspect for Copy Mode; flip to Interact lets the user actually click through the rendered product). Shipping the toggle is cheap; using it on stage is optional.

---

## Q&A prep — predictable attacks

For each: lead with the **Punch** line. Expand with **Pushback** only if the judge presses.

### "The token A/B isn't fair — you pre-loaded substrate."
**Punch:** That's the architecture, not a setup trick. Substrate compounds across tasks; bare Claude starts fresh every time.
**Pushback:** Multiply this delta across 50 PRs/week per engineer. It's not a one-shot win — it's the difference between an agent that learns your team and one that doesn't. The savings are token-cost AND wall-clock.

### "Beat 2 is recorded. What's actually real?"
**Punch:** Beats 1, 3, and 4 are live on these laptops. Beat 2 is recorded only because agent runs aren't reliably 75 seconds on stage.
**Pushback:** The MCP server, contract atoms, graph-anchored retrieval, verifier — all running on this machine right now. Happy to run a fresh prompt against the substrate after the demo.

### "Where do the rules come from in real usage?"
**Punch:** A PostToolUse hook on Claude Code sessions. Every time an engineer course-corrects an agent — "no, soft-delete, don't hard-delete" — the hook captures the user message, the diff, the surface, and writes a candidate atom.
**Pushback:** Engineers approve candidates before they become enforceable rules. Existing CLAUDE.mds, ADRs, and design docs get ingested at bootstrap so day-0 isn't empty.

### "What's the ingestion period? Cold start before this is useful?"
**Punch:** Day 0 bootstraps from existing CLAUDE.mds, ADRs, design docs, and recent PR descriptions via importers. From there, 2–3 weeks of normal Claude Code use hits the density you saw on stage — passively, no extra authoring.
**Pushback:** The graph structure means sparse substrate is still valuable. A single constraint on a parent surface (like the priority-shift in Beat 3) protects every child screen and endpoint under it. You don't need 1000 rules — you need 10 well-scoped ones in the right places.

### "How is this different from claude-mem, graphiti, Cursor memory, OpenMemory?"
**Punch:** They store *facts* and retrieve via embedding similarity — "things that look related." We store *constraints with scope* and retrieve via graph anchoring + applies_when matching against the contract.
**Pushback:** Beat 3's parent-surface conflict catch is the proof. A fact store can't do that — they don't model surfaces, hierarchy, or which constraint applies where. They'd return "modal" as a fact and miss the priority-shift entirely.

### "What stops the substrate from filling with hallucinated rules?"
**Punch:** Every atom is reviewable before it becomes enforceable, with provenance back to the session that produced it. Beat 4's harvested atoms show this — source pointers attached, ready for review.
**Pushback:** The verifier's middle group — implicit decisions surfaced — exists exactly to catch agent assumptions that no rule covers, so engineers see and accept defaults instead of agents silently inventing.

### "Why would my team adopt this over Cursor's built-in memory or a richer CLAUDE.md?"
**Punch:** Cursor memory is per-user, per-machine, fuzzy. CLAUDE.md is monolithic — every prompt re-reads the whole thing. We're per-team, MCP-served, scope-anchored, retrieved precisely.
**Pushback:** Every agent your team adopts inherits the substrate — Claude Code, Devin, Windsurf, Cursor itself. One substrate, every agent. No per-tool authoring.
