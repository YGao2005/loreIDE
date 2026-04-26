# Phase 13 UAT — 11 Success Criteria + DEMO-04

**Purpose:** Manual verification of all 11 Phase 13 success criteria + DEMO-04 reproducibility. Walks the demo arc end-to-end and asserts each SC is satisfied. Run after plan 13-11 fixture substitution + runbook rewrite; precedes filming.

**Status:** Pending. Run when Phase 14 (data realism) has landed and Phase 9 contract UUIDs are stable. Several SCs gate on upstream phases (BABEL-01, FLOW-01, BACKEND-FM-01, Phase 12 supersession, Phase 14 data realism) — note the dependency column on each SC.

## Setup (run once before walking the script)

1. `bash contract-ide/demo/reset-demo.sh` — verify <15s elapsed
2. App boots; `contract-ide-demo` repo open
3. SQLite seed loaded (substrate node count matches fixture)
4. Localhost dev server running for ScreenCard iframe
5. DemoOrchestrationPanel visible bottom-left (dev mode)
6. UUID substitution complete in `blast-radius.json` + `beat3-verifier.json` + `beat4-harvest.json`

---

## SC 1 — Cmd+P intent search

**Pass criteria:** Press Cmd+P → palette opens (no system Print dialog); typing "account settings danger" returns ranked hits with the AccountSettings.DangerZone atom or AccountSettings flow as top-1 ≥80% of the time across 10 ambient queries.

**Manual reproduction:**
1. From any canvas state, press `⌘P`.
2. Type `account settings danger`. Note top-1 hit.
3. Type `soft delete`. Note top-1 hit.
4. Run automated precision check: `cd contract-ide && npx vitest run cmdp-precision`.
5. Selecting a flow in palette → land at L2 chain view.
6. Selecting an atom → land at L3 with chip auto-focused (halo visible).

**Expected outcome:** Palette opens within 100ms. Top-1 precision ≥8/10 on the test fixture. Selection navigates correctly to L2 (flow) or L3 (atom + chip focus).

**Dependency notes:** Plan 13-03 (IntentPalette + `find_substrate_by_intent` IPC). Phase 11 retrieval quality affects precision; Phase 14 data realism affects ambient query coverage.

---

## SC 2 — ScreenCard with iframe + atom chip overlay

**Pass criteria:** AccountSettings flow chain shows live iframe of `/account/settings`; atom chips render at correct positions over iframe components; clicking the empty Danger Zone region resolves to the AccountSettings.DangerZone atom contract.

**Manual reproduction:**
1. Sidebar → click `flow-delete-account`.
2. Verify ScreenCard at top of chain shows live iframe (not a screenshot fallback).
3. Hover iframe → verify chips light up over Profile, Email Preferences, Notifications, Danger Zone.
4. Click the Danger Zone chip → Inspector opens with the atom contract.
5. Resize the canvas window → chip positions update with the iframe layout.

**Expected outcome:** Iframe renders the dev-server page within 500ms. Chips overlay with pixel-accurate positions. Click resolves through the `data-contract-uuid` chain to the right atom.

**Dependency notes:** Plan 13-05 (ScreenCard + chip overlay). **Phase 9 BABEL-01 is required for chip click resolution** — without it, clicking the chip falls back to a default-position chip and may resolve to the wrong (or no) atom. Phase 14 data realism affects iframe page content.

---

## SC 3 — ServiceCard structured rendering (Stripe-API-docs style)

**Pass criteria:** Service cards in the chain render method-colored badges, monospace method+path, and Inputs / Outputs / Side effects sections from contract frontmatter.

**Manual reproduction:**
1. With `flow-delete-account` chain open, scroll through service cards.
2. Verify `POST /api/account/delete` shows a green POST badge (or red DELETE badge for the delete route).
3. Verify Inputs / Outputs / Side effects sections render content (not "no schema declared" placeholders).
4. Verify atom chips beside each card show correct substrate-state coloring.
5. Inspect a card's source contract — verify rendered content matches frontmatter.

**Expected outcome:** Cards visually mirror Stripe API docs style. All sections populated from real contract data.

**Dependency notes:** Plan 13-04 (ServiceCard rendering). **Phase 9 BACKEND-FM-01 is required** — without it, sections show "no schema declared" placeholders and demo readability degrades.

---

## SC 4 — Vertical chain with edge labels

**Pass criteria:** Flow chain renders top-to-bottom in members order; 1 trigger card + ≥6 participant cards visible; edges carry call-shape labels matching `prev.Outputs → next.Inputs`; FPS ≥50 during pan.

**Manual reproduction:**
1. Open `flow-delete-account` flow.
2. Count cards: trigger (Account Settings iframe) + 6 participants minimum.
3. Inspect each edge — verify label like `{ userId, token }` matches the call-shape between participants.
4. Open Chrome DevTools Performance tab → record 5s of canvas pan → verify FPS ≥50.
5. With both `flow-delete-account` and `flow-delete-workspace` open, focus on workspace flow → verify account flow renders screenshot fallback (not iframe).

**Expected outcome:** Vertical chain layout deterministic; edge labels readable; pan smooth at 50fps.

**Dependency notes:** Plan 13-06 (FlowChainLayout + edge labels). **Phase 9 FLOW-01 (`members:` field)** required for chain assembly — without it, the chain doesn't render. **Phase 9 BACKEND-FM-01** required for edge labels to populate from frontmatter.

---

## SC 5 — Sidebar replacing L0/L1 lens switcher

**Pass criteria:** Sidebar shows area tree (NOT lens switcher); per-area badges show drift / rollup-stale / intent-drifted counts; areas expand to flows; clicking a flow drives canvas to its L2 view.

**Manual reproduction:**
1. Open the app — verify sidebar shows the area tree on left.
2. Verify NO lens switcher (L0/L1/L2/L3/L4 dropdown) is present anywhere in the UI.
3. Verify each area row shows badge counts (e.g., "3 drift, 1 stale").
4. Click an area → expands to show flows.
5. Click a flow → canvas navigates to L2 chain view.

**Expected outcome:** Sidebar is the sole navigation surface; lens switcher fully removed.

**Dependency notes:** Plan 13-02 (sidebar replacing lens switcher).

---

## SC 6 — Substrate-state coloring across new node types

**Pass criteria:** All 5 substrate states render with correct, distinguishable colors on cards/chips. Drift = red. Rollup-stale = amber. Intent-drifted = distinct orange (NOT amber). Superseded = muted orange. Precedence: red > orange > amber > gray.

**Manual reproduction:**
1. Open a flow with mixed substrate states (use seeded fixture or trigger states via DemoOrchestrationPanel).
2. Visually verify each color renders distinctly.
3. Photograph the canvas on a phone in bright light — verify orange (intent_drifted) is distinguishable from amber (rollup_stale).
4. Trigger a node with both drift and intent-drifted states — verify red wins.
5. Check ServiceCards, ScreenCard, atom chips — all node types apply the same coloring.

**Expected outcome:** All states visible and distinguishable; precedence rule respected.

**Dependency notes:** Plan 13-01 (CVA `intent_drifted` + `superseded` variants + `resolveNodeState` precedence compositor).

---

## SC 7 — Chat archaeology (≤5s)

**Pass criteria:** Click `[source]` citation pill on any substrate node → `SourceArchaeologyModal` opens within ≤500ms (well under 5s budget); verbatim quote renders inline; corresponding service card halos in canvas.

**Manual reproduction:**
1. Open Beat 3 verifier (DemoOrchestrationPanel "Beat 3: Verifier results").
2. Click any `[source]` citation in the intent summary sidebar.
3. Time modal open → verify ≤500ms perceived.
4. Verify modal body shows the verbatim quote (not empty — fixture must include `verbatim_quote` field).
5. Verify the cited ServiceCard in the chain has a halo while the modal is open.

**Expected outcome:** Click-to-readable in <500ms; verbatim quote populated; halo wired.

**Dependency notes:** Plan 13-07 (SourceArchaeologyModal + citation halo). Fixture `verbatim_quote` field must be populated (Pitfall 4 from 13-RESEARCH).

---

## SC 8 — PR-review intent-drift

**Pass criteria:** Cmd+Shift+P → PRReviewPanel slides in; pasting a sample diff + clicking Analyze highlights affected nodes orange (intent_drifted); explanation sidebar lists affected-by-participant in ≤30s readable form; Cancel restores highlights cleanly.

**Manual reproduction:**
1. Press `Cmd+Shift+P`.
2. Paste sample diff from `contract-ide/demo/fixtures/sample-pr.diff`.
3. Click Analyze.
4. Verify affected nodes pulse orange in canvas.
5. Read explanation sidebar — verify it lists affected nodes grouped by participant.
6. Click Cancel — verify highlights clear cleanly.

**Expected outcome:** PR-review mode toggles in/out cleanly; affected nodes highlight; explanation readable.

**Dependency notes:** Plan 13-08 (PRReviewPanel + Cmd+Shift+P binding). Phase 12 supersession provides `intent_drifted` semantics; absent Phase 12, the panel still renders highlights but the upstream flag may be stale.

---

## SC 9 — Mocked Sync animation

**Pass criteria:** Click Sync button → trigger card pulses first; service cards pulse in invocation order with 50ms stagger; pulse fades after ~1.5s; substrate state settles to fresh.

**Manual reproduction:**
1. Open `flow-delete-account` chain.
2. Click Sync button in canvas toolbar.
3. Verify trigger card (Account Settings iframe) pulses first.
4. Verify service cards pulse 50ms apart down the chain.
5. Verify pulse fades after ~1.5s.
6. Verify final substrate state is "fresh" (no lingering rings).

**Expected outcome:** Animation runs deterministically against `blast-radius.json` UUIDs.

**Dependency notes:** Plan 13-09 (SyncButton + `animateSyncBlastRadius` + `trigger_sync_animation` IPC). **Real Phase 9 UUIDs must be substituted into `blast-radius.json`** — placeholder UUIDs cause Pitfall 3 (animation fires against empty state).

---

## SC 10 — 4-beat reproducibility

**Pass criteria:** Reset script restores deterministic state in <15s; 4-beat walk-through completes in <4 minutes; 3 consecutive runs documented in `rehearsal-log.md` with zero blocking glitches in runs 2–3.

**Manual reproduction:**
1. `bash contract-ide/demo/reset-demo.sh` → time it.
2. Walk Beats 1–4 from `presentation-script.md` exactly.
3. Time each beat. Note any glitches.
4. Append to `rehearsal-log.md`.
5. Reset and repeat. Continue until 3 consecutive clean runs.

**Expected outcome:** Reset <15s every time; full demo <4 minutes; 3 consecutive clean runs achievable.

**Dependency notes:** Plan 13-10a (`reset-demo.sh` + SQLite seed) + plan 13-10b (DemoOrchestrationPanel). **DEMO-04 / Phase 14 data realism gate:** rehearsals deferred until Phase 14 lands and the demo repo's substrate matches what the seeded SQLite expects.

---

## SC 11 — Verifier with implicit-decisions group + promoted-rule badge

**Pass criteria:** Beat 3 verifier shows 6 ✓ honor rows + ℹ Implicit decisions group with exactly 3 rows (24h email-link / audit_log / async cleanup) + ⚠ orange flag halo on the SCREEN CARD (parent surface), not a service card. Beat 4 HarvestPanel shows 3 new rules; one carries `[⌃ promoted from implicit]` amber badge.

**Manual reproduction:**
1. Click DemoOrchestrationPanel "Beat 3: Verifier results".
2. Count honor rows → must equal 6.
3. Verify ℹ "Implicit decisions" group with exactly 3 specific rows.
4. Verify ⚠ orange-flag halo lands on the screen card (Account Settings), NOT a service card.
5. Click DemoOrchestrationPanel "Beat 4: Harvest panel".
6. Verify HarvestPanel shows 3 new rules.
7. Verify the third rule (or whichever has `promoted_from_implicit: true`) carries the `[⌃ promoted from implicit]` amber badge.

**Expected outcome:** Verifier output exact match to script § Beat 3; harvest output exact match to script § Beat 4 closing.

**Dependency notes:** Plan 13-09 (VerifierPanel + ImplicitDecisionsGroup + HarvestPanel + promoted badge). Plan 13-10b (DemoOrchestrationPanel triggers). **`beat3-verifier.json` `parentSurfaceUuid` must be the Account Settings screen-card UUID** (Phase 9-derived); otherwise the halo lands on the wrong node. Phase 12 supersession is the canonical source of the orange flag, but Beat 3 is STAGED via fixture so the engine does not need to be running for the demo.

---

## DEMO-04 — Per-beat acceptance criteria

For each beat, verify the acceptance criteria from `presentation-script.md` § Beat N. Each beat is acceptable when:

- **Beat 1:** Cmd+P → chip → Inspector → Delegate completes within ~35s with no glitches; chip click lands in the right atom (BABEL-01 dependency).
- **Beat 2:** Recorded video plays cleanly start to finish; rubric panel reads 5/0 ✓/✗.
- **Beat 3:** Sync animation, 6-line intent summary, citation halo, verifier with implicit-decisions group + orange flag on screen card, narrowing-note resolution all complete within ~70s.
- **Beat 4:** Workspace-delete prompt → flow chain renders → harvest panel shows 3 new rules with promoted badge within ~35s.

## Sign-off

- Run 1 timestamp: _____ Total: _____ Glitches: _____
- Run 2 timestamp: _____ Total: _____ Glitches: _____
- Run 3 timestamp: _____ Total: _____ Glitches: _____

- [ ] All 11 SCs verified
- [ ] 3 consecutive clean runs achieved
- [ ] No blockers remaining
- [ ] Phase 13 closed; ready for filming

**Note:** This UAT is the human-verification gate. It is intentionally NOT signed off in plan 13-11's partial run — sign-off requires UUID substitution + 3 rehearsals + Phase 14 data realism, all deferred. See plan-13-11 checkpoint for resume conditions.
