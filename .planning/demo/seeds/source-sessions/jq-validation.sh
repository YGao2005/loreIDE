#!/usr/bin/env bash
# Validate deletion-incident-2026-02.jsonl is ingestible by Phase 10's filter pipeline.
#
# Mirrors the filter logic from contract-ide/src-tauri/src/session/ingestor.rs:
# - Keep type="user" where isMeta is not true and message.content is a plain string
# - Keep type="assistant" where message.content is an array; extract .text blocks
# - Skip tool_use, thinking, file-history-snapshot, and all other types
#
# Also validates:
# - Every line is valid JSON (Pitfall 4 — malformed JSONL breaks Phase 10 ingestor)
# - All 5 substrate rule IDs appear in the filtered output (distiller anchor tokens)
# - Priority-shift anchor (compliance-first) is present
#
# Usage: ./jq-validation.sh
# Expected output: "[validate] PASS" with no WARNING lines
#
# Run before placing deletion-incident-2026-02.jsonl at:
#   ~/.claude/projects/<encoded-cwd>/deletion-incident-2026-02.jsonl

set -euo pipefail

JSONL="$(dirname "${BASH_SOURCE[0]}")/deletion-incident-2026-02.jsonl"

if [[ ! -f "$JSONL" ]]; then
  echo "ERROR: $JSONL not found" >&2
  exit 1
fi

# ── Step 1: Verify every line is valid JSON ──────────────────────────────────
LINE_COUNT=$(wc -l < "$JSONL" | tr -d ' ')
ERRORS=0

while IFS= read -r line; do
  if ! echo "$line" | jq -e '.' > /dev/null 2>&1; then
    echo "ERROR: malformed JSON line: ${line:0:80}..." >&2
    ERRORS=$((ERRORS + 1))
  fi
done < "$JSONL"

if [[ $ERRORS -gt 0 ]]; then
  echo "ERROR: $ERRORS malformed JSON lines in $JSONL" >&2
  exit 1
fi
echo "[validate] $LINE_COUNT lines, all valid JSON"

# ── Step 2: Apply Phase 10's expected filter ─────────────────────────────────
# Mirror the Rust logic in session/ingestor.rs filter_session_lines():
# - user turns: message.content is a string, isMeta != true, not starting with '<'
# - assistant turns: message.content is an array, extract .text-typed blocks only
FILTERED=$(jq -r '
  select(.type == "user" or .type == "assistant") |
  if .type == "user" then
    select(.isMeta != true) |
    .message.content |
    if type == "string" and (startswith("<") | not) then .
    elif type == "array" then (map(select(.type == "text") | .text) | join("\n"))
    else empty
    end
  else
    # assistant: content is always array
    .message.content |
    if type == "array" then (map(select(.type == "text") | .text) | join("\n"))
    else empty
    end
  end
' "$JSONL" 2>&1)

if [[ -z "$FILTERED" ]]; then
  echo "ERROR: filter produced empty output — JSONL may not match Phase 10 schema" >&2
  exit 1
fi

FILTERED_CHARS=$(echo "$FILTERED" | wc -c | tr -d ' ')
FILTERED_WORDS=$(echo "$FILTERED" | wc -w | tr -d ' ')
echo "[validate] filtered text: $FILTERED_CHARS characters, $FILTERED_WORDS words"

# ── Step 3: Count turn types ─────────────────────────────────────────────────
USER_COUNT=$(jq -r 'select(.type == "user" and .isMeta != true)' "$JSONL" | jq -s 'length')
ASSISTANT_COUNT=$(jq -r 'select(.type == "assistant")' "$JSONL" | jq -s 'length')
echo "[validate] turns: $USER_COUNT user, $ASSISTANT_COUNT assistant"

if [[ $USER_COUNT -lt 15 ]]; then
  echo "WARNING: only $USER_COUNT user turns — expected ≥15 for 4-thread narrative" >&2
fi

# ── Step 4: Verify each substrate rule ID appears in the filtered output ──────
PASS=true
for RULE in dec-soft-delete-30day-grace \
            dec-confirm-via-email-link \
            con-stripe-customer-archive \
            con-anonymize-not-delete-tax-held \
            con-mailing-list-suppress-not-delete; do
  if echo "$FILTERED" | grep -q "$RULE"; then
    echo "[validate] rule $RULE: anchored in JSONL"
  else
    echo "WARNING: rule id $RULE not found in filtered output — distiller may miss it" >&2
    PASS=false
  fi
done

# ── Step 5: Verify the priority-shift anchor is present ──────────────────────
if echo "$FILTERED" | grep -qi "compliance-first"; then
  echo "[validate] priority-shift anchor (compliance-first): present"
else
  echo "WARNING: priority-shift anchor (compliance-first) not found — Phase 12 narrative may be weakened" >&2
  PASS=false
fi

# ── Step 6: Verify verbatim rule text fragments are present ──────────────────
# These are key phrases from the substrate-rules.sql text fields; distiller
# training data — rule text appears verbatim in source session, distiller extracts it back.
declare -a ANCHORS=(
  "set deletedAt"
  "Never call"
  "db.user.delete"
  "email-link confirmation"
  "stripe.customers.update"
  "archived_at"
  "deleted user"
  "anonymized, not deleted"
  "unsubscribed"
  "status_if_new"
)

for ANCHOR in "${ANCHORS[@]}"; do
  if echo "$FILTERED" | grep -q "$ANCHOR"; then
    echo "[validate] verbatim anchor '$ANCHOR': present"
  else
    echo "WARNING: verbatim anchor '$ANCHOR' not found in filtered output" >&2
  fi
done

# ── Step 7: Check jq filter specifically used in extraction-prompt.md ────────
# The extraction-prompt.md filter is:
#   jq -r 'select(.type=="user" or .type=="assistant") | .message.content'
# This simpler version should also work (even though Phase 10 uses the richer one)
SIMPLE_FILTER=$(jq -r 'select(.type=="user" or .type=="assistant") | .message.content' \
  "$JSONL" 2>/dev/null | { head -5; cat > /dev/null; } 2>/dev/null || true)
if [[ -n "$SIMPLE_FILTER" ]]; then
  echo "[validate] extraction-prompt.md simple filter: produces output"
else
  echo "WARNING: extraction-prompt.md simple filter produced empty output" >&2
fi

# ── Final result ──────────────────────────────────────────────────────────────
if [[ "$PASS" == "true" ]]; then
  echo "[validate] PASS"
else
  echo "[validate] WARNINGS present — review output above before committing" >&2
  # Exit 0 anyway — warnings are non-blocking; only hard errors exit non-zero
  echo "[validate] PASS (with warnings)"
fi
