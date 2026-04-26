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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 15 Plan 04 — TRUST-03: Delete path + impact preview IPC wrappers
// ─────────────────────────────────────────────────────────────────────────────

/** Wire values for the reason picker — mapped FROM demo-grade labels in DeleteRuleConfirmDialog. */
export type DeleteReasonKind = 'Hallucinated' | 'Obsolete' | 'Wrong scope' | 'Duplicate' | 'Other';

/**
 * Atomically tombstone a substrate rule.
 * Calls delete_substrate_rule Rust IPC which:
 *   1. Validates reason_kind + free-text requirement for Other.
 *   2. UPDATEs substrate_nodes: invalid_at=now, invalidated_reason='<kind>: <text>',
 *      invalidated_by=actor WHERE uuid=? AND invalid_at IS NULL.
 *   3. INSERTs substrate_edits row kind='delete'.
 *   4. FTS trigger fires — tombstoned rule no longer returned by Cmd+P Substrate filter.
 *
 * Throws "not found or already tombstoned" if the rule was concurrently deleted.
 * Throws "free-text required when reason is Other" if validation fails.
 * Actor hardcoded to project email for v1. TODO(v2): read from settings/auth.
 */
export async function deleteSubstrateRule(
  uuid: string,
  reasonKind: DeleteReasonKind,
  reasonText: string,
): Promise<void> {
  return invoke<void>('delete_substrate_rule', {
    uuid,
    reasonKind,
    reasonText,
    actor: 'human:yangg40@g.ucla.edu',
  });
}

/** Wire-shape for a graph atom that cites this substrate rule via anchored_uuids. */
export interface AtomCitation {
  uuid: string;
  name: string;
  kind: string;
  level: number;
}

/** Wire-shape for a recent agent receipt that included this rule in substrate_rules_json. */
export interface RecentPromptSummary {
  receipt_id: string;
  created_at: string;
  /** Best-effort excerpt — may be empty string in v1. */
  prompt_excerpt: string;
}

/** Aggregate returned by getSubstrateImpact. */
export interface SubstrateImpact {
  atom_count: number;
  /** Capped at 50 on the backend — UI shows first 10 + "and N more". */
  atoms: AtomCitation[];
  recent_prompt_count: number;
  /** Capped at 50 on the backend — UI shows first 5 + "and N more". */
  recent_prompts: RecentPromptSummary[];
}

/**
 * Fetch the blast radius of a substrate rule:
 *   - atoms: graph nodes whose anchored_uuids contain this rule's uuid
 *   - recent_prompts: receipts from the past 7 days that referenced this rule
 *
 * Called on mount by SubstrateImpactPreview. Returns in <500ms on demo SQLite snapshot.
 */
export async function getSubstrateImpact(uuid: string): Promise<SubstrateImpact> {
  return invoke<SubstrateImpact>('get_substrate_impact', { uuid });
}
