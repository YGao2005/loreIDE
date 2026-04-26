import { describe, it, expect } from 'vitest';
import { parseChatStream, prettyToolName, toolCallSummary } from '../chatStream';

describe('parseChatStream', () => {
  it('returns no events for empty input', () => {
    expect(parseChatStream([])).toEqual([]);
    expect(parseChatStream([''])).toEqual([]);
  });

  it('skips malformed lines', () => {
    expect(parseChatStream(['not-json', '{"type":"system","subtype":"init"}'])).toEqual([]);
  });

  it('extracts assistant text blocks', () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Hello world' }] },
      }),
    ];
    const events = parseChatStream(lines);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('text');
    expect((events[0] as { text: string }).text).toBe('Hello world');
  });

  it('extracts thinking blocks', () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'thinking', thinking: 'Let me reason about this.' }],
        },
      }),
    ];
    const events = parseChatStream(lines);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('thinking');
  });

  it('pairs tool_use with tool_result by id', () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'Read',
              input: { file_path: '/repo/foo.ts' },
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_1', content: 'file contents here' },
          ],
        },
      }),
    ];
    const events = parseChatStream(lines);
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.kind).toBe('tool');
    if (e.kind === 'tool') {
      expect(e.pending).toBe(false);
      expect(e.result?.content).toBe('file contents here');
      expect(e.result?.isError).toBe(false);
    }
  });

  it('marks errored tool_result', () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'toolu_2', name: 'Bash', input: { command: 'ls' } }],
        },
      }),
      JSON.stringify({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_2',
              content: [{ type: 'text', text: 'permission denied' }],
              is_error: true,
            },
          ],
        },
      }),
    ];
    const events = parseChatStream(lines);
    const e = events[0];
    if (e.kind === 'tool') {
      expect(e.result?.isError).toBe(true);
      expect(e.result?.content).toBe('permission denied');
    }
  });

  it('keeps tool_use pending when no result yet', () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'toolu_3', name: 'Glob', input: { pattern: '*.ts' } },
          ],
        },
      }),
    ];
    const events = parseChatStream(lines);
    const e = events[0];
    if (e.kind === 'tool') {
      expect(e.pending).toBe(true);
      expect(e.result).toBeUndefined();
    }
  });

  it('extracts result event with usage', () => {
    const lines = [
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'All done.',
        duration_ms: 4200,
        total_cost_usd: 0.0123,
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    ];
    const events = parseChatStream(lines);
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.kind).toBe('result');
    if (e.kind === 'result') {
      expect(e.tokensIn).toBe(100);
      expect(e.tokensOut).toBe(50);
      expect(e.durationMs).toBe(4200);
      expect(e.costUsd).toBeCloseTo(0.0123);
      expect(e.summary).toBe('All done.');
      expect(e.isError).toBe(false);
    }
  });

  it('preserves event order', () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'I will read the file.' },
            { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a.ts' } },
          ],
        },
      }),
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Done reading.' }] },
      }),
    ];
    const events = parseChatStream(lines);
    expect(events.map((e) => e.kind)).toEqual(['text', 'tool', 'text']);
  });
});

describe('toolCallSummary', () => {
  it('returns file_path for Read/Edit', () => {
    expect(toolCallSummary('Read', { file_path: '/a.ts' })).toBe('/a.ts');
    expect(toolCallSummary('Edit', { file_path: '/b.ts' })).toBe('/b.ts');
  });

  it('returns truncated command for Bash', () => {
    const long = 'echo ' + 'x'.repeat(200);
    const summary = toolCallSummary('Bash', { command: long });
    expect(summary.length).toBeLessThanOrEqual(80);
    expect(summary.endsWith('…')).toBe(true);
  });

  it('returns todo count for TodoWrite', () => {
    expect(toolCallSummary('TodoWrite', { todos: [1, 2, 3] })).toBe('3 items');
    expect(toolCallSummary('TodoWrite', { todos: [1] })).toBe('1 item');
  });

  it('falls back to first string arg for mcp tools', () => {
    const s = toolCallSummary('mcp__foo__bar', { something: 'hello world' });
    expect(s).toBe('hello world');
  });
});

describe('prettyToolName', () => {
  it('strips mcp__server__ prefix', () => {
    expect(prettyToolName('mcp__claude-in-chrome__navigate')).toBe('navigate');
    expect(prettyToolName('Read')).toBe('Read');
  });
});
