// scripts/install-babel-plugin.mjs — Stage 5b's Babel-plugin install step.
//
// Copies the contract-uuid-plugin/ scaffold from skill templates into the
// target repo, then idempotently patches the target's next.config.{ts,js,mjs}
// to wire the loader into the webpack pipeline.
//
// Idempotency contract (RESEARCH Pattern 3): re-running over a repo that
// already has the plugin installed REPLACES the BOOTSTRAP-INSERT block in
// next.config.* (find-and-replace between markers). Never appends a
// duplicate block.
//
// Templates are stamped with a `_comment` provenance field in the JSON
// (stripped on emit) and a 5-line provenance header in the JS (preserved
// so users can trace the file back to the skill). Path resolution into
// the target repo's pnpm virtual store is handled at runtime by the
// loader's existing `resolvePnpmDep` helper (Phase 9 BABEL-01 spike).

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(__filename);

const TEMPLATE_DIR = resolve(SCRIPT_DIR, '../templates');
const LOADER_TEMPLATE = resolve(TEMPLATE_DIR, 'contract-uuid-plugin-loader.js');
const PACKAGE_TEMPLATE = resolve(TEMPLATE_DIR, 'contract-uuid-plugin-package.json');
const SNIPPET_TEMPLATE = resolve(TEMPLATE_DIR, 'next-config-snippet.ts');

const INSERT_START = '// BOOTSTRAP-INSERT-START contract-uuid-plugin';
const INSERT_END = '// BOOTSTRAP-INSERT-END contract-uuid-plugin';

const NEXT_CONFIG_CANDIDATES = ['next.config.ts', 'next.config.js', 'next.config.mjs'];

// ---------------------------------------------------------------------------
// Plugin directory copy — verbatim file copies from templates/, with the
// `_comment` provenance stripped from the package.json on the way out.
// ---------------------------------------------------------------------------

function copyPluginScaffold(repoPath) {
  const pluginDir = resolve(repoPath, 'contract-uuid-plugin');
  mkdirSync(pluginDir, { recursive: true });

  // index.js: byte-identical copy (provenance header travels with the file).
  copyFileSync(LOADER_TEMPLATE, resolve(pluginDir, 'index.js'));

  // package.json: strip `_comment` field (JSON can't host comments; provenance
  // lives only in the source template).
  const pkgRaw = JSON.parse(readFileSync(PACKAGE_TEMPLATE, 'utf8'));
  delete pkgRaw._comment;
  writeFileSync(
    resolve(pluginDir, 'package.json'),
    JSON.stringify(pkgRaw, null, 2) + '\n',
  );

  return pluginDir;
}

// ---------------------------------------------------------------------------
// Snippet preparation — strips the BOOTSTRAP-INSERT-START/END markers from
// the template so we can wrap the OUTPUT in fresh markers ourselves. This
// keeps the marker logic owned by THIS module (single source of truth for
// the find-and-replace contract).
// ---------------------------------------------------------------------------

function loadSnippetBody() {
  const raw = readFileSync(SNIPPET_TEMPLATE, 'utf8');
  // Find content BETWEEN the markers; that's the actual hook code we
  // insert. Lines outside the markers are guidance comments + usage
  // examples (not relevant to the patched config).
  const startIdx = raw.indexOf(INSERT_START);
  const endIdx = raw.indexOf(INSERT_END);
  if (startIdx < 0 || endIdx < 0) {
    throw new Error(
      `Template ${SNIPPET_TEMPLATE} is missing BOOTSTRAP-INSERT markers; ` +
      `cannot extract snippet body for installation.`,
    );
  }
  // Include the start marker + body + end marker — the markers travel
  // with the snippet so re-installs find them.
  return raw.slice(startIdx, endIdx + INSERT_END.length);
}

// ---------------------------------------------------------------------------
// next.config patcher — finds existing BOOTSTRAP-INSERT block and replaces
// it; if no block exists, injects one before the default export.
// ---------------------------------------------------------------------------

function patchNextConfig(repoPath, snippet) {
  const configFile = NEXT_CONFIG_CANDIDATES
    .map((c) => resolve(repoPath, c))
    .find((p) => existsSync(p));

  if (!configFile) {
    return {
      patched: false,
      configFile: null,
      reason: 'no next.config.{ts,js,mjs} found at repo root',
    };
  }

  const original = readFileSync(configFile, 'utf8');
  const startIdx = original.indexOf(INSERT_START);
  const endIdx = original.indexOf(INSERT_END);

  let patched;
  if (startIdx >= 0 && endIdx > startIdx) {
    // Idempotent path: replace the existing block in-place.
    patched = original.slice(0, startIdx) + snippet + original.slice(endIdx + INSERT_END.length);
  } else {
    // Fresh install: inject before the default export / module.exports.
    const exportMatch = original.match(/^(export\s+default|module\.exports)/m);
    if (exportMatch) {
      const insertAt = original.indexOf(exportMatch[0]);
      patched = original.slice(0, insertAt) + snippet + '\n\n' + original.slice(insertAt);
    } else {
      // No recognizable export — append at end with a separating newline.
      patched = original + '\n\n' + snippet + '\n';
    }
  }

  // Wire the hook into the nextConfig object. Two cases:
  //   (a) Config has NO `webpack:` field -> inject one.
  //   (b) Config has a `webpack:` field -> leave it (user must wire
  //       contractUuidWebpackHook manually if desired). The hook itself
  //       is exported from the snippet so it's importable.
  // For v1 we ALSO add the wiring for case (a) by looking for the
  // `const nextConfig: NextConfig = {` opener and injecting `webpack:
  // contractUuidWebpackHook,` if no webpack field exists.
  if (!/\bwebpack\s*:/m.test(patched)) {
    // Find the nextConfig object literal opener.
    const nextConfigMatch = patched.match(
      /const\s+nextConfig\s*:\s*NextConfig\s*=\s*\{|const\s+nextConfig\s*=\s*\{|module\.exports\s*=\s*\{/,
    );
    if (nextConfigMatch) {
      const openerEnd = patched.indexOf(nextConfigMatch[0]) + nextConfigMatch[0].length;
      // Insert `\n  webpack: contractUuidWebpackHook,` right after the opening brace.
      patched =
        patched.slice(0, openerEnd) +
        '\n  webpack: contractUuidWebpackHook,' +
        patched.slice(openerEnd);
    }
  }

  writeFileSync(configFile, patched);
  return {
    patched: true,
    configFile,
    reason: startIdx >= 0 ? 'replaced existing BOOTSTRAP-INSERT block' : 'injected fresh BOOTSTRAP-INSERT block',
  };
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

export function installBabelPlugin(repoPath) {
  const pluginDir = copyPluginScaffold(repoPath);
  const snippet = loadSnippetBody();
  const configResult = patchNextConfig(repoPath, snippet);

  return {
    pluginDir,
    nextConfig: configResult,
  };
}

// Exposed for testing.
export { copyPluginScaffold, loadSnippetBody, patchNextConfig, INSERT_START, INSERT_END };

if (import.meta.url === `file://${process.argv[1]}`) {
  const repoPath = resolve(process.argv[2] || process.cwd());
  const result = installBabelPlugin(repoPath);
  console.log(JSON.stringify(result, null, 2));
}
