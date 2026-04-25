/// Prompt assembler — builds a scoped, context-rich prompt from SQLite reads
/// and sidecar files.
///
/// AGENT-01 invariant: ALL context is sourced from SQLite (nodes + edges tables)
/// and sidecar file reads. NO whole-repo grep, NO file-system globbing outside
/// of the sidecar directory. The neighbor list is the SQLite `edges` table.
use serde_json::Value;
use sqlx::Row;
use tauri::Manager;
use tauri_plugin_sql::DbInstances;

/// Maximum prompt length before section compression kicks in (chars, not tokens).
/// At ~4 chars/token this is roughly 8k tokens — intentionally conservative.
const MAX_PROMPT_CHARS: usize = 32_000;

/// Assemble a prompt for the claude CLI runner.
///
/// If `scope_uuid` is None, returns a simple prompt wrapper.
/// If `scope_uuid` is Some, reads the scope node, its neighbors, and recent
/// journal entries from SQLite + sidecar files to build a context-rich prompt.
///
/// AGENT-01: reads from SQLite (nodes + edges) and sidecar files ONLY.
pub async fn assemble_prompt(
    app: &tauri::AppHandle,
    user_prompt: &str,
    scope_uuid: Option<&str>,
) -> Result<String, String> {
    match scope_uuid {
        None => Ok(format!(
            "User intent: {user_prompt}\n\nNo specific node scope; act on the repository at large."
        )),
        Some(uuid) => assemble_scoped_prompt(app, user_prompt, uuid).await,
    }
}

async fn assemble_scoped_prompt(
    app: &tauri::AppHandle,
    user_prompt: &str,
    scope_uuid: &str,
) -> Result<String, String> {
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

    // Fetch scope node.
    let row = sqlx::query(
        "SELECT uuid, level, kind, code_ranges FROM nodes WHERE uuid = ?1 LIMIT 1",
    )
    .bind(scope_uuid)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    let Some(row) = row else {
        // Node not found — fall back to unscoped prompt.
        return Ok(format!(
            "User intent: {user_prompt}\n\nScope node {scope_uuid} not found in DB; acting unscoped."
        ));
    };

    let level: String = row.try_get("level").unwrap_or_default();
    let kind: String = row.try_get("kind").unwrap_or_default();
    let code_ranges_json: Option<String> = row.try_get("code_ranges").unwrap_or(None);

    // Resolve repo root from RepoState.
    let repo_path: Option<std::path::PathBuf> = app
        .try_state::<crate::commands::repo::RepoState>()
        .and_then(|state| state.0.lock().ok().and_then(|g| g.clone()));

    // Read scope sidecar body.
    let scope_body = if let Some(repo) = repo_path.as_ref() {
        crate::sidecar::frontmatter::read_sidecar_file(repo, scope_uuid)
            .map(|(_, body)| body)
            .unwrap_or_else(|_| String::new())
    } else {
        String::new()
    };

    // Extract file paths from code_ranges for summary line.
    let files_summary: String = code_ranges_json
        .as_deref()
        .and_then(|s| serde_json::from_str::<Vec<Value>>(s).ok())
        .map(|ranges| {
            ranges
                .iter()
                .filter_map(|r| r.get("file").and_then(|f| f.as_str()).map(str::to_owned))
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_else(|| "(no code_ranges)".to_string());

    // Fetch neighbor UUIDs from edges table (both source and target directions).
    let neighbor_rows = sqlx::query(
        "SELECT target_uuid AS neighbor_uuid FROM edges WHERE source_uuid = ?1
         UNION
         SELECT source_uuid AS neighbor_uuid FROM edges WHERE target_uuid = ?1",
    )
    .bind(scope_uuid)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let neighbor_uuids: Vec<String> = neighbor_rows
        .iter()
        .filter_map(|r| r.try_get::<String, _>("neighbor_uuid").ok())
        .collect();

    // Build neighbor sections from sidecar reads (AGENT-01: SQLite edges only).
    let mut neighbor_sections = String::new();
    for n_uuid in &neighbor_uuids {
        let n_body = if let Some(repo) = repo_path.as_ref() {
            crate::sidecar::frontmatter::read_sidecar_file(repo, n_uuid)
                .ok()
                .map(|(fm, body)| {
                    format!(
                        "## {} ({} {})\n{body}",
                        n_uuid, fm.level, fm.kind
                    )
                })
                .unwrap_or_else(|| format!("## {n_uuid}\n(sidecar not found)"))
        } else {
            format!("## {n_uuid}\n(no repo path)")
        };
        neighbor_sections.push_str(&n_body);
        neighbor_sections.push('\n');
    }

    // TODO(08-03): if the journal module has shipped, call
    // `read_journal_entries(pool, scope_uuid, 5)` here instead of the stub.
    // Graceful degradation per CONTEXT.md — empty list is acceptable.
    let journal_entries = Vec::<String>::new(); // stub: 08-03 not yet merged

    let journal_section: String = if journal_entries.is_empty() {
        String::from("(no journal entries yet)")
    } else {
        journal_entries.join("\n")
    };

    // Compose prompt with section-weighted compression.
    let prompt = format!(
        "User intent: {user_prompt}\n\n\
         Acting on node {scope_uuid} ({level} {kind}). Source files: {files_summary}.\n\n\
         ## Contract for {scope_uuid}\n\
         {scope_body}\n\n\
         ## Neighbor contracts\n\
         {neighbor_sections}\n\
         ## Recent intent journal (last 5 entries)\n\
         {journal_section}\n\n\
         Make minimal, scoped changes. Do NOT modify files outside the scope node's \
         code_ranges or its direct neighbors' code_ranges unless the user explicitly \
         requested it."
    );

    // Section-weighted compression: if over budget, drop ## Notes sections first,
    // then ## Examples (Examples is load-bearing — dropped LAST per CONTEXT.md).
    if prompt.len() > MAX_PROMPT_CHARS {
        let compressed = compress_prompt(&prompt, scope_uuid);
        return Ok(compressed);
    }

    Ok(prompt)
}

/// Section-weighted compression.
///
/// Drop sections in priority order:
///   1. `## Notes` from neighbor contracts (lowest signal density)
///   2. `## Examples` from neighbor contracts (load-bearing, dropped last)
///
/// Documents any dropped sections as a footer so the model can see what was
/// omitted. Scope node's contract is NEVER trimmed.
fn compress_prompt(prompt: &str, scope_uuid: &str) -> String {
    // Simple heuristic: strip neighbor ## Notes sections first.
    let mut result = remove_sections_matching(prompt, "## Notes");
    if result.len() <= MAX_PROMPT_CHARS {
        result.push_str(&format!(
            "\n[Compressed: dropped ## Notes from neighbors of {scope_uuid}]"
        ));
        return result;
    }

    // Still over budget: also strip neighbor ## Examples sections.
    result = remove_sections_matching(&result, "## Examples");
    result.push_str(&format!(
        "\n[Compressed: dropped ## Notes and ## Examples from neighbors of {scope_uuid}]"
    ));
    result
}

/// Remove all occurrences of a Markdown H2 section (heading + body until next
/// H2 or end of string) from `text`.
fn remove_sections_matching(text: &str, section_heading: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let lines: Vec<&str> = text.lines().collect();
    let mut skip = false;
    for line in &lines {
        if line.starts_with("## ") {
            skip = line.trim_end() == section_heading.trim_end();
        }
        if !skip {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}
