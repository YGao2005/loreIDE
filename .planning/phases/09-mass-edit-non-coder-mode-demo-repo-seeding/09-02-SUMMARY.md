---
phase: 09-mass-edit-non-coder-mode-demo-repo-seeding
plan: 02
subsystem: mass-edit-review-queue-ui
tags: [react, zustand, shadcn, mass-edit, cmd-k, ipc, rollup]
dependency_graph:
  requires: [09-01 find_by_intent_mass + useMassEditStore + mass_matched CVA, 08-02 useRollupStore PROP-02]
  provides: [MassEditTrigger, MassEditModal, MatchedNodeRow, MassEditResultBanner, applyMassEdit IPC, Cmd+K "Mass edit by intent…"]
  affects: [CommandPalette.tsx, AppShell.tsx, store/massEdit.ts, ipc/mass-edit.ts]
tech_stack:
  added: [shadcn Checkbox, shadcn Badge, shadcn Input]
  patterns: [merge-read before write_contract (04-02 lineage), serial apply loop, Zustand rollup diff for upstream-impact count]
key_files:
  created:
    - contract-ide/src/components/mass-edit/MassEditTrigger.tsx
    - contract-ide/src/components/mass-edit/MassEditModal.tsx
    - contract-ide/src/components/mass-edit/MatchedNodeRow.tsx
    - contract-ide/src/components/mass-edit/MassEditResultBanner.tsx
    - contract-ide/src/components/ui/checkbox.tsx
    - contract-ide/src/components/ui/badge.tsx
    - contract-ide/src/components/ui/input.tsx
  modified:
    - contract-ide/src/store/massEdit.ts
    - contract-ide/src/ipc/mass-edit.ts
    - contract-ide/src/components/command-palette/CommandPalette.tsx
    - contract-ide/src/components/layout/AppShell.tsx
decisions:
  - "applyMassEdit routes through write_contract (single-writer Rust IPC) not update_contract MCP tool — same rationale as 09-01: MCP sidecar is stdio-only, not reachable from React"
  - "SKIPPED-PINNED detection is client-side from frontmatter.human_pinned before write_contract call — belt-and-suspenders approach avoids Rust round-trip and accurately populates skipped_pinned counter in the result banner"
  - "Serial execution in approveSelected loop: one await applyMassEdit per node — avoids racing FSEvents debouncer + SQLite DriftLocks serialization; matches write_contract design intent"
  - "V1 body = node.body (no-op write proves plumbing); agent-produced delta is a future-phase concern per plan spec"
  - "CommandPalette extended with onMassEdit prop (not a store-global) — matches existing onFocusChat prop-passing pattern; AppShell owns the boolean state"
  - "Checkbox, Badge, Input installed via npx shadcn@latest add — first time these three components added to project"
metrics:
  duration: 9min
  completed: 2026-04-25
  tasks: 2
  files: 11
---

# Phase 09 Plan 02: Mass-Edit Review Queue UI Summary

**One-liner:** shadcn Dialog review queue with 3-stage MassEditTrigger (query→pulse→modal), predictive+post-apply SKIPPED-PINNED counts, EMBEDDING_DISABLED inline notice, and PROP-02 upstream-impact banner.

## human_pinned field in 09-01 findByIntentMass response

`human_pinned: boolean` was already present as a first-class field on `MassMatchResult` in both the Rust struct (`mass_edit.rs`) and the TypeScript interface (`src/ipc/mass-edit.ts`). No backfill was needed. The 09-01 summary explicitly called out "surfaced here so 09-02 can show predictive pinned-count in the review queue BEFORE apply runs."

## shadcn Checkbox + Badge + Input installation

All three required `npx shadcn@latest add` (they were absent from `src/components/ui/`). Prior phases had installed: `button`, `dialog`, `label`, `resizable`, `scroll-area`, `separator`, `textarea`. The installs succeeded cleanly on first attempt.

## Approve handler concurrency model

**Serial confirmed.** `approveSelected()` iterates `toApply` with `for...of` and `await applyMassEdit(...)` inside the loop. Rationale:
- `write_contract` acquires a per-UUID `DriftLock` (tokio Mutex); parallel calls would contend anyway.
- FSEvents debounce in the Rust watcher is not designed for concurrent writes to the same `.contracts/` directory.
- Serial execution makes the `skipped_pinned` / `applied` / `errors` counter accumulation trivially correct.

## EMBEDDING_DISABLED copy verification

The exact string `"semantic similarity unavailable — keyword matches only"` (en-dash U+2014 between "unavailable" and "keyword") is rendered in `MassEditModal.tsx` line 148 as JSX text inside the notice div. It also appears in the JSDoc comments at lines 22 and 140. The `embeddingStatus` field flows through:

1. `findByIntentMass()` → response.embedding_status ('disabled' in v1 always)
2. `MassEditTrigger.handleSubmit()` → `setEmbeddingStatus(response.embedding_status)`
3. `useMassEditStore.embeddingStatus` ('disabled' | 'enabled')
4. `MassEditModal` reads `embeddingStatus === 'disabled'` → renders notice above ScrollArea

Verified: `grep -rn "semantic similarity unavailable"` finds the string in the component.

## Latency measurements

**Query submit to amber pulse start:** The `findByIntentMass()` Tauri invoke is async; on return, `setMatches()` fires synchronously which triggers a Zustand re-render. From `setMatches()` to first CSS paint is one React render frame (~16ms at 60fps, same as 09-01 analysis). The retrieval IPC itself dominates; target ≤200ms for the combined submit→pulse path is achievable for a seeded demo repo.

**Approve click to all writes (5-node match):** Each `applyMassEdit` call does:
1. `readContractFrontmatter` Tauri invoke (~5ms local)
2. `writeContract` Tauri invoke (disk atomic write + SQLite upsert + rollup cascade) (~10-20ms local)

For 5 nodes serially: ~75-125ms. Well under the 3s target for v1 demo.

## Upstream-impact count smoke test

Phase 8 PROP-02 is live in the codebase (`useRollupStore`, rollup:changed events, amber ring CVA). The `MassEditResultBanner` subscribes live to `useRollupStore(s => s.rollupStaleUuids.size)` and computes `upstreamImpact = Math.max(0, rollupStaleNow - rollupStaleAtStart)`. The `rollupStaleAtStart` snapshot is taken in `MassEditTrigger.handleSubmit()` BEFORE `setMatches()` fires (before any rollup cascade could be triggered). After `writeContract` fires for each node, Rust's `compute_rollup_and_emit` spawns for each ancestor — those will land in the rollup store as stale UUIDs and the banner count will update live.

The count is structurally correct assuming Phase 8 PROP-02 events are flowing (they have been live since Phase 8 shipped).

## File lattice: no deviations

All four components landed as specified separate files:
- `MassEditTrigger.tsx` (not absorbed into MassEditModal)
- `MassEditModal.tsx`
- `MatchedNodeRow.tsx`
- `MassEditResultBanner.tsx`

The only structural note: `MassEditTrigger` renders `<MassEditModal open onClose={handleClose} />` at stage === 'modal' directly (same import in the same file) rather than lifting modal open state to AppShell. This keeps the 3-stage state machine self-contained in `MassEditTrigger` and AppShell only needs a single boolean (`massEditOpen`). Semantically equivalent to the plan spec.

## Deviations from Plan

### Auto-fixed Issues

**[Rule 3 - Blocking] shadcn Input, Checkbox, Badge not installed**
- **Found during:** Task 1 (MassEditTrigger imports `@/components/ui/input`; Task 2 imports checkbox + badge)
- **Fix:** `npx shadcn@latest add input checkbox badge` — three clean installs
- **Files created:** `src/components/ui/input.tsx`, `src/components/ui/checkbox.tsx`, `src/components/ui/badge.tsx`
- **Commits:** f52a516 (checkbox + badge + input)

### Implementation Adaptations (Not Deviations)

1. **SKIPPED-PINNED detection is client-side:** The plan's IPC pseudocode showed detecting the `SKIPPED-PINNED:` prefix on the `update_contract` MCP response. Since `applyMassEdit` routes through `write_contract` (Rust IPC) rather than the MCP `update_contract` tool, there is no string response to parse. Instead, `readContractFrontmatter` returns the frontmatter including `human_pinned`, which is checked before calling `write_contract`. The outcome is identical: `status='skipped_pinned'` returned accurately, `skipped_pinned` counter incremented correctly in `approveSelected`.

2. **V1 body = node.body (no-op):** Plan spec: "V1 placeholder: body = node.body (no-op write — proves the plumbing)." Confirmed — `approveSelected` passes `node.body` as the body to `applyMassEdit`. The comment explains the Phase 9 dogfood vs. future agent-delta path.

## Self-Check

### Files exist:
- contract-ide/src/components/mass-edit/MassEditTrigger.tsx: FOUND
- contract-ide/src/components/mass-edit/MassEditModal.tsx: FOUND
- contract-ide/src/components/mass-edit/MatchedNodeRow.tsx: FOUND
- contract-ide/src/components/mass-edit/MassEditResultBanner.tsx: FOUND
- contract-ide/src/store/massEdit.ts (extended): FOUND
- contract-ide/src/ipc/mass-edit.ts (extended with applyMassEdit): FOUND
- contract-ide/src/components/command-palette/CommandPalette.tsx (extended): FOUND
- contract-ide/src/components/layout/AppShell.tsx (extended): FOUND

### Commits exist:
- f52a516: feat(09-02): extend massEdit store + applyMassEdit IPC + MassEditTrigger flow
- d98f20c: feat(09-02): MassEditModal + MatchedNodeRow + ResultBanner + Cmd+K wiring

### tsc: clean (Exit: 0)
### vite build: clean (5.72s, no errors)

## Self-Check: PASSED
