// apply_cherrypick — atomic two-file write IPC for the cherrypick flow (CHRY-03).
//
// Write order (Pitfall 6 from 08-RESEARCH.md):
//   Phase 1 — write ALL temp files (no renames yet)
//   Phase 2 — rename source temps FIRST (files in order)
//   Phase 3 — rename sidecar LAST
//
// A partial failure in Phase 2 leaves at least one source file updated with the
// sidecar still pointing at the old contract_hash. Phase 7's SourceWatcher will
// fire on the next FSEvents tick → user sees red drift pulse. Observable, never
// silent (Pitfall 6 closed).
//
// DriftLocks integration: acquires the same per-UUID tokio::sync::Mutex used by
// Phase 7 watcher (compute_and_emit) and 08-02 rollup engine (compute_rollup_and_emit).
// All three serialize on the same UUID → no race on code_hash / contract_hash.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::Manager;

/// A single file patch — one source file to be written as part of a cherrypick.
/// Frontend sends `{ file, newContent }`; serde rename_all gives us snake_case
/// in Rust without breaking the IPC payload shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePatch {
    /// Path relative to the repo root.
    pub file: String,
    /// New content to write to the file.
    pub new_content: String,
}

/// Resolve and validate that `file` (relative to `repo`) stays inside the repo.
/// Returns the absolute `PathBuf` on success, or an error if the path escapes.
fn resolve_safe(repo: &Path, file: &str) -> Result<PathBuf, String> {
    // Canonicalize the repo root first.
    let canon_repo = std::fs::canonicalize(repo)
        .map_err(|e| format!("cannot canonicalize repo root: {e}"))?;

    // Join the relative file path to the repo root and normalize without
    // resolving symlinks on the full path (the file may not exist yet).
    let joined = canon_repo.join(file);

    // Normalize by resolving `..` and `.` components lexically (not via
    // filesystem) using a manual stack walk. This handles paths like
    // `../../etc/passwd` even when the intermediate dirs don't exist.
    let mut components = Vec::new();
    for component in joined.components() {
        match component {
            std::path::Component::ParentDir => {
                // If we can't pop (already at root), the path escapes.
                if components.is_empty() {
                    return Err(format!("path escapes repo: {file}"));
                }
                components.pop();
            }
            std::path::Component::CurDir => {
                // Skip `.` components.
            }
            c => components.push(c),
        }
    }

    let normalized: PathBuf = components.iter().collect();

    // Containment guard — same pattern as `read_file_content` (Plan 04-01).
    if !normalized.starts_with(&canon_repo) {
        return Err(format!("path escapes repo: {file}"));
    }

    // Now try to canonicalize the parent directory (which should exist) to
    // resolve any symlinks, then reattach the filename.
    let parent = normalized
        .parent()
        .ok_or_else(|| format!("path has no parent: {file}"))?;

    // If the parent doesn't exist yet, that's OK — the patch will create it.
    // We already confirmed the path is inside the repo via the containment guard.
    let resolved = if parent.exists() {
        let canon_parent = std::fs::canonicalize(parent)
            .map_err(|e| format!("cannot canonicalize parent of {file}: {e}"))?;
        let filename = normalized
            .file_name()
            .ok_or_else(|| format!("path has no filename: {file}"))?;
        canon_parent.join(filename)
    } else {
        normalized.clone()
    };

    // Final containment check after symlink resolution.
    if !resolved.starts_with(&canon_repo) {
        return Err(format!("path escapes repo: {file}"));
    }

    Ok(resolved)
}

/// Quick line-scan for `human_pinned: true` inside the frontmatter fence.
/// Defaults to false if the field is absent or the file isn't a sidecar.
/// Mirrors the helper in `reconcile.rs` — kept local to avoid cross-module
/// dependency for a 12-line scan.
fn is_human_pinned(raw: &str) -> bool {
    let mut in_front = false;
    for line in raw.lines() {
        if !in_front {
            if line.trim() == "---" {
                in_front = true;
            }
            continue;
        }
        if line.trim() == "---" {
            break;
        }
        if let Some(rest) = line.strip_prefix("human_pinned:") {
            return matches!(rest.trim(), "true");
        }
    }
    false
}

/// Compute a SHA-256 hex digest of `text` (same logic as `hash_text` in inspector.rs,
/// duplicated here to avoid importing from sibling commands module which would
/// create a circular-dependency risk at the module level).
fn hash_text_inner(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hex::encode(hasher.finalize())
}

/// Internal testable core — accepts a concrete `repo: &Path` instead of
/// `AppHandle` so unit tests can exercise it without a running Tauri app.
///
/// `fail_after_n_source_renames`: if `Some(n)`, simulates a failure AFTER the
/// nth source-file rename (used by the mid-rename-failure unit test).
pub fn apply_cherrypick_inner(
    repo: &Path,
    uuid: &str,
    contract_body: &str,
    file_patches: &[FilePatch],
    fail_after_n_source_renames: Option<usize>,
) -> Result<(), String> {
    // ---- Phase 0: defense-in-depth pin re-check ----
    // The UI gates cherrypick approval on pin state, but a concurrent pin-toggle
    // from another session could race. A pinned contract must NOT be auto-overwritten
    // by an agent suggestion — the user pinned it for a reason. The watcher will
    // surface red drift on the source-only path; user can unpin and retry.
    let sidecar_path = repo.join(".contracts").join(format!("{uuid}.md"));
    if sidecar_path.exists() {
        if let Ok(existing) = std::fs::read_to_string(&sidecar_path) {
            if is_human_pinned(&existing) {
                return Err(format!(
                    "SKIPPED-PINNED: cannot apply cherrypick to pinned contract {uuid}"
                ));
            }
        }
    }

    // ---- Phase 1: validate paths and write all temp files (NO renames yet) ----

    // Build (resolved_path, tmp_path) pairs for source files.
    let mut source_pairs: Vec<(PathBuf, PathBuf)> = Vec::new();
    for patch in file_patches {
        let resolved = resolve_safe(repo, &patch.file)?;
        let tmp = resolved.with_extension(format!(
            "{}.cherrypick.tmp",
            resolved
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("file")
        ));
        // Ensure the parent directory exists (source file may be in a subdir).
        if let Some(p) = resolved.parent() {
            std::fs::create_dir_all(p).map_err(|e| format!("mkdir {:?}: {e}", p))?;
        }
        std::fs::write(&tmp, &patch.new_content)
            .map_err(|e| format!("write temp {:?}: {e}", tmp))?;
        source_pairs.push((resolved, tmp));
    }

    // Sidecar temp.
    let contracts_dir = repo.join(".contracts");
    std::fs::create_dir_all(&contracts_dir)
        .map_err(|e| format!("mkdir .contracts: {e}"))?;

    // Build the new sidecar content.
    // Read the existing sidecar to preserve frontmatter fields (e.g. neighbors,
    // derived_at, code_ranges) — same merge-read pattern as Plan 04-02.
    // sidecar_path was already computed in Phase 0 for the pin check.
    let sidecar_tmp = contracts_dir.join(format!("{uuid}.md.cherrypick.tmp"));

    let new_sidecar_content = if sidecar_path.exists() {
        let existing = std::fs::read_to_string(&sidecar_path)
            .map_err(|e| format!("read existing sidecar: {e}"))?;
        // Parse existing frontmatter, update contract_hash, rewrite body.
        match crate::sidecar::frontmatter::parse_sidecar(&existing) {
            Ok((mut fm, _old_body)) => {
                fm.contract_hash = Some(hash_text_inner(contract_body));
                crate::sidecar::frontmatter::write_sidecar(&fm, contract_body)
                    .map_err(|e| format!("write_sidecar: {e}"))?
            }
            Err(_) => {
                // Sidecar is corrupted or missing — construct minimal content.
                format!(
                    "---\nuuid: {uuid}\nformat_version: 2\nkind: API\nlevel: L4\ncontract_hash: {}\n---\n\n{}",
                    hash_text_inner(contract_body),
                    contract_body
                )
            }
        }
    } else {
        // No existing sidecar — create a minimal one.
        format!(
            "---\nuuid: {uuid}\nformat_version: 2\nkind: API\nlevel: L4\ncontract_hash: {}\n---\n\n{}",
            hash_text_inner(contract_body),
            contract_body
        )
    };

    std::fs::write(&sidecar_tmp, &new_sidecar_content)
        .map_err(|e| format!("write sidecar temp: {e}"))?;

    // ---- Phase 2: rename source temps FIRST ----
    // Pitfall 6: if a rename fails here, at least one source may be updated
    // but the sidecar still points at the old contract_hash. The Phase 7
    // SourceWatcher fires on the next FSEvents tick → red drift pulse. Observable.
    for (rename_count, (resolved, tmp)) in source_pairs.iter().enumerate() {
        // Simulate mid-rename failure for testing.
        if let Some(fail_at) = fail_after_n_source_renames {
            if rename_count >= fail_at {
                // Clean up unused source temps (already-renamed ones are permanent).
                // Leave the sidecar tmp — sidecar is NOT updated.
                let _ = std::fs::remove_file(tmp); // best-effort cleanup of remaining temps
                // Clean up sidecar tmp (it was never renamed).
                let _ = std::fs::remove_file(&sidecar_tmp);
                return Err(format!(
                    "partial-cherrypick: simulated rename failure after {fail_at} source renames"
                ));
            }
        }
        std::fs::rename(tmp, resolved).map_err(|e| {
            // DO NOT roll back already-renamed source files — leave drift observable.
            // Clean up remaining temp files best-effort.
            let _ = std::fs::remove_file(&sidecar_tmp);
            format!(
                "partial-cherrypick: source file {} rename failed: {e}",
                resolved.display()
            )
        })?;
    }

    // ---- Phase 3: rename sidecar LAST ----
    // If this fails, all source files are updated but sidecar keeps old contract_hash.
    // Phase 7 watcher fires on the mtime change → drift observable.
    std::fs::rename(&sidecar_tmp, &sidecar_path)
        .map_err(|e| format!("sidecar rename failed: {e}"))?;

    Ok(())
}

/// Tauri IPC command — atomic two-file write for the cherrypick approve action (CHRY-03).
///
/// Acquires the same `DriftLocks` per-UUID Tokio mutex used by Phase 7's
/// `compute_and_emit` and 08-02's `compute_rollup_and_emit`, so the watcher and
/// rollup engine wait while the cherrypick is in progress.
///
/// Frontend passes `{ uuid, contractBody, filePatches }`. Tauri does NOT
/// auto-convert camelCase invoke args to snake_case Rust params by default —
/// `#[tauri::command(rename_all = "camelCase")]` is required for that mapping.
#[tauri::command(rename_all = "camelCase")]
pub async fn apply_cherrypick(
    app: tauri::AppHandle,
    uuid: String,
    contract_body: String,
    file_patches: Vec<FilePatch>,
) -> Result<(), String> {
    // Acquire per-UUID DriftLocks serialization guard FIRST (before any disk I/O).
    // We must bind `for_uuid()`'s return value to a local `arc` so its lifetime
    // extends to the end of the function — if we chain `.lock().await` on the
    // temporary returned by `for_uuid(...)`, the Arc is dropped before the guard
    // is used at function exit (E0716 borrow error).
    let locks = app.state::<crate::drift::state::DriftLocks>();
    let arc = locks.for_uuid(&uuid);
    let _guard = arc.lock().await;

    // Fetch the repo root BEFORE any .await (std::sync::MutexGuard must not be
    // held across .await points — clippy -D warnings). Scope the guard drop.
    let repo_path: PathBuf = {
        let repo_state = app.state::<crate::commands::repo::RepoState>();
        let guard = repo_state
            .0
            .lock()
            .map_err(|e| format!("RepoState lock poisoned: {e}"))?;
        guard
            .clone()
            .ok_or("no repository open — call open_repo first")?
    };

    // Delegate all I/O to the inner testable helper.
    apply_cherrypick_inner(&repo_path, &uuid, &contract_body, &file_patches, None)
}
