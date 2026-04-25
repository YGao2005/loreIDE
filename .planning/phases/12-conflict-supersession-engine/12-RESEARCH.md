# Phase 12: Conflict / Supersession Engine - Research

**Researched:** 2026-04-24
**Domain:** Bitemporal substrate · Graphiti-pattern fact invalidation · intent-level (L0→L4) priority-shift propagation · semantic candidate selection (FTS5 + LLM rerank) · adversarial regression harness
**Confidence:** HIGH on the Graphiti bitemporal pattern (verified against `getzep/graphiti/graphiti_core/utils/maintenance/edge_operations.py` + OpenAI Cookbook temporal-agents schema + Zep blog) · HIGH on LLM-judge feasibility (already validated 9/10 in `.planning/research/intent-supersession/`) · HIGH on Phase 8 reuse seams (per-UUID Tokio mutex, rollup walker, watcher) · MEDIUM on candidate-selection latency at 500-node scale (FTS5 sub-100ms is verified at 100 nodes; embeddings deferred per Phase 9 decision) · LOW on Phase 11's exact `substrate_nodes` schema (Phase 11 not yet planned — must coordinate)

> **CRITICAL UPSTREAM DEPENDENCY:** Phase 11 ships `substrate_nodes` + `substrate_edges` + the bitemporal columns (`valid_at`, `invalid_at`, `expired_at`, `created_at`). Phase 12 layers the supersession ENGINE on top — but Phase 11's schema decisions constrain Phase 12 directly. If Phase 11's schema diverges from this research, Phase 12 plans MUST be re-validated. Recommend: Phase 11 RESEARCH.md should reference this doc back; this doc speaks the schema authoritatively, but Phase 11 owns the migration.

> **CRITICAL REQUIREMENT GAP:** SUB-06 and SUB-07 are referenced in `.planning/ROADMAP.md` Phase 12 (line 224) but DO NOT yet appear in `.planning/REQUIREMENTS.md`. They are tagged for the next `/gsd:new-milestone` pass. This research synthesizes their content from ROADMAP success criteria + VISION.md "supersession (the moat)" section. Planner MUST flag this gap and either (a) defer until SUB-06/SUB-07 are properly added, or (b) cite ROADMAP as the canonical source and add the requirements during planning.

<phase_requirements>
## Phase Requirements

| ID | Description (synthesized from ROADMAP + VISION) | Research Support |
|----|-------------------------------------------------|------------------|
| **SUB-06** | Fact-level supersession (Graphiti pattern): when the distiller ingests a substrate node that contradicts an existing one, the system invalidates the stale node (sets `invalid_at = new.valid_at` and `expired_at = utc_now()`) rather than deleting it; emits a `supersedes` edge from new → stale; current-truth queries filter via `WHERE invalid_at IS NULL`; history queries return both nodes ordered by `valid_at`. Adversarial test passes recall ≥ 80%, precision ≥ 85% on 5 synthetic contradictions of varying semantic distance. | Graphiti `edge_operations.py::resolve_edge_contradictions` + the dedupe/invalidation prompt template (verified against `getzep/graphiti` repo). 9/10 already validated in `.planning/research/intent-supersession/`. Pattern 1 below specifies exact schema fields. |
| **SUB-07** | Intent-level supersession (the moat): when an L0 contract priority shifts (a "priority-shift event" — the new L0 supersedes the old), every transitively rollup-linked decision substrate node flips to `intent_drifted` within one ingestion cycle. The intent-drift judge prompt is the validated prompt at `.planning/research/intent-supersession/prompt.md`. Three-way verdict (`DRIFTED` / `NOT_DRIFTED` / `NEEDS_HUMAN_REVIEW`) with confidence threshold for auto-apply / surface / noise-filter. A "priority-shift impact preview" displays `N nodes will flip` before applying — safeguard against typo / wrong-scope priority shifts. | Validated 9/10 at `.planning/research/intent-supersession/evaluation.md` (results.txt + fixtures.json). Phase 8 PROP-02 `compute_rollup_and_emit` engine + ancestor-walk pattern reused. Verified novel against literature (no prior art for hierarchical L0-priority-shift cascade — see "State of the Art" below). |
</phase_requirements>

## Summary

Phase 12 codifies what `.planning/research/intent-supersession/` already validated: the moat claim (intent-level supersession driven by L0-priority shifts) is tractable with single-shot LLM judgment, adversarial-keyword-match noise is rejected by the validated prompt, and a three-way verdict + confidence score gives a natural triage UI. Fact-level supersession ships first as a *direct port* of Graphiti's `resolve_edge_contradictions` algorithm (verified against the open-source Python implementation at `getzep/graphiti`). Intent-level supersession ships second as a NEW engine that rides Phase 8's shipped `compute_rollup_and_emit` + per-UUID `DriftLocks` Tokio mutex machinery — same walker pattern, different judge.

The phase is conservative architecturally — no new infrastructure beyond the Phase 11 substrate schema and the Phase 8 propagation engine. The risk is *integration-and-cost*, not invention. Specifically: (a) candidate selection before LLM call (Phase 11 will ship FTS5 over `substrate_nodes`; embeddings stretch goal per Phase 9 deferral), (b) cost at scale (500-node × per-shift × ~700 input tokens × $0.003/1k = ~$1/shift via subscription auth — manageable, not free), (c) the priority-shift impact preview gate (load-bearing safeguard surfaced by 9/10 evaluation report).

The demo-required slice is small: a *staged* orange-flag fixture for Beat 3 (parent surface holds `con-settings-no-modal-interrupts-2025-Q4` under superseded `reduce-onboarding-friction` priority). The roadmap explicitly allows hardcoding the demo flag against the seeded priority-shift state if the full propagation engine slips. The full engine is the moat; the staged fixture is the demo. **Both must be planned, but only one must work end-to-end on stage.**

**Primary recommendation:** Split Phase 12 into 4 plans: (12-01) substrate schema additions for supersession (`invalid_at`, `expired_at`, `intent_drifted` state, `supersedes` edge, `priority_shifts` log table, `intent_drift_verdicts` derived table); (12-02) fact-level invalidation engine — port `resolve_edge_contradictions` (Graphiti-style invalidation prompt, FTS5 candidate selection, write `invalid_at` + `expired_at` + emit `supersedes` edge under per-UUID Tokio mutex); (12-03) intent-level cascade engine — `record_priority_shift` IPC, `propagate_intent_drift` Tauri command that walks rollup edges and runs the validated `prompt.md` judge per descendant decision node, three-way verdict persistence, "impact preview" gate before apply; (12-04) adversarial regression harness + history-query MCP tool + Phase 12 E2E UAT including Beat 3 fixture verification. Adversarial fixtures from `.planning/research/intent-supersession/fixtures.json` are the regression-test baseline — recall ≥ 80%, precision ≥ 85% lives in `cargo test`.

## Standard Stack

### Core (Locked — Already Shipped or Strict Constraint)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `tokio::sync::Mutex` via `DriftLocks` | (existing — Phase 7) | Per-UUID serialization of supersession writes; ingest-LLM-judge writes serialize against any rollup/drift writes for the same `substrate_node` UUID | Phase 7 + 8 already shipped this; STATE.md confirms the cross-engine invariant |
| `compute_rollup_and_emit` engine + ancestor walker | (Phase 8 PROP-02 — landing) | Intent-cascade walker reuses the SAME parent-walk infrastructure: when an L0 priority shifts, walk down through `rollup_inputs` edges to all transitively linked decision substrate nodes | Already specified in `08-02-PLAN.md`; "no retroactive changes" mandate from PROPAGATION.md |
| FTS5 `nodes_fts` virtual table | (Phase 1 DATA-06 — shipped) | Candidate selection BEFORE LLM contradiction-judge call — replaces a "compare new node against ALL existing nodes" loop with FTS5 MATCH ranked top-K | DATA-06 already shipped; Phase 11 will extend with a `substrate_nodes_fts` virtual table; Phase 12 reuses the pattern |
| `tauri-plugin-shell` → `claude -p` | (existing — Phase 6 derivation pivot) | LLM judge for invalidation prompt + intent-drift prompt — runs `claude -p "<prompt>"` over stdin, parses JSON response | No `ANTHROPIC_API_KEY` required (subscription auth); same pattern as Phase 6 derivation pivot, Phase 11 distiller, Phase 8 draft-propagation |
| `serde_json` | (existing) | Three-way verdict JSON parsing (`{verdict, reasoning, confidence}`) per validated `prompt.md` | Already shipped |
| `chrono` | (existing — Phase 7) | RFC3339 ISO-8601 timestamps for `valid_at`, `invalid_at`, `expired_at` (UTC enforced — Graphiti issue #893 lineage: timezone-naive datetime comparisons are a known footgun) | Already shipped; use `chrono::Utc::now().to_rfc3339()` everywhere |
| `sha2` (existing) | (existing — Phase 6/7) | Generation/version hash on priority-shift events for idempotency | Already shipped |
| `sqlx` 0.8 | (existing) | Direct dep for `substrate_nodes` / `substrate_edges` reads + `priority_shifts` writes | Already direct dep — Phase 2 added it |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Existing `mcp-sidecar` MCP server | n/a | New MCP tools `find_substrate_history(node_id)` (returns ordered `valid_at` history), `record_priority_shift(old_l0, new_l0, valid_at)`, `current_truth_query(scope?)` | Already running; uses better-sqlite3 read-only client; writes go through Rust IPC per single-writer rule |
| `BTreeSet` / sorted Vec | (Rust stdlib) | De-duplication of candidates returned by FTS5 (when multiple FTS hits map to same `substrate_node` UUID) | Use when constructing candidate list before LLM call |
| MCP `claude -p` JSON output mode | n/a | Run judge with `--output-format json` for parseable response (vs. plain text); already used by Phase 8 distiller plan via Phase 11 | Verify with Plan 12-02 Day-1 spike using the validated `prompt.md` against the 5-fixture set |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| FTS5 candidate selection | Embedding cosine over `applies_when` field | Embeddings give better semantic recall but Phase 9 explicitly deferred the embedding pipeline (`EMBEDDING_DISABLED` flag, keyword-only fallback per MASS-01 spec). FTS5 is sufficient for hackathon-scale demos and matches the pattern already shipped. v2 stretch: layer embeddings via `transformers.js` in MCP sidecar. **Reject for v1.** |
| Single-shot LLM judge per pair | Batch judge across N candidates (one LLM call per ingestion) | Batch reduces LLM calls 10× but loses per-judgment confidence calibration. The validated batch-prompt.txt did demonstrate batch works (10 decisions in one prompt; 9/10 match). **Use batch where possible** — for fact-level, batch the candidates returned by FTS5 (typically 3–10) into one LLM call; for intent-cascade, batch the descendants of the priority shift into chunks of 10–20 per call. |
| `WHERE invalid_at IS NULL` filter on every read | Materialized view of "current truth" rebuilt on every ingest | Materialized view is faster for reads but introduces the same bootstrap-storm anti-pattern Phase 8 PROPAGATION.md flagged. **Stick with `WHERE invalid_at IS NULL` filter** — SQLite's index optimizer handles it cheaply if the column is indexed. Add `idx_substrate_nodes_active ON substrate_nodes(invalid_at) WHERE invalid_at IS NULL` (partial index). |
| Auto-apply intent-drift verdicts | Always-surface for human review | Auto-apply at confidence ≥ 0.85 is the validated recommendation in `evaluation.md`; surface 0.50–0.85 + `NEEDS_HUMAN_REVIEW`; filter < 0.50 as noise. **Use the calibration scale.** Rationale: 9/10 evaluation showed clear bimodal confidence distribution — clear flags ≥ 0.85, judgment calls ≤ 0.65. |
| `expired_at` always set when `invalid_at` is set | `expired_at` only on database-side invalidation, `invalid_at` on real-world facts | Per Graphiti pattern: `expired_at = utc_now()` (when DB realized the contradiction); `invalid_at = new.valid_at` (when fact stopped being true in real-world time). **Two distinct timestamps.** Set `expired_at` ONLY on the contradiction-driven path; user-driven manual invalidation also sets both but with `expired_at = invalid_at`. |
| `supersedes` edge as REFERENCES-style FK | `supersedes` edge in `substrate_edges` table (typed) | Phase 11 ships `substrate_edges` with `edge_type` column already; reuse it. **Use `substrate_edges` row with `edge_type = 'supersedes'`** — same pattern as Phase 11 `implements`/`contradicts`/`references` edges per VISION.md. |
| Single-monolithic priority shift record | One row per (old_l0_id → new_l0_id) transition | Need history of priority shifts (e.g., Q4-2025 `reduce-friction` → 2026-04-24 `compliance-first` from `presentation-script.md`). **One row per transition** in a new `priority_shifts` table; carries `valid_at`, `summary_of_old`, `summary_of_new`, `applied_at`. |

**Installation (only the new pieces):**
```toml
# src-tauri/Cargo.toml — NO new deps required
# All Phase 12 mechanics use already-shipped crates (chrono, sqlx, serde_json, sha2, tokio)
```

```bash
# mcp-sidecar/package.json — NO new deps required
# Three new MCP tools (find_substrate_history, record_priority_shift, current_truth_query)
# all use existing better-sqlite3 + zod + child_process patterns
```

## User Constraints (synthesized; no CONTEXT.md exists yet)

> Phase 12 has no `12-CONTEXT.md` — `/gsd:discuss-phase 12` has not been run. The constraints below are SYNTHESIZED from `.planning/research/intent-supersession/evaluation.md` (Yang's own validated recommendations), the demo script, the roadmap planning notes, and the prior-phase context discipline. The planner SHOULD run `/gsd:discuss-phase 12` first to lock these as user decisions before plans land. If skipped, treat the items below as DEFAULTS, not user-locked decisions.

### Defaults (treat as Claude's discretion until CONTEXT.md exists)

- Three-way verdict scheme `DRIFTED | NOT_DRIFTED | NEEDS_HUMAN_REVIEW` with confidence ≥ 0.85 auto-apply / 0.50–0.85 surface / < 0.50 filter (per `evaluation.md` recommendation 1)
- "Priority-shift impact preview" gate showing `N nodes will flip` before applying (per `evaluation.md` recommendation 2 — "needs a safeguard")
- Transitive drift (cascade through decisions built on top of intent-drifted decisions) is v2.5; v1 stops at depth-1 from priority shift (per `evaluation.md` failure mode 3 — "Transitive drift… didn't test chains")
- Cost target: ≤ $1 per priority-shift event at 500-node scale via subscription `claude -p` auth (per `evaluation.md` failure mode 1)
- Validated prompt at `.planning/research/intent-supersession/prompt.md` is THE prompt — do not re-explore variations; codify it
- Adversarial fixture set at `.planning/research/intent-supersession/fixtures.json` (5 cases — already 9/10 match) is the regression baseline; new test files only EXTEND, never replace
- Demo-required slice may be a HARDCODED orange flag against the seeded `con-settings-no-modal-interrupts-2025-Q4` fixture if the full engine slips (per ROADMAP planning notes line 233) — Plan 12-04 owns this fallback

### Demo-Load-Bearing (must work end-to-end before Phase 13)

- The Beat 3 verifier output (line 154–166 of `presentation-script.md`) shows ONE orange flag against the parent surface — this is the literal moat-claim moment. Phase 12 either delivers it from the engine OR via a Phase 12-04 hardcoded path against the seeded priority-shift fixture
- The Beat 3 engineer resolution (line 167–169) requires the orange flag to clear and a scope-narrowing note to land in substrate — Phase 12-03 / 12-04 must wire the "Accept with note" affordance even if the engine is mocked

### Out of Scope (defer to v3 unless explicitly requested)

- Auto-application of intent-drift verdicts WITHOUT user confirmation (always show impact preview first)
- Transitive intent-drift propagation past depth-1 from the priority shift (cascade through intent-drifted decisions to OTHER decisions built on top of them)
- Multi-machine priority-shift sync — single-user local-first per VISION.md, mirroring Phase 8 concurrency story
- Partial drift (decision is half-drifted; same code pattern, different parameters) — three-way verdict doesn't capture nuance per `evaluation.md` failure mode 4
- Embedding-based candidate selection (FTS5 sufficient for hackathon scale; v2 carry-over per Phase 9 09-RESEARCH.md decision)
- Substrate UI surface (Phase 13 ships canvas substrate-state overlay with red > orange > amber > gray precedence — Phase 12 only EMITS the state, doesn't render it)

## Architecture Patterns

### Recommended Project Structure (Net-New Files)

```
contract-ide/
├── src-tauri/src/
│   ├── supersession/                       # NEW MODULE — fact + intent supersession engines
│   │   ├── mod.rs                          # NEW — pub-mod re-exports
│   │   ├── fact_engine.rs                  # NEW — Graphiti-style invalidation (port of resolve_edge_contradictions)
│   │   ├── intent_engine.rs                # NEW — L0-priority-shift cascade walker
│   │   ├── candidate_selection.rs          # NEW — FTS5 over substrate_nodes (top-K)
│   │   ├── prompt.rs                       # NEW — invalidation + intent-drift prompts (verbatim from research/intent-supersession/)
│   │   └── verdict.rs                      # NEW — { DRIFTED, NOT_DRIFTED, NEEDS_HUMAN_REVIEW } enum + confidence parser
│   ├── commands/
│   │   ├── supersession.rs                 # NEW — Tauri commands: record_priority_shift, propagate_intent_drift, find_substrate_history, current_truth_query
│   │   └── mod.rs                          # EXTEND
│   └── lib.rs                              # EXTEND — register new commands
│
├── src-tauri/migrations/                   # NEW migration file (or shared with Phase 11)
│   └── 0005_supersession_layer.sql         # priority_shifts table, intent_drift_verdicts derived table, indexes
│
├── src-tauri/tests/
│   ├── fact_supersession_tests.rs          # NEW — port adversarial fixtures from research/intent-supersession
│   └── fixtures/
│       ├── fact_contradictions/            # NEW — 5 adversarial pairs (REST→gRPC, etc.)
│       └── intent_drift/                   # NEW — fixtures.json transformed to substrate-shaped fixtures
│
├── mcp-sidecar/src/tools/
│   ├── find_substrate_history.ts           # NEW — MCP tool returning bitemporal node history
│   ├── record_priority_shift.ts            # NEW — MCP tool wrapping Rust IPC for priority shifts (Phase 11 may also call this)
│   └── current_truth_query.ts              # NEW — MCP tool returning WHERE invalid_at IS NULL projection
│
└── src/                                     # FRONTEND — Phase 13 owns the UI surface
    └── (no new files in Phase 12; events emit, Phase 13 renders)
```

### Pattern 1: Bitemporal Schema (Graphiti port)

**What:** Substrate nodes carry four bitemporal timestamps; substrate edges with `edge_type = 'supersedes'` link new → stale on contradiction. Verbatim Graphiti pattern (verified against `getzep/graphiti` repo + OpenAI Cookbook temporal_agents schema):

```sql
-- Phase 11 owns substrate_nodes; Phase 12 ASSUMES these columns exist.
-- Schema must match this exactly OR Phase 12 plans need migration adjustment.
CREATE TABLE substrate_nodes (
    uuid          TEXT PRIMARY KEY,
    node_type     TEXT NOT NULL,                -- 'constraint' | 'decision' | 'open_question' | 'resolved_question' | 'attempt'
    text          TEXT NOT NULL,
    scope         TEXT,                         -- 'global' | 'module:<pat>' | 'task-pattern:<desc>'
    applies_when  TEXT,                         -- semantic trigger field (load-bearing for retrieval)
    -- ----- Bitemporal columns (Graphiti pattern, owned by Phase 11) -----
    valid_at      TEXT NOT NULL,                -- ISO-8601 UTC; when fact became true
    invalid_at    TEXT,                         -- ISO-8601 UTC; NULL = currently true
    expired_at    TEXT,                         -- ISO-8601 UTC; database-side invalidation timestamp (set by fact_engine)
    created_at    TEXT NOT NULL,                -- ISO-8601 UTC; first ingestion
    invalidated_by TEXT REFERENCES substrate_nodes(uuid),  -- Graphiti pattern: pointer to superseding node
    -- ----- Phase 12 additions (intent_drift state — derived; lives on the substrate node) -----
    intent_drift_state TEXT,                    -- NULL | 'drifted' | 'not_drifted' | 'needs_human_review'
    intent_drift_confidence REAL,               -- 0.0–1.0 from latest judge run
    intent_drift_reasoning TEXT,                -- one-sentence reasoning from judge (truncated to 200 chars)
    intent_drift_judged_at TEXT,                -- ISO-8601 UTC; when last judged
    intent_drift_judged_against TEXT REFERENCES priority_shifts(id)  -- which priority shift triggered the verdict
);

-- Partial index makes "current truth" queries cheap.
CREATE INDEX idx_substrate_nodes_active ON substrate_nodes(invalid_at) WHERE invalid_at IS NULL;

-- Index for history queries (find_substrate_history MCP tool).
CREATE INDEX idx_substrate_nodes_valid_at ON substrate_nodes(valid_at);

-- NEW Phase 12 table — priority shift log.
CREATE TABLE priority_shifts (
    id              TEXT PRIMARY KEY,           -- uuid v4
    old_l0_uuid     TEXT NOT NULL,              -- references nodes(uuid), the L0 contract before shift
    new_l0_uuid     TEXT NOT NULL,              -- references nodes(uuid), the L0 contract after shift
    valid_at        TEXT NOT NULL,              -- ISO-8601 UTC; when shift took effect (real-world time)
    summary_of_old  TEXT NOT NULL,              -- short text summary used in judge prompt (extracted from old L0 body)
    summary_of_new  TEXT NOT NULL,              -- short text summary used in judge prompt (extracted from new L0 body)
    applied_at      TEXT NOT NULL,              -- ISO-8601 UTC; when propagate_intent_drift completed
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- NEW Phase 12 table — derived intent-drift verdict log (audit trail).
-- substrate_nodes.intent_drift_state is the LATEST verdict; this table is the FULL HISTORY.
CREATE TABLE intent_drift_verdicts (
    id              TEXT PRIMARY KEY,
    node_uuid       TEXT NOT NULL REFERENCES substrate_nodes(uuid) ON DELETE CASCADE,
    priority_shift_id TEXT NOT NULL REFERENCES priority_shifts(id) ON DELETE CASCADE,
    verdict         TEXT NOT NULL,              -- 'DRIFTED' | 'NOT_DRIFTED' | 'NEEDS_HUMAN_REVIEW'
    confidence      REAL NOT NULL,              -- 0.0–1.0
    reasoning       TEXT,                       -- truncated one-sentence reasoning
    judged_at       TEXT NOT NULL,              -- ISO-8601 UTC
    auto_applied    INTEGER NOT NULL DEFAULT 0  -- 1 if confidence ≥ 0.85 and auto-applied; 0 if surfaced for review
);

CREATE INDEX idx_intent_drift_verdicts_node ON intent_drift_verdicts(node_uuid);
CREATE INDEX idx_intent_drift_verdicts_shift ON intent_drift_verdicts(priority_shift_id);
```

**When to use:** `substrate_nodes.invalid_at IS NULL` is the universal current-truth filter. Every MCP read tool MUST apply this filter unless explicitly fetching history. The `intent_drift_state` is computed lazily — Phase 12-03 sets it on priority-shift apply; Phase 13 reads it for UI rendering with red > orange > amber > gray precedence (intent_drifted = orange per the requirement).

**Example:**
```sql
-- Source: Graphiti pattern (verified against getzep/graphiti edge_operations.py)
-- Current-truth query (default for all reads):
SELECT * FROM substrate_nodes
WHERE invalid_at IS NULL
ORDER BY valid_at DESC;

-- History query (for find_substrate_history MCP tool):
WITH supersession_chain AS (
    SELECT s.uuid, s.text, s.valid_at, s.invalid_at, e.target_uuid AS superseded_by
    FROM substrate_nodes s
    LEFT JOIN substrate_edges e ON e.source_uuid = s.uuid AND e.edge_type = 'supersedes'
    WHERE s.uuid = ?1 OR s.invalidated_by = ?1 OR s.uuid IN (
        SELECT source_uuid FROM substrate_edges WHERE edge_type = 'supersedes' AND target_uuid = ?1
    )
)
SELECT * FROM supersession_chain ORDER BY valid_at ASC;
```

### Pattern 2: Fact-Level Invalidation Engine (port of `resolve_edge_contradictions`)

**What:** A new Rust function `invalidate_contradicted(app, new_node_uuid)` that (1) selects candidate stale nodes via FTS5 + scope match, (2) batch-judges against the new node via `claude -p` with the dedupe/invalidation prompt, (3) for each contradicted candidate, sets `invalid_at = new.valid_at`, `expired_at = utc_now()`, `invalidated_by = new.uuid`, AND emits a `substrate_edges` row with `edge_type = 'supersedes'`. Acquires `DriftLocks::for_uuid(new_node_uuid)` AND `DriftLocks::for_uuid(stale_uuid)` BEFORE writes (lock order: smaller UUID first to prevent deadlock — explicit ordering rule).

**When to use:** Called from the Phase 11 distiller pipeline AFTER the new substrate node is upserted. **Decision (Q1):** synchronous in the distiller per-episode pipeline, NOT async post-ingestion. Rationale: distiller writes new node → invalidation engine immediately judges → user sees the consistent state on next read. Async post-ingestion would create a window where contradicting nodes both pass the `WHERE invalid_at IS NULL` filter — bad for any read fired between distiller and engine.

**Example:**
```rust
// Source: synthesized from getzep/graphiti edge_operations.py + Phase 7 compute_and_emit pattern
// File: src-tauri/src/supersession/fact_engine.rs
use crate::drift::state::DriftLocks;
use crate::supersession::{candidate_selection, prompt, verdict};
use chrono::Utc;
use tauri::Manager;

pub async fn invalidate_contradicted(
    app: &tauri::AppHandle,
    new_uuid: &str,
) -> Result<Vec<String>, String> {
    // 1. Acquire lock for the new node (whoever ingested it might still be writing).
    let locks = app.state::<DriftLocks>();
    let new_guard = locks.for_uuid(new_uuid);
    let _new_lock = new_guard.lock().await;

    // 2. Read the new substrate_node body + applies_when + scope.
    let new = read_substrate_node(app, new_uuid).await?;
    if new.invalid_at.is_some() {
        // Node was invalidated between ingest and this call — nothing to do.
        return Ok(vec![]);
    }

    // 3. Candidate selection: FTS5 over substrate_nodes_fts on new.text + new.applies_when,
    //    scoped to (a) same node_type and (b) overlapping scope, (c) WHERE invalid_at IS NULL.
    //    Top-K hardcoded to 10 (validated batch size in research/intent-supersession/).
    let candidates = candidate_selection::find_overlapping(
        app,
        &new.node_type,
        &new.scope,
        &new.text,
        &new.applies_when,
        /* top_k */ 10,
    ).await?;
    if candidates.is_empty() {
        return Ok(vec![]);
    }

    // 4. Build the invalidation prompt (verbatim port of Graphiti's resolve_edge prompt).
    //    Returns a JSON list of contradicted candidate idx values + the new node's classification.
    let prompt_text = prompt::build_invalidation_prompt(&new, &candidates);
    let raw_response = run_claude_judge(app, &prompt_text).await?;
    let contradicted_idxs = verdict::parse_invalidation_response(&raw_response)?;

    // 5. For each contradicted candidate, write under that candidate's per-UUID lock.
    let mut invalidated = vec![];
    for idx in contradicted_idxs {
        let stale = &candidates[idx];
        // Ordered lock acquisition to prevent deadlock (smaller UUID first).
        let stale_guard = locks.for_uuid(&stale.uuid);
        let _stale_lock = stale_guard.lock().await;

        let now = Utc::now().to_rfc3339();
        // Apply Graphiti's exact field updates:
        //   stale.invalid_at = new.valid_at  (when fact stopped being true)
        //   stale.expired_at = utc_now()      (when DB realized contradiction)
        //   stale.invalidated_by = new.uuid
        write_supersession(app, &stale.uuid, &new.valid_at, &now, new_uuid).await?;
        write_supersedes_edge(app, new_uuid, &stale.uuid).await?;

        invalidated.push(stale.uuid.clone());

        // Emit event so Phase 13 UI can re-render that node as 'superseded'.
        let _ = app.emit("substrate:invalidated", serde_json::json!({
            "uuid": stale.uuid,
            "invalidated_by": new_uuid,
            "valid_at": new.valid_at,
        }));
    }

    Ok(invalidated)
}
```

**Lock ordering rule:** `(new_uuid, stale_uuid)` order doesn't matter for correctness as long as a CONSISTENT global order is used. Use lexicographic UUID order — acquire the smaller UUID's lock first. Both engine writes (fact_engine + intent_engine) follow this rule.

### Pattern 3: Intent-Level Cascade Engine (the moat)

**What:** A new Rust function `propagate_intent_drift(app, priority_shift_id)` that (1) loads the priority shift record, (2) walks every transitively-rollup-linked decision substrate node from the new L0 (descendants via `rollup_inputs` edges from Phase 8 PROP-02 — REUSE Phase 8's compute_rollup_and_emit pattern's parent-walk in REVERSE), (3) batches descendants into chunks of 10–20, runs the validated `prompt.md` judge per chunk, (4) writes verdicts to `intent_drift_verdicts` + updates `substrate_nodes.intent_drift_state`. Auto-applies confidence ≥ 0.85; surfaces 0.50–0.85 + `NEEDS_HUMAN_REVIEW` for review; filters < 0.50 as noise.

**When to use:** Triggered by `record_priority_shift(old_l0, new_l0)` Tauri command. The user (or PM via Copy Mode L0 edit) writes the new L0 → command computes diff → `priority_shifts` row inserted → impact preview gate computes "N nodes will flip" via DRY-RUN judge on a sample of 10 descendants → user confirms → `propagate_intent_drift` runs the full set.

**Example:**
```rust
// Source: synthesized from research/intent-supersession/prompt.md + Phase 8 compute_rollup_and_emit
// File: src-tauri/src/supersession/intent_engine.rs

pub async fn propagate_intent_drift(
    app: &tauri::AppHandle,
    priority_shift_id: &str,
) -> Result<IntentDriftResult, String> {
    let shift = read_priority_shift(app, priority_shift_id).await?;

    // 1. Walk the rollup graph: from new L0, traverse rollup_inputs edges DOWN
    //    to all transitively-linked decision substrate nodes.
    //    REUSE Phase 8's parent-walk machinery — same DAG structure, traversed in reverse.
    //    Bound: depth ≤ 5 (L0 → L1 → L2 → L3 → L4 → atom) to prevent unbounded traversal.
    //    Edge-type filter: only `rollup_inputs` (cross-level) and `derived-from-contract`
    //    (substrate-anchored decisions per VISION.md edges).
    let descendants = walk_rollup_descendants(app, &shift.new_l0_uuid, /* max_depth */ 5).await?;
    let decisions: Vec<_> = descendants.into_iter()
        .filter(|n| n.node_type == "decision" || n.node_type == "constraint")
        .filter(|n| n.invalid_at.is_none())  // skip already-superseded
        .collect();

    if decisions.is_empty() {
        return Ok(IntentDriftResult { judged: 0, drifted: 0, surfaced: 0, filtered: 0 });
    }

    // 2. Batch in chunks of 10 (validated batch size from research/intent-supersession/).
    //    Per-chunk LLM call ~700 input tokens. 500 nodes / 10 = 50 calls → ~$1 at subscription.
    let mut result = IntentDriftResult::default();
    for chunk in decisions.chunks(10) {
        let prompt_text = prompt::build_intent_drift_batch_prompt(
            &shift.summary_of_old,
            &shift.summary_of_new,
            chunk,
        );
        let raw_response = run_claude_judge(app, &prompt_text).await?;
        let verdicts = verdict::parse_three_way_batch(&raw_response)?;

        // Per-decision: confidence threshold determines auto-apply vs surface vs filter.
        for (decision, v) in chunk.iter().zip(verdicts.iter()) {
            // Acquire lock for write.
            let locks = app.state::<DriftLocks>();
            let _g = locks.for_uuid(&decision.uuid).lock().await;
            let auto_applied = matches!(v.verdict, Verdict::Drifted) && v.confidence >= 0.85;
            write_intent_drift_verdict(app, &decision.uuid, priority_shift_id, v, auto_applied).await?;
            update_substrate_node_drift_state(app, &decision.uuid, v).await?;
            result.judged += 1;
            match v.verdict {
                Verdict::Drifted if v.confidence >= 0.85 => result.drifted += 1,
                Verdict::Drifted | Verdict::NeedsHumanReview => result.surfaced += 1,
                _ if v.confidence < 0.50 => result.filtered += 1,
                _ => {}
            }
            let _ = app.emit("substrate:intent_drift_changed", serde_json::json!({
                "uuid": decision.uuid,
                "verdict": format!("{:?}", v.verdict),
                "confidence": v.confidence,
                "auto_applied": auto_applied,
            }));
        }
    }

    // 3. Mark priority shift as applied.
    write_priority_shift_applied(app, priority_shift_id, &Utc::now().to_rfc3339()).await?;
    Ok(result)
}

async fn walk_rollup_descendants(
    app: &tauri::AppHandle,
    root_l0_uuid: &str,
    max_depth: u32,
) -> Result<Vec<DescendantNode>, String> {
    // Reverse-walk from rollup_inputs (Phase 8 schema): given an upstream L0 uuid,
    // find all downstream contracts whose rollup_inputs cite this L0 directly OR transitively.
    // For each contract, fetch substrate decision/constraint nodes anchored to it via
    // `derived-from-contract` edges.
    //
    // Implementation: BFS over (nodes -> rollup_inputs reverse map) up to max_depth.
    // De-dup by UUID. Return all unique descendants. ~O(N) where N = nodes in subtree.
    todo!("implementation in plan 12-03; see RESEARCH Pattern 5 for the reverse-walk SQL")
}
```

**Definition of "transitively rollup-linked decision node":** A decision substrate node `d` is transitively rollup-linked to L0 contract `l` if there exists a contract `c` such that (1) there is a `derived-from-contract` substrate edge from `d` to `c`, and (2) `c` is reachable from `l` via 1+ `rollup_inputs` edges in the contract DAG. Bounded by `max_depth = 5` (L0 → L1 → L2 → L3 → L4 → atom). Phase 12 v1 only judges DIRECT descendants — no recursion into "decisions built on top of intent-drifted decisions" (transitive-decision drift is v2.5 per `evaluation.md` failure mode 3).

### Pattern 4: Candidate Selection via FTS5 (before LLM judge)

**What:** A function `find_overlapping(node_type, scope, text, applies_when, top_k)` that returns top-K substrate node candidates likely to overlap with a new node. Reuses `nodes_fts` virtual-table pattern Phase 1 already shipped; Phase 11 will add `substrate_nodes_fts`. Phase 12 plans assume Phase 11 ships this — flag as upstream dep.

**When to use:** Before EVERY fact-engine LLM call. The validated dedupe prompt expects candidates already shortlisted; without filtering, we'd LLM-judge new × ALL existing nodes per ingest, which is 100× cost.

**Example:**
```sql
-- Phase 11 must ship this (or Phase 12 ships it as a backstop):
CREATE VIRTUAL TABLE substrate_nodes_fts USING fts5(
    uuid UNINDEXED,
    text,
    applies_when,
    scope,
    content='substrate_nodes',
    content_rowid='rowid'
);

-- Candidate selection query (Phase 12-02 backstop if Phase 11 doesn't ship the FTS):
SELECT s.uuid, s.text, s.applies_when, s.scope
FROM substrate_nodes_fts f
JOIN substrate_nodes s ON s.rowid = f.rowid
WHERE substrate_nodes_fts MATCH ?1                    -- query: text + applies_when concatenated
  AND s.invalid_at IS NULL                             -- current-truth only
  AND s.node_type = ?2                                 -- same type
  AND (s.scope = ?3 OR s.scope LIKE ?3 || '%' OR ?3 LIKE s.scope || '%')  -- overlapping scope
  AND s.uuid != ?4                                     -- exclude the new node itself
ORDER BY rank
LIMIT ?5;                                              -- top_k = 10
```

**Threshold:** No similarity threshold needed — FTS5's BM25 rank is the implicit ordering. Top-K = 10 is validated by `research/intent-supersession/` batch size. If candidates returned by FTS5 are spurious (no real overlap), the LLM judge filters them at confidence < 0.50 → noise floor (per evaluation.md tier-3 filter).

### Pattern 5: Adversarial Regression Harness (recall ≥ 80%, precision ≥ 85%)

**What:** A `cargo test` integration suite that ports the `research/intent-supersession/fixtures.json` 5-case set + adds 5 fact-level contradiction fixtures (synthetic REST→gRPC pairs, 30s-cache→1s-cache, etc.). Runs both engines against an in-memory SQLite + a real `claude -p` invocation (skipped in CI; gated by `CI_LLM_LIVE=1` env flag). Asserts:
- Recall ≥ 80% (true positives / actual positives) — fact engine flags ≥ 4/5 known contradictions
- Precision ≥ 85% (true positives / predicted positives) — fact engine doesn't flag aligned pairs as contradictions
- Intent engine reproduces 9/10 match against `evaluation.md` baseline

**When to use:** Plan 12-04 ships the harness. Run before every Phase 12 SUMMARY commit; integrate into `cargo test` so a regression is caught.

**Test structure:**
```rust
// Source: structure mirrors src-tauri/src/drift/engine.rs unit tests + integration testing pattern
// File: src-tauri/tests/fact_supersession_tests.rs
#[tokio::test]
#[ignore]  // gated by CI_LLM_LIVE=1 (live LLM call)
async fn fact_engine_recall_at_least_80_percent_on_5_fixtures() {
    let pool = fresh_test_pool_with_substrate_schema().await;
    seed_substrate_fixtures(&pool, "tests/fixtures/fact_contradictions/").await;

    let mut hits = 0;
    let mut false_pos = 0;
    let mut total_positives = 5;

    for new_uuid in &["new_grpc", "new_postgres", "new_no_cache", ...] {
        let invalidated = invalidate_contradicted(&app, new_uuid).await.unwrap();
        // Each fixture file has expected_invalidated.json with the GT list.
        let expected = read_expected(format!("tests/fixtures/fact_contradictions/{new_uuid}_expected.json"));
        for inv_uuid in &invalidated {
            if expected.contains(inv_uuid) { hits += 1; } else { false_pos += 1; }
        }
    }

    let recall = hits as f64 / total_positives as f64;
    let precision = hits as f64 / (hits + false_pos) as f64;
    assert!(recall >= 0.80, "recall {:.2} < 0.80 threshold", recall);
    assert!(precision >= 0.85, "precision {:.2} < 0.85 threshold", precision);
}

#[tokio::test]
#[ignore]
async fn intent_engine_reproduces_9_of_10_evaluation_baseline() {
    // Port research/intent-supersession/fixtures.json directly; assert verdicts match
    // research/intent-supersession/results.txt (9/10 match — d8 is NEEDS_HUMAN_REVIEW).
    let pool = fresh_test_pool_with_substrate_schema().await;
    let shift_id = seed_priority_shift_from_evaluation_fixture(&pool).await;
    seed_10_decisions_from_evaluation_fixture(&pool).await;

    let result = propagate_intent_drift(&app, &shift_id).await.unwrap();
    let verdicts = read_intent_drift_verdicts(&pool, &shift_id).await;

    let expected_drifted = ["d1", "d2", "d4", "d6", "d10"];  // from results.txt
    let expected_not_drifted = ["d3", "d5", "d7", "d9"];
    let expected_review = ["d8"];

    for d in &expected_drifted {
        assert_eq!(verdicts.get(d).unwrap().verdict, Verdict::Drifted);
        assert!(verdicts.get(d).unwrap().confidence >= 0.50);
    }
    for d in &expected_not_drifted {
        assert_eq!(verdicts.get(d).unwrap().verdict, Verdict::NotDrifted);
    }
    for d in &expected_review {
        assert_eq!(verdicts.get(d).unwrap().verdict, Verdict::NeedsHumanReview);
    }
}
```

### Pattern 6: Demo-Required Slice (Beat 3 orange-flag fixture)

**What:** The Beat 3 verifier panel must show ONE orange flag against the parent surface even if the full intent-cascade engine slips. ROADMAP planning notes (line 233) explicitly allow hardcoding against a seeded priority-shift state.

**Implementation strategy:** Plan 12-04 ships TWO paths to the same UI surface:

1. **Engine path (preferred):** `propagate_intent_drift(priority_shift_id)` returns `con-settings-no-modal-interrupts-2025-Q4` as `intent_drifted` (verdict = `DRIFTED`, confidence ~0.85+ since the modal-interrupts decision under `reduce-onboarding-friction` is a clean drift case under the new `compliance-first` priority). Phase 13's verifier reads `substrate_nodes.intent_drift_state` and renders the orange flag.

2. **Hardcoded fallback (demo backstop):** A Rust IPC `demo_force_intent_drift(uuid)` (gated by `cfg(feature = "demo-fixture")` AND the active repo path matching the seeded `contract-ide-demo` directory) sets `intent_drift_state = 'drifted'` directly. The verifier reads the same column → identical UI behavior. Test stage with the engine path; record-day stage with the fallback if engine misbehaves on stage.

**Decision:** Ship both. The fallback is 30 LOC and one IPC; cost-of-safety is negligible vs. losing Beat 3 to a transient LLM judge variance.

### Anti-Patterns to Avoid

- **DO NOT** delete substrate nodes on contradiction. Always set `invalid_at` + `expired_at` and emit `supersedes` edge. History queries depend on this. Per Graphiti pattern.
- **DO NOT** materialize a "current truth" view. Use `WHERE invalid_at IS NULL` filter on every read. Materialized views introduce bootstrap-storm anti-pattern (Phase 8 PROPAGATION.md).
- **DO NOT** make `record_priority_shift` MCP-only. It needs to be callable from BOTH (a) PM-side L0 contract edits via the Inspector (Phase 9 Copy Mode wiring), and (b) MCP from Claude Code sessions. **Two surfaces, one Rust IPC.**
- **DO NOT** judge new × ALL substrate nodes per ingest. Use FTS5 candidate selection first (top-K = 10). Per Graphiti pattern; without this, cost is 100× (reject).
- **DO NOT** apply intent-drift verdicts auto-without-impact-preview. The "this shift would flag 40% of decisions — confirm?" gate is load-bearing per `evaluation.md` failure mode 5. SAFE-OFF DEFAULT — gate is not optional.
- **DO NOT** re-explore the validated `prompt.md` text. Codify the exact text. Variations risk losing the "focus on the DECISION, not the rationale" instruction that prevented adversarial keyword false positives.
- **DO NOT** judge transitively-drifted-decisions (decisions built on top of decisions already flagged drifted). v1 stops at depth-1 from the priority shift. Per `evaluation.md` failure mode 3.
- **DO NOT** treat `expired_at` and `invalid_at` as synonyms. Two distinct timestamps per Graphiti: `invalid_at` = real-world stop (set to `new.valid_at`); `expired_at` = DB realization time (set to `utc_now()` on contradiction-driven invalidation only).
- **DO NOT** use timezone-naive datetime comparisons. Always RFC3339 UTC. Graphiti's known issue #893 (timezone-naive vs timezone-aware comparison) is exactly this footgun. Use `chrono::Utc::now().to_rfc3339()`.
- **DO NOT** add a parallel TS supersession engine in MCP sidecar. Engine lives in Rust; MCP tools call Rust IPC. Same pattern as Phase 8 section parser (PROP-01).
- **DO NOT** rewrite Phase 8's `compute_rollup_and_emit` to handle intent cascade. Add `propagate_intent_drift` as a sibling function. Phase 8 invariant ("no retroactive changes") preserved — STATE.md confirms.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bitemporal contradiction algorithm | Bespoke "if new contradicts old then mark old invalid" loop | Direct port of Graphiti's `resolve_edge_contradictions` (verified in `getzep/graphiti/graphiti_core/utils/maintenance/edge_operations.py`) | Algorithm has subtle invariants (timezone-aware datetimes, dual-timestamp semantics, idx-based response parsing). Reinventing risks the issue-#893 footgun. |
| LLM intent-drift judge prompt | New prompt design | Verbatim use of `.planning/research/intent-supersession/prompt.md` | 9/10 already validated. The "focus on the DECISION, not the rationale" instruction is load-bearing — adversarial keyword-match cases (d7 pnpm, d9 ENV flags) only succeed because of this exact phrasing. |
| Three-way verdict + confidence schema | Binary flag + reason string | Three-way enum + 0.0–1.0 confidence (per `evaluation.md` recommendation) | The confidence calibration is what makes the auto-apply / surface / filter triage usable. Binary flags lose this signal entirely. |
| Candidate selection BEFORE LLM call | LLM-judge new × all-existing-nodes pairwise | FTS5 + scope filter + WHERE invalid_at IS NULL → top-K = 10 | Without filter: 500 nodes × 1 ingest = 500 LLM calls per ingestion. With filter: ~10 LLM calls per ingestion. 50× cost reduction. |
| Concurrency primitive for cross-node writes | Database-level optimistic locking via row version columns | Per-UUID `tokio::sync::Mutex` via `DriftLocks` (already shipped — Phase 7) | Phase 8's PROP-04 already validated this primitive end-to-end. Reuse, don't reinvent. |
| Cascade walker over the L0→L4 contract DAG | New BFS implementation | Phase 8's `compute_rollup_and_emit` parent-walk pattern, traversed in REVERSE | Same DAG, same edges (`rollup_inputs`), same lock primitive. Pattern is already shipped and tested. |
| Adversarial regression suite | Hand-curated test cases without ground truth | Port `research/intent-supersession/fixtures.json` directly + 5 hand-crafted fact-level contradictions | The 5-case set + d8 NEEDS_HUMAN_REVIEW is the ALREADY-VALIDATED baseline. New fixtures EXTEND. |
| Subscription-auth LLM call | New API client / new auth | `tauri-plugin-shell` → `claude -p` (Phase 6 derivation pivot pattern) | Already shipped; no `ANTHROPIC_API_KEY` dance; same pattern Phase 11 distiller will use. |
| RFC3339 timestamp helpers | New time-handling utility | `chrono::Utc::now().to_rfc3339()` (already shipped) | Phase 7 uses this everywhere; Graphiti issue #893 is the cautionary tale for timezone-naive alternatives. |
| Substrate `supersedes` edge | New table | `substrate_edges` with `edge_type = 'supersedes'` (Phase 11 owns the table) | Phase 11 ships typed substrate_edges; reuse rather than parallel table. |

**Key insight:** Every piece of Phase 12 has prior art either (a) inside the project (Phase 7+8 machinery, Phase 11 schema, Phase 6 LLM-call pattern), or (b) in Graphiti's open-source Python implementation. Net-new code is the engine *glue* (Rust IPC commands, LLM judge invocation, three-way verdict parsing, ancestor-walk in reverse). Everything else is reuse. **Reject any plan task that re-implements something already shipped.**

## Common Pitfalls

### Pitfall 1: Timezone-Naive Datetime Comparison

**What goes wrong:** `valid_at` strings stored without timezone offset → comparing `valid_at` from one ingestion path against `valid_at` from another fails silently. Stale node never invalidated; supersession appears to "lose" contradictions.

**Why it happens:** Python's `datetime.now()` returns naive datetime by default; Rust's `chrono::Local::now()` returns local-time. RFC3339 with explicit `Z` (UTC) is the only safe form.

**How to avoid:** Use `chrono::Utc::now().to_rfc3339()` everywhere. Add a unit test that comparing `valid_at` from US-Pacific-input vs UTC-input matches under string-comparison. Per Graphiti issue #893 lineage.

**Warning signs:** Two contradicting nodes both pass `WHERE invalid_at IS NULL` after running through fact_engine. Test: run the engine twice in sequence; confirm second run is a no-op (idempotent).

### Pitfall 2: FTS5 Candidate Selection Misses Semantic Twins

**What goes wrong:** New node says "use gRPC for service-to-service"; old contradicting node says "all internal RPCs use Protocol Buffers" — keyword overlap is "RPC" only. FTS5 may return them ordered low; if top-K cuts at 10 and there are 50 RPC-mentioning candidates, the real contradiction misses the cut.

**Why it happens:** BM25 is keyword-frequency based; doesn't capture semantic equivalence. Embeddings would; we deferred them per Phase 9 decision.

**How to avoid:** (1) Top-K = 10 is the validated default but keep it tunable. (2) For demo-load-bearing fixtures, hand-author the seed contracts so their `applies_when` fields share keywords (PM-side discipline). (3) v2 stretch: add embedding fallback as a Phase 9 stretch item that Phase 12 inherits. Document the limit clearly.

**Warning signs:** Adversarial regression recall < 80% on contradictions with low keyword overlap. Test: include a "REST → gRPC" pair where the old says "use HTTP+JSON for inter-service" — verify FTS5 finds it.

### Pitfall 3: Priority-Shift Impact Preview Bypassed

**What goes wrong:** User edits L0 contract directly (Phase 9 Copy Mode wiring) without realizing it triggered a priority shift; engine flips 40% of decisions silently; user discovers 200 verdicts overnight in their substrate.

**Why it happens:** L0 contract edit is a normal contract edit through Inspector — there's no "are you SURE this is a priority shift?" gate built in.

**How to avoid:** `record_priority_shift` is the EXPLICIT entry point. L0 contract edits via `update_contract` MCP tool / Inspector save do NOT auto-trigger intent-cascade. Instead: (a) detect via `compute_rollup_and_emit` (the L0 parent's section_hashes change → `rollup_state = stale` propagates via Phase 8 amber path), (b) the verifier or PM-side UI surfaces a "Significant L0 change detected — declare as priority shift?" toast, (c) user clicks → opens "impact preview" panel with DRY-RUN judge on 10 sample descendants → user confirms → `propagate_intent_drift` runs the full set.

**Warning signs:** L0 contract edit causes immediate flood of `intent_drifted` flags without user confirmation. Counter test: edit an L0 contract → confirm the engine does NOT auto-fire; only `record_priority_shift` does.

### Pitfall 4: Contradiction Engine Race with Rollup Engine

**What goes wrong:** New substrate node ingests; fact engine starts judging; concurrently a contract edit fires `compute_rollup_and_emit` for the same UUID. Both engines write to the same node's row; one's update is silently lost.

**Why it happens:** Two engines, same `DriftLocks` map but different lock-acquisition order.

**How to avoid:** Both engines use `DriftLocks::for_uuid(uuid).lock().await` BEFORE any read-then-write. Smallest-UUID-first ordering when multiple locks are needed (e.g., fact engine locking new + stale node together). This is the Phase 7 invariant; preserve it.

**Warning signs:** Stress test: ingest a contradicting node WHILE editing the contract that anchors the contradicted decision. Confirm both writes land; no `tokio::sync::Mutex` deadlock; no lost update.

### Pitfall 5: Three-Way Verdict Lost in Binary UI

**What goes wrong:** Phase 13 substrate UI maps `intent_drift_state` to a binary `drifted` flag. The `NEEDS_HUMAN_REVIEW` confidence-0.65 nodes are rendered identically to `DRIFTED` confidence-0.95 nodes. User can't triage.

**Why it happens:** UI takes the path of least resistance — boolean check.

**How to avoid:** Phase 12 emits the full three-way state. Phase 13 RENDERS it: `DRIFTED` confidence ≥ 0.85 = orange (auto-applied label); `DRIFTED` confidence 0.50–0.85 = orange-with-question-mark (review needed); `NEEDS_HUMAN_REVIEW` = orange dashed (judge punted); `NOT_DRIFTED` confidence ≥ 0.50 = no overlay; confidence < 0.50 = no overlay (filtered as noise). DOCUMENT the precedence in the Phase 12 SUMMARY so Phase 13 can wire it.

**Warning signs:** Phase 13 UI renders intent-drift as a binary. Counter: surface a `auto_applied` flag in the emitted event payload so Phase 13 can distinguish.

### Pitfall 6: LLM Judge Returns Malformed JSON

**What goes wrong:** `claude -p` occasionally drops or truncates output; verdict parser throws; entire batch's verdicts lost.

**Why it happens:** Same defensive-parsing concern as Phase 8 receipt parser — LLM output is not 100% reliable JSON. Output mode + prompt phrasing reduce risk but don't eliminate.

**How to avoid:** Defensive parser per Phase 8 Pattern 5 lineage. (1) Wrap response in try-parse; (2) on parse failure, log raw response + emit a NEEDS_HUMAN_REVIEW verdict for every node in that batch with confidence 0.0; (3) surface in UI for manual review. Mock fallback: if `claude -p` itself errors (binary not found, rate-limited, etc.), emit zero verdicts and an "engine unavailable" event so Phase 13 can render a status badge.

**Warning signs:** Production engine emits zero verdicts for a batch. Counter: instrument log lines per LLM call; alert on parse failure.

### Pitfall 7: Cost Runaway on Large Substrate

**What goes wrong:** 500-node substrate × 5 priority shifts in a day × ~700 input tokens = ~$5/day in subscription token cost (which is included for now, but any rate-limit or quota will hit). Demo runs the engine ~3 times → $0.30 — fine. Production dogfood at scale is the risk.

**Why it happens:** Each priority shift triggers full descendants walk → batched judge calls. Linear in node count.

**How to avoid:** (1) Impact preview gate prevents accidental runs (Pitfall 3). (2) Subscription auth via `claude -p` doesn't bill per-token, but rate-limits exist; degrade gracefully. (3) v2 mitigation: cache verdict hashes (priority_shift_id, decision_uuid) in the verdict table — rerun is a no-op if the (shift, decision) pair was already judged. Already specified above.

**Warning signs:** User runs `record_priority_shift` 5 times in 1 minute (typing a typo'd L0). Counter: rate-limit `record_priority_shift` to one per 30s + impact-preview-mandatory.

### Pitfall 8: Substrate Schema Diverges from Phase 11

**What goes wrong:** Phase 12 plans assume `substrate_nodes` columns that Phase 11 names differently. Migration v5 conflicts with Phase 11's migration v4. Plans land before Phase 11 ships → broken.

**Why it happens:** Phase 11 not yet planned; Phase 12 is researching ahead.

**How to avoid:** (1) Phase 12-01 owns the schema additions (`priority_shifts`, `intent_drift_verdicts`, supersession columns on `substrate_nodes`). (2) Phase 12 plans EXPLICITLY assume Phase 11 schema names per Pattern 1 above; if Phase 11 ships different names, Plan 12-01 is the SINGLE place that adapts. (3) Recommend Phase 11 RESEARCH.md cite Phase 12's expected schema as a downstream constraint.

**Warning signs:** Phase 11 ships `substrate_nodes` with `node_type` column named `kind` instead. Counter: Plan 12-01 reads Phase 11's actual migration before adding columns.

## Code Examples

### Example 1: Verbatim Invalidation Prompt (Graphiti port)

```rust
// Source: synthesized from getzep/graphiti/graphiti_core/prompts/dedupe_edges.py
// File: src-tauri/src/supersession/prompt.rs

pub fn build_invalidation_prompt(
    new_node: &SubstrateNode,
    candidates: &[SubstrateNode],
) -> String {
    let candidates_block = candidates.iter().enumerate()
        .map(|(i, c)| format!(
            "  idx {}: type={} text={:?} applies_when={:?} valid_at={}",
            i, c.node_type, c.text, c.applies_when, c.valid_at,
        ))
        .collect::<Vec<_>>()
        .join("\n");

    format!(r#"You are evaluating whether a NEW substrate node contradicts any of the
EXISTING_CANDIDATES below.

A node contradicts an existing node if:
- Both make claims about the same thing AND those claims are mutually exclusive, OR
- The new node states a rule, decision, or constraint whose validity REPLACES the existing one
- They disagree on a binary choice (use X vs use Y; cache TTL N vs cache TTL M)

A node DOES NOT contradict an existing node if:
- Both can be true simultaneously
- They cover different scopes or different applies_when conditions
- The new node refines or extends without negating the existing one

Focus on the CLAIM, not on incidental wording overlap. A node mentioning the same
keywords as another but making a different claim is NOT a contradiction.

NEW_NODE:
  type: {new_type}
  text: {new_text:?}
  applies_when: {new_when:?}
  valid_at: {new_valid_at}

EXISTING_CANDIDATES (idx 0..{n}):
{candidates}

Output a JSON object with this exact shape (no markdown, no commentary):
{{
  "contradicted_idxs": [<idx values from EXISTING_CANDIDATES>],
  "reasoning": "<one sentence per contradicted idx>"
}}
"#,
        new_type = new_node.node_type,
        new_text = new_node.text,
        new_when = new_node.applies_when,
        new_valid_at = new_node.valid_at,
        n = candidates.len(),
        candidates = candidates_block,
    )
}
```

### Example 2: Validated Intent-Drift Prompt (Verbatim Codification)

```rust
// Source: VERBATIM port of .planning/research/intent-supersession/prompt.md
// File: src-tauri/src/supersession/prompt.rs

const INTENT_DRIFT_SYSTEM_PROMPT: &str = r#"You are evaluating whether a historical engineering decision is INTENT-DRIFTED under a priority shift — i.e., whether a new L0 priority would plausibly lead a reasonable team to revisit or reverse the decision.

A decision is DRIFTED if:
- It explicitly traded off against something the new L0 now values, OR
- It violates a constraint the new L0 establishes

A decision is NOT_DRIFTED if:
- It's priority-neutral (independent of either L0), OR
- It's aligned with both old and new priorities, OR
- Its rationale mentions priority-related keywords but the decision itself doesn't conflict with the new L0

Focus on the DECISION, not the rationale's wording. A rationale mentioning "faster" or "simpler" is not sufficient evidence of drift — the decision itself must conflict with the new L0."#;

// Batch prompt — evaluation.md showed batch works. One LLM call per ~10 decisions.
pub fn build_intent_drift_batch_prompt(
    old_l0_text: &str,
    new_l0_text: &str,
    decisions: &[SubstrateNode],
) -> String {
    let decisions_block = decisions.iter().enumerate()
        .map(|(i, d)| format!(
            "d{}. {}\n   rationale: {}",
            i + 1, d.text, d.applies_when.as_deref().unwrap_or("(none)"),
        ))
        .collect::<Vec<_>>()
        .join("\n\n");

    format!(r#"{system}

OLD_L0: {old}

NEW_L0: {new}

For EACH of the {n} decisions below, output ONE JSON line in this exact format:
{{"id": "d1", "verdict": "DRIFTED|NOT_DRIFTED|NEEDS_HUMAN_REVIEW", "reasoning": "<one sentence>", "confidence": <float 0-1>}}

Output exactly {n} JSON lines, nothing else. No markdown fences, no commentary.

DECISIONS:

{decisions}
"#,
        system = INTENT_DRIFT_SYSTEM_PROMPT,
        old = old_l0_text,
        new = new_l0_text,
        n = decisions.len(),
        decisions = decisions_block,
    )
}
```

### Example 3: Three-Way Verdict Parser (Defensive)

```rust
// Source: synthesized from Phase 8 Pattern 5 (defensive JSONL parser) + research/intent-supersession/results.txt
// File: src-tauri/src/supersession/verdict.rs

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Verdict {
    Drifted,
    NotDrifted,
    NeedsHumanReview,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ParsedVerdict {
    pub id: String,
    pub verdict: Verdict,
    pub reasoning: String,
    pub confidence: f64,
}

/// Parse the LLM's batch response. One JSON line per decision; tolerant of
/// blank lines, trailing commas, missing fields. On any parse failure for a
/// single line, emit a NEEDS_HUMAN_REVIEW verdict at confidence 0.0 — the UI
/// surfaces it, no silent loss.
pub fn parse_three_way_batch(raw: &str) -> Result<Vec<ParsedVerdict>, String> {
    let mut out = vec![];
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("```") { continue; }

        // Defensive: try strict parse first, fall back to NEEDS_HUMAN_REVIEW.
        match serde_json::from_str::<serde_json::Value>(line) {
            Ok(v) => {
                let id = v.get("id").and_then(|x| x.as_str()).unwrap_or("unknown").to_string();
                let verdict_str = v.get("verdict").and_then(|x| x.as_str()).unwrap_or("NEEDS_HUMAN_REVIEW");
                let verdict = match verdict_str {
                    "DRIFTED" => Verdict::Drifted,
                    "NOT_DRIFTED" => Verdict::NotDrifted,
                    _ => Verdict::NeedsHumanReview,
                };
                let confidence = v.get("confidence").and_then(|x| x.as_f64()).unwrap_or(0.0);
                let reasoning = v.get("reasoning").and_then(|x| x.as_str()).unwrap_or("(parse fallback)").to_string();
                out.push(ParsedVerdict { id, verdict, reasoning, confidence });
            }
            Err(_) => {
                // Skip malformed lines; downstream caller re-counts and may emit
                // synthetic NEEDS_HUMAN_REVIEW verdicts for missing decisions.
                eprintln!("[supersession] malformed verdict line: {}", line);
            }
        }
    }
    Ok(out)
}
```

### Example 4: Current-Truth Query Helper (with Fallthrough History)

```rust
// File: src-tauri/src/supersession/queries.rs

/// Default current-truth query — applied to EVERY MCP read.
pub async fn fetch_current_substrate_nodes(
    pool: &sqlx::SqlitePool,
    node_type: Option<&str>,
    limit: u32,
) -> sqlx::Result<Vec<SubstrateNode>> {
    let q = match node_type {
        Some(t) => sqlx::query_as("SELECT * FROM substrate_nodes WHERE invalid_at IS NULL AND node_type = ?1 ORDER BY valid_at DESC LIMIT ?2").bind(t).bind(limit),
        None    => sqlx::query_as("SELECT * FROM substrate_nodes WHERE invalid_at IS NULL ORDER BY valid_at DESC LIMIT ?1").bind(limit),
    };
    q.fetch_all(pool).await
}

/// History query — find_substrate_history MCP tool. Returns BOTH current and
/// invalidated versions of a node, ordered by valid_at ascending.
pub async fn fetch_substrate_history(
    pool: &sqlx::SqlitePool,
    root_uuid: &str,
) -> sqlx::Result<Vec<SubstrateNode>> {
    sqlx::query_as(r#"
        WITH chain AS (
            SELECT * FROM substrate_nodes WHERE uuid = ?1
            UNION
            SELECT s.* FROM substrate_nodes s
            JOIN substrate_edges e ON e.target_uuid = s.uuid
            WHERE e.source_uuid = ?1 AND e.edge_type = 'supersedes'
            UNION
            SELECT s.* FROM substrate_nodes s
            JOIN substrate_edges e ON e.source_uuid = s.uuid
            WHERE e.target_uuid = ?1 AND e.edge_type = 'supersedes'
        )
        SELECT * FROM chain ORDER BY valid_at ASC
    "#)
    .bind(root_uuid)
    .fetch_all(pool)
    .await
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hard-delete on contradiction (older memory systems) | Soft-invalidate via `invalid_at` + preserve history | Graphiti formalized 2024–2025 | History queries become first-class; "what was true at time T" tractable |
| Bespoke per-domain contradiction logic | LLM-judge dedupe/invalidation prompt with hybrid candidate selection | Graphiti `resolve_edge_contradictions` (2024) | Generalizable across domains; defensive parser handles schema drift |
| Single timestamp `invalidated_at` | Dual `valid_at` + `invalid_at` + `expired_at` | Graphiti pattern (bitemporal) | Distinguishes real-world vs database time; supports retroactive corrections |
| Pure embedding candidate retrieval | Hybrid FTS5 + embedding via Reciprocal Rank Fusion | sqlite-vec hybrid pattern (2024–2026) | Better recall on adversarial keyword cases; faster than embedding-only at small scale |
| Intent-based networking "intent drift" (operational) | Hierarchical L0→L4 priority-cascade intent-drift (Contract IDE novel) | This research, 2026 | **No prior art for the L0-priority-shift cascade variant — this is the moat.** Verified via WebSearch: "intent drift" exists in IBN context, "intent-level supersession" with hierarchical priority does not appear in literature. |

**Deprecated/outdated:**
- "Always replace prior facts on contradiction without history" — replaced by Graphiti soft-invalidate-with-history. Documented in Zep's blog post explicitly.
- "Single LLM call per node × all-existing-nodes pairwise" — replaced by candidate-selection-then-batch-judge pattern. Cost difference is 50–100×; cannot ship without filter.
- "Naive `now()` datetime without timezone" — replaced by RFC3339 UTC after Graphiti issue #893.

## Open Questions

### Q1. Where does the invalidation prompt fire — synchronous or async?

**What we know:** Phase 11 owns the distiller pipeline. Distiller writes new substrate node → fact engine judges. Synchronous keeps the substrate consistent for the next read; async leaves a window where contradictions are both `invalid_at IS NULL`.

**What's unclear:** What is the exact distiller-pipeline integration point? Phase 11 is not yet planned.

**Recommendation:** SYNCHRONOUS in the distiller per-episode pipeline (per Pattern 2). Plan 12-02 ships an `invalidate_contradicted` Rust IPC; Phase 11 calls it from the distiller AFTER each `INSERT INTO substrate_nodes`. Phase 11 RESEARCH.md should cite this expectation.

### Q2. What happens if `record_priority_shift` is called when `propagate_intent_drift` is still running for an EARLIER shift?

**What we know:** Phase 12-03 ships these as separate IPC commands. User-driven flow gates with impact preview, but two PMs simultaneously editing two different L0 contracts is theoretical-but-possible.

**What's unclear:** Should the engine reject overlapping shifts, queue them, or run them in parallel?

**Recommendation:** REJECT overlapping shifts. `propagate_intent_drift` writes a `priority_shifts.applied_at` timestamp on completion; `record_priority_shift` checks for any unapplied shift and returns an error if found. Single-user local-first per VISION.md; this is sufficient. v2 can add queueing.

### Q3. Definition of "transitively rollup-linked decision node" — exact graph traversal

**What we know:** Pattern 3 specifies depth ≤ 5, edge filter to `rollup_inputs` + `derived-from-contract`. Phase 8 ships `rollup_inputs` per L1/L2/L3 node.

**What's unclear:** When a substrate decision is anchored to MULTIPLE contracts (some inside the L0 subtree, some outside), is it intent-drift-judged once or per-anchor?

**Recommendation:** Per-anchor judgment is over-engineering for v1. Judge ONCE with the priority-shift's old/new L0 summary; if any anchor falls inside the L0 subtree, the decision is in scope. Phase 12-03 ships this. Edge case (decision anchored half-in / half-out) is rare enough to surface as `NEEDS_HUMAN_REVIEW` and let the user decide.

### Q4. Phase 13 substrate-state coloring with precedence red > orange > amber > gray

**What we know:** Phase 13 SC 2 (per ROADMAP line 243) requires precedence red > orange > amber > gray. Red = code drift (Phase 7). Amber = rollup stale (Phase 8 PROP-02). Gray = rollup untracked (Phase 8 PROP-02). Orange = intent_drifted (Phase 12 — this phase).

**What's unclear:** Phase 12 emits `substrate_nodes.intent_drift_state`. Phase 13 reads it. How does Phase 13 know which CONTRACTS to color when a SUBSTRATE node is intent-drifted? Substrate nodes are anchored to contracts via `derived-from-contract` edges.

**Recommendation:** Phase 12 emits `substrate:intent_drift_changed` events with the substrate_node UUID. Phase 13 dereferences via `derived-from-contract` edges to find the anchor contract(s), then renders orange overlay on those contracts. Phase 12 SUMMARY MUST document the dereference pattern; Phase 13 owns the render.

### Q5. How does the demo-required slice avoid demo-day surprises?

**What we know:** Plan 12-04 ships both engine path AND hardcoded fallback. Hardcoded fallback gated by repo-path match.

**What's unclear:** Recording-day stage: do we run engine path or fallback?

**Recommendation:** TWO REHEARSALS minimum. Rehearsal 1: engine path. Rehearsal 2: fallback path. Beat 3 must work both ways. Decision-day: pick whichever is more reliable in the last hour before recording. Plan 12-04 documents both UAT scripts.

### Q6. SUB-06 / SUB-07 not yet in REQUIREMENTS.md

**What we know:** ROADMAP line 224 cites them. REQUIREMENTS.md does not list them. ROADMAP says "to be added to REQUIREMENTS.md in /gsd:new-milestone pass."

**What's unclear:** Should Plan 12-01 add the requirements, or is that out of scope?

**Recommendation:** Plan 12-01 adds SUB-06 and SUB-07 to REQUIREMENTS.md as part of the schema-migration commit. Cite this RESEARCH.md doc as the source of the canonical wording. Fail-safe: if the planner believes adding requirements is out-of-scope for an execute plan, surface as a blocker and request clarification.

## Sources

### Primary (HIGH confidence)

- `.planning/research/intent-supersession/evaluation.md` — internal validated 9/10 evaluation; the load-bearing input
- `.planning/research/intent-supersession/prompt.md` — verbatim validated prompt; codified in Pattern 2
- `.planning/research/intent-supersession/fixtures.json` — adversarial fixture set; regression baseline in Plan 12-04
- `.planning/research/intent-supersession/results.txt` — actual LLM output (9/10 baseline)
- `.planning/research/intent-supersession/batch-prompt.txt` — batch-mode validation (10 decisions in one LLM call, 9/10 match)
- `.planning/research/contract-form/PROPAGATION.md` — Phase 8 propagation engine; Phase 12 intent-cascade reuses the parent-walk pattern
- `.planning/phases/08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation/08-RESEARCH.md` — Phase 8 patterns reused (DriftLocks, compute_rollup_and_emit, ReconcilePanel sibling render)
- `.planning/phases/08-…/08-02-PLAN.md` — exact rollup engine spec
- `.planning/research/constraint-distillation/schema.json` — bitemporal schema fields (`valid_at`, `invalid_at`, `superseded_by`) that Phase 11 will ship and Phase 12 extends
- `.planning/VISION.md` — moat thesis (intent-level supersession is "the single most interesting claim")
- `.planning/demo/scenario-criteria.md` § 8 — Beat 3 orange-flag fixture spec (parent surface holds `con-settings-no-modal-interrupts-2025-Q4`, priority shift Q4-2025 `reduce-onboarding-friction` → 2026-04-24 `compliance-first`)
- `.planning/demo/presentation-script.md` Beat 3 (lines 154–169) — verifier output exact text

### Secondary (HIGH confidence — verified against canonical source)

- [`getzep/graphiti` `graphiti_core/utils/maintenance/edge_operations.py`](https://github.com/getzep/graphiti/blob/main/graphiti_core/utils/maintenance/edge_operations.py) — `resolve_edge_contradictions` algorithm; verbatim port for Plan 12-02
- [`getzep/graphiti` `graphiti_core/prompts/dedupe_edges.py`](https://github.com/getzep/graphiti/blob/5a67e660dce965582ba4b80d3c74f25e7d86f6b3/graphiti_core/prompts/dedupe_edges.py) — actual invalidation/dedupe prompt template; Pattern 1 example
- [Zep blog: "Beyond Static Knowledge Graphs"](https://blog.getzep.com/beyond-static-knowledge-graphs/) — verified `expired_at` vs `invalid_at` semantics
- [OpenAI Cookbook: Temporal Agents with Knowledge Graphs](https://developers.openai.com/cookbook/examples/partners/temporal_agents_with_knowledge_graphs/temporal_agents) — verified bitemporal field model (`TemporalEvent.valid_at`, `invalid_at`, `expired_at`, `created_at`, `invalidated_by`)
- [Graphiti issue #893: timezone-naive datetime comparison](https://github.com/getzep/graphiti/issues/893) — Pitfall 1 lineage
- [Alex Garcia: Hybrid full-text search and vector search with SQLite](https://alexgarcia.xyz/blog/2024/sqlite-vec-hybrid-search/index.html) — FTS5 + sqlite-vec + RRF pattern for v2 stretch
- [Hybrid Search: Smart Search Architecture with FTS5 + Vector + RRF](https://ceaksan.com/en/hybrid-search-fts5-vector-rrf) — same pattern, second confirmation
- Phase 9 09-RESEARCH.md (in-tree) — embedding decision (`EMBEDDING_DISABLED` flag, keyword-only fallback) propagates to Phase 12

### Tertiary (MEDIUM confidence — single source or unverified)

- [Graphiti DeepWiki](https://deepwiki.com/getzep/graphiti) — secondary description of bitemporal model
- [OpenReview: Fast Intent Classification](https://openreview.net/forum?id=UMuVvvIEvA) — confirms novelty of the L0-priority-cascade variant; "intent drift" exists only in IBN literature
- [arxiv 2402.00715: Intent Assurance using LLMs guided by Intent Drift](https://arxiv.org/html/2402.00715v2) — shows "intent drift" is a known concept in IBN; **does NOT cover hierarchical priority cascades**

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dependency already shipped (Tauri 2, Tokio, sqlx, chrono, sha2, serde_json); no new deps required for v1; embeddings deferred per Phase 9 decision
- Architecture: HIGH on fact engine (verbatim Graphiti port); HIGH on intent engine (validated 9/10 in research); MEDIUM on Phase 11 schema names (Phase 11 not yet planned — Pattern 1 is the proposed canonical schema, Phase 11 may diverge)
- Pitfalls: HIGH — every pitfall has a documented prior occurrence in either Graphiti or Phase 7+8 history
- Demo slice: HIGH — Plan 12-04 hardcoded fallback path is 30 LOC; engine path is the validated baseline

**Research date:** 2026-04-24
**Valid until:** 2026-05-08 (14 days — substrate schema is fast-moving; Phase 11's actual ship may force schema revision)

**Specific risks to monitor:**
1. Phase 11's actual `substrate_nodes` migration may name columns differently — Plan 12-01 must align
2. The 5-fixture adversarial set may not generalize to all real contradictions — Plan 12-04 should add 5 more before demo if cycles allow
3. `claude -p` rate limits via subscription auth are not bound — burst >100 calls in <60s may hit a soft cap
4. Recording-day LLM judge variance: Plan 12-04 hardcoded fallback is the demo backstop; do not omit
