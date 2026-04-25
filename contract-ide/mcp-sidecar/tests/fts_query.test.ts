/**
 * Phase 9 Plan 09-01 fix — Unit tests for FTS5 query builder.
 *
 * Mirrors the Rust IPC tests in src-tauri/src/commands/mass_edit.rs ::
 * fts_query_tests. Both implementations must produce identical MATCH
 * expressions for the same input so the MCP path and the frontend Rust
 * IPC path return the same result set.
 */

import { describe, expect, test } from 'bun:test';
import { buildFtsQuery } from '../src/lib/fts_query';

describe('buildFtsQuery', () => {
  test('natural-language query OR-tokenizes with stopwords dropped', () => {
    // "add" stays (action verb, not stopword); "to" + "every" dropped.
    expect(buildFtsQuery('add audit logging to every destructive endpoint'))
      .toBe('"add" OR "audit" OR "logging" OR "destructive" OR "endpoint"');
  });

  test('stopwords-only query falls back to no-filter tokenization', () => {
    expect(buildFtsQuery('the all every')).toBe('"the" OR "all" OR "every"');
  });

  test('case-insensitive stopword match', () => {
    expect(buildFtsQuery('audit TO destructive'))
      .toBe('"audit" OR "destructive"');
  });

  test('structured OR query passes through', () => {
    expect(buildFtsQuery('audit OR destructive')).toBe('audit OR destructive');
  });

  test('structured AND query passes through', () => {
    expect(buildFtsQuery('audit AND logging')).toBe('audit AND logging');
  });

  test('quoted phrase passes through', () => {
    expect(buildFtsQuery('"destructive endpoint"')).toBe('"destructive endpoint"');
  });

  test('punctuation splits tokens', () => {
    expect(buildFtsQuery('delete: account-button.tsx'))
      .toBe('"delete" OR "account" OR "button" OR "tsx"');
  });

  test('empty string returns empty', () => {
    expect(buildFtsQuery('')).toBe('');
    expect(buildFtsQuery('   ')).toBe('');
  });

  test('single term gets quoted', () => {
    expect(buildFtsQuery('destructive')).toBe('"destructive"');
  });

  test('matches Rust IPC output for SC1 query (stopwords filtered)', () => {
    // Must produce byte-identical output to the Rust helper in
    // src-tauri/src/commands/mass_edit.rs :: build_fts_query — both paths
    // bind to the same FTS5 MATCH operator so divergence here means the
    // MCP tool and the frontend would return different result sets for
    // the same user query.
    const sc1 = 'add audit logging to every destructive endpoint';
    expect(buildFtsQuery(sc1))
      .toBe('"add" OR "audit" OR "logging" OR "destructive" OR "endpoint"');
  });
});
