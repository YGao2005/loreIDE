// scripts/derive-frontmatter.mjs — Stage 2 of the bootstrap pipeline.
//
// Reads .staging/nodes.json (Stage 1 output), derives a complete YAML
// frontmatter per node via `claude -p --output-format json --json-schema
// schemas/frontmatter.json`, and writes one .staging/<uuid>.frontmatter.json
// per node. Hash-skip: nodes whose source file's sha256 matches the
// previously-derived `_source_sha256` marker reuse the existing frontmatter
// (Pitfall 1 mitigation — model drift).
//
// Concurrency: 5 parallel claude -p calls (claude CLI tolerates this; higher
// risks rate-limit). temperature: 0 + model pinned via BOOTSTRAP_CLAUDE_MODEL
// env var (default claude-sonnet-4-6) for re-run determinism.
//
// Output is staging-only — Stage 5b (Plan 14-05) atomically promotes to
// .contracts/.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { callClaude } from './helpers/claude-cli-bridge.mjs';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = resolve(__filename, '..');

const DEFAULT_CONCURRENCY = 5;
const SOURCE_HASH_FIELD = '_source_sha256';

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Build the candidate -> bootstrap frontmatter object that the LLM should
 * mostly preserve. We pre-fill all schema fields with their bootstrap
 * defaults so even a degenerate LLM response (or test-mode {} short-circuit)
 * yields a valid sidecar shape. The LLM's job is to confirm + occasionally
 * refine code_ranges; everything else is mechanical.
 *
 * If the schema's required[] grows in the future, add the new field here so
 * the bootstrap output stays valid even when the LLM omits it.
 */
function bootstrapFrontmatter(node) {
  return {
    format_version: 3,
    uuid: node.uuid,
    kind: node.kind,
    level: node.level,
    parent: node.parent_hint ?? null,
    neighbors: [],
    code_ranges: [{
      file: node.file,
      start_line: node.candidate_lines?.start_line ?? 1,
      end_line: node.candidate_lines?.end_line ?? 1,
    }],
    code_hash: null,
    contract_hash: null,
    human_pinned: false,
    route: node.route ?? null,
    derived_at: null,
    section_hashes: {},
    rollup_inputs: [],
    rollup_hash: null,
    rollup_state: 'untracked',
    rollup_generation: 0,
  };
}

/**
 * Merge LLM output onto the bootstrap defaults. The LLM may return a partial
 * object or a full one; either way, we preserve uuid/kind/level/route from
 * Stage 1 (the LLM is not authoritative on those) and accept the LLM's
 * code_ranges if they look well-shaped.
 */
function mergeFrontmatter(bootstrap, llmOut) {
  if (!llmOut || typeof llmOut !== 'object') return bootstrap;
  const merged = { ...bootstrap };
  // Accept narrowed code_ranges from the LLM if it returned a non-empty,
  // well-shaped array.
  if (Array.isArray(llmOut.code_ranges) && llmOut.code_ranges.length > 0) {
    const valid = llmOut.code_ranges.every(r =>
      r && typeof r.file === 'string' && Number.isInteger(r.start_line) && Number.isInteger(r.end_line)
    );
    if (valid) merged.code_ranges = llmOut.code_ranges;
  }
  // Authoritative-from-Stage-1 fields are NEVER overridden by the LLM.
  // Everything else stays at the bootstrap default (null / [] / {} / etc.).
  return merged;
}

export async function deriveFrontmatter(repoPath, options = {}) {
  const stagingDir = resolve(repoPath, '.contracts/.staging');
  const nodesJsonPath = resolve(stagingDir, 'nodes.json');
  if (!existsSync(nodesJsonPath)) {
    throw new Error(`Stage 1 has not been run. Expected ${nodesJsonPath}. Run discover.mjs first.`);
  }
  const nodes = JSON.parse(readFileSync(nodesJsonPath, 'utf8'));

  const promptPath = resolve(SCRIPT_DIR, '../prompts/derive-frontmatter.txt');
  const schemaPath = resolve(SCRIPT_DIR, '../schemas/frontmatter.json');
  const systemPrompt = existsSync(promptPath) ? readFileSync(promptPath, 'utf8') : '';

  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

  // Hash-skip eligibility: node needs derivation if either no prior
  // frontmatter exists OR the stored source sha256 doesn't match current.
  let derived = 0;
  let skipped = 0;
  const eligible = [];
  for (const node of nodes) {
    const sourcePath = resolve(repoPath, node.file);
    if (!existsSync(sourcePath)) continue; // file deleted between stages — ignore
    const fmPath = resolve(stagingDir, `${node.uuid}.frontmatter.json`);
    const sourceHash = sha256(readFileSync(sourcePath));
    if (existsSync(fmPath)) {
      try {
        const existing = JSON.parse(readFileSync(fmPath, 'utf8'));
        if (existing[SOURCE_HASH_FIELD] === sourceHash) {
          skipped += 1;
          continue;
        }
      } catch { /* corrupt — re-derive */ }
    }
    eligible.push({ node, sourcePath, sourceHash });
  }

  console.log(`Stage 2: ${eligible.length}/${nodes.length} nodes need (re-)derivation (${skipped} hash-skipped)`);

  // Parallel batched processing
  for (let i = 0; i < eligible.length; i += concurrency) {
    const batch = eligible.slice(i, i + concurrency);
    await Promise.all(batch.map(async ({ node, sourcePath, sourceHash }) => {
      const sourceContent = readFileSync(sourcePath, 'utf8');
      const userPrompt = `Generate frontmatter for this candidate node.

Candidate (Stage 1 output):
${JSON.stringify(node, null, 2)}

File path (relative): ${node.file}

Source contents (first 5000 chars):
\`\`\`typescript
${sourceContent.slice(0, 5000)}
\`\`\`

Output the frontmatter as structured JSON per the schema.`;

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
        process.stderr.write(`[derive-frontmatter] LLM failure for ${node.uuid} (${node.file}): ${err.message}\n`);
        // Fall through with llmOut=null -> bootstrap defaults stand.
      }

      const fm = mergeFrontmatter(bootstrapFrontmatter(node), llmOut);
      // Tag with source sha256 for next-run hash-skip. Stripped before final
      // emit in Stage 5b — it's a staging-only marker.
      fm[SOURCE_HASH_FIELD] = sourceHash;

      writeFileSync(
        resolve(stagingDir, `${node.uuid}.frontmatter.json`),
        JSON.stringify(fm, null, 2) + '\n'
      );
      derived += 1;
    }));

    const completedBatch = Math.min(i + concurrency, eligible.length);
    if (eligible.length > 0) {
      process.stderr.write(`  Stage 2 progress: ${completedBatch}/${eligible.length}\n`);
    }
  }

  // Update _progress.json
  const progressPath = resolve(stagingDir, '_progress.json');
  let progress = {};
  if (existsSync(progressPath)) {
    try { progress = JSON.parse(readFileSync(progressPath, 'utf8')); } catch { /* ignore */ }
  }
  progress.stage = 2;
  progress.stage_2_completed_at = new Date().toISOString();
  progress.stage_2_derived_count = derived;
  progress.stage_2_skipped_count = skipped;
  writeFileSync(progressPath, JSON.stringify(progress, null, 2) + '\n');

  console.log(`Stage 2 complete: ${derived} frontmatter files written, ${skipped} hash-skipped`);
  return { derived, skipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repoPath = resolve(process.argv[2] || process.cwd());
  deriveFrontmatter(repoPath).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
