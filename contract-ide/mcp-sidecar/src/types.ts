/**
 * Shared TypeScript types for the MCP sidecar.
 *
 * KEEP IN SYNC BY HAND with the Rust equivalents:
 *   - `ContractNodeRow`            ↔ contract-ide/src-tauri/src/commands/nodes.rs `ContractNode`
 *   - `ContractFrontmatter`        ↔ contract-ide/src-tauri/src/sidecar/frontmatter.rs `ContractFrontmatter`
 *   - `CodeRange`                  ↔ contract-ide/src-tauri/src/sidecar/frontmatter.rs `CodeRange`
 *
 * The sidecar is a standalone Node workspace (no shared crate), so any schema
 * change in Phase 6/7/8 migrations must update this file in the same plan that
 * introduces the migration. Divergence = silent runtime errors at the JSON
 * boundary (missing columns surface as `undefined`).
 */

export interface CodeRange {
  file: string;
  start_line: number;
  end_line: number;
}

/** Mirrors contract-ide/src-tauri/src/commands/nodes.rs ContractNode. */
export interface ContractNodeRow {
  uuid: string;
  level: string;
  name: string;
  kind: string;
  code_ranges: CodeRange[]; // JSON-decoded from TEXT column
  parent_uuid: string | null;
  is_canonical: boolean;
  code_hash: string | null;
  contract_hash: string | null;
  human_pinned: boolean;
  route: string | null;
  derived_at: string | null;
  contract_body: string | null;
}

/** Mirrors contract-ide/src-tauri/src/sidecar/frontmatter.rs ContractFrontmatter. */
export interface ContractFrontmatter {
  format_version: number;
  uuid: string;
  kind: string;
  level: string;
  parent: string | null;
  neighbors: string[];
  code_ranges: CodeRange[];
  code_hash: string | null;
  contract_hash: string | null;
  human_pinned: boolean;
  route: string | null;
  derived_at: string | null;
}
