use crate::retrieval::SubstrateHit;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// LLM listwise rerank: top-15 candidates -> top-K (5 default) via DeepSeek
/// chat-completions API (OpenAI-compatible). One HTTP call per compose.
///
/// Why DeepSeek and not the `claude` CLI: the rerank is internal plumbing
/// (turn 15 strings into a 5-index ordering), not a user-facing Claude Code
/// session. Spawning the CLI cost ~3-5s of fixed startup (CLAUDE.md scan,
/// LSP init, hooks, OAuth keychain) wrapping a ~500ms inference. Direct API
/// is sub-second and ~$0.0001/call on v4-flash.
///
/// Model: deepseek-v4-flash (released 2026-04-24). 1M context, dual
/// thinking/non-thinking modes. We pin non-thinking for rerank — the task is
/// "order these 15 strings", no chain-of-thought needed and reasoning tokens
/// would add latency + cost. Non-thinking also re-enables `temperature` (0.0
/// gives deterministic ordering across calls).
///
/// Auth: reads `DEEPSEEK_API_KEY` from env (loaded via dotenvy in lib.rs::run).
/// If missing, falls back to FTS5+RRF ordering — rerank is best-effort.
///
/// Defensive parser tolerates code-fence wrapping + out-of-bounds indices +
/// duplicates; backfills missing slots from the original FTS5 ordering.
const DEEPSEEK_ENDPOINT: &str = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL: &str = "deepseek-v4-flash";
const RERANK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage<'a>>,
    temperature: f32,
    max_tokens: u32,
    /// Pin non-thinking mode. Default may switch to thinking on v4-flash and
    /// emit reasoning tokens we don't need.
    thinking: ThinkingMode,
}

#[derive(Serialize)]
struct ThinkingMode {
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

pub async fn llm_rerank(
    _app: &AppHandle,
    contract_body: &str,
    candidates: &[SubstrateHit],
    top_k: usize,
) -> Result<Vec<SubstrateHit>, String> {
    if candidates.is_empty() {
        return Ok(vec![]);
    }
    if candidates.len() <= top_k {
        return Ok(candidates.to_vec());
    }

    // No key → graceful degradation to FTS5 ordering. The selector already
    // produced a usable ranking via RRF; rerank is a quality boost, not a
    // correctness requirement.
    let api_key = match std::env::var("DEEPSEEK_API_KEY") {
        Ok(k) if !k.is_empty() => k,
        _ => {
            eprintln!("[rerank] DEEPSEEK_API_KEY not set; using FTS5 ordering");
            return Ok(candidates.iter().take(top_k).cloned().collect());
        }
    };

    // Truncate contract body to keep token count predictable on long L0
    // rollup-stale contracts (Pitfall 8 from the prior CLI implementation).
    let body_truncated = if contract_body.chars().count() > 800 {
        contract_body.chars().take(800).collect::<String>()
    } else {
        contract_body.to_string()
    };

    let candidates_text = candidates
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let aw = c.applies_when.as_deref().unwrap_or("");
            format!(
                "[{i}] type={} text=\"{}\" applies_when=\"{}\"",
                c.node_type, c.text, aw
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = format!(
        r#"You are reranking substrate rules for a coding agent's task.

Contract body (the work to do):
<contract>
{body_truncated}
</contract>

Candidates (top-{n} from semantic search):
<candidates>
{candidates_text}
</candidates>

Task: Pick the {top_k} candidates whose `applies_when` MOST DIRECTLY constrains how the agent should
implement this contract. Order them most-relevant first.

Output ONLY a JSON array of indices like [3, 7, 1, 5, 2]. No commentary."#,
        n = candidates.len(),
    );

    let req = ChatRequest {
        model: DEEPSEEK_MODEL,
        messages: vec![ChatMessage {
            role: "user",
            content: &prompt,
        }],
        // Deterministic ordering: same candidates → same output every call.
        // Only honored in non-thinking mode (thinking mode ignores temperature).
        temperature: 0.0,
        // 5 indices is ~15 tokens; small cap is fine since non-thinking mode
        // doesn't emit reasoning_content.
        max_tokens: 64,
        thinking: ThinkingMode { type_: "disabled" },
    };

    let client = reqwest::Client::new();
    let send = client
        .post(DEEPSEEK_ENDPOINT)
        .bearer_auth(&api_key)
        .json(&req)
        .send();

    let response = match tokio::time::timeout(RERANK_TIMEOUT, send).await {
        Err(_) => {
            eprintln!("[rerank] deepseek timed out after 15s; using FTS5 ordering");
            return Ok(candidates.iter().take(top_k).cloned().collect());
        }
        Ok(Err(e)) => {
            eprintln!("[rerank] deepseek request failed: {e}; using FTS5 ordering");
            return Ok(candidates.iter().take(top_k).cloned().collect());
        }
        Ok(Ok(r)) => r,
    };

    if !response.status().is_success() {
        let status = response.status();
        let body_snip: String = response
            .text()
            .await
            .unwrap_or_default()
            .chars()
            .take(200)
            .collect();
        eprintln!("[rerank] deepseek HTTP {status}: {body_snip}; using FTS5 ordering");
        return Ok(candidates.iter().take(top_k).cloned().collect());
    }

    let parsed: ChatResponse = match response.json().await {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[rerank] deepseek response parse failed: {e}; using FTS5 ordering");
            return Ok(candidates.iter().take(top_k).cloned().collect());
        }
    };

    let result_text = parsed
        .choices
        .first()
        .map(|c| c.message.content.as_str())
        .unwrap_or("[]")
        .to_string();

    let indices = parse_indices_defensive(&result_text);

    // Filter: drop out-of-bounds + duplicates.
    let mut seen = std::collections::HashSet::new();
    let mut ordered: Vec<SubstrateHit> = indices
        .into_iter()
        .filter(|&i| i < candidates.len() && seen.insert(i))
        .map(|i| candidates[i].clone())
        .take(top_k)
        .collect();

    // Backfill from original FTS5 ordering for any missing slots (insurance
    // against the model returning fewer than top_k indices).
    if ordered.len() < top_k {
        for (i, c) in candidates.iter().enumerate() {
            if seen.contains(&i) {
                continue;
            }
            ordered.push(c.clone());
            seen.insert(i);
            if ordered.len() >= top_k {
                break;
            }
        }
    }

    Ok(ordered)
}

/// Defensive index parser: handles raw JSON array, code-fence-wrapped JSON, and
/// adjacent preamble text. Returns Vec<usize>; empty Vec if all parses fail.
///
/// Three-level fallback:
///   1. Direct parse as JSON array
///   2. Strip code fences (```json ... ```) then parse
///   3. Regex-extract first `[...]` substring then parse
pub fn parse_indices_defensive(text: &str) -> Vec<usize> {
    // Attempt 1: direct parse
    if let Ok(indices) = serde_json::from_str::<Vec<i64>>(text) {
        return indices
            .into_iter()
            .filter(|i| *i >= 0)
            .map(|i| i as usize)
            .collect();
    }
    // Attempt 2: strip code fences + whitespace
    let stripped = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    if let Ok(indices) = serde_json::from_str::<Vec<i64>>(stripped) {
        return indices
            .into_iter()
            .filter(|i| *i >= 0)
            .map(|i| i as usize)
            .collect();
    }
    // Attempt 3: regex-extract first JSON-array-like substring
    if let Some(start) = stripped.find('[') {
        if let Some(end) = stripped[start..].find(']') {
            let candidate = &stripped[start..=start + end];
            if let Ok(indices) = serde_json::from_str::<Vec<i64>>(candidate) {
                return indices
                    .into_iter()
                    .filter(|i| *i >= 0)
                    .map(|i| i as usize)
                    .collect();
            }
        }
    }
    Vec::new()
}
