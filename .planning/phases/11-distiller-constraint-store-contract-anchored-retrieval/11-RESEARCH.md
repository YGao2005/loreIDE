# Phase 11: Distiller + Constraint Store + Contract-Anchored Retrieval - Research

**Researched:** 2026-04-24
**Domain:** LLM-driven typed-substrate extraction, bitemporal SQLite storage, hybrid graph-anchored retrieval, MCP-dispatched two-phase agent delegation
**Confidence:** HIGH on stack/patterns/pitfalls; MEDIUM on `Delegate to agent` plan-pass affordance design (UI) and Beat 4 harvest-back timing tolerances; LOW on absolute SC 2 top-3 retrieval recall against the synthesized 50-constraint substrate (Phase 9 supplies that fixture; we extrapolate from kernel-experiment 4/4)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### `Delegate to agent` button — UX & states

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

#### Retrieval algorithm

- **Compute order ≠ rhetorical order.** Script narrates "applies_when match → graph scope → LLM rerank" for clarity; algorithm runs **graph-scope FIRST** (cheap), then embedding similarity on `applies_when` within the scoped set, then LLM rerank top-N → top-5.
- **Lineage scope** = parent + all ancestors up to L0 + sibling atoms (same parent). **Exclude cousins.** This matches the script's framing ("the chain of contracts that govern this work").
- **Top-K:** hard-coded **5** in the Delegate overlay. MCP tools take a `limit` param, default 5.
- **Zero-hit fallback:** if scoped set is empty (e.g., L0 contract or sparse graph), fall back to global semantic match and badge the overlay as `"Broad search — no scoped hits"`. Demo never hits this; safety net for non-demo use.
- **LLM rerank:** ranker prompt over top-15 semantic candidates → outputs ranked top-5. One Claude call per Delegate dispatch via `claude -p` subprocess (Phase 6 MCP-pivot pattern; no API key needed).
- **Provenance traveling with each hit:** `{ rubric_label, applies_when, source: { session_id, turn_ref, quote }, confidence }` — used by overlay rows AND by Phase 13's chat-archaeology surface later.

#### Distiller pipeline behavior

- **Live per-episode**, debounced — max 1 distill in flight per session. Episodes from Phase 10's chunker feed a queue. Latency target: 3–5s per episode.
- **Visibility:** extend Phase 10's footer status (`watching N sessions, M episodes`) → adds `K substrate nodes captured`. **One first-time toast** when the very first node lands across the whole product (delight moment). No per-episode toasts (would be noisy).
- **Confidence:** kernel-experiment schema shipped as-is — `explicit | inferred`. Both kept in store. UI distinguishes inferred (lighter color, italic) in any list view. **No human-review queue in v1** — too costly.
- **Failure handling:** dead-letter queue + footer warning `"1 episode failed to distill — retry"` with manual retry button. **No exponential auto-retry** (cost discipline).
- **Bitemporal columns ship in Phase 11** (`valid_at` required; `invalid_at`, `expired_at` nullable but present). Phase 12 *uses* them; schema is forward-compatible.
- **Backfill:** routes through the same distiller queue as live ingestion. Phase 10's cost-preview gate covers consent — Phase 11 reuses it.

#### Substrate visibility in the IDE

- **Phase 11 ships a read-only "Substrate" link in Inspector footer** → opens a side panel with the contract's lineage-scoped substrate as a flat typed list. Each row: kind icon + rubric label + `applies_when` + `[source]` token.
- **Side panel is read-only.** No edit/add/delete in v1. Edits come implicitly via Phase 12 supersession (re-ingest invalidates).
- **Delegate overlay = primary substrate surface for v1.** Side panel = secondary investigation tool ("what does this node know about?").
- Phase 13 owns the rich surfaces: canvas substrate-state coloring, Cmd+P-by-intent, chat archaeology jump-to-turn, PR-review intent-drift, full Substrate Inspector tab.

#### Implicit-decisions manifest (Phase 11 SC 7)

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

#### MCP surface + delegate target

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

### Deferred Ideas (OUT OF SCOPE)

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
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **SUB-03** | Distiller LLM extracts ≥5 typed nodes (Constraint, Decision, OpenQuestion, ResolvedQuestion, Attempt) per completed session with full provenance (`session_id`, `turn_ref`, `verbatim_quote`, `actor`, `confidence`); kernel-experiment fixtures reproduce 14 hand-extracted constraints (regression test) | Pattern 1 (Distiller pipeline) + Pattern 2 (typed extraction prompt + Anthropic structured output via `--json-schema`) + kernel-experiment fixtures (already 14/14 validated 2026-04-24) |
| **SUB-04** | Contract-anchored retrieval returns top-3 within ranking on 50-constraint substrate; `find_constraints_for_goal` scopes by graph edges from contract lineage BEFORE semantic match; LLM rerank uses contract body as grounding | Pattern 3 (3-stage retrieval: graph-scope → embedding-similarity → LLM rerank) + Pattern 4 (lineage scope SQL with recursive CTE) + Verified RRF k=60 industry pattern |
| **SUB-05** | `Delegate to agent` Inspector button composes prompt with retrieved substrate hits + parent-surface context + lineage-scoped neighbors; dispatches via MCP to coding agent; replaces chat-panel-as-prompt-entry for contract-driven work | Pattern 5 (Delegate state machine: idle → composing → plan-review → sent → executing) + Pattern 6 (two-pass `claude -p` with `--append-system-prompt` for plan-only first pass) + reuses Phase 8's `run_agent` Rust runner |
| **SUB-10** | Constraint-injection demo beat measures Contract IDE vs bare Claude on Beat 2 prompt — Contract IDE retrieves all 5 substrate rules, writes a 5-file change first try; bare Claude defaults to `db.user.delete()` and 0/5 rules; receipt comparison shows favorable token + tool-call delta | Pattern 7 (Receipt-card delta methodology: same Phase 8 receipt parser; bare-Claude baseline produced by Phase 9 SC 5; SC 6's "3 reproductions" measured via Phase 8 wall_time_ms + tool_call_count v1 columns) |
</phase_requirements>

---

## Summary

Phase 11 is the substrate engine that powers the demo. It turns Phase 10's chunked episodes into a typed bitemporal substrate (`substrate_nodes` / `substrate_edges` with Graphiti `valid_at`/`invalid_at`/`expired_at`/`created_at` columns), exposes graph-anchored retrieval (lineage scope → embedding similarity on `applies_when` → LLM rerank), and ships the `Delegate to agent` Inspector button with two-phase planning gate. The kernel experiment at `.planning/research/constraint-distillation/` already validated end-to-end: extraction prompt produces 14 constraints from two real session JSONLs, retrieval scores 4/4 on synthetic goals, and the schema (`schema.json`) is the spine for Phase 11's typed-node output. Phase 11 is therefore **codifying validated work**, not inventing.

The implementation has four loosely-coupled pillars: (1) **distiller pipeline** — episode queue → `claude -p --output-format json --json-schema` → typed-node JSON → upsert with provenance; (2) **bitemporal store** — new SQLite tables `substrate_nodes` (5 typed kinds) + `substrate_edges` + Graphiti columns + a `substrate_nodes_fts` virtual table + a `substrate_embeddings` table (sqlite-vec optional, with a stable cosine fallback); (3) **graph-anchored retrieval** — lineage walker (parent + ancestors-up-to-L0 + siblings, exclude cousins) → semantic candidate selection (FTS5 keyword + embedding cosine) → LLM rerank top-15→5 via `claude -p`; (4) **`Delegate to agent` button** — state machine (idle → composing → plan-review → sent → executing → idle), planning-only first pass via `--append-system-prompt` injection, then execute-pass that emits `decisions.json` alongside code, all dispatched via Phase 8's existing `run_agent` Rust runner.

Two pieces are demo-load-bearing and must NOT be cut: (a) the **plan-review gate** inserts a new ~5–8s beat between composing and Beat 2's recording cut — UI must render target files + substrate rules cited + implicit-decisions preview within 3–5s of composing finishing; (b) the **implicit-decisions manifest** for the two danger-zone atoms must NEVER show empty in Beat 3 — agent prompt-instructed emission with fixture fallback at `fixtures/decisions/<atom-uuid>.json` ensures storage is always populated. The receipt-delta methodology (SC 6 + SUB-10) reuses Phase 8's `tool_call_count` and `input_tokens` columns directly; the "3 reproductions" requirement is gated against Phase 9's bare-Claude baselines (DEMO-03), not freshly measured per beat.

**Primary recommendation:** ship the distiller pipeline + bitemporal store + retrieval primitive in plans 11-01 / 11-02 / 11-03; ship the `Delegate to agent` button + plan-review panel + implicit-decisions manifest in plans 11-04 / 11-05; gate the demo on SC 3 (kernel regression: 14/14 constraints reproduce) and SC 7 (decisions.json populated for both atoms). Reuse Phase 8's `run_agent` runner, Phase 7's `DriftLocks` mutex pattern, Phase 1's FTS5 virtual table pattern, and Phase 6's MCP-pivot `claude -p` subprocess pattern. **Do not introduce sqlite-vec as a hard dependency** — embeddings via `sqlite-vec` are a stretch; the v1 path uses Float32-blob columns + manual cosine in TypeScript inside the MCP sidecar (sub-50ms at 50-constraint scale, validated by the kernel experiment's 4/4 retrieval test). This keeps the build pipeline (esbuild + @yao-pkg/pkg) untouched.

---

## Standard Stack

### Core (Locked — Already Shipped or Strict Constraint)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `tauri-plugin-shell` | 2 (existing) | Spawn `claude -p` subprocess for distiller + LLM rerank + Delegate execute-pass — no `ANTHROPIC_API_KEY` (subscription auth) | Phase 6 derivation pivot pattern; Phase 8 agent runner; Phase 12 supersession judge — all already use this. **Locked.** |
| `claude` CLI | system-installed | Distiller LLM (Haiku-4-5 for typed extraction; Sonnet-4-6 for rerank); planning-pass first; execute-pass second | Anthropic Cookbook recommends Haiku for high-volume schema-constrained extraction, Sonnet for nuance — fits our distiller (high volume) + rerank (nuanced) split. Verified pattern. |
| `serde_json` | 1 (existing) | Parse distiller JSON output, parse `decisions.json`, parse Claude session JSONL emitted from execute-pass | Already used throughout codebase. **Locked.** |
| `sqlx` | 0.8 (existing — direct dep since Phase 2) | Direct queries against new `substrate_nodes` / `substrate_edges` tables | Already direct dep; reuse pattern from `commands/nodes.rs` and `db/scanner.rs`. **Locked.** |
| `chrono` | 0.4 (existing) | RFC3339 ISO-8601 timestamps for `valid_at`, `created_at` (UTC enforced) | Already shipped (Phase 7); avoid timezone-naive comparisons (Graphiti issue #893 footgun). **Locked.** |
| `sha2` | 0.11 (existing) | Stable substrate-node IDs derived from `(session_id, episode_id, text-hash)` for idempotency | Already used by Phase 6 for `code_hash` / `contract_hash`. **Locked.** |
| `dashmap` + `tokio::sync::Mutex` | 6 / 1 (existing) | Per-session distill-in-flight guard (mirror Phase 7's `DriftLocks` pattern verbatim) | Same pattern as Phase 7 + Phase 10. **Locked.** |
| `tauri-plugin-sql` (FTS5) | 2 (existing) | `substrate_nodes_fts` virtual table for keyword candidate selection | Already shipped (Phase 1 DATA-06 created `nodes_fts`); same pattern. **Locked.** |
| `@modelcontextprotocol/sdk` | ^1.29.0 (existing) | Three new MCP tools (`find_constraints_for_goal`, `find_decisions_about`, `open_questions`) plus internal `find_substrate` | Already direct dep in `mcp-sidecar/`. **Locked.** |
| `better-sqlite3` | (transitive in mcp-sidecar) | Read-only access to substrate tables from MCP sidecar | Already pattern from Phase 5; `find_by_intent` shows the FTS5 query shape verbatim. **Locked.** |
| Phase 8 `run_agent` Rust runner | (Phase 8 — landing) | `Delegate to agent` invokes Phase 8's already-shipped `run_agent(prompt, scope_uuid)` Tauri command — Phase 11 does NOT re-implement spawn/streaming/receipt-parsing | Phase 8 plan 04a explicitly carved `run_agent` as "a clean Rust API that Phase 11's Delegate button can call without re-implementation." **Reuse mandatory.** |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | ^3.23.0 (existing in mcp-sidecar) | Validate distiller JSON output + `decisions.json` shape before persisting | Catch malformed LLM output at the boundary; routes to dead-letter queue on schema failure |
| Phase 10 `episodes` + `sessions` tables | (Phase 10 — landing) | Source of episode `filtered_text` + `start_line` (turn_ref source) + provenance to `session_id` | Distiller reads `episodes.filtered_text` + `episodes.start_line`; emits substrate nodes referencing `session_id` and `turn_ref` (line index) — Phase 13 chat-archaeology uses these to jump back |
| Phase 8 `journal/<session-id>.jsonl` files | (Phase 8 — landing, PROP-03) | Beat 4 harvest-back: distiller runs on the agent's OWN session JSONL (Pass 2 fresh-agent rederive emits a session JSONL just like Beat 1's PM-trigger session) — captures `con-cascade-revoke-tokens-on-org-delete-2026-04-25` + `dec-owner-orphan-check-2026-04-25` | Beat 4's "3 new substrate nodes animate in" demand depends on Phase 10 watcher seeing the just-finished agent session JSONL → Phase 11 distiller running on it within ~5s. **Validate end-to-end during Plan 11-04 UAT.** |
| Float32 BLOB columns (vanilla SQLite) | (no extension required) | Store embeddings inline in `substrate_nodes` (or sibling table); cosine computed in TS in the MCP sidecar | **Recommended over sqlite-vec for v1** — keeps esbuild + @yao-pkg/pkg pipeline untouched; sqlite-vec ABI mismatches with better-sqlite3 12.x are documented (Issue #65156 / #66977) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff | Recommendation |
|------------|-----------|----------|----------------|
| `Float32 BLOB columns` + TS-side cosine | `sqlite-vec` extension (vec0 virtual table) | Vec0 gives KNN + RRF SQL primitives but adds a precompiled `.dylib` to the build pipeline; Issue #65156 documents sqlite-vec failing silently with better-sqlite3 12.x ABI mismatch. At 50-constraint scale, in-memory cosine over 768-dim vectors is sub-1ms — extension overhead not justified. | **Use Float32 BLOB + TS-side cosine for v1.** Stretch goal: revisit sqlite-vec if substrate grows >5,000 nodes. |
| `claude -p --output-format json --json-schema` for distiller | Free-form `claude -p` + manual JSON parse | Anthropic's `--json-schema` flag (verified 2026-04 docs) validates output against a JSON Schema and exposes it in the `structured_output` field of the JSON response — no defensive parsing needed. Free-form requires regex/jq fallback. | **Use `--json-schema` for distiller; fall back to free-form parse only on schema rejection (dead-letter the episode).** |
| Synchronous distiller per episode | Async batch (multiple episodes per call) | Batching saves ~30% LLM cost at high volume but breaks per-episode provenance (which `session_id`/`turn_ref` does each output node belong to?). v1 ships ONE episode per call; v2 may batch. | **One-episode-per-call; debounced queue with max 1 distill in flight per session (CONTEXT lock).** |
| Embedding via `claude` CLI / Anthropic API | OpenAI `text-embedding-3-small` (1536-dim, $0.02/MTok) | Phase 9 mass-edit will produce embeddings somehow — Phase 11 should reuse whatever Phase 9 picks for FTS+embedding parity (CONTEXT note). Three options: (a) OpenAI text-embedding-3-small (cheap, well-known, but adds OpenAI key dep); (b) `fastembed-js` with AllMiniLM-L6-v2 (fully local, 384-dim, ONNX runtime in MCP sidecar, ~10ms/embedding on CPU); (c) reuse Claude via `claude -p` to score similarity (no embeddings table; LLM does it all — too expensive at scale). | **RECOMMENDATION:** ship **fastembed-js + AllMiniLM-L6-v2** (384-dim, fully local, no API key, fits the "no third-party dependencies" demo posture). Backup: defer the embedding pipeline and start with FTS5-only candidate selection — kernel experiment showed 4/4 retrieval works with `applies_when` text matching alone. **Decision: Plan 11-03 ships FTS5-first, Plan 11-04 layers fastembed if time permits before 11-05's Delegate UI.** |
| Two-pass agent dispatch (planning then executing) | Single execute-pass with audience prediction | Plan-review gate is the locked CONTEXT decision — non-negotiable for the Beat 1 narration ("the agent never gets a vague request") | Use `--append-system-prompt "PLANNING ONLY: do not write files"` for first pass; second pass is normal `run_agent` with full execute prompt |
| `find_substrate(query, types?, limit?)` exposed publicly via MCP | Kept private to Delegate composer | Public MCP exposure means agents *can* call it directly, but obscures the typed-tool surface (`find_constraints_for_goal` etc.) | **Keep private** (CONTEXT lock); private = "Rust IPC only, not MCP-exposed" |

**Installation (only the new pieces):**

```toml
# src-tauri/Cargo.toml — NO new direct deps required
# All Phase 11 mechanics use already-shipped crates (chrono, sqlx, serde_json, sha2, tokio, dashmap)
```

```bash
# mcp-sidecar/package.json — ADD if pursuing local embeddings (optional Plan 11-04)
npm install fastembed
# Otherwise: NO new MCP-side deps. Three new tools use existing better-sqlite3 + zod.
```

---

## Architecture Patterns

### Recommended Project Structure

```
contract-ide/src-tauri/src/
├── distiller/                          # NEW — Phase 11
│   ├── mod.rs                          # pub mod state, types, prompt, pipeline
│   ├── state.rs                        # DistillerLocks — DashMap<session_id, Arc<tokio::sync::Mutex<()>>>; mirror DriftLocks pattern
│   ├── types.rs                        # SubstrateNode, SubstrateEdge, NodeType enum (Constraint|Decision|OpenQuestion|ResolvedQuestion|Attempt), DistillerOutput, DeadLetter
│   ├── prompt.rs                       # Verbatim adapted from research/constraint-distillation/extraction-prompt.md, plus 4 new node kinds
│   └── pipeline.rs                     # distill_episode(episode_id) — claude -p invocation, JSON parse, upsert, dead-letter on failure
├── retrieval/                          # NEW — Phase 11
│   ├── mod.rs                          # pub mod scope, candidates, rerank
│   ├── scope.rs                        # lineage_scope_uuids(scope_uuid) — recursive CTE walking parent + ancestors (up to L0) + siblings
│   ├── candidates.rs                   # candidate_selection(scope_uuids, query) — FTS5 + (optional) embedding cosine + dedup
│   └── rerank.rs                       # llm_rerank(contract_body, candidates) — claude -p with rerank prompt, returns top-5 ordered
├── delegate/                           # NEW — Phase 11
│   ├── mod.rs                          # pub mod composer, plan_review
│   ├── composer.rs                     # compose_prompt(scope_uuid) -> { prompt, hits[] } — assembles contract body + 5 hits + lineage-scope text
│   └── plan_review.rs                  # run_planning_pass(prompt) — uses run_agent with --append-system-prompt PLANNING ONLY; parses StructuredPlan { target_files, substrate_rules, decisions_preview }
├── commands/
│   ├── distiller.rs                    # NEW — Tauri commands: list_dead_letters, retry_dead_letter, get_substrate_count_for_session
│   ├── retrieval.rs                    # NEW — Tauri commands: find_substrate_for_atom (private; Delegate composer), find_substrate_history (Phase 12 forward-compat)
│   ├── delegate.rs                     # NEW — Tauri commands: delegate_compose, delegate_plan, delegate_execute (or single delegate_to_agent with state-machine driven by frontend)
│   └── mod.rs                          # EXTEND — register new modules
├── db/
│   └── migrations.rs                   # EXTEND — Migration v(next): substrate_nodes + substrate_edges + substrate_nodes_fts + substrate_embeddings (Float32 BLOB)
└── lib.rs                              # EXTEND — register pub mod distiller, retrieval, delegate; .manage(DistillerLocks::default())

contract-ide/mcp-sidecar/src/tools/
├── find_constraints_for_goal.ts        # NEW — public MCP tool; thin wrapper over retrieval IPC
├── find_decisions_about.ts             # NEW — public MCP tool
├── open_questions.ts                   # NEW — public MCP tool
└── (find_substrate.ts is private — implemented as Rust IPC, not exposed via mcp-sidecar)

contract-ide/src/                       # FRONTEND — Phase 11 Delegate button + side panel
├── components/inspector/
│   ├── DelegateButton.tsx              # NEW — Inspector footer CTA; state machine (idle→composing→plan-review→sent→executing)
│   ├── ComposingOverlay.tsx            # NEW — 5 substrate hits stream-in with stagger; 150ms fade; provenance row
│   ├── PlanReviewPanel.tsx             # NEW — target files + substrate rules + decisions.json keys preview; [Approve][Edit][Cancel]
│   └── SubstrateSidePanel.tsx          # NEW — read-only flat list of lineage-scoped substrate (kind icon + rubric + applies_when)
├── store/
│   ├── delegate.ts                     # NEW — Zustand: dispatchState, currentHits, currentPlan, scope_uuid
│   └── substrate.ts                    # NEW — Zustand: substrate counter for footer status, dead-letter list
└── ipc/
    └── delegate.ts                     # NEW — invoke wrappers for delegate_compose / delegate_plan / delegate_execute

contract-ide/.contract-ide/             # Demo fixture artifacts
└── fixtures/decisions/
    ├── <AccountSettings.DangerZone-uuid>.json     # Hand-crafted 3-row manifest (24h, audit_log, async cleanup)
    └── <TeamSettings.DangerZone-uuid>.json        # Hand-crafted 3-row manifest mirroring above
```

### Pattern 1: Distiller Pipeline (LLM-driven typed extraction with provenance)

**What:** A per-episode distiller that reads `episodes.filtered_text` (Phase 10 output), runs `claude -p --output-format json --json-schema <schema>` to extract typed substrate nodes, and upserts them into `substrate_nodes` + `substrate_edges` with full provenance (`session_id`, `turn_ref` = `start_line`, `verbatim_quote`, `actor`, `confidence`).

**When to use:** Triggered by Phase 10's episode-ingest pipeline (new event `episode:ingested` with `episode_id`). Distiller is the consumer; runs in a debounced queue with max 1 in flight per session.

**Key sub-patterns:**
1. **JSON-schema validation at the boundary** — `claude -p` with `--json-schema` returns `structured_output` field; reject if missing or schema-mismatched (route to dead-letter); never trust LLM output without validation.
2. **Idempotent upsert via stable IDs** — `substrate_node.uuid = sha256(session_id + ":" + start_line + ":" + text-hash-prefix-12)`; INSERT OR REPLACE on the PK; re-running distiller on the same episode produces no duplicates.
3. **Per-session lock** — acquire `DistillerLocks::for_session(session_id)` BEFORE the LLM call; prevents two episodes from the same session being distilled concurrently (would race on substrate_node IDs derived from same session_id).
4. **Dead-letter queue** — schema validation failure, JSON parse failure, or `claude -p` non-zero exit appends a row to `distiller_dead_letters(episode_id, error_kind, raw_output, attempt_count, last_attempt_at)`. Footer shows `K episodes failed to distill — retry`. Manual retry only (no exponential auto-retry per CONTEXT lock).

**Example:**

```rust
// File: contract-ide/src-tauri/src/distiller/pipeline.rs
// Source: synthesized from Phase 10 ingestor.rs pattern + Anthropic Cookbook structured-output guide
use crate::distiller::{prompt, state::DistillerLocks, types::*};
use sha2::{Digest, Sha256};
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

pub async fn distill_episode(
    app: &tauri::AppHandle,
    episode_id: &str,
) -> Result<usize, String> {
    // 1. Load episode + session metadata
    let pool = /* ... DbPool ... */;
    let row: (String, String, i64, String) = sqlx::query_as(
        "SELECT e.session_id, e.filtered_text, e.start_line, s.cwd_key
         FROM episodes e
         JOIN sessions s ON s.session_id = e.session_id
         WHERE e.episode_id = ?",
    )
    .bind(episode_id)
    .fetch_one(&pool).await
    .map_err(|e| format!("episode lookup: {e}"))?;
    let (session_id, filtered_text, start_line, _cwd_key) = row;

    // 2. Acquire per-session lock — prevents concurrent distill of two episodes from same session
    let locks = app.state::<DistillerLocks>();
    let session_guard = locks.for_session(&session_id);
    let _lock = session_guard.lock().await;

    // 3. Run claude -p with --json-schema
    let schema = serde_json::json!({
        "type": "object",
        "properties": {
            "nodes": {
                "type": "array",
                "items": prompt::SUBSTRATE_NODE_SCHEMA.clone()
            }
        },
        "required": ["nodes"]
    });

    let prompt_text = prompt::DISTILLER_PROMPT.replace("{filtered_text}", &filtered_text);

    let output = app.shell()
        .command("claude")
        .args([
            "-p", &prompt_text,
            "--output-format", "json",
            "--json-schema", &schema.to_string(),
            "--bare",  // skip auto-discovery (faster startup, deterministic context)
        ])
        .output()
        .await
        .map_err(|e| format!("claude spawn: {e}"))?;

    if !output.status.success() {
        write_dead_letter(&pool, episode_id, "claude_exit_nonzero", &String::from_utf8_lossy(&output.stderr)).await?;
        return Err("distiller failed".into());
    }

    // 4. Parse top-level JSON, then drill into structured_output.nodes
    let response: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("response parse: {e}"))?;

    let nodes_raw = response.get("structured_output")
        .and_then(|v| v.get("nodes"))
        .and_then(|v| v.as_array())
        .ok_or_else(|| "missing structured_output.nodes".to_string())?;

    // 5. For each extracted node: derive stable UUID, upsert
    let mut upserted = 0usize;
    let now = chrono::Utc::now().to_rfc3339();
    for raw in nodes_raw {
        let text = raw.get("text").and_then(|v| v.as_str()).unwrap_or("");
        let node_type = raw.get("type").and_then(|v| v.as_str()).unwrap_or("constraint");

        // Stable UUID — re-running on same episode produces identical IDs
        let mut hasher = Sha256::new();
        hasher.update(format!("{}:{}:{}", session_id, start_line, &text[..text.len().min(120)]));
        let uuid = format!("substrate-{}", hex::encode(&hasher.finalize()[..12]));

        sqlx::query(
            "INSERT OR REPLACE INTO substrate_nodes
             (uuid, node_type, text, scope, applies_when,
              valid_at, invalid_at, expired_at, created_at,
              source_session_id, source_turn_ref, source_quote, source_actor,
              confidence, episode_id)
             VALUES (?,?,?,?,?, ?,NULL,NULL,?, ?,?,?,?, ?,?)",
        )
        .bind(&uuid)
        .bind(node_type)
        .bind(text)
        .bind(raw.get("scope").and_then(|v| v.as_str()))
        .bind(raw.get("applies_when").and_then(|v| v.as_str()))
        .bind(&now)
        .bind(&now)
        .bind(&session_id)
        .bind(start_line)
        .bind(raw.get("source").and_then(|v| v.get("quote")).and_then(|v| v.as_str()))
        .bind(raw.get("source").and_then(|v| v.get("actor")).and_then(|v| v.as_str()).unwrap_or("claude"))
        .bind(raw.get("confidence").and_then(|v| v.as_str()).unwrap_or("inferred"))
        .bind(episode_id)
        .execute(&pool).await
        .map_err(|e| format!("upsert {uuid}: {e}"))?;

        upserted += 1;
    }

    // 6. Emit substrate counter event for footer + first-toast logic
    app.emit("substrate:ingested", serde_json::json!({
        "episode_id": episode_id,
        "session_id": session_id,
        "count": upserted,
    })).ok();

    Ok(upserted)
}
```

### Pattern 2: Bitemporal SQLite Schema (Graphiti-pattern; coordinates with Phase 12)

**What:** New tables `substrate_nodes` (5 typed kinds, bitemporal columns), `substrate_edges` (typed: `cites`, `refines`, `supersedes` reserved for Phase 12), `substrate_nodes_fts` (FTS5 virtual table), `substrate_embeddings` (Float32 BLOB), `distiller_dead_letters` (retry queue). Schema is Phase 12 forward-compatible — Phase 12 layers `intent_drift_state`, `priority_shifts`, `intent_drift_verdicts` ON TOP of this without rewriting.

**When to use:** Apply once via numbered migration at next-free-version (mirrors Phase 10 / Phase 12's dynamic-version pattern).

**SQL (verbatim — this is the canonical schema):**

```sql
-- Phase 11 SUB-03: typed substrate nodes with full provenance + bitemporal columns.
-- Bitemporal columns (Graphiti pattern): valid_at = real-world; invalid_at = real-world end;
-- expired_at = DB-side invalidation; created_at = first ingestion. invalid_at + expired_at
-- nullable but PRESENT (Phase 12 will USE them; schema is forward-compatible).
CREATE TABLE IF NOT EXISTS substrate_nodes (
    uuid              TEXT PRIMARY KEY,
    node_type         TEXT NOT NULL CHECK(node_type IN ('constraint','decision','open_question','resolved_question','attempt')),
    text              TEXT NOT NULL,                        -- imperative one-sentence rule (kernel-experiment schema)
    scope             TEXT,                                  -- 'global' | 'module:<pat>' | 'task-pattern:<short>'
    applies_when      TEXT,                                  -- LOAD-BEARING for retrieval (kernel finding #4)

    -- Provenance (kernel-experiment schema; SUB-03 explicitly requires all 5 fields)
    source_session_id TEXT,                                  -- references sessions.session_id (Phase 10)
    source_turn_ref   INTEGER,                               -- start_line of the episode in the JSONL
    source_quote      TEXT,                                  -- verbatim quote justifying the node
    source_actor      TEXT CHECK(source_actor IN ('user','claude','derived') OR source_actor IS NULL),

    -- Bitemporal (Graphiti pattern; valid_at REQUIRED per CONTEXT lock; others NULLable)
    valid_at          TEXT NOT NULL,                         -- ISO-8601 UTC; when fact became true
    invalid_at        TEXT,                                  -- NULL = currently true (Phase 12 sets)
    expired_at        TEXT,                                  -- DB-side invalidation timestamp (Phase 12 sets)
    created_at        TEXT NOT NULL,                         -- first ingestion

    -- Confidence (kernel-experiment binary)
    confidence        TEXT NOT NULL DEFAULT 'inferred' CHECK(confidence IN ('explicit','inferred')),

    -- Indexing back-link
    episode_id        TEXT REFERENCES episodes(episode_id) ON DELETE CASCADE,

    -- Phase 12 forward-compat (NULL until Phase 12 ships)
    invalidated_by    TEXT REFERENCES substrate_nodes(uuid)
);

-- Partial index for "current truth" queries — Phase 12 + every retrieval read filters by this
CREATE INDEX IF NOT EXISTS idx_substrate_nodes_active   ON substrate_nodes(invalid_at) WHERE invalid_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_substrate_nodes_type     ON substrate_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_substrate_nodes_session  ON substrate_nodes(source_session_id);
CREATE INDEX IF NOT EXISTS idx_substrate_nodes_episode  ON substrate_nodes(episode_id);
CREATE INDEX IF NOT EXISTS idx_substrate_nodes_valid_at ON substrate_nodes(valid_at);

-- Typed edges between substrate nodes
CREATE TABLE IF NOT EXISTS substrate_edges (
    id          TEXT PRIMARY KEY,
    source_uuid TEXT NOT NULL REFERENCES substrate_nodes(uuid) ON DELETE CASCADE,
    target_uuid TEXT NOT NULL REFERENCES substrate_nodes(uuid) ON DELETE CASCADE,
    edge_type   TEXT NOT NULL,                               -- 'cites' | 'refines' | 'supersedes' (Phase 12) | 'derived_from'
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_substrate_edges_source ON substrate_edges(source_uuid);
CREATE INDEX IF NOT EXISTS idx_substrate_edges_target ON substrate_edges(target_uuid);
CREATE INDEX IF NOT EXISTS idx_substrate_edges_type   ON substrate_edges(edge_type);

-- FTS5 over text + applies_when for keyword candidate selection
CREATE VIRTUAL TABLE IF NOT EXISTS substrate_nodes_fts USING fts5(
    uuid UNINDEXED,
    text,
    applies_when,
    scope,
    content='substrate_nodes',
    content_rowid='rowid'
);

-- FTS5 sync triggers (manual sync — same pattern as nodes_fts)
CREATE TRIGGER IF NOT EXISTS substrate_nodes_ai AFTER INSERT ON substrate_nodes BEGIN
    INSERT INTO substrate_nodes_fts(rowid, uuid, text, applies_when, scope)
    VALUES (new.rowid, new.uuid, new.text, new.applies_when, new.scope);
END;
CREATE TRIGGER IF NOT EXISTS substrate_nodes_au AFTER UPDATE ON substrate_nodes BEGIN
    INSERT INTO substrate_nodes_fts(substrate_nodes_fts, rowid, uuid, text, applies_when, scope)
    VALUES ('delete', old.rowid, old.uuid, old.text, old.applies_when, old.scope);
    INSERT INTO substrate_nodes_fts(rowid, uuid, text, applies_when, scope)
    VALUES (new.rowid, new.uuid, new.text, new.applies_when, new.scope);
END;
CREATE TRIGGER IF NOT EXISTS substrate_nodes_ad AFTER DELETE ON substrate_nodes BEGIN
    INSERT INTO substrate_nodes_fts(substrate_nodes_fts, rowid, uuid, text, applies_when, scope)
    VALUES ('delete', old.rowid, old.uuid, old.text, old.applies_when, old.scope);
END;

-- Embeddings (Float32 BLOB; 384 floats = 1536 bytes for AllMiniLM-L6-v2 dim)
-- Sibling table to keep substrate_nodes row size small + allow embedding-skipped rows (Phase 12 stretch)
CREATE TABLE IF NOT EXISTS substrate_embeddings (
    uuid       TEXT PRIMARY KEY REFERENCES substrate_nodes(uuid) ON DELETE CASCADE,
    model      TEXT NOT NULL DEFAULT 'all-MiniLM-L6-v2',
    dim        INTEGER NOT NULL DEFAULT 384,
    -- 384 * 4 bytes = 1536 bytes per row at 384-dim
    vector     BLOB NOT NULL,
    embedded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dead-letter queue — failed distiller runs surface here for manual retry
CREATE TABLE IF NOT EXISTS distiller_dead_letters (
    id              TEXT PRIMARY KEY,                        -- uuid v4
    episode_id      TEXT NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
    error_kind      TEXT NOT NULL,                           -- 'claude_exit_nonzero' | 'json_parse' | 'schema_mismatch' | 'timeout'
    raw_output      TEXT,                                    -- truncated to 4KB
    attempt_count   INTEGER NOT NULL DEFAULT 1,
    last_attempt_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dead_letters_episode ON distiller_dead_letters(episode_id);
```

**Coordination with Phase 12:** Phase 12's plan 12-01 (already drafted) uses `CREATE TABLE IF NOT EXISTS` for `substrate_nodes` so it's idempotent against the case where Phase 11 hasn't shipped yet. Phase 12 ALTER TABLE-adds `intent_drift_state`, `intent_drift_confidence`, `intent_drift_reasoning`, `intent_drift_judged_at`, `intent_drift_judged_against` columns. **Phase 11's schema above MUST NOT pre-add those columns** — leave Phase 12 to add them via ALTER. The shared invariant is the bitemporal column quartet (`valid_at`, `invalid_at`, `expired_at`, `created_at`) plus `invalidated_by` — all five present after Phase 11 lands.

### Pattern 3: Three-Stage Retrieval — Lineage Scope → Semantic Filter → LLM Rerank

**What:** The load-bearing demo claim ("not just RAG over chat") executes as: (1) walk the contract's lineage edges to scope candidate substrate nodes (cheap), (2) embedding-similarity-rank those candidates against the contract's intent text (medium), (3) LLM-rerank the top-15 down to top-5 using the contract body as grounding (slow but precise). Compute order = graph → semantic → LLM; rhetorical order in narration = applies_when match → graph scope → LLM rerank (CONTEXT lock).

**When to use:** Every Delegate dispatch + every `find_constraints_for_goal` MCP call. Phase 9 mass-edit reuses just the candidate-selection step (no LLM rerank for mass-edit due to per-node cost).

**Step 1 — Lineage scope (graph traversal):**

```rust
// File: contract-ide/src-tauri/src/retrieval/scope.rs
// "lineage scope = parent + ancestors up to L0 + siblings; EXCLUDE cousins" (CONTEXT lock)
pub async fn lineage_scope_uuids(
    pool: &DbPool,
    scope_uuid: &str,
) -> Result<Vec<String>, String> {
    let DbPool::Sqlite(pool) = pool else { return Err("not sqlite".into()) };

    // Recursive CTE: walk parent_uuid edges from scope_uuid up to L0
    // Then add siblings (children of the same parent)
    let rows: Vec<(String,)> = sqlx::query_as(
        r#"
        WITH RECURSIVE ancestors(uuid, parent_uuid, level) AS (
            SELECT uuid, parent_uuid, level FROM nodes WHERE uuid = ?1
            UNION ALL
            SELECT n.uuid, n.parent_uuid, n.level
            FROM nodes n
            JOIN ancestors a ON n.uuid = a.parent_uuid
            WHERE a.parent_uuid IS NOT NULL
        )
        SELECT uuid FROM ancestors
        UNION
        SELECT s.uuid
        FROM nodes s
        JOIN nodes target ON target.uuid = ?1
        WHERE s.parent_uuid = target.parent_uuid AND s.uuid != target.uuid
        "#,
    )
    .bind(scope_uuid)
    .fetch_all(pool).await
    .map_err(|e| format!("lineage walk: {e}"))?;

    Ok(rows.into_iter().map(|r| r.0).collect())
}
```

**Step 2 — Semantic candidate selection (FTS5 keyword + cosine on embeddings):**

```rust
// File: contract-ide/src-tauri/src/retrieval/candidates.rs
// Hybrid: FTS5 over substrate_nodes_fts.applies_when (BM25 ranked) + cosine on substrate_embeddings.vector
// Returns top-15 candidates with `WHERE invalid_at IS NULL` filter (current-truth always)
//
// Note: this implementation MUST scope to substrate_nodes whose source_session_id appears in a
// session that ran in a project linked to ANY of the lineage_scope_uuids (i.e., the substrate
// "knows about" something in this lineage). v1 simple version: union of substrate_nodes whose
// `episode_id` belongs to a session whose `cwd_key` matches the current repo. Phase 11 retrieval
// uses the contract's lineage as a SECOND filter via `applies_when` semantic match — the lineage
// uuids constrain which contracts the substrate could possibly apply to.
pub async fn candidate_selection(
    pool: &DbPool,
    scope_uuids: &[String],
    query: &str,            // contract body or intent text
    query_embedding: Option<&[f32]>,  // None if embeddings disabled
    limit: usize,           // 15 default
) -> Result<Vec<Candidate>, String> {
    // FTS5 candidates (cheap, broad)
    let fts_rows: Vec<(String, f64)> = sqlx::query_as(
        r#"
        SELECT s.uuid, fts.rank
        FROM substrate_nodes_fts fts
        JOIN substrate_nodes s ON s.uuid = fts.uuid
        WHERE substrate_nodes_fts MATCH ?
          AND s.invalid_at IS NULL
        ORDER BY fts.rank
        LIMIT ?
        "#,
    )
    .bind(query)
    .bind(limit as i64 * 2)
    .fetch_all(/*pool*/).await?;

    // Embedding cosine candidates (if embeddings enabled)
    // Implementation: load all embeddings for current-truth nodes into memory; compute cosine
    // against query_embedding; sort. At 50-node scale this is sub-1ms.
    // OR: use sqlite-vec vec0 KNN (deferred — Float32 BLOB + TS cosine for v1).
    let mut combined: HashMap<String, f64> = HashMap::new();

    // RRF: combine FTS5 rank + (optional) cosine rank with k=60
    for (rank, (uuid, _bm25_score)) in fts_rows.iter().enumerate() {
        let rrf_contribution = 1.0 / (60.0 + rank as f64 + 1.0);
        *combined.entry(uuid.clone()).or_insert(0.0) += rrf_contribution;
    }

    if let Some(qe) = query_embedding {
        let cosine_rows = compute_cosine_top_n(pool, qe, limit * 2).await?;
        for (rank, uuid) in cosine_rows.iter().enumerate() {
            let rrf_contribution = 1.0 / (60.0 + rank as f64 + 1.0);
            *combined.entry(uuid.clone()).or_insert(0.0) += rrf_contribution;
        }
    }

    // Sort by combined RRF score descending
    let mut candidates: Vec<(String, f64)> = combined.into_iter().collect();
    candidates.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    candidates.truncate(limit);

    // Hydrate Candidate structs with full metadata
    let uuids: Vec<&str> = candidates.iter().map(|(u, _)| u.as_str()).collect();
    let hydrated = fetch_substrate_nodes(pool, &uuids).await?;
    Ok(hydrated)
}
```

**Step 3 — LLM rerank top-15 → top-5:**

```rust
// File: contract-ide/src-tauri/src/retrieval/rerank.rs
// One claude -p call per Delegate dispatch (acceptable: ~$0.01-0.03 per dispatch)
// Verbatim listwise-rerank prompt pattern (Pinecone / LlamaIndex 2026)
pub async fn llm_rerank(
    app: &tauri::AppHandle,
    contract_body: &str,
    candidates: &[Candidate],
    top_k: usize,             // 5 (CONTEXT lock)
) -> Result<Vec<Candidate>, String> {
    let candidates_text = candidates.iter().enumerate()
        .map(|(i, c)| format!("[{i}] type={} text=\"{}\" applies_when=\"{}\"", c.node_type, c.text, c.applies_when.as_deref().unwrap_or("")))
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = format!(
        r#"You are reranking substrate rules for a coding agent's task.

Contract body (the work to do):
<contract>
{contract_body}
</contract>

Candidates (top-{n} from semantic search):
<candidates>
{candidates_text}
</candidates>

Task: Pick the {top_k} candidates whose `applies_when` MOST DIRECTLY constrains how the agent should
implement this contract. Order them most-relevant first.

Output ONLY a JSON array of indices like [3, 7, 1, 5, 2]. No commentary."#,
        n = candidates.len(),
    );

    let output = app.shell()
        .command("claude")
        .args(["-p", &prompt, "--output-format", "json", "--bare"])
        .output().await
        .map_err(|e| format!("rerank claude: {e}"))?;

    // Parse: response.result is the model's text output; expect a JSON array of indices
    let response: serde_json::Value = serde_json::from_slice(&output.stdout)?;
    let result_text = response.get("result").and_then(|v| v.as_str()).unwrap_or("[]");
    let indices: Vec<usize> = serde_json::from_str(result_text)
        .or_else(|_| {
            // Defensive: some models wrap in code fences. Strip and retry.
            let stripped = result_text.trim_matches(|c: char| c == '`' || c == '\n' || c == 'j' || c == 's' || c == 'o' || c == 'n');
            serde_json::from_str(stripped)
        })
        .map_err(|e| format!("indices parse: {e}; got: {}", &result_text[..result_text.len().min(200)]))?;

    Ok(indices.into_iter()
        .filter_map(|i| candidates.get(i).cloned())
        .take(top_k)
        .collect())
}
```

### Pattern 4: `Delegate to agent` — Two-Phase Dispatch State Machine

**What:** A frontend state machine (idle → composing → plan-review → sent → executing → idle) coordinates a planning-only first pass, user approval, then execute pass. Reuses Phase 8's `run_agent` Rust runner for both passes; differs only in prompt prefix.

**When to use:** Inspector footer button click. Triggers retrieval, then planning, then approval gate, then execution.

**State machine + prompt patterns:**

```typescript
// File: contract-ide/src/store/delegate.ts
// Source: synthesized from CONTEXT.md state-machine spec + Phase 8 run_agent IPC pattern
type DelegateState =
  | { kind: 'idle' }
  | { kind: 'composing'; scope_uuid: string }
  | { kind: 'plan-review'; scope_uuid: string; hits: SubstrateHit[]; plan: StructuredPlan; assembledPrompt: string }
  | { kind: 'sent'; scope_uuid: string }
  | { kind: 'executing'; scope_uuid: string; tracking_id: string };

interface SubstrateHit {
  uuid: string;
  rubric_label: string;        // first 60 chars of `text`
  applies_when: string;
  source: { session_id: string; turn_ref: number; quote: string };
  confidence: 'explicit' | 'inferred';
  node_type: NodeType;
}

interface StructuredPlan {
  target_files: string[];      // e.g. ['app/account/settings/page.tsx', ...]
  substrate_rules: { uuid: string; one_line: string }[];
  decisions_preview: { key: string; chosen_value: string }[];  // PREVIEW; not full decisions.json
}

// Compose then plan in two-step sequence:
async function delegateFlow(scope_uuid: string) {
  setState({ kind: 'composing', scope_uuid });

  // Step 1: composer assembles prompt + retrieves 5 hits
  const { hits, prompt } = await invoke<{ hits: SubstrateHit[]; prompt: string }>(
    'delegate_compose',
    { scope_uuid }
  );

  // (frontend animates 5 hits with 150ms stagger fade-in during composing state)

  // Step 2: planning pass — claude -p with PLANNING-ONLY system prompt prefix
  const plan = await invoke<StructuredPlan>('delegate_plan', {
    scope_uuid,
    assembled_prompt: prompt,
  });

  setState({ kind: 'plan-review', scope_uuid, hits, plan, assembledPrompt: prompt });

  // (user clicks Approve → call delegate_execute; Cancel → setState idle; Edit → re-prompt loop)
}
```

```rust
// File: contract-ide/src-tauri/src/commands/delegate.rs
// Step: planning pass — uses run_agent with --append-system-prompt PLANNING ONLY directive
// Per Anthropic CLI docs: --append-system-prompt adds INSTRUCTIONS but doesn't replace defaults
#[tauri::command]
pub async fn delegate_plan(
    app: tauri::AppHandle,
    scope_uuid: String,
    assembled_prompt: String,
) -> Result<StructuredPlan, String> {
    // Use --append-system-prompt to ADD planning-only directive without removing default tools
    let planning_directive = r#"PLANNING-ONLY MODE. You will produce a STRUCTURED PLAN, not code.
Do not call Edit, Write, or MultiEdit tools.
Do not modify any files.
Read tools are permitted (Read, Glob, Grep) for understanding the task.

Output ONLY a JSON object matching this schema:
{
  "target_files": ["path/to/file.tsx", ...],
  "substrate_rules": [{"uuid": "...", "one_line": "..."}],
  "decisions_preview": [{"key": "...", "chosen_value": "..."}]
}
"#;

    let schema = serde_json::json!({
        "type": "object",
        "properties": {
            "target_files": { "type": "array", "items": {"type": "string"} },
            "substrate_rules": { "type": "array", "items": {
                "type": "object", "properties": {
                    "uuid": {"type": "string"}, "one_line": {"type": "string"}
                }
            }},
            "decisions_preview": { "type": "array", "items": {
                "type": "object", "properties": {
                    "key": {"type": "string"}, "chosen_value": {"type": "string"}
                }
            }}
        },
        "required": ["target_files", "substrate_rules", "decisions_preview"]
    });

    let output = app.shell()
        .command("claude")
        .args([
            "-p", &assembled_prompt,
            "--append-system-prompt", planning_directive,
            "--output-format", "json",
            "--json-schema", &schema.to_string(),
            "--bare",
        ])
        .output().await
        .map_err(|e| format!("plan claude: {e}"))?;

    let response: serde_json::Value = serde_json::from_slice(&output.stdout)?;
    let plan: StructuredPlan = serde_json::from_value(
        response.get("structured_output").cloned().ok_or("missing structured_output")?
    )?;

    Ok(plan)
}

// Execute pass: standard run_agent (Phase 8) with execute-mode prompt that ALSO instructs
// the agent to emit decisions.json alongside code.
#[tauri::command]
pub async fn delegate_execute(
    app: tauri::AppHandle,
    scope_uuid: String,
    assembled_prompt: String,
    atom_uuid: Option<String>,  // for the two demo atoms, fixture-fallback applies on missing/malformed emission
) -> Result<String, String> {
    // Compose execute-mode prompt: same assembled prompt + decisions.json emission directive
    let execute_prompt = format!(r#"{assembled_prompt}

---
ALSO: After writing code, emit a `decisions.json` file at `.contracts/decisions/{scope_uuid}.json` with this schema:
{{
  "atom_uuid": "{scope_uuid}",
  "decisions": [
    {{
      "key": "string",
      "chosen_value": "string",
      "rationale": "1-sentence explanation",
      "substrate_citation_id": "string|null"  // null if no substrate rule applied
    }}
  ]
}}
List the implicit decisions you made — defaults you picked that no substrate rule explicitly demanded.
"#);

    // Delegate to Phase 8's run_agent — same chat panel surface, same receipt parsing
    let tracking_id = crate::commands::agent::run_agent(
        app.clone(),
        execute_prompt,
        Some(scope_uuid.clone()),
    ).await?;

    // After agent terminates, check for decisions.json; fall back to fixture if needed
    // (Note: this is naturally event-driven via Phase 8's `agent:terminated` event; the frontend
    // subscribes and triggers the fixture-load IPC if the agent emission is missing)

    Ok(tracking_id)
}
```

### Pattern 5: Implicit-Decisions Manifest with Fixture Fallback

**What:** Storage layer always populated for the two demo atoms. Agent emits `.contracts/decisions/<atom-uuid>.json`; if missing or schema-invalid, load from fixture path. Phase 13 verifier reads from storage; never sees an empty manifest.

**When to use:** After every `delegate_execute` against `AccountSettings.DangerZone` or `TeamSettings.DangerZone`. Auto-fallback for these two atoms ONLY (per CONTEXT lock).

**Implementation:**

```rust
// File: contract-ide/src-tauri/src/commands/delegate.rs
const DEMO_ATOM_UUIDS: &[&str] = &[
    "AccountSettings.DangerZone",  // placeholder — actual UUID comes from Phase 9 contract-ide-demo seeding
    "TeamSettings.DangerZone",
];

#[tauri::command]
pub async fn ensure_decisions_manifest(
    app: tauri::AppHandle,
    repo_path: String,
    atom_uuid: String,
) -> Result<DecisionsManifest, String> {
    let decisions_path = std::path::Path::new(&repo_path)
        .join(".contracts")
        .join("decisions")
        .join(format!("{atom_uuid}.json"));

    // Try to read agent emission
    if let Ok(text) = std::fs::read_to_string(&decisions_path) {
        if let Ok(manifest) = serde_json::from_str::<DecisionsManifest>(&text) {
            // Validate against schema (zod-equivalent in Rust via serde + manual check)
            if manifest.atom_uuid == atom_uuid && !manifest.decisions.is_empty() {
                return Ok(manifest);
            }
        }
    }

    // Fallback: for the two demo atoms, load from committed fixture
    if DEMO_ATOM_UUIDS.contains(&atom_uuid.as_str()) {
        let fixture_path = std::path::Path::new(&repo_path)
            .join(".contract-ide-fixtures")
            .join("decisions")
            .join(format!("{atom_uuid}.json"));

        let text = std::fs::read_to_string(&fixture_path)
            .map_err(|e| format!("fixture {fixture_path:?}: {e}"))?;
        let manifest: DecisionsManifest = serde_json::from_str(&text)
            .map_err(|e| format!("fixture parse: {e}"))?;

        // Write fallback manifest to canonical location (so verifier reads consistently)
        let _ = std::fs::create_dir_all(decisions_path.parent().unwrap());
        let _ = std::fs::write(&decisions_path, serde_json::to_string_pretty(&manifest)?);

        return Ok(manifest);
    }

    Err(format!("no decisions.json emission and no fixture for {atom_uuid}"))
}
```

**Fixture content (committed to repo, hand-crafted per CONTEXT lock):**

```json
// .contract-ide-fixtures/decisions/AccountSettings.DangerZone.json
{
  "atom_uuid": "AccountSettings.DangerZone",
  "decisions": [
    {
      "key": "email_link_expiry_hours",
      "chosen_value": "24",
      "rationale": "Industry standard for destructive-action confirmation; matches dec-confirm-via-email-link behavior.",
      "substrate_citation_id": null
    },
    {
      "key": "audit_log_destination",
      "chosen_value": "audit_log table",
      "rationale": "Inferred from existing project schema; centralized audit trail is repo convention.",
      "substrate_citation_id": null
    },
    {
      "key": "cleanup_execution_mode",
      "chosen_value": "background job (async)",
      "rationale": "Derived from contract.role 'primary action' — UI must respond immediately; cleanup runs after grace window.",
      "substrate_citation_id": null
    }
  ]
}
```

### Anti-Patterns to Avoid

- **DO NOT pre-add Phase 12 columns** (`intent_drift_state`, `intent_drift_confidence`, etc.) to `substrate_nodes` in Phase 11's migration. Phase 12's plan 12-01 ALTER-adds them. Pre-adding causes Phase 12's `ADD COLUMN IF NOT EXISTS` (which SQLite doesn't support) to require additional guards.

- **DO NOT call `claude -p` without `--bare`.** Without it, the CLI auto-discovers `~/.claude/CLAUDE.md` + plugins + MCP servers + skills, adding 1-3s of startup latency and non-deterministic behavior. Distiller, rerank, and planning all need fast deterministic context.

- **DO NOT trust LLM JSON output without `--json-schema` validation.** Free-form output requires regex/jq fallback with brittle parsing; the validated `--json-schema` flag (Anthropic CLI docs 2026-04) returns parsed JSON in the `structured_output` field. Always use it for distiller + planning.

- **DO NOT embed in the same `claude -p` call as the rerank.** Embeddings are model-specific (text-embedding-3-small / AllMiniLM-L6-v2) and need cosine math; rerank is listwise LLM ranking. Separate concerns.

- **DO NOT fire the LLM rerank on every keystroke.** Rerank is expensive (~$0.01-0.03 per call). It runs ONCE per Delegate dispatch (after Composing finishes, before plan-review). MCP tool calls (`find_constraints_for_goal`) also run rerank — but agents call those once per task, not per keystroke.

- **DO NOT load all sqlite-vec vectors into a `vec0` virtual table for v1.** sqlite-vec ABI mismatches with better-sqlite3 12.x are documented (Issues #65156 / #66977). Float32 BLOB columns + TS-side cosine in the MCP sidecar is sub-1ms at 50-constraint scale and avoids the build-pipeline complication.

- **DO NOT couple distiller scheduling to Phase 13's UI.** Distiller runs on `episode:ingested` event from Phase 10 watcher. Phase 13's "Substrate" tab merely DISPLAYS what the distiller already wrote — Phase 11's distiller is event-driven, not UI-triggered.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Subprocess spawning + streaming | Custom `tokio::process::Command` wrapper | `tauri-plugin-shell` + Phase 8's `run_agent` | Phase 8 already isolated this — capability scopes, env inheritance under Finder launch (Plan 01-04 lessons), CommandChild lifecycle. Re-implementing breaks Pitfalls 4 / 6 |
| Per-session distill-in-flight guard | Custom flag/Mutex | `DashMap<session_id, Arc<tokio::sync::Mutex<()>>>` (mirror Phase 7's `DriftLocks` verbatim) | Same pattern as Phase 7 + Phase 10; tested, idiomatic |
| Stable substrate node IDs | Custom counter or UUID v4 | `sha256(session_id + ":" + start_line + ":" + text-prefix-12)` with hex prefix | Idempotency on re-run; same pattern as Phase 10's episode_id |
| FTS5 candidate selection | Manual LIKE / regex | `substrate_nodes_fts MATCH` via FTS5 virtual table + sync triggers | Phase 1 DATA-06 already shipped this pattern for `nodes_fts`; copy verbatim |
| LLM JSON parsing | Manual regex over markdown code fences | `claude -p --json-schema <schema> --output-format json` returning `structured_output` | Anthropic CLI does the schema validation; defensive parsing only on schema rejection |
| Cosine similarity | Hand-roll inner product | `Float32Array` dot product / norm in TS (or `cosine_similarity` from `sqlite-vec` if extension stretch) | Hand-rolled in TS is 5 lines; sub-1ms at 50-node scale; sqlite-vec is overkill for v1 |
| RRF combination | Custom score normalization | `1.0 / (60 + rank)` per source, sum across sources (industry k=60 default) | Verified pattern (Microsoft Azure, OpenSearch, Pinecone) — k=60 is "performs well across various datasets" per benchmark literature |
| Receipt-card delta measurement | Custom token counting | Phase 8's `tool_call_count` + `input_tokens` + `wall_time_ms` columns from `receipts` table | Phase 8 already parses session JSONL defensively; Phase 11 just queries the same columns for Beat 2's stacked-absolute display |
| Decisions.json schema validation | Custom checks | `zod` schema in TS (mcp-sidecar already imports zod) OR `serde_json::from_str::<DecisionsManifest>` with strict deserialization | Both routes already in stack; pick by where the validation runs (frontend = zod, backend = serde) |
| Lineage walker (parent + ancestors + siblings) | TS-side recursive call | SQLite recursive CTE (Pattern 3 above) | One round-trip; SQLite query planner is well-tuned; no N+1 problem |

**Key insight:** Phase 11 is heavy on integration but light on novel infrastructure. Every primitive — subprocess spawning, FTS5, mutex locking, claude-p subprocess, JSONL parsing — is shipped or being shipped. The new code is the THREE pieces of glue: distiller pipeline, retrieval algorithm, Delegate state machine. Plus the schema migration + 3 MCP tools. Avoid re-implementing what Phase 7/8/10 already shipped.

---

## Common Pitfalls

### Pitfall 1: `--json-schema` returning non-JSON output

**What goes wrong:** The model occasionally wraps JSON in markdown code fences (```json ... ```) or adds preamble like "Here's the structured output:" before the JSON. `--json-schema` is supposed to enforce schema, but failures still produce unparseable output occasionally.

**Why it happens:** Model temperature variance; `--json-schema` validates the OUTPUT field but the model may still emit pre-text in the `result` field even when `structured_output` is correct.

**How to avoid:**
1. Always read `response.structured_output` (the validated field), NOT `response.result` (which is the raw text).
2. If `structured_output` is missing or `null`, route the episode to the dead-letter queue immediately. Do NOT attempt regex-cleanup of `response.result` — that's a maintenance nightmare.
3. Log the full `response` JSON to the dead-letter `raw_output` column for offline inspection.

**Warning signs:** Distiller running but no substrate nodes accumulating; dead-letter count climbing; manual `claude -p` test producing valid JSON inside fences.

### Pitfall 2: Lineage scope returning empty for sparse demo graph

**What goes wrong:** `AccountSettings.DangerZone` is a L4 atom; lineage walker returns parent (`AccountSettings`) → grandparent (`Account` flow) → root (`L0 Product`). Plus siblings (`Profile`, `Billing`, etc.). Total: 5-8 uuids. But the substrate is keyed by `source_session_id`, not by lineage uuids — the substrate doesn't know about the contract graph at all.

**Why it happens:** Substrate nodes are scoped by `applies_when` semantics; their relevance to a contract atom is determined by SEMANTIC match against `applies_when`, not by graph membership. The "lineage scope" is a SEMANTIC FILTER (only consider substrate nodes whose `applies_when` could conceivably apply to nodes in this lineage) — not a hard graph filter.

**How to avoid:**
- v1 simplification: lineage_scope is used as a TEXT context in the LLM rerank prompt (`"this contract is about Account Settings → Danger Zone in Account flow"`), letting the model interpret what `applies_when` matches.
- Don't try to JOIN `substrate_nodes` to `nodes` via lineage uuids — there's no such relationship in v1. Phase 12 may add `applies_to_uuids` if needed.
- Zero-hit fallback (per CONTEXT lock): if FTS5 + embeddings return <5 candidates, badge the overlay `"Broad search — no scoped hits"` and show top global candidates.

**Warning signs:** Demo composing overlay shows only 2-3 hits when 5 are expected; LLM rerank receives 15 candidates but they're broadly off-topic.

### Pitfall 3: Plan-review gate breaks Beat 1 timing

**What goes wrong:** Plan-review pass takes 8-12s instead of expected 3-5s; Beat 1 runs over its 35s envelope; demo recording cut to Beat 2 misses cue.

**Why it happens:** `claude -p --bare` with `--append-system-prompt` and `--json-schema` adds startup overhead. Without `--bare`, MCP server discovery + skills loading adds 2-5s. With `--bare` + a long input prompt + tool calls (Read of contract body), still ~3-5s.

**How to avoid:**
1. Use `--bare` always.
2. Pre-warm: run a no-op `claude -p --bare "ping"` at app startup to JIT the CLI.
3. Time the planning pass during Plan 11-04 dev — if >5s, simplify the planning prompt (drop `--json-schema` and parse free-form, or pre-compute the file list from substrate hits + contract code_ranges instead of asking the model).
4. Cache the assembled prompt + plan locally; if user clicks Re-plan after Edit, only re-run if the prompt changed.

**Warning signs:** Beat 1 timing in rehearsal slips past 50s; plan-review panel shows "Composing plan..." for >7s.

### Pitfall 4: Embedding dimensions mismatch between distiller and retrieval

**What goes wrong:** Distiller embeds `applies_when` text with AllMiniLM-L6-v2 (384-dim); retrieval embeds the contract body with `text-embedding-3-small` (1536-dim); cosine fails (mismatched vector dims).

**Why it happens:** Phase 9 mass-edit may pick a different model than Phase 11; "use whatever Phase 9 uses for FTS+embedding parity" (CONTEXT note) is brittle if Phase 9's choice isn't locked when Phase 11 builds.

**How to avoid:**
1. Pin the embedding model + dim in `substrate_embeddings.model` + `substrate_embeddings.dim`. Distiller writes `model='all-MiniLM-L6-v2'` and `dim=384`.
2. Retrieval queries this column; if a substrate node's embedding model ≠ query model, treat it as embedding-missing and fall back to FTS5-only for that row.
3. **Recommendation:** lock both Phase 11 and Phase 9 to AllMiniLM-L6-v2 (384-dim, fastembed-js, fully local). Document in 11-RESEARCH.md and 09-RESEARCH.md (already mentions FTS+embedding parity).
4. Stretch: add a re-embedding migration if model is changed mid-flight.

**Warning signs:** Cosine returns NaN or 0.0 for all candidates; retrieval falls back to FTS5-only silently.

### Pitfall 5: Distiller backfill cost spike

**What goes wrong:** Phase 10's backfill ingests 30 days of historical sessions; Phase 11's distiller queues all of them; cost ~$0.50-2.00 per session × 50 sessions = $25-100 in one click.

**Why it happens:** Phase 10's cost preview only covers FILTERING (no LLM calls); Phase 11's distiller runs an LLM call PER EPISODE, and a 30-day backfill could be 200+ episodes.

**How to avoid:**
1. Backfill flow MUST show TWO cost previews — Phase 10's filtering cost (zero, native Rust) AND Phase 11's distillation cost ($0.005-0.02 per episode × estimated episode count).
2. Default backfill to ONE session (the most recent); user must explicitly opt into more.
3. Distiller cost rate: ~6,000 input tokens (filtered_text) + 1,500 output tokens (typed nodes JSON) × $0.001 / 1M (Haiku-4-5) ≈ $0.008 per episode. Document in CONTEXT-MD distiller cost section.
4. Footer status shows running estimated total cost; user can pause queue.

**Warning signs:** Backfill takes hours to complete; Anthropic dashboard shows unexpected daily spike.

### Pitfall 6: Race between distiller and Phase 12 supersession

**What goes wrong:** Distiller writes substrate_node A with `valid_at = T1`; Phase 12's fact_engine fires concurrently on the new node, sees A contradicts existing B, sets `B.invalid_at = T1`; meanwhile distiller's next call for the same session writes substrate_node C; fact_engine fires on C, but A was set with `invalid_at = NULL` and a contradiction is detected with C, so A gets invalidated; but distiller's per-session lock didn't span the supersession run.

**Why it happens:** Distiller lock scope is per-session; supersession lock scope is per-uuid (`DriftLocks::for_uuid(new_uuid)`). They don't compose.

**How to avoid:**
1. Per Phase 12 RESEARCH (Pattern 2): supersession runs SYNCHRONOUSLY at the end of distiller's upsert path, INSIDE the per-session lock.
2. Phase 11's distiller calls `crate::supersession::fact_engine::invalidate_contradicted(app, &new_uuid).await?` after each substrate node upsert, before releasing the session lock.
3. This makes distiller-and-supersession a single atomic episode operation. Phase 12 already specs this composition.

**Warning signs:** Beat 3 orange-flag fixture not firing in tests; supersession recall < 80% on adversarial fixtures.

### Pitfall 7: Click `[source]` token before Phase 13 ships chat archaeology

**What goes wrong:** User clicks `[source]` token in composing overlay → expects to see the source session turn → sees nothing (or a broken IPC call).

**Why it happens:** Phase 13 owns chat archaeology (SUB-08 SC 3); Phase 11 ships the click handler stub that fires a toast.

**How to avoid (CONTEXT lock):** Phase 11 click handler emits `app.emit("source:click", {...})` and shows a toast `source: <session_id> turn <turn_ref>`. Phase 13 wires the actual modal. Frontend stub is intentional dev-visibility, not a regression.

**Warning signs:** User reports "click does nothing" — verify toast appears, not silent.

### Pitfall 8: Contract body too long for LLM rerank prompt

**What goes wrong:** Long contracts (Phase 8 rollup-stale L0 with 1500-token body) blow past the rerank prompt's input window or cause expensive token counts.

**Why it happens:** Phase 8 rollup contracts can grow large; lineage scope context can also be substantial.

**How to avoid:**
1. Truncate contract body to 800 chars in rerank prompt (the LLM has the contract intent in the candidate `applies_when` field anyway).
2. Lineage scope = uuids only, NOT bodies. The rerank prompt names the lineage as `"contract is about Account Settings → Danger Zone"` — short text.
3. Cap rerank input candidates at 15 (already specced).

**Warning signs:** Rerank latency > 5s; cost per dispatch > $0.05.

### Pitfall 9: Beat 4 harvest-back not firing within demo timing window

**What goes wrong:** Phase 11 distiller runs on the agent's session JSONL but takes >10s; the "3 new substrate nodes animate in" demo moment misses cue.

**Why it happens:** Phase 10 watcher latency (~1s) + Phase 11 distiller (~3-5s) + UI animation (~1s) = 5-7s. If any link is slow, the harvest-back animation arrives after the demo cuts to Close.

**How to avoid:**
1. Pre-warm `claude -p` at app start (same as Pitfall 3 fix).
2. Distiller has a "fast path" for the agent's own session: skip embedding generation if Phase 9's mass-edit reuse isn't required for this session (Phase 11's distiller doesn't NEED embeddings to write the substrate node — it only needs the JSON output).
3. Delay the harvest-back animation by 8s post-Approve to give the pipeline a buffer.
4. **Demo backstop:** if distiller misses, hardcode the 2 new substrate nodes (`con-cascade-revoke-tokens-on-org-delete-2026-04-25`, `dec-owner-orphan-check-2026-04-25`) in a fixture and animate from fixture if real distillation hasn't completed by 10s post-Approve. Same fixture-fallback pattern as decisions.json.

**Warning signs:** Beat 4 timing slips; harvest-back doesn't appear during animation window.

---

## Code Examples

### Example 1: Distiller prompt (adapted from kernel-experiment for 5 typed kinds)

```markdown
# Substrate Distillation Prompt

You are extracting reusable SUBSTRATE NODES from a software-development session transcript.

## What is a substrate node

A typed observation that should guide future work on this codebase. Substrate nodes are
**reusable** — they would save time or prevent bugs if automatically surfaced to a future
agent on a relevant task.

Five node types:

- **constraint**: A rule that must hold (e.g., "Always canonicalize file paths from JS in Rust commands")
- **decision**: A choice the team made and committed to (e.g., "We use soft-delete with 30-day grace")
- **open_question**: A question raised but not resolved in this session (e.g., "Should we cache contract bodies in MCP?")
- **resolved_question**: A question raised AND answered in this session (e.g., "Q: Use shadcn-Tabs? A: No, button strips")
- **attempt**: A pattern that was tried but didn't fully work — useful as a "don't repeat this exactly" signal

## Output schema

For each substrate node, emit ONE JSON object matching:

```json
{
  "type": "constraint" | "decision" | "open_question" | "resolved_question" | "attempt",
  "text": "imperative or declarative statement, ONE sentence",
  "scope": "global" | "module:<path-pattern>" | "task-pattern:<short>",
  "applies_when": "semantic trigger for retrieval — be specific enough to avoid false positives, broad enough to catch paraphrases",
  "source": {
    "quote": "verbatim quote from transcript justifying this node",
    "actor": "user" | "claude" | "derived"
  },
  "confidence": "explicit" | "inferred"
}
```

## Quality bar

Each substrate node should answer: "Would I want this injected automatically into a future
session whose goal matches `applies_when`?" If no, drop it.

For constraint and decision nodes, prefer fewer high-quality nodes over many low-quality ones.

For open_question and resolved_question nodes, capture them whenever a question gets raised
or settled — these are higher-volume but cheap to keep.

## Input transcript

<transcript>
{filtered_text}
</transcript>

Output: a JSON object `{"nodes": [...]}` containing all substrate nodes you extracted.
```

### Example 2: SQL — current-truth retrieval with lineage scope

```sql
-- Source: Pattern 3 above + Phase 12 fact_engine current-truth pattern
-- Find all current-truth substrate nodes whose applies_when matches a contract's intent text,
-- scoped to the contract's lineage (parent + ancestors + siblings).

WITH RECURSIVE lineage(uuid) AS (
    -- Anchor + ancestors
    SELECT uuid FROM nodes WHERE uuid = ?1
    UNION ALL
    SELECT n.uuid FROM nodes n
    JOIN lineage l ON l.uuid IN (SELECT uuid FROM nodes WHERE parent_uuid = l.uuid)
    -- (Recursive ancestors via parent_uuid follow-up)
),
siblings AS (
    SELECT s.uuid
    FROM nodes s
    JOIN nodes target ON target.uuid = ?1
    WHERE s.parent_uuid = target.parent_uuid
      AND s.uuid != target.uuid
)
SELECT s.uuid, s.text, s.applies_when, s.scope, s.confidence,
       s.source_session_id, s.source_turn_ref, s.source_quote, s.source_actor,
       s.node_type
FROM substrate_nodes s
JOIN substrate_nodes_fts fts ON fts.uuid = s.uuid
WHERE s.invalid_at IS NULL
  AND substrate_nodes_fts MATCH ?2  -- contract intent text
ORDER BY fts.rank
LIMIT 15;
```

### Example 3: TS — fastembed-js for AllMiniLM-L6-v2 (Plan 11-04 stretch)

```typescript
// File: contract-ide/mcp-sidecar/src/embeddings.ts
// Source: fastembed-js npm docs (https://github.com/Anush008/fastembed-js)
// Pinned: AllMiniLM-L6-v2 (384-dim, fully local, no API key)
import { FlagEmbedding, EmbeddingModel } from 'fastembed';

let _model: FlagEmbedding | null = null;

async function getModel(): Promise<FlagEmbedding> {
  if (!_model) {
    _model = await FlagEmbedding.init({
      model: EmbeddingModel.AllMiniLML6V2,
      maxLength: 512,
      // Cache the ONNX model under the user's app-data dir
      cacheDir: process.env.CONTRACT_IDE_CACHE_DIR ?? '~/.contract-ide/cache',
    });
  }
  return _model;
}

export async function embed(texts: string[]): Promise<Float32Array[]> {
  const model = await getModel();
  const embeddings: Float32Array[] = [];
  for await (const batch of model.embed(texts, 16 /* batch size */)) {
    embeddings.push(...batch);
  }
  return embeddings;
}

// Cosine similarity for query-time ranking (sub-1ms at 50-vector scale)
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
```

### Example 4: TS — `find_constraints_for_goal` MCP tool

```typescript
// File: contract-ide/mcp-sidecar/src/tools/find_constraints_for_goal.ts
// Source: synthesized from Phase 5 find_by_intent.ts pattern + Pattern 3 retrieval algorithm
import { getDb } from '../db';
import { embed, cosineSimilarity } from '../embeddings';

interface SubstrateHit {
  uuid: string;
  type: string;
  text: string;
  applies_when: string;
  scope: string | null;
  confidence: 'explicit' | 'inferred';
  source_session_id: string | null;
  source_turn_ref: number | null;
  source_quote: string | null;
}

export async function findConstraintsForGoal(intent: string, limit: number = 5) {
  const db = getDb();

  // Step 1: FTS5 candidates (top-15)
  const ftsRows = db
    .prepare(
      `
      SELECT s.uuid, s.text, s.applies_when, s.scope, s.confidence,
             s.source_session_id, s.source_turn_ref, s.source_quote, s.node_type
      FROM substrate_nodes_fts fts
      JOIN substrate_nodes s ON s.uuid = fts.uuid
      WHERE substrate_nodes_fts MATCH ?
        AND s.invalid_at IS NULL
        AND s.node_type = 'constraint'
      ORDER BY fts.rank
      LIMIT 15
      `,
    )
    .all(intent) as SubstrateHit[];

  if (ftsRows.length === 0) {
    return { content: [{ type: 'text' as const, text: `No constraints found matching: ${intent}` }] };
  }

  // Step 2 (optional embedding boost — only if substrate_embeddings table populated):
  // ... cosine similarity over substrate_embeddings.vector (deferred for stretch)

  // Step 3: For find_constraints_for_goal — return top-`limit` directly (no LLM rerank;
  //         that's reserved for Delegate flow). MCP tools are called by agents and need
  //         to be cheap.

  const top = ftsRows.slice(0, limit);
  const text = top.map((r, i) =>
    `[${i + 1}] ${r.text}
   applies_when: ${r.applies_when}
   confidence: ${r.confidence} | source: ${r.source_session_id ?? 'none'}:${r.source_turn_ref ?? '?'}`
  ).join('\n\n');

  return { content: [{ type: 'text' as const, text }] };
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Free-form LLM JSON parsing with regex | `claude -p --json-schema <schema>` (Anthropic CLI verified 2026-04) | 2026 | No defensive parsing; schema validated at boundary; structured_output field available |
| sqlite-vss (FAISS-backed) | sqlite-vec (pure C, vec0 virtual table) | 2024 | sqlite-vss deprecated; sqlite-vec is the maintained successor — but ABI mismatches with better-sqlite3 12.x are a known footgun (Issues #65156 / #66977) |
| Single-stage retrieval (FTS5 OR vector) | Hybrid FTS5 + vector with RRF (k=60) | 2024+ | RRF k=60 is industry standard (Microsoft, OpenSearch, Pinecone); 91% recall@10 vs 65-78% single-stage |
| Single-pass agent execution | Two-pass (planning → approval → executing) | 2026 (this phase) | Audience sees agent reasoning explicitly before files change; Beat 1 narration pivot |
| ANTHROPIC_API_KEY for LLM calls | `claude -p` subprocess (subscription auth) | 2026 (Phase 6 pivot) | No env var management; user's Pro/Max subscription carries through |

**Deprecated/outdated:**
- **sqlite-vss**: sqlite-vec is the successor; sqlite-vss deprecated by author (asg017)
- **Free-form `claude -p` for structured output**: `--json-schema` is now the recommended path
- **MCP SDK v1 → v2 migration**: v2 still pre-alpha as of 2026-04; v1.29.0 remains current (verified during Plan 05-01)

---

## Open Questions

1. **Is the kernel-experiment extraction prompt sufficient for 5 typed kinds, or does each kind need its own prompt?**
   - What we know: kernel experiment used a single prompt that produced both `explicit` and `inferred` constraints (the `confidence` field captures the difference). The prompt's instructions for "what is a constraint" are tight; expanding to 4 more kinds (decision, open_question, resolved_question, attempt) within ONE prompt may dilute precision.
   - What's unclear: whether single-prompt-multi-type yields ≥5 nodes per session at the same precision as kernel experiment's 7+7. Multi-prompt-per-type doubles LLM cost.
   - Recommendation: **Plan 11-01 ships single-prompt-multi-type with the expanded prompt in Example 1 above.** Plan 11-04 UAT measures: if SC 1 (≥5 nodes per session) fails on 3 representative sessions, fall back to per-kind prompts in a follow-up plan. Anthropic Cookbook precedent (Haiku for high-volume, single-schema-prompt approach) supports the single-prompt direction.

2. **Should embeddings be generated for `text` or `applies_when`?**
   - What we know: kernel experiment's 4/4 retrieval scored by walking each constraint's `applies_when` against goal text — `applies_when` IS the retrieval surface. The schema docs say so explicitly.
   - What's unclear: whether the contract body intent (the QUERY side) embeds against the constraint's `applies_when` (target side) symmetrically. Different field types may compose poorly.
   - Recommendation: **embed both `text` and `applies_when`** (concatenated with " ; " separator). Total stored = ~1.5KB Float32 BLOB per node. Adds ~30% storage but gives a cleaner semantic surface. Phase 11-04 dev validates against the kernel experiment retrieval test (must score 4/4 minimum).

3. **What's the right rerank prompt format — listwise (return ranked indices) or pointwise (score each candidate)?**
   - What we know: listwise (rank all 15 in one call) is what Pinecone, LlamaIndex, and the Anthropic Cookbook recommend for top-K reranking. Single LLM call; cheaper than pointwise.
   - What's unclear: whether the model occasionally outputs invalid indices (e.g., out-of-bounds, duplicates) under listwise. Defensive parsing should catch but not eliminate.
   - Recommendation: **Use listwise (Example 1 in Pattern 3 above).** Defensive parser truncates invalid indices and falls back to the original FTS5 ordering for the missing slots.

4. **Phase 9 mass-edit and Phase 11 retrieval — share the same `find_substrate_for_atom` Rust IPC, or split?**
   - What we know: Phase 9 mass-edit ranks NODES by intent; Phase 11 retrieval ranks SUBSTRATE NODES by contract intent. Different consumers, different rankings.
   - What's unclear: whether the rerank prompt is shared (probably yes — same listwise pattern) or separate.
   - Recommendation: **Share the candidate-selection step (FTS5 + RRF + embedding cosine), split the rerank prompt.** Plan 11-03 exports `retrieval::candidates::candidate_selection(scope_uuids, query, limit)` as a public Rust function that Phase 9 can also call. Reranking is consumer-specific.

5. **`--bare` mode and CLAUDE.md interaction — can the distiller see project-level skills/MCP that would help extraction?**
   - What we know: `--bare` skips MCP discovery, CLAUDE.md, skills, plugins, auto-memory. Faster, deterministic.
   - What's unclear: whether the distiller benefits from project context (e.g., "this repo uses Tailwind v4" in CLAUDE.md helps the distiller phrase `applies_when` correctly).
   - Recommendation: **Use `--bare` for distiller (deterministic + cheap), skip CLAUDE.md.** The episode's `filtered_text` already contains all the conversational context the distiller needs. Add `--append-system-prompt` if specific framing is needed; don't load full CLAUDE.md.

6. **Beat 4 timing — can the distiller-on-agent's-own-session run synchronously enough to fire harvest-back animation?**
   - What we know: Phase 10 watcher latency ~1s; distiller cost ~3-5s. Total ~4-6s for harvest-back. Demo Beat 4 has ~8s of harvest-back animation budget.
   - What's unclear: whether the latency holds during a full demo run (warm cache, load on the laptop, recording overhead). Plan 11-04 must validate end-to-end.
   - Recommendation: **demo backstop fixture** (Pitfall 9): if real distillation hasn't completed by 10s post-Approve, hardcode-animate the 2 new substrate nodes from `.contract-ide-fixtures/substrate/beat4-harvest.json`. Same fallback discipline as decisions.json.

---

## Sources

### Primary (HIGH confidence)

- `.planning/research/constraint-distillation/` — kernel experiment validating 14/14 constraint extraction, 4/4 retrieval, single-prompt strategy, JSONL filtering. **Authoritative for distiller prompt + schema.**
- `.planning/phases/10-session-watcher-filter-pipeline/10-RESEARCH.md` — Phase 10 schema (`sessions`, `episodes`), filter logic, episode chunking, cwd-key derivation. **Authoritative for upstream pipeline.**
- `.planning/phases/12-conflict-supersession-engine/12-RESEARCH.md` — Phase 12 schema expectations for `substrate_nodes` bitemporal columns, supersession engine integration points. **Coordination doc.**
- `.planning/phases/08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation/08-04a-PLAN.md` — Phase 8 `run_agent` Rust runner. **Reuse mandatory.**
- `.planning/demo/presentation-script.md` — locked demo script for Beat 1 (Delegate button), Beat 2 (recorded comparison), Beat 4 (harvest-back), Close. **Source of truth for narration timing + content.**
- `.planning/demo/scenario-criteria.md` § Committed Scenario — full schema of the 5 substrate decisions, their narrative origin, the 2 Beat 4 harvest-back rules.
- `.planning/CANVAS-PURPOSE.md` — implicit-decisions manifest narrow slice spec (3 rows hand-crafted for the 2 demo atoms).
- [Anthropic Cookbook: Knowledge graph construction with Claude](https://platform.claude.com/cookbook/capabilities-knowledge-graph-guide) — Haiku for extraction + Sonnet for synthesis, `--json-schema` validation, provenance tracking pattern.
- [Anthropic CLI: headless mode](https://code.claude.com/docs/en/headless) — `--output-format json`, `--json-schema`, `--bare`, `--append-system-prompt`. Verified 2026-04.
- [SQLite hybrid search RRF pattern (Alex Garcia 2024)](https://alexgarcia.xyz/blog/2024/sqlite-vec-hybrid-search/index.html) — k=60 RRF default, full SQL pattern verified.
- [Graphiti bitemporal pattern (Zep, getzep/graphiti)](https://github.com/getzep/graphiti) — `valid_at`/`invalid_at`/`expired_at`/`created_at` semantics; Phase 12 RESEARCH cross-verifies.
- `contract-ide/mcp-sidecar/src/tools/find_by_intent.ts` — verified FTS5 query pattern; Phase 11 mirrors verbatim.
- `contract-ide/src-tauri/src/db/migrations.rs` — verified migration immutability rule + dynamic-version-detection pattern from Phase 10.

### Secondary (MEDIUM confidence)

- [sqlite-vec (asg017/sqlite-vec)](https://github.com/asg017/sqlite-vec) — current vector extension; verified KNN syntax, distance metrics (`vec_distance_cosine`), Node.js installation (`sqliteVec.load(db)`).
- [fastembed-js (Anush008/fastembed-js)](https://github.com/Anush008/fastembed-js) — local CPU embeddings via ONNX runtime; AllMiniLM-L6-v2 supported.
- [LLM listwise rerank patterns (Pinecone, LlamaIndex 2026)](https://www.pinecone.io/learn/series/rag/rerankers/) — top-15 → top-5 pattern; output JSON array of indices; defensive parsing.
- [Reciprocal Rank Fusion k=60 (Microsoft Azure, OpenSearch)](https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking) — k=60 industry default; performs well across datasets.
- [Anthropic SDK token tracking docs](https://code.claude.com/docs/en/agent-sdk/cost-tracking) — `usage.input_tokens` / `output_tokens` / cache fields verified.

### Tertiary (LOW confidence)

- sqlite-vec ABI compatibility with better-sqlite3 12.x — community-reported issues (#65156, #66977) suggest mismatches; not definitively verified against contract-ide's specific better-sqlite3 version. **Recommend Float32 BLOB v1 path; revisit if substrate scales >5k nodes.**
- AllMiniLM-L6-v2 dimension (384) — verified from MTEB leaderboard but not from a Rust/Node.js inference run inside contract-ide. **Plan 11-04 dev validates with a hello-world embed.**
- Beat 4 harvest-back end-to-end latency — extrapolated from Phase 10 + Phase 11 component latencies; not measured in a real demo rehearsal. **Plan 11-04 UAT must measure on actual demo laptop.**

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dep already shipped or pattern verified
- Architecture (distiller pipeline + retrieval + Delegate state machine): HIGH — patterns verified against Phase 7/8/10 + kernel experiment
- Bitemporal schema: HIGH — coordinated with Phase 12 (12-RESEARCH.md cross-references); Graphiti pattern verified
- Pitfalls: HIGH — synthesized from kernel experiment + Phase 7/8/10 lessons + 2026 LLM-distillation literature
- Code examples: MEDIUM — patterns are sound; exact API surface (e.g., `claude -p --json-schema` field shape) verified from Anthropic 2026-04 docs but not exercised inside contract-ide yet
- Beat 4 harvest-back timing: MEDIUM — extrapolated from component latencies; demo backstop (fixture fallback) recommended as insurance
- sqlite-vec stretch goal: LOW — Float32 BLOB + TS cosine recommended for v1; sqlite-vec only if scale demands

**Research date:** 2026-04-24
**Valid until:** 2026-05-24 (30 days) — stable domain. Revalidate if (a) Anthropic CLI `--json-schema` semantics change, (b) Phase 9 picks a different embedding model, (c) Phase 12 schema additions diverge from `substrate_nodes` shape locked here.
