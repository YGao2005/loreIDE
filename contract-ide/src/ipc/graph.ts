// Typed wrappers for the graph-derived Rust commands (Plan 03-02).
//
// Mirrors src-tauri/src/commands/graph.rs. KEEP IN SYNC — field names and
// argument casing must match the Rust side or the invoke() boundary returns
// silent nulls.

import { invoke } from '@tauri-apps/api/core';
import type { ContractNode, GraphEdge, LensRequestId } from '@/ipc/types';

/**
 * Fetch edges, optionally constrained to a single level + parent.
 *
 * Matches the Rust `get_edges(level, parent_uuid)` signature; both filters
 * are applied to BOTH endpoints so cross-level edges never leak into a
 * hierarchical sub-flow (RESEARCH §Pitfall 10).
 */
export async function getEdges(opts?: {
  level?: string;
  parentUuid?: string;
}): Promise<GraphEdge[]> {
  return invoke<GraphEdge[]>('get_edges', {
    level: opts?.level ?? null,
    parentUuid: opts?.parentUuid ?? null,
  });
}

/**
 * Lens-aware node fetch.
 *
 * `journey` + `flowUuid` → nodes that belong to that L1 flow (via node_flows).
 * Any other combo → all nodes (Phase 3 placeholder for system/ownership).
 *
 * The caller is responsible for resolving an L1 flow UUID from the current
 * drill-in stack — `parentUuidStack[0]` is L0, not L1. See
 * `graphStore.getCurrentFlowUuid()`.
 */
export async function getLensNodes(opts: {
  lens: LensRequestId;
  flowUuid?: string;
}): Promise<ContractNode[]> {
  return invoke<ContractNode[]>('get_lens_nodes', {
    lens: opts.lens,
    flowUuid: opts.flowUuid ?? null,
  });
}

/**
 * Rebuild DATA-05 ghost-reference rows from node_flows membership.
 *
 * Idempotent (transactional DELETE WHERE is_canonical=0 + INSERT). Returns
 * the number of ghost rows inserted in this call.
 */
export async function rebuildGhostRefs(): Promise<number> {
  return invoke<number>('rebuild_ghost_refs');
}
