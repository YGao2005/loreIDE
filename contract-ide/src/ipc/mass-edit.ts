/**
 * Phase 9 Plan 09-01/09-02 — TypeScript IPC wrappers for mass-edit.
 *
 * 09-01 shipped: findByIntentMass (Rust IPC → find_by_intent_mass Tauri command).
 *
 * 09-02 extends with: applyMassEdit — per-node contract write via the existing
 * write_contract single-writer path. Routes through readContractFrontmatter
 * (merge-read) + writeContract (single-writer) to preserve Phase 8 rollup/
 * propagation frontmatter fields and honour the DERIVE-03 pin guard at the
 * Rust level.
 *
 * Routing choice: Option A (Rust IPC) — the MCP sidecar is stdio-only and
 * not reachable from React. Mirrors the inspector's saveContract pattern from
 * Plan 04-02 for the merge-read + write_contract sequence.
 *
 * SKIPPED-PINNED detection: human_pinned is checked CLIENT-SIDE by reading
 * the existing frontmatter before the write. If human_pinned is true, we
 * return status='skipped_pinned' immediately WITHOUT calling write_contract
 * (belt-and-suspenders; write_contract's DERIVE-03 guard would also block it).
 * This surfaces the SKIPPED-PINNED state to the accumulator loop in
 * MassEditModal before any Rust round-trip.
 */

import { invoke } from '@tauri-apps/api/core';
import { readContractFrontmatter } from '@/ipc/inspector';
import { writeContract } from '@/ipc/contracts';
import { useGraphStore } from '@/store/graph';

/** A single mass-edit retrieval match. */
export interface MassMatchResult {
  uuid: string;
  name: string;
  level: string;
  kind: string;
  snippet: string;
  /** Full contract body — returned so 09-02 review queue can show diff preview
   * without a second round-trip. */
  body: string;
  /** True when nodes.human_pinned is set. Surfaced here so 09-02 can show
   * predictive pinned-count in the review queue BEFORE apply runs. */
  human_pinned: boolean;
  /** BM25 × section weight score (higher = better match). */
  weighted_score: number;
  /** Which H2 section the snippet was found in (e.g. 'invariants', 'notes').
   * Undefined when section detection failed or snippet not in body. */
  matched_section?: string;
}

/** Mass-edit retrieval response — mirrors Rust MassMatchResponse struct. */
export interface MassMatchResponse {
  query: string;
  /** Always 'disabled' in Phase 9 v1 — keyword-only fallback per MASS-01. */
  embedding_status: 'disabled' | 'enabled';
  matches: MassMatchResult[];
}

/**
 * Retrieve contracts matching a natural-language query for mass editing.
 *
 * Returns the full FTS5 match set (default cap 100) with section-weighted
 * re-ranking. Uses the Rust IPC command `find_by_intent_mass` which runs the
 * same SQL as the MCP tool but is directly callable from the frontend.
 *
 * - embedding_status: always 'disabled' in v1 (keyword-only fallback)
 * - human_pinned: true when the node is human-pinned (DERIVE-03 guard)
 * - matched_section: which H2 section the snippet came from (for UI labeling)
 */
export async function findByIntentMass(
  query: string,
  limit = 100,
): Promise<MassMatchResponse> {
  return invoke<MassMatchResponse>('find_by_intent_mass', { query, limit });
}

// ─── 09-02: per-node apply ────────────────────────────────────────────────

export interface ApplyResult {
  /** 'applied' — write_contract succeeded.
   * 'skipped_pinned' — node has human_pinned=true (DERIVE-03 guard).
   * 'error' — unexpected failure (see message). */
  status: 'applied' | 'skipped_pinned' | 'error';
  message?: string;
  uuid: string;
}

/**
 * Apply a single mass-edit body write to a node via the write_contract
 * single-writer path.
 *
 * Merge-read pattern (Phase 4 Plan 04-02): reads the existing frontmatter
 * first so Phase 8 rollup/propagation fields (rollup_inputs, rollup_hash,
 * rollup_state, rollup_generation, parent) are preserved across the write.
 * Hardcoding default frontmatter would wipe edge rows on every mass-edit save
 * (write_contract DELETE FROM edges WHERE source_uuid = ?).
 *
 * SKIPPED-PINNED detection (Pitfall 1 from 09-RESEARCH.md): checked client-
 * side from the frontmatter.human_pinned field to surface the skip count
 * BEFORE any Rust round-trip. write_contract has its own pin guard (DERIVE-03)
 * so this is belt-and-suspenders, but checking here lets the accumulator in
 * MassEditModal count skipped_pinned accurately even if write_contract were
 * to somehow not return the SKIPPED-PINNED prefix.
 *
 * Serial execution (not parallel): MassEditModal calls this once per selected
 * node, awaiting each result before proceeding to the next, to avoid hammering
 * the Rust FSEvents debounce and SQLite serialization layer simultaneously
 * (Plan 09-02 Task 2 comment: "serial to avoid racing the FSEvents debouncer").
 */
export async function applyMassEdit(args: {
  uuid: string;
  body: string;
}): Promise<ApplyResult> {
  const repoPath = useGraphStore.getState().repoPath;
  if (!repoPath) {
    return {
      status: 'error',
      uuid: args.uuid,
      message: 'No repository open — cannot apply mass edit.',
    };
  }

  // Merge-read: read existing frontmatter so rollup/propagation fields survive.
  let frontmatter;
  try {
    frontmatter = await readContractFrontmatter(repoPath, args.uuid);
  } catch (e) {
    return {
      status: 'error',
      uuid: args.uuid,
      message: `readContractFrontmatter failed: ${String(e)}`,
    };
  }

  if (!frontmatter) {
    return {
      status: 'error',
      uuid: args.uuid,
      message: `No sidecar found for uuid ${args.uuid}`,
    };
  }

  // SKIPPED-PINNED detection (client-side fast path).
  // write_contract's DERIVE-03 guard would also block this, but checking here
  // avoids the Rust round-trip and ensures accurate skipped_pinned accounting.
  if (frontmatter.human_pinned === true) {
    return {
      status: 'skipped_pinned',
      uuid: args.uuid,
      message: `SKIPPED-PINNED: ${args.uuid} is human_pinned — sidecar left unchanged.`,
    };
  }

  // Write via single-writer path. write_contract handles:
  //  - atomic temp+rename disk write
  //  - section_hashes recompute (PROP-01)
  //  - SQLite upsert (cache sync)
  //  - Phase 8 rollup cascade trigger (compute_rollup_and_emit for ancestors)
  try {
    await writeContract({
      repoPath,
      uuid: args.uuid,
      frontmatter,
      body: args.body,
    });
    return { status: 'applied', uuid: args.uuid };
  } catch (e) {
    return {
      status: 'error',
      uuid: args.uuid,
      message: String(e),
    };
  }
}
