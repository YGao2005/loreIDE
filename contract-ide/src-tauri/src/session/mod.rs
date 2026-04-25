//! Phase 10 session ingestion module.
//!
//! Watches `~/.claude/projects/<cwd-key>/*.jsonl` for ambient Claude Code
//! session activity, filters JSONL to conversational text (~97% reduction),
//! chunks into episodes by user-prompt boundaries, and persists to the
//! `sessions` + `episodes` tables (added in db migration v4).
//!
//! Module layout (mirrors `crate::drift`):
//! - `state` — per-session tokio mutex map (DashMap)
//! - `types` — shared row types (FilteredTurn, Episode, SessionRow, BackfillPreview)
//! - `cwd_key` — pure helper deriving Claude Code's project-key from a cwd path
//! - `ingestor` — filter + chunk + DB upsert (10-02 fills this)
//! - `watcher` — notify::RecommendedWatcher on the project's session dir (10-03)
//!
//! Tauri commands live in `crate::commands::session` (added in 10-03).

pub mod cwd_key;
pub mod ingestor;
pub mod state;
pub mod types;
pub mod watcher;
