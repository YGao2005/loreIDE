/**
 * Phase 9 Plan 09-02 — MassEditResultBanner: post-apply summary banner.
 *
 * Shown inside MassEditModal after the apply phase completes (applyState === 'done').
 *
 * Displays four lines (as applicable):
 *   1. "{applied} of {total} applied"
 *   2. "{skipped_pinned} pinned · skipped"    (only when > 0)
 *   3. "{errors} errors — see console"        (only when > 0)
 *   4. "{upstreamImpact} upstream contracts now amber — reconcile via graph"
 *      (only when > 0; computed from rollupStaleUuids diff)
 *
 * The upstream-impact count is the MASS-02 cascade visibility requirement:
 * after mass edits, ancestors may flip to rollup_stale (amber ring on the
 * canvas). This banner surfaces how many flipped so the user knows to
 * reconcile without having to scan the canvas manually.
 *
 * upstreamImpact = max(0, rollupStaleNow - rollupStaleAtStart)
 *
 * rollupStaleAtStart is snapshotted in MassEditTrigger BEFORE the apply runs
 * so that any stale nodes that were already amber before the batch are not
 * counted as new impact. The banner subscribes to useRollupStore so the count
 * updates if more rollup events fire post-apply (Phase 8 PROP-02 events are
 * async).
 *
 * Null-render when result is null (before apply runs).
 */

import { useRollupStore } from '@/store/rollup';
import { useMassEditStore } from '@/store/massEdit';

export function MassEditResultBanner() {
  const result = useMassEditStore((s) => s.result);
  const rollupStaleAtStart = useMassEditStore((s) => s.rollupStaleAtStart);
  // Subscribe live — rollup events may arrive asynchronously after apply
  const rollupStaleNow = useRollupStore((s) => s.rollupStaleUuids.size);

  if (!result) return null;

  const total =
    result.applied + result.skipped_pinned + result.errors;
  const upstreamImpact = Math.max(0, rollupStaleNow - rollupStaleAtStart);

  return (
    <div
      className="rounded-md border bg-muted/40 p-4 space-y-1.5 text-sm"
      role="status"
      aria-live="polite"
    >
      {/* Line 1: applied count */}
      <div className="font-medium">
        {result.applied} of {total} applied
      </div>

      {/* Line 2: pinned skips (POST-APPLY count — accumulated from apply loop) */}
      {result.skipped_pinned > 0 && (
        <div className="text-amber-900 text-xs">
          {result.skipped_pinned} pinned · skipped
        </div>
      )}

      {/* Line 3: errors */}
      {result.errors > 0 && (
        <div className="text-red-700 text-xs">
          {result.errors}{' '}
          {result.errors === 1 ? 'error' : 'errors'} — see console
        </div>
      )}

      {/* Line 4: MASS-02 cascade visibility — upstream contracts that flipped
          to stale during the apply window. */}
      {upstreamImpact > 0 && (
        <div className="text-amber-900 text-xs font-medium">
          {upstreamImpact} upstream{' '}
          {upstreamImpact === 1 ? 'contract' : 'contracts'} now amber —
          reconcile via graph
        </div>
      )}
    </div>
  );
}
