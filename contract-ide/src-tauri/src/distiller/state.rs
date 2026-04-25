use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Per-session distill-in-flight guard. Mirrors Phase 7's DriftLocks pattern.
/// Acquire via `for_session(session_id)` BEFORE the claude -p call to prevent
/// two episodes from the same session being distilled concurrently (would race
/// on substrate_node IDs derived from same session_id).
///
/// CRITICAL: Uses `tokio::sync::Mutex` (NOT `std::sync::Mutex`). The guard
/// is held across `.await` points (DB queries + claude subprocess). std::sync::Mutex
/// is not Send-across-await and panics the scheduler under load.
#[derive(Default)]
pub struct DistillerLocks {
    inner: DashMap<String, Arc<Mutex<()>>>,
}

impl DistillerLocks {
    pub fn for_session(&self, session_id: &str) -> Arc<Mutex<()>> {
        self.inner
            .entry(session_id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}
