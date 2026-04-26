//! Intent-level supersession engine — the moat.
//! See 12-RESEARCH.md Pattern 3 + research/intent-supersession/.
//!
//! When an L0 contract priority shifts, every transitively rollup-linked
//! decision substrate node is judged for intent drift via the validated
//! `prompt.md` (codified in 12-02's `build_intent_drift_batch_prompt`).
//! The cascade walker traverses Phase 8's `rollup_inputs` edges DOWN from
//! the new L0 (depth ≤ 5), batches descendants in chunks of 10, and
//! persists three-way verdicts to `intent_drift_verdicts` (audit) +
//! `substrate_nodes.intent_drift_state` (latest).
//!
//! Confidence calibration: ≥ 0.85 → auto_applied=1; 0.50–0.85 → surfaced;
//! < 0.50 → filtered (state stays NULL on substrate_nodes).
//!
//! # Lock ordering
//! Per-decision verdict writes acquire the corresponding decision UUID's
//! `DriftLocks::for_uuid()` mutex one at a time — no cross-node lock
//! pairing. This eliminates the deadlock-pair concern fact_engine has to
//! manage.

use crate::drift::state::DriftLocks;
use crate::supersession::prompt::build_intent_drift_batch_prompt;
use crate::supersession::types::{IntentDriftResult, ParsedVerdict, Verdict};
use crate::supersession::verdict::parse_three_way_batch;
use crate::supersession::walker::walk_rollup_descendants;

/// Bucket a (verdict, confidence) pair lands in per the calibration spec.
/// Confidence-floor is checked first — anything below 0.50 is `Filtered`
/// regardless of verdict, matching the substrate_nodes write-gate. Then:
/// `Drifted ≥ 0.85` → `AutoApplied`; `Drifted | NeedsHumanReview ≥ 0.50` →
/// `Surfaced`; everything else (e.g., confident `NotDrifted`) → `NoAction`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum VerdictBucket {
    AutoApplied,
    Surfaced,
    Filtered,
    NoAction,
}

pub(crate) fn classify_verdict(v: Verdict, confidence: f64) -> VerdictBucket {
    if confidence < 0.50 {
        return VerdictBucket::Filtered;
    }
    match v {
        Verdict::Drifted if confidence >= 0.85 => VerdictBucket::AutoApplied,
        Verdict::Drifted | Verdict::NeedsHumanReview => VerdictBucket::Surfaced,
        _ => VerdictBucket::NoAction,
    }
}
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::{Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

/// Returned by preview_intent_drift_impact for the safeguard gate.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImpactPreview {
    pub priority_shift_id: String,
    pub total_descendants: u32,
    pub sampled: u32,
    pub would_drift: u32,
    pub would_surface: u32,
    pub would_filter: u32,
    pub representative_examples: Vec<RepresentativeVerdict>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepresentativeVerdict {
    pub uuid: String,
    pub text: String,
    pub verdict: String,
    pub confidence: f64,
}

/// Insert a new priority_shifts row. Returns the new shift id.
/// Rejects if any unapplied shift exists (RESEARCH.md Q2: REJECT, not queue).
pub async fn record_priority_shift_internal(
    pool: &SqlitePool,
    old_l0_uuid: &str,
    new_l0_uuid: &str,
    valid_at: &str,
    summary_of_old: &str,
    summary_of_new: &str,
) -> Result<String, String> {
    // Reject if there's any unapplied shift currently in flight.
    let pending: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM priority_shifts WHERE applied_at IS NULL LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("record_priority_shift pending check: {e}"))?;
    if let Some((id,)) = pending {
        return Err(format!(
            "Another priority shift ({id}) is unapplied. Apply or rollback before recording a new one."
        ));
    }

    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO priority_shifts (id, old_l0_uuid, new_l0_uuid, valid_at, summary_of_old, summary_of_new, applied_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
    )
    .bind(&id)
    .bind(old_l0_uuid)
    .bind(new_l0_uuid)
    .bind(valid_at)
    .bind(summary_of_old)
    .bind(summary_of_new)
    .execute(pool)
    .await
    .map_err(|e| format!("record_priority_shift insert: {e}"))?;
    Ok(id)
}

/// DRY-RUN judge on a sample of descendants — load-bearing safeguard before
/// full apply (RESEARCH.md Pitfall 3, evaluation.md failure mode 5).
/// Sample size = min(10, total_descendants).
pub async fn preview_intent_drift_impact(
    app: &tauri::AppHandle,
    pool: &SqlitePool,
    priority_shift_id: &str,
) -> Result<ImpactPreview, String> {
    let shift = read_priority_shift(pool, priority_shift_id).await?;
    let descendants = walk_rollup_descendants(pool, &shift.new_l0_uuid, 5).await?;
    let total = descendants.len() as u32;
    if total == 0 {
        return Ok(ImpactPreview {
            priority_shift_id: priority_shift_id.to_string(),
            total_descendants: 0,
            sampled: 0,
            would_drift: 0,
            would_surface: 0,
            would_filter: 0,
            representative_examples: vec![],
        });
    }
    let sample_size = std::cmp::min(10, total) as usize;
    let sample: Vec<_> = descendants
        .iter()
        .take(sample_size)
        .map(|d| d.node.clone())
        .collect();
    let prompt_text = build_intent_drift_batch_prompt(
        &shift.summary_of_old,
        &shift.summary_of_new,
        &sample,
    );
    let raw = run_claude_judge(app, &prompt_text).await?;
    let verdicts = parse_three_way_batch(&raw)?;

    let mut would_drift = 0u32;
    let mut would_surface = 0u32;
    let mut would_filter = 0u32;
    let mut examples = vec![];
    for (i, v) in verdicts.iter().enumerate() {
        match classify_verdict(v.verdict, v.confidence) {
            VerdictBucket::AutoApplied => would_drift += 1,
            VerdictBucket::Surfaced => would_surface += 1,
            VerdictBucket::Filtered => would_filter += 1,
            VerdictBucket::NoAction => {}
        }
        if i < 3 {
            if let Some(d) = sample.get(i) {
                examples.push(RepresentativeVerdict {
                    uuid: d.uuid.clone(),
                    text: d.text.chars().take(80).collect::<String>(),
                    verdict: v.verdict.as_db_str().to_string(),
                    confidence: v.confidence,
                });
            }
        }
    }

    Ok(ImpactPreview {
        priority_shift_id: priority_shift_id.to_string(),
        total_descendants: total,
        sampled: sample.len() as u32,
        would_drift,
        would_surface,
        would_filter,
        representative_examples: examples,
    })
}

/// Apply intent-drift judgment to ALL descendants of the shift's new_l0.
/// Batches in chunks of 10. Persists verdicts; emits substrate:intent_drift_changed.
/// Marks priority_shifts.applied_at on success.
pub async fn propagate_intent_drift(
    app: &tauri::AppHandle,
    pool: &SqlitePool,
    priority_shift_id: &str,
) -> Result<IntentDriftResult, String> {
    let shift = read_priority_shift(pool, priority_shift_id).await?;
    if shift.applied_at.is_some() {
        return Err(format!(
            "Priority shift {priority_shift_id} already applied at {}",
            shift.applied_at.unwrap()
        ));
    }
    let descendants = walk_rollup_descendants(pool, &shift.new_l0_uuid, 5).await?;
    if descendants.is_empty() {
        // Mark applied with empty result.
        write_priority_shift_applied(pool, priority_shift_id).await?;
        return Ok(IntentDriftResult::default());
    }

    let mut result = IntentDriftResult::default();
    let locks = app.state::<DriftLocks>();

    // Map d{i+1} placeholders → uuid for chunk-local ID resolution.
    for chunk in descendants.chunks(10) {
        let chunk_nodes: Vec<_> = chunk.iter().map(|d| d.node.clone()).collect();
        let prompt_text = build_intent_drift_batch_prompt(
            &shift.summary_of_old,
            &shift.summary_of_new,
            &chunk_nodes,
        );
        let raw = run_claude_judge(app, &prompt_text).await?;
        let verdicts = parse_three_way_batch(&raw)?;

        // Pair each verdict (d1, d2, …) with the corresponding chunk node by index.
        for (idx, decision) in chunk_nodes.iter().enumerate() {
            let placeholder = format!("d{}", idx + 1);
            let v = verdicts.iter().find(|v| v.id == placeholder);
            let parsed = match v {
                Some(v) => v.clone(),
                None => {
                    // Missing verdict — synthesize NEEDS_HUMAN_REVIEW at confidence 0.0.
                    ParsedVerdict {
                        id: placeholder.clone(),
                        verdict: Verdict::NeedsHumanReview,
                        reasoning: "(verdict missing from LLM response — surfaced for review)"
                            .into(),
                        confidence: 0.0,
                    }
                }
            };

            // Per-decision write under that decision's lock (one lock at a
            // time — no cross-pair locking, eliminates the deadlock concern
            // fact_engine has to manage).
            let g = locks.for_uuid(&decision.uuid);
            let _h = g.lock().await;

            let auto_applied =
                matches!(parsed.verdict, Verdict::Drifted) && parsed.confidence >= 0.85;
            write_intent_drift_verdict(
                pool,
                &decision.uuid,
                priority_shift_id,
                &parsed,
                auto_applied,
            )
            .await?;

            // Update substrate_nodes.intent_drift_state ONLY if confidence >= 0.50
            // (filtered noise stays NULL per evaluation.md tier-3 filter).
            if parsed.confidence >= 0.50 {
                update_substrate_intent_drift_state(
                    pool,
                    &decision.uuid,
                    &parsed,
                    priority_shift_id,
                )
                .await?;
            }

            result.judged += 1;
            let bucket = classify_verdict(parsed.verdict, parsed.confidence);
            match bucket {
                VerdictBucket::AutoApplied => result.drifted += 1,
                VerdictBucket::Surfaced => result.surfaced += 1,
                VerdictBucket::Filtered => result.filtered += 1,
                VerdictBucket::NoAction => {}
            }
            // Only emit when substrate_nodes.intent_drift_state was actually written
            // (confidence >= 0.50). Below the noise floor, DB stays NULL — emitting
            // would let UI subscribers render an orange flag with no DB backing.
            if !matches!(bucket, VerdictBucket::Filtered) {
                let _ = app.emit(
                    "substrate:intent_drift_changed",
                    serde_json::json!({
                        "uuid": decision.uuid,
                        "verdict": parsed.verdict.as_db_str(),
                        "confidence": parsed.confidence,
                        "auto_applied": auto_applied,
                        "priority_shift_id": priority_shift_id,
                    }),
                );
            }
        }
    }

    write_priority_shift_applied(pool, priority_shift_id).await?;
    Ok(result)
}

// -------- Persistence helpers (private) --------

#[allow(dead_code)]
struct PriorityShiftRow {
    old_l0_uuid: String,
    new_l0_uuid: String,
    summary_of_old: String,
    summary_of_new: String,
    applied_at: Option<String>,
}

async fn read_priority_shift(
    pool: &SqlitePool,
    id: &str,
) -> Result<PriorityShiftRow, String> {
    let row: (String, String, String, String, Option<String>) = sqlx::query_as(
        "SELECT old_l0_uuid, new_l0_uuid, summary_of_old, summary_of_new, applied_at \
         FROM priority_shifts WHERE id = ?1",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("read_priority_shift({id}): {e}"))?;
    Ok(PriorityShiftRow {
        old_l0_uuid: row.0,
        new_l0_uuid: row.1,
        summary_of_old: row.2,
        summary_of_new: row.3,
        applied_at: row.4,
    })
}

async fn write_intent_drift_verdict(
    pool: &SqlitePool,
    node_uuid: &str,
    shift_id: &str,
    v: &ParsedVerdict,
    auto_applied: bool,
) -> Result<(), String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO intent_drift_verdicts (id, node_uuid, priority_shift_id, verdict, confidence, reasoning, judged_at, auto_applied) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )
    .bind(&id)
    .bind(node_uuid)
    .bind(shift_id)
    .bind(v.verdict.as_db_str())
    .bind(v.confidence)
    .bind(&v.reasoning)
    .bind(&now)
    .bind(if auto_applied { 1 } else { 0 })
    .execute(pool)
    .await
    .map_err(|e| format!("write_intent_drift_verdict: {e}"))?;
    Ok(())
}

async fn update_substrate_intent_drift_state(
    pool: &SqlitePool,
    node_uuid: &str,
    v: &ParsedVerdict,
    shift_id: &str,
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    let state_str = match v.verdict {
        Verdict::Drifted => "drifted",
        Verdict::NotDrifted => "not_drifted",
        Verdict::NeedsHumanReview => "needs_human_review",
    };
    sqlx::query(
        "UPDATE substrate_nodes \
         SET intent_drift_state = ?1, \
             intent_drift_confidence = ?2, \
             intent_drift_reasoning = ?3, \
             intent_drift_judged_at = ?4, \
             intent_drift_judged_against = ?5 \
         WHERE uuid = ?6",
    )
    .bind(state_str)
    .bind(v.confidence)
    .bind(&v.reasoning)
    .bind(&now)
    .bind(shift_id)
    .bind(node_uuid)
    .execute(pool)
    .await
    .map_err(|e| format!("update_substrate_intent_drift_state: {e}"))?;
    Ok(())
}

async fn write_priority_shift_applied(
    pool: &SqlitePool,
    id: &str,
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    sqlx::query("UPDATE priority_shifts SET applied_at = ?1 WHERE id = ?2")
        .bind(&now)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| format!("write_priority_shift_applied: {e}"))?;
    Ok(())
}

/// Reuse fact_engine's run_claude_judge pattern (we duplicate ~10 lines
/// instead of cross-importing to avoid coupling the two engines).
async fn run_claude_judge(
    app: &tauri::AppHandle,
    prompt_text: &str,
) -> Result<String, String> {
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
            "claude -p exit {:?}: {stderr}",
            output.status.code()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(test)]
mod classify_tests {
    use super::*;

    #[test]
    fn high_confidence_drifted_auto_applies() {
        assert_eq!(
            classify_verdict(Verdict::Drifted, 0.95),
            VerdictBucket::AutoApplied
        );
    }

    #[test]
    fn boundary_drifted_at_0_85_auto_applies() {
        // Inclusive lower bound at 0.85.
        assert_eq!(
            classify_verdict(Verdict::Drifted, 0.85),
            VerdictBucket::AutoApplied
        );
    }

    #[test]
    fn drifted_just_under_0_85_surfaces_for_review() {
        assert_eq!(
            classify_verdict(Verdict::Drifted, 0.849),
            VerdictBucket::Surfaced
        );
    }

    #[test]
    fn drifted_at_0_50_floor_surfaces() {
        // Inclusive lower bound at 0.50.
        assert_eq!(
            classify_verdict(Verdict::Drifted, 0.50),
            VerdictBucket::Surfaced
        );
    }

    #[test]
    fn drifted_below_0_50_is_filtered_not_surfaced() {
        // Regression: previously the verdict-classification arm caught this
        // before the noise-floor check, mis-tallying as Surfaced and emitting
        // a substrate:intent_drift_changed event for a node whose DB state
        // stayed NULL.
        assert_eq!(
            classify_verdict(Verdict::Drifted, 0.30),
            VerdictBucket::Filtered
        );
    }

    #[test]
    fn needs_human_review_below_0_50_is_filtered_not_surfaced() {
        // Same regression as above for NHR.
        assert_eq!(
            classify_verdict(Verdict::NeedsHumanReview, 0.30),
            VerdictBucket::Filtered
        );
    }

    #[test]
    fn needs_human_review_above_floor_surfaces_regardless_of_confidence() {
        // NHR never auto-applies, even at high confidence.
        assert_eq!(
            classify_verdict(Verdict::NeedsHumanReview, 0.95),
            VerdictBucket::Surfaced
        );
    }

    #[test]
    fn confident_not_drifted_takes_no_action() {
        assert_eq!(
            classify_verdict(Verdict::NotDrifted, 0.95),
            VerdictBucket::NoAction
        );
    }

    #[test]
    fn not_drifted_below_floor_is_filtered() {
        assert_eq!(
            classify_verdict(Verdict::NotDrifted, 0.30),
            VerdictBucket::Filtered
        );
    }

    #[test]
    fn zero_confidence_always_filtered() {
        for v in [Verdict::Drifted, Verdict::NotDrifted, Verdict::NeedsHumanReview] {
            assert_eq!(classify_verdict(v, 0.0), VerdictBucket::Filtered);
        }
    }
}
