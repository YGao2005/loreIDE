---
phase: 07-drift-detection-watcher-path
verified: 2026-04-24T00:00:00Z
status: passed
score: 3/3 must-haves verified
---

# Phase 7: Drift Detection — Watcher Path Verification Report

**Phase Goal:** Manual code changes cause affected nodes to pulse red in the graph within seconds via the `notify` watcher; reconcile panel handles the three resolution paths. PostToolUse hook is explicitly deferred to Phase 8.
**Verified:** 2026-04-24
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Requirements Coverage

| Requirement | Description | Status | Evidence |
|---|---|---|---|
| DRIFT-01 | Node pulses red when code changes without matching contract update | SATISFIED | `drift/watcher.rs` + `drift/engine.rs` + `GraphCanvasInner.tsx` driftedUuids wiring |
| DRIFT-02 | Drifted node offers three reconcile paths | SATISFIED | `ReconcilePanel.tsx` with three action buttons; `Inspector.tsx` reconcileOpen state |

REQUIREMENTS.md traceability table confirms both DRIFT-01 and DRIFT-02 are mapped to Phase 7 as Complete.

---

## Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Manual file edit causes drifted node to pulse red within ~2s via notify watcher | VERIFIED | `drift/watcher.rs`: `notify::recommended_watcher` on per-file set; `EventKind::Modify/Create/Remove` dispatches `tauri::async_runtime::spawn(compute_and_emit)`; `GraphCanvasInner.tsx` line 74: `driftedUuids.has(row.uuid)` sets state `'drifted'`; `useDriftStore` subscribed in `AppShell.tsx` line 93-100 via `subscribeDriftChanged` |
| 2 | Per-node tokio::sync::Mutex prevents stale code_hash reads under concurrent watcher events | VERIFIED | `drift/state.rs`: `DriftLocks(DashMap<String, Arc<Mutex<()>>>)` using `tokio::sync::Mutex`; `engine.rs` line 48-49: mutex acquired before any DB access; `watcher.rs` line 108-110: each UUID spawned independently so per-UUID serialization coexists with cross-UUID parallelism |
| 3 | Clicking a drifted node opens the inspector with reconcile panel offering all three resolution paths | VERIFIED | `Inspector.tsx` lines 39, 57-59, 123-125, 165-169: `reconcileOpen` state, auto-close on node switch, `DriftBadge` `onReconcile={() => setReconcileOpen(true)}`, `<ReconcilePanel>` render; `ReconcilePanel.tsx` lines 73-103: three buttons ("Update contract to match code", "Rewrite code to match contract", "Acknowledge") with distinct actions |

**Score:** 3/3 truths verified

---

## Artifact Verification

| Artifact | Status | Evidence |
|---|---|---|
| `src-tauri/src/drift/state.rs` | VERIFIED | Exists, substantive (DriftLocks with per-UUID tokio Mutex via DashMap), used in engine.rs and commands/drift.rs |
| `src-tauri/src/drift/engine.rs` | VERIFIED | Exists, substantive (full compute_and_emit with 9 documented steps, 3 unit tests), called from watcher.rs |
| `src-tauri/src/drift/watcher.rs` | VERIFIED | Exists, substantive (SourceWatcher with notify::recommended_watcher, canonical path handling, per-UUID spawn), referenced from commands/drift.rs |
| `src-tauri/src/drift/mod.rs` | VERIFIED | Exists, exports engine/state/watcher |
| `src-tauri/src/commands/drift.rs` | VERIFIED | Exists, substantive: `acknowledge_drift` Tauri command + `refresh_source_watcher_from_db` helper |
| `src/store/drift.ts` | VERIFIED | Exists, substantive (driftedUuids Set, setDrifted, reset), consumed in GraphCanvasInner.tsx |
| `src/ipc/drift.ts` | VERIFIED | Exists, substantive (subscribeDriftChanged, acknowledgeDrift), consumed in AppShell.tsx and ReconcilePanel.tsx |
| `src/components/inspector/ReconcilePanel.tsx` | VERIFIED | Exists, substantive (three action buttons with real behavior), imported and rendered in Inspector.tsx |
| `src/components/ui/dialog.tsx` | VERIFIED | Exists (shadcn Dialog primitive), used in ReconcilePanel.tsx |
| `src/components/layout/Inspector.tsx` | VERIFIED | Exists, substantive: reconcileOpen useState, auto-close useEffect on selectedNodeUuid, ReconcilePanel rendered at inspector root |
| `src/components/inspector/DriftBadge.tsx` | VERIFIED | Exists, substantive: showHint placeholder fully removed (grep confirms no "showHint" or "Reconcile flow ships" strings anywhere in src/); onReconcile wired to live callback |

---

## Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `drift/watcher.rs` | `drift/engine.rs` | `tauri::async_runtime::spawn(compute_and_emit)` | WIRED | Line 108-110 in watcher.rs |
| `drift/engine.rs` | `drift/state.rs` | `DriftLocks::for_uuid` | WIRED | Line 47-49 in engine.rs |
| `commands/drift.rs` | `drift/watcher.rs` | `SourceWatcher::refresh` | WIRED | Line 72-75 in commands/drift.rs |
| `commands/repo.rs` (open_repo) | `commands/drift.rs` | `refresh_source_watcher_from_db` | WIRED | Line 69 in repo.rs |
| `commands/repo.rs` (refresh_nodes) | `commands/drift.rs` | `refresh_source_watcher_from_db` | WIRED | Line 162 in repo.rs |
| `lib.rs` | `drift::state::DriftLocks` | `.manage(DriftLocks::default())` | WIRED | Line 29 in lib.rs |
| `lib.rs` | `drift::watcher::SourceWatcher` | `.manage(SourceWatcher::new())` | WIRED | Line 30 in lib.rs |
| `lib.rs` | `commands::drift::acknowledge_drift` | `invoke_handler` | WIRED | Line 46 in lib.rs |
| `AppShell.tsx` | `ipc/drift.ts` | `subscribeDriftChanged` in useEffect | WIRED | Lines 6, 93-100 in AppShell.tsx |
| `ipc/drift.ts` | `store/drift.ts` | `useDriftStore.getState().setDrifted` | WIRED | Line 23 in ipc/drift.ts |
| `GraphCanvasInner.tsx` | `store/drift.ts` | `useDriftStore((s) => s.driftedUuids)` | WIRED | Line 122 in GraphCanvasInner.tsx |
| `Inspector.tsx` | `ReconcilePanel.tsx` | import + render with reconcileOpen state | WIRED | Lines 12, 165-169 in Inspector.tsx |
| `ReconcilePanel.tsx` | `ipc/drift.ts` | `acknowledgeDrift(node.uuid)` | WIRED | Lines 3, 59 in ReconcilePanel.tsx |
| `Inspector.tsx` | `DriftBadge.tsx` | `onReconcile={() => setReconcileOpen(true)}` | WIRED | Lines 11, 123-125 in Inspector.tsx |

---

## Anti-Patterns Found

No blocking anti-patterns detected.

- No TODO/FIXME/placeholder comments in drift/ module files
- No stub return values (empty array, null, "Not implemented")
- The Phase-4 `showHint` placeholder ("Reconcile flow ships in Phase 7") is fully absent from the codebase — grep confirms zero matches
- All three ReconcilePanel buttons have real implementations (clipboard copy or Tauri invoke), not console.log stubs
- `acknowledge_drift` registered in `invoke_handler` in lib.rs — not a dead export

Open items carried forward (not blockers for Phase 7 goal):
- `refresh_nodes` delete-event TODO in repo.rs (line 88-92) — explicitly documented as punted to Phase 8; does not affect DRIFT-01/DRIFT-02
- ReconcilePanel copy-success toast deferred to Phase 9 polish

---

## Human Verification

Human UAT was already performed and signed off (07-04-SUMMARY.md):

- **SC1 PASS:** 2-second drift pulse verified for 3 nodes; per-range scoping validated
- **SC2 PASS:** 10/10 concurrent stress writes landed in drift_state within 4ms spread
- **SC3 PASS:** Three-button reconcile dialog verified by user ("Works"); clipboard contents verified for Update/Rewrite; Acknowledge cleared pulse

No additional human verification required — all three success criteria were closed by the human gate in the UAT task.

---

## Summary

Phase 7 goal is fully achieved. The watcher path is completely wired from the `notify` FSEvents backend through per-UUID tokio mutexes and `compute_and_emit` into the Tauri `drift:changed` event, which flows through `subscribeDriftChanged` → `useDriftStore` → `GraphCanvasInner` → node `state = 'drifted'` → red pulse animation. The reconcile panel is a real three-action dialog (not a stub), rendered at the Inspector root via lifted `reconcileOpen` state, with `Acknowledge` backed by the `acknowledge_drift` Tauri command that both writes to SQLite and clears the pulse. Both DRIFT-01 and DRIFT-02 requirements are satisfied with no gaps.

---

_Verified: 2026-04-24_
_Verifier: Claude (gsd-verifier)_
