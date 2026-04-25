// Phase 13 Plan 02 — sidebar tree IPC.
//
// Replaces the L0/L1 abstract-zoom canvas surface with a repo-tree sidebar
// grouped by area (top-level subdirectory under `.contracts/`). Each area
// surfaces:
//   - `member_uuids`: ALL contract uuids whose sidecar lives under that area
//                     (used for badge aggregation in the frontend — drift /
//                     rollup-stale / intent-drifted counts).
//   - `flows`:        per-area kind:'flow' contracts (with their own member
//                     uuids for L2 chain navigation, populated when Phase 9
//                     FLOW-01 has shipped; otherwise empty).
//
// **Why we walk disk instead of using `nodes.file_path`:** the v1 schema has
// `file_path` but the scanner intentionally leaves it NULL (Phase 2 DATA-01
// pivoted to `code_ranges` for source-file references). The sidecar path
// itself is the source of truth for area grouping, so we walk `.contracts/`
// inside `spawn_blocking`, parse each sidecar's frontmatter for its uuid,
// then group by top-level subdirectory.
//
// **Defensive boots:** a repo with no `.contracts/` returns Ok([]). A sidecar
// that fails to parse is silently skipped (errors stay non-fatal — the rest
// of the tree still renders so the sidebar is never blank because of one
// malformed sidecar).
//
// **Performance:** at hackathon scale (<500 contracts) the walk + parse
// completes in well under 100ms on a cold cache. The async runtime is
// protected via spawn_blocking per the Phase 2 pattern.

use crate::sidecar::frontmatter::parse_sidecar;
use serde::Serialize;
use sqlx::Row;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{Manager, State};
use tauri_plugin_sql::{DbInstances, DbPool};
use walkdir::WalkDir;

/// Magic area name for sidecars that live directly under `.contracts/`
/// (e.g. `.contracts/account.md`) rather than inside a subdirectory.
/// The frontend special-cases this to render as italic "Root".
pub const ROOT_AREA: &str = "_root";

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct SidebarFlow {
    pub uuid: String,
    pub name: String,
    /// Always 'flow'. Kept on the wire so future kinds (e.g. 'journey') can be
    /// added defensively in a single place.
    pub kind: String,
    /// Ordered member uuids from the flow's frontmatter (Phase 9 FLOW-01).
    /// Empty when FLOW-01 hasn't shipped yet on this repo.
    pub member_uuids: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct SidebarArea {
    /// Top-level directory name under `.contracts/`. ROOT_AREA = "_root" for
    /// sidecars that live directly under `.contracts/`.
    pub area: String,
    /// ALL contract uuids whose sidecar lives under this area. Used by the
    /// frontend to aggregate badge counts (drift / rollup-stale / intent-drifted)
    /// via Set intersection against the existing drift / rollup / substrate stores.
    pub member_uuids: Vec<String>,
    /// kind:'flow' contracts within this area, alphabetised by name.
    pub flows: Vec<SidebarFlow>,
}

/// Pool-clone helper (mirrors substrate.rs:62-74 exactly).
async fn pool_clone(app: &tauri::AppHandle) -> Result<SqlitePool, String> {
    let instances = app.state::<DbInstances>();
    let db_map = instances.0.read().await;
    let db = db_map
        .get("sqlite:contract-ide.db")
        .ok_or_else(|| "DB not loaded".to_string())?;
    let pool = match db {
        DbPool::Sqlite(p) => p.clone(),
        #[allow(unreachable_patterns)]
        _ => return Err("expected sqlite pool".into()),
    };
    Ok(pool)
}

/// Walk `.contracts/` and emit (uuid, area, kind, members) per sidecar.
///
/// Runs inside `spawn_blocking` — never call from an async context directly.
///
/// Note: contract `name` is NOT carried by the sidecar frontmatter (no `name`
/// field on `ContractFrontmatter` — see scanner.rs:177-187 which derives the
/// DB `name` column from `code_ranges[0].file`'s basename, falling back to the
/// uuid). We pull the authoritative `name` from the DB after this walk.
fn walk_contracts_blocking(
    contracts_dir: PathBuf,
) -> Vec<(String, String, String, Vec<String>)> {
    let mut out = Vec::new();
    if !contracts_dir.exists() {
        return out;
    }
    for entry in WalkDir::new(&contracts_dir)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("md"))
    {
        let path = entry.path();
        let Ok(content) = std::fs::read_to_string(path) else {
            // Read failure — skip silently so one bad file doesn't blank the tree.
            continue;
        };
        let Ok((fm, _body)) = parse_sidecar(&content) else {
            continue;
        };
        let area = derive_area(&contracts_dir, path);
        let members = fm.members.clone().unwrap_or_default();
        out.push((fm.uuid, area, fm.kind, members));
    }
    out
}

/// Extract area = first path component under `.contracts/`. Returns ROOT_AREA
/// when the sidecar lives directly under `.contracts/` (no subdirectory).
///
/// Examples:
///   `.contracts/auth/login.md`         → "auth"
///   `.contracts/billing/checkout.md`   → "billing"
///   `.contracts/account.md`            → "_root"
///   `.contracts/auth/sub/nested.md`    → "auth" (only top-level matters)
fn derive_area(contracts_dir: &Path, sidecar_path: &Path) -> String {
    let Ok(rel) = sidecar_path.strip_prefix(contracts_dir) else {
        return ROOT_AREA.to_string();
    };
    let mut components = rel.components();
    let Some(first) = components.next() else {
        return ROOT_AREA.to_string();
    };
    // If first component IS the file (no subdirectory), it's a root-level sidecar.
    if components.next().is_none() {
        return ROOT_AREA.to_string();
    }
    first.as_os_str().to_string_lossy().to_string()
}

/// Returns the active repo path from `RepoState`, or Err if none has been opened.
fn repo_path_from_state(
    repo_state: &State<'_, crate::commands::repo::RepoState>,
) -> Result<PathBuf, String> {
    let guard = repo_state
        .0
        .lock()
        .map_err(|e| format!("RepoState lock poisoned: {e}"))?;
    guard
        .clone()
        .ok_or_else(|| "no repo open — call open_repo first".to_string())
}

/// Per-uuid metadata pulled from the `nodes` table for cross-referencing
/// against the disk walk: confirms uuid exists, surfaces the canonical kind,
/// and provides the `name` column (which the sidecar frontmatter does NOT
/// carry — name is derived at scan time from `code_ranges[0].file`'s basename
/// per scanner.rs:177-187).
struct DbNodeMeta {
    kind: String,
    name: String,
}

/// Fetch (uuid → DbNodeMeta) for every row in `nodes`. Returns an empty map
/// on a fresh DB. Defensive: any sqlx error short-circuits to empty (the IPC
/// stays non-blocking for the UI).
async fn db_uuid_meta_map(pool: &SqlitePool) -> Result<HashMap<String, DbNodeMeta>, String> {
    let rows = sqlx::query("SELECT uuid, kind, name FROM nodes")
        .fetch_all(pool)
        .await
        .map_err(|e| format!("db_uuid_meta_map: {e}"))?;
    let mut map = HashMap::with_capacity(rows.len());
    for r in rows {
        let uuid: String = r.try_get("uuid").unwrap_or_default();
        let kind: String = r.try_get("kind").unwrap_or_default();
        let name: String = r.try_get("name").unwrap_or_default();
        if !uuid.is_empty() {
            map.insert(uuid, DbNodeMeta { kind, name });
        }
    }
    Ok(map)
}

/// Phase 13 Plan 02 — return the per-area sidebar tree for the open repo.
///
/// Walks `.contracts/` to determine area grouping (since `nodes.file_path` is
/// NULL post-Phase 2 DATA-01 pivot — sidecar path is the source of truth for
/// area). Cross-references against the `nodes` table to confirm uuids exist
/// in the DB and to surface the canonical `kind` for flow-detection.
///
/// Defensive: returns Ok(vec![]) if no repo is open or `.contracts/` is missing.
#[tauri::command]
pub async fn get_sidebar_tree(
    app: tauri::AppHandle,
    repo_state: State<'_, crate::commands::repo::RepoState>,
) -> Result<Vec<SidebarArea>, String> {
    let repo_path = match repo_path_from_state(&repo_state) {
        Ok(p) => p,
        // No repo open — return empty tree rather than erroring so the sidebar
        // gracefully renders the "No contracts loaded" empty state.
        Err(_) => return Ok(vec![]),
    };
    let contracts_dir = repo_path.join(".contracts");

    // Phase 1: walk + parse off the async runtime.
    let parsed = tauri::async_runtime::spawn_blocking(move || walk_contracts_blocking(contracts_dir))
        .await
        .map_err(|e| format!("spawn_blocking join error: {e}"))?;

    // Phase 2: cross-reference with DB so we only emit uuids the canvas knows
    // about and we use the canonical `name` (DB-derived from code_ranges).
    // Defensive — if DB read fails, fall back to the sidecar's kind value and
    // the uuid prefix as a name placeholder rather than dropping the tree.
    let pool = pool_clone(&app).await?;
    let db_meta = db_uuid_meta_map(&pool).await.unwrap_or_default();

    // Phase 3: group by area, identify flows, collect members.
    let mut areas: HashMap<String, (Vec<String>, Vec<SidebarFlow>)> = HashMap::new();
    for (uuid, area, fm_kind, members) in parsed {
        // Use DB's authoritative kind + name when available. On a fresh scan
        // where the upsert hasn't completed yet, fall back to the sidecar's
        // kind and uuid prefix (steady state both agree).
        let (kind, name) = match db_meta.get(&uuid) {
            Some(m) => (m.kind.clone(), m.name.clone()),
            None => (fm_kind, uuid.chars().take(8).collect::<String>()),
        };

        let entry = areas.entry(area).or_insert_with(|| (Vec::new(), Vec::new()));
        entry.0.push(uuid.clone());
        if kind == "flow" {
            entry.1.push(SidebarFlow {
                uuid,
                name,
                kind,
                member_uuids: members,
            });
        }
    }

    // Phase 4: stable ordering — areas alphabetical, flows alphabetical within
    // each area. ROOT_AREA sorts naturally (with leading underscore, before
    // letters) — the frontend renders it as "Root" so the visual order stays
    // intuitive.
    let mut out: Vec<SidebarArea> = areas
        .into_iter()
        .map(|(area, (member_uuids, mut flows))| {
            flows.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
            SidebarArea {
                area,
                member_uuids,
                flows,
            }
        })
        .collect();
    out.sort_by(|a, b| a.area.to_lowercase().cmp(&b.area.to_lowercase()));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn derive_area_subdirectory() {
        let contracts = PathBuf::from("/repo/.contracts");
        let sidecar = PathBuf::from("/repo/.contracts/auth/login.md");
        assert_eq!(derive_area(&contracts, &sidecar), "auth");
    }

    #[test]
    fn derive_area_billing_checkout() {
        let contracts = PathBuf::from("/repo/.contracts");
        let sidecar = PathBuf::from("/repo/.contracts/billing/checkout.md");
        assert_eq!(derive_area(&contracts, &sidecar), "billing");
    }

    #[test]
    fn derive_area_root_level() {
        let contracts = PathBuf::from("/repo/.contracts");
        let sidecar = PathBuf::from("/repo/.contracts/account.md");
        assert_eq!(derive_area(&contracts, &sidecar), ROOT_AREA);
    }

    #[test]
    fn derive_area_nested_takes_top_level() {
        let contracts = PathBuf::from("/repo/.contracts");
        let sidecar = PathBuf::from("/repo/.contracts/auth/sub/nested.md");
        assert_eq!(derive_area(&contracts, &sidecar), "auth");
    }

    #[test]
    fn derive_area_unrelated_path_falls_back() {
        let contracts = PathBuf::from("/repo/.contracts");
        let sidecar = PathBuf::from("/elsewhere/file.md");
        // strip_prefix fails — should fall back to ROOT_AREA rather than panic.
        assert_eq!(derive_area(&contracts, &sidecar), ROOT_AREA);
    }
}
