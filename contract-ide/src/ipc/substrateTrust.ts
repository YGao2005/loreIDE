/**
 * Phase 15 Plan 03 — IPC wrappers for TRUST-02 refine path.
 *
 * Two wrappers:
 *   refineSubstrateRule  — calls refine_substrate_rule Rust IPC (atomic transaction)
 *   getSubstrateChain    — calls get_substrate_chain Rust IPC (recursive CTE walk)
 *
 * Actor is hardcoded to the project email for v1 per CLAUDE.md userEmail context.
 * TODO(v2): read actor from settings / auth session instead of hardcoding here.
 */

import { invoke } from '@tauri-apps/api/core';

/** Wire-shape for a single version in the chain (mirrors ChainVersion in substrate_trust.rs). */
export interface ChainVersion {
  version_number: number;
  uuid: string;
  text: string;
  applies_when: string | null;
  valid_at: string;
  invalid_at: string | null;
  invalidated_reason: string | null;
  prev_version_uuid: string | null;
  /** Actor who performed the refine that produced this version (null for chain origin). */
  actor: string | null;
  /** Text of the version being refined away (null for chain origin). */
  before_text: string | null;
  /** Human reason supplied at refine time (null for chain origin). */
  reason: string | null;
}

/**
 * Atomically refine a substrate rule:
 *   1. Validates the old row is not already tombstoned.
 *   2. INSERTs the new chain row with prev_version_uuid = uuid.
 *   3. UPDATEs the old row with invalid_at + invalidated_reason = 'refined: <reason>'.
 *   4. INSERTs a substrate_edits audit row (kind='refine').
 *
 * Returns the new chain-head UUID on success.
 * Throws with "already tombstoned — cannot refine" if a distiller race occurred.
 */
export async function refineSubstrateRule(
  uuid: string,
  newText: string,
  newAppliesWhen: string | null,
  reason: string,
): Promise<string> {
  // actor hardcoded to the project email per CLAUDE.md userEmail context for v1.
  // TODO(v2): read from settings/auth session.
  return invoke<string>('refine_substrate_rule', {
    uuid,
    newText,
    newAppliesWhen,
    reason,
    actor: 'human:yangg40@g.ucla.edu',
  });
}

/**
 * Walk the prev_version_uuid chain from the given UUID via recursive CTE.
 * Returns versions ordered oldest→newest (version_number is 1-indexed from oldest).
 * The chain origin has actor/before_text/reason = null (no refine produced it).
 * Each subsequent version has the audit metadata from substrate_edits LEFT JOIN.
 */
export async function getSubstrateChain(uuid: string): Promise<ChainVersion[]> {
  return invoke<ChainVersion[]>('get_substrate_chain', { uuid });
}
