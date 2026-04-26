/**
 * Parse the agent's raw JSONL stdout stream into a sequence of structured
 * `ChatEvent`s for rendering. Pairs `tool_use` blocks with their matching
 * `tool_result` blocks so the UI can show one collapsible card per tool call.
 *
 * The stream-json shape we care about:
 *   { type: "system", subtype: "init", ... }            — session start (skipped)
 *   { type: "assistant", message: { content: [...] } }  — text/thinking/tool_use blocks
 *   { type: "user",      message: { content: [...] } }  — tool_result blocks
 *   { type: "result",    result, usage, ... }           — final summary
 *
 * Tolerates malformed lines and missing fields. Returns events in stream order.
 */
import { extractTokenCounts } from './jsonl-parser';

export type ChatEvent =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'thinking'; key: string; text: string }
  | {
      kind: 'tool';
      key: string;
      id: string;
      name: string;
      input: Record<string, unknown>;
      result?: { content: string; isError: boolean };
      pending: boolean;
    }
  | {
      kind: 'result';
      key: string;
      durationMs?: number;
      tokensIn?: number;
      tokensOut?: number;
      costUsd?: number;
      summary?: string;
      isError: boolean;
    };

export function parseChatStream(lines: readonly string[]): ChatEvent[] {
  const events: ChatEvent[] = [];
  const toolIndex = new Map<string, number>();

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;

    let v: Record<string, unknown>;
    try {
      v = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = v['type'];

    if (type === 'assistant') {
      const msg = v['message'] as Record<string, unknown> | undefined;
      const content = msg?.['content'];
      if (!Array.isArray(content)) continue;

      for (let j = 0; j < content.length; j++) {
        const block = content[j];
        if (!block || typeof block !== 'object') continue;
        const b = block as Record<string, unknown>;
        const key = `${i}-${j}`;
        const blockType = b['type'];

        if (blockType === 'text' && typeof b['text'] === 'string') {
          const text = b['text'].trim();
          if (text) events.push({ kind: 'text', key, text });
        } else if (blockType === 'thinking' && typeof b['thinking'] === 'string') {
          const text = b['thinking'].trim();
          if (text) events.push({ kind: 'thinking', key, text });
        } else if (
          blockType === 'tool_use' &&
          typeof b['id'] === 'string' &&
          typeof b['name'] === 'string'
        ) {
          const idx = events.length;
          const input =
            b['input'] && typeof b['input'] === 'object'
              ? (b['input'] as Record<string, unknown>)
              : {};
          events.push({
            kind: 'tool',
            key,
            id: b['id'] as string,
            name: b['name'] as string,
            input,
            pending: true,
          });
          toolIndex.set(b['id'] as string, idx);
        }
      }
    } else if (type === 'user') {
      const msg = v['message'] as Record<string, unknown> | undefined;
      const content = msg?.['content'];
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        const b = block as Record<string, unknown>;
        if (b['type'] !== 'tool_result') continue;
        const toolUseId = b['tool_use_id'];
        if (typeof toolUseId !== 'string') continue;
        const idx = toolIndex.get(toolUseId);
        if (idx === undefined) continue;
        const target = events[idx];
        if (target.kind !== 'tool') continue;
        target.pending = false;
        target.result = {
          content: stringifyToolResultContent(b['content']),
          isError: b['is_error'] === true,
        };
      }
    } else if (type === 'result') {
      const usage = (v['usage'] as Record<string, unknown> | undefined) ?? {};
      const counts = extractTokenCounts(usage);
      const subtype = typeof v['subtype'] === 'string' ? (v['subtype'] as string) : '';
      events.push({
        kind: 'result',
        key: `${i}-result`,
        durationMs: numberOrUndef(v['duration_ms']),
        tokensIn: counts.input,
        tokensOut: counts.output,
        costUsd: numberOrUndef(v['total_cost_usd']) ?? numberOrUndef(v['cost_usd']),
        summary: typeof v['result'] === 'string' ? (v['result'] as string) : undefined,
        isError: subtype.startsWith('error') || v['is_error'] === true,
      });
    }
    // 'system' events are intentionally skipped from the rendered timeline.
  }

  return events;
}

function stringifyToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const c of content) {
      if (typeof c === 'string') {
        parts.push(c);
      } else if (c && typeof c === 'object') {
        const obj = c as Record<string, unknown>;
        if (obj['type'] === 'text' && typeof obj['text'] === 'string') {
          parts.push(obj['text']);
        } else {
          parts.push(JSON.stringify(c));
        }
      }
    }
    return parts.join('');
  }
  if (content === undefined || content === null) return '';
  return JSON.stringify(content);
}

function numberOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * One-line summary string for a tool call (shown in the collapsed card header).
 * Falls back to the tool name alone when no input field is recognized.
 */
export function toolCallSummary(name: string, input: Record<string, unknown>): string {
  const str = (k: string): string | undefined =>
    typeof input[k] === 'string' ? (input[k] as string) : undefined;

  switch (name) {
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return str('file_path') ?? str('path') ?? '';
    case 'Bash':
      return truncate(str('command') ?? '', 80);
    case 'Glob':
      return str('pattern') ?? '';
    case 'Grep':
      return str('pattern') ?? '';
    case 'WebFetch':
      return str('url') ?? '';
    case 'WebSearch':
      return str('query') ?? '';
    case 'Task':
      return str('description') ?? str('prompt') ?? '';
    case 'TodoWrite': {
      const todos = input['todos'];
      if (Array.isArray(todos)) return `${todos.length} item${todos.length === 1 ? '' : 's'}`;
      return '';
    }
    default: {
      // mcp__server__tool — show first string-valued argument as a hint.
      for (const v of Object.values(input)) {
        if (typeof v === 'string' && v.length > 0 && v.length < 120) return v;
      }
      return '';
    }
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

/** Friendly display name for a tool — strips `mcp__server__` prefix etc. */
export function prettyToolName(name: string): string {
  if (name.startsWith('mcp__')) {
    const parts = name.split('__');
    return parts[parts.length - 1] ?? name;
  }
  return name;
}
