// Phase 13 Plan 09 → 10b — Mocked Sync trigger IPC.
//
// Returns the pre-known set of affected uuids for the demo's delete-account
// flow. Real multi-machine sync is deferred to v3 per VISION.md; for the live
// two-laptop demo, the engineer-laptop substrate state is staged ahead of time
// (plan 13-10a SQL seed + plan 13-10b fixture loader), and clicking Sync just
// reveals the already-known blast radius via the staggered animation in
// src/lib/syncBlastRadius.ts.
//
// Plan 13-10b: replaced plan 13-09's hardcoded placeholder uuids with a
// JSON fixture read from blast-radius.json. The wire shape SyncTriggerResult
// is preserved so SyncButton wiring requires zero changes downstream. If the
// fixture is missing/unreadable, returns empty arrays + logs to stderr — the
// demo orchestrator (plan 13-11) catches missing fixtures during pre-flight.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct SyncTriggerResult {
    /// Trigger card (typically the screen card at the top of the chain).
    pub trigger_uuid: String,
    /// Chain participants in invocation order, top-to-bottom.
    pub participant_uuids: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct BlastRadiusFixture {
    pub trigger_uuid: String,
    pub participant_uuids: Vec<String>,
}

/// Resolve fixture directory. Honors `CONTRACT_IDE_DEMO_FIXTURE_DIR` env var;
/// falls back to `<crate>/../demo/seeds` (relative to CARGO_MANIFEST_DIR at
/// build time, which lands at `contract-ide/demo/seeds` on disk).
fn fixture_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("CONTRACT_IDE_DEMO_FIXTURE_DIR") {
        return PathBuf::from(dir);
    }
    PathBuf::from(format!("{}/../demo/seeds", env!("CARGO_MANIFEST_DIR")))
}

/// Read blast-radius.json from the fixture directory. Returns Err with
/// human-readable diagnostic if read or parse fails.
fn load_blast_radius_fixture() -> Result<BlastRadiusFixture, String> {
    let path = fixture_dir().join("blast-radius.json");
    let data = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read blast-radius.json at {path:?}: {e}"))?;
    let fixture: BlastRadiusFixture = serde_json::from_str(&data)
        .map_err(|e| format!("Failed to parse blast-radius.json: {e}"))?;
    Ok(fixture)
}

/// Trigger the staged blast-radius animation. Returns the trigger + ordered
/// participant uuids; the JS caller passes them to `animateSyncBlastRadius`
/// for the staggered pulse.
///
/// Also emits a `sync:triggered` Tauri event so any future listener (e.g. an
/// audit panel) can react without the JS having to forward the result.
#[tauri::command]
pub async fn trigger_sync_animation(app: AppHandle) -> Result<SyncTriggerResult, String> {
    let result = match load_blast_radius_fixture() {
        Ok(f) => SyncTriggerResult {
            trigger_uuid: f.trigger_uuid,
            participant_uuids: f.participant_uuids,
        },
        Err(e) => {
            // Defensive fallback: empty arrays don't blow up the UI; plan
            // 13-11 rehearsal pre-flight catches missing fixtures.
            eprintln!("[sync] fixture load failed, using empty fallback: {e}");
            SyncTriggerResult {
                trigger_uuid: String::new(),
                participant_uuids: vec![],
            }
        }
    };
    // Best-effort emit — non-fatal if no listeners.
    let _ = app.emit("sync:triggered", &result);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sync_trigger_result_serde_roundtrip_snake_case() {
        let r = SyncTriggerResult {
            trigger_uuid: "uuid-trigger".to_string(),
            participant_uuids: vec!["a".to_string(), "b".to_string()],
        };
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("trigger_uuid"));
        assert!(json.contains("participant_uuids"));
        let parsed: SyncTriggerResult = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.trigger_uuid, r.trigger_uuid);
        assert_eq!(parsed.participant_uuids, r.participant_uuids);
    }

    #[test]
    fn blast_radius_fixture_parses_expected_shape() {
        let json = r#"{
            "trigger_uuid": "screen-uuid",
            "participant_uuids": ["a", "b", "c"]
        }"#;
        let parsed: BlastRadiusFixture = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.trigger_uuid, "screen-uuid");
        assert_eq!(parsed.participant_uuids.len(), 3);
    }

    #[test]
    fn fixture_dir_honors_env_var() {
        std::env::set_var("CONTRACT_IDE_DEMO_FIXTURE_DIR", "/tmp/nonexistent-test");
        let dir = fixture_dir();
        assert_eq!(dir, PathBuf::from("/tmp/nonexistent-test"));
        std::env::remove_var("CONTRACT_IDE_DEMO_FIXTURE_DIR");
    }
}
