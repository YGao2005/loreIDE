# Phase 11: Distiller + Constraint Store + Contract-Anchored Retrieval - Context

**Gathered:** 2026-04-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Turn ingested Claude Code sessions (Phase 10's chunked episodes) into a typed substrate — Constraint, Decision, OpenQuestion, ResolvedQuestion, Attempt — with bitemporal storage and full provenance. Expose **graph-anchored retrieval** that scopes by contract lineage *before* semantic match, then LLM-reranks. Ship the `Delegate to agent` Inspector button as the user-facing surface — the entire Beat 1 → Beat 2 transition runs through it.

**Phase 11 is the substrate engine that powers Beats 1, 2, and 4 directly and provides the data Phase 13 displays in Beat 3.** Drop it and the demo doesn't run.

**In scope:**
- Per-episode LLM distiller (5 typed node kinds)
- SQLite schema additions: `substrate_nodes` (type-tagged), `substrate_edges` (typed), bitemporal columns (`valid_at`, `invalid_at`, `expired_at`, `created_at`)
- Contract-anchored retrieval (graph-scope → semantic match → LLM rerank)
- Three typed MCP tools: `find_constraints_for_goal`, `find_decisions_about`, `open_questions`
- `Delegate to agent` Inspector button with **two-phase dispatch (plan → user approve → execute)**: composing overlay, planning-pass agent run, plan-review panel, Approve/Edit/Cancel actions, execute-pass agent run via MCP
- Receipt-card delta vs bare Claude Code (reproducibility gate)
- Implicit-decisions manifest with **prompt-instructed emission + fixture fallback** for the two danger-zone atoms; schema locked for Phase 13 verifier
- Read-only "Substrate" side panel from Inspector footer (lineage-scoped flat list)

**Out of scope (other phases):**
- Session watcher + filter pipeline → Phase 10
- Fact-level + intent-level supersession → Phase 12
- Cmd+P-by-intent, canvas substrate-state coloring, chat archaeology jump-to-turn, PR-review intent-drift verifier panel, mocked Sync button → Phase 13
- Auto-emission of `decisions.json` for arbitrary atoms → v2

</domain>

<decisions>
## Implementation Decisions

### `Delegate to agent` button — UX & states

- **Placement:** Inspector **footer** as primary CTA. Always visible regardless of which tab is active (Contract / Code / Preview / Receipts) — the button is contextual to the *node*, not the tab.
- **Two-phase agent dispatch (planning, then executing — gated by user approval):**
  - `idle` — label `Delegate to agent`
  - `composing` — overlay appears beneath the button; substrate hits stream in (5 rows, ~150ms stagger fade-in); copy: `"Composing prompt: contract body + N substrate hits + L<level> surface context…"`
  - `plan-review` — agent runs a **planning-only first pass** (no code edits) and returns a structured plan. Inline panel renders:
    - Target files to edit (e.g. `app/account/settings/page.tsx`, `lib/account/beginAccountDeletion.ts`, …)
    - Substrate rules being applied (cited by id, one line each)
    - Implicit decisions the agent will make (preview of `decisions.json` keys + chosen values)
    - User actions: `[Approve]` / `[Edit prompt]` / `[Cancel]`
  - `sent` — after Approve: pill `Sent to agent`; agent re-runs in execute mode and writes code + emits `decisions.json`
  - `executing` — button collapses to `Agent running… view in chat ↗` linking to Phase 8's chat panel
  - returns to `idle` after the agent run completes (signal sourced from Phase 8 agent-loop)
- **Composing overlay is the magic moment, not a flash.** Stream the 5 hits visibly (~1.5s on stage). Each row: rubric label + truncated `applies_when` (60 chars) + `[source]` token. Don't hide retrieval — the audience sees Phase 11 working.
- **Plan-review panel timing:** target ~3–5s for the plan to appear after composing finishes (one Claude planning call). NT approves on stage; recording cut to Beat 2 begins from `sent` state.
- **`Edit prompt` action:** opens the inline `[Preview prompt ▾]` expander pre-filled with the assembled prompt; user edits, clicks `Re-plan` to re-run the planning pass; loops until Approve.
- **`Cancel` action:** abandons the dispatch; returns to `idle`. No agent execution occurred (planning is read-only — no file writes).
- **Abort during execution** (post-Approve): delegated to Phase 8's chat-panel cancel. Phase 11 adds no separate abort UI for the executing state.
- **Click handler for `[source]` tokens:** stubbed in Phase 11 — fires a toast like `source: <session_id> turn <ref>`. Phase 13 wires it to the actual chat-archaeology jump.

> **Beat 1 script timing implication:** The plan-review gate adds ~5–8s between the composing overlay and the `Sent to agent` pill that cuts to Beat 2's recording. Current Beat 1 runs 35s (0:15–0:50); with the gate it lands closer to 40–43s. Acceptable within the 4-minute envelope but worth pre-walking on stage. Trade: the plan-review surface is itself a demo asset — audience sees the agent reasoning explicitly before execution, reinforcing "the agent never gets a vague request" narration.

### Retrieval algorithm

- **Compute order ≠ rhetorical order.** Script narrates "applies_when match → graph scope → LLM rerank" for clarity; algorithm runs **graph-scope FIRST** (cheap), then embedding similarity on `applies_when` within the scoped set, then LLM rerank top-N → top-5.
- **Lineage scope** = parent + all ancestors up to L0 + sibling atoms (same parent). **Exclude cousins.** This matches the script's framing ("the chain of contracts that govern this work").
- **Top-K:** hard-coded **5** in the Delegate overlay. MCP tools take a `limit` param, default 5.
- **Zero-hit fallback:** if scoped set is empty (e.g., L0 contract or sparse graph), fall back to global semantic match and badge the overlay as `"Broad search — no scoped hits"`. Demo never hits this; safety net for non-demo use.
- **LLM rerank:** ranker prompt over top-15 semantic candidates → outputs ranked top-5. One Claude call per Delegate dispatch via `claude -p` subprocess (Phase 6 MCP-pivot pattern; no API key needed).
- **Provenance traveling with each hit:** `{ rubric_label, applies_when, source: { session_id, turn_ref, quote }, confidence }` — used by overlay rows AND by Phase 13's chat-archaeology surface later.

### Distiller pipeline behavior

- **Live per-episode**, debounced — max 1 distill in flight per session. Episodes from Phase 10's chunker feed a queue. Latency target: 3–5s per episode.
- **Visibility:** extend Phase 10's footer status (`watching N sessions, M episodes`) → adds `K substrate nodes captured`. **One first-time toast** when the very first node lands across the whole product (delight moment). No per-episode toasts (would be noisy).
- **Confidence:** kernel-experiment schema shipped as-is — `explicit | inferred`. Both kept in store. UI distinguishes inferred (lighter color, italic) in any list view. **No human-review queue in v1** — too costly.
- **Failure handling:** dead-letter queue + footer warning `"1 episode failed to distill — retry"` with manual retry button. **No exponential auto-retry** (cost discipline).
- **Bitemporal columns ship in Phase 11** (`valid_at` required; `invalid_at`, `expired_at` nullable but present). Phase 12 *uses* them; schema is forward-compatible.
- **Backfill:** routes through the same distiller queue as live ingestion. Phase 10's cost-preview gate covers consent — Phase 11 reuses it.

### Substrate visibility in the IDE

- **Phase 11 ships a read-only "Substrate" link in Inspector footer** → opens a side panel with the contract's lineage-scoped substrate as a flat typed list. Each row: kind icon + rubric label + `applies_when` + `[source]` token.
- **Side panel is read-only.** No edit/add/delete in v1. Edits come implicitly via Phase 12 supersession (re-ingest invalidates).
- **Delegate overlay = primary substrate surface for v1.** Side panel = secondary investigation tool ("what does this node know about?").
- Phase 13 owns the rich surfaces: canvas substrate-state coloring, Cmd+P-by-intent, chat archaeology jump-to-turn, PR-review intent-drift, full Substrate Inspector tab.

### Implicit-decisions manifest (Phase 11 SC 7)

- **Prompt-instructed emission, fixture-backed fallback.** The Delegate execute-pass prompt includes an instruction block asking the agent to emit a `decisions.json` artifact alongside code edits. **For the two demo atoms** (`AccountSettings.DangerZone`, `TeamSettings.DangerZone`), if the agent's emission is missing or malformed, Phase 11 loads the hand-crafted fixture at `fixtures/decisions/<atom-uuid>.json`. Phase 13's verifier reads from storage; storage always populated (agent emission OR fixture). **No risk of empty implicit-decisions group on stage.**
- **Plan-review gate also previews decisions.json keys** (see Delegate state machine above) — surfaces the agent's intended implicit decisions *before* execution so the user can catch surprises early.
- **Schema (locked here so Phase 13 verifier can render against it):**
  ```json
  {
    "atom_uuid": "string",
    "decisions": [
      {
        "key": "string",                    // e.g. "email_link_expiry_hours"
        "chosen_value": "string",           // e.g. "24"
        "rationale": "string",              // 1-sentence why
        "substrate_citation_id": "string?"  // nullable: not every implicit decision has substrate backing
      }
    ]
  }
  ```
- 3 rows per atom for the demo: 24h email-link expiry, `audit_log` destination, async cleanup (per `CANVAS-PURPOSE.md`).
- **Fallback detection:** parse-fail or schema-validation-fail on the agent's emission triggers fixture load. Surface a small footer note in the verifier ("Loaded from fixture") for Phase 11 dev visibility; suppress the note for the two demo atoms.
- **Auto-emission for arbitrary atoms is v2** — production-grade prompt + 2-pass auditor. Phase 11 ships only the v1 prompt + the two demo fixtures.

### MCP surface + delegate target

- **Three typed MCP tools** per spec: `find_constraints_for_goal(intent, limit?)`, `find_decisions_about(subject, limit?)`, `open_questions(scope?, limit?)`. Discoverable to agents.
- **Internal `find_substrate(query, types?, limit?)` is private** — used by the Delegate composer; not exposed via MCP.
- **v1 dispatch target = Claude Code only** via `claude -p` subprocess (Phase 6 MCP-pivot pattern). Devin/Windsurf wiring stays narrative-only (Close beat: "MCP-native, plug them in").

### Claude's Discretion

- Exact distiller prompt wording (the kernel-experiment `extraction-prompt.md` is the starting point — adapt as needed; SC 3 regression test is the gate)
- Composing-overlay typography, exact stagger timing, fade easing
- LLM ranker prompt content and temperature
- Footer counter copy / icon choices
- Side panel layout (table vs cards), styling
- SQLite index strategy on `substrate_nodes` / `substrate_edges`
- Embedding provider choice (default to whatever Phase 9 mass-edit uses for FTS+embedding parity per Phase 9 stretch note)
- Error / loading / empty state visuals beyond the spec

</decisions>

<specifics>
## Specific Ideas

### Demo-script anchors (these are non-negotiable)

- Composing overlay copy from Beat 1: `"Composing prompt: contract body + 5 substrate hits + L2 surface context…"` — this exact line lands on stage
- Status pill copy: `"Sent to agent"`
- The 5 substrate hits in the Beat 2 recording are the canonical kernel: `dec-soft-delete-30day-grace-2026-02-18`, `con-anonymize-not-delete-tax-held-2026-03-04`, `con-stripe-customer-archive-2026-02-22`, `con-mailing-list-suppress-not-delete-2026-03-11`, `dec-confirm-via-email-link-2026-02-18` (full schemas in `.planning/demo/scenario-criteria.md` § 6)
- Receipt deltas Beat 2: `~1,400 tokens · ~3 tool calls · 5/5 rules honored` vs `~7,200 / ~22 / 0`. Beat 4: `~1,200 / ~2 / 5/5` vs `~6,800 / ~19 / 0`. Reproducibility bar = SC 6 ("3 times in a row")
- Beat 4 harvest-back captures **two new** substrate nodes during the workspace-delete run: `con-cascade-revoke-tokens-on-org-delete-2026-04-25`, `dec-owner-orphan-check-2026-04-25`. Distiller must produce these from the agent's own session JSONL — this is Phase 11's compounding claim made visible.

### New demo-script asset (added by this Phase 11 context)

- **Plan-review panel between composing and `Sent to agent`** — the planning-only first-pass output is a new on-stage artifact (rows: target files, substrate rules cited by id, implicit-decision preview). NT approves visibly before Beat 2 cuts to recording. Adds ~5–8s to Beat 1 timing; presentation script's "What's locked vs open" needs an update to capture the new beat structure.
- **Plan-review copy (proposed, refine in planning):** panel header `"Plan ready — review before dispatch"`; action buttons `[Approve]` / `[Edit prompt]` / `[Cancel]`. NT's narration during this gate (proposed): *"Plan first — five files, five rules, three implicit decisions. Approve."*

### Validated patterns (don't redesign these)

- **Schema** — kernel-experiment `schema.json` is the spine: `id`, `type`, `text`, `scope`, `applies_when`, `source: {kind, session_id, turn_ref, quote, actor}`, `confidence: explicit | inferred`, `valid_at`, `invalid_at`, `superseded_by`. Bitemporal extension for Phase 12 (`expired_at`, `created_at`) gets added in Phase 11's migration so the columns exist.
- **Filter** — Phase 10's `jq` filter (95% reduction, conversational text only) feeds Phase 11. Tool-use content not required (Claude narrates reasoning enough in conversational text — kernel finding #5).
- **Retrieval primitive** — `find_constraints_for_goal(intent) → ranked nodes` is the shape Phase 9 mass-edit will reuse for substrate-aware ranking (per Phase 9 planning notes stretch).
- **Bug-fix sessions are the highest-density distillation source** (kernel finding #3). The Phase 9 source-session script should bias toward incident-narrative threads.

### Demo gates Phase 11 must clear

1. SC 1 — A completed session produces ≥5 nodes with full provenance
2. SC 3 — Distiller reproduces all 14 kernel-experiment constraints from the two committed fixtures (regression test)
3. SC 4 — Graph-anchored retrieval (lineage scope before semantic match) — narrated in Beat 2
4. SC 5 — Delegate button dispatches a fully-composed prompt via MCP — Beat 1→2 transition
5. SC 5+ (extends SC 5) — **Two-phase dispatch (plan → approve → execute) works end-to-end**, with Approve / Edit prompt / Cancel actions all functional
6. SC 6 — Receipt-delta reproducible 3 times in a row — gates the Beat 2 recording session
7. SC 7 — Implicit-decisions manifest populates on Delegate against the two danger-zone atoms (agent emission OR fixture fallback — never blank)

</specifics>

<deferred>
## Deferred Ideas

- **Full Substrate Inspector tab** (rich per-area substrate browser) — Phase 13 polish or v2
- **Manual substrate edit / add / delete** — v2 (Phase 12 supersession handles "this got out of date" implicitly)
- **Production-grade `decisions.json` emission for arbitrary atoms** (full coverage, 2-pass auditor in `CANVAS-PURPOSE.md`) — v2. Phase 11 ships v1 prompt-instructed emission for the two demo atoms only, with fixture fallback. v2 hardens for arbitrary atoms.
- **Devin / Windsurf live MCP integrations** — v3 (Close-beat narrative, not v1 code)
- **Cousin-scoped retrieval** (children of ancestors) — only revisit if precision feels too narrow in practice
- **User-configurable top-K UI** — `limit` param exists on MCP tools; no UI knob until users ask
- **Human-review queue for low-confidence distillations** — too costly for v1
- **Exponential auto-retry on distiller failures** — discipline; manual retry only
- **Real-time multi-machine substrate replication** — v3 (per `VISION.md` Open Questions; Phase 13 mocks Sync)
- **Section-weighted substrate ranking via Phase 8's `section_hashes`** — Phase 9 mass-edit stretch; revisit during Phase 9 planning
- **`find_substrate` exposed publicly via MCP** — kept private in v1; promote only if agent UX demands it

</deferred>

---

*Phase: 11-distiller-constraint-store-contract-anchored-retrieval*
*Context gathered: 2026-04-24*
