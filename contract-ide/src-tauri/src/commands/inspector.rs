// Inspector IPC commands (Phase 4, Plan 04-01).
//
// `read_file_content` is the single reader the Monaco Code tab uses. It takes
// (repo_path, rel_path) SEPARATELY — the frontend MUST NOT pre-join into an
// absolute path, because this command canonicalizes both sides and enforces
// containment: any symlink or `..` traversal that resolves outside the repo
// root returns Err. Phase 8 agent loops and hook-driven callers will
// sloppily construct paths; the frontend cannot be trusted as the sole
// gatekeeper, so the guard lives here.
//
// `open_in_editor` reads $EDITOR and routes through a small table of known
// editor argument conventions. Unknown editors fall back to the default-app
// opener (no line number, but the file still opens). We never panic — any
// failure path returns Err(String) so the frontend can toast.

use sha2::{Digest, Sha256};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::ShellExt;

use crate::sidecar::frontmatter::{parse_sidecar, ContractFrontmatter};

/// Resolve $EDITOR basename to argument vector for jumping to a file:line.
/// Returns None if the editor is unknown — caller should fall back to
/// `tauri_plugin_opener` which opens in the default app (no line number).
fn editor_args(editor: &str, path: &str, line: u32) -> Option<Vec<String>> {
    // Match on the basename of $EDITOR (e.g. /usr/local/bin/code → "code").
    let base = std::path::Path::new(editor)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(editor)
        .to_lowercase();
    match base.as_str() {
        // VS Code family: --goto path:line
        "code" | "cursor" | "code-insiders" | "codium" => {
            Some(vec!["--goto".into(), format!("{path}:{line}")])
        }
        // Sublime / Zed / TextMate / Atom: path:line
        "subl" | "zed" | "mate" | "atom" => Some(vec![format!("{path}:{line}")]),
        // Vim family: +{line} path
        "vim" | "nvim" | "mvim" | "gvim" | "nvr" => {
            Some(vec![format!("+{line}"), path.into()])
        }
        // Emacs: +line path
        "emacs" | "emacsclient" => Some(vec![format!("+{line}"), path.into()]),
        // Helix: path:line
        "hx" | "helix" => Some(vec![format!("{path}:{line}")]),
        // Unknown editor — caller falls back to opener (no line number).
        _ => None,
    }
}

/// Read a text file from disk, but only if it lives under `repo_path` after
/// canonicalization. The (repo_path, rel_path) split is load-bearing: the
/// frontend never constructs an absolute path, so a symlink farm under the
/// repo cannot smuggle a read of, e.g., `/etc/passwd` through the Code tab.
#[tauri::command]
pub fn read_file_content(repo_path: String, rel_path: String) -> Result<String, String> {
    let repo = std::fs::canonicalize(&repo_path).map_err(|e| e.to_string())?;
    let target = std::fs::canonicalize(std::path::Path::new(&repo_path).join(&rel_path))
        .map_err(|e| e.to_string())?;
    if !target.starts_with(&repo) {
        return Err(format!("path escapes repo root: {}", rel_path));
    }
    std::fs::read_to_string(&target).map_err(|e| e.to_string())
}

/// Open `path` in the user's configured $EDITOR at `line`. Unknown editors
/// fall back to the default-app opener (which won't jump to a line, but at
/// least opens the file). $EDITOR unset → fall back to opener as well.
#[tauri::command]
pub fn open_in_editor(app: tauri::AppHandle, path: String, line: u32) -> Result<(), String> {
    let editor = std::env::var("EDITOR").ok();

    if let Some(editor) = editor.as_deref() {
        if let Some(args) = editor_args(editor, &path, line) {
            app.shell()
                .command(editor)
                .args(args)
                .spawn()
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
    }

    // Fallback: no $EDITOR or unknown editor — open in default app.
    app.opener()
        .open_path(&path, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Compute a SHA-256 hex digest of `text`. Used by the inspector (Phase 4
/// Plan 04-02) so `contract_hash` on save matches the derivation pipeline's
/// hash byte-for-byte — both sides must go through Rust/`sha2` so Unicode
/// normalization never diverges between them.
#[tauri::command]
pub fn hash_text(text: String) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hex::encode(hasher.finalize())
}

/// Read and parse an existing sidecar; returns the frontmatter ONLY.
///
/// The body is re-entered via the editor buffer on save — we only need
/// frontmatter to preserve server-derived fields (neighbors, format_version,
/// derived_at) during human-pinned saves. Returns `Ok(None)` if the sidecar
/// does not exist yet (first save for a new node).
///
/// DATA-CORRUPTION GUARD (Phase 4 Plan 04-02): `write_contract` is an
/// OVERWRITE and its `upsert_node_pub` path runs `DELETE FROM edges WHERE
/// source_uuid = ?` before re-inserting from `fm.neighbors`. The frontend
/// MUST read this, pass `neighbors` through untouched, and only stamp
/// `human_pinned: true` + the fresh `contract_hash`. Hardcoding `neighbors:
/// []` on save would wipe every outgoing edge for that node silently.
#[tauri::command]
pub fn read_contract_frontmatter(
    repo_path: String,
    uuid: String,
) -> Result<Option<ContractFrontmatter>, String> {
    let path = std::path::Path::new(&repo_path)
        .join(".contracts")
        .join(format!("{uuid}.md"));
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let (fm, _body) = parse_sidecar(&raw).map_err(|e| e.to_string())?;
    Ok(Some(fm))
}

/// Probe a URL for reachability (Phase 4 Plan 04-03).
///
/// Returns `true` when the dev server answers within ~1s with a status code
/// below 500; `false` otherwise. This is definitionally non-throwing — the
/// frontend's UX is "is it reachable or not", not "explain the failure."
///
/// We accept `< 500` so 404/403 pages still count as "dev server is up" —
/// the user can navigate from there.
///
/// CORS NOTE: the frontend MUST NOT fetch(http://localhost:3000) directly —
/// tauri://localhost is a distinct origin and Chromium's CORS kicks in. A
/// Rust reqwest call bypasses that entirely (no browser origin in the picture).
#[tauri::command]
pub async fn probe_route(url: String) -> bool {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(1))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    matches!(
        client.get(&url).send().await,
        Ok(r) if r.status().as_u16() < 500
    )
}
