/**
 * TS-side defensive JSONL parser (defense-in-depth alongside Rust parser).
 *
 * The canonical parser lives in src-tauri/src/commands/receipts.rs (08-04a).
 * This module mirrors the logic for:
 *  1. Frontend fallback re-parse when Rust emits parse_status: "fallback_mock"
 *  2. Streaming partial-count preview during agent runs
 *  3. Unit testing isolation (Vitest) to prove parser correctness
 *
 * Mirrors the Rust parser field names exactly:
 *   input_tokens, output_tokens, tool_calls, parse_status
 */

export type ParseStatus = 'ok' | 'fallback_mock';

export interface ParsedSession {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  tool_calls: number;
  /** Relative file paths from Write/Edit/MultiEdit tool_use blocks. */
  touched_files: string[];
  parse_status: ParseStatus;
}

export interface TokenCounts {
  input?: number;
  output?: number;
  cache_read?: number;
  tool_calls?: number;
}

/**
 * Parse a full session JSONL string (real session file format from Claude Code).
 *
 * Session file format (real, not streaming):
 *  - `type: "assistant"` lines have `.message.usage.input_tokens` etc.
 *  - Tool use blocks are in `.message.content[i].type === "tool_use"`
 *  - sessionId is camelCase (not used here, caller extracts if needed)
 *
 * Defensive: malformed lines are skipped (never throw).
 * Returns parse_status "fallback_mock" only if NO lines were parseable.
 */
export function parseSessionJsonl(text: string): ParsedSession {
  let input_tokens = 0;
  let output_tokens = 0;
  let cache_read_tokens = 0;
  let tool_calls = 0;
  const touched_files = new Set<string>();
  let parsed_any = false;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    let v: Record<string, unknown>;
    try {
      v = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // Skip malformed lines — never throw.
      continue;
    }

    const event_type = typeof v['type'] === 'string' ? v['type'] : '';
    if (event_type !== 'assistant') continue;

    const msg = v['message'];
    if (!msg || typeof msg !== 'object') continue;
    const message = msg as Record<string, unknown>;

    // Accumulate token usage.
    const usage = message['usage'];
    if (usage && typeof usage === 'object') {
      const u = usage as Record<string, unknown>;
      const extracted = extractTokenCounts(u);
      input_tokens += extracted.input ?? 0;
      output_tokens += extracted.output ?? 0;
      cache_read_tokens += extracted.cache_read ?? 0;
    }

    // Count tool_use blocks and collect touched files.
    const content = message['content'];
    if (Array.isArray(content)) {
      for (const item of content) {
        if (!item || typeof item !== 'object') continue;
        const block = item as Record<string, unknown>;
        if (block['type'] !== 'tool_use') continue;
        tool_calls += 1;

        const name = typeof block['name'] === 'string' ? block['name'] : '';
        if (name === 'Write' || name === 'Edit' || name === 'MultiEdit') {
          const input = block['input'];
          if (input && typeof input === 'object') {
            const inp = input as Record<string, unknown>;
            const fp =
              (typeof inp['file_path'] === 'string' ? inp['file_path'] : null) ??
              (typeof inp['path'] === 'string' ? inp['path'] : null);
            if (fp) touched_files.add(fp);
          }
        }
      }
    }

    parsed_any = true;
  }

  return {
    input_tokens,
    output_tokens,
    cache_read_tokens,
    tool_calls,
    touched_files: Array.from(touched_files).sort(),
    parse_status: parsed_any ? 'ok' : 'fallback_mock',
  };
}

/**
 * Extract token counts from a single parsed usage object (or any JSON line).
 *
 * Used by streaming consumers to show live partial counts as agent:stream
 * events arrive. Tolerates missing fields — returns undefined for absent keys.
 *
 * Handles both session-file format (input_tokens, output_tokens) and
 * cache-related fields (cache_creation_input_tokens, cache_read_input_tokens).
 */
export function extractTokenCounts(line: Record<string, unknown>): TokenCounts {
  const get = (key: string): number | undefined => {
    const v = line[key];
    if (typeof v === 'number') return v;
    return undefined;
  };

  // input accumulates base + cache_creation (mirrors Rust parser).
  const base_input = get('input_tokens');
  const cache_creation = get('cache_creation_input_tokens');
  const input =
    base_input !== undefined || cache_creation !== undefined
      ? (base_input ?? 0) + (cache_creation ?? 0)
      : undefined;

  return {
    input,
    output: get('output_tokens'),
    cache_read: get('cache_read_input_tokens'),
  };
}
