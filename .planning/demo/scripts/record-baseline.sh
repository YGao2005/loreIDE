#!/usr/bin/env bash
# Record bare-Claude baseline for a demo prompt.
# Pitfall 6 from 09-RESEARCH.md: MUST run before substrate seeding so context can't leak.
#
# Usage: record-baseline.sh <name> "<prompt>"
# Output: .planning/demo/baselines/<name>-baseline.json
#
# Conditions enforced (clean baseline):
#   - Tree contents match demo repo at locked SHA, but extracted into a tmpdir
#     workspace whose git history contains ONLY a single synthetic "baseline"
#     commit. This prevents bare Claude from running `git show <SHA>:.contracts/...`
#     to peek at substrate via history (Pitfall 6 — discovered 2026-04-25 audit).
#   - .contracts/ directory absent (working tree AND history)
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

# Step 1: Reset canonical demo repo to locked SHA so the tree we extract
# matches the locked state exactly.
echo "[baseline] Resetting canonical demo repo to $DEMO_COMMIT_SHA"
git -C "$DEMO_REPO" checkout --detach "$DEMO_COMMIT_SHA"
git -C "$DEMO_REPO" clean -fd

# Step 2: Build a HISTORY-CLEAN baseline workspace.
# rsync the working tree into a tmpdir, drop the .git directory, then re-init
# git with a single synthetic commit. This eliminates the contamination path
# discovered 2026-04-25: bare Claude was running `git show <SHA>:.contracts/...`
# against the canonical repo to peek at substrate via history.
BASELINE_PARENT="$(mktemp -d -t contract-ide-baseline)"
BASELINE_DIR="$BASELINE_PARENT/contract-ide-demo"
echo "[baseline] Building history-clean workspace at $BASELINE_DIR"
mkdir -p "$BASELINE_DIR"
# rsync excludes large/cache directories that Claude won't touch but would slow
# the copy. node_modules is included (~half the demo repo size) so bare Claude
# can typecheck if it wants to.
rsync -a \
  --exclude '.git/' \
  --exclude '.next/' \
  --exclude '.contracts/' \
  --exclude '.mcp.json' \
  "$DEMO_REPO/" "$BASELINE_DIR/"

# 09-04 Option A: demo-setup file is named DEMO-SETUP.md, NOT CLAUDE.md.
# Assert NO CLAUDE.md exists rather than rm-ing it — fail loudly if Option A
# was reverted instead of silently mutating state.
if [[ -f "$BASELINE_DIR/CLAUDE.md" ]]; then
  echo "ERROR: $DEMO_REPO/CLAUDE.md exists. Per 09-04 Option A, the demo-setup file" >&2
  echo "       must be named DEMO-SETUP.md so CLAUDE.md never exists in the demo repo." >&2
  echo "       Pitfall 6 risk: bare-Claude baseline could leak context. ABORT." >&2
  exit 1
fi

# Verify clean working tree
if [[ -d "$BASELINE_DIR/.contracts" ]] || [[ -f "$BASELINE_DIR/CLAUDE.md" ]] || [[ -f "$BASELINE_DIR/.mcp.json" ]]; then
  echo "ERROR: clean-state verification failed in $BASELINE_DIR" >&2
  exit 1
fi

# Re-init git with a single synthetic commit — bare Claude can run `git log` /
# `git show` but only sees the baseline commit, no substrate in history.
git -C "$BASELINE_DIR" init -q -b main
git -C "$BASELINE_DIR" add -A
git -C "$BASELINE_DIR" \
  -c user.email=baseline@local \
  -c user.name=baseline \
  -c commit.gpgsign=false \
  commit -q -m "baseline (history-clean snapshot of demo repo at $DEMO_COMMIT_SHA)"

# Verify history is clean: substrate must not appear in any past commit
if git -C "$BASELINE_DIR" log --all -- '.contracts/' 2>/dev/null | grep -q "commit "; then
  echo "ERROR: .contracts/ found in baseline git history — clean failed" >&2
  exit 1
fi
echo "[baseline] History-clean state verified — single synthetic commit, no .contracts/ in tree or history"

# Step 3: Compute the encoded cwd for ~/.claude/projects/<encoded> path
# macOS Claude Code encodes the cwd by replacing / with -
ENCODED_CWD=$(echo "$BASELINE_DIR" | sed 's/\//-/g')
SESSION_DIR="$HOME/.claude/projects/$ENCODED_CWD"

# Snapshot existing sessions so we can identify the new one (should be empty
# since the baseline dir is brand new, but defensive).
mkdir -p "$SESSION_DIR" 2>/dev/null || true
SESSIONS_BEFORE=$(ls -1 "$SESSION_DIR" 2>/dev/null | sort | uniq || true)

# Step 4: Run claude -p
echo "[baseline] Running: claude -p \"$PROMPT\""
cd "$BASELINE_DIR"
START=$(date +%s)
claude -p "$PROMPT" > "/tmp/baseline-${NAME}-output.txt" 2>&1 || {
  echo "WARNING: claude exited non-zero — baseline may still be capturable from JSONL"
}
END=$(date +%s)
WALL_TIME=$((END-START))

# Step 5: Find the new session JSONL.
# Claude Code's encoded-cwd algorithm replaces non-alphanumeric chars (_, ., /, -)
# with '-' and resolves macOS /var/folders/ symlinks to /private/var/folders/.
# Predicting the exact encoded path is brittle, so search across all session
# dirs for the JSONL whose first-line `cwd` field matches our baseline path.
JSONL=$(find "$HOME/.claude/projects/" -name "*.jsonl" -newer "$BASELINE_DIR" 2>/dev/null \
  -exec sh -c '
    head -1 "$1" 2>/dev/null | grep -q "\"cwd\":\"$2\"" && echo "$1"
  ' _ {} "$BASELINE_DIR" \; | head -1)

# Fallback: take newest .jsonl in any dir mentioning baseline name
if [[ -z "$JSONL" ]]; then
  JSONL=$(find "$HOME/.claude/projects/" -path "*contract-ide-baseline*" -name "*.jsonl" -mmin -5 2>/dev/null \
    | xargs ls -1t 2>/dev/null | head -1)
fi

if [[ -z "$JSONL" || ! -f "$JSONL" ]]; then
  echo "ERROR: could not identify new session JSONL for $BASELINE_DIR" >&2
  echo "       Searched: $HOME/.claude/projects/" >&2
  echo "       Tip: find ~/.claude/projects/ -name '*.jsonl' -mmin -5 | xargs head -1 | grep cwd" >&2
  exit 1
fi
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
  "baseline_workspace": "${BASELINE_DIR}",
  "claude_version": "${CLAUDE_VERSION}",
  "conditions": {
    "no_contracts_dir": true,
    "no_claude_md": true,
    "no_mcp_json": true,
    "history_clean": true
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
echo "[baseline] Baseline workspace preserved at $BASELINE_DIR (delete with: rm -rf $BASELINE_PARENT)"
