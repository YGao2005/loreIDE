#!/usr/bin/env bash
# Build substrate.sqlite.seed from substrate-rules.sql idempotently.
# Run this whenever substrate-rules.sql is edited.
set -euo pipefail

PLANNING_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SEED="${PLANNING_DIR}/seeds/substrate.sqlite.seed"
SQL="${PLANNING_DIR}/seeds/substrate-rules.sql"

if [[ ! -f "$SQL" ]]; then
  echo "ERROR: $SQL not found" >&2
  exit 1
fi

rm -f "$SEED"
sqlite3 "$SEED" < "$SQL"

# Verification: count rows and emit summary
NODE_COUNT=$(sqlite3 "$SEED" "SELECT COUNT(*) FROM substrate_nodes")
EDGE_COUNT=$(sqlite3 "$SEED" "SELECT COUNT(*) FROM substrate_edges")
echo "Built $SEED"
echo "  substrate_nodes: $NODE_COUNT (expected 8: 5 rules + 1 parent constraint + 2 priorities)"
echo "  substrate_edges: $EDGE_COUNT (expected 2: supersedes + derived_from)"

if [[ "$NODE_COUNT" != "8" ]]; then
  echo "ERROR: expected 8 substrate_nodes, got $NODE_COUNT" >&2
  exit 1
fi

if [[ "$EDGE_COUNT" != "2" ]]; then
  echo "ERROR: expected 2 substrate_edges, got $EDGE_COUNT" >&2
  exit 1
fi

echo "Build complete."
