//! Receipts persistence + defensive JSONL parser + cost-rate constants.
//!
//! The session JSONL format used by Claude Code stores conversation turns as
//! newline-delimited JSON. Each line is an independent JSON object. This parser
//! is deliberately defensive: malformed lines are skipped (eprintln!), never
//! panicked. If ALL lines fail (or the file is missing), `parse_session_jsonl`
//! returns Err and the caller uses `mock_receipt` to ensure the UI never blanks.
//!
//! MERGED COLUMN NAMES (08-01 schema):
//!   - `tool_call_count`      (NOT `tool_calls`)
//!   - `estimated_cost_usd`   (NOT `est_cost_usd`)
//!
//! W3 FIX: wall_time_ms is passed in from agent.rs which measures it via
//! Instant::now() deltas around spawn. It is NOT derived from JSONL timestamps.

use serde_json::Value;
use sqlx::Row;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};
use tauri_plugin_sql::DbInstances;

// ---------------------------------------------------------------------------
// Cost-rate constants (verified 2026-04 per Anthropic published rates).
// Match by model substring. Default to opus-4-7 rates if no substring matches.
// ---------------------------------------------------------------------------
const COST_RATES: &[(&str, f64, f64)] = &[
    // (model_substring, input_per_1m_tokens_usd, output_per_1m_tokens_usd)
    ("opus-4-7", 15.00, 75.00),
    ("sonnet-4-5", 3.00, 15.00),
    ("haiku-4", 1.00, 5.00),
];

fn cost_rate_for_model(model: &str) -> (f64, f64) {
    for (substr, input_rate, output_rate) in COST_RATES {
        if model.contains(substr) {
            return (*input_rate, *output_rate);
        }
    }
    // Default: opus-4-7 rates.
    (15.00, 75.00)
}

fn compute_cost(input_tokens: u64, output_tokens: u64, model: &str) -> f64 {
    let (input_rate, output_rate) = cost_rate_for_model(model);
    (input_tokens as f64 / 1_000_000.0) * input_rate
        + (output_tokens as f64 / 1_000_000.0) * output_rate
}

// ---------------------------------------------------------------------------
// ParseStatus
// ---------------------------------------------------------------------------
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseStatus {
    Ok,
    FallbackMock,
}

impl ParseStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            ParseStatus::Ok => "ok",
            ParseStatus::FallbackMock => "fallback_mock",
        }
    }
}

// ---------------------------------------------------------------------------
// ParseError
// ---------------------------------------------------------------------------
#[derive(Debug)]
pub struct ParseError(pub String);

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "ParseError: {}", self.0)
    }
}

impl std::error::Error for ParseError {}

// ---------------------------------------------------------------------------
// SessionReceipt
// ---------------------------------------------------------------------------
#[derive(Debug, Clone)]
pub struct SessionReceipt {
    pub tracking_id: String,
    pub session_id: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub tool_call_count: u64,
    pub estimated_cost_usd: f64,
    pub raw_jsonl_path: PathBuf,
    pub parse_status: ParseStatus,
    pub wall_time_ms: Option<u64>,
    pub model: Option<String>,
    /// Raw relative file paths extracted from Write/Edit/MultiEdit tool_use blocks.
    pub touched_files: Vec<String>,
    /// UUIDs resolved via SQLite lookup against touched_files (populated by parse_and_persist).
    pub nodes_touched_uuids: Vec<String>,
}

// ---------------------------------------------------------------------------
// encode_cwd helper
//
// Maps an absolute path like /Users/yang/lahacks/contract-ide to
// -Users-yang-lahacks-contract-ide (leading slash → leading dash,
// remaining separators → dash).
// ---------------------------------------------------------------------------
pub fn encode_cwd(path: &Path) -> String {
    let s = path.to_string_lossy();
    // Replace all '/' (including leading) with '-'.
    s.replace('/', "-")
}

// ---------------------------------------------------------------------------
// parse_session_jsonl — defensive JSONL parser
// ---------------------------------------------------------------------------
pub fn parse_session_jsonl(path: &Path, tracking_id: &str) -> Result<SessionReceipt, ParseError> {
    let content = std::fs::read_to_string(path).map_err(|e| ParseError(format!("{e}")))?;

    let mut input_tokens: u64 = 0;
    let mut output_tokens: u64 = 0;
    let mut cache_read_tokens: u64 = 0;
    let mut tool_call_count: u64 = 0;
    let mut started_at: Option<String> = None;
    let mut finished_at: Option<String> = None;
    let mut model: Option<String> = None;
    let mut session_id = String::new();
    let mut touched_files_set = BTreeSet::new();
    let mut parsed_any = false;

    for (line_num, line) in content.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let v: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(e) => {
                eprintln!(
                    "[receipts] line {}: skipping malformed JSON: {e}",
                    line_num + 1
                );
                continue;
            }
        };

        parsed_any = true;

        // Extract session_id (camelCase in the real file format).
        if let Some(sid) = v.get("sessionId").and_then(|s| s.as_str()) {
            if !sid.is_empty() && session_id.is_empty() {
                session_id = sid.to_owned();
            }
        }

        let event_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");

        match event_type {
            "user" => {
                // Track started_at from first user line timestamp.
                if started_at.is_none() {
                    if let Some(ts) = v.get("timestamp").and_then(|t| t.as_str()) {
                        started_at = Some(ts.to_owned());
                    }
                }
            }
            "assistant" => {
                let msg = match v.get("message") {
                    Some(m) => m,
                    None => continue,
                };

                // Update model from first assistant line with model set.
                if model.is_none() {
                    if let Some(m) = msg.get("model").and_then(|m| m.as_str()) {
                        if !m.is_empty() {
                            model = Some(m.to_owned());
                        }
                    }
                }

                // Accumulate token usage.
                if let Some(usage) = msg.get("usage") {
                    input_tokens += usage
                        .get("input_tokens")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    input_tokens += usage
                        .get("cache_creation_input_tokens")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    output_tokens += usage
                        .get("output_tokens")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    cache_read_tokens += usage
                        .get("cache_read_input_tokens")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                }

                // Count tool_use blocks and collect touched files.
                if let Some(content_arr) = msg.get("content").and_then(|c| c.as_array()) {
                    for item in content_arr {
                        let item_type = item.get("type").and_then(|t| t.as_str()).unwrap_or("");
                        if item_type == "tool_use" {
                            tool_call_count += 1;

                            let name = item.get("name").and_then(|n| n.as_str()).unwrap_or("");
                            // Only Write/Edit/MultiEdit produce behavior changes.
                            // Read does NOT count (no behavior change).
                            if matches!(name, "Write" | "Edit" | "MultiEdit") {
                                let input = item.get("input");
                                let file_path = input
                                    .and_then(|i| {
                                        i.get("file_path")
                                            .or_else(|| i.get("path"))
                                            .and_then(|p| p.as_str())
                                    })
                                    .unwrap_or("");
                                if !file_path.is_empty() {
                                    touched_files_set.insert(file_path.to_owned());
                                }
                            }
                        }
                    }
                }

                // Track finished_at from last assistant line timestamp.
                if let Some(ts) = v.get("timestamp").and_then(|t| t.as_str()) {
                    finished_at = Some(ts.to_owned());
                }
            }
            _ => {
                // Unknown or unhandled type — skip silently.
            }
        }
    }

    if !parsed_any {
        return Err(ParseError("no parseable lines in file".to_string()));
    }

    // If session_id wasn't found in the JSONL, use the filename stem.
    if session_id.is_empty() {
        session_id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_owned();
    }

    let model_str = model.clone().unwrap_or_else(|| "claude-opus-4-7".to_string());
    let estimated_cost_usd = compute_cost(input_tokens, output_tokens, &model_str);

    Ok(SessionReceipt {
        tracking_id: tracking_id.to_owned(),
        session_id,
        started_at,
        finished_at,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        tool_call_count,
        estimated_cost_usd,
        raw_jsonl_path: path.to_path_buf(),
        parse_status: ParseStatus::Ok,
        wall_time_ms: None, // filled by caller (agent.rs) via Instant deltas (W3)
        model,
        touched_files: touched_files_set.into_iter().collect(),
        nodes_touched_uuids: Vec::new(), // populated by parse_and_persist
    })
}

// ---------------------------------------------------------------------------
// mock_receipt — always returns a safe fallback (never panics)
// ---------------------------------------------------------------------------
pub fn mock_receipt(tracking_id: &str, raw_jsonl_path: PathBuf) -> SessionReceipt {
    SessionReceipt {
        tracking_id: tracking_id.to_owned(),
        session_id: "mock".to_owned(),
        started_at: None,
        finished_at: None,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        tool_call_count: 0,
        estimated_cost_usd: 0.0,
        raw_jsonl_path,
        parse_status: ParseStatus::FallbackMock,
        wall_time_ms: None,
        model: None,
        touched_files: Vec::new(),
        nodes_touched_uuids: Vec::new(),
    }
}

// ---------------------------------------------------------------------------
// parse_and_persist — parse JSONL, resolve touched UUIDs, INSERT receipt row
// ---------------------------------------------------------------------------
pub async fn parse_and_persist(
    app: &tauri::AppHandle,
    tracking_id: &str,
    jsonl_path: &Path,
    scope_uuid: Option<&str>,
    wall_time_ms: Option<u64>,
    substrate_rules_json: Option<&str>, // Phase 15 TRUST-03: JSON array of substrate hit UUIDs
) -> Result<SessionReceipt, String> {
    // Parse (with mock fallback on any error).
    let mut receipt = match parse_session_jsonl(jsonl_path, tracking_id) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[receipts] parse error for {tracking_id}: {e}");
            mock_receipt(tracking_id, jsonl_path.to_path_buf())
        }
    };

    // Inject wall_time_ms from agent.rs (W3 — authoritative wall-clock).
    receipt.wall_time_ms = wall_time_ms;

    // Fetch DB pool.
    let instances = app.state::<DbInstances>();
    let db_map = instances.0.read().await;
    let db = db_map
        .get("sqlite:contract-ide.db")
        .ok_or("DB not loaded")?;
    let pool = match db {
        tauri_plugin_sql::DbPool::Sqlite(p) => p,
        #[allow(unreachable_patterns)]
        _ => return Err("only sqlite supported".to_string()),
    };

    // Resolve affected UUIDs from touched_files (B-fix — populates nodes_touched column).
    let mut affected_uuids = BTreeSet::new();
    if let Some(su) = scope_uuid {
        affected_uuids.insert(su.to_owned());
    }
    for file_path in &receipt.touched_files {
        let rows = sqlx::query(
            r#"SELECT DISTINCT n.uuid
               FROM nodes n, json_each(n.code_ranges) je
               WHERE json_extract(je.value, '$.file') = ?1"#,
        )
        .bind(file_path)
        .fetch_all(pool)
        .await
        .unwrap_or_default();
        for row in rows {
            if let Ok(uuid) = row.try_get::<String, _>("uuid") {
                affected_uuids.insert(uuid);
            }
        }
    }
    receipt.nodes_touched_uuids = affected_uuids.iter().cloned().collect();

    // Serialize nodes_touched as JSON array.
    let nodes_touched_json =
        serde_json::to_string(&receipt.nodes_touched_uuids).unwrap_or_else(|_| "[]".to_string());

    // Generate receipt id.
    let receipt_id = uuid::Uuid::new_v4().to_string();
    let transcript_path = jsonl_path.to_string_lossy().to_string();
    let raw_jsonl_path_str = transcript_path.clone();
    let parse_status_str = receipt.parse_status.as_str();

    // INSERT INTO receipts — uses 08-01 merged column list + Phase 15 substrate_rules_json.
    sqlx::query(
        r#"INSERT INTO receipts (
             id, session_id, transcript_path, started_at, finished_at,
             input_tokens, output_tokens, cache_read_tokens, tool_call_count,
             nodes_touched, estimated_cost_usd, raw_summary,
             raw_jsonl_path, parse_status, wall_time_ms,
             substrate_rules_json
           ) VALUES (?1,?2,?3,?4,?5, ?6,?7,?8,?9, ?10,?11,?12, ?13,?14,?15, ?16)"#,
    )
    .bind(&receipt_id)
    .bind(&receipt.session_id)
    .bind(&transcript_path)
    .bind(&receipt.started_at)
    .bind(&receipt.finished_at)
    .bind(receipt.input_tokens as i64)
    .bind(receipt.output_tokens as i64)
    .bind(receipt.cache_read_tokens as i64)
    .bind(receipt.tool_call_count as i64)
    .bind(&nodes_touched_json)
    .bind(receipt.estimated_cost_usd)
    .bind(Option::<String>::None) // raw_summary — not used in Phase 8
    .bind(&raw_jsonl_path_str)
    .bind(parse_status_str)
    .bind(receipt.wall_time_ms.map(|v| v as i64))
    .bind(substrate_rules_json)                     // Phase 15 TRUST-03: ?16
    .execute(pool)
    .await
    .map_err(|e| format!("INSERT receipts failed: {e}"))?;

    // INSERT INTO receipt_nodes join table for each affected UUID.
    for node_uuid in &receipt.nodes_touched_uuids {
        let _ = sqlx::query(
            "INSERT OR IGNORE INTO receipt_nodes (receipt_id, node_uuid) VALUES (?1, ?2)",
        )
        .bind(&receipt_id)
        .bind(node_uuid)
        .execute(pool)
        .await;
    }

    // Emit receipt:created event.
    let _ = app.emit(
        "receipt:created",
        serde_json::json!({
            "receipt_id": receipt_id,
            "tracking_id": tracking_id,
            "session_id": receipt.session_id,
            "input_tokens": receipt.input_tokens,
            "output_tokens": receipt.output_tokens,
            "tool_call_count": receipt.tool_call_count,
            "estimated_cost_usd": receipt.estimated_cost_usd,
            "parse_status": parse_status_str,
            "wall_time_ms": receipt.wall_time_ms,
            "nodes_touched": receipt.nodes_touched_uuids,
        }),
    );

    Ok(receipt)
}

// ---------------------------------------------------------------------------
// list_receipts_for_node — Tauri command
// ---------------------------------------------------------------------------
/// Returns receipts associated with a node UUID, ordered by most recent first.
/// Used by the receipt-history tab in the Inspector.
#[tauri::command]
pub async fn list_receipts_for_node(
    app: tauri::AppHandle,
    node_uuid: String,
) -> Result<Vec<serde_json::Value>, String> {
    let instances = app.state::<DbInstances>();
    let db_map = instances.0.read().await;
    let db = db_map
        .get("sqlite:contract-ide.db")
        .ok_or("DB not loaded")?;
    let pool = match db {
        tauri_plugin_sql::DbPool::Sqlite(p) => p,
        #[allow(unreachable_patterns)]
        _ => return Err("only sqlite supported".to_string()),
    };

    let rows = sqlx::query(
        r#"SELECT r.id, r.session_id, r.transcript_path, r.started_at, r.finished_at,
                  r.input_tokens, r.output_tokens, r.cache_read_tokens, r.tool_call_count,
                  r.nodes_touched, r.estimated_cost_usd, r.raw_summary,
                  r.raw_jsonl_path, r.parse_status, r.wall_time_ms, r.created_at
           FROM receipts r
           JOIN receipt_nodes rn ON rn.receipt_id = r.id
           WHERE rn.node_uuid = ?1
           ORDER BY COALESCE(r.started_at, r.created_at) DESC"#,
    )
    .bind(&node_uuid)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut results = Vec::with_capacity(rows.len());
    for row in rows {
        results.push(serde_json::json!({
            "id": row.try_get::<String, _>("id").unwrap_or_default(),
            "session_id": row.try_get::<String, _>("session_id").unwrap_or_default(),
            "transcript_path": row.try_get::<Option<String>, _>("transcript_path").unwrap_or(None),
            "started_at": row.try_get::<Option<String>, _>("started_at").unwrap_or(None),
            "finished_at": row.try_get::<Option<String>, _>("finished_at").unwrap_or(None),
            "input_tokens": row.try_get::<i64, _>("input_tokens").unwrap_or(0),
            "output_tokens": row.try_get::<i64, _>("output_tokens").unwrap_or(0),
            "cache_read_tokens": row.try_get::<i64, _>("cache_read_tokens").unwrap_or(0),
            "tool_call_count": row.try_get::<i64, _>("tool_call_count").unwrap_or(0),
            "nodes_touched": row.try_get::<Option<String>, _>("nodes_touched").unwrap_or(None),
            "estimated_cost_usd": row.try_get::<f64, _>("estimated_cost_usd").unwrap_or(0.0),
            "raw_summary": row.try_get::<Option<String>, _>("raw_summary").unwrap_or(None),
            "raw_jsonl_path": row.try_get::<Option<String>, _>("raw_jsonl_path").unwrap_or(None),
            "parse_status": row.try_get::<Option<String>, _>("parse_status").unwrap_or(None),
            "wall_time_ms": row.try_get::<Option<i64>, _>("wall_time_ms").unwrap_or(None),
            "created_at": row.try_get::<String, _>("created_at").unwrap_or_default(),
        }));
    }

    Ok(results)
}
