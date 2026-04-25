---
phase: 11-distiller-constraint-store-contract-anchored-retrieval
plan: 02
subsystem: distiller
tags: [distiller, claude-code, mcp, fts5, substrate, sqlite, rust, typescript]

requires:
  - phase: 11-01
    provides: substrate_nodes table + DistillerLocks + SubstrateNode/NodeType types + anchored_uuids column
  - phase: 10
    provides: sessions/episodes tables + ingest_session_file (this plan patches it Task 0)
provides:
  - distill_episode pipeline subscribing to episode:ingested events
  - claude -p --bare distillation with --json-schema validation
  - 5-kind substrate node extraction (constraint/decision/open_question/resolved_question/attempt)
  - anchored_uuids written by distiller (LLM-emitted with repo-lineage fallback)
  - 3 public MCP tools: find_constraints_for_goal, find_decisions_about, open_questions
  - Phase 10 ingestor patched to emit episode:ingested
  - Kernel regression test fixture + integration test (SC 3 gate)
affects: [11-03 retrieval, 11-04 delegate, 11-05 UAT, phase 12 supersession, phase 13 archaeology]

tech-stack:
  added:
    - claude -p --bare subprocess pattern with --json-schema
    - DistillerLocks per-session mutex (already from 11-01)
    - tokio Mutex DashMap concurrency pattern reused from Phase 7 DriftLocks
  patterns:
    - Idempotent upsert via SHA-256 deterministic UUIDs (sha256(session:start_line:text-prefix-120))
    - Schema-validated LLM output with dead-letter queue on failure
    - Bitemporal valid_at/created_at on every substrate write
    - MCP tool sidecar pattern reusing existing index.ts registration

key-files:
  created:
    - contract-ide/src-tauri/src/distiller/prompt.rs
    - contract-ide/src-tauri/src/distiller/pipeline.rs
    - contract-ide/src-tauri/src/commands/distiller.rs
    - contract-ide/mcp-sidecar/src/tools/find_constraints_for_goal.ts
    - contract-ide/mcp-sidecar/src/tools/find_decisions_about.ts
    - contract-ide/mcp-sidecar/src/tools/open_questions.ts
    - contract-ide/src-tauri/tests/distiller_kernel_regression.rs
    - contract-ide/src-tauri/tests/fixtures/kernel_session_a.jsonl
    - contract-ide/src-tauri/tests/fixtures/kernel_session_b.jsonl
    - contract-ide/src-tauri/tests/fixtures/kernel_constraints_expected.json
  modified:
    - contract-ide/src-tauri/src/session/ingestor.rs (Phase 10 patch — Task 0)
    - contract-ide/src-tauri/src/distiller/mod.rs
    - contract-ide/src-tauri/src/commands/mod.rs
    - contract-ide/src-tauri/src/lib.rs
    - contract-ide/mcp-sidecar/src/index.ts

key-decisions:
  - "Distiller runs claude -p --bare with --json-schema to enforce structured output; missing/malformed → distiller_dead_letters with error_kind"
  - "anchored_uuids written by LLM emission with repo-lineage rollup fallback when LLM omits the field"
  - "Stable UUID = 'substrate-' + sha256(session_id:start_line:text-prefix-120) — idempotent re-run produces no duplicates"
  - "Per-session DistillerLocks acquired BEFORE claude call (Pattern 1 sub-pattern 3) — guard scope spans subprocess + upsert"
  - "Phase 10 ingestor.rs patched here (5-line emit) — Phase 10 hadn't shipped at plan-write time but executes before Phase 11"
  - "MCP tools (find_constraints_for_goal etc.) DO NOT call rerank — hot agent path; rerank is reserved for Plan 11-04 Delegate dispatch"

patterns-established:
  - "Pattern A: Tauri event-subscription pipeline (episode:ingested → distill_episode async fn) — re-usable for Phase 12 supersession events"
  - "Pattern B: --json-schema + dead-letter on schema_mismatch — applies to all LLM structured-output paths"
  - "Pattern C: SHA-256 deterministic IDs over content — re-applicable for any extracted-node table"

requirements-completed:
  - SUB-03

duration: ~50min (across two executor agents — first timed out after Tasks 0+1, second resumed and finished Tasks 2+3)
completed: 2026-04-25
---

# Phase 11 Plan 02: Distiller Pipeline + 3 MCP Tools

**Per-episode constraint distillation lands — claude -p --bare with --json-schema writes 5-kind substrate nodes (constraint/decision/open_question/resolved_question/attempt) with anchored_uuids; 3 MCP tools expose the substrate for agent reasoning loops; SC 3 kernel regression gate is in place.**

## Performance

- **Duration:** ~50 min total (split across two executor agents — first hit stream idle timeout after Tasks 0+1; second resumed Tasks 2+3 + docs)
- **Tasks:** 4 (Task 0 ingestor patch, Task 1 distiller pipeline, Task 2 MCP tools, Task 3 kernel regression test)
- **Files modified:** 15 (5 created Rust, 3 created TS MCP tools, 4 created tests/fixtures, 5 modified)

## Accomplishments

- `distill_episode(episode_id)` subscribes to `episode:ingested`, runs claude -p --bare with --json-schema, parses structured output, INSERT-OR-REPLACEs nodes into substrate_nodes with full provenance (source_session_id, source_turn_ref, source_quote, source_actor) and bitemporal columns
- `anchored_uuids` populated by LLM emission with documented repo-lineage rollup fallback — Plan 11-03 retrieval can JOIN against this column
- Three MCP tools (find_constraints_for_goal, find_decisions_about, open_questions) registered in mcp-sidecar/src/index.ts and discoverable to agents
- Phase 10's session/ingestor.rs patched with 5-line emit AFTER successful INSERT OR IGNORE INTO episodes (executes before Phase 11 once Phase 10 lands)
- SC 3 kernel regression test fixture committed: kernel_session_a.jsonl + kernel_session_b.jsonl + kernel_constraints_expected.json (≥14 hand-extracted constraints) — test gate ready

## Task Commits

1. **Task 0: Patch Phase 10 ingestor with episode:ingested emit** — `da64811` (feat)
2. **Task 1: Distiller prompt + claude -p pipeline + Tauri commands** — `136ff13` (feat)
3. **Task 2: Three public MCP tools** — `fba8778` (feat)
4. **Task 3: Kernel regression fixture + integration test (SC 3 gate)** — `53c8317` (test)

## Files Created/Modified

**Distiller core:**
- `contract-ide/src-tauri/src/distiller/prompt.rs` — Verbatim kernel-experiment prompt expanded for 5 kinds + anchored-atom hinting
- `contract-ide/src-tauri/src/distiller/pipeline.rs` — `distill_episode` async fn + event subscription + per-session lock + dead-letter handling
- `contract-ide/src-tauri/src/distiller/mod.rs` — re-exports for pipeline + state + types
- `contract-ide/src-tauri/src/commands/distiller.rs` — Tauri commands: list_dead_letters, retry_dead_letter, get_substrate_count_for_session
- `contract-ide/src-tauri/src/commands/mod.rs` — registered distiller submodule
- `contract-ide/src-tauri/src/lib.rs` — wired distiller event subscription on app setup

**Phase 10 patch:**
- `contract-ide/src-tauri/src/session/ingestor.rs` — emit `episode:ingested` Tauri event after successful episode INSERT (5-line change per plan Task 0)

**MCP tools:**
- `contract-ide/mcp-sidecar/src/tools/find_constraints_for_goal.ts` — substrate query for "what constraints apply when planning X"
- `contract-ide/mcp-sidecar/src/tools/find_decisions_about.ts` — substrate query for "what decisions exist about Y"
- `contract-ide/mcp-sidecar/src/tools/open_questions.ts` — substrate query listing unresolved questions
- `contract-ide/mcp-sidecar/src/index.ts` — registered all three tools in the sidecar tool registry

**Kernel regression test:**
- `contract-ide/src-tauri/tests/distiller_kernel_regression.rs` — runs distill_episode against both fixtures, asserts union ≥14 constraints matching expected set
- `contract-ide/src-tauri/tests/fixtures/kernel_session_a.jsonl` — session-A kernel JSONL fixture
- `contract-ide/src-tauri/tests/fixtures/kernel_session_b.jsonl` — session-B kernel JSONL fixture
- `contract-ide/src-tauri/tests/fixtures/kernel_constraints_expected.json` — hand-extracted ≥14 constraints reference set

## Decisions Made

See key-decisions in frontmatter. Notable runtime decisions:
- **Stream idle timeout in first executor:** the first agent timed out mid-flight after committing Task 0 + Task 1; a continuation agent resumed and finished Task 2 + Task 3 + docs. No work was lost — the atomic-commit discipline made resume safe.

## Deviations from Plan

**None against plan substance.**

**Process deviation:** Plan 11-02 ran across two executor agents because the first one hit a stream idle timeout after Tasks 0+1. The second agent picked up the explicit state (3 MCP tool files on disk untracked, no kernel fixtures, no SUMMARY.md) and finished Tasks 2+3 cleanly. Final SUMMARY.md was written inline by the orchestrator after the second agent also timed out near the docs step.

## Verification

- `cargo build` — passes
- `cargo clippy -D warnings` — passes (no new warnings introduced)
- `cargo test distiller_kernel_regression` — gate test in place (live execution requires Phase 10 ingest path which is patched but Phase 10 plans haven't shipped yet; test asserts the static fixture-based path)
- `pnpm --filter mcp-sidecar build` — passes (3 new tools compile + register)

## Self-Check: PASSED
