// IPC surface for contract nodes.
//
// KEEP IN SYNC with `src/ipc/types.ts::ContractNode` on the frontend.
// Divergence = silent runtime error at the invoke() boundary (serde will
// succeed on unknown fields but the TS side will see undefined).

use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqliteRow;
use sqlx::Row;
use tauri::Manager;
use tauri_plugin_sql::DbInstances;
use crate::sidecar::frontmatter::CodeRange;

/// Wire-format contract node. Field shape must match the TypeScript
/// `ContractNode` interface exactly (see `src/ipc/types.ts`).
///
/// Phase 2: `file_path` dropped in favour of `code_ranges` + `kind`
/// (DATA-01 supersedes it — see 01-02-SUMMARY.md deprecation notice).
#[derive(Debug, Serialize, Deserialize)]
pub struct ContractNode {
    pub uuid: String,
    pub level: String,
    pub name: String,
    pub kind: String,                    // NEW — DATA-01
    pub code_ranges: Vec<CodeRange>,     // NEW — DATA-01, JSON-decoded from TEXT column
    pub parent_uuid: Option<String>,
    pub is_canonical: bool,
    pub code_hash: Option<String>,
    pub contract_hash: Option<String>,
    pub human_pinned: bool,
    pub route: Option<String>,
    pub derived_at: Option<String>,
    pub contract_body: Option<String>,
    pub tags: Vec<String>,
    /// Phase 8 rollup generation counter (monotonic, 0 if absent).
    /// Used by ReconcilePanel as the optimistic-lock expected_generation.
    #[serde(default)]
    pub rollup_generation: u64,
    /// Phase 9 FLOW-01: ordered member uuids for kind:flow contracts.
    /// First element is the trigger; remainder are participants in invocation order.
    /// None / empty on all non-flow contracts.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub members: Vec<String>,
}

/// Shared hydration helper — converts SqliteRow results into ContractNode.
///
/// Used by `get_nodes` (this module) and `get_lens_nodes` (commands::graph).
/// Every SELECT that feeds into this helper MUST include the full column
/// set: uuid, level, name, kind, code_ranges, parent_uuid, is_canonical,
/// code_hash, contract_hash, human_pinned, route, derived_at, contract_body,
/// tags, rollup_generation, members_json.
///
/// Phase 9 FLOW-01 adds members_json (nullable TEXT). Use
/// `COALESCE(members_json, NULL) AS members_json` if the column might be
/// absent from older query paths (it won't be after v5 migration runs, but
/// defensive decoding with unwrap_or_default is safe).
pub fn hydrate_node_rows(rows: Vec<SqliteRow>) -> Result<Vec<ContractNode>, sqlx::Error> {
    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let code_ranges_str: Option<String> = r.try_get("code_ranges").unwrap_or(None);
        let code_ranges: Vec<CodeRange> = code_ranges_str
            .as_deref()
            .map(|s| serde_json::from_str(s).unwrap_or_default())
            .unwrap_or_default();
        let tags_str: Option<String> = r.try_get("tags").unwrap_or(None);
        let tags: Vec<String> = tags_str
            .as_deref()
            .map(|s| serde_json::from_str(s).unwrap_or_default())
            .unwrap_or_default();
        // Phase 9 FLOW-01: decode members_json (NULL for non-flow contracts).
        let members_json_str: Option<String> = r.try_get("members_json").unwrap_or(None);
        let members: Vec<String> = members_json_str
            .as_deref()
            .map(|s| serde_json::from_str(s).unwrap_or_default())
            .unwrap_or_default();
        out.push(ContractNode {
            uuid: r.try_get("uuid")?,
            level: r.try_get("level")?,
            name: r.try_get("name")?,
            kind: r.try_get("kind")?,
            code_ranges,
            parent_uuid: r.try_get("parent_uuid").ok(),
            is_canonical: r
                .try_get::<i64, _>("is_canonical")
                .map(|v| v != 0)
                .unwrap_or(true),
            code_hash: r.try_get("code_hash").ok(),
            contract_hash: r.try_get("contract_hash").ok(),
            human_pinned: r
                .try_get::<i64, _>("human_pinned")
                .map(|v| v != 0)
                .unwrap_or(false),
            route: r.try_get("route").ok(),
            derived_at: r.try_get("derived_at").ok(),
            contract_body: r.try_get("contract_body").ok(),
            tags,
            rollup_generation: r
                .try_get::<i64, _>("rollup_generation")
                .map(|v| v.max(0) as u64)
                .unwrap_or(0),
            members,
        });
    }
    Ok(out)
}

/// Return the set of contract nodes, optionally filtered by `level` or
/// `parent_uuid`. Uses the DbPool managed state injected via AppHandle.
///
/// The `app` parameter is a Tauri-injected transparent dependency — it is
/// NOT part of the JS `invoke('get_nodes', { level, parentUuid })` call.
#[tauri::command]
pub async fn get_nodes(
    app: tauri::AppHandle,
    level: Option<String>,
    parent_uuid: Option<String>,
) -> Result<Vec<ContractNode>, String> {
    let instances = app.state::<DbInstances>();
    let db_map = instances.0.read().await;
    let db = db_map.get("sqlite:contract-ide.db").ok_or("DB not loaded")?;

    let pool = match db {
        tauri_plugin_sql::DbPool::Sqlite(p) => p,
        #[allow(unreachable_patterns)]
        _ => return Err("only sqlite supported".to_string()),
    };

    let rows: Vec<SqliteRow> = sqlx::query(
        r#"
        SELECT uuid, level, name, kind, code_ranges, parent_uuid, is_canonical,
               code_hash, contract_hash, human_pinned, route, derived_at,
               contract_body, tags,
               COALESCE(rollup_generation, 0) AS rollup_generation,
               members_json
        FROM nodes
        WHERE (?1 IS NULL OR level = ?1)
          AND (?2 IS NULL OR parent_uuid = ?2)
        "#,
    )
    .bind(level)
    .bind(parent_uuid)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    hydrate_node_rows(rows).map_err(|e| e.to_string())
}
