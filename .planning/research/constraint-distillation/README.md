# Constraint Distillation — Kernel Experiment

**Status:** Validated 2026-04-24. Input for v2 planning.

## What this is

A proof-of-concept for the core primitive of Contract IDE v2: **distilling typed constraints from Claude Code session transcripts, with semantic retrieval by task**.

Run on two real sessions from `~/.claude/projects/-Users-yang-lahacks/`:
- **Review session** (`5f44f5af`): 627K → 12K filtered → 7 explicit constraints
- **Debug session** (`efadfcc4`): 1.3M → 27K filtered → 7 inferred constraints

Retrieval test: 4/4 synthetic goals matched correctly against the right constraints via `applies_when` field.

## Files

| File | Purpose |
|---|---|
| `schema.json` | JSON schema for a Constraint node (bitemporal fields borrowed from Graphiti) |
| `extraction-prompt.md` | Single extraction prompt that handles both explicit and inferred modes |
| `extracted-5f44f5af.json` | 7 explicit constraints from the review session |
| `extracted-efadfcc4.json` | 7 inferred constraints from the debug session |
| `retrieval-test.md` | Retrieval test across 4 synthetic goals (1 control) |

## Key findings

1. **Single `jq` filter** reduces session JSONL by 95% (user text + assistant text only) with no signal loss.
2. **Single extraction prompt** handles explicit and inferred modes — distinction captured in `confidence` field.
3. **Bug-fix sessions are the highest-density source** — every bug fixed = a reusable rule.
4. **`applies_when` is the load-bearing field** for retrieval. Quality here determines precision/recall.
5. **Tool-use content not required** — Claude narrates its reasoning enough in conversational text.

See `.planning/VISION.md` for how these findings shape the v2 product direction.
