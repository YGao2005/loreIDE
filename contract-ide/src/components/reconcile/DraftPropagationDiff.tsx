/**
 * Phase 8 Plan 08-06 — DraftPropagationDiff component (UNPINNED-amber path).
 *
 * Force-shows the proposed-edit context BEFORE any commit, per RESEARCH.md
 * (Jin & Chen 2026 / Stengg 2025 backstop: "user is the backstop against LLM
 * overconfidence"). The user must review before any write occurs.
 *
 * v1: clipboard-copy only per CONTEXT.md "correct not polished".
 * v2 carry-over: dispatch directly via run_agent (08-04).
 */

import { useState } from 'react';
import type { DraftPropagationContext } from '@/ipc/reconcile';

interface Props {
  context: DraftPropagationContext;
  upstreamUuid: string;
  onBack: () => void;
}

function buildPropagationPrompt(
  uuid: string,
  context: DraftPropagationContext,
): string {
  const childSections = context.cited_child_sections
    .map(
      (s) =>
        `## ${s.child_uuid} :: ${s.section_name}\n${s.section_text || '(empty)'}`,
    )
    .join('\n\n');

  const journalLines = context.recent_journal_entries
    .map((e) => `- [${e.ts}] ${e.intent}`)
    .join('\n');

  return `Upstream contract ${uuid} is rollup-stale. Cited child sections have changed.

Current upstream body:
${context.current_body || '(empty)'}

Cited child sections (current state):
${childSections || '(none)'}

Recent intent journal:
${journalLines || '(no journal entries)'}

Propose a minimal edit to the upstream body that reflects the cited child changes.
Write only the new contract body in a fenced code block. Do not modify cited child contracts.`;
}

export default function DraftPropagationDiff({ context, upstreamUuid, onBack }: Props) {
  const [copied, setCopied] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());

  const prompt = buildPropagationPrompt(upstreamUuid, context);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleSection = (i: number) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      {/* Current upstream body */}
      <div>
        <div className="font-medium text-xs text-muted-foreground uppercase tracking-wide mb-1">
          Current upstream body
        </div>
        <pre className="bg-muted rounded p-2 text-xs overflow-auto max-h-40 whitespace-pre-wrap break-words">
          {context.current_body || '(empty)'}
        </pre>
      </div>

      {/* Cited child sections */}
      {context.cited_child_sections.length > 0 && (
        <div>
          <div className="font-medium text-xs text-muted-foreground uppercase tracking-wide mb-1">
            Cited child sections ({context.cited_child_sections.length})
          </div>
          <div className="flex flex-col gap-1">
            {context.cited_child_sections.map((s, i) => (
              <div key={i} className="border rounded">
                <button
                  type="button"
                  className="w-full text-left px-2 py-1.5 text-xs font-mono hover:bg-muted flex items-center justify-between"
                  onClick={() => toggleSection(i)}
                >
                  <span className="truncate">
                    {s.child_uuid.slice(0, 8)} :: {s.section_name}
                  </span>
                  <span className="text-muted-foreground ml-2">
                    {expandedSections.has(i) ? '▲' : '▼'}
                  </span>
                </button>
                {expandedSections.has(i) && (
                  <pre className="px-2 pb-2 text-xs overflow-auto max-h-32 whitespace-pre-wrap break-words border-t">
                    {s.section_text || '(empty)'}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent journal entries */}
      {context.recent_journal_entries.length > 0 && (
        <div>
          <div className="font-medium text-xs text-muted-foreground uppercase tracking-wide mb-1">
            Recent intent journal ({context.recent_journal_entries.length})
          </div>
          <ul className="flex flex-col gap-0.5">
            {context.recent_journal_entries.map((e, i) => (
              <li key={i} className="text-xs text-muted-foreground truncate">
                <span className="font-mono text-xs">[{e.ts.slice(0, 19)}]</span>{' '}
                {e.intent}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Footer actions */}
      <div className="flex items-center justify-between pt-1 border-t mt-1">
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={onBack}
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="rounded-md bg-primary text-primary-foreground text-xs px-3 py-1.5 hover:bg-primary/90 transition-colors"
        >
          {copied ? 'Copied!' : 'Copy proposed-edit prompt'}
        </button>
      </div>
    </div>
  );
}
