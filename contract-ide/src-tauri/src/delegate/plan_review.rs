use serde::{Deserialize, Serialize};
use std::io::Write;
use std::process::{Command, Stdio};
use tauri::AppHandle;

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
    _app: &AppHandle,
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

    // Pipe prompt via stdin (not -p arg) to avoid macOS argv size limits AND to give
    // claude an explicit EOF on stdin — `claude -p` (no arg) reads from stdin and
    // returns when stdin closes. Using -p with a positional argument leaves stdin
    // piped-but-empty, which trips the "no stdin data received in 3s" warning and
    // a non-zero exit on newer Claude CLI versions.
    let prompt_owned = assembled_prompt.to_string();
    let schema_str = schema.to_string();
    let directive_owned = planning_directive.to_string();

    // Lean-mode flags: skip MCP discovery + skills + session persistence, but
    // keep OAuth/keychain auth (so we don't need ANTHROPIC_API_KEY). Cuts
    // claude startup from ~15-20s (with full plugin/MCP roster) to ~3-5s.
    // Trade-off vs --bare: still pays for keychain read + CLAUDE.md auto-discovery
    // but skips the MCP servers + skill registry + session journaling.
    let output_future = tokio::task::spawn_blocking(move || -> Result<std::process::Output, String> {
        let mut child = Command::new("claude")
            .args([
                "-p",
                "--append-system-prompt",
                &directive_owned,
                "--output-format",
                "json",
                "--json-schema",
                &schema_str,
                "--strict-mcp-config",
                "--mcp-config",
                r#"{"mcpServers":{}}"#,
                "--disable-slash-commands",
                "--no-session-persistence",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("planning claude spawn: {e}"))?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(prompt_owned.as_bytes())
                .map_err(|e| format!("planning stdin write: {e}"))?;
        }
        child
            .wait_with_output()
            .map_err(|e| format!("planning claude wait: {e}"))
    });

    // 45s hard timeout — fail fast if claude hangs (vs the previous unbounded wait).
    let output = match tokio::time::timeout(std::time::Duration::from_secs(45), output_future).await {
        Err(_) => return Err("planning claude timed out after 45s".into()),
        Ok(Err(e)) => return Err(format!("planning task join: {e}")),
        Ok(Ok(Err(e))) => return Err(e),
        Ok(Ok(Ok(out))) => out,
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stdout_snip: String = stdout.chars().take(500).collect();
        return Err(format!(
            "planning claude exit code {}: stderr={:?} stdout_head={:?}",
            output.status.code().unwrap_or(-1),
            stderr.trim(),
            stdout_snip,
        ));
    }

    // claude -p with --output-format json may signal API errors via is_error=true
    // INSIDE the JSON body even when exit code is 0. Surface that explicitly so the
    // user gets the underlying message instead of a downstream schema parse failure.
    let response: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("response parse: {e}"))?;
    if response.get("is_error").and_then(|v| v.as_bool()) == Some(true) {
        let msg = response
            .get("result")
            .and_then(|v| v.as_str())
            .unwrap_or("(no result message)");
        return Err(format!("planning claude API error: {msg}"));
    }

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
