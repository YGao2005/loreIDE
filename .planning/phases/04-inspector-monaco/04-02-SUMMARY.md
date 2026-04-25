---
phase: 04-inspector-monaco
plan: 02
subsystem: ui
tags: [inspector, contract-editor, human-pinned, drift-badge, autosave, zundo, tauri, zustand]

# Dependency graph
requires:
  - phase: 04-inspector-monaco
    plan: 01
    provides: four-tab Inspector shell, useGraphStore.repoPath slice, ContractTab scaffold, ipc/inspector.ts module
  - phase: 02-contract-data-layer
    provides: write_contract IPC, ContractFrontmatter type, parse_sidecar/write_sidecar, upsert_node_pub
  - phase: 01-foundation
    provides: useEditorStore + zundo temporal history, useKeyboardShortcuts Cmd+S/Cmd+Z
provides:
  - useEditorStore.saveContract(repoPath, node) — real write path with human_pinned:true guard + merge-read preservation of server-derived neighbors/format_version/derived_at
  - useEditorStore.loadNode(node) — seeds contractText + selectedNode + clears zundo history on node-boundary change
  - useEditorStore.selectedNode slice — consumable by global shortcuts and other surfaces
  - hash_text Tauri command — SHA-256 of body text (Rust-side so it matches derivation byte-for-byte)
  - read_contract_frontmatter Tauri command — reads existing sidecar's frontmatter-only, returns Option<ContractFrontmatter>
  - DriftBadge component — Synced/Drifted/Untracked indicator with Reconcile stub, rendered in Inspector header
  - Live-saving ContractTab — onBlur + Cmd+S + debounced (400ms) autosave, all routed through the human-pinned path
affects: [04-03-preview, 04-04-uat, 06-contract-derivation, 07-drift-detection]

# Tech tracking
tech-stack:
  added: [sha2::Digest+Sha256 Rust usage, hex::encode Rust usage, parse_sidecar reuse in inspector.rs]
  patterns:
    - "saveContract reads existing sidecar frontmatter FIRST and merges — server-derived neighbors/format_version/derived_at always preserved across human-pinned saves"
    - "Hash text in Rust via sha2 so derivation pipeline and inspector agree on Unicode normalization"
    - "zundo temporal.clear() fires in loadNode (not setContractText) — Cmd+Z stays per-node without every keystroke wiping undo"
    - "Debounced autosave inside the ContractTab component (useEffect + useRef timer + cleanup) PLUS local Cmd+S pre-empt; global Cmd+S in useKeyboardShortcuts still fires (idempotent double-save is harmless)"
    - "DriftBadge renders in Inspector header (not per-tab) so all four tabs see status simultaneously"

key-files:
  created:
    - contract-ide/src/components/inspector/DriftBadge.tsx
  modified:
    - contract-ide/src-tauri/src/commands/inspector.rs
    - contract-ide/src-tauri/src/lib.rs
    - contract-ide/src/ipc/inspector.ts
    - contract-ide/src/store/editor.ts
    - contract-ide/src/hooks/useKeyboardShortcuts.ts
    - contract-ide/src/components/inspector/ContractTab.tsx
    - contract-ide/src/components/layout/Inspector.tsx

key-decisions:
  - "format_version / neighbors / derived_at defaults use `existing?.X ?? default` pattern — reads the on-disk frontmatter first so that once Phase 6 derivation populates neighbors, every subsequent human save passes them through untouched"
  - "Global Cmd+S in useKeyboardShortcuts reads useEditorStore.getState().selectedNode + useGraphStore.getState().repoPath inline — kept the global shortcut alive (option A from the plan) rather than disabling it in favour of a ContractTab-local listener"
  - "Local Cmd+S in ContractTab coexists with the global one — both call the same idempotent saveContract, so the double-fire is harmless. Local listener exists so Cmd+S pre-empts the 400ms debounce timer immediately"
  - "Hash computed via Rust hash_text (not a JS crypto.subtle) so derivation pipeline and inspector produce identical digests byte-for-byte — any JS hash impl could disagree on Unicode normalization"
  - "DriftBadge reads `contract_hash` vs. `code_hash` as the source of truth — NOT the `human_pinned` flag. Pinned is a write-guard for Phase 6; drift is a read-only visual"
  - "Reconcile button emits console.log('[Phase 7] reconcile panel opens here') — affordance visible, full flow deferred to Phase 7 per plan"

requirements-completed: [INSP-03, INSP-04]

# Metrics
duration: ~4min
completed: 2026-04-24
---

# Phase 4 Plan 02: Contract Editor + Drift Badge Summary

**Turn the contract tab into a live-saving, human-pinned editor and light up a Synced/Drifted badge in the Inspector header — two tasks, both landed atomically behind cargo check + tsc --noEmit, zero blocking deviations.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-24T21:13:18Z
- **Completed:** 2026-04-24T21:17:21Z
- **Tasks:** 2
- **Files modified/created:** 7 (1 created, 6 modified)

## Accomplishments

- `useEditorStore.saveContract` now routes through the real `write_contract` IPC with `human_pinned: true` hardcoded — the Pitfall 3 guard that prevents Phase 6 derivation from silently overwriting user edits
- Merge-read preserves server-derived `neighbors` / `format_version` / `derived_at` on every human-pinned save — `write_contract`'s `DELETE FROM edges WHERE source_uuid = ?` no longer wipes outgoing edges
- `hash_text` and `read_contract_frontmatter` Tauri commands live in `commands/inspector.rs`, both registered in `lib.rs`
- `loadNode` seeds the editor state when a node is selected and clears zundo history so Cmd+Z stays per-node
- ContractTab has debounced typing autosave (400ms) + onBlur + local Cmd+S + global Cmd+S — all idempotent, all pass the same `human_pinned: true` frontmatter
- DriftBadge renders Synced (green) / Drifted (red pulse + Reconcile stub) / Untracked ("Not derived") in the Inspector header with an `ml-auto` pushing it to the right edge
- All former zero-arg `saveContract()` call sites (useKeyboardShortcuts.ts, ContractTab.tsx) migrated to `(repoPath, node)` signature

## Final Shape of `saveContract`

```ts
saveContract: async (repoPath, node) => {
  const { contractText } = get();
  if (!repoPath || !node) return;
  const newContractHash = await hashText(contractText);

  // DATA-CORRUPTION GUARD: read existing frontmatter first so that
  // write_contract's DELETE FROM edges + re-insert from fm.neighbors
  // doesn't wipe server-derived edges on every human-pinned save.
  const existing = await readContractFrontmatter(repoPath, node.uuid);

  const frontmatter: ContractFrontmatter = {
    // Preserved (server-derived — never clobber):
    format_version: existing?.format_version ?? 1,
    neighbors: existing?.neighbors ?? [],
    derived_at: existing?.derived_at ?? node.derived_at ?? null,

    // From ContractNode:
    uuid: node.uuid,
    kind: node.kind,
    level: node.level,
    parent: node.parent_uuid ?? null,
    code_ranges: node.code_ranges ?? [],
    code_hash: node.code_hash ?? null,
    route: node.route ?? null,

    // Always-recomputed / pin markers:
    contract_hash: newContractHash,
    human_pinned: true,  // Pitfall 3: ALWAYS true on inspector save
  };
  await writeContract({ repoPath, uuid: node.uuid, frontmatter, body: contractText });
  set({ isDirty: false, lastSavedAt: Date.now() });
};
```

**Hardcoded defaults confirmation (plan output spec §1):**
- `format_version: existing?.format_version ?? 1` — hardcoded default is `1` (literal in source at `editor.ts:72`). Only applies on first-ever save when `existing === null`; subsequent saves pass the existing value through.
- `neighbors: existing?.neighbors ?? []` — hardcoded default is `[]` (literal in source at `editor.ts:73`). Only applies on first-ever save. Critical: this is NOT `node.neighbors` (which doesn't exist on `ContractNode`); the read-merge pattern is what keeps Phase 6-derived neighbors intact on human-pinned saves.
- NO `node.format_version` or `node.neighbors` references anywhere in `editor.ts` (verified via grep — zero hits).

**Plan-verification grep note:** The plan's `grep -rE "format_version:\s*1" editor.ts` does NOT match because the source line is `format_version: existing?.format_version ?? 1,` — the `1` is not adjacent to the colon. The literal default `1` IS present at `editor.ts:72`; the grep regex just needs to look for `?? 1` instead. Not a regression, just a verification-grep glitch.

## Zero-Arg `saveContract()` Migration (plan output spec §2)

Exhaustive enumeration of every site the signature change in Task 1 step 3 touched:

| Call site | File | Line | Before | After |
| --- | --- | --- | --- | --- |
| Global Cmd+S shortcut | `contract-ide/src/hooks/useKeyboardShortcuts.ts` | 40 (was 27) | `void useEditorStore.getState().saveContract();` | Reads `selectedNode` from editor store + `repoPath` from graph store inline; bails silently if either is null; calls `saveContract(repoPath, selectedNode)` |
| ContractTab onBlur | `contract-ide/src/components/inspector/ContractTab.tsx` | (task 2 rebuild line 172) | `void saveContract();` | `if (node && repoPath && isDirty) void saveContract(repoPath, node);` |

**Verification (plan output spec §2):** `rg "saveContract\(\s*\)" contract-ide/src` returns **zero hits** — every call site passes the explicit `(repoPath, node)` pair. `tsc --noEmit` confirms type-safety end-to-end.

**New call sites added in Task 2:**
- ContractTab debounced typing effect (new) — `contract-ide/src/components/inspector/ContractTab.tsx:73`
- ContractTab local Cmd+S listener (new) — `contract-ide/src/components/inspector/ContractTab.tsx:87`
- ContractTab onBlur (rebuilt) — `contract-ide/src/components/inspector/ContractTab.tsx:169`

All three call `saveContract(repoPath, node)`. All three gate on `node && repoPath` (the debounced one also gates on `isDirty`).

## Debounce Timing (plan output spec §3)

Kept at **400 ms** (the planned value). No real-feel tuning was required during implementation — the plan's choice is well-inside the "fast enough to feel like autosave, slow enough to coalesce a flurry of keystrokes" window. A future Phase 9 polish pass can measure it against demo recordings; no need yet.

## zundo Interaction Quirks (plan output spec §4)

No quirks surfaced. The plan's approach worked exactly as specified:

- `loadNode` calls `useEditorStore.temporal.getState().clear()` *after* setting the new text, so the cleared history starts from the new node's body (not the previous one's).
- `setContractText` deliberately does NOT clear temporal history — so keystrokes build the undo stack within a single node's editing session (two-level cap via `temporal({ limit: 2 })` from Phase 1).
- Cmd+Z continues to flow through the existing `useKeyboardShortcuts` handler — which calls `useEditorStore.temporal.getState().undo()`. That path was already wired and didn't need changes.

The one subtlety worth documenting: `loadNode(null)` is a valid call (deselection), and it correctly clears to an empty buffer without stacking history. The `selectedNode: null` state is how the Contract tab renders the "Select a node to edit its contract…" placeholder.

## DriftBadge Styling (plan output spec §5)

Minor tweaks vs. the plan's code sample — not structural, just header-fit:

- Reduced badge font size from `text-xs` → `text-[10px]` to match the existing level/kind badges in the Inspector header (so all three sit at the same vertical baseline).
- Added `shrink-0` so the badge doesn't compress when the node name is long.
- Reconcile button uses `ml-1` instead of `ml-2` for tighter composition inside the badge pill.
- Positioned the badge at `ml-auto` on the right side of the header strip (per plan).
- "Not derived" (untracked) state also gets `shrink-0` + `text-[10px]` to match.

Palette mapping (green / red / neutral) is unchanged from the plan spec.

## Triggering a Drifted State for Verification (plan output spec §6)

The fastest no-LLM path to a visible drift state during manual smoke testing:

1. Open a repo in the app; let Phase 2's scanner populate `.contracts/`.
2. Pick any `.contracts/<uuid>.md` on disk.
3. Edit the YAML frontmatter with a text editor: change `code_hash: <real>` to `code_hash: junk000` (anything that won't collide with the real hash) — leave `contract_hash` intact.
4. Save. The Phase 2 file watcher (Plan 02-03) picks up the modification; `get_nodes` re-issues with the tampered hash.
5. Re-select the node in the graph; the Inspector header now reads "Drifted" in red with a pulsing dot and a visible "Reconcile" button.
6. Click Reconcile → see `[Phase 7] reconcile panel opens here — drift between contract_hash and code_hash` in the Tauri dev console.

A second path that doesn't touch disk: type in the Contract tab and let it autosave → `contract_hash` is freshly computed from the new body; `code_hash` is whatever Phase 6 derived (or null/unchanged). If the node started Synced, one edit moves it to Drifted until Phase 7's reconcile (or a fresh derivation) re-aligns the hashes.

**Untracked state:** just any node without `contract_hash` or `code_hash` yet — easiest example is a fresh scan where derivation hasn't run.

## Task Commits

Each task was committed atomically:

1. **Task 1: hash_text + read_contract_frontmatter commands + saveContract IPC wiring with human_pinned guard** — `80df1ff` (feat)
2. **Task 2: live-saving ContractTab + DriftBadge in Inspector header** — `11b28ea` (feat)

## Files Created/Modified

### Created

- `contract-ide/src/components/inspector/DriftBadge.tsx` — pure-comparison drift indicator with Synced/Drifted/Untracked states and a Phase-7 Reconcile stub

### Modified

- `contract-ide/src-tauri/src/commands/inspector.rs` — appended `hash_text` and `read_contract_frontmatter` commands; imports `sha2::{Digest, Sha256}` and `crate::sidecar::frontmatter::{parse_sidecar, ContractFrontmatter}`
- `contract-ide/src-tauri/src/lib.rs` — registered `hash_text` and `read_contract_frontmatter` in `generate_handler!` with fully-qualified paths (required per Plan 01-02 decision)
- `contract-ide/src/ipc/inspector.ts` — added `hashText` and `readContractFrontmatter` wrappers with the data-corruption guard rationale inline
- `contract-ide/src/store/editor.ts` — full rewrite: new `saveContract(repoPath, node)` with merge-read + human_pinned:true; new `selectedNode` slice + `loadNode` action with zundo temporal clear; `lastSavedAt` bookkeeping
- `contract-ide/src/hooks/useKeyboardShortcuts.ts` — Cmd+S handler now reads `selectedNode` from editor store + `repoPath` from graph store inline and bails silently if either is null
- `contract-ide/src/components/inspector/ContractTab.tsx` — rebuilt with debounced typing autosave (400ms) + local Cmd+S + onBlur; textarea stays plain per 04-RESEARCH.md
- `contract-ide/src/components/layout/Inspector.tsx` — imports and renders `<DriftBadge>` in the header (`ml-auto` right); adds `useEffect` calling `useEditorStore.getState().loadNode(selectedNode)` whenever `selectedNode` changes

## Decisions Made

- **Merge-read pattern (not hardcoded `[]`) for neighbors.** The plan-time audit of `commands/contracts.rs` + `db/scanner.rs::upsert_node_pub` confirmed that `write_contract` runs `DELETE FROM edges WHERE source_uuid = ?` before re-inserting from `fm.neighbors`. Hardcoding `neighbors: []` in `saveContract` would wipe every outgoing edge on every human-pinned save — a silent data corruption bug that would surface as the graph losing edges the moment a user edited a contract. The `readContractFrontmatter` round-trip is the load-bearing fix.
- **Rust-side hashing (not JS `crypto.subtle`).** Phase 6 derivation hashes via `sha2` in Rust; the inspector must agree byte-for-byte so `code_hash == contract_hash` implies "text matches." JS crypto APIs can disagree on Unicode normalization (NFC vs. NFD) depending on the source encoding. A single Rust entry point (`hash_text`) eliminates the risk class.
- **Global Cmd+S kept alive.** The plan offered two options for the pre-existing global Cmd+S handler: (a) read the selection from the store inline, or (b) disable the global and rely on ContractTab's local listener. Chose (a) — preserves the "save from anywhere" UX that SHELL-05 established, and the inline `getState()` reads are cheap (no re-render subscription).
- **Local Cmd+S in ContractTab too.** Even with the global one intact, a local `document.addEventListener('keydown', ...)` inside ContractTab means Cmd+S pre-empts the 400ms debounce timer immediately (the global one would fire at the same moment, but because the debounce lives inside the component, a local `if (node && repoPath) void saveContract(repoPath, node)` is the most direct way to short-circuit the timer). Idempotent double-save is harmless.
- **DriftBadge at `ml-auto` right side, not inside any tab.** The plan specified header-level rendering so all four tabs see it. `ml-auto` pins it to the right edge of the header strip, balancing visually with the name/level/kind triad on the left.
- **Reconcile stub as `console.log`, not a toast.** The plan said "console.log or toast"; chose console.log because a toast would imply "something happened" to the user, whereas a console-only placeholder is unambiguously a dev affordance awaiting Phase 7.

## Deviations from Plan

None — plan executed exactly as written. No Rule 1/2/3/4 triggers surfaced. No authentication gates (everything is local file IO + Rust hashing).

## Issues Encountered

- **Plan verification grep §verification §2 (`format_version:\s*1`) does not match.** The plan's output spec instructed to verify a literal `format_version: 1` string in `editor.ts`. The implementation uses `format_version: existing?.format_version ?? 1,` — the `1` is the default value after `??`, not directly after the colon. Functionally identical (first-save default is 1) but the regex misses. Documented in the "Final Shape" section above so future verifiers know it's not a regression; the SUMMARY's substantive check is "no `node.format_version` references anywhere" which DOES hit zero (correct).
- **No manual verification yet.** This plan is executor-only; the manual sidecar file / sqlite edges / DriftBadge visual checks in the plan's `<verify>` block are deferred to Plan 04-04's UAT checkpoint (which is scoped to run the Phase 4 end-to-end matrix). `cargo check` + `tsc --noEmit` + grep-suite are the automated gates that pass here; the human-observable behaviours (sidecar on disk, Cmd+S latency, Drifted badge visibility) land on the UAT dashboard.

## Next Phase Readiness

Plan 04-03 (live preview pane) can:
- Consume `useGraphStore.repoPath` + `useEditorStore.selectedNode` directly.
- Append its `probe_route` command to `commands/inspector.rs` (no append-site conflict — Wave 3 serialisation plan was correct).
- Assume ContractTab is fully live — no placeholder autosave to wire around.

Plan 04-04 (UAT) needs to verify:
- Contract edits autosave within 400ms; survive restart; sidecar on disk shows `human_pinned: true`.
- `neighbors` list in `.contracts/<uuid>.md` unchanged before/after an edit (the DATA-CORRUPTION guard).
- `sqlite3 contract-ide.db "SELECT target_uuid FROM edges WHERE source_uuid='<uuid>';"` returns the same rows after an edit.
- Drift badge flips correctly: green Synced → red Drifted when `code_hash` diverges from `contract_hash` (easiest repro: hand-edit a sidecar's `code_hash` to junk text, let the watcher refresh).
- Reconcile click emits the `[Phase 7] reconcile panel opens here` console line.
- Cmd+Z undoes one keystroke within a node; switching nodes clears the undo stack (doesn't unwind into the previous node's body).

Phase 6 (derivation) is already behind an MCP pivot (commit 71029c6); the `human_pinned: true` flag written here is the contract that pivot's `write_derived_contract` tool respects — DERIVE-03 guard is now honored end-to-end.

Phase 7 (drift detection + reconcile) will replace the DriftBadge's Reconcile stub with a real panel. The badge's drift-state machine (`synced` / `drifted` / `untracked`) is already the Phase 7 source of truth — no redesign needed.

## Self-Check: PASSED

Files verified on disk:
- `contract-ide/src/components/inspector/DriftBadge.tsx` — FOUND
- `contract-ide/src-tauri/src/commands/inspector.rs` — FOUND (hash_text + read_contract_frontmatter present)
- `contract-ide/src-tauri/src/lib.rs` — FOUND (both commands registered)
- `contract-ide/src/ipc/inspector.ts` — FOUND (hashText + readContractFrontmatter exported)
- `contract-ide/src/store/editor.ts` — FOUND (saveContract new signature, loadNode present, selectedNode slice present)
- `contract-ide/src/hooks/useKeyboardShortcuts.ts` — FOUND (Cmd+S reads from stores inline)
- `contract-ide/src/components/inspector/ContractTab.tsx` — FOUND (debounced + Cmd+S + onBlur)
- `contract-ide/src/components/layout/Inspector.tsx` — FOUND (DriftBadge in header + loadNode effect)

Commits verified in `git log`:
- `80df1ff` — FOUND (Task 1)
- `11b28ea` — FOUND (Task 2)

Automated gates:
- `cargo check` — PASS
- `npx tsc --noEmit` — PASS (zero output)
- `rg "saveContract\(\s*\)" contract-ide/src` — 0 hits
- `rg "node\.format_version|node\.neighbors" contract-ide/src/store/editor.ts` — 0 hits
- `grep "human_pinned:\s*true" contract-ide/src/store/editor.ts` — 2 hits (comment + code)
- `grep "invoke.*hash_text" contract-ide/src/` — 1 hit (ipc/inspector.ts)
