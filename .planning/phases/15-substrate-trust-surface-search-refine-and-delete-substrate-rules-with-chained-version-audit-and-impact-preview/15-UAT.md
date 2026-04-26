---
phase: 15
status: pending  # pending → partial-pass (6/7) | partial-pass-with-issues | failed
sc7_status: deferred-pending-sync-review-surface
plan: 15-07
created: 2026-04-25
updated: 2026-04-25
---

# Phase 15 — Substrate Trust Surface — Partial UAT

**Scope:** Verify 6 of 7 ROADMAP success criteria via UI-independent paths (Cmd+P palette + SourceArchaeologyModal + SubstrateHealthDialog). SC7 (Beat 3 fixture-to-real conversion) is deferred to the sync-review surface build because the floating-panel `VerifierPanel` that 15-06 was wiring no longer exists. See § SC7 below for the precise wiring spec the sync-review work inherits.

**How to use this doc:** Walk each SC section in order. Run the listed commands / click sequences against the live IDE. Capture observed behaviour in the **Evidence** block. Mark **Result** as `PASS`, `FAIL`, or `BLOCKED`. After all sections, update frontmatter `status:` accordingly.

**Test seed reset:** `bash contract-ide/demo/reset-demo.sh` — reseeds substrate_nodes from `demo/seeds/substrate.sqlite.seed.sql`. `substrate_edits` rows from prior runs MAY persist (TRUST-04 audit-table-survives-reset is correct behaviour); if you need a totally clean audit table, `sqlite3 <db> "DELETE FROM substrate_edits;"` before walking the harness.

---

## SC0 — Reset perf gate (<15s)

Not a ROADMAP-numbered SC, but the performance gate that anchors the rest of the UAT.

**Run:**
```bash
time bash contract-ide/demo/reset-demo.sh
```

**Verify:** wall time < 15s; sqlite3 confirms migration v8 applied:

```bash
sqlite3 ~/Library/Application\ Support/com.contract-ide.app/contracts.db \
  "PRAGMA user_version;"
# expected: 8
```

**Evidence:**
```
[ wall time: ____ s ]
[ user_version: ____ ]
```

**Result:** [ PASS / FAIL / BLOCKED ]

---

## SC1 — Cmd+P substrate-search precision (TRUST-01)

> Substrate filter chip in Cmd+P returns ranked rationale-matched substrate hits in <2s end-to-end; ≥ 0.80 top-1 precision on the 10-query ambient harness.

**Setup:** open the IDE, open Cmd+P, click the **Substrate** chip.

**Run each query, click Substrate chip, record the top-1 hit:**

| # | Query | Expected top-1 (rule UUID) | Observed top-1 | Hit? |
|---|---|---|---|---|
| 1 | `why email confirmation` | `dec-confirm-via-email-link-2026-02-18` | | |
| 2 | `why soft delete` | `dec-soft-delete-30day-grace-2026-02-18` | | |
| 3 | `why anonymize invoices` | `con-anonymize-not-delete-tax-held-2026-03-04` | | |
| 4 | `why archive stripe` | `con-stripe-customer-archive-2026-02-22` | | |
| 5 | `why suppress mailchimp` | `con-mailing-list-suppress-not-delete-2026-03-11` | | |
| 6 | `why no modal interrupts` | `con-settings-no-modal-interrupts-2025-Q4` (or refined head) | | |
| 7 | `tax record retention` | `con-anonymize-not-delete-tax-held-2026-03-04` | | |
| 8 | `30 day grace` | `dec-soft-delete-30day-grace-2026-02-18` | | |
| 9 | `stripe.customers.update` | `con-stripe-customer-archive-2026-02-22` | | |
| 10 | `CAN-SPAM` | `con-mailing-list-suppress-not-delete-2026-03-11` | | |

**Score:** ___ / 10 = ___ %  (PASS if ≥ 80 %)

**Latency:** open DevTools console; the IntentPalette emits `console.time('substrate-cmdp-roundtrip')` (15-02). Pick any query above, observe `substrate-cmdp-roundtrip: ____ ms`. Modal mount: open SourceArchaeologyModal on a hit, observe roughly when first quote becomes readable. Total < 2s = PASS.

**Evidence:**
```
[ score: ___ / 10 ]
[ substrate-cmdp-roundtrip: ____ ms ]
[ modal-mount-to-readable: ____ ms ]
```

**Result:** [ PASS / FAIL / BLOCKED ]

---

## SC2 — Refine path (TRUST-02)

> SourceArchaeologyModal exposes Refine button; click expands editor for `text` + `applies_when`; required reason; Save creates new chain row + invalidates old + writes substrate_edits in single transaction; modal switches to History tab; chain renders oldest → newest with Current badge on head + side-by-side before/after pre-blocks.

**Run:**
1. Cmd+P → Substrate chip → query `why email confirmation` → click hit (`dec-confirm-via-email-link-2026-02-18`).
2. SourceArchaeologyModal mounts on Detail tab. Capture original `applies_when` text.
3. Click **Refine** button (or press `⌘E`). Editor expands; pre-fills with current text + applies_when.
4. Type narrowed text (suggestion): `Confirmation email link expires after 24 hours. After expiry, user must request a fresh link.`
5. Type reason: `15-UAT SC2 verification — narrowing the link-expiry rule to be specific.`
6. Click **Save**. Spinner. Modal switches to History tab.
7. Verify chain: 2 versions stacked oldest → newest. Current badge on the new head row. Side-by-side `<pre>` before/after blocks.

**Inspect:**
```bash
sqlite3 ~/Library/Application\ Support/com.contract-ide.app/contracts.db \
  "SELECT uuid, prev_version_uuid, invalid_at IS NULL AS is_head, substr(text, 1, 60)
   FROM substrate_nodes
   WHERE uuid='dec-confirm-via-email-link-2026-02-18'
      OR prev_version_uuid='dec-confirm-via-email-link-2026-02-18'
   ORDER BY created_at;"
```

Expected output: 2 rows.
  - Row 1 (origin): is_head=0 (invalid_at set); prev_version_uuid=NULL.
  - Row 2 (head): is_head=1; prev_version_uuid='dec-confirm-via-email-link-2026-02-18'.

**Capture HEAD_UUID for later steps:**
```bash
sqlite3 ~/Library/Application\ Support/com.contract-ide.app/contracts.db \
  "SELECT uuid FROM substrate_nodes
   WHERE prev_version_uuid='dec-confirm-via-email-link-2026-02-18'
     AND invalid_at IS NULL;"
# record: HEAD_UUID_DEC = ________________________
```

**Evidence:**
```
[ original applies_when: __________________________ ]
[ narrowed text: __________________________ ]
[ history tab shows 2 versions: yes / no ]
[ Current badge on head: yes / no ]
[ side-by-side before/after blocks: yes / no ]
[ HEAD_UUID_DEC: __________________________ ]
[ sqlite3 row count: ____ (expect 2) ]
```

**Result:** [ PASS / FAIL / BLOCKED ]

---

## SC3 — Audit trail in substrate_edits (TRUST-04)

> substrate_edits table captures every refine / delete / restore atomically alongside the substrate-node version write.

**Inspect (after SC2):**
```bash
sqlite3 ~/Library/Application\ Support/com.contract-ide.app/contracts.db \
  "SELECT kind, actor, reason, substr(before_text, 1, 40), substr(after_text, 1, 40)
   FROM substrate_edits
   WHERE rule_uuid='dec-confirm-via-email-link-2026-02-18'
   ORDER BY edited_at;"
```

Expected: at least one row with kind='refine', actor='human:yangg40@g.ucla.edu', reason matching the SC2 reason text, before_text = original, after_text = narrowed.

**Evidence:**
```
[ kind: ______ ]
[ actor: ______ ]
[ reason matches SC2 input: yes / no ]
[ before_text matches origin: yes / no ]
[ after_text matches narrowing: yes / no ]
```

**Result:** [ PASS / FAIL / BLOCKED ]

---

## SC4 — Delete path with mandatory reason + impact preview (TRUST-03)

> Delete this rule button; confirm dialog with 5-radio reason picker (Hallucinated · Obsolete · Wrong scope · Duplicate · Other) + free-text amplification (required when Other) + auto-loaded impact preview (atoms-citing count + names; recent-7d agent prompts count). Confirm sets invalid_at + invalidated_reason + invalidated_by. Tombstoned rule no longer matches in Cmd+P substrate FTS.

**Run:**
1. Cmd+P → Substrate chip → query `why suppress mailchimp` → click hit (`con-mailing-list-suppress-not-delete-2026-03-11`).
2. SourceArchaeologyModal mounts. Click **Delete this rule** button (red, destructive variant).
3. Confirm dialog opens. Verify:
    - 5 radio options visible with demo-grade copy: `Wrong (hallucinated)`, `Outdated`, `Scope mismatch`, `Duplicate`, `Other reason`.
    - Free-text textarea is OPTIONAL with non-Other reasons; REQUIRED with Other selected.
    - Impact preview section auto-loads showing two counts. Atom count may be 0–N depending on seed; recent-prompts count may be 0 in fresh demo state (fine).
    - Confirm button is DISABLED until a reason is picked.
4. Pick `Wrong (hallucinated)`. Confirm button enables.
5. (Optional) Pick `Other reason`; verify Confirm becomes disabled until free-text non-empty.
6. Pick `Wrong (hallucinated)` again. Click **Confirm**.
7. Modal closes. Observe DOM toast (bottom-right): `Rule tombstoned — N atoms previously cited it`.
8. Cmd+P → Substrate chip → query `why suppress mailchimp` again. Verify the rule does NOT appear (FTS trigger fired correctly).

**Inspect:**
```bash
sqlite3 ~/Library/Application\ Support/com.contract-ide.app/contracts.db \
  "SELECT uuid, invalid_at IS NOT NULL AS tombstoned, invalidated_reason, invalidated_by
   FROM substrate_nodes
   WHERE uuid='con-mailing-list-suppress-not-delete-2026-03-11';"
```

Expected: tombstoned=1; invalidated_reason starts with `Hallucinated:`; invalidated_by='human:yangg40@g.ucla.edu'.

```bash
sqlite3 ~/Library/Application\ Support/com.contract-ide.app/contracts.db \
  "SELECT kind FROM substrate_edits WHERE rule_uuid='con-mailing-list-suppress-not-delete-2026-03-11' ORDER BY edited_at;"
```

Expected: at least one row with kind='delete'.

**Evidence:**
```
[ 5 radio options correct: yes / no ]
[ Other free-text gating works: yes / no ]
[ impact preview rendered: yes / no ]
[ atom_count: ____ ]
[ recent_prompt_count: ____ ]
[ Confirm button gating works: yes / no ]
[ toast appeared: yes / no ]
[ Cmd+P substrate FTS no longer returns: yes / no ]
[ invalid_at set + invalidated_reason starts 'Hallucinated:': yes / no ]
[ substrate_edits kind='delete' present: yes / no ]
```

**Result:** [ PASS / FAIL / BLOCKED ]

---

## SC5 — Substrate Health surface + Restore (TRUST-03 SC5 + TRUST-04)

> SubstrateStatusIndicator footer shows 🪦 N tombstoned badge (hidden when N=0). Click opens SubstrateHealthDialog. Each row: kind, name, parsed reason (kind + text split on ': '), tombstoned-at, actor. Restore button calls restore_substrate_rule IPC. Active-successor guard surfaces inline error. After restore, FTS matches the rule again.

**Run:**
1. Look at SubstrateStatusIndicator footer (bottom of sidebar). Should show `🪦 N tombstoned` badge with N ≥ 1 after SC4. The existing Phase 11 P05 `K substrate nodes captured` label remains visible verbatim.
2. Click the badge → SubstrateHealthDialog opens.
3. Row for `con-mailing-list-suppress-not-delete-2026-03-11` should be visible. Verify:
    - kind badge correct (constraint).
    - name = first line of text (or rule name if seeded).
    - Parsed reason renders the picker label (`Hallucinated`) + free-text amplification if any.
    - Tombstoned-at relative time renders.
    - Actor `human:yangg40@g.ucla.edu` visible.
4. Click **Restore** button on that row. Row disappears from list. Toast appears.
5. Cmd+P → Substrate chip → `why suppress mailchimp` → rule returns again.

**Inspect:**
```bash
sqlite3 ~/Library/Application\ Support/com.contract-ide.app/contracts.db \
  "SELECT uuid, invalid_at IS NULL AS is_active, invalidated_reason, invalidated_by
   FROM substrate_nodes
   WHERE uuid='con-mailing-list-suppress-not-delete-2026-03-11';"
```

Expected: is_active=1; invalidated_reason=NULL; invalidated_by=NULL.

```bash
sqlite3 ~/Library/Application\ Support/com.contract-ide.app/contracts.db \
  "SELECT kind FROM substrate_edits WHERE rule_uuid='con-mailing-list-suppress-not-delete-2026-03-11' ORDER BY edited_at;"
```

Expected kind sequence: `delete`, then `restore`.

**Active-successor guard (optional):** to test, refine `con-stripe-customer-archive-2026-02-22` (capture HEAD_UUID), then attempt to delete the head, then attempt to restore the original tombstoned origin row. Expected: restore on origin returns `Err('cannot restore: chain has an active successor — restore would create two heads')` rendered inline on the row. Skip if not exercising.

**Evidence:**
```
[ 🪦 N tombstoned badge visible: yes / no ]
[ K substrate nodes captured label preserved: yes / no ]
[ row metadata correct (kind/reason/actor/time): yes / no ]
[ Restore button works (row disappears + toast): yes / no ]
[ Cmd+P substrate returns rule again: yes / no ]
[ invalid_at = NULL after restore: yes / no ]
[ substrate_edits kind sequence (delete, restore): yes / no ]
[ active-successor guard exercised: yes / no — if yes, error inline: yes / no ]
```

**Result:** [ PASS / FAIL / BLOCKED ]

---

## SC6 — Phase 12 supersession compatibility (load-bearing forensic)

> Phase 12 supersession queries (fact-level + intent-level + walker) audited under chained versions: queries that filter `WHERE invalid_at IS NULL` continue to return the current-version row; the rerank in retrieval/rerank.rs reads only current rows. Smoke: refine an existing fixture rule, run a Beat-4-style Delegate-to-agent task — the new wording (not the old) appears in the agent's substrate hits.

**Run:**
1. Reset for clean state (optional but recommended): `bash contract-ide/demo/reset-demo.sh`. NOTE: wipes substrate_nodes back to seed state; substrate_edits MAY persist. If desired, also `sqlite3 <db> "DELETE FROM substrate_edits;"` for a clean audit baseline.
2. Cmd+P → Substrate chip → `why archive stripe` → click hit (`con-stripe-customer-archive-2026-02-22`).
3. SourceArchaeologyModal → **Refine** → narrow the text. Suggestion:
   - New text: `Use stripe.customers.update(customer.id, {metadata: {archived: 'true'}}) for users with active subscriptions only. For users without active subscriptions, deletion is acceptable.`
   - New applies_when: leave as-is or refine.
   - Reason: `Phase 15 SC6 regression check: prove the chain head propagates to receipts.substrate_rules_json post-refine.`
4. Save. Modal switches to History tab. Confirm 2-version chain.
5. Capture the new HEAD_UUID:
   ```bash
   sqlite3 ~/Library/Application\ Support/com.contract-ide.app/contracts.db \
     "SELECT uuid FROM substrate_nodes
      WHERE prev_version_uuid='con-stripe-customer-archive-2026-02-22'
        AND invalid_at IS NULL;"
   # record: HEAD_UUID_STRIPE = ________________________
   ```
6. Trigger a Delegate-to-agent run with prompt: `Implement workspace deletion that archives the Stripe customer instead of deleting it.` (Use the existing Delegate-to-agent surface; submit and wait for the agent run to complete and the receipt to land via the PostToolUse hook → parse_and_persist path from 15-01.)
7. Inspect the most recent receipt:
   ```bash
   sqlite3 ~/Library/Application\ Support/com.contract-ide.app/contracts.db \
     "SELECT id, substrate_rules_json FROM receipts ORDER BY created_at DESC LIMIT 1;"
   ```
8. **PASS criteria:**
   - `substrate_rules_json` is a non-NULL JSON array.
   - It CONTAINS the captured `HEAD_UUID_STRIPE`.
   - It does NOT contain `con-stripe-customer-archive-2026-02-22` (the tombstoned origin).

This proves three things at once:
  - 15-01's composer → delegate_execute → run_agent → parse_and_persist threading correctly persists the substrate hit UUIDs into receipts.
  - The composer's substrate hits use the canonical `WHERE invalid_at IS NULL` chain-head selection (Phase 12 retrieval predicate), so the head — not the tombstoned origin — is the one cited.
  - Refine has zero impact on the agent prompt format / receipt persistence pipeline beyond the UUID swap.

**Evidence:**
```
[ HEAD_UUID_STRIPE: __________________________ ]
[ receipt id: __________________________ ]
[ substrate_rules_json (verbatim or truncated):
  __________________________________________________
  __________________________________________________
]
[ HEAD_UUID_STRIPE present in JSON: yes / no ]
[ con-stripe-customer-archive-2026-02-22 absent from JSON: yes / no ]
```

**Result:** [ PASS / FAIL / BLOCKED ]

---

## SC7 — Beat 3 fixture-to-real conversion — DEFERRED

**Status:** deferred-pending-sync-review-surface

**Why deferred:** SC7 originally targeted the floating-panel `VerifierPanel` orange-flag click handler. That panel has been deleted in the parallel sync-review surface reframe (see `.planning/HANDOFF-sync-review-surface.md`). Its content is being repurposed as page sections inside `SyncReviewPage` (`SyncReviewHonors` / `SyncReviewImplicit` / `SyncReviewFlag`). There is currently no flag-row component to wire.

**What survives from 15-06 and lands here for the sync-review build to consume:**

The receiving end of the commit-handshake is **already wired** in plan 15-03:
  - `useCitationStore.onRefineSuccess: ((originalUuid: string) => void) | null` field exists.
  - `setOnRefineSuccess(cb)` setter exists.
  - `closeCitation` clears `onRefineSuccess` automatically (deterministic regardless of close path: X / Escape / outside-click).
  - `SourceArchaeologyModal` (15-03) invokes `onRefineSuccess(originalUuid)` synchronously after `RefineRuleEditor.onSave` fires, BEFORE re-pointing `openCitation` to the new chain head.

**The 10-line wiring stub the sync-review flag-row component must add:**

```ts
// In whichever component renders the orange-flag row inside SyncReviewPage.
// (Likely SyncReviewFlag.tsx or a similar new component per the salvage list
// in HANDOFF-sync-review-surface.md.)

import { useCitationStore } from '@/store/citation';
import { useVerifierStore } from '@/store/verifier';

const onFlagClick = (row: VerifierRow) => {
  // Step 1: register the commit-handshake. SourceArchaeologyModal (15-03)
  // invokes this callback synchronously after a successful refine, with the
  // ORIGINAL uuid (the rule that was refined, before re-pointing to the new
  // chain head). closeCitation auto-clears this callback, so a subsequent
  // open without setting onRefineSuccess (e.g., from Cmd+P substrate hits)
  // leaves the field null and a refine from THAT path has no panel
  // side-effects.
  useCitationStore.getState().setOnRefineSuccess((uuid) => {
    useVerifierStore.getState().acceptFlag(uuid);
  });

  // Step 2: open the modal on the rule.
  useCitationStore.getState().openCitation(row.ruleUuid);
};
```

**Plus the new action on `useVerifierStore`:**

```ts
// In contract-ide/src/store/verifier.ts (currently deleted; will be
// reinstated as part of the sync-review surface work).
acceptFlag: (ruleUuid: string) =>
  set((state) => ({
    rows: state.rows.filter((r) => !(r.kind === 'flag' && r.ruleUuid === ruleUuid)),
  })),
```

**WHY this approach (architectural note for the sync-review build):** 15-06's first draft inferred "refine happened" by polling `getSubstrateChain` after every modal close and checking chain length > 1. That was post-hoc inference + a DB roundtrip on every modal close + fragile under unexpected close paths. The callback approach is direct: SourceArchaeologyModal fires the handshake EXACTLY when a refine commits, regardless of how the modal subsequently closes. No useEffect, no chain-length probe, no DB roundtrip on close.

**WHY the wire is generic (`row.ruleUuid` not a hardcoded UUID):** the seeded UUID for Beat 3 is `con-settings-no-modal-interrupts-2025-Q4`, but the click handler must be generic so any future flag routes correctly. The seed-specific binding lives in the seed file, not in the component.

**Verification when the sync-review surface lands:**
  1. Open the new sync-review surface (Beat 3 fixture).
  2. Click the flag row. SourceArchaeologyModal opens on `con-settings-no-modal-interrupts-2025-Q4`.
  3. DevTools console: confirm `useCitationStore.getState().onRefineSuccess` is non-null (proves Step 1 of the handler ran).
  4. Click Refine → narrow + reason → Save. Flag row disappears IMMEDIATELY on Save (callback fires synchronously in the modal's onSave handler), NOT on modal close. This is the demo's tactile commit moment.
  5. Close modal (X or Escape) → no further state changes; flag is already cleared.
  6. Reopen surface via fresh reset → click flag → close modal WITHOUT refining → flag persists (callback was registered but never invoked).
  7. Open SourceArchaeologyModal via Cmd+P → Substrate chip → click hit → refine → verify NO panel changes (callback is null because Cmd+P path did not register one). This proves the silence guarantee.
  8. 5x consecutive end-to-end Beat 3 rehearsals with `bash contract-ide/demo/reset-demo.sh` between each → all pass without manual intervention. Document any flake.

**When SC7 is wired:** update this section's status to `partial-pass-then-passed` or similar; close Phase 15 fully.

---

## Summary

| SC | Description | Status | Evidence |
|----|---|---|---|
| SC0 | Reset perf <15s | [ PASS / FAIL / BLOCKED ] | wall time + user_version |
| SC1 | Cmd+P substrate-search precision ≥0.80 | [ PASS / FAIL / BLOCKED ] | score / 10 + roundtrip ms |
| SC2 | Refine path via modal | [ PASS / FAIL / BLOCKED ] | 2-version chain visible + sqlite3 |
| SC3 | Audit trail in substrate_edits | [ PASS / FAIL / BLOCKED ] | kind/actor/reason row |
| SC4 | Delete path with reason + impact preview | [ PASS / FAIL / BLOCKED ] | dialog correctness + tombstone + FTS removal |
| SC5 | Substrate Health surface + Restore | [ PASS / FAIL / BLOCKED ] | dialog correctness + restore + FTS reindex |
| SC6 | Phase 12 supersession compatibility | [ PASS / FAIL / BLOCKED ] | HEAD_UUID in receipts.substrate_rules_json |
| SC7 | Beat 3 fixture-to-real conversion | DEFERRED | wiring spec preserved for sync-review build |

**Phase 15 closure rule:** if SC0–SC6 all PASS → frontmatter `status: partial-pass`; SC7 remains deferred with the wiring spec preserved. Phase 15 enters the `verify-with-deferred-SC` state — actionable, demo-ready in part, with one clean handoff to the sync-review build.
