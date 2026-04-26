// scripts/__tests__/emit.test.mjs
//
// Verifies Stage 5b: composeMarkdownBody + atomic emit + plugin install
// idempotency + validator-failure abort.
//
// Strategy: build a tmpdir "fake repo" with prepopulated .staging/ JSON
// intermediates + a next.config.ts; run emit() and assert end-state of
// the .contracts/ tree, the contract-uuid-plugin/ scaffold, and the
// next.config.ts patch.
//
// Tests:
//   1. emit composes .md sidecars from .json intermediates and atomically
//      moves them to .contracts/.
//   2. emit installs the plugin scaffold (index.js + package.json) +
//      patches next.config.ts with BOOTSTRAP-INSERT-START/END markers.
//   3. emit re-run is idempotent — a second pass does NOT duplicate the
//      BOOTSTRAP-INSERT block in next.config.ts.
//   4. emit ABORTS when validator returns ok:false (validator gate).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BOOTSTRAP_TEST_MODE = '1';
const { emit } = await import('../emit.mjs');
const { installBabelPlugin, INSERT_START, INSERT_END } = await import('../install-babel-plugin.mjs');

// ---------------------------------------------------------------------------
// Fixture builder — minimal fake repo with one UI L3 + one UI L4 + one
// backend lib node.json/body.json pair, plus a next.config.ts.
// ---------------------------------------------------------------------------

function makeFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'emit-test-'));

  // package.json
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture-app' }, null, 2));

  // next.config.ts (minimal — emit will patch).
  writeFileSync(join(dir, 'next.config.ts'),
    `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
`);

  // Source file for the L4 atom's code_range.
  mkdirSync(join(dir, 'src/components'), { recursive: true });
  writeFileSync(
    join(dir, 'src/components/Button.tsx'),
    `export function Button() { return <button>Hi</button>; }\n`,
  );

  // Staging directory + 3 fixture frontmatter/body pairs.
  const stagingDir = join(dir, '.contracts/.staging');
  mkdirSync(stagingDir, { recursive: true });

  const uiL3Uuid = '11111111-1111-4111-8111-111111111111';
  const uiL4Uuid = '22222222-2222-4222-8222-222222222222';
  const libUuid = '33333333-3333-4333-8333-333333333333';

  writeFileSync(join(stagingDir, `${uiL3Uuid}.frontmatter.json`), JSON.stringify({
    format_version: 3, uuid: uiL3Uuid, kind: 'UI', level: 'L3',
    parent: null, neighbors: [], code_ranges: [],
    code_hash: null, contract_hash: null, human_pinned: false,
    route: '/notes', derived_at: null, section_hashes: {},
    rollup_inputs: [], rollup_hash: null,
    rollup_state: 'untracked', rollup_generation: 0,
    _source_sha256: 'cafe' + 'cafe'.repeat(15),
  }, null, 2));
  writeFileSync(join(stagingDir, `${uiL3Uuid}.body.json`), JSON.stringify({
    kind: 'UI', level: 'L3',
    intent: 'Notes index page where users browse their notes — a substantive intent ≥50 chars.',
    role: 'Browse surface for notes — a substantive role description.',
  }, null, 2));

  writeFileSync(join(stagingDir, `${uiL4Uuid}.frontmatter.json`), JSON.stringify({
    format_version: 3, uuid: uiL4Uuid, kind: 'UI', level: 'L4',
    parent: uiL3Uuid, neighbors: [],
    code_ranges: [{ file: 'src/components/Button.tsx', start_line: 1, end_line: 1 }],
    code_hash: null, contract_hash: null, human_pinned: false,
    route: null, derived_at: null, section_hashes: {},
    rollup_inputs: [], rollup_hash: null,
    rollup_state: 'untracked', rollup_generation: 0,
  }, null, 2));
  writeFileSync(join(stagingDir, `${uiL4Uuid}.body.json`), JSON.stringify({
    kind: 'UI', level: 'L4',
    intent: 'Button atom for invoking actions on notes — a substantive intent ≥50 chars.',
    role: 'Generic clickable affordance.',
    examples: ['onClick fires the parent action'],
  }, null, 2));

  writeFileSync(join(stagingDir, `${libUuid}.frontmatter.json`), JSON.stringify({
    format_version: 3, uuid: libUuid, kind: 'lib', level: 'L2',
    parent: null, neighbors: [], code_ranges: [],
    code_hash: null, contract_hash: null, human_pinned: false,
    route: null, derived_at: null, section_hashes: {},
    rollup_inputs: [], rollup_hash: null,
    rollup_state: 'untracked', rollup_generation: 0,
  }, null, 2));
  writeFileSync(join(stagingDir, `${libUuid}.body.json`), JSON.stringify({
    kind: 'lib', level: 'L2',
    intent: 'Utility library for shared notes logic — substantive intent ≥50 chars in length.',
    role: 'Helper module providing reusable functions for notes CRUD.',
    inputs: ['args: arbitrary call inputs'],
    outputs: ['return result of the underlying call'],
    side_effects: [],
  }, null, 2));

  return { dir, stagingDir, uiL3Uuid, uiL4Uuid, libUuid };
}

// ---------------------------------------------------------------------------
// Test 1: emit composes .md sidecars and atomically moves to .contracts/.
// ---------------------------------------------------------------------------

test('emit composes .md sidecars and promotes them to .contracts/', async () => {
  const { dir, uiL3Uuid, uiL4Uuid, libUuid } = makeFixtureRepo();
  try {
    const result = await emit(dir);

    const finalDir = join(dir, '.contracts');
    assert.ok(existsSync(finalDir), '.contracts/ created');

    // 3 .md files in .contracts/.
    const mdFiles = readdirSync(finalDir).filter((f) => f.endsWith('.md'));
    assert.equal(mdFiles.length, 3, '3 sidecars promoted');
    assert.ok(mdFiles.includes(`${uiL3Uuid}.md`), 'UI L3 sidecar present');
    assert.ok(mdFiles.includes(`${uiL4Uuid}.md`), 'UI L4 sidecar present');
    assert.ok(mdFiles.includes(`${libUuid}.md`), 'lib sidecar present');

    // Inspect a backend sidecar to confirm Inputs/Outputs/Side effects rendered.
    const libSidecar = readFileSync(join(finalDir, `${libUuid}.md`), 'utf8');
    assert.ok(libSidecar.includes('## Inputs'), 'lib has ## Inputs');
    assert.ok(libSidecar.includes('## Outputs'), 'lib has ## Outputs');
    assert.ok(libSidecar.includes('## Side effects'), 'lib has ## Side effects');

    // Staging-only fields stripped (no _source_sha256).
    const uiL3Sidecar = readFileSync(join(finalDir, `${uiL3Uuid}.md`), 'utf8');
    assert.equal(uiL3Sidecar.includes('_source_sha256'), false, 'staging marker stripped');

    // result.composed reflects the count.
    assert.equal(result.composed, 3);
    assert.equal(result.promoted, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 2: emit installs the plugin scaffold + patches next.config.ts.
// ---------------------------------------------------------------------------

test('emit installs contract-uuid-plugin scaffold and patches next.config.ts', async () => {
  const { dir } = makeFixtureRepo();
  try {
    await emit(dir);

    const pluginDir = join(dir, 'contract-uuid-plugin');
    assert.ok(existsSync(pluginDir), 'plugin dir created');
    assert.ok(existsSync(join(pluginDir, 'index.js')), 'plugin index.js present');
    assert.ok(existsSync(join(pluginDir, 'package.json')), 'plugin package.json present');

    const pkg = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'));
    assert.equal(pkg.name, 'contract-uuid-plugin');
    assert.equal(pkg._comment, undefined, 'provenance comment stripped from JSON');

    const config = readFileSync(join(dir, 'next.config.ts'), 'utf8');
    assert.ok(config.includes(INSERT_START), 'next.config.ts has BOOTSTRAP-INSERT-START');
    assert.ok(config.includes(INSERT_END), 'next.config.ts has BOOTSTRAP-INSERT-END');
    // Markers appear EXACTLY once.
    const startCount = (config.match(/BOOTSTRAP-INSERT-START/g) || []).length;
    assert.equal(startCount, 1, 'exactly one BOOTSTRAP-INSERT-START marker');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 3: Idempotent re-install — re-running installBabelPlugin replaces the
// existing block (does NOT duplicate it).
// ---------------------------------------------------------------------------

test('install-babel-plugin: re-running replaces (not duplicates) the BOOTSTRAP-INSERT block', () => {
  const { dir } = makeFixtureRepo();
  try {
    // First install.
    installBabelPlugin(dir);
    const config1 = readFileSync(join(dir, 'next.config.ts'), 'utf8');
    const startCount1 = (config1.match(/BOOTSTRAP-INSERT-START/g) || []).length;
    assert.equal(startCount1, 1, 'first install: exactly one BOOTSTRAP-INSERT block');

    // Second install — should replace, not append.
    installBabelPlugin(dir);
    const config2 = readFileSync(join(dir, 'next.config.ts'), 'utf8');
    const startCount2 = (config2.match(/BOOTSTRAP-INSERT-START/g) || []).length;
    assert.equal(startCount2, 1, 're-install: still exactly one BOOTSTRAP-INSERT block (not duplicated)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 4: emit aborts when validator gate returns ok:false. .contracts/ stays
// empty (or absent), .staging/ tree preserved for debugging.
// ---------------------------------------------------------------------------

test('emit aborts on validator failure — .contracts/ never gets the bad sidecars', async () => {
  // Build a fixture where we DELIBERATELY emit a backend lib with no inputs
  // — this should trip BACKEND-FM-01 in the JS-fallback validator.
  const dir = mkdtempSync(join(tmpdir(), 'emit-bad-test-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture' }));
    writeFileSync(join(dir, 'next.config.ts'),
      `const nextConfig = {};\nexport default nextConfig;\n`);
    const stagingDir = join(dir, '.contracts/.staging');
    mkdirSync(stagingDir, { recursive: true });
    const libUuid = 'ffff0000-0000-4000-8000-000000000000';
    writeFileSync(join(stagingDir, `${libUuid}.frontmatter.json`), JSON.stringify({
      format_version: 3, uuid: libUuid, kind: 'lib', level: 'L2',
      parent: null, neighbors: [], code_ranges: [],
      code_hash: null, contract_hash: null, human_pinned: false,
      route: null, derived_at: null, section_hashes: {},
      rollup_inputs: [], rollup_hash: null,
      rollup_state: 'untracked', rollup_generation: 0,
    }, null, 2));
    // Body: Intent + Role only — Inputs / Outputs / Side effects MISSING.
    // Validator should catch this via BACKEND-FM-01.
    writeFileSync(join(stagingDir, `${libUuid}.body.json`), JSON.stringify({
      kind: 'lib', level: 'L2',
      intent: 'A backend lib that intentionally lacks Inputs / Outputs sections.',
      role: 'Helper module.',
    }, null, 2));

    await assert.rejects(
      emit(dir, { throwOnError: true }),
      /Validation failed/,
      'emit should throw on validator failure',
    );

    const finalDir = join(dir, '.contracts');
    // .contracts/ may exist (because .staging/ is under it), but no .md
    // files should have been promoted (if any composed got moved up).
    const composedInFinal = existsSync(finalDir)
      ? readdirSync(finalDir).filter((f) => f.endsWith('.md') && !f.startsWith('.'))
      : [];
    assert.equal(composedInFinal.length, 0, '.contracts/ has NO promoted sidecars after validator abort');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
