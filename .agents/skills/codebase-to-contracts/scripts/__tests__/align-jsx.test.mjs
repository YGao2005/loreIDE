// scripts/__tests__/align-jsx.test.mjs
//
// Verifies Stage 4 JSX alignment: outermost-element matching, multi-match
// tiebreak, and refuse-to-emit on zero match. Uses BOOTSTRAP_TEST_MODE=1
// so the LLM tiebreak short-circuits to {} (which falls through to index 0
// in our handler — that's deterministic enough for the unit test).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.BOOTSTRAP_TEST_MODE = '1';
const { alignAllAtoms, findOutermostMatches, BABEL_PARSE_OPTIONS } = await import('../align-jsx.mjs');
const { loadBabel } = await import('../helpers/babel-parser-bridge.mjs');

const __filename = fileURLToPath(import.meta.url);
const FIXTURES_DIR = resolve(dirname(__filename), 'fixtures');

function makeFixtureRepo(fixtureName, atomFrontmatters) {
  const dir = mkdtempSync(join(tmpdir(), 'align-jsx-test-'));
  const stagingDir = join(dir, '.contracts/.staging');
  mkdirSync(stagingDir, { recursive: true });

  // Copy the fixture .tsx into the fake repo.
  const targetPath = join(dir, 'src/app/page.tsx');
  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(join(FIXTURES_DIR, fixtureName), targetPath);

  // Write nodes.json + per-atom frontmatter.json.
  const nodes = atomFrontmatters.map(fm => ({
    uuid: fm.uuid,
    kind: 'UI', level: 'L4',
    file: 'src/app/page.tsx',
    parent_hint: null,
    candidate_lines: { start_line: fm.code_ranges[0].start_line, end_line: fm.code_ranges[0].end_line },
  }));
  writeFileSync(join(stagingDir, 'nodes.json'), JSON.stringify(nodes, null, 2));
  for (const fm of atomFrontmatters) {
    writeFileSync(join(stagingDir, `${fm.uuid}.frontmatter.json`), JSON.stringify(fm, null, 2));
  }
  return { dir, stagingDir };
}

test('Stage 4 outermost-detection picks parent over nested children', async () => {
  // page-with-jsx.tsx: candidate range 11-14 covers the danger-zone section.
  // Inside it: <section> (outer, lines 11-14), <h2> (12), <button> (13).
  // Expected outermost: the <section> at lines 11-14.
  const atomFm = {
    uuid: 'a1000000-0000-4000-8000-000000000000',
    kind: 'UI', level: 'L4',
    code_ranges: [{ file: 'src/app/page.tsx', start_line: 11, end_line: 14 }],
  };
  const { dir, stagingDir } = makeFixtureRepo('page-with-jsx.tsx', [atomFm]);
  try {
    const result = await alignAllAtoms(dir);
    assert.equal(result.aligned, 1);
    assert.equal(result.failures, 0);

    const updatedFm = JSON.parse(readFileSync(join(stagingDir, `${atomFm.uuid}.frontmatter.json`), 'utf8'));
    assert.equal(updatedFm.code_ranges.length, 1);
    // The outermost JSX element fully contained in [11,14] is the <section> at 11-14.
    assert.equal(updatedFm.code_ranges[0].start_line, 11, 'outermost element starts at 11');
    assert.equal(updatedFm.code_ranges[0].end_line, 14, 'outermost element ends at 14');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Stage 4 zero-match writes _stage4_failures.json and throws (test mode)', async () => {
  // Candidate range 50-60 has no JSX (page-with-jsx.tsx is only 16 lines).
  const atomFm = {
    uuid: 'a2000000-0000-4000-8000-000000000000',
    kind: 'UI', level: 'L4',
    code_ranges: [{ file: 'src/app/page.tsx', start_line: 50, end_line: 60 }],
  };
  const { dir, stagingDir } = makeFixtureRepo('page-with-jsx.tsx', [atomFm]);
  try {
    await assert.rejects(
      alignAllAtoms(dir, { throwOnFailure: true }),
      /Stage 4 alignment failed/,
      'should throw on zero-match',
    );
    const failuresPath = join(stagingDir, '_stage4_failures.json');
    assert.ok(existsSync(failuresPath), '_stage4_failures.json written');
    const failures = JSON.parse(readFileSync(failuresPath, 'utf8'));
    assert.equal(failures.length, 1);
    assert.equal(failures[0].uuid, atomFm.uuid);
    assert.match(failures[0].reason, /zero JSX elements/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Stage 4 multi-match candidates trigger tiebreak (test mode → idx 0)', async () => {
  // page-multi-element-bad.tsx: candidate range 3-10 covers the fragment +
  // both sibling <section> elements. Outermost = both sections (siblings,
  // neither nested in the other; the fragment is a JSXFragment, not
  // JSXElement, so it doesn't enter the candidate set).
  // With multi-match, we tiebreak. In test mode, callClaude returns {}, so
  // our fallback picks index 0.
  const atomFm = {
    uuid: 'a3000000-0000-4000-8000-000000000000',
    kind: 'UI', level: 'L4',
    code_ranges: [{ file: 'src/app/page.tsx', start_line: 3, end_line: 10 }],
  };
  const { dir, stagingDir } = makeFixtureRepo('page-multi-element-bad.tsx', [atomFm]);
  try {
    const result = await alignAllAtoms(dir);
    assert.equal(result.aligned, 1, 'tiebreak resolves to one atom');
    assert.equal(result.failures, 0);

    const updatedFm = JSON.parse(readFileSync(join(stagingDir, `${atomFm.uuid}.frontmatter.json`), 'utf8'));
    // After tiebreak, code_ranges should point to ONE of the two sections.
    const start = updatedFm.code_ranges[0].start_line;
    const end = updatedFm.code_ranges[0].end_line;
    assert.ok(
      (start === 4 && end === 6) || (start === 7 && end === 9),
      `expected one of the two sections (4-6 or 7-9), got ${start}-${end}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Stage 4 findOutermostMatches helper filters nested elements', async () => {
  const repoPath = resolve(FIXTURES_DIR, '../../..');  // skill root
  const { parse } = await loadBabel(repoPath);
  const source = readFileSync(join(FIXTURES_DIR, 'page-with-jsx.tsx'), 'utf8');
  const ast = parse(source, BABEL_PARSE_OPTIONS);

  const elements = [];
  function walk(node, parent) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const c of node) walk(c, parent); return; }
    if (node.type === 'JSXElement') elements.push({ jsxElement: node, parent });
    for (const k of Object.keys(node)) {
      if (['type','loc','start','end'].includes(k)) continue;
      const v = node[k];
      if (v && typeof v === 'object') walk(v, node.type ? node : parent);
    }
  }
  walk(ast, null);

  // Range 11-14 covers section + h2 + button. Outermost = just the section.
  const outermost = findOutermostMatches(elements, { start_line: 11, end_line: 14 });
  assert.equal(outermost.length, 1, 'exactly one outermost in range 11-14');
  assert.equal(outermost[0].jsxElement.loc.start.line, 11);
  assert.equal(outermost[0].jsxElement.loc.end.line, 14);
});
