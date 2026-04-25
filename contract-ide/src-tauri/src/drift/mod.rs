//! Phase 7 drift detection — watcher path.
//!
//! `state` exposes per-UUID tokio mutexes (DashMap<String, Arc<Mutex>>).
//! `engine` holds the drift computation routine.
//! `watcher` wraps a notify::RecommendedWatcher against a curated file set.
//!
//! Tauri commands live in `crate::commands::drift` (added in Plan 07-02).

pub mod engine;
pub mod state;
pub mod watcher;
