// Source: contract-ide-demo/contract-uuid-plugin/index.js — copied verbatim per Phase 14 Plan 14-01b / RESEARCH.md Pitfall 3
// Sync strategy: when the source plugin in contract-ide-demo evolves (bug fix, perf), re-copy via
//   cp contract-ide-demo/contract-uuid-plugin/index.js .agents/skills/codebase-to-contracts/templates/contract-uuid-plugin-loader.js && diff
// (CI step future: assert hash match on every commit. Open Question 6 — symlink-vs-copy strategy: deferred. v1 = copy + manual sync.)

/**
 * contract-uuid-plugin/index.js
 *
 * Webpack loader that injects `data-contract-uuid="<uuid>"` on JSX opening
 * elements whose source-line range matches an L4 UI atom's code_ranges in
 * .contracts/*.md frontmatter.
 *
 * Strategy: custom webpack loader (NOT babel-loader) that parses each .tsx
 * file via @babel/parser, walks the JSX AST, injects attributes, and
 * regenerates source. Runs alongside Next.js's SWC pipeline — loader is
 * chained BEFORE the built-in SWC loader so it pre-processes the source.
 *
 * BABEL-01 spike implementation (Task 1 of 09-04b).
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Dependency resolution helpers
// ---------------------------------------------------------------------------
// @babel/parser and @babel/generator live in the pnpm virtual store as
// Next.js transitive deps. Resolve them via require.resolve from this file's
// directory so we find the right version regardless of workspace layout.
// ---------------------------------------------------------------------------

function resolvePnpmDep(pkgName, rootDir) {
  // Try direct node_modules first (standard npm/pnpm hoist).
  try {
    return require.resolve(pkgName, { paths: [rootDir] });
  } catch (_) {}
  // Fallback: walk pnpm virtual store for the package.
  const pnpmStore = path.join(rootDir, 'node_modules', '.pnpm', 'node_modules');
  try {
    return require.resolve(pkgName, { paths: [pnpmStore] });
  } catch (_) {}
  // Fallback 2: try finding via pnpm store directory listing.
  const storeDir = path.join(rootDir, 'node_modules', '.pnpm');
  try {
    const entries = fs.readdirSync(storeDir).filter((e) => e.startsWith(pkgName.replace('@', '').replace('/', '+')));
    for (const entry of entries) {
      try {
        return require.resolve(pkgName, {
          paths: [path.join(storeDir, entry, 'node_modules')],
        });
      } catch (_) {}
    }
  } catch (_) {}
  return null;
}

let babelParser = null;
let babelGenerator = null;
let jsYaml = null;
let depsResolved = false;

function resolveDeps(repoRoot) {
  if (depsResolved) return;
  depsResolved = true;

  // @babel/parser
  try {
    const parserPath = resolvePnpmDep('@babel/parser', repoRoot);
    if (parserPath) babelParser = require(parserPath);
  } catch (e) {
    console.warn('[contract-uuid-plugin] @babel/parser not available:', e.message);
  }

  // @babel/generator
  try {
    const generatorPath = resolvePnpmDep('@babel/generator', repoRoot);
    if (generatorPath) {
      const gen = require(generatorPath);
      babelGenerator = gen.default || gen;
    }
  } catch (e) {
    console.warn('[contract-uuid-plugin] @babel/generator not available:', e.message);
  }

  // js-yaml (in pnpm store as Next.js dep)
  try {
    const yamlPath = resolvePnpmDep('js-yaml', repoRoot);
    if (yamlPath) jsYaml = require(yamlPath);
  } catch (e) {
    console.warn('[contract-uuid-plugin] js-yaml not available:', e.message);
  }

  if (!babelParser || !babelGenerator || !jsYaml) {
    console.warn('[contract-uuid-plugin] Missing deps — attribute injection disabled');
  }
}

// ---------------------------------------------------------------------------
// Contract frontmatter loading
// ---------------------------------------------------------------------------

/** @type {Map<string, Array<{uuid: string, start: number, end: number}>>} */
let atomsByFile = null;

/**
 * Walk .contracts/ (and .contracts/ambient/) recursively, parse frontmatter
 * for L4 UI atoms, build Map<repo-relative-file, atoms[]>.
 */
function loadAtoms(repoRoot) {
  if (atomsByFile !== null) return atomsByFile;

  atomsByFile = new Map();
  if (!jsYaml) return atomsByFile;

  const contractsDir = path.join(repoRoot, '.contracts');
  if (!fs.existsSync(contractsDir)) return atomsByFile;

  const mdFiles = walkMd(contractsDir);

  for (const mdFile of mdFiles) {
    let content;
    try {
      content = fs.readFileSync(mdFile, 'utf8');
    } catch (_) {
      continue;
    }

    const fm = parseFrontmatter(content);
    if (!fm) continue;

    // Only L4 UI atoms have JSX targets.
    if (fm.level !== 'L4' || fm.kind !== 'UI') continue;
    if (!fm.uuid) continue;
    if (!Array.isArray(fm.code_ranges) || fm.code_ranges.length === 0) continue;

    for (const range of fm.code_ranges) {
      if (!range.file || !range.start_line || !range.end_line) continue;

      const normalizedFile = range.file.replace(/\\/g, '/');
      if (!atomsByFile.has(normalizedFile)) {
        atomsByFile.set(normalizedFile, []);
      }
      atomsByFile.get(normalizedFile).push({
        uuid: fm.uuid,
        start: range.start_line,
        end: range.end_line,
      });
    }
  }

  return atomsByFile;
}

function walkMd(dir) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkMd(full));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  try {
    return jsYaml.load(match[1]);
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// AST transformation
// ---------------------------------------------------------------------------

/**
 * Collect all JSXElement nodes (with parent refs) for disambiguation.
 * Returns array of { jsxElement, openingElement, parentJsxElement }.
 */
function collectJsxElements(ast) {
  const elements = [];
  walkAstWithParent(ast, null, (node, parent) => {
    if (node.type === 'JSXElement') {
      elements.push({ jsxElement: node, parent });
    }
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
    if (child && typeof child === 'object') walkAstWithParent(child, node, visitor);
  }
}

/**
 * Transform .tsx source: inject `data-contract-uuid="<uuid>"` on the
 * outermost JSX element whose source span is fully contained within an
 * L4 UI atom's code_ranges.
 *
 * "Outermost" means: the JSX element whose start line falls within the
 * atom range AND whose parent JSX element (if any) starts BEFORE the
 * atom range (i.e., is NOT itself fully contained in the atom range).
 */
function transformSource(source, filename, repoRoot) {
  if (!babelParser || !babelGenerator) return null;

  const atoms = loadAtoms(repoRoot);

  // Normalize filename to a repo-relative path for lookup.
  const repoRel = path.relative(repoRoot, filename).replace(/\\/g, '/');
  const fileAtoms = atoms.get(repoRel);
  if (!fileAtoms || fileAtoms.length === 0) return null;

  let ast;
  try {
    ast = babelParser.parse(source, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true,
    });
  } catch (e) {
    // If parse fails, don't transform — let Next.js handle any error.
    return null;
  }

  const jsxElements = collectJsxElements(ast);
  let modified = false;

  for (const atom of fileAtoms) {
    // Find JSX elements that are fully within the atom's range.
    const candidates = jsxElements.filter(({ jsxElement }) => {
      if (!jsxElement.loc) return false;
      const elStart = jsxElement.loc.start.line;
      const elEnd = jsxElement.loc.end.line;
      return elStart >= atom.start && elEnd <= atom.end;
    });

    if (candidates.length === 0) continue;

    // Among candidates, find the outermost: the one whose parent is NOT itself
    // a candidate (i.e., parent is not within the atom range).
    const candidateSet = new Set(candidates.map((c) => c.jsxElement));
    const outermost = candidates.filter(({ parent }) => {
      // If parent is a JSXElement in our candidate set, this is not outermost.
      if (!parent) return true; // root-level, definitely outermost
      // Walk up to find first JSXElement ancestor.
      // The parent stored is the direct AST parent, which may be JSXElement
      // or something else (like ReturnStatement, etc.)
      if (parent.type === 'JSXElement' && candidateSet.has(parent)) return false;
      return true;
    });

    for (const { jsxElement } of outermost) {
      const openingElement = jsxElement.openingElement;
      if (!openingElement) continue;

      // Idempotency: skip if already has data-contract-uuid.
      const alreadyHas = openingElement.attributes.some(
        (attr) => attr.type === 'JSXAttribute' && attr.name?.name === 'data-contract-uuid',
      );
      if (alreadyHas) continue;

      // Inject the attribute.
      openingElement.attributes.push({
        type: 'JSXAttribute',
        name: { type: 'JSXIdentifier', name: 'data-contract-uuid' },
        value: { type: 'StringLiteral', value: atom.uuid },
      });
      modified = true;
    }
  }

  if (!modified) return null;

  try {
    const result = babelGenerator(ast, { retainLines: true }, source);
    return result.code;
  } catch (e) {
    console.warn('[contract-uuid-plugin] generator failed:', e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Webpack loader entry point
// ---------------------------------------------------------------------------

/**
 * This function is the webpack loader. Webpack calls it with `this` as the
 * loader context. Return value is the transformed source (or original on
 * no-op / error).
 */
function contractUuidLoader(source) {
  const filename = this.resourcePath;
  // Only process .tsx files.
  if (!filename.endsWith('.tsx') && !filename.endsWith('.jsx')) return source;

  // Find repo root: walk up from filename until we find a .contracts/ dir.
  const repoRoot = findRepoRoot(filename);
  if (!repoRoot) return source;

  resolveDeps(repoRoot);

  try {
    const transformed = transformSource(source, filename, repoRoot);
    return transformed !== null ? transformed : source;
  } catch (e) {
    // Never error — worst case return original source.
    this.emitWarning(new Error(`[contract-uuid-plugin] Failed to transform ${filename}: ${e.message}`));
    return source;
  }
}

function findRepoRoot(filename) {
  let dir = path.dirname(filename);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, '.contracts'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

module.exports = contractUuidLoader;

// Also export as named export for next.config.ts import.
module.exports.contractUuidLoader = contractUuidLoader;
