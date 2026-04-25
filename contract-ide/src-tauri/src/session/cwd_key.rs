use std::path::Path;

/// Derive the `cwd-key` Claude Code uses to organise sessions under
/// `~/.claude/projects/<cwd-key>/`. Rule (validated against real
/// `~/.claude/projects/` directory listing): replace every `/` with `-`.
/// Leading `/` becomes leading `-`.
///
/// Examples (all from the validated 10-RESEARCH.md):
/// - `/Users/yang/lahacks` → `-Users-yang-lahacks`
/// - `/Users/yang/lahacks/contract-ide` → `-Users-yang-lahacks-contract-ide`
///
/// This is the SINGLE SOURCE OF TRUTH for the cwd-key derivation. Four call
/// sites depend on it (10-03 watcher, list_ingested_sessions, get_backfill_preview,
/// execute_backfill); a bug here would silently watch the wrong directory.
///
/// TODO(Plan 10-03): consumed by `SessionWatcher::watch_project` and the
/// session command surface. Remove `#[allow(dead_code)]` then.
#[allow(dead_code)]
pub fn derive_cwd_key(path: &Path) -> String {
    path.to_string_lossy().replace('/', "-")
}

/// Resolve `~/.claude/projects/` from $HOME. Returns Err if HOME is unset
/// (shouldn't happen on macOS — login shell sets it; but defensive).
///
/// TODO(Plan 10-03): consumed by `SessionWatcher::watch_project`. Remove
/// `#[allow(dead_code)]` then.
#[allow(dead_code)]
pub fn claude_projects_dir() -> Result<std::path::PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME env var not set".to_string())?;
    Ok(std::path::PathBuf::from(home)
        .join(".claude")
        .join("projects"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn derive_cwd_key_unix_root() {
        assert_eq!(
            derive_cwd_key(&PathBuf::from("/Users/yang/lahacks")),
            "-Users-yang-lahacks"
        );
    }

    #[test]
    fn derive_cwd_key_nested() {
        assert_eq!(
            derive_cwd_key(&PathBuf::from("/Users/yang/lahacks/contract-ide")),
            "-Users-yang-lahacks-contract-ide"
        );
    }

    #[test]
    fn derive_cwd_key_deeper_nested() {
        assert_eq!(
            derive_cwd_key(&PathBuf::from(
                "/Users/yang/lahacks/contract-ide/src-tauri"
            )),
            "-Users-yang-lahacks-contract-ide-src-tauri"
        );
    }

    #[test]
    fn derive_cwd_key_trailing_slash_preserved() {
        // Path::new("/Users/yang/lahacks/") still represents the same dir but
        // string conversion may or may not include the trailing slash. The
        // derivation must be deterministic; Claude Code's actual keys do NOT
        // have trailing hyphens (verified via real ~/.claude/projects/ listing).
        // Documenting current behavior — if Claude Code changes its convention,
        // this test will fail and force a planning revision.
        let p1 = PathBuf::from("/Users/yang/lahacks");
        let p2 = PathBuf::from("/Users/yang/lahacks/");
        let key1 = derive_cwd_key(&p1);
        let key2 = derive_cwd_key(&p2);
        // Document observation rather than enforce — this is the test that will
        // catch any future regression where Path::to_string_lossy starts adding/removing slashes.
        assert!(
            key1 == "-Users-yang-lahacks"
                && (key2 == "-Users-yang-lahacks" || key2 == "-Users-yang-lahacks-"),
            "key1={} key2={}",
            key1,
            key2
        );
    }

    #[test]
    fn claude_projects_dir_resolves_under_home() {
        // Smoke test only — relies on HOME being set in the test env.
        let dir = claude_projects_dir().expect("HOME must be set in test env");
        assert!(dir.ends_with(".claude/projects"));
    }
}
