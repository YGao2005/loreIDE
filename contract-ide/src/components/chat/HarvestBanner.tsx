/**
 * HarvestBanner — sticky approve/deny surface for the substrate review queue.
 *
 * Pinned to the top of the chat scrollback (above message timeline). Listens
 * to `substrate:nodes-added` (fired both by the post-session distiller and
 * the live MCP tool `record_substrate_rule` via the mcp.rs stderr bridge),
 * refetches `list_pending_substrate`, and renders the queue with per-row
 * Approve / Deny buttons + an "Approve all" shortcut.
 *
 * Hidden when the queue is empty. No bottom-right toast competition: the
 * existing HarvestPanel still renders for non-chat sessions, but with this
 * banner mounted in ChatPanel the user has a clearer in-context surface.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, SparklesIcon, XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  approveSubstrate,
  listPendingSubstrate,
  rejectSubstrate,
  type PendingSubstrateRow,
} from '@/ipc/substrate_review';

const TYPE_LABEL: Record<string, string> = {
  constraint: 'Constraint',
  decision: 'Decision',
  open_question: 'Open question',
  resolved_question: 'Resolved',
  attempt: 'Attempt',
};

const TYPE_ACCENT: Record<string, string> = {
  constraint: 'text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/30',
  decision: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  open_question: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30',
  resolved_question: 'text-violet-600 dark:text-violet-400 bg-violet-500/10 border-violet-500/30',
  attempt: 'text-muted-foreground bg-muted/40 border-border-subtle',
};

export function HarvestBanner() {
  const [rows, setRows] = useState<PendingSubstrateRow[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [pendingActions, setPendingActions] = useState<Set<string>>(new Set());

  const refetch = useCallback(async () => {
    try {
      const next = await listPendingSubstrate();
      setRows(next);
    } catch (e) {
      console.warn('[HarvestBanner] list_pending_substrate failed', e);
    }
  }, []);

  // Refetch on multiple signals so the banner appears regardless of which
  // path produced the row:
  //
  //   1. `substrate:nodes-added` — fired by mcp.rs (persistent sidecar) and
  //      agent.rs (chat agent's MCP child, IF claude forwards stderr —
  //      empirically unreliable across CLI versions).
  //   2. `agent:stream` — every JSONL line from the chat agent. We parse for
  //      tool_use of `mcp__contract-ide__record_substrate_rule` and refetch
  //      on hit. This is the load-bearing signal: the agent always emits a
  //      tool_use in its stream-json output when it calls the MCP tool, and
  //      claude doesn't isolate this the way it isolates child stderr.
  //   3. `agent:complete` — backstop. If somehow the live signal misses, the
  //      banner still appears at run-end.
  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    void refetch();

    void listen('substrate:nodes-added', () => {
      void refetch();
    }).then((u) => {
      if (cancelled) u();
      else unlisteners.push(u);
    });

    void listen<{ line: string; is_stderr?: boolean }>('agent:stream', (evt) => {
      const line = evt.payload?.line;
      if (!line) return;
      // Quick reject before JSON.parse — every chat line passes through here,
      // so we want this to be cheap when it doesn't match.
      if (!line.includes('record_substrate_rule')) return;
      try {
        const v = JSON.parse(line) as Record<string, unknown>;
        if (v.type !== 'assistant') return;
        const msg = v.message as Record<string, unknown> | undefined;
        const content = msg?.content;
        if (!Array.isArray(content)) return;
        for (const block of content) {
          if (!block || typeof block !== 'object') continue;
          const b = block as Record<string, unknown>;
          if (
            b.type === 'tool_use' &&
            typeof b.name === 'string' &&
            b.name.endsWith('record_substrate_rule')
          ) {
            // Small delay so the MCP write commits before we read.
            setTimeout(() => void refetch(), 150);
            return;
          }
        }
      } catch {
        // Non-JSON lines (claude warnings etc.) — ignore.
      }
    }).then((u) => {
      if (cancelled) u();
      else unlisteners.push(u);
    });

    void listen('agent:complete', () => {
      void refetch();
    }).then((u) => {
      if (cancelled) u();
      else unlisteners.push(u);
    });

    return () => {
      cancelled = true;
      for (const u of unlisteners) u();
    };
  }, [refetch]);

  const markActing = useCallback((uuid: string) => {
    setPendingActions((prev) => {
      const next = new Set(prev);
      next.add(uuid);
      return next;
    });
  }, []);

  const dropFromQueue = useCallback((uuid: string) => {
    setRows((prev) => prev.filter((r) => r.uuid !== uuid));
    setPendingActions((prev) => {
      if (!prev.has(uuid)) return prev;
      const next = new Set(prev);
      next.delete(uuid);
      return next;
    });
  }, []);

  const handleApprove = useCallback(
    async (uuid: string) => {
      markActing(uuid);
      try {
        await approveSubstrate(uuid);
        dropFromQueue(uuid);
      } catch (e) {
        console.error('[HarvestBanner] approve failed', e);
        setPendingActions((prev) => {
          const next = new Set(prev);
          next.delete(uuid);
          return next;
        });
      }
    },
    [markActing, dropFromQueue],
  );

  const handleReject = useCallback(
    async (uuid: string) => {
      markActing(uuid);
      try {
        await rejectSubstrate(uuid);
        dropFromQueue(uuid);
      } catch (e) {
        console.error('[HarvestBanner] reject failed', e);
        setPendingActions((prev) => {
          const next = new Set(prev);
          next.delete(uuid);
          return next;
        });
      }
    },
    [markActing, dropFromQueue],
  );

  const handleApproveAll = useCallback(async () => {
    const targets = rows.map((r) => r.uuid);
    targets.forEach(markActing);
    await Promise.allSettled(
      targets.map(async (uuid) => {
        try {
          await approveSubstrate(uuid);
          dropFromQueue(uuid);
        } catch (e) {
          console.error('[HarvestBanner] approve-all entry failed', uuid, e);
        }
      }),
    );
  }, [rows, markActing, dropFromQueue]);

  const headline = useMemo(() => {
    if (rows.length === 0) return null;
    return rows.length === 1
      ? '1 rule captured — review before saving'
      : `${rows.length} rules captured — review before saving`;
  }, [rows.length]);

  if (rows.length === 0) return null;

  return (
    <div
      className={cn(
        'mx-3 mt-2 mb-2 rounded-lg border bg-background/95 shadow-sm',
        'border-amber-400/50 dark:border-amber-500/40',
        'shadow-[0_0_0_1px_rgba(245,158,11,0.08),0_2px_8px_-2px_rgba(245,158,11,0.18)]',
        'animate-in fade-in slide-in-from-top-1 duration-200',
      )}
      role="region"
      aria-label="Substrate review queue"
    >
      {/* Header row — collapse toggle, count, approve-all */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded((o) => !o)}
          className="flex items-center gap-1.5 min-w-0 flex-1 text-left"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDownIcon className="size-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
          ) : (
            <ChevronRightIcon className="size-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
          )}
          <SparklesIcon
            className="size-3.5 text-amber-500 shrink-0"
            strokeWidth={2.25}
          />
          <span className="text-[12px] font-medium text-foreground/90 truncate">
            {headline}
          </span>
        </button>
        <button
          type="button"
          onClick={() => void handleApproveAll()}
          className={cn(
            'shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md',
            'text-[10px] font-medium',
            'bg-amber-500/15 text-amber-700 dark:text-amber-300',
            'border border-amber-500/40',
            'hover:bg-amber-500/25 transition-colors',
          )}
          title="Approve every pending rule in this list"
        >
          <CheckIcon className="size-3" />
          Approve all
        </button>
      </div>

      {/* Per-rule rows */}
      {expanded && (
        <ul className="border-t border-amber-400/30 dark:border-amber-500/30 divide-y divide-amber-400/20 dark:divide-amber-500/20">
          {rows.map((r) => (
            <PendingRow
              key={r.uuid}
              row={r}
              busy={pendingActions.has(r.uuid)}
              onApprove={() => void handleApprove(r.uuid)}
              onReject={() => void handleReject(r.uuid)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface PendingRowProps {
  row: PendingSubstrateRow;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}

function PendingRow({ row, busy, onApprove, onReject }: PendingRowProps) {
  const accent = TYPE_ACCENT[row.node_type] ?? TYPE_ACCENT.attempt;
  const label = TYPE_LABEL[row.node_type] ?? row.node_type;

  return (
    <li className="px-3 py-2 flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span
            className={cn(
              'shrink-0 inline-flex items-center px-1.5 py-0.5 rounded font-mono text-[9px] uppercase tracking-wider border',
              accent,
            )}
          >
            {label}
          </span>
          <span
            className="text-[12px] font-medium text-foreground/90 truncate"
            title={row.name}
          >
            {row.name}
          </span>
        </div>
        {row.text && row.text !== row.name && (
          <div className="text-[11px] text-foreground/70 italic leading-snug pl-1">
            "{row.text}"
          </div>
        )}
        {(row.scope || row.applies_when) && (
          <div className="mt-1 flex flex-wrap gap-1.5 pl-1 text-[10px] text-muted-foreground/80">
            {row.scope && (
              <span>
                <span className="text-muted-foreground/60">scope:</span> {row.scope}
              </span>
            )}
            {row.applies_when && (
              <span>
                <span className="text-muted-foreground/60">applies when:</span>{' '}
                {row.applies_when}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-1">
        <button
          type="button"
          onClick={onApprove}
          disabled={busy}
          className={cn(
            'inline-flex items-center justify-center size-6 rounded-md',
            'border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
            'hover:bg-emerald-500/20 transition-colors',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
          aria-label="Approve rule"
          title="Approve — saves this rule and makes it visible to future agent runs"
        >
          <CheckIcon className="size-3.5" strokeWidth={2.5} />
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={busy}
          className={cn(
            'inline-flex items-center justify-center size-6 rounded-md',
            'border border-border-subtle bg-muted/30 text-muted-foreground',
            'hover:bg-red-500/15 hover:border-red-500/30 hover:text-red-600 dark:hover:text-red-400',
            'transition-colors',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
          aria-label="Deny rule"
          title="Deny — discards this rule (agent may capture it again later)"
        >
          <XIcon className="size-3.5" strokeWidth={2.5} />
        </button>
      </div>
    </li>
  );
}
