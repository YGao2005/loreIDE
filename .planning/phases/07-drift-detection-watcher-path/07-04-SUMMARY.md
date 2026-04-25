---
phase: 07-drift-detection-watcher-path
plan: "04"
subsystem: drift-reconcile-ui
tags: [react, typescript, tauri, shadcn, dialog, drift, reconcile, zustand, uat]

# Dependency graph
requires:
  - phase: 07-02
    provides: acknowledge_drift Tauri command + drift:changed event emitter
  - phase: 07-03
    provides: useDriftStore + subscribeDriftChanged + GraphCanvasInner driftedUuids wiring
  - phase: 04-02
    provides: DriftBadge in Inspector header with onReconcile prop stub
provides:
  - src/components/ui/dialog.tsx: shadcn Dialog primitive (Radix-based)
  - src/components/inspector/ReconcilePanel.tsx: three-action reconcile dialog (DRIFT-02)
  - src/components/layout/Inspector.tsx: reconcileOpen state + ReconcilePanel render
  - src/components/inspector/DriftBadge.tsx: showHint placeholder removed, onReconcile wired
affects:
  - 08 (PostToolUse hook should call drift::engine::compute_and_emit — same per-UUID mutex; no changes needed to Phase 7 surface)

# Tech tracking
tech-stack:
  added:
    - "@radix-ui/react-dialog (via shadcn Dialog add)"
  patterns:
    - "Parent-lifted dialog state — Inspector holds reconcileOpen, passes onReconcile to DriftBadge child; dialog overlay rendered at Inspector root so it covers all four tabs"
    - "useEffect closes dialog on selectedNode?.uuid change — prevents stale-node data showing behind dialog when user clicks a different node"
    - "Clipboard-first reconcile pattern — Update/Rewrite paths copy a MCP-referencing prompt to clipboard; no direct MCP call from UI (Phase 6 MCP-driven pivot convention upheld)"
    - "Per-range scoping for drift hash — hash computed over node's code_ranges slice only; edits outside range do NOT produce drift; see load-bearing decision below"

key-files:
  created:
    - contract-ide/src/components/ui/dialog.tsx
    - contract-ide/src/components/inspector/ReconcilePanel.tsx
  modified:
    - contract-ide/src/components/layout/Inspector.tsx
    - contract-ide/src/components/inspector/DriftBadge.tsx

key-decisions:
  - "LOAD-BEARING — Per-range scoping is correct, not a watcher bug: SC1 UAT confirmed that edits OUTSIDE a node's code_ranges do NOT produce drift (hash-of-slice behavior is intentional). An edit to write_derived_contract.ts at EOF produced no drift for node 11111 (range 31-98); only an in-range edit at line 50 triggered the drift_state row. Any future 'drift didn't fire' report must FIRST check whether the edit is inside the watched range before diagnosing a watcher issue."
  - "Phase-4 DriftBadge showHint placeholder ('Reconcile flow ships in Phase 7') fully removed — replaced by live onReconcile call. No state or animation artifact remains."
  - "Rewrite prompt includes post-rewrite write_derived_contract call (per RESEARCH Open Question 1 single-combined-prompt option) — prevents immediate re-drift on post-rewrite watcher tick (Pitfall 6 mitigation)."
  - "ReconcilePanel prompts reference MCP tools by EXACT NAME (get_contract, write_derived_contract) — any future rename shows up as a visible string-mismatch, not silent breakage (Phase 06-02 convention upheld)."
  - "Phase 2 refresh_nodes delete-event TODO remains open (punted from 07-02) — distinguishing sidecar-delete vs source-delete requires more surface area; tracked in STATE.md Pending Todos."

patterns-established:
  - "Inspector-rooted dialog pattern: lifted state in Inspector, not in DriftBadge child — keeps badge stateless"
  - "Clipboard reconcile: UI copies prompt for active Claude Code session, never calls MCP directly from Tauri frontend"
  - "Auto-close on node switch: useEffect(() => setReconcileOpen(false), [selectedNode?.uuid]) — prevents stale dialog"

requirements-completed:
  - DRIFT-02
  - DRIFT-01

# Metrics
duration: ~15min (Tasks 1+2 implementation) + UAT (live test by user)
completed: 2026-04-24
---

# Phase 7 Plan 04: Reconcile UI + Phase 7 UAT — Summary

**shadcn Dialog + ReconcilePanel three-path reconcile (Update contract / Rewrite code / Acknowledge) wired into Inspector via lifted state; Phase 7 closed with full UAT sign-off: 2-second per-range drift pulse, 10/10 concurrent stress flags, three-path reconcile confirmed.**

## Performance

- **Duration:** ~15 min implementation + user-run UAT
- **Started:** 2026-04-24 (Tasks 1 + 2)
- **Completed:** 2026-04-24 (UAT approved)
- **Tasks:** 3 (Task 1: shadcn Dialog + ReconcilePanel, Task 2: Inspector wiring + DriftBadge cleanup, Task 3: UAT PASS)
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- Installed shadcn Dialog primitive (`@radix-ui/react-dialog`) and built `ReconcilePanel.tsx` with all three DRIFT-02 reconcile paths wired to prescribed behaviors
- Lifted `reconcileOpen` state into Inspector; DriftBadge's Phase-4 "ships in Phase 7" placeholder + `showHint` logic fully removed
- Phase 7 UAT closed with all three success criteria verified by live test: per-range drift pulse (SC1), 10/10 concurrent stress test with no lost flags (SC2), three-path reconcile dialog confirmed (SC3)

## Task Commits

1. **Task 1: Install shadcn Dialog primitive + build ReconcilePanel** — `3f176da` (feat)
   - Files: `src/components/ui/dialog.tsx`, `src/components/inspector/ReconcilePanel.tsx`, `package.json`, `package-lock.json`

2. **Task 2: Wire ReconcilePanel into Inspector + clean up DriftBadge** — `01976f9` (feat)
   - Files: `src/components/layout/Inspector.tsx`, `src/components/inspector/DriftBadge.tsx`

3. **Task 3: Phase 7 end-to-end UAT** — UAT PASS (no code commit; human verification gate closed by user approval)

## Files Created/Modified

- `contract-ide/src/components/ui/dialog.tsx` — shadcn Dialog primitive (DialogContent, DialogHeader, DialogTitle et al.) installed via `npx shadcn@latest add dialog`
- `contract-ide/src/components/inspector/ReconcilePanel.tsx` — three-action dialog: Update contract (copies MCP derivation prompt referencing `get_contract` + `write_derived_contract`), Rewrite code (copies rewrite prompt with embedded post-rewrite `write_derived_contract` for baseline refresh), Acknowledge (invokes `acknowledgeDrift(uuid)` Tauri command)
- `contract-ide/src/components/layout/Inspector.tsx` — added `reconcileOpen` useState + `<ReconcilePanel>` render + `useEffect(() => setReconcileOpen(false), [selectedNode?.uuid])` auto-close on node switch
- `contract-ide/src/components/inspector/DriftBadge.tsx` — removed `showHint` state + timer effect + "Reconcile flow ships in Phase 7" conditional span; simplified Reconcile button onClick to `() => onReconcile?.()`

## Decisions Made

**LOAD-BEARING: Per-range scoping is correct behavior, not a watcher bug.**
SC1 UAT demonstrated that edits outside a node's `code_ranges` slice do NOT produce drift — the hash is computed over the exact byte range, not the full file. During testing, appending at EOF of `write_derived_contract.ts` produced no drift for node 11111 (range 31-98). An in-range edit at line 50 then correctly produced a `drift_state` row within ~3 seconds. `DriftBadge.tsx` (range 1-89, shorter file) drifted on any append, confirming range boundary behavior. Any future "drift didn't fire" report must first check whether the edit is inside the watched range before diagnosing the watcher.

Other decisions:
- Phase-4 `showHint` placeholder fully removed; no state or animation artifact remains
- Rewrite prompt includes post-rewrite `write_derived_contract` call per RESEARCH Open Question 1 (Pitfall 6 mitigation — prevents immediate re-drift on post-rewrite watcher tick)
- MCP tool names referenced by exact string in prompts per Phase 06-02 convention

## UAT Evidence

### SC 1 — 2-second drift pulse / per-range scoping (DRIFT-01): PASS

- Seeded 10 stress sidecars + 10 stub source files (`stress-test/fileN.ts`) and re-opened the repo.
- Confirmed per-range scoping: appending at EOF of `write_derived_contract.ts` (outside node 11111's range 31-98) produced NO drift (same hash of lines 31-98). An in-range edit (`awk` line 50 `" //"`) then produced a `drift_state` row for node 11111 within ~3 seconds.
- `DriftBadge.tsx` (range 1-89, file shorter than 89 lines) drifted on any append — confirmed via `drift_state` row for node 22222 at 06:25:06.
- Stress `file1.ts` (baseline hash seeded as 64 zeros) drifted on any edit — confirmed at 06:24:30.

### SC 2 — Per-node Mutex / no lost flags (DRIFT-01): PASS 10/10

- Parallel write of 10 stress files via `for i in 1..10; do ( echo '// stress-TS' >> stress-test/fileN.ts ) & done; wait`.
- After 3s sleep: `SELECT COUNT(*) FROM drift_state WHERE reconciled_at IS NULL AND node_uuid LIKE '99999999%'` returned **10**.
- Timestamps spanned 06:27:47.372206 → 06:27:47.376318 (4ms spread) — confirms per-UUID `tokio::sync::Mutex` serialized concurrent events cleanly with no lost flags.

### SC 3 — Three-path reconcile panel (DRIFT-02): PASS (user-confirmed "Works")

- Clicked drifted node → Inspector → Drift badge → Reconcile → dialog opened with 3 buttons.
- "Update contract to match code": clipboard verified with `pbpaste`.
- "Rewrite code to match contract": clipboard verified with `pbpaste`.
- "Acknowledge": dialog closed, red pulse cleared within ~1 second.

### Regression checks (run by orchestrator): ALL PASS

- `cargo test`: 11/11 passed
- `cargo clippy -- -D warnings`: clean
- `npx tsc --noEmit`: clean

### Test debris cleaned

- `bash /tmp/sc2-cleanup.sh` — removed 10 stress sidecars + `stress-test/` dir
- `git checkout -- mcp-sidecar/src/tools/write_derived_contract.ts` — reverted SC1 in-range edit
- `git checkout -- src/components/inspector/DriftBadge.tsx` — reverted SC1 append to DriftBadge

## Deviations from Plan

None — plan executed exactly as written.

The shadcn CLI installed Dialog without needing the React 19 override fallback. `@radix-ui/react-dialog` integrated cleanly with the existing `overrides` block. ReconcilePanel prompt text matches plan specification verbatim.

## Issues Encountered

**SC1 initially appeared to not fire:** First test edit was appended at EOF of `write_derived_contract.ts`, outside node 11111's range 31-98. Investigation confirmed this is correct behavior (per-range hash), not a watcher bug. Documented as the load-bearing decision above.

## Open Items Carried Forward

- Phase 2 `refresh_nodes` delete-event TODO remains open — punted from 07-02, tracked in STATE.md Pending Todos. Distinguishing sidecar-delete vs. source-delete requires more surface area.
- ReconcilePanel copy-success toast deferred to Phase 9 polish (no toast on clipboard write; Phase 7 stays minimal per plan guidance).

## Phase 8 Readiness

Phase 8's PostToolUse hook should call `drift::engine::compute_and_emit(uuid)` directly — the per-UUID `tokio::sync::Mutex` in `DriftLocks` already serializes watcher events and will serialize hook events the same way. Hook and watcher will coexist without racing. No changes to Phase 7 surface required.

## Next Phase Readiness

- Phase 7 complete: all DRIFT-01 and DRIFT-02 requirements met with UAT sign-off
- Phase 8 can begin: `drift::engine::compute_and_emit` is the hook entry point; `acknowledge_drift` Tauri command is already live; drift store resets on repo switch; reconcile panel handles the three user-facing paths
- No blockers for Phase 8

---

## Self-Check

**Commits verified:**
- `3f176da` — feat(07-04): install shadcn Dialog + build ReconcilePanel — FOUND
- `01976f9` — feat(07-04): wire ReconcilePanel into Inspector + clean up DriftBadge — FOUND

**Files verified (from git history):**
- `contract-ide/src/components/ui/dialog.tsx` — created in 3f176da
- `contract-ide/src/components/inspector/ReconcilePanel.tsx` — created in 3f176da
- `contract-ide/src/components/layout/Inspector.tsx` — modified in 01976f9
- `contract-ide/src/components/inspector/DriftBadge.tsx` — modified in 01976f9

## Self-Check: PASSED

---
*Phase: 07-drift-detection-watcher-path*
*Completed: 2026-04-24*
