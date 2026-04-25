---
phase: 09-mass-edit-non-coder-mode-demo-repo-seeding
plan: "03"
subsystem: ui
tags: [react, zustand, copy-mode, nonc-01, simplified-inspector, given-when-then, shadcn]

# Dependency graph
requires:
  - phase: 08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation
    provides: section_hashes computed by Rust section_parser.rs at write time (PROP-01); write_contract IPC path with frontmatter merge; rollup amber/gray CVA variants in contractNodeStyles.ts
  - phase: 04-inspector-monaco
    provides: Inspector.tsx four-tab button-strip layout; useEditorStore.setContractText + saveContract + 400ms debounced autosave; ContractTab autosave path
provides:
  - useUiStore with copyModeActive boolean + setCopyMode + toggleCopyMode (src/store/ui.ts)
  - Sidebar Copy Mode pill enabled (was disabled Phase 1 stub); toggles copyModeActive; aria-pressed; filled/outlined visual treatment
  - GraphCanvasInner L4-only filter when copyModeActive (rows.filter level===L4 before layout)
  - buildFlowNodes suppresses rollup_stale/untracked CVA variants when copyModeActive (forces rollupState 'fresh')
  - DISPLAY-ONLY contract-sections.ts helpers: parseExamplesSection + reconstructExamplesSection
  - SimplifiedInspector component (3 tabs: Contract/Preview/Receipts, NO Code tab)
  - GivenWhenThenEditor: three labeled textareas wired to existing saveContract autosave path
  - DelegateToAgentButton: Phase 11 stub with onDelegate?: (body, uuid) => void prop seam
  - Inspector.tsx Copy Mode branching: copyModeActive && L4 → SimplifiedInspector; Pitfall 3 auto-tab-switch
affects: [phase-11-distiller, phase-13-substrate-ui-demo-polish]

# Tech tracking
tech-stack:
  added: [shadcn/ui Textarea, shadcn/ui Label]
  patterns:
    - "DISPLAY-ONLY section parsing: TS helpers in contract-sections.ts + parseSimplifiedSections for UI rendering only; mandatory header comment forbidding section_hashes computation; Rust section_parser.rs is sole authority"
    - "Phase N stub prop seam: DelegateToAgentButton ships disabled with onDelegate?: prop; Phase N+2 wires it without modifying the component"
    - "Copy Mode branching in Inspector: single if-guard before return statement; onDelegate intentionally undefined in Phase 9"

key-files:
  created:
    - contract-ide/src/store/ui.ts
    - contract-ide/src/lib/contract-sections.ts
    - contract-ide/src/components/inspector/SimplifiedInspector.tsx
    - contract-ide/src/components/inspector/GivenWhenThenEditor.tsx
    - contract-ide/src/components/inspector/DelegateToAgentButton.tsx
    - contract-ide/src/components/ui/textarea.tsx
    - contract-ide/src/components/ui/label.tsx
  modified:
    - contract-ide/src/components/layout/Sidebar.tsx
    - contract-ide/src/components/graph/GraphCanvasInner.tsx
    - contract-ide/src/components/layout/Inspector.tsx

key-decisions:
  - "shadcn Textarea + Label installed via 'npx shadcn@latest add textarea label' — first time these components added to the project (cumulative across 09-02 + 09-03: Label + Textarea added in 09-03)"
  - "Inspector.tsx is in layout/ (not components/inspector/) — existing file structure is Inspector at src/components/layout/Inspector.tsx, not src/components/inspector/Inspector.tsx; plan referenced the wrong path but intent was correct"
  - "buildFlowNodes is a module-level function inside GraphCanvasInner.tsx (not a separate buildFlowNodes.ts) — added copyModeActive param to the existing function; no new file created"
  - "GivenWhenThenEditor intentionally omits contractBody from the useEffect([given, when, then]) dependency array to prevent setContractText → contractBody change → effect re-run → setContractText loop; eslint-disable-next-line comment added"
  - "Four-tab Inspector uses button-based tab strip (NOT shadcn Tabs) — confirmed in Inspector.tsx lines 46-47: TABS array + button map; SimplifiedInspector follows same pattern"
  - "GivenWhenThenEditor handles missing ## Examples section: parseExamplesSection returns {given:'',when:'',then:''}; reconstructExamplesSection appends new ## Examples block before ## Notes if present, else at end"
  - "Pitfall 3 (auto-tab-switch) wired in Inspector.tsx useEffect([copyModeActive, activeTab]): if copyModeActive && activeTab==='Code', setActiveTab('Contract')"
  - "Phase 8 PROP-01 section_hashes preserved: GivenWhenThenEditor calls setContractText → existing ContractTab 400ms debounced autosave → saveContract IPC → write_contract Rust command → section-parser-cli recomputes section_hashes; no new write paths"

patterns-established:
  - "DISPLAY-ONLY TS section parsers: always carry mandatory header comment block stating 'DISPLAY-ONLY — does NOT compute section_hashes; canonical hashing is owned by section_parser.rs'"
  - "Phase stub props: ship the prop signature with the stub (disabled/undefined); wiring phase passes the real handler without touching the stub component"

requirements-completed: [NONC-01]

# Metrics
duration: 5min
completed: 2026-04-25
---

# Phase 9 Plan 03: Copy Mode (NONC-01) Summary

**Copy Mode pill enabled in Sidebar with L4-only graph filter, rollup-overlay suppression, and SimplifiedInspector Given/When/Then editor wired to existing saveContract autosave path**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-25T08:20:19Z
- **Completed:** 2026-04-25T08:25:42Z
- **Tasks:** 2
- **Files modified:** 11 (7 created, 4 modified)

## Accomplishments

- useUiStore ships with `copyModeActive`, `setCopyMode`, and `toggleCopyMode`; Sidebar pill is live (was disabled Phase 1 stub) with filled/outlined toggle and `aria-pressed`
- GraphCanvasInner filters to L4 atoms before layout when Copy Mode active; buildFlowNodes suppresses amber/gray rollup overlays by forcing `rollupState: 'fresh'`
- SimplifiedInspector renders 3-tab strip (Contract/Preview/Receipts, no Code tab) with read-only Intent/Role sections, Given/When/Then editable Examples, entry copy banner verbatim, and disabled DelegateToAgentButton Phase 11 stub
- Phase 8 PROP-01 section_hashes computation preserved: GivenWhenThenEditor writes through existing ContractTab saveContract path unchanged

## Task Commits

1. **Task 1: uiStore + Sidebar pill + graph L4 filter + buildFlowNodes suppression + contract-sections.ts** - `a5683a4` (feat)
2. **Task 2: SimplifiedInspector + GivenWhenThenEditor + DelegateToAgentButton + Inspector branching** - `5497f5a` (feat)

**Plan metadata:** (docs commit to follow)

## Files Created/Modified

- `contract-ide/src/store/ui.ts` — Zustand uiStore: copyModeActive + setCopyMode + toggleCopyMode
- `contract-ide/src/lib/contract-sections.ts` — DISPLAY-ONLY parseExamplesSection + reconstructExamplesSection; mandatory no-hash-computation header comment
- `contract-ide/src/components/inspector/SimplifiedInspector.tsx` — 3-tab Copy Mode inspector; entry copy banner; read-only Intent/Role; GivenWhenThenEditor; DelegateToAgentButton footer; DISPLAY-ONLY parseSimplifiedSections
- `contract-ide/src/components/inspector/GivenWhenThenEditor.tsx` — GIVEN/WHEN/THEN textareas; parses ## Examples; reconstructs body on change; wired to useEditorStore.setContractText → existing autosave
- `contract-ide/src/components/inspector/DelegateToAgentButton.tsx` — Phase 11 stub; onDelegate?: (body, uuid) => void; disabled with tooltip 'Available in Phase 11' when prop undefined
- `contract-ide/src/components/ui/textarea.tsx` — shadcn Textarea (installed via npx shadcn@latest add)
- `contract-ide/src/components/ui/label.tsx` — shadcn Label (installed via npx shadcn@latest add)
- `contract-ide/src/components/layout/Sidebar.tsx` — Copy Mode pill enabled; useUiStore; aria-pressed; filled/outlined visual; data-copy-mode-pill preserved
- `contract-ide/src/components/graph/GraphCanvasInner.tsx` — useUiStore import; copyModeActive subscription; rows.filter(level===L4) in useMemo; buildFlowNodes signature extended with copyModeActive param; rollup overlay suppression
- `contract-ide/src/components/layout/Inspector.tsx` — useUiStore + SimplifiedInspector imports; copyModeActive subscription; Pitfall 3 auto-tab-switch effect; Copy Mode branch (copyModeActive && level===L4 → SimplifiedInspector)

## Decisions Made

- **shadcn Textarea + Label installed** — first install of these components; cumulative with 09-02 context: Label + Textarea added in 09-03
- **buildFlowNodes stays in GraphCanvasInner.tsx** — plan referenced a separate `buildFlowNodes.ts` file that doesn't exist; the function is a module-level function inside GraphCanvasInner.tsx; added the `copyModeActive` parameter to the existing function rather than creating a new file
- **Inspector.tsx is at layout/ not inspector/** — the plan referenced `src/components/inspector/Inspector.tsx` but the file lives at `src/components/layout/Inspector.tsx`; edited the correct file
- **Four-tab Inspector uses button-strip pattern confirmed** — `TABS.map((tab) => <button>...)` at lines 46-47; NOT shadcn Tabs; SimplifiedInspector follows same button pattern per project convention (STATE.md decision from Phase 04-01)
- **GivenWhenThenEditor dep array excludes contractBody** — prevents setContractText → contractBody prop change → effect re-run → setContractText infinite loop; `eslint-disable-next-line` comment documents the intentional omission

## Deviations from Plan

None — plan executed as written with minor structural adaptations to match actual codebase layout (Inspector.tsx in layout/ not inspector/; buildFlowNodes inline in GraphCanvasInner.tsx not a separate file). These are codebase reality adaptations, not deviations from intent.

## Issues Encountered

None.

## Output per Plan Spec

- **shadcn Textarea + Label installed?** Yes — `npx shadcn@latest add textarea label` installed both components
- **useUiStore final shape** — exactly the minimal spec: `copyModeActive: boolean`, `setCopyMode: (active: boolean) => void`, `toggleCopyMode: () => void`; no deviations
- **Inspector four-tab implementation type** — button-strip pattern (TABS array map), NOT shadcn Tabs; consistent with Phase 04-01 project convention
- **GivenWhenThenEditor with no ## Examples section** — `parseExamplesSection` returns `{given:'', when:'', then:''}` (empty fields); `reconstructExamplesSection` appends new `## Examples` block before `## Notes` if present, otherwise at EOF
- **Pitfall 3 auto-tab-switch** — wired in Inspector.tsx via `useEffect([copyModeActive, activeTab])`: `if (copyModeActive && activeTab === 'Code') setActiveTab('Contract')`
- **Phase 8 PROP-01 section_hashes on Copy Mode saves** — GivenWhenThenEditor → setContractText → existing 400ms debounced autosave → saveContract IPC → write_contract Rust command → section-parser-cli recomputes section_hashes; no new write paths; canonical Rust parser unchanged

## Next Phase Readiness

- Phase 11 Distiller: `SimplifiedInspector` accepts `onDelegate?: (contractBody: string, nodeUuid: string) => void`; Phase 11 threads the real handler without modifying Phase 9 code
- Phase 13 UI polish: Copy Mode pill and SimplifiedInspector are styled with project Tailwind conventions; no hardcoded colors that would conflict with polish pass

---
*Phase: 09-mass-edit-non-coder-mode-demo-repo-seeding*
*Completed: 2026-04-25*
