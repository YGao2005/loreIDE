# Phase 14 UAT — End-to-End Bootstrap Reproducibility

**Authored:** 2026-04-26 (Phase 14 Plan 06 Task 1)
**Last updated:** 2026-04-26
**Tracking phase:** 14-codebase-to-contracts-bootstrap-skill-demo-application
**Tracking plan:** 14-06

This runbook is the operational gate for closing Phase 14. It captures the exact 3-run reproducibility protocol Yang executes against `bootstrap-demo-target/` (Marginalia) to verify the bootstrap pipeline works end-to-end and the bootstrapped repo loads cleanly in Contract IDE.

**Acceptance gate (summary at top, full criteria at bottom):**

- All 3 runs succeed (no crash, no validator failure)
- IDE smoke 100% green on Run 1 (6 items)
- Run 2 cost = $0 (full hash-skip working)
- Run 3 cost <$0.20 (selective re-derivation working)
- 3-run mean wall time <7 minutes
- 3-run total cost <$3
- **Prose Quality Gate (Task 2.5) approved** — Yang reviewed 5–6 derived contracts post-cold-run and scored them passing on decision specificity, cross-reference density, prose density. If failed, loop back to Plan 14-04 prompt iteration BEFORE recording (Task 4).

---

## Pre-UAT setup (one-time, before Run 1)

1. **Verify skill is on PATH:**

```bash
ls /Users/yang/lahacks/.agents/skills/codebase-to-contracts/SKILL.md
ls /Users/yang/lahacks/.agents/skills/codebase-to-contracts/scripts/discover.mjs
ls /Users/yang/lahacks/.agents/skills/codebase-to-contracts/scripts/derive-frontmatter.mjs
ls /Users/yang/lahacks/.agents/skills/codebase-to-contracts/scripts/derive-body.mjs
ls /Users/yang/lahacks/.agents/skills/codebase-to-contracts/scripts/align-jsx.mjs
ls /Users/yang/lahacks/.agents/skills/codebase-to-contracts/scripts/synthesize-flows.mjs
ls /Users/yang/lahacks/.agents/skills/codebase-to-contracts/scripts/emit.mjs
ls /Users/yang/lahacks/.agents/skills/codebase-to-contracts/scripts/install-babel-plugin.mjs
ls /Users/yang/lahacks/.agents/skills/codebase-to-contracts/scripts/validate.mjs
```

All 9 must exist. If any are missing, abort UAT — Plans 14-01b / 14-03 / 14-04 / 14-05 didn't ship cleanly.

2. **Verify demo target shape:**

```bash
cd /Users/yang/lahacks/bootstrap-demo-target
ls package.json prisma/schema.prisma next.config.ts
# All 3 must exist
git log --oneline | head -5
# Should show ~16 commits backdated 2026-04-04 to 2026-04-25 (per Plan 14-02 SUMMARY)
git status
# Should be clean — no uncommitted changes (we'll wipe .contracts/ before Run 1, that's expected)
```

3. **Capture pre-existing Marginalia file count** (for delta tracking in Run 3):

```bash
find /Users/yang/lahacks/bootstrap-demo-target/src -type f \( -name '*.ts' -o -name '*.tsx' \) | wc -l
# Expected: ~51 (15 .ts + 36 .tsx per Plan 14-02 SUMMARY)
```

4. **Pre-authenticate Claude Code** (avoid mid-run auth gates):

```bash
cd /Users/yang/lahacks/bootstrap-demo-target
claude --version  # Verify installed; should print version >= 2.x
# Open a session and confirm authenticated:
echo "exit" | claude -p "say hello" 2>&1 | head -5
# Should print substantive output (not auth error). If auth error: run claude /login
```

5. **Pre-set environment** (optional cost / model overrides):

```bash
export BOOTSTRAP_CLAUDE_MODEL=claude-sonnet-4-6  # Default; override if needed
export BOOTSTRAP_CLAUDE_TIMEOUT_MS=180000        # Override 120s default to 3min if first run hits watchdog
```

If `BOOTSTRAP_CLAUDE_TIMEOUT_MS` is needed, document why in SUMMARY.md (e.g. "first run hit 130s on a flow synthesis call, widened to 3min for stability").

---

## Run 1: COLD-START + IDE-LOAD SMOKE

**Goal:** Wipe `.contracts/` entirely, run the full pipeline from scratch, load the bootstrapped repo in Contract IDE, walk the 6-item smoke checklist.

### Run 1 prep

```bash
cd /Users/yang/lahacks/bootstrap-demo-target

# WIPE all bootstrap state
rm -rf .contracts/
rm -rf contract-uuid-plugin/

# Restore clean next.config.ts (no BOOTSTRAP-INSERT block)
git checkout next.config.ts

# Verify wipe complete
ls .contracts/ 2>&1                     # should: No such file
ls contract-uuid-plugin/ 2>&1           # should: No such file
grep -c BOOTSTRAP-INSERT next.config.ts  # should: 0
```

### Run 1 execution

```bash
RUN1_START=$(date +%s)

# Run the skill via Claude Code (the user-facing path)
cd /Users/yang/lahacks/bootstrap-demo-target
# In Claude Code session: type /codebase-to-contracts
# Or invoke scripts directly for deterministic timing:

node /Users/yang/.agents/skills/codebase-to-contracts/scripts/preflight.mjs /Users/yang/lahacks/bootstrap-demo-target
node /Users/yang/.agents/skills/codebase-to-contracts/scripts/discover.mjs /Users/yang/lahacks/bootstrap-demo-target
node /Users/yang/.agents/skills/codebase-to-contracts/scripts/derive-frontmatter.mjs /Users/yang/lahacks/bootstrap-demo-target
node /Users/yang/.agents/skills/codebase-to-contracts/scripts/derive-body.mjs /Users/yang/lahacks/bootstrap-demo-target
node /Users/yang/.agents/skills/codebase-to-contracts/scripts/align-jsx.mjs /Users/yang/lahacks/bootstrap-demo-target
node /Users/yang/.agents/skills/codebase-to-contracts/scripts/synthesize-flows.mjs /Users/yang/lahacks/bootstrap-demo-target
node /Users/yang/.agents/skills/codebase-to-contracts/scripts/emit.mjs /Users/yang/lahacks/bootstrap-demo-target

RUN1_END=$(date +%s)
RUN1_WALL=$(( RUN1_END - RUN1_START ))
echo "Run 1 wall time: ${RUN1_WALL} seconds ($(( RUN1_WALL / 60 ))min $(( RUN1_WALL % 60 ))s)"
```

### Run 1 immediate validation

```bash
# .contracts/ exists and has expected files
ls /Users/yang/lahacks/bootstrap-demo-target/.contracts/ | head -10
ls /Users/yang/lahacks/bootstrap-demo-target/.contracts/*.md | wc -l
# Expected: ≥35 sidecars (40 nodes minus skipped backend kinds for JSX, plus flows)

# Flow contracts present
ls /Users/yang/lahacks/bootstrap-demo-target/.contracts/flow-*.md | wc -l
# Expected: ≥3 (likely 16 per Plan 14-05 smoke)

# Babel plugin installed
ls /Users/yang/lahacks/bootstrap-demo-target/contract-uuid-plugin/
grep -c BOOTSTRAP-INSERT /Users/yang/lahacks/bootstrap-demo-target/next.config.ts
# Expected: ≥1 (or 2 — start + end markers)

# Validator passed (no .staging/diagnostics.json after emit)
ls /Users/yang/lahacks/bootstrap-demo-target/.contracts/.staging/diagnostics.json 2>&1
# Expected: No such file (validator passed → atomic mv from .staging/ to .contracts/ succeeded)

# Cost capture (if available; claude -p exposes usage in --output-format json's _meta.usage):
# Approximate: ~40 nodes × ~$0.10 frontmatter + ~40 × ~$0.10 body + ~16 × ~$0.05 flow ≈ $1.50
# Real cost depends on prompt-caching hit rate and model pricing.
```

### Run 1 IDE smoke checklist (6 items)

Open Contract IDE and point it at `/Users/yang/lahacks/bootstrap-demo-target/`. Walk through:

| # | Item                                      | Expected behavior                                                                                                                                                                          | Pass / Fail |
| - | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| 1 | Sidebar populates                         | Repository area-tree sidebar shows the bootstrapped repo with areas grouped (e.g. `app/`, `app/api/`, `app/account/`, `lib/`). Click on each area expands its children.                    |             |
| 2 | Cmd+P returns hits                        | `Cmd+P → "delete account"` returns ≥3 ranked hits (the API delete route, an L4 atom, the flow). All hits clickable. Click one → navigates to that contract.                                |             |
| 3 | L3 trigger view renders iframe            | Click an L3 page (e.g. `app/account/settings/page.tsx`). Canvas opens an L3 trigger view with a live iframe of the page rendered (probe at `localhost:3000` works). No CSP errors. |             |
| 4 | Atom chips render on iframe               | The iframe shows atom chips overlaid on JSX elements (the BABEL-01 chain). Chips visible on Danger Zone area or similar L4 atoms. No empty rect overlays.                                  |             |
| 5 | Click chip → inspector opens              | Click a chip → inspector slides in from the right, shows the atom's contract body (Intent / Role / Examples). Body content is real prose (not "TODO" or empty).                            |             |
| 6 | No console errors / no degraded-mode warn | Open dev console: no JS errors, no Rust panics. Validator did NOT emit "Skill is using degraded JS-side validators" stderr (or if it did, the IDE binary is on PATH but `validate-repo` not yet shipped — Open Question 7 follow-up).                   |             |

**Pass: 6/6 green.**
**Fail criteria:** any item above shows error, missing data, or unexpected behavior.

If 6/6 green: Run 1 closes. Capture metrics:

```
Run 1 metrics:
- Wall time:        ${RUN1_WALL}s
- Sidecars emitted: ${SIDECAR_COUNT}
- Flows emitted:    ${FLOW_COUNT}
- Cost (estimated): $X.XX
- IDE smoke:        6/6 green
- Validator source: [Rust subprocess | JS fallback w/ degraded warning]
```

Document the validator source — it answers RESEARCH Open Question 7 ("does `contract-ide validate-repo` ship in v1?"). If the JS fallback is used, that's expected per Plan 14-05 SUMMARY (the IDE binary doesn't have `validate-repo` yet).

If <6/6 green: STOP. Do not proceed to Run 2 or Task 4. Surface the failure to Yang for triage.

---

## Run 2: WARM-CACHE FULL HASH-SKIP

**Goal:** Re-run the entire pipeline against the same repo with NO source changes. Verify hash-skip eliminates 100% of LLM calls (cost = $0).

### Run 2 prep

```bash
cd /Users/yang/lahacks/bootstrap-demo-target
# DO NOT wipe .contracts/. We're testing idempotency.
git status
# Should show .contracts/ as untracked + contract-uuid-plugin/ untracked + next.config.ts modified.

ls .contracts/*.md | wc -l   # Run 1's output count
ls .contracts/.staging/_progress.json   # exists; tracks what was completed
```

### Run 2 execution

```bash
RUN2_START=$(date +%s)

cd /Users/yang/lahacks/bootstrap-demo-target

# Re-run the full pipeline. Each stage should hash-skip.
node /Users/yang/.agents/skills/codebase-to-contracts/scripts/preflight.mjs /Users/yang/lahacks/bootstrap-demo-target
# preflight should detect prior staging and prompt resume/restart/abort. Choose `resume` (the keyword the preflight expects).

node /Users/yang/.agents/skills/codebase-to-contracts/scripts/discover.mjs /Users/yang/lahacks/bootstrap-demo-target
# Output: "Stage 1 complete: 40 candidate nodes" (byte-identical to Run 1; nodes.json should be unchanged)

node /Users/yang/.agents/skills/codebase-to-contracts/scripts/derive-frontmatter.mjs /Users/yang/lahacks/bootstrap-demo-target
# Output: "Stage 2: 0/40 nodes need (re-)derivation (40 hash-skipped)"
# COST: $0 — no LLM calls

node /Users/yang/.agents/skills/codebase-to-contracts/scripts/derive-body.mjs /Users/yang/lahacks/bootstrap-demo-target
# Output: "Stage 3: 0/40 bodies need (re-)derivation (40 hash-skipped)"  (or similar)
# COST: $0

node /Users/yang/.agents/skills/codebase-to-contracts/scripts/align-jsx.mjs /Users/yang/lahacks/bootstrap-demo-target
# Stage 4 is deterministic AST walk — re-runs at full speed but no LLM cost.

node /Users/yang/.agents/skills/codebase-to-contracts/scripts/synthesize-flows.mjs /Users/yang/lahacks/bootstrap-demo-target
# Output: "Stage 5a: 0/16 flows need (re-)synthesis (16 hash-skipped)" (or "16 flows already synthesized")
# COST: $0

node /Users/yang/.agents/skills/codebase-to-contracts/scripts/emit.mjs /Users/yang/lahacks/bootstrap-demo-target
# Stage 5b: re-runs validator + (optionally) re-installs Babel plugin idempotently.
# Should output: "0 .md files written, 0 staging .md files moved (already in .contracts/)"
# OR: "Babel plugin already installed (BOOTSTRAP-INSERT marker present)"

RUN2_END=$(date +%s)
RUN2_WALL=$(( RUN2_END - RUN2_START ))
echo "Run 2 wall time: ${RUN2_WALL} seconds"
```

### Run 2 validation

```bash
# Verify hash-skip on every LLM stage:
grep -c "hash-skipped" /tmp/run2-stage2-output.log     # ≥ 1, with count = 40
grep -c "hash-skipped" /tmp/run2-stage3-output.log     # ≥ 1, with count = 40
grep -c "hash-skipped\|already synthesized" /tmp/run2-stage5a-output.log  # ≥ 1

# Verify Babel plugin is idempotent (no duplicate BOOTSTRAP-INSERT block):
grep -c "BOOTSTRAP-INSERT-START" /Users/yang/lahacks/bootstrap-demo-target/next.config.ts
# Expected: 1 (NOT 2 — re-install replaces, not duplicates)

# Verify .contracts/ unchanged:
git diff --stat /Users/yang/lahacks/bootstrap-demo-target/.contracts/  # 0 files changed
```

**Pass criteria for Run 2:**

- [ ] Total LLM cost = $0 (every stage hash-skipped)
- [ ] Wall time <60s (no LLM call latency; just file I/O)
- [ ] Babel plugin install idempotent (count of `BOOTSTRAP-INSERT-START` = 1, NOT 2)
- [ ] `.contracts/` byte-identical to Run 1 output (`git diff` shows zero changes)

If any fails: STOP. Hash-skip isn't working — that's a regression vs Plan 14-03 / 14-04 / 14-05's idempotency claims. Surface to Yang.

---

## Run 3: SELECTIVE RE-DERIVATION

**Goal:** Modify ONE source file, re-run pipeline. Verify only the affected node re-derives (others hash-skip). Total cost <$0.20.

### Run 3 prep

```bash
cd /Users/yang/lahacks/bootstrap-demo-target

# Pick a representative source file. Use lib/notes.ts (a lib L2 with searchNotes function — the most "interesting" pattern per Plan 14-02).
# Make a small but real change — add a comment, change a const value, etc.
echo "// UAT change: $(date)" >> src/lib/notes.ts

# Or for a UI L4 atom test:
# echo "// UAT change" >> src/app/account/settings/page.tsx

# Verify the change:
git diff src/lib/notes.ts | head -10
```

### Run 3 execution

```bash
RUN3_START=$(date +%s)

cd /Users/yang/lahacks/bootstrap-demo-target

# Re-run pipeline. The modified file should re-derive; everything else hash-skips.
node /Users/yang/.agents/skills/codebase-to-contracts/scripts/discover.mjs /Users/yang/lahacks/bootstrap-demo-target
# nodes.json should be byte-identical (same 40 nodes — change is in body, not classification).

node /Users/yang/.agents/skills/codebase-to-contracts/scripts/derive-frontmatter.mjs /Users/yang/lahacks/bootstrap-demo-target
# Output: "Stage 2: 1/40 nodes need (re-)derivation (39 hash-skipped)"
# COST: ~$0.05–0.10

node /Users/yang/.agents/skills/codebase-to-contracts/scripts/derive-body.mjs /Users/yang/lahacks/bootstrap-demo-target
# Output: "Stage 3: 1/40 bodies need (re-)derivation (39 hash-skipped)"
# COST: ~$0.10

node /Users/yang/.agents/skills/codebase-to-contracts/scripts/align-jsx.mjs /Users/yang/lahacks/bootstrap-demo-target
# Stage 4: deterministic, no LLM cost.

node /Users/yang/.agents/skills/codebase-to-contracts/scripts/synthesize-flows.mjs /Users/yang/lahacks/bootstrap-demo-target
# Stage 5a may or may not re-synth depending on whether the modified node is a flow trigger.
# If lib/notes.ts changed and notes.ts is a participant in any flow, that flow may invalidate.
# COST: $0–$0.05

node /Users/yang/.agents/skills/codebase-to-contracts/scripts/emit.mjs /Users/yang/lahacks/bootstrap-demo-target
# Stage 5b: validator re-runs (deterministic), atomic re-emit only for the changed node.

RUN3_END=$(date +%s)
RUN3_WALL=$(( RUN3_END - RUN3_START ))
echo "Run 3 wall time: ${RUN3_WALL} seconds"
```

### Run 3 validation

```bash
# Verify selective re-derivation:
grep "1/40" /tmp/run3-stage2-output.log   # Stage 2: 1 changed
grep "1/40" /tmp/run3-stage3-output.log   # Stage 3: 1 changed (or similar count for the affected node)

# Verify only the modified node's frontmatter / body changed:
git diff /Users/yang/lahacks/bootstrap-demo-target/.contracts/ | head -30
# Expected: 1 sidecar's `code_hash` updated, body sections regenerated.
# Expected: NO changes to the other 39 sidecars.

# Cost should be <$0.20 (1 frontmatter + 1 body + maybe 1 flow re-derive).
```

### Run 3 cleanup (revert source change before final acceptance)

```bash
cd /Users/yang/lahacks/bootstrap-demo-target

# Revert the test change:
git checkout src/lib/notes.ts

# Optional: re-run pipeline once more to bring .contracts/ back in sync with the original source.
# This is bookkeeping; not part of acceptance.
```

**Pass criteria for Run 3:**

- [ ] Selective re-derivation: only the modified node's frontmatter + body re-run; the other 39 hash-skip
- [ ] Cost <$0.20 (small delta from cold)
- [ ] Wall time <120s
- [ ] `.contracts/` shows surgical diff (1 file changed, 39 unchanged)

If selective re-derivation runs all 40 nodes again: hash-skip is broken on source-modification path. Surface to Yang.

---

## Cost / wall time aggregate

After all 3 runs, capture the aggregate:

| Run                                  | Wall time     | LLM cost     | Sidecars  | Flows     | IDE smoke |
| ------------------------------------ | ------------- | ------------ | --------- | --------- | --------- |
| Run 1 (cold)                         | XmYs          | $X.XX        | N         | M         | 6/6       |
| Run 2 (full hash-skip)               | XmYs          | $0.00        | N         | M         | n/a       |
| Run 3 (selective re-derivation, +1)  | XmYs          | $X.XX        | N (1 new) | M         | n/a       |
| **Total**                            | **XmYs**      | **$X.XX**    |           |           |           |
| **Mean (3 runs)**                    | **XmYs**      |              |           |           |           |

**Acceptance gate:**

- 3-run mean wall time <7 minutes
- 3-run total cost <$3
- Run 1 cost ≈ $1.50 (preflight target)
- Run 2 cost = $0
- Run 3 cost <$0.20

If means / totals exceed targets:

- Wall time exceeded: investigate single-stage outliers via the per-stage logs. Common cause: LLM call latency on flow synthesis (mitigated by `BOOTSTRAP_CLAUDE_TIMEOUT_MS` widening — but a higher mean wall time may simply reflect API variability).
- Cost exceeded: prompt-caching may not be firing as expected. Check `_meta.usage.cache_creation_input_tokens` vs `cache_read_input_tokens` ratio. A high creation-to-read ratio means the cache isn't hitting.

---

## Edge cases and reproducibility checks

1. **Modify nodes.json directly:** if Yang manually edits `.contracts/.staging/nodes.json` (e.g., to drop a UUID), Run 2 should detect the manipulation and either resume cleanly or refuse with a diagnostic. Acceptable for v1.

2. **Source change with no body impact:** modify a comment-only line in `src/lib/notes.ts`. Hash-skip should fire (the body's `_source_sha256` will change but the actual derivation may produce identical output). Verify via `git diff` on the affected sidecar — if body unchanged, hash-skip on subsequent run; if body changed slightly, accept the change.

3. **Schema upgrade scenario (deferred to Phase 6 / 8):** if a schema migration occurs (e.g. `format_version: 3 → 4`), the bootstrap skill's hash-skip should NOT re-derive (schema concerns are Phase 6 / 8 territory). Document this as out-of-scope in SUMMARY.md.

4. **Multi-machine reproducibility (deferred):** in v1 the bootstrap skill is single-machine. Running the same skill on the same repo from a different machine should produce byte-identical UUIDs (deterministic UUIDv5) but the `_source_sha256` may differ if file mtimes differ. Out-of-scope for Phase 14 acceptance.

---

## Acceptance gate for phase close

All of the following must hold for Phase 14 to close:

- [ ] Run 1 succeeded (wall time captured, cost captured, sidecars + flows count captured, IDE smoke 6/6)
- [ ] Run 2 succeeded (full hash-skip, $0, idempotent Babel install)
- [ ] Run 3 succeeded (selective re-derivation, <$0.20)
- [ ] 3-run mean wall time <7 min
- [ ] 3-run total cost <$3
- [ ] **Prose Quality Gate (Task 2.5) approved** — Yang reviewed 5–6 derived contracts post-cold-run and scored them passing on decision specificity, cross-reference density, prose density. If failed, loop back to Plan 14-04 prompt iteration BEFORE recording (Task 4).
- [ ] Q&A inset recorded (Task 4 approves) — 75–105s, all 3 final shots present, queued on demo machine
- [ ] `.planning/demo/presentation-script.md` NOT modified (locked 4-beat script preserved — Phase 14's demo posture is Q&A-only inset per RESEARCH Open Question 4)
- [ ] BOOTSTRAP-05 [proposed] satisfied — demo target bootstrapped end-to-end live or recorded as a Phase 14 SC

---

## Reference paths

- Q&A inset runbook: `/Users/yang/lahacks/.planning/phases/14-codebase-to-contracts-bootstrap-skill-demo-application/qa-inset-runbook.md` (sibling document — provides the recording protocol for Task 4)
- Skill: `/Users/yang/lahacks/.agents/skills/codebase-to-contracts/`
- Demo target repo: `/Users/yang/lahacks/bootstrap-demo-target/` (Marginalia)
- Phase 14 Plan 06: `/Users/yang/lahacks/.planning/phases/14-codebase-to-contracts-bootstrap-skill-demo-application/14-06-PLAN.md`
- Phase 9 prose-quality exemplars (referenced by Task 2.5):
  - `/Users/yang/lahacks/contract-ide-demo/.contracts/ambient/api-account-delete-001.md`
  - `/Users/yang/lahacks/contract-ide-demo/.contracts/ambient/lib-begin-account-deletion-001.md`
  - `/Users/yang/lahacks/contract-ide-demo/.contracts/a0000000-0000-4000-8000-000000000000.md`
  - `/Users/yang/lahacks/contract-ide-demo/.contracts/a1000000-0000-4000-8000-000000000000.md`
- Locked 4-beat script (DO NOT MODIFY): `/Users/yang/lahacks/.planning/demo/presentation-script.md`
