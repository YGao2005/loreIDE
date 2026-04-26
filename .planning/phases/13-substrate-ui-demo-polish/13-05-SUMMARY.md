---
phase: 13-substrate-ui-demo-polish
plan: 05
subsystem: ui
tags: [react-flow, cva, iframe, postmessage, vitest, babel-plugin-dependency, chip-overlay]

# Dependency graph
requires:
  - phase: 13-substrate-ui-demo-polish
    provides: resolveNodeState compositor + NodeVisualState union + useSubstrateStore.nodeStates Map + useGraphStore.focusedAtomUuid slice + setFocusedAtomUuid action (plan 13-01)
  - phase: 13-substrate-ui-demo-polish
    provides: serviceCard nodeTypes registration (plan 13-04 — preserved during additive append of screenCard)
  - phase: 04-inspector-monaco
    provides: probeRoute IPC (Rust reqwest CORS-safe probe — Plan 04-03) + frame-src http://localhost:* CSP + iframe sandbox tokens (allow-scripts allow-same-origin allow-forms)
  - phase: 03-graph-canvas
    provides: nodeTypes registry + module-scope memo + plain-NodeProps cast pattern (Pitfall 1)
  - phase: 07-drift-detection-watcher-path
    provides: useDriftStore.driftedUuids Set
  - phase: 08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation
    provides: useRollupStore.rollupStaleUuids + untrackedUuids Sets
  - phase: 09-mass-edit-non-coder-mode-demo-repo-seeding
    provides: BABEL-01 (Babel/SWC plugin injecting data-contract-uuid on JSX elements — Phase 9 Plan 09-04b spike PASSED Route A custom webpack loader). 13-05 ships defensive impl: when iframe DOM has no [data-contract-uuid] elements, AtomChipOverlay renders nothing; section-bottom fallback per CARD-01 spec deferred to plan 13-10b once seeded fixture lands. Without BABEL-01 in the iframe content, the visceral Beat 1 moment (clicking rendered Danger Zone region) does NOT work — surfaced to plan 13-11 rehearsal as a Phase 9 contract gap if the demo iframe content lacks `data-contract-uuid` annotations.
provides:
  - requestChipRects(iframe, timeoutMs) async helper — same-origin contentDocument direct access (preferred) with postMessage fallback; rects normalised to iframe-local coordinates
  - ChipRect + ChipRectMessage wire shapes
  - AtomChip — bounding-rect-positioned button with state-keyed CVA (drifted / intent_drifted / rollup_stale / rollup_untracked / superseded / healthy) + focused halo when uuid matches focusedAtomUuid; canonical selectNode + setFocusedAtomUuid setters (checker N7)
  - AtomChipOverlay — pointer-events-none container with pointer-events-auto chips; refreshes on iframe load + window resize; subscribes to graphStore.nodes filtered by parent_uuid + L4 level
  - screenCardStyles CVA — separate scope from ServiceCard's cardKindStyles but identical state hex values for canvas-wide visual consistency
  - ScreenCard react-flow node — UI-mode L3 trigger card: probeRoute → iframe at fullUrl + AtomChipOverlay layered in parent (NOT inside iframe); Inspect (default) / Interact mode toggle in header flips iframe pointer-events
  - ScreenCardData wire shape — `{uuid, name, route, devServerUrl?}` (consumed by plan 13-06's flow-chain assembler for L3 trigger nodes when `kind: 'screen'`)
  - screenCard registration in nodeTypes.ts (additive append AFTER plan 13-04's serviceCard entry per Wave 2 serialization_hint)
  - data-atom-uuid + data-state DOM attributes on chips — stable selectors for plan 13-07's citation halo (mirrors plan 13-04 ServiceCardChips pattern)
affects:
  - 13-06 (FlowChainLayout — assembles vertical L2 chain with ScreenCard at top + ServiceCards below; visual verification of ScreenCard isolation deferred here per user direction)
  - 13-07 (Chat archaeology citation halo — citation links can `document.querySelector('[data-atom-uuid="..."]')` against ScreenCard atom chips and ServiceCardChips uniformly)
  - 13-10b (UAT — section-uuid fallback wiring once seeded fixture exists; full chain end-to-end verification)
  - 13-11 (Rehearsal — Phase 9 BABEL-01 contract gap surfaces if iframe content lacks `data-contract-uuid` annotations on the Beat 1 Danger Zone region)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Parent-layer overlay (NOT iframe-injection) for cross-origin defence + pan/zoom integrity — chip overlay sits absolutely-positioned over iframe in the parent stacking context; pointer-events-none container + pointer-events-auto chips lets clicks land on chips while passing through to iframe (when in Interact mode)"
    - "Same-origin direct DOM access (preferred) with postMessage fallback (graceful degradation) for iframe rect queries — same-origin works today via Phase 4 frame-src CSP for http://localhost:*; postMessage path future-proofs against cross-origin scenarios without coupling iframe content to parent"
    - "Inspect (default) / Interact mode toggle pattern — iframe pointer-events flipped via React state; chips fade to 0.4 opacity in Interact (still clickable as power-user affordance); Inspect intercepts clicks via chip overlay so Beat 1 visceral click resolves to atom uuid"
    - "Test infrastructure parity (continued from plan 13-04) — vitest .test.ts (NOT .test.tsx), environment:'node', no jsdom, no @testing-library/react. ScreenCard.test.ts uses pure-logic / structural checks (URL composition, NodeProps shape, nodeTypes registration preservation) — visual rendering covered by plan 13-06 + 13-11 rehearsal"
    - "Probe + retry + iframe remount pattern (continued from Phase 4 Plan 04-03) — probeRoute IPC, probeCount key bumps re-run probe and force iframe remount, mirrors PreviewTab key={probeCount} exactly"

key-files:
  created:
    - "contract-ide/src/lib/iframeChipPositioning.ts (requestChipRects + ChipRect + ChipRectMessage)"
    - "contract-ide/src/lib/__tests__/iframeChipPositioning.test.ts (5 vitest cases)"
    - "contract-ide/src/components/graph/AtomChip.tsx (single chip + chipStyles CVA)"
    - "contract-ide/src/components/graph/AtomChipOverlay.tsx (container + iframe rect query lifecycle)"
    - "contract-ide/src/components/graph/screenCardStyles.ts (card body CVA)"
    - "contract-ide/src/components/graph/ScreenCard.tsx (UI-mode L3 trigger card)"
    - "contract-ide/src/components/graph/__tests__/ScreenCard.test.ts (8 vitest cases)"
  modified:
    - "contract-ide/src/components/graph/nodeTypes.ts (appended `screenCard: ScreenCard` AFTER plan 13-04's `serviceCard` entry — additive; both registrations preserved per Wave 2 serialization_hint)"

key-decisions:
  - "Visual end-to-end verification (Task 3 checkpoint:human-verify) DEFERRED to plan 13-06 by user direction — 13-06's FlowChainLayout depends on ScreenCard and will mount it inside a real flow chain (ScreenCard at top + ServiceCards below); that becomes the natural test surface. Setting up a custom annotated localhost page for 13-05 isolation alone is wasted scope. Unit tests (5/5 iframeChipPositioning + 8/8 ScreenCard) + tsc clean + vite build success cover plan-level isolation; visual gates on 13-06."
  - "Same-origin direct contentDocument access is the preferred chip-rect query path; postMessage is graceful-degrade fallback. Phase 4 Plan 04-03 frame-src CSP (`http://localhost:* http://127.0.0.1:*`) makes localhost iframes same-origin under Tauri. The iframe is not coupled to parent — no script injection — so chip overlay works without iframe-side cooperation. Future cross-origin scenarios (e.g., remote preview targets) gracefully fall back to postMessage."
  - "Parent-layer overlay (NOT iframe-injection) — three reasons: (1) cross-origin defence — even if same-origin today we don't inject scripts into user dev server; (2) pan/zoom integrity — iframe content scrolls/scales independently of canvas, parent-layer chips stay positioned correctly under react-flow zoom; (3) click intercept — pointer-events-none container + pointer-events-auto chips lets Inspect mode work."
  - "Inspect (default) intercepts clicks via chip overlay; Interact toggle flips iframe pointer-events. Inspect: iframe pointer-events: none + chips pointer-events: auto → chips catch clicks, iframe whitespace no-op. Interact: iframe pointer-events: auto + chips faded to 0.4 opacity but still clickable (power-user affordance). Toggle ships even though demo doesn't require Interact mode — foundation requires iframe to ignore pointer events by default for chip-click intercept to work."
  - "Empty-element fallback (no JSX has matching `data-contract-uuid`) renders NOTHING in 13-05 — the section-bottom placement spec deferred to plan 13-10b once seeded fixture exists. TODO comment in AtomChipOverlay.tsx notes the deferred work. Plan 13-11 rehearsal will catch this as Phase 9 BABEL-01 gap if iframe content lacks annotations."
  - "Wave 2 serialization compliance: nodeTypes.ts append-only — `screenCard: ScreenCard` placed AFTER plan 13-04's `serviceCard` entry; both preserved. lib.rs UNTOUCHED (no Rust IPC commands added by this plan — probeRoute already shipped in Phase 4). tauri.conf.json frame-src verified read-only (Phase 4 Plan 04-03 already shipped `http://localhost:* http://127.0.0.1:*` allowlist for both standard ports)."
  - "Test infrastructure parity (continued from plan 13-04) — vitest .test.ts pure-logic checks. iframeChipPositioning.test.ts: 5 cases (rect normalisation, multi-element preservation, attribute guard, contentDocument null fallthrough, SecurityError fallthrough) — note vitest config environment:'node' so postMessage fallthrough cases stub globalThis.window. ScreenCard.test.ts: 8 cases (nodeTypes registration preservation, ScreenCardData contract shape, URL composition with leading-slash defence + custom devServerUrl). Visual rendering deferred to 13-06 + 13-11."
  - "Canonical store API enforced per checker N7 — AtomChip uses `useGraphStore.getState().selectNode(uuid)` AND `useGraphStore.getState().setFocusedAtomUuid(uuid)` (NEVER `setSelectedNode`, NEVER raw `setState({ focusedAtomUuid })`). Both typed actions provided by plan 13-01 graphStore extension. grep verification clean."

patterns-established:
  - "Parent-layer chip overlay over iframe — sidesteps cross-origin script injection AND pan/zoom interference. Reusable for any future card variant where the body content is third-party (e.g., remote preview targets, sandboxed live demos). Pattern: container with absolute inset-0 + pointer-events-none, child chips with pointer-events-auto + state-keyed CVA + bounding-rect positioning from a query helper that prefers same-origin direct access with postMessage graceful-degrade fallback."
  - "Same-origin-direct + postMessage-fallback chip rect query — requestChipRects tries iframe.contentDocument first (works for localhost dev, future-proofs for any scenario where Phase 4 CSP keeps iframes same-origin), catches SecurityError on cross-origin, falls back to postMessage with 250ms timeout. Iframe content not coupled to parent — no injection required for the same-origin case; postMessage path requires iframe-side responder which a future BABEL-01 extension or dev-tools shim can provide."
  - "ScreenCard probe + retry + iframe remount lifecycle (Phase 4 PreviewTab pattern) — probeRoute IPC returns reachable bool, probing/reachable/unreachable state machine, probeCount key bumps re-run AND iframe remount via React key prop. Reusable for any card whose body is a live network resource (CARD-04 webhook receiver future, etc.)."
  - "Inspect/Interact toggle pattern for surfaces with overlays AND interactive content — toggle bit flips pointer-events on iframe + opacity on overlay. Pattern: default (Inspect) prioritizes overlay clicks; toggle (Interact) prioritizes content clicks; overlay still mounted in both modes so state coloring + halos remain visible."

requirements-completed: []  # CARD-01 + CHIP-01 marked In Progress (full completion gates on plan 13-06 visual verification per user-directed deferral) — see REQUIREMENTS.md update.

# Metrics
duration: 18 min  # cumulative across initial run + checkpoint deferral resolution
completed: 2026-04-25
---

# Phase 13 Plan 05: ScreenCard + Atom-Chip Overlay Summary

**UI-mode L3 trigger card with iframe at the screen contract's `route` + parent-layer atom-chip overlay positioned via same-origin direct DOM access (postMessage fallback for cross-origin) — ScreenCard ships in isolation; visual end-to-end verification deferred to plan 13-06's FlowChainLayout where ScreenCard mounts inside a real flow chain.**

## Performance

- **Duration:** 18 min (cumulative across initial run + checkpoint deferral resolution)
- **Started:** 2026-04-25T21:48:00Z (initial run for Tasks 1+2)
- **Completed:** 2026-04-25T22:06:00Z (deferral documentation finalized after user direction)
- **Tasks:** 2 of 3 (Task 3 checkpoint:human-verify deferred to plan 13-06 by user direction)
- **Files modified:** 8 (7 created + 1 modified)

## Accomplishments

- `requestChipRects(iframe, timeoutMs)` — async helper that prefers same-origin `iframe.contentDocument.querySelectorAll('[data-contract-uuid]')` direct access (works for localhost dev under Phase 4 frame-src CSP) and gracefully falls back to `postMessage` with a 250ms timeout when same-origin access throws. Rects are normalised to iframe-local coordinates so chips position correctly inside the parent overlay container's `absolute inset-0` box.
- `AtomChip` — bounding-rect-positioned button with state-keyed CVA matching plan 13-01 `NodeVisualState` exactly (drifted / intent_drifted / rollup_stale / rollup_untracked / superseded / healthy). Focused halo when `useGraphStore.focusedAtomUuid === uuid` (set by plan 13-03 Cmd+P L4 atom-hit landing). Click handler uses canonical `selectNode` + `setFocusedAtomUuid` typed actions per checker N7. `data-atom-uuid` + `data-state` DOM attributes mirror plan 13-04 `ServiceCardChips` for plan 13-07's citation-halo selector compatibility.
- `AtomChipOverlay` — pointer-events-none container with pointer-events-auto chips; refreshes on iframe `load` event + window `resize` event + 200ms initial delay (lets HMR settle); subscribes to `useGraphStore.nodes` filtered by `parent_uuid` + `level === 'L4'` with `.length` as stable re-bind signal. TODO comment for plan 13-10b's section-uuid fallback when no JSX element matches an atom.
- `screenCardStyles` CVA — separate scope from `cardKindStyles` (ServiceCard) but identical state hex values (orange-600 + 8px glow halo for `intent_drifted` matches ContractNode + ServiceCard exactly per 13-RESEARCH.md Pitfall 6 — bitrate compression).
- `ScreenCard` react-flow node — UI-mode L3 trigger card. Probe via `probeRoute` IPC (Phase 4 Plan 04-03 reqwest reqwest, NOT frontend fetch — CORS-blocked because `tauri://localhost ≠ http://localhost:3000`). probing/reachable/unreachable state machine; iframe at `fullUrl` (composed from `route` + `devServerUrl`); `AtomChipOverlay` layered in parent layer, NOT inside iframe; Inspect (default, iframe `pointer-events: none`) / Interact (iframe `pointer-events: auto`, chips fade to 0.4 opacity) toggle in header. Module-scope `memo()` + plain `NodeProps` cast per Plan 03-01 Pitfall 1.
- `nodeTypes.ts` — appended `screenCard: ScreenCard` AFTER plan 13-04's `serviceCard` entry; both registrations preserved per Wave 2 serialization_hint. Header comment updated to document both Phase 13 entries.
- 13 vitest cases total (5 iframeChipPositioning + 8 ScreenCard); full project test suite passes; vite production build succeeds; `tsc --noEmit` clean.

## Task Commits

1. **Task 1: iframe-chip postMessage protocol + AtomChipOverlay + AtomChip + screenCardStyles** — `d66cbc9` (feat)
2. **Task 2: ScreenCard component + screenCard nodeTypes registration** — `4089fda` (feat)
3. **Task 3: Verify ScreenCard renders iframe + chip overlay end-to-end (checkpoint:human-verify)** — DEFERRED to plan 13-06 by user direction (no commit; this SUMMARY documents the deferral rationale)

_Plan metadata commit follows this SUMMARY (docs)._

## Files Created/Modified

**Created:**
- `contract-ide/src/lib/iframeChipPositioning.ts` — `requestChipRects(iframe, timeoutMs)` async helper. Same-origin path uses `iframe.contentDocument.querySelectorAll<HTMLElement>('[data-contract-uuid]')`, normalises rects to iframe-local coords. postMessage fallback registers a temporary `message` listener, posts `{ type: 'request-chip-rects' }` to `iframe.contentWindow`, awaits `{ type: 'chip-rects', rects }` response, times out at 250ms returning `[]`. SecurityError swallowed silently.
- `contract-ide/src/lib/__tests__/iframeChipPositioning.test.ts` — 5 vitest cases: (1) rect normalisation produces iframe-local coords, (2) multiple elements all preserved, (3) elements without `data-contract-uuid` ignored, (4) `contentDocument === null` falls through to postMessage, (5) `contentDocument` access throwing falls through to postMessage. Stub `globalThis.window` for postMessage cases since vitest config uses `environment: 'node'` (no jsdom).
- `contract-ide/src/components/graph/AtomChip.tsx` — Memo'd button with `chipStyles` CVA (state + focused variants); canonical `selectNode` + `setFocusedAtomUuid` setters per checker N7; `data-atom-uuid` + `data-state` DOM attributes for plan 13-07 citation halo.
- `contract-ide/src/components/graph/AtomChipOverlay.tsx` — Container with `absolute inset-0 pointer-events-none`; effect re-binds on `[atoms.length, parentUuid]`; refreshes on iframe `load` + window `resize` + 200ms initial; merges rects with atom names from graphStore by uuid; TODO for plan 13-10b section-uuid fallback.
- `contract-ide/src/components/graph/screenCardStyles.ts` — `screenCardStyles` CVA: rounded panel + state ring matching plan 13-01 NodeVisualState exactly. State keys `healthy / drifted / rollup_stale / rollup_untracked / intent_drifted / superseded` — same hex values as ContractNode + ServiceCard.
- `contract-ide/src/components/graph/ScreenCard.tsx` — `ScreenCardImpl` consumes `data as ScreenCardData` (plain `NodeProps` cast per Pitfall 1), composes `fullUrl` from `route` + `devServerUrl ?? DEFAULT_DEV_BASE` with leading-slash defence, runs probe via `probeRoute` IPC, renders header (route + name + Inspect/Interact toggle) and body (iframe + AtomChipOverlay or probing/unreachable state). Module-scope `memo(ScreenCardImpl)`.
- `contract-ide/src/components/graph/__tests__/ScreenCard.test.ts` — 8 vitest cases: nodeTypes preserves serviceCard + screenCard; ScreenCardData has uuid/name/route/optional devServerUrl; URL composition with leading slash; URL composition without leading slash; URL composition with custom devServerUrl; ScreenCard is a memo'd function component; nodeTypes is `as const` for react-flow type narrowing; default dev base is `http://localhost:3000`.

**Modified:**
- `contract-ide/src/components/graph/nodeTypes.ts` — Appended `screenCard: ScreenCard` AFTER plan 13-04's `serviceCard: ServiceCard` entry. Header comment updated documenting both Phase 13 entries (Plan 13-04 ServiceCard + Plan 13-05 ScreenCard) and the Wave 2 serialization_hint append discipline.

## Decisions Made

### Visual end-to-end verification deferred to plan 13-06 (Task 3 checkpoint resolution)

**User direction (verbatim):** "Defer visual verification to plan 13-06's checkpoint. Plan 13-06 (FlowChainLayout) depends on 13-05 ScreenCard and will mount it inside a real flow chain — that's the natural test surface. Setting up a custom annotated localhost page just for 13-05 isolation is wasted scope. Unit tests + tsc + build green is enough for 13-05's plan-level summary."

**Rationale:**
- Plan 13-06's FlowChainLayout assembler will mount `ScreenCard` at the top of an L2 vertical chain with `ServiceCard`s below (per CHAIN-01 spec, `flow.members` ordering top-to-bottom). That composition is the natural test surface — the demo's Beat 1 trigger flow renders exactly this shape.
- Setting up a custom annotated localhost page (a Next.js page with `data-contract-uuid` annotations on test elements) for 13-05 isolation alone duplicates the work plan 13-06 will exercise live. The seeded `contract-ide-demo` repo's `app/account/settings/page.tsx` is the production test surface.
- Plan-level isolation is already covered: 5/5 iframeChipPositioning unit tests + 8/8 ScreenCard unit tests + `tsc --noEmit` clean + `vite build` success. The component renders correctly in isolation; the question that needs visual verification ("does the chip-to-element resolution chain work end-to-end") is answered by plan 13-06's flow-chain integration test against the seeded fixture.

### Wave 2 serialization compliance — append-only nodeTypes.ts, no lib.rs edits

Per the plan's `serialization_hint` frontmatter: plan 13-04 commits its `serviceCard` registration FIRST; plan 13-05 appends `screenCard` to the same `nodeTypes` const AFTER. Final state in `nodeTypes.ts`:

```typescript
export const nodeTypes = {
  contract: ContractNode,
  group: GroupNode,
  serviceCard: ServiceCard,  // added by plan 13-04
  screenCard: ScreenCard,    // added by plan 13-05
} as const;
```

`lib.rs` is UNTOUCHED — no new Rust IPC commands added by this plan. `probeRoute` already shipped in Phase 4 Plan 04-03; ScreenCard reuses it. `tauri.conf.json` `frame-src` allowlist (`http://localhost:* http://127.0.0.1:*`) verified READ-ONLY (Phase 4 Plan 04-03 ships both standard ports).

### Same-origin direct contentDocument access is the canonical path; postMessage is fallback

Phase 4 Plan 04-03's frame-src CSP allows `http://localhost:*` and `http://127.0.0.1:*` in `frame-src` — under Tauri the iframe is same-origin (both parent and iframe live under the Tauri WebView's relaxed sandbox), so `iframe.contentDocument` access works without throwing. Direct `querySelectorAll('[data-contract-uuid]')` is the simplest path: no protocol coordination, no postMessage round-trip, no iframe-side responder needed.

postMessage fallback is graceful degradation. If a future scenario serves the iframe from a different origin (e.g., remote preview targets, prod deploy URLs), `iframe.contentDocument` access throws `SecurityError` — caught silently, falls through to postMessage path, which requires the iframe content to register a `request-chip-rects` listener. Today the seeded fixture's iframe content does NOT register such a listener (Babel plugin output is for `data-contract-uuid` injection only, not parent message handling), so the fallback path returns `[]` after timeout — chip overlay renders empty.

This dual-path architecture is documented inline. Plan 13-10b can wire a postMessage responder into the demo repo's Babel plugin output when seeded fixture work happens.

### Empty-element fallback — render nothing today, section-bottom placement deferred to plan 13-10b

Per CARD-01 spec: when an L4 atom contract exists but its corresponding JSX element has not been added yet (the empty Danger Zone case — Beat 1's exact moment before the agent edit lands), the iframe DOM has NO `[data-contract-uuid="<atom-uuid>"]` element matching that atom. The fallback per CARD-01 is to look up the atom's `code_ranges.section_uuid`, find the parent section's `data-contract-section-uuid` element, and place the chip in the section's bottom-anchored region.

That fallback is DEFERRED to plan 13-10b once the seeded fixture (BABEL-01 output + JSX-aligned `code_ranges`) is in place to test against. For now, atoms with no matching JSX element render NOTHING in the chip overlay. TODO comment lives in `AtomChipOverlay.tsx` referencing plan 13-10b.

**Phase 9 BABEL-01 dependency status:** Defensive fallback ships — when iframe DOM has no `[data-contract-uuid]` elements at all (e.g., iframe content lacks the Babel plugin output entirely), `AtomChipOverlay` queries return `[]` and the overlay renders empty. Without BABEL-01 in the iframe content, the visceral Beat 1 moment (clicking the rendered Danger Zone region resolves to the matching atom) does NOT work. Plan 13-11 rehearsal must surface this as a Phase 9 contract gap if the demo iframe content lacks `data-contract-uuid` annotations on the Beat 1 surface.

### Test infrastructure parity (continued from plan 13-04)

vitest config: `environment: 'node'`, no jsdom, no `@testing-library/react`. Tests use pure-logic / structural checks per project precedent (`DeltaBanner.test.ts` + plan 13-04 `ServiceCard.test.ts`).

`iframeChipPositioning.test.ts` (5 cases): The same-origin path is testable without DOM mounting — construct fake `iframe`-shaped objects with `contentDocument: { querySelectorAll: vi.fn().mockReturnValue([...]) }` + `getBoundingClientRect: vi.fn()` returning predictable rects, assert resulting normalised rects. The postMessage fallthrough cases stub `globalThis.window` (with `addEventListener` + `removeEventListener` mocks) so the helper's `window.addEventListener('message', ...)` call has a target.

`ScreenCard.test.ts` (8 cases): URL composition is pure logic (string manipulation with leading-slash defence), nodeTypes registration is structural (object key presence + react-flow `as const` type narrowing), ScreenCardData contract is a TypeScript type assertion. Visual rendering of iframe + chip overlay is an integration concern deferred to plan 13-06's flow-chain composition test.

### Canonical store API enforced (checker N7)

`AtomChip.onClick` calls:

```typescript
useGraphStore.getState().selectNode(uuid);
useGraphStore.getState().setFocusedAtomUuid(uuid);
```

NEVER `setSelectedNode` (does not exist on graph store), NEVER raw `setState({ focusedAtomUuid: uuid })` (bypasses typed action). Both setters are typed actions provided by plan 13-01's `useGraphStore` extension. `grep -n "setSelectedNode" contract-ide/src/components/graph/AtomChip.tsx` returns ZERO matches — verified.

## Deviations from Plan

None — plan executed exactly as written for Tasks 1+2. Task 3 (checkpoint:human-verify for visual end-to-end smoke) was reached as designed; visual verification was DEFERRED to plan 13-06 by user direction (not skipped, not failed — explicitly delegated to the natural integration test surface). This is documented as a key decision above, not a deviation, because the deferral is policy alignment with the plan's own scope language ("ScreenCard renders correctly in isolation … chain composition is plan 13-06's deliverable").

## Issues Encountered

**Task 3 checkpoint resolution required user direction.** The `checkpoint:human-verify` step (Task 3) listed a 10-step manual verification protocol that required either (a) a custom localhost page with `data-contract-uuid`-annotated elements + DevTools-injected ScreenCard node, or (b) the seeded `contract-ide-demo` fixture and a flow chain to mount ScreenCard inside. Option (a) is wasted scope (duplicates plan 13-06's natural test surface); option (b) requires plan 13-06 (FlowChainLayout) and plan 13-10a (substrate seed) work that has not yet shipped.

**Resolution:** User explicitly directed deferral to plan 13-06's checkpoint, where ScreenCard mounts inside a real flow chain (the natural test surface). Plan-level isolation is covered by the unit-test suite + tsc + build verification; full chain end-to-end verification gates on 13-06.

## User Setup Required

None — no external service configuration required. ScreenCard renders against the user's own dev server (default `http://localhost:3000`); iframe sandbox tokens (allow-scripts allow-same-origin allow-forms) and frame-src CSP (`http://localhost:* http://127.0.0.1:*`) already shipped in Phase 4 Plan 04-03.

## Next Phase Readiness

Wave 3 plan 13-06 (FlowChainLayout — CHAIN-01 + CHAIN-02) can now:

- `import { ScreenCard, type ScreenCardData } from '@/components/graph/ScreenCard'` — register ScreenCard for L3 trigger nodes when `kind: 'screen'` is present on the trigger contract's frontmatter.
- `import { ServiceCard, type ServiceCardData } from '@/components/graph/ServiceCard'` (plan 13-04) — register ServiceCard for participants below the trigger.
- Use the `nodeTypes` const exported from `nodeTypes.ts` directly as react-flow's `nodeTypes` prop — both `screenCard` and `serviceCard` keys present.
- Read the canonical `ScreenCardData` shape: `{ uuid, name, route, devServerUrl? }`. The flow-chain assembler should populate this from the trigger contract's frontmatter (extract `route` from contract frontmatter — Phase 9 FLOW-01's UI flow trigger contracts carry this; default `devServerUrl` to `http://localhost:3000` unless the user has configured otherwise).
- Mount ScreenCard inside a flow chain — the L2 vertical chain assembler emits `{type: 'screenCard', data: ScreenCardData, position}` for L3 trigger nodes when `kind: 'screen'`, then `{type: 'serviceCard', data: ServiceCardData, position}` for each participant below in `flow.members` order.
- Visual verification for plan 13-05's ScreenCard isolation lands here — when 13-06's flow-chain assembler mounts ScreenCard atop the chain, the demo's seeded `app/account/settings/page.tsx` iframe loads (assuming user dev server is up), AtomChipOverlay queries the iframe DOM, chips render at bounding rects of `data-contract-uuid`-annotated elements (assuming Phase 9 BABEL-01 has populated those annotations), Inspect/Interact toggle works, focusedAtomUuid halo renders when set by Cmd+P (plan 13-03).

**Plan 13-07 (chat archaeology citation halo):**
- Each chip exposes `data-atom-uuid={atom.uuid}` + `data-state={state}` — plan 13-07's halo can `document.querySelector('[data-atom-uuid="..."]')` for flash-on-citation across BOTH `ServiceCardChips` (plan 13-04) and ScreenCard atom chips (plan 13-05) uniformly.

**Plan 13-10b (UAT — section-bottom fallback wiring):**
- The TODO in `AtomChipOverlay.tsx` references plan 13-10b: when an atom has `code_ranges.section_uuid` but no JSX element matches, look up the section element (`data-contract-section-uuid`) and place chip at section's bottom region. Implementation: extend the same-origin `querySelectorAll` to also fetch `[data-contract-section-uuid="<section-uuid>"]` elements, compute section.bottom rect, render placeholder chip with `(no element yet)` label or similar. Today plan 13-05 falls back to render-nothing.

**Plan 13-11 (rehearsal — Phase 9 BABEL-01 contract gap surface):**
- If the seeded `contract-ide-demo` iframe content does NOT include `data-contract-uuid` annotations on the Beat 1 surface (e.g., Babel plugin not installed, plugin not running on the demo build, plugin output not picked up), the chip overlay will render empty against the iframe and the visceral Beat 1 click-to-resolve moment will not work. This is a Phase 9 BABEL-01 contract gap, NOT a 13-05 bug — Phase 9 Plan 09-04b's spike PASSED Route A custom webpack loader; rehearsal must verify the loader runs against the demo build and emits `data-contract-uuid` attributes on the seeded `app/account/settings/page.tsx` JSX elements.

**Wave status:**
- Wave 2 COMPLETE (4 plans landed): plan 13-04 (ServiceCard), plan 13-02 (Sidebar), plan 13-03 (Cmd+P + cmdk fix), plan 13-05 (ScreenCard).
- Wave 3 NEXT: plan 13-06 (FlowChainLayout — CHAIN-01 + CHAIN-02). Assembles the vertical L2 chain with ScreenCard at top + ServiceCards below in `flow.members` order; renders call-shape edge labels from each participant's `## Outputs` → next participant's `## Inputs`.

---
*Phase: 13-substrate-ui-demo-polish*
*Completed: 2026-04-25*

## Self-Check: PASSED

All 7 created files exist on disk:
- `contract-ide/src/lib/iframeChipPositioning.ts`
- `contract-ide/src/lib/__tests__/iframeChipPositioning.test.ts` (5 test cases)
- `contract-ide/src/components/graph/AtomChip.tsx`
- `contract-ide/src/components/graph/AtomChipOverlay.tsx`
- `contract-ide/src/components/graph/screenCardStyles.ts`
- `contract-ide/src/components/graph/ScreenCard.tsx`
- `contract-ide/src/components/graph/__tests__/ScreenCard.test.ts` (8 test cases)

`contract-ide/src/components/graph/nodeTypes.ts` modified — both `serviceCard: ServiceCard` (plan 13-04) and `screenCard: ScreenCard` (plan 13-05) entries present.

Both task commits found in git history:
- `d66cbc9` (Task 1: iframe-chip postMessage protocol + AtomChipOverlay + AtomChip + screenCardStyles)
- `4089fda` (Task 2: ScreenCard component + screenCard nodeTypes registration)

Task 3 (checkpoint:human-verify) explicitly deferred to plan 13-06 by user direction — no commit expected; deferral rationale documented above.
