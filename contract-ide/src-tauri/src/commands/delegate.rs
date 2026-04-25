use crate::delegate::{
    composer,
    decisions::{ensure_decisions_manifest_inner, DecisionsManifest},
    plan_review::{run_planning_pass, StructuredPlan},
};
use crate::retrieval::SubstrateHit;
use serde::Serialize;

#[derive(Serialize)]
pub struct ComposeOutput {
    pub hits: Vec<SubstrateHit>,
    pub assembled_prompt: String,
}

/// Compose the agent prompt for the given scope_uuid.
/// Calls Plan 11-03 retrieval pipeline internally (lineage scope + FTS5 + LLM rerank).
/// Returns the 5 substrate hits (for the composing overlay) + the assembled prompt.
#[tauri::command]
pub async fn delegate_compose(
    app: tauri::AppHandle,
    scope_uuid: String,
) -> Result<ComposeOutput, String> {
    let result = composer::compose_prompt(&app, &scope_uuid).await?;
    Ok(ComposeOutput {
        hits: result.hits,
        assembled_prompt: result.assembled_prompt,
    })
}

/// Run the planning pass for the given assembled prompt.
/// Uses claude -p --bare --append-system-prompt PLANNING-ONLY directive --json-schema.
/// Returns StructuredPlan { target_files, substrate_rules, decisions_preview }.
#[tauri::command]
pub async fn delegate_plan(
    app: tauri::AppHandle,
    assembled_prompt: String,
) -> Result<StructuredPlan, String> {
    run_planning_pass(&app, &assembled_prompt).await
}

/// Execute the delegate with the given assembled prompt.
/// Appends a decisions.json emission directive to the planning prompt, then
/// calls Phase 8's run_agent with bare=true.
/// Returns the tracking_id immediately (agent streams in background via Phase 8 machinery).
#[tauri::command]
pub async fn delegate_execute(
    app: tauri::AppHandle,
    scope_uuid: String,
    assembled_prompt: String,
    atom_uuid: Option<String>,
) -> Result<String, String> {
    let final_atom_uuid = atom_uuid.unwrap_or_else(|| scope_uuid.clone());

    // Compose execute-mode prompt: APPEND decisions.json emission directive to the planning prompt.
    let execute_prompt = format!(
        r#"{assembled_prompt}

---

ALSO: After writing code, emit a `decisions.json` file at `.contracts/decisions/{final_atom_uuid}.json` with this schema:

{{
  "atom_uuid": "{final_atom_uuid}",
  "decisions": [
    {{
      "key": "<short-snake-case-key>",
      "chosen_value": "<value as string>",
      "rationale": "<one-sentence explanation>",
      "substrate_citation_id": "<substrate uuid if a substrate rule explicitly demanded this; null otherwise>"
    }}
  ]
}}

List the implicit decisions you made — defaults you picked that no substrate rule explicitly demanded (e.g. "email_link_expiry_hours: 24"). Aim for 3-5 entries covering the most consequential implicit choices."#
    );

    // Reuse Phase 8's run_agent with bare=true (Phase 11 amendment).
    // Do NOT re-implement spawn/streaming/receipt logic — that all lives in Phase 8's agent.rs.
    let tracking_id = crate::commands::agent::run_agent(
        app,
        execute_prompt,
        Some(scope_uuid),
        Some(true), // bare=true for all Phase 11 execute paths
    )
    .await?;

    Ok(tracking_id)
}

/// Read the decisions manifest for the given atom_uuid.
/// Tries agent emission at .contracts/decisions/<atom-uuid>.json first.
/// On missing/malformed AND atom_uuid is a demo atom: loads the committed fixture
/// and copies it to the canonical location so the verifier reads consistently.
#[tauri::command]
pub async fn ensure_decisions_manifest(
    app: tauri::AppHandle,
    repo_path: String,
    atom_uuid: String,
) -> Result<DecisionsManifest, String> {
    ensure_decisions_manifest_inner(&app, &repo_path, &atom_uuid).await
}
