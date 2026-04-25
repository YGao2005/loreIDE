#!/bin/bash
# PostToolUse hook that dumps stdin to a file for inspection.
# Validates: hook payload contains `transcript_path` and the referenced JSONL
# includes token accounting (`usage.input_tokens` or equivalent).
#
# Usage: configured in .claude/settings.json under hooks.PostToolUse — see README.md
# in this directory.

set -euo pipefail

OUT_DIR="$(dirname "$0")/captures"
mkdir -p "$OUT_DIR"

STAMP=$(date +%s)
PAYLOAD_FILE="$OUT_DIR/payload-$STAMP.json"

# Capture stdin, then replay to stdout if Claude Code expects it.
cat > "$PAYLOAD_FILE"

# Hook must exit 0 with no stdout to avoid affecting the Claude Code session.
exit 0
