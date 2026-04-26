// scripts/helpers/__tests__/frontmatter-writer.test.mjs
//
// Round-trip parity: read a Phase 9 exemplar sidecar, parse its frontmatter,
// re-emit via writeFrontmatter(), and assert the YAML body parses back to a
// deep-equal object. Phase 14 revision Issue 12 closure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { writeFrontmatter } from '../frontmatter-writer.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../../../..');

function splitFrontmatter(content) {
  // Match exactly the same pattern as Phase 2 reader / contract-uuid-plugin loader.
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error('No frontmatter found');
  return { yaml: m[1], body: m[2] };
}

function roundTrip(fixturePath) {
  const fullPath = path.join(REPO_ROOT, fixturePath);
  const raw = fs.readFileSync(fullPath, 'utf8');
  const { yaml: yamlBody, body } = splitFrontmatter(raw);
  const parsed = yaml.load(yamlBody);

  // Re-emit.
  const reemitted = writeFrontmatter(parsed, body);

  // Parse the re-emitted output back, assert deep equality.
  const { yaml: yaml2, body: body2 } = splitFrontmatter(reemitted);
  const parsed2 = yaml.load(yaml2);

  return { parsed, parsed2, body, body2, raw, reemitted };
}

test('round-trip parity: contract-ide-demo UI L4 exemplar (a1000000-...)', () => {
  const { parsed, parsed2, body, body2 } = roundTrip(
    'contract-ide-demo/.contracts/a1000000-0000-4000-8000-000000000000.md'
  );
  assert.deepEqual(parsed2, parsed, 'frontmatter round-trip lost data');
  assert.equal(body2.trim(), body.trim(), 'body content drifted');
});

test('round-trip parity: contract-ide-demo backend L3 exemplar (api-account-delete-001)', () => {
  const { parsed, parsed2, body, body2 } = roundTrip(
    'contract-ide-demo/.contracts/ambient/api-account-delete-001.md'
  );
  assert.deepEqual(parsed2, parsed, 'frontmatter round-trip lost data');
  assert.equal(body2.trim(), body.trim(), 'body content drifted');
});

test('output uses correct fence pattern (---\\n on both sides)', () => {
  const out = writeFrontmatter({ format_version: 3, uuid: 'a-b-c' }, 'body');
  assert.equal(out, '---\nformat_version: 3\nuuid: a-b-c\n---\n\nbody');
});

test('empty arrays serialize as [] not bare key:', () => {
  const out = writeFrontmatter({ code_ranges: [] }, '');
  assert.match(out, /code_ranges: \[\]/);
});
