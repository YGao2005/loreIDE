use serde::{Deserialize, Serialize};
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

/// Planning pass: read the assembled compose prompt, return a StructuredPlan
/// (target_files, substrate_rules, decisions_preview). Drives the Inspector's
/// plan-review step before the user clicks Approve.
///
/// Backed by DeepSeek v4-flash chat-completions (json_object mode), non-thinking.
/// Same vendor + key as retrieval/rerank.rs — see lib.rs::run for dotenvy
/// loading. We dropped the `claude` CLI here for the same reason as rerank:
/// internal LLM plumbing (parse one prompt → emit one structured object) was
/// paying ~3-5s of CLI startup that the actual work didn't need. v4-flash
/// returns this structure in ~2-5s end-to-end vs ~10-20s for the CLI path.
///
/// Why non-thinking: planning is structured-output, not open-ended reasoning.
/// Thinking mode would emit reasoning_content tokens we discard, increase
/// latency 2-5x, and disable temperature pinning. If plan quality slips on
/// gnarlier contracts we can flip thinking on by setting type_: "enabled".
///
/// Schema enforcement: claude's `--json-schema` validates server-side; DeepSeek
/// json_object mode returns *some* valid JSON but doesn't enforce our specific
/// shape. We compensate by (a) describing the exact shape inline in the system
/// prompt, (b) parsing into StructuredPlan via serde and surfacing clear errors
/// when the model deviates.
const DEEPSEEK_ENDPOINT: &str = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL: &str = "deepseek-v4-flash";
const PLANNING_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage<'a>>,
    temperature: f32,
    max_tokens: u32,
    /// Pin non-thinking — see module-level rationale.
    thinking: ThinkingMode,
    /// Guarantees `content` parses as JSON. The system prompt describes our
    /// expected shape; serde catches any deviation.
    response_format: ResponseFormat,
}

#[derive(Serialize)]
struct ThinkingMode {
    #[serde(rename = "type")]
    type_: &'static str,
}

#[derive(Serialize)]
struct ResponseFormat {
    #[serde(rename = "type")]
    type_: &'static str,
}

#[derive(Serialize)]
struct ChatMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatResponseMessage,
}

#[derive(Deserialize)]
struct ChatResponseMessage {
    content: String,
}

pub async fn run_planning_pass(
    _app: &AppHandle,
    assembled_prompt: &str,
) -> Result<StructuredPlan, String> {
    let api_key = std::env::var("DEEPSEEK_API_KEY")
        .map_err(|_| {
            "DEEPSEEK_API_KEY not set — required for delegate planning. \
             Add it to src-tauri/.env (see .env.example)."
                .to_string()
        })?;
    if api_key.is_empty() {
        return Err("DEEPSEEK_API_KEY is set but empty".into());
    }

    let system_prompt = r#"You are a coding-task planner. The user message contains a contract specification: intent, role, constraints, lineage context (parent surface + ancestors + sibling atoms), and ranked substrate rules retrieved from prior team sessions.

PLANNING-ONLY MODE. Do NOT write code. Do NOT modify files. Output JSON ONLY.

Output a JSON object with EXACTLY these three top-level keys (no others):

{
  "target_files": [<string>, ...],
  "substrate_rules": [{"uuid": <string>, "one_line": <string>}, ...],
  "decisions_preview": [{"key": <string>, "chosen_value": <string>}, ...]
}

Field semantics:
- target_files: file paths the agent intends to edit or create. Be specific (e.g. "src/app/team/[slug]/members/page.tsx"), not directories.
- substrate_rules: the substrate rules from the input that you'll cite while implementing this contract. Each entry: substrate rule's uuid (copy verbatim from input — do not invent) + a one-line restatement of why it applies to this contract. Pick the rules whose `applies_when` directly constrains the work; skip rules retrieval was over-eager about.
- decisions_preview: 3-5 implicit decisions you anticipate making — defaults you'd pick that no substrate rule explicitly demands (e.g. "session_token_expiry_hours: 24"). Each entry: snake_case key + short chosen_value string.

Output only the JSON object. No markdown fences, no commentary, no preamble."#;

    let req = ChatRequest {
        model: DEEPSEEK_MODEL,
        messages: vec![
            ChatMessage {
                role: "system",
                content: system_prompt,
            },
            ChatMessage {
                role: "user",
                content: assembled_prompt,
            },
        ],
        // Deterministic across re-plans for the same prompt.
        temperature: 0.0,
        // StructuredPlan is small but assembled_prompt may cite many candidates;
        // budget for a generous response while remaining bounded.
        max_tokens: 4000,
        thinking: ThinkingMode { type_: "disabled" },
        response_format: ResponseFormat {
            type_: "json_object",
        },
    };

    let client = reqwest::Client::new();
    let send = client
        .post(DEEPSEEK_ENDPOINT)
        .bearer_auth(&api_key)
        .json(&req)
        .send();

    let response = match tokio::time::timeout(PLANNING_TIMEOUT, send).await {
        Err(_) => return Err("planning deepseek timed out after 60s".into()),
        Ok(Err(e)) => return Err(format!("planning deepseek request failed: {e}")),
        Ok(Ok(r)) => r,
    };

    if !response.status().is_success() {
        let status = response.status();
        let body_snip: String = response
            .text()
            .await
            .unwrap_or_default()
            .chars()
            .take(500)
            .collect();
        return Err(format!("planning deepseek HTTP {status}: {body_snip}"));
    }

    let parsed: ChatResponse = response
        .json()
        .await
        .map_err(|e| format!("planning response parse: {e}"))?;

    let content = parsed
        .choices
        .first()
        .map(|c| c.message.content.as_str())
        .ok_or("planning response had no choices")?
        .to_string();

    // json_object mode guarantees parseable JSON, but not our exact shape.
    // Surface the head of the content on parse failure so the user can see
    // what the model actually emitted (helps tune the system prompt).
    serde_json::from_str::<StructuredPlan>(&content).map_err(|e| {
        let head: String = content.chars().take(300).collect();
        format!("plan JSON parse failed: {e}; content head: {head}")
    })
}
