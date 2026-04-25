//! Fact-level supersession engine — Graphiti port of resolve_edge_contradictions.
//! Called synchronously by Phase 11's distiller (and by 12-02's
//! ingest_substrate_node_with_invalidation Tauri command for direct ingestion paths)
//! AFTER each substrate_nodes upsert.
//!
//! See 12-RESEARCH.md Pattern 2.
//!
//! # Lock ordering
//! For a given (new, stale) pair, this engine acquires `new_uuid` first then
//! `stale_uuid` second. Across multiple stale candidates within one
//! invalidate_contradicted run, the `new_uuid` lock is held for the entire
//! call; each `stale_uuid` lock is acquired and released in turn. The
//! intent_engine (12-03) holds locks one-at-a-time, so there is no
//! cross-engine ordering conflict on the per-UUID DriftLocks map.

use crate::drift::state::DriftLocks;
use crate::supersession::candidate_selection::find_overlapping;
use crate::supersession::prompt::build_invalidation_prompt;
use crate::supersession::queries::{
    read_substrate_node, write_supersedes_edge, write_supersession,
};
use crate::supersession::verdict::parse_invalidation_response;
use chrono::Utc;
use sqlx::SqlitePool;
use tauri::{Emitter, Manager};
use tauri_plugin_shell::ShellExt;

/// For a newly-ingested substrate node, find contradicting current-truth
/// candidates via FTS5 + LLM judge, and invalidate them.
/// Returns the list of invalidated stale node UUIDs.
///
/// Called by Phase 11 distiller (synchronous, post-INSERT) and by
/// `ingest_substrate_node_with_invalidation` Tauri command.
pub async fn invalidate_contradicted(
    app: &tauri::AppHandle,
    pool: &SqlitePool,
    new_uuid: &str,
) -> Result<Vec<String>, String> {
    // 1. Acquire lock for the new node.
    let locks = app.state::<DriftLocks>();
    let new_guard = locks.for_uuid(new_uuid);
    let _new_lock = new_guard.lock().await;

    // 2. Read the new substrate node. Short-circuit if it's already invalidated
    //    (race-safe idempotency: a second call sees invalid_at IS NOT NULL).
    let new = read_substrate_node(pool, new_uuid).await?;
    if new.invalid_at.is_some() {
        return Ok(vec![]);
    }

    // 3. Candidate selection — top-K=10, scope-overlap, current-truth-only.
    let candidates = find_overlapping(
        pool,
        &new.node_type,
        new.scope.as_deref(),
        &new.text,
        new.applies_when.as_deref(),
        &new.uuid,
        10,
    )
    .await?;
    if candidates.is_empty() {
        return Ok(vec![]);
    }

    // 4. Build invalidation prompt and run claude -p.
    let prompt_text = build_invalidation_prompt(&new, &candidates);
    let raw = run_claude_judge(app, &prompt_text).await?;
    let contradicted_idxs = parse_invalidation_response(&raw)?;
    if contradicted_idxs.is_empty() {
        return Ok(vec![]);
    }

    // 5. For each contradicted candidate, lock + write.
    //    Lock-ordering rule (preserves Phase 7 invariant): we already hold
    //    new_uuid; acquire each stale_uuid one at a time. Because no other
    //    fact-engine call can hold (stale_uuid, new_uuid) in that order
    //    simultaneously (each call holds new_uuid first), and intent_engine
    //    (12-03) holds at most one lock at a time, no deadlock cycle exists.
    let now_iso = Utc::now().to_rfc3339();
    let mut invalidated = vec![];
    for idx in &contradicted_idxs {
        let stale = match candidates.get(*idx) {
            Some(c) => c,
            None => {
                eprintln!("[supersession] LLM returned out-of-bounds idx {idx}");
                continue;
            }
        };
        // Already-invalidated guard (race-safe).
        if stale.invalid_at.is_some() {
            continue;
        }
        let stale_guard = locks.for_uuid(&stale.uuid);
        let _stale_lock = stale_guard.lock().await;

        write_supersession(pool, &stale.uuid, &new.valid_at, &now_iso, new_uuid).await?;
        write_supersedes_edge(pool, new_uuid, &stale.uuid).await?;

        invalidated.push(stale.uuid.clone());

        // Emit so Phase 13 UI can re-render that node as 'superseded'.
        let _ = app.emit(
            "substrate:invalidated",
            serde_json::json!({
                "uuid": stale.uuid,
                "invalidated_by": new_uuid,
                "valid_at": new.valid_at,
            }),
        );
    }

    Ok(invalidated)
}

/// Run `claude -p <prompt>` via tauri-plugin-shell. Subscription auth (no API key).
/// Same pattern as Phase 1 validation::test_claude_spawn — args inline, output()
/// blocking on subprocess completion.
async fn run_claude_judge(app: &tauri::AppHandle, prompt_text: &str) -> Result<String, String> {
    let shell = app.shell();
    let output = shell
        .command("claude")
        .args(["-p", prompt_text, "--output-format", "text"])
        .output()
        .await
        .map_err(|e| format!("claude -p subprocess failed: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "claude -p exit code {:?}: {stderr}",
            output.status.code()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}
