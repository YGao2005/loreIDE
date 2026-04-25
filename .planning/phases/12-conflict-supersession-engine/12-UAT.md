# Phase 12 UAT — Conflict / Supersession Engine

**Status:** Pending sign-off
**Phase Goals:** SC1 (fact-level supersession), SC2 (intent-level cascade), SC3 (no v1 regression), Beat 3 dual-path demo verification.
**Dependencies landed:** 12-01 (schema v7 + types), 12-02 (fact_engine + 3 IPC commands), 12-03 (intent_engine + 3 IPC commands), 12-04 Tasks 1+2 (adversarial harness + Beat 3 backstop).
**Author:** Claude (12-04 Task 3 deliverable)

---

## Pre-UAT Setup

Two terminal sessions, plus the IDE:

- **T1 — `claude` CLI authenticated.** Subscription auth via `claude login`. Confirm:
  ```bash
  claude -p "ping" --output-format text
  ```
  must return text (not an auth error). The harness in SC1+SC2 invokes this binary — the executor cannot script around an unauthenticated CLI.

- **T2 — Project root**, ready for `cargo` and `npm run tauri dev`.

- **IDE — App built two ways and ready to launch:**
  - Default build: `cd contract-ide/src-tauri && cargo build --release`
  - Demo backstop build: `cd contract-ide/src-tauri && cargo build --release --features demo-fixture`

Required env for SC1+SC2 harness: `CI_LLM_LIVE=1`.

Database: the dev SQLite at `~/Library/Application Support/com.contract-ide.app/contract-ide.db` should already have migrations 1–7 applied (12-01 verified v7 in place; 12-02/03 use it).

---

## SC1 — Fact-level supersession (SUB-06)

Verifies that ingesting a new substrate node that contradicts a stale current-truth node correctly invalidates the stale one with the Graphiti write-set (invalid_at + expired_at + invalidated_by + supersedes-edge).

### SC1.1 — Adversarial harness pass

```bash
cd /Users/yang/lahacks/contract-ide/src-tauri
CI_LLM_LIVE=1 cargo test --test fact_supersession_tests \
    -- --ignored --nocapture
```

**Expected:**
- Recall ≥ 0.80
- Precision ≥ 0.85
- All 5 fixtures (REST→gRPC, cache TTL 30s→1s, JWT→OAuth, Redis→Postgres MV, fire-forget→retry) exercised against real `claude -p`
- Final `Recall: x.xx` and `Precision: x.xx` lines printed

**Variance protocol:** If the first run misses the threshold:
1. Re-run twice more.
2. If 2 of 3 runs pass → accept (record per-run numbers in 12-04-SUMMARY).
3. If 0 or 1 of 3 runs pass → STOP, surface as failed checkpoint, do not auto-pass. The harness becomes the regression-blocking gate; record the variance details and convene gap-closure planning via `/gsd:plan-phase 12 --gaps`.

**Record in 12-04-SUMMARY:** the actual recall/precision number per run.

### SC1.2 — Manual contradiction round-trip

Verifies the live engine + DB write path end-to-end (independent of the harness).

1. Launch the default-build app: `cd contract-ide && npm run tauri dev` (or run the prebuilt `.app`). Open any repo (any path; this test isn't gated).

2. From a separate terminal, seed two contradicting substrate nodes via direct SQL on the dev DB:

   ```sql
   INSERT INTO substrate_nodes
     (uuid, node_type, text, applies_when, scope, valid_at, created_at, anchored_uuids)
   VALUES
     ('uat-stale-rest', 'constraint',
      'Use HTTP+JSON for service-to-service',
      'service-to-service comms', 'global',
      '2025-01-01T00:00:00Z', datetime('now'), '[]'),
     ('uat-new-grpc', 'constraint',
      'Use gRPC for service-to-service',
      'service-to-service comms', 'global',
      '2026-04-24T00:00:00Z', datetime('now'), '[]');
   ```

   (`created_at` and `anchored_uuids` are `NOT NULL` in the v6 schema; the seed above includes them.)

3. From the IDE devtools console:
   ```js
   await window.__TAURI_INTERNALS__.invoke(
     'ingest_substrate_node_with_invalidation',
     { newUuid: 'uat-new-grpc' }
   )
   ```
   (Use whatever invoke shim the app's frontend exposes; for raw Tauri 2 it's typically `window.__TAURI_INTERNALS__.invoke` or `@tauri-apps/api/core` `invoke`.)

4. **Expected return:** an array `["uat-stale-rest"]`.

5. **SQL invariant 1 — Graphiti write set on stale node:**
   ```sql
   SELECT uuid, invalid_at, expired_at, invalidated_by
     FROM substrate_nodes WHERE uuid = 'uat-stale-rest';
   ```
   - `invalid_at = '2026-04-24T00:00:00Z'` (matches new node's valid_at)
   - `expired_at` is non-NULL (a recent ISO timestamp)
   - `invalidated_by = 'uat-new-grpc'`

6. **SQL invariant 2 — supersedes edge:**
   ```sql
   SELECT id, source_uuid, target_uuid, edge_type
     FROM substrate_edges
    WHERE source_uuid = 'uat-new-grpc'
      AND target_uuid = 'uat-stale-rest'
      AND edge_type = 'supersedes';
   ```
   - Exactly one row (deterministic id, e.g., `supersedes-uat-new-grpc->uat-stale-rest`).

7. **Idempotency:** Re-run step 3. Expected return: `[]` (the stale is already invalidated; the WHERE-guard on `write_supersession` short-circuits).

8. **Current-truth filter:**
   ```sql
   SELECT uuid FROM substrate_nodes
    WHERE invalid_at IS NULL
      AND uuid IN ('uat-stale-rest', 'uat-new-grpc');
   ```
   - Returns only `uat-new-grpc`.

9. **Cleanup (post-UAT):**
   ```sql
   DELETE FROM substrate_edges WHERE source_uuid = 'uat-new-grpc';
   DELETE FROM substrate_nodes WHERE uuid IN ('uat-stale-rest','uat-new-grpc');
   ```

**Pass criterion:** All 4 invariants (return value, SQL 1, SQL 2, idempotency, current-truth) hold cleanly.

---

## SC2 — Intent-level cascade (SUB-07 — the moat)

Verifies that an L0 priority shift cascades drift judgments to descendant decisions through the Phase 8 rollup DAG, with the three-way verdict and confidence-tiered persistence.

### SC2.1 — Adversarial harness pass

```bash
cd /Users/yang/lahacks/contract-ide/src-tauri
CI_LLM_LIVE=1 cargo test --test intent_supersession_tests \
    -- --ignored --nocapture
```

**Expected:**
- ≥ 8 of 10 verdicts match the validated baseline (`research/intent-supersession/results.txt` is 9/10; tolerance lets one flip)
- d8 (single-region AWS) is `NEEDS_HUMAN_REVIEW` OR a low-confidence (< 0.85) `DRIFTED`
- Per-decision lines printed showing expected/got/conf/reasoning

**Variance protocol:** Same as SC1.1 — re-run twice if first miss; surface as failure if 2 of 3 fail. Record actual match-count in 12-04-SUMMARY.

### SC2.2 — Manual cascade end-to-end

Verifies the live engine path + DRY-RUN preview + apply path with real LLM judgments and DB writes.

1. Seed the contract DAG (Phase 8 schema). Substrate nodes anchor to a leaf contract via the Phase 11 `derived-from-contract` edge type.

   ```sql
   -- Contract DAG: 1 L0 (q4 priorities) + 1 L0 (compliance-first, the new one)
   --             + 1 L1 (account flow) anchored to new L0
   --             + 1 L3 (settings danger zone) anchored to L1
   INSERT INTO nodes (uuid, level, name, parent_uuid)
   VALUES
     ('uat-l0-q4',      'L0', 'Q4 Priorities',         NULL),
     ('uat-l0-2026',    'L0', 'Compliance First 2026', NULL),
     ('uat-l1-acct',    'L1', 'Account Flow',          'uat-l0-2026'),
     ('uat-l3-danger',  'L3', 'Settings Danger Zone',  'uat-l1-acct');

   -- Three substrate decisions, all anchored (via substrate_edges
   -- 'derived-from-contract') to the L3 leaf so the walker reaches them
   -- when traversing from new_l0_uuid.
   INSERT INTO substrate_nodes
     (uuid, node_type, text, applies_when, scope, valid_at, created_at, anchored_uuids)
   VALUES
     ('uat-d-modal-1', 'decision',
      'Settings page mutations are inline; no modal interrupts; users can correct mistakes via undo.',
      'editing user-facing destructive settings',
      'module:settings', '2025-09-01T00:00:00Z', datetime('now'),
      '["uat-l3-danger"]'),
     ('uat-d-modal-2', 'decision',
      'Profile-photo upload is fire-and-forget; success toast appears immediately, failures retry silently.',
      'profile photo flow',
      'module:settings', '2025-09-15T00:00:00Z', datetime('now'),
      '["uat-l3-danger"]'),
     ('uat-d-modal-3', 'decision',
      'TypeScript strict mode enabled across the settings module.',
      'compile-time correctness',
      'module:settings', '2025-08-15T00:00:00Z', datetime('now'),
      '["uat-l3-danger"]');

   -- Substrate edges to the L3 contract (walker join target).
   INSERT INTO substrate_edges (id, source_uuid, target_uuid, edge_type)
   VALUES
     ('uat-edge-1', 'uat-d-modal-1', 'uat-l3-danger', 'derived-from-contract'),
     ('uat-edge-2', 'uat-d-modal-2', 'uat-l3-danger', 'derived-from-contract'),
     ('uat-edge-3', 'uat-d-modal-3', 'uat-l3-danger', 'derived-from-contract');
   ```

2. Record the priority shift via the Tauri command:
   ```js
   const shiftId = await window.__TAURI_INTERNALS__.invoke(
     'record_priority_shift',
     {
       oldL0Uuid: 'uat-l0-q4',
       newL0Uuid: 'uat-l0-2026',
       validAt: '2026-04-24T00:00:00Z',
       summaryOfOld: 'reduce-onboarding-friction',
       summaryOfNew: 'compliance-first',
     }
   );
   console.log('shiftId:', shiftId);
   ```
   **Expected:** A UUID v4 returned. Save it for steps 3+4.

3. DRY-RUN preview (the safeguard before apply):
   ```js
   const preview = await window.__TAURI_INTERNALS__.invoke(
     'preview_intent_drift_impact_cmd',
     { priorityShiftId: shiftId }
   );
   console.log(preview);
   ```
   **Expected:** `ImpactPreview` with `sampled` (= 3, since we have 3 descendants), `would_drift` count, `would_surface` count, `would_filter` count, and a `representative_examples` array of up to 3 verdicts. Reasonable expectation: 1–3 will_drift (modal-1 and modal-2 likely drift; modal-3 is priority-neutral).

4. Apply the cascade:
   ```js
   const result = await window.__TAURI_INTERNALS__.invoke(
     'propagate_intent_drift_cmd',
     { priorityShiftId: shiftId }
   );
   console.log(result);
   ```
   **Expected:** `IntentDriftResult { judged: 3, drifted: <int>, surfaced: <int>, filtered: <int> }`.

5. **SQL invariant 1 — full audit in intent_drift_verdicts:**
   ```sql
   SELECT node_uuid, verdict, confidence, auto_applied
     FROM intent_drift_verdicts
    WHERE priority_shift_id = (SELECT id FROM priority_shifts ORDER BY created_at DESC LIMIT 1);
   ```
   - 3 rows (one per decision)
   - Each verdict ∈ `('DRIFTED','NOT_DRIFTED','NEEDS_HUMAN_REVIEW')`
   - `auto_applied = 1` for any DRIFTED with confidence ≥ 0.85
   - `auto_applied = 0` otherwise

6. **SQL invariant 2 — confidence-tiered state on substrate_nodes:**
   ```sql
   SELECT uuid, intent_drift_state, intent_drift_confidence
     FROM substrate_nodes
    WHERE uuid LIKE 'uat-d-modal-%';
   ```
   - For confidence ≥ 0.50: `intent_drift_state` populated (`'drifted'` / `'not_drifted'` / `'needs_human_review'`)
   - For confidence < 0.50: `intent_drift_state` IS NULL (filtered noise floor)

7. **Idempotency on second propagate:**
   ```js
   await window.__TAURI_INTERNALS__.invoke(
     'propagate_intent_drift_cmd',
     { priorityShiftId: shiftId }
   ).catch(e => console.log('expected error:', e));
   ```
   **Expected:** Error containing "already applied" (or similar). The shift's `applied_at` is set after the first apply.

8. **Event subscription:** Before step 4, register a listener:
   ```js
   const { listen } = await import('@tauri-apps/api/event');
   const unsub = await listen('substrate:intent_drift_changed', e => console.log('event:', e.payload));
   ```
   After step 4, expect 3 events with payloads `{uuid, verdict, confidence, auto_applied, priority_shift_id}` (one per decision).

9. **REJECT-overlapping-shifts:** With the first shift still applied, attempt to record a second shift before the first is acknowledged:
   ```js
   await window.__TAURI_INTERNALS__.invoke(
     'record_priority_shift',
     {
       oldL0Uuid: 'uat-l0-2026',
       newL0Uuid: 'uat-l0-q4', // bogus reverse direction
       validAt: '2026-05-01T00:00:00Z',
       summaryOfOld: 'compliance-first',
       summaryOfNew: 'reverted',
     }
   ).catch(e => console.log('expected error:', e));
   ```
   **Expected:** Per RESEARCH.md Q2, this should succeed only if the previous shift's `applied_at` is set (i.e., not pending). Verify by inspecting `priority_shifts.applied_at` for the first shift — if it's non-NULL (we applied it in step 4), this second `record_priority_shift` should succeed. If you want to test the reject path, manually `UPDATE priority_shifts SET applied_at = NULL WHERE id = '<first-shift-id>'`, then retry — should reject with "Another priority shift X is unapplied."

10. **Cleanup:**
    ```sql
    DELETE FROM intent_drift_verdicts;
    DELETE FROM priority_shifts;
    DELETE FROM substrate_edges WHERE id LIKE 'uat-edge-%';
    DELETE FROM substrate_nodes WHERE uuid LIKE 'uat-d-modal-%';
    DELETE FROM nodes WHERE uuid LIKE 'uat-l%';
    ```

**Pass criterion:** All 9 invariants (return value, SQL 1, SQL 2, idempotency, events, REJECT path) hold cleanly.

---

## SC3 — No v1 regression

Verifies that Phase 12's writes do NOT break Phase 7 drift detection or Phase 8 rollup state. The supersession schema is layered atop v6 — if any of the v6 indexes / FTS5 triggers / drift_state writes regressed, the canvas's existing red-pulse and amber-rollup signals would silently fail.

### SC3.1 — Phase 7 drift still works

1. With the app running and a real demo repo open, edit a code file inside a node's `code_ranges`. (Use the `contract-ide-demo` repo if available; or any repo with a contract that has cited code ranges.)
2. **Expected within 2s:** the drift watcher emits `drift:detected`, the canvas pulses red on that node, and `drift_state` has a new row for that node_uuid.
3. **SQL check:**
   ```sql
   SELECT node_uuid, drifted_at, reconciled_at FROM drift_state
    ORDER BY drifted_at DESC LIMIT 1;
   ```
   - `drifted_at` is recent
   - `reconciled_at` is NULL (no reconcile yet)

### SC3.2 — Phase 8 rollup still works

1. Edit a child sidecar's cited section in the same repo.
2. **Expected within 2s:** the rollup engine emits `rollup:stale` for the parent, the canvas shows an amber overlay on the parent, and `rollup_derived` has the parent in `'stale'` state.
3. **SQL check:**
   ```sql
   SELECT node_uuid, rollup_state, rollup_generation
     FROM rollup_derived
    ORDER BY updated_at DESC LIMIT 5;
   ```
   - The recently-edited parent appears with `rollup_state = 'stale'`.

### SC3.3 — Reconcile panel renders

1. Click the drifted node in the canvas.
2. **Expected:** the right-hand reconcile panel shows the existing 3-action set:
   - "Update contract to match code"
   - "Rewrite code to match contract"
   - "Acknowledge"
3. None of these are missing or relabeled.

### SC3.4 — Lib tests pass without LLM gate

```bash
cd contract-ide/src-tauri && cargo test --tests --release
```

**Expected:** All non-ignored tests pass (104+ lib + integration tests). No regressions versus 12-03 baseline (98/98) plus 12-04's 2 new fixture-load sanity tests = 106 total non-ignored expected.

**Pass criterion:** All 4 sub-checks (drift, rollup, reconcile UI, cargo test) clean.

---

## Beat 3 demo backstop verification

Verifies the cfg-gated `demo_force_intent_drift` Tauri command (12-04 Task 2) — the demo insurance per RESEARCH.md Pattern 6.

### Beat3.1 — Default build does NOT expose the backstop

1. Build default: `cargo build --release` (already done in pre-UAT). Launch.
2. From devtools:
   ```js
   await window.__TAURI_INTERNALS__.invoke('demo_force_intent_drift', {
     nodeUuid: 'whatever',
     confidence: 0.9,
     reasoning: 'test',
   }).catch(e => console.log(e));
   ```
3. **Expected:** Error string containing `"built without the \`demo-fixture\` cargo feature"`. The function exists (so JS callers don't see "command not found"), but the stub refuses to do anything.

### Beat3.2 — Demo build refuses non-demo repos (runtime gate)

1. Build with the feature: `cargo build --release --features demo-fixture`.
2. Open the app pointed at any repo whose path does NOT contain `"contract-ide-demo"` (e.g., a generic test repo).
3. From devtools, invoke the same command as Beat3.1.
4. **Expected:** Error containing `"refused: active repo path"` (the runtime gate fires).

### Beat3.3 — Demo build, demo repo, target uuid present

1. Demo build (from Beat3.2). Open or symlink a demo path (e.g., `~/contract-ide-demo` or any path containing the literal string `contract-ide-demo`).
2. Seed the target substrate node:
   ```sql
   INSERT OR IGNORE INTO substrate_nodes
     (uuid, node_type, text, applies_when, scope, valid_at, created_at, anchored_uuids)
   VALUES
     ('con-settings-no-modal-interrupts-2025-Q4', 'constraint',
      'Settings page interactions should be inline; no modal interrupts.',
      'editing user-facing destructive settings',
      'module:settings', '2025-12-01T00:00:00Z', datetime('now'), '[]');
   ```
3. Subscribe to the event before invoking:
   ```js
   const { listen } = await import('@tauri-apps/api/event');
   await listen('substrate:intent_drift_changed', e => console.log('backstop event:', e.payload));
   ```
4. Invoke:
   ```js
   await window.__TAURI_INTERNALS__.invoke('demo_force_intent_drift', {
     nodeUuid: 'con-settings-no-modal-interrupts-2025-Q4',
     confidence: 0.92,
     reasoning: 'Modal interrupts now expected for destructive actions under compliance-first priority.',
   });
   ```
5. **Expected return:** `null` (Ok(())).
6. **SQL check:**
   ```sql
   SELECT uuid, intent_drift_state, intent_drift_confidence,
          intent_drift_reasoning, intent_drift_judged_at,
          intent_drift_judged_against
     FROM substrate_nodes
    WHERE uuid = 'con-settings-no-modal-interrupts-2025-Q4';
   ```
   - `intent_drift_state = 'drifted'`
   - `intent_drift_confidence = 0.92`
   - `intent_drift_reasoning` matches the input
   - `intent_drift_judged_at` is a recent ISO timestamp
   - `intent_drift_judged_against IS NULL` (backstop has no priority-shift to cite)
7. **Event payload:** the listener should have fired once with payload `{uuid, verdict: "DRIFTED", confidence: 0.92, auto_applied: false, priority_shift_id: null, demo_backstop: true}`.

### Beat3.4 — Cleanup

```sql
UPDATE substrate_nodes
   SET intent_drift_state = NULL,
       intent_drift_confidence = NULL,
       intent_drift_reasoning = NULL,
       intent_drift_judged_at = NULL,
       intent_drift_judged_against = NULL
 WHERE uuid = 'con-settings-no-modal-interrupts-2025-Q4';
```

(Or delete the row entirely if it was only seeded for this UAT.)

**Pass criterion:** All 4 sub-checks (default-build refuses, demo-build runtime gate fires for non-demo repos, demo-build mutates state in demo repo, event payload matches engine shape) hold cleanly.

---

## Beat 3 dual-path rehearsal (record-day insurance)

Per RESEARCH.md Q5: TWO REHEARSALS minimum — engine path AND backstop path. Both must produce the orange flag in Phase 13's UI. Decision-day pick whichever was more reliable in the last hour before recording.

### Engine-path rehearsal (preferred — should be the default)

1. Demo repo open. Substrate seeded with `con-settings-no-modal-interrupts-2025-Q4` (from Beat3.3 step 2 if not cleaned up).
2. Seed a priority shift from `reduce-onboarding-friction` → `compliance-first`:
   ```sql
   INSERT INTO priority_shifts (id, old_l0_uuid, new_l0_uuid, valid_at, summary_of_old, summary_of_new)
   VALUES ('beat3-shift', 'uat-l0-q4-demo', 'uat-l0-2026-demo',
           '2026-04-24T00:00:00Z',
           'reduce-onboarding-friction',
           'compliance-first');
   ```
   (Ensure the L0 nodes exist in `nodes` table and substrate_edges anchor the constraint to a contract reachable from `uat-l0-2026-demo` — Beat3 demo seed should have all of this; check `.planning/demo/seeds/`.)
3. Run:
   ```js
   await window.__TAURI_INTERNALS__.invoke('propagate_intent_drift_cmd', { priorityShiftId: 'beat3-shift' });
   ```
4. **Expected SQL:**
   ```sql
   SELECT uuid, intent_drift_state FROM substrate_nodes
    WHERE uuid = 'con-settings-no-modal-interrupts-2025-Q4';
   ```
   - `intent_drift_state IN ('drifted', 'needs_human_review')` — either renders orange in Phase 13.
5. **Expected UI:** Phase 13 verifier panel shows the orange flag with the constraint's text.

### Backstop-path rehearsal

1. Same seed setup as engine path. Skip step 3 (don't run propagate).
2. Run instead:
   ```js
   await window.__TAURI_INTERNALS__.invoke('demo_force_intent_drift', {
     nodeUuid: 'con-settings-no-modal-interrupts-2025-Q4',
     confidence: 0.92,
     reasoning: 'Modal interrupts now expected for destructive actions under compliance-first priority.',
   });
   ```
3. Same SQL + UI expectation as engine path. Phase 13 should render identically.

**Pass criterion:** Both rehearsals complete cleanly; the orange flag renders the same in both paths. On record day, pick the more reliable — but BOTH must be rehearsed in the hour before recording.

---

## Sign-off

Yang: confirm by running each section above. On clean pass:

- [ ] **SC1** — Fact-level supersession: harness ≥ 80%/85%, manual round-trip clean
- [ ] **SC2** — Intent-level cascade: harness ≥ 8/10 + d8 special case, manual cascade end-to-end clean
- [ ] **SC3** — No v1 regression: Phase 7 drift + Phase 8 rollup + reconcile UI + `cargo test` clean
- [ ] **Beat3** — Backstop verified: default build refuses, demo build runtime gates, mutates state in demo repo, event payload identical to engine shape
- [ ] **Beat3 dual-path** — Engine rehearsal ✓ AND backstop rehearsal ✓

If any step fails:
- Capture the failure mode in detail (raw output, SQL state, error string).
- Mark the checkpoint as REJECTED and surface to executor with the diagnostic detail.
- Convene gap-closure planning via `/gsd:plan-phase 12 --gaps` — do NOT auto-pass.

When all 5 boxes are checked: type **"approved"** in the executor's checkpoint prompt and the executor will append the actual recall/precision/match-count numbers to `12-04-SUMMARY.md` for future regression detection.

---

## Variance numbers — captured 2026-04-25 (orchestrator-automated)

Run 1 passed cleanly; no re-runs needed. Numbers preserved as the regression baseline.

| Section | Metric | Target | Actual (run 1) |
|---------|--------|--------|----------------|
| SC1.1 fact harness | Recall | ≥ 0.80 | **1.00 (5/5)** |
| SC1.1 fact harness | Precision | ≥ 0.85 | **1.00 (5/5)** |
| SC2.1 intent harness | Match count | ≥ 8 / 10 | **10/10** |
| SC2.1 intent harness | d8 verdict | NEEDS_HUMAN_REVIEW or low-conf DRIFTED | **NEEDS_HUMAN_REVIEW @ conf 0.50** |

Full per-decision verdict table is in `12-04-SUMMARY.md` § "Adversarial Harness Numbers".
