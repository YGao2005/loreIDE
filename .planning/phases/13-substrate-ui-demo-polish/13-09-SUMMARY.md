---
phase: 13-substrate-ui-demo-polish
plan: 09
subsystem: ui
tags: [tauri-ipc, zustand, citation-halo, demo-staging, beat3, beat4, mocked-sync]

# Dependency graph
requires:
  - phase: 13-substrate-ui-demo-polish
    provides: useSubstrateStore.nodeStates Map + setNodeState/clearNodeState (plan 13-01) — semantic state surface that blast-radius animation settles into
  - phase: 13-substrate-ui-demo-polish
    provides: useCitationStore.highlight (plan 13-07) — transient halo primitive reused for sync pulse + verifier orange flag
  - phase: 13-substrate-ui-demo-polish
    provides: FlowChainLayout vertical chain (plan 13-06) — visual surface the staggered pulse propagates down
  - phase: 13-substrate-ui-demo-polish
    provides: SubstrateCitation + SourceArchaeologyModal (plan 13-07) — citation pills inside VerifierPanel honor rows
provides:
  - SyncButton — mocked-sync affordance (top-right z-30 in AppShell); click invokes trigger_sync_animation IPC and runs animateSyncBlastRadius across the pre-known affected uuids
  - animateSyncBlastRadius(orderedUuids, finalState='fresh', staggerMs=50) — stagger helper that pulses citation halos and persists substrate state at the same time; first uuid is trigger, subsequent are participants in chain order
  - DEFAULT_BLAST_STAGGER_MS + BLAST_PULSE_DURATION_MS exported from src/lib/syncBlastRadius.ts — animation pacing constants for 13-11 rehearsal tuning
  - trigger_sync_animation Rust IPC — returns SyncTriggerResult { trigger_uuid, participant_uuids } with PLACEHOLDER uuids today (uuid-account-settings-screen + 5 service participants); 13-10b will extend sync.rs to read blast-radius.json and replace placeholders with real Phase 9 uuids while preserving response shape
  - VerifierPanel (top-right top-16 z-30) — Beat 3 stream rendering ✓ honor rows, ℹ ImplicitDecisionsGroup, ⚠ orange flag with 8s halo on parent screen card via useCitationStore.highlight
  - ImplicitDecisionsGroup — ℹ row group rendering 3 hand-crafted implicit-decision rows (24h email-link / audit_log / async cleanup per script Beat 3)
  - HarvestPanel (bottom-right z-40) — Beat 4 notification subscribed to substrate:nodes-added Tauri event with 2s polling fallback against list_recent_substrate_additions (silently swallows IPC-not-found per 13-RESEARCH.md Open Question 3); renders harvested rules with [⌃ promoted from implicit] amber badge for promoted_from_implicit nodes
  - useVerifierStore — zustand store with VerifierRow[] + ImplicitDecisionRow[] + setResults/clear/setOpen
  - loadBeat3VerifierResults(parentSurfaceUuid) — exposed via window.__demo (defined in src/lib/demoOrchestration.ts); 13-10b's loadAndApplyBeat3Verifier calls this after reading beat3-verifier.json; takes parent surface (screen card) uuid for orange flag halo placement
affects:
  - 13-10a (data layer — beat3-verifier.json + beat4-harvest.json + blast-radius.json fixtures will load real Phase 9 uuids that the panels render)
  - 13-10b (UI orchestration — DemoOrchestrationPanel triggers Beat 3 + Beat 4; extends sync.rs to read blast-radius.json; calls window.__demo.loadBeat3VerifierResults; emits substrate:nodes-added via emit_beat4_harvest IPC)
  - 13-11 (rehearsal — DEFAULT_BLAST_STAGGER_MS and BLAST_PULSE_DURATION_MS available to tune if camera-readability flags 50ms as too fast)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Citation halo as universal pulse primitive — SyncButton's blast-radius reuses useCitationStore.highlight rather than introducing a separate CVA pulse, keeping demo visual vocabulary unified across plan 13-07 (citation), 13-09 (sync wave), and 13-09 (verifier flag)"
    - "Stagger via setTimeout + persist substrate state simultaneously — citation halo handles the visual transient (1500ms ring), substrate state setter handles the post-pulse semantic settling. Promise resolves after (n-1)*stagger + pulse duration so demo orchestration can sequence subsequent beats"
    - "Dual-channel substrate-event consumption — Tauri event listener (primary, fires when Phase 10 watcher emits) + 2s setInterval polling against list_recent_substrate_additions IPC (fallback, silently swallows IPC-not-found via try/catch). Mirrors 13-RESEARCH.md Open Question 3 graceful-degradation guidance"
    - "Demo orchestration namespace via window.__demo — debug helpers (loadBeat3VerifierResults) attached to a single global object so 13-10b's DemoOrchestrationPanel + DevTools both have a stable call site without cluttering the global namespace"
    - "Placeholder-uuid Rust IPC with stable response shape — trigger_sync_animation returns hardcoded uuid strings today; 13-10b extends the function body to read blast-radius.json without changing SyncTriggerResult { trigger_uuid: String, participant_uuids: Vec<String> }, so SyncButton wiring requires zero changes downstream"

key-files:
  created:
    - "contract-ide/src/components/substrate/SyncButton.tsx"
    - "contract-ide/src/lib/syncBlastRadius.ts (animateSyncBlastRadius + DEFAULT_BLAST_STAGGER_MS + BLAST_PULSE_DURATION_MS)"
    - "contract-ide/src-tauri/src/commands/sync.rs (trigger_sync_animation IPC + SyncTriggerResult)"
    - "contract-ide/src/store/verifier.ts (useVerifierStore)"
    - "contract-ide/src/components/substrate/VerifierPanel.tsx"
    - "contract-ide/src/components/substrate/ImplicitDecisionsGroup.tsx"
    - "contract-ide/src/components/substrate/HarvestPanel.tsx"
    - "contract-ide/src/lib/demoOrchestration.ts (loadBeat3VerifierResults + window.__demo wiring)"
  modified:
    - "contract-ide/src-tauri/src/commands/mod.rs (registered sync module)"
    - "contract-ide/src-tauri/src/lib.rs (appended trigger_sync_animation to generate_handler! AFTER 13-08's analyze_pr_diff per Wave 4 serialization)"
    - "contract-ide/src/components/layout/AppShell.tsx (mounted SyncButton top-right z-30, VerifierPanel top-right top-16, HarvestPanel bottom-right z-40 alongside 13-08's PRReviewPanel)"

key-decisions:
  - "Visual verification deferred to plan 13-10b — natural test surface via DemoOrchestrationPanel + fixture-loaded uuids from 13-10a"
  - "Wave 4 serialization compliance — trigger_sync_animation appended to lib.rs generate_handler! AFTER 13-08's analyze_pr_diff in its own commit"
  - "Citation halo over custom CVA for pulse — DRY against plan 13-07 halo wiring; pulse looks visually identical to citation halos across the canvas"
  - "Placeholder uuids in Rust IPC today, fixture read in 13-10b — preserve SyncTriggerResult shape so SyncButton wiring is untouched when fixtures land"
  - "window.__demo namespace for demo helpers — loadBeat3VerifierResults attached to single global object; 13-10b + DevTools share stable call site"
  - "HarvestPanel dual-channel subscription — Tauri event primary + 2s poll fallback with silent IPC-not-found swallow per 13-RESEARCH.md Open Question 3 graceful-degradation guidance"
  - "Orange flag halo lands on SCREEN CARD parent surface (not service card) per script Beat 3 + SC 6 — 8s halo duration to draw demo attention; halo uuid passed in via parentSurfaceUuid arg to loadBeat3VerifierResults"

patterns-established:
  - "Demo-orchestration debug surface — src/lib/demoOrchestration.ts owns named functions attached to window.__demo; DevTools-callable for ad-hoc verification, importable from 13-10b's DemoOrchestrationPanel for production demo flow"
  - "Stable Rust IPC response shape across staging → fixture transition — define struct + return shape on first ship with placeholder data; later plan extends body to read fixture without touching consumers"

requirements-completed: []  # SUB-09 progress only — full completion gates on 13-10b real-fixture verification per user direction

# Metrics
duration: ~12 min (Tasks 1+2 prior session) + docs finalization this run
completed: 2026-04-25
---

# Phase 13 Plan 09: Sync + Verifier + Harvest Panels Summary

**Three Beat 3 / Beat 4 demo-stage UI elements shipped — SyncButton with 50ms-staggered citation-halo blast radius via trigger_sync_animation IPC, VerifierPanel rendering 6 honors + ImplicitDecisionsGroup of 3 implicit decisions + 1 orange flag with 8s halo on parent screen card, HarvestPanel with dual-channel substrate:nodes-added subscription + 2s poll fallback rendering [⌃ promoted from implicit] amber badge — visual verification deferred to plan 13-10b's natural fixture-loaded test surface.**

## Performance

- **Duration:** ~12 min for Tasks 1+2 (prior session); documentation-only finalization this run
- **Tasks:** 2 implementation + 1 checkpoint (deferred to 13-10b)
- **Files created:** 8
- **Files modified:** 3

## Accomplishments

- **SyncButton + animateSyncBlastRadius + trigger_sync_animation IPC** — top-right z-30 button; click invokes Rust IPC, receives placeholder uuids (trigger + 5 participants), runs animateSyncBlastRadius with 50ms stagger; each pulse fires citation halo (1500ms) + persists substrate state to `fresh` at the same instant. DEFAULT_BLAST_STAGGER_MS and BLAST_PULSE_DURATION_MS exported for 13-11 rehearsal pacing.
- **VerifierPanel + ImplicitDecisionsGroup + HarvestPanel + verifier store + window.__demo + loadBeat3VerifierResults** — VerifierPanel renders 6 ✓ honor rows (with SubstrateCitation pills opening SourceArchaeologyModal from plan 13-07), ℹ ImplicitDecisionsGroup of 3 hand-crafted rows (24h email-link / audit_log / async cleanup), ⚠ orange flag with 8s halo on parentSurfaceUuid passed via loadBeat3VerifierResults. HarvestPanel subscribes to substrate:nodes-added Tauri event + 2s setInterval polling against list_recent_substrate_additions (graceful try/catch swallow if IPC absent); renders harvested rules with [⌃ promoted from implicit] amber badge for promoted_from_implicit nodes; Dismiss clears panel.
- **Wave 4 serialization compliance** — appended `commands::sync::trigger_sync_animation` to `lib.rs` `generate_handler!` AFTER 13-08's `commands::pr_review::analyze_pr_diff`; mounted SyncButton + VerifierPanel + HarvestPanel in AppShell as fixed-positioned overlays with non-colliding z-indexes (PRReviewPanel from 13-08 sits at right edge sliding panel; SyncButton top-right z-30; VerifierPanel top-right top-16 z-30; HarvestPanel bottom-right z-40 — confirmed visually distinct corners + layers).

## Task Commits

1. **Task 1: SyncButton + animateSyncBlastRadius + trigger_sync_animation IPC** — `8c4165d` (feat)
2. **Task 2: VerifierPanel + ImplicitDecisionsGroup + HarvestPanel + verifier store + window.__demo debug helper + loadBeat3VerifierResults** — `83cf126` (feat)
3. **Task 3: Visual verification** — DEFERRED to plan 13-10b by user direction (no commit)

_Plan metadata commit follows this SUMMARY (docs)._

## Files Created/Modified

**Created:**
- `contract-ide/src/components/substrate/SyncButton.tsx` — Mocked Sync affordance (top-right z-30); invokes trigger_sync_animation IPC + animateSyncBlastRadius
- `contract-ide/src/lib/syncBlastRadius.ts` — `animateSyncBlastRadius(orderedUuids, finalState, staggerMs)` + `DEFAULT_BLAST_STAGGER_MS` + `BLAST_PULSE_DURATION_MS` exports
- `contract-ide/src-tauri/src/commands/sync.rs` — `trigger_sync_animation` Tauri command + `SyncTriggerResult { trigger_uuid, participant_uuids }` (placeholder uuids today; 13-10b extends to read blast-radius.json)
- `contract-ide/src/store/verifier.ts` — `useVerifierStore` zustand with `VerifierRow[]` + `ImplicitDecisionRow[]` + `setResults/clear/setOpen`
- `contract-ide/src/components/substrate/VerifierPanel.tsx` — Beat 3 stream renderer (top-right top-16 z-30); halos parentSurfaceUuid for 8s on flag rows
- `contract-ide/src/components/substrate/ImplicitDecisionsGroup.tsx` — ℹ section between honors and flag (3 rows hand-crafted per script Beat 3)
- `contract-ide/src/components/substrate/HarvestPanel.tsx` — Bottom-right z-40 notification; substrate:nodes-added listener + 2s poll fallback; promoted-from-implicit amber badge
- `contract-ide/src/lib/demoOrchestration.ts` — `loadBeat3VerifierResults(parentSurfaceUuid)` + window.__demo wiring; canonical Beat 3 verifier payload (6 honors + 3 implicit + 1 flag) per script

**Modified:**
- `contract-ide/src-tauri/src/commands/mod.rs` — Registered `pub mod sync;`
- `contract-ide/src-tauri/src/lib.rs` — Appended `commands::sync::trigger_sync_animation` to `tauri::generate_handler!` AFTER 13-08's `commands::pr_review::analyze_pr_diff` per Wave 4 serialization compliance
- `contract-ide/src/components/layout/AppShell.tsx` — Imported SyncButton + VerifierPanel + HarvestPanel; mounted alongside 13-08's PRReviewPanel with non-colliding z-indexes (top-right z-30 / top-right top-16 / bottom-right z-40)

## Decisions Made

### Visual verification deferred to plan 13-10b

User direction: defer visual verification of SyncButton blast radius, VerifierPanel orange flag halo, HarvestPanel promoted badge, and z-index coexistence to plan 13-10b's natural test surface. Rationale: plan 13-09 ships only the rendering layer + initial IPCs with placeholder uuids; chain-pulse fidelity, halo-on-screen-card semantics, and promoted-from-implicit badge styling are naturally exercised when 13-10b's DemoOrchestrationPanel triggers Beat 3 + Beat 4 with real fixture-loaded uuids from beat3-verifier.json / beat4-harvest.json / blast-radius.json (shipped by sibling 13-10a). Setting up custom annotated localhost fixtures for 13-09 isolation alone is wasted scope when 13-10b's orchestration panel is the canonical demo entry point.

### Citation halo over a custom pulse CVA

Plan 13-07 already wired citation halo across all three card types (ScreenCard / ServiceCard / ContractNode). Reusing useCitationStore.highlight for SyncButton's blast-radius pulse keeps the demo visual vocabulary unified — every "thing flashes" moment in the demo uses the same halo primitive. Substrate state setter fires at the same instant via setNodeState so the card's permanent ring color settles to `fresh` once the 1500ms halo fades; no additional CVA variant needed.

### Placeholder uuids in Rust IPC today, fixture read deferred to 13-10b

`trigger_sync_animation` returns hardcoded uuid strings today (`uuid-account-settings-screen` + 5 service participants). 13-10b will extend `sync.rs` body to read `blast-radius.json` and replace these with real Phase 9 uuids — but the response struct (`SyncTriggerResult { trigger_uuid: String, participant_uuids: Vec<String> }`) is locked now so SyncButton's TypeScript wiring requires zero changes. This staging → fixture transition pattern is a reusable convention for Wave 5: ship UI + IPC shape early with placeholders; later plan extends IPC body to read real data.

### Dual-channel substrate-event subscription with silent IPC-not-found swallow

HarvestPanel subscribes to `substrate:nodes-added` Tauri event (primary path, fires when Phase 10 session watcher emits) AND polls `list_recent_substrate_additions` IPC every 2s (fallback). The poll wraps the invoke in try/catch and silently ignores IPC-not-found errors per 13-RESEARCH.md Open Question 3 graceful-degradation guidance — without Phase 10 deployed, the event channel never fires and the IPC doesn't exist; HarvestPanel still works because 13-10b's `emit_beat4_harvest` IPC manually emits the event with the fixture payload.

### Orange flag halo on SCREEN CARD parent surface (not service card)

Per script Beat 3 + SC 6: the verifier's orange flag must visually attach to the parent surface (Account Settings screen) — not to a service card — so reviewers see "the conflict lives at parent level". `loadBeat3VerifierResults(parentSurfaceUuid)` takes the screen card uuid and stores it on the flag VerifierRow's `parentSurfaceUuid` field; VerifierPanel's effect calls `useCitationStore.highlight(parentSurfaceUuid, 8000)` on open — 8s halo duration (vs 1500ms default for sync pulse) to draw demo attention during the pause for verbal commentary.

### Wave 4 serialization compliance

`trigger_sync_animation` appended to `lib.rs` `generate_handler!` AFTER 13-08's `analyze_pr_diff` per the documented Wave 4 serialization plan. Sibling plans 13-07 + 13-08 ran in parallel and modify different file surfaces — zero conflict on this insertion point.

## Deviations from Plan

None — plan executed exactly as written. Task 3 visual verification deferred per user direction is not a deviation (it's an explicit user-approved checkpoint outcome documented in the resume instructions).

## Issues Encountered

None during implementation. Visual verification is deferred to plan 13-10b's DemoOrchestrationPanel surface (the natural test point for fixture-loaded uuids), per user direction.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Plan 13-10a (data layer — Wave 5 parallel sibling)** ships:
- `blast-radius.json` — real Phase 9 uuids (trigger screen card + 5 chain participants) for the delete-account flow per scenario-criteria.md staging
- `beat3-verifier.json` — 6 honor rows (rule uuids matching real substrate_nodes) + 3 implicit-decision rows + 1 flag row with parent_surface_uuid pointing at the real Account Settings screen card uuid
- `beat4-harvest.json` — 3 harvested nodes (2 code-derived + 1 with `promoted_from_implicit: true`) with `attached_to_uuid` per node for participant halo wiring
- SQL seed setting `substrate_nodes.intent_drift_state = 'DRIFTED'` for the parent surface contract (drives the orange-flag halo dynamically when Phase 12 supersession is wired; today fixture-staged)
- Reset script for stage rehearsal repeatability

Zero file overlap with plan 13-09 (data files only).

**Plan 13-10b (UI orchestration — Wave 5 parallel sibling)** consumes plan 13-09's surfaces:
- Extends `contract-ide/src-tauri/src/commands/sync.rs` `trigger_sync_animation` body to read `blast-radius.json` from the demo fixture path; replaces placeholder uuids with real Phase 9 uuids; preserves `SyncTriggerResult` shape
- Calls `window.__demo.loadBeat3VerifierResults(<real-screen-card-uuid>)` from `loadAndApplyBeat3Verifier` after reading `beat3-verifier.json`
- Adds `emit_beat4_harvest` Tauri IPC that reads `beat4-harvest.json` and emits `substrate:nodes-added` event with the harvested_nodes array (each carrying `attached_to_uuid` for participant halo wiring) — fires HarvestPanel's primary subscription path
- DemoOrchestrationPanel triggers Beat 3 + Beat 4 with real uuids; this is the natural test surface where plan 13-09's deferred visual verification lands (chain-pulse fidelity, halo-on-screen-card semantics, promoted-from-implicit badge styling, z-index coexistence with PRReviewPanel from 13-08)

**Plan 13-11 (rehearsal):** `DEFAULT_BLAST_STAGGER_MS` and `BLAST_PULSE_DURATION_MS` exported from `src/lib/syncBlastRadius.ts` for animation pacing tuning if camera-readability flags 50ms as too fast. Likely candidates for tuning: 75-100ms stagger (camera frame-rate + audience cognition) and 2000-2500ms pulse (longer dwell for verbal commentary). Adjust constants only — no logic changes needed.

**Phase 12 dependency status:** Orange-flag verifier output is fixture-staged via `beat3-verifier.json` (shipped by 13-10a). Without Phase 12 supersession engine running live, the orange flag does not appear dynamically (no `substrate_nodes.intent_drift_state = 'DRIFTED'` cascade); with the fixture, Beat 3 still runs end-to-end on the demo bar.

**Phase 10 dependency status:** HarvestPanel's `substrate:nodes-added` event subscription has 2s polling fallback against `list_recent_substrate_additions` IPC (silently swallows IPC-not-found via try/catch). Without Phase 10 session watcher deployed, the event channel never fires; 13-10b's `emit_beat4_harvest` IPC manually emits for Beat 4 staging — HarvestPanel renders correctly via the primary event path even with Phase 10 absent.

---
*Phase: 13-substrate-ui-demo-polish*
*Completed: 2026-04-25*

## Self-Check: PASSED

Both task commits found in git history:
- `8c4165d` (Task 1: SyncButton + animateSyncBlastRadius + trigger_sync_animation IPC)
- `83cf126` (Task 2: VerifierPanel + ImplicitDecisionsGroup + HarvestPanel + verifier store + window.__demo + loadBeat3VerifierResults)

Task 3 visual verification deferred to plan 13-10b per user direction (no commit expected).

Documentation-only finalization run — no source files modified.
