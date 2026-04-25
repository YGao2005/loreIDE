#!/usr/bin/env bash
# Record bare-Claude baseline for a demo prompt.
# Pitfall 6 from 09-RESEARCH.md: MUST run before substrate seeding so context can't leak.
#
# Usage: record-baseline.sh <name> "<prompt>"
# Output: .planning/demo/baselines/<name>-baseline.json
#
# Conditions enforced (clean baseline):
#   - Demo repo at locked SHA
#   - .contracts/ directory absent
#   - CLAUDE.md absent (ASSERTED — per 09-04 Option A, demo-setup is named DEMO-SETUP.md)
#   - .mcp.json absent
#   - No MCP sidecar running

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <name> \"<prompt>\"" >&2
  exit 1
fi

NAME="$1"
PROMPT="$2"

LAHACKS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DEMO_REPO="${DEMO_REPO:-${LAHACKS_ROOT}/contract-ide-demo}"
SPEC="${LAHACKS_ROOT}/.planning/demo/contract-ide-demo-spec.md"
OUT="${LAHACKS_ROOT}/.planning/demo/baselines/${NAME}-baseline.json"

# Read locked SHA
DEMO_COMMIT_SHA=$(awk '/^Locked SHA:/{print $3}' "$SPEC" | head -1)
if [[ -z "$DEMO_COMMIT_SHA" ]]; then
  echo "ERROR: DEMO_COMMIT_SHA not in $SPEC" >&2
  exit 1
fi

# Step 1: Reset demo repo to locked SHA + ensure baseline-clean state
# Use detached-HEAD checkout + clean (non-destructive vs reset --hard)
echo "[baseline] Resetting demo repo to $DEMO_COMMIT_SHA"
git -C "$DEMO_REPO" checkout --detach "$DEMO_COMMIT_SHA"
git -C "$DEMO_REPO" clean -fd

# Remove substrate-leaking files (Pitfall 6)
# 09-04 Option A: demo-setup file is named DEMO-SETUP.md, NOT CLAUDE.md.
# We assert NO CLAUDE.md exists rather than rm-ing it — failing loudly if Option A
# was reverted or accidentally undone, instead of silently mutating state.
rm -rf "$DEMO_REPO/.contracts"
rm -f "$DEMO_REPO/.mcp.json"
if [[ -f "$DEMO_REPO/CLAUDE.md" ]]; then
  echo "ERROR: $DEMO_REPO/CLAUDE.md exists. Per 09-04 Option A, the demo-setup file" >&2
  echo "       must be named DEMO-SETUP.md so CLAUDE.md never exists in the demo repo." >&2
  echo "       Pitfall 6 risk: bare-Claude baseline could leak context. ABORT." >&2
  exit 1
fi

# Verify clean state
if [[ -d "$DEMO_REPO/.contracts" ]] || [[ -f "$DEMO_REPO/CLAUDE.md" ]] || [[ -f "$DEMO_REPO/.mcp.json" ]]; then
  echo "ERROR: clean-state verification failed" >&2
  exit 1
fi
echo "[baseline] Clean state verified — no .contracts/, no CLAUDE.md (assert), no .mcp.json"

# Step 2: Compute the encoded cwd for ~/.claude/projects/<encoded> path
# macOS Claude Code encodes the cwd by replacing / with -
ENCODED_CWD=$(echo "$DEMO_REPO" | sed 's/\//-/g')
SESSION_DIR="$HOME/.claude/projects/$ENCODED_CWD"

# Snapshot existing sessions so we can identify the new one
mkdir -p "$SESSION_DIR" 2>/dev/null || true
SESSIONS_BEFORE=$(ls -1 "$SESSION_DIR" 2>/dev/null | sort | uniq || true)

# Step 3: Run claude -p
echo "[baseline] Running: claude -p \"$PROMPT\""
cd "$DEMO_REPO"
START=$(date +%s)
claude -p "$PROMPT" > "/tmp/baseline-${NAME}-output.txt" 2>&1 || {
  echo "WARNING: claude exited non-zero — baseline may still be capturable from JSONL"
}
END=$(date +%s)
WALL_TIME=$((END-START))

# Step 4: Find the new session JSONL
SESSIONS_AFTER=$(ls -1 "$SESSION_DIR" 2>/dev/null | sort | uniq || true)
NEW_SESSION=$(comm -13 <(echo "$SESSIONS_BEFORE") <(echo "$SESSIONS_AFTER") | head -1)

# Fallback: if diff approach doesn't work, grab the most recent JSONL
if [[ -z "$NEW_SESSION" ]]; then
  NEW_SESSION=$(ls -1t "$SESSION_DIR" 2>/dev/null | head -1 || true)
fi

if [[ -z "$NEW_SESSION" ]]; then
  echo "ERROR: could not identify new session JSONL in $SESSION_DIR" >&2
  echo "       Tip: run 'find ~/.claude/projects/ -newer /tmp -name \"*.jsonl\" -mmin -5' to debug" >&2
  exit 1
fi
JSONL="$SESSION_DIR/$NEW_SESSION"
echo "[baseline] Captured session: $JSONL"

# Step 5: Extract counts via jq (defensive — JSONL may have malformed lines)
INPUT_TOKENS=$(jq -s '[.[] | .message?.usage?.input_tokens // 0] | add // 0' "$JSONL" 2>/dev/null || echo 0)
OUTPUT_TOKENS=$(jq -s '[.[] | .message?.usage?.output_tokens // 0] | add // 0' "$JSONL" 2>/dev/null || echo 0)
CACHE_READ_TOKENS=$(jq -s '[.[] | .message?.usage?.cache_read_input_tokens // 0] | add // 0' "$JSONL" 2>/dev/null || echo 0)
TOOL_CALLS=$(jq -s '[.[] | .message?.content?[]? | select(.type == "tool_use") | 1] | add // 0' "$JSONL" 2>/dev/null || echo 0)

CLAUDE_VERSION=$(claude --version 2>/dev/null || echo 'unknown')

# Step 6: Write baseline JSON
mkdir -p "$(dirname "$OUT")"
cat > "$OUT" <<EOF
{
  "name": "${NAME}",
  "prompt": "${PROMPT}",
  "recorded_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "demo_repo_sha": "${DEMO_COMMIT_SHA}",
  "claude_version": "${CLAUDE_VERSION}",
  "conditions": {
    "no_contracts_dir": true,
    "no_claude_md": true,
    "no_mcp_json": true
  },
  "session_jsonl": "${JSONL}",
  "wall_time_seconds": ${WALL_TIME},
  "metrics": {
    "input_tokens": ${INPUT_TOKENS},
    "output_tokens": ${OUTPUT_TOKENS},
    "cache_read_tokens": ${CACHE_READ_TOKENS},
    "tool_calls": ${TOOL_CALLS}
  }
}
EOF

echo "[baseline] Wrote $OUT"
echo "[baseline] input_tokens=$INPUT_TOKENS output_tokens=$OUTPUT_TOKENS tool_calls=$TOOL_CALLS wall_time=${WALL_TIME}s"
