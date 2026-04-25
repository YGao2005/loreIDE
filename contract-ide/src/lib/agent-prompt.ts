/**
 * Frontend prompt-shape preview helpers.
 *
 * These are client-side approximations used by the ChatPanel to:
 *   1. Show a "scope context" chip indicating how many neighbors will be
 *      injected into the prompt (e.g., "Scope: Account Settings (3 neighbors)")
 *   2. Generate a preview string of the assembled prompt on hover
 *
 * The authoritative prompt assembly runs on the Rust side (08-04a
 * src/agent/prompt_assembler.rs). These helpers mirror the structure for
 * UI preview purposes only — they read via existing IPC (getNodes / getEdges)
 * and do NOT replicate the full sidecar-reading pipeline.
 */

import { invoke } from '@tauri-apps/api/core';
import { getEdges } from '@/ipc/graph';
import type { ContractNode } from '@/ipc/types';

export interface ScopeContext {
  /** The scope node itself, or null if not found. */
  scopeNode: ContractNode | null;
  /** Direct neighbors via edges (both directions). */
  neighbors: ContractNode[];
  /** Count of journal entries available (placeholder — 0 until Phase 10). */
  journalEntryCount: number;
}

/**
 * Assemble scope context for the chat panel's scope-context indicator.
 *
 * Reads from already-loaded node list (via IPC getNodes + getEdges fallback).
 * Returns a summary struct with neighbor count for the scope chip.
 */
export async function assembleScopeContext(
  scopeNodeUuid: string | null,
): Promise<ScopeContext> {
  if (!scopeNodeUuid) {
    return { scopeNode: null, neighbors: [], journalEntryCount: 0 };
  }

  let allNodes: ContractNode[] = [];

  try {
    allNodes = await invoke<ContractNode[]>('get_nodes');
  } catch (e) {
    console.warn('[agent-prompt] assembleScopeContext IPC failed:', e);
    return { scopeNode: null, neighbors: [], journalEntryCount: 0 };
  }

  const scopeNode = allNodes.find((n) => n.uuid === scopeNodeUuid) ?? null;
  if (!scopeNode) {
    return { scopeNode: null, neighbors: [], journalEntryCount: 0 };
  }

  // Collect neighbor UUIDs from edges (both source and target directions).
  let edges: Awaited<ReturnType<typeof getEdges>> = [];
  try {
    edges = await getEdges();
  } catch {
    // Non-fatal — neighbors will be empty but scope chip still shows.
  }
  const neighborUuids = new Set<string>();
  for (const edge of edges) {
    if (edge.source_uuid === scopeNodeUuid) neighborUuids.add(edge.target_uuid);
    else if (edge.target_uuid === scopeNodeUuid) neighborUuids.add(edge.source_uuid);
  }

  const neighbors = allNodes.filter((n) => neighborUuids.has(n.uuid));

  return {
    scopeNode,
    neighbors,
    journalEntryCount: 0, // Phase 10 integration: list_journal_entries IPC
  };
}

/**
 * Preview the assembled prompt structure for a given user intent + scope.
 *
 * Returns a concise multi-line string showing what will be sent to the
 * claude CLI. Shown in a tooltip on hover in the ChatPanel. Not exhaustive —
 * the real prompt has full sidecar bodies; this shows structural shape.
 */
export async function previewPrompt(
  userIntent: string,
  scopeNodeUuid: string | null,
): Promise<string> {
  if (!scopeNodeUuid) {
    return `[No scope] ${userIntent}`;
  }

  const ctx = await assembleScopeContext(scopeNodeUuid);
  if (!ctx.scopeNode) {
    return `[Scope: unknown] ${userIntent}`;
  }

  const lines: string[] = [
    `# Scope: ${ctx.scopeNode.name} (${ctx.scopeNode.level} ${ctx.scopeNode.kind})`,
    `# ${ctx.neighbors.length} neighbor(s): ${ctx.neighbors.map((n) => n.name).join(', ') || 'none'}`,
    ``,
    userIntent,
  ];

  return lines.join('\n');
}
