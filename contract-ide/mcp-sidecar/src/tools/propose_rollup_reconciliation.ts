/**
 * Phase 8 Plan 08-06 — propose_rollup_reconciliation MCP tool (PROP-04).
 *
 * Callable from an active Claude Code session. Respects pin-aware branching:
 *   - PINNED upstream: returns a read-only diff for the IDE Reconcile panel
 *     (the user must approve there — this tool NEVER calls a writer)
 *   - UNPINNED upstream: returns a draft-propagation prompt context with
 *     the current upstream body + cited child sections + recent journal entries
 *
 * Per RESEARCH.md (Jin & Chen 2026 / Stengg 2025 backstop): the tool NEVER
 * calls a writer. The user is the backstop — all writes flow through the IDE
 * Reconcile panel (accept_rollup_as_is Rust IPC) after human review.
 *
 * Journal entries are read by scanning .contracts/journal/*.jsonl files
 * directly (MCP sidecar has its own SQLite read-only connection plus env-var
 * access to CONTRACT_IDE_REPO_PATH).
 */

import * as fs from 'fs';
import * as path from 'path';
import { getDb, getRepoPath } from '../db';

// ─── Response types ────────────────────────────────────────────────────────────

interface CitedChildSection {
  child_uuid: string;
  section_name: string;
  section_text: string;
}

interface JournalEntryBrief {
  ts: string;
  tool: string;
  intent: string;
}

interface ProposeReadOnlyDiffResult {
  mode: 'read_only_diff';
  upstream_uuid: string;
  upstream_body: string;
  cited_child_sections: CitedChildSection[];
  message: string;
}

interface ProposeDraftPropagationResult {
  mode: 'draft_propagation';
  upstream_uuid: string;
  upstream_body: string;
  cited_child_sections: CitedChildSection[];
  recent_journal: JournalEntryBrief[];
  suggested_prompt: string;
  message: string;
}

type ProposeResult = ProposeReadOnlyDiffResult | ProposeDraftPropagationResult;

// ─── Main handler ──────────────────────────────────────────────────────────────

export async function handleProposeRollupReconciliation(args: {
  upstream_uuid: string;
}): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const { upstream_uuid } = args;
  const db = getDb();

  // 1. Read the upstream node row.
  const nodeRow = db
    .prepare(
      `SELECT uuid, level, name, human_pinned, rollup_inputs_json, contract_body
       FROM nodes WHERE uuid = ?`,
    )
    .get(upstream_uuid) as {
    uuid: string;
    level: string;
    name: string;
    human_pinned: number | boolean;
    rollup_inputs_json: string | null;
    contract_body: string | null;
  } | undefined;

  if (!nodeRow) {
    return {
      content: [
        {
          type: 'text',
          text: `No contract found with uuid=${upstream_uuid}`,
        },
      ],
    };
  }

  const humanPinned = Boolean(nodeRow.human_pinned);
  const upstreamBody = nodeRow.contract_body ?? '';
  const level = nodeRow.level;

  // 2. Parse rollup_inputs to identify cited children.
  let rollupInputs: Array<{ child_uuid: string; sections: string[] }> = [];
  if (nodeRow.rollup_inputs_json) {
    try {
      rollupInputs = JSON.parse(nodeRow.rollup_inputs_json);
    } catch {
      rollupInputs = [];
    }
  }

  // 3. Collect cited child sections by reading sidecar files.
  const repoPath = safeGetRepoPath();
  const citedChildSections = repoPath
    ? collectCitedSections(repoPath, rollupInputs)
    : [];

  // 4. Pin-aware branching — NEVER calls a writer.

  if (humanPinned) {
    // PINNED: return read-only diff — user must use IDE Reconcile panel.
    const result: ProposeReadOnlyDiffResult = {
      mode: 'read_only_diff',
      upstream_uuid,
      upstream_body: upstreamBody,
      cited_child_sections: citedChildSections,
      message:
        `Upstream contract ${upstream_uuid} (${level}: ${nodeRow.name}) is PINNED. ` +
        `It has ${citedChildSections.length} cited child section(s) that may have changed. ` +
        `To reconcile: open the IDE, click the amber node, and use the Reconcile panel ` +
        `("Review children's changes" or "Unpin and reconcile"). ` +
        `This tool NEVER writes to a pinned contract — the user must approve in the IDE.`,
    };
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }

  // UNPINNED: return draft-propagation prompt context.
  const recentJournal = repoPath
    ? readRecentJournalEntries(repoPath, upstream_uuid, rollupInputs, 10)
    : [];

  const suggestedPrompt = buildSuggestedPrompt(
    upstream_uuid,
    upstreamBody,
    citedChildSections,
    recentJournal,
  );

  const result: ProposeDraftPropagationResult = {
    mode: 'draft_propagation',
    upstream_uuid,
    upstream_body: upstreamBody,
    cited_child_sections: citedChildSections,
    recent_journal: recentJournal,
    suggested_prompt: suggestedPrompt,
    message:
      `Upstream contract ${upstream_uuid} (${level}: ${nodeRow.name}) is rollup-stale ` +
      `with ${citedChildSections.length} cited child section(s). ` +
      `Use the suggested_prompt to draft a reconciled contract body, then approve via ` +
      `the IDE Reconcile panel ("Accept as-is" or "Draft propagation for review"). ` +
      `This tool NEVER writes — the user is the backstop (Jin & Chen 2026 / Stengg 2025).`,
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function safeGetRepoPath(): string | null {
  try {
    return getRepoPath();
  } catch {
    return null;
  }
}

/** Read a sidecar's body section (after the closing --- fence). */
function readSidecarBody(repoPath: string, uuid: string): string {
  const sidecarPath = path.join(repoPath, '.contracts', `${uuid}.md`);
  let content: string;
  try {
    content = fs.readFileSync(sidecarPath, 'utf-8');
  } catch {
    return '';
  }
  const fenceIdx = content.indexOf('\n---\n');
  if (fenceIdx === -1) return content;
  const afterFence = content.slice(fenceIdx + 5);
  return afterFence.replace(/^\n+/, '');
}

/** Extract a named H2 section from a Markdown body. Case-insensitive. */
function extractH2Section(body: string, sectionName: string): string {
  const needle = sectionName.toLowerCase();
  let inSection = false;
  const lines: string[] = [];
  for (const line of body.split('\n')) {
    if (line.startsWith('## ')) {
      const heading = line.slice(3).trim().toLowerCase();
      if (heading === needle) {
        inSection = true;
        continue;
      } else if (inSection) {
        break;
      }
    }
    if (inSection) lines.push(line);
  }
  return lines.join('\n').trim();
}

function collectCitedSections(
  repoPath: string,
  rollupInputs: Array<{ child_uuid: string; sections: string[] }>,
): CitedChildSection[] {
  const out: CitedChildSection[] = [];
  for (const ri of rollupInputs) {
    const body = readSidecarBody(repoPath, ri.child_uuid);
    for (const sectionName of ri.sections) {
      const text = extractH2Section(body, sectionName);
      out.push({ child_uuid: ri.child_uuid, section_name: sectionName, section_text: text });
    }
  }
  return out;
}

/** Read recent journal entries related to the upstream + its cited children. */
function readRecentJournalEntries(
  repoPath: string,
  upstreamUuid: string,
  rollupInputs: Array<{ child_uuid: string; sections: string[] }>,
  limit: number,
): JournalEntryBrief[] {
  const journalDir = path.join(repoPath, '.contracts', 'journal');
  const relatedUuids = new Set([upstreamUuid, ...rollupInputs.map((r) => r.child_uuid)]);

  const entries: Array<JournalEntryBrief & { ts_sort: string }> = [];

  let files: string[];
  try {
    files = fs.readdirSync(journalDir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }

  for (const file of files) {
    const filePath = path.join(journalDir, file);
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as {
          ts?: string;
          tool?: string;
          intent?: string;
          affected_uuids?: string[];
        };
        const affected = entry.affected_uuids ?? [];
        const isRelated = affected.some((u) => relatedUuids.has(u));
        if (isRelated && entry.ts && entry.intent) {
          entries.push({
            ts: entry.ts,
            tool: entry.tool ?? '?',
            intent: entry.intent,
            ts_sort: entry.ts,
          });
        }
      } catch {
        // skip malformed line
      }
    }
  }

  // Sort descending by ts, deduplicate, cap at limit.
  entries.sort((a, b) => b.ts_sort.localeCompare(a.ts_sort));
  const seen = new Set<string>();
  const deduped: JournalEntryBrief[] = [];
  for (const e of entries) {
    const key = `${e.ts}|${e.intent}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push({ ts: e.ts, tool: e.tool, intent: e.intent });
    }
    if (deduped.length >= limit) break;
  }
  return deduped;
}

function buildSuggestedPrompt(
  uuid: string,
  upstreamBody: string,
  citedChildSections: CitedChildSection[],
  recentJournal: JournalEntryBrief[],
): string {
  const childSections = citedChildSections
    .map((s) => `## ${s.child_uuid} :: ${s.section_name}\n${s.section_text || '(empty)'}`)
    .join('\n\n');

  const journalLines = recentJournal
    .map((e) => `- [${e.ts}] ${e.intent}`)
    .join('\n');

  return `Upstream contract ${uuid} is rollup-stale. Cited child sections have changed.

Current upstream body:
${upstreamBody || '(empty)'}

Cited child sections (current state):
${childSections || '(none)'}

Recent intent journal:
${journalLines || '(no journal entries)'}

Propose a minimal edit to the upstream body that reflects the cited child changes.
Write only the new contract body in a fenced code block. Do not modify cited child contracts.`;
}
