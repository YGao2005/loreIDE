// scripts/emit.mjs — Stage 5b atomic emit + Babel install + validator gate.
//
// The closing step of the bootstrap pipeline. Composes per-node markdown
// sidecars from the .staging/ JSON intermediates (frontmatter.json + body.json),
// installs the Babel plugin scaffold into the target repo (idempotent),
// runs the validator gate, and ONLY on validator-pass atomically promotes
// the .staging/ tree to .contracts/.
//
// On any validator failure: process.exit(1) + diagnostic output. .contracts/
// remains untouched (cardinal: never let a bad state leak past the gate).
//
// Atomicity: composed .md files are written under .staging/ first; staging
// JSON intermediates are archived to .contracts/.bootstrap-staging-archive/
// (so rerunners can debug); only AFTER the validator passes do the .md
// files move up to .contracts/. The move is one rename per file (atomic
// per-file but the directory transition is best-effort consistent — we
// document the order in the inline comments so recovery is mechanical).

import {
  existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, renameSync, rmSync, statSync,
} from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFrontmatter } from './helpers/frontmatter-writer.mjs';
import { installBabelPlugin } from './install-babel-plugin.mjs';
import { validate } from './validate.mjs';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(__filename);

// Staging-only frontmatter fields (e.g., _source_sha256) get stripped on the
// way out so emitted .md files are clean.
const STAGING_ONLY_FIELDS = new Set(['_source_sha256']);

// ---------------------------------------------------------------------------
// Markdown body composition — render structured body.json into the canonical
// section order: ## Intent / ## Role / ## Inputs / ## Outputs / ## Side
// effects / ## Examples / ## Notes. Section headers are emitted only when
// the field is present (UI L3 doesn't get Inputs/Outputs; pure libs may
// have empty side_effects: []).
// ---------------------------------------------------------------------------

function composeMarkdownBody(body, fm) {
  const sections = [];
  if (typeof body.intent === 'string' && body.intent.length > 0) {
    sections.push(`## Intent\n${body.intent}`);
  }
  if (typeof body.role === 'string' && body.role.length > 0) {
    sections.push(`## Role\n${body.role}`);
  }
  // Backend kinds → Inputs / Outputs / Side effects.
  if (Array.isArray(body.inputs)) {
    const lines = body.inputs.length > 0
      ? body.inputs.map((i) => `- ${i}`).join('\n')
      : '- (none yet — populated by Phase 6 derivation)';
    sections.push(`## Inputs\n${lines}`);
  }
  if (Array.isArray(body.outputs)) {
    const lines = body.outputs.length > 0
      ? body.outputs.map((o) => `- ${o}`).join('\n')
      : '- (none yet — populated by Phase 6 derivation)';
    sections.push(`## Outputs\n${lines}`);
  }
  if (Array.isArray(body.side_effects)) {
    const lines = body.side_effects.length > 0
      ? body.side_effects.map((s) => `- ${s}`).join('\n')
      : '- (none — pure operation)';
    sections.push(`## Side effects\n${lines}`);
  }
  // UI L4 atoms → Examples (may be empty array).
  if (Array.isArray(body.examples) && fm.kind === 'UI' && fm.level === 'L4') {
    const lines = body.examples.length > 0
      ? body.examples.join('\n\n')
      : '(none yet — populated by Phase 6 derivation)';
    sections.push(`## Examples\n${lines}`);
  }
  // Flow contracts → Notes (numbered invocation walkthrough).
  if (typeof body.notes === 'string' && body.notes.length > 0) {
    sections.push(`## Notes\n${body.notes}`);
  }
  return sections.join('\n\n') + '\n';
}

// ---------------------------------------------------------------------------
// Frontmatter cleanup — strip staging-only fields and fields with `null`
// values when the schema allows them to be absent (we keep null-required
// fields like `parent` so the schema's required[] passes; only optional
// fields with no value get stripped).
// ---------------------------------------------------------------------------

function cleanFrontmatter(fmRaw) {
  const fm = {};
  for (const [k, v] of Object.entries(fmRaw)) {
    if (STAGING_ONLY_FIELDS.has(k)) continue;
    fm[k] = v;
  }
  return fm;
}

// ---------------------------------------------------------------------------
// Compose phase: walk staging JSON intermediates, write .md sidecars under
// .staging/ (alongside the .json files until the atomic rename happens).
// ---------------------------------------------------------------------------

function composeAllSidecars(stagingDir) {
  const fmFiles = readdirSync(stagingDir).filter((f) => f.endsWith('.frontmatter.json'));
  let composed = 0;
  for (const fmFile of fmFiles) {
    const uuid = fmFile.replace(/\.frontmatter\.json$/, '');
    const fmRaw = JSON.parse(readFileSync(resolve(stagingDir, fmFile), 'utf8'));
    const fm = cleanFrontmatter(fmRaw);

    const bodyPath = resolve(stagingDir, `${uuid}.body.json`);
    const body = existsSync(bodyPath)
      ? JSON.parse(readFileSync(bodyPath, 'utf8'))
      : { intent: '(body missing — re-run Stage 3 to populate)', role: '(role missing — re-run Stage 3)' };

    const mdBody = composeMarkdownBody(body, fm);
    const sidecarPath = resolve(stagingDir, `${uuid}.md`);
    writeFileSync(sidecarPath, writeFrontmatter(fm, mdBody));
    composed += 1;
  }
  return composed;
}

// ---------------------------------------------------------------------------
// Atomic move — promote .staging/<uuid>.md files to .contracts/<uuid>.md
// AFTER the validator gate has passed. Staging .json intermediates are
// archived under .contracts/.bootstrap-staging-archive/ for rerunners.
// ---------------------------------------------------------------------------

function archiveStagingJson(stagingDir, archiveDir) {
  mkdirSync(archiveDir, { recursive: true });
  let archived = 0;
  for (const file of readdirSync(stagingDir)) {
    if (file.endsWith('.json')) {
      renameSync(resolve(stagingDir, file), resolve(archiveDir, file));
      archived += 1;
    }
  }
  return archived;
}

function promoteStagingMd(stagingDir, finalDir) {
  mkdirSync(finalDir, { recursive: true });
  let promoted = 0;
  for (const file of readdirSync(stagingDir)) {
    if (file.endsWith('.md')) {
      renameSync(resolve(stagingDir, file), resolve(finalDir, file));
      promoted += 1;
    }
  }
  return promoted;
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

export async function emit(repoPath, options = {}) {
  const stagingDir = resolve(repoPath, '.contracts/.staging');
  const finalDir = resolve(repoPath, '.contracts');
  const archiveDir = resolve(repoPath, '.contracts/.bootstrap-staging-archive');

  if (!existsSync(stagingDir)) {
    throw new Error(`Staging directory missing: ${stagingDir}. Run earlier stages first.`);
  }

  // Refuse to clobber an existing populated .contracts/ tree (separate
  // from .staging/). For v1, error out if the user already has sidecars.
  if (existsSync(finalDir)) {
    const existingSidecars = readdirSync(finalDir)
      .filter((f) => f.endsWith('.md') && !f.startsWith('.'));
    if (existingSidecars.length > 0 && !options.allowClobber) {
      const errMsg = `.contracts/ already has ${existingSidecars.length} sidecars at ${finalDir}. ` +
        `Aborting to avoid clobber. Move .contracts/ aside (mv .contracts/ .contracts.bak/) and retry, ` +
        `or pass { allowClobber: true } to overwrite.`;
      if (options.throwOnError) throw new Error(errMsg);
      process.stderr.write(`[emit] ${errMsg}\n`);
      process.exit(1);
    }
  }

  // 1. Compose .md sidecars under .staging/.
  const composed = composeAllSidecars(stagingDir);
  console.log(`[emit] Composed ${composed} sidecars in .staging/`);

  // 2. Install the Babel plugin (idempotent — replaces existing
  //    BOOTSTRAP-INSERT block; never appends a duplicate).
  const pluginResult = installBabelPlugin(repoPath);
  console.log(`[emit] Babel plugin: ${JSON.stringify(pluginResult.nextConfig)}`);

  // 3. Validator gate. If validate.mjs returns !ok, REFUSE to promote
  //    staging to .contracts/. The .staging/ tree stays in place so the
  //    user can inspect, fix, and re-run.
  const validation = validate(repoPath);
  if (!validation.ok) {
    process.stderr.write(`[emit] Validation FAILED (source: ${validation.source}). .staging/ NOT promoted to .contracts/.\n`);
    for (const err of validation.errors) process.stderr.write(`  - ${err}\n`);
    if (options.throwOnError) throw new Error(`Validation failed: ${validation.errors.length} errors`);
    process.exit(1);
  }
  console.log(`[emit] Validation OK (source: ${validation.source})`);

  // 4. Archive staging JSON intermediates (before promoting .md files —
  //    keeps the staging dir slim for the final rename).
  const archivedJsonCount = archiveStagingJson(stagingDir, archiveDir);
  console.log(`[emit] Archived ${archivedJsonCount} staging JSON files to ${archiveDir}`);

  // 5. Promote .staging/*.md → .contracts/*.md.
  const promoted = promoteStagingMd(stagingDir, finalDir);
  console.log(`[emit] Promoted ${promoted} sidecars to ${finalDir}`);

  // 6. Cleanup the now-empty .staging/ directory. Best-effort — if it
  //    can't be removed (Windows file locks, etc.), the next run's
  //    pre-flight will detect and prompt.
  try {
    const remaining = readdirSync(stagingDir);
    if (remaining.length === 0) rmSync(stagingDir, { recursive: true, force: true });
  } catch { /* ignore */ }

  return {
    composed,
    pluginInstalled: true,
    validatorSource: validation.source,
    archivedJsonCount,
    promoted,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repoPath = resolve(process.argv[2] || process.cwd());
  emit(resolve(repoPath)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
