# Check 2 — PostToolUse hook payload

**Validates:** the PostToolUse hook receives `transcript_path` in its stdin payload, and the referenced JSONL file contains token accounting fields (`usage.input_tokens` or equivalent).

**Why it matters:** Phase 8 depends on parsing that JSONL to produce receipt cards. If the schema doesn't include what we think it does, the whole receipt story fails silently on demo day.

## Run

```bash
cd /Users/yang/lahacks/day0/check2-hook-payload
rm -rf captures

# Run a one-shot Claude Code session scoped to THIS directory that writes a file.
# The session inherits the settings.json in this directory via --settings.
claude -p "write a file called hello.txt containing the word 'hello' in the current directory" \
  --settings ./settings.json \
  --allowedTools Write

# Then inspect the capture:
ls captures/
cat captures/payload-*.json | jq .
```

## Pass criteria

1. `captures/payload-*.json` exists — hook fired
2. The payload contains a field named `transcript_path` (or `sessionTranscript`, or similar)
3. The referenced JSONL file exists and at least one line includes token usage (`usage.input_tokens`, `message.usage.input_tokens`, or similar — schema varies by CLI version)

## Fail paths

- **No file in `captures/`** — hook not invoked; check matcher config, check `claude --settings` is honored in this CLI version
- **No `transcript_path` field** — schema has changed; grep the payload for `transcript`, `session`, or `jsonl` to find the new field name
- **JSONL has no token fields** — Phase 8 parser must compute tokens some other way (tool output length, mock fallback); flag this as an unresolved risk in the plan
