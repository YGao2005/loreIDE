# Phase 14 — Deferred Items

Out-of-scope discoveries during plan execution. Each entry is logged with the discovering plan + task; resolution is for a future plan to pick up.

---

## D1. schema-rust-parity test fails to locate `pub struct Frontmatter` (Plan 14-03)

**Discovered during:** Plan 14-03 Task 2 — running `pnpm test` to verify discover.mjs + derive-frontmatter.mjs unit tests didn't break the existing test suite.

**Failure:**

```
✖ schema-vs-Rust parity: every non-Option Rust field appears in JSON Schema
  Error: Could not locate `pub struct Frontmatter` in frontmatter.rs
      at parseRustFrontmatterStruct (.../schema-rust-parity.test.mjs:38:11)
```

**Root cause (confirmed):** The Rust struct is `pub struct ContractFrontmatter` (line 40 of `contract-ide/src-tauri/src/sidecar/frontmatter.rs`), but `schema-rust-parity.test.mjs:38` greps for `pub struct Frontmatter` (without the `Contract` prefix). The 14-01b SUMMARY frontmatter even references `ContractFrontmatter` correctly — so the test was authored with a bug. One-line regex fix.

**Why deferred:** Pre-existing failure unrelated to Plan 14-03's scope (Stage 1 + Stage 2 of the bootstrap pipeline). Plan 14-03's tests (discover + derive-frontmatter) pass clean — this is bookkeeping for the parity smoke that was authored in 14-01b.

**Resolution path (for future plan):**

1. Confirm the actual Rust struct name in `contract-ide/src-tauri/src/sidecar/frontmatter.rs` (it may be `ContractFrontmatter`, not `Frontmatter`).
2. Either (a) update the regex in `schema-rust-parity.test.mjs:38` to match the real identifier, or (b) keep the test SKIPPED until parity refactor lands.
3. Once green, the parity test should print the field-by-field table promised in 14-01b's SUMMARY.

**Workaround in 14-03:** Plan 14-03's own tests (`scripts/__tests__/discover.test.mjs` + `scripts/__tests__/derive-frontmatter.test.mjs`) run via `node --test 'scripts/__tests__/*.test.mjs'` and pass 6/6. The parity test failure is in `scripts/helpers/__tests__/` and is the only failure in `pnpm test` (the rest pass: 6 deterministic-uuid + 4 frontmatter-writer + 6 discover + 9 derive-frontmatter).
