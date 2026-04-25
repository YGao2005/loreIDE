---
phase: 08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation
plan: "06"
subsystem: pin-aware-reconcile-and-mcp-tools
tags: [reconcile, propagation, PROP-04, MCP-02, amber, pin-aware, rollup-generation, staleness-annotation, UAT]
requires: [08-02, 08-03]
provides: [accept-rollup-as-is-ipc, draft-propagation-diff, read-children-section-diffs, reconcile-panel-amber, unpinned-amber-actions, pinned-amber-actions, propose-rollup-reconciliation-mcp, staleness-annotation]
affects: [09-demo-repo-seeding]
tech-stack:
  added:
    - regex = "1" (Cargo.toml dep — for in-place YAML field replacement)
  patterns:
    - In-place YAML regex replacement for rollup_* fields (never serde_yaml_ng round-trip)
    - rollup_generation optimistic-lock: extract via line scan, mismatch → Err with current gen
    - ReconcilePanel sibling render pattern (drift branch untouched, rollup-stale branch added alongside)
    - Pin-aware branching before writer call (SKIPPED-PINNED unreachable from UI)
    - annotateStaleness wrapper on MCP tool responses
    - v1 "may have diverged" phrasing for staleness annotation (W7 decision)
key-files:
  created:
    - contract-ide/src-tauri/src/commands/reconcile.rs
    - contract-ide/src-tauri/tests/reconcile_pin_tests.rs
    - contract-ide/src/ipc/reconcile.ts
    - contract-ide/src/components/reconcile/UnpinnedAmberActions.tsx
    - contract-ide/src/components/reconcile/PinnedAmberActions.tsx
    - contract-ide/src/components/reconcile/DraftPropagationDiff.tsx
    - contract-ide/src/components/reconcile/ChildrenChangesView.tsx
    - contract-ide/mcp-sidecar/src/lib/staleness_annotation.ts
    - contract-ide/mcp-sidecar/src/tools/propose_rollup_reconciliation.ts
    - .planning/phases/08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation/08-UAT.md
  modified:
    - contract-ide/src/components/inspector/ReconcilePanel.tsx
    - contract-ide/src-tauri/src/commands/mod.rs
    - contract-ide/src-tauri/src/lib.rs
    - contract-ide/src-tauri/src/commands/journal.rs
    - contract-ide/src-tauri/src/commands/nodes.rs
    - contract-ide/src-tauri/src/commands/graph.rs
    - contract-ide/src/ipc/types.ts
    - contract-ide/mcp-sidecar/src/tools/get_contract.ts
    - contract-ide/mcp-sidecar/src/tools/find_by_intent.ts
    - contract-ide/mcp-sidecar/src/index.ts
decisions:
  - "In-place YAML edit uses three independent multiline regexes (rollup_hash, rollup_state, rollup_generation). Safety guarantees: (1) YAML keys at document root cannot contain newlines; (2) frontmatter is bounded by leading --- and closing \\n---\\n; (3) body section after closing fence cannot have a top-level rollup_* key at column 0. Tests confirm byte-equality on the contract body after edit."
  - "rollup_generation added to ContractNode Rust struct + TypeScript type. SQL queries use COALESCE(rollup_generation, 0) so new nodes return 0 default. Enables ReconcilePanel to pass expected_generation to accept_rollup_as_is without an extra IPC round-trip."
  - "list_journal_entries_raw added to journal.rs for Rust-to-Rust calls by draft_propagation_diff. Avoids the Tauri command overhead for same-binary calls."
  - "Staleness annotation uses v1 phrasing 'cited children may have diverged' (W7) — not 'N dependent children changed' because v1 lacks per-generation snapshot table. Phase 9 mass-edit ranking keys off this header format."
  - "Phase 7 drift branch in ReconcilePanel is byte-identical to the Phase 7 shipped version. Only the rollup-stale sibling render was added. PROPAGATION.md no-retroactive-changes mandate honored."
  - "read_children_section_diffs v1 limitation documented explicitly: section_text_at_last_generation is always null (no historical body snapshots). The drifted flag uses section hash mismatch as proxy. v2 carry-over: upstream_generation_snapshots table."
metrics:
  duration_minutes: 15
  tasks_completed: 2
  files_changed: 21
  completed_date: "2026-04-25"
  test_count: 6
---

# Phase 08 Plan 06: Pin-Aware Reconcile + propose_rollup_reconciliation MCP Tool + Phase 8 UAT Script Summary

**One-liner:** Pin-aware ReconcilePanel sibling render with accept_rollup_as_is narrow Rust IPC (in-place YAML, never serde_yaml_ng round-trip), rollup_generation optimistic lock, propose_rollup_reconciliation MCP tool, and staleness annotation on get_contract/find_by_intent.

## What Was Built

### Task 1: Rust IPC Commands (commit 2d25d9e)

**`commands/reconcile.rs`** — three Tauri commands:

1. **`accept_rollup_as_is`** — NARROW writer (PROP-04 anti-YAML-round-trip):
   - Acquires `DriftLocks::for_uuid(uuid)` — serializes with watcher, rollup engine, cherrypick
   - Reads raw sidecar bytes (NOT `parse_sidecar`) to avoid any YAML parse → serialize perturbation
   - Extracts current `rollup_generation` via line scan (fast, zero allocations)
   - Enforces optimistic lock: `current_generation != expected_generation` → returns `Err("rollup_generation mismatch: … — refresh and retry")` with current generation for client retry
   - In-place regex edit of ONLY three lines: `rollup_hash`, `rollup_generation`, `rollup_state`
   - Temp+rename write (atomic, same as Phase 2)
   - Optional journal entry with `entry_type: "accept_rollup_as_is"` (forward-compat extra fields per 08-03 schema tolerance)
   - SQLite update: nodes + rollup_derived
   - Emits `rollup:changed { uuid, state: "fresh", generation: N }` to React

2. **`draft_propagation_diff`** — read-only bundle for unpinned-amber path:
   - Reads upstream sidecar via `read_sidecar_file` for body + rollup_inputs + generation
   - Reads each cited child section via `extract_section_from_body` (H2 section scanner)
   - Calls `list_journal_entries_raw` (new Rust-to-Rust helper) for recent context
   - Returns `DraftPropagationContext` without any write

3. **`read_children_section_diffs`** — read-only for pinned-amber path:
   - Returns `Vec<ChildSectionDiff>` with current section texts + `drifted` flag
   - v1 limitation: `section_text_at_last_generation = None` (no historical snapshots)
   - v2 carry-over documented explicitly

**`apply_rollup_inplace`** helper exported for tests:
- Three independent multiline regexes; L0 sidecars (no rollup fields) return byte-equal unchanged

**`extract_rollup_generation_test`** exported for test module.

**`list_journal_entries_raw`** added to `commands/journal.rs` for direct Rust-to-Rust calls.

**6 reconcile_pin_tests** — all pass:
- `accept_rollup_as_is_touches_only_rollup_fields` — body bytes byte-equal pre/post; only 3 lines change
- `accept_rollup_as_is_rejects_stale_generation` — mismatch message includes "refresh and retry"
- `accept_rollup_as_is_concurrent_calls_serialize` — second caller sees generation advanced
- `draft_propagation_diff_returns_cited_sections` — 3 sections from 2 children, correct texts
- `draft_propagation_diff_omits_uncited_sections` — Notes section not in rollupInputs → not included
- `frontmatter_inplace_edit_snapshot_l0_to_l4` — L0 byte-equal; L1..L4 exactly 3 changed lines

### Task 2: Frontend + MCP (commit a0784e7)

**`src/ipc/reconcile.ts`** — three typed wrappers: `acceptRollupAsIs`, `draftPropagationDiff`, `readChildrenSectionDiffs`.

**`src/ipc/types.ts`** — `ContractNode.rollup_generation: number` added (default 0).

**`src/components/inspector/ReconcilePanel.tsx`** — extended with rollup-stale SIBLING RENDER:
- Branch order: drift (red) → rollup-stale (amber) → healthy/untracked
- Phase 7 drift branch: byte-identical to Phase 7 shipped version (PROPAGATION.md mandate)
- Pin-aware branching fires in the render function BEFORE any action component:
  - `isPinned && rollupState === 'stale'` → `PinnedAmberActions`
  - `!isPinned && rollupState === 'stale'` → `UnpinnedAmberActions`
  - SKIPPED-PINNED unreachable from both UI paths (Pitfall 5 closed)

**`UnpinnedAmberActions.tsx`** — three actions:
- Draft propagation for review (calls `draftPropagationDiff`, renders `DraftPropagationDiff`)
- Accept as-is (justification REQUIRED for L1; optional for L2/L3; rollup_generation mismatch → toast)
- Edit manually (closes modal, user edits in Monaco Contract tab)

**`PinnedAmberActions.tsx`** — three actions:
- Review children's changes (calls `readChildrenSectionDiffs`, renders `ChildrenChangesView`)
- Unpin and reconcile (two-step: confirmation → writeContract with human_pinned=false → close; panel re-opens showing UnpinnedAmberActions)
- Accept as-is, keep pin (justification REQUIRED for L1; uses `keepPin: true`)

**`DraftPropagationDiff.tsx`** — force-shown diff before commit:
- Displays upstream body (pre read-only), collapsed child section cards, recent journal entries
- Assembles clipboard-copy prompt from the context bundle (v1: clipboard only; v2 carry-over: run_agent dispatch)

**`ChildrenChangesView.tsx`** — read-only child sections:
- Drifted flag shown per section; v1 limitation label ("Last-committed snapshot not yet recorded")

**`mcp-sidecar/src/lib/staleness_annotation.ts`** — `annotateStaleness(body, summary)`:
- Returns `"[This <level> is rollup-stale; cited children may have diverged: <child_uuid> (<sections>); ...]\\n\\n" + body`
- Returns `body` unchanged when `summary` is null (fresh or untracked)
- v1 phrasing uses "may have diverged" (W7 decision — no per-generation snapshots to compute exact diff)

**`mcp-sidecar/src/tools/get_contract.ts`** — extended:
- Queries `rollup_derived.state` after reading node
- Reads `rollup_inputs_json` to build `StalenessSummary` with cited children
- Calls `annotateStaleness` when `state === 'stale'`; returns verbatim for fresh/untracked

**`mcp-sidecar/src/tools/find_by_intent.ts`** — extended:
- For each FTS result, checks rollup_derived.state
- Annotates matching stale snippets with the same staleness header

**`mcp-sidecar/src/tools/propose_rollup_reconciliation.ts`** — new MCP tool:
- Reads node row: `human_pinned`, `rollup_inputs_json`, `contract_body`
- Reads cited child section texts from sidecar files via H2 section extractor
- Reads recent journal entries from `.contracts/journal/*.jsonl` by scanning for related UUIDs
- Pin-aware branching:
  - PINNED: returns `{ mode: 'read_only_diff', … message: "open IDE Reconcile panel" }`
  - UNPINNED: returns `{ mode: 'draft_propagation', … suggested_prompt: <assembled prompt> }`
- NEVER calls a writer (user is the backstop — Jin & Chen 2026 / Stengg 2025)

**`nodes.rs`** + **`graph.rs`** — `rollup_generation` added to `ContractNode` struct and all SELECT queries using `COALESCE(rollup_generation, 0)`.

## In-Place YAML Edit Regex Details

Final regexes used in `apply_rollup_inplace`:
```
r"(?m)^(rollup_hash:\s*).*$"       → rollup_hash: "<new_hash>"
r"(?m)^(rollup_generation:\s*).*$" → rollup_generation: <new_generation>
r"(?m)^(rollup_state:\s*).*$"      → rollup_state: "fresh"
```

Safety guarantees (documented in code):
1. YAML keys at document root cannot contain `\n`
2. Frontmatter is bounded by leading `---` and closing `\n---\n` (Phase 2 invariant)
3. Body section after closing fence cannot have a top-level `rollup_*` line at column 0 (Markdown body)

Test confirms: body bytes byte-identical pre/post; L0 sidecars byte-equal (no rollup fields → no changes).

## Staleness Annotation Header Format (Verbatim)

```
[This L2 is rollup-stale; cited children may have diverged: abc12345 (intent, examples); def67890 (role).]
```

Phase 9 mass-edit ranking will key off this format — do not change without updating the ranking logic.

## Phase 7 Drift Branch Invariant

ReconcilePanel's Phase 7 drift branch (the three "Update contract / Rewrite code / Acknowledge" buttons) is **byte-identical** to Phase 7's shipped version. The rollup-stale amber paths are sibling renders that fire only when `driftState !== 'drifted'`. PROPAGATION.md "no retroactive changes" mandate honored.

## v1 Limitations (Documented)

1. **`read_children_section_diffs`**: `section_text_at_last_generation` always null — no historical body snapshots. The `drifted` flag uses section_hash mismatch as proxy. v2 carry-over: `upstream_generation_snapshots` table per upstream generation.
2. **`DraftPropagationDiff`**: v1 ships clipboard-copy only (per CONTEXT.md "correct not polished"). v2 carry-over: dispatch directly via `run_agent` (08-04).
3. **Batch reconcile**: v1 is click-at-a-time. v2 carry-over: "Reconcile all amber in this dependency chain" action.
4. **Multi-machine rollup_generation coordination**: out of scope for v1 (single-machine only).

## UAT Script

Written at `.planning/phases/08-…/08-UAT.md` covering all five gates:
- Gate 1: Beat 1 schema-v3 round-trip (section_hashes populated, no parse error)
- Gate 2: Beat 2 agent loop streaming + receipt card + journal pipeline (IDE-spawned agent)
- Gate 3: PostToolUse journal under headless `-p`
- Gate 4: Cherrypick atomic two-file write
- Gate 5: Propagation cascade L4 → L3 → L2 → L1 click-at-a-time

**Critical mechanic documented in Gate 5:** Cascade requires `Edit manually` at each level (not `Accept as-is`) because only `Edit manually` writes a new body → recomputes `section_hashes` → triggers upstream rollup recompute.

## propose_rollup_reconciliation MCP Integration

Registered in `mcp-sidecar/src/index.ts` alongside existing tools. MCP sidecar rebuilt successfully (293 modules, ~142ms compile). Tool surfaces as `propose_rollup_reconciliation` in `/mcp` listing.

Manual UAT (via claude Code session) deferred to 08-UAT.md Gate 5 dry run — the tool is implemented and registered; functional verification is the checkpoint gate.

## Deviations from Plan

### Auto-fixed Issues

**[Rule 2 - Missing Critical Functionality] Added list_journal_entries_raw to journal.rs**
- **Found during:** Task 1 implementation of draft_propagation_diff
- **Issue:** draft_propagation_diff needed to fetch journal entries from Rust without going through Tauri command overhead
- **Fix:** Extracted the journal read logic as a public `list_journal_entries_raw` async fn that the reconcile module calls directly
- **Files modified:** `contract-ide/src-tauri/src/commands/journal.rs`
- **Commit:** 2d25d9e (included in Task 1)

**[Rule 2 - Missing Critical Functionality] Added rollup_generation to ContractNode**
- **Found during:** Task 2 ReconcilePanel implementation — needed to pass expected_generation to accept_rollup_as_is
- **Issue:** ContractNode didn't expose rollup_generation; the panel would need an extra IPC call to get it
- **Fix:** Added rollup_generation u64 field to ContractNode (Rust struct + TypeScript type + all SELECT queries with COALESCE)
- **Files modified:** nodes.rs, graph.rs, types.ts
- **Commit:** a0784e7 (included in Task 2)

### No Retroactive Changes

Phase 7's ReconcilePanel drift branch, DriftLocks, SourceWatcher, and all Phase 7 machinery: untouched. Phase 8 rollup branch is a pure addition.

## Self-Check: PASSED
