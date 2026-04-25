use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecisionsManifest {
    pub atom_uuid: String,
    pub decisions: Vec<Decision>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Decision {
    pub key: String,
    pub chosen_value: String,
    pub rationale: String,
    pub substrate_citation_id: Option<String>,
}

/// RUBRIC LABELS, not UUIDs — these are the canonical names of the demo atoms in the
/// presentation script. Phase 9 plan 09-04 (contract-ide-demo seeding) assigns the actual
/// atom UUIDs in the nodes table. resolve_demo_uuids() looks them up at runtime.
pub const DEMO_ATOM_RUBRICS: &[&str] = &[
    "AccountSettings.DangerZone",
    "TeamSettings.DangerZone",
];

/// Runtime resolver: returns the actual atom UUIDs for the demo rubrics by querying nodes.name.
/// Returns empty Vec until Phase 9 seeds the demo atoms — the fixture-fallback path handles
/// the empty case gracefully (rubric-label match still works).
pub async fn resolve_demo_uuids(pool: &SqlitePool) -> Vec<String> {
    let placeholders = std::iter::repeat_n("?", DEMO_ATOM_RUBRICS.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!("SELECT uuid FROM nodes WHERE name IN ({placeholders})");
    let mut q = sqlx::query_as::<_, (String,)>(&sql);
    for r in DEMO_ATOM_RUBRICS {
        q = q.bind(r);
    }
    match q.fetch_all(pool).await {
        Ok(rows) => rows.into_iter().map(|r| r.0).collect(),
        Err(_) => Vec::new(),
    }
}

/// True if the given atom_uuid is a demo atom. Two-layer match:
/// 1. Exact match against rubric LABELS directly (pre-Phase-9-seeding case where atom_uuid is
///    actually the rubric string itself — i.e. caller passed "AccountSettings.DangerZone"
///    as the atom_uuid because Phase 9 hasn't seeded yet).
/// 2. Exact match against resolved UUIDs from nodes table (post-Phase-9-seeding case).
pub async fn is_demo_atom(pool: &SqlitePool, atom_uuid: &str) -> bool {
    if DEMO_ATOM_RUBRICS.contains(&atom_uuid) {
        return true;
    }
    resolve_demo_uuids(pool).await.iter().any(|u| u == atom_uuid)
}

/// Compute the fixture filename to load. For the post-Phase-9 case, atom_uuid is a real UUID;
/// we map it back to the rubric LABEL by looking up nodes.name. For the pre-Phase-9 case,
/// atom_uuid IS the rubric label.
async fn fixture_label_for(pool: &SqlitePool, atom_uuid: &str) -> Option<String> {
    if DEMO_ATOM_RUBRICS.contains(&atom_uuid) {
        return Some(atom_uuid.to_string());
    }
    // Look up nodes.name by uuid — this is the post-Phase-9 case.
    match sqlx::query_as::<_, (String,)>("SELECT name FROM nodes WHERE uuid = ?")
        .bind(atom_uuid)
        .fetch_optional(pool)
        .await
    {
        Ok(Some((name,))) if DEMO_ATOM_RUBRICS.contains(&name.as_str()) => Some(name),
        _ => None,
    }
}

async fn pool_clone(app: &AppHandle) -> Result<SqlitePool, String> {
    let instances = app.state::<DbInstances>();
    let db_map = instances.0.read().await;
    let db = db_map
        .get("sqlite:contract-ide.db")
        .ok_or("DB not loaded")?;
    let pool = match db {
        DbPool::Sqlite(p) => p.clone(),
        #[allow(unreachable_patterns)]
        _ => return Err("expected sqlite pool".into()),
    };
    // Read guard drops here — pool clone is cheap (Arc internally).
    Ok(pool)
}

/// 1. Try canonical agent emission at .contracts/decisions/<atom-uuid>.json.
/// 2. If missing/malformed AND atom_uuid resolves to a demo atom (rubric or seeded UUID),
///    load fixture from .contract-ide-fixtures/decisions/<rubric>.json AND copy it to
///    canonical .contracts/decisions/<atom-uuid>.json so verifier reads consistently.
/// 3. Otherwise: error (non-demo atoms must emit their own decisions.json — v1 limitation).
pub async fn ensure_decisions_manifest_inner(
    app: &AppHandle,
    repo_path: &str,
    atom_uuid: &str,
) -> Result<DecisionsManifest, String> {
    let canonical_path = PathBuf::from(repo_path)
        .join(".contracts")
        .join("decisions")
        .join(format!("{atom_uuid}.json"));

    // 1. Try agent emission at canonical location.
    if let Ok(text) = std::fs::read_to_string(&canonical_path) {
        if let Ok(manifest) = serde_json::from_str::<DecisionsManifest>(&text) {
            if manifest.atom_uuid == atom_uuid && !manifest.decisions.is_empty() {
                return Ok(manifest);
            }
        }
    }

    // 2. Fallback: for demo atoms, load committed fixture from rubric label.
    let pool = pool_clone(app).await?;
    let Some(rubric_label) = fixture_label_for(&pool, atom_uuid).await else {
        return Err(format!(
            "no decisions.json emission and no fixture for {atom_uuid}"
        ));
    };

    let fixture_path = PathBuf::from(repo_path)
        .join(".contract-ide-fixtures")
        .join("decisions")
        .join(format!("{rubric_label}.json"));

    let text = std::fs::read_to_string(&fixture_path)
        .map_err(|e| format!("fixture {fixture_path:?}: {e}"))?;
    let mut manifest: DecisionsManifest =
        serde_json::from_str(&text).map_err(|e| format!("fixture parse: {e}"))?;

    // Override atom_uuid in the manifest with the actual atom_uuid (so verifier consistency holds
    // regardless of whether atom_uuid is a rubric or a real UUID).
    manifest.atom_uuid = atom_uuid.to_string();

    // Write to canonical location so verifier reads consistently.
    if let Some(parent) = canonical_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(
        &canonical_path,
        serde_json::to_string_pretty(&manifest).map_err(|e| format!("manifest serialize: {e}"))?,
    );

    Ok(manifest)
}
