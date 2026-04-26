// scripts/__tests__/derive-body.test.mjs
//
// Verifies Stage 3 body derivation against a fixture nodes.json.
// claude -p is mocked via BOOTSTRAP_TEST_MODE=1 (the bridge returns {} so
// derive-body falls through to its bootstrap defaults). The test asserts
// the kind-branching shape (UI L3 / UI L4 / backend) and the exemplar
// interpolation in buildSystemPrompt().

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

process.env.BOOTSTRAP_TEST_MODE = '1';
const { deriveBody, buildSystemPrompt } = await import('../derive-body.mjs');

function makeFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'derive-body-test-'));
  const stagingDir = join(dir, '.contracts/.staging');
  mkdirSync(stagingDir, { recursive: true });

  // Three fixture nodes spanning the three kind branches.
  mkdirSync(join(dir, 'src/app/account/settings'), { recursive: true });
  writeFileSync(join(dir, 'src/app/account/settings/page.tsx'),
    `export default function Settings() { return <main><section data-uuid="a1">Danger Zone</section></main>; }`
  );
  mkdirSync(join(dir, 'src/lib/account'), { recursive: true });
  writeFileSync(join(dir, 'src/lib/account/beginAccountDeletion.ts'),
    `export async function beginAccountDeletion(userId: string): Promise<void> { return; }`
  );

  const nodes = [
    {
      uuid: 'a0000000-0000-4000-8000-000000000000',
      kind: 'UI', level: 'L3',
      file: 'src/app/account/settings/page.tsx',
      parent_hint: null,
      route: '/account/settings',
      candidate_lines: { start_line: 1, end_line: 1 },
    },
    {
      uuid: 'a1000000-0000-4000-8000-000000000000',
      kind: 'UI', level: 'L4',
      file: 'src/app/account/settings/page.tsx',
      parent_hint: 'a0000000-0000-4000-8000-000000000000',
      route: '/account/settings',
      candidate_lines: { start_line: 1, end_line: 1 },
    },
    {
      uuid: 'b0000000-0000-4000-8000-000000000000',
      kind: 'lib', level: 'L3',
      file: 'src/lib/account/beginAccountDeletion.ts',
      parent_hint: null,
      route: null,
      candidate_lines: { start_line: 1, end_line: 1 },
    },
  ];
  writeFileSync(join(stagingDir, 'nodes.json'), JSON.stringify(nodes, null, 2));
  return { dir, stagingDir, nodes };
}

test('Stage 3 buildSystemPrompt interpolates all 4 exemplars', () => {
  const prompt = buildSystemPrompt();
  // No leftover interpolation tokens.
  assert.equal(prompt.includes('{{EXEMPLAR_'), false, 'all interpolation tokens replaced');
  // ## Intent appears in all 4 exemplars (each has one).
  const intentCount = (prompt.match(/## Intent/g) || []).length;
  assert.ok(intentCount >= 4, `expected ≥4 ## Intent occurrences (one per exemplar), got ${intentCount}`);
  // ## Side effects appears in the backend exemplars (≥1).
  const sideEffectsCount = (prompt.match(/## Side effects/g) || []).length;
  assert.ok(sideEffectsCount >= 1, `expected ≥1 ## Side effects (backend exemplar), got ${sideEffectsCount}`);
});

test('Stage 3 produces one body.json per node with kind-branched shape', async () => {
  const { dir, stagingDir, nodes } = makeFixtureRepo();
  try {
    const result = await deriveBody(dir);
    assert.equal(result.derived, nodes.length, 'every node should be derived on first run');
    assert.equal(result.skipped, 0);

    const bodyFiles = readdirSync(stagingDir).filter(f => f.endsWith('.body.json'));
    assert.equal(bodyFiles.length, nodes.length, 'one body file per node');

    const byUuid = {};
    for (const f of bodyFiles) {
      const obj = JSON.parse(readFileSync(join(stagingDir, f), 'utf8'));
      byUuid[f.replace('.body.json', '')] = obj;
    }

    // UI L3 — has intent + role; NO inputs/outputs/side_effects/examples.
    const uiL3 = byUuid['a0000000-0000-4000-8000-000000000000'];
    assert.ok(uiL3, 'UI L3 body present');
    assert.equal(uiL3.kind, 'UI');
    assert.equal(uiL3.level, 'L3');
    assert.ok(typeof uiL3.intent === 'string' && uiL3.intent.length > 0);
    assert.ok(typeof uiL3.role === 'string' && uiL3.role.length > 0);
    assert.equal(uiL3.inputs, undefined, 'UI L3 should not have inputs');
    assert.equal(uiL3.examples, undefined, 'UI L3 should not have examples');

    // UI L4 — has intent + role + examples (may be empty array).
    const uiL4 = byUuid['a1000000-0000-4000-8000-000000000000'];
    assert.ok(uiL4, 'UI L4 body present');
    assert.equal(uiL4.kind, 'UI');
    assert.equal(uiL4.level, 'L4');
    assert.ok(Array.isArray(uiL4.examples), 'UI L4 must have examples array (may be empty)');

    // Backend lib — has inputs (≥1), outputs (≥1), side_effects (array, may be empty).
    const lib = byUuid['b0000000-0000-4000-8000-000000000000'];
    assert.ok(lib, 'backend lib body present');
    assert.equal(lib.kind, 'lib');
    assert.ok(Array.isArray(lib.inputs) && lib.inputs.length >= 1, 'backend has ≥1 input');
    assert.ok(Array.isArray(lib.outputs) && lib.outputs.length >= 1, 'backend has ≥1 output');
    assert.ok(Array.isArray(lib.side_effects), 'backend has side_effects array (may be empty)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Stage 3 hash-skips already-completed nodes on re-run', async () => {
  const { dir, nodes } = makeFixtureRepo();
  try {
    await deriveBody(dir);
    const second = await deriveBody(dir);
    assert.equal(second.derived, 0, 'no re-derivation on unchanged re-run');
    assert.equal(second.skipped, nodes.length, 'all nodes skipped via _progress.json');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Stage 3 --sample=N selects spread across UI L3 / UI L4 / backend', async () => {
  const { dir } = makeFixtureRepo();
  try {
    const result = await deriveBody(dir, { sampleN: 3 });
    assert.equal(result.derived, 3, 'sample of 3 derives 3 nodes');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
