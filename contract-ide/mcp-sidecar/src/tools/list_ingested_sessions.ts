/**
 * Phase 10 Plan 10-03 MCP tool — list_ingested_sessions.
 *
 * Returns Claude Code sessions ingested into the substrate for the currently-
 * open repo, ordered by `last_seen_at DESC`. Used by Phase 11+ retrieval
 * and by the agent itself to scope substrate queries by recent activity.
 *
 * Read-only: bun:sqlite connection is opened with `readonly: true` (see
 * `db.ts`), so any accidental write attempt throws SQLITE_READONLY. Mirrors
 * Phase 5's `list_drifted_nodes.ts` pattern.
 *
 * Repo scoping: the current repo is derived from the
 * `CONTRACT_IDE_REPO_PATH` env var (set by the Tauri parent at sidecar
 * spawn time — same mechanism Phase 5's `update_contract.ts` uses for
 * sidecar file paths).
 */

import { getDb, getRepoPath } from '../db';

interface IngestedSession {
  session_id: string;
  cwd_key: string;
  repo_path: string | null;
  started_at: string;
  last_seen_at: string;
  episode_count: number;
  bytes_raw: number;
  bytes_filtered: number;
  state: 'active' | 'ended' | 'compacted';
}

/**
 * Derive Claude Code's `cwd-key` from an absolute repo path. Mirror of
 * `contract-ide/src-tauri/src/session/cwd_key.rs::derive_cwd_key` — the
 * single Rust source of truth uses `PathBuf::to_string_lossy().replace('/',
 * '-')`. Replicated here so the sidecar can scope queries without an extra
 * IPC round-trip to Rust.
 */
function deriveCwdKey(repoPath: string): string {
  return repoPath.replace(/\//g, '-');
}

/**
 * MCP tool entry point. Returns a text-formatted list of ingested sessions.
 *
 * Inputs:
 *   limit: Optional<number> — max rows to return, default 50, capped at 500
 */
export async function listIngestedSessions(
  limit?: number,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  // Repo path: tolerate the unset case so the tool returns a clear message
  // rather than throwing at the JSON-RPC framing layer.
  let repoPath: string;
  try {
    repoPath = getRepoPath();
  } catch (e) {
    return {
      content: [
        {
          type: 'text',
          text: `ERROR: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
    };
  }
  const cwdKey = deriveCwdKey(repoPath);

  const db = getDb();

  // Defensive: the `sessions` table may not exist yet on a Phase 8-only DB
  // that hasn't picked up Phase 10 migration v4 (e.g., user launches the
  // sidecar manually with a stale DB path). Probe sqlite_master to avoid a
  // SqliteError on first launch after partial migration.
  const probe = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'",
    )
    .get() as { name?: string } | undefined;
  if (!probe || !probe.name) {
    return {
      content: [
        {
          type: 'text',
          text:
            'Sessions table not yet initialized — Phase 10 migration v4 has not run. ' +
            'Launch the Contract IDE app once to apply migrations.',
        },
      ],
    };
  }

  const cap = Math.max(1, Math.min(500, limit ?? 50));
  const rows = db
    .prepare(
      `
      SELECT session_id, cwd_key, repo_path, started_at, last_seen_at,
             episode_count, bytes_raw, bytes_filtered, state
      FROM sessions
      WHERE cwd_key = ?
      ORDER BY last_seen_at DESC
      LIMIT ?
      `,
    )
    .all(cwdKey, cap) as IngestedSession[];

  if (rows.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text:
            `No ingested sessions for cwd_key=${cwdKey}. ` +
            `Run \`claude\` in this repo to start populating the substrate.`,
        },
      ],
    };
  }

  const text = rows
    .map(
      (r) =>
        `${r.session_id}  ${r.last_seen_at}  ${r.episode_count} episodes  ` +
        `${r.bytes_filtered}/${r.bytes_raw} bytes  state=${r.state}`,
    )
    .join('\n');

  return {
    content: [
      {
        type: 'text',
        text: `Ingested sessions for ${cwdKey} (${rows.length}/${cap}):\n${text}`,
      },
    ],
  };
}
