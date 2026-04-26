use crate::retrieval::{candidates::candidate_selection, rerank::llm_rerank, scope::lineage_scope_uuids, SubstrateHit};
use serde::Serialize;
use sqlx::SqlitePool;
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool};

#[derive(Debug, Serialize)]
pub struct ComposeResult {
    pub hits: Vec<SubstrateHit>,
    pub assembled_prompt: String,
}

/// Canonical async pool extraction — mirrors commands/nodes.rs canonical pattern.
/// Returns owned pool clone (cheap — Arc internally) and drops the read guard
/// before any subsequent .await.
async fn pool_clone(app: &AppHandle) -> Result<SqlitePool, String> {
    let instances = app.state::<DbInstances>();
    let db_map = instances.0.read().await;
    let db = db_map.get("sqlite:contract-ide.db").ok_or("DB not loaded")?;
    let pool = match db {
        DbPool::Sqlite(p) => p.clone(),
        #[allow(unreachable_patterns)]
        _ => return Err("expected sqlite pool".into()),
    };
    // Read guard drops here — pool clone is cheap (Arc internally).
    Ok(pool)
}

/// Real `nodes` columns only — NO intent/role separate columns; those concepts live inside
/// contract_body markdown.
#[derive(sqlx::FromRow)]
struct ContractRow {
    uuid: String,
    level: String,
    parent_uuid: Option<String>,
    contract_body: Option<String>,
    name: String,
}

impl ComposeResult {
    /// Serialize substrate hit UUIDs to a JSON array string like `["uuid1","uuid2"]`,
    /// or None when there are no hits. Bound onto receipts.substrate_rules_json
    /// downstream so TRUST-03 impact preview can count real recent prompts that
    /// included the rule.
    pub fn substrate_rules_json(&self) -> Option<String> {
        if self.hits.is_empty() {
            return None;
        }
        let uuids: Vec<&str> = self.hits.iter().map(|h| h.uuid.as_str()).collect();
        serde_json::to_string(&uuids).ok()
    }
}

pub async fn compose_prompt(
    app: &AppHandle,
    scope_uuid: &str,
) -> Result<ComposeResult, String> {
    // 1. Load contract body + level + parent_uuid from nodes table (REAL columns).
    let pool = pool_clone(app).await?;
    let contract: ContractRow = sqlx::query_as(
        "SELECT uuid, level, parent_uuid, contract_body, name FROM nodes WHERE uuid = ?"
    )
    .bind(scope_uuid)
    .fetch_optional(&pool)
    .await
    .map_err(|e| format!("contract lookup (uuid={scope_uuid}): {e}"))?
    .ok_or_else(|| {
        format!(
            "contract lookup: no node found for scope_uuid={scope_uuid}. \
             The selected node may belong to a different repo or have been removed by a rescan. \
             Try clicking another node, or reopen the repo to refresh the canonical nodes table."
        )
    })?;

    let body = contract
        .contract_body
        .clone()
        .unwrap_or_else(|| "(no contract body)".to_string());

    // 2. Walk lineage (parent + ancestors + siblings + self)
    let lineage_uuids = lineage_scope_uuids(&pool, scope_uuid).await?;
    let lineage_text = render_lineage_text(&pool, &lineage_uuids).await?;

    // 3. Candidate selection (top-15 from FTS5, cousins excluded via anchored_uuids JOIN)
    // + LLM rerank top-5
    let candidates = candidate_selection(
        &pool,
        &lineage_uuids,
        &body,
        None, // query_embedding — None for v1 FTS5-only path
        15,
    )
    .await?;

    // No need to drop pool — it's an owned clone; safe to .await on the rerank call alongside.
    let hits = if candidates.len() > 5 {
        llm_rerank(app, &body, &candidates, 5).await?
    } else {
        candidates
    };

    // 4. Assemble final prompt — send contract_body verbatim (LLM reads markdown intent/role)
    let hits_block = hits
        .iter()
        .enumerate()
        .map(|(i, h)| {
            format!(
                "[{}] {} ({}): {}\n   applies_when: {}\n   source: session={} turn={}",
                i + 1,
                h.node_type,
                h.confidence,
                h.text,
                h.applies_when.as_deref().unwrap_or("(none)"),
                h.source_session_id.as_deref().unwrap_or("none"),
                h.source_turn_ref
                    .map(|n| n.to_string())
                    .unwrap_or_else(|| "?".to_string()),
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    let _parent_note = contract
        .parent_uuid
        .as_deref()
        .map(|p| format!("parent uuid={p}"))
        .unwrap_or_else(|| "(root node)".to_string());

    let assembled_prompt = format!(
        r#"You are implementing a contract. Read the contract body carefully (it includes intent and role expressed in markdown), honor every applicable substrate rule, and write code that satisfies the intent.

# Contract: {name} (uuid={uuid}, Level {level})

## Contract Body

{body}

# Lineage Context (parent surface + ancestors + sibling atoms)

{lineage_text}

# Substrate Rules (top-5 retrieved, ranked by relevance)

{hits_block}

# Your task

Implement the contract above. Honor every substrate rule whose `applies_when` matches the work. Cite the substrate rule by its index (e.g. "per [3]") in your reasoning when applying it. If a rule's applies_when does not match this contract, ignore it (the retrieval may be over-eager).

**Exact values are exact.** When a substrate rule names a literal value — a color hex (`#FF0000`), a duration (`24h`, `30 days`), an identifier, an endpoint — apply that exact value verbatim. Do not paraphrase, round, or substitute a semantic equivalent (e.g. do NOT pick a Tailwind utility like `red-600` in place of `#FF0000`; do NOT pick `1d` in place of `24h`). The literal IS the rule."#,
        uuid = contract.uuid,
        name = contract.name,
        level = contract.level,
        body = body,
    );

    Ok(ComposeResult {
        hits,
        assembled_prompt,
    })
}

async fn render_lineage_text(pool: &SqlitePool, uuids: &[String]) -> Result<String, String> {
    if uuids.is_empty() {
        return Ok("(no lineage — root or unscoped)".to_string());
    }
    let placeholders = std::iter::repeat_n("?", uuids.len())
        .collect::<Vec<_>>()
        .join(",");
    // SELECT real columns only — no intent/role.
    let q = format!("SELECT uuid, level, name FROM nodes WHERE uuid IN ({placeholders})");
    let mut q = sqlx::query_as::<_, (String, String, String)>(&q);
    for u in uuids {
        q = q.bind(u);
    }
    let rows: Vec<(String, String, String)> = q
        .fetch_all(pool)
        .await
        .map_err(|e| format!("lineage hydrate: {e}"))?;
    Ok(rows
        .into_iter()
        .map(|(uuid, level, name)| format!("- [{level}] {uuid}: {name}"))
        .collect::<Vec<_>>()
        .join("\n"))
}
