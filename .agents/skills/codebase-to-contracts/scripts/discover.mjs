// scripts/discover.mjs — Stage 1 of the codebase-to-contracts pipeline.
//
// Walks $repo_path, applies the heuristic taxonomy from
// references/classification-rules.md, and emits a deterministic-UUID-stable
// nodes.json under $repo_path/.contracts/.staging/. ~85% of files classify
// by path glob + lightweight regex; ambiguous files fall through to a single
// `claude -p --json-schema schemas/classify.json` call (Pitfall 1: heuristic
// share keeps LLM cost small AND output reproducible across re-runs).
//
// Output shape (per node):
//   {
//     uuid:         deterministic UUIDv5 from (repo_name, file_path, ast_anchor)
//     kind:         UI | API | data | lib | external | job | cron | event
//     level:        L0 | L1 | L2 | L3 | L4
//     file:         repo-relative path
//     route:        '/foo' for UI, 'METHOD /api/bar' for API, null otherwise
//     candidate_lines: { start_line: 1, end_line: <eof> } — refined in Stage 4
//     parent_hint:  null at this stage; Stage 5a fills L1 anchors + flow membership
//     model_name:   for kind:data (Prisma model blocks)
//     source:       'heuristic' | 'llm-fallback'
//   }

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from 'tinyglobby';
import { deterministicUuid } from './helpers/deterministic-uuid.mjs';
import { callClaude } from './helpers/claude-cli-bridge.mjs';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = resolve(__filename, '..');

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/** Detect Next.js source root: '' (app/ at repo root) or 'src' (src/app/). */
function detectSourceRoot(repoPath) {
  if (existsSync(resolve(repoPath, 'src/app'))) return 'src';
  if (existsSync(resolve(repoPath, 'app'))) return '';
  if (existsSync(resolve(repoPath, 'src/pages'))) return 'src';
  return '';
}

/** Slug for repo-name UUIDv5 namespace — stable across cwd / absolute-path drift. */
function repoNameFromPath(repoPath) {
  const pkgPath = resolve(repoPath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (pkg.name && typeof pkg.name === 'string') return pkg.name;
    } catch { /* fall through */ }
  }
  return basename(resolve(repoPath));
}

/** Read file with size cap; returns '' for missing/oversized. */
function safeRead(absPath, maxBytes = 200 * 1024) {
  try {
    const buf = readFileSync(absPath);
    if (buf.length > maxBytes) return buf.subarray(0, maxBytes).toString('utf8');
    return buf.toString('utf8');
  } catch {
    return '';
  }
}

/** Count lines for `end_line: <eof>` placeholder in candidate_lines. */
function countLines(content) {
  if (!content) return 1;
  const lines = content.split('\n').length;
  return Math.max(1, lines);
}

/**
 * Convert a Next.js app-router file path into a route string.
 *   src/app/page.tsx                 -> '/'
 *   src/app/notes/page.tsx           -> '/notes'
 *   src/app/notes/[id]/page.tsx      -> '/notes/[id]'
 *   src/app/(auth)/login/page.tsx    -> '/login'  (group segments stripped)
 *   src/app/api/auth/login/route.ts  -> '/api/auth/login'
 */
function routeFromAppPath(filePath, sourceRoot) {
  const prefix = sourceRoot ? `${sourceRoot}/app/` : 'app/';
  let relativeRoute = filePath;
  if (relativeRoute.startsWith(prefix)) {
    relativeRoute = relativeRoute.slice(prefix.length);
  }
  // Strip /page.tsx / /route.ts / /layout.tsx
  relativeRoute = relativeRoute
    .replace(/\/page\.tsx$/, '')
    .replace(/\/route\.ts$/, '')
    .replace(/\/layout\.tsx$/, '');
  // Strip route groups: (auth) segments don't affect the URL
  relativeRoute = relativeRoute
    .split('/')
    .filter(seg => !(seg.startsWith('(') && seg.endsWith(')')))
    .join('/');
  if (!relativeRoute || relativeRoute === '') return '/';
  return '/' + relativeRoute;
}

/** Detect HTTP methods exported from an app-router route handler. */
function detectHttpMethods(source) {
  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];
  return methods.filter(m =>
    new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(source) ||
    new RegExp(`export\\s+const\\s+${m}\\b`).test(source)
  );
}

/** External-SDK detection (RESEARCH § classification-rules.md). */
const EXTERNAL_SDK_REGEX = /from\s+['"](?:stripe|@mailchimp\/[\w-]+|resend|@sendgrid\/[\w-]+|googleapis|twilio|openai|anthropic|@aws-sdk\/[\w-]+|@vercel\/postgres-kysely)/;

/** Prisma write-op detection — drives data vs lib classification for lib/*.ts. */
const PRISMA_WRITE_REGEX = /\.(?:create|update|delete|upsert|createMany|updateMany|deleteMany|executeRaw)\(/;
const PRISMA_IMPORT_REGEX = /from\s+['"]@prisma\/client['"]/;

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

export async function discover(repoPath, options = {}) {
  const sourceRoot = options.sourceRoot ?? detectSourceRoot(repoPath);
  const repoName = repoNameFromPath(repoPath);
  const prefix = sourceRoot ? `${sourceRoot}/` : '';

  // 1. Enumerate
  const files = {
    pages: await glob([`${prefix}app/**/page.tsx`], { cwd: repoPath }),
    layouts: await glob([`${prefix}app/**/layout.tsx`], { cwd: repoPath }),
    routes: await glob([`${prefix}app/api/**/route.ts`], { cwd: repoPath }),
    prisma: await glob(['prisma/schema.prisma'], { cwd: repoPath }),
    libs: await glob([`${prefix}lib/**/*.ts`], { cwd: repoPath }),
  };

  const nodes = [];

  // 2a. Pages -> UI L3 (route entry points)
  for (const page of files.pages) {
    const absPath = resolve(repoPath, page);
    const source = safeRead(absPath);
    const lines = countLines(source);
    const route = routeFromAppPath(page, sourceRoot);
    const uuid = deterministicUuid(repoName, page, 'L3:default-export');
    nodes.push({
      uuid,
      kind: 'UI',
      level: 'L3',
      file: page,
      route,
      candidate_lines: { start_line: 1, end_line: lines },
      parent_hint: null,
      source: 'heuristic',
    });

    // L4 candidates inside the page: top-level function components and named
    // const exports that match the JSX-component naming convention. Stage 4
    // refines candidate_lines to wrap the actual JSX element; Stage 1 only
    // proposes the candidate set.
    const componentRegex = /(?:function|const)\s+([A-Z]\w+)\s*[=(]/g;
    const seen = new Set();
    let m;
    while ((m = componentRegex.exec(source)) !== null) {
      const name = m[1];
      if (seen.has(name)) continue;
      seen.add(name);
      // Skip the default export (already an L3) — heuristic: skip the file's
      // own basename if it matches PascalCase, but we'd need filename+naming
      // alignment. Simpler: emit all unique components as L4 candidates;
      // Stage 4 dedups via JSX matching.
      const l4Uuid = deterministicUuid(repoName, page, `L4:component-${name}`);
      nodes.push({
        uuid: l4Uuid,
        kind: 'UI',
        level: 'L4',
        file: page,
        route: null,
        candidate_lines: { start_line: 1, end_line: lines },
        parent_hint: uuid,
        component_name: name,
        source: 'heuristic',
      });
    }
  }

  // 2b. Layouts -> UI L3 (parent route's layout)
  for (const layout of files.layouts) {
    const absPath = resolve(repoPath, layout);
    const source = safeRead(absPath);
    const lines = countLines(source);
    const uuid = deterministicUuid(repoName, layout, 'L3:default-export');
    nodes.push({
      uuid,
      kind: 'UI',
      level: 'L3',
      file: layout,
      route: routeFromAppPath(layout, sourceRoot),
      candidate_lines: { start_line: 1, end_line: lines },
      parent_hint: null,
      source: 'heuristic',
    });
  }

  // 2c. API routes -> one L3 per HTTP method exported
  for (const route of files.routes) {
    const absPath = resolve(repoPath, route);
    const source = safeRead(absPath);
    const lines = countLines(source);
    const apiPath = routeFromAppPath(route, sourceRoot);
    const methods = detectHttpMethods(source);
    if (methods.length === 0) continue; // file with no exported handlers — skip
    for (const method of methods) {
      const uuid = deterministicUuid(repoName, route, `L3:${method}`);
      nodes.push({
        uuid,
        kind: 'API',
        level: 'L3',
        file: route,
        route: `${method} ${apiPath}`,
        candidate_lines: { start_line: 1, end_line: lines },
        parent_hint: null,
        method,
        source: 'heuristic',
      });
    }
  }

  // 2d. Prisma schema -> one data L2 per `model X { ... }` block
  for (const schemaPath of files.prisma) {
    const absPath = resolve(repoPath, schemaPath);
    const source = safeRead(absPath);
    const lines = source.split('\n');
    const modelRegex = /^\s*model\s+(\w+)\s*\{/;
    let inModel = null;
    let modelStart = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!inModel) {
        const match = line.match(modelRegex);
        if (match) {
          inModel = match[1];
          modelStart = i + 1;
        }
      } else if (line.trim() === '}') {
        const uuid = deterministicUuid(repoName, schemaPath, `L2:model-${inModel}`);
        nodes.push({
          uuid,
          kind: 'data',
          level: 'L2',
          file: schemaPath,
          route: null,
          candidate_lines: { start_line: modelStart, end_line: i + 1 },
          parent_hint: null,
          model_name: inModel,
          source: 'heuristic',
        });
        inModel = null;
      }
    }
  }

  // 2e. lib/**/*.ts -> kind dispatch (external / data / lib) + level by size
  const ambiguous = [];
  for (const lib of files.libs) {
    const absPath = resolve(repoPath, lib);
    const source = safeRead(absPath);
    const lines = countLines(source);
    const sizeBytes = source.length;

    const isExternal = EXTERNAL_SDK_REGEX.test(source);
    const importsPrisma = PRISMA_IMPORT_REGEX.test(source);
    const hasPrismaWrites = importsPrisma && PRISMA_WRITE_REGEX.test(source);

    // Conflict: imports BOTH external SDK AND @prisma/client with writes.
    // -> defer to LLM fallback (e.g. lib/billing.ts that calls Stripe AND
    //    persists subscription rows).
    if (isExternal && hasPrismaWrites) {
      ambiguous.push({ file: lib, source, reason: 'external+prisma-writes' });
      continue;
    }

    let kind, level;
    if (isExternal) {
      kind = 'external';
      level = 'L3';
    } else if (hasPrismaWrites) {
      kind = 'data';
      level = 'L3';
    } else if (importsPrisma) {
      // Prisma reads only — query helper.
      kind = 'lib';
      level = sizeBytes < 3000 ? 'L2' : 'L3';
    } else {
      kind = 'lib';
      // ~100-line threshold (≈3KB). Land within ±10% (2700-3300) -> ambiguous.
      if (sizeBytes >= 2700 && sizeBytes <= 3300) {
        ambiguous.push({ file: lib, source, reason: 'lib-size-near-threshold' });
        continue;
      }
      level = sizeBytes < 3000 ? 'L2' : 'L3';
    }

    const uuid = deterministicUuid(repoName, lib, `${level}:default-export`);
    nodes.push({
      uuid,
      kind,
      level,
      file: lib,
      route: null,
      candidate_lines: { start_line: 1, end_line: lines },
      parent_hint: null,
      source: 'heuristic',
    });
  }

  // 3. LLM fallback for ambiguous files (one call per file). Skipped silently
  // in test mode (BOOTSTRAP_TEST_MODE=1) — callClaude returns {} which we
  // treat as low-confidence and skip the node.
  if (ambiguous.length > 0 && process.env.BOOTSTRAP_TEST_MODE !== '1') {
    const classifyPromptPath = resolve(SCRIPT_DIR, '../prompts/classify-atom.txt');
    const classifySchemaPath = resolve(SCRIPT_DIR, '../schemas/classify.json');
    const systemPrompt = existsSync(classifyPromptPath) ? readFileSync(classifyPromptPath, 'utf8') : '';

    for (const item of ambiguous) {
      try {
        const result = await callClaude({
          schemaPath: classifySchemaPath,
          systemPrompt,
          userPrompt: `Classify this file. Heuristic conflict: ${item.reason}.\n\nFile: ${item.file}\n\nSource (first 5000 chars):\n\`\`\`typescript\n${item.source.slice(0, 5000)}\n\`\`\``,
        });
        const out = result.structured_output || {};
        if (typeof out.confidence === 'number' && out.confidence >= 0.6 && out.kind && out.level) {
          const uuid = deterministicUuid(repoName, item.file, 'llm-classified');
          nodes.push({
            uuid,
            kind: out.kind,
            level: out.level,
            file: item.file,
            route: null,
            candidate_lines: { start_line: 1, end_line: countLines(item.source) },
            parent_hint: null,
            confidence: out.confidence,
            source: 'llm-fallback',
          });
        }
        // else: low-confidence -> log and skip (caller can re-run with hints)
      } catch (err) {
        // Don't halt the whole run on a single LLM failure.
        process.stderr.write(`[discover] llm-fallback failed for ${item.file}: ${err.message}\n`);
      }
    }
  }

  // 4. Sort for deterministic output (stable across runs).
  nodes.sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.level !== b.level) return a.level < b.level ? -1 : 1;
    return a.uuid < b.uuid ? -1 : 1;
  });

  // 5. Write to .staging/
  const stagingDir = resolve(repoPath, '.contracts/.staging');
  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(resolve(stagingDir, 'nodes.json'), JSON.stringify(nodes, null, 2) + '\n');
  writeFileSync(resolve(stagingDir, '_progress.json'), JSON.stringify({
    stage: 1,
    stage_1_completed_at: new Date().toISOString(),
    node_count: nodes.length,
    source_root: sourceRoot,
    repo_name: repoName,
  }, null, 2) + '\n');

  console.log(`Stage 1 complete: ${nodes.length} candidate nodes written to ${relative(repoPath, resolve(stagingDir, 'nodes.json'))}`);
  return nodes;
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const repoPath = resolve(process.argv[2] || process.cwd());
  discover(repoPath).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
