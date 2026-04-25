use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StructuredPlan {
    pub target_files: Vec<String>,
    pub substrate_rules: Vec<SubstrateRuleRef>,
    pub decisions_preview: Vec<DecisionPreview>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubstrateRuleRef {
    pub uuid: String,
    pub one_line: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecisionPreview {
    pub key: String,
    pub chosen_value: String,
}

pub async fn run_planning_pass(
    app: &AppHandle,
    assembled_prompt: &str,
) -> Result<StructuredPlan, String> {
    let planning_directive = r#"PLANNING-ONLY MODE. You will produce a STRUCTURED PLAN, not code.
Do not call Edit, Write, or MultiEdit tools.
Do not modify any files.
Read tools are permitted (Read, Glob, Grep) for understanding the task.

Output ONLY a JSON object matching the schema. No commentary, no code, no edits."#;

    let schema = serde_json::json!({
        "type": "object",
        "properties": {
            "target_files": { "type": "array", "items": {"type": "string"} },
            "substrate_rules": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["uuid", "one_line"],
                    "properties": {
                        "uuid": {"type": "string"},
                        "one_line": {"type": "string"}
                    }
                }
            },
            "decisions_preview": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["key", "chosen_value"],
                    "properties": {
                        "key": {"type": "string"},
                        "chosen_value": {"type": "string"}
                    }
                }
            }
        },
        "required": ["target_files", "substrate_rules", "decisions_preview"]
    });

    let output = app
        .shell()
        .command("claude")
        .args([
            "-p",
            assembled_prompt,
            "--append-system-prompt",
            planning_directive,
            "--output-format",
            "json",
            "--json-schema",
            &schema.to_string(),
            "--bare",
        ])
        .output()
        .await
        .map_err(|e| format!("planning claude spawn: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "planning claude exit non-zero: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let response: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("response parse: {e}"))?;

    // Try structured_output field first (json output format with schema)
    let structured = response
        .get("structured_output")
        .cloned()
        .or_else(|| {
            // Fallback: try parsing the entire response as the plan directly
            Some(response.clone())
        })
        .ok_or("missing structured_output")?;

    serde_json::from_value::<StructuredPlan>(structured)
        .map_err(|e| format!("plan parse: {e}"))
}
