---
phase: 06-contract-derivation
plan: 01
subsystem: rust-backend
tags: [derivation, llm, anthropic, hash, tauri-command, reqwest, chrono, superseded]
superseded_by: 06-02
supersession_note: "Plan 06-02 pivoted Phase 6 from a Rust-side Anthropic API client to MCP-driven derivation via the user's active Claude Code session. The derive_contracts Tauri command, call_anthropic_for_contract, derive:progress events, reqwest + chrono deps introduced by 06-01 were all reverted in 06-02's commit. The hash helpers (compute_code_hash, compute_contract_hash, extract_source) + their unit tests were RETAINED in commands/derive.rs as the canonical Rust reference implementation for Phase 7 drift detection; the TS port in mcp-sidecar/src/tools/write_derived_contract.ts must stay byte-for-byte aligned."
dependency_graph:
  requires: [02-01, 02-02, 05-01]
  provides: [derive_contracts Tauri command, compute_code_hash baseline, derive:progress event shape]
  affects: [06-02-PLAN (UI layer), 07-drift-detection (code_hash baseline consumer)]
tech_stack:
  added: [reqwest 0.12.28 (json + rustls-tls), chrono 0.4.44 (serde), tempfile 3 (dev-dep)]
  patterns: [tauri::async_runtime::spawn non-blocking pattern, temp+atomic-rename sidecar write, per-uuid Tauri event emission, single reqwest::Client per batch]
key_files:
  created: [contract-ide/src-tauri/src/commands/derive.rs]
  modified:
    - contract-ide/src-tauri/Cargo.toml
    - contract-ide/src-tauri/Cargo.lock
    - contract-ide/src-tauri/src/commands/mod.rs
    - contract-ide/src-tauri/src/lib.rs
    - contract-ide/src-tauri/src/commands/validation.rs
decisions:
  - "reqwest 0.12 with default-features=false + rustls-tls: verified cargo tree | grep openssl returns empty; no OpenSSL/SecureTransport linkage on macOS"
  - "derive_contracts spawns via tauri::async_runtime::spawn (not tokio::spawn, not spawn_blocking) — Tauri owns the runtime per RESEARCH Pitfall 1"
  - "Single reqwest::Client constructed once per derive_contracts invocation and reused across the batch — connection pooling; per-call clients are the anti-pattern"
  - "Guard order in derive_one: human_pinned check LEXICALLY BEFORE hash-skip BEFORE LLM call — matches DERIVE-03 → DERIVE-02 → DERIVE-01 priority"
  - "compute_code_hash(empty_ranges) returns None (not error) — caller emits skipped for conceptual L0/L1 nodes with no file backing"
  - "Doc comment over-indentation (clippy::doc_overindented_list_items) fixed in module-level comment — was caused by the plan's code template using two-space continuation for aligned bullet text"
  - "Drive-by: fixed pre-existing clippy::unnecessary_map_or in validation.rs (map_or(false, ...) → is_some_and); required for -D warnings to pass on the full crate"
metrics:
  duration: "~3 min"
  completed: "2026-04-24"
  tasks_completed: 2
  files_changed: 6
---

# Phase 6 Plan 01: Rust Derivation Pipeline Summary

One-liner: Non-blocking `derive_contracts` Tauri command with SHA-256 code/contract hashing, human-pinned + hash-skip guards, Anthropic claude-haiku-4-5 LLM call, atomic sidecar rewrite, and SQLite upsert — first code in the repo that actually computes `code_hash`.

## What Was Built

### Pure-function helpers (`compute_code_hash`, `compute_contract_hash`, `extract_source`, `call_anthropic_for_contract`)

`compute_code_hash` iterates `code_ranges`, reads only the referenced lines from each file, feeds them into SHA-256 with newline terminators, and returns `Option<String>` — `None` for empty ranges (conceptual nodes) or unreadable files. End-line is clamped to actual file length.

`compute_contract_hash` SHA-256s the trimmed body text so trailing editor newlines don't create spurious drift signals in Phase 7.

`extract_source` collects lines up to `max_lines` (150), emits a `// ... N lines truncated` marker when the budget is exceeded, and prefixes each range with a `// filename` comment so the LLM has file context.

`call_anthropic_for_contract` POSTs to `https://api.anthropic.com/v1/messages` with `model: claude-haiku-4-5`, `max_tokens: 256`, a prose-only system prompt, and a per-uuid user prompt. Returns the trimmed assistant text.

### Tauri command (`derive_contracts`)

- Returns `Ok(())` immediately; all work runs inside `tauri::async_runtime::spawn`
- Reads `ANTHROPIC_API_KEY` at invocation time (not at startup)
- Resolves repo path via `app.try_state::<RepoState>().0.lock()`
- Constructs one `reqwest::Client` per invocation with 60s timeout
- Processes uuids sequentially via `derive_one`

### `derive_one` guard sequence

1. Emit `running`
2. Load + parse sidecar
3. `human_pinned = true` → emit `skipped-pinned`, return (no LLM, no write)
4. `code_ranges.is_empty()` → emit `skipped`, return
5. `compute_code_hash` → `None` → emit `error`, return
6. Hashes match AND body non-empty → emit `skipped`, return
7. Call Anthropic LLM
8. Update `fm.code_hash`, `fm.contract_hash`, `fm.derived_at` (RFC3339 via chrono)
9. `write_sidecar` → write to `.md.tmp` → `rename` to `.md` (atomic)
10. `upsert_node_pub(db, &fm, &llm_body)` — FTS5 rebuild included
11. Emit `done`

## Dependency Versions Resolved

- `reqwest` = **0.12.28** (Cargo.lock confirmed; rustls-tls active; openssl absent from cargo tree)
- `chrono` = **0.4.44** (serde feature; `Utc::now().to_rfc3339()` for `derived_at`)
- `tempfile` = **3.x** (dev-dep for unit tests)
- Anthropic model pin: **`claude-haiku-4-5`** (as specified in plan; not tested against live API in this plan — live test is Plan 06-02 UAT surface)

## OpenSSL Audit

`cargo tree | grep openssl` returns empty after adding reqwest 0.12 with `default-features = false`. `rustls-tls` feature routes through `rustls` + `webpki-roots` (visible in clippy compile output). No `native-tls`, `openssl`, or `security-framework` linkage.

## Unit Tests (5 new, all green)

| Test | Coverage |
|------|---------|
| `code_hash_covers_only_referenced_lines` | Determinism + range sensitivity |
| `code_hash_clamps_end_line_past_file_end` | Graceful file-length clamp |
| `code_hash_returns_none_for_empty_ranges` | None for empty input |
| `contract_hash_trims_whitespace` | Trim-before-hash invariant |
| `extract_source_caps_at_max_lines` | Truncation marker + cap |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Clippy doc-overindented-list-items in module doc comment**
- **Found during:** Task 1 verify (`cargo clippy -- -D warnings`)
- **Issue:** The plan's code template used deep indentation for bullet continuation lines (`//!                       `) which clippy treats as over-indented doc list items
- **Fix:** Reformatted module-level doc comment to use standard `//!   ` (2-space) continuation
- **Files modified:** `contract-ide/src-tauri/src/commands/derive.rs`

**2. [Rule 3 - Blocking] Pre-existing clippy::unnecessary_map_or in validation.rs**
- **Found during:** Task 2 verify (`cargo clippy -- -D warnings`)
- **Issue:** `validation.rs:71` used `.map_or(false, |x| x == "json")` which clippy flags as `unnecessary_map_or` when `-D warnings` is active — this blocked the plan's required clean clippy check
- **Fix:** Changed to `.is_some_and(|x| x == "json")` per clippy suggestion
- **Files modified:** `contract-ide/src-tauri/src/commands/validation.rs`
- **Note:** Pre-existing issue in unrelated file; fixed because it blocked the plan's `-D warnings` success criterion

## DevTools Smoke Test (Plan Specified)

The plan specifies three DevTools smoke checks. These require a running Tauri app with a repo open and are performed in Plan 06-02 UAT (which builds the UI surface). As a pre-check:
- `cargo build` clean proves the command is registered and compilable
- Guard ordering verified lexically: `fm.human_pinned` check appears before `compute_code_hash` call before `call_anthropic_for_contract` in `derive_one`
- Empty-uuid invocation safety: the `for uuid in &uuids {}` loop is a no-op; `Ok(())` is returned immediately; spawn exits cleanly

## Latency Target

The plan specifies sub-2s per Anthropic call target per RESEARCH. `call_anthropic_for_contract` uses `claude-haiku-4-5` with `max_tokens: 256` — haiku tier is the fastest Anthropic model. Live latency measurement deferred to Plan 06-02 UAT.

## Clippy Notes — Suggestions NOT Taken

None. All clippy suggestions were either fixed or did not apply to `derive.rs`. The `doc_overindented_list_items` fix was taken (not suppressed with `#[allow]`) because fixing the indentation is cleaner than a lint suppression.

## How Plan 06-02 Consumes This

Plan 06-02 (UI layer) depends on:

1. **`derive:progress` event shape** — `{ uuid: string, status: "running" | "done" | "skipped" | "skipped-pinned" | "error", message: string | null }` (camelCase via `serde(rename_all = "camelCase")`). The frontend listener calls `refreshNodes()` after each `status: done` event.

2. **`invoke('derive_contracts', { uuids: ['...'] })`** — Returns `Promise<void>` (Rust `Result<(), String>` maps to resolved/rejected). The frontend does NOT await the LLM result; it subscribes to `derive:progress` events first, then invokes.

3. **Guard semantics for UI feedback** — `skipped-pinned` should show a lock icon; `skipped` (hash-unchanged) should show a check; `error` should surface the `message` field in a toast or inline status.

## Self-Check: PASSED

- `contract-ide/src-tauri/src/commands/derive.rs` EXISTS
- `contract-ide/src-tauri/Cargo.toml` EXISTS (reqwest + chrono + tempfile added)
- `.planning/phases/06-contract-derivation/06-01-SUMMARY.md` EXISTS
- Commit `a926870` EXISTS: "feat(06-01): implement derive_contracts Tauri command + hash pipeline"
