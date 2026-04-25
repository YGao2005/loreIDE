use crate::retrieval::SubstrateHit;
use std::io::Write;
use std::process::{Command, Stdio};
use tauri::AppHandle;

/// LLM listwise rerank: top-15 candidates -> top-K (5 default).
/// One `claude -p --bare` call. Defensive parser tolerates code-fence wrapping +
/// out-of-bounds indices + duplicates.
///
/// Falls back to original FTS5 ordering if rerank parse fails entirely
/// (insurance against LLM jitter).
///
/// Anti-pattern: NEVER call claude -p without --bare. Without --bare, MCP
/// discovery + CLAUDE.md + skills add 1-3s latency and non-deterministic context.
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

    // Pitfall 8: truncate contract_body to 800 chars to avoid input window blow-up
    // on long Phase 8 rollup-stale L0 contracts.
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

    // Lean-mode flags: see plan_review.rs for rationale. Skips MCP/skills/persistence
    // but keeps OAuth/keychain auth (no ANTHROPIC_API_KEY required).
    let prompt_owned = prompt;
    let output_future = tokio::task::spawn_blocking(move || -> Result<std::process::Output, String> {
        let mut child = Command::new("claude")
            .args([
                "-p",
                "--output-format",
                "json",
                // Pin haiku + low effort — rerank just orders a 15-item list,
                // doesn't need opus thinking. Without the pin, default routing
                // may pick opus + medium thinking and add 15-30s of inference.
                "--model",
                "haiku",
                "--effort",
                "low",
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
            .map_err(|e| format!("rerank claude spawn: {e}"))?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(prompt_owned.as_bytes())
                .map_err(|e| format!("rerank stdin write: {e}"))?;
        }
        child
            .wait_with_output()
            .map_err(|e| format!("rerank claude wait: {e}"))
    });

    // 30s hard timeout — fall back to FTS5 ordering if claude hangs.
    let output = match tokio::time::timeout(std::time::Duration::from_secs(30), output_future).await {
        Err(_) => {
            eprintln!("[rerank] claude timed out after 30s; falling back to FTS5 order");
            return Ok(candidates.iter().take(top_k).cloned().collect());
        }
        Ok(Err(e)) => return Err(format!("rerank task join: {e}")),
        Ok(Ok(Err(e))) => return Err(e),
        Ok(Ok(Ok(out))) => out,
    };

    if !output.status.success() {
        // Fallback: original ordering
        eprintln!("[rerank] claude exit non-zero; falling back to FTS5 order");
        return Ok(candidates.iter().take(top_k).cloned().collect());
    }

    let response: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("response parse: {e}"))?;
    let result_text = response
        .get("result")
        .and_then(|v| v.as_str())
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

    // Backfill from original FTS5 ordering for any missing slots (insurance).
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
