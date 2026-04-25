---
phase: 08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation
plan: "01"
subsystem: propagation-foundation
tags: [section-parser, frontmatter-v3, migration, pulldown-cmark, PROP-01]
requires: []
provides: [section-parser-module, frontmatter-v3-schema, migration-v3, section-parser-cli-binary]
affects: [08-02, 08-03, 08-04, 08-05, 08-06]
tech-stack:
  added:
    - pulldown-cmark 0.13 (section parser, offset_iter API)
    - thiserror 1 (ParseError derive)
  patterns:
    - collect_h2_bounds single-pass offset_iter, then BTreeMap slice-from-source
    - skip_serializing_if for optional Phase 8 YAML fields (lazy migration)
    - section-parser-cli standalone bin, MCP IPC via execFileSync + SECTION_PARSER_CLI_PATH env var
key-files:
  created:
    - contract-ide/src-tauri/src/sidecar/section_parser.rs
    - contract-ide/src-tauri/binaries/section-parser-cli/Cargo.toml
    - contract-ide/src-tauri/binaries/section-parser-cli/src/main.rs
    - contract-ide/src-tauri/binaries/section-parser-cli/src/section_parser.rs
    - contract-ide/src-tauri/binaries/section-parser-cli-aarch64-apple-darwin
    - contract-ide/src-tauri/tests/section_parser_tests.rs
    - contract-ide/src-tauri/tests/fixtures/contract_beat1_body.md
    - contract-ide/src-tauri/tests/fixtures/contract_api_l3.md
    - contract-ide/src-tauri/tests/fixtures/contract_ui_l4.md
  modified:
    - contract-ide/src-tauri/src/sidecar/mod.rs
    - contract-ide/src-tauri/src/sidecar/frontmatter.rs
    - contract-ide/src-tauri/src/lib.rs
    - contract-ide/src-tauri/src/db/migrations.rs
    - contract-ide/src-tauri/Cargo.toml
    - contract-ide/src-tauri/tauri.conf.json
decisions:
  - "collect_h2_bounds single-pass approach: captures (name, heading_line_start, body_start) in one offset_iter walk. body_end for section i = heading_line_start of section i+1 (or EOF). No re-scan, no event re-generation."
  - "section-parser-cli is a standalone Cargo project (not a path dep on the main crate) because the main crate has cdylib/staticlib crate types that are incompatible with path dependencies in standalone bins."
  - "sidecar module made pub in lib.rs to allow integration tests in tests/ to import contract_ide_lib::sidecar::section_parser. Commands module also became pub as a linter side-effect — no behavior change."
  - "Fixtures contract_api_l3.md and contract_ui_l4.md have the same 5 section names (intent, inputs, outputs, examples, invariants) but in different source order. The order_independence_round_trip test asserts both produce alphabetically-sorted keys and that each fixture's hashes are stable across two calls."
  - "Migration v3 description is 'phase8_propagation_and_receipts' (immutable per STATE.md Pitfall 5 rule)."
  - "receipts table already existed from v1 migration. ALTER TABLE (not DROP/CREATE) adds the 3 new columns. receipt_nodes join table and idx_receipts_node_uuid index already exist — not recreated."
metrics:
  duration_minutes: 11
  tasks_completed: 3
  files_changed: 14
  completed_date: "2026-04-25"
---

# Phase 08 Plan 01: Propagation Foundation — Section Parser + Format v3 + Migration v3 Summary

**One-liner:** Canonical Rust section parser with pulldown-cmark offset_iter, ContractFrontmatter v3 with 5 Phase 8 fields (lazy migration), migration v3 adding rollup_derived table and receipts extensions, and a section-parser-cli binary for MCP sidecar IPC.

## What Was Built

### Task 1: Section parser + CLI binary + fixtures

**pulldown-cmark API used:** `Parser::new_ext(body, Options::all()).into_offset_iter()` returning `(Event, Range<usize>)` pairs. The `collect_h2_bounds` function does a single pass:

1. On `Event::Start(Tag::Heading { level: H2 })`, record `range.start` as `heading_line_start`.
2. Concatenate `Event::Text` and `Event::Code` payloads until `Event::End(TagEnd::Heading)`.
3. On end event, `range.end` is `body_start` (first byte after the heading's closing newline).

Section body for section i = `body[body_start_i .. heading_line_start_{i+1}]`, trimmed. No text re-generation, no second pass. `BTreeMap` key insertion detects duplicates.

**Deviation from RESEARCH.md Pattern 1:** RESEARCH described storing `(name, start_of_section_body_byte_offset)` then using a second pass to find heading_line_start. Implemented as a single pass collecting all three values simultaneously — cleaner and avoids the dead `heading_end_offset` variable that appeared in the first draft.

**Fenced-code handling:** Confirmed by `ignores_h2_inside_fenced_code` test — pulldown-cmark does not emit `Tag::Heading` for `## ` lines inside ` ``` ` fences. No extra logic needed.

**section-parser-cli location and MCP spawn pattern:**

Binary artifact: `contract-ide/src-tauri/binaries/section-parser-cli-aarch64-apple-darwin`

Registered in `tauri.conf.json`:
```json
"externalBin": ["binaries/mcp-server", "binaries/section-parser-cli"]
```

MCP TypeScript sidecar invocation (for 08-02 and 08-06 to copy verbatim):
```typescript
const result = child_process.execFileSync(
  process.env.SECTION_PARSER_CLI_PATH,
  [],
  { input: body, encoding: "utf-8" }
);
const { section_hashes } = JSON.parse(result);
```

Rust env var injection in `launch_mcp_sidecar` (to be wired in 08-02):
```rust
let target = std::env::consts::ARCH; // "aarch64"
let os = std::env::consts::OS; // "macos"
let triple = format!("{target}-apple-{os}"); // "aarch64-apple-macos" — adjust per Tauri convention
// More precisely via Tauri build env: target is "aarch64-apple-darwin"
let cli_path = app.path().resource_dir()
    .expect("resource_dir")
    .join("binaries")
    .join(format!("section-parser-cli-aarch64-apple-darwin"));
// In the CommandChild spawn block:
.env("SECTION_PARSER_CLI_PATH", cli_path)
```

### Task 2: ContractFrontmatter v3 with 5 Phase 8 fields

Five fields added to `ContractFrontmatter`, placed after all existing fields:
- `section_hashes: BTreeMap<String, String>` — `serde(default, skip_serializing_if = "BTreeMap::is_empty")`
- `rollup_inputs: Vec<RollupInput>` — `serde(default, skip_serializing_if = "Vec::is_empty")`
- `rollup_hash: Option<String>` — `serde(skip_serializing_if = "Option::is_none")`
- `rollup_state: Option<String>` — `serde(skip_serializing_if = "Option::is_none")`
- `rollup_generation: Option<u64>` — `serde(skip_serializing_if = "Option::is_none")`

`RollupInput { child_uuid: String, sections: Vec<String> }` added as a new public struct.

Lazy migration: `parse_sidecar` never calls `compute_section_hashes` — callers needing hashes call it explicitly. `write_sidecar` also does not auto-compute hashes (08-05 cherrypick will call `compute_section_hashes` before building the frontmatter to write). This is intentional — the write path in 08-05 sets `format_version: 3` and populates `section_hashes` before calling `write_sidecar`.

**Was any v2 sidecar mutated on launch?** Per the `frontmatter_v2_reads_without_persisting` test: mtime is identical before and after `read_sidecar_file`, and raw file content is byte-identical. Zero v2 sidecars are mutated.

### Task 3: Migration v3

Schema changes in `0003_phase8_propagation_and_receipts`:
- `nodes`: 5 new nullable columns (`section_hashes_json`, `rollup_inputs_json`, `rollup_hash`, `rollup_state`, `rollup_generation INTEGER DEFAULT 0`)
- New table `rollup_derived` (node_uuid PK, computed_rollup_hash, stored_rollup_hash, state, generation_at_check, checked_at)
- New index `idx_rollup_derived_state` on `rollup_derived(state)`
- `receipts` ALTER TABLE: 3 new columns (`raw_jsonl_path`, `parse_status DEFAULT 'ok'`, `wall_time_ms`)

**Did receipts table exist before v3?** YES. The v1 migration (`create_core_tables`) already created `receipts` with 13 columns and `receipt_nodes` join table with `idx_receipts_node_uuid` index. v3 uses `ALTER TABLE receipts ADD COLUMN` — no DROP/recreate needed. `receipt_nodes` and its index are NOT touched by v3.

## Deviations from Plan

### Auto-fixed Issues

**[Rule 2 - Missing functionality] Added `#![allow(dead_code)]` in section_parser.rs**
- **Found during:** Task 1 verification
- **Issue:** The linter (cargo fix) added `#![allow(dead_code)]` to silence warnings about public API not yet called from within the crate. This is the correct approach — the API will be called once 08-02..06 land.
- **Files modified:** `contract-ide/src-tauri/src/sidecar/section_parser.rs`
- **Commit:** 28b3931 (linter-applied, Task 1 commit)

**[Rule 3 - Blocking] Made `sidecar` module pub in lib.rs**
- **Found during:** Task 1 — integration tests in `tests/` need `use contract_ide_lib::sidecar::...`
- **Issue:** `mod sidecar;` was private; integration tests couldn't import from it.
- **Fix:** Changed to `pub mod sidecar;`
- **Files modified:** `contract-ide/src-tauri/src/lib.rs`
- **Commit:** 28b3931

**[Rule 3 - Blocking] clippy doc-lazy-continuation warning in frontmatter.rs**
- **Found during:** Task 2 clippy pass
- **Issue:** Doc comment line `/// / write_derived_contract / update_contract.` triggered `doc-lazy-continuation` lint (list item without indentation).
- **Fix:** Rewrote the sentence to avoid the slash-continuation pattern.
- **Files modified:** `contract-ide/src-tauri/src/sidecar/frontmatter.rs`
- **Commit:** e131f50

## Self-Check: PASSED

All files exist. All commits found. Key content verified:
- section_parser.rs: parse_sections, compute_section_hashes, ParseError
- frontmatter.rs: section_hashes, rollup_inputs, rollup_hash, rollup_state, rollup_generation
- migrations.rs: version: 3, rollup_derived table, receipts ALTER TABLE
- tauri.conf.json: section-parser-cli in externalBin
- Cargo.toml: pulldown-cmark = "0.13"
- contract_beat1_body.md: ## Intent, ## Role, ## Examples headings present
- All 30 tests pass (24 unit + 6 integration)
