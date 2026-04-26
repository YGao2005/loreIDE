# Handoff — Demo Scenario Revision (Trigger-Fix Mismatch + Substrate Depth)

**Status:** Save-changes scenario is committed in `scenario-criteria.md` and threaded through `runbook-v2.md`, `presentation-script.md`, and `PITCH.md`. A foundation issue surfaced in the 2026-04-24 session: the customer-complaint trigger doesn't match the scope of the fix, and the substrate's contribution is too thin (one UI convention, ~3 decisions). This handoff captures the open decision before any further script work.

**Mode:** decision-only. No code, no roadmap, no further script edits until the trigger/scenario question is locked.

**Prior session context:** the closed-loop live demo design is locked (PM trigger → agent → developer review → harvest → future agent on different surface → close). What's open is *what scenario fills the loop*. See `presentation-script.md` for the current flow shape.

---

## The two issues identified

### Issue 1 — Trigger-fix mismatch

The current trigger is *"customer complaint: settings keep disappearing."* That implies a state-management bug — controlled inputs, dirty tracking, navigation guards, async persistence. **Adding a Save Changes button does not fix this.** Adding a Save button is what you do *after* the state-management is in place by design.

A judge who thinks for 10 seconds will notice the demo's fix doesn't address the demo's complaint. Trust erodes.

### Issue 2 — Substrate depth is thin

The substrate currently carries 3 decisions, all UI-flavored:
- `dec-cta-button-mandatory-2026-01-15`
- `con-cta-loading-prop-required`
- `con-no-inline-button-tailwind`

All three resolve to "use this button component instead of a raw `<button>`." The substrate's demo-visible contribution is *one UI convention*. A judge could reasonably think: *"This is what Storybook + a code linter does."*

The closed-loop payoff in Beat 4 (future agent on a different surface) suffers from the same thinness — what propagates is "use CTAButton on a publish button too." Not a substantive demonstration of substrate-as-team-memory.

---

## The two options on the table

### Option A — Keep save-changes scenario, fix the trigger to match

Replace *"customer complaint: settings keep disappearing"* with a trigger that resolves to "add a primary save action":
- *"Accessibility audit: settings page must have explicit save action with focus management."* (best — dovetails with `dec-cta-button-mandatory-2026-01-15`'s a11y-audit origin)
- *"Compliance: GDPR requires explicit user consent for state changes."* (less relatable)
- *"UX redesign: shift from auto-save to explicit-confirm across the app."* (product-shaped)

**Cost:** minimal — update trigger language in 3 docs (script, runbook, PITCH.md). Substrate stays as-is.
**Limit:** doesn't fix Issue 2. Substrate is still one UI convention.

### Option B — Change the scenario to "Add a refund button to the order page"

- **Trigger:** *"Customers calling support to request refunds — we need self-service."* Customer-driven, e-commerce-shaped, trigger maps cleanly to fix.
- **Substrate carries 4–5 non-obvious decisions:**
  - `<CTAButton>` for the action (UI convention, same as before)
  - Confirmation modal required (post-accidental-refund incident — invisible until you see the modal in the diff)
  - `Idempotency-Key` header on the POST (post-duplicate-refund incident — completely invisible from code patterns)
  - Routes to `/api/v2/refunds` (v1 deprecated for tax-compliance — natural fit for the Beat 3 orange flag)
  - Legal copy: *"processed in 5–7 business days"* (compliance requirement)
- **Vanilla loses in 4 dimensions, not 1.** Visible (no modal) + invisible-until-you-look (no idempotency, wrong endpoint, missing legal copy).
- **Closed-loop on Beat 4** becomes meaningful: future agent on *"add a cancel-subscription button"* inherits confirmation + idempotency + v2 API + legal copy. *Different surface, same operational discipline.*
- **Cost:** half-hour of doc updates across `scenario-criteria.md`, `runbook-v2.md`, `presentation-script.md`, `PITCH.md`, `live-scenario.md`. No code changes — seeded fixtures relocate to a refund/order surface in the same custom repo.

---

## Recommendation

**Option B.** Three reasons:

1. The trigger-fix alignment is honest — customer wants refund, agent ships refund flow. Whole.
2. Substrate carries depth, not surface — operational rules learned by getting burned, not button-component preferences. The differentiation against "Storybook + linter" lands.
3. Backend logic enters scope (idempotency, endpoint version) — addresses the "frontend-only is thin" concern raised in the prior session. The substrate's value becomes *"the rules nobody wrote down but everyone now follows"*, which is harder to dismiss than UI consistency.

The risk in Option B is scope of repo prep — the custom `contract-ide-demo` needs an order/refund surface plus the seeded substrate decisions. But the scenario-criteria.md repo plan was always *"fork a Next.js + shadcn dashboard starter"*, which already includes order/billing surfaces in most starter templates. Marginal additional work.

---

## Tertiary issue — PM-chat vs PM-contract differentiation

The contract-edit-as-prompt workflow gives three things chat doesn't: persistent substrate record, reviewable surface for engineer, hierarchy + supersession affordance. Currently this distinction is implied, not shown.

Possible fix during Beat 3: have the engineer click a *"show provenance"* affordance on the contract atom that surfaces the original PM session + the customer-complaint thread + the contract diff + downstream decisions, demonstrating that the contract is a queryable artifact and not an evaporating chat message. Lands the *"chat doesn't persist; contracts do"* claim visibly.

This is a script-level addition, not a scenario decision. Resolves after Option A vs B is locked.

---

## Decision needed in next session

1. **Lock Option A or Option B.** No further demo work proceeds until this is decided. The current `scenario-criteria.md` § Committed Scenario is the save-changes / Option A baseline; Option B requires a re-commit of that section.
2. **If Option B:** specify the 4–5 substrate decisions in their full form (id, text, applies_when, justification — same shape as the current `dec-cta-button-mandatory-2026-01-15`).
3. **If Option A:** pick which trigger reframe (a11y audit / GDPR / UX redesign) and update the script.

---

## Out of scope for this session

- Repo provisioning, source-session script, reset fixture (Phase 10 prep)
- Live-scenario.md update (resolves after scenario lock)
- Any changes to PITCH.md beyond the scenario block
- Re-litigating the closed-loop demo design (locked) or the speaker split (locked)
