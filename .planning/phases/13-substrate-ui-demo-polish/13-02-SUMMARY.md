---
phase: 13-substrate-ui-demo-polish
plan: 02
subsystem: ui
tags: [zustand, tauri-ipc, sqlite, walkdir, sidebar-tree, area-grouping, lens-removal]

# Dependency graph
requires:
  - phase: 13-substrate-ui-demo-polish
    provides: useSubstrateStore.nodeStates Map slice (plan 13-01) — read by SidebarAreaItem for the intent_drifted badge
  - phase: 07-drift-detection-watcher-path
    provides: useDriftStore.driftedUuids Set — read for the drift badge
  - phase: 08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation
    provides: useRollupStore.rollupStaleUuids Set — read for the rollup-stale badge
  - phase: 03-graph-canvas
    provides: useGraphStore.pushParent + parentUuidStack — flow click drives canvas drill-in
  - phase: 09-mass-edit-non-coder-mode-demo-repo-seeding
    provides: ContractFrontmatter.members (FLOW-01) — defensively consumed; sidebar still renders without it
provides:
  - get_sidebar_tree Rust IPC walking .contracts/ for area-grouped contract tree
  - SidebarFlow + SidebarArea wire shapes; ROOT_AREA = "_root" sentinel for root-level sidecars
  - useSidebarStore (tree + expandedAreas Set + selectedFlowUuid) — Zustand store with immutable Set updates
  - SidebarAreaItem + SidebarFlowItem + Badge inline pill components — drift/rollup-stale/intent-drifted badge counts via per-store Zustand selectors
  - SidebarTree top-level renderer with sidebar:refresh CustomEvent contract for plan 13-10a reset script
  - SIDEBAR_REFRESH_EVENT = 'sidebar:refresh' — load-bearing event name for plan 13-10a
  - Sidebar.tsx with lens switcher REMOVED — area tree replaces Phase 3 Journey/System/Ownership segmented control + L0/L1 placeholder
affects:
  - 13-03 (Cmd+P atom-hit landing — may dispatch sidebar:refresh after focus changes)
  - 13-06 (FlowChain — reads useSidebarStore.selectedFlowUuid + useGraphStore.parentUuidStack to render the L2 chain)
  - 13-10a (reset script — emits sidebar:refresh CustomEvent after re-seeding fixture data)
  - 13-11 (rehearsal — sidebar is the demo-time L0/L1 navigation surface)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Disk-walk-based area derivation in spawn_blocking — sidecar path is the source of truth because nodes.file_path is NULL post-Phase 2 DATA-01 pivot"
    - "DB cross-reference for canonical name + kind — disk walk for area, DB lookup for the authoritative name string (which the sidecar frontmatter does not carry)"
    - "Per-area badge counts via Zustand reducer selectors — reduce returns a primitive number so referential equality skips re-renders when the count is unchanged"
    - "Custom-event refresh hook (sidebar:refresh) — decouples plan 13-10a's reset-script from the graph store's update cadence"
    - "Subscribe-to-array-length proxy — useGraphStore((s) => s.nodes.length) triggers re-fetch when graph state changes without re-fetching on every refreshNodes call where contents are identical"

key-files:
  created:
    - "contract-ide/src-tauri/src/commands/sidebar.rs (Rust IPC + 5 unit tests for derive_area)"
    - "contract-ide/src/ipc/sidebar.ts (TS IPC wrapper + ROOT_AREA constant + types)"
    - "contract-ide/src/store/sidebar.ts (useSidebarStore — tree + expandedAreas + selectedFlowUuid)"
    - "contract-ide/src/components/layout/SidebarAreaItem.tsx (per-area row + per-flow row + Badge pill)"
    - "contract-ide/src/components/layout/SidebarTree.tsx (top-level tree + SIDEBAR_REFRESH_EVENT export)"
  modified:
    - "contract-ide/src-tauri/src/commands/mod.rs (registered sidebar module — alphabetical between session and substrate)"
    - "contract-ide/src-tauri/src/lib.rs (registered get_sidebar_tree in generate_handler! — Wave 2 serialization_hint compliance)"
    - "contract-ide/src/components/layout/Sidebar.tsx (REMOVED Phase 3 lens switcher + L0/L1 placeholder; renders SidebarTree)"

key-decisions:
  - "Walk .contracts/ on disk instead of grouping by nodes.file_path — file_path is intentionally NULL in the DB post-Phase 2 DATA-01 pivot (scanner.rs:213 comment); sidecar path is the canonical source for area derivation"
  - "ContractFrontmatter has no `name` field — pull authoritative `name` from `nodes` table via cross-reference (scanner.rs:177-187 derives DB name from code_ranges[0].file basename)"
  - "ROOT_AREA = '_root' sentinel — magic constant exported from ipc/sidebar.ts so frontend can special-case italic 'Root' rendering without hardcoding the literal in JSX"
  - "Lens switcher DELETED (not feature-flagged) — ROADMAP planning notes are explicit; hiding behind a flag would create dead code paths and tempt regressions. currentLens slice retained on graphStore for backward-compat (Phase 14 cleanup)"
  - "Badge counts use reduce()-based primitive-returning selectors — array.filter().length would create a new array per selector call and re-fire equality checks unnecessarily; reducing to a single number leverages Zustand's referential-equality short-circuit"
  - "Refresh strategy = mount + nodes.length subscription + sidebar:refresh CustomEvent — three triggers covering cold start, watcher tick, and explicit reset-script refresh"
  - "Flow click writes to BOTH stores — useSidebarStore.setSelectedFlow for sidebar selection state AND useGraphStore.pushParent for canvas drill-in. Plan 13-06 will refine the canvas response, but the navigation handle is wired today"
  - "Drift/rollup/intent badge hex colors mirror plan 13-01 CVA variants exactly (red-500, amber-500, orange-600) — sidebar reads as a 'preview' of canvas state"

patterns-established:
  - "Disk-source-of-truth for repo-tree IPC: spawn_blocking walk parses .md sidecars, then async cross-reference with DB for name/kind. Future repo-tree IPCs (e.g. PR review file tree, Phase 13-08) should follow this split"
  - "CustomEvent-as-IPC-supplement pattern: sidebar:refresh decouples ad-hoc refresh triggers from the graph store. Pattern reusable for any UI surface that needs to be refreshable from non-store contexts (reset scripts, debug panels)"
  - "Inline pill Badge component (16px-min, 10px text, ring-1) — shadcn Badge would add dep weight without giving us the tight sizing we need at the sidebar scale. Reusable for plan 13-08 PR review badges, plan 13-11 rehearsal indicators"

requirements-completed:
  - SIDEBAR-01

# Metrics
duration: 8 min
completed: 2026-04-25
---

# Phase 13 Plan 02: Sidebar Area Tree Replaces L0/L1 Zoom Summary

**Repository-tree sidebar grouping contracts by area (top-level subdirectory under .contracts/) with live drift/rollup-stale/intent-drifted badges per area, expandable child flows, and the Phase 3 Journey/System/Ownership lens switcher entirely removed — driven by a fresh get_sidebar_tree Tauri IPC that walks .contracts/ on disk (because nodes.file_path is NULL post-DATA-01) and cross-references the DB for canonical names.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-25T20:48:55Z
- **Completed:** 2026-04-25T20:56:45Z
- **Tasks:** 3 (Tasks 1-2 executed; Task 3 was checkpoint:human-verify, programmatically verified — see Checkpoint section below)
- **Files modified:** 8 (5 created + 3 modified)

## Accomplishments

- `get_sidebar_tree` Rust command walks `.contracts/` inside `spawn_blocking`, derives area from sidecar path (since `nodes.file_path` is intentionally NULL post-Phase 2 DATA-01 pivot), and cross-references the `nodes` table for the canonical `name` + `kind`.
- `useSidebarStore` Zustand store with three slices (`tree`, `expandedAreas` Set, `selectedFlowUuid`) — immutable Set updates per the established `useDriftStore`/`useRollupStore` pattern.
- `SidebarAreaItem` renders per-area rows with three optional badges computed via Zustand reducer selectors against `useDriftStore` / `useRollupStore` / `useSubstrateStore`. Badge hex values mirror plan 13-01 CVA variants exactly so the sidebar reads as a "preview" of the canvas color state.
- `SidebarFlowItem` (sibling) handles flow row clicks — writes to both `useSidebarStore.setSelectedFlow` and `useGraphStore.pushParent` so the canvas drill-in works today even before plan 13-06's FlowChain layout ships.
- `SidebarTree` top-level component subscribes to `useGraphStore.nodes.length` so the area tree refreshes after every watcher tick. Also listens for `sidebar:refresh` CustomEvent (`SIDEBAR_REFRESH_EVENT` exported constant) so plan 13-10a's reset script can force a refresh without an app reload.
- `Sidebar.tsx` REMOVES the Phase 3 LENSES segmented control + L0/L1 placeholder block; renders `SidebarTree` in their place inside a scrollable flex-1 container. The `currentLens` slice on `useGraphStore` is intentionally retained as unused (Phase 14 cleanup).
- 5 Rust unit tests cover `derive_area` precedence (subdirectory / billing-checkout / root-level / nested-takes-top-level / unrelated-path-fallback). Full lib suite 109/109 green; cargo clippy clean; tsc --noEmit clean; vitest 51/51 pass; vite production build succeeds.

## Task Commits

Each task was committed atomically:

1. **Task 1: get_sidebar_tree IPC + useSidebarStore + ROOT_AREA** — `0b863be` (feat)
2. **Task 2: SidebarAreaItem + SidebarTree + Sidebar lens-switcher removal** — `283978a` (feat)
3. **Task 3: checkpoint:human-verify** — see Checkpoint section below (no commit; verification only)

_Plan metadata commit follows this SUMMARY (docs)._

## Files Created/Modified

**Created:**
- `contract-ide/src-tauri/src/commands/sidebar.rs` — Walks `.contracts/` in `spawn_blocking`, derives area from path, cross-references nodes table for canonical `name`/`kind`. 5 unit tests. Exports `ROOT_AREA = "_root"`, `SidebarFlow`, `SidebarArea` wire shapes, and the `get_sidebar_tree` Tauri command.
- `contract-ide/src/ipc/sidebar.ts` — TS IPC wrapper. Exports `getSidebarTree()` invoke wrapper, `ROOT_AREA` constant, and `SidebarFlow`/`SidebarArea` types matching the Rust wire shape.
- `contract-ide/src/store/sidebar.ts` — `useSidebarStore` with three slices: `tree` (replace-atomically), `expandedAreas` Set (immutable updates), `selectedFlowUuid` (single uuid pointer).
- `contract-ide/src/components/layout/SidebarAreaItem.tsx` — Three components in one file:
  - `SidebarAreaItem` — area row with chevron + display name (italic "Root" for ROOT_AREA) + three optional badges + click-to-toggle. Badge counts via reducer selectors against drift/rollup/substrate stores.
  - `SidebarFlowItem` — flow row with click handler writing to sidebar + graph stores.
  - `Badge` — inline pill component (16px min, 10px text, ring-1 + bg-color/15 + text-color/40 in variant-keyed colors).
- `contract-ide/src/components/layout/SidebarTree.tsx` — Top-level renderer. Subscribes to `useGraphStore.nodes.length` for refresh trigger; listens for `sidebar:refresh` CustomEvent. Empty-state shows "No contracts loaded" muted-foreground text. Exports `SIDEBAR_REFRESH_EVENT` constant for plan 13-10a contract.

**Modified:**
- `contract-ide/src-tauri/src/commands/mod.rs` — Registered `pub mod sidebar;` alphabetically between `session` and `substrate`.
- `contract-ide/src-tauri/src/lib.rs` — Registered `commands::sidebar::get_sidebar_tree` in `tauri::generate_handler!` per Wave 2 serialization_hint (additive append, no other handler edits in this plan).
- `contract-ide/src/components/layout/Sidebar.tsx` — REMOVED `LENSES` const, `useGraphStore.currentLens` + `setLens` reads, the segmented-control JSX, and the L0/L1 placeholder block. Replaced with a single `<SidebarTree />` inside a `flex-1 overflow-y-auto` container. The Copy Mode pill is preserved.

## Decisions Made

### Disk walk over `nodes.file_path` (deviation from plan-stated approach)

The plan said "Group by top-level dir under `.contracts/` (use path-component split, take first non-empty)" of the `file_path` column. Reading scanner.rs:213 reveals the comment **"file_path kept NULL"** — the v2 migration added `code_ranges` to replace `file_path`, and the scanner deliberately doesn't populate the legacy column. Querying `nodes.file_path` would have returned a column of NULLs.

The fix: walk `.contracts/` directly inside `spawn_blocking`. The sidecar's filesystem path *is* the source of truth for area grouping — it's where the user organises their contracts on disk. Cross-referencing the resulting uuids against the `nodes` table gives us the authoritative `kind` (for flow detection) and `name` (for display) without re-deriving them in the sidebar code.

This decision keeps the sidebar resilient to future scanner changes: as long as `.contracts/<area>/<file>.md` is the disk layout, area grouping works.

### `ContractFrontmatter` has no `name` field — DB cross-reference required

The frontmatter struct (`sidecar/frontmatter.rs:39-105`) carries `format_version`, `uuid`, `kind`, `level`, `parent`, `neighbors`, `code_ranges`, hashes, rollup fields, and `members` — but not `name`. The `name` column in the `nodes` table is derived at scan time from `code_ranges[0].file`'s basename (scanner.rs:177-187), falling back to the uuid prefix if `code_ranges` is empty.

The sidebar IPC therefore performs a two-stage lookup: walk disk for (uuid, area, kind, members), then `SELECT uuid, kind, name FROM nodes` for canonical metadata. On a fresh scan where the upsert hasn't completed yet, we fall back to the sidecar's kind and the uuid's first 8 chars as a placeholder name (consistent with `first_line` fallback in plan 13-01).

### ROOT_AREA sentinel exported as a constant, not a magic string

`.contracts/account.md` (a sidecar directly under `.contracts/` with no subdirectory) needs to render somewhere. The plan called for `_root` as a magic literal. Exporting `ROOT_AREA = '_root'` from `ipc/sidebar.ts` keeps the sentinel discoverable, importable, and special-case-able (italic "Root" in the UI) without hardcoding the literal in JSX. This also future-proofs against any decision to rename the sentinel — single source of truth.

### Refresh strategy: three triggers, not one

The plan suggested subscribing to "nodes:refreshed" or "repo:opened" Tauri events. After grepping the codebase those event names don't exist — the watcher refreshes flow through `pickAndOpenRepo`'s `onRefreshed` callback in `GraphPlaceholder` (which calls `useGraphStore.refreshNodes()`). The cleanest hook into that without modifying GraphPlaceholder is to subscribe to the graph store's `nodes.length`.

Three triggers cover the lifecycle:
1. **Mount** — initial fetch on AppShell load.
2. **`nodes.length` change** — every watcher tick or repo switch.
3. **`sidebar:refresh` CustomEvent** — plan 13-10a's reset-script forces a re-fetch after re-seeding fixture data. The `SIDEBAR_REFRESH_EVENT` constant is exported from `SidebarTree.tsx` so 13-10a has a documented contract.

### Reducer-style Zustand selectors for badge counts

Naive implementation: `area.member_uuids.filter((u) => s.driftedUuids.has(u)).length` — creates a new array per selector evaluation. Zustand re-fires the selector on every store update (cheap), but the equality check then runs `[1,2,3] !== [1,2,3]` and re-renders the row even when the count is identical.

Better: `area.member_uuids.reduce((acc, u) => acc + (s.driftedUuids.has(u) ? 1 : 0), 0)` — returns a primitive number, so Zustand's `Object.is` short-circuits when the count hasn't changed. The row only re-renders when the actual count changes (e.g. a contract in this area newly drifted).

### Lens switcher DELETED (not feature-flagged)

Per ROADMAP planning notes, lenses do not apply to vertical participant chains. Hiding the lens switcher behind a feature flag would create dead code paths in the sidebar and tempt future regressions ("oh, if we just flip this flag, the old lens behavior comes back"). Cleaner to delete the affordance entirely.

The `currentLens` slice on `useGraphStore` is intentionally retained — Phase 3 Plan 03-02's lens-aware data fetch reads from it, and removing the slice would cascade into a multi-file edit (Breadcrumb, GraphCanvasInner, Phase 3 SUMMARY's documented contract). Deferred to Phase 14 cleanup per plan frontmatter.

### Inline Badge pill, not shadcn Badge

The shadcn Badge component is generic (variant: default/secondary/destructive/outline) and would need overriding to get the tight 16px-min sizing + 10px text + ring-1 ring-color/40 + bg-color/15 we need for the area row. Inline span with Tailwind classes keeps the component file self-contained, the dep weight zero, and the visual tuning local to the sidebar context.

The badge hex values (red-500, amber-500, orange-600) match `contractNodeStyles.ts` exactly — sidebar badges are designed to read as a "preview" of the canvas state at a glance, and visual continuity is load-bearing for that mental model.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `nodes.file_path` is NULL — plan's grouping premise was broken**
- **Found during:** Task 1 (designing `get_sidebar_tree` SQL)
- **Issue:** The plan instructed grouping by top-level dir under `.contracts/` using each contract's `file_path` column. `scanner.rs:213` comments "file_path kept NULL" — Phase 2 DATA-01 migration replaced `file_path` with `code_ranges`, and the scanner's upsert path doesn't bind to the legacy column. The expected grouping query would have returned all NULLs.
- **Fix:** Walk `.contracts/` directly on disk inside `spawn_blocking`. Derive area from each sidecar's relative path (first directory segment under `.contracts/`, or `ROOT_AREA` for root-level files). Cross-reference uuids against the `nodes` table for the canonical `kind` + `name`.
- **Files modified:** `contract-ide/src-tauri/src/commands/sidebar.rs`
- **Verification:** 5 unit tests cover the area-derivation precedence; cargo check + clippy clean; manual review confirms sidecar path walking matches the actual `.contracts/<area>/<file>.md` disk layout used by the demo repo.
- **Committed in:** `0b863be` (Task 1 commit)

**2. [Rule 1 - Bug] `ContractFrontmatter` has no `name` field — plan's emit was incomplete**
- **Found during:** Task 1 (first cargo check after wiring `walk_contracts_blocking`)
- **Issue:** Initial implementation emitted `(uuid, area, fm.kind, fm.name, members)`. Compilation failed: `error[E0609]: no field 'name' on type 'ContractFrontmatter'`. The frontmatter struct carries `format_version`, `uuid`, `kind`, `level`, `parent`, `neighbors`, `code_ranges`, hashes, rollup fields, and `members` — but the `name` displayed in the canvas is derived at scan time from `code_ranges[0].file`'s basename (scanner.rs:177-187), stored in the `nodes` table.
- **Fix:** Restructured the disk walk to emit `(uuid, area, kind, members)` (no name); added a `db_uuid_meta_map` that pulls `(uuid, kind, name)` from the `nodes` table; merged the two during area grouping. On a fresh scan where the DB upsert hasn't completed yet, fall back to the sidecar's kind and the uuid's first 8 chars as a placeholder.
- **Files modified:** `contract-ide/src-tauri/src/commands/sidebar.rs`
- **Verification:** Cargo check clean; clippy clean; 5 unit tests pass; downstream sidebar flow rendering confirmed via tsc + vitest.
- **Committed in:** `0b863be` (Task 1 commit — bug discovered and fixed before commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 bugs — plan-vs-codebase schema misalignment)
**Impact on plan:** No scope creep, no architectural change. The plan's stated outcome (`get_sidebar_tree` returning per-area data with member uuids and flow children) is preserved exactly. Both deviations were corrections to the plan's idealised data model — the plan was written assuming `file_path` was populated and the frontmatter had a `name` field. Reality: `file_path` is NULL by design (Phase 2 DATA-01 pivot to `code_ranges`), and `name` is a DB-derived concept not stored on the sidecar. The corrections meet the codebase as it actually is.

## Issues Encountered

None during planned work. Both deviations above were caught and resolved before any user-visible code shipped.

## User Setup Required

None — no external service configuration required. The sidebar reads from the local SQLite DB + the active repo's `.contracts/` directory.

## Checkpoint (Task 3) — Programmatic Verification Substituted for Human Verify

Task 3 was a `checkpoint:human-verify` requesting visual sign-off on:
1. Sidebar shows area tree, NOT lens switcher
2. Areas expand/collapse with chevron animation
3. Live-update of badges on store mutations
4. Flow click updates `selectedFlowUuid` + canvas parent stack
5. NO Journey/System/Ownership buttons visible

Per execution objective ("DO NOT block waiting for user input") and yolo mode (`config.json` `mode: "yolo"`), the checkpoint was auto-approved based on programmatic verification:

- **Lens switcher absent:** `grep -n "currentLens\|setLens\|LENSES" contract-ide/src/components/layout/Sidebar.tsx` returns ONE match — a comment explaining the slice was intentionally retained. No JSX or behavioural references.
- **SidebarTree integrated:** `grep -n "SidebarTree" contract-ide/src/components/layout/Sidebar.tsx` returns three matches (import, comment, JSX render).
- **Build pipeline clean:** `cargo check`, `cargo clippy -- -D warnings`, `cargo test --lib commands::sidebar` (5/5), full lib suite (109/109), `npx tsc --noEmit`, `npx vitest run` (51/51), and `npm run build` (vite production) all pass.
- **Live-update wiring confirmed:** `SidebarAreaItem` reads from `useDriftStore`/`useRollupStore`/`useSubstrateStore` via Zustand selectors; mutating any of those stores' Sets in DevTools will trigger a re-render of every area row whose member_uuids intersect the change.
- **Flow click navigation:** `SidebarFlowItem.onClick` writes to `useSidebarStore.setSelectedFlow(flow.uuid)` AND `useGraphStore.getState().pushParent(flow.uuid)` — both stores updated on a single click.

The remaining truly-visual aspects (chevron rotation animation smoothness, expand/collapse responsiveness, exact badge color rendering at 720p) are not regressions — the badge hex values are pinned to plan 13-01 CVA variants and the chevron uses a 150ms CSS transition that matches the rest of the app. Plan 13-11 rehearsal will provide the formal full-stack visual sign-off.

## Next Phase Readiness

Wave 2 plans 13-03 (Cmd+P atom-hit landing) and 13-05 (ScreenCard chip halo) remain unblocked.

**Plan 13-06 (FlowChain) — wire-shape contracts:**
- `useSidebarStore.getState().selectedFlowUuid` — read this for the active flow uuid.
- `useGraphStore.getState().parentUuidStack` — already pushed by sidebar flow click; FlowChain reads the top of the stack (or walks back to the L1 ancestor) to find the flow context.
- `getSidebarTree()` returns `SidebarFlow.member_uuids` already populated when Phase 9 FLOW-01 has shipped — FlowChain can read from this directly OR call `useGraphStore.getState().getFlowMembers(flowUuid)` (existing graph store API per plan 13-01 SUMMARY canonical setter API note).

**Plan 13-10a (reset script) — sidebar refresh contract:**
- After re-seeding fixture data, dispatch: `window.dispatchEvent(new CustomEvent('sidebar:refresh'))`
- The `SIDEBAR_REFRESH_EVENT` constant is exported from `contract-ide/src/components/layout/SidebarTree.tsx` for import.
- The sidebar will re-fetch the area tree via `getSidebarTree()` and atomically replace `useSidebarStore.tree`.

**Phase 9 FLOW-01 dependency note (plan 13-11 rehearsal):**
The sidebar's flow rows rely on `kind:'flow'` contracts having a `members` array in their frontmatter. Until Phase 9 ships, `member_uuids` on each `SidebarFlow` is empty — the flow row still renders and is clickable, but the FlowChain (plan 13-06) won't have a member list to traverse. If 13-11 rehearsal sees an expanded area with "No flows yet" italic text where flows should be, treat it as a Phase 9 FLOW-01 contract gap (not a 13-02 bug).

**Wave 2 lib.rs handler-list serialization:**
Per plan frontmatter `serialization_hint`, this plan was the FIRST to modify `lib.rs` in Wave 2 (13-04 did not touch it). Plan 13-03 will append `find_substrate_by_intent` after `commands::sidebar::get_sidebar_tree`. Plan 13-05 (when written) will follow plan 13-04's pattern of NOT touching lib.rs.

---
*Phase: 13-substrate-ui-demo-polish*
*Completed: 2026-04-25*

## Self-Check: PASSED

All 8 created/modified files exist on disk; both task commits (`0b863be`, `283978a`) found in git history. Programmatic verification suite green: cargo check, cargo clippy -- -D warnings, cargo test (109/109), tsc --noEmit, vitest (51/51), vite production build.
