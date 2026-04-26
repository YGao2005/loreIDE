/**
 * Phase 13 Plan 09 — Beat 3 ℹ "Implicit decisions surfaced" group.
 *
 * Inserted between substrate honors and the orange flag in VerifierPanel.
 * Per CANVAS-PURPOSE.md and script Beat 3, the AccountSettings.DangerZone
 * scenario hand-crafts three rows: 24h email-link expiry, audit_log
 * destination, async cleanup. Each row shows the field + where the value
 * came from (agent default / inferred from project schema / derived from
 * contract.role).
 */

import type { ImplicitDecisionRow } from '@/store/verifier';

interface Props {
  rows: ImplicitDecisionRow[];
}

export function ImplicitDecisionsGroup({ rows }: Props) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-2 border-l-2 border-slate-500/50 pl-3 py-1">
      <div className="text-xs font-medium text-slate-300 mb-1">
        ℹ Implicit decisions surfaced (no team rule applied)
      </div>
      <ul className="space-y-0.5">
        {rows.map((r, i) => (
          <li key={i} className="text-xs text-muted-foreground">
            • <span className="text-foreground">{r.field}</span> —{' '}
            <span className="italic">{r.derivedFrom}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
