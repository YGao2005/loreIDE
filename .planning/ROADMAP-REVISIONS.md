# Roadmap Revisions — v2 Harvest-First Substrate

**Status:** Proposal, partially decided. Demo timing resolved 2026-04-24 — **Option B (v1 + Phase 10 + slice of Phase 11 for demo)**. Remaining items still need approval before editing `ROADMAP.md` / `PROJECT.md` / `REQUIREMENTS.md`.

**Input:** `.planning/VISION.md` (the v2 thesis) and `.planning/research/constraint-distillation/` (the validated kernel experiment).

## Summary

- **v1 (Phases 1–9)**: unchanged except for two forward-compatibility notes.
- **v2 (Phases 10–13)**: new milestone, four phases, harvest-first substrate.
- **Demo timing**: user decision required — ship v1 for the demo (low risk) or stretch Phase 10 into the demo (high-risk, strong story).
- **Documents to update if approved**: `PROJECT.md` (point "Long-term vision" at v2), `ROADMAP.md` (append Phases 10–13 or create a new v2 roadmap section), `REQUIREMENTS.md` (add substrate-specific requirement IDs).

## v1 changes (minimal)

Only two edits, both forward-compat:

**Phase 8 Plan 08-03 (PostToolUse hook + journal)**: journal schema stays as currently specified (`schema_version: 1`, fields `{ts, session_id, tool, file, affected_uuids, intent}`), but add a note:

> The per-session journal files are the kernel of the v2 distiller pipeline. v2 Phase 10 will read these JSONL files directly. Keep the schema append-only and tolerant of unknown fields (already specified). Do not rename fields in v2; add new ones as nullable.

**Phase 9 mass-edit (SC 1)**: add a stretch note:

> Mass-edit match-ranking could be further strengthened in v2 by up-weighting nodes whose constraints (in the substrate) match the user's intent. Not in scope for v1 — but the retrieval shape (`find_constraints_for_goal(intent) → ranked nodes`) is already the right primitive. Defer to v2 Phase 11.

Nothing else in Phases 1–9 changes. No re-planning of existing work.

## v2 milestone — proposed phases

Four phases, executable strictly sequentially (each depends on the prior). Estimated 1–2 weeks total at hackathon velocity if v1 is fully landed.

### Phase 10: Session Watcher + Filter Pipeline

**Goal:** An ambient watcher ingests Claude Code JSONL sessions, filters to conversational content, and chunks into episodes ready for distillation.

**Depends on:** Phase 8 (journal schema stable).

**Scope:**
- Rust `SessionWatcher` extension of existing `SourceWatcher`, watching `~/.claude/projects/<cwd-key>/*.jsonl` (new writes only; backfill is opt-in per next phase)
- `jq`-style filter implemented in Rust (or shelled out) that extracts user-text + assistant-text only
- Episode boundary detection (tool-use/response pair = episode)
- SQLite schema additions: `sessions` table (session_id, project_key, started_at, last_ingested_episode)
- MCP tool `list_ingested_sessions()` for debugging / provenance display
- UI: status indicator in footer showing "watching N sessions, M episodes ingested"

**Success criteria:**
1. Starting a `claude` session in any watched project directory causes a row to appear in `sessions` within 2s of the first user message.
2. Filtering reduces a 1MB JSONL to <50KB conversational text with zero loss of user/assistant message content (regression-tested against the two kernel-experiment fixtures).
3. Episode chunking produces stable boundaries across re-ingestion of the same JSONL (idempotent).
4. Opt-in backfill command (`POST /ingest-backfill { session_ids: [...] }`) shows a per-session token-cost preview before running.

**What's unvalidated that this phase validates:** the watcher integration with Claude Code's session file lifecycle (race conditions around session-end, compaction, `/clear`).

---

### Phase 11: Distiller + Constraint Store

**Goal:** An LLM-backed distiller runs on every new episode, extracts typed nodes (Constraint, Decision, OpenQuestion, ResolvedQuestion, Attempt), and persists them with bitemporal validity. Retrieval is exposed as a new MCP tool.

**Depends on:** Phase 10.

**Scope:**
- Distiller sub-agent invoked per episode via `tauri-plugin-shell` → `claude -p`
- Pydantic-equivalent typed schemas (Rust side — `serde_json` structs) for all 5 node types, matching `.planning/research/constraint-distillation/schema.json`
- SQLite schema additions: `substrate_nodes` (type-tagged), `substrate_edges` (typed), with `valid_at`, `invalid_at`, `expired_at`, `created_at` columns (Graphiti bitemporal pattern)
- Provenance columns: `session_id`, `turn_ref`, `quote`, `actor`, `confidence` on every node
- MCP tools: `find_constraints_for_goal(goal, k=5)`, `find_decisions_about(topic, k=5)`, `open_questions(scope?)`
- Retrieval: semantic embedding match on `applies_when` field, re-ranked by LLM for top-K (Graphiti pattern; cheap bolt-on per prior-art survey)
- **Contract-anchored retrieval (the demo-load-bearing differentiation):** when the query subject is a contract atom (not a free-text goal), scope candidates by graph edges from the contract's lineage — parent surface, sibling atoms, ancestors up to L0 — *before* semantic match. Yields the rules that apply to *this work* rather than text-vague fuzzy hits. This is the answer to the judge question *"isn't this just RAG over chat?"* See `presentation-script.md` Beat 2 narration for the user-facing articulation.
- **`Delegate to agent` button on Inspector (demo-load-bearing):** UI affordance on the Contract tab. On click: composes the agent prompt as `{ contract body + retrieved substrate hits + parent-surface context + lineage-scoped neighbors }`, dispatches via MCP to a coding agent (Claude Code in v2; Devin via API as a future integration target). Replaces the current chat-panel-as-prompt-entry pattern for contract-driven work. The demo's PM-to-agent handoff (Beat 1 → Beat 2) is wired through this button.
- UI: new "Substrate" tab in Inspector for Contract nodes, showing derived constraints/decisions for that area

**Success criteria:**
1. A completed session produces ≥5 extracted substrate nodes with correct types and full provenance.
2. `find_constraints_for_goal("add loading state to async button")` returns the matching constraint within the top-3 results across a 50-constraint substrate.
3. Running the distiller on the two kernel-experiment sessions reproduces the 14 constraints in the fixture files (regression test against the hand-extracted set).
4. Claude Code session launched in a seeded repo auto-injects top-3 matching constraints into the prompt context (via MCP tool call during session init) — measured by appearance in the session JSONL.
5. Receipt card on a Contract IDE session vs. a bare Claude Code session (same goal, same repo) shows a measurable delta: fewer tool calls before first edit, fewer input tokens.

**What's unvalidated that this phase validates:** distiller quality at scale, retrieval precision at 50+ constraints, cost/latency of per-episode distillation.

---

### Phase 12: Conflict / Supersession Engine

**Goal:** When the distiller ingests a new node that contradicts an existing one, the system invalidates the stale one rather than deleting it. Fact-level supersession (Graphiti-style) ships first; intent-level supersession (the moat) ships as a second layer on top of the L0–L4 propagation already built in Phase 8.

**Depends on:** Phase 11.

**Scope:**
- Invalidation prompt run on ingestion: for each new node, check for existing overlapping nodes via semantic match; if the LLM judges contradiction, set `invalid_at = new_node.valid_at` on the stale one, emit `supersedes` edge from new → stale
- Current-truth query filter: `WHERE invalid_at IS NULL`
- History query: `SELECT * FROM substrate_nodes WHERE type=? AND ... ORDER BY valid_at DESC` — shows the trail
- **Intent-level supersession layer** (the novel piece): when a L0 contract changes, enumerate all L4 decisions transitively rollup-linked to it; mark them `intent_drifted` (a new state alongside `fresh`/`stale`/`superseded`); flag for human review in the substrate UI
- Extends Phase 8's `rollup_state` machinery from contract-only to decision-node-aware
- UI: supersession indicator on substrate nodes; history viewer showing prior versions

**Success criteria:**
1. Ingesting two contradictory constraints (e.g., "use REST" followed two sessions later by "use gRPC") results in the first being invalidated, the second being current, and the history query returning both in order.
2. A L0 contract priority shift causes all transitively rollup-linked decision nodes to flip to `intent_drifted` within one ingestion cycle.
3. No existing v1 test regresses — contract drift detection, rollup detection, and reconcile panel all continue working.
4. Adversarial test: 5 synthetic contradictions with varying semantic distance. Invalidation prompt recall ≥ 80%, precision ≥ 85%.

**What's unvalidated that this phase validates:** intent-level supersession as a usable concept (not just a theoretical gap in prior art). This is the primary moat claim — if it doesn't land here, the product is "Graphiti + coding-specific schema," which is weaker but still viable.

---

### Phase 13: Substrate UI + Demo Polish

**Goal:** The substrate is a first-class UI surface: Cmd+P by intent, canvas color-coding, chat archaeology, PR-review intent-drift. v2 demo beats are reproducible.

**Depends on:** Phase 12.

**Scope:**
- Cmd+P semantic finder: replaces file-path fuzzy match with intent match against all node types (constraint, decision, contract, question)
- Canvas overlay: each node gets substrate-state coloring (fresh/stale/superseded/intent-drifted) above the existing code-drift coloring; precedence hierarchy documented
- Chat archaeology: "where was this decided?" click → opens source session at the turn, shows the quote inline
- PR-review mode: input a PR diff, the UI colors which nodes are affected and which are intent-drifted — even if the code passes tests
- Two new demo beats scripted + rehearsed:
  - **Constraint injection beat** — same goal, same repo, vanilla Claude Code vs. Contract IDE, side-by-side receipts
  - **Intent-drift beat** — a PR that "looks fine" but violates a recent L0 priority shift, flagged on review
- (Optional) third beat: **Chat archaeology** — reviewer asks "why gRPC here?", answered in 5 seconds with provenance
- **`Sync` affordance for two-laptop demo (demo-only)**: a button on the developer's view that visually triggers the canvas blast-radius animation against pre-loaded substrate state. *Mocked* — the receiving machine is preloaded with the partner's session output; the click animates already-cached changes. Real-time multi-machine substrate replication is deferred (v3 multi-user concern per `VISION.md`); v2 demo only needs the affordance to exist visually for the Beat 3 entry in `presentation-script.md`.

**Success criteria:**
1. Cmd+P search returns the right node type for all 10 ambient test queries across a seeded repo (>80% top-1 precision).
2. Canvas substrate overlay renders at 50+ fps on the 500-node stress graph.
3. Constraint-injection beat: measurable delta of ≥30% fewer tokens and ≥40% fewer tool-calls-before-first-edit on a baseline goal.
4. Intent-drift beat: curated PR flagged correctly; reviewer reads the explanation in ≤30 seconds on camera.
5. Demo is reproducible 3 times in a row before filming.

---

## Demo timing decision

**The user needs to pick one.** This is the single open question blocking v2 scoping.

### Option A — Conservative (v1 only in demo)

Ship Phases 1–9 as the demo. Mention v2 as the "next milestone" in the pitch. Lowest risk.

**Pros:**
- Ships what's already planned; no new risk
- v1 is already strong — three beats, receipts, propagation, cherrypick
- Plenty of time for Phase 8+9 polish

**Cons:**
- Misses the strongest v2 story (constraint injection) in the video
- Judges see the IDE, not the deeper memory thesis
- Enterprise-wedge framing ("convention-enforcement substrate") doesn't show up in the demo

### Option B — Ambitious (Phase 10 + partial 11 in demo)

Ship Phases 1–9 + Phase 10 + a scaled-down Phase 11 (distiller + constraint injection only — no supersession, no substrate UI yet) for the demo. Add the constraint-injection beat as the **fourth demo beat**.

**Pros:**
- Adds the strongest v2 story to the demo: measurable token/tool-call delta on a real task
- Shows the deeper thesis ("memory across sessions"), not just the IDE
- Enterprise wedge becomes concrete ("this is how you enforce team conventions")

**Cons:**
- Needs ~3–5 extra build days between Phase 9 completion and demo filming
- Distiller quality at scale is unvalidated — could underperform in front of camera
- Another thing to break during the demo

**My recommendation:** Option B if Phase 9 lands with 5+ days of slack before filming; Option A otherwise. Check velocity after Phase 8 lands.

## Concrete edits if approved

### `PROJECT.md`
- Update "Context" section: replace "Long-term vision is contracts as source of truth" with "Long-term vision is the harvest-first intent substrate — see `.planning/VISION.md`. v1 is the first milestone."
- Add pointer to `VISION.md` under "What This Is"

### `ROADMAP.md`
- Add a new section header "# Milestone 2: Harvest-First Substrate (v2)" after Phase 9
- Append Phases 10–13 with the outlines above (full phase-plan scaffolds come via `/gsd:new-milestone` + `/gsd:plan-phase` per phase as usual)

### `REQUIREMENTS.md`
- Add new requirement group `SUB-01..SUB-10` for substrate work
- Suggested IDs:
  - `SUB-01` Ambient session watcher
  - `SUB-02` Conversational-text filter (95%+ reduction)
  - `SUB-03` Typed-schema distiller
  - `SUB-04` Bitemporal substrate storage
  - `SUB-05` Semantic retrieval via `applies_when`
  - `SUB-06` Fact-level supersession
  - `SUB-07` Intent-level supersession (moat)
  - `SUB-08` Cmd+P by intent
  - `SUB-09` Canvas substrate overlay
  - `SUB-10` Constraint-injection demo beat

### New file: `.planning/research/substrate-architecture/` (to be populated)
- Folder for the full prior-art survey + architecture detail (Graphiti integration decision, intent-supersession specification, etc.)

---

*If approved, `/gsd:new-milestone` + `/gsd:plan-phase 10` are the next GSD commands.*
