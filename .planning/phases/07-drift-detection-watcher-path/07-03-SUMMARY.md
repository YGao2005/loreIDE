---
phase: 07-drift-detection-watcher-path
plan: "03"
subsystem: react-drift-subscriber
tags: [react, typescript, zustand, tauri-event, drift, graph-canvas]
dependency_graph:
  requires:
    - 07-02 (acknowledge_drift Tauri command + drift:changed event emitter live in Rust)
    - 03-01 (contractNodeStyles.ts drifted CVA variant: ring-2 ring-red-500 animate-pulse)
  provides:
    - store/drift.ts: useDriftStore with driftedUuids Set<string> + setDrifted + reset
    - ipc/drift.ts: subscribeDriftChanged() listen wrapper + acknowledgeDrift() invoke wrapper
    - AppShell: drift:changed subscription mounted once with proper cleanup
    - GraphCanvasInner: buildFlowNodes promotes state to 'drifted' when uuid in driftedUuids
  affects:
    - 07-04 (UAT: 2s red pulse end-to-end; acknowledgeDrift imported from ipc/drift.ts)
    - Inspector (reads drift state for reconcile badge — shared store)
tech_stack:
  added: []
  patterns:
    - Immutable Set update in Zustand (new Set(s.driftedUuids)) — referential inequality triggers re-render
    - useDriftStore.getState() inside listen callback (not hook) — avoids stale closure over React state
    - buildFlowNodes accepts driftedUuids as parameter — keeps function pure and useMemo deps explicit
    - AppShell subscription mount pattern (let unsub; promise.then(u => unsub=u); return () => unsub?.()) matching McpStatusIndicator pattern
key_files:
  created:
    - contract-ide/src/store/drift.ts
    - contract-ide/src/ipc/drift.ts
  modified:
    - contract-ide/src/components/layout/AppShell.tsx (subscribeDriftChanged import + useEffect)
    - contract-ide/src/components/graph/GraphCanvasInner.tsx (useDriftStore + buildFlowNodes param + useMemo deps)
    - contract-ide/src/ipc/repo.ts (useDriftStore.getState().reset() in pickAndOpenRepo + openRepo)
decisions:
  - "buildFlowNodes signature changed to accept driftedUuids: Set<string> as second param (instead of closing over a module-level variable) — keeps the function pure and co-locates the dep in the useMemo deps array"
  - "drift overrides ALL other health states — driftedUuids.has(uuid) ? 'drifted' : 'healthy'; no existing 'untested' state was in use (Phase 3 shipped 'healthy' as const hardcoded with TODO comment)"
  - "Repo-switch reset wired in both pickAndOpenRepo AND openRepo entry points — missing either leaves stale red pulse from previous repo (latent bug, both paths confirmed in repo.ts)"
  - "No new CSS written — 'drifted' CVA variant (ring-2 ring-red-500 animate-pulse) was already present in contractNodeStyles.ts from Phase 3 Plan 03-01"
metrics:
  duration: ~2 minutes
  completed: 2026-04-24
  tasks_completed: 2
  files_changed: 5
---

# Phase 7 Plan 03: React Drift Event Consumer — Summary

**One-liner:** Zustand `useDriftStore` (immutable Set-based, reset-on-repo-switch) wired to Rust `drift:changed` events via `subscribeDriftChanged()` at AppShell mount; `buildFlowNodes` promotes node `state` to `'drifted'` when uuid is in the set, activating the existing `ring-2 ring-red-500 animate-pulse` CVA variant with no new CSS.

## What Was Built

**`store/drift.ts`** — `useDriftStore` Zustand slice with three actions:
- `driftedUuids: Set<string>` — the source of truth for which UUIDs are currently drifted
- `setDrifted(uuid, drifted)` — immutable update (creates `new Set(...)` to guarantee referential inequality and trigger React re-render)
- `reset()` — clears all drift state; called on repo switch

**`ipc/drift.ts`** — two exports, one module:
- `subscribeDriftChanged()`: `listen<DriftChangedPayload>('drift:changed', ...)` → updates store via `useDriftStore.getState().setDrifted(...)`. Returns unlisten handle. `DriftChangedPayload` uses camelCase field names (`currentCodeHash`, `baselineCodeHash`) matching Rust `#[serde(rename_all = "camelCase")]`.
- `acknowledgeDrift(uuid)`: thin `invoke('acknowledge_drift', { uuid })` wrapper for Plan 07-04.

**`AppShell.tsx`** — new `useEffect` mounts the subscription exactly once:
```
let unsub; subscribeDriftChanged().then(u => unsub = u); return () => unsub?.()
```
Follows the same `McpStatusIndicator` pattern. Mounted at AppShell (not GraphCanvas) so drift state survives graph unmount/remount and is available app-wide (Inspector drift badge in future plans).

**`GraphCanvasInner.tsx`** — three changes:
1. Import `useDriftStore` from `@/store/drift`
2. `const driftedUuids = useDriftStore((s) => s.driftedUuids)` in component body
3. `buildFlowNodes` signature: `(rows, driftedUuids)` — state promotion: `driftedUuids.has(row.uuid) ? 'drifted' : 'healthy'`
4. `useMemo` deps updated: `[rows, driftedUuids]` — drift churn triggers re-render correctly

**`ipc/repo.ts`** — drift store reset wired at both repo-switch entry points:
- `pickAndOpenRepo`: after `useGraphStore.getState().setRepoPath(folder)`
- `openRepo`: after `useGraphStore.getState().setRepoPath(repoPath)`

## Repo-switch Reset Wiring

`useDriftStore.getState().reset()` was added at **two locations** in `contract-ide/src/ipc/repo.ts`:
- Line ~55: inside `pickAndOpenRepo`, right after `setRepoPath(folder)` — user-picker flow
- Line ~102: inside `openRepo`, right after `setRepoPath(repoPath)` — programmatic reopen flow (Phase 4 Plan 04-01 cold-start rehydration path)

Both confirmed present via `grep -n "useDriftStore.getState().reset" repo.ts` → exactly 2 lines.

## buildFlowNodes and useMemo

`buildFlowNodes` already ran in a `useMemo` (the Phase 3 baseline kept the memo for perf). The `driftedUuids` parameter was added to both the function signature and the `useMemo` deps array. Under rapid drift churn:
- Each watcher event creates a new `Set` (immutable store update)
- Zustand's referential inequality check fires a `GraphCanvasInner` re-render
- `useMemo` sees `driftedUuids` changed, re-runs `buildFlowNodes` with the new set
- At ~500 nodes this is sub-frame; no perf concerns at hackathon scale

## Deviations from Plan

None — plan executed exactly as written.

The one implementation detail: Phase 3 hardcoded `state: 'healthy' as const` with a `// Phase 7 (DRIFT-01) populates real drift state` TODO comment. There was no existing `'untested'` state to preserve in the non-drifted branch, so the ternary `driftedUuids.has(uuid) ? 'drifted' : 'healthy'` is the complete replacement. No existing state logic was lost.

## Debug Logs

No debug logs were added during Task 2. The pre-existing `console.log('[AppShell] rehydrate ...')` calls in AppShell.tsx are from Plan 04-01 and were not added by this plan.

## Smoke Test

Smoke test (npm run tauri dev + file edit → node pulse) was **not executed** — this requires a running Tauri dev environment and a seeded repo with tracked source files. The TypeScript compilation is clean and the data plumbing is correct end-to-end. Full UAT (2s red pulse criterion DRIFT-01) is the scope of Plan 07-04.

## Task Commits

1. **Task 1: Zustand drift store + IPC wrapper** — `b950cf0`
   - Files: `store/drift.ts`, `ipc/drift.ts`

2. **Task 2: AppShell subscription + GraphCanvasInner + repo reset** — `7a3965f`
   - Files: `AppShell.tsx`, `GraphCanvasInner.tsx`, `ipc/repo.ts`

## Verification Results

- `npx tsc --noEmit` — clean (both after Task 1 and after Task 2)
- `grep -n "useDriftStore" store/drift.ts` — exports the hook
- `grep -n "subscribeDriftChanged|acknowledgeDrift" ipc/drift.ts` — both exports present
- `grep -n "currentCodeHash" ipc/drift.ts` — camelCase payload type matches Rust
- `grep -n "subscribeDriftChanged" AppShell.tsx` — subscription mounted
- `grep -n "useDriftStore" GraphCanvasInner.tsx` — store consumed
- `grep -n "driftedUuids.has" GraphCanvasInner.tsx` — state promotion present
- `grep -n "'drifted'" GraphCanvasInner.tsx` — drifted state literal used
- `grep -n "useDriftStore.getState().reset" repo.ts` — exactly 2 lines
- `grep -rn "DriftChangedPayload|drift:changed" src/` — handled at ONE location (ipc/drift.ts)
- No console.log debug statements added by this plan

## Self-Check: PASSED

Files confirmed to exist:
- contract-ide/src/store/drift.ts
- contract-ide/src/ipc/drift.ts
- contract-ide/src/components/layout/AppShell.tsx (modified)
- contract-ide/src/components/graph/GraphCanvasInner.tsx (modified)
- contract-ide/src/ipc/repo.ts (modified)

Commits confirmed:
- b950cf0 (Task 1: drift store + IPC wrapper)
- 7a3965f (Task 2: AppShell + GraphCanvasInner + repo reset)
