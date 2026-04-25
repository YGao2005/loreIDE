---
phase: 02-contract-data-layer
plan: 01
subsystem: data-layer
tags: [sqlite, migrations, sidecar, frontmatter, yaml, serde, tauri-plugin-fs, tauri-plugin-dialog, walkdir, uuid, sha2]

# Dependency graph
requires:
  - "Plan 01-02: migration v1 (create_core_tables, immutable); lib.rs builder with plugin chain; db module pattern"
  - "Plan 01-01: tauri scaffold with macos-private-api, Cargo.toml dep conventions"
provides:
  - "Migration v2 (add_code_ranges_and_kind): nodes.code_ranges TEXT + nodes.kind TEXT NOT NULL DEFAULT 'unknown' applied additively to existing v1 DB"
  - "ContractFrontmatter struct + CodeRange struct covering all DATA-01 fields (format_version, uuid, kind, level, parent, neighbors, code_ranges, code_hash, contract_hash, human_pinned, route, derived_at)"
  - "parse_sidecar() / write_sidecar() round-trip helpers in crate::sidecar::frontmatter"
  - "3 unit tests: round_trip_preserves_every_field, missing_opening_fence_is_an_error, defaults_apply_for_optional_fields — all green"
  - "New Rust deps compiled: serde_yaml_ng 0.10.0, walkdir 2.5.0, uuid 1.23.1 (v4), sha2 0.11.0, hex 0.4.3, tauri-plugin-fs 2.5.0 (watch), tauri-plugin-dialog 2.7.0"
  - "tauri_plugin_fs::init() + tauri_plugin_dialog::init() registered in Tauri builder"
affects: [02-02, 02-03, 03, 04, 05, 06, 07, 08, 09]

# Tech tracking
tech-stack:
  added:
    - "serde_yaml_ng 0.10.0 — replacement for deprecated serde_yaml; uses unsafe-libyaml under the hood"
    - "walkdir 2.5.0 — recursive directory traversal for Phase 2 scanner"
    - "uuid 1.23.1 (v4 feature) — UUID generation for new contract nodes"
    - "sha2 0.11.0 — SHA-256 hashing for code_hash / contract_hash"
    - "hex 0.4.3 — encode hash bytes to hex strings"
    - "tauri-plugin-fs 2.5.0 (watch feature) — file system access + watch() API for Phase 2 watcher"
    - "tauri-plugin-dialog 2.7.0 — native folder picker for Phase 2 SHELL-02"
  patterns:
    - "Sidecar parse pattern: strip opening --- fence, find \\n---\\n closing fence (newline on BOTH sides prevents in-body --- misparse), extract YAML block, parse with serde_yaml_ng::from_str"
    - "Single-writer rule: all sidecar .md writes route through write_sidecar() in Rust — JS never writes sidecar files directly"
    - "Crate name vs package name: serde_yaml_ng uses underscores in Cargo.toml (serde-yaml-ng hyphenated name not found on crates.io); serde_yaml_ng is referenced in code as serde_yaml_ng"
    - "Dead-code lint on public helpers: parse_sidecar/write_sidecar generate dead_code warnings until Plan 02-02 wires them — expected, not a defect"

key-files:
  created:
    - "/Users/yang/lahacks/contract-ide/src-tauri/src/sidecar/mod.rs"
    - "/Users/yang/lahacks/contract-ide/src-tauri/src/sidecar/frontmatter.rs"
  modified:
    - "/Users/yang/lahacks/contract-ide/src-tauri/Cargo.toml"
    - "/Users/yang/lahacks/contract-ide/src-tauri/Cargo.lock"
    - "/Users/yang/lahacks/contract-ide/src-tauri/src/db/migrations.rs"
    - "/Users/yang/lahacks/contract-ide/src-tauri/src/lib.rs"

key-decisions:
  - "Cargo.toml dep name is serde_yaml_ng (underscores) — the hyphen variant serde-yaml-ng is NOT the registered crates.io name. Code uses extern crate serde_yaml_ng; serde_yaml_ng::from_str"
  - "In-body --- guard: parse_sidecar searches for \\n---\\n (newline on both sides) as the closing fence sentinel, not bare ---; this is the critical Pitfall 6 fix ensuring a markdown horizontal rule in the body doesn't truncate the body text"
  - "tauri-plugin-fs watch feature required at Cargo.toml time: omitting it causes the plugin to compile without the notify backend, making watch() calls panic at runtime (Pitfall 7)"
  - "parse_sidecar body extraction: after finding end=rest.find(\"\\n---\\n\"), skip end+1 to get to the --- line, then find the next \\n to skip past ---\\n, then trim leading newlines — this handles the blank line between --- fence and body text"

patterns-established:
  - "Sidecar module layout: src-tauri/src/sidecar/{mod.rs,frontmatter.rs}; lib.rs declares mod sidecar; consumers use crate::sidecar::frontmatter::parse_sidecar"
  - "All frontmatter round-trips route through serde_yaml_ng — no manual YAML string building"

requirements-completed: [DATA-01, DATA-06]

# Metrics
duration: ~25min
completed: 2026-04-24
---

# Phase 2 Plan 1: Phase 2 Foundation — Migration v2 + Sidecar Frontmatter Parser Summary

**Migration v2 (code_ranges TEXT + kind TEXT) lands additively on existing v1 DB; ContractFrontmatter + parse/write helpers with serde_yaml_ng cover the full DATA-01 schema and pass 3 round-trip unit tests including in-body --- survival.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-24T22:03:07Z
- **Completed:** 2026-04-24T22:28:00Z
- **Tasks:** 2 (both type="auto", no checkpoints)
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments

- Migration v2 (`add_code_ranges_and_kind`, version 2) appended to the migration vec without touching v1 — existing DB gets `code_ranges TEXT` and `kind TEXT NOT NULL DEFAULT 'unknown'` on next launch; `_sqlx_migrations` row `2 | add_code_ranges_and_kind` applied additively
- All 7 new Rust deps compile clean: `serde_yaml_ng 0.10.0`, `walkdir 2.5.0`, `uuid 1.23.1`, `sha2 0.11.0`, `hex 0.4.3`, `tauri-plugin-fs 2.5.0` (watch feature active), `tauri-plugin-dialog 2.7.0`
- `tauri_plugin_fs::init()` + `tauri_plugin_dialog::init()` registered in the Tauri builder alongside existing plugins
- `ContractFrontmatter` struct with all 13 DATA-01 fields and `CodeRange` struct implement Serialize/Deserialize via serde
- `parse_sidecar()` correctly handles the Pitfall 6 in-body `---` case: the full FULL_SIDECAR test constant has a `---` horizontal rule inside the body, and the body text after it ("Second paragraph after a markdown horizontal rule") survives both parse and round-trip
- 3 unit tests green: `round_trip_preserves_every_field`, `missing_opening_fence_is_an_error`, `defaults_apply_for_optional_fields`

## Task Commits

1. **Task 1: Add Phase 2 Rust deps + migration v2** — `238dbb8` (feat)
2. **Task 2: Sidecar frontmatter parser/writer + round-trip tests** — `63f5b8d` (feat)

**Plan metadata commit:** pending (this commit)

## Files Created / Modified

**Created**
- `contract-ide/src-tauri/src/sidecar/mod.rs` — module root re-exporting `pub mod frontmatter`
- `contract-ide/src-tauri/src/sidecar/frontmatter.rs` — `ContractFrontmatter` + `CodeRange` structs, `parse_sidecar()`, `write_sidecar()`, 3 unit tests (108 lines)

**Modified**
- `contract-ide/src-tauri/Cargo.toml` — added 7 new deps (serde_yaml_ng, walkdir, uuid, sha2, hex, tauri-plugin-fs[watch], tauri-plugin-dialog)
- `contract-ide/src-tauri/Cargo.lock` — updated lockfile (21 new packages)
- `contract-ide/src-tauri/src/db/migrations.rs` — appended Migration v2 (`add_code_ranges_and_kind`) after v1; v1 completely untouched
- `contract-ide/src-tauri/src/lib.rs` — added `mod sidecar;`, `.plugin(tauri_plugin_fs::init())`, `.plugin(tauri_plugin_dialog::init())`

## Decisions Made

1. **serde_yaml_ng package name uses underscores.** The PLAN.md and RESEARCH.md refer to the dependency as `serde-yaml-ng` (hyphenated), following Rust crate naming conventions. However, crates.io registers it as `serde_yaml_ng` (underscores); `cargo search serde_yaml_ng` confirms the correct name. First build attempt with `serde-yaml-ng = "0.10"` failed immediately with "no matching package found". Fix: renamed to `serde_yaml_ng = "0.10"` in Cargo.toml. Code uses `serde_yaml_ng::from_str` / `serde_yaml_ng::to_string` as expected.

2. **parse_sidecar body-extraction logic.** The PLAN.md code uses a two-step body extraction: find `\n---\n` fence end index, then re-derive `body_start` by finding a second `\n` via a `rest[end..].find('\n')` call. During implementation I simplified this to: skip `end+1` to reach the `---` line, find its terminating `\n`, then advance past it, then `trim_start_matches` to drop the blank separator line. Both approaches produce the same result for the test constant; the simplified version is slightly cleaner.

3. **tauri-plugin-fs watch feature confirmed.** `cargo tree` output shows `tauri-plugin-fs v2.5.0` in the dependency graph; the watch feature pulls in `notify v8.2.0` and `notify-debouncer-full v0.6.0` confirming the runtime watch backend is present.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] serde-yaml-ng package name incorrect — crates.io uses serde_yaml_ng**
- **Found during:** Task 1 (first `cargo build` attempt)
- **Issue:** PLAN.md specifies `serde-yaml-ng = "0.10"` (hyphenated), but the crate is registered on crates.io as `serde_yaml_ng` (underscores). `cargo build` immediately failed: "no matching package found; searched package name: `serde-yaml-ng`; perhaps you meant: `serde_yaml_ng`"
- **Fix:** Changed `serde-yaml-ng = "0.10"` to `serde_yaml_ng = "0.10"` in Cargo.toml. The `use serde_yaml_ng::` code path in frontmatter.rs remains unchanged (already used underscores).
- **Files modified:** `contract-ide/src-tauri/Cargo.toml`
- **Verification:** `cargo build` exits 0; `cargo tree | grep serde_yaml` shows `serde_yaml_ng v0.10.0` with no deprecated marker
- **Committed in:** `238dbb8` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 – Blocking). **Impact on plan:** Single narrow name correction; all plan semantics preserved exactly. No scope creep.

## Issues Encountered

None beyond the dep name correction documented above.

## User Setup Required

None. Migration v2 runs automatically at next `npm run tauri dev` launch against the existing v1 DB. No manual `sqlite3` or DB deletion required.

## Next Phase Readiness

- **Plan 02-02** (scanner + write_contract command) can `use crate::sidecar::frontmatter::{parse_sidecar, write_sidecar, ContractFrontmatter}` immediately — module is wired and compiles
- **Plan 02-03** (folder picker + watcher wiring) can use `tauri_plugin_fs` watch API and `tauri_plugin_dialog` — both plugins registered in the builder; capabilities permissions will be added in that plan as planned
- **Phase 3+** (graph canvas): `nodes.kind` and `nodes.code_ranges` columns will be present when Phase 2 scanner begins inserting rows

---
*Phase: 02-contract-data-layer*
*Completed: 2026-04-24*

## Self-Check: PASSED
