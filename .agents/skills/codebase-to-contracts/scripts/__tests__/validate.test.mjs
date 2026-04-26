// scripts/__tests__/validate.test.mjs
//
// Tests the JS-fallback validator branch (the IDE-binary subprocess is
// short-circuited by setting forceJsValidator: true). We construct
// minimal sidecar fixtures and assert the validator catches:
//   1. BACKEND-FM-01: missing ## Outputs section on a backend kind.
//   2. JSX-01: empty code_ranges on an L4 UI atom.
//   3. Schema allOf re-assertion: kind=flow without format_version=5.
//   4. All-good sidecar set: ok: true.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { validate, jsFallbackValidate } = await import('../validate.mjs');

function makeFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'validate-test-'));
  mkdirSync(join(dir, '.contracts/.staging'), { recursive: true });
  return dir;
}

function writeSidecar(stagingDir, uuid, frontmatterYaml, body) {
  writeFileSync(
    join(stagingDir, `${uuid}.md`),
    `---\n${frontmatterYaml}\n---\n\n${body}`,
  );
}

// ---------------------------------------------------------------------------
// Test 1: BACKEND-FM-01 catches missing ## Outputs.
// ---------------------------------------------------------------------------

test('validate: BACKEND-FM-01 catches missing ## Outputs on backend kind', () => {
  const dir = makeFixtureRepo();
  try {
    const stagingDir = join(dir, '.contracts/.staging');
    writeSidecar(stagingDir, 'aaaa1111-1111-4111-8111-111111111111', `format_version: 3
uuid: aaaa1111-1111-4111-8111-111111111111
kind: API
level: L3
parent: null
neighbors: []
code_ranges: []
code_hash: null
contract_hash: null
human_pinned: false
route: 'POST /api/notes'
derived_at: null
section_hashes: {}
rollup_inputs: []
rollup_hash: null
rollup_state: untracked
rollup_generation: 0`,
      `## Intent\nDoes a thing.\n\n## Role\nAPI endpoint.\n\n## Inputs\n- req: Request\n\n## Side effects\n- writes db`);

    const result = validate(dir, { forceJsValidator: true, silent: true });
    assert.equal(result.ok, false, 'should fail: missing Outputs');
    const outputsErr = result.errors.find((e) => /Outputs/.test(e));
    assert.ok(outputsErr, `expected error mentioning Outputs, got: ${JSON.stringify(result.errors)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 2: JSX-01 catches empty code_ranges on L4 UI atom.
// ---------------------------------------------------------------------------

test('validate: JSX-01 catches empty code_ranges on L4 UI atom', () => {
  const dir = makeFixtureRepo();
  try {
    const stagingDir = join(dir, '.contracts/.staging');
    writeSidecar(stagingDir, 'bbbb1111-1111-4111-8111-111111111111', `format_version: 3
uuid: bbbb1111-1111-4111-8111-111111111111
kind: UI
level: L4
parent: aaaa0000-0000-4000-8000-000000000000
neighbors: []
code_ranges: []
code_hash: null
contract_hash: null
human_pinned: false
route: null
derived_at: null
section_hashes: {}
rollup_inputs: []
rollup_hash: null
rollup_state: untracked
rollup_generation: 0`,
      `## Intent\nA button atom.\n\n## Role\nClickable affordance.`);

    const result = validate(dir, { forceJsValidator: true, silent: true });
    assert.equal(result.ok, false, 'should fail: empty code_ranges');
    const jsxErr = result.errors.find((e) => /JSX-01|empty code_ranges/.test(e));
    assert.ok(jsxErr, `expected JSX-01 error, got: ${JSON.stringify(result.errors)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 3: Schema allOf re-assertion catches kind=flow with wrong
//          format_version (the bridge stripped allOf at the API; validator
//          re-asserts here per Plan 14-04 SUMMARY mitigation).
// ---------------------------------------------------------------------------

test('validate: schema allOf re-assertion catches kind=flow with format_version=3', () => {
  const dir = makeFixtureRepo();
  try {
    const stagingDir = join(dir, '.contracts/.staging');
    writeSidecar(stagingDir, 'cccc0000-0000-4000-8000-000000000000', `format_version: 3
uuid: cccc0000-0000-4000-8000-000000000000
kind: flow
level: L2
parent: null
neighbors: []
members:
  - aaaa0000-0000-4000-8000-000000000000
  - bbbb0000-0000-4000-8000-000000000000
code_ranges: []
code_hash: null
contract_hash: null
human_pinned: false
route: null
derived_at: null
section_hashes: {}
rollup_inputs: []
rollup_hash: null
rollup_state: untracked
rollup_generation: 0`,
      `## Intent\nA flow.\n\n## Role\nOrchestrator.\n\n## Notes\n1. A\n2. B`);

    const result = validate(dir, { forceJsValidator: true, silent: true });
    assert.equal(result.ok, false, 'should fail: format_version mismatch');
    const fvErr = result.errors.find((e) => /format_version=5/.test(e));
    assert.ok(fvErr, `expected format_version=5 error, got: ${JSON.stringify(result.errors)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 4: Non-flow with members[] declared — the OTHER allOf branch.
// ---------------------------------------------------------------------------

test('validate: schema allOf re-assertion catches non-flow with members[]', () => {
  const dir = makeFixtureRepo();
  try {
    const stagingDir = join(dir, '.contracts/.staging');
    writeSidecar(stagingDir, 'dddd0000-0000-4000-8000-000000000000', `format_version: 3
uuid: dddd0000-0000-4000-8000-000000000000
kind: lib
level: L2
parent: null
neighbors: []
code_ranges:
  - file: src/lib/bad.ts
    start_line: 1
    end_line: 10
code_hash: null
contract_hash: null
human_pinned: false
route: null
derived_at: null
section_hashes: {}
rollup_inputs: []
rollup_hash: null
rollup_state: untracked
rollup_generation: 0
members:
  - aaaa0000-0000-4000-8000-000000000000`,
      `## Intent\nA lib.\n\n## Role\nHelper.\n\n## Inputs\n- foo\n\n## Outputs\n- bar\n\n## Side effects\n- none`);

    const result = validate(dir, { forceJsValidator: true, silent: true });
    assert.equal(result.ok, false, 'should fail: lib must not have members[]');
    const memErr = result.errors.find((e) => /must not declare members/.test(e));
    assert.ok(memErr, `expected members rejection error, got: ${JSON.stringify(result.errors)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 5: All-good sidecar set passes.
// ---------------------------------------------------------------------------

test('validate: all-good staging passes', () => {
  const dir = makeFixtureRepo();
  try {
    const stagingDir = join(dir, '.contracts/.staging');
    // Write a source file so JSX-01 can validate the code_range path,
    // even though the validator currently silent-skips missing files.
    mkdirSync(join(dir, 'src/components'), { recursive: true });
    writeFileSync(
      join(dir, 'src/components/Button.tsx'),
      `export function Button() { return <button>OK</button>; }`,
    );

    // (a) UI L3 (no Inputs/Outputs needed, only Intent + Role)
    writeSidecar(stagingDir, 'aaaa1111-1111-4111-8111-111111111111', `format_version: 3
uuid: aaaa1111-1111-4111-8111-111111111111
kind: UI
level: L3
parent: null
neighbors: []
code_ranges: []
code_hash: null
contract_hash: null
human_pinned: false
route: '/notes'
derived_at: null
section_hashes: {}
rollup_inputs: []
rollup_hash: null
rollup_state: untracked
rollup_generation: 0`,
      `## Intent\nNotes index page where users browse their notes.\n\n## Role\nNotes browse surface.`);

    // (b) UI L4 with non-empty code_ranges
    writeSidecar(stagingDir, 'bbbb1111-1111-4111-8111-111111111111', `format_version: 3
uuid: bbbb1111-1111-4111-8111-111111111111
kind: UI
level: L4
parent: aaaa1111-1111-4111-8111-111111111111
neighbors: []
code_ranges:
  - file: src/components/Button.tsx
    start_line: 1
    end_line: 1
code_hash: null
contract_hash: null
human_pinned: false
route: null
derived_at: null
section_hashes: {}
rollup_inputs: []
rollup_hash: null
rollup_state: untracked
rollup_generation: 0`,
      `## Intent\nButton atom for invoking actions in the notes UI.\n\n## Role\nGeneric clickable affordance.\n\n## Examples\n- onClick fires the parent action`);

    // (c) Backend lib with all sections
    writeSidecar(stagingDir, 'cccc1111-1111-4111-8111-111111111111', `format_version: 3
uuid: cccc1111-1111-4111-8111-111111111111
kind: lib
level: L2
parent: null
neighbors: []
code_ranges: []
code_hash: null
contract_hash: null
human_pinned: false
route: null
derived_at: null
section_hashes: {}
rollup_inputs: []
rollup_hash: null
rollup_state: untracked
rollup_generation: 0`,
      `## Intent\nUtility function library for shared logic.\n\n## Role\nHelper module.\n\n## Inputs\n- args: arbitrary\n\n## Outputs\n- result of the call\n\n## Side effects\n- none`);

    // (d) Flow contract
    writeSidecar(stagingDir, 'eeee0000-0000-4000-8000-000000000000', `format_version: 5
uuid: eeee0000-0000-4000-8000-000000000000
kind: flow
level: L2
parent: null
neighbors: []
members:
  - aaaa1111-1111-4111-8111-111111111111
  - bbbb1111-1111-4111-8111-111111111111
code_ranges: []
code_hash: null
contract_hash: null
human_pinned: false
route: null
derived_at: null
section_hashes: {}
rollup_inputs: []
rollup_hash: null
rollup_state: untracked
rollup_generation: 0`,
      `## Intent\nA flow that demonstrates schema validity.\n\n## Role\nDemonstration flow.\n\n## Notes\n1. Step one\n2. Step two`);

    const result = validate(dir, { forceJsValidator: true, silent: true });
    if (!result.ok) {
      assert.fail(`expected pass, got errors: ${JSON.stringify(result.errors, null, 2)}`);
    }
    assert.equal(result.source, 'js-fallback');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
