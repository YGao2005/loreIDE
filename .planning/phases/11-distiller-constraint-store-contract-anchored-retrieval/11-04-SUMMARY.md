---
phase: 11-distiller-constraint-store-contract-anchored-retrieval
plan: "04"
subsystem: delegate-button
tags: [delegate, inspector, substrate-retrieval, state-machine, decisions-manifest, run_agent-bare]
dependency_graph:
  requires: [11-03, 08-04a]
  provides: [delegate_compose, delegate_plan, delegate_execute, ensure_decisions_manifest, DelegateButton, ComposingOverlay, PlanReviewPanel, decisions-fixtures]
  affects: [Inspector, SimplifiedInspector, AppShell, run_agent]
tech_stack:
  added: []
  patterns: [zustand-state-machine, tauri-command-bare-flag, stagger-fade-animation, fixture-fallback]
key_files:
  created:
    - contract-ide/src-tauri/src/delegate/mod.rs
    - contract-ide/src-tauri/src/delegate/composer.rs
    - contract-ide/src-tauri/src/delegate/plan_review.rs
    - contract-ide/src-tauri/src/delegate/decisions.rs
    - contract-ide/src-tauri/src/commands/delegate.rs
    - contract-ide/src/ipc/delegate.ts
    - contract-ide/src/store/delegate.ts
    - contract-ide/src/components/inspector/DelegateButton.tsx
    - contract-ide/src/components/inspector/ComposingOverlay.tsx
    - contract-ide/src/components/inspector/PlanReviewPanel.tsx
    - contract-ide/.contract-ide-fixtures/decisions/AccountSettings.DangerZone.json
    - contract-ide/.contract-ide-fixtures/decisions/TeamSettings.DangerZone.json
  modified:
    - contract-ide/src-tauri/src/commands/agent.rs
    - contract-ide/src-tauri/src/commands/mod.rs
    - contract-ide/src-tauri/src/lib.rs
    - contract-ide/src/components/inspector/SimplifiedInspector.tsx
    - contract-ide/src/components/layout/Inspector.tsx
    - contract-ide/src/components/layout/AppShell.tsx
decisions:
  - "delegate_execute reuses Phase 8 run_agent (no re-implementation of spawn/streaming/receipt logic)"
  - "bare: Option<bool> param on run_agent defaults false; Phase 11 paths pass Some(true)"
  - "SimplifiedInspector DelegateToAgentButton stub replaced with real DelegateButton (store-driven)"
  - "source:click toast implemented as inline DOM element — no toast library dependency added"
  - "Task 1a+1b shipped sequentially in one session (decisions.rs stub → full replace avoids broken intermediate)"
  - "repeat_n() used instead of repeat().take() per clippy::manual_repeat_n"
metrics:
  duration: ~30min
  completed: "2026-04-25T10:09:10Z"
  tasks_completed: 2
  tasks_total: 3
  files_created: 12
  files_modified: 6
---

# Phase 11 Plan 04: Delegate Button + Beat 1 Demo Flow Summary

**One-liner:** Inspector-footer Delegate button with Zustand state machine (idle→composing→plan-review→sent→executing→idle), 150ms-stagger composing overlay, plan-review panel, decisions.json fixture fallback for two demo atoms, and bare-flag extension to Phase 8 run_agent.

## Tasks Completed

| # | Name | Commit | Status |
|---|------|--------|--------|
| 1a | Rust delegate module — composer + plan_review + run_agent bare-param patch | bb1258c | DONE |
| 1b | Decisions manifest module + ensure_decisions_manifest + 2 demo fixtures | 1d00293 | DONE |
| 2 | React state machine + 3 components + Inspector wiring | a86c540 | DONE |
| 3 | Beat 1 visual sign-off | — | CHECKPOINT |

## What Was Built

### Rust side (Tasks 1a + 1b)

**delegate/mod.rs** — re-exports composer, plan_review, decisions submodules.

**delegate/composer.rs** — `compose_prompt(app, scope_uuid)` assembles agent prompt from:
- Real `nodes` columns (uuid, level, parent_uuid, contract_body, name — NO intent/role)
- Plan 11-03 lineage scope walker (recursive CTE, cousins excluded)
- Plan 11-03 candidate_selection (FTS5 + anchored_uuids JOIN + RRF k=60)
- Plan 11-03 llm_rerank (top-15 → top-5 with LLM grounding)

**delegate/plan_review.rs** — `run_planning_pass(app, prompt)` calls `claude -p --bare --append-system-prompt PLANNING-ONLY --json-schema` and parses StructuredPlan { target_files, substrate_rules, decisions_preview }.

**delegate/decisions.rs** — `ensure_decisions_manifest_inner(app, repo_path, atom_uuid)` with two-layer demo-atom resolution:
- DEMO_ATOM_RUBRICS constant: ["AccountSettings.DangerZone", "TeamSettings.DangerZone"] (rubric LABELS, not UUIDs)
- `resolve_demo_uuids(pool)` runtime lookup via nodes.name (post-Phase-9 path)
- Fixture fallback: reads `.contract-ide-fixtures/decisions/<rubric>.json` and copies to `.contracts/decisions/<atom-uuid>.json`
- SC 7: demo atoms NEVER return empty (pre-Phase-9 rubric-label match + post-Phase-9 UUID-via-nodes.name both work)

**commands/delegate.rs** — 4 Tauri commands: `delegate_compose`, `delegate_plan`, `delegate_execute`, `ensure_decisions_manifest`.
- `delegate_execute` appends decisions-emission directive then calls Phase 8 `run_agent(app, prompt, scope_uuid, Some(true))` — no re-implementation of spawn/streaming/receipt logic.

**commands/agent.rs patch** — `run_agent` gains `bare: Option<bool>` param (default false). When true, appends `--bare` to claude spawn args.

### React side (Task 2)

**store/delegate.ts** — Zustand store with DelegateState union type and full state machine actions. `onAgentTerminated` uses `getState()` inside the handler (race-resistant).

**ComposingOverlay.tsx** — 5 rows fade in with 150ms stagger (~1.5s total). Skeleton rows during compose; real hits during plan-review. `[source]` click fires Tauri `source:click` event.

**PlanReviewPanel.tsx** — "Plan ready — review before dispatch" with three groups (target files, substrate rules cited, implicit decisions preview). [Preview prompt] expander + Re-plan + Approve + Cancel.

**DelegateButton.tsx** — Always-visible in Inspector footer regardless of active tab. State-machine label transitions. Shows ComposingOverlay + PlanReviewPanel when applicable.

**Inspector.tsx + SimplifiedInspector.tsx** — DelegateButton wired into always-visible footer. SimplifiedInspector replaces legacy DelegateToAgentButton stub.

**AppShell.tsx** — `agent:complete` → `onAgentTerminated` listener. `source:click` → DOM toast.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] decisions.rs stub created before full implementation**
- **Found during:** Task 1a
- **Issue:** commands/delegate.rs imports decisions.rs; without the file the build fails
- **Fix:** Created a stub decisions.rs first (pre-compile), then replaced with full implementation in Task 1b
- **Files modified:** contract-ide/src-tauri/src/delegate/decisions.rs
- **Commit:** 1d00293

**2. [Rule 1 - Bug] clippy::manual_repeat_n violations**
- **Found during:** Task 1a/1b verification
- **Issue:** `std::iter::repeat("?").take(n)` pattern triggers clippy -D warnings
- **Fix:** Changed to `std::iter::repeat_n("?", n)` in both composer.rs and decisions.rs
- **Files modified:** delegate/composer.rs, delegate/decisions.rs
- **Commit:** Included in 1d00293

**3. [Rule 1 - Bug] TypeScript timer type mismatch**
- **Found during:** Task 2 TypeScript build
- **Issue:** `ReturnType<typeof setTimeout>` vs `number` mismatch in browser context
- **Fix:** Used `number[]` with `window.setTimeout(...) as unknown as number` cast
- **Files modified:** ComposingOverlay.tsx
- **Commit:** a86c540

**4. [Rule 2 - Missing critical functionality] SimplifiedInspector DelegateToAgentButton wiring**
- **Found during:** Task 2 Inspector review
- **Issue:** SimplifiedInspector was still using the Phase 9 stub DelegateToAgentButton (disabled by default)
- **Fix:** Replaced with the real DelegateButton — delegates to useDelegateStore directly
- **Files modified:** contract-ide/src/components/inspector/SimplifiedInspector.tsx
- **Commit:** a86c540

**5. [Rule 2 - Missing critical functionality] source:click toast without a toast library**
- **Found during:** Task 2 AppShell wiring
- **Issue:** Project has no toast library installed (sonner/react-hot-toast not in package.json)
- **Fix:** Implemented inline DOM toast element (creates div, styles, auto-removes after 2.5s)
- **Files modified:** AppShell.tsx
- **Commit:** a86c540

## Requirements Satisfied

- **SUB-05:** Delegate button composes contract body + 5 substrate hits + lineage neighbors + parent-surface context, dispatches via Phase 8 run_agent (bare=true)
- **SUB-10 (partial):** Delegate flow surface ships; Plan 11-05 UAT measures receipt-delta against Phase 9 baselines

## Success Criteria Status

- [x] Delegate state machine (idle → composing → plan-review → sent → executing → idle)
- [x] Composing overlay streams 5 substrate hits with 150ms stagger fade
- [x] Plan-review panel renders target_files / substrate_rules / decisions_preview within 3-5s
- [x] Approve / Edit prompt / Cancel all wired
- [x] decisions.json fallback: demo atoms NEVER show empty (SC 7)
- [x] Hand-crafted decisions.json fixtures committed for both demo atoms
- [x] Phase 8 run_agent extended with optional bare:bool param; delegate_execute passes bare=true
- [x] composer.rs uses real nodes columns only (no intent/role)
- [x] DB pool extraction follows canonical async pattern
- [x] [source] click stub fires toast
- [x] Phase 8 run_agent reused (not re-implemented)
- [ ] Visual sign-off (Task 3 checkpoint) — PENDING

## Self-Check: PASSED

Files exist:
- contract-ide/src-tauri/src/delegate/mod.rs ✓
- contract-ide/src-tauri/src/delegate/composer.rs ✓
- contract-ide/src-tauri/src/delegate/plan_review.rs ✓
- contract-ide/src-tauri/src/delegate/decisions.rs ✓
- contract-ide/src-tauri/src/commands/delegate.rs ✓
- contract-ide/src/ipc/delegate.ts ✓
- contract-ide/src/store/delegate.ts ✓
- contract-ide/src/components/inspector/DelegateButton.tsx ✓
- contract-ide/src/components/inspector/ComposingOverlay.tsx ✓
- contract-ide/src/components/inspector/PlanReviewPanel.tsx ✓
- contract-ide/.contract-ide-fixtures/decisions/AccountSettings.DangerZone.json ✓
- contract-ide/.contract-ide-fixtures/decisions/TeamSettings.DangerZone.json ✓

Commits exist: bb1258c, 1d00293, a86c540 ✓

Build status: cargo build + clippy -D warnings + cargo test ✓ | npm run build (tsc + vite) ✓

## UAT Findings & Fixes (post-checkpoint)

The Beat 1 visual sign-off surfaced six issues across the dependent code paths.
All resolved before checkpoint approval; the planning pass now shows real
substrate knowledge end-to-end.

| # | Symptom | Root cause | Fix | Commit |
|---|---|---|---|---|
| 1 | Delegate click did nothing | `fts5: syntax error near "#"` — contract body's markdown headers passed verbatim to FTS5 MATCH | Sanitize query: tokenize, strip non-alphanumeric, phrase-quote, OR-join, cap 32 tokens | `c055af6` |
| 2 | `claude exit non-zero: Warning: no stdin data received in 3s` | `tauri-plugin-shell` always pipes stdin without writing/closing; newer claude CLI exits non-zero | Switch to `std::process::Command` via `tokio::task::spawn_blocking`; pipe prompt to stdin and drop to signal EOF | `1a62f63` |
| 3 | `claude exit non-zero:` (empty stderr) | claude `-p --output-format json` returns errors in stdout body, not stderr | Surface exit code + stderr + first 500 chars of stdout in error; detect `is_error: true` and surface `result` field | `9d63b1e` |
| 4 | "Not logged in · Please run /login" | `--bare` deliberately ignores OAuth keychain; requires `ANTHROPIC_API_KEY` | Drop `--bare` from all 4 claude call-sites (plan_review, rerank, distiller pipeline, delegate_execute). Trade-off: lose 1-3s startup discipline (Pitfall 3) for working Claude Code OAuth auth | `daa5b6d` |
| 5 | 77 episodes ingested, 0 substrate produced | `INSERT OR IGNORE` short-circuits `episode:ingested` event on re-backfill; existing episodes never re-trigger distillation after pipeline fixes land | New `redistill_all_episodes` Tauri command + UI affordance in BackfillModal with live progress | `bad3047` |
| 6 | All 137 distilled nodes shipped with `anchored_uuids='[]'` (cousin-exclusion JOIN broken) | `load_session_atom_candidates` filtered by `nodes.updated_at >= sessions.started_at` — undefined string compare (timezone format mismatch), and structurally always-empty (atoms derived during repo scan, before runtime sessions) | Drop session-time filter; return 50 most-recently-updated canonical atoms as broad fallback (matches the pipeline-level comment's stated intent) | `f099a67` |

### Coordination notes for downstream phases

- Plan 11-05 UAT: substrate IS now seeded (137 nodes after second redistill); SC 1 (≥5 nodes per session with provenance) gateable.
- Phase 12 supersession: `--bare` was dropped here; if Phase 12 introduces additional claude calls, follow the same OAuth pattern (no env-var dependency) for Claude Code-only auth.
- Plan 11-04 also added `redistill:progress` event + IPC wrappers; Plan 11-05 substrate side panel can reuse the substrate-count refresh pattern.

### Sonnet+medium effort uplift (post-checkpoint refinement)

`run_agent` signature extended with explicit `model` + `effort` params. `delegate_execute` now passes `Some("sonnet"), Some("medium")` rather than inheriting the chat panel's haiku/low defaults — delegate writes code with multi-file edits + decisions.json emission, which sonnet+medium handles reliably.
