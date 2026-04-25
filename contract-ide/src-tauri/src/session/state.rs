use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Per-session serialization guard. One mutex per session_id, lazily inserted
/// on first ingest event. Never garbage-collected (hackathon scale: < 100
/// sessions per developer per day; 48 bytes per entry).
///
/// CRITICAL: Uses `tokio::sync::Mutex` (NOT `std::sync::Mutex`). The guard is
/// held across `.await` points (DB queries during ingest). std::sync::Mutex
/// is not Send-across-await and the clippy `await_holding_lock` lint flags it.
///
/// Mirror of Phase 7's `crate::drift::state::DriftLocks`. Both registered in
/// lib.rs managed state alongside each other.
#[derive(Default)]
pub struct SessionLocks(pub DashMap<String, Arc<Mutex<()>>>);

impl SessionLocks {
    /// Returns the per-session tokio mutex (lazily inserted). Consumed by
    /// `ingestor::ingest_session_file` (10-02) and `SessionWatcher::watch_project`
    /// (10-03).
    pub fn for_session(&self, session_id: &str) -> Arc<Mutex<()>> {
        self.0
            .entry(session_id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}
