// scripts/align-jsx.mjs — Stage 4 of the bootstrap pipeline.
//
// For every L4 UI atom in .staging/<uuid>.frontmatter.json, walk the
// parent .tsx file with @babel/parser using EXACTLY the Phase 9 webpack
// loader's config (`sourceType: 'module', plugins: ['jsx', 'typescript']`)
// and tighten code_ranges to wrap the OUTERMOST JSX element fully
// contained in the heuristic candidate range.
//
// Algorithm (mirrors contract-ide-demo/contract-uuid-plugin/index.js):
//   1. Collect all JSXElement nodes in the .tsx via the Babel parser.
//   2. Filter to candidates: elements whose [start_line, end_line] fall
//      within the atom's heuristic range.
//   3. Filter to outermost: candidates whose JSXElement parent is NOT
//      itself a candidate.
//   4. exactly-1 outermost match  → set atom.code_ranges to that span.
//      multi-match                → single LLM tiebreak call (no schema,
//                                   integer index back).
//      zero-match                 → push to failures; ABORT at end.
//
// Backend kinds (API / lib / data / external / job / cron / event) are
// EXEMPT — they have no JSX targets.
//
// On any zero-match: process.exit(1) + write _stage4_failures.json
// diagnostic to .staging/. The .contracts/ directory is never touched.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBabel } from './helpers/babel-parser-bridge.mjs';
import { callClaude } from './helpers/claude-cli-bridge.mjs';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(__filename);

// Phase 9 parity: parser config MUST match
// contract-ide-demo/contract-uuid-plugin/index.js EXACTLY.
const BABEL_PARSE_OPTIONS = { sourceType: 'module', plugins: ['jsx', 'typescript'] };

const BACKEND_KINDS = new Set(['API', 'lib', 'data', 'external', 'job', 'cron', 'event']);

// ---------------------------------------------------------------------------
// AST walking — collect all JSXElement nodes with parent refs.
// ---------------------------------------------------------------------------

function collectJsxElements(ast) {
  const elements = [];
  walkAstWithParent(ast, null, (node, parent) => {
    if (node.type === 'JSXElement') elements.push({ jsxElement: node, parent });
  });
  return elements;
}

function walkAstWithParent(node, parent, visitor) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walkAstWithParent(child, parent, visitor);
    return;
  }
  if (node.type) visitor(node, parent);
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue;
    const child = node[key];
    if (child && typeof child === 'object') walkAstWithParent(child, parent && node.type ? node : parent, visitor);
  }
}

// ---------------------------------------------------------------------------
// Outermost-JSX matcher.
// ---------------------------------------------------------------------------

function findOutermostMatches(jsxElements, atomRange) {
  const candidates = jsxElements.filter(({ jsxElement }) => {
    if (!jsxElement.loc) return false;
    const elStart = jsxElement.loc.start.line;
    const elEnd = jsxElement.loc.end.line;
    return elStart >= atomRange.start_line && elEnd <= atomRange.end_line;
  });
  if (candidates.length === 0) return [];
  const candidateSet = new Set(candidates.map(c => c.jsxElement));
  return candidates.filter(({ parent }) => {
    // If parent is a JSXElement that is also in our candidate set, this
    // element is nested inside another candidate → not outermost.
    if (parent && parent.type === 'JSXElement' && candidateSet.has(parent)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// LLM tiebreak — receive intent + N candidate JSX snippets, return integer.
// ---------------------------------------------------------------------------

async function llmTiebreak(atom, candidates, sourceLines) {
  const candidateSnippets = candidates.map(({ jsxElement }, idx) => {
    const start = jsxElement.loc.start.line;
    const end = jsxElement.loc.end.line;
    const snippet = sourceLines.slice(start - 1, end).join('\n');
    return `[${idx}] lines ${start}-${end}:\n${snippet}`;
  }).join('\n\n');

  const userPrompt = `Multiple JSX elements match this L4 UI atom's candidate range.
Pick the index of the JSX element whose source span best represents the atom.

Atom intent: ${atom.intent || '(intent unknown — pick the outermost semantically-meaningful element)'}
File: ${atom.file}

Candidates:
${candidateSnippets}

Return ONLY a single integer (the index). No prose, no formatting.`;

  try {
    const result = await callClaude({
      systemPrompt: 'You are a JSX-element disambiguation tiebreaker. Return only an integer index.',
      userPrompt,
      allowedTools: [],
    });
    const raw = String(result.structured_output?.result ?? result.raw ?? '').trim();
    const match = raw.match(/-?\d+/);
    if (match) {
      const idx = parseInt(match[0], 10);
      if (idx >= 0 && idx < candidates.length) return idx;
    }
  } catch (err) {
    process.stderr.write(`[align-jsx] LLM tiebreak failed: ${err.message}; defaulting to index 0\n`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Per-file alignment.
// ---------------------------------------------------------------------------

async function alignAtomsInFile(parse, repoPath, file, atomsForFile, failures, sourceLinesCache) {
  const sourcePath = resolve(repoPath, file);
  if (!existsSync(sourcePath)) {
    for (const atom of atomsForFile) {
      failures.push({ uuid: atom.uuid, file, reason: 'source file not found' });
    }
    return [];
  }
  const source = readFileSync(sourcePath, 'utf8');
  const sourceLines = source.split('\n');
  sourceLinesCache.set(file, sourceLines);

  let ast;
  try {
    ast = parse(source, BABEL_PARSE_OPTIONS);
  } catch (err) {
    for (const atom of atomsForFile) {
      failures.push({ uuid: atom.uuid, file, reason: `babel parse error: ${err.message}` });
    }
    return [];
  }
  const jsxElements = collectJsxElements(ast);

  const aligned = [];
  for (const atom of atomsForFile) {
    const candidateRange = atom.code_ranges?.[0];
    if (!candidateRange) {
      failures.push({ uuid: atom.uuid, file, reason: 'no candidate range on atom' });
      continue;
    }
    const outermost = findOutermostMatches(jsxElements, candidateRange);
    if (outermost.length === 0) {
      failures.push({
        uuid: atom.uuid, file,
        reason: `zero JSX elements found in candidate range ${candidateRange.start_line}-${candidateRange.end_line}`,
      });
      continue;
    }
    let chosen;
    if (outermost.length === 1) {
      chosen = outermost[0];
    } else {
      const idx = await llmTiebreak(atom, outermost, sourceLines);
      chosen = outermost[idx];
    }
    aligned.push({
      uuid: atom.uuid,
      code_ranges: [{
        file,
        start_line: chosen.jsxElement.loc.start.line,
        end_line: chosen.jsxElement.loc.end.line,
      }],
    });
  }
  return aligned;
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

export async function alignAllAtoms(repoPath, options = {}) {
  const stagingDir = resolve(repoPath, '.contracts/.staging');
  if (!existsSync(stagingDir)) {
    throw new Error(`Stage 1+2 has not been run. Expected ${stagingDir}.`);
  }

  const nodes = JSON.parse(readFileSync(resolve(stagingDir, 'nodes.json'), 'utf8'));

  // Load each L4 UI atom's frontmatter (carries the heuristic candidate range).
  const l4Atoms = [];
  for (const node of nodes) {
    if (node.kind !== 'UI' || node.level !== 'L4') continue; // backend exempt; L3 unchanged
    const fmPath = resolve(stagingDir, `${node.uuid}.frontmatter.json`);
    if (!existsSync(fmPath)) continue;
    const fm = JSON.parse(readFileSync(fmPath, 'utf8'));
    // Optionally pull intent from .body.json for the tiebreak prompt.
    const bodyPath = resolve(stagingDir, `${node.uuid}.body.json`);
    let intent = null;
    if (existsSync(bodyPath)) {
      try { intent = JSON.parse(readFileSync(bodyPath, 'utf8')).intent; } catch { /* ignore */ }
    }
    l4Atoms.push({
      uuid: fm.uuid,
      file: fm.code_ranges?.[0]?.file ?? node.file,
      code_ranges: fm.code_ranges,
      intent,
    });
  }

  console.log(`Stage 4: aligning ${l4Atoms.length} L4 UI atoms`);

  const { parse } = await loadBabel(repoPath);

  // Group atoms by file for one parse() per .tsx.
  const byFile = new Map();
  for (const atom of l4Atoms) {
    if (!byFile.has(atom.file)) byFile.set(atom.file, []);
    byFile.get(atom.file).push(atom);
  }

  const failures = [];
  const aligned = [];
  const sourceLinesCache = new Map();

  for (const [file, atomsForFile] of byFile) {
    const fileAligned = await alignAtomsInFile(parse, repoPath, file, atomsForFile, failures, sourceLinesCache);
    aligned.push(...fileAligned);
  }

  // Refuse-to-emit on ANY failure: write diagnostic + abort.
  if (failures.length > 0) {
    const failuresPath = resolve(stagingDir, '_stage4_failures.json');
    writeFileSync(failuresPath, JSON.stringify(failures, null, 2) + '\n');
    process.stderr.write(`[align-jsx] ${failures.length} L4 UI atoms failed alignment. See ${failuresPath}\n`);
    if (options.throwOnFailure) {
      throw new Error(`Stage 4 alignment failed for ${failures.length} atoms`);
    }
    process.exit(1);
  }

  // Persist tightened code_ranges into each atom's frontmatter.json.
  for (const a of aligned) {
    const fmPath = resolve(stagingDir, `${a.uuid}.frontmatter.json`);
    const fm = JSON.parse(readFileSync(fmPath, 'utf8'));
    fm.code_ranges = a.code_ranges;
    writeFileSync(fmPath, JSON.stringify(fm, null, 2) + '\n');
  }

  // Update progress.
  const progressPath = resolve(stagingDir, '_progress.json');
  let progress = {};
  if (existsSync(progressPath)) {
    try { progress = JSON.parse(readFileSync(progressPath, 'utf8')); } catch { /* ignore */ }
  }
  progress.stage = Math.max(progress.stage || 0, 4);
  progress.stage_4_completed_at = new Date().toISOString();
  progress.stage_4_aligned_count = aligned.length;
  writeFileSync(progressPath, JSON.stringify(progress, null, 2) + '\n');

  console.log(`Stage 4 complete: ${aligned.length} L4 UI atoms aligned, 0 failures`);
  return { aligned: aligned.length, failures: 0 };
}

// Exposed for testing.
export { findOutermostMatches, BABEL_PARSE_OPTIONS };

if (import.meta.url === `file://${process.argv[1]}`) {
  const repoPath = resolve(process.argv[2] || process.cwd());
  alignAllAtoms(repoPath).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
