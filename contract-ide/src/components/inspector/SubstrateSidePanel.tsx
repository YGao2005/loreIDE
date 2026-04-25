/**
 * Read-only Substrate side panel (Plan 11-05).
 *
 * Purpose: secondary investigation surface for lineage-scoped substrate.
 *   - Delegate overlay is the PRIMARY path (LLM rerank, expensive).
 *   - This panel is the CHEAP path (FTS5 only, no rerank) for browsing.
 *
 * CONTEXT lock: READ-ONLY in v1. No edit / add / delete affordances.
 * Phase 12 supersession is the v1 "edit" path (re-ingest invalidates).
 *
 * Row format per CONTEXT lock:
 *   kind icon (⚖ / ✓ / ? / ✓? / ⚠) + rubric label (60 chars) +
 *   applies_when (full text, wrapped) + [source] token +
 *   confidence visual (italic + lighter color for 'inferred')
 *
 * Auto-closes when the selected node changes (mirror Phase 7 ReconcilePanel
 * pattern — handled in the Inspector via useEffect on selectedNode.uuid).
 */

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { SubstrateHit } from '../../ipc/delegate';

interface SubstrateSidePanelProps {
  scopeUuid: string;
  onClose: () => void;
}

const KIND_ICON: Record<string, string> = {
  constraint: '⚖',
  decision: '✓',
  open_question: '?',
  resolved_question: '✓?',
  attempt: '⚠',
};

const KIND_LABEL: Record<string, string> = {
  constraint: 'Constraint',
  decision: 'Decision',
  open_question: 'Open question',
  resolved_question: 'Resolved',
  attempt: 'Attempt',
};

export function SubstrateSidePanel({ scopeUuid, onClose }: SubstrateSidePanelProps) {
  const [hits, setHits] = useState<SubstrateHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHits(null);
    setError(null);

    invoke<SubstrateHit[]>('list_substrate_for_atom', {
      scopeUuid,
      query: null,
      limit: 50,
    })
      .then((result) => {
        if (!cancelled) setHits(result);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [scopeUuid]);

  const handleSourceClick = (hit: SubstrateHit) => {
    if (hit.source_session_id !== null && hit.source_turn_ref !== null) {
      void emit('source:click', {
        session_id: hit.source_session_id,
        turn_ref: hit.source_turn_ref,
      });
    }
  };

  return (
    <div className="fixed right-0 top-0 z-40 flex h-screen w-96 flex-col border-l border-border bg-background shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Substrate</h3>
          <p className="text-[10px] text-muted-foreground">
            lineage-scoped · read-only · {hits !== null ? `${hits.length} rows` : '…'}
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          aria-label="Close substrate panel"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {error && (
          <div className="rounded border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {!error && hits === null && (
          <div className="flex flex-col gap-2 pt-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded border border-border/60 bg-card p-2 animate-pulse"
                style={{ opacity: 1 - i * 0.2 }}
              >
                <div className="h-3 w-3/4 rounded bg-muted mb-1" />
                <div className="h-2 w-1/2 rounded bg-muted/60" />
              </div>
            ))}
          </div>
        )}

        {hits !== null && hits.length === 0 && (
          <div className="rounded border border-dashed border-border p-4 text-center text-xs text-muted-foreground mt-2">
            No substrate captured for this lineage yet.
            <br />
            <span className="text-[10px] opacity-70">
              Substrate appears as your team works in Claude Code.
            </span>
          </div>
        )}

        {hits?.map((hit) => (
          <SubstrateRow
            key={hit.uuid}
            hit={hit}
            onSourceClick={handleSourceClick}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="border-t border-border/60 px-4 py-2">
        <p className="text-[10px] text-muted-foreground">
          Read-only · Phase 12 supersession handles stale entries
        </p>
      </div>
    </div>
  );
}

interface SubstrateRowProps {
  hit: SubstrateHit;
  onSourceClick: (hit: SubstrateHit) => void;
}

function SubstrateRow({ hit, onSourceClick }: SubstrateRowProps) {
  const icon = KIND_ICON[hit.node_type] ?? '·';
  const kindLabel = KIND_LABEL[hit.node_type] ?? hit.node_type;
  const isInferred = hit.confidence === 'inferred';

  return (
    <div className="rounded border border-border bg-card p-2 text-xs">
      {/* Row header: icon + kind badge + confidence */}
      <div className="flex items-start gap-2 mb-1">
        <span
          className="mt-0.5 text-sm leading-none text-muted-foreground shrink-0"
          aria-hidden
          title={kindLabel}
        >
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          {/* Rubric label — italic + muted if inferred */}
          <div
            className={
              isInferred
                ? 'italic text-muted-foreground leading-snug'
                : 'font-medium leading-snug'
            }
          >
            {hit.rubric_label}
            {isInferred && (
              <span className="ml-1 text-[10px] text-muted-foreground/60 not-italic">
                (inferred)
              </span>
            )}
          </div>

          {/* applies_when — full text, wrapped */}
          {hit.applies_when && (
            <div className="mt-0.5 text-[10px] text-muted-foreground leading-snug">
              <span className="opacity-60">applies_when:</span>{' '}
              {hit.applies_when}
            </div>
          )}
        </div>
      </div>

      {/* Footer: [source] token */}
      {hit.source_session_id && (
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-muted-foreground/50 truncate max-w-[160px]">
            {hit.scope_used === 'broad' && (
              <span className="mr-1 text-amber-500/70">[broad]</span>
            )}
          </span>
          <button
            onClick={() => onSourceClick(hit)}
            className="text-[10px] text-muted-foreground hover:text-foreground hover:underline transition-colors"
            aria-label={`Jump to source turn ${hit.source_turn_ref}`}
          >
            [source]
          </button>
        </div>
      )}
    </div>
  );
}
