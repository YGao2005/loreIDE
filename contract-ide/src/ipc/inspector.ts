import { invoke } from '@tauri-apps/api/core';
import type { ContractFrontmatter } from '@/ipc/types';

/**
 * Inspector IPC wrappers (Phase 4, Plan 04-01).
 *
 * `readFileContent` takes `(repoPath, relPath)` separately so the Rust command
 * can canonicalize BOTH sides and assert repo-root containment. Never pre-join
 * into a single absolute path on the JS side — that bypasses the containment
 * guard (the command trusts the repo_path as the boundary).
 */
export const readFileContent = (repoPath: string, relPath: string) =>
  invoke<string>('read_file_content', { repoPath, relPath });

/**
 * Open `path` in the user's $EDITOR at `line`. Unknown editors fall back to
 * the default app via the opener plugin (no line number). $EDITOR unset also
 * falls back. Never throws on Rust side; any shell-spawn failure is surfaced
 * as a rejected Promise the caller can toast.
 */
export const openInEditor = (path: string, line: number) =>
  invoke<void>('open_in_editor', { path, line });

/**
 * SHA-256 the given text via Rust (Phase 4 Plan 04-02). The inspector saves
 * contract bodies through this so `contract_hash` matches what the derivation
 * pipeline produces — any JS-side hash implementation could disagree on
 * Unicode normalization, so both call sites MUST go through `sha2` in Rust.
 */
export const hashText = (text: string) => invoke<string>('hash_text', { text });

/**
 * Read an existing sidecar's frontmatter from disk, returning `null` if the
 * sidecar does not exist yet.
 *
 * DATA-CORRUPTION GUARD: `write_contract` runs `DELETE FROM edges WHERE
 * source_uuid = ?` before re-inserting from `fm.neighbors` — so every save
 * MUST read the current frontmatter first and pass `neighbors` /
 * `format_version` / `derived_at` through untouched. Hardcoding `[]` for
 * neighbors wipes every outgoing edge on each human-pinned save.
 */
export const readContractFrontmatter = (repoPath: string, uuid: string) =>
  invoke<ContractFrontmatter | null>('read_contract_frontmatter', {
    repoPath,
    uuid,
  });

/**
 * Probe a dev-server URL for reachability (Phase 4 Plan 04-03).
 *
 * Returns `true` if a server answers within ~1s with status < 500; `false`
 * otherwise. Routed through Rust reqwest (not frontend fetch) because
 * `fetch('http://localhost:3000')` from `tauri://localhost` is cross-origin
 * and CORS-blocked. The Rust side has no browser origin in the picture.
 *
 * Used by PreviewTab to decide whether to render an iframe or the
 * "Start dev server" prompt.
 */
export const probeRoute = (url: string) => invoke<boolean>('probe_route', { url });
