#!/usr/bin/env bash
# Demo reset script — restores deterministic state in <15s (target <10s).
# Per .planning/phases/13-substrate-ui-demo-polish/13-RESEARCH.md Pitfall 7:
#   Must full-relaunch the app so useSubstrateStore re-hydrates from SQLite.
#   Just resetting the .db file isn't enough — in-memory state would persist.

set -euo pipefail

SCRIPT_START=$(date +%s)
REPO_ROOT="${REPO_ROOT:-$HOME/lahacks}"
CONTRACT_IDE_DIR="$REPO_ROOT/contract-ide"
DEMO_REPO_DIR="${DEMO_REPO_DIR:-$HOME/lahacks/contract-ide-demo}"
SEED_DIR="$CONTRACT_IDE_DIR/demo/seeds"
DB_PATH="$HOME/Library/Application Support/com.contract-ide.app/contract-ide.db"
APP_BUNDLE_NAME="contract-ide"  # adapt if Tauri bundle name differs

if [ ! -d "$CONTRACT_IDE_DIR" ]; then
  echo "ERROR: $CONTRACT_IDE_DIR not found"
  exit 1
fi

echo "[reset] Step 1/5: kill running app..."
# Kill any running instance — both Finder-launched and dev-server
pkill -f "$APP_BUNDLE_NAME" || true
pkill -f "tauri dev"        || true
sleep 1  # let processes exit cleanly

echo "[reset] Step 2/5: reset demo repo to locked commit..."
if [ -d "$DEMO_REPO_DIR" ]; then
  cd "$DEMO_REPO_DIR"
  # Reset to the locked commit (set in DEMO_LOCKED_COMMIT env or default to HEAD~0)
  git reset --hard "${DEMO_LOCKED_COMMIT:-HEAD}"
  # Clean any stray new files that wouldn't be tracked
  git clean -fd
else
  echo "[reset] WARNING: $DEMO_REPO_DIR not found — skipping demo repo reset"
fi

echo "[reset] Step 3/5: restore SQLite seed..."
mkdir -p "$(dirname "$DB_PATH")"
# Backup existing DB before replacing — defensive
if [ -f "$DB_PATH" ]; then
  cp "$DB_PATH" "$DB_PATH.before-reset.bak"
fi
# Apply seed: keep the migrated DB structure, just reload substrate_nodes table from seed.
# (App's tauri-plugin-sql migrations run on next launch and create whatever schema is missing.)
sqlite3 "$DB_PATH" < "$SEED_DIR/substrate.sqlite.seed.sql"

echo "[reset] Step 4/5: relaunch app..."
# Launch the production .app bundle (deterministic boot path); fallback to tauri dev.
APP_PATH="$CONTRACT_IDE_DIR/src-tauri/target/release/bundle/macos/$APP_BUNDLE_NAME.app"
if [ -d "$APP_PATH" ]; then
  open "$APP_PATH"
else
  echo "[reset] No release bundle found at $APP_PATH; running tauri dev..."
  cd "$CONTRACT_IDE_DIR"
  npm run tauri dev > /tmp/contract-ide-dev.log 2>&1 &
  disown
  echo "[reset] tauri dev started (logs at /tmp/contract-ide-dev.log)"
fi

echo "[reset] Step 5/5: wait for app boot..."
# Give the app time to hydrate substrate store from SQLite
sleep 3

echo "[reset] Done. Total elapsed: $(($(date +%s) - SCRIPT_START))s"
echo "[reset] Open the demo repo in the IDE; press Cmd+P; type 'account settings'; verify hits."
