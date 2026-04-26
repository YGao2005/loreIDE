# Runbook v2 — 4-Beat Two-Laptop Demo

**Purpose:** Operational handbook for filming the locked 4-beat two-laptop demo per `.planning/demo/presentation-script.md`. This document is the rehearsal + filming reference; the script remains the canonical performance spec.

**Status:** Aligned with the 2026-04-24 visual model lock + scenario lock (delete-account → workspace-delete). Replaces the structurally-outdated v1 runbook that referenced an abstract zoom canvas + 3-beat recorded video.

**Cross-reference policy:** This runbook does NOT duplicate prose from `presentation-script.md`. Performance-detail questions (verbatim narration, on-screen text) → script. Operational questions (reset cadence, glitch playbook, fallback chain) → here.

---

## Pre-flight checklist (run BEFORE every recording attempt)

- [ ] `contract-ide-demo` repo at the locked commit (`git log --oneline -1` matches the demo-locked SHA)
- [ ] Both laptops on stage; projector tested switching between them
- [ ] Reset script executed cleanly within <15s (`bash contract-ide/demo/reset-demo.sh`)
- [ ] App boots; `Cmd+P` returns expected hits for "account settings danger" and "soft delete"
- [ ] Sidebar shows demo flows (`flow-delete-account`, `flow-delete-workspace` after Beat 4)
- [ ] DemoOrchestrationPanel visible bottom-left (dev mode, plan 13-10b)
- [ ] Localhost dev server (Next.js) reachable for ScreenCard iframe (Account Settings page renders the danger-zone scaffold)
- [ ] SQLite seed loaded (`substrate_nodes` count matches plan 13-10a fixture: ≥18 nodes including the 5 February rules + parent-surface constraint + ambient padding)
- [ ] `blast-radius.json` + `beat3-verifier.json` + `beat4-harvest.json` fixtures contain real Phase 9 UUIDs (no `<UUID-…>` placeholders) — see "UUID substitution" below

## Beat 1 — PM trigger (NT laptop, ~35s)

**Implementation status:** SHIPPED. Cmd+P intent search (plan 13-03), ScreenCard iframe + chip overlay (plan 13-05), simplified Copy Mode editor + Delegate-to-agent button surfaces (Phase 11 / plan 13-05 fallback for chip resolution).

**Steps (per `presentation-script.md` § Beat 1):**
1. Projector cuts to NT laptop; brief flash of ticket #4471.
2. NT presses `⌘P`, types `account settings danger` → ranked hits surface (target ≥80% top-1 per plan 13-03 precision fixture; degrades to "type fully and click hit" if top-1 misses).
3. NT picks `AccountSettings.DangerZone` → canvas transitions to L3 trigger view; Danger Zone chip auto-focuses with halo (plan 13-05 chip overlay using `focusedAtomUuid` from plan 13-03).
4. NT clicks the chip → Inspector opens with simplified Copy Mode editor.
5. NT types Intent + Role + Examples (verbatim from script — see § Beat 1).
6. NT clicks **Delegate to agent** → status pill: "Sent to agent."

**Demo orchestration:** None for Beat 1 — runs through normal app surfaces (Cmd+P → chip → inspector → delegate). The chip-resolution chain (`data-contract-uuid` ↔ Phase 9 BABEL-01) is the only dependency that can degrade.

**Glitch playbook:**
- Cmd+P top-1 misses → fall back to top-3 hit (still acceptable per script).
- Iframe shows "unreachable" → start dev server before next take; warm dev server before recording.
- Chip click does not resolve to atom (BABEL-01 missing) → fall back to clicking ServiceCard in the chain (Beat 3 surface) instead; truncates Beat 1's visceral moment.

## Beat 2 — Recorded comparison (~75s)

**Implementation status:** RECORDED — not live. Generate the recording before filming day per script § Beat 2. Beat 2 has zero in-app dependencies on filming day; the recording plays back through the projector.

**Steps:**
1. Projector cuts to full-screen recorded comparison: Contract IDE left vs bare Claude Code right.
2. Substrate query streams 5 hits (per script).
3. Both agents complete; rubric panel shows 5/0 ✓/✗.
4. Receipt banner: Contract IDE ~3 tool calls / ~30k context / 5/5 vs Bare 10 tool calls / 661k context / 1/5*.

**Demo orchestration:** N/A (recorded).

**Glitch playbook:** If recording fails to play, hold on the last frame of Beat 1 and narrate the comparison verbally. Acceptable only as last resort — the rubric is the strongest visual proof.

## Beat 3 — Developer review (T laptop, ~70s)

**Implementation status:** SHIPPED. FlowChainLayout (plan 13-06), Sync animation (plan 13-09), VerifierPanel + ImplicitDecisionsGroup + orange flag (plan 13-09), citation halo (plan 13-07), backend-frontmatter rendering for ServiceCard (plan 13-04), DemoOrchestrationPanel triggers for staged moments (plan 13-10b). Verifier output STAGED via `beat3-verifier.json` fixture (plan 13-10a) — real Phase 9 UUIDs substituted at rehearsal pre-flight.

**Steps (per script § Beat 3):**
1. Projector cuts to T laptop. FlowChainLayout already shows the delete-account vertical chain.
2. T clicks **Sync** in canvas toolbar (plan 13-09 SyncButton).
3. **DEMO ORCHESTRATION:** Sync triggers blast-radius animation — trigger card pulses, then service cards pulse 50ms apart down the chain (plan 13-09 `animateSyncBlastRadius` + plan 13-10a `blast-radius.json` UUIDs).
4. Sidebar renders 6-line intent summary with `[source]` citations (plan 13-07).
5. T clicks `[source]` on Stripe-archive line → `SourceArchaeologyModal` opens AND the corresponding ServiceCard halos (plan 13-07 citation-halo).
6. T clicks **Verify against intent** → **DEMO ORCHESTRATION:** click "Beat 3: Verifier results" in DemoOrchestrationPanel (plan 13-10b) → loads `beat3-verifier.json`.
7. VerifierPanel renders: 6 ✓ honor rows + ℹ Implicit decisions group (3 rows: 24h email-link, audit_log destination, async cleanup) + ⚠ orange flag.
8. Orange-flag halo lands on the **screen card** (Account Settings parent surface) — NOT a service card.
9. T clicks the flag → side panel opens with priority history (Q4-2025 `reduce-onboarding-friction` → 2026-04-24 `compliance-first`).
10. T types narrowing note + Accept + Merge. (Substrate write is staged for the demo; type real prose.)

**Demo orchestration:** Beat 3 has TWO orchestration moments — Sync click (real IPC + animation against fixture UUIDs) + DemoOrchestrationPanel "Beat 3: Verifier results" (loads JSON fixture via plan 13-10b IPC).

**Glitch playbook:**
- Sync animation fires against empty state (Pitfall 3) → UUID substitution missed in `blast-radius.json`. Re-run pre-flight; use DemoOrchestrationPanel "Sync animation" button as backup.
- Orange flag halos a service card instead of screen card → BUG. `parentSurfaceUuid` in `beat3-verifier.json` doesn't match the seeded Account Settings screen-card UUID. Re-substitute and reload.
- Verifier doesn't appear → click "Beat 3: Verifier results" again; if still nothing, console for fixture-load error (plan 13-10b IPC).
- Citation halo doesn't fire on `[source]` click → ServiceCard UUID mismatch with citation `participantUuid` field.

## Beat 4 — Closed loop (T laptop + recorded inset, ~35s)

**Implementation status:** SHIPPED. HarvestPanel (plan 13-09), promoted-from-implicit badge (plan 13-09), workspace-delete flow chain rendering (Phase 9 FLOW-01 dependency). Recorded inset filmed separately. Harvest moment STAGED via `beat4-harvest.json` fixture (plan 13-10a) + DemoOrchestrationPanel button (plan 13-10b).

**Steps (per script § Beat 4):**
1. Notification slides in: "5 nodes captured from this session..."
2. New ticket flashes (workspace-delete enterprise customer).
3. T types prompt in Claude Code terminal: `add a delete-workspace button to the team settings page`.
4. (RECORDED INSET runs concurrently in adjacent window: bare Claude failing on same prompt.)
5. Substrate query streams; agent writes 5-file change first try.
6. Canvas updates: `flow-delete-workspace` chain renders (vertical chain with workspace-scoped variations, ghost-ref participants for `stripe.customers.update` + `mailchimp.suppress`).
7. **DEMO ORCHESTRATION:** Click "Beat 4: Harvest panel" in DemoOrchestrationPanel → emits `substrate:nodes-added` event with 3 new rules (plan 13-10b loader → plan 13-09 HarvestPanel listener).
8. HarvestPanel slides in bottom-right with 3 entries; the third carries `[⌃ promoted from implicit]` badge.

**Demo orchestration:** Beat 4 has ONE orchestration moment — DemoOrchestrationPanel "Beat 4: Harvest panel" trigger.

**Glitch playbook:**
- Workspace-delete flow chain doesn't render → Phase 9 `flow-delete-workspace` contract missing or `members:` field empty. Degrade: T narrates the comparison while pointing at the morning's chain.
- HarvestPanel doesn't appear → click "Beat 4: Harvest panel" button again; 2s poll fallback in plan 13-09 should catch it.
- Promoted badge missing on third entry → `beat4-harvest.json` third entry must have `promoted_from_implicit: true`.
- Ghost-ref participants render as solid (not faded) → Phase 9 FLOW-01 `members:` field doesn't mark cross-flow shared participants. Cosmetic; keep filming.

## Close (~10s)

**Implementation status:** N/A — speakers in frame.

---

## Fallback beat map (per `13-RESEARCH.md` Risk 5)

If specific upstream phases are missing or broken at film time, what beats still work? This table is the production-day decision matrix when something is broken.

| Missing | Beat 1 | Beat 2 | Beat 3 | Beat 4 | Notes |
|---|---|---|---|---|---|
| Phase 9 BABEL-01 (`data-contract-uuid` injection) | DEGRADED | OK (recorded) | OK | OK | Beat 1 chip click doesn't resolve to atom — degrade by clicking the ServiceCard in the chain instead. Loses the visceral "click the rendered region" moment but preserves narrative. |
| Phase 9 BACKEND-FM-01 (Inputs/Outputs/Side-effects frontmatter) | OK | OK (recorded) | DEGRADED | DEGRADED | ServiceCards show "no schema declared" placeholders. Demo readability suffers; structurally still works. |
| Phase 9 FLOW-01 (`flow-delete-{account,workspace}` `members:`) | DEGRADED | OK (recorded) | BROKEN | BROKEN | Flow chains can't assemble. Worst-case fallback: pre-record Beats 3 and 4 against a working laptop and play recordings. |
| Phase 11 distiller / retrieval | DEGRADED | OK (recorded) | OK (Sync STAGED) | OK | Cmd+P precision drops below 80%; type fully and click. Substrate is hand-seeded so retrieval still works against the fixture. |
| Phase 12 supersession engine | OK | OK (recorded) | OK | OK | Beat 3 orange flag is STAGED via `beat3-verifier.json`; works regardless of engine state. |
| Phase 10 session watcher | OK | OK (recorded) | OK | OK (STAGED) | Beat 4 harvest panel is STAGED via DemoOrchestrationPanel button. Live capture is decorative; substrate is pre-loaded. |
| Phase 14 data realism (live demo repo state) | DEGRADED | OK (recorded) | DEGRADED | DEGRADED | If the seeded SQLite + repo are out of sync, expect chip / chain / fixture mismatches. Block filming until Phase 14 lands. |

**Multiple-failure worst case:** If multiple upstream phases are missing simultaneously, all four beats can still demonstrate via DemoOrchestrationPanel staging — the script gracefully degrades to a "scripted demo" rather than a "live demo," visually identical on camera.

---

## UUID substitution (deferred until Phase 14)

Three fixture files contain placeholder UUID tokens that must be substituted with real Phase 9 contract UUIDs before rehearsal:

- `contract-ide/demo/seeds/blast-radius.json` — trigger UUID + 6 service-card UUIDs
- `contract-ide/demo/seeds/beat3-verifier.json` — `parentSurfaceUuid` (Account Settings screen card)
- `contract-ide/demo/seeds/beat4-harvest.json` — 3 participant UUIDs (revokeAllMemberTokens, assertNotSoleOwner, sendDeletionConfirmationEmail)

**Discovery procedure (run from `contract-ide-demo` repo root once Phase 9 contracts are stable):**

```bash
# List all seeded contract UUIDs:
grep -rh "^uuid:" .contracts/ | awk '{print $2}'

# Match by reading each contract's `name:` and `kind:` fields, then
# edit the JSON files in contract-ide/demo/seeds/.
```

**Verification:**

```bash
grep -c '<UUID-' contract-ide/demo/seeds/blast-radius.json   # expect 0
grep -c '<UUID-' contract-ide/demo/seeds/beat3-verifier.json # expect 0
grep -c '<UUID-' contract-ide/demo/seeds/beat4-harvest.json  # expect 0
```

This step is deferred from plan 13-11 until Phase 14 (data realism) ships and the demo repo's contract UUIDs are stable. See `.planning/phases/13-substrate-ui-demo-polish/13-11-SUMMARY.md` (when finalized) and the plan-13-11 checkpoint return for resume conditions.

---

## Filming-day routine

1. **2h before:** Reset script run cleanly 3 times in a row. Log to `rehearsal-log.md`. ZERO red flags allowed before filming.
2. **30m before:** Both laptops on table; projector tested; both running `npm run tauri dev` OR the `.app` bundle.
3. **5m before:** Final reset on each laptop; verify Cmd+P precision query.
4. **Take 1:** Run full script. Glitch → log → reset for take 2.
5. **Up to 5 takes:** Pick best in post.

## Recording-day decisions matrix

| Glitch severity | Decision |
|---|---|
| Tiny visual glitch (<1s, off-camera) | Continue take |
| Moderate (1–3s, on-camera but recoverable) | Continue, may use in post |
| Major (>3s, breaks narrative) | Cut, reset, redo |
| Demo-orchestration button missed (Beat 3 verifier or Beat 4 harvest) | Cut, reset (no good way to recover live) |
| Sync animation fires on empty state | Cut, fix UUID substitution, reset |

## Out of scope

- Audio mixing, lower-third graphics, post-production: filming-team responsibility
- B-roll: covered by `scenario-criteria.md` if needed
- Pitch slides: separate deck, owned by `.planning/PITCH.md`

---

*Runbook revised 2026-04-25 (Phase 13 plan 11 — partial). UUID substitution + 3-rehearsal log entries deferred until Phase 14 lands. See `presentation-script.md` for canonical performance prose; this runbook is the operational handbook.*
