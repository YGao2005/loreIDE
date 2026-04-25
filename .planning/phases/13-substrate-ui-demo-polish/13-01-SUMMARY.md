---
phase: 13-substrate-ui-demo-polish
plan: 01
subsystem: ui
tags: [zustand, cva, tauri-ipc, sqlite, react-flow, substrate, intent-drift]

# Dependency graph
requires:
  - phase: 11-distiller-constraint-store-contract-anchored-retrieval
    provides: substrate_nodes table (text, node_type, source_*, valid_at, invalid_at, anchored_uuids)
  - phase: 12-conflict-supersession-engine
    provides: intent_drift_state column on substrate_nodes (DRIFTED / NOT_DRIFTED / NEEDS_HUMAN_REVIEW)
  - phase: 07-drift-detection-watcher-path
    provides: useDriftStore + drifted ring (red, animated)
  - phase: 08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation
    provides: useRollupStore + rollup_stale (amber) + rollup_untracked (gray) variants
  - phase: 03-graph-canvas
    provides: GraphCanvasInner buildFlowNodes wiring + ContractNode CVA pipeline
provides:
  - useSubstrateStore extended with nodeStates Map<uuid, SubstrateNodeState> + setNodeState + bulkSet + clearNodeState + reset
  - SubstrateNodeState type ('fresh' | 'stale' | 'superseded' | 'intent_drifted')
  - useGraphStore.focusedAtomUuid slice + setFocusedAtomUuid action
  - getSubstrateStatesForCanvas + getSubstrateNodeDetail TS IPC wrappers
  - SubstrateNodeSummary wire shape (uuid, kind, state, name, summary, session_id, turn_ref, verbatim_quote, actor, confidence)
  - get_substrate_states_for_canvas + get_substrate_node_detail Rust commands (defensive table + column existence checks)
  - CVA variants intent_drifted (orange-600 + glow + pulse) and superseded (orange-400 + opacity 0.75, no pulse)
  - resolveNodeState(uuid, drifted, rollup_stale, rollup_untracked, substrateStates) compositor with full precedence ordering
  - NodeVisualState type union exported for Wave 2 consumers
  - GraphCanvasInner buildFlowNodes consumes substrate states via useMemo dep
  - AppShell hydrates substrate store on mount (defensive — empty Map on failure)
affects:
  - 13-02 (Inspector substrate citations panel)
  - 13-03 (Cmd+P atom-hit landing — reads focusedAtomUuid)
  - 13-04 (ServiceCardChips — reads resolveNodeState + substrate kind)
  - 13-05 (ScreenCard chip halo — reads focusedAtomUuid + resolveNodeState)
  - 13-06 (FlowChain — reads resolveNodeState)
  - 13-07 (Chat archaeology citation halo — reads resolveNodeState)
  - 13-08 (PR review surface — reads useSubstrateStore.nodeStates)
  - 13-09 (Sync + Verifier — writes useSubstrateStore via future event sub)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-slice Zustand store (Phase 11 footer counter + Phase 13 nodeStates) coexist on one useSubstrateStore"
    - "Map-identity-change re-render pattern (mirrors useDriftStore Set + useRollupStore Sets)"
    - "Defensive table/column existence checks (PRAGMA table_info + sqlite_master scan) so app boots before migrations land"
    - "resolveNodeState compositor with explicit precedence — single source of truth for visual state, importable by Wave 2 plans"
    - "CVA compoundVariants for substrate-states-suppress-targeted-ring (mirrors Phase 8 rollup-suppress-targeted-ring)"

key-files:
  created:
    - "contract-ide/src-tauri/src/commands/substrate.rs (Rust IPC + 6 unit tests)"
  modified:
    - "contract-ide/src/store/substrate.ts (extended with Phase 13 slice — additive on top of Phase 11)"
    - "contract-ide/src/store/graph.ts (added focusedAtomUuid slice + setFocusedAtomUuid action)"
    - "contract-ide/src/ipc/substrate.ts (added SubstrateNodeSummary + getSubstrateStatesForCanvas + getSubstrateNodeDetail)"
    - "contract-ide/src-tauri/src/commands/mod.rs (registered substrate module)"
    - "contract-ide/src-tauri/src/lib.rs (registered 2 commands in generate_handler!)"
    - "contract-ide/src/components/graph/contractNodeStyles.ts (intent_drifted + superseded CVA variants + resolveNodeState helper + NodeVisualState type)"
    - "contract-ide/src/components/graph/GraphCanvasInner.tsx (subscribed to useSubstrateStore + wired resolveNodeState into buildFlowNodes)"
    - "contract-ide/src/components/layout/AppShell.tsx (hydrate substrate state map on mount via getSubstrateStatesForCanvas)"

key-decisions:
  - "Extend existing useSubstrateStore (Phase 11 P05 footer counter) rather than creating a name-collision second store — both slices coexist orthogonally on one Zustand instance"
  - "Map plan's expected substrate_nodes columns (kind/state/name/summary) onto the actual schema (node_type/intent_drift_state+invalid_at/text) — plan was written against an idealised schema; Rust IPC bridges the gap"
  - "Derive 'state' from (intent_drift_state, invalid_at) pair: DRIFTED → intent_drifted; invalid_at NOT NULL → superseded; else fresh. 'stale' reserved for plan 13-09 sync (not emitted by Phase 11/12 yet)"
  - "Defensive PRAGMA table_info column check so app boots even when Phase 12 v7 migration hasn't run on a particular machine — falls back to invalid_at-only state derivation (no intent_drifted emitted)"
  - "EMPTY_SET module-scoped const for Copy Mode rollup-overlay suppression (stable reference avoids useMemo invalidation)"
  - "mass_matched layered between rollup_stale and superseded in precedence — only emitted when no higher-priority visual state applies, layered onto healthy or rollup_untracked nodes"
  - "focusedAtomUuid slice lives on graphStore (not substrateStore) per 13-RESEARCH Anti-pattern: substrate store is for substrate semantics, not UI-interaction markers"
  - "Canonical setter API for graphStore: useGraphStore.getState().selectNode(uuid) — NOT setSelectedNode. Plans 13-03/04/05/07/08 must use selectNode() per checker N7"

patterns-established:
  - "Two-slice store pattern: a single Zustand store can host orthogonal concerns (Phase 11 totalCount + Phase 13 nodeStates) when consumers select discrete slices"
  - "resolveNodeState as load-bearing import: any consumer needing the composite visual state imports from @/components/graph/contractNodeStyles — single precedence definition site"
  - "Defensive Rust IPC pattern for forward-compatible reads: PRAGMA table_info column check + dynamic SQL column projection (CAST(NULL AS TEXT) AS missing_col) when later-migration columns may be absent"

requirements-completed:
  - SUB-08
  - CHIP-03

# Metrics
duration: 8 min
completed: 2026-04-25
---

# Phase 13 Plan 01: Substrate-State Foundation Summary

**Foundational Zustand + IPC + CVA plumbing — useSubstrateStore.nodeStates Map keyed by contract atom uuid, get_substrate_states_for_canvas Rust IPC reading the actual substrate_nodes schema (node_type / intent_drift_state / invalid_at), CVA intent_drifted (orange-600 + glow) and superseded (orange-400 muted) variants, resolveNodeState precedence compositor exported for Wave 2 plans, and focusedAtomUuid slice on graphStore.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-25T20:21:36Z
- **Completed:** 2026-04-25T20:30:11Z
- **Tasks:** 2
- **Files modified:** 8 (1 created + 7 modified)

## Accomplishments

- `useSubstrateStore` extended with Phase 13 `nodeStates: Map<string, SubstrateNodeState>` slice (alongside Phase 11 footer counter slice — both coexist on one store).
- `useGraphStore` extended with `focusedAtomUuid` slice + `setFocusedAtomUuid` action (additive — `selectNode` API preserved as the canonical setter).
- Two new Tauri commands (`get_substrate_states_for_canvas`, `get_substrate_node_detail`) reading the real `substrate_nodes` schema with defensive table + column existence checks.
- CVA `intent_drifted` (orange-600 + 8px glow + pulse) and `superseded` (orange-400 muted, no pulse, opacity 0.75) state variants added.
- `resolveNodeState(uuid, drifted, rollup_stale, rollup_untracked, substrateStates) → NodeVisualState` precedence compositor exported as the single source of truth for Wave 2 plans (13-04 / 05 / 06 / 07 / 09).
- `GraphCanvasInner.buildFlowNodes` rewired to consume substrate states via `useMemo` dependency; mass_matched layered into precedence (between rollup_stale and superseded).
- `AppShell` hydrates substrate state map on mount via the new IPC.
- 6 Rust unit tests (`first_line` + `derive_state`) all pass; full lib suite 104/104 green; clippy clean; tsc clean.

## Task Commits

1. **Task 1: Create useSubstrateStore + IPC wrappers + Rust command + focusedAtomUuid slice** — `2ca959d` (feat)
2. **Task 2: Extend CVA variants + resolveNodeState compositor in GraphCanvasInner** — `7e8c471` (feat)

_Plan metadata commit follows this SUMMARY (docs)._

## Files Created/Modified

**Created:**
- `contract-ide/src-tauri/src/commands/substrate.rs` — Two Tauri commands + `SubstrateNodeSummary` struct + 6 unit tests for `first_line` and `derive_state` precedence.

**Modified:**
- `contract-ide/src/store/substrate.ts` — Added `SubstrateNodeState` type, `nodeStates` Map slice, `setNodeState` / `bulkSet` / `clearNodeState` / `reset` actions. Phase 11 `totalCount` / `firstNodeSeen` slice preserved as-is.
- `contract-ide/src/store/graph.ts` — Added `focusedAtomUuid: string | null` slice + `setFocusedAtomUuid: (uuid: string | null) => void` action. `selectNode` API preserved exactly.
- `contract-ide/src/ipc/substrate.ts` — Added `SubstrateNodeSummary` interface, `getSubstrateStatesForCanvas`, `getSubstrateNodeDetail` wrappers. `ipcSubstrate.getTotalCount` (Phase 11) preserved.
- `contract-ide/src-tauri/src/commands/mod.rs` — Registered new `substrate` module (alphabetically between `session` and `substrate_panel`).
- `contract-ide/src-tauri/src/lib.rs` — Registered `commands::substrate::get_substrate_states_for_canvas` + `commands::substrate::get_substrate_node_detail` in `tauri::generate_handler!`.
- `contract-ide/src/components/graph/contractNodeStyles.ts` — Added `intent_drifted` and `superseded` to the `state` CVA variant; extended `NodeHealthState` union; exported new `NodeVisualState` union and `resolveNodeState` helper; added `compoundVariants` for substrate-states-suppress-targeted-ring.
- `contract-ide/src/components/graph/GraphCanvasInner.tsx` — Imported `useSubstrateStore` + `resolveNodeState`; subscribed to `nodeStates` Map; rewired `buildFlowNodes` to call `resolveNodeState` and map result to `(state, rollupState)` variants. `EMPTY_SET` module-scope const for Copy Mode suppression.
- `contract-ide/src/components/layout/AppShell.tsx` — Added `useEffect` hydrating `useSubstrateStore.nodeStates` via `getSubstrateStatesForCanvas` on mount.

## Decisions Made

### Load-bearing CVA classes (downstream contract for Phase 13 visual differentiation)

```
intent_drifted: 'ring-2 ring-orange-600 animate-pulse shadow-[0_0_8px_2px_rgba(234,88,12,0.4)]'
superseded:     'ring-1 ring-orange-400 opacity-75'
```

The orange-600 hex `#ea580c` is intentionally darker than amber-500 `#f59e0b` so the visual differentiation survives compressed video bitrate (Pitfall 6 in 13-RESEARCH.md). The `box-shadow` halo (8px blur, 2px spread, 0.4 alpha) is the visual element that distinguishes orange from amber at 720p — pure ring color alone reads as a single "warning" hue.

`superseded` deliberately avoids `animate-pulse` and uses `ring-1` (not `ring-2`) plus `opacity-75` so it reads as a softer "touched but not active" signal — appropriate for atoms whose anchoring substrate was invalidated but where no priority-shift cascade hit them directly.

### Defensive `get_substrate_states_for_canvas` (Phase 11 / Phase 12 dependency note)

The Rust command performs two existence checks before reading:

1. `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='substrate_nodes'` — short-circuits with `Ok(vec![])` if Phase 11 migration v6 hasn't run.
2. `PRAGMA table_info('substrate_nodes')` scan for `intent_drift_state` column — if absent (Phase 12 v7 migration hasn't run), the SQL projects `CAST(NULL AS TEXT) AS intent_drift_state` so the read still works; state derivation falls back to `invalid_at`-only (no `intent_drifted` emitted).

This keeps Phase 13 from gating on Phase 11/12 shipping their migrations on a particular dev machine — the app boots cleanly with empty Map and the canvas just renders without orange overlays.

### `focusedAtomUuid` lives on graphStore, not substrateStore

Per 13-RESEARCH.md anti-pattern: don't mix UI-interaction markers with substrate semantics. `focusedAtomUuid` is a transient halo target on a chip inside a card — semantically distinct from `selectedNodeUuid` (Inspector target) but mechanically identical (a uuid pointer). Colocating both on `graphStore` keeps "what's emphasised on canvas?" a single mental model.

### Canonical setter API for downstream plans

- `useGraphStore.getState().selectNode(uuid)` — Inspector target (existing Phase 4 API).
- `useGraphStore.getState().setFocusedAtomUuid(uuid)` — Phase 13 chip halo target.

NEVER use `setSelectedNode` — that's not the actual API. Per checker N7, plans 13-03 / 13-04 / 13-05 / 13-07 / 13-08 must call `selectNode()`.

### `resolveNodeState` precedence (final ordering)

```
drifted (red, animated)         — Phase 7  (code-vs-contract drift)
intent_drifted (orange + glow)  — Phase 12 (priority shift cascade)
rollup_stale (amber)            — Phase 8  (child section changed)
[mass_matched (amber transient) — Phase 9 — layered onto healthy or rollup_untracked only]
superseded (orange muted)       — Phase 12 (anchoring substrate invalid)
rollup_untracked (gray)         — Phase 8  (no engine signal yet)
healthy                         — default
```

`mass_matched` is NOT in the resolveNodeState chain — it's layered downstream in `buildFlowNodes` so it never overrides an active substrate or drift signal.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Name collision with existing `useSubstrateStore`**
- **Found during:** Task 1 setup
- **Issue:** Plan said "Create `contract-ide/src/store/substrate.ts`" assuming the file did not exist. Phase 11 Plan 05 had already shipped `useSubstrateStore` with `totalCount` + `firstNodeSeen` + `seedFromIpc` + `onSubstrateIngested` slices for the footer counter and first-time toast. Creating a fresh store with the same name would break Phase 11's footer.
- **Fix:** Extended the existing `useSubstrateStore` additively. Both slices (Phase 11 footer counter; Phase 13 `nodeStates` Map) coexist orthogonally on one Zustand instance. Consumers select the slice they need; neither slice mutates the other.
- **Files modified:** `contract-ide/src/store/substrate.ts`
- **Verification:** `grep -n "totalCount\|firstNodeSeen" src/store/substrate.ts` confirms Phase 11 slice preserved; `tsc --noEmit` clean; `SubstrateStatusIndicator` still mounts and renders.
- **Committed in:** `2ca959d` (Task 1 commit)

**2. [Rule 1 - Bug] Plan's `SubstrateNodeSummary` referenced columns absent from actual `substrate_nodes` schema**
- **Found during:** Task 1 — writing `commands/substrate.rs` and matching to the real schema.
- **Issue:** Plan specified `SELECT uuid, kind, state, name, summary, ...` but the actual `substrate_nodes` table has `node_type` (not `kind`), `text` (not `name`/`summary`), and no `state` column at all. State must be derived from `intent_drift_state` (Phase 12) + `invalid_at` (Phase 11).
- **Fix:** Mapped plan's wire shape onto real columns:
  - `kind` ← `node_type`
  - `name` ← first non-empty line of `text` (capped at 80 chars)
  - `summary` ← full `text`
  - `state` ← `derive_state(intent_drift_state, invalid_at)` helper: `DRIFTED → intent_drifted; invalid_at NOT NULL → superseded; else fresh`
  - `session_id`/`turn_ref`/`verbatim_quote`/`actor` ← `source_session_id`/`source_turn_ref`/`source_quote`/`source_actor`
- **Files modified:** `contract-ide/src-tauri/src/commands/substrate.rs`, `contract-ide/src/ipc/substrate.ts`
- **Verification:** 6 unit tests cover `first_line` + `derive_state` precedence; cargo test 104/104; cargo clippy clean.
- **Committed in:** `2ca959d` (Task 1 commit)

**3. [Rule 2 - Missing Critical] Defensive `intent_drift_state` column check**
- **Found during:** Task 1 — Phase 12 v7 migration is independent of Phase 11 v6 migration; on a fresh dev DB without v7, the `SELECT intent_drift_state` would crash.
- **Issue:** Plan's defensive check covered only the `substrate_nodes` table; it did not address the Phase 12 column.
- **Fix:** Added `intent_drift_column_present(pool)` using `PRAGMA table_info` scan. If absent, the SELECT projects `CAST(NULL AS TEXT) AS intent_drift_state` so the read still works; state derivation falls back to `invalid_at`-only (no `intent_drifted` ever emitted on a v6-only DB).
- **Files modified:** `contract-ide/src-tauri/src/commands/substrate.rs`
- **Verification:** Cargo build + test pass; the dynamic SQL branch is exercised in the absence-of-column path.
- **Committed in:** `2ca959d` (Task 1 commit)

**4. [Rule 1 - Bug] mass_matched precedence interaction with substrate states**
- **Found during:** Task 2 — wiring `resolveNodeState` into `buildFlowNodes`.
- **Issue:** Plan's `resolveNodeState` returns one of six visual states and didn't account for Phase 9's `mass_matched` (transient amber pulse). Naively replacing the existing precedence with `resolveNodeState` would have dropped the mass_matched layer entirely.
- **Fix:** `resolveNodeState` returns the canonical visual state from drift/substrate/rollup signals; `buildFlowNodes` then layers `mass_matched` on TOP of that result, but only when the visual state is `healthy` or `rollup_untracked` (so substrate / rollup_stale / drift always dominate the transient pulse).
- **Files modified:** `contract-ide/src/components/graph/GraphCanvasInner.tsx`
- **Verification:** `tsc --noEmit` clean; the Phase 9 review-queue amber pulse on healthy nodes still works (matched type narrowing on `state` variable preserves all six legal values).
- **Committed in:** `7e8c471` (Task 2 commit)

---

**Total deviations:** 4 auto-fixed (1 blocking, 1 missing critical, 2 bugs)
**Impact on plan:** All deviations were corrections to schema-vs-plan misalignment and one unaddressed precedence interaction. The plumbing landed exactly as the plan intended (`useSubstrateStore.nodeStates`, `resolveNodeState`, `focusedAtomUuid` slice) — the deviations are about meeting the actual codebase rather than the plan's idealised model. No scope creep; no architectural change.

## Issues Encountered

None during planned work. Schema mismatch was discovered and corrected before any user-visible code shipped.

## User Setup Required

None — no external service configuration required. Substrate state is read from the local SQLite DB.

## Next Phase Readiness

Wave 2 plans (13-02, 13-03, 13-04, 13-05) can now:

- `import { useSubstrateStore, type SubstrateNodeState } from '@/store/substrate'` — get the Map for canvas coloring or per-uuid lookups.
- `import { useGraphStore } from '@/store/graph'` and call `setFocusedAtomUuid(uuid)` for chip halo targeting.
- `import { resolveNodeState, type NodeVisualState } from '@/components/graph/contractNodeStyles'` — single source of truth for visual state composition.
- `import { getSubstrateStatesForCanvas, getSubstrateNodeDetail } from '@/ipc/substrate'` — IPC reads.
- Reference the canonical setter API: `useGraphStore.getState().selectNode(uuid)` (NOT `setSelectedNode`).

The substrate engine event subscription (`substrate:updated`) is intentionally deferred to plan 13-09 (Sync + Verifier). For now substrate state is hydrated once on mount; if the distiller writes new rows during a session, the user must reload or re-open the repo to see them.

Plans should serialise `lib.rs` edits during Wave 2 as the macro `tauri::generate_handler!` accumulates entries — 12-04 already added `demo_force_intent_drift` between Task 1 and Task 2 of this plan, demonstrating the merge-conflict surface to be careful around.

---
*Phase: 13-substrate-ui-demo-polish*
*Completed: 2026-04-25*

## Self-Check: PASSED

All 9 created/modified files exist on disk; both task commits (2ca959d, 7e8c471) found in git history.
