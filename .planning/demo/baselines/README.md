# Bare-Claude Baselines

Captured under reproducible conditions per DEMO-03:
- Demo repo at the locked commit SHA (see `../contract-ide-demo-spec.md`)
- NO `.contracts/` directory
- NO `CLAUDE.md` (per 09-04 Option A: the demo-setup file is named `DEMO-SETUP.md`, so `CLAUDE.md` never exists in the demo repo at any commit)
- NO `.mcp.json` / no MCP sidecar running
- `claude -p "<prompt>"` invocation only
- macOS, system network online (Claude API), other apps quiet
- Same model version as the demo recording (verify the value in `claude_version` matches across baseline + demo recording)

## How to re-record

```bash
/Users/yang/lahacks/.planning/demo/scripts/record-baseline.sh \
  "delete-account" \
  "add a delete-account button to the account settings page"
```

The script enforces the clean conditions above before invoking claude. If
`CLAUDE.md` exists in the demo repo (Option A reverted), the script ABORTS
with an error rather than silently rm-ing it — this prevents accidental
Pitfall-6 contamination.

## Token count interpretation

The baselines use Claude Code's JSONL session format. Token fields:

| Field | Meaning |
|-------|---------|
| `input_tokens` | Fresh tokens in the prompt (the actual query text, ~25–32 tokens) |
| `cache_creation_input_tokens` | Codebase tokens read and cached to disk on first pass |
| `cache_read_tokens` | Codebase tokens read from cache on subsequent passes |
| `output_tokens` | Tokens generated (code written + reasoning) |
| `tool_calls` | Number of tool invocations (Bash/Grep/Read/Edit) |

The demo presentation script's `~7,200 tokens · ~22 tool calls` estimate was
pre-dated to before the full 49-contract + Next.js + Prisma + Stripe + Mailchimp
repo was built. The actual demo repo is much larger (400–900k total context tokens
across cache_creation + cache_read). The delta claim holds: Contract IDE retrieves
5 targeted substrate rules (~1,400 tokens · ~3 tool calls) vs bare Claude scanning
the entire codebase (~600k–900k tokens · 9–13 tool calls, with no rules found).

## Recorded metrics

| Prompt | tool_calls | input_tokens | cache_read | wall_time |
|--------|-----------|-------------|------------|-----------|
| delete-account | 9 | 25 | 518,355 | 54s |
| workspace-delete | 13 | 32 | 863,184 | 72s |

## Variance

Bare Claude is non-deterministic. Token counts can vary 10-15% run-to-run.
Tool call counts can vary by 2-5 calls depending on Claude's exploration path.
The recorded baseline is a single representative run per prompt. Keep the source
JSONL (referenced in each JSON file) so judges can audit the actual session.

## Files

- `delete-account-baseline.json` — Beat 2 baseline
- `workspace-delete-baseline.json` — Beat 4 inset baseline

## CLAUDE.md assertion (Option A)

`record-baseline.sh` line 28: `if [[ -f "$DEMO_REPO/CLAUDE.md" ]]` — ABORTS
with error if CLAUDE.md exists. This is an ASSERTION, not a cleanup action.
Per 09-04 decision (Option A), `CLAUDE.md` was never committed to the demo
repo at any SHA; the demo-setup file is `DEMO-SETUP.md`. If the assertion
fires, Option A was violated and the baseline is potentially contaminated.

## Encoded cwd path scheme

Claude Code stores sessions at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`
where `<encoded-cwd>` replaces `/` with `-` (stripping the leading `/`).

Example: `/Users/yang/lahacks/contract-ide-demo` becomes
`-Users-yang-lahacks-contract-ide-demo`.

The `record-baseline.sh` script uses `sed 's/\//-/g'` to compute this path.
Verified on macOS with Claude Code 2.1.119.
