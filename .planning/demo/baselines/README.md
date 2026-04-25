# Bare-Claude Baselines

Captured under reproducible conditions per DEMO-03:
- Demo repo at the locked commit SHA (see `../contract-ide-demo-spec.md`)
- **History-clean baseline workspace** — tree extracted into a tmpdir, re-init'd
  with a single synthetic git commit. Prevents bare Claude from running
  `git show <SHA>:.contracts/...` against the canonical repo to peek at substrate
  via history (Pitfall 6 — discovered 2026-04-25 audit; original recordings
  were partially contaminated, replaced with history-clean baselines)
- NO `.contracts/` directory (working tree AND history)
- NO `CLAUDE.md` (per 09-04 Option A: the demo-setup file is named `DEMO-SETUP.md`)
- NO `.mcp.json` / no MCP sidecar running
- `claude -p "<prompt>"` invocation only
- macOS, system network online (Claude API), other apps quiet
- Same model version as the demo recording (verify `claude_version`)

## How to re-record

```bash
/Users/yang/lahacks/.planning/demo/scripts/record-baseline.sh \
  "delete-account" \
  "add a delete-account button to the account settings page"
```

The script (1) checks the canonical demo repo to the locked SHA, (2) rsyncs
the tree into `$(mktemp -d)/contract-ide-demo`, (3) drops `.git/`, `.contracts/`,
`.mcp.json`, (4) `git init` + commits a single "baseline" snapshot, (5) verifies
no `.contracts/` in any past commit, then (6) runs `claude -p` in the tmpdir.

If `CLAUDE.md` exists in the demo repo (Option A reverted), the script ABORTS
rather than silently rm-ing it — prevents accidental Pitfall-6 contamination.

## Token count interpretation

| Field | Meaning |
|-------|---------|
| `input_tokens` | Fresh tokens in the prompt text (~25–32 tokens) |
| `cache_creation_input_tokens` | Codebase tokens read and cached on first pass |
| `cache_read_tokens` | Codebase tokens read from cache on subsequent passes |
| `output_tokens` | Tokens generated (code written + reasoning) |
| `tool_calls` | Number of tool invocations (Bash/Grep/Read/Edit/Write/Agent) |

The presentation-script's pre-build `~7,200 input_tokens · ~22 tool calls`
estimate dates from before the 49-contract + Next.js + Prisma + Stripe +
Mailchimp repo existed. Actual context volume is 400–900k total (cache_creation
+ cache_read). The delta claim holds at the volume + tool-call level — see
"Demo banner numbers" below.

## Recorded metrics (history-clean, 2026-04-25)

| Prompt | tool_calls | cache_read | output_tokens | wall_time | rules_honored |
|--------|-----------|------------|---------------|-----------|---------------|
| delete-account | 10 | 661,468 | 10,201 | 83s | 1/5* |
| workspace-delete | 15 | 742,513 | 14,408 | 122s | 0/5 |

\* Rule 5 (`dec-confirm-via-email-link`) accidentally honored — bare Claude
  picked `confirmation="email-link"` from a 2-option TypeScript enum
  (`'email-link' | 'modal'`) it saw in `DangerActionButton.tsx`. No team-rule
  reasoning; the workspace-delete run on a structurally identical task picked
  `"modal"` for the same enum.

## Rule audit (5 substrate rules from scenario-criteria.md § 6)

| Rule | delete-account | workspace-delete |
|------|----------------|------------------|
| 1. `dec-soft-delete-30day-grace` (soft-delete with 30-day grace) | ✗ stub `throw 'not implemented'` left untouched | ✗ no API route written, fetch hits non-existent endpoint |
| 2. `con-anonymize-not-delete-tax-held` (anonymize tax records) | ✗ no impl | ✗ no impl |
| 3. `con-stripe-customer-archive` (archive Stripe customer) | ✗ no impl | ✗ no impl |
| 4. `con-mailing-list-suppress-not-delete` (CAN-SPAM suppress) | ✗ no impl | ✗ no impl |
| 5. `dec-confirm-via-email-link` (email-link confirmation) | ✓ accidental (enum sampling) | ✗ chose `confirmation="modal"` |

## Demo banner numbers (presentation-script Beat 2 + Beat 4)

Beat 2 (delete-account):
> **Contract IDE: ~3 tool calls · ~30k context read · 5/5 rules honored**
> **Bare Claude: 10 tool calls · 661k context read · 1/5 rules honored\***

Beat 4 inset (workspace-delete):
> **Bare Claude: 15 tool calls · 743k context read · 0/5 rules honored**

The Contract IDE numbers (`~3 tool calls · ~30k`) are the targets for Phase 11
distiller + retrieval — not yet measured. They'll be re-derived when Phase 11
ships and the recorded demo run captures the real numbers.

## Files

- `delete-account-baseline.json` — Beat 2 baseline
- `workspace-delete-baseline.json` — Beat 4 inset baseline
- `README.md` — this file (audit + interpretation)

## Variance

Bare Claude is non-deterministic. Token counts can vary 10–15% run-to-run.
Tool call counts can vary by 2–5 calls depending on Claude's exploration path.
Each recorded baseline is a single representative run; the source JSONL is
preserved (referenced in each JSON file) so judges can audit the session.

## Encoded cwd path scheme

Claude Code stores sessions at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`.
The encoding replaces non-alphanumeric chars (`/`, `_`, `.`) with `-`. macOS
`/var/folders/...` resolves to `/private/var/folders/...` before encoding.

The `record-baseline.sh` script handles this by searching for the JSONL by
matching `cwd` field in the first line of each session file under
`~/.claude/projects/`, rather than predicting the encoded path.
