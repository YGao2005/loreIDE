import { createHash } from 'node:crypto';
import { getWritableDb } from '../db';

/**
 * Record a substrate rule emitted by the coding agent mid-conversation.
 *
 * This is the *live* path into the substrate review queue. The post-session
 * distiller is the *batch* path. Both write rows with `published_at = NULL`;
 * a chat-banner UI shows the user the queue with per-rule Approve / Deny
 * buttons. Approve flips `published_at`; Deny deletes the row.
 *
 * Idempotent UUID — text-only hash so multiple agent invocations of the same
 * rule collapse to one row. The distiller uses a different scheme
 * (session_id:start_line:text-prefix), which means a rule captured both
 * live AND post-session may produce TWO uuids. The distiller is responsible
 * for skipping rules whose text already appears in `substrate_nodes` (see
 * pipeline.rs dedup), so the agent path wins when it fires.
 *
 * After insert, the tool writes a single `[event] substrate-added <json>`
 * line to stderr. Tauri's mcp-sidecar stderr loop pattern-matches this and
 * re-emits `substrate:nodes-added` to the frontend so the chat banner can
 * refetch its queue without polling.
 */

interface RecordSubstrateRuleArgs {
  node_type: 'constraint' | 'decision' | 'open_question' | 'resolved_question' | 'attempt';
  text: string;
  scope?: string;
  applies_when?: string;
  anchored_atom_uuids?: string[];
  source_quote?: string;
}

function deriveUuid(text: string): string {
  // Text-only hash, normalized so trivial whitespace / case differences
  // collapse to the same UUID. 24 hex chars = 96 bits — well over collision
  // safety at hackathon scale; matches the distiller's truncation.
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  const prefix = normalized.length > 120 ? normalized.slice(0, 120) : normalized;
  const digest = createHash('sha256').update(`agent:${prefix}`).digest('hex');
  return `substrate-${digest.slice(0, 24)}`;
}

function deriveName(text: string): string {
  const t = text.trim();
  if (!t) return 'Untitled rule';
  const dot = t.indexOf('.');
  const nl = t.indexOf('\n');
  const candidates = [dot, nl, 60].filter((n) => n > 0);
  const cut = Math.min(...candidates, t.length);
  const head = t.slice(0, cut).trim();
  return head.length < t.length ? `${head}…` : head;
}

export async function recordSubstrateRule(args: RecordSubstrateRuleArgs) {
  // Validate text presence eagerly — empty/whitespace text is the most common
  // mis-call shape and we want a clear error rather than a row with no body.
  const text = (args.text ?? '').trim();
  if (!text) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'ERROR: text is required and must not be empty.',
        },
      ],
      isError: true,
    };
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

  const uuid = deriveUuid(text);
  const now = new Date().toISOString();
  const anchoredJson = JSON.stringify(args.anchored_atom_uuids ?? []);

  // Use INSERT OR REPLACE so re-recording the same rule (same uuid) is a
  // no-op shape-wise; we DO reset `published_at = NULL` even if the row was
  // previously approved, because the agent re-emitting it may carry a refined
  // scope or applies_when the user should re-review. This is intentional;
  // the demo memory `feedback_substrate_capture_quality.md` favors review
  // over silent persistence.
  try {
    db.run(
      `INSERT OR REPLACE INTO substrate_nodes
         (uuid, node_type, text, scope, applies_when,
          valid_at, invalid_at, expired_at, created_at,
          source_session_id, source_turn_ref, source_quote, source_actor,
          confidence, episode_id, anchored_uuids, published_at)
       VALUES (?,?,?,?,?, ?,NULL,NULL,?, NULL,NULL,?,?, ?,NULL,?, NULL)`,
      [
        uuid,
        args.node_type,
        text,
        args.scope ?? null,
        args.applies_when ?? null,
        now, // valid_at
        now, // created_at
        args.source_quote ?? null,
        'claude', // source_actor — agent path is always claude
        'inferred',
        anchoredJson,
      ],
    );
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

  // Stderr signal — the Tauri parent reads stderr and converts this line into
  // a `substrate:nodes-added` Tauri event for the frontend banner.
  const eventPayload = {
    uuid,
    name: deriveName(text),
    kind: args.node_type,
    text,
    promoted_from_implicit: false,
    attached_to_uuid: args.anchored_atom_uuids?.[0] ?? null,
  };
  process.stderr.write(`[event] substrate-added ${JSON.stringify(eventPayload)}\n`);

  return {
    content: [
      {
        type: 'text' as const,
        text: `Recorded substrate rule ${uuid}. Pending user review (will appear in chat banner).`,
      },
    ],
  };
}
