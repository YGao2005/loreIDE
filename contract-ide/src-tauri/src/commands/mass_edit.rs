//! Phase 9 Plan 09-01 — Mass-edit retrieval Tauri command (MASS-01).
//!
//! Implements the Rust-side IPC for `find_by_intent_mass` so the React
//! frontend can trigger mass-edit retrieval without requiring the MCP sidecar
//! to be reachable from the frontend (MCP is stdio-only, accessible to Claude
//! Code sessions but not directly to React).
//!
//! This command mirrors the FTS5 query and section-weighted re-ranking logic
//! in mcp-sidecar/src/tools/find_by_intent_mass.ts, but runs entirely in Rust
//! via SQLite direct access. The section-parser-cli binary (Phase 8 PROP-01)
//! is spawned via std::process::Command for snippet-to-section matching.
//!
//! Routing choice: Option A per 09-01-SUMMARY.md. Avoids needing the MCP
//! sidecar to be reachable from React (it's only accessible via stdio to
//! external Claude Code sessions). Mirrors the existing scanner read pattern.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use tauri::Manager;
use tauri_plugin_sql::DbInstances;

/// Wire-format for a single mass-match result.
/// Matches the TypeScript MassMatchResult interface in src/ipc/mass-edit.ts.
#[derive(Debug, Serialize, Deserialize)]
pub struct MassMatchResult {
    pub uuid: String,
    pub name: String,
    pub level: String,
    pub kind: String,
    pub snippet: String,
    pub body: String,
    /// true if nodes.human_pinned is non-zero (NULL treated as false)
    pub human_pinned: bool,
    pub weighted_score: f64,
    pub matched_section: Option<String>,
}

/// Wire-format response matching TypeScript MassMatchResponse.
#[derive(Debug, Serialize, Deserialize)]
pub struct MassMatchResponse {
    pub query: String,
    /// Always "disabled" in Phase 9 v1 — embeddings deferred per MASS-01 spec.
    pub embedding_status: String,
    pub matches: Vec<MassMatchResult>,
}

/// PACT 2025 section weights (matches mcp-sidecar/src/lib/section_weight.ts).
fn section_weight(section_name: &str) -> f64 {
    match section_name {
        "invariants" => 2.0,
        "examples" => 2.0,
        "intent" => 1.5,
        "role" => 1.0,
        "inputs" => 1.0,
        "outputs" => 1.0,
        "side effects" => 0.8,
        "failure modes" => 0.8,
        "notes" => 0.5,
        _ => 1.0,
    }
}

/// Parse H2 sections from a contract body using simple line-based splitting.
/// Fallback for when section-parser-cli is unavailable or fails.
/// Returns lowercase keys matching the CLI convention.
fn simple_h2_split(body: &str) -> HashMap<String, String> {
    let mut out: HashMap<String, String> = HashMap::new();
    let mut current_section: Option<String> = None;
    let mut current_body: Vec<&str> = Vec::new();
    let mut in_fence = false;

    for line in body.lines() {
        if line.trim_start().starts_with("```") {
            in_fence = !in_fence;
        }
        if !in_fence && line.starts_with("## ") {
            if let Some(section) = current_section.take() {
                out.insert(section, current_body.join("\n").trim().to_string());
            }
            current_section = Some(line[3..].trim().to_lowercase());
            current_body = Vec::new();
        } else if current_section.is_some() {
            current_body.push(line);
        }
    }
    if let Some(section) = current_section {
        out.insert(section, current_body.join("\n").trim().to_string());
    }
    out
}

/// Invoke section-parser-cli (Phase 8 PROP-01) on a contract body.
/// Returns parsed sections (lowercase keys) or None if CLI fails.
/// CLI path: SECTION_PARSER_CLI_PATH env var → bundled binary path.
fn parse_sections_via_cli(body: &str) -> Option<HashMap<String, String>> {
    // Resolve binary path — same priority as the MCP sidecar (documented in
    // 08-02-SUMMARY.md as the canonical override pattern).
    let binary_path: PathBuf = if let Ok(p) = std::env::var("SECTION_PARSER_CLI_PATH") {
        PathBuf::from(p)
    } else {
        // Try bundled path relative to the Tauri app data dir — not available in
        // dev mode. Fall back to a known dev path (src-tauri/binaries/).
        // In bundled mode, Tauri resolves sidecar binaries differently; the MCP
        // sidecar uses an env var set by launch_mcp_sidecar. For now use the
        // dev-mode suffixed path.
        let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        p.push("binaries");
        p.push("section-parser-cli-aarch64-apple-darwin");
        p
    };

    if !binary_path.exists() {
        return None;
    }

    let output = Command::new(&binary_path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            if let Some(stdin) = child.stdin.as_mut() {
                let _ = stdin.write_all(body.as_bytes());
            }
            child.wait_with_output()
        })
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let json_str = std::str::from_utf8(&output.stdout).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(json_str).ok()?;

    // CLI only emits section_hashes (confirmed by 09-01 verification).
    // Use simpleH2Split for section text (needed for snippet matching).
    parsed.get("section_hashes")?; // confirm CLI output is valid
    Some(simple_h2_split(body))
}

/// Identify which section a snippet belongs to by substring match.
fn find_snippet_section(snippet: &str, sections: &HashMap<String, String>) -> Option<String> {
    // Strip FTS5 ** bold markers and ... ellipsis before matching
    let clean = snippet.replace("**", "").replace("...", "").trim().to_string();
    if clean.len() < 8 {
        return None;
    }
    let prefix = &clean[..clean.len().min(24)];
    for (name, text) in sections {
        if text.contains(prefix) {
            return Some(name.clone());
        }
    }
    None
}

/// Build an FTS5 MATCH expression from a free-form user query.
///
/// FTS5's default tokenization treats whitespace-separated terms as implicit
/// AND — a natural-language query like `"add audit logging to every destructive
/// endpoint"` requires every word to appear in the same row, returning 0 hits.
/// We OR-tokenize so any single matching term contributes; BM25 ranking demotes
/// common words naturally.
///
/// Pass-through behavior: if the user already wrote a structured FTS query
/// (uppercase AND/OR/NOT, NEAR, or quoted phrases), respect it verbatim.
fn build_fts_query(user_query: &str) -> String {
    let trimmed = user_query.trim();
    if trimmed.is_empty() {
        return trimmed.to_string();
    }

    // Detect structured queries — pass through.
    let upper = trimmed.to_ascii_uppercase();
    let has_operator = upper.contains(" AND ")
        || upper.contains(" OR ")
        || upper.contains(" NOT ")
        || upper.contains(" NEAR(")
        || trimmed.contains('"');
    if has_operator {
        return trimmed.to_string();
    }

    // Split on any non-alphanumeric (whitespace + punctuation), FTS5-quote
    // each term, join with " OR ". This way "account-button.tsx" yields three
    // tokens (account, button, tsx) rather than one merged blob.
    let tokens: Vec<String> = trimmed
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{t}\""))
        .collect();

    if tokens.is_empty() {
        trimmed.to_string()
    } else {
        tokens.join(" OR ")
    }
}

/// Tauri command: mass-edit retrieval via FTS5 + section-weighted re-ranking.
///
/// Returns a JSON-serialized MassMatchResponse. The React frontend calls this
/// via `invoke('find_by_intent_mass', { query, limit })`.
///
/// EMBEDDING_DISABLED: embeddings deferred per MASS-01 spec. Response includes
/// `embedding_status: "disabled"` so the review queue can show "keyword only".
#[tauri::command]
pub async fn find_by_intent_mass(
    app: tauri::AppHandle,
    query: String,
    limit: Option<u32>,
) -> Result<MassMatchResponse, String> {
    let cap = limit.unwrap_or(100) as i64;
    let fts_match = build_fts_query(&query);

    let instances = app.state::<DbInstances>();
    let db_map = instances.0.read().await;
    let db = db_map
        .get("sqlite:contract-ide.db")
        .ok_or("DB not loaded")?;
    let pool = match db {
        tauri_plugin_sql::DbPool::Sqlite(p) => p.clone(),
        #[allow(unreachable_patterns)]
        _ => return Err("only sqlite supported".to_string()),
    };
    drop(db_map); // Release RwLock before async DB work (sqlx clone-and-drop pattern)

    // FTS5 MATCH with full contract body and human_pinned.
    // The `rank` column in nodes_fts is BM25 (more negative = more relevant).
    #[allow(clippy::type_complexity)]
    let rows: Vec<(String, String, String, String, String, i64, String, f64)> =
        sqlx::query_as(
            r#"
            SELECT n.uuid, n.name, n.level, n.kind,
                   COALESCE(n.contract_body, '') AS body,
                   COALESCE(n.human_pinned, 0) AS human_pinned,
                   snippet(nodes_fts, -1, '**', '**', '...', 20) AS snippet,
                   nodes_fts.rank AS fts_rank
            FROM nodes_fts
            JOIN nodes n ON n.uuid = nodes_fts.uuid
            WHERE nodes_fts MATCH ?1
            ORDER BY nodes_fts.rank
            LIMIT ?2
            "#,
        )
        .bind(&fts_match)
        .bind(cap)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    if rows.is_empty() {
        return Ok(MassMatchResponse {
            query,
            embedding_status: "disabled".to_string(),
            matches: vec![],
        });
    }

    // Section-weighted re-ranking:
    // ftsRank is BM25 (negative; more negative = more relevant).
    // Invert to positive score, multiply by section weight, sort descending.
    let mut results: Vec<MassMatchResult> = rows
        .into_iter()
        .map(|(uuid, name, level, kind, body, human_pinned, snippet, fts_rank)| {
            let positive_score = -fts_rank; // invert BM25
            let sections = parse_sections_via_cli(&body);
            let (weighted_score, matched_section) = if let Some(ref secs) = sections {
                let sec_name = find_snippet_section(&snippet, secs);
                let weight = sec_name
                    .as_deref()
                    .map(section_weight)
                    .unwrap_or(1.0);
                (positive_score * weight, sec_name)
            } else {
                (positive_score, None)
            };

            MassMatchResult {
                uuid,
                name,
                level,
                kind,
                snippet,
                body,
                human_pinned: human_pinned != 0,
                weighted_score,
                matched_section,
            }
        })
        .collect();

    // Sort descending by weighted_score (highest = best match)
    results.sort_by(|a, b| {
        b.weighted_score
            .partial_cmp(&a.weighted_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    Ok(MassMatchResponse {
        query,
        embedding_status: "disabled".to_string(),
        matches: results,
    })
}

#[cfg(test)]
mod fts_query_tests {
    use super::build_fts_query;

    #[test]
    fn natural_language_or_tokenizes() {
        let q = build_fts_query("add audit logging to every destructive endpoint");
        assert_eq!(
            q,
            r#""add" OR "audit" OR "logging" OR "to" OR "every" OR "destructive" OR "endpoint""#
        );
    }

    #[test]
    fn structured_or_passes_through() {
        let q = build_fts_query("audit OR destructive");
        assert_eq!(q, "audit OR destructive");
    }

    #[test]
    fn structured_and_passes_through() {
        let q = build_fts_query("audit AND logging");
        assert_eq!(q, "audit AND logging");
    }

    #[test]
    fn quoted_phrase_passes_through() {
        let q = build_fts_query(r#""destructive endpoint""#);
        assert_eq!(q, r#""destructive endpoint""#);
    }

    #[test]
    fn punctuation_splits_tokens() {
        let q = build_fts_query("delete: account-button.tsx");
        assert_eq!(q, r#""delete" OR "account" OR "button" OR "tsx""#);
    }

    #[test]
    fn empty_returns_empty() {
        assert_eq!(build_fts_query(""), "");
        assert_eq!(build_fts_query("   "), "");
    }

    #[test]
    fn single_term_quoted() {
        let q = build_fts_query("destructive");
        assert_eq!(q, r#""destructive""#);
    }
}
