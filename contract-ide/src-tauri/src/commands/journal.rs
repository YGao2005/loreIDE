// list_journal_entries — reads .contracts/journal/<session>.jsonl files
// produced by the PostToolUse hook (08-03 Task 1) and returns parsed entries
// for downstream consumers (08-06 reconcile panel).
//
// Defensive parsing per Pitfall 3 lineage: tolerate unknown fields via
// #[serde(flatten)] extra, skip malformed lines with a log warning, never
// panic on a corrupt journal.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournalEntry {
    pub schema_version: u32,
    pub ts: String,
    pub session_id: String,
    pub tool: String,
    pub file: String,
    pub affected_uuids: Vec<String>,
    pub intent: String,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ListJournalOpts {
    pub uuid: Option<String>,
    pub since_ts: Option<String>,
    pub limit: Option<u32>,
}

const DEFAULT_LIMIT: u32 = 50;
const MAX_LIMIT: u32 = 500;

/// Internal Rust-to-Rust helper — same logic as `list_journal_entries` but
/// callable without the Tauri command overhead. Used by `draft_propagation_diff`
/// in reconcile.rs which needs journal entries for its context bundle.
pub async fn list_journal_entries_raw(
    app: &tauri::AppHandle,
    uuid: Option<String>,
    since_ts: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<JournalEntry>, String> {
    let repo_path = {
        let repo_state = app.state::<crate::commands::repo::RepoState>();
        let guard = repo_state.0.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };
    let repo_path = repo_path.ok_or_else(|| "no repo open".to_string())?;
    let journal_dir = repo_path.join(".contracts").join("journal");

    let entries = read_journal_dir(&journal_dir);
    let opts = ListJournalOpts {
        uuid,
        since_ts,
        limit,
    };
    Ok(filter_and_sort(entries, &opts))
}

#[tauri::command]
pub async fn list_journal_entries(
    app: tauri::AppHandle,
    uuid: Option<String>,
    since_ts: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<JournalEntry>, String> {
    let repo_path = {
        let repo_state = app.state::<crate::commands::repo::RepoState>();
        let guard = repo_state.0.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };
    let repo_path = repo_path.ok_or_else(|| "no repo open".to_string())?;
    let journal_dir = repo_path.join(".contracts").join("journal");

    let entries = read_journal_dir(&journal_dir);
    let opts = ListJournalOpts {
        uuid,
        since_ts,
        limit,
    };
    Ok(filter_and_sort(entries, &opts))
}

fn read_journal_dir(journal_dir: &PathBuf) -> Vec<JournalEntry> {
    let mut entries = Vec::new();
    let read_dir = match fs::read_dir(journal_dir) {
        Ok(rd) => rd,
        Err(_) => return entries,
    };
    for dirent in read_dir.flatten() {
        let path = dirent.path();
        if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
            continue;
        }
        let Ok(contents) = fs::read_to_string(&path) else {
            continue;
        };
        for (line_no, line) in contents.lines().enumerate() {
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<JournalEntry>(line) {
                Ok(entry) => entries.push(entry),
                Err(e) => {
                    eprintln!(
                        "list_journal_entries: skip malformed line {}:{} — {e}",
                        path.display(),
                        line_no + 1
                    );
                }
            }
        }
    }
    entries
}

fn filter_and_sort(mut entries: Vec<JournalEntry>, opts: &ListJournalOpts) -> Vec<JournalEntry> {
    if let Some(u) = &opts.uuid {
        entries.retain(|e| e.affected_uuids.iter().any(|a| a == u));
    }
    if let Some(ts) = &opts.since_ts {
        entries.retain(|e| e.ts.as_str() >= ts.as_str());
    }
    entries.sort_by(|a, b| b.ts.cmp(&a.ts));
    let limit = opts
        .limit
        .map(|l| l.min(MAX_LIMIT))
        .unwrap_or(DEFAULT_LIMIT) as usize;
    entries.truncate(limit);
    entries
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_journal_file(dir: &std::path::Path, name: &str, lines: &[&str]) {
        let mut f = fs::File::create(dir.join(name)).unwrap();
        for line in lines {
            writeln!(f, "{line}").unwrap();
        }
    }

    #[test]
    fn journal_parser_tolerates_unknown_fields() {
        let line = r#"{"schema_version":1,"ts":"2026-04-25T00:00:00Z","session_id":"s","tool":"Write","file":"x.ts","affected_uuids":["u1"],"intent":"i","foo":"bar","baz":42}"#;
        let entry: JournalEntry = serde_json::from_str(line).unwrap();
        assert_eq!(entry.schema_version, 1);
        assert_eq!(entry.intent, "i");
        // The extra fields are captured in `extra`.
        assert_eq!(entry.extra["foo"], "bar");
        assert_eq!(entry.extra["baz"], 42);
    }

    #[test]
    fn journal_parser_skips_malformed_lines() {
        let dir = tempfile::tempdir().unwrap();
        write_journal_file(
            dir.path(),
            "session-1.jsonl",
            &[
                r#"{"schema_version":1,"ts":"2026-04-25T00:00:00Z","session_id":"s","tool":"Write","file":"a.ts","affected_uuids":[],"intent":"ok"}"#,
                "{not json}",
                r#"{"schema_version":1,"ts":"2026-04-25T00:01:00Z","session_id":"s","tool":"Edit","file":"b.ts","affected_uuids":[],"intent":"also ok"}"#,
            ],
        );
        let entries = read_journal_dir(&dir.path().to_path_buf());
        assert_eq!(entries.len(), 2, "two valid lines, one skipped");
    }

    fn fixture_entries() -> Vec<JournalEntry> {
        vec![
            JournalEntry {
                schema_version: 1,
                ts: "2026-04-25T00:00:00Z".to_string(),
                session_id: "s1".to_string(),
                tool: "Write".to_string(),
                file: "a.ts".to_string(),
                affected_uuids: vec!["X".to_string(), "Y".to_string()],
                intent: "first".to_string(),
                extra: serde_json::Value::Null,
            },
            JournalEntry {
                schema_version: 1,
                ts: "2026-04-25T00:01:00Z".to_string(),
                session_id: "s1".to_string(),
                tool: "Edit".to_string(),
                file: "b.ts".to_string(),
                affected_uuids: vec!["X".to_string()],
                intent: "second".to_string(),
                extra: serde_json::Value::Null,
            },
            JournalEntry {
                schema_version: 1,
                ts: "2026-04-25T00:02:00Z".to_string(),
                session_id: "s1".to_string(),
                tool: "Write".to_string(),
                file: "c.ts".to_string(),
                affected_uuids: vec!["Z".to_string()],
                intent: "third".to_string(),
                extra: serde_json::Value::Null,
            },
        ]
    }

    #[test]
    fn journal_filters_by_uuid() {
        let opts = ListJournalOpts {
            uuid: Some("X".to_string()),
            since_ts: None,
            limit: None,
        };
        let out = filter_and_sort(fixture_entries(), &opts);
        assert_eq!(out.len(), 2);
        // Sorted descending — second comes before first.
        assert_eq!(out[0].intent, "second");
        assert_eq!(out[1].intent, "first");
    }

    #[test]
    fn journal_filters_by_since_ts() {
        let opts = ListJournalOpts {
            uuid: None,
            since_ts: Some("2026-04-25T00:01:00Z".to_string()),
            limit: None,
        };
        let out = filter_and_sort(fixture_entries(), &opts);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].intent, "third");
        assert_eq!(out[1].intent, "second");
    }

    #[test]
    fn journal_respects_limit() {
        let opts = ListJournalOpts {
            uuid: None,
            since_ts: None,
            limit: Some(2),
        };
        let out = filter_and_sort(fixture_entries(), &opts);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].intent, "third");
        assert_eq!(out[1].intent, "second");
    }
}
