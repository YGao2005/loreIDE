#!/usr/bin/env bash
# Phase 9 partial reset script. Phase 13 absorbs the dev-server start, Contract IDE
# launch, and full env teardown. This script handles the two reset steps that
# depend ONLY on Phase 9 deliverables: demo repo checkout + substrate seed swap.
#
# Usage: reset-demo.sh
# Reads:
#   DEMO_REPO       — path to contract-ide-demo (default: /Users/yang/lahacks/contract-ide-demo)
#   DEMO_COMMIT_SHA — locked SHA (default: read from .planning/demo/contract-ide-demo-spec.md)
#   SUBSTRATE_DB    — path to live substrate db that Phase 10's distiller writes to
#                     (default: /tmp/contract-ide-demo-substrate.sqlite)

set -euo pipefail
START=$(date +%s)

LAHACKS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DEMO_REPO="${DEMO_REPO:-${LAHACKS_ROOT}/contract-ide-demo}"
SPEC="${LAHACKS_ROOT}/.planning/demo/contract-ide-demo-spec.md"
SEED="${LAHACKS_ROOT}/.planning/demo/seeds/substrate.sqlite.seed"
SUBSTRATE_DB="${SUBSTRATE_DB:-/tmp/contract-ide-demo-substrate.sqlite}"

# Read locked SHA from spec doc (line beginning with "Locked SHA:")
if [[ -z "${DEMO_COMMIT_SHA:-}" ]]; then
  DEMO_COMMIT_SHA=$(awk '/^Locked SHA:/{print $3}' "$SPEC" | head -1)
fi
if [[ -z "${DEMO_COMMIT_SHA:-}" ]]; then
  echo "ERROR: DEMO_COMMIT_SHA not set and not found in $SPEC" >&2
  exit 1
fi

echo "[reset] Demo repo: $DEMO_REPO"
echo "[reset] Locked SHA: $DEMO_COMMIT_SHA"

# Step 1: restore demo repo to locked SHA. Use detached-HEAD checkout +
# clean rather than `git reset --hard` — non-destructive against any
# uncommitted WIP a developer might have in the demo repo working tree
# (e.g., a hand-edit they want to keep), while still landing the working
# tree at the locked SHA for demo purposes. `git clean -fd` removes
# untracked + ignored output (build artifacts, dev.db, etc.) which is
# what the demo needs.
git -C "$DEMO_REPO" checkout --detach "$DEMO_COMMIT_SHA"
git -C "$DEMO_REPO" clean -fd

# Step 2: restore substrate snapshot
cp "$SEED" "$SUBSTRATE_DB"

END=$(date +%s)
echo "[reset] Complete in $((END-START))s"
echo "[reset] Verification:"
sqlite3 "$SUBSTRATE_DB" "SELECT type, COUNT(*) FROM substrate_nodes GROUP BY type"
echo "[reset] Demo repo HEAD: $(git -C "$DEMO_REPO" rev-parse HEAD)"
