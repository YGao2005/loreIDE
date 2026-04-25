# Phase 8 End-to-End UAT Script

**Phase:** 08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation
**Covers plans:** 08-01 through 08-06
**Purpose:** Verify all five demo-load-bearing readiness gates before Phase 9 starts seeding the demo repo.

**Pass/fail criteria (top level):**
- All five gates pass observably on the dev machine
- No `SKIPPED-PINNED` toast in any path (PROP-04 invariant — UI branching prevents reaching the writer in the pinned case)
- No blank receipt card (mock fallback is the safety net; if mock fires during UAT, document why)
- No parser rejection on the literal Beat 1 body
- No partial cherrypick (sidecar AND every source file updated, OR observable red drift)
- No race-loss on rollup_generation (one accept_rollup_as_is wins, loser sees explicit error)

---

## Preconditions (all gates)

1. `cd /Users/yang/lahacks/contract-ide`
2. App is NOT running. Kill any prior instance: `pkill -f "contract-ide"` or kill from Activity Monitor.
3. A demo seed repo is available at a known path (create one if not yet seeded):
   ```bash
   mkdir -p /tmp/demo-repo/.contracts/journal
   # Seed at least 4 contract nodes: one L1 (uuid: l1-uuid), one L2 (uuid: l2-uuid),
   # one L3 (uuid: l3-uuid), one L4 (uuid: l4-uuid).
   # L4 → L3 → L2 → L1 rollup_inputs chain.
   # For Gates 1–4, any seeded or real repo with the app open is sufficient.
   ```
4. Launch the app: `npm run tauri dev` from `contract-ide/`.
5. Open the demo repo via File → Open Repository (or drag-drop).

---

## Gate 1 — Beat 1 schema-v3 round-trip

**Tests:** 08-01 (section parser), schema v3 persistence, Beat 1 literal body acceptance.

**Precondition:** App running with any repo open. At least one existing contract node visible.

**Action:**

1. Click any node on the graph canvas to select it.
2. In the Inspector panel, click the **Contract** tab.
3. In the contract body editor, type or paste the following verbatim Beat 1 body:

```markdown
## Intent
The Account Settings page needs a way for a customer to delete
their own account without contacting support. Today, every delete
request is a manual ticket, and we have a backlog from the GDPR
and CCPA windows. The customer who started the latest thread
clicked "delete" once already, was charged the next month anyway,
and is unhappy.

## Role
A primary action at the bottom of the danger-zone section of the
Account Settings page.

## Examples
GIVEN a logged-in customer on the Account Settings page
WHEN they click Delete Account and confirm via the email link
THEN their account is marked for deletion with a 30-day grace window
  AND they are signed out

GIVEN a customer who clicked Delete Account by mistake
WHEN they don't click the email confirmation link within 24 hours
THEN nothing changes and their account remains fully active
```

4. Press `Cmd+S` to save.

**Expected observable results:**

- No error toast appears.
- The Inspector header shows the saved state (no asterisk, or "Saved" indicator).
- In the terminal: `cat .contracts/<node-uuid>.md | head -20` shows:
  - `format_version: 3`
  - `section_hashes:` block with keys `intent`, `role`, `examples` (three entries, alphabetically sorted)
  - No `sidecar missing closing --- fence` error in app logs.
- Section hashes are populated (non-empty hex strings).

**Capture:**
- Screenshot of Inspector showing saved state.
- Terminal output: `cat .contracts/<node-uuid>.md | head -30`
- Assertion: `grep "format_version: 3" .contracts/<node-uuid>.md` → prints the line.
- Assertion: `grep -c "section_hashes" .contracts/<node-uuid>.md` → at least 1.

**Pass criteria:**
- [ ] `format_version: 3` present in sidecar after save.
- [ ] `section_hashes` block has at least 3 entries (intent, role, examples).
- [ ] No parse error toast.
- [ ] `cat` output shows the Beat 1 body sections intact (not corrupted).

---

## Gate 2 — Beat 2 agent loop streaming + receipt card + journal pipeline

**Tests:** 08-04a/04b (agent loop, streaming, receipts), 08-03 (PostToolUse hook + journal), 08-01 (Pass 2 rederive).

**Precondition:** A node with at least one `code_range` pointing to an existing source file. Claude CLI available: `which claude` returns a path.

**Action:**

1. In the graph, zoom into a node that has `code_ranges` (e.g., a TypeScript source file).
2. Confirm the scope chip in the agent chat panel reads `Scope: <node-name>`.
3. In the chat panel input, type a small intent: `add a single comment at the top of the main function`
4. Click **Send**.

**Expected observable results (within 30s):**

- Streaming output appears in the chat panel within ~1s of clicking Send.
- Agent terminates within ~30s.
- A receipt card appears in the Inspector's **Receipts** tab showing:
  - Non-zero input_tokens and output_tokens
  - Cost in `$X.XX` format (or `$0.0X`)
  - Tool call count ≥ 1

**Assert journal pipeline (B-fix — IDE-spawned agent hook):**

5. After agent run completes, run in terminal:
   ```bash
   ls -la .contracts/journal/
   ```
   Assert: at least one `<session-id>.jsonl` file with mtime within the last 2 minutes.

6. Run:
   ```bash
   wc -l .contracts/journal/<session-id>.jsonl
   ```
   Assert: at least 1 line.

7. Run:
   ```bash
   cat .contracts/journal/<session-id>.jsonl | python3 -m json.tool | head -30
   ```
   Assert each line has: `schema_version: 1`, `ts`, `session_id`, `tool`, `file`, `affected_uuids`, `intent`.

**Assert Pass 2 auto-rederive fired (B-fix — at least ONE of the three signals):**

8. Within 30–60s of agent completion, observe ONE of:
   - (a) Graph node briefly pulses red (drift detected) then returns to fresh — visible in screen recording
   - (b) `cat .contracts/<uuid>.md` shows updated `## Examples` body reflecting the new comment
   - (c) During the 30s window: `ps aux | grep "claude -p" | grep -v grep` shows ≥ 1 backgrounded subprocess

**Capture:**
- Screen recording of the streaming output in the chat panel.
- Screenshot of the final receipt card (Receipts tab).
- Terminal output of: `cat .contracts/journal/<session-id>.jsonl`
- Before/after diff of contract body (if Pass 2 rederive updated it).

**Pass criteria:**
- [ ] Streaming output appears within ~1s.
- [ ] Receipt card visible in Receipts tab with non-zero tokens.
- [ ] Journal file exists with correct schema fields.
- [ ] At least one Pass 2 signal is observable (red pulse, updated body, or subprocess visible).

---

## Gate 3 — PostToolUse journal under headless `-p`

**Tests:** 08-03 (Bash hook, PostToolUse settings.json, journal JSONL write).

**Precondition:** `contract-ide/.claude/settings.json` exists and registers `PostToolUse` hook. Claude CLI available. App running (so DB is populated and the DB path is resolvable).

**Action:**

1. In a new terminal tab, `cd /Users/yang/lahacks/contract-ide`.
2. Run:
   ```bash
   claude -p "create a temp file at /tmp/uat-test.md with content 'hello'"
   ```
   Wait for completion (typically < 30s).

**Expected observable results:**

3. After completion, run:
   ```bash
   ls -lt .contracts/journal/ | head -5
   ```
   Assert: at least one `.jsonl` file with mtime within the last 2 minutes.

4. Run:
   ```bash
   cat .contracts/journal/<newest-session-id>.jsonl
   ```
   Assert:
   - Line is valid JSON with `schema_version: 1`.
   - `tool` field is `"Write"`.
   - `file` field contains `/tmp/uat-test.md` or the written path.
   - `intent` is non-empty (either extracted from transcript OR `(headless: ...)` fallback).

**Capture:**
- Terminal output: `cat .contracts/journal/<session-id>.jsonl | python3 -m json.tool`

**Pass criteria:**
- [ ] Journal file created after headless run.
- [ ] `schema_version: 1` present.
- [ ] `intent` field non-empty.
- [ ] `tool: "Write"` matches the operation performed.

---

## Gate 4 — Cherrypick atomic two-file write

**Tests:** 08-05 (apply_cherrypick, DriftLocks, temp+rename write order).

**Precondition:** At least one node with a `code_range`. App running.

**Action (via dev cherrypick affordance):**

1. In the Inspector panel for a node with `code_ranges`, trigger the cherrypick modal. If no pending cherrypick exists, use the dev affordance button (present in the `CherrypickPanel` during development) to seed a test patch.
2. Alternatively, use a real agent-produced patch from Gate 2 if the agent modified source files.
3. Open the cherrypick modal.
4. Verify:
   - `OrientationHeader` is visible at the top of the modal (sticky, showing `<NodeName> — <intent> — N tool calls`).
   - Diff pane(s) render with before/after content.
5. Click **Approve**.

**Expected observable results:**

- Only ONE `apply_cherrypick` IPC call is fired (check DevTools Network or app logs — should NOT see duplicate calls).
- Both the sidecar `.contracts/<uuid>.md` AND the source file(s) are updated on disk.
- Modal closes.
- The `targetedNodeUuid` in the cherrypick store clears.

**Capture:**
- Screenshot of the cherrypick modal before approval (showing orientation header + diff).
- Screenshot after approval (modal closed, graph node state).
- Terminal verification: `stat .contracts/<uuid>.md` and `stat <source-file>` — both show recent mtime.

**Pass criteria:**
- [ ] Modal renders with orientation header.
- [ ] Single IPC call (no duplicate apply).
- [ ] Both sidecar and source file updated on disk.
- [ ] Modal closes cleanly after approval.

---

## Gate 5 — Propagation cascade L4 → L3 → L2 → L1 (CLAUDE.md demo bar)

**Tests:** 08-02 (rollup detection), 08-06 (ReconcilePanel + amber visuals), cross-level cascade end-to-end.

**CRITICAL MECHANIC:** The cascade requires `section_hashes` to actually change at each level. `Accept as-is` ONLY updates `rollup_hash/generation/state` — it does NOT change `section_hashes` (the body wasn't edited). So `Accept as-is` clears amber but does NOT trigger upstream cascade. **For cascade to propagate, each level must use `Edit manually`** (which writes a new body → recomputes `section_hashes` → triggers parent rollup recompute).

**Precondition:**

Set up a four-level rollup chain:
1. Ensure nodes L1, L2, L3, L4 exist where:
   - L4 has `code_ranges` pointing to a real TypeScript file
   - L3's `rollup_inputs` cites `L4 → ["examples"]` (or "intent")
   - L2's `rollup_inputs` cites `L3 → ["examples"]`
   - L1's `rollup_inputs` cites `L2 → ["examples"]`
2. Run `recompute_all_rollups` (via dev console or the rollup recompute button if available) to ensure all nodes start `fresh`.
3. All four nodes must be unpinned (`human_pinned: false`).
4. Confirm: none of the four nodes are amber on the graph.

**Action (screen recording recommended from this point):**

**Step 1 — Trigger cascade from L4:**

1. Open the Inspector for the L4 node. Click **Contract** tab.
2. Edit the `## Examples` section — add or change one Given/When/Then block. Press `Cmd+S`.
3. Watch the graph.

**Step 2 — Expected: L3 pulses amber within ~2s.**

4. Within 2s of the L4 save, L3 should pulse amber (L4's `section_hashes.examples` changed → L3's recomputed rollup_hash no longer matches stored → L3 flips stale).
5. Click the amber L3 node → ReconcilePanel opens with `UnpinnedAmberActions` (not drift/pinned actions).
6. Click **Edit manually** → modal closes, Inspector shows Contract tab for L3.
7. In L3's contract body, make a small edit to `## Examples` (e.g., update the THEN clause to reference L4's new behavior). Press `Cmd+S`.

**Step 3 — Expected: L2 pulses amber within ~2s of L3 save.**

8. Within 2s of L3 save: L2 should pulse amber.
9. Click amber L2 → **Edit manually** → make a small edit to L2's `## Examples` → `Cmd+S`.

**Step 4 — Expected: L1 pulses amber within ~2s of L2 save.**

10. Within 2s of L2 save: L1 should pulse amber.
11. Click amber L1 → **Edit manually** → make a small edit to L1's `## Examples` → `Cmd+S`.
12. L1 returns to fresh. Cascade complete.

**Expected observable results:**

- Each amber pulse appears within ~2s after the upstream save (not after Accept-as-is).
- Click-at-a-time per CONTEXT.md ("v1 is click-at-a-time; this cascade IS the demo payoff").
- No node skips amber (flips directly from fresh to fresh without user action).
- No `SKIPPED-PINNED` toast at any step.
- Total cascade time from L4-save to L1-fresh: ideally < 60s for a live demo.

**Capture:**
- Full screen recording from L4 edit through L1 resolution.
- Log the per-hop latency: time from `Cmd+S` at each level to the next node's amber pulse.

**Alternate gate (optional):** If demo prefers `Accept as-is` for narrative simplicity, use it at each level. The cascade will NOT propagate via `Accept as-is` (body unchanged, section_hashes unchanged). This path is valid as a developer dogfood demo ("I confirmed the upstream still holds semantically") but requires narration to explain the difference.

**Pass criteria:**
- [ ] L3 pulses amber within ~2s of L4 edit+save.
- [ ] L2 pulses amber within ~2s of L3 edit+save (via Edit manually).
- [ ] L1 pulses amber within ~2s of L2 edit+save (via Edit manually).
- [ ] L1 returns to fresh after L1 edit+save.
- [ ] ReconcilePanel shows `UnpinnedAmberActions` (not drift actions) for each amber node.
- [ ] No `SKIPPED-PINNED` toast.
- [ ] Cascade is click-at-a-time (no batch auto-propagation).

---

## UAT Status

| Gate | Status | Notes |
|------|--------|-------|
| 1 — Beat 1 schema-v3 round-trip | PENDING | Awaiting human run |
| 2 — Beat 2 agent loop + receipt card + journal | PENDING | Awaiting human run |
| 3 — PostToolUse journal under headless -p | PENDING | Awaiting human run |
| 4 — Cherrypick atomic two-file write | PENDING | Awaiting human run |
| 5 — Cascade L4 → L3 → L2 → L1 | PENDING | Awaiting human run |

**If any gate fails:** Document the failure mode + observed behavior in the status table above. Create a follow-up plan via `/gsd:plan-phase --gaps` to address before Phase 9 starts.

---

## Known v2 carry-overs (not blocking Phase 9)

1. **Per-generation child section snapshots** for `read_children_section_diffs` — v1 shows current state only; historical diff requires `upstream_generation_snapshots` table.
2. **Batch "reconcile all amber" action** — v1 is click-at-a-time; the batch action is explicitly deferred per CONTEXT.md.
3. **DraftPropagationDiff dispatch via run_agent** — v1 ships clipboard-copy only; v2 would dispatch directly to an active agent session.
4. **Real multi-machine rollup_generation coordination** — out of scope for v1 (single-machine only).
