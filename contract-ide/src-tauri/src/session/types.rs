use serde::{Deserialize, Serialize};

/// One filtered conversational turn extracted from a JSONL line.
/// Produced by `ingestor::filter_session_lines`, consumed by
/// `ingestor::chunk_episodes`. Not persisted directly — only `Episode`s are.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilteredTurn {
    /// "user" or "assistant"
    pub role: String,
    pub text: String,
    /// 0-based line index in the source JSONL
    pub line_index: usize,
    /// ISO-8601 timestamp from the JSONL line; empty if unavailable on assistant lines
    #[serde(default)]
    pub timestamp: String,
}

/// One episode = (one user prompt + all following assistant turns) until the
/// next user prompt. Persisted as one row in the `episodes` table by
/// `ingestor::ingest_session_file`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Episode {
    /// `sha256(session_id + ":" + start_line)` — deterministic, stable across re-ingest.
    pub episode_id: String,
    pub session_id: String,
    pub start_line: usize,
    pub end_line: usize,
    /// Concatenated `[User]: ... \n [Assistant]: ...` text — preserves role prefixes.
    pub filtered_text: String,
    /// `sha256(filtered_text)` — Phase 11 distiller can use this to detect content change
    /// even when episode_id stays stable (e.g., compacted session edge case).
    pub content_hash: String,
    /// Count of user turns this episode contains (always 1 for v1; future: merged episodes).
    pub turn_count: u32,
}

/// One row from the `sessions` table — used by `list_ingested_sessions` MCP tool
/// + `SessionStatusIndicator` UI.
///
/// TODO(Plan 10-03): consumed by `commands::session::list_ingested_sessions`.
/// Remove `#[allow(dead_code)]` then.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRow {
    pub session_id: String,
    pub cwd_key: String,
    pub repo_path: Option<String>,
    pub started_at: String,
    pub last_seen_at: String,
    pub episode_count: i64,
    pub bytes_raw: i64,
    pub bytes_filtered: i64,
    pub last_line_index: i64,
    pub state: String,
    pub ingested_at: String,
}

/// Backfill preview for one session — returned by `get_backfill_preview` Tauri
/// command (10-03) before any ingestion runs (SC4 opt-in confirmation).
///
/// IMPORTANT: `estimated_tokens = filtered_chars / 4` — heuristic only. NO Claude
/// API call is made for this estimate (Phase 10 makes ZERO LLM calls). Phase 11's
/// distiller will report actual tokens on its receipt.
///
/// TODO(Plan 10-03): consumed by `commands::session::get_backfill_preview`.
/// Remove `#[allow(dead_code)]` then.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackfillPreview {
    pub session_id: String,
    pub estimated_tokens: u64,
    pub estimated_cost_usd: f64,
    pub episode_count_estimate: u32,
    /// Raw file size in bytes — UI displays alongside estimate.
    pub bytes_raw: u64,
    /// File mtime — UI sorts by this descending so user sees most recent first.
    pub mtime_iso: String,
}
