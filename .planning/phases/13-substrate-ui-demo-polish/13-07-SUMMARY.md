---
phase: 13-substrate-ui-demo-polish
plan: 07
subsystem: ui
tags: [zustand, shadcn-dialog, tauri-ipc, citation-halo, source-archaeology]

# Dependency graph
requires:
  - phase: 13-substrate-ui-demo-polish
    provides: getSubstrateNodeDetail IPC + SubstrateNodeSummary wire shape (plan 13-01)
  - phase: 13-substrate-ui-demo-polish
    provides: ServiceCard with cardKindStyles (plan 13-04)
  - phase: 13-substrate-ui-demo-polish
    provides: ScreenCard with screenCardStyles + AtomChip with chipStyles (plan 13-05)
  - phase: 13-substrate-ui-demo-polish
    provides: FlowChainLayout mounted under GraphCanvasInner (plan 13-06)
  - phase: 07-drift-detection-watcher-path
    provides: shadcn Dialog primitive (Phase 7 Plan 07-04)
provides:
  - useCitationStore — Zustand store with highlightedUuid (auto-clearing 2s timer) + openCitationUuid + highlight + openCitation + closeCitation + clearHighlight
  - SubstrateCitation — inline `[short-label]` pill with haloOnClick prop (default true)
  - SourceArchaeologyModal — shadcn Dialog rendering kind / state / actor / confidence / verbatim_quote / session:turn_ref
  - citationHaloClass — additive Tailwind class string exported from contractNodeStyles.ts (blue-300 ring + 12px glow + scale-1.02)
  - Halo subscriber wiring on ServiceCard, ScreenCard, AtomChip (stable primitive selector + additive class)
  - SourceArchaeologyModal mounted in Inspector.tsx (single Dialog instance for all citations app-wide)
affects:
  - 13-08 (PRReviewPanel can render SubstrateCitation pills inside intent summaries; halo will land on chain participants automatically)
  - 13-09 (Sync + Verifier — verifier orange-flag panel can render SubstrateCitation for cited rules; the same modal opens)
  - 13-10 (fixture validation MUST populate verbatim_quote on every demo-clicked uuid — amber warning surfaces missing-quote nodes)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single-store coordination of two related UI behaviours (modal + halo) — one click sets both atomically; subscribers select discrete slices and never see half-updated state"
    - "Closure-scoped non-reactive timeoutHandle inside Zustand factory — auto-clearing transient state without leaking through the store interface (only set() drives renders; the handle is captured by the create() callback)"
    - "Additive-class halo (NOT a CVA variant) — orthogonal to semantic state rings (substrate / drift / rollup) so a haloed-AND-drifted node renders BOTH effects without compoundVariants explosion"
    - "Stable primitive Zustand selector pattern (per 13-06 SUMMARY lesson): subscribers read `(s) => s.highlightedUuid` (a string-or-null primitive, not a derived collection) so useSyncExternalStore snapshot equality holds and the canvas-crash retry loop is impossible by construction"
    - "Single-instance portaled Dialog — SourceArchaeologyModal mounts once under the Inspector tree; citation pills anywhere in the app trigger the same Dialog via the openCitationUuid slice (no per-citation modal forest)"

key-files:
  created:
    - "contract-ide/src/store/citation.ts (useCitationStore — 60 LOC)"
    - "contract-ide/src/components/inspector/SubstrateCitation.tsx (memoised inline pill)"
    - "contract-ide/src/components/inspector/SourceArchaeologyModal.tsx (shadcn Dialog + getSubstrateNodeDetail fetch)"
  modified:
    - "contract-ide/src/components/graph/contractNodeStyles.ts (added citationHaloClass export — additive Tailwind string, not a CVA variant)"
    - "contract-ide/src/components/graph/ServiceCard.tsx (subscribed to useCitationStore.highlightedUuid + appended citationHaloClass when haloed)"
    - "contract-ide/src/components/graph/ScreenCard.tsx (subscribed to useCitationStore.highlightedUuid + appended citationHaloClass when haloed)"
    - "contract-ide/src/components/graph/AtomChip.tsx (subscribed to useCitationStore.highlightedUuid + appended citationHaloClass; preserved orthogonal Cmd+P focused ring)"
    - "contract-ide/src/components/layout/Inspector.tsx (mounted <SourceArchaeologyModal /> alongside CherrypickModal)"

key-decisions:
  - "ONE Zustand store coordinates modal + halo — a single click on a citation pill sets both openCitationUuid (modal) and highlightedUuid (halo) atomically; splitting into two stores would surface intermediate states (modal opens before halo fires, or vice versa) that never need to be observable"
  - "citationHaloClass is an additive Tailwind class string, not a CVA variant — keeps it orthogonal to substrate/drift/rollup state rings so a haloed superseded atom shows BOTH the orange-400 muted ring AND the blue-300 halo simultaneously, by design (the halo is a transient interaction marker; substrate state is persistent semantic)"
  - "Stable primitive selector pattern — `useCitationStore((s) => s.highlightedUuid)` returns string|null (a primitive); useSyncExternalStore snapshot equality holds; the AtomChipOverlay class of bug from 13-06 cannot recur here"
  - "shortLabel ?? uuid.slice(0, 16) fallback on SubstrateCitation pill — ensures the pill always renders something readable even when the calling code doesn't yet know the substrate node's slug; the modal then reveals the canonical name"
  - "Amber 'No verbatim quote on this node' warning instead of silent collapse — surfaces hand-seeded fixture rows during plan 13-10 demo prep so we don't discover missing quotes on stage; the warning explicitly references Pitfall 4 in 13-RESEARCH.md so the fix is traceable"
  - "Inspector mounts a SINGLE SourceArchaeologyModal — Dialog is portaled, so any citation pill anywhere in the React tree (verifier panel, intent summary, side panels) triggers the same modal via the store; avoids a per-citation Dialog forest with N independent open states"
  - "haloOnClick prop on SubstrateCitation defaults to true (Beat 3 sidebar usage) but can be disabled — anticipates an in-modal back-reference citation that would otherwise self-halo"

patterns-established:
  - "Coordinate-related-UI-behaviours-in-one-store: when two UI surfaces ALWAYS update together (modal open + halo flash), put both slices on one store with one action that sets both — keeps the action surface tight and avoids subscribers seeing inconsistent intermediate state"
  - "Additive-class halo over CVA: any transient interaction marker (citation halo, future hover-glow, future drag-target indicator) should be an exported class string, not a CVA variant — keeps the semantic-state CVAs (cardKindStyles, screenCardStyles, chipStyles) free of interaction noise and lets the two compose without compoundVariants"
  - "Closure-scoped timer inside Zustand factory: when the store needs auto-clearing transient state (halos, toasts, transient flashes), capture the timeout handle in the factory closure — it's mutable but non-reactive (only the set() call drives renders), and rapid-fire actions can cancel previous timeouts cleanly"

requirements-completed:
  - SUB-08

# Metrics
duration: ~2 min 30 sec
completed: 2026-04-25
---

# Phase 13 Plan 07: Source-Archaeology Modal + Citation Halo Summary

**`[source]` citation surface — clicking a SubstrateCitation pill opens a shadcn Dialog with verbatim quote + provenance (fetched via Phase 13 Plan 01's getSubstrateNodeDetail IPC) AND ripples a 2s blue halo across the corresponding ServiceCard / ScreenCard / AtomChip in the chain. One Zustand store coordinates both behaviours; an additive Tailwind halo class composes orthogonally with substrate / drift / rollup state rings.**

## Performance

- **Duration:** ~2 min 30 sec (autonomous; no checkpoint deviations)
- **Completed:** 2026-04-25
- **Tasks:** 2 of 2
- **Files created:** 3
- **Files modified:** 5

## Accomplishments

- **`useCitationStore`** — Zustand store with `highlightedUuid` (auto-clears after 2000ms), `openCitationUuid` (modal target), and four actions (`highlight`, `openCitation`, `closeCitation`, `clearHighlight`). Closure-scoped `timeoutHandle` cancels previous timeouts on rapid clicks so each citation produces a fresh 2s pulse.
- **`SubstrateCitation`** — memoised inline `[short-label]` pill component. Click → `openCitation(uuid)` AND (when `haloOnClick`, default true) `highlight(uuid)`. `e.stopPropagation()` so a citation embedded inside a ServiceCard / ScreenCard never triggers an unintended node-selection.
- **`SourceArchaeologyModal`** — shadcn Dialog rendering: kind chip + state chip + actor + confidence + summary (when distinct from name) + verbatim quote (in a bordered `<blockquote>`) + `source: <session_id>:<turn_ref>` reference line. Cancellable fetch (cancelled flag in useEffect) so a rapid-fire close-then-open can't overwrite the new fetch with a stale one.
- **Missing-quote amber warning** — when `verbatim_quote` is null, the modal renders an explicit amber-bordered note referencing 13-RESEARCH Pitfall 4. Surfaces missing fixture data during plan 13-10 demo prep rather than silently collapsing the section.
- **`citationHaloClass`** — exported from `contractNodeStyles.ts` as an additive Tailwind class string (`ring-2 ring-blue-300 shadow-[0_0_12px_4px_rgba(96,165,250,0.4)] scale-[1.02] transition-all`). Not a CVA variant — composes additively over the existing state ring CVAs so a haloed-AND-drifted card shows both halos simultaneously.
- **ServiceCard / ScreenCard / AtomChip** — each subscribes to `useCitationStore((s) => s.highlightedUuid)` (stable primitive selector — no derived array, no useSyncExternalStore hazard) and appends `citationHaloClass` when `highlightedUuid === d.uuid`.
- **Inspector mount** — `<SourceArchaeologyModal />` mounted alongside the existing CherrypickModal in `Inspector.tsx`. Single instance app-wide; portaled Dialog so render position doesn't matter visually.

## Task Commits

1. **Task 1: useCitationStore + SubstrateCitation pill + SourceArchaeologyModal + Inspector mount** — `d7b0014` (feat)
2. **Task 2: citation halo wiring on ServiceCard / ScreenCard / AtomChip** — `0e109ad` (feat)

_Plan metadata commit follows this SUMMARY (docs)._

## Files Created/Modified

**Created:**
- `contract-ide/src/store/citation.ts` — `useCitationStore` with halo timer + modal slice (60 LOC, single create() factory).
- `contract-ide/src/components/inspector/SubstrateCitation.tsx` — `[short-label]` inline pill, memoised.
- `contract-ide/src/components/inspector/SourceArchaeologyModal.tsx` — shadcn Dialog + `getSubstrateNodeDetail` fetch with cancellable useEffect, kind/state/actor/confidence chips, verbatim_quote block, missing-quote amber warning, session:turn_ref reference line.

**Modified:**
- `contract-ide/src/components/graph/contractNodeStyles.ts` — added `citationHaloClass` export (additive Tailwind string, not a CVA variant). Adjacent to existing `resolveNodeState` so halo + state-ring imports come from the same module.
- `contract-ide/src/components/graph/ServiceCard.tsx` — imported `useCitationStore` + `citationHaloClass`; subscribed to `highlightedUuid` via stable primitive selector; appended halo class to outer `<div>` className via `cn(...)`.
- `contract-ide/src/components/graph/ScreenCard.tsx` — same pattern as ServiceCard; halo applied to the outer `screenCardStyles` div.
- `contract-ide/src/components/graph/AtomChip.tsx` — subscribed to `highlightedUuid`; preserved the existing orthogonal `focused` (Cmd+P) ring; halo appended via filter+join string composition (chipStyles is invoked positionally and its CVA already returns a class string, so I use `[...].filter(Boolean).join(' ')` to avoid re-importing `cn`).
- `contract-ide/src/components/layout/Inspector.tsx` — imported `SourceArchaeologyModal` and mounted it alongside `<CherrypickModal />` near the bottom of the JSX (single Dialog instance app-wide).

## Decisions Made

### One store coordinates modal + halo

The citation pill click sets BOTH `openCitationUuid` (modal target) AND `highlightedUuid` (halo target) — these are inseparably linked by the user's intent ("show me where this came from AND where it lives in the chain"). Splitting into two stores would have surfaced an intermediate state where one but not both has updated. A single store with one action (`open(uuid)` + `highlight(uuid)` called in the same onClick handler) keeps the React commit atomic and the subscriber semantics simple.

### `citationHaloClass` is additive, not a CVA variant

The card-level CVAs (`cardKindStyles`, `screenCardStyles`, `chipStyles`) own SEMANTIC state (drifted / intent_drifted / rollup_stale / superseded / etc.). Citation halo is a TRANSIENT INTERACTION MARKER — orthogonal axis. Adding it to the CVA would have required a new `halo: true|false` variant on each of the three CVAs PLUS compoundVariants for every (state × halo) combination — explosive surface area. An additive class string composes via `cn(...)` cleanly: a haloed-AND-drifted ServiceCard renders the red ring AND the blue glow simultaneously, by design.

### Stable primitive selector — 13-06 lesson applied prophylactically

Per the 13-06 SUMMARY, `useGraphStore((s) => s.nodes.filter(...))` returned a fresh array reference each render and crashed the canvas under FlowChainLayout via useSyncExternalStore retry. The citation halo subscriber pattern uses `useCitationStore((s) => s.highlightedUuid)` — a string|null PRIMITIVE — which is reference-stable across renders by definition. No derived collections, no useMemo workaround needed. This is the correct pattern; it's also been audited against the wave_serialization_context reminder.

### Closure-scoped non-reactive timeoutHandle

The 2s auto-clear timer is a side effect (setTimeout) that should NOT be in the React component tree (would cause the timer to be re-created on every render of any subscriber) and should NOT be in the store's reactive state (would cause every subscriber to re-render whenever the timer pointer changes). Capturing `timeoutHandle` in the closure of the `create()` factory keeps it mutable across actions but invisible to subscribers — only `set({ highlightedUuid })` drives renders. Rapid clicks cancel the previous timeout, so a second click within 1s produces a fresh 2s pulse, not a clipped one.

### Amber missing-quote warning, NOT silent collapse

Plan 13-10 fixture prep needs to populate `verbatim_quote` for every demo-clicked uuid. If the modal silently rendered nothing for missing quotes, a stale fixture would only be discovered on stage during the demo. The amber-bordered warning makes missing quotes obvious during rehearsal AND traces the cause back to 13-RESEARCH Pitfall 4 so the fix-owner knows where to look.

### `haloOnClick` defaults to true, but is opt-out

Beat 3 sidebar usage (the most common case) needs the halo. But an in-modal back-reference citation (e.g. "this decision was based on [other-decision]" rendered inside the SourceArchaeologyModal itself) would otherwise self-halo a card that's already covered by the open Dialog overlay. The opt-out lets future surfaces suppress the halo without changing the store API.

### Single SourceArchaeologyModal mounted in Inspector

Citation pills can appear anywhere — verifier output, intent summaries, sidebar, chat archaeology. Mounting one Dialog at the Inspector level (a stable always-present container) and routing all pills through the store's `openCitationUuid` slice means there's exactly one Dialog instance handling all citations app-wide. Portaled by Radix, so render-tree position doesn't affect visual placement.

## Deviations from Plan

None — plan executed exactly as written. The plan's `<files>` block referenced `contract-ide/src/components/inspector/Inspector.tsx`, but the actual Inspector lives at `contract-ide/src/components/layout/Inspector.tsx` (it's a layout-level component, not an inspector subpanel). Mounted there per the plan's intent ("Add `<SourceArchaeologyModal />` as a sibling to the existing tabs panel — it's a portaled Dialog so render position doesn't matter visually"). No functional deviation; just a path correction.

## SubstrateCitation API contract (for plan 13-09 verifier)

Plan 13-09's verifier panel will render `[source]` pills next to each cited rule. Use:

```tsx
import { SubstrateCitation } from '@/components/inspector/SubstrateCitation';

// In the verifier rendering:
<SubstrateCitation uuid={citedRule.uuid} shortLabel={citedRule.slug} />
```

- `uuid` — required; substrate node uuid the citation points at.
- `shortLabel` — optional; falls back to `uuid.slice(0, 16)` (rendered with brackets, e.g. `[abc12345-6789-...]`). For demo polish, prefer the substrate node's slug or short name.
- `haloOnClick` — defaults to `true`. Leave default unless rendering inside a Dialog that's already covering the haloed card.

The pill is `inline-flex` with `e.stopPropagation()`, so it can be embedded directly in `<p>` / `<li>` / `<span>` content without breaking layout or triggering parent click handlers.

## Deferred items

- **Monaco deep-link to source-session turn** — the plan's "must_haves" mentioned an "Open in Monaco" affordance using the Phase 4 Plan 04-01 `setHiddenAreas` pattern to scroll to the citation's anchor. The plan's `<action>` block did NOT instruct implementing this in either task, and the research notes flagged it as v2 polish. The inline verbatim quote satisfies SC 7's ≤5s click-to-readable bar without needing Monaco navigation. **Deferred to a future polish pass; not blocking the demo.**

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required. The modal fetches over the existing `getSubstrateNodeDetail` Tauri IPC; the store is pure in-memory state.

## Next Phase Readiness

Wave 4 sibling 13-08 (PRReviewPanel) is unblocked: any citation rendered inside the PR review surface routes through `useCitationStore.openCitation` and triggers the halo on the chain participant automatically. No coordination overhead needed.

Plan 13-09 (Sync + Verifier + Harvest) can render `<SubstrateCitation />` pills directly in the verifier output. The single SourceArchaeologyModal at Inspector root will handle all citations.

**Plan 13-10 fixture validation TODO:** for every demo-clicked substrate uuid, verify `substrate_nodes.source_quote` is populated. Any node showing the amber "No verbatim quote" warning during rehearsal must be repopulated before recording.

---
*Phase: 13-substrate-ui-demo-polish*
*Completed: 2026-04-25*

## Self-Check: PASSED

All 3 created files exist on disk; both task commits (d7b0014, 0e109ad) found in git history. tsc --noEmit clean; vitest 86 pass + 1 skipped.
