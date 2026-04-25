---
phase: 13-substrate-ui-demo-polish
plan: 03
subsystem: ui
tags: [cmdk, tauri-ipc, fts5, bm25, debounce, intent-search, navigation, sub-08]

# Dependency graph
requires:
  - phase: 13-substrate-ui-demo-polish
    provides: useGraphStore.focusedAtomUuid + setFocusedAtomUuid action (plan 13-01)
  - phase: 13-substrate-ui-demo-polish
    provides: useSidebarStore.setSelectedFlow (plan 13-02 — sidebar flow selection)
  - phase: 03-graph-canvas
    provides: useGraphStore.pushParent + selectNode + parentUuidStack
  - phase: 05-mcp-server-sidecar
    provides: nodes_fts FTS5 virtual table (contract content) + bm25() ranking
  - phase: 11-distiller-constraint-store-contract-anchored-retrieval
    provides: substrate_nodes_fts FTS5 + substrate_nodes table + anchored_uuids JSON column
  - phase: 09-mass-edit-non-coder-mode-demo-repo-seeding
    provides: build_fts_or_query OR-tokenizer pattern (mass_edit.rs)
provides:
  - find_substrate_by_intent Rust IPC unifying nodes_fts contract hits + substrate_nodes_fts hits with BM25 score normalisation (contracts dominate, substrate augments)
  - IntentSearchHit wire shape (uuid, kind, level, name, summary, state, parent_uuid, score)
  - findSubstrateByIntent TS IPC wrapper
  - IntentPalette cmdk Command.Dialog component bound to Cmd+P with shouldFilter={false} (IPC is authoritative ranker)
  - IntentPaletteHit row renderer with lucide kind icons + substrate-state badge (orange-600/orange-400/amber-500 hex matches plan 13-01 CVA exactly)
  - 10-query precision test fixture (cmdp-precision.test.ts) gated on VITEST_INTEGRATION=1 — runs in plan 13-10b UAT with seeded substrate
  - Per-kind navigation contract: flow → setSelectedFlow + pushParent; L4 atom → pushParent(parent) + setFocusedAtomUuid; L0–L3 contract → pushParent(uuid); substrate node → selectNode(parent_uuid)
  - first_anchored_uuid Rust helper extracting first uuid from substrate_nodes.anchored_uuids JSON for substrate→atom navigation
  - build_fts_or_query OR-tokenizer (mirrors mass_edit.rs Phase 9, drops English stopwords) reused for nodes_fts + substrate_nodes_fts
affects:
  - 13-05 (ScreenCard chip halo — reads focusedAtomUuid set by atom-hit landing)
  - 13-06 (FlowChain — reads parentUuidStack pushed by flow-hit landing)
  - 13-07 (Chat archaeology — substrate hit handler will route to archaeology modal)
  - 13-10a (seed fixture — precision test queries map to seeded uuids/names)
  - 13-10b (UAT — runs cmdp-precision.test.ts with VITEST_INTEGRATION=1 against live Tauri dev server)
  - 13-11 (rehearsal — Cmd+P is Beat 1 entry pattern in the demo)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-source unified search via Rust IPC: nodes_fts (Phase 5 contract FTS5) + substrate_nodes_fts (Phase 11) merged with score normalisation, dedup by uuid, contracts ranked above substrate so navigation defaults toward the L2/L3 surface"
    - "BM25 score inversion: nodes_fts.bm25() returns lower-is-better; we negate to get higher-is-better, then normalise so contract scores stay above substrate's flat 0.5 baseline"
    - "shouldFilter={false} on cmdk Command.Dialog when external ranker provides authoritative order — cmdk's command-score against value={uuid} would drop every row because uuids share no characters with intent queries"
    - "OR-tokenizer with stopword stripping for FTS5: 'account settings danger' becomes 'account OR settings OR danger' (the English stopwords like 'the' / 'of' / 'a' filtered out) — broader recall than AND-tokenized phrases"
    - "Defensive substrate FTS5 fallback to LIKE on substrate_nodes.text when substrate_nodes_fts is empty — keeps the palette useful before Phase 11 distiller has populated FTS rows"

key-files:
  created:
    - "contract-ide/src/components/command-palette/IntentPalette.tsx (Cmd+P palette with debounced async query + shouldFilter={false})"
    - "contract-ide/src/components/command-palette/IntentPaletteHit.tsx (row renderer with lucide icons + substrate-state badge)"
    - "contract-ide/src/components/command-palette/__tests__/cmdp-precision.test.ts (10-query precision fixture, gated on VITEST_INTEGRATION=1)"
  modified:
    - "contract-ide/src-tauri/src/commands/substrate.rs (added IntentSearchHit struct, build_fts_or_query, find_substrate_by_intent, first_anchored_uuid helper, 6 new unit tests)"
    - "contract-ide/src-tauri/src/lib.rs (registered find_substrate_by_intent in tauri::generate_handler! after 13-02's get_sidebar_tree per Wave 2 serialization_hint)"
    - "contract-ide/src/ipc/substrate.ts (added IntentSearchHit interface + findSubstrateByIntent wrapper)"
    - "contract-ide/src/components/layout/AppShell.tsx (mounted <IntentPalette /> sibling to <CommandPalette /> inside ReactFlowProvider)"

key-decisions:
  - "shouldFilter={false} on Command.Dialog — cmdk's default fuzzy filter scores Command.Item value against the input string; we set value={hit.uuid}, so cmdk's command-score returned 0 for every row (uuids don't share chars with intent queries) and the palette displayed nothing despite IPC returning 10 hits. The IPC is the authoritative BM25 ranker; cmdk should render our pre-ranked list without re-sorting"
  - "BM25 inversion + score normalisation: contract scores (-bm25_rank) get boosted above substrate's flat 0.5 baseline so contracts dominate the visible window. Demo Beat 1 wants AccountSettings.DangerZone (a contract) at top-1 for the query 'account settings danger', not a substrate decision that mentions both words"
  - "OR-tokenizer with English stopword stripping (mirrors Phase 9 mass_edit.rs build_fts_or_query) — query 'the workspace is deleted' tokenizes to 'workspace OR deleted', not 'the AND workspace AND is AND deleted' which would over-restrict recall"
  - "Per-kind navigation handler: flow → both stores updated (sidebar selection + canvas drill-in); L4 atom → parent pushed for L3 view + setFocusedAtomUuid for chip halo (consumed by plan 13-05); L0–L3 contract → pushParent on the contract uuid; substrate node → selectNode on first anchored uuid (parent atom) so Inspector opens with context. Plan 13-07 will refine the substrate path to a dedicated archaeology modal"
  - "preventDefault BEFORE setOpen on Cmd+P listener — macOS default Cmd+P opens system Print dialog; without preventDefault, the dialog races React state flush and the keystroke is unrecoverable"
  - "Canonical setter API: useGraphStore.getState().selectNode + setFocusedAtomUuid (NOT setSelectedNode, NOT raw setState) per plan 13-01 SUMMARY checker N7. Confirmed by grep — zero setSelectedNode references in code paths"
  - "Precision test fixture gated on VITEST_INTEGRATION=1 — default unit-test run (environment: 'node', no Tauri runtime) doesn't trip 'invoke is not a function'; plan 13-10b will boot Tauri dev server with seeded substrate fixture and run the harness with the env flag set"
  - "data-atom-uuid + data-state DOM attributes on IntentPaletteHit chips — provides plan 13-07's citation-halo target a stable selector without coupling to React component identity"

patterns-established:
  - "External-ranker palette pattern: when an IPC returns pre-ranked results, set shouldFilter={false} on cmdk Command.Dialog and key Command.Items by uuid. Reusable for any future palette where BM25/embedding/LLM rerank is the authoritative order"
  - "FTS5 OR-tokenization with stopword stripping: build_fts_or_query in substrate.rs is shareable with any future FTS5 reader that needs broader-than-AND recall — already exists in mass_edit.rs, this plan generalised the helper into commands/substrate.rs"
  - "Two-palette siblings under ReactFlowProvider: Cmd+K (action-first, in-memory action registry) + Cmd+P (intent-first, async IPC) coexist as siblings, neither nested inside the other. Each palette owns its own grammar; merging them would force users to mentally context-switch within the same surface"

requirements-completed:
  - SUB-08-NAV
  # Note: SUB-08 has multiple gates. The Cmd+P palette + navigation surface ships in this plan;
  # the ≥80% top-1 precision SC gates on plan 13-10b's UAT once plan 13-10a populates substrate.

# Metrics
duration: ~30 min (Tasks 1+2 ~28 min Apr 25 14:08–14:12 + Task 3 cmdk fix on resume Apr 25 ~21:38)
completed: 2026-04-25
---

# Phase 13 Plan 03: Cmd+P Intent Palette Summary

**Cmd+P semantic intent palette as a sibling to Cmd+K — debounced async query against `find_substrate_by_intent` (a unified Rust IPC merging nodes_fts contract hits + substrate_nodes_fts substrate hits with BM25 score normalisation), per-kind navigation (flow → L2 chain, L4 atom → L3 with chip halo, substrate → Inspector on parent atom), 10-query precision test fixture gated on `VITEST_INTEGRATION=1` for plan 13-10b UAT, and a Task 3 user-verify discovery + fix: cmdk's default `shouldFilter` was dropping every IPC-ranked hit by command-scoring against `value={hit.uuid}`.**

## Performance

- **Duration:** ~30 min wall (Tasks 1+2 ~28 min in initial run; Task 3 checkpoint surfaced cmdk filter bug, fix landed on resume)
- **Started:** 2026-04-25T~21:08:00Z (Task 1 commit timestamp + ~2min)
- **Completed:** 2026-04-25T21:38:55Z
- **Tasks:** 3 (Tasks 1+2 executed initially; Task 3 was checkpoint:human-verify — bug found during verification, fixed as Rule 1 deviation)
- **Files modified:** 7 (3 created + 4 modified)

## Accomplishments

- `find_substrate_by_intent` Rust IPC unifying `nodes_fts` (Phase 5 contract FTS5) and `substrate_nodes_fts` (Phase 11) hits with BM25 score normalisation. Contracts dominate the top of palette via score boost (`-bm25_rank` then normalised above substrate's flat 0.5 baseline).
- `build_fts_or_query` OR-tokenizer mirrors Phase 9 `mass_edit.rs` pattern, drops English stopwords (the/of/a/an/and/etc.), strips punctuation, lowercases. Query `"account settings danger"` becomes FTS5 match `"account OR settings OR danger"` for broader-than-AND recall.
- `first_anchored_uuid` helper extracts the first uuid from `substrate_nodes.anchored_uuids` JSON array for substrate → parent-atom navigation.
- LIKE fallback when `substrate_nodes_fts` is empty — palette stays useful before Phase 11 distiller has populated FTS rows.
- `IntentSearchHit` wire shape with explicit `kind`, `level`, `state`, `parent_uuid`, `score` fields — kind-switched navigation reads these to land on the correct canvas surface.
- `IntentPalette` cmdk Command.Dialog bound to Cmd+P with `e.preventDefault()` BEFORE `setOpen` (no macOS Print dialog), 300ms debounced async query, race-safe via timeout-cleanup.
- `shouldFilter={false}` on `Command.Dialog` — cmdk renders our pre-ranked IPC list without re-sorting (see Deviation #1 below for the bug discovery).
- Per-kind navigation contract codified in handler:
  - `flow` → `useSidebarStore.setSelectedFlow(uuid)` + `useGraphStore.pushParent(uuid)`
  - L4 atom → `pushParent(parent_uuid)` + `setFocusedAtomUuid(uuid)` (chip halo target for plan 13-05)
  - L0–L3 contract → `pushParent(uuid)`
  - substrate node → `selectNode(parent_uuid)` via canonical setter
- `IntentPaletteHit` row renderer with lucide kind icons (`FileCode` / `Workflow` / `Lightbulb` / `ShieldCheck` / `HelpCircle` / `CheckCircle2` / `Activity`) + substrate-state badge whose hex values mirror plan 13-01 CVA variants exactly (orange-600 `#ea580c` for `intent_drifted` + 4px glow, orange-400 `#fb923c` muted for `superseded`, amber-500 `#f59e0b` for `rollup_stale`).
- 10-query precision test fixture (`cmdp-precision.test.ts`) ambient-query-mapped to seed-fixture expected top-1 hits (flow / contract / constraint / decision kinds across the four demo beats). Three structural tests run unconditionally to defend fixture shape; integration test gated on `VITEST_INTEGRATION=1` so default unit-test run doesn't trip `invoke is not a function`.
- AppShell mounts `<IntentPalette />` as a sibling of `<CommandPalette />` inside `ReactFlowProvider` — neither dialog is nested in the other; both share `commandPalette.css` so visual tuning stays in one place.
- 6 new Rust unit tests (build_fts_or_query precedence + first_anchored_uuid extraction); full `commands::substrate` suite 16/16 pass; `cargo check` + `cargo clippy -D warnings` clean; `tsc --noEmit` clean; vitest 54/55 pass + 1 integration skipped (expected); vite production build succeeds.

## Task Commits

1. **Task 1: find_substrate_by_intent IPC + IntentPalette mounted in AppShell** — `c46841b` (feat)
2. **Task 2: 10-query Cmd+P precision fixture for plan 13-10b UAT** — `49734f2` (test)
3. **Task 3 — cmdk filter bug fix discovered during human-verify** — `2ad13e4` (fix; landed on resume)

_Plan metadata commit follows this SUMMARY (docs)._

## Files Created/Modified

**Created:**
- `contract-ide/src/components/command-palette/IntentPalette.tsx` — Cmd+P palette: cmdk Command.Dialog with `shouldFilter={false}`, debounced 300ms async query, per-kind navigation handler, race-safe via timeout cleanup, preventDefault BEFORE setOpen.
- `contract-ide/src/components/command-palette/IntentPaletteHit.tsx` — Row renderer with lucide kind icons + substrate-state badge whose hex values mirror plan 13-01 CVA exactly.
- `contract-ide/src/components/command-palette/__tests__/cmdp-precision.test.ts` — 10-query precision fixture, three structural tests run unconditionally + integration test gated on `VITEST_INTEGRATION=1`.

**Modified:**
- `contract-ide/src-tauri/src/commands/substrate.rs` — Added `IntentSearchHit` struct, `build_fts_or_query` OR-tokenizer with stopword stripping, `find_substrate_by_intent` Tauri command (BM25 inversion + normalisation, contracts above substrate, LIKE fallback), `first_anchored_uuid` JSON-extract helper, 6 new unit tests.
- `contract-ide/src-tauri/src/lib.rs` — Registered `commands::substrate::find_substrate_by_intent` in `tauri::generate_handler!` AFTER 13-02's `get_sidebar_tree` per Wave 2 serialization_hint.
- `contract-ide/src/ipc/substrate.ts` — Added `IntentSearchHit` TS interface + `findSubstrateByIntent(query, limit)` invoke wrapper.
- `contract-ide/src/components/layout/AppShell.tsx` — Mounted `<IntentPalette />` as sibling of `<CommandPalette />` inside ReactFlowProvider scope (Plan 03-03).

## Decisions Made

### `shouldFilter={false}` on Command.Dialog (added on resume after Task 3 user-verify discovery)

cmdk's default behaviour: `Command.Dialog` runs `command-score(item.value, input)` for every `Command.Item`, sorts by score, and hides items that score 0. We set `value={hit.uuid}` on each item — the uuid is our stable React key + selection identifier. But uuids don't share characters with intent queries (`"account settings danger"` vs. uuid `"a3f2-c81e-..."` scores 0 against every character). cmdk dropped every IPC-ranked hit, and the palette displayed `<Command.Empty>No matches.</Command.Empty>` despite IPC returning 10 hits.

The fix is `shouldFilter={false}` on Command.Dialog. The IPC's BM25 ranking is the authoritative order; cmdk should render our pre-ranked list without re-sorting. The original comment block claimed the filter was "implicitly disabled by keying every Command.Item with `value={hit.uuid}`" — that was wrong. cmdk doesn't notice that the value is "uuid-shaped"; it command-scores the string regardless. The corrected one-line comment now explicitly references the disabled prop.

This is the canonical pattern when an external ranker returns pre-ranked results: `shouldFilter={false}` + IPC sorts. Reusable for any future palette where BM25/embedding/LLM rerank is authoritative.

### BM25 inversion + score normalisation for contracts-above-substrate ranking

`nodes_fts.bm25()` returns lower-is-better (more negative = better match). To merge with substrate scores in a higher-is-better paradigm, we negate: `score = -bm25_rank`. Then we normalise so contract scores stay above substrate's flat 0.5 baseline — substrate hits are useful augmentation but Beat 1 wants the contract `AccountSettings.DangerZone` at top-1 for query "account settings danger", not a substrate decision that happens to mention both words.

### OR-tokenizer with English stopword stripping

`build_fts_or_query` mirrors Phase 9 `mass_edit.rs` pattern: lowercase, strip punctuation, drop common English stopwords (the/of/a/an/and/or/in/to/at/etc.), join remaining tokens with `OR`. Result: query `"the workspace is deleted"` becomes FTS5 match `"workspace OR deleted"` — much broader recall than `"the AND workspace AND is AND deleted"` which would over-restrict because most contract bodies don't contain every stopword.

### Per-kind navigation handler — single source of truth for canvas drill-in

```typescript
if (hit.kind === 'flow') {
  useSidebarStore.setSelectedFlow(hit.uuid);    // sidebar selection
  useGraphStore.pushParent(hit.uuid);            // canvas L2 chain drill-in
}
if (hit.kind === 'contract' && hit.level === 'L4') {
  if (hit.parent_uuid) useGraphStore.pushParent(hit.parent_uuid);  // parent surface
  useGraphStore.setFocusedAtomUuid(hit.uuid);    // chip halo (plan 13-05 reads)
}
if (hit.kind === 'contract') {                   // L0–L3 non-flow
  useGraphStore.pushParent(hit.uuid);
}
// substrate hit (constraint / decision / question / attempt):
if (hit.parent_uuid) useGraphStore.selectNode(hit.parent_uuid);  // Inspector context
```

The handler is wrapped in `useCallback([close])` so its identity stays stable across renders — cmdk memoises Command.Item children by props, and an unstable `onSelect` would defeat the memoization and re-render the entire list on every keystroke.

### Canonical setter API enforced

Confirmed by grep: `setSelectedNode` appears ZERO times in code paths, only in two comments referencing the canonical setter rule. All graphStore mutations use:
- `useGraphStore.getState().selectNode(uuid)` — Inspector target.
- `useGraphStore.getState().setFocusedAtomUuid(uuid)` — chip halo target (plan 13-01 slice).
- `useGraphStore.getState().pushParent(uuid)` — canvas drill-in (Phase 3 API).

Per plan 13-01 SUMMARY checker N7.

### Precision test gated on `VITEST_INTEGRATION=1`

The default unit-test environment is `environment: 'node'` with no Tauri runtime, so `invoke('find_substrate_by_intent', ...)` would throw `'invoke is not a function'`. Three structural tests (length=10, all entries non-empty, expected_kind in valid 7-kind enum) run unconditionally to defend fixture shape; the actual precision assertion is gated on `VITEST_INTEGRATION=1` and runs in plan 13-10b UAT against a live Tauri dev server with seeded substrate.

Per-query JSON log via `console.log` so plan 13-10b can paste failures into the UAT runbook even when the assertion fails.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] cmdk `shouldFilter` default dropped every IPC-ranked hit**
- **Found during:** Task 3 (`checkpoint:human-verify`) — user reported typing "settings" or "danger" returned `<Command.Empty>No matches.</Command.Empty>` despite IPC returning 10 hits.
- **Diagnostic findings:**
  - `nodes_fts` has 56 rows; `substrate_nodes` has 165 rows on the test DB.
  - `find_substrate_by_intent("settings", 10)` returns 10 hits at the IPC layer (verified via direct invoke logging).
  - `find_substrate_by_intent("danger", 10)` returns 10 hits at the IPC layer (verified).
  - `Command.Empty` was rendering, indicating `hits.length === 0` from cmdk's perspective.
  - Root cause: cmdk's default `shouldFilter` runs `command-score(item.value, input)` for each `Command.Item`. Each item had `value={hit.uuid}` (e.g. `"a3f2-c81e-..."`). The query `"settings"` scored 0 against every uuid (no shared characters), so cmdk filtered out every hit before render — even though `useState(hits)` correctly held all 10.
  - The misleading existing comment block (lines 222–227) claimed the filter was "implicitly disabled" by uuid keying — this was incorrect. cmdk doesn't recognise uuid-shaped values; it command-scores any string in `value`.
- **Fix (Option A per user direction):**
  - Added `shouldFilter={false}` prop to `<Command.Dialog>` (around line 210).
  - Replaced the misleading 5-line comment block with an accurate one-liner: `// shouldFilter={false} above — IPC is the authoritative BM25 ranker; cmdk renders our pre-ranked list without re-sorting.`
  - The IPC's BM25 ranking is the authoritative order; cmdk should not re-filter or re-sort.
- **Why Option A (not a different mitigation):** The IPC already does the work — BM25 invert + score normalisation + contracts-above-substrate merge. Adding a second filter layer in the UI would either (a) re-rank against a heuristic that knows less than BM25, or (b) over-restrict recall for queries where uuid-vs-input share no characters. `shouldFilter={false}` is the cmdk-native escape hatch for exactly this case (external ranker authoritative).
- **Files modified:** `contract-ide/src/components/command-palette/IntentPalette.tsx`
- **Verification:**
  - `grep -n "shouldFilter" IntentPalette.tsx` shows `shouldFilter={false}` on line 210 + the new accurate comment on line 223.
  - `npx tsc --noEmit` clean.
  - `npx vitest run --no-coverage` 54/55 pass + 1 integration skipped (cmdp-precision integration test, gated on `VITEST_INTEGRATION=1`).
- **Committed in:** `2ad13e4` — `fix(13-03): disable cmdk auto-filter so IPC BM25 ranking is authoritative`

---

**Total deviations:** 1 auto-fixed (Rule 1 bug discovered during human-verify checkpoint, fixed on resume per user-directed Option A)
**Impact on plan:** No scope creep, no architectural change. The plan's intent — "Cmd+P palette opens, types a query, ranked hits land within ≤300ms, selecting routes correctly" — is now actually achieved end-to-end. The first run of Tasks 1+2 shipped the correct IPC + navigation + fixture but a single missing prop (`shouldFilter={false}`) on Command.Dialog made the whole pipeline invisible at the UI layer. Discovery during human-verify is the textbook case for why Task 3 is a checkpoint, not auto.

## Issues Encountered

### Task 3 checkpoint discovery: cmdk filter bug

The `checkpoint:human-verify` task in plan 13-03 was deliberate — visual / navigation behaviour can't be confidently programmatically verified without a Tauri dev server + seeded substrate. The user opened the Cmd+P palette, typed expected queries, and observed zero hits despite the network/IPC layer showing 10 returns. This is the value of human-verify checkpoints in Wave 2 plans: the bug surfaced in 60 seconds of interactive testing where unit tests would have missed it (TS unit tests don't render cmdk through a real DOM tree, and cargo unit tests stop at the IPC return).

The diagnostic was straightforward once the user shared `nodes_fts=56 / substrate_nodes=165 / IPC returns 10 hits / palette shows zero` — the only remaining variable was the cmdk render layer. `shouldFilter={false}` is the cmdk-native escape hatch for external-ranker palettes; the project owner (Yang) directed Option A as the canonical fix.

## User Setup Required

None — the IPC reads from local SQLite + the in-memory cmdk render is now correctly disabled-filter. Cmd+P works against any seeded fixture or live distilled substrate.

## Next Phase Readiness

Wave 2 plans (13-05 ScreenCard, 13-06 FlowChain, 13-07 Chat archaeology citation halo) can now:

- Read `useGraphStore.getState().focusedAtomUuid` for chip halo targets — set by Cmd+P L4 atom hits.
- Read `useGraphStore.getState().parentUuidStack` for canvas L2/L3 drill-in state — pushed by both flow hits and L4 atom hits.
- Read `useSidebarStore.getState().selectedFlowUuid` for sidebar flow selection state — set by flow hits.
- Reference the canonical setter API: `selectNode` + `setFocusedAtomUuid` + `pushParent` (NOT `setSelectedNode`, NOT raw `setState`).

**Plan 13-05 (ScreenCard) — chip halo wire-shape contract:**
- `useGraphStore.focusedAtomUuid` is the load-bearing read. When Cmd+P selects an L4 atom, `setFocusedAtomUuid(uuid)` fires; ScreenCard reads this and applies the orange-600 + 8px glow halo to the matching chip.
- `data-atom-uuid` + `data-state` DOM attributes on `IntentPaletteHit` chips are stable selectors for future plan 13-07's citation halo (matches the same pattern established in plan 13-04's `ServiceCardChips`).

**Plan 13-06 (FlowChain) — flow-hit drill-in:**
- When Cmd+P selects a flow, `pushParent(flow_uuid)` fires; FlowChain reads `parentUuidStack[length-1]` (or walks back to the L1 ancestor) to render the L2 chain.
- `useSidebarStore.selectedFlowUuid` is updated in lockstep so the sidebar's flow row stays selected when canvas drills in.

**Plan 13-07 (Chat archaeology) — substrate hit handler refinement:**
- Currently substrate hits route to `selectNode(parent_uuid)` for Inspector context. Plan 13-07 will replace this with a dedicated archaeology modal that opens to the verbatim quote + session/turn ref. The IntentPalette handler has a clearly labelled fall-through branch where 13-07 will swap in the new modal trigger.

**Plan 13-10a (seed fixture) — precision test fixture mapping:**
- The 10 ambient queries in `cmdp-precision.test.ts` map to expected `expected_uuid_or_name` strings (e.g. `AccountSettings.DangerZone`, `flow-delete-account`, `con-anonymize-not-delete-tax-held-2026-03-04`).
- Plan 13-10a's seed SQL must populate `nodes` + `substrate_nodes` rows whose `name` / `uuid` either match these strings OR contain them as substring. Fuzzy match (substring + hyphens→spaces) keeps the fixture flexible against seed-emit drift.

**Plan 13-10b (UAT) — precision validation:**
- Boot Tauri dev server with seeded substrate fixture, then run: `VITEST_INTEGRATION=1 npx vitest run cmdp-precision`.
- Assert: ≥8/10 top-1 hits match expected. Per-query JSON log printed to console for any failures.
- If precision falls below 80%: research Risk 1 mitigation in `13-RESEARCH.md` — add FTS5 substring match as a first-pass filter before ranking, OR tighten the OR-tokenizer's stopword list, OR boost contract scores further above substrate. Document which mitigation was needed in the 13-10b SUMMARY.

**SUB-08 status (REQUIREMENTS.md):**
- Cmd+P navigation surface: COMPLETE (this plan).
- Substrate-state overlay on cards/chips (precedence red > orange > amber > gray): COMPLETE (plan 13-01 + plan 13-04 chips).
- ≥80% top-1 precision SC: GATES on plan 13-10b UAT. The test fixture and harness ship today; the precision assertion runs against seeded substrate in plan 13-10b.
- Chat archaeology `[source]` click: PENDING plan 13-07.

---
*Phase: 13-substrate-ui-demo-polish*
*Completed: 2026-04-25*

## Self-Check: PASSED

All 7 created/modified files verified on disk; all three task commits (`c46841b`, `49734f2`, `2ad13e4`) found in git history. `npx tsc --noEmit` clean; `npx vitest run --no-coverage` 54/55 pass + 1 integration skipped (expected per gating). Spot-check confirms `shouldFilter={false}` on Command.Dialog (line 210) and accurate one-line comment (line 223); zero `setSelectedNode` references in code paths.
