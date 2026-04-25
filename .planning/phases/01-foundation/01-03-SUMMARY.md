---
phase: 01-foundation
plan: 03
subsystem: ui
tags: [react, tauri, react-resizable-panels, zustand, zundo, shadcn, tailwind, vibrancy, keyboard-shortcuts]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: Tauri shell + macOS vibrancy + SQLite schema + get_nodes IPC skeleton (Plans 01-01, 01-02)
provides:
  - Three-pane AppShell (Sidebar | Graph+Chat | Inspector) with react-resizable-panels v4
  - Copy Mode pill placeholder + Journey/System/Ownership lens switcher (visual scaffold for Phase 9)
  - AsyncState<loading|empty|error|ready> reusable primitive with data-async DOM hook
  - Zustand editor store with zundo temporal middleware (limit=2, partialize on contractText only)
  - Global Cmd+S (saveContract) and Cmd+Z (temporal.undo) bindings wired at AppShell root
  - Blur-triggered autosave against stub saveContract (flips isDirty without touching Rust — Phase 2 wires write_contract)
  - CSS vibrancy scoping: whole-window transparent + bg-background solid override on non-sidebar panels
  - ?force-error URL-param override in GraphPlaceholder for manually exercising the error branch
affects: [02-contract-data-layer, 03-graph-canvas, 04-inspector-monaco, 09-demo-polish]

# Tech tracking
tech-stack:
  added: [react-resizable-panels@^4 (percentage-string API), zundo (temporal middleware for Zustand)]
  patterns:
    - "AsyncState primitive: every phase that calls getNodes/derive/agent wraps the call in <AsyncState state=... /> — no freeze, no silent failure"
    - "Vibrancy scoping via bg-background override: sidebar inherits whole-window transparency; center+right panels opt out with solid hsl(var(--background))"
    - "Global keyboard shortcuts live in useKeyboardShortcuts() hook called from AppShell root; textarea onChange is captured by store, Cmd+Z drives temporal.undo outside focused inputs"
    - "zundo partialize({ contractText }) keeps isDirty out of the undo stack so Cmd+Z doesn't yo-yo save status"

key-files:
  created:
    - contract-ide/src/components/layout/AppShell.tsx
    - contract-ide/src/components/layout/Sidebar.tsx
    - contract-ide/src/components/layout/GraphPlaceholder.tsx
    - contract-ide/src/components/layout/Inspector.tsx
    - contract-ide/src/components/layout/ChatPanel.tsx
    - contract-ide/src/components/states/AsyncState.tsx
    - contract-ide/src/store/editor.ts
    - contract-ide/src/store/graph.ts
    - contract-ide/src/hooks/useKeyboardShortcuts.ts
  modified:
    - contract-ide/src/App.tsx
    - contract-ide/src/index.css

key-decisions:
  - "react-resizable-panels v4 requires percentage STRINGS (\"18%\") not bare numbers — bare numbers render as pixels. Caught during human-verify, fixed in 381442e. Flag for dep-upgrade checklist."
  - "Blur-triggered autosave is per-spec for Phase 1; debounced-while-typing autosave is deferred to Phase 4 when Monaco replaces the textarea and has its own change-event cadence."
  - "zundo partialize scoped to contractText only — isDirty stays out of undo stack so Cmd+Z doesn't flicker save status."
  - "?force-error URL-param override in GraphPlaceholder is demo infrastructure, not production logic; Phase 2 removes it once real IPC data paths exist."
  - "Empty-state copy 'No contracts yet — open a repo' assumes Phase 2 ships the folder picker; if Phase 2 descopes opener, copy must change to avoid a dead-reference UX."

patterns-established:
  - "AsyncState primitive with data-async DOM attribute — inspection hook for DOM tests + human verifiers"
  - "Global keyboard shortcuts installed once at AppShell root via useKeyboardShortcuts hook"
  - "Solid-background opt-out: any panel that shouldn't show window vibrancy gets className=\"bg-background\""
  - "Temporal Zustand stores use partialize() to scope the undo stack to user-editable fields only"

requirements-completed: [SHELL-01, SHELL-04, SHELL-05]

# Metrics
duration: ~90min (including human-verify iteration + layout bugfix)
completed: 2026-04-24
---

# Phase 01 Plan 03: Three-pane AppShell + AsyncState + Autosave/Undo Summary

**Three-pane Tauri IDE shell with vibrancy-scoped sidebar, AsyncState primitive driving the graph placeholder from get_nodes(), and a zundo-backed editor store delivering Cmd+S autosave and two-level Cmd+Z undo — validated against a contract-textarea stub and human-verified.**

## Performance

- **Duration:** ~90 min (including 5-iteration bug-fix cycle during human-verify and the v4-API layout fix)
- **Started:** 2026-04-24
- **Completed:** 2026-04-24
- **Tasks:** 3 (2 auto + 1 human-verify checkpoint)
- **Files created:** 9
- **Files modified:** 2
- **Commits:** 3 (dae32e5, 37bbd85, 381442e)

## Accomplishments

- Three-pane AppShell renders with working resize handles on all three dividers (only after the v4 percentage-string fix landed)
- Sidebar displays Copy Mode pill placeholder (disabled, data-copy-mode-pill attribute wired for Phase 9) + Journey/System/Ownership lens switcher + L0/L1 placeholder stubs
- Vibrancy scoped visually to the sidebar — center graph and right inspector have solid backgrounds; user confirmed on drag-behind verification
- AsyncState component renders loading → empty path end-to-end via get_nodes() returning [] from Plan 01-02's stub
- Editor store with zundo limit=2, partialize(contractText): Cmd+S flips isDirty, Cmd+Z twice reverts A→AB→ABC back to A, third Cmd+Z is a no-op (user-observable two-level boundary confirmed)
- Global keyboard shortcuts hook installed at AppShell root
- TypeScript strict compile clean (`npx tsc --noEmit` passed)

## Task Commits

Each task was committed atomically:

1. **Task 2: AsyncState + editor store + keyboard shortcuts hook** — `dae32e5` (feat)
2. **Task 1: Three-pane AppShell layout + sidebar vibrancy + Copy Mode pill + lens switcher** — `37bbd85` (feat)
3. **Post-verify layout fix: percentage strings for resizable panel sizes** — `381442e` (fix)

_Note: Tasks 1 and 2 were committed in dependency order (store first, shell second) even though Task 1 appears first in the plan — this is the order imports resolved during parallel execution._

**Plan metadata:** (this commit — docs closing the plan)

## Files Created/Modified

### Created

- `contract-ide/src/components/layout/AppShell.tsx` — Outer ResizablePanelGroup with sidebar | (graph over chat) | inspector three-pane layout; hosts useKeyboardShortcuts()
- `contract-ide/src/components/layout/Sidebar.tsx` — Copy Mode pill (disabled placeholder) + lens switcher (Journey default) + L0/L1 stubs; no background so window vibrancy bleeds through
- `contract-ide/src/components/layout/GraphPlaceholder.tsx` — Wraps <AsyncState> driven by getNodes() on mount; supports ?force-error URL-param override
- `contract-ide/src/components/layout/Inspector.tsx` — Contract/Code/Preview/Receipts tab strip with only Contract functional; textarea bound to useEditorStore with onBlur → saveContract
- `contract-ide/src/components/layout/ChatPanel.tsx` — Placeholder strip with collapse toggle driving the parent panel ref's collapse() API
- `contract-ide/src/components/states/AsyncState.tsx` — 4-state async primitive (loading/empty/error/ready) with data-async DOM attribute for verification
- `contract-ide/src/store/editor.ts` — Zustand + zundo(temporal) store; limit=2, partialize(contractText); setContractText/saveContract/resetEditor actions
- `contract-ide/src/store/graph.ts` — Minimal Zustand store for node selection (selectedNodeUuid + selectNode); real graph logic deferred to Phase 3
- `contract-ide/src/hooks/useKeyboardShortcuts.ts` — Document-level keydown listener: Cmd+S → saveContract, Cmd+Z → temporal.getState().undo()

### Modified

- `contract-ide/src/App.tsx` — Replaced Plan 01-02 smoke-test body with `<AppShell />`
- `contract-ide/src/index.css` — Added `.bg-background { background-color: hsl(var(--background)); }` to opt non-sidebar panels out of whole-window transparency

## Decisions Made

- **v4 resize API uses percentage strings.** react-resizable-panels v4's internal `bt()` dispatcher routes bare numbers to `px` and bare strings with `%` to percentages. Original Task 1 commit used `defaultSize={18}` — window rendered sidebar/inspector as 18px/28px strips with text wrapping one letter per line. Fixed in 381442e. Action item: add "verify v4 dep API shape against current node_modules" to the upgrade-checklist. This is the second time in Phase 1 a major-version CSS/API breaking change has bitten us (first was shadcn v4 `--base-color` → `--preset`, logged in Plan 01-01).
- **Blur-triggered autosave, not debounced typing.** SHELL-05 spec reads "autosaves on blur + Cmd+S" — current behavior is exactly that. A debounced typing-while-saving cadence requires Monaco's change-event stream (Phase 4) and is out of scope here. Documented as a known UX limitation to avoid surprise during later review.
- **zundo partialize to contractText only.** Without partialize, `isDirty` enters the undo stack and Cmd+Z flickers the save-status line between "saved" and "editing…" even when nothing visible changed. Scoping to contractText keeps the undo semantics clean.
- **`?force-error` URL-param for manual error-state verification.** Since Plan 01-02's get_nodes always returns Ok(vec![]), the AsyncState error branch can't be exercised organically. Added a URL-param override (reads `window.location.search`) that skips the IPC call and routes straight to the error path with a fixture message. Marked for removal in Phase 2 once real data-path failure modes exist.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] react-resizable-panels v4 bare-number sizes render as pixels, not percentages**
- **Found during:** Task 3 (human-verify step 2 — "Three-pane layout")
- **Issue:** User loaded the app and saw the sidebar rendered as an 18px vertical strip with text running top-to-bottom one letter per line, same for the inspector at 28px. Only the center panel had a usable width. Resize handles on outer dividers were unreachable because the adjacent panels were at their maxSize (which was also in pixels).
- **Root cause:** react-resizable-panels v4 shipped a breaking change to its size-prop type dispatcher. The internal `bt(value)` in `node_modules/react-resizable-panels/dist/*` matches `case "number": return [e, "px"]` — so `defaultSize={18}` is interpreted as 18px. Percentages require string form with the `%` suffix: `defaultSize="18%"`.
- **Fix:** Changed every `defaultSize` / `minSize` / `maxSize` / `collapsedSize` prop on every `<ResizablePanel>` in AppShell.tsx from bare numbers to percentage strings. 7 props total touched. No other file needed changes; the shadcn-wrapped `<ResizableHandle>` was fine.
- **Files modified:** `contract-ide/src/components/layout/AppShell.tsx`
- **Verification:** User re-ran `npm run tauri dev` post-fix and confirmed all 8 verifier-tested steps pass (step 6 error-state not explicitly run, but the TS-checked `?force-error` branch is low-risk).
- **Committed in:** `381442e`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** The fix was necessary for any usable three-pane layout — without it, the plan's SHELL-01 success criterion (three usable panes) fails catastrophically. The fix itself is purely surgical (prop-value type coercion) and does not introduce scope creep. Flagging as a v4-dep-gotcha for the project's upgrade hygiene.

## Authentication Gates

None — no external service calls in this plan.

## Issues Encountered

- **Human-verify step 2 failure on first attempt (addressed by 381442e above).** User's feedback on this step was what caught the v4 API change. The prior executor iterated 5 times on the bug-fix cycle before settling on the percentage-string fix. Vite dev was running during verification; orchestrator killed the dev process before handoff to this finalizer.
- **Known UX limitation (not a bug, per-spec for Phase 1):** Autosave fires on textarea blur and Cmd+S only, not while the user is mid-type. SHELL-05 explicitly allows this; debounced-while-typing autosave is a Phase 4 Monaco concern. Noting here so future reviewers don't treat it as regressed behavior.
- **Empty-state copy follow-up:** GraphPlaceholder's empty message reads "No contracts yet — open a repo". Phase 2 is responsible for SHELL-02 (folder picker). If Phase 2 descopes the opener, the copy must change (e.g., to "No contracts yet — scan a directory" or similar) to avoid a dead-reference affordance. Added as a Pending Todo in STATE.md.
- **Step 6 error-state not exercised during human-verify.** The `?force-error` path compiles and is TS-checked; the risk of a runtime regression on an unused branch is low. Any real error surface in Phase 2's IPC rewrite will exercise it organically.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All SHELL-01 / SHELL-04 / SHELL-05 success criteria satisfied as of 381442e:
  - Three-pane layout with native chrome + Copy Mode pill + lens switcher visible on launch ✓
  - AsyncState pattern renders loading/empty/error/ready for get_nodes() ✓
  - Cmd+S autosaves, Cmd+Z reverts up to two edits against inspector textarea ✓
- Plan 01-04 (Day-1 integration validation: claude CLI subprocess, PostToolUse hook fixture, pkg+better-sqlite3, Monaco worker) has a fully rendered UI surface to validate against.
- **Pending Todos to carry forward:**
  - v4-dep-gotcha awareness: future major-version upgrades of shadcn / tailwind / react-resizable-panels need an explicit API-shape check before commit (logged alongside Plan 01-01's shadcn v4 `--preset` note).
  - Empty-state copy review once Phase 2 settles on whether SHELL-02 ships as folder-picker or scanner.
  - Phase 4 Monaco integration should replace the blur-triggered autosave with a debounced typing-while-saving cadence.

---
*Phase: 01-foundation*
*Completed: 2026-04-24*

## Self-Check: PASSED

- All 9 created files present on disk (`contract-ide/src/components/layout/AppShell.tsx`, `Sidebar.tsx`, `GraphPlaceholder.tsx`, `Inspector.tsx`, `ChatPanel.tsx`, `states/AsyncState.tsx`, `store/editor.ts`, `store/graph.ts`, `hooks/useKeyboardShortcuts.ts`) — verified by orchestrator context.
- All 3 commits present in `git log` (`dae32e5`, `37bbd85`, `381442e`) — verified before writing summary.
- Requirements SHELL-01 / SHELL-04 / SHELL-05 mapped to plan frontmatter.
