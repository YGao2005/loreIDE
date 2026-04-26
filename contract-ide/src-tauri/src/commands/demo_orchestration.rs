// Phase 13 Plan 10b — Demo orchestration IPCs.
//
// Loaders for Beat 3 + Beat 4 fixture files (shipped by sibling plan 13-10a).
// Both IPCs read fresh from disk on each call so plan 13-11 rehearsal can
// edit the JSON without rebuilding the binary.
//
// `load_beat3_verifier_fixture` returns the parsed fixture as a JsonValue —
// the TS layer (loadAndApplyBeat3Verifier) interprets the shape and applies
// it via useVerifierStore.setResults.
//
// `emit_beat4_harvest` emits a `substrate:nodes-added` Tauri event with the
// harvested_nodes array (matching HarvestPanel's listener payload shape, plan
// 13-09). HarvestPanel's animateHarvestArrival call (per plan 13-09 N9) fires
// green halos on each node's attached_to_uuid participant.
//
// Defensive: if a fixture file is missing/unreadable, returns Err with a
// human-readable diagnostic. Does NOT crash the app — TS callers surface the
// error to the user.

use serde_json::Value as JsonValue;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

/// Resolve fixture directory. Honors `CONTRACT_IDE_DEMO_FIXTURE_DIR` env var;
/// falls back to `<crate>/../demo/seeds` (lands at `contract-ide/demo/seeds`
/// on disk under the standard repo layout).
fn fixture_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("CONTRACT_IDE_DEMO_FIXTURE_DIR") {
        return PathBuf::from(dir);
    }
    PathBuf::from(format!("{}/../demo/seeds", env!("CARGO_MANIFEST_DIR")))
}

/// Read beat3-verifier.json from the fixture directory and return its parsed
/// JSON shape. The TS layer is the source of truth for the shape contract;
/// this IPC is intentionally schema-agnostic so plan 13-11 can iterate the
/// fixture content without Rust recompiles.
#[tauri::command]
pub async fn load_beat3_verifier_fixture() -> Result<JsonValue, String> {
    let path = fixture_dir().join("beat3-verifier.json");
    let data = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read beat3-verifier.json at {path:?}: {e}"))?;
    serde_json::from_str(&data)
        .map_err(|e| format!("Failed to parse beat3-verifier.json: {e}"))
}

/// Read beat4-harvest.json and emit `substrate:nodes-added` with the
/// harvested_nodes array. HarvestPanel (plan 13-09) consumes the event;
/// nodes carrying `attached_to_uuid` trigger green halos on the matching
/// participant per N9 staging.
#[tauri::command]
pub async fn emit_beat4_harvest(app: AppHandle) -> Result<(), String> {
    let path = fixture_dir().join("beat4-harvest.json");
    let data = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read beat4-harvest.json at {path:?}: {e}"))?;
    let parsed: JsonValue = serde_json::from_str(&data)
        .map_err(|e| format!("Failed to parse beat4-harvest.json: {e}"))?;
    let nodes = parsed
        .get("harvested_nodes")
        .cloned()
        .unwrap_or_else(|| JsonValue::Array(vec![]));
    app.emit("substrate:nodes-added", &nodes)
        .map_err(|e| format!("Failed to emit substrate:nodes-added: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixture_dir_honors_env_var() {
        std::env::set_var(
            "CONTRACT_IDE_DEMO_FIXTURE_DIR",
            "/tmp/demo-orch-test-fixture",
        );
        let dir = fixture_dir();
        assert_eq!(dir, PathBuf::from("/tmp/demo-orch-test-fixture"));
        std::env::remove_var("CONTRACT_IDE_DEMO_FIXTURE_DIR");
    }

    #[test]
    fn fixture_dir_falls_back_to_crate_relative_seeds() {
        std::env::remove_var("CONTRACT_IDE_DEMO_FIXTURE_DIR");
        let dir = fixture_dir();
        let dir_str = dir.to_string_lossy();
        assert!(
            dir_str.ends_with("demo/seeds") || dir_str.ends_with("demo\\seeds"),
            "expected fallback to end with demo/seeds, got {dir_str}"
        );
    }
}
