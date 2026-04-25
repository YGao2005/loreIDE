// NEVER add #[tokio::main] anywhere in this crate — Tauri owns the async
// runtime. Use tauri::async_runtime::spawn() for background work.
// See RESEARCH.md Pitfall 1 / GitHub tauri-apps/tauri#13330.

pub mod agent;
pub mod commands;
pub mod delegate;
mod db;
pub mod distiller;
pub mod drift;
pub mod retrieval;
pub mod session;
pub mod sidecar;
pub mod supersession;

use tauri::Manager;
use tauri_plugin_sql::Builder as SqlBuilder;
#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            SqlBuilder::default()
                .add_migrations("sqlite:contract-ide.db", db::get_migrations())
                .build(),
        )
        .manage(commands::repo::RepoState(std::sync::Mutex::new(None)))
        .manage(commands::mcp::McpSidecarHandle::default())
        .manage(crate::drift::state::DriftLocks::default())
        .manage(crate::drift::watcher::SourceWatcher::new())
        .manage(crate::session::state::SessionLocks::default())
        .manage(crate::session::watcher::SessionWatcher::new())
        .manage(distiller::state::DistillerLocks::default())
        .manage(commands::agent::AgentRuns::default())
        .invoke_handler(tauri::generate_handler![
            commands::cherrypick::apply_cherrypick,
            commands::nodes::get_nodes,
            commands::repo::open_repo,
            commands::repo::get_repo_path,
            commands::repo::refresh_nodes,
            commands::contracts::write_contract,
            commands::graph::get_edges,
            commands::graph::get_lens_nodes,
            commands::graph::rebuild_ghost_refs,
            commands::inspector::read_file_content,
            commands::inspector::open_in_editor,
            commands::inspector::hash_text,
            commands::inspector::read_contract_frontmatter,
            commands::inspector::probe_route,
            commands::journal::list_journal_entries,
            commands::devlog::devlog,
            commands::drift::acknowledge_drift,
            commands::mcp::get_mcp_status,
            commands::agent::run_agent,
            commands::receipts::list_receipts_for_node,
            commands::reconcile::accept_rollup_as_is,
            commands::reconcile::draft_propagation_diff,
            commands::reconcile::read_children_section_diffs,
            commands::rollup::list_rollup_states,
            commands::rollup::recompute_all_rollups,
            commands::session::get_ingested_sessions,
            commands::session::get_backfill_preview,
            commands::session::execute_backfill,
            commands::session::get_session_status,
            commands::session::list_historical_session_files,
            commands::mass_edit::find_by_intent_mass,
            commands::validation::test_claude_spawn,
            commands::validation::test_hook_payload_fixture,
            commands::validation::test_pkg_sqlite_binary,
            commands::retrieval::find_substrate_for_atom,
            commands::distiller::list_dead_letters,
            commands::distiller::retry_dead_letter,
            commands::distiller::get_substrate_count_for_session,
            commands::distiller::redistill_all_episodes,
            commands::delegate::delegate_compose,
            commands::delegate::delegate_plan,
            commands::delegate::delegate_execute,
            commands::delegate::ensure_decisions_manifest,
            commands::sidebar::get_sidebar_tree,
            commands::substrate_panel::list_substrate_for_atom,
            commands::substrate_panel::get_total_substrate_count,
            commands::substrate::get_substrate_states_for_canvas,
            commands::substrate::get_substrate_node_detail,
            // 13-03 Cmd+P palette retrieval (SUB-08). Wave 2 serialization_hint:
            // appended AFTER 13-02's get_sidebar_tree per the macro-edit ordering
            // contract documented in the plan frontmatter.
            commands::substrate::find_substrate_by_intent,
            commands::supersession::ingest_substrate_node_with_invalidation,
            commands::supersession::find_substrate_history_cmd,
            commands::supersession::current_truth_query_cmd,
            commands::supersession::record_priority_shift,
            commands::supersession::preview_intent_drift_impact_cmd,
            commands::supersession::propagate_intent_drift_cmd,
            // 12-04 Beat 3 demo backstop. The function body is gated by the
            // `demo-fixture` cargo feature — default builds compile a stub
            // that returns an error if invoked. Registered unconditionally
            // so JS callers always have a stable command name.
            commands::supersession::demo_force_intent_drift,
        ])
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("main window must exist");

            #[cfg(target_os = "macos")]
            apply_vibrancy(&window, NSVisualEffectMaterial::Sidebar, None, None)
                .expect(
                    "apply_vibrancy failed — macOSPrivateApi must be true in \
                     tauri.conf.json and the tauri crate needs the \
                     macos-private-api feature flag.",
                );

            #[cfg(not(target_os = "macos"))]
            let _ = window;

            // Spawn MCP sidecar (Plan 05-01). Non-blocking — failures emit a
            // `mcp:status` {stopped, reason} event rather than panicking, so the
            // app still boots if the binary is missing.
            commands::mcp::launch_mcp_sidecar(app.handle().clone());

            // Register Phase 11 distiller pipeline listener (Plan 11-02).
            // Subscribes to episode:ingested events emitted by session/ingestor.rs.
            // Non-blocking — distillation failures are dead-lettered, not propagated.
            crate::distiller::pipeline::init(app.handle());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
