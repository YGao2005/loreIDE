/**
 * Phase 8 Plan 08-06 — ChildrenChangesView component (PINNED-amber path).
 *
 * Read-only diff of cited child sections for the "Review children's changes"
 * action in PinnedAmberActions. Informational only — the user decides what
 * to do next (unpin, accept-as-is-keep-pin, or edit manually).
 *
 * v1 limitation: section_text_at_last_generation is always null (no historical
 * body snapshots). We show current section text + a "drifted" indicator.
 * v2 carry-over: add upstream_generation_snapshots table for real diffs.
 */

import type { ChildSectionDiff } from '@/ipc/reconcile';

interface Props {
  diffs: ChildSectionDiff[];
  onBack: () => void;
}

export default function ChildrenChangesView({ diffs, onBack }: Props) {
  if (diffs.length === 0) {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <div className="text-muted-foreground text-sm py-4 text-center">
          No cited child sections found.
        </div>
        <div className="flex justify-start pt-1 border-t">
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={onBack}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  const driftedCount = diffs.filter((d) => d.drifted).length;

  return (
    <div className="flex flex-col gap-3 text-sm">
      {/* Summary header */}
      <div className="text-xs text-muted-foreground">
        {driftedCount > 0 ? (
          <span className="text-amber-500 font-medium">
            {driftedCount} of {diffs.length} sections have changed since last rollup commit.
          </span>
        ) : (
          <span>
            {diffs.length} sections — no hash mismatches detected.
          </span>
        )}
        <div className="mt-0.5 opacity-70">
          v1 limitation: previous generation body not stored — showing current state only.
        </div>
      </div>

      {/* Section list */}
      <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
        {diffs.map((d, i) => (
          <div key={i} className="border rounded">
            {/* Header */}
            <div className="flex items-center justify-between px-2 py-1.5 border-b bg-muted/40">
              <span className="font-mono text-xs truncate">
                {d.child_uuid.slice(0, 8)} :: {d.section_name}
              </span>
              {d.drifted && (
                <span className="ml-2 text-xs text-amber-500 shrink-0">drifted</span>
              )}
            </div>

            {/* Content */}
            <div className="p-2">
              {d.section_text_at_last_generation === null ? (
                <div className="text-xs text-muted-foreground mb-1 italic">
                  Last-committed snapshot not yet recorded — v2 will compare against generation N.
                </div>
              ) : null}
              <pre className="text-xs overflow-auto max-h-24 whitespace-pre-wrap break-words">
                {d.section_text_now || '(empty)'}
              </pre>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex justify-start pt-1 border-t">
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={onBack}
        >
          Back
        </button>
      </div>
    </div>
  );
}
