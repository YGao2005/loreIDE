import { createHash } from 'node:crypto';
import { getWritableDb } from '../db';

/**
 * Record a high-level decision made by the chat agent during the current turn,
 * with one or more code-region anchors that implement it. Distinct from
 * `record_substrate_rule` — substrate rules are PORTABLE team facts pending
 * user review; decisions are chat-local citations the user expands inline to
 * verify the agent's reasoning trail.
 *
 * Idempotent UUID — text-only hash of decision+rationale. Re-recording the same
 * decision in the same chat collapses to one row (anchors are replaced).
 *
 * After insert, the tool writes a single `[event] decision-recorded <json>`
 * line to stderr. The Tauri parent's mcp.rs stderr loop pattern-matches this
 * and re-emits `chat:decision-recorded` so the frontend ChatStream can render
 * the new card without polling.
 */

interface DecisionAnchor {
  file: string;
  line_start: number;
  line_end: number;
  kind?: 'code' | 'diff';
}

interface RecordDecisionArgs {
  decision: string;
  rationale: string;
  anchors: DecisionAnchor[];
  chat_id?: string;
  tracking_id?: string;
}

function deriveUuid(decision: string, rationale: string): string {
  const normalized = `${decision}\n${rationale}`.trim().toLowerCase().replace(/\s+/g, ' ');
  const prefix = normalized.length > 200 ? normalized.slice(0, 200) : normalized;
  const digest = createHash('sha256').update(`decision:${prefix}`).digest('hex');
  return `decision-${digest.slice(0, 24)}`;
}

export async function recordDecision(args: RecordDecisionArgs) {
  const decision = (args.decision ?? '').trim();
  const rationale = (args.rationale ?? '').trim();
  const anchors = Array.isArray(args.anchors) ? args.anchors : [];

  if (!decision) {
    return {
      content: [{ type: 'text' as const, text: 'ERROR: decision is required.' }],
      isError: true,
    };
  }
  if (!rationale) {
    return {
      content: [{ type: 'text' as const, text: 'ERROR: rationale is required.' }],
      isError: true,
    };
  }
  if (anchors.length === 0) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'ERROR: at least one anchor is required — every decision must cite a code region.',
        },
      ],
      isError: true,
    };
  }

  // Validate anchors before any DB write — partial anchors are worse than rejection.
  for (const [i, a] of anchors.entries()) {
    if (!a || typeof a.file !== 'string' || a.file.trim() === '') {
      return {
        content: [{ type: 'text' as const, text: `ERROR: anchors[${i}].file missing.` }],
        isError: true,
      };
    }
    if (!Number.isFinite(a.line_start) || !Number.isFinite(a.line_end)) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `ERROR: anchors[${i}] line_start/line_end must be numeric.`,
          },
        ],
        isError: true,
      };
    }
    if (a.line_start < 1 || a.line_end < a.line_start) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `ERROR: anchors[${i}] invalid range (start=${a.line_start} end=${a.line_end}).`,
          },
        ],
        isError: true,
      };
    }
  }

  let db: ReturnType<typeof getWritableDb>;
  try {
    db = getWritableDb();
  } catch (e) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `ERROR: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
      isError: true,
    };
  }

  const uuid = deriveUuid(decision, rationale);
  const now = new Date().toISOString();
  const chatId = args.chat_id ?? null;
  const trackingId = args.tracking_id ?? null;

  try {
    db.transaction(() => {
      db.run(
        `INSERT OR REPLACE INTO chat_decisions
           (uuid, chat_id, tracking_id, session_id, decision, rationale, created_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?)`,
        [uuid, chatId, trackingId, decision, rationale, now],
      );
      // Anchors get replaced wholesale on re-record so the card never shows
      // stale citations after the agent refines a decision.
      db.run(`DELETE FROM decision_anchors WHERE decision_uuid = ?`, [uuid]);
      for (const [i, a] of anchors.entries()) {
        db.run(
          `INSERT INTO decision_anchors
             (decision_uuid, file, line_start, line_end, kind, ord)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            uuid,
            a.file.trim(),
            Math.floor(a.line_start),
            Math.floor(a.line_end),
            a.kind === 'diff' ? 'diff' : 'code',
            i,
          ],
        );
      }
    })();
  } catch (e) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `ERROR: insert failed: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
      isError: true,
    };
  }

  // Stderr signal — Tauri parent re-emits as `chat:decision-recorded`.
  const eventPayload = {
    uuid,
    chat_id: chatId,
    tracking_id: trackingId,
    decision,
    rationale,
    anchors: anchors.map((a, i) => ({
      file: a.file.trim(),
      line_start: Math.floor(a.line_start),
      line_end: Math.floor(a.line_end),
      kind: a.kind === 'diff' ? 'diff' : 'code',
      ord: i,
    })),
    created_at: now,
  };
  process.stderr.write(`[event] decision-recorded ${JSON.stringify(eventPayload)}\n`);

  return {
    content: [
      {
        type: 'text' as const,
        text: `Recorded decision ${uuid} with ${anchors.length} anchor${anchors.length === 1 ? '' : 's'}.`,
      },
    ],
  };
}
