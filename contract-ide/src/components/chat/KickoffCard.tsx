/**
 * KickoffCard — rendered at the top of a Delegate-launched agent run in chat.
 *
 * Replaces the user-prompt bubble. Represents the approved structured plan
 * as the "ask" handed to the agent — so the chat scrollback reads:
 *   [plan card]  → [assistant stream]  → [result chip]
 * as a continuous timeline.
 *
 * Sections:
 *   - Target files (always shown, monospace list)
 *   - Substrate rules cited (collapsed → expandable list)
 *   - Implicit decisions preview (key=value)
 *   - Full prompt (collapsed → expandable preformatted block)
 */

import { useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon, SendIcon } from 'lucide-react';
import type { KickoffPayload } from '@/store/agent';

interface KickoffCardProps {
  kickoff: KickoffPayload;
}

export function KickoffCard({ kickoff }: KickoffCardProps) {
  const { plan, assembledPrompt } = kickoff;
  const [substrateOpen, setSubstrateOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);

  return (
    <div className="self-stretch rounded-lg border border-border/50 bg-muted/20 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <SendIcon className="size-3 text-muted-foreground" />
        <span className="text-[11px] font-medium text-foreground/80">
          Delegate kickoff
        </span>
      </div>

      {/* Target files — always shown */}
      <div className="mb-2.5">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">
          Target files ({plan.target_files.length})
        </div>
        {plan.target_files.length > 0 ? (
          <ul className="space-y-0.5">
            {plan.target_files.map((f) => (
              <li
                key={f}
                className="font-mono text-[11px] text-foreground/80 truncate"
                title={f}
              >
                {f}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-[11px] text-muted-foreground italic">
            (none identified)
          </div>
        )}
      </div>

      {/* Substrate rules — collapsed by default */}
      <div className="mb-2.5">
        <button
          type="button"
          onClick={() => setSubstrateOpen((o) => !o)}
          className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 hover:text-foreground/80 font-medium transition-colors"
        >
          {substrateOpen ? (
            <ChevronDownIcon className="size-3" />
          ) : (
            <ChevronRightIcon className="size-3" />
          )}
          Substrate rules cited ({plan.substrate_rules.length})
        </button>
        {substrateOpen && plan.substrate_rules.length > 0 && (
          <ul className="mt-1 space-y-1">
            {plan.substrate_rules.map((r) => (
              <li key={r.uuid} className="flex items-start gap-1.5 text-[11px]">
                <span className="text-muted-foreground/60 mt-0.5" aria-hidden>
                  •
                </span>
                <span className="text-foreground/80">
                  <span className="mr-1.5 font-mono text-muted-foreground/70 text-[10px]">
                    {r.uuid.slice(0, 12)}
                  </span>
                  {r.one_line}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Implicit decisions preview */}
      <div className="mb-2.5">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">
          Implicit decisions ({plan.decisions_preview.length})
        </div>
        {plan.decisions_preview.length > 0 ? (
          <ul className="space-y-0.5">
            {plan.decisions_preview.map((d) => (
              <li key={d.key} className="flex items-baseline gap-2 text-[11px]">
                <span className="font-mono text-muted-foreground/80">
                  {d.key}:
                </span>
                <span className="text-foreground/80 font-medium">
                  {d.chosen_value}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-[11px] text-muted-foreground italic">(none)</div>
        )}
      </div>

      {/* Full prompt — collapsed expander */}
      <details
        open={promptOpen}
        onToggle={(e) =>
          setPromptOpen((e.target as HTMLDetailsElement).open)
        }
        className="border-t border-border/40 pt-2"
      >
        <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-muted-foreground/70 hover:text-foreground/80 font-medium transition-colors select-none">
          {promptOpen ? '▾' : '▸'} Full prompt
        </summary>
        <pre className="mt-1.5 max-h-72 overflow-y-auto rounded bg-background/60 border border-border/40 p-2 font-mono text-[10px] text-foreground/70 whitespace-pre-wrap break-words leading-relaxed">
          {assembledPrompt}
        </pre>
      </details>
    </div>
  );
}
