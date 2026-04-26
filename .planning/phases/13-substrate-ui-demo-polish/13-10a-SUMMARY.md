---
phase: 13-substrate-ui-demo-polish
plan: 10a
subsystem: demo-data-layer
tags: [demo, fixtures, sqlite-seed, reset-script]
requires:
  - 13-01 (substrate_nodes schema columns: kind, state, intent_drift_state, invalid_at)
  - 13-09 (loadBeat3VerifierResults parentSurfaceUuid contract; harvest event shape)
  - 13-08 (diffToNodeMapper field expectations)
provides:
  - contract-ide/demo/reset-demo.sh — deterministic reset script
  - contract-ide/demo/seeds/substrate.sqlite.seed.sql — seed data
  - contract-ide/demo/seeds/blast-radius.json — Sync animation fixture
  - contract-ide/demo/seeds/beat3-verifier.json — Beat 3 verifier rows + flag
  - contract-ide/demo/seeds/beat4-harvest.json — Beat 4 harvest fixture
  - contract-ide/demo/seeds/contracts/README.md — Phase 9 sidecar contract requirements
affects:
  - 13-10b (consumes JSON fixtures via IPC layer)
  - 13-11 (rehearsal harness substitutes PLACEHOLDER-* uuids with Phase 9 real uuids)
tech-stack:
  patterns:
    - CREATE TABLE IF NOT EXISTS for defensive migration ordering
    - PLACEHOLDER-* uuid strings for Phase 9 substitution at rehearsal time
key-files:
  created:
    - contract-ide/demo/reset-demo.sh
    - contract-ide/demo/seeds/substrate.sqlite.seed.sql
    - contract-ide/demo/seeds/blast-radius.json
    - contract-ide/demo/seeds/beat3-verifier.json
    - contract-ide/demo/seeds/beat4-harvest.json
    - contract-ide/demo/seeds/contracts/README.md
decisions:
  - PLACEHOLDER-* uuid prefix strategy chosen for unambiguous Phase 9 substitution by 13-11
  - Defensive CREATE TABLE IF NOT EXISTS ensures seed runs cleanly even if Phase 11 distiller migration absent on demo machine
metrics:
  duration: ~10min
  tasks: 2
  files: 6
  completed: 2026-04-25
---

# Phase 13 Plan 10a: Demo Data Layer Summary

Pure data layer for the 4-beat live demo: deterministic SQLite seed (5 demo rules + parent intent_drifted constraint + 12 ambient padding), three JSON fixtures (Sync blast-radius, Beat 3 verifier rows + flag, Beat 4 harvest with N9 attached_to_uuid wiring), reset-demo.sh that kills the app, restores DB, and full-relaunches per 13-RESEARCH.md Pitfall 7. Zero overlap with sibling 13-10b's UI/IPC layer.

## What shipped

- **substrate.sqlite.seed.sql** — defensive `CREATE TABLE IF NOT EXISTS` for `substrate_nodes` and `l0_priority_history`; 5 verbatim demo rules from scenario-criteria.md § 6 (`dec-soft-delete-30day-grace-2026-02-18`, `con-anonymize-not-delete-tax-held-2026-03-04`, `con-stripe-customer-archive-2026-02-22`, `con-mailing-list-suppress-not-delete-2026-03-11`, `dec-confirm-via-email-link-2026-02-18`); 1 parent-surface constraint with `state='intent_drifted'` (`con-settings-no-modal-interrupts-2025-Q4`) for orange-flag fixture per § 8; priority history rows (`reduce-onboarding-friction` superseded `2026-04-01` by `compliance-first`); 12 ambient padding nodes across unrelated topics (Tailwind, Postgres, Zod, Radix, etc.). PRAGMA user_version = 13.
- **blast-radius.json** — `trigger_uuid` + 5 `participant_uuids` using `PLACEHOLDER-*` strings for unambiguous 13-11 substitution.
- **beat3-verifier.json** — 6 honor rows (1 contract match + 5 keyed by demo rule uuids) + 3 implicit decisions + 1 flag with `parentSurfaceUuid` placeholder.
- **beat4-harvest.json** — 3 harvested nodes; one with `promoted_from_implicit: true`; each carries `attached_to_uuid` per checker N9 for green-halo wiring.
- **contracts/README.md** — documents Phase 9 sidecar contract list (surfaces, atoms, backend participants, flow contracts) for plan 13-11's `--verify-contracts` rehearsal flag.
- **reset-demo.sh** — 5-step idempotent script (pkill → git reset demo repo → sqlite seed apply → open .app or fallback `tauri dev` → 3s boot wait); env-overrideable `REPO_ROOT`, `DEMO_REPO_DIR`, `DEMO_LOCKED_COMMIT`; backs up prior DB to `.before-reset.bak`. Budget ~11s nominal, well under 15s ceiling.

## Verification

- `sqlite3 :memory: < substrate.sqlite.seed.sql` exits 0.
- `jq` validates all 3 JSON fixtures.
- `jq '.rows | length'` → 6; `.implicitDecisions | length` → 3; `.flag.kind` → `"flag"`.
- `jq '.harvested_nodes | length'` → 3; one with `promoted_from_implicit: true`; all 3 have `attached_to_uuid`.
- `bash -n reset-demo.sh` parses; script is executable.
- End-to-end timed run **deferred to plan 13-11 rehearsal** (requires real .app bundle + demo repo present; this plan ships the script — measured runtime is a rehearsal-time output, not a build-time output).

## Phase 9 dependency at this point

Phase 9 contracts were NOT physically inspected during this plan — the placeholder strategy (`PLACEHOLDER-screen-account-settings`, etc.) was used as the substitution mechanism. Plan 13-11's rehearsal harness must:
1. Read each placeholder string
2. Resolve via Phase 9 nodes table (lookup by sidecar path → uuid)
3. Rewrite the JSON fixtures in place (or pass through a substitution layer to the IPC reader)

If Phase 9 sidecar contracts have not shipped at rehearsal time, plan 13-11's `--verify-contracts` flag (per `contracts/README.md`) surfaces the gap.

## Deviations from Plan

None — plan executed exactly as written. Substrate content is verbatim from scenario-criteria.md § 6 / § 8 per spec.

## Self-Check: PASSED

- contract-ide/demo/reset-demo.sh — FOUND (executable)
- contract-ide/demo/seeds/substrate.sqlite.seed.sql — FOUND
- contract-ide/demo/seeds/contracts/README.md — FOUND
- contract-ide/demo/seeds/blast-radius.json — FOUND
- contract-ide/demo/seeds/beat3-verifier.json — FOUND
- contract-ide/demo/seeds/beat4-harvest.json — FOUND
- Commit eace1b3 — FOUND
- Commit 11d58ba — FOUND
