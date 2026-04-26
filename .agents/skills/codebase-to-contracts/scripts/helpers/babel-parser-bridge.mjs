// scripts/helpers/babel-parser-bridge.mjs
//
// Loads @babel/parser + @babel/traverse via a 3-tier resolution strategy.
//
// Tier 1 (preferred): Skill's own bundled deps (Task 1 installed them).
//                     Known-good versions; always present at clone time.
// Tier 2 (fallback):  Target repo's node_modules (in case the skill bundle
//                     was tampered with or stripped).
// Tier 3 (deepest):   Target repo's pnpm virtual store. Mirrors the
//                     resolvePnpmDep() function from
//                     contract-ide-demo/contract-uuid-plugin/index.js
//                     (verbatim pattern — Phase 9 verified it works).

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const requireFromHere = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));

function tryResolveSkillBundled(pkgName) {
  try {
    return requireFromHere.resolve(pkgName);
  } catch (_) {
    return null;
  }
}

function tryResolveTargetNodeModules(pkgName, targetRoot) {
  try {
    return requireFromHere.resolve(pkgName, { paths: [targetRoot] });
  } catch (_) {
    return null;
  }
}

// Mirrors resolvePnpmDep() from contract-ide-demo/contract-uuid-plugin/index.js
// (Phase 9 spike — pnpm-store-fallback resolution).
function tryResolveTargetPnpmStore(pkgName, targetRoot) {
  // pnpm hoist directory.
  const hoist = path.join(targetRoot, 'node_modules', '.pnpm', 'node_modules');
  try {
    return requireFromHere.resolve(pkgName, { paths: [hoist] });
  } catch (_) {}
  // Walk the virtual store for matching entries.
  const storeDir = path.join(targetRoot, 'node_modules', '.pnpm');
  try {
    const entries = fs.readdirSync(storeDir).filter((e) =>
      e.startsWith(pkgName.replace('@', '').replace('/', '+'))
    );
    for (const entry of entries) {
      try {
        return requireFromHere.resolve(pkgName, {
          paths: [path.join(storeDir, entry, 'node_modules')],
        });
      } catch (_) {}
    }
  } catch (_) {}
  return null;
}

async function resolveBabelDep(pkgName, targetRoot) {
  const path1 = tryResolveSkillBundled(pkgName);
  if (path1) return path1;
  if (targetRoot) {
    const path2 = tryResolveTargetNodeModules(pkgName, targetRoot);
    if (path2) return path2;
    const path3 = tryResolveTargetPnpmStore(pkgName, targetRoot);
    if (path3) return path3;
  }
  throw new Error(
    `babel-parser-bridge: could not resolve ${pkgName} via skill-bundled, target-node_modules, or target-pnpm-store. targetRoot=${targetRoot} skillDir=${HERE}`
  );
}

/**
 * Load Babel toolchain (parser + traverse) for a target repo.
 *
 * @param {string} targetRepoRoot — absolute path to the target repo
 * @returns {Promise<{ parse: Function, traverse: Function }>}
 */
export async function loadBabel(targetRepoRoot) {
  const parserPath = await resolveBabelDep('@babel/parser', targetRepoRoot);
  const traversePath = await resolveBabelDep('@babel/traverse', targetRepoRoot);

  const parserMod = await import(parserPath);
  const traverseMod = await import(traversePath);

  // @babel/traverse exports default-on-CJS; normalize to a plain function.
  const traverse =
    typeof traverseMod.default === 'function'
      ? traverseMod.default
      : typeof traverseMod.default?.default === 'function'
        ? traverseMod.default.default
        : traverseMod;

  const parse = parserMod.parse ?? parserMod.default?.parse;

  return { parse, traverse };
}
