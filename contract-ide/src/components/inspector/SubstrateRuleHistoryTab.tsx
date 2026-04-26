/**
 * Phase 15 Plan 03 — TRUST-02: Chain history tab for substrate rules.
 *
 * Calls getSubstrateChain(uuid) on mount and renders all versions stacked
 * oldest→newest (version 1 at the top, current head at the bottom).
 *
 * For each version where before_text is non-null (i.e., this version was
 * produced by a refine), renders side-by-side <pre> blocks (no diff library —
 * per RESEARCH Open Question 2 decision: plain side-by-side is sufficient).
 *
 * The head row (invalid_at = null) is highlighted with a "Current" badge and
 * a left-border accent.
 */

import { useEffect, useState } from 'react';
import { getSubstrateChain, type ChainVersion } from '@/ipc/substrateTrust';

interface Props {
  uuid: string;
}

function formatTimestamp(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function SubstrateRuleHistoryTab({ uuid }: Props) {
  const [chain, setChain] = useState<ChainVersion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uuid) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getSubstrateChain(uuid)
      .then((versions) => {
        if (!cancelled) setChain(versions);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [uuid]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
        Loading history…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        Failed to load chain history: {error}
      </div>
    );
  }

  if (!chain || chain.length === 0) {
    return (
      <div className="py-4 text-sm text-muted-foreground">
        No chain history found for this rule.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {chain.map((version) => {
        const isHead = version.invalid_at === null;
        return (
          <div
            key={version.uuid}
            className={[
              'rounded border p-3 text-sm',
              isHead
                ? 'border-primary/40 border-l-2 border-l-primary bg-primary/5'
                : 'border-border bg-muted/10',
            ].join(' ')}
          >
            {/* Version header row */}
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] font-semibold text-foreground/70">
                Version {version.version_number}
              </span>
              {isHead && (
                <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                  Current
                </span>
              )}
              <span className="ml-auto text-[11px] text-muted-foreground">
                {formatTimestamp(version.valid_at)}
              </span>
            </div>

            {/* Tombstone metadata */}
            {version.invalid_at && (
              <div className="mb-2 text-[11px] text-muted-foreground">
                Superseded {formatTimestamp(version.invalid_at)}
                {version.invalidated_reason && (
                  <span className="ml-1 italic">{version.invalidated_reason}</span>
                )}
              </div>
            )}

            {/* Refine metadata (actor / reason for non-origin versions) */}
            {version.actor && (
              <div className="mb-2 text-[11px] text-muted-foreground">
                Refined by <span className="font-mono">{version.actor}</span>
                {version.reason && (
                  <>
                    {' '}— <span className="italic">{version.reason}</span>
                  </>
                )}
              </div>
            )}

            {/* Side-by-side before/after for refine steps (not for chain origin) */}
            {version.before_text != null ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    Before
                  </div>
                  <pre className="whitespace-pre-wrap rounded bg-muted/30 p-2 font-mono text-[11px] leading-relaxed text-foreground/70">
                    {version.before_text}
                  </pre>
                </div>
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    After
                  </div>
                  <pre className="whitespace-pre-wrap rounded bg-muted/30 p-2 font-mono text-[11px] leading-relaxed text-foreground/90">
                    {version.text}
                  </pre>
                </div>
              </div>
            ) : (
              /* Chain origin — show full text without before/after split */
              <pre className="mt-1 whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-foreground/80">
                {version.text}
              </pre>
            )}

            {/* Applies-when (if set) */}
            {version.applies_when && (
              <div className="mt-2 text-[11px] text-muted-foreground">
                <span className="text-muted-foreground/70">Applies when:</span>{' '}
                <span className="italic">{version.applies_when}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
