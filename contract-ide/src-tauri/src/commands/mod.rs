// Command modules for Tauri IPC. The #[tauri::command] macro generates a
// sibling `__cmd__<name>` shim alongside each command; `generate_handler!`
// resolves those via the full `commands::<module>::<fn>` path, so we do
// not re-export command fns here (pub use would elide the shim).
pub mod agent;
pub mod cherrypick;
pub mod contracts;
pub mod delegate;
pub mod demo_orchestration;
pub mod derive;
pub mod devlog;
pub mod distiller;
pub mod drift;
pub mod graph;
pub mod inspector;
pub mod journal;
pub mod mass_edit;
pub mod mcp;
pub mod nodes;
pub mod pr_review;
pub mod receipts;
pub mod reconcile;
pub mod repo;
pub mod retrieval;
pub mod rollup;
pub mod screenshot;
pub mod session;
pub mod sidebar;
pub mod substrate;
pub mod substrate_panel;
pub mod supersession;
pub mod sync;
pub mod validation;
