//! Phase 8 Plan 08-06: Pin-aware reconcile IPC commands (PROP-04).
//!
//! ## Three commands
//!
//! - `accept_rollup_as_is` — NARROW writer: updates ONLY the three rollup_*
//!   YAML lines via in-place text replacement. NEVER calls serde_yaml_ng for the
//!   full body (Pitfall: YAML round-trip not byte-preserving — engineering red
//!   team flag). Enforces `rollup_generation` optimistic lock; returns the new
//!   generation on success, or Err with the current generation on mismatch so
//!   the frontend can re-read and retry.
//!
//! - `draft_propagation_diff` — READ-ONLY. Collects upstream body + cited child
//!   section texts + recent journal entries. Returns the bundle so the frontend
//!   (DraftPropagationDiff.tsx) can assemble a clipboard-copy prompt.
//!
//! - `read_children_section_diffs` — READ-ONLY. Returns current cited child
//!   section texts for the PINNED-amber path (ChildrenChangesView.tsx).
//!   v1 limitation: no historical section snapshots — shows current state + a
//!   "drifted since last rollup" flag based on hash mismatch.
//!
//! ## YAML in-place editing safety guarantees
//!
//! The regex `^(\s*)rollup_(hash|state|generation):\s*.*$` (multiline) is safe
//! because:
//!   1. YAML keys at the document root cannot contain `\n`.
//!   2. The sidecar's frontmatter section is bounded by the leading `---` and
//!      closing `\n---\n` (Phase 2 invariant).
//!   3. The body section starts AFTER the closing fence and cannot contain a
//!      top-level `rollup_*` line at column 0 since it's a Markdown body.
//!
//! NOTE: `tauri::generate_handler!` resolves commands via `__cmd__<name>` shim
//! emitted ALONGSIDE each `#[tauri::command]` fn. Always register via fully-
//! qualified `commands::reconcile::accept_rollup_as_is` etc. (STATE.md decision).

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_sql::DbInstances;

use crate::commands::journal::JournalEntry;
use crate::sidecar::frontmatter::{read_sidecar_file, RollupInput};

// ─── Public return types ────────────────────────────────────────────────────

/// A cited child section from a rollup input.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChildSection {
    pub child_uuid: String,
    pub section_name: String,
    pub section_text: String,
}

/// Full context bundle returned by `draft_propagation_diff`.
/// The frontend (DraftPropagationDiff.tsx) assembles this into a clipboard-
/// copy prompt for the user's Claude Code session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraftPropagationContext {
    pub current_body: String,
    pub cited_child_sections: Vec<ChildSection>,
    pub recent_journal_entries: Vec<JournalEntry>,
    pub expected_generation: u64,
}

/// One drifted child section returned by `read_children_section_diffs`.
///
/// v1 limitation: `section_text_at_last_generation` is always `None` because
/// we do not persist per-generation body snapshots in v1. The `drifted` flag
/// is derived from whether the section_hash in the parent's stored rollup_inputs
/// matches what we recompute from the child's current body.
///
/// v2 carry-over: persist a copy of cited child section_hashes per upstream
/// generation in a new SQLite table `upstream_generation_snapshots`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChildSectionDiff {
    pub child_uuid: String,
    pub section_name: String,
    pub section_text_at_last_generation: Option<String>,
    pub section_text_now: String,
    /// SHA-256 hex of `section_text_now` (same algo as section-parser-cli).
    pub section_hash_now: String,
    /// True when `section_hash_now` differs from the hash stored in the
    /// parent's `rollup_inputs` at the last committed rollup generation.
    pub drifted: bool,
}

// ─── Path helpers ────────────────────────────────────────────────────────────

fn repo_from_app(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let state = app.state::<crate::commands::repo::RepoState>();
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    guard.clone().ok_or_else(|| "no repo open".to_string())
}

// ─── In-place YAML edit helper ───────────────────────────────────────────────

/// Perform in-place replacement of the three rollup_* lines in a raw sidecar
/// string. Only touches lines that match — L0 sidecars (no rollup fields) are
/// returned byte-equal.
///
/// Replaces:
///   `rollup_hash: "<old>"`  → `rollup_hash: "<new_hash>"`
///   `rollup_generation: N`  → `rollup_generation: <new_generation>`
///   `rollup_state: "<old>"` → `rollup_state: "fresh"`
///
/// Uses multiline regex so the replacement is anchored at line boundaries.
/// Returns the modified string (or the original if no matches).
pub fn apply_rollup_inplace(
    raw: &str,
    new_hash: &str,
    new_generation: u64,
) -> Result<String, String> {
    // Compile once per call (acceptable at the per-file edit cadence).
    let re_hash = Regex::new(r"(?m)^(rollup_hash:\s*).*$")
        .map_err(|e| format!("re_hash compile: {e}"))?;
    let re_gen = Regex::new(r"(?m)^(rollup_generation:\s*).*$")
        .map_err(|e| format!("re_gen compile: {e}"))?;
    let re_state = Regex::new(r"(?m)^(rollup_state:\s*).*$")
        .map_err(|e| format!("re_state compile: {e}"))?;

    // Each replacement returns a Cow<str>; chain them.
    let s = re_hash
        .replace_all(raw, format!("rollup_hash: \"{}\"", new_hash).as_str())
        .to_string();
    let s = re_gen
        .replace_all(&s, format!("rollup_generation: {}", new_generation).as_str())
        .to_string();
    let s = re_state
        .replace_all(&s, "rollup_state: \"fresh\"")
        .to_string();

    Ok(s)
}

// ─── accept_rollup_as_is ─────────────────────────────────────────────────────

/// Accept the current rollup state as-is for a node.
///
/// NARROW writer — updates ONLY the three rollup_* YAML lines via in-place
/// text replacement. NEVER round-trips the body through serde_yaml_ng
/// (YAML round-trip is not byte-preserving — engineering red team flag closed).
///
/// - Acquires `DriftLocks::for_uuid(uuid)` before any I/O (serializes with the
///   watcher, rollup engine, and cherrypick writer).
/// - Enforces `rollup_generation` optimistic lock: if the sidecar's current
///   generation differs from `expected_generation`, returns `Err` with the
///   current generation so the frontend can re-read and retry (no silent
///   last-writer-wins, Pitfall 5).
/// - Writes a journal entry when `justification` is `Some` (L1 requires it;
///   L2/L3 optional). The entry uses `entry_type: "accept_rollup_as_is"`.
/// - Updates SQLite `nodes` and `rollup_derived` after file write.
/// - Emits `rollup:changed { uuid, state: "fresh", generation: N }`.
///
/// Returns the new `rollup_generation` on success.
#[tauri::command(rename_all = "camelCase")]
pub async fn accept_rollup_as_is(
    app: tauri::AppHandle,
    uuid: String,
    expected_generation: u64,
    justification: Option<String>,
    keep_pin: bool,
) -> Result<u64, String> {
    let repo = repo_from_app(&app)?;

    // Acquire per-UUID mutex — serializes with watcher, rollup engine, cherrypick.
    let locks = app.state::<crate::drift::state::DriftLocks>();
    let arc = locks.for_uuid(&uuid);
    let _guard = arc.lock().await;

    // Read raw sidecar bytes — NOT via parse_sidecar / serde_yaml_ng.
    let sidecar_path = repo.join(".contracts").join(format!("{uuid}.md"));
    let raw = std::fs::read_to_string(&sidecar_path)
        .map_err(|e| format!("read sidecar {uuid}: {e}"))?;

    // Defense-in-depth pin re-check under DriftLocks. The UI branches first
    // (PinnedAmberActions vs UnpinnedAmberActions), but a concurrent pin-toggle
    // from another session could race: the writer is the last line of defense.
    if extract_human_pinned(&raw) {
        return Err(format!(
            "SKIPPED-PINNED: cannot accept rollup as-is on pinned contract {uuid}"
        ));
    }

    // Extract current rollup_generation via line scan (no YAML parse needed).
    let current_generation = extract_rollup_generation(&raw)?;
    if current_generation != expected_generation {
        return Err(format!(
            "rollup_generation mismatch: expected {expected_generation}, \
             found {current_generation} — refresh and retry"
        ));
    }

    let new_generation = expected_generation + 1;

    // Get the latest computed hash from rollup_derived.
    let new_hash = get_computed_rollup_hash(&app, &uuid).await?;

    // In-place edit — ONLY touches the three rollup_* lines.
    let modified = apply_rollup_inplace(&raw, &new_hash, new_generation)?;

    // Write via temp + rename (atomic write pattern, same as Phase 2).
    let tmp_path = repo
        .join(".contracts")
        .join(format!("{uuid}.md.accept.tmp"));
    std::fs::write(&tmp_path, &modified)
        .map_err(|e| format!("write temp sidecar: {e}"))?;
    std::fs::rename(&tmp_path, &sidecar_path)
        .map_err(|e| format!("rename sidecar: {e}"))?;

    // Persist journal entry when justification provided (or always for keep_pin path).
    if let Some(ref j) = justification {
        let _ = write_accept_journal_entry(&repo, &uuid, j, keep_pin);
    }

    // Update SQLite — both nodes and rollup_derived.
    update_sqlite_after_accept(&app, &uuid, &new_hash, new_generation).await?;

    // Emit event so React store updates without a full re-seed.
    let _ = app.emit(
        "rollup:changed",
        serde_json::json!({
            "uuid": uuid,
            "state": "fresh",
            "generation": new_generation,
        }),
    );

    let _ = keep_pin; // keep_pin does not toggle human_pinned — that's a separate flow.

    Ok(new_generation)
}

/// Extract `rollup_generation` from the frontmatter section of a raw sidecar
/// string via line scan. Returns 0 if the field is absent (L0 sidecars).
///
/// Exposed as a test helper for reconcile_pin_tests.rs to validate the
/// generation-mismatch logic without a full Tauri AppHandle.
#[cfg_attr(test, allow(dead_code))]
pub fn extract_rollup_generation_test(raw: &str) -> Result<u64, String> {
    extract_rollup_generation(raw)
}

/// Extract `human_pinned` from the frontmatter via line scan. Defaults to false
/// if absent. Used as a defense-in-depth guard inside DriftLocks-protected
/// writers — keeps the no-YAML-roundtrip invariant intact.
#[cfg_attr(test, allow(dead_code))]
pub fn extract_human_pinned_test(raw: &str) -> bool {
    extract_human_pinned(raw)
}

fn extract_human_pinned(raw: &str) -> bool {
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

fn extract_rollup_generation(raw: &str) -> Result<u64, String> {
    // Walk lines inside the frontmatter only (between first --- and closing \n---).
    let mut in_front = false;
    for line in raw.lines() {
        if !in_front {
            if line.trim() == "---" {
                in_front = true;
            }
            continue;
        }
        if line.trim() == "---" {
            break; // closing fence
        }
        if let Some(rest) = line.strip_prefix("rollup_generation:") {
            let val = rest.trim().parse::<u64>().map_err(|e| {
                format!("invalid rollup_generation value '{}': {e}", rest.trim())
            })?;
            return Ok(val);
        }
    }
    // L0 or untracked — treat as generation 0 (no mismatch possible).
    Ok(0)
}

/// Query `rollup_derived.computed_rollup_hash` for a UUID.
/// Falls back to the `nodes.rollup_hash` column if `rollup_derived` has no row.
async fn get_computed_rollup_hash(
    app: &tauri::AppHandle,
    uuid: &str,
) -> Result<String, String> {
    let instances = app.state::<DbInstances>();
    let map = instances.0.read().await;
    let Some(db) = map.get("sqlite:contract-ide.db") else {
        return Err("sqlite db not loaded".into());
    };
    let pool = match db {
        tauri_plugin_sql::DbPool::Sqlite(p) => p,
        #[allow(unreachable_patterns)]
        _ => return Err("non-sqlite DbPool variant".into()),
    };

    // Try rollup_derived first (has the most recent computed hash).
    let row: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT computed_rollup_hash FROM rollup_derived WHERE node_uuid = ?",
    )
    .bind(uuid)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    if let Some((Some(h),)) = row {
        return Ok(h);
    }

    // Fallback: nodes.rollup_hash (set during a real reconcile commit).
    let row2: Option<(Option<String>,)> =
        sqlx::query_as("SELECT rollup_hash FROM nodes WHERE uuid = ?")
            .bind(uuid)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;

    if let Some((Some(h),)) = row2 {
        return Ok(h);
    }

    // No stored hash at all — use a deterministic sentinel so accept still works.
    Ok("0000000000000000000000000000000000000000000000000000000000000000".to_string())
}

/// Write a journal entry for `accept_rollup_as_is` to the .contracts/journal/ dir.
fn write_accept_journal_entry(
    repo: &std::path::Path,
    uuid: &str,
    justification: &str,
    keep_pin: bool,
) -> anyhow::Result<()> {
    let journal_dir = repo.join(".contracts").join("journal");
    std::fs::create_dir_all(&journal_dir)?;

    let ts = chrono::Utc::now().to_rfc3339();
    let session_id = format!(
        "ide-direct-{}",
        chrono::Utc::now().timestamp_millis()
    );

    let entry = serde_json::json!({
        "schema_version": 1,
        "ts": ts,
        "session_id": session_id,
        "tool": "accept_rollup_as_is",
        "file": format!(".contracts/{uuid}.md"),
        "affected_uuids": [uuid],
        "intent": justification,
        "entry_type": "accept_rollup_as_is",
        "keep_pin": keep_pin,
        "justification": justification,
    });

    let journal_path = journal_dir.join(format!("{session_id}.jsonl"));
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&journal_path)?;
    use std::io::Write;
    writeln!(file, "{}", serde_json::to_string(&entry)?)?;
    Ok(())
}

/// Update `nodes` and `rollup_derived` after a successful accept_rollup_as_is.
async fn update_sqlite_after_accept(
    app: &tauri::AppHandle,
    uuid: &str,
    new_hash: &str,
    new_generation: u64,
) -> Result<(), String> {
    let instances = app.state::<DbInstances>();
    let map = instances.0.read().await;
    let Some(db) = map.get("sqlite:contract-ide.db") else {
        return Err("sqlite db not loaded".into());
    };
    let pool = match db {
        tauri_plugin_sql::DbPool::Sqlite(p) => p,
        #[allow(unreachable_patterns)]
        _ => return Err("non-sqlite DbPool variant".into()),
    };

    sqlx::query(
        "UPDATE nodes SET rollup_hash = ?, rollup_generation = ?, rollup_state = 'fresh' \
         WHERE uuid = ?",
    )
    .bind(new_hash)
    .bind(new_generation as i64)
    .bind(uuid)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "UPDATE rollup_derived SET state = 'fresh', computed_rollup_hash = ? \
         WHERE node_uuid = ?",
    )
    .bind(new_hash)
    .bind(uuid)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

// ─── draft_propagation_diff ───────────────────────────────────────────────────

/// Return the upstream body + cited child section texts + recent journal entries
/// for the UNPINNED-amber "Draft propagation for review" path.
///
/// READ-ONLY — no writes. The frontend assembles this into a clipboard-copy
/// prompt (DraftPropagationDiff.tsx). v1 ships clipboard-copy only per
/// CONTEXT.md "correct not polished"; Phase 9+ may dispatch via run_agent.
#[tauri::command(rename_all = "camelCase")]
pub async fn draft_propagation_diff(
    app: tauri::AppHandle,
    upstream_uuid: String,
) -> Result<DraftPropagationContext, String> {
    let repo = repo_from_app(&app)?;

    // Parse the upstream sidecar to get the body + rollup_inputs + generation.
    let (fm, body) = read_sidecar_file(&repo, &upstream_uuid)
        .map_err(|e| format!("read upstream sidecar: {e}"))?;

    let expected_generation = fm.rollup_generation.unwrap_or(0);

    // Collect cited child section texts.
    let cited_child_sections =
        collect_cited_sections(&repo, &fm.rollup_inputs)?;

    // Fetch recent journal entries that affected this upstream or any cited child.
    let mut related_uuids: Vec<String> = vec![upstream_uuid.clone()];
    for ri in &fm.rollup_inputs {
        related_uuids.push(ri.child_uuid.clone());
    }

    // list_journal_entries filters by a single UUID — run one call per related
    // UUID and merge (capped at 10 entries total, most-recent wins).
    let mut journal_entries: Vec<JournalEntry> = Vec::new();
    for rel_uuid in &related_uuids {
        // Call the journal module's public fn directly (same binary, no IPC hop).
        if let Ok(entries) = crate::commands::journal::list_journal_entries_raw(
            &app,
            Some(rel_uuid.clone()),
            None,
            Some(5),
        )
        .await
        {
            journal_entries.extend(entries);
        }
    }
    // Sort descending by ts, deduplicate by ts+session_id, cap at 10.
    journal_entries.sort_by(|a, b| b.ts.cmp(&a.ts));
    journal_entries.dedup_by(|a, b| a.ts == b.ts && a.session_id == b.session_id);
    journal_entries.truncate(10);

    Ok(DraftPropagationContext {
        current_body: body,
        cited_child_sections,
        recent_journal_entries: journal_entries,
        expected_generation,
    })
}

// ─── read_children_section_diffs ─────────────────────────────────────────────

/// Return current cited child section texts + drift flag for the PINNED-amber
/// "Review children's changes" path.
///
/// READ-ONLY. v1 limitation: `section_text_at_last_generation` is always `None`
/// because we don't store per-generation body snapshots. The `drifted` flag is
/// derived from hash mismatch between the section's current hash and whatever
/// the parent's rollup_inputs stored at the last committed generation.
///
/// v2 carry-over: add `upstream_generation_snapshots` table that persists cited
/// child section_hashes per upstream generation so exact diffs can be shown.
#[tauri::command(rename_all = "camelCase")]
pub async fn read_children_section_diffs(
    app: tauri::AppHandle,
    upstream_uuid: String,
) -> Result<Vec<ChildSectionDiff>, String> {
    let repo = repo_from_app(&app)?;

    let (fm, _body) = read_sidecar_file(&repo, &upstream_uuid)
        .map_err(|e| format!("read upstream sidecar: {e}"))?;

    let mut diffs: Vec<ChildSectionDiff> = Vec::new();

    for ri in &fm.rollup_inputs {
        let child_result = read_sidecar_file(&repo, &ri.child_uuid);
        let child_fm_opt = child_result.as_ref().ok().map(|(f, _)| f.clone());
        let child_body = child_result.map(|(_, b)| b).unwrap_or_default();

        for section_name in &ri.sections {
            let section_text_now =
                extract_section_from_body(&child_body, section_name);
            let section_hash_now = sha256_hex(&section_text_now);

            // Check if the stored rollup_inputs have a section hash we can compare.
            // If the child's section_hashes map has this section, compare it.
            let drifted = if let Some(ref child_fm) = child_fm_opt {
                // Compare child's stored section_hash against what we just computed.
                // If they differ, the section text changed after the last rollup commit.
                child_fm
                    .section_hashes
                    .get(&section_name.to_lowercase())
                    .map(|stored| stored != &section_hash_now)
                    .unwrap_or(false)
            } else {
                false
            };

            diffs.push(ChildSectionDiff {
                child_uuid: ri.child_uuid.clone(),
                section_name: section_name.clone(),
                // v1 limitation — no historical snapshot. v2 carry-over documented.
                section_text_at_last_generation: None,
                section_text_now,
                section_hash_now,
                drifted,
            });
        }
    }

    Ok(diffs)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Collect the cited child sections for all rollup_inputs of a parent contract.
/// Reads each child sidecar and extracts the named H2 sections.
fn collect_cited_sections(
    repo: &std::path::Path,
    rollup_inputs: &[RollupInput],
) -> Result<Vec<ChildSection>, String> {
    let mut out = Vec::new();
    for ri in rollup_inputs {
        let child_body = match read_sidecar_file(repo, &ri.child_uuid) {
            Ok((_, b)) => b,
            Err(e) => {
                eprintln!(
                    "[draft_propagation_diff] cannot read child {}: {e}",
                    ri.child_uuid
                );
                continue;
            }
        };
        for section_name in &ri.sections {
            let text = extract_section_from_body(&child_body, section_name);
            out.push(ChildSection {
                child_uuid: ri.child_uuid.clone(),
                section_name: section_name.clone(),
                section_text: text,
            });
        }
    }
    Ok(out)
}

/// Extract the text of a named H2 section from a Markdown body.
/// Returns the text between `## <name>` and the next `## ` heading (or EOF).
/// Case-insensitive section name match.
fn extract_section_from_body(body: &str, section_name: &str) -> String {
    let needle = section_name.to_lowercase();
    let mut in_section = false;
    let mut lines: Vec<&str> = Vec::new();

    for line in body.lines() {
        if let Some(rest) = line.strip_prefix("## ") {
            let heading = rest.trim().to_lowercase();
            if heading == needle {
                in_section = true;
                continue;
            } else if in_section {
                break; // next H2 heading — section is done
            }
        }
        if in_section {
            lines.push(line);
        }
    }

    lines.join("\n").trim().to_string()
}

/// Compute SHA-256 hex of a string (same algorithm as section-parser-cli).
fn sha256_hex(s: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    hex::encode(h.finalize())
}

