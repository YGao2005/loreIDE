/**
 * Phase 8 Plan 08-06 — Pin-aware reconcile IPC wrappers (PROP-04).
 *
 * Three narrow commands:
 *   - acceptRollupAsIs — update ONLY rollup_hash/generation/state (never YAML round-trip)
 *   - draftPropagationDiff — read-only bundle for the DraftPropagationDiff clipboard prompt
 *   - readChildrenSectionDiffs — read-only current child sections for ChildrenChangesView
 */

import { invoke } from '@tauri-apps/api/core';
import type { JournalEntry } from './journal';

// ─── Shared types ─────────────────────────────────────────────────────────────

/** A cited child section extracted for the propagation diff context. */
export interface ChildSection {
  child_uuid: string;
  section_name: string;
  section_text: string;
}

/**
 * Full context bundle returned by `draft_propagation_diff`.
 * DraftPropagationDiff.tsx assembles this into a clipboard-copy prompt.
 */
export interface DraftPropagationContext {
  current_body: string;
  cited_child_sections: ChildSection[];
  recent_journal_entries: JournalEntry[];
  expected_generation: number;
}

/**
 * One drifted child section returned by `read_children_section_diffs`.
 *
 * v1 limitation: `section_text_at_last_generation` is always `null` — no
 * historical body snapshots exist yet. The `drifted` flag uses section hash
 * mismatch as a proxy. v2 carry-over: add `upstream_generation_snapshots` table.
 */
export interface ChildSectionDiff {
  child_uuid: string;
  section_name: string;
  /** Always null in v1 — see v1 limitation note above. */
  section_text_at_last_generation: string | null;
  section_text_now: string;
  section_hash_now: string;
  /** True when section_hash_now ≠ stored hash at last rollup commit. */
  drifted: boolean;
}

// ─── IPC wrappers ─────────────────────────────────────────────────────────────

/**
 * Accept the current rollup state as-is for a node.
 *
 * NARROW writer — updates ONLY rollup_hash, rollup_generation, rollup_state.
 * Enforces rollup_generation optimistic lock — returns Err if generation advanced.
 * L1 nodes: justification REQUIRED (enforce in UI before calling).
 *
 * Returns the new rollup_generation on success.
 */
export async function acceptRollupAsIs(args: {
  uuid: string;
  expectedGeneration: number;
  justification?: string;
  keepPin: boolean;
}): Promise<number> {
  return await invoke<number>('accept_rollup_as_is', {
    uuid: args.uuid,
    expectedGeneration: args.expectedGeneration,
    justification: args.justification ?? null,
    keepPin: args.keepPin,
  });
}

/**
 * Fetch the upstream body + cited child sections + recent journal entries for
 * the UNPINNED-amber "Draft propagation for review" path.
 *
 * READ-ONLY — no writes.
 */
export async function draftPropagationDiff(
  upstreamUuid: string,
): Promise<DraftPropagationContext> {
  return await invoke<DraftPropagationContext>('draft_propagation_diff', {
    upstreamUuid,
  });
}

/**
 * Fetch current cited child section texts for the PINNED-amber
 * "Review children's changes" path.
 *
 * READ-ONLY. v1 limitation: section_text_at_last_generation is always null.
 */
export async function readChildrenSectionDiffs(
  upstreamUuid: string,
): Promise<ChildSectionDiff[]> {
  return await invoke<ChildSectionDiff[]>('read_children_section_diffs', {
    upstreamUuid,
  });
}
