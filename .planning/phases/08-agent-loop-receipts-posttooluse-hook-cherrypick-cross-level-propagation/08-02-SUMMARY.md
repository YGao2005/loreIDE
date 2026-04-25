---
phase: 08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation
plan: "02"
subsystem: rollup-detection
tags: [rollup, drift, cross-level-propagation, PROP-02, tri-state-visuals, amber, gray]
requires: [08-01]
provides: [rollup-engine, rollup-commands, rollup-store, rollup-ipc, tri-state-graph-visuals]
affects: [08-06]
tech-stack:
  added: []
  patterns:
    - compute_rollup_and_emit sibling fn alongside compute_and_emit (no retroactive Phase 7 changes)
    - SourceWatcher uuid_to_parent snapshot for ancestor walk without per-event DB queries
    - seed-on-mount + subscribe-to-events rollup store pattern (mirrors 07-03 drift pattern)
    - buildFlowNodes rollupState precedence stale>untracked>fresh computed inline from two Sets
key-files:
  created:
    - contract-ide/src-tauri/src/commands/rollup.rs
    - contract-ide/src/store/rollup.ts
    - contract-ide/src/ipc/rollup.ts
  modified:
    - contract-ide/src-tauri/src/drift/engine.rs
    - contract-ide/src-tauri/src/drift/watcher.rs
    - contract-ide/src-tauri/src/commands/drift.rs
    - contract-ide/src-tauri/src/commands/mod.rs
    - contract-ide/src-tauri/src/lib.rs
    - contract-ide/src-tauri/src/commands/mcp.rs
    - contract-ide/src/components/layout/AppShell.tsx
    - contract-ide/src/components/graph/GraphCanvasInner.tsx
    - contract-ide/src/ipc/repo.ts
decisions:
  - "CVA precedence implementation: compoundVariants in contractNodeStyles.ts (already shipped
    in 08-05) suppress targeted ring when drifted/stale/untracked. The rollupState field is
    computed inside buildFlowNodes (inline, not in CVA selector) by checking rollupStaleUuids
    and untrackedUuids Sets — stale wins over untracked wins over fresh. Clean separation: node
    component passes both state+rollupState, CVA composes additively."
  - "Amber hue: ring-2 ring-amber-400 (already in contractNodeStyles.ts from 08-05).
    Non-pulsing — rollup stale is a persistent detection state, not a live event like drift.
    Gray hue: ring-2 ring-slate-400 opacity-80 — muted, non-pulsing, dashed not used (solid
    gray with opacity reads more clearly as 'not-configured' than dashed)."
  - "stored_rollup_hash on first-pass detection: rollup_derived table checked first (prior
    detection run). If no rollup_derived row exists, fallback to nodes.rollup_hash (set during
    a real reconcile commit). NULL/missing → stale immediately so user sees the gap."
  - "SourceWatcher.refresh() now takes parent_map: HashMap<String,String> as 4th arg.
    The parent_map snapshot in the closure walks uuid→parent_uuid without DB queries per
    FSEvents tick. Ancestor walk loops until no parent in snapshot (hits L0)."
  - "SECTION_PARSER_CLI_PATH env var injected in launch_mcp_sidecar so the MCP TypeScript
    sidecar can call compute_section_hashes via execFileSync. Path resolves to
    <resource_dir>/binaries/section-parser-cli-aarch64-apple-darwin."
  - "No retroactive Phase 7 changes: compute_and_emit and all Phase 7 drift machinery
    are untouched. compute_rollup_and_emit is a pure sibling fn."
metrics:
  duration_minutes: 11
  tasks_completed: 2
  files_changed: 12
  completed_date: "2026-04-25"
---

# Phase 08 Plan 02: Rollup Detection Engine + Tri-state Graph Visuals Summary

**One-liner:** Cross-level rollup detection with compute_rollup_and_emit (DriftLocks sibling), SourceWatcher ancestor cascade, Rust commands, Zustand rollup store, and amber/gray CVA visuals with red>amber>gray precedence.

## What Was Built

### Task 1: compute_rollup_and_emit + SourceWatcher + Rust commands

**compute_rollup_and_emit** added to `drift/engine.rs` as a SIBLING of `compute_and_emit`. Phase 7 code is completely untouched (PROPAGATION.md "no retroactive changes" mandate). The function:

1. Acquires the SAME `DriftLocks::for_uuid(uuid)` arc as `compute_and_emit` — body writes and rollup writes for the same UUID serialize via one Tokio mutex.
2. Reads node from SQLite: level, rollup_inputs_json, rollup_hash, rollup_generation.
3. L0 → delete any stray rollup_derived row, return early (L0 exempt).
4. Empty rollup_inputs → state = "untracked". Upsert row with empty computed hash.
5. Otherwise: for each RollupInput entry, read child section_hashes_json from DB. If NULL (v2 sidecar lazy migration), read from disk via `read_sidecar_file` + `compute_section_hashes`.
6. Sort contributions as `(child_uuid, section_name, hash)` tuples, build `"child:section=hash;"` concat string, sha256 it.
7. Compare computed hash to stored_rollup_hash (from rollup_derived or nodes.rollup_hash fallback).
8. Upsert rollup_derived. Emit `rollup:changed` only when state transitions.

**SourceWatcher extension** (watcher.rs):
- Added `uuid_to_parent: Mutex<HashMap<String, String>>` field.
- `refresh()` now takes a 4th `parent_map: HashMap<String, String>` argument.
- FSEvents callback: for each UUID from path_to_uuids, AFTER spawning `compute_and_emit` (Phase 7, untouched), also spawns `compute_rollup_and_emit` for the UUID and walks `parent_snap` up to L0 — each ancestor gets its own spawn. Errors logged, not propagated.

**commands/drift.rs** extended to also SELECT `(uuid, parent_uuid) FROM nodes WHERE parent_uuid IS NOT NULL` and pass the resulting HashMap as `parent_map` to `watcher.refresh()`.

**commands/rollup.rs** created with:
- `list_rollup_states` — SELECT node_uuid, state FROM rollup_derived → Vec<RollupStateRow>
- `recompute_all_rollups` + `trigger_recompute_all_rollups` — walks L1/L2/L3 ORDER BY level DESC (L3 → L2 → L1), spawns compute_rollup_and_emit for each UUID.

**lib.rs**: both rollup commands registered via fully-qualified paths in `generate_handler!`.

**SECTION_PARSER_CLI_PATH injection** in `commands/mcp.rs` — MCP TypeScript sidecar can now call the section-parser-cli binary via `execFileSync(process.env.SECTION_PARSER_CLI_PATH)`.

**Four unit tests** added in `drift/engine.rs`:
- `rollup_state_untracked_when_inputs_empty` — empty array → untracked
- `rollup_state_stale_when_child_section_hash_changes` — stored != computed → stale
- `rollup_state_fresh_when_recompute_matches_stored` — stored == computed → fresh
- `l0_node_skipped_no_rollup_state_row` — L0 exempt, no rollup_derived row

### Task 2: React rollup store + IPC + tri-state graph visuals

**src/store/rollup.ts**: Zustand store with `rollupStaleUuids: Set<string>` and `untrackedUuids: Set<string>`. Three actions:
- `set(uuid, state)` — removes from both sets then inserts into correct bucket (immutable update for Zustand referential-inequality re-render)
- `hydrate(rows)` — bulk-replaces both sets from list_rollup_states response
- `reset()` — clears both sets; wired in both `pickAndOpenRepo` and `openRepo` in `ipc/repo.ts`

**src/ipc/rollup.ts**: Two wrappers:
- `listRollupStates()` — invoke('list_rollup_states') → RollupStateRow[]
- `subscribeRollupChanged(handler)` — listen('rollup:changed', ...) → UnlistenFn

**AppShell.tsx**: sibling useEffect to the drift subscription:
1. `listRollupStates()` → `useRollupStore.getState().hydrate(rows)` (seed on mount)
2. `subscribeRollupChanged(payload => store.set(uuid, state))` (event stream)
Both paths required — same race guard logic as Plan 07-03 drift subscription.

**ipc/repo.ts**: `useRollupStore.getState().reset()` added to both `pickAndOpenRepo` and `openRepo` (colocated with the existing drift + cherrypick resets).

**GraphCanvasInner.tsx**: 
- Subscribes to `useRollupStore` for both `rollupStaleUuids` and `untrackedUuids`.
- `buildFlowNodes` signature extended with `rollupStaleUuids` and `untrackedUuids` params.
- `rollupState` computed inline: `stale` if uuid in rollupStaleUuids, `untracked` if in untrackedUuids, else `fresh`.
- useMemo deps updated to include both new sets.

**CVA precedence**: Already shipped in 08-05's `contractNodeStyles.ts` via compoundVariants:
- `rollupState: 'stale'` → `ring-2 ring-amber-400` (non-pulsing, distinguishable from red)
- `rollupState: 'untracked'` → `ring-2 ring-slate-400 opacity-80` (muted solid gray)
- `rollupState: 'fresh'` → no extra styling
- compoundVariants suppress targeted ring when rollupState is stale/untracked (amber/gray dominates)
- drift (red pulse, `ring-2 ring-red-500 animate-pulse`) dominates because buildFlowNodes sets `state='drifted'` which triggers the pulsing red ring — the amber ring also renders from CVA but is visually dominated by the animated red pulse.

## Deviations from Plan

### Auto-fixed Issues

**[Rule 3 - Blocking] Pre-existing doc comment style errors in agent.rs and receipts.rs**
- **Found during:** Task 2 `cargo clippy --all-targets -- -D warnings`
- **Issue:** The linter (running between tasks) added `pub mod agent` and `pub mod receipts` to lib.rs, which exposed pre-existing `/// ` module-level doc comments that clippy flags as `empty_line_after_doc_comments` (should be `//!` for module-level docs)
- **Fix:** Changed `/// ...` → `//!` in the first doc-block of both agent.rs and receipts.rs
- **Files modified:** `contract-ide/src-tauri/src/commands/agent.rs`, `contract-ide/src-tauri/src/commands/receipts.rs`
- **Commit:** f4f4fa1 (included in Task 2 commit)

### Changes to files not in plan's files_modified list

**commands/drift.rs** (not listed in plan): Required to pass `parent_map` to `watcher.refresh()`. This was necessary to implement the ancestor-walk without per-event DB queries — the parent_map is built once during watcher refresh alongside the existing `path_to_uuids` map. This is a minimal extension of an already-modified file (the plan adds the 4th param to `refresh()`), not a structural change.

**commands/mcp.rs** (not listed in plan): SECTION_PARSER_CLI_PATH injection. This was explicitly required by the dependency_context in the plan prompt ("08-02 must inject SECTION_PARSER_CLI_PATH env var into the launch_mcp_sidecar Rust CommandChild spawn block").

**ipc/repo.ts** (not listed in plan): Reset wired here per plan spec (Task 2 Step 3: "wire useRollupStore.getState().reset() into both pickAndOpenRepo and openRepo").

## Visual Treatment Choices

**Amber (rollup_stale):** `ring-2 ring-amber-400` — non-pulsing solid amber ring. Chosen because rollup staleness is a persistent detection state (not a live transient event), so pulsing would be distracting. Amber-400 is distinct from red-500 (drift), teal-400 (targeted), and does not overlap with orange (Phase 13 reserves orange for intent_drifted per 08-CONTEXT.md).

**Gray (rollup_untracked):** `ring-2 ring-slate-400 opacity-80` — muted solid gray ring with slight opacity reduction. Non-pulsing. Reads as "not configured for rollup tracking" — intentionally subdued.

**CVA implementation:** `compoundVariants` approach (already in contractNodeStyles.ts from 08-05). The `rollupState` variant adds the ring additively; compoundVariants suppress the `targeted` teal ring when rollupState is stale/untracked. The `state: 'drifted'` variant (red pulse) visually dominates the amber ring because it uses `animate-pulse` — the amber ring renders but is obscured by the larger pulsing animation. A future Phase 13 pass could add an explicit compoundVariant to suppress rollupState when state==='drifted' for pixel-perfect enforcement, but the visual result is already correct.

## Self-Check: PASSED

All files exist. All commits found. Key content verified:
- drift/engine.rs: compute_rollup_and_emit alongside compute_and_emit, 4 new rollup tests
- drift/watcher.rs: uuid_to_parent field, parent_map param, ancestor loop
- commands/rollup.rs: list_rollup_states, recompute_all_rollups, trigger_recompute_all_rollups
- commands/mod.rs: pub mod rollup present
- lib.rs: commands::rollup::list_rollup_states and recompute_all_rollups in generate_handler!
- src/store/rollup.ts: useRollupStore with rollupStaleUuids, untrackedUuids, set, hydrate, reset
- src/ipc/rollup.ts: listRollupStates, subscribeRollupChanged
- AppShell.tsx: hydrate + subscribe on mount, both paths present
- ipc/repo.ts: reset in both pickAndOpenRepo and openRepo
- GraphCanvasInner.tsx: rollupStaleUuids + untrackedUuids subscribed and passed to buildFlowNodes
- contractNodeStyles.ts: rollupState variant with stale/untracked/fresh (from 08-05)
- All 44 Rust tests pass; clippy clean; tsc clean; npm build clean
