---
phase: 13-substrate-ui-demo-polish
plan: 06
subsystem: ui
tags: [react-flow, flow-chain, callshape-edge, postmessage, cross-origin, screenshot, vitest]

# Dependency graph
requires:
  - phase: 13-substrate-ui-demo-polish
    provides: ServiceCard + cardKindStyles + parseBackendSections (plan 13-04)
  - phase: 13-substrate-ui-demo-polish
    provides: ScreenCard + AtomChipOverlay + requestChipRects + screenCardStyles (plan 13-05)
  - phase: 13-substrate-ui-demo-polish
    provides: useGraphStore.focusedAtomUuid + resolveNodeState compositor (plan 13-01)
  - phase: 09-mass-edit-non-coder-mode-demo-repo-seeding
    provides: FLOW-01 (kind:flow + members[] ordering) + BACKEND-FM-01 (## Inputs / ## Outputs / ## Side effects)
provides:
  - assembleFlowChain pure function — deterministic vertical layout from flow.members + node corpus → react-flow nodes/edges with positions, screenCard-vs-serviceCard kind dispatch, and per-edge call-shape data
  - deriveCallShape — parses prev `## Outputs` + next `## Inputs` (BACKEND-FM-01) → matched-key label or `?` muted fallback
  - CallShapeEdge — custom react-flow edge with smooth-step path + EdgeLabelRenderer label (matched vs muted styling)
  - edgeTypes registry — `callShape` registration; module-scope const per Phase 3 Pitfall 1
  - FlowChainLayout — top-level component reading useSidebarStore.selectedFlowUuid + useGraphStore.nodes; mounts ReactFlow with vertical chain
  - GraphCanvasInner branch — when selectedFlowUuid set, swaps default rendering for FlowChainLayout
  - captureIframeScreenshot — try Rust IPC first → SVG-foreignObject canvas same-origin fallback → null (never throws)
  - capture_route_screenshot Tauri IPC — registered in lib.rs handler list (stub returning Err, real impl deferred); wave-2 → wave-3 serialization compliance APPENDED after 13-03's find_substrate_by_intent
  - useScreenshotStore — Zustand cache keyed by uuid, used by ScreenCard isFocused branch
  - ScreenCard isFocused branch — non-focused flows render cached screenshot <img>; focused flows render live iframe + AtomChipOverlay
  - postMessage protocol with requestId nonce + 500ms timeout + leak-safe listener cleanup — replaces same-origin shortcut blocked across :1420/:3000
  - public/contract-chip-responder.js (demo repo, separate git repo) — vanilla-JS responder loaded via `<Script strategy="afterInteractive">` in src/app/layout.tsx
affects:
  - 13-07 (citation halo can flash chips inside FlowChainLayout uniformly)
  - 13-08 (PR review animates the chain — chain must exist)
  - 13-09 (Sync animation pulses up the chain — chain must exist)
  - 13-11 (rehearsal — Phase 9 BABEL-01 + BACKEND-FM-01 contract-gap surfaces)
  - 14 (data realism — ServiceCard uuid-as-name fallback when contract `name` absent → Phase 14 populates)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-function assembler + react-flow node/edge emit — assembleFlowChain takes (memberUuids, allNodes, focusedFlowUuid, thisFlowUuid) → {nodes, edges}, deterministic positions, no side effects, vitest-coverable in node env without DOM"
    - "Cross-origin postMessage protocol with requestId nonce + timeout + listener cleanup — IDE :1420 ↔ demo :3000; replaces direct contentDocument access blocked by same-origin policy across ports"
    - "Three-tier screenshot fallback (Rust IPC → SVG-foreignObject canvas → null) — never throws; downstream consumers (ScreenCard non-focused branch) render existing 'Capturing screenshot…' placeholder when null"
    - "Memoized Zustand selector for graph-store filtered subscriptions — `useGraphStore((s) => s.nodes)` then `useMemo` derive filter; AVOID inline `.filter()` in selector (returns fresh reference each render → useSyncExternalStore infinite retry → canvas crash)"
    - "Wave 2 → Wave 3 serialization (append-only handler list in lib.rs) — `capture_route_screenshot` appended AFTER 13-03's `find_substrate_by_intent`; nodeTypes.ts UNTOUCHED (owned by Wave 2)"

key-files:
  created:
    - "contract-ide/src/lib/flowChainAssembler.ts (assembleFlowChain + deriveCallShape pure functions)"
    - "contract-ide/src/components/graph/CallShapeEdge.tsx (smooth-step + EdgeLabelRenderer with matched/muted styling)"
    - "contract-ide/src/components/graph/edgeTypes.ts (callShape registration)"
    - "contract-ide/src/components/graph/__tests__/flowChainAssembler.test.ts (15 vitest cases)"
    - "contract-ide/src/components/graph/FlowChainLayout.tsx (top-level vertical chain component)"
    - "contract-ide/src/lib/iframeScreenshot.ts (captureIframeScreenshot — Rust IPC → SVG-foreignObject → null fallback)"
    - "contract-ide/src/store/screenshots.ts (useScreenshotStore Zustand cache)"
    - "contract-ide/src-tauri/src/commands/screenshot.rs (capture_route_screenshot stub IPC)"
  modified:
    - "contract-ide/src/components/graph/GraphCanvasInner.tsx (selectedFlowUuid branch → FlowChainLayout)"
    - "contract-ide/src/components/graph/ScreenCard.tsx (isFocused branch — live iframe vs cached screenshot)"
    - "contract-ide/src/components/graph/AtomChipOverlay.tsx (memoized Zustand selector — broke infinite render loop)"
    - "contract-ide/src/lib/iframeChipPositioning.ts (postMessage protocol with requestId nonce + 500ms timeout + leak-safe cleanup)"
    - "contract-ide/src/lib/__tests__/iframeChipPositioning.test.ts (extended for nonce/timeout/cleanup)"
    - "contract-ide/src-tauri/src/lib.rs (capture_route_screenshot handler appended after find_substrate_by_intent)"
    - "contract-ide/src-tauri/src/commands/mod.rs (screenshot module registration)"

key-decisions:
  - "13-06 approved with three Rule 1 deviations caught during user verification — infinite render loop, cross-origin chip rects, cross-origin screenshot. All fixed inline; no architectural changes."
  - "Cross-origin postMessage protocol replaces 13-05's same-origin direct DOM access shortcut — IDE :1420 ↔ demo :3000 are different origins; original shortcut blocked by same-origin policy. New protocol uses requestId nonce + 500ms timeout + leak-safe listener cleanup; demo-side responder script (separate repo, commit 6b0ceb1) loaded via <Script strategy='afterInteractive'>."
  - "captureIframeScreenshot rewritten as three-tier never-throws fallback — Rust IPC capture_route_screenshot (currently stub, real impl post-13-13 polish) → SVG-foreignObject canvas trick wrapped in try/catch → null. ScreenCard isFocused=false branch renders existing 'Capturing screenshot…' placeholder when null. Beat 4 two-flow case gains true screenshot fidelity when Rust IPC implemented."
  - "AtomChipOverlay memoized selector fix — `useGraphStore((s) => s.nodes.filter(...))` returned fresh array reference each render → useSyncExternalStore snapshot inequality → infinite retry → canvas crash. Fix: subscribe to stable `s.nodes`, derive L4 filter via useMemo. Audited all sibling graph components — AtomChipOverlay was the only offender."
  - "Phase 14 handoff — ServiceCard renders raw uuid (e.g. e7000000-0000-4000-8000-000000000000) when contract's `name` frontmatter field is absent or equals the uuid. Correct defensive fallback; demo-realism contract data is Phase 14's responsibility (codebase-to-contracts bootstrap skill populates human-readable names)."
  - "Phase 9 BABEL-01 contract gap surfaced for plan 13-11 rehearsal — chips render only if demo build emits `data-contract-uuid` on JSX. If absent, postMessage responder returns empty rects → no chips, no crash. 13-11 must verify BABEL-01 ships before recording."
  - "Phase 9 BACKEND-FM-01 fallback verified — call-shape edge labels show `?` italic-muted when prev `## Outputs` or next `## Inputs` sections are missing. Legal CHAIN-02 fallback. 13-11 will surface uncovered participants."
  - "Wave 2 → Wave 3 serialization compliance — appended `capture_route_screenshot` to lib.rs handler list AFTER 13-03's `find_substrate_by_intent`; nodeTypes.ts UNTOUCHED (owned by Wave 2)."
  - "Demo repo (contract-ide-demo) commit 6b0ceb1 currently on detached HEAD — preexisting condition (NOT caused by this session); user to fast-forward master if desired."

patterns-established:
  - "Pure-function assembler for react-flow layouts — keep node/edge emit logic in node-env-testable pure functions (no DOM, no react-flow runtime); component shells only mount results"
  - "Cross-origin postMessage with requestId + timeout + cleanup — use any time the IDE talks to a separately-served frontend; the protocol shape (request type + nonce, response type + nonce + payload, 500ms timeout, listener removal in finally) is reusable for future cross-origin scenarios"
  - "Three-tier never-throws screenshot — try native (Tauri IPC) → try canvas trick → null; downstream renders existing placeholder. AVOID throwing across the React boundary; AVOID console.error spam (warnings only on canvas-tainted, silent fall-through on others)"
  - "Stable Zustand selector + useMemo derivation — when filtering or transforming store output, subscribe to stable references and derive in useMemo; never put `.filter()` / `.map()` inline in the selector function"

requirements-completed: [CHAIN-01, CHAIN-02, CARD-01, CHIP-01, CHIP-02]

# Metrics
duration: ~95min  # cumulative across initial run + checkpoint deviations + user verification
completed: 2026-04-25
---

# Phase 13 Plan 06: FlowChainLayout + Cross-Origin Postmessage Fix Summary

**Vertical participant chain layout (assembleFlowChain + CallShapeEdge + iframe→screenshot fallback) wired through GraphCanvasInner; three Rule 1 deviations caught during user verification (AtomChipOverlay infinite render loop, cross-origin postMessage protocol with requestId nonce + 500ms timeout, three-tier never-throws screenshot fallback) shipped inline; user approved.**

## Performance

- **Duration:** ~95min (cumulative — initial Tasks 1+2 ~50min, three deviation fixes during checkpoint ~30min, doc finalization ~15min)
- **Completed:** 2026-04-25
- **Tasks:** 3 of 3 (Task 3 checkpoint:human-verify approved after three Rule 1 fixes)
- **Files created:** 8
- **Files modified:** 7

## Accomplishments

- `assembleFlowChain(memberUuids, allNodes, focusedFlowUuid, thisFlowUuid)` — pure function emitting deterministic react-flow nodes (screenCard for UI triggers, serviceCard everywhere else) + edges (callShape type, deriveCallShape data). 15 vitest cases (ordering, kind dispatch, missing-uuid skip, deterministic positions, deriveCallShape matched/mismatched/missing).
- `deriveCallShape(prevBody, nextBody)` — parses BACKEND-FM-01 sections, returns `{ label, matched }`. Matched-keys label `{ field, field }` for shared JSON keys; `?` muted fallback for missing/mismatched.
- `CallShapeEdge` — react-flow custom edge with smooth-step path + EdgeLabelRenderer; matched-vs-muted CSS classes drive visual distinction.
- `edgeTypes.ts` — module-scope const with `callShape: CallShapeEdge` (Phase 3 Pitfall 1 — never inline in JSX).
- `FlowChainLayout` — reads useSidebarStore.selectedFlowUuid + useGraphStore.nodes; assembles via flowChainAssembler; mounts ReactFlow with `nodesDraggable={false}` (deterministic chain layout). Renders empty-state copy when no flow selected.
- `GraphCanvasInner` — added `selectedFlowUuid` branch — when set, returns `<FlowChainLayout />`; otherwise existing default rendering preserved.
- `captureIframeScreenshot` — three-tier fallback: (1) `invoke('capture_route_screenshot', { url })` (currently stub returning Err; real impl post-13-13 polish), (2) SVG-foreignObject canvas trick wrapped in try/catch, (3) `return null`. Never throws across React boundary.
- `capture_route_screenshot` Tauri IPC — registered in lib.rs handler list AFTER 13-03's `find_substrate_by_intent` (Wave 2 → Wave 3 serialization compliance); stub returns `Err("not implemented; rely on JS-side fallback")`.
- `useScreenshotStore` — Zustand cache `Map<uuid, dataUrl>` with stable map identity for per-key memoization.
- `ScreenCard.isFocused` branch — focused flows render live iframe + AtomChipOverlay; non-focused render cached screenshot or existing "Capturing screenshot…" placeholder when null.
- Three Rule 1 deviation fixes during checkpoint (see Deviations section).

## Task Commits

1. **Task 1: assembleFlowChain pure function + CallShapeEdge + edgeTypes** — `cab5679` (feat)
2. **Task 2: FlowChainLayout + iframe screenshot + GraphCanvasInner integration** — `c4a1388` (feat)
3. **Task 3: Checkpoint:human-verify** — APPROVED after three deviation fixes:
   - Rule 1 fix: AtomChipOverlay infinite render loop — `24f1b40` (fix)
   - Rule 1 fix: postMessage cross-origin chip rects + graceful screenshot fallback — `1e0d9b6` (fix)
   - Demo-side responder script — `6b0ceb1` (separate contract-ide-demo repo, currently on detached HEAD)

_Plan metadata commit follows this SUMMARY (docs)._

## Files Created/Modified

**Created:**
- `contract-ide/src/lib/flowChainAssembler.ts` — `assembleFlowChain` + `deriveCallShape` pure functions; emits Node/Edge with screenCard-vs-serviceCard dispatch (i==0 && kind=='ui' → screenCard, else serviceCard); `VERTICAL_GAP=120` + height-estimated y-stepping (440px screenCard / 200px serviceCard).
- `contract-ide/src/components/graph/CallShapeEdge.tsx` — `memo()`-wrapped; `getSmoothStepPath` + `EdgeLabelRenderer`; matched vs muted CSS via `data?.matched === false`.
- `contract-ide/src/components/graph/edgeTypes.ts` — module-scope `as const` registry.
- `contract-ide/src/components/graph/__tests__/flowChainAssembler.test.ts` — 15 vitest cases (assembleFlowChain ordering, kind dispatch, screenCard for UI trigger, serviceCard for API trigger, missing-uuid skip, deterministic positions, edge count, edge id format, focusedFlowUuid pass-through; deriveCallShape matched JSON keys, no-shared-keys returns `?`, missing-sections returns `?`, non-JSON truncation, empty-body handling, undefined-input defensive).
- `contract-ide/src/components/graph/FlowChainLayout.tsx` — top-level component; reads useSidebarStore.selectedFlowUuid + useGraphStore.nodes; assembles via `useMemo`; mounts ReactFlow with `nodeTypes` + `edgeTypes` + `nodesDraggable={false}` + `proOptions={{ hideAttribution: true }}`.
- `contract-ide/src/lib/iframeScreenshot.ts` — three-tier fallback: try `invoke('capture_route_screenshot', { url })` first, catch all errors and warn-log; then try SVG-foreignObject canvas trick wrapped in `try { canvas.toDataURL() } catch { resolve(null) }`; final `return null`. Never throws.
- `contract-ide/src/store/screenshots.ts` — `useScreenshotStore` Zustand store with `cache: Map<string, string>` and `setScreenshot(uuid, dataUrl)` action; uses fresh-Map pattern for per-key memoization.
- `contract-ide/src-tauri/src/commands/screenshot.rs` — `#[tauri::command] async fn capture_route_screenshot(_url: String) -> Result<String, String>` returning `Err("capture_route_screenshot not implemented; rely on JS-side same-origin canvas".to_string())`. Real impl deferred to post-13-13 polish.

**Modified:**
- `contract-ide/src/components/graph/GraphCanvasInner.tsx` — added `useSidebarStore((s) => s.selectedFlowUuid)` read; if set, returns `<FlowChainLayout />` early; otherwise existing default rendering preserved (L0/L1/L2/L3/L4 graph carries forward unchanged for non-flow contexts).
- `contract-ide/src/components/graph/ScreenCard.tsx` — added `isFocused` read from data; `loadState === 'reachable'` branch splits on `isFocused`: live iframe + AtomChipOverlay when true, `<img src={cachedScreenshot} />` (or existing "Capturing screenshot…" placeholder when null) when false; `iframe.onload` handler triggers `captureIframeScreenshot` + `useScreenshotStore.getState().setScreenshot(d.uuid, dataUrl)` for focused branch.
- `contract-ide/src/components/graph/AtomChipOverlay.tsx` — memoized selector fix (Rule 1 deviation): replaced `useGraphStore((s) => s.nodes.filter((n) => n.parent_uuid === parentUuid && n.level === 'L4'))` (fresh array each render → infinite useSyncExternalStore retry) with `const allNodes = useGraphStore((s) => s.nodes); const atoms = useMemo(() => allNodes.filter(...), [allNodes, parentUuid])`. Audited sibling components — AtomChipOverlay was sole offender.
- `contract-ide/src/lib/iframeChipPositioning.ts` — replaced 13-05 same-origin direct DOM access shortcut with true postMessage protocol: requestId nonce (`crypto.randomUUID()`), 500ms timeout, listener cleanup in `finally`. Iframe responder must handle `{ type: 'request-chip-rects', requestId }` → reply `{ type: 'chip-rects', requestId, rects: [...] }`. Cross-origin (:1420 ↔ :3000) compliant.
- `contract-ide/src/lib/__tests__/iframeChipPositioning.test.ts` — extended for requestId nonce match, 500ms timeout returning `[]`, listener cleanup verification (addEventListener call count == removeEventListener call count).
- `contract-ide/src-tauri/src/lib.rs` — appended `commands::screenshot::capture_route_screenshot` to the `tauri::generate_handler!` list AFTER 13-03's `commands::substrate::find_substrate_by_intent` (Wave 2 → Wave 3 serialization compliance — append-only).
- `contract-ide/src-tauri/src/commands/mod.rs` — `pub mod screenshot;` registration.

## Decisions Made

### Three-tier never-throws screenshot fallback

Original Task 2 implementation did direct iframe-document canvas capture which throws across origins (the IDE's :1420 iframe pointing to demo's :3000 page). Rewritten to (1) try Rust IPC `capture_route_screenshot` (currently a stub returning Err — real impl deferred to post-13-13 polish where macOS CGDisplay or headless WebKit ships), (2) fall back to same-origin SVG-foreignObject canvas trick wrapped in try/catch (works for genuinely same-origin localhost cases), (3) return null and let ScreenCard render its existing "Capturing screenshot…" placeholder. **Never throws across the React boundary.** Beat 4 two-flow case gains true screenshot fidelity once the Rust IPC implementation lands.

### Cross-origin postMessage protocol (replaces 13-05 same-origin shortcut)

13-05's `requestChipRects` took a "same-origin direct contentDocument access (postMessage fallback)" shortcut that the same-origin policy blocks across :1420 (IDE) and :3000 (demo) ports. The fix re-implements the helper as a true postMessage protocol with `requestId` nonce + 500ms timeout + leak-safe listener cleanup. Demo-side responder is a vanilla-JS file `public/contract-chip-responder.js` loaded from the demo's `src/app/layout.tsx` via `<Script strategy="afterInteractive">`. The contract-ide-demo repo is a SEPARATE git repo from contract-ide; its commit `6b0ceb1` is currently on detached HEAD (preexisting state, NOT caused by this session) — flagged for the user to fast-forward master if desired.

### AtomChipOverlay memoized selector — sole offender audit

`useGraphStore((s) => s.nodes.filter((n) => n.parent_uuid === parentUuid && n.level === 'L4'))` returned a fresh array reference each render → React's `useSyncExternalStore` saw snapshot inequality and infinitely retried, crashing the canvas under FlowChainLayout mount. Fixed by subscribing to stable `s.nodes` and deriving the L4 filter via `useMemo([allNodes, parentUuid])`. **Audited all sibling graph components** — `GraphCanvasInner`, `FlowChainLayout`, `ContractNode`, `GroupNode`, `ServiceCard`, `ServiceCardChips`, `ScreenCard` — none had the same anti-pattern; AtomChipOverlay was the only offender.

### Phase 14 handoff — ServiceCard uuid-as-name fallback

User-flagged during verification: ServiceCard renders raw uuid (e.g. `e7000000-0000-4000-8000-000000000000`) when a contract's `name` frontmatter field is absent or equals the uuid. **This is correct defensive fallback** — current contract corpus lacks human-readable `name` fields on all nodes; ServiceCard reads `data.name` and falls through to uuid when absent. Phase 14 (codebase-to-contracts bootstrap skill + demo target) populates human-readable names as part of the data realism work. NOT a 13-06 bug.

### Phase 9 contract gaps surfaced for plan 13-11 rehearsal

- **BABEL-01 (Phase 9 SC 6):** Chips render only if demo build emits `data-contract-uuid` on JSX. If the Babel plugin output is absent, the postMessage responder returns an empty rects array → no chips, no crash. Plan 13-11 must verify Phase 9 BABEL-01 ships against the seeded `contract-ide-demo` build before recording the demo.
- **BACKEND-FM-01 (Phase 9 SC 8):** Call-shape edge labels show `?` italic-muted when the previous participant's `## Outputs` or the next participant's `## Inputs` sections are missing. This is a legal CHAIN-02 fallback. Plan 13-11 will surface uncovered participants during rehearsal — any chain link showing `?` indicates a missing BACKEND-FM-01 section that the seeded fixture should populate.

### Wave 2 → Wave 3 serialization compliance

Per the plan's frontmatter, Wave 3 (13-06) appends `capture_route_screenshot` to the `tauri::generate_handler!` list AFTER Wave 2 plan 13-03's `find_substrate_by_intent` entry. **`nodeTypes.ts` is UNTOUCHED** (owned by Wave 2 — both `serviceCard` (13-04) and `screenCard` (13-05) entries already present and preserved). The frontend `edgeTypes.ts` is a NEW file unique to 13-06 (no Wave 2 collision possible).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] AtomChipOverlay infinite render loop**
- **Found during:** Task 3 (checkpoint:human-verify) — canvas crash on first FlowChainLayout mount
- **Issue:** `useGraphStore((s) => s.nodes.filter((n) => n.parent_uuid === parentUuid && n.level === 'L4'))` returned a fresh array reference each render → React's `useSyncExternalStore` saw snapshot inequality and infinitely retried → canvas crashed
- **Fix:** Subscribe to stable `s.nodes`, derive L4 filter via `useMemo([allNodes, parentUuid])`. Audited all sibling graph components — AtomChipOverlay was the only offender.
- **Files modified:** `contract-ide/src/components/graph/AtomChipOverlay.tsx`
- **Verification:** Canvas mounts cleanly under FlowChainLayout; vitest 82 pass + 1 skipped baseline preserved; tsc clean
- **Committed in:** `24f1b40`

**2. [Rule 1 - Bug] Cross-origin DOM access in postMessage protocol**
- **Found during:** Task 3 (checkpoint:human-verify) — chips never rendered against demo iframe
- **Issue:** IDE serves on :1420, demo on :3000. Original Task 1 implementation took a "same-origin direct DOM access (postMessage fallback)" shortcut that the same-origin policy blocks across these ports. SecurityError thrown synchronously, fallback path never triggered as designed.
- **Fix:** Re-implemented `requestChipRects` as a true postMessage protocol with `requestId` nonce (crypto.randomUUID), 500ms timeout, leak-safe listener cleanup in `finally` block. Accompanied by vanilla-JS responder script `public/contract-chip-responder.js` loaded from demo's `src/app/layout.tsx` via `<Script strategy="afterInteractive">`.
- **Files modified:** `contract-ide/src/lib/iframeChipPositioning.ts`, `contract-ide/src/lib/__tests__/iframeChipPositioning.test.ts`, `contract-ide/src/components/graph/AtomChipOverlay.tsx`, `contract-ide/src/components/graph/ScreenCard.tsx` (IDE-side); `public/contract-chip-responder.js` + `src/app/layout.tsx` (demo-side, separate repo commit `6b0ceb1`)
- **Verification:** Chips render at expected coordinates against running demo build; vitest 82 pass + 1 skipped; tsc clean
- **Committed in:** `1e0d9b6` (IDE-side); `6b0ceb1` (demo-side, separate contract-ide-demo repo currently on detached HEAD — preexisting condition, NOT caused by this session)

**3. [Rule 1 - Bug] Cross-origin canvas screenshot**
- **Found during:** Task 3 (checkpoint:human-verify) — non-focused ScreenCard threw on screenshot capture
- **Issue:** `captureIframeScreenshot` previously did direct iframe-document canvas capture which throws across origins (canvas-tainting). Beat 4 two-flow case crashed.
- **Fix:** Rewrote to three-tier never-throws fallback — (1) try Rust IPC `capture_route_screenshot` (still a stub returning Err — real impl deferred to post-13-13), (2) fall back to same-origin SVG-foreignObject canvas trick wrapped in try/catch, (3) return null and let ScreenCard render its existing "Capturing screenshot…" placeholder. Never throws across React boundary.
- **Files modified:** `contract-ide/src/lib/iframeScreenshot.ts`
- **Verification:** Two-flow case mounts cleanly; non-focused branch shows placeholder; no crashes; vitest baseline preserved; tsc clean
- **Committed in:** `1e0d9b6` (combined with deviation #2)

---

**Total deviations:** 3 auto-fixed (3 Rule 1 bugs)
**Impact on plan:** All three fixes essential for cross-origin operation under the demo's two-port topology. No scope creep — all changes preserve the plan's spec; the original implementations made same-origin assumptions that the actual demo topology violates.

## Issues Encountered

- Demo repo (contract-ide-demo) commit `6b0ceb1` is currently on detached HEAD. **This is preexisting state (NOT caused by this session)**; the responder-script commit landed on the detached HEAD where the user was working. Surfaced for user to fast-forward master if desired.
- `capture_route_screenshot` Rust IPC ships as a stub returning Err — full implementation (macOS CGDisplay or headless WebKit) deferred to post-13-13 polish. Beat 4 two-flow case currently relies on the SVG-foreignObject same-origin canvas trick or null fallback (placeholder), not true native screenshots. Acceptable for demo scope per ROADMAP iframe perf budget; user verified visually.

## User Setup Required

None — no external service configuration required for IDE-side. Demo-side responder script ships as a static asset in the contract-ide-demo repo's `public/` directory; loaded automatically via `<Script strategy="afterInteractive">` in `src/app/layout.tsx`.

## Next Phase Readiness

Wave 4 plans now unblocked:
- **13-07 (SourceArchaeologyModal — autonomous):** Citation halo can `document.querySelector('[data-atom-uuid="..."]')` against chips inside FlowChainLayout uniformly (same selector pattern as plans 13-04 + 13-05).
- **13-08 (PRReviewPanel — autonomous):** PR-review animation pulses the chain — chain assembly now exists.
- **13-09 (Sync + Verifier + Harvest — checkpoint):** Sync animation pulses up the chain — chain assembly now exists; VerifierPanel orange-flag halo can target ScreenCard at the top of the chain via the existing focusedAtomUuid + selectedFlowUuid wiring.

**Phase 14 handoff:** ServiceCard uuid-as-name fallback when contract `name` field is missing — Phase 14 will populate human-readable names as part of the codebase-to-contracts bootstrap skill data realism work.

**Plan 13-11 rehearsal:** Surface Phase 9 BABEL-01 + BACKEND-FM-01 contract gaps if seeded fixture lacks `data-contract-uuid` annotations or backend frontmatter sections.

---
*Phase: 13-substrate-ui-demo-polish*
*Completed: 2026-04-25*

## Self-Check: PASSED

All 8 created files exist on disk:
- `contract-ide/src/lib/flowChainAssembler.ts`
- `contract-ide/src/components/graph/CallShapeEdge.tsx`
- `contract-ide/src/components/graph/edgeTypes.ts`
- `contract-ide/src/components/graph/__tests__/flowChainAssembler.test.ts`
- `contract-ide/src/components/graph/FlowChainLayout.tsx`
- `contract-ide/src/lib/iframeScreenshot.ts`
- `contract-ide/src/store/screenshots.ts`
- `contract-ide/src-tauri/src/commands/screenshot.rs`

All 4 task commits found in git history:
- `cab5679` (Task 1: assembleFlowChain + CallShapeEdge + edgeTypes)
- `c4a1388` (Task 2: FlowChainLayout + iframe screenshot + GraphCanvasInner integration)
- `24f1b40` (Rule 1 fix: AtomChipOverlay infinite render loop)
- `1e0d9b6` (Rule 1 fix: postMessage cross-origin chip rects + graceful screenshot fallback)
