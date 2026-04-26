# Handoff — Investigate Relatable Scenarios That Fit Our Schema

**Mode:** investigation + recommendation. No code, no script edits, no roadmap changes. Output is a scenario shortlist with one preferred candidate, fully specified, ready to commit.
**Prior context:** *not loaded* — everything below + the referenced docs is self-contained.

---

You're picking up a Contract IDE demo-design session. Prior sessions established:

- **Demo structure is locked** (4 minutes, two laptops, closed-loop live with one recorded segment in Beat 2). See `presentation-script.md`.
- **Scenario is open.** The previously-committed save-changes-button scenario was identified as having a *trigger-fix mismatch* (customer complaint about disappearing settings doesn't actually get fixed by adding a button) and *thin substrate value* (only 3 decisions, all "use this button component"). See `HANDOFF-demo-revision.md` for the full diagnosis and the Option A vs Option B framing.
- **The pitch positions the substrate as agent memory + harvest-first capture + intent-level supersession.** See `PITCH.md`. Demo must demonstrate at least the first two; the supersession moat lands inside Beat 3's verifier.

**Your job this session:** investigate the field of relatable scenarios that *also* fit our actual schema, present a shortlist of 3–5 with first-pass evaluation, recommend one, and fully specify it (prompt + contract body + substrate decisions + Beat 4 closed-loop task) so a future session can commit it directly into `scenario-criteria.md` § Committed Scenario.

## Read these in this order before generating candidates

1. **`HANDOFF-demo-revision.md`** — why the prior scenario was rejected; what *relatable* and *substrate-rich* mean for this demo
2. **`scenario-criteria.md`** — the five non-negotiable criteria + the eight candidate categories from the original lock session
3. **`presentation-script.md`** — the current locked structure; understand the load each beat puts on the scenario (especially Beat 2's "vanilla loses in 4+ visible dimensions" demand and Beat 4's "different surface, similar intent" demand)
4. **`VISION.md`** — the harvest-first thesis; what the substrate is *for*
5. **The schema** — read these specific files in order, no more:
   - `contract-ide/mcp-sidecar/src/tools/prompt-v2.ts` (the v2 derivation prompt — the canonical contract form)
   - `contract-ide/.contracts/22222222-2222-2222-2222-222222222222.md` (a real seeded contract — what the schema actually looks like in practice)
   - `contract-ide/src/ipc/types.ts` (the `ContractNode` + `ContractFrontmatter` shapes)

Do **not** read the wider planning dir, the research subdirs, or the phase plans. The five docs above are sufficient.

## Constraints the chosen scenario must satisfy

**The five from `scenario-criteria.md` (non-negotiable):**

1. **Verifiable correctness** — there is a specific right answer (lib, component, header, endpoint, value) a judge can check without taste
2. **Discoverable only in the substrate** — answer lives in a captured prior conversation, not in code patterns a fresh agent could grep out
3. **Non-obvious from code alone** — a thorough vanilla agent following sensible defaults still gets it wrong
4. **Specific, not generic** — exact identifiers, not "good UX"
5. **Visible on screen** — code diff, preview iframe, network panel, or rendered page

**Plus three additional constraints introduced in the demo-revision pass:**

6. **Trigger-fix alignment** — the customer/policy trigger must actually be *resolved* by the fix shown. *"Settings keep disappearing"* triggered an "add a save button" fix — a state-management bug fixed with a UI element. Rejected. Don't repeat.
7. **Substrate carries 4–5 decisions, not 1.** A mix of UI-visible and backend-invisible-until-you-look. Single-convention scenarios (only "use CTAButton") read as Storybook + linter to a sharp judge.
8. **Closed-loop fitness for Beat 4** — there's a *different surface, similar intent* future task that credibly inherits the captured substrate. Not just "same convention applied somewhere else" but "the high-level goal that drove this initial change is still load-bearing on the new task."

**Plus schema fit:**

- The PM-authored contract in Beat 1 lives cleanly in v2 sectioned-markdown form (Intent + Role + Examples minimum, with the PM writing only Intent + 1–2 Examples in product language; agent fills in Inputs/Outputs/Invariants from implementation post-hoc)
- The contract is L4 (atomic) with a sensible parent (L3 component or L2 surface) that already exists in the seeded repo
- The substrate decisions express cleanly as `{ id, text, applies_when, justification }` per the existing pattern (see the prior committed scenario in `scenario-criteria.md` for the shape)

## Starting candidate field (widen further if you find better)

These are *starting points*, not endorsements. Evaluate each against all 8+1 constraints. Rank, cut, replace as warranted.

1. **Refund button on order page** (Option B from `HANDOFF-demo-revision.md`).
   *Trigger:* customers calling support to refund. *Substrate:* CTAButton + confirmation modal + `Idempotency-Key` header + v2 endpoint + legal copy. *Beat 4:* cancel-subscription button.

2. **Export user data button (GDPR/CCPA)**.
   *Trigger:* compliance audit / user data-export request. *Substrate:* CTAButton + correct endpoint + async-poll pattern + audit-log entry + email-when-ready UX copy. *Beat 4:* delete-account button.

3. **Cancel subscription button**.
   *Trigger:* "users complaining they get charged after canceling." *Substrate:* CTAButton + retention-modal pattern + idempotent cancel + audit log + immediate-confirmation UX. *Beat 4:* downgrade-plan button.

4. **Verify email magic-link request**.
   *Trigger:* "spam accounts → require email verification before key actions." *Substrate:* CTAButton + correct rate-limit handling + token expiry + auth-event log + post-verification redirect. *Beat 4:* password-reset request button.

5. **Apply discount code on checkout**.
   *Trigger:* "promo codes failing silently / applying wrong discount." *Substrate:* CTAButton + idempotent application + server-side validation + audit + UX-confirmation copy. *Beat 4:* gift-card redemption button.

The hypothesis is that something in the e-commerce / SaaS-billing / privacy-compliance space hits all 8+1 constraints best because those domains naturally accumulate hard-won team decisions that don't show up in code patterns. Auth flows are second-strongest. UI-only scenarios (settings, preferences) are the weakest because the substrate value tends to collapse to "use this component."

Don't be afraid to introduce new candidates — these five are starting fuel.

## Deliverable

Write a single new file: **`.planning/demo/SCENARIO-CANDIDATES.md`**.

Required structure:

1. **Shortlist table** — 3–5 candidates (could be the five above, could be a different five), each with one-line trigger + one-line substrate-depth summary + one-line Beat 4 task + a fail/pass column for each of the 8+1 constraints. Quick visual ranking.
2. **Recommendation** — one candidate picked, with a paragraph of justification (why it beats the runners-up on which constraints).
3. **Full specification of the recommended candidate**, matching the shape of the prior committed scenario in `scenario-criteria.md`:
   - The PM's prompt (one line) AND the PM's contract body (the schema-honest sectioned-markdown they type into the Inspector — Intent + 1–2 Examples)
   - Vanilla wrong answer (file + line shape across the 4–5 dimensions vanilla loses)
   - Contract IDE right answer (file + line shape)
   - 4–5 substrate decisions in `{ id, text, applies_when, justification }` form, with the origin story (single coherent prior conversation that produced all of them)
   - The Beat 4 future-task prompt + why it credibly inherits the captured intent
   - The orange-flag fixture for Beat 3 (which substrate node is "stale under priority shift" — pick something natural to this domain, e.g., for a refund: legacy v1 endpoint deprecated under "compliance-first" priority)
4. **Open questions for the user** — anything where the candidate is strong but a domain-specific judgment call is needed (e.g., "should the legal copy be exactly 'processed in 5–7 business days' or company-specific?"). Keep this list short — don't dump every micro-decision.

## What's *out* of scope this session

- Editing `scenario-criteria.md` § Committed Scenario (the user commits this in the *next* session after reviewing the candidates doc)
- Editing `presentation-script.md`, `runbook-v2.md`, `live-scenario.md`, or `PITCH.md`
- Re-litigating the demo structure (locked) or the schema (locked)
- Phase 10/11/12/13 planning
- Repo provisioning / source-session scripting / reset fixtures (those follow scenario commit)
- Picking a specific OSS starter to fork (deferred — repo choice is downstream of scenario)

If you find yourself drafting any of the above, stop. The deliverable is one document with a recommendation. Everything else follows.

## Done when

A user reading `SCENARIO-CANDIDATES.md` cold can:

- See the shortlist + ranking in under 2 minutes
- Find the recommended candidate fully specified to the level where the next session could paste it into `scenario-criteria.md` § Committed Scenario with no further work
- Identify the 1–3 open questions that need user judgment before commit

If a user has to bounce out to the schema files or other planning docs to understand the recommendation, the spec isn't dense enough. Make it self-contained.

---

*Companion docs in `.planning/demo/`: `HANDOFF-scenario-lock.md` (the original scenario-lock handoff that produced the now-rejected save-changes scenario — for format reference + lessons-learned), `HANDOFF-demo-revision.md` (why we're re-investigating), `presentation-script.md` (the locked demo structure the chosen scenario must serve).*
