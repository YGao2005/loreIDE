// scripts/derive-body.mjs — Stage 3 of the bootstrap pipeline.
//
// For every node in .staging/nodes.json, derive the structured BODY of
// the contract sidecar (## Intent / ## Role + per-kind sections) via
// `claude -p --output-format json --json-schema schemas/contract-body.json`.
// Output: one .staging/<uuid>.body.json per node.
//
// Per-kind branching is driven by the system prompt + JSON schema; the
// schema enforces minLength on intent/role and requires inputs/outputs/
// side_effects on backend kinds. The renderer (Plan 14-05) composes the
// final markdown body from this JSON.
//
// Concurrency: nodes are GROUPED BY L3 SURFACE (parent_hint or self for
// L3 nodes) so a page.tsx and its child L4 atoms get derived together
// for context coherence. Groups run in parallel at concurrency 5.
//
// Hash-skip: per-node skip if .staging/<uuid>.body.json already exists
// AND _progress.json.stage_3_completed_for includes the uuid.
//
// CLI: node derive-body.mjs <repo-path> [--sample=N]
//   --sample=N  process only the first N nodes spanning UI L3 / UI L4 /
//               backend (used by the Plan 14-04 Task 3 prompt-iteration
//               loop — fast, cheap iteration without firing the full
//               pipeline).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callClaude } from './helpers/claude-cli-bridge.mjs';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(__filename);

const DEFAULT_CONCURRENCY = 5;

// ---------------------------------------------------------------------------
// Prompt assembly — interpolate the 4 verbatim exemplars into the template.
// ---------------------------------------------------------------------------

export function buildSystemPrompt() {
  const promptDir = resolve(SCRIPT_DIR, '../prompts');
  const template = readFileSync(resolve(promptDir, 'derive-body.txt'), 'utf8');
  const exemplars = {
    '{{EXEMPLAR_API}}': readFileSync(resolve(promptDir, 'exemplars/api-account-delete.md'), 'utf8'),
    '{{EXEMPLAR_LIB}}': readFileSync(resolve(promptDir, 'exemplars/lib-begin-account-deletion.md'), 'utf8'),
    '{{EXEMPLAR_UI_L3}}': readFileSync(resolve(promptDir, 'exemplars/ui-l3-account-settings.md'), 'utf8'),
    '{{EXEMPLAR_UI_L4}}': readFileSync(resolve(promptDir, 'exemplars/ui-l4-danger-zone.md'), 'utf8'),
  };
  return Object.entries(exemplars).reduce(
    (acc, [token, content]) => acc.replaceAll(token, content),
    template,
  );
}

// ---------------------------------------------------------------------------
// Bootstrap-defaults: degenerate LLM output (or BOOTSTRAP_TEST_MODE=1) still
// yields a schema-valid body shape. The downstream prose-quality gate (Task 3)
// catches "this passes the schema but reads generic" cases — but we want every
// pipeline run to produce a writable file even on LLM hiccups.
// ---------------------------------------------------------------------------

const PLACEHOLDER_INTENT = '(intent not yet derived — re-run Stage 3 with a non-test claude session to fill this section with substantive prose at Phase 9 exemplar density)';
const PLACEHOLDER_ROLE = '(role not yet derived — re-run Stage 3 to fill)';

function bootstrapBody(node) {
  const body = {
    kind: node.kind,
    level: node.level,
    intent: PLACEHOLDER_INTENT,
    role: PLACEHOLDER_ROLE,
  };
  const isBackend = ['API', 'lib', 'data', 'external', 'job', 'cron', 'event'].includes(node.kind);
  if (isBackend) {
    body.inputs = [`(input not yet derived for ${node.file})`];
    body.outputs = [`(output not yet derived for ${node.file})`];
    body.side_effects = [];
  }
  if (node.kind === 'UI' && node.level === 'L4') {
    body.examples = [];
  }
  return body;
}

function mergeBody(bootstrap, llmOut) {
  if (!llmOut || typeof llmOut !== 'object' || Object.keys(llmOut).length === 0) {
    return bootstrap;
  }
  const merged = { ...bootstrap };
  for (const key of ['intent', 'role', 'notes']) {
    if (typeof llmOut[key] === 'string' && llmOut[key].length > 0) merged[key] = llmOut[key];
  }
  for (const key of ['inputs', 'outputs', 'side_effects', 'examples']) {
    if (Array.isArray(llmOut[key])) merged[key] = llmOut[key];
  }
  // Authoritative-from-Stage-1 fields are NEVER overridden:
  merged.kind = bootstrap.kind;
  merged.level = bootstrap.level;
  return merged;
}

// ---------------------------------------------------------------------------
// Sample selection for the prompt-iteration loop (--sample=N).
// Picks N nodes spanning UI L3 / UI L4 / backend so Yang reviews coverage
// across all kind branches in a single iteration.
// ---------------------------------------------------------------------------

function pickSample(nodes, n) {
  const picked = [];
  const wantUiL3 = nodes.find(x => x.kind === 'UI' && x.level === 'L3');
  const wantUiL4 = nodes.find(x => x.kind === 'UI' && x.level === 'L4');
  const wantBackend = nodes.find(x => ['API', 'lib', 'data', 'external', 'job', 'cron', 'event'].includes(x.kind));
  for (const candidate of [wantUiL3, wantUiL4, wantBackend]) {
    if (candidate && !picked.includes(candidate)) picked.push(candidate);
    if (picked.length >= n) break;
  }
  // Pad with any remaining nodes if the caller requested more than the
  // 3-kind spread provides.
  for (const node of nodes) {
    if (picked.length >= n) break;
    if (!picked.includes(node)) picked.push(node);
  }
  return picked.slice(0, n);
}

// ---------------------------------------------------------------------------
// Group nodes by L3 surface for context-coherent batching. UI L4 atoms
// share their parent's L3 group; everything else groups by self-uuid.
// ---------------------------------------------------------------------------

function groupByL3Surface(nodes) {
  const groups = new Map();
  for (const node of nodes) {
    const key = node.parent_hint || node.uuid;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(node);
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// Per-node derivation.
// ---------------------------------------------------------------------------

async function deriveOne(node, repoPath, stagingDir, systemPrompt, schemaPath) {
  const sourcePath = resolve(repoPath, node.file);
  if (!existsSync(sourcePath)) return null;
  const sourceContent = readFileSync(sourcePath, 'utf8');

  const userPrompt = `Derive the contract body for this node.

Stage 1+2 node descriptor:
${JSON.stringify(node, null, 2)}

File path (relative): ${node.file}

Source contents (first 5000 chars):
\`\`\`typescript
${sourceContent.slice(0, 5000)}
\`\`\`

Output the contract body as structured JSON per the schema. Match the
prose density of the four exemplars in the system prompt.`;

  let llmOut = null;
  try {
    const result = await callClaude({
      schemaPath,
      systemPrompt,
      userPrompt,
      temperature: 0,
      allowedTools: ['Read'],
    });
    llmOut = result.structured_output;
  } catch (err) {
    process.stderr.write(`[derive-body] LLM failure for ${node.uuid} (${node.file}): ${err.message}\n`);
  }

  const body = mergeBody(bootstrapBody(node), llmOut);
  writeFileSync(
    resolve(stagingDir, `${node.uuid}.body.json`),
    JSON.stringify(body, null, 2) + '\n',
  );
  return body;
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

export async function deriveBody(repoPath, options = {}) {
  const stagingDir = resolve(repoPath, '.contracts/.staging');
  const nodesJsonPath = resolve(stagingDir, 'nodes.json');
  if (!existsSync(nodesJsonPath)) {
    throw new Error(`Stage 1 has not been run. Expected ${nodesJsonPath}. Run discover.mjs first.`);
  }

  let nodes = JSON.parse(readFileSync(nodesJsonPath, 'utf8'));
  if (options.sampleN && options.sampleN > 0) {
    nodes = pickSample(nodes, options.sampleN);
    console.log(`Stage 3 (--sample=${options.sampleN}): ${nodes.length} nodes selected for prompt-iteration loop`);
  }

  const systemPrompt = buildSystemPrompt();
  const schemaPath = resolve(SCRIPT_DIR, '../schemas/contract-body.json');
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

  // Hash-skip via _progress.json.stage_3_completed_for set.
  const progressPath = resolve(stagingDir, '_progress.json');
  let progress = {};
  if (existsSync(progressPath)) {
    try { progress = JSON.parse(readFileSync(progressPath, 'utf8')); } catch { /* ignore */ }
  }
  const completedSet = new Set(progress.stage_3_completed_for || []);

  const eligible = [];
  let skipped = 0;
  for (const node of nodes) {
    const bodyPath = resolve(stagingDir, `${node.uuid}.body.json`);
    if (existsSync(bodyPath) && completedSet.has(node.uuid)) {
      skipped += 1;
      continue;
    }
    eligible.push(node);
  }

  console.log(`Stage 3: ${eligible.length}/${nodes.length} nodes need body derivation (${skipped} skipped)`);

  // Group by L3 surface, then process groups in parallel batches of `concurrency`.
  // Within a group, nodes are processed in parallel too (small group sizes).
  const groups = groupByL3Surface(eligible);

  let derived = 0;
  for (let i = 0; i < groups.length; i += concurrency) {
    const batch = groups.slice(i, i + concurrency);
    await Promise.all(batch.map(async (group) => {
      // Per-group sequential to keep context coherent (page.tsx first, then atoms).
      for (const node of group) {
        const result = await deriveOne(node, repoPath, stagingDir, systemPrompt, schemaPath);
        if (result) {
          derived += 1;
          completedSet.add(node.uuid);
        }
      }
    }));
    process.stderr.write(`  Stage 3 progress: ${Math.min(i + concurrency, groups.length)}/${groups.length} groups\n`);
  }

  progress.stage = Math.max(progress.stage || 0, 3);
  progress.stage_3_completed_at = new Date().toISOString();
  progress.stage_3_derived_count = derived;
  progress.stage_3_completed_for = [...completedSet];
  writeFileSync(progressPath, JSON.stringify(progress, null, 2) + '\n');

  console.log(`Stage 3 complete: ${derived} body files written, ${skipped} skipped`);
  return { derived, skipped };
}

// ---------------------------------------------------------------------------
// CLI entry — supports --sample=N for the Task 3 prompt-iteration loop.
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const repoPath = resolve(process.argv[2] || process.cwd());
  const sampleArg = process.argv.find(a => a.startsWith('--sample='));
  const sampleN = sampleArg ? parseInt(sampleArg.split('=')[1], 10) : null;
  deriveBody(repoPath, { sampleN }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
