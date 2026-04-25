# Phase 8: Agent Loop + Receipts + PostToolUse Hook + Cherrypick + Cross-Level Propagation - Context

**Gathered:** 2026-04-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 8 ships the substrate of Beat 1 of the live demo (per `.planning/demo/presentation-script.md`) plus the full propagation stack required for the contract-substrate IDE primitive. Two distinct workloads, both in scope, but with different polish bars:

**Demo-load-bearing (must look right on camera):**
- `format_version: 3` schema + canonical Rust section parser (PROP-01) — Beat 1 contract editor takes `## Intent` / `## Role` / `## Examples` form
- `claude` CLI runner + agent loop (AGENT-01..04) — Beat 2 recording's left-pane execution stream
- Receipts with delta banner — Beat 2's on-screen comparison banner; format must match the script verbatim
- PostToolUse hook with per-session journal (PROP-03, MCP-02) — invisible on stage, but feeds Phase 10 distiller → Beat 4 harvest-back animation

**Functional bar (correct, not demo-polished):**
- Cherrypick flow (CHRY-01..03) — never on camera (Beat 1 cuts at `Sent to agent`; Beat 2 shows file writes; Beat 3 opens on merged state). Build it to work atomically and ship the orientation header — but don't burn polish budget on motion design or empty/error states beyond functional.
- Rollup detection + tri-state visuals (PROP-02) + pin-aware reconcile panel + `propose_rollup_reconciliation` / `accept_rollup_as_is` (PROP-04) — none of this is in any beat. Build correctly per the spec; visual states should be distinguishable but don't need demo-grade animation polish. Cascade UX (L4→L3→L2→L1) must work, but is click-at-a-time and developer-facing.

</domain>

<decisions>
## Implementation Decisions

### Receipt card + delta banner

- **Banner format aligned to Beat 2 recording (absolute stacked, not percentage delta):**
  ```
  Contract IDE: ~N tokens · ~N tool calls · N/5 rules honored
  Bare Claude:  ~N tokens · ~N tool calls · 0/5 rules honored
  ```
  Two rows, monospace numerals, 28px+ for the numerals, slightly smaller for the labels. The original Phase 8 SC 4 spec (`−82% tokens −83% tool calls −85% wall time`) is a **second view** — used for in-IDE pinned-receipt comparisons (developer dogfood). Demo uses the absolute-stacked view.
- "Rules honored" row is a substrate-verifier output (Phase 12/13) but the receipt-card layout must reserve space for it from day one — don't ship a banner that needs re-layout when Phase 13 adds the rubric.
- Receipts persist per node in SQLite `receipts` table with `(node_uuid, session_id, ts, input_tokens, output_tokens, tool_calls, est_cost_usd, raw_jsonl_path)`. Receipt-history tab in inspector shows reverse-chrono list; click two to pin side-by-side.
- Defensive JSONL parser ships as an **isolated module with unit tests against a captured real session**, fixture-mock fallback prevents blank cards. (Already in roadmap planning notes — re-stating because it's load-bearing for SC 2.)

### Agent loop dispatch surfaces

- **Two dispatch paths, same runner:**
  1. Chat-panel entry (Phase 8's own surface, scoped to currently-zoomed node + neighbors) — developer dogfood path
  2. Phase 11's `Delegate to agent` Inspector button (composes prompt with substrate hits + lineage neighbors) — **the demo path**
- The runner module (`claude` CLI invocation, JSONL streaming, receipt assembly) must expose a clean Rust API that Phase 11 can call without re-implementation. Plan accordingly: the agent loop is a library + two thin UI surfaces, not a chat-panel-coupled feature.
- Beat 1 dispatches via the Delegate button (Phase 11) — Phase 8's chat panel UX gets shipped but doesn't need demo polish.

### Cherrypick flow

- Build to functional bar: side-by-side diff modal works, persistent orientation header (`NodeName — intent — N tool calls`) shows correctly, single-IPC atomic approve writes both sidecar and source file via temp+rename.
- **Skip demo-grade polish:** no need for entrance/exit animation choreography, no need for fancy empty/error states beyond functional placeholders. Modal can use shadcn Dialog defaults.
- Target-node ring glow (CHRY-01) ships, but visual treatment is Claude's discretion — pick something that reads as "this is the focus" without competing with red-pulse drift state.

### Cross-level propagation (PROP-01..04)

- **PROP-01 (schema v3 + section parser): demo-grade.** This is the contract format Beat 1 types into. Section parser must round-trip stable hashes for the two committed fixtures (`11111111-…` API L3, `22222222-…` UI L4). MCP sidecar calls Rust parser via IPC — no parallel TS implementation.
- **PROP-02 (rollup detection + amber/gray visuals): correct, not polished.** Reuse Phase 7's `DriftLocks` mutex map and `SourceWatcher` notify infrastructure. Add `compute_rollup_and_emit` engine fn alongside `compute_and_emit` (do NOT replace). Graph CVA variants extend with `rollup_stale` (amber) + `rollup_untracked` (gray), precedence red > amber > gray. Visual hue choice is Claude's discretion — pick something distinguishable from the red-pulse and from the substrate-state colors Phase 13 will add later (avoid orange — Phase 13 uses orange for `intent_drifted`).
- **PROP-03 (per-session intent journal): demo-load-bearing for Phase 10.** Schema is locked per roadmap planning notes: `{schema_version, ts, session_id, tool, file, affected_uuids, intent}`. Append-only, tolerant of unknown fields, per-session files (one JSONL per `session_id`). Hook calls `update_contract` after journal write; pinned nodes return `SKIPPED-PINNED` and the hook records the intent regardless.
- **PROP-04 (pin-aware reconcile + MCP tools): correct, not polished.** Pin-aware branching fires before any writer is called — `SKIPPED-PINNED` must be unreachable from both UI paths. `propose_rollup_reconciliation` respects pin-aware branching. `accept_rollup_as_is` is a narrow IPC that updates only `rollup_hash`, `rollup_generation`, `rollup_state` — never round-trips the body through YAML. Microcopy for the six action buttons is Claude's discretion; lean on existing shadcn Dialog patterns.

### PostToolUse hook + watcher coexistence

- Hook and Phase 7 watcher serialize via the same `DriftLocks` per-UUID Tokio mutex — no race on `nodes.code_hash`.
- Hook script reads `$CLAUDE_TRANSCRIPT_PATH`, extracts `intent` from the latest user prompt; falls back to a thin tool_use summary for headless `-p` invocations (e.g., distiller calls in Phase 11).
- Journal write happens **before** `update_contract` call. Even if `update_contract` returns `SKIPPED-PINNED`, the journal entry is preserved — the intent record is useful regardless of the write outcome.

### Concurrency

- `rollup_generation` is the cross-node concurrency primitive. Reconcile panels read generation at open; canonical writer rejects writes whose generation has advanced; second-to-commit re-reads and retries. No silent last-writer-wins.

### Claude's Discretion

- Visual treatment of amber pulse (specific hue, animation timing, intensity relative to red-pulse)
- Ring-glow visual on target node (color, animation curve, persistence behavior beyond "appears on selection, persists through agent run")
- Cherrypick modal exact layout — header position, diff pane proportions, scroll behavior, collapse/expand of unchanged sections
- Reconcile panel microcopy for the six action variants (three pinned + three unpinned)
- Chat panel UX during agent run — streaming pane position, interrupt affordance design, scoped-context visual cue
- Receipt-history tab interaction — pinning UX, ordering, filtering
- Empty/loading/error states for receipt card, reconcile panel, cherrypick modal beyond functional placeholders
- Cascade UX for the dev-facing L4→L3→L2→L1 click-at-a-time path — whether the graph auto-pans to the next amber node, etc.

</decisions>

<specifics>
## Specific Ideas

- **Beat 2 receipt banner is the format spec.** The exact line `Contract IDE: ~1,400 tokens · ~3 tool calls · 5/5 rules honored` (and bare-Claude counterpart `~7,200 tokens · ~22 tool calls · 0/5 rules honored`) is locked per `presentation-script.md` § Beat 2. Reproduce that line shape verbatim — same separator (`·`), same approximate-tilde, same "rules honored" phrasing.
- **Beat 1 contract body shape is the schema-v3 acceptance test.** PM types `## Intent` (multi-paragraph), `## Role` (single paragraph), `## Examples` (multiple `GIVEN/WHEN/THEN` blocks). The section parser must accept this exact form and produce stable `section_hashes` regardless of section order. Use the script's literal Beat 1 body as a fixture in the parser test suite — if it doesn't round-trip, the demo doesn't run.
- **Reuse Phase 7's shipped machinery, don't replace.** `DriftLocks`, `SourceWatcher`, the `drifted` CVA variant, and the `ReconcilePanel` Dialog shell all exist. Extend them. Per `PROPAGATION.md#phase-7-drift-detection-watcher-path-no-retroactive-changes`.
- **The `## Examples` section is load-bearing under token pressure** (PACT 2025 per `.planning/research/contract-form/RESEARCH.md`). Prompt assembly should treat it as the last-to-drop section. Phase 9 mass-edit ranking and Phase 11 retrieval reuse this signal — keep section weighting consistent across all readers.

</specifics>

<deferred>
## Deferred Ideas

- **Side-by-side delta-percentage receipt comparison view** (`−82% tokens` etc.) — ships in Phase 8 as a secondary view on the receipt-history tab; not on camera in the demo. Don't burn polish budget here; functional is fine.
- **Cherrypick demo polish** — entrance/exit animations, fancy empty states, motion design. v2 if/when cherrypick lands in a future demo beat.
- **Cascade reconciliation batch action** ("Reconcile all amber in this dependency chain") — explicitly v2 per roadmap planning notes. v1 is click-at-a-time.
- **Real multi-machine `rollup_generation` coordination across replicas** — out of scope; v1 is single-machine. Beat 3's Sync is mocked per Phase 13.

</deferred>

---

*Phase: 08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation*
*Context gathered: 2026-04-24*
