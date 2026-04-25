# Deferred Items — Phase 02-contract-data-layer

## Pre-existing clippy warning in validation.rs (out-of-scope for 02-02)

- **File:** `contract-ide/src-tauri/src/commands/validation.rs:71`
- **Issue:** `map_or(false, |x| x == "json")` should use `is_some_and(|x| x == "json")`
- **Clippy rule:** `unnecessary_map_or`
- **Status:** Pre-existing, not introduced by Plan 02-02. Will surface as `-D warnings` failure
  on a whole-crate clippy run until fixed. Fix in next plan that touches validation.rs or
  a dedicated cleanup pass.
