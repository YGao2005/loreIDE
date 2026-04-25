use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Per-node serialization guard. One mutex per node UUID, lazily inserted on
/// first drift event. Never garbage-collected (demo scale < 1k nodes; the
/// memory cost is 48 bytes per entry).
///
/// CRITICAL: Uses `tokio::sync::Mutex` (NOT `std::sync::Mutex`). The guard
/// is held across `.await` points (DB queries). std::sync::Mutex is not
/// Send-across-await and panics the scheduler under load.
///
/// Phase 8's PostToolUse hook will reuse this same map via
/// `DriftLocks::for_uuid(uuid)` → guaranteed no race between watcher and hook.
#[derive(Default)]
pub struct DriftLocks(pub DashMap<String, Arc<Mutex<()>>>);

impl DriftLocks {
    pub fn for_uuid(&self, uuid: &str) -> Arc<Mutex<()>> {
        self.0
            .entry(uuid.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}
