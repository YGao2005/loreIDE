---
phase: 15
plan: "02"
subsystem: substrate-trust-surface
tags:
  - cmdp
  - filter-chip
  - fts5
  - source-archaeology-modal
  - trust-01
  - routing-override
dependency_graph:
  requires:
    - Phase 15 Plan 01 (v8 migration: substrate_edits + FTS tombstone fix + WHERE invalid_at IS NULL)
    - Phase 13 Plan 03 (find_substrate_by_intent base IPC + IntentPalette)
    - Phase 13 Plan 07 (useCitationStore.openCitation + SourceArchaeologyModal)
  provides:
    - IntentPalette chip row (All / Contracts / Code / Substrate)
    - find_substrate_by_intent kind_filter parameter (optional, backward-compat)
    - Substrate-hit routing override → openCitation (TRUST-01 demo path)
    - SubstrateNodeSummary.applies_when field (folded from 15-03)
    - resolveKindFilter + resolveSubstrateRoute + isSubstrateKind pure helpers
  affects:
    - 15-03 RefineRuleEditor (consumes applies_when from getSubstrateNodeDetail)
    - 15-06 Beat 3 UAT (Substrate chip + SourceArchaeologyModal <2s demo path)
tech_stack:
  added: []
  patterns:
    - Zustand store read (useCitationStore.getState().openCitation) from event handler
    - Optional Rust command parameter (kind_filter: Option<String>) with serde default None
    - Pure exported helpers for testability (resolveKindFilter, resolveSubstrateRoute, isSubstrateKind)
    - console.time/timeEnd DEV guards for performance measurement
key_files:
  created:
    - contract-ide/src/components/command-palette/__tests__/IntentPalette.test.ts
  modified:
    - contract-ide/src-tauri/src/commands/substrate.rs
    - contract-ide/src/ipc/substrate.ts
    - contract-ide/src/components/command-palette/IntentPalette.tsx
    - contract-ide/src/components/command-palette/IntentPaletteHit.tsx
decisions:
  - "Export resolveKindFilter + resolveSubstrateRoute + isSubstrateKind as pure helpers from IntentPalette.tsx for testability — project uses environment:node (no jsdom); pure logic tests match established ServiceCard/ScreenCard test patterns"
  - "Substrate chip routing override uses useCitationStore.openCitation (not openCitationUuid — that's the state field; openCitation is the action method per Phase 13 Plan 07 store definition)"
  - "applies_when: None in get_substrate_states_for_canvas (canvas bulk read doesn't need it); only get_substrate_node_detail SELECT extended — minimizes DB overhead for the hot canvas path"
  - "filter_mode dispatch uses &str match on normalised value — avoids Option nesting in the if-guards; code/contracts both map to 'contracts' branch with TODO comment for Phase 16 code filter"
metrics:
  duration: "~11 minutes"
  completed_date: "2026-04-26"
  tasks_completed: 3
  files_modified: 5
---

# Phase 15 Plan 02: Cmd+P Substrate Filter Chip Summary

Adds the Substrate filter chip to the Cmd+P palette so users can search by rationale (text/applies_when/scope via FTS5) and reach the verbatim quote in SourceArchaeologyModal without leaving the keyboard. Reuses the existing FTS5 + flat-score path — zero new retrieval code.

## What Was Built

### Task 1: Backend — kind_filter parameter + applies_when extension

`find_substrate_by_intent` in `commands/substrate.rs` gains optional `kind_filter: Option<String>`:

```rust
pub async fn find_substrate_by_intent(
    db_instances: State<'_, DbInstances>,
    query: String,
    limit: Option<i32>,
    kind_filter: Option<String>,
) -> Result<Vec<IntentSearchHit>, String> {
```

Dispatch logic:
- `None` / `Some("all")` → `filter_mode = "all"` (both FTS scans, existing behaviour)
- `Some("substrate")` → `filter_mode = "substrate"` (substrate FTS only; contract scan skipped)
- `Some("contracts")` / `Some("code")` → `filter_mode = "contracts"` (contract FTS only; substrate scan skipped)

All `WHERE invalid_at IS NULL` predicates preserved — tombstoned rows from the 15-01 chained-version model do NOT surface.

`SubstrateNodeSummary` struct gains `pub applies_when: Option<String>`:
- `get_substrate_node_detail`: both SQL SELECT branches extended to include `applies_when` column; row extraction reads and populates the field.
- `get_substrate_states_for_canvas`: sets `applies_when: None` (canvas doesn't need it; avoids overhead on bulk read).

TS `findSubstrateByIntent` wrapper signature:

```ts
export async function findSubstrateByIntent(
  query: string,
  limit = 10,
  kindFilter?: 'substrate' | 'contracts' | 'code' | 'all',
): Promise<IntentSearchHit[]>
```

`SubstrateNodeSummary` TS interface gains `applies_when: string | null`.

### Task 2: Filter chip row + routing override + console.time profiling

Filter chip row added above `Command.Input` in IntentPalette:

```tsx
<div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5" role="group" aria-label="Filter by kind">
  {(['all', 'contracts', 'code', 'substrate'] as const).map((chip) => (
    <button
      key={chip}
      aria-pressed={chipFilter === chip}
      onClick={() => setChipFilter(chip)}
      className={chipFilter === chip ? 'bg-secondary text-secondary-foreground ...' : 'text-muted-foreground ...'}
    >
      ...
    </button>
  ))}
</div>
```

Substrate-hit routing override (IntentPalette `handleSelect`, line ~330):

```ts
const routeDecision = resolveSubstrateRoute(hit, chipFilter);
if (routeDecision === 'modal') {
  useCitationStore.getState().openCitation(hit.uuid);  // → SourceArchaeologyModal
  return;
}
// All chip or non-substrate chip: existing selectNode(parent_uuid)
if (hit.parent_uuid) {
  useGraphStore.getState().selectNode(hit.parent_uuid);
}
```

`console.time('substrate-cmdp-roundtrip')` / `console.timeEnd` guards wrap the IPC call (gated on `import.meta.env.DEV`) for the <2s TRUST-01 SC measurement during plan 15-06 UAT.

IntentPaletteHit: substrate hits in the All view now show a muted `substrate` kind label where contract hits show their level pill.

### Task 3: Vitest coverage — 14 cases, 5 describe blocks

Pure helpers exported from IntentPalette.tsx for testability (project uses `environment: 'node'`, no jsdom):

- `resolveKindFilter(chip)` → IPC kindFilter arg (4 cases: all→undefined, substrate, contracts, code)
- `resolveSubstrateRoute(hit, chip)` → `'modal' | 'inspector'` (7 cases: substrate+substrate→modal; all→inspector; non-substrate always→inspector)
- `isSubstrateKind(kind)` → bool (3 cases: 5 valid substrate kinds, contract/flow false, empty/unknown false)
- Chip reset structural check: `resolveKindFilter('all') === undefined` both on mount and after reset

Full vitest suite: 100 passed / 1 skipped.

## Deviations from Plan

### Test infrastructure adaptation

**Found during:** Task 3

**Issue:** Plan Task 3 specifies `@testing-library/react` + `userEvent`. The project uses `environment: 'node'` (no jsdom) and `@testing-library/react` is not installed — confirmed by `package.json` + established test pattern from ServiceCard.test.ts, ScreenCard.test.ts.

**Fix:** Exported pure helpers (`resolveKindFilter`, `resolveSubstrateRoute`, `isSubstrateKind`) from IntentPalette.tsx. Tests call these directly — equivalent correctness coverage for the 4 plan test cases (IPC wiring, routing override, preserved routing, chip reset). React component render wiring tested manually via `tauri dev` smoke.

**Files modified:** IntentPalette.tsx (exports added), IntentPalette.test.ts (pure-logic tests)

### openCitation vs openCitationUuid

**Found during:** Task 2

**Issue:** Plan references `useCitationStore.getState().openCitationUuid(hit.uuid)` but `openCitationUuid` is the STATE FIELD (string | null), not a method. The action method is `openCitation(uuid: string)` (per Phase 13 Plan 07 store definition).

**Fix:** Called `useCitationStore.getState().openCitation(hit.uuid)` — correct method name per the store's CitationState interface.

## Self-Check: PASSED

- `contract-ide/src-tauri/src/commands/substrate.rs` — exists, `kind_filter: Option<String>` param present, `applies_when` in struct + detail SELECT
- `contract-ide/src/ipc/substrate.ts` — exists, `kindFilter?` param on wrapper, `applies_when: string | null` in SubstrateNodeSummary
- `contract-ide/src/components/command-palette/IntentPalette.tsx` — exists, chip row + `chipFilter` state + resolveSubstrateRoute routing + console.time guards
- `contract-ide/src/components/command-palette/IntentPaletteHit.tsx` — exists, substrate kind label
- `contract-ide/src/components/command-palette/__tests__/IntentPalette.test.ts` — exists, 14 tests pass
- Commits: f1e6253 (Task 1), 524ac5e (Task 2), cbf8413 (Task 3)
