# Phase 9 UAT — Mass Edit + Non-Coder Mode + Demo Repo Seeding

**Status:** Pending sign-off
**Requirements covered:** MASS-01, MASS-02, NONC-01, DEMO-01, DEMO-02, DEMO-03, BABEL-01, JSX-01, FLOW-01, BACKEND-FM-01
**Phase 8 dependencies:** PROP-01 (section parser + format_version 3), PROP-02 (rollup detection + amber CVA), PROP-03 (per-session journal), PROP-04 (pin-aware reconcile)
**Prereqs:** All Phase 8 plans complete + 09-01 through 09-06 plans complete

---

## Pre-UAT setup

1. Run `/Users/yang/lahacks/.planning/demo/scripts/build-substrate-seed.sh` (rebuilds
   substrate.sqlite.seed if substrate-rules.sql changed since last build).
2. Run `/Users/yang/lahacks/.planning/demo/scripts/reset-demo.sh` (restores demo repo to
   locked SHA + copies substrate seed).
3. From `/Users/yang/lahacks/contract-ide/`, launch `npm run tauri dev`. Wait for "MCP
   ready" indicator in bottom-right footer.
4. Use Cmd+O / "Open Repository" → select `/Users/yang/lahacks/contract-ide-demo`.
5. Wait for canvas to populate (24+ nodes, 4 scenario nodes visible).

---

## Test 1: MASS-01 — retrieval + section-weighted ranking + EMBEDDING_DISABLED fallback

**Requirement:** MASS-01

Cmd+K → "Mass edit by intent…"
Type: `add audit logging to every destructive endpoint`
Submit.

**Expected:**
- Within 200ms, ≥3 nodes pulse with amber rings, staggered 50ms apart (visually
  evident — first node animates first, second 50ms later, etc.).
- Pulse persists ≥3 seconds before MassEditModal opens.
- MassEditModal header reads "{N} nodes matched"; if any matches are pinned, header
  includes "{M} pinned, will skip".
- Each row shows the matched section pill (e.g., "## Invariants" or "## Notes") — at
  least one row should show a high-leverage section.
- Top row's body matches the query semantically (a node mentioning "audit" or
  "destructive" in its body).
- Modal also shows a banner / pill: "semantic similarity unavailable — keyword matches
  only" (EMBEDDING_DISABLED surfaced).

**PASS** if all 6 expected behaviors observed.
**FAIL** if any of: pulse doesn't appear, pulse not staggered, modal opens before 3s
elapse, header doesn't show counts, no matched-section pill visible, EMBEDDING_DISABLED
banner absent.

---

## Test 2: MASS-02 — review queue + SKIPPED-PINNED + cascade visibility

**Requirement:** MASS-02

Continue from Test 1 with the modal open.

1. Click "Approve all" (or "Approve N selected").
2. Wait for the apply phase to complete (all selected nodes update).
3. Verify the result banner shows:
   - `M of N applied` (where M + pinned count = N — never silent skips)
   - If any pinned: `K pinned · skipped`
   - If Phase 8 PROP-02 cascade fires: `J upstream contracts now amber — reconcile via
     graph` (depends on seed contracts having rollup_inputs declared correctly per
     09-04 must_haves truth #13)
4. Click Cancel/Close on the modal.
5. Observe the canvas: staggered pulse stops; if upstream nodes are now amber
   (rollup_stale), they remain amber via Phase 8 PROP-02's persistent styling.

**PASS** if applied/skipped/upstream counts visible AND consistent (M + skipped +
errors = N), AND mass-match pulse stops on close.
**FAIL** if any count silently absent, pulse doesn't stop, or M + skipped + errors ≠ N.

---

## Test 3: NONC-01 — Copy Mode pill + simplified inspector + Delegate-to-agent stub

**Requirement:** NONC-01

1. Click the **Copy Mode pill** in the left sidebar.
   - Pill should visually transition from outlined to filled.
   - Canvas should filter to L4 atoms only across all lenses (L1/L2/L3 nodes disappear).
   - Phase 8 amber/gray rollup overlays should be HIDDEN (open a previously-amber node
     — its amber ring is gone in Copy Mode).
2. Click on the `AccountSettings.DangerZone` L4 atom (a1000000-...).
   - Inspector slides open with `SimplifiedInspector` (NOT four-tab).
   - Tab strip shows Contract / Preview / Receipts (NO Code tab).
   - Above the editable area, banner reads verbatim: "Your edit lands; a teammate reviews
     upstream impact."
   - Contract tab shows ## Intent and ## Role as read-only paragraphs.
   - ## Examples is editable as three labeled textareas: GIVEN / WHEN / THEN.
   - At the bottom: a `Delegate to agent` button — DISABLED, with tooltip "Available in
     Phase 11" on hover.
3. Type a value into the `WHEN` textarea (e.g., "they click Delete Account and confirm
   via the email link"). Wait 400ms (autosave debounce).
   - Status pill or DriftBadge should reflect the save (depends on existing 04-02
     implementation).
4. Toggle Copy Mode pill OFF.
   - Canvas returns to full lens; L1/L2/L3 nodes reappear; rollup amber/gray overlays
     return.
   - Inspector returns to four-tab layout (Contract / Code / Preview / Receipts) for the
     same node — confirms regression-safe.
5. Toggle Copy Mode ON. Click on a L1 node (NOT an L4).
   - Inspector should NOT switch to SimplifiedInspector — branching is
     `copyModeActive AND level === 'L4'`. The L1 node renders the four-tab layout (or
     empty/disabled state — L1 is not an "atom" in NONC-01 spec).

**PASS** if all 5 steps behave as expected.
**FAIL** if pill doesn't toggle, Code tab is visible in Copy Mode L4 view, entry copy
doesn't read verbatim, Delegate button is enabled, rollup overlays are still visible in
Copy Mode, or non-L4 nodes incorrectly render SimplifiedInspector.

---

## Test 4: DEMO-01 — contract-ide-demo provisioning

**Requirement:** DEMO-01

From a fresh terminal:
```bash
cd /Users/yang/lahacks/contract-ide-demo
pnpm install  # may be skipped if already installed
pnpm prisma generate && pnpm prisma db push
pnpm tsx prisma/seed.ts  # populates dev.db with one user + one workspace
pnpm dev &
sleep 5  # wait for dev server
curl -sf http://localhost:3000/account/settings | grep -q "Account Settings" && echo "[ok] /account/settings renders"
curl -sf http://localhost:3000/team/test/settings | grep -q "Team Settings" && echo "[ok] /team/test/settings renders"
pnpm tsc --noEmit && echo "[ok] tsc clean"
pkill -f "next dev" || true
```

Visual confirmation:
- Visit http://localhost:3000/account/settings in a browser → confirm NO "Delete Account"
  button visible.
- Visit http://localhost:3000/team/test/settings → confirm NO "Delete Workspace" button
  visible.

Contract count:
```bash
ls /Users/yang/lahacks/contract-ide-demo/.contracts/*.md | wc -l
ls /Users/yang/lahacks/contract-ide-demo/.contracts/ambient/*.md | wc -l
# Combined total: ≥49 (4 scenario + 14 new FLOW-01 + 31 ambient)
```

**PASS** if `pnpm dev` boots, both routes render without delete buttons, tsc is clean,
and `.contracts/` (root + ambient) has ≥49 sidecars combined.
**FAIL** if any install step errors, a delete button is visible, tsc produces errors, or
contract count is below 49.

---

## Test 5: DEMO-02 — reset fixture reproducibility (5x in a row)

**Requirement:** DEMO-02

```bash
cd /Users/yang/lahacks
for i in 1 2 3 4 5; do
  .planning/demo/scripts/reset-demo.sh > /dev/null 2>&1
  HASH=$(shasum -a 256 /tmp/contract-ide-demo-substrate.sqlite | cut -d' ' -f1)
  REPO_HEAD=$(git -C contract-ide-demo rev-parse HEAD)
  echo "Run $i: substrate=$HASH repo=$REPO_HEAD"
done | tee /tmp/uat-test5-log.txt
```

**PASS** if all 5 lines show identical substrate SHA-256 hash AND identical repo HEAD.
**FAIL** if any drift — debug before sign-off.

Expected substrate hash: `f4c2f579e50275513d9a56fdaf6189cddb1aa5afa80b66a4166c05fc9caa9354`
Expected repo HEAD: `9f5029b0f4667ef4c5182a5386092b8e201e01af`

---

## Test 6: DEMO-03 — bare-Claude baselines exist + are sane

**Requirement:** DEMO-03

```bash
cat /Users/yang/lahacks/.planning/demo/baselines/delete-account-baseline.json | jq -r '
  "delete-account: input_tokens=\(.metrics.input_tokens) output_tokens=\(.metrics.output_tokens) tool_calls=\(.metrics.tool_calls) rules_honored=\(.metrics.rules_honored)"
'
cat /Users/yang/lahacks/.planning/demo/baselines/workspace-delete-baseline.json | jq -r '
  "workspace-delete: input_tokens=\(.metrics.input_tokens) output_tokens=\(.metrics.output_tokens) tool_calls=\(.metrics.tool_calls) rules_honored=\(.metrics.rules_honored)"
'
```

**PASS** if:
- `delete-account`: `tool_calls >= 8` AND `output_tokens >= 5000`
- `workspace-delete`: `tool_calls >= 10` AND `output_tokens >= 5000`

(Lower bounds — actual history-clean recordings are 10/10,201 and 15/14,408. These
bounds allow ±30% variance from a re-recording without false failures.)

Condition verification:
```bash
cat /Users/yang/lahacks/.planning/demo/baselines/delete-account-baseline.json | jq '.conditions'
cat /Users/yang/lahacks/.planning/demo/baselines/workspace-delete-baseline.json | jq '.conditions'
# Expected: all three flags true in both:
# { "no_contracts_dir": true, "no_claude_md": true, "no_mcp_json": true }
```

**PASS** if all three flags are `true` in both baselines.
**FAIL** if any flag is `false` (Pitfall 6 contamination) OR tool_calls below lower bound.

Audit note: `rules_honored` values are `"1/5*"` and `"0/5"` per the post-execution audit
(2026-04-25). The asterisk on 1/5 means rule 5 was accidentally honored via enum sampling,
not genuine rule reasoning. This is the demo's *before* state — correct and expected.

---

## Test 7: BABEL-01 + JSX-01 — click-resolution chain + alignment validator

**Requirements:** BABEL-01, JSX-01

From `contract-ide-demo/`:
```bash
cd /Users/yang/lahacks/contract-ide-demo
pnpm dev --webpack &
sleep 5
# Confirm plugin injected attributes on rendered DOM:
curl -sf http://localhost:3000/account/settings -o /tmp/page.html
UUID_COUNT=$(grep -c 'data-contract-uuid' /tmp/page.html || echo 0)
echo "data-contract-uuid count on Account Settings: $UUID_COUNT"
pkill -f "next dev" || true
```

**PASS** if `UUID_COUNT >= 1` (the Danger Zone `<section>` carries the attribute).

IDE-side click-resolution check (subjective — on-camera for Beat 1):
1. Open contract-ide; open contract-ide-demo via Cmd+O.
2. Navigate to the L3 trigger view for the Account Settings page (Phase 13 surface; if
   not yet rendered, this step is deferred to Phase 13's UAT).
3. Move cursor over the rendered Danger Zone region in the iframe → chip lights up.
4. Click the chip → inspector opens for the L4 atom (a1000000-...) with the simplified
   Copy Mode editor (matching 09-03 UI).

(Steps 2–4 are Phase 13 CHIP-01 territory; mark as "deferred to Phase 13" if Phase 13
has not yet shipped.)

JSX-01 validator negative test:
```bash
cd /Users/yang/lahacks/contract-ide-demo
# Step 1: Record original code_ranges for a1000000
ORIGINAL=$(grep 'end_line' .contracts/a1000000-0000-4000-8000-000000000000.md | head -1)
# Step 2: Temporarily bump end_line beyond the JSX element boundary
# (e.g., change end_line: 29 to end_line: 200 in the frontmatter — now spans multiple elements)
# Step 3: Re-open the demo repo in the IDE
# Expected: persistent banner naming the offending atom with [JSX-01] prefix
# Step 4: Restore original end_line
# Expected: banner clears on re-open
```

**PASS** if injected violation triggers persistent banner (not a toast) AND restoration
clears it.

---

## Test 8: FLOW-01 + BACKEND-FM-01 — flow contracts + backend frontmatter sections

**Requirements:** FLOW-01, BACKEND-FM-01

From the running IDE (contract-ide-demo loaded):
```bash
DB="$HOME/Library/Application Support/com.contractide.dev/contract.db"
sqlite3 "$DB" "SELECT COUNT(*) FROM nodes WHERE kind='flow'"
# Expected: 6
sqlite3 "$DB" "SELECT uuid, json_array_length(members_json) AS m_count FROM nodes WHERE kind='flow' ORDER BY uuid"
# Expected: 6 rows; delete-account and delete-workspace have 7 members each;
# signup/checkout have 5; add-team-member has 4; password-reset has 3
```

**PASS** if 6 flow rows present AND all `members_json` arrays non-empty.

`layoutFlowMembers` test (in browser dev console after opening delete-account flow):
```javascript
// Navigate to the delete-account flow via Cmd+P → "delete-account flow"
// Then in browser console:
const members = window.__graphStore?.getFlowMembers('flow-de1e-0000-4000-8000-acc000000000');
console.assert(members?.length === 7, 'expected 7 members, got ' + members?.length);
// If layoutFlowMembers is exposed:
// console.assert(layout[0].y === 0 && layout[1].y === 120 && layout[6].y === 720);
console.log('layoutFlowMembers: 7 members confirmed');
```

(If the store is not accessible via `window.__graphStore`, verify via Redux/Zustand devtools.)

BACKEND-FM-01 validator negative test:
```bash
cd /Users/yang/lahacks/contract-ide-demo
# Step 1: Temporarily remove the ## Inputs section from one ambient backend contract
# (e.g., .contracts/ambient/api-account-delete-001.md or e1000000 equivalent)
# Step 2: Re-open the demo repo in IDE
# Expected: persistent banner naming the missing section with [BACKEND-FM-01] prefix
# Step 3: Restore the ## Inputs section
# Expected: banner clears on re-open
```

**PASS** if injected violation triggers banner AND restoration clears it.
**FAIL** if banner does not appear or does not clear.

---

## Test 9: Source-session JSONL round-trip

**Requirement:** DEMO-02 (source fixture)

```bash
/Users/yang/lahacks/.planning/demo/seeds/source-sessions/jq-validation.sh
```

**PASS** if the script prints `[validate] PASS` with no `WARNING:` lines.

Expected output pattern:
```
[validate] N lines, all valid JSON
[validate] filtered text: XXXXX characters
[validate] rule dec-soft-delete-30day-grace: anchored in JSONL
[validate] rule con-anonymize-not-delete-tax-held: anchored in JSONL
[validate] rule con-stripe-customer-archive: anchored in JSONL
[validate] rule con-mailing-list-suppress-not-delete: anchored in JSONL
[validate] rule dec-confirm-via-email-link: anchored in JSONL
[validate] priority-shift anchor: present
[validate] PASS
```

**FAIL** if any WARNING line appears (rule not anchored or priority-shift missing).

---

## Rehearsal log

Run all 9 tests in sequence. Log results for 3 complete runs over ≥2 days before
final sign-off.

| Run | Date       | T1     | T2     | T3     | T4     | T5     | T6     | T7     | T8     | T9     | Notes |
|-----|------------|--------|--------|--------|--------|--------|--------|--------|--------|--------|-------|
| 1   |            |        |        |        |        |        |        |        |        |        |       |
| 2   |            |        |        |        |        |        |        |        |        |        |       |
| 3   |            |        |        |        |        |        |        |        |        |        |       |

All cells must be PASS for Phase 9 to close.

---

## Sign-off checklist

- [ ] Test 1 (MASS-01) — PASS
- [ ] Test 2 (MASS-02) — PASS
- [ ] Test 3 (NONC-01) — PASS
- [ ] Test 4 (DEMO-01) — PASS
- [ ] Test 5 (DEMO-02) — PASS
- [ ] Test 6 (DEMO-03) — PASS
- [ ] Test 7 (BABEL-01 + JSX-01) — PASS
- [ ] Test 8 (FLOW-01 + BACKEND-FM-01) — PASS
- [ ] Test 9 (source-session JSONL) — PASS
- [ ] Rehearsal log: 3/3 runs PASS (over ≥2 days)

Phase 9 closed: __________ (date)

---

## Phase 8 dependency check

Before running Tests 1–3 (MASS-01/02, NONC-01), verify Phase 8 plans are complete:

```bash
ls /Users/yang/lahacks/.planning/phases/08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation/*-SUMMARY.md
```

Phase 8 plans required: 08-01, 08-02, 08-03, 08-04a, 08-04b, 08-06 (PROP-01/02/03/04).
If any SUMMARY is missing, the corresponding Phase 9 test may show unexpected behavior.
Document which Phase 8 plans are present before proceeding.

---

## Notes on Test 7 (BABEL-01) deferred steps

The click-resolution chain (steps 2–4 of the subjective check) requires Phase 13
CHIP-01 (iframe rendering + chip overlay). The DOM injection and `data-contract-uuid`
attribute assertion (UUID_COUNT >= 1 via curl) can be validated now. The full click-to-
inspector flow is deferred to Phase 13's UAT.

Mark Test 7 as PARTIAL-PASS if:
- `UUID_COUNT >= 1` confirmed via curl
- JSX-01 negative test passes (banner appears and clears)
- But CHIP-01 click-resolution is deferred to Phase 13

A PARTIAL-PASS is acceptable for Phase 9 closure; Phase 13 owns the end-to-end
click-resolution UAT.
