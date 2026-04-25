#!/usr/bin/env bash
# PostToolUse hook for Contract IDE.
#
# Pass 1 (synchronous): append one JSONL line per Write/Edit/MultiEdit to
#   .contracts/journal/<session_id>.jsonl with {schema_version, ts, session_id,
#   tool, file, affected_uuids, intent}.
#
# Pass 2 (fire-and-forget): for each affected UUID, spawn a backgrounded
#   `claude -p` subprocess that calls the update_contract MCP tool. Subscription
#   auth carries to subprocess (Phase 6 derivation pivot pattern).
#
# Exits 0 on every path so the agent flow is never broken mid-demo.
set -u
trap 'exit 0' ERR

# Make jq invocations safe even with -u; we wrap risky calls in `|| true`.
set +e

PAYLOAD=$(cat)

SESSION_ID=$(jq -r '.session_id // empty' <<<"$PAYLOAD" 2>/dev/null)
TRANSCRIPT_PATH=$(jq -r '.transcript_path // empty' <<<"$PAYLOAD" 2>/dev/null)
TOOL_NAME=$(jq -r '.tool_name // empty' <<<"$PAYLOAD" 2>/dev/null)
FILE_PATH=$(jq -r '.tool_input.file_path // .tool_input.path // empty' <<<"$PAYLOAD" 2>/dev/null)
CWD=$(jq -r '.cwd // empty' <<<"$PAYLOAD" 2>/dev/null)

# No file_path → nothing to journal.
[ -z "$FILE_PATH" ] && exit 0
# Default cwd to PWD if payload omits it.
[ -z "$CWD" ] && CWD="$PWD"

# Skip writes outside cwd. Pattern match handles both absolute and relative file_path.
case "$FILE_PATH" in
    "$CWD"/*) ;;
    /*) exit 0 ;;
    *) FILE_PATH="$CWD/$FILE_PATH" ;;
esac

REL_PATH="${FILE_PATH#$CWD/}"
JOURNAL_DIR="$CWD/.contracts/journal"
mkdir -p "$JOURNAL_DIR" 2>/dev/null || true

# Phase 2 — affected UUIDs lookup (read-only SQLite).
# DB path is overridable via CONTRACT_IDE_DB_PATH for tests; otherwise derive from
# macOS app-data convention.
DB_PATH="${CONTRACT_IDE_DB_PATH:-$HOME/Library/Application Support/com.contract-ide.app/contract-ide.db}"
AFFECTED_UUIDS_JSON="[]"
if [ -f "$DB_PATH" ] && command -v sqlite3 >/dev/null 2>&1; then
    QUERY="SELECT json_group_array(uuid) FROM (SELECT DISTINCT n.uuid FROM nodes n, json_each(n.code_ranges) je WHERE json_extract(je.value, '\$.file') = '$REL_PATH')"
    RESULT=$(sqlite3 -readonly "$DB_PATH" "$QUERY" 2>/dev/null)
    if [ -n "$RESULT" ] && [ "$RESULT" != "null" ]; then
        AFFECTED_UUIDS_JSON="$RESULT"
    fi
fi

# Phase 3 — intent extraction (tail-of-transcript, last user-with-string-content).
# `tac` on Linux, `tail -r` on macOS; both reverse line order.
if command -v tac >/dev/null 2>&1; then
    REVERSE_CMD="tac"
else
    REVERSE_CMD="tail -r"
fi
INTENT=""
if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
    INTENT=$($REVERSE_CMD "$TRANSCRIPT_PATH" 2>/dev/null \
        | jq -r 'select(.type == "user" and (.message.content | type == "string")) | .message.content' 2>/dev/null \
        | head -1 \
        || true)
fi
# Headless `-p` fallback: no user prompt visible.
if [ -z "$INTENT" ]; then
    INTENT="(headless: $TOOL_NAME on $REL_PATH)"
fi

# Phase 4 — journal append (Pass 1, synchronous).
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
LINE=$(jq -nc \
    --arg ts "$TS" \
    --arg session_id "$SESSION_ID" \
    --arg tool "$TOOL_NAME" \
    --arg file "$REL_PATH" \
    --argjson affected_uuids "$AFFECTED_UUIDS_JSON" \
    --arg intent "$INTENT" \
    '{schema_version: 1, ts: $ts, session_id: $session_id, tool: $tool, file: $file, affected_uuids: $affected_uuids, intent: $intent}' 2>/dev/null)

if [ -n "$LINE" ]; then
    echo "$LINE" >> "$JOURNAL_DIR/$SESSION_ID.jsonl" 2>/dev/null || true
fi

# Phase 5 — per-UUID auto-rederive spawn (Pass 2, fire-and-forget).
# Skip if no affected UUIDs.
if [ "$AFFECTED_UUIDS_JSON" = "[]" ]; then
    exit 0
fi

UUIDS=$(echo "$AFFECTED_UUIDS_JSON" | jq -r '.[]' 2>/dev/null || true)
for uuid in $UUIDS; do
    [ -z "$uuid" ] && continue
    # Build the prompt as a here-doc-quoted string.
    PROMPT="Use the update_contract MCP tool for UUID $uuid. Steps: (1) read the current sidecar at .contracts/$uuid.md to get the existing body. (2) read the source code at the cited code_ranges. (3) derive a new contract body that matches the code's observed behavior. (4) call update_contract($uuid, new_body). CRITICAL: the new body MUST preserve the existing '## Intent' and '## Role' sections verbatim — only update '## Examples' and '## Implicit Decisions' to reflect what the code actually does. If update_contract returns SKIPPED-PINNED, exit silently — pinned contracts are not auto-rederived."
    # Fully detach: redirect ALL subshell FDs to /dev/null so the parent's
    # stdout/stderr pipes don't keep the parent process alive while the
    # backgrounded `claude -p` runs (10-30s). Without this, Rust callers that
    # capture the hook's stdout block until the children close those FDs.
    (
        cd "$CWD" || exit 0
        claude -p --dangerously-skip-permissions "$PROMPT"
    ) </dev/null >/dev/null 2>&1 &
    disown 2>/dev/null || true
done

exit 0
