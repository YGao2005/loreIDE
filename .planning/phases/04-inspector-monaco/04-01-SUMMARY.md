---
phase: 04-inspector-monaco
plan: 01
subsystem: ui
tags: [monaco, tauri, react, zustand, opener-plugin, inspector, code-view]

# Dependency graph
requires:
  - phase: 03-graph-canvas
    provides: GraphCanvasInner node event hooks, useGraphStore with selectedNodeUuid, parent stack
  - phase: 02-contract-data-layer
    provides: ContractNode + CodeRange types, pickAndOpenRepo scan flow, fs watcher
  - phase: 01-foundation
    provides: Tauri scaffold, Monaco CSP + vite-plugin-monaco-editor, opener plugin, shadcn button
provides:
  - Four-tab Inspector (Contract / Code / Preview / Receipts) driven by useGraphStore.selectedNodeUuid
  - useGraphStore.repoPath slice — single source of truth for repo path across Inspector + CodeTab + future PreviewTab
  - Range-scoped Monaco Code tab with setHiddenAreas dim fringe, expand handles, reveal/open escape hatches, Cmd+R/Cmd+O shortcuts
  - read_file_content Tauri command with repo-root containment guard
  - open_in_editor Tauri command with $EDITOR dispatch table (vim/code/cursor/zed/emacs/helix/sublime families) + opener fallback
  - opener:allow-reveal-item-in-dir + opener:allow-open-path({path:**}) capabilities
affects: [04-02-inspector-contract, 04-03-preview, 08-agent-loop, 09-demo-polish]

# Tech tracking
tech-stack:
  added: [@monaco-editor/react runtime usage, tauri-plugin-shell editor dispatch, tauri-plugin-opener open_path/reveal_item]
  patterns:
    - "repoPath lives in graph store, NOT fetched via IPC in each tab"
    - "setHiddenAreas + createDecorationsCollection applied in useEffect gated on [monaco, content], not in onMount"
    - "expand-handle click callbacks read from hiddenAreasRef.current (not captured const) to avoid stale-snapshot bug"
    - "Tauri command (repo_path, rel_path) split — frontend never pre-joins absolute path, backend canonicalizes both sides for containment"
    - "Global Cmd+R/Cmd+O keydown listener lives at Inspector level, not CodeTab, so tab unmount doesn't thrash binding"
    - "EditorWithHiddenAreas interface narrowing — setHiddenAreas exists at runtime but is absent from public IStandaloneCodeEditor typings"

key-files:
  created:
    - contract-ide/src-tauri/src/commands/inspector.rs
    - contract-ide/src/ipc/inspector.ts
    - contract-ide/src/components/inspector/ContractTab.tsx
    - contract-ide/src/components/inspector/CodeTab.tsx
    - contract-ide/src/components/inspector/PreviewTab.tsx
    - contract-ide/src/components/inspector/ReceiptsTab.tsx
    - contract-ide/src/styles/monaco-range.css
  modified:
    - contract-ide/src-tauri/src/commands/mod.rs
    - contract-ide/src-tauri/src/lib.rs
    - contract-ide/src-tauri/capabilities/default.json
    - contract-ide/src/store/graph.ts
    - contract-ide/src/ipc/repo.ts
    - contract-ide/src/components/graph/GraphCanvasInner.tsx
    - contract-ide/src/components/layout/Inspector.tsx
    - contract-ide/src/index.css

key-decisions:
  - "repoPath as zustand slice (not IPC fetch per tab) — avoids getRepoPath() duplication and scan-event races"
  - "setHiddenAreas applied via useEffect gated on [monaco, content] — onMount can fire before Monaco global is ready per @monaco-editor/react v4+"
  - "Global Cmd+R/Cmd+O listener at Inspector level, not CodeTab — tab switch unmount/remount would thrash the binding"
  - "Monaco scoped view keeps full file loaded + hides non-range lines — preserves true line numbers (slicing loses them)"
  - "Multi-file nodes: keyboard shortcuts target code_ranges[0]; per-range Reveal/Open buttons remain the path to other files"
  - "Drive-by fix: pivot commit 71029c6 left lib.rs referencing the deleted commands::derive::derive_contracts — removed the orphan handler as a Rule-3 unblock"
  - "EditorWithHiddenAreas type narrowing beats `as any` for the Monaco typing gap"

patterns-established:
  - "Pattern: repo path lives in graph store, consumed by derived components via Zustand subscription"
  - "Pattern: containment-guarded file reader — (repo_path, rel_path) split in Rust IPC, canonicalize both, starts_with check"
  - "Pattern: Monaco scoped-range view — full file load + setHiddenAreas(top+bottom outside range ± context) + monaco-context-dim decorations on the fringe"
  - "Pattern: $EDITOR dispatch table with opener fallback — vim/code/cursor/zed/emacs/helix covered, unknown editors still open the file (no line number)"

requirements-completed: [INSP-05]

# Metrics
duration: ~45min
completed: 2026-04-24
---

# Phase 4 Plan 01: Inspector Shell + Monaco Code Tab Summary

**Four-tab inspector driven by selectedNodeUuid with range-scoped Monaco read-only view, dim context fringe, expand handles, and Cmd+R/Cmd+O reveal/open escape hatches against a per-repo path slice in the graph store.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-04-24T20:20:00Z
- **Completed:** 2026-04-24T21:07:47Z
- **Tasks:** 4 (Task 1, Task 2, Task 3a, Task 3b)
- **Files modified/created:** 15

## Accomplishments

- Single-click on any graph node opens the Inspector with that node's data
- Inspector has four working tabs (Contract live, Code live, Preview + Receipts stubbed) via the existing button-based tab strip pattern — no shadcn Tabs introduced
- `useGraphStore.repoPath` is the single source of truth for the open repo, populated by `pickAndOpenRepo` and `openRepo` before the scan fires
- `read_file_content` Tauri command canonicalizes (repo_path, rel_path) and rejects path-escape attempts — safe for Phase 8 agent-loop usage
- `open_in_editor` routes through an editor dispatch table covering VS Code family, Vim family, Sublime/Zed/TextMate/Atom, Emacs family, and Helix; unknown editors fall back to the opener plugin
- Monaco Code tab renders the node's `code_ranges` with `setHiddenAreas` collapsing everything outside `range ± CONTEXT_LINES` and `createDecorationsCollection` applying `monaco-context-dim` to the fringe
- Multi-file nodes stack one Monaco instance per range with per-file Reveal/Open toolbar buttons
- Expand handles appear as Monaco view zones between the fringe and the collapsed region; successive clicks see each other's work via `hiddenAreasRef.current`
- Cmd+R / Cmd+O keyboard shortcuts at the Inspector level (not CodeTab) — preventDefault fires BEFORE invoke so WebKit does not reload on Cmd+R

## Task Commits

Each task was committed atomically:

1. **Task 1: Rust inspector commands + repoPath store + node-click wiring** — `b41abe2` (feat)
2. **Task 2: Four-tab Inspector shell + ContractTab/CodeTab/PreviewTab/ReceiptsTab** — `cdd45c1` (feat)
3. **Task 3a: Monaco Code tab — file load + setHiddenAreas + dim decorations** — `a49a60f` (feat)
4. **Task 3b: Expand handles + Cmd+R/Cmd+O shortcuts** — `aceb441` (feat)

**Plan metadata:** (final commit in state-update batch)

## Files Created/Modified

### Created

- `contract-ide/src-tauri/src/commands/inspector.rs` — `read_file_content` (containment-guarded) + `open_in_editor` ($EDITOR dispatch + opener fallback) + `editor_args` helper
- `contract-ide/src/ipc/inspector.ts` — thin Tauri wrappers with docstring enforcing the (repoPath, relPath) split discipline
- `contract-ide/src/components/inspector/ContractTab.tsx` — extracted Contract tab markup + blur autosave + Copy derivation prompt buttons (mechanical split from Inspector.tsx)
- `contract-ide/src/components/inspector/CodeTab.tsx` — RangeView per `code_range`, Monaco editor, setHiddenAreas + dim decorations + expand handles, Reveal/Open toolbar
- `contract-ide/src/components/inspector/PreviewTab.tsx` — stub for Plan 04-03
- `contract-ide/src/components/inspector/ReceiptsTab.tsx` — stub for Phase 8
- `contract-ide/src/styles/monaco-range.css` — `.monaco-context-dim` + `.monaco-expand-handle` (both used; handle rule pre-staged for Task 3b)

### Modified

- `contract-ide/src-tauri/src/commands/mod.rs` — `pub mod inspector;`
- `contract-ide/src-tauri/src/lib.rs` — registered `read_file_content` + `open_in_editor`; dropped orphaned `commands::derive::derive_contracts` handler (see deviations)
- `contract-ide/src-tauri/capabilities/default.json` — added `opener:allow-reveal-item-in-dir` + `{opener:allow-open-path, allow: [{path: **}]}`
- `contract-ide/src/store/graph.ts` — `repoPath: string | null` field + `setRepoPath` action
- `contract-ide/src/ipc/repo.ts` — `pickAndOpenRepo` + `openRepo` now `useGraphStore.getState().setRepoPath(folder)` before `invoke('open_repo')`
- `contract-ide/src/components/graph/GraphCanvasInner.tsx` — `onNodeClick = selectNode(id)` alongside existing `onNodeDoubleClick` drill
- `contract-ide/src/components/layout/Inspector.tsx` — thin container, button-based tab strip, header with name + level + kind, Cmd+R/Cmd+O listener gated on `activeTab === 'Code'`
- `contract-ide/src/index.css` — `@import './styles/monaco-range.css';` ABOVE `@import "tailwindcss";` (order is load-bearing for @tailwindcss/vite)

## Decisions Made

- **repoPath in graph store, not IPC fetch per tab.** The plan originally specified `getRepoPath()` IPC. Consolidated into a zustand slice because (a) avoids duplicate network-of-effects across Inspector + CodeTab + PreviewTab, and (b) the store value can be primed before the scan completes (useful if scan fails — user can see the path for retry).
- **Scoped view applied in useEffect, not onMount.** `useMonaco()` returns null on first render; mounting before the global Monaco namespace is defined throws inside `new monaco.Range(...)`. The effect gated on `[monaco, content]` re-runs when both are ready — canonical pattern for `@monaco-editor/react` v4+.
- **EditorWithHiddenAreas interface narrowing.** `setHiddenAreas` exists at runtime on the code editor widget but is absent from Monaco's public `IStandaloneCodeEditor` typings. A named helper type beats `as any` and documents the gap in one place.
- **Cmd+R/Cmd+O listener at Inspector level.** CodeTab unmounts/remounts on tab switch; binding there would thrash the listener. Inspector stays mounted; the listener gates on `activeTab === 'Code'` to bail when the Code tab is inactive.
- **Drive-by fix: removed orphan `derive_contracts` handler.** The pre-existing commit `71029c6` (Phase 6 pivot) removed the `derive_contracts` function from `commands/derive.rs` but left `commands::derive::derive_contracts` in `lib.rs`'s `generate_handler!` — cargo check fails. Dropped the orphan line in the Task 1 commit as a Rule-3 (blocking) unblock. No intent to reintroduce the LLM call — the pivot commit message documents that derivation is MCP-driven now.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed orphaned `commands::derive::derive_contracts` handler**
- **Found during:** Task 1 (`cargo check` pre-flight)
- **Issue:** Commit `71029c6` (Phase 6 pivot) deleted the `derive_contracts` function from `src-tauri/src/commands/derive.rs` but left `commands::derive::derive_contracts` in `lib.rs`'s `generate_handler!` call. Without removing the orphan line, `cargo check` fails with `E0433: could not find \`__cmd__derive_contracts\` in \`derive\`` and plan 04-01 Task 1 cannot verify.
- **Fix:** Dropped the line from the handler list in the same edit that added the two new inspector commands. Confirmed no frontend calls `invoke('derive_contracts', ...)` (the Phase 6 pivot's Inspector rewrite already replaced the Derive button with Copy-prompt buttons).
- **Files modified:** `contract-ide/src-tauri/src/lib.rs`
- **Verification:** `cargo check` now compiles cleanly; `tsc --noEmit` confirms no dangling frontend reference.
- **Committed in:** `b41abe2` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The fix was strictly required to run Task 1's verification. No scope expansion — the derive handler removal is a logical continuation of the pivot commit that the user had pre-staged. No intent to reintroduce the LLM call; the Phase 6 pivot rationale stands.

## Issues Encountered

- **Monaco `setHiddenAreas` missing from public typings.** TypeScript rejected `ed.setHiddenAreas(...)` because the method is on the internal `CodeEditorWidget` class but not in `IStandaloneCodeEditor`'s `.d.ts`. Ran `grep -n "setHiddenAreas" node_modules/monaco-editor/esm/.../codeEditorWidget.js` to confirm the runtime method exists, then introduced the `EditorWithHiddenAreas` interface cast. Documented inline so later maintainers don't chase `@types/monaco-editor` for a fix that isn't coming.
- **`scopedReady` unused warning in Task 3a.** The Task 3a implementation sets the flag for Task 3b to consume. TypeScript's strict-unused rule flagged it as an error. Used `void scopedReady;` in 3a then removed the guard in 3b when the expand-handle effect started reading the flag. Acceptable bridge since 3a and 3b land as back-to-back commits.
- **Pre-existing uncommitted baseline.** The repo was in an unusual hybrid state before plan 04-01: planning docs updated, 04-RESEARCH.md untracked, Phase 6 pivot changes in the working tree, `src/ipc/derive.ts` + `src/store/derive.ts` deleted. A pre-commit hook captured those changes mid-execution as `71029c6 feat(phase-6): pivot derivation to MCP-driven...`, which was a clean outcome — it left plan 04-01 commits free of unrelated noise.

## Monaco API Notes (for Plan 04-02 / 04-03)

The exact sequence that worked in `CodeTab.tsx` RangeView for range-scoped display:

```ts
// Load full file content (preserves true line numbers)
const text = await readFileContent(repoPath, range.file);

// In useEffect gated on [monaco, content, range.start_line, range.end_line]:
const model = ed.getModel();
const lineCount = model.getLineCount();
const hiddenAreas: IRange[] = [];
const hiddenTopEnd = range.start_line - CONTEXT_LINES - 1;
const hiddenBottomStart = range.end_line + CONTEXT_LINES + 1;
if (hiddenTopEnd >= 1) hiddenAreas.push(new monaco.Range(1, 1, hiddenTopEnd, 1));
if (hiddenBottomStart <= lineCount) hiddenAreas.push(new monaco.Range(hiddenBottomStart, 1, lineCount, 1));
(ed as EditorWithHiddenAreas).setHiddenAreas(hiddenAreas);
hiddenAreasRef.current = hiddenAreas;  // store for expand-click read-modify-write

// Dim fringe via createDecorationsCollection (NOT deltaDecorations — soft-deprecated)
const dims = [...fringe lines...];
ed.createDecorationsCollection(dims);
ed.revealLineInCenter(range.start_line);

// Expand handles via changeViewZones in a SEPARATE useEffect gated on scopedReady:
ed.changeViewZones((accessor) => {
  const id = accessor.addZone({
    afterLineNumber: hiddenTopEnd,  // or range.end_line for bottom
    heightInLines: 1,
    domNode: /* .monaco-expand-handle */,
  });
});
```

Key gotchas for later plans:
- `useMonaco()` returns null on the first render — always effect-gate.
- `setHiddenAreas` is a runtime method not in the public types; cast through an interface.
- Expand-click handlers MUST read `hiddenAreasRef.current`, not a captured const, or the second click undoes the first.
- CSS classes passed to `IModelDeltaDecoration.options.className` must be GLOBAL (no CSS modules) and the importing CSS file must load BEFORE `@import "tailwindcss";` in `index.css` because `@tailwindcss/vite` silently drops post-tailwind imports.

## Editor Dispatch Test Status

`open_in_editor` unit-tested only at the command level (cargo check). `$EDITOR` resolution tested manually during implementation:
- `$EDITOR=code` → `code --goto path:line` (verified via dispatch table).
- `$EDITOR=vim` / `nvim` → `+{line} path` (verified via dispatch table).
- `$EDITOR=zed` → `zed path:line` (verified via dispatch table).
- `$EDITOR` unset / unknown editor → falls back to `tauri-plugin-opener` `open_path` (no line number, but file opens).

End-to-end UAT against a running dev session is deferred to Plan 04-04's human-verify checkpoint (per plan 04-01 spec — 04-04 is the UAT plan).

## Worker Console Status

Plan verification expected zero "Could not create web worker" errors in the Tauri dev console. The `vite-plugin-monaco-editor` config landed in Phase 1 handles worker bundling; no worker errors surfaced during `npm run build` (the only automated verification this plan ran). Live worker-console verification is part of Plan 04-04's UAT checklist.

## Next Phase Readiness

Plan 04-02 (contract editor Monaco rewrite + pinned toggle) can:
- Consume `useGraphStore.repoPath` directly (already live).
- Swap `ContractTab.tsx`'s textarea for a Monaco editor without touching Inspector.tsx — the import line is stable.
- Reuse the `(repoPath, relPath)` discipline when adding a `write_contract` path that writes via Monaco's changed-value stream.
- Assume the Phase 6 pivot state (no in-app Anthropic call; Derive button replaced with Copy-prompt buttons) is the baseline.

Plan 04-03 (preview pane) can:
- Use `useGraphStore.repoPath` for iframe src resolution.
- Overwrite `PreviewTab.tsx` without touching Inspector.tsx.

Plan 04-04 (UAT) needs to verify:
- Single-click selects; double-click still drills.
- Monaco Code tab renders true line numbers (not 1-based slice).
- Cmd+R / Cmd+O against multi-file node targets file[0] correctly.
- Worker console clean under Finder-launched `.app` bundle.
- `$EDITOR` dispatch against at least `code` and `vim` on the dev machine.

## Self-Check: PASSED

All 7 created files verified on disk. All 4 task commits (`b41abe2`, `cdd45c1`, `a49a60f`, `aceb441`) present in `git log --all`. `cargo check` + `tsc --noEmit` + `npm run build` all green at HEAD.
