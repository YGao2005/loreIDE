/**
 * Phase 8 Plan 08-06 — Staleness annotation wrapper (PROP-04, MCP-02).
 *
 * Wraps MCP tool response bodies with a staleness header when rollup_state ≠ 'fresh'.
 * Applied by get_contract and find_by_intent to signal downstream agents that the
 * L2/L3 contract they're reading may not reflect the current state of cited children.
 *
 * v1 phrasing rationale (W7 decision from RESEARCH.md):
 *   - "cited children may have diverged" (v1 — what we ship)
 *   - NOT "since N dependent children changed" (v2 — requires per-generation snapshot table)
 *   - We don't have a per-generation snapshot table in v1, so we cannot compute exact diff.
 *   - Signal "may have diverged" honestly rather than overclaiming precision.
 *
 * Phase 9+ mass-edit ranking will key off the header format — do not change the
 * phrasing without updating the ranking logic.
 */

export interface StalenessSummary {
  /** e.g. 'L1' | 'L2' | 'L3' — the level of the stale node */
  level: string;
  /** How many distinct cited children have at least one section that may have changed */
  dependent_children_changed: number;
  child_summaries: Array<{
    child_uuid: string;
    /** Section names cited in rollup_inputs for this child */
    sections_changed: string[];
  }>;
}

/**
 * Prepend a staleness annotation header to a contract body.
 *
 * Returns `body` unchanged if `summary` is null (node is fresh or untracked).
 *
 * Verbatim header format (load-bearing — Phase 9 mass-edit ranking keys on this):
 *   `[This <level> is rollup-stale; cited children may have diverged: <child_uuid> (<sections>); ...]`
 *
 * Example output:
 *   ```
 *   [This L2 is rollup-stale; cited children may have diverged: abc12345 (intent, examples); def67890 (role).]
 *
 *   ## Intent
 *   ...
 *   ```
 */
export function annotateStaleness(body: string, summary: StalenessSummary | null): string {
  if (!summary) return body;

  const childList = summary.child_summaries
    .map((c) => `${c.child_uuid} (${c.sections_changed.join(', ')})`)
    .join('; ');

  // W7 phrasing: "may have diverged" — softened from "N dependent children changed"
  // because v1 lacks per-generation snapshot table to compute exact diff.
  const header = `[This ${summary.level} is rollup-stale; cited children may have diverged: ${childList}.]\n\n`;

  return header + body;
}
