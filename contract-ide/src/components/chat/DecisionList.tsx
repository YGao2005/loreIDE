/**
 * DecisionList — renders citations the chat agent emitted via the
 * `record_decision` MCP tool, scoped to a single agent run (tracking_id).
 *
 * Each decision card shows:
 *   - decision (one-line title)
 *   - rationale
 *   - one row per anchor: "<file>:<line_start>-<line_end>", expandable
 *
 * Expanding an anchor calls `read_code_region` (Tauri IPC) and renders the
 * code slice inline. We intentionally use a plain <pre> with a small line-
 * number gutter rather than embedding Monaco — the surface is read-only and
 * Monaco's bundle would dwarf the rest of the chat panel.
 *
 * Mounted from ChatStream BETWEEN the assistant text/tool events and the
 * result chip, so live decisions appear as the agent records them.
 */

import { memo, useEffect, useMemo, useState } from 'react';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileCodeIcon,
  Loader2Icon,
  ScrollTextIcon,
} from 'lucide-react';
import { useChatDecisionsStore, type Decision, type DecisionAnchor } from '@/store/chatDecisions';
import { readCodeRegion, type CodeRegion } from '@/ipc/chatDecisions';
import { cn } from '@/lib/utils';

interface DecisionListProps {
  trackingId: string;
}

const EMPTY_UUIDS: readonly string[] = [];

export const DecisionList = memo(function DecisionList({ trackingId }: DecisionListProps) {
  // Select stable primitives — both `byTracking[trackingId]` and `byUuid` are
  // replaced by reference on every store mutation, so `useSyncExternalStore`
  // sees stable snapshots between mutations. Mapping to Decision[] happens in
  // useMemo so we don't return a fresh array each render (which would loop).
  const uuids = useChatDecisionsStore((s) => s.byTracking[trackingId] ?? EMPTY_UUIDS);
  const byUuid = useChatDecisionsStore((s) => s.byUuid);
  const decisions = useMemo(
    () => uuids.map((u) => byUuid[u]).filter(Boolean) as Decision[],
    [uuids, byUuid],
  );
  if (decisions.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 mt-1">
      <div className="flex items-center gap-1.5 px-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">
        <ScrollTextIcon className="size-3" />
        <span>
          {decisions.length} decision{decisions.length === 1 ? '' : 's'} recorded
        </span>
      </div>
      {decisions.map((d) => (
        <DecisionCard key={d.uuid} decision={d} />
      ))}
    </div>
  );
});

function DecisionCard({ decision }: { decision: Decision }) {
  return (
    <div className="rounded-md border border-border/50 bg-muted/15 overflow-hidden">
      <div className="px-3 py-2 border-b border-border/40 bg-muted/25">
        <div className="text-[12px] font-medium text-foreground/95 leading-snug">
          {decision.decision}
        </div>
        {decision.rationale && (
          <div className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
            {decision.rationale}
          </div>
        )}
      </div>
      <ul className="divide-y divide-border/30">
        {decision.anchors.map((a, i) => (
          <AnchorRow key={`${a.file}:${a.line_start}-${a.line_end}-${i}`} anchor={a} />
        ))}
      </ul>
    </div>
  );
}

function AnchorRow({ anchor }: { anchor: DecisionAnchor }) {
  const [open, setOpen] = useState(false);
  const [region, setRegion] = useState<CodeRegion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Lazy-fetch on first expand so we don't read N files for unopened anchors.
  useEffect(() => {
    if (!open || region || loading || error) return;
    let cancelled = false;
    setLoading(true);
    void readCodeRegion(anchor.file, anchor.line_start, anchor.line_end)
      .then((r) => {
        if (!cancelled) setRegion(r);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, anchor.file, anchor.line_start, anchor.line_end, region, loading, error]);

  const fileLabel = useMemo(() => {
    // Show last two path segments — enough disambiguation, doesn't blow the
    // line. Full path is in the title attribute on hover.
    const parts = anchor.file.split('/');
    if (parts.length <= 2) return anchor.file;
    return `…/${parts.slice(-2).join('/')}`;
  }, [anchor.file]);

  const rangeLabel =
    anchor.line_start === anchor.line_end
      ? `:${anchor.line_start}`
      : `:${anchor.line_start}-${anchor.line_end}`;

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'w-full flex items-center gap-1.5 px-3 py-1.5',
          'text-left text-[11px] text-muted-foreground hover:text-foreground/90',
          'hover:bg-muted/30 transition-colors',
        )}
        title={`${anchor.file}${rangeLabel}`}
      >
        {open ? (
          <ChevronDownIcon className="size-3 shrink-0" />
        ) : (
          <ChevronRightIcon className="size-3 shrink-0" />
        )}
        <FileCodeIcon className="size-3 shrink-0" />
        <span className="font-mono truncate">
          {fileLabel}
          <span className="text-foreground/60">{rangeLabel}</span>
        </span>
        {anchor.kind === 'diff' && (
          <span className="ml-1 shrink-0 inline-flex items-center px-1 py-0.5 rounded font-mono text-[9px] uppercase tracking-wider bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
            diff
          </span>
        )}
        {loading && (
          <Loader2Icon className="ml-auto size-3 shrink-0 animate-spin opacity-60" />
        )}
      </button>
      {open && (
        <div className="border-t border-border/30 bg-background/60">
          {loading && !region && (
            <div className="px-3 py-2 text-[10px] text-muted-foreground/70">
              Reading {anchor.file}…
            </div>
          )}
          {error && (
            <div className="px-3 py-2 text-[10px] text-red-600 dark:text-red-400">
              Couldn't read region: {error}
            </div>
          )}
          {region && <CodeBlock region={region} />}
        </div>
      )}
    </li>
  );
}

function CodeBlock({ region }: { region: CodeRegion }) {
  const lines = region.text.split('\n');
  return (
    <pre className="text-[11px] font-mono leading-relaxed overflow-x-auto max-h-72 overflow-y-auto py-1.5">
      {lines.map((line, i) => {
        const lineNo = region.line_start + i;
        return (
          <div key={i} className="flex">
            <span className="shrink-0 select-none w-10 pr-2 text-right text-muted-foreground/40 tabular-nums">
              {lineNo}
            </span>
            <span className="whitespace-pre text-foreground/90 pr-3">{line}</span>
          </div>
        );
      })}
    </pre>
  );
}
