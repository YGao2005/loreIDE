// scripts/__tests__/derive-frontmatter.test.mjs
//
// Verifies Stage 2 hash-skip + frontmatter shape against a small fixture.
// claude -p is mocked via BOOTSTRAP_TEST_MODE=1 (the bridge returns {}, and
// derive-frontmatter falls through to its bootstrap defaults).
//
// Asserts:
//   1. Each node in nodes.json produces a .staging/<uuid>.frontmatter.json
//      with format_version=3, valid uuid/kind/level, and no LLM-required body.
//   2. Re-running with unchanged sources reports "0 derived, N skipped".
//   3. Re-running after one source file changes reports "1 derived, N-1 skipped".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

process.env.BOOTSTRAP_TEST_MODE = '1';
const { discover } = await import('../discover.mjs');
const { deriveFrontmatter } = await import('../derive-frontmatter.mjs');

function makeFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'derive-fm-test-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture-app' }, null, 2));

  mkdirSync(join(dir, 'src/app'), { recursive: true });
  writeFileSync(join(dir, 'src/app/page.tsx'),
    `export default function Home() { return <main>Welcome</main>; }`
  );

  mkdirSync(join(dir, 'src/lib'), { recursive: true });
  writeFileSync(join(dir, 'src/lib/db.ts'),
    `export function getDb() { return {}; }`
  );

  mkdirSync(join(dir, 'prisma'), { recursive: true });
  writeFileSync(join(dir, 'prisma/schema.prisma'),
    `model User {
       id String @id
     }
    `
  );

  return dir;
}

function readFrontmatterFiles(stagingDir) {
  return readdirSync(stagingDir)
    .filter(f => f.endsWith('.frontmatter.json'))
    .map(f => JSON.parse(readFileSync(join(stagingDir, f), 'utf8')));
}

test('Stage 2 produces a valid frontmatter file per Stage 1 node', async () => {
  const repo = makeFixtureRepo();
  try {
    const nodes = await discover(repo);
    const result = await deriveFrontmatter(repo);

    assert.equal(result.derived, nodes.length, 'every node should be derived on first run');
    assert.equal(result.skipped, 0, 'no nodes should be hash-skipped on first run');

    const stagingDir = resolve(repo, '.contracts/.staging');
    const fms = readFrontmatterFiles(stagingDir);
    assert.equal(fms.length, nodes.length, 'one frontmatter file per node');

    for (const fm of fms) {
      assert.equal(fm.format_version, 3, 'format_version must be 3 at bootstrap');
      assert.match(fm.uuid, /^[0-9a-fA-F-]{36}$/, 'uuid must be RFC 4122-shaped');
      assert.ok(['UI', 'API', 'data', 'lib', 'external', 'job', 'cron', 'event'].includes(fm.kind));
      assert.ok(['L0', 'L1', 'L2', 'L3', 'L4'].includes(fm.level));
      assert.equal(fm.code_hash, null, 'code_hash must be null at bootstrap (Phase 6 fills)');
      assert.equal(fm.derived_at, null, 'derived_at must be null at bootstrap');
      assert.equal(fm.rollup_state, 'untracked');
      assert.equal(fm.rollup_generation, 0);
      assert.equal(fm.human_pinned, false);
      assert.deepEqual(fm.section_hashes, {});
      assert.deepEqual(fm.rollup_inputs, []);
      assert.deepEqual(fm.neighbors, []);
      assert.ok(Array.isArray(fm.code_ranges) && fm.code_ranges.length === 1, 'one code_range per node');
      assert.ok(typeof fm._source_sha256 === 'string' && fm._source_sha256.length === 64, 'staging marker present');
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('Stage 2 hash-skips unchanged sources on re-run', async () => {
  const repo = makeFixtureRepo();
  try {
    const nodes = await discover(repo);
    await deriveFrontmatter(repo);
    const second = await deriveFrontmatter(repo);
    assert.equal(second.derived, 0, '0 derivations on unchanged re-run');
    assert.equal(second.skipped, nodes.length, 'all nodes should be hash-skipped');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('Stage 2 re-derives only changed sources', async () => {
  const repo = makeFixtureRepo();
  try {
    const nodes = await discover(repo);
    await deriveFrontmatter(repo);

    // Modify only db.ts
    writeFileSync(join(repo, 'src/lib/db.ts'),
      `export function getDb() { return { changed: true }; }
       export function getOther() { return null; }`
    );

    const second = await deriveFrontmatter(repo);
    assert.equal(second.derived, 1, 'exactly one node re-derived (db.ts changed)');
    assert.equal(second.skipped, nodes.length - 1, 'remaining nodes hash-skipped');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
