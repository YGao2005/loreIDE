// Phase 13 Plan 09 — Mocked Sync trigger IPC.
//
// Returns the pre-known set of affected uuids for the demo's delete-account
// flow. Real multi-machine sync is deferred to v3 per VISION.md; for the live
// two-laptop demo, the engineer-laptop substrate state is staged ahead of time
// (plan 13-10a SQL seed + plan 13-10b fixture loader), and clicking Sync just
// reveals the already-known blast radius via the staggered animation in
// src/lib/syncBlastRadius.ts.
//
// Plan 13-10b will replace the hardcoded placeholder uuids below by reading
// from a JSON fixture (.planning/demo/fixtures/beat3-blast-radius.json or
// similar), keeping this function the single entry point for the IPC. Designed
// so the wire shape SyncTriggerResult does NOT change between this plan and
// 13-10b — only the producer changes.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct SyncTriggerResult {
    /// Trigger card (typically the screen card at the top of the chain).
    pub trigger_uuid: String,
    /// Chain participants in invocation order, top-to-bottom.
    pub participant_uuids: Vec<String>,
}

/// Pre-known affected uuids for the demo's delete-account flow.
///
/// PLACEHOLDER values — plan 13-10b's seed-fixture loader will replace these
/// with real uuids matching the SQL seed in the engineer-laptop substrate.
/// The names below are deliberately readable so a missing-fixture state is
/// visually obvious in the canvas (no card matches the uuid → no pulse).
fn demo_delete_account_blast_radius() -> SyncTriggerResult {
    SyncTriggerResult {
        trigger_uuid: "uuid-account-settings-screen".to_string(),
        participant_uuids: vec![
            "uuid-api-account-delete".to_string(),
            "uuid-begin-account-deletion-lib".to_string(),
            "uuid-stripe-customers-archive".to_string(),
            "uuid-mailchimp-suppress".to_string(),
            "uuid-send-deletion-email".to_string(),
        ],
    }
}

/// Trigger the staged blast-radius animation. Returns the trigger + ordered
/// participant uuids; the JS caller passes them to `animateSyncBlastRadius`
/// for the staggered pulse.
///
/// Also emits a `sync:triggered` Tauri event so any future listener (e.g. an
/// audit panel) can react without the JS having to forward the result.
#[tauri::command]
pub async fn trigger_sync_animation(app: AppHandle) -> Result<SyncTriggerResult, String> {
    let result = demo_delete_account_blast_radius();
    // Best-effort emit — non-fatal if no listeners.
    let _ = app.emit("sync:triggered", &result);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blast_radius_has_trigger_plus_participants() {
        let r = demo_delete_account_blast_radius();
        assert!(!r.trigger_uuid.is_empty());
        assert_eq!(r.participant_uuids.len(), 5);
    }

    #[test]
    fn blast_radius_serde_roundtrip_snake_case() {
        let r = demo_delete_account_blast_radius();
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("trigger_uuid"));
        assert!(json.contains("participant_uuids"));
        let parsed: SyncTriggerResult = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.trigger_uuid, r.trigger_uuid);
        assert_eq!(parsed.participant_uuids, r.participant_uuids);
    }
}
