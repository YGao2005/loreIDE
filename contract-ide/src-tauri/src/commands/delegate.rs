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

    // Build the lean-mode flag set with ONLY the contract-ide MCP loaded —
    // skips Chrome/Firebase/Scholar/etc. (~15-20s startup → ~4s) while keeping
    // the agent's substrate tools (find_constraints_for_goal, find_by_intent,
    // find_decisions_about, open_questions, get_contract).
    let extra_args = build_lean_with_contract_ide_mcp(&app);

    // Reuse Phase 8's run_agent. Do NOT re-implement spawn/streaming/receipt logic.
    //
    // Opt up to sonnet + medium effort: the chat panel's haiku/low defaults
    // optimize for conversational latency, but delegate writes code and
    // expects multi-file edits + decisions.json emission. Sonnet is the
    // floor for that workload; medium effort lets it think through the plan
    // without overshooting.
    let tracking_id = crate::commands::agent::run_agent(
        app,
        execute_prompt,
        Some(scope_uuid),
        // bare=false: --bare requires ANTHROPIC_API_KEY (OAuth keychain ignored).
        Some(false),
        Some("sonnet".to_string()),
        Some("medium".to_string()),
        Some(extra_args),
    )
    .await?;

    Ok(tracking_id)
}

/// Build the lean-mode args + a focused mcp-config that loads only the
/// contract-ide MCP server. Returns the args ready to append to claude's argv.
///
/// Keeps the agent's substrate-query tools while skipping the user's other
/// MCP servers (Chrome, Firebase, Scholar, etc.) which add 10-15s of startup
/// latency without benefit for code-writing.
///
/// Falls back to empty mcp-config (no servers) if any path resolution fails;
/// the agent loses contract-ide tools but still runs (better than blocking).
fn build_lean_with_contract_ide_mcp(app: &tauri::AppHandle) -> Vec<String> {
    let mcp_servers_json = match resolve_contract_ide_mcp_config(app) {
        Some(json) => json,
        None => r#"{"mcpServers":{}}"#.to_string(),
    };

    vec![
        "--strict-mcp-config".to_string(),
        "--mcp-config".to_string(),
        mcp_servers_json,
        "--disable-slash-commands".to_string(),
        "--no-session-persistence".to_string(),
    ]
}

/// Resolve the contract-ide MCP server binary + DB + repo paths and return
/// the mcp-config JSON. Returns None if any path resolution fails (caller
/// falls back to no-MCP mode).
fn resolve_contract_ide_mcp_config(app: &tauri::AppHandle) -> Option<String> {
    use tauri::Manager;

    // MCP binary path: same resolution Tauri uses for sidecar("mcp-server").
    // resource_dir is the bundled-app location at runtime; in dev tauri puts
    // the binary at <resource_dir>/binaries/mcp-server-<triple>.
    let resource_dir = app.path().resource_dir().ok()?;
    let triple = format!("{}-apple-darwin", std::env::consts::ARCH);
    let bin_path = resource_dir
        .join("binaries")
        .join(format!("mcp-server-{triple}"));
    if !bin_path.exists() {
        eprintln!(
            "[delegate_execute] mcp-server binary not found at {} — falling back to no-MCP",
            bin_path.display()
        );
        return None;
    }

    let db_path = app.path().app_data_dir().ok()?.join("contract-ide.db");

    // Repo path is optional — without it, MCP tools that need a repo context
    // gracefully fail; the substrate-query tools (find_constraints_for_goal etc.)
    // only need the DB.
    let repo_path: Option<String> = app
        .try_state::<crate::commands::repo::RepoState>()
        .and_then(|state| {
            state
                .0
                .lock()
                .ok()
                .and_then(|guard| guard.as_ref().map(|p| p.to_string_lossy().into_owned()))
        });

    let mut env_obj = serde_json::json!({
        "CONTRACT_IDE_DB_PATH": db_path.to_string_lossy(),
    });
    if let Some(rp) = repo_path {
        env_obj["CONTRACT_IDE_REPO_PATH"] = serde_json::Value::String(rp);
    }

    let config = serde_json::json!({
        "mcpServers": {
            "contract-ide": {
                "command": bin_path.to_string_lossy(),
                "env": env_obj,
            }
        }
    });
    Some(config.to_string())
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
