---
phase: 13-substrate-ui-demo-polish
plan: 08
subsystem: ui
tags: [tauri-ipc, sqlite, zustand, unified-diff, substrate, intent-drift, pr-review]

# Dependency graph
requires:
  - phase: 13-substrate-ui-demo-polish
    provides: useSubstrateStore.nodeStates Map + bulkSet/setNodeState/clearNodeState (plan 13-01) — overlay surface
  - phase: 13-substrate-ui-demo-polish
    provides: FlowChainLayout participant chain (plan 13-06) — visual surface for highlighting affected atoms
  - phase: 12-conflict-supersession-engine
    provides: substrate_nodes.intent_drift_state column (DRIFTED) — read-only intersection target; defensive on absence
  - phase: 02-contract-data-layer
    provides: nodes.code_ranges TEXT (JSON) column — file/line lookup target for diff mapping
provides:
  - parseDiffHunks(diffText) — pure unified-diff parser (file+line hunk extraction; +++ b/path detection; @@ header parsing)
  - mapDiffToNodes(hunks, nodeRanges) — pure file+line-overlap → uuid Set with conservative no-line-range fallback
  - analyze_pr_diff Rust IPC — DiffHunkInput[] → PrReviewResult { affected_uuids, intent_drifted_uuids, hunk_count, file_count }
  - PRReviewPanel — right-edge 420px sliding panel; diff textarea + Analyze + transient overlay + Cancel restore
  - PRReviewExplanation — affected nodes grouped by parent_uuid with ⚠ markers for intent_drifted subset
  - Cmd+Shift+P keyboard binding (toggle) — defensive non-collision with Cmd+P (IntentPalette in 13-03)
affects:
  - 13-09 (Sync + Verifier + Harvest — appends trigger_sync_animation to lib.rs handler list AFTER analyze_pr_diff per Wave 4 serialization)
  - 13-10a (orange-flag fixture — when substrate_nodes have intent_drift_state='DRIFTED', the PR panel returns intent_drifted_uuids)
  - 13-11 (rehearsal — PR review demo affordance per pitch "Paste a PR. Canvas lights up.")

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-function diff parser + structured-input IPC — TS-side parseDiffHunks emits DiffHunkInput[]; Rust does the SQL join (small wire payload, vitest-coverable kernel)"
    - "Snapshot-and-restore overlay pattern — useRef<Map<uuid, prevState | null>> snapshots before bulkSet, restored via setNodeState/clearNodeState on Cancel/unmount; no transient state leaks across review sessions"
    - "Stable Zustand selector + useMemo derivation in PRReviewExplanation (Phase 13-06 lesson — no inline .filter() in selector)"
    - "Defensive substrate intersection — substrate_table_exists + intent_drift_column_present checks before SELECT; missing schema returns empty intent_drifted list, never errors"
    - "Snake_case JSON serialisation across Rust/TS boundary — DiffHunkInput uses serde rename_all = snake_case; nodes.code_ranges JSON uses Rust serde default (start_line/end_line)"

key-files:
  created:
    - "contract-ide/src/lib/diffToNodeMapper.ts (parseDiffHunks + mapDiffToNodes pure functions)"
    - "contract-ide/src/lib/__tests__/diffToNodeMapper.test.ts (4 vitest cases)"
    - "contract-ide/src-tauri/src/commands/pr_review.rs (analyze_pr_diff IPC + 2 unit tests)"
    - "contract-ide/src/components/substrate/PRReviewPanel.tsx (sliding panel + snapshot-and-restore Cancel)"
    - "contract-ide/src/components/substrate/PRReviewExplanation.tsx (affected nodes grouped by parent_uuid)"
  modified:
    - "contract-ide/src-tauri/src/commands/mod.rs (registered pr_review module alphabetically between nodes and receipts)"
    - "contract-ide/src-tauri/src/lib.rs (appended analyze_pr_diff to generate_handler! AFTER 13-06's capture_route_screenshot per Wave 4 serialization hint)"
    - "contract-ide/src/components/layout/AppShell.tsx (mount PRReviewPanel + Cmd+Shift+P toggle binding)"

key-decisions:
  - "Cmd+Shift+P toggle (not just open) — same shortcut closes the panel; e.preventDefault prevents the default browser print dialog. Distinct from Cmd+P (IntentPalette) — modifier-shift differentiation chosen because both are P-anchored mnemonically (Palette / PR review)"
  - "Apply intent_drifted overlay to ALL affected uuids, not just the drifted subset — demo simplicity: every diff-touched atom lights up orange. Explanation sidebar distinguishes the substrate-drifted subset via ⚠ marker so reviewers can still see the Phase 12 cascade signal"
  - "Snapshot-and-restore via useRef<Map<uuid, SubstrateNodeState | null>> — null sentinel means 'no prior state, use clearNodeState'. Re-Analyze without Cancel restores prior overlay BEFORE snapshotting + applying the new one (avoids snapshot overwrite leak that would lose original state). Cleanup effect also restores on unmount"
  - "JSON field naming bridges Rust/TS — DiffHunkInput uses #[serde(rename_all = \"snake_case\")] so TS payload {file_path, new_start, new_lines} matches. nodes.code_ranges JSON uses Rust serde default (start_line/end_line snake_case from sidecar/frontmatter.rs CodeRange — no rename attribute), so the Rust IPC reads JSON values via .get(\"start_line\")/.get(\"end_line\")"
  - "TS-side parseDiffHunks instead of Rust-side parsing — diff text is small (KB scale), TS regex is simpler than a Rust unified-diff parser, and the structured DiffHunkInput payload to Rust is tiny. Rust does the heavy lifting (SQL join over all nodes.code_ranges)"
  - "Defensive substrate intersection (mirrors Phase 13-01 pattern) — substrate_table_exists + intent_drift_column_present both checked before SELECT; missing schema (Phase 12 not deployed on this machine) returns empty intent_drifted_uuids, never errors. The PR review affordance still works file-level even without Phase 12"
  - "PRReviewExplanation uses stable selector + useMemo (per Phase 13-06 lesson) — useGraphStore((s) => s.nodes) subscribes to stable reference; the affected/grouped derivations live in useMemo with explicit deps. NEVER inline .filter() in the selector — useSyncExternalStore retry trap"
  - "Wave 4 serialization compliance — analyze_pr_diff appended to lib.rs generate_handler! AFTER 13-06's capture_route_screenshot. 13-09's trigger_sync_animation will append AFTER analyze_pr_diff in its own commit"

patterns-established:
  - "Pure TS parser + structured IPC payload — keep parsing logic vitest-coverable in TS; let Rust do DB joins. Reusable for any future 'analyse external text + map to graph' surface (e.g. PR-URL parser, commit-message intent extraction)"
  - "Transient substrate overlay via snapshot-and-restore — bulkSet for application, useRef<Map<uuid, prevState | null>> for snapshot, setNodeState/clearNodeState per uuid for restore. Cleanup-on-unmount for accidental teardown safety. Reusable for any 'preview state' surface (Mass Edit highlight preview, drift staging)"

requirements-completed:
  - SUB-09

# Metrics
duration: 4 min
completed: 2026-04-25
---

# Phase 13 Plan 08: PR-Review Intent-Drift Mode Summary

**Right-edge sliding PR-review panel with raw-diff paste, file+line→ContractNode mapping via parseDiffHunks (pure TS) + analyze_pr_diff Rust IPC (sqlx join over nodes.code_ranges JSON ∩ substrate_nodes.intent_drift_state), transient intent_drifted overlay via useSubstrateStore.bulkSet with snapshot-and-restore Cancel, and Cmd+Shift+P toggle binding non-colliding with Cmd+P (IntentPalette).**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-25T22:50:16Z
- **Completed:** 2026-04-25T22:54:16Z
- **Tasks:** 2
- **Files created:** 5
- **Files modified:** 3

## Accomplishments

- `parseDiffHunks(diffText)` pure TS parser — handles standard `git diff` output (`+++ b/path` detection, `@@ -OLD,L +NEW,L @@` hunk header parsing, raw-hunk capture). 4 vitest cases pass.
- `mapDiffToNodes(hunks, nodeRanges)` pure mapper — file+line-overlap → uuid Set with conservative no-line-range fallback for atoms whose code_ranges only carry a file string.
- `analyze_pr_diff` Tauri IPC — takes structured `DiffHunkInput[]`, returns `PrReviewResult { affected_uuids, intent_drifted_uuids, hunk_count, file_count }`. Reads `nodes.code_ranges` JSON (snake_case `start_line`/`end_line` per Rust serde default) and intersects with `substrate_nodes.intent_drift_state == 'DRIFTED'`. Defensive on missing table/column. 2 Rust unit tests pass.
- `PRReviewPanel` — 420px right-edge sliding panel, raw-diff textarea with `git diff` clarification copy, Analyze button, status line ("N hunks across M files affecting K atoms"), Cancel button. Snapshot-and-restore via `useRef<Map<uuid, SubstrateNodeState | null>>` — Cancel/unmount restore is leak-safe.
- `PRReviewExplanation` — affected nodes grouped by `parent_uuid` (participant surface), `⚠` marker for intent_drifted subset, click-to-focus via `useGraphStore.selectNode` (canonical setter per checker N7). Stable selector + useMemo derivation (Phase 13-06 lesson — no inline `.filter()` trap).
- `Cmd+Shift+P` toggle binding in `AppShell` — opens/closes panel; defensive non-collision with `Cmd+P` (IntentPalette) via shift-modifier differentiation.
- Wave 4 serialization compliance: `analyze_pr_diff` appended to `lib.rs` `generate_handler!` AFTER 13-06's `capture_route_screenshot`. 13-09 will append `trigger_sync_animation` AFTER this entry.

## Task Commits

1. **Task 1: diffToNodeMapper + analyze_pr_diff Rust IPC** — `1fa66b3` (feat)
2. **Task 2: PRReviewPanel + PRReviewExplanation + Cmd+Shift+P binding** — `69a296f` (feat) — also picked up sibling 13-07's already-staged STATE/ROADMAP/REQUIREMENTS/13-07-SUMMARY metadata files (parallel-execution merge surface)

_Plan metadata commit follows this SUMMARY (docs)._

## Files Created/Modified

**Created:**
- `contract-ide/src/lib/diffToNodeMapper.ts` — `DiffHunk` interface, `parseDiffHunks` pure parser, `NodeCodeRange` interface, `mapDiffToNodes` pure mapper.
- `contract-ide/src/lib/__tests__/diffToNodeMapper.test.ts` — 4 vitest cases (two-file diff parse, empty input, file+line-overlap mapping, no-line-range conservative fallback).
- `contract-ide/src-tauri/src/commands/pr_review.rs` — `DiffHunkInput` (snake_case-renamed serde input), `PrReviewResult` (snake_case-renamed serde output), `analyze_pr_diff` Tauri command, defensive `substrate_table_exists` + `intent_drift_column_present` helpers, 2 unit tests for serde round-trip.
- `contract-ide/src/components/substrate/PRReviewPanel.tsx` — Sliding panel component with `previousStatesRef` snapshot, `restorePreviousStates` callback, cleanup-on-unmount effect, Analyze handler with re-Analyze prior-overlay restore, Cancel handler.
- `contract-ide/src/components/substrate/PRReviewExplanation.tsx` — Grouped-by-parent affected list with `useMemo` derivation from stable `useGraphStore.nodes` slice; `⚠` marker for intent_drifted subset; `selectNode` click handler.

**Modified:**
- `contract-ide/src-tauri/src/commands/mod.rs` — Registered `pub mod pr_review;` alphabetically between `nodes` and `receipts`.
- `contract-ide/src-tauri/src/lib.rs` — Appended `commands::pr_review::analyze_pr_diff` to `tauri::generate_handler!` AFTER `commands::screenshot::capture_route_screenshot` per Wave 4 serialization hint.
- `contract-ide/src/components/layout/AppShell.tsx` — Imported `PRReviewPanel`, added `prReviewOpen` state + `handlePrReviewClose` callback, added `useEffect` for Cmd+Shift+P toggle keybinding (`document.addEventListener('keydown')` with cleanup), mounted `<PRReviewPanel />` adjacent to existing top-level modals.

## Decisions Made

### Cmd+Shift+P toggle, not just open

The same shortcut closes the panel. `e.preventDefault()` swallows the default browser Print dialog. Distinct from Cmd+P (IntentPalette in 13-03) via the shift modifier — both are P-anchored mnemonically (Palette / PR review) but the modifier difference is unambiguous in keyboard event handling.

### Apply intent_drifted overlay to ALL affected uuids (not just drifted subset)

Demo simplicity: every diff-touched atom lights up orange so reviewers see the visual drama of "PR pasted → canvas lights up". The explanation sidebar distinguishes the substrate-drifted subset via the `⚠` marker so the Phase 12 cascade signal is still surfaced. A more nuanced overlay (drifted = orange-glow, file-affected = orange-muted) would be a future polish — not required for the demo's 30-second-readable target.

### Snapshot-and-restore via useRef<Map<uuid, SubstrateNodeState | null>>

The snapshot is a `Map<uuid, prevState | null>`. The `null` sentinel means "no prior state existed — use `clearNodeState` on restore". Restoration walks the map and calls `setNodeState` (for non-null prior state) or `clearNodeState` (for null prior state) per uuid.

Re-Analyze without Cancel restores the prior overlay BEFORE snapshotting + applying the new one. Without that step, the second snapshot would capture the first overlay's already-orange state and Cancel would restore atoms to orange instead of fresh.

A cleanup effect (`useEffect` return) also runs `restorePreviousStates` on panel unmount — defensive for the case where the panel is closed via Esc / app reload while an overlay is applied.

### TS-side parseDiffHunks, Rust-side join

The diff text is KB-scale; TS regex parsing is simpler than a Rust unified-diff parser and faster to vitest. The structured `DiffHunkInput[]` payload to Rust is tiny (a few dozen `{file_path, new_start, new_lines}` objects per realistic PR). Rust does the SQL join over `nodes.code_ranges` JSON (~50-200 rows at hackathon scale).

### JSON field naming bridges Rust/TS

`DiffHunkInput` uses `#[serde(rename_all = "snake_case")]` so the TS-side `{ file_path, new_start, new_lines }` deserializes correctly. The `nodes.code_ranges` JSON column uses Rust serde defaults (snake_case `start_line` / `end_line` from `sidecar/frontmatter.rs:CodeRange` — no rename attribute), so the Rust IPC reads via `.get("start_line")` / `.get("end_line")` (NOT camelCase).

### Defensive substrate intersection

Mirrors Phase 13-01 pattern exactly. `substrate_table_exists` checks `sqlite_master` for the table; `intent_drift_column_present` uses `PRAGMA table_info('substrate_nodes')` to check the column. Both must be true before the `SELECT DISTINCT uuid FROM substrate_nodes WHERE intent_drift_state = 'DRIFTED'` runs. Missing schema → empty `intent_drifted_uuids`, never errors. The PR review file-level affordance still works without Phase 12 deployed.

### PRReviewExplanation stable selector + useMemo

Per Phase 13-06's load-bearing lesson: `useGraphStore((s) => s.nodes.filter(...))` returns a fresh array reference each render → `useSyncExternalStore` infinite retry → canvas crash. Fix: subscribe to stable `s.nodes` and derive filtered/grouped views in `useMemo` with explicit deps (`[allNodes, affectedSet]`). The `affectedSet` and `driftedSet` are themselves memoised from the result arrays so they're stable across renders unless the result actually changed.

### Wave 4 serialization compliance

`analyze_pr_diff` appended to `lib.rs` `generate_handler!` AFTER 13-06's `capture_route_screenshot`. 13-09 (Sync) will append `trigger_sync_animation` AFTER `analyze_pr_diff` in its own Wave 4 commit. Sibling 13-07 ran in parallel and modifies different files (Inspector / ServiceCard / ScreenCard / AtomChip citation halo wiring) — zero overlap with this plan. The merge surface in the metadata commit (13-07's STATE/ROADMAP/REQUIREMENTS got swept into 13-08's Task 2 commit because they were already staged when this plan ran `git add`) is harmless content — non-conflicting line-level updates, all related to plan completion bookkeeping.

## Deviations from Plan

None — plan executed exactly as written.

The plan's Rust pseudocode used camelCase JSON field names (`startLine`/`endLine`) for the `code_ranges` parsing; the actual schema uses snake_case (Rust serde default for `CodeRange`). This was caught at implementation time and corrected without scope change — same pattern, different field-name string. Not flagged as a Rule 1 deviation because the plan was explicit that the Rust IPC reads `code_ranges` via `serde_json::Value`-based field access, and the field-name correctness is a literal value, not a design choice.

## Issues Encountered

**Parallel-execution merge surface (informational, not a problem):** Sibling plan 13-07 finished mid-execution and ran its `gsd-tools state advance-plan` / `state update-progress` / `roadmap update-plan-progress` / `requirements mark-complete` commands, which staged `STATE.md`, `ROADMAP.md`, `REQUIREMENTS.md`, and dropped `13-07-SUMMARY.md`. When this plan ran `git add` for its Task 2 files (specific paths only, NOT `git add .`), git recorded all already-staged content into the commit. This is the documented behavior of `git commit` (commits the entire staged index, not just the args to `git add`). The Task 2 commit therefore contains a few non-13-08 metadata files. No conflict, no rework needed — the metadata is correct for both plans and the planning bookkeeping flows naturally.

## User Setup Required

None — no external service configuration required. The PR review panel reads the local SQLite DB and applies in-memory substrate overlays.

## Next Phase Readiness

**Plan 13-09 (Sync + Verifier + Harvest)** can now:
- Append `trigger_sync_animation` to `lib.rs` `generate_handler!` AFTER `analyze_pr_diff` (Wave 4 serialization continues).
- Reuse the sliding-panel pattern from `PRReviewPanel.tsx` for `VerifierPanel` / `SyncPanel` if its layout requires a right-edge dialog surface.
- Follow the snapshot-and-restore overlay pattern for any transient state preview the verifier or sync engine needs to render.

**Plan 13-10a (orange-flag fixture)** integrates seamlessly: when the SQL seed sets `substrate_nodes.intent_drift_state = 'DRIFTED'` for the staged demo atoms, the PR review panel will surface them in `intent_drifted_uuids` (with the `⚠` marker in the explanation), demonstrating the file-level vs intent-level differentiation called out in the plan's `<context>` block. Without the fixture, the demo still works file-level (every affected atom orange-glows; intent_drifted subset is empty).

**Plan 13-11 (rehearsal):** Cmd+Shift+P is the demo shortcut. Recorded demo should paste the staged scenario diff (per `.planning/demo/scenario-criteria.md`) and let the canvas light up — pitch quote "Paste a PR. Canvas lights up." The 30-second-readable target needs validation against the actual scenario diff during rehearsal; explanation copy can be tweaked in 13-11 if needed.

**Demo-side dependency:** No new responder script needed (PR review is fully IDE-side; the iframe doesn't participate). The chip overlay (plan 13-05/06) continues to render the orange-glow CVA state on AtomChips for affected uuids — no extra wiring needed.

---
*Phase: 13-substrate-ui-demo-polish*
*Completed: 2026-04-25*

## Self-Check: PASSED

All 5 created files exist on disk:
- `contract-ide/src/lib/diffToNodeMapper.ts`
- `contract-ide/src/lib/__tests__/diffToNodeMapper.test.ts`
- `contract-ide/src-tauri/src/commands/pr_review.rs`
- `contract-ide/src/components/substrate/PRReviewPanel.tsx`
- `contract-ide/src/components/substrate/PRReviewExplanation.tsx`

Both task commits found in git history:
- `1fa66b3` (Task 1: diffToNodeMapper + analyze_pr_diff Rust IPC)
- `69a296f` (Task 2: PRReviewPanel + PRReviewExplanation + Cmd+Shift+P)

Verification suite green: `cargo check` clean; `cargo test commands::pr_review` 2/2 pass; `vitest run` 86 passed + 1 skipped (was 82+1, +4 new diffToNodeMapper cases); `tsc --noEmit` clean.
