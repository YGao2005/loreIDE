import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '@/store/editor';
import { useGraphStore } from '@/store/graph';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ContractNode } from '@/ipc/types';

/**
 * Contract tab — the textual contract editor (INSP-03).
 *
 * Phase 4 Plan 04-02 rebuild:
 *   - Save on blur (always fires if dirty).
 *   - Save on Cmd+S (local listener, pre-empts debounce immediately).
 *   - Debounced autosave while typing (400ms after last keystroke).
 *   - Every save routes through `useEditorStore.saveContract(repoPath, node)`,
 *     which hardcodes `human_pinned: true` (Pitfall 3 guard — without this,
 *     Phase 6 derivation would silently overwrite the user's edits).
 *
 * The global Cmd+S in `useKeyboardShortcuts` fires too; both call the same
 * idempotent save, so double-firing is harmless. The local listener exists
 * so Cmd+S pre-empts the 400ms debounce timer the moment the user presses it.
 *
 * The textarea is INTENTIONALLY plain (not Monaco) — per 04-RESEARCH.md,
 * contract editing is prose-first; Monaco is code-only (Code tab).
 */
const DEBOUNCE_MS = 400;

/**
 * v2 contract-form derivation spec. KEEP IN SYNC BY HAND with
 * `contract-ide/mcp-sidecar/src/tools/prompt-v2.ts` — the Inspector and the
 * MCP sidecar live in different workspaces and cannot share a module.
 *
 * Adopted 2026-04-24 after a 3-iteration dogfood test. See
 * `.planning/research/contract-form/DOGFOOD_VERDICT.md` for the iteration
 * log. The single-node variant used by the Inspector's Copy-single-prompt
 * button wraps this in a node-metadata preamble; the batch variant passes
 * the session through `list_nodes_needing_derivation`, which appends the
 * same spec from the sidecar-side copy.
 */
const V2_DERIVATION_INSTRUCTIONS = `Derive the contract in v2 sectioned-markdown form.

STEPS
  1. Read every file in the node's code_ranges at the specified line numbers.
  2. Compose a body in the sectioned form below.
  3. Run the two SELF-REVIEW checks at the end of this block.
  4. Call \`write_derived_contract\` with { uuid, body }.

REQUIRED SECTIONS, in order:
  ## Intent         1–3 sentences; what this exists to do, in product
                    terms. NO library/framework vocabulary; NO project-
                    coined terms (\`sidecar\`, \`frontmatter\`, \`hash\`,
                    \`YAML\`, \`atomic\`, \`SHA\`, \`tempfile\`, \`ISO-8601\`,
                    \`timestamp\`, \`metadata\`, \`useState\`, \`useEffect\`,
                    \`prop\`, \`callback\`, \`Tailwind\`, \`className\`).
                    A non-technical stakeholder reading ONLY this section
                    should understand what the node does and why.
  ## Role           1 sentence. MUST name the broader flow or surface by
                    concrete noun — "the cart checkout flow", "the
                    inspector's header strip", "the derivation loop".
                    NOT "sits between X and Y". Optional at L4 for pure
                    utilities with no meaningful broader flow.
  ## Inputs         bullets: \`name: type — meaning\`. The \`name: type\`
                    half may use technical tokens. The \`— meaning\` half
                    follows Intent banword rules. No "parent"/"caller"/
                    "hook"/"ref"/"prop" references to surrounding
                    structure — use "the surrounding view" etc.
  ## Outputs        bullets; same meaning-clause rules as Inputs.
  ## Invariants     bullets. MANDATORY: every bullet ends with \`(line N)\`
                    or \`(lines M–N)\` citing source lines within
                    code_ranges. Uncited → move to ## Notes or delete.
  ## Examples       1–3 Given/When/Then blocks. Load-bearing. Cover the
                    happy path + at least one guard/failure case. Use
                    PRODUCT LANGUAGE; NO field names (\`human_pinned\`,
                    \`code_hash\`…), response strings (\`DONE:\`,
                    \`ERROR:\`…), or structural terms (\`the sidecar\`,
                    \`the frontmatter\`) inside GIVEN/WHEN/THEN clauses.
                    Map raw tokens to product phrases.

OPTIONAL (skip the heading if not substantive):
  ## Side Effects   writes, network, fs, timing.
  ## Failure Modes  how it fails and the observable.
  ## Interaction    UI kind; what a user can do.
  ## Visual States  UI kind; rendering states. SKIP if Outputs already
                    enumerates render variants — no duplicating.
  ## HTTP           API kind only. MCP tools: use Transport/Tool name/Auth.
  ## Shape          data kind.
  ## Persistence    data kind.
  ## Trigger        job kind.
  ## Schedule       job kind.
  ## Idempotency    job kind.
  ## Notes          overflow.

EXAMPLES TEMPLATE:
  GIVEN <state>
  WHEN  <single action>
  THEN  <outcome>
    AND <additional outcome, optional>

SELF-REVIEW — MANDATORY, BOTH CHECKS
  1. NON-CODER READ. Re-read ONLY ## Intent + ## Examples. Could a PM
     explain what this is and when it matters? If no, rewrite.
  2. INVARIANT CITATIONS. Re-read ## Invariants. Every bullet cites a
     real line within code_ranges, or it's removed.

OUTPUT
Call \`write_derived_contract\` with the full body AFTER both self-reviews.
Body starts with \`## Intent\` on line 1. No code fences. No frontmatter —
the tool preserves it. Then report DONE / SKIPPED-PINNED / ERROR status.`;

function buildDerivationPrompt(node: {
  uuid: string;
  name: string;
  level: string;
  kind: string;
}): string {
  return `Using the \`contract-ide\` MCP server, derive the contract for this node.

NODE
  uuid:  ${node.uuid}
  name:  ${node.name}
  level: ${node.level}
  kind:  ${node.kind}

${V2_DERIVATION_INSTRUCTIONS}`;
}

function buildBatchDerivationPrompt(): string {
  return `Using the \`contract-ide\` MCP server, derive contracts for every undocumented node.

1. Call \`list_nodes_needing_derivation\` — the tool returns the node list
   AND the full v2 derivation spec in one payload.
2. Follow the spec in that payload for each node. It matches the single-
   node spec in this project's ContractTab.tsx; either source is
   authoritative.
3. Report final DONE / SKIPPED-PINNED / ERROR counts at the end.`;
}

export default function ContractTab({ node }: { node: ContractNode | null }) {
  const [copyState, setCopyState] = useState<
    'idle' | 'copied-one' | 'copied-all' | 'error'
  >('idle');
  const contractText = useEditorStore((s) => s.contractText);
  const isDirty = useEditorStore((s) => s.isDirty);
  const setContractText = useEditorStore((s) => s.setContractText);
  const saveContract = useEditorStore((s) => s.saveContract);
  const repoPath = useGraphStore((s) => s.repoPath);
  const debounceRef = useRef<number | null>(null);

  // Debounced autosave on typing. Fires `DEBOUNCE_MS` after the last
  // keystroke (or sooner if `isDirty` flips again during the window, in
  // which case the effect re-runs and resets the timer).
  useEffect(() => {
    if (!isDirty || !node || !repoPath) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      saveContract(repoPath, node).catch(console.error);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [contractText, isDirty, node, repoPath, saveContract]);

  // Local Cmd+S — pre-empts the debounce the moment the user asks. The
  // global Cmd+S in useKeyboardShortcuts fires too; saves are idempotent
  // so the double-fire is harmless (just one extra hash + write).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (node && repoPath) void saveContract(repoPath, node);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [node, repoPath, saveContract]);

  async function copyPrompt(text: string, kind: 'copied-one' | 'copied-all') {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState(kind);
      setTimeout(() => setCopyState('idle'), 2500);
    } catch {
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 2500);
    }
  }

  const copyLabel =
    copyState === 'copied-one'
      ? 'Copied — paste in Claude Code'
      : copyState === 'copied-all'
        ? 'Batch prompt copied'
        : copyState === 'error'
          ? 'Clipboard denied'
          : null;

  return (
    <>
      {node ? (
        <div className="border-b border-border/50 px-3 py-2 flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground truncate">
              {node.name}
            </span>
            {node.human_pinned ? (
              <span
                className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 shrink-0"
                title="Human-pinned — write_derived_contract will skip this node"
              >
                pinned
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void copyPrompt(buildDerivationPrompt(node), 'copied-one')
              }
              className="h-6 text-xs px-2"
              title="Copy a prompt that derives THIS node via the contract-ide MCP server"
            >
              Copy derivation prompt
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void copyPrompt(buildBatchDerivationPrompt(), 'copied-all')
              }
              className="h-6 text-xs px-2"
              title="Copy a batch prompt that derives every undocumented node"
            >
              Copy batch prompt
            </Button>
            {copyLabel ? (
              <span
                className={cn(
                  'text-xs',
                  copyState === 'error'
                    ? 'text-destructive'
                    : 'text-muted-foreground',
                )}
              >
                {copyLabel}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <textarea
        value={contractText}
        onChange={(e) => setContractText(e.target.value)}
        onBlur={() => {
          if (node && repoPath && isDirty) void saveContract(repoPath, node);
        }}
        placeholder={
          node
            ? 'Describe what this node does — behaviour, inputs, outputs…'
            : 'Select a node to edit its contract…'
        }
        spellCheck={false}
        className="flex-1 resize-none bg-transparent px-4 py-3 text-sm text-foreground outline-none font-mono leading-relaxed"
      />
      <div className="border-t border-border/50 px-4 py-1.5 text-[11px] text-muted-foreground flex items-center justify-between">
        <span data-autosave-status={isDirty ? 'dirty' : 'saved'}>
          {isDirty ? 'editing…' : 'saved'}
        </span>
        <span className="text-muted-foreground/60">
          Cmd+S to save · Cmd+Z to undo
        </span>
      </div>
    </>
  );
}
