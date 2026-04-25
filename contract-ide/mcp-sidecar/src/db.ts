import { Database } from 'bun:sqlite';
import type { ContractNodeRow, CodeRange } from './types';

let db: Database | null = null;

/**
 * Open the live SQLite DB in read-only mode via bun:sqlite.
 *
 * MCP-03: readonly:true enforces single-writer at the OS level — any write
 * attempt throws SQLITE_READONLY. This is load-bearing; do NOT remove the option.
 *
 * bun:sqlite's `readonly` option implies `create: false`, so an absent file
 * raises an open error rather than silently materialising an empty DB.
 */
export function getDb(): Database {
  if (db) return db;

  const dbPath = process.env.CONTRACT_IDE_DB_PATH;
  if (!dbPath) {
    throw new Error(
      'CONTRACT_IDE_DB_PATH env var not set — Tauri passes this at spawn time',
    );
  }

  db = new Database(dbPath, { readonly: true });
  return db;
}

/**
 * Resolve the currently-open repo path from env. Used by update_contract to
 * locate the .contracts/<uuid>.md sidecar. Phase 8 revisits repo-switch.
 */
export function getRepoPath(): string {
  const p = process.env.CONTRACT_IDE_REPO_PATH;
  if (!p) {
    throw new Error(
      'CONTRACT_IDE_REPO_PATH env var not set — Tauri passes this at spawn time; Phase 8 revisits repo-switch',
    );
  }
  return p;
}

/**
 * Decode a SQLite row into the ContractNodeRow shape the tools emit.
 * Handles JSON TEXT columns and i64→boolean coercion.
 */
export function decodeNodeRow(r: Record<string, unknown>): ContractNodeRow {
  const codeRangesRaw = typeof r.code_ranges === 'string' ? r.code_ranges : null;
  let codeRanges: CodeRange[] = [];
  if (codeRangesRaw) {
    try {
      codeRanges = JSON.parse(codeRangesRaw) as CodeRange[];
    } catch {
      codeRanges = [];
    }
  }
  return {
    uuid: r.uuid as string,
    level: r.level as string,
    name: r.name as string,
    kind: (r.kind as string | null) ?? 'unknown',
    code_ranges: codeRanges,
    parent_uuid: (r.parent_uuid as string | null) ?? null,
    is_canonical: (r.is_canonical as number) !== 0,
    code_hash: (r.code_hash as string | null) ?? null,
    contract_hash: (r.contract_hash as string | null) ?? null,
    human_pinned: (r.human_pinned as number) !== 0,
    route: (r.route as string | null) ?? null,
    derived_at: (r.derived_at as string | null) ?? null,
    contract_body: (r.contract_body as string | null) ?? null,
  };
}
