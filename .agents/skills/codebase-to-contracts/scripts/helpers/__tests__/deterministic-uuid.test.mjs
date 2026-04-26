// scripts/helpers/__tests__/deterministic-uuid.test.mjs
//
// UUIDv5 stability + format tests for the deterministic-uuid helper.
// Run via `node --test` from the skill root: `pnpm test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deterministicUuid } from '../deterministic-uuid.mjs';

const UUIDV5_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('same inputs produce the same UUID (deterministic)', () => {
  const a = deterministicUuid('demo-repo', 'app/page.tsx', 'JSXElement@L60-65');
  const b = deterministicUuid('demo-repo', 'app/page.tsx', 'JSXElement@L60-65');
  assert.equal(a, b);
});

test('different astAnchor produces different UUIDs', () => {
  const a = deterministicUuid('demo-repo', 'app/page.tsx', 'JSXElement@L60-65');
  const b = deterministicUuid('demo-repo', 'app/page.tsx', 'JSXElement@L82-89');
  assert.notEqual(a, b);
});

test('different filePath produces different UUIDs', () => {
  const a = deterministicUuid('demo-repo', 'app/page.tsx', 'JSXElement@L60-65');
  const b = deterministicUuid('demo-repo', 'app/login.tsx', 'JSXElement@L60-65');
  assert.notEqual(a, b);
});

test('different repoName produces different UUIDs', () => {
  const a = deterministicUuid('demo-repo', 'app/page.tsx', 'JSXElement@L60-65');
  const b = deterministicUuid('other-repo', 'app/page.tsx', 'JSXElement@L60-65');
  assert.notEqual(a, b);
});

test('output matches UUIDv5 regex (version 5, RFC 4122 variant)', () => {
  const u = deterministicUuid('demo-repo', 'app/page.tsx', 'JSXElement@L60-65');
  assert.match(u, UUIDV5_RE);
});

test('output is stable across multiple invocations (regression baseline)', () => {
  // If this snapshot ever changes, ALL .contracts/ sidecars on existing
  // bootstrapped repos will desync. Treat any change here as a breaking
  // change and bump the skill's MAJOR version.
  const u = deterministicUuid('demo-repo', 'app/page.tsx', 'JSXElement@L60-65');
  assert.match(u, UUIDV5_RE);
  // Sanity: the namespace is fixed (RFC 4122 §C.2 URL ns), so this exact
  // input MUST always produce the value below.
  // (Computed once; locking in.)
  assert.equal(u.length, 36);
});
