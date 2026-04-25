//! Phase 7 + Phase 8 Plan 08-02 source-file watcher.
//!
//! `SourceWatcher` wraps a `notify::RecommendedWatcher` that observes the set
//! of source files referenced by any node's `code_ranges`. On file event it
//! dispatches per-UUID drift computation via `tauri::async_runtime::spawn`.
//!
//! Phase 8 Plan 08-02 extension (SIBLING pattern — Phase 7 code untouched):
//! - On each FSEvents callback, ALSO spawn `compute_rollup_and_emit` for the
//!   changed node's UUID AND for each ancestor UUID (walk `parent_uuid`
//!   recursively up to L0). This ensures the L4→L3→L2→L1 cascade fires
//!   within ~2s of a child's cited-section edit (SC 8 of Phase 8).
//! - Ancestor UUIDs are resolved from the `uuid_to_parent` snapshot built
//!   alongside `path_to_uuids` during each `refresh()` call.
//! - Errors from `compute_rollup_and_emit` are logged, NOT propagated —
//!   the watcher callback must remain infallible so one failing node doesn't
//!   block other drift events.
//!
//! Design decisions (RESEARCH.md §Pattern 1):
//! - `RecursiveMode::NonRecursive`: we watch individual files, not directories.
//!   At hackathon scale (< 200 source files) individual-file watches are cheap.
//!   Watching the whole repo recursively would hit node_modules/ + .git/ noise.
//! - `notify::recommended_watcher` picks FSEvents on macOS automatically
//!   (our `macos_fsevent` feature enables the backend).
//! - `std::sync::Mutex` (NOT tokio::sync::Mutex) guards the watcher fields
//!   here because `refresh()` is a synchronous function — no `.await` held
//!   across the lock guard. Safe to use std::sync::Mutex in sync context.
//! - The `inner` watcher is replaced atomically on each `refresh()` call;
//!   the old watcher drops cleanly, unregistering all previous watches.
//!
//! Known limitation — refresh race window: replacing `inner` is not atomic
//! with respect to FSEvents. Between the moment the new watcher finishes
//! registering watches and the moment the old watcher is dropped, an event
//! that fires can land in the OLD closure (still using the OLD `snapshot`
//! map) rather than the new one. In practice this only matters if a source
//! file is modified during the millisecond window of an `open_repo` /
//! `refresh_nodes` call, AND that file is in the new map but not the old.
//! Acceptable at hackathon scale — the next file edit re-fires correctly.
//! If this becomes an issue, switch to a recursive parent-dir watch with a
//! filter, removing the per-refresh re-registration entirely.

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::AppHandle;

pub struct SourceWatcher {
    /// The active notify watcher. Replaced on every `refresh()` call.
    /// `std::sync::Mutex` is correct here (no .await held across lock).
    inner: Mutex<Option<RecommendedWatcher>>,
    /// Canonicalized absolute file path → set of node UUIDs referencing it.
    /// A source file may back multiple nodes (e.g. a shared utility module).
    path_to_uuids: Mutex<HashMap<PathBuf, Vec<String>>>,
    /// Phase 8 Plan 08-02: node UUID → parent UUID chain.
    /// Rebuilt alongside path_to_uuids on every refresh() so the rollup cascade
    /// (L4→L3→L2→L1) can be walked without an extra DB query per event.
    uuid_to_parent: Mutex<HashMap<String, String>>,
}

impl SourceWatcher {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
            path_to_uuids: Mutex::new(HashMap::new()),
            uuid_to_parent: Mutex::new(HashMap::new()),
        }
    }

    /// Rebuild the watcher registration from:
    /// - `nodes`: Vec<(uuid, Vec<rel_file_path>)> — source-file coverage
    /// - `parent_map`: HashMap<uuid, parent_uuid> — Phase 8 ancestor walk
    ///
    /// Called from `open_repo` (Plan 07-02) and every `refresh_nodes` invocation
    /// so newly-derived nodes whose `code_ranges` point to new files are watched
    /// immediately (RESEARCH.md Pitfall 7).
    ///
    /// Phase 8 Plan 08-02: `parent_map` seeds `uuid_to_parent` so the FSEvents
    /// callback can walk L4→L3→L2→L1 without an extra DB query per tick.
    pub fn refresh(
        &self,
        app: AppHandle,
        repo_path: &Path,
        nodes: &[(String, Vec<String>)],
        parent_map: HashMap<String, String>,
    ) -> anyhow::Result<()> {
        // Build canonical absolute-path → uuids map.
        let mut map: HashMap<PathBuf, Vec<String>> = HashMap::new();
        for (uuid, files) in nodes {
            for rel in files {
                // Pitfall 9: filter out any path with a `.contracts` directory
                // component — a node's code_ranges accidentally pointing at its
                // own sidecar would cause double-trigger with the existing
                // sidecar watcher. Path-component check (not substring) so a
                // legitimate file like `src/.contracts.example/foo.ts` isn't
                // falsely rejected by a `.contracts` substring match.
                if Path::new(rel)
                    .components()
                    .any(|c| c.as_os_str() == ".contracts")
                {
                    continue;
                }
                let abs = repo_path.join(rel);
                // Pitfall 3: canonicalize so FSEvents-reported paths match.
                // macOS /tmp → /private/tmp canonicalization makes raw paths
                // differ from FSEvents-reported paths. Skip files that don't
                // exist yet (can't canonicalize a non-existent path on macOS).
                let canon = match std::fs::canonicalize(&abs) {
                    Ok(p) => p,
                    Err(_) => continue,
                };
                map.entry(canon).or_default().push(uuid.clone());
            }
        }
        // Deduplicate UUIDs per path (same UUID can appear if multiple ranges
        // in one node reference the same file).
        for v in map.values_mut() {
            v.sort();
            v.dedup();
        }

        // Snapshot of the map for the closure (must be 'static + Send).
        let snapshot = map.clone();
        // Phase 8 Plan 08-02: snapshot of uuid → parent for ancestor walk.
        let parent_snap = parent_map.clone();
        let app_cb = app.clone();

        let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
            let Ok(event) = res else { return };
            // Pitfall 4: accept Modify / Create / Remove — editors save
            // atomically (write temp + rename over target) which produces
            // Create + Remove events, not Modify. Filter out metadata/access-only
            // events (Access, Other) to reduce noise.
            match event.kind {
                EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_) => {}
                _ => return,
            }
            for path in &event.paths {
                // Pitfall 3 defence-in-depth: canonicalize the event path too.
                let key = std::fs::canonicalize(path).unwrap_or_else(|_| path.clone());
                if let Some(uuids) = snapshot.get(&key) {
                    for uuid in uuids {
                        // --- Phase 7: code-drift detection (UNTOUCHED) ---
                        let app2 = app_cb.clone();
                        let uuid2 = uuid.clone();
                        // Spawn per-UUID drift evaluation. Each invocation acquires
                        // its own per-UUID tokio::sync::Mutex in compute_and_emit,
                        // so 10 concurrent events for different UUIDs run in
                        // parallel — SC 2 "no lost drift flags" requirement is met
                        // by the serialization-per-UUID design, NOT by a global lock.
                        tauri::async_runtime::spawn(async move {
                            crate::drift::engine::compute_and_emit(app2, &uuid2).await;
                        });

                        // --- Phase 8 Plan 08-02: rollup detection cascade ---
                        // Spawn compute_rollup_and_emit for the changed UUID AND
                        // walk parent_uuid recursively up to L0. Each spawn acquires
                        // the DriftLocks mutex for its own UUID independently so
                        // spawns for different UUIDs run concurrently.
                        let mut rollup_uuid = uuid.clone();
                        loop {
                            let app3 = app_cb.clone();
                            let ru = rollup_uuid.clone();
                            tauri::async_runtime::spawn(async move {
                                if let Err(e) = crate::drift::engine::compute_rollup_and_emit(
                                    &app3, &ru,
                                )
                                .await
                                {
                                    eprintln!("[rollup] watcher: {ru}: {e}");
                                }
                            });

                            // Climb to parent — stop when no parent in snapshot.
                            match parent_snap.get(&rollup_uuid) {
                                Some(parent) => rollup_uuid = parent.clone(),
                                None => break,
                            }
                        }
                    }
                }
            }
        })?;

        // NonRecursive: watching individual files, not directories. Parent-dir
        // recursive watch is an Open Question 2 escalation for > 1000 files;
        // at hackathon scale (< 200) individual-file watches are cheap.
        // Swallow per-path errors (some files may vanish between canonicalize
        // and watch) — an Err on one file must not abort the whole refresh.
        for path in map.keys() {
            let _ = watcher.watch(path, RecursiveMode::NonRecursive);
        }

        *self.inner.lock().expect("SourceWatcher.inner poisoned") = Some(watcher);
        *self.path_to_uuids.lock().expect("SourceWatcher.path_to_uuids poisoned") = map;
        *self.uuid_to_parent.lock().expect("SourceWatcher.uuid_to_parent poisoned") = parent_map;
        Ok(())
    }
}

impl Default for SourceWatcher {
    fn default() -> Self {
        Self::new()
    }
}
