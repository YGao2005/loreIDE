// Mirrors Rust structs in src-tauri/src/commands/nodes.rs and
// src-tauri/src/sidecar/frontmatter.rs.
// KEEP IN SYNC — drift = silent runtime error at invoke() boundary.

export type ContractLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

export interface CodeRange {
  file: string;
  start_line: number;
  end_line: number;
}

export interface ContractNode {
  uuid: string;
  level: ContractLevel;
  name: string;
  kind: string;
  code_ranges: CodeRange[];
  parent_uuid: string | null;
  is_canonical: boolean;
  code_hash: string | null;
  contract_hash: string | null;
  human_pinned: boolean;
  route: string | null;
  derived_at: string | null;
  contract_body: string | null;
  tags: string[];
  /** Phase 8: optimistic-lock generation for rollup writes (0 if not yet set). */
  rollup_generation: number;
  /**
   * Phase 9 FLOW-01: ordered member uuids for kind:'flow' contracts.
   * First element is the trigger; rest are participants in invocation order.
   * Empty array on all non-flow contracts (Rust uses skip_serializing_if = Vec::is_empty).
   */
  members?: string[];
}

/**
 * Phase 9 FLOW-01: type-narrowed contract for kind:'flow' contracts.
 * Phase 13 CHAIN-01 imports this type for the vertical-chain renderer.
 * The `members` array is guaranteed non-empty on this type (validated at
 * repo-load time by validate_flow_members in frontmatter.rs).
 */
export interface FlowContractNode extends ContractNode {
  kind: 'flow';
  /** At least one element (trigger). Non-empty guaranteed at load time. */
  members: string[];
}

/** Type guard: narrow a ContractNode to FlowContractNode. */
export function isFlowContract(node: ContractNode): node is FlowContractNode {
  return node.kind === 'flow' && Array.isArray(node.members) && node.members.length > 0;
}

// Full DATA-01 frontmatter shape — mirrors Rust ContractFrontmatter.
// Used by writeContract() IPC payload. KEEP IN SYNC.
export interface ContractFrontmatter {
  format_version: number;
  uuid: string;
  kind: string;
  level: ContractLevel;
  parent: string | null;
  neighbors: string[];
  code_ranges: CodeRange[];
  code_hash: string | null;
  contract_hash: string | null;
  human_pinned: boolean;
  route: string | null;
  derived_at: string | null;
}

export interface ScanResult {
  nodeCount: number;
  errorCount: number;
  errors: string[];
}

// Mirrors src-tauri/src/commands/graph.rs::GraphEdge. KEEP IN SYNC.
export interface GraphEdge {
  id: string;
  source_uuid: string;
  target_uuid: string;
  edge_type: string;
}

export type LensRequestId = 'journey' | 'system' | 'ownership';
