# HANDOFF — Sync Review Surface (Product Reframe)

**Status:** Draft, ready for new-session pickup.
**Author context:** Phase 13 substrate-ui-demo-polish shipped 11/12 plans (13-11 docs done, rehearsal deferred). The build works but Beat 3 + Beat 4 are floating-panel demo theater. This handoff captures a product reframe agreed in the previous session — same demo arc, much more believable surface.

---

## The reframe in one sentence

**Sync isn't a button you click — it's a git-driven event that lands you on a PR-review-shaped surface where everything about the incoming change lives in one coherent view.**

Today's `Sync` button → `VerifierPanel` floating popup → `HarvestPanel` floating popup is three reveals. The new model is one surface that hydrates with everything an engineer would actually want to see when reviewing an agent-generated PR.

## Why now

Three things wrong with the current architecture, surfaced during rehearsal-prep:

1. **Floating panels feel like dev affordances, not product UI.** Even with the new `Sync` + `Verify against intent` buttons we just shipped (commits `e5aaf25`, `c02c3a0`), the underlying mental model is "click a button → a panel pops up." Real engineers don't review PRs that way.
2. **The demo doesn't show the verification loop.** Today the verifier output is a static fixture-load. The product claim is "the substrate carries the team's reasoning into the agent's work AND the verifier checks the agent honored it." Today the audience sees the panel but doesn't see the verification *happen*.
3. **The "implicit decisions" group is the most interesting moment but has no follow-through.** Today you see "ℹ Email link expires in 24h — agent default" and… that's it. There's no way for the engineer to interrogate "did the agent actually do this? Show me where." The surface ends there. That's where a "verify with agent" textarea unlocks the most value.

## What changes / what survives

| Today | New |
|-------|-----|
| `Sync` button (manual click → blast animation only) | Git-event-driven (synthetic / fixture in demo) — page mounts on incoming commit |
| `VerifierPanel` floating popup top-right | Section *inside* the review page |
| `HarvestPanel` floating popup bottom-right | Section *inside* the review page |
| `Verify against intent` button (loads fixture) | Removed — replaced by the page itself + per-implicit "verify with agent" textarea |
| `SyncBlastRadius` animation on button click | Plays on page entry as the first thing the engineer sees |
| `[source]` citation pills + `SourceArchaeologyModal` | **Unchanged** — keep as-is; surface as part of the new page |
| `useSubstrateStore` / `useGraphStore` / `useVerifierStore` / `useCitationStore` | **Unchanged** — page reads from existing stores |
| `loadAndApplyBeat3Verifier` / `triggerBeat4Harvest` IPCs | **Unchanged** — repurpose as page-hydration sources |
| `beat3-verifier.json` / `beat4-harvest.json` / `blast-radius.json` fixtures | **Unchanged** — extend with new fields if the new surface needs them |
| `DemoOrchestrationPanel` (dev panel, hidden in prod) | **Unchanged** — still useful for rehearsal; still hidden in prod via `import.meta.env.DEV` |
| Cmd+Shift+R reset hotkey | **Unchanged** |
| Beats 3 + 4 narrated as separate panel reveals | Beats 3 + 4 are two visits to the *same* surface — today's commit, tomorrow's commit |

About 60% of the 13-08 / 13-09 / 13-10 build is salvageable. The cosmetic shells get rewritten; the data + animation layers stay.

## The new surface spec (proposed; iterate)

A full-canvas PR-review surface that hydrates from a fixture payload representing "an incoming commit." Sections in render order:

### 1. Header (~10% vertical)
- Commit metadata: author (partner persona), commit message, files changed count, timestamp
- Visual treatment: looks like a polished PR header. NOT a popup with chrome.
- "Close" affordance (returns to canvas) — Cmd+W or visible button

### 2. Blast radius (~20% vertical)
- The vertical chain (FlowChainLayout, reused) renders compact at the top
- Plays the existing blast-radius animation on page mount (50ms stagger pulse down the chain)
- Trigger card highlights what's the entry point of the change
- This replaces the current "Sync button → animation on canvas" — the chain IS visible on the review page itself

### 3. What rules were honored (~25% vertical)
- The 6 ✓ honor rows from `beat3-verifier.json` (the substrate hits)
- Each row: rule name, rule body, `[source]` citation pill (clicking opens existing `SourceArchaeologyModal`)
- Each row also gets a **"Where in code?"** link → opens Monaco at the `code_ranges` of the cited code (this is partially built — the `[source]` modal has "Open in Monaco" already; reuse)

### 4. Implicit decisions surfaced (~25% vertical) — **the genuinely new piece**
- The 3 ℹ implicit-decision rows from `beat3-verifier.json` (24h email link, audit_log destination, async cleanup)
- Each row gets a **freeform textarea: "Verify with agent"** — placeholder text like "Ask: did the agent actually implement this? Show me where."
- Submitting the textarea opens an agent chat conversation, *pre-filled* with:
  - The implicit decision text
  - The substrate context (which atom this lives on)
  - The relevant code citations (parsed from the diff)
  - A leading question shaped from the user's input
- Agent's response renders inline in the page (or in a side chat panel — open question)
- This is the moment the audience SEES verification happen, not just sees output

### 5. New rules learned (~15% vertical)
- The 3 newly-harvested rules from `beat4-harvest.json` (2 code-derived + 1 promoted-from-implicit with `⌃` badge)
- Each row: rule body, `attached_to_uuid` participant link, "promoted from implicit" badge if applicable
- Visual: animates in with green halos on the chain (existing behavior, repurposed)

### 6. The flag (~5% vertical or floating)
- The single ⚠ orange-flag row from `beat3-verifier.json`
- Placed prominently — the page should make it visually obvious that one thing needs human attention
- Halo lands on the screen card in the chain (existing behavior — preserved)
- Click → existing constraint-narrowing flow (priority history modal, accept-narrowing, merge)

## How "Sync" hydrates the page (hardcoded, not live git)

Decision: **hardcode the demo flow, do not implement live git polling for v1.**

Reasons (from the previous session's conversation):
- Stage demos need determinism. Network, git auth, distillation timing (5–30s) all add failure surface without adding story value.
- The audience never sees a git command run. Whether the commit is real or fixture is invisible.
- Reset between takes (Cmd+Shift+R) is much simpler with fixtures.

**Mechanism for v1:**
- Sync button still exists but its onClick handler now dispatches: "open SyncReviewPage with payload from `sync-review.json`"
- New fixture: `contract-ide/demo/seeds/sync-review.json` aggregates everything the page needs (commit metadata + chain participants + verifier rows + implicit decisions + harvested rules + flag), or composes from existing 3 fixtures at load time
- `DemoOrchestrationPanel` gets a "Open Sync Review" button for rehearsal isolation (in addition to keeping existing Beat-3/Beat-4 buttons until they're proven dead)

**For Beat 4 (workspace-delete commit):**
- Second fixture: `sync-review-beat4.json` representing the next-morning commit
- DemoOrchestrationPanel gets a "Open Beat 4 Review" button
- Same surface, different payload — proves the surface is reusable, not a one-off

**Open question** (flag for Yang at start of new session): does Sync open a *new* page each time, or replace the contents of the existing page? Beat 3 → Beat 4 transition should probably be "close Beat 3 page → open Beat 4 page" (clean reset) rather than "Beat 4 contents replace Beat 3 in place" (visually muddy).

## "Verify with agent" — the genuinely new piece

This is where the previous build had no scaffold. Specifying carefully because it's load-bearing for the demo.

**User input:** Freeform textarea per implicit decision, e.g. "did the agent actually wait 24h before expiring the email link?" or "show me the audit_log write."

**System composition (when textarea is submitted):**
1. Build a prompt: implicit decision text + substrate atom context + code citations from the relevant participant in the chain + user's question
2. Send to existing agent chat infrastructure (Phase 11 wired this — `Delegate to agent` uses similar plumbing; check `contract-ide/src/store/agent.ts` and `contract-ide/src-tauri/src/agent/`)
3. Stream agent response

**Where the response renders:**
- Option A: inline in the page, in the same row as the implicit decision (collapses/expands)
- Option B: opens the existing chat panel side-by-side with the review page
- Option C: opens a modal overlay
- **Recommend A for demo flow** (everything in one viewport), but verify the chat infra supports it

**Demo-time behavior:**
- For the demo, Yang will type a specific pre-rehearsed question into the textarea
- The agent's response should be deterministic enough to demo — either real (if streaming is fast enough) or fixture-loaded (with delay simulation to look like streaming)
- **Open question for Yang:** real-streamed response, or fixture-streamed-with-fake-delay? Real is more impressive but adds latency risk. Fixture is more reliable. Lean fixture for first version.

## Script-first methodology

Before writing any code:

1. **Open `.planning/demo/presentation-script.md`** and rewrite Beats 3 + 4 to reflect the new surface. The script is the spec.
2. The narrative arc stays the same (5 substrate hits honored, 3 implicit decisions, 1 flag, then later 3 new rules harvested). The on-screen *actions* change.
3. Get the script reviewed by Yang before building.
4. THEN plan the build backwards from the new script.

Suggested new Beat 3 narrative shape:
- T's laptop. A subtle notification appears: "New commit from <partner>." T clicks Sync. Page opens.
- Chain renders at top with blast animation. T narrates "blast radius — visible."
- T scrolls to honors section. Reads "six rules honored, all from the February incident thread." Clicks one `[source]` for proof.
- T scrolls to implicit decisions. Stops on "Email link expires in 24h — agent default." Types in the textarea: "show me where the agent set this." Agent responds inline with the code citation + reasoning.
- T scrolls to flag. Narrates the priority shift. Clicks flag, narrows constraint, merges.

Suggested new Beat 4 narrative shape:
- Different morning. T types prompt in Claude Code terminal. Agent runs. Commit lands.
- New Sync notification. T clicks. New page opens with the workspace-delete commit's review.
- Same surface. Honors section: "all 5 morning rules cited again." Harvest section: "3 new rules learned, here's where they attached." T narrates "the substrate compounds."

## Salvage list (concrete file references)

**Reuse as-is:**
- `contract-ide/src/components/inspector/SourceArchaeologyModal.tsx` (citation modal — keep)
- `contract-ide/src/components/inspector/SubstrateCitation.tsx` (citation pill — keep)
- `contract-ide/src/store/citation.ts` (citation halo state — keep)
- `contract-ide/src/store/verifier.ts` (verifier results state — keep, repurpose)
- `contract-ide/src/store/substrate.ts` (substrate state — keep)
- `contract-ide/src/store/graph.ts` (focused atom + chain state — keep)
- `contract-ide/src/lib/syncBlastRadius.ts` (animation helper — call from page mount instead of button click)
- `contract-ide/src/lib/demoOrchestration.ts` (IPC wrappers — extend with `loadSyncReview()`)
- `contract-ide/src-tauri/src/commands/demo_orchestration.rs` (fixture-loading IPCs — extend with sync_review fixture)
- `contract-ide/src-tauri/src/commands/sync.rs` (blast-radius fixture loader — keep)
- `contract-ide/src/components/graph/FlowChainLayout.tsx` (chain renderer — render compact mode at page top)
- All 13-09 tests + 13-10 fixtures (keep)
- The two product-UI buttons we just shipped (`Sync` keeps function but rebinds onClick; `Verify against intent` becomes redundant — delete or repurpose)

**Repurpose as page sections:**
- `contract-ide/src/components/substrate/VerifierPanel.tsx` → split into `SyncReviewHonors`, `SyncReviewImplicit`, `SyncReviewFlag` sections
- `contract-ide/src/components/substrate/HarvestPanel.tsx` → `SyncReviewHarvest` section
- `contract-ide/src/components/substrate/ImplicitDecisionsGroup.tsx` → extend each row with the "verify with agent" textarea

**Build new:**
- `contract-ide/src/components/sync-review/SyncReviewPage.tsx` (the container)
- `contract-ide/src/components/sync-review/SyncReviewHeader.tsx`
- `contract-ide/src/components/sync-review/VerifyWithAgentTextarea.tsx`
- `contract-ide/src/components/sync-review/SyncReviewAgentResponse.tsx`
- `contract-ide/demo/seeds/sync-review.json` (Beat 3 fixture)
- `contract-ide/demo/seeds/sync-review-beat4.json` (Beat 4 fixture)
- New IPC `load_sync_review_fixture` in `demo_orchestration.rs`
- New TS wrapper `loadSyncReview(beat: 'beat3' | 'beat4')` in `demoOrchestration.ts`

**Delete (or comment-out and revisit):**
- `contract-ide/src/components/substrate/PRReviewPanel.tsx` (13-08 — superseded by SyncReviewPage)
- `contract-ide/src/components/substrate/PRReviewExplanation.tsx` (13-08 — superseded)
- `contract-ide/src/lib/diffToNodeMapper.ts` (13-08) — actually KEEP, may be needed for "Where in code?" links if you want them to highlight changed lines
- `analyze_pr_diff` IPC (13-08) — keep for now, may be reusable

## Demo data context

- **`contract-ide-demo` is already populated** at `/Users/yang/lahacks/contract-ide-demo/`. 56 contracts including:
  - `flow-delete-account.md`, `flow-delete-workspace.md` (the two demo flows)
  - Screen card uuid: `a0000000-0000-4000-8000-000000000000`
  - Other deterministic uuids: `a1/a2/a3/a4`, `b0/b1`, `f3010100`, `f4020101`, etc.
  - Babel plugin installed at `contract-uuid-plugin/`
- **JSON fixtures exist** at `contract-ide/demo/seeds/` with `<UUID-*>` placeholders. UUID substitution still needs to happen — agent in new session can map placeholders to real uuids by matching `name` + `kind` against `contract-ide-demo/.contracts/*.md` frontmatter.
- **Phase 14 is irrelevant** to this work. Phase 14 = Codebase-to-Contracts Bootstrap Skill demonstrated against Marginalia (a separate Yang-built micro-SaaS). Different demo, different repo. Do not let Phase 14 plans/files distract from this rework.

## Out of scope for this rework

- Beat 1 + Beat 2 of the demo (no changes — those flows are working and stay)
- Cmd+P intent palette (works, do not touch)
- Sidebar tree (works, do not touch)
- ScreenCard / ServiceCard / FlowChainLayout core rendering (do not touch — only call from the new page)
- Real git polling / live partner-commit detection (deferred to v3 polish; demo uses hardcoded fixtures)
- Babel plugin / `data-contract-uuid` annotation (Phase 9 deliverable in `contract-ide-demo`, not this rework)
- Phase 14 Marginalia bootstrap recording (separate demo asset)
- Phase 15 Substrate Trust Surface (separately scoped)
- The cmdp-precision ≥8/10 gate (still part of 13-11 rehearsal, separate from this rework)

## Open questions for Yang to answer at start of new session

1. **Page transition model:** Sync opens a new full-canvas page, OR the page is a modal overlay over the canvas? (Recommend: full-canvas page that you "exit" to return to canvas.)
2. **"Verify with agent" response location:** inline in the row, side panel, or modal? (Recommend: inline expanding section.)
3. **"Verify with agent" response source:** real streamed agent response, or fixture-streamed-with-fake-delay? (Recommend: fixture for v1 — deterministic for stage; real path can come later.)
4. **Beat 4 transition:** does Sync close the Beat 3 page first, then open Beat 4 with a fresh notification? Or is Beat 4 a "next commit" UI element on the same page? (Recommend: close + reopen — visually clean reset between morning/afternoon segments of the demo.)
5. **Sync button placement after rework:** still top-right of canvas, OR moved into a notifications area / toolbar? Currently it lives at top-right next to "Verify against intent." (Open — depends on what "the canvas" looks like after the page-not-popup model is established.)

## Suggested execution order in new session

1. **Open this handoff doc.** Read end-to-end. Surface any concerns.
2. **Yang answers the 5 open questions above.**
3. **Rewrite `presentation-script.md` Beats 3 + 4** to reflect the new surface. Get review.
4. **Plan the build backwards from the script** — formalize as Phase 13.1 (`/gsd:insert-phase`) or as a new Phase 16 — Yang's call.
5. **Build the surface** — start with the static page rendering all sections from a hand-crafted fixture payload, no animations. Get layout right first.
6. **Layer in interactivity** — citation halos, blast animation on mount, "verify with agent" textarea + agent response.
7. **Wire Sync button** to open the page from fixture.
8. **Smoke-test against `contract-ide-demo` real uuids** — substitute placeholders, run full flow.
9. **Rehearse 3x.** Adjust copy, timing, animations.
10. **Build production bundle, record.**

## Files to read first (new session)

In priority order:

1. **This handoff doc** (you are here)
2. `.planning/demo/presentation-script.md` — current Beat 3 + Beat 4 narration; what's being rewritten
3. `.planning/demo/runbook-v2.md` — implementation status per beat
4. `.planning/CANVAS-PURPOSE.md` — product mental model for the canvas (why surfaces matter)
5. `.planning/PITCH.md` and `.planning/VISION.md` — the thesis the demo is proving
6. `.planning/phases/13-substrate-ui-demo-polish/13-09-SUMMARY.md` — what currently exists for Beat 3 + Beat 4
7. `.planning/phases/13-substrate-ui-demo-polish/13-10b-SUMMARY.md` — orchestration IPCs and fixture loaders
8. `.planning/phases/13-substrate-ui-demo-polish/13-11-PLAN.md` — what 13-11 promised but couldn't finish (rehearsals deferred)
9. `contract-ide/src/components/substrate/VerifierPanel.tsx` and `HarvestPanel.tsx` — the panels being repurposed as page sections
10. `contract-ide/demo/seeds/beat3-verifier.json` and `beat4-harvest.json` — current fixture shapes

Do NOT read all 12 plan SUMMARYs end-to-end at session start — too much context. Pull them on-demand if a specific question arises.

## What success looks like

- A single PR-review surface that hydrates on Sync click from a hardcoded fixture
- All Beat 3 content lives inside this surface (no floating panels left)
- All Beat 4 content lives inside the same surface, second visit
- Engineer can interrogate any implicit decision via "verify with agent"
- Reset between takes via Cmd+Shift+R still works
- Production build hides DemoOrchestrationPanel; recording captures only product UI
- Three clean rehearsal runs of the new Beat 3 + Beat 4 → ready to record

---

**End of handoff.**

When the new session is ready: paste the contents of this file as the opening message, optionally prefixed with: *"Read this handoff and start with the open questions before doing anything else."*
