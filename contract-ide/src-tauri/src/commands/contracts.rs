// write_contract — single-writer sidecar disk write + SQLite upsert.
//
// All sidecar .md writes route through this command (single-writer rule from
// 02-RESEARCH.md). JS never writes sidecar files directly.
//
// Acquires DriftLocks::for_uuid(uuid) so the user-direct save path serializes
// with the watcher, the rollup engine (08-02), the cherrypick writer (08-05),
// and accept_rollup_as_is (08-06) per CONTEXT.md "all writers serialize"
// invariant — closes a Phase 2 gap where concurrent writers could interleave
// and persist a stale code_hash.

use tauri::Manager;
use tauri_plugin_sql::DbInstances;
use crate::sidecar::frontmatter::ContractFrontmatter;

/// Write a contract sidecar atomically (temp file + rename, same filesystem)
/// and re-upsert its node into SQLite so the cache is immediately in sync.
///
/// The file watcher in Plan 02-03 will also fire on the rename, but we
/// proactively upsert here to avoid a race between the write and a graph
/// refresh triggered before the watcher fires.
#[tauri::command]
pub async fn write_contract(
    app: tauri::AppHandle,
    repo_path: String,
    uuid: String,
    mut frontmatter: ContractFrontmatter,
    body: String,
) -> Result<(), String> {
    // Acquire per-UUID mutex BEFORE any disk I/O — serializes with watcher,
    // rollup engine, cherrypick, and accept_rollup_as_is. Bind the Arc to a
    // local so its lifetime extends past the guard (E0716 pattern).
    let locks = app.state::<crate::drift::state::DriftLocks>();
    let arc = locks.for_uuid(&uuid);
    let _guard = arc.lock().await;

    // Server-side merge-read: preserve Phase 8 propagation fields the frontend
    // does not (and should not) send. Without this, the editor's saveContract
    // posts a frontmatter with rollup_inputs=[], rollup_state=None, etc., and
    // upsert_node_pub clobbers the prior rows. The propagation engine owns
    // these fields; user-driven saves only update the body and contract_hash.
    {
        let repo = std::path::Path::new(&repo_path);
        if let Ok((existing_fm, _existing_body)) =
            crate::sidecar::frontmatter::read_sidecar_file(repo, &uuid)
        {
            if frontmatter.rollup_inputs.is_empty() && !existing_fm.rollup_inputs.is_empty() {
                frontmatter.rollup_inputs = existing_fm.rollup_inputs;
            }
            if frontmatter.rollup_hash.is_none() && existing_fm.rollup_hash.is_some() {
                frontmatter.rollup_hash = existing_fm.rollup_hash;
            }
            if frontmatter.rollup_state.is_none() && existing_fm.rollup_state.is_some() {
                frontmatter.rollup_state = existing_fm.rollup_state;
            }
            if frontmatter.rollup_generation.is_none() && existing_fm.rollup_generation.is_some()
            {
                frontmatter.rollup_generation = existing_fm.rollup_generation;
            }
            // parent: same FK preservation rationale — autosave path may pass
            // None for nodes the React-side ContractNode never populated.
            if frontmatter.parent.is_none() && existing_fm.parent.is_some() {
                frontmatter.parent = existing_fm.parent;
            }
        }
    }

    // Compute section_hashes from the new body so the rollup cascade engine
    // can detect that a child's cited section changed. The frontend doesn't
    // (and shouldn't) compute these — they're an implementation detail of the
    // propagation engine (PROP-01). Forces format_version: 3 on every save.
    if let Ok(hashes) = crate::sidecar::section_parser::compute_section_hashes(&body) {
        frontmatter.section_hashes = hashes;
        frontmatter.format_version = 3;
    }

    // Serialize the .md string.
    let contents = crate::sidecar::frontmatter::write_sidecar(&frontmatter, &body)
        .map_err(|e| e.to_string())?;

    // Atomic write: temp file + rename. Both in .contracts/ so rename is same-fs.
    let contracts_dir = std::path::Path::new(&repo_path).join(".contracts");
    std::fs::create_dir_all(&contracts_dir).map_err(|e| e.to_string())?;
    let target = contracts_dir.join(format!("{uuid}.md"));
    let tmp = contracts_dir.join(format!(".{uuid}.md.tmp"));

    std::fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &target).map_err(|e| e.to_string())?;

    // Re-upsert into SQLite so the cache is immediately in sync.
    // Call the ONE canonical public symbol — upsert_node_pub — established in
    // Task 1. No ambiguous naming here.
    let instances = app.state::<DbInstances>();
    let db_map = instances.0.read().await;
    let db = db_map.get("sqlite:contract-ide.db").ok_or("DB not loaded")?;
    crate::db::scanner::upsert_node_pub(db, &frontmatter, &body)
        .await
        .map_err(|e| e.to_string())?;

    // Persist section_hashes_json on the saved node so the rollup cascade
    // engine (compute_rollup_and_emit) can read fresh hashes from the DB
    // without re-parsing the .md file. upsert_node_pub does NOT write the
    // Phase 8 propagation columns (it's a pre-Phase-8 helper); patch them
    // in directly via UPDATE.
    if let Ok(section_hashes_json) = serde_json::to_string(&frontmatter.section_hashes) {
        let pool_inner = match db {
            tauri_plugin_sql::DbPool::Sqlite(p) => p,
            #[allow(unreachable_patterns)]
            _ => return Ok(()),
        };
        let _ = sqlx::query(
            "UPDATE nodes SET section_hashes_json = ?1 WHERE uuid = ?2",
        )
        .bind(&section_hashes_json)
        .bind(&uuid)
        .execute(pool_inner)
        .await;
    }

    // Phase 8 Plan 08-02 cascade trigger: editing a child sidecar's cited
    // section must flip its parent's rollup_state. The SourceWatcher only
    // fires compute_rollup_and_emit on SOURCE-file edits — direct contract
    // body saves bypass it. Walk up parent_uuid from the saved node and
    // spawn compute_rollup_and_emit for each ancestor (skipping L0 — exempt
    // per PROP-02). Drop the db_map read lock first so each spawn can
    // re-acquire its own.
    let pool = match db {
        tauri_plugin_sql::DbPool::Sqlite(p) => p.clone(),
        #[allow(unreachable_patterns)]
        _ => return Ok(()),
    };
    drop(db_map);

    let mut ancestors: Vec<String> = Vec::new();
    let mut current = uuid.clone();
    while let Ok(Some((parent, level))) = sqlx::query_as::<_, (Option<String>, String)>(
        "SELECT parent_uuid, level FROM nodes WHERE uuid = ?1",
    )
    .bind(&current)
    .fetch_optional(&pool)
    .await
    {
        // Recompute rollup for the saved node itself first iteration so its
        // section_hashes update; then walk up. L0 is exempt.
        if level != "L0" {
            ancestors.push(current.clone());
        }
        match parent {
            Some(p) if !p.is_empty() && p != "null" => current = p,
            _ => break,
        }
    }
    for ru in ancestors {
        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = crate::drift::engine::compute_rollup_and_emit(&app2, &ru).await {
                eprintln!("[rollup] write_contract cascade {ru}: {e}");
            }
        });
    }

    Ok(())
}
