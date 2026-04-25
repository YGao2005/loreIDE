/**
 * Vitest unit tests for the TS-side defensive JSONL parser (defense-in-depth
 * alongside the Rust parser in src-tauri/src/commands/receipts.rs, 08-04a).
 */
import { describe, it, expect } from 'vitest';
import { parseSessionJsonl, extractTokenCounts } from '../jsonl-parser';

// ---------------------------------------------------------------------------
// Inline synthetic session fixtures
// ---------------------------------------------------------------------------

/** Minimal 3-line session: user + assistant(Write) + assistant(text). */
const SESSION_REAL_INLINE = [
  JSON.stringify({
    type: 'user',
    sessionId: 'test-session-001',
    timestamp: '2026-04-25T10:00:00.000Z',
    message: { content: [{ type: 'text', text: 'Do something' }] },
  }),
  JSON.stringify({
    type: 'assistant',
    sessionId: 'test-session-001',
    timestamp: '2026-04-25T10:00:01.000Z',
    message: {
      model: 'claude-opus-4-7',
      usage: {
        input_tokens: 1200,
        cache_creation_input_tokens: 5000,
        output_tokens: 180,
        cache_read_input_tokens: 300,
      },
      content: [
        {
          type: 'tool_use',
          name: 'Write',
          input: { file_path: '/repo/src/app.ts', content: 'const x = 1;' },
        },
        {
          type: 'tool_use',
          name: 'Read',
          input: { file_path: '/repo/src/utils.ts' },
        },
      ],
    },
  }),
  JSON.stringify({
    type: 'assistant',
    sessionId: 'test-session-001',
    timestamp: '2026-04-25T10:00:02.000Z',
    message: {
      model: 'claude-opus-4-7',
      usage: { input_tokens: 50, output_tokens: 20 },
      content: [{ type: 'text', text: 'Done.' }],
    },
  }),
].join('\n');

/** Session with one truncated (invalid JSON) line. */
const SESSION_TRUNCATED = [
  JSON.stringify({
    type: 'assistant',
    sessionId: 'test-session-002',
    message: {
      model: 'claude-opus-4-7',
      usage: { input_tokens: 800, output_tokens: 100 },
      content: [],
    },
  }),
  '{"type":"assistant","sessionId":"test-session-002","message":{"usage":{"input_tokens":200', // truncated — no closing braces
  JSON.stringify({
    type: 'assistant',
    sessionId: 'test-session-002',
    message: {
      model: 'claude-opus-4-7',
      usage: { input_tokens: 100, output_tokens: 50 },
      content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/repo/x.ts' } }],
    },
  }),
].join('\n');

/** Session with unknown top-level event types. */
const SESSION_UNKNOWN_TYPES = [
  JSON.stringify({ type: 'unknown_event', data: 'blah' }),
  JSON.stringify({ type: 'system', session_id: 'test-session-003' }),
  JSON.stringify({
    type: 'assistant',
    sessionId: 'test-session-003',
    message: {
      model: 'claude-haiku-4',
      usage: { input_tokens: 500, output_tokens: 60 },
      content: [
        { type: 'tool_use', name: 'MultiEdit', input: { file_path: '/repo/y.ts' } },
      ],
    },
  }),
].join('\n');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseSessionJsonl', () => {
  it('parses_real_session_jsonl_inline — non-zero input_tokens', () => {
    const result = parseSessionJsonl(SESSION_REAL_INLINE);
    // input = (1200 + 5000) + 50 = 6250; output = 180 + 20 = 200
    expect(result.input_tokens).toBeGreaterThan(0);
    expect(result.output_tokens).toBeGreaterThan(0);
    // tool_calls = 2 (Write + Read both count); touched_files = only Write
    expect(result.tool_calls).toBe(2);
    expect(result.touched_files).toContain('/repo/src/app.ts');
    // Read does NOT appear in touched_files
    expect(result.touched_files).not.toContain('/repo/src/utils.ts');
    expect(result.parse_status).toBe('ok');
  });

  it('tolerates_malformed_lines — skips truncated line, returns counts from rest', () => {
    const result = parseSessionJsonl(SESSION_TRUNCATED);
    // Line 2 is malformed; lines 1 and 3 are valid assistant lines.
    // input_tokens = 800 + 100 = 900; output_tokens = 100 + 50 = 150
    expect(result.input_tokens).toBe(900);
    expect(result.output_tokens).toBe(150);
    expect(result.tool_calls).toBe(1); // only the Edit in line 3
    expect(result.touched_files).toContain('/repo/x.ts');
    expect(result.parse_status).toBe('ok');
  });

  it('tolerates_unknown_top_level_types — skips them, returns counts from assistant lines', () => {
    const result = parseSessionJsonl(SESSION_UNKNOWN_TYPES);
    // Lines 1 and 2 are non-assistant; line 3 is valid.
    expect(result.input_tokens).toBe(500);
    expect(result.output_tokens).toBe(60);
    expect(result.tool_calls).toBe(1);
    expect(result.touched_files).toContain('/repo/y.ts');
    expect(result.parse_status).toBe('ok');
  });

  it('returns fallback_mock for completely empty input', () => {
    const result = parseSessionJsonl('');
    expect(result.parse_status).toBe('fallback_mock');
    expect(result.input_tokens).toBe(0);
    expect(result.tool_calls).toBe(0);
  });

  it('returns fallback_mock when all lines are malformed', () => {
    const result = parseSessionJsonl('not json\nalso not json\n{unterminated');
    expect(result.parse_status).toBe('fallback_mock');
    expect(result.input_tokens).toBe(0);
  });
});

describe('extractTokenCounts', () => {
  it('extracts base input + cache_creation as combined input', () => {
    const result = extractTokenCounts({
      input_tokens: 100,
      cache_creation_input_tokens: 500,
      output_tokens: 80,
      cache_read_input_tokens: 200,
    });
    expect(result.input).toBe(600); // 100 + 500
    expect(result.output).toBe(80);
    expect(result.cache_read).toBe(200);
  });

  it('returns undefined for absent fields', () => {
    const result = extractTokenCounts({});
    expect(result.input).toBeUndefined();
    expect(result.output).toBeUndefined();
    expect(result.cache_read).toBeUndefined();
  });

  it('handles only output_tokens present', () => {
    const result = extractTokenCounts({ output_tokens: 42 });
    expect(result.input).toBeUndefined();
    expect(result.output).toBe(42);
  });
});
