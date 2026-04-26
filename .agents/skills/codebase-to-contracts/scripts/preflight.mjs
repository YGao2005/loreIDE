// scripts/preflight.mjs
//
// Stage 0 — runs BEFORE Stage 1 (discover) and Stage 2 (derive-frontmatter)
// fire any LLM calls. Verifies the target repo shape, detects prior staging
// (resume / restart / abort), enforces a hard 500-.tsx ceiling, and surfaces
// a soft cost estimate via stdin readline prompt before the LLM batch runs.
//
// Pitfall 5 mitigation (RESEARCH § Pitfall 5): truly absurd repos fail loud
// up front, and an opt-in cost prompt fires for repos whose estimate exceeds
// $5.00 so we don't burn 100x what the user expected.

import { existsSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { glob } from 'tinyglobby';

const COST_PER_NODE_USD = 0.05;          // empirical, per RESEARCH § Pitfall 5
const STAGE_MULTIPLIER = 2;              // Stage 1 (cheap) + Stage 2 (LLM-heavy)
const NODES_PER_FILE_ESTIMATE = 1.5;     // rough — pages spawn extra L4 atoms
const HARD_CEILING_TSX = 500;            // RESEARCH § Pitfall 5 hard ceiling
const SOFT_COST_THRESHOLD_USD = 5.0;     // surface prompt above this

/**
 * Quick yes/no prompt over stdin/stdout. In test mode (BOOTSTRAP_TEST_MODE=1)
 * or when stdin isn't a TTY, default to `yes` to avoid hanging headless runs.
 */
async function ask(question, { defaultYes = false } = {}) {
  if (process.env.BOOTSTRAP_TEST_MODE === '1') return defaultYes;
  if (!input.isTTY) return defaultYes;
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

/**
 * Three-way prompt for prior-staging detection. Returns 'resume' | 'restart' |
 * 'abort'. Defaults to 'abort' in non-TTY/test mode for safety.
 */
async function askResumeRestartAbort() {
  if (process.env.BOOTSTRAP_TEST_MODE === '1') {
    return process.env.BOOTSTRAP_TEST_RESUME_CHOICE || 'restart';
  }
  if (!input.isTTY) return 'abort';
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(
      'Previous bootstrap incomplete. Resume / restart / abort? [resume/restart/abort]: '
    )).trim().toLowerCase();
    if (answer.startsWith('res')) return 'resume';
    if (answer.startsWith('rest')) return 'restart';
    return 'abort';
  } finally {
    rl.close();
  }
}

/**
 * Detect the source root used by the target repo. Next.js supports both
 * `app/**` (default) and `src/app/**` (with --src-dir flag). We sniff this
 * once and surface it so all downstream globs use the right prefix.
 */
async function detectSourceRoot(repoPath) {
  // Prefer src/ layout if present (matches the demo target Marginalia + most
  // modern create-next-app scaffolds).
  if (existsSync(resolve(repoPath, 'src/app'))) return 'src';
  if (existsSync(resolve(repoPath, 'app'))) return '';
  // Pages router fallback
  if (existsSync(resolve(repoPath, 'src/pages'))) return 'src';
  if (existsSync(resolve(repoPath, 'pages'))) return '';
  return '';
}

/**
 * Pre-flight gate. Returns:
 *   { resume: bool, abort: bool, nodeCountEstimate: int, costEstimate: number, sourceRoot: string }
 *
 * If `abort: true`, callers should exit immediately without running Stage 1.
 *
 * @param {string} repoPath
 * @param {object} [options]
 * @param {boolean} [options.skipCostPrompt]  — bypass the soft-ceiling prompt (caller already confirmed)
 */
export async function preflight(repoPath, options = {}) {
  // 1. Repo exists + readable
  if (!existsSync(repoPath) || !statSync(repoPath).isDirectory()) {
    throw new Error(`pre-flight: $repo_path '${repoPath}' does not exist or is not a directory`);
  }

  // 2. Next.js + TS shape — accept either next.config.{ts,js,mjs} OR src/app/**.tsx
  const nextConfigMatches = await glob(['next.config.{ts,js,mjs,cjs}'], { cwd: repoPath });
  const tsxFilesEarly = await glob(
    ['app/**/*.tsx', 'src/app/**/*.tsx', 'pages/**/*.tsx', 'src/pages/**/*.tsx'],
    { cwd: repoPath }
  );
  if (nextConfigMatches.length === 0 && tsxFilesEarly.length === 0) {
    throw new Error(
      `pre-flight: '${repoPath}' is not a Next.js + TS-shaped repo (no next.config.* and no app/**.tsx)`
    );
  }

  // 3. Hard ceiling — refuse truly absurd repos for v1
  if (tsxFilesEarly.length > HARD_CEILING_TSX) {
    throw new Error(
      `pre-flight: repo too large for v1 bootstrap (${tsxFilesEarly.length} .tsx > ${HARD_CEILING_TSX}). v2 will support monorepos via paths-allowlist.`
    );
  }

  // 4. Detect prior staging
  const stagingDir = resolve(repoPath, '.contracts/.staging');
  let resume = false;
  if (existsSync(stagingDir)) {
    const choice = await askResumeRestartAbort();
    if (choice === 'abort') return { resume: false, abort: true, nodeCountEstimate: 0, costEstimate: 0, sourceRoot: '' };
    if (choice === 'restart') {
      await rm(stagingDir, { recursive: true, force: true });
    } else {
      resume = true;
    }
  }

  // 5. Source-root sniff (drives discover.mjs globs)
  const sourceRoot = await detectSourceRoot(repoPath);

  // 6. Quick file count for cost estimate (covers pages + routes + libs + prisma)
  const prefix = sourceRoot ? `${sourceRoot}/` : '';
  const candidateFiles = await glob([
    `${prefix}app/**/page.tsx`,
    `${prefix}app/**/layout.tsx`,
    `${prefix}app/**/route.ts`,
    `${prefix}lib/**/*.ts`,
    `prisma/schema.prisma`,
  ], { cwd: repoPath });
  const nodeCountEstimate = Math.ceil(candidateFiles.length * NODES_PER_FILE_ESTIMATE);
  const costEstimate = nodeCountEstimate * COST_PER_NODE_USD * STAGE_MULTIPLIER;

  // 7. Soft cost ceiling — opt-in prompt above $5
  if (!options.skipCostPrompt && costEstimate > SOFT_COST_THRESHOLD_USD) {
    const minutesEstimate = Math.ceil(nodeCountEstimate / 5); // ~5 nodes/min @ concurrency 5
    const proceed = await ask(
      `Estimated cost: $${costEstimate.toFixed(2)}. Estimated time: ${minutesEstimate}min. Continue? [y/N]: `,
      { defaultYes: false }
    );
    if (!proceed) return { resume: false, abort: true, nodeCountEstimate, costEstimate, sourceRoot };
  }

  return { resume, abort: false, nodeCountEstimate, costEstimate, sourceRoot };
}

// CLI entry — `node scripts/preflight.mjs <repo>` prints the JSON estimate.
if (import.meta.url === `file://${process.argv[1]}`) {
  const repoPath = resolve(process.argv[2] || process.cwd());
  preflight(repoPath, { skipCostPrompt: true })
    .then(result => { console.log(JSON.stringify(result, null, 2)); })
    .catch(err => { console.error(err.message); process.exit(1); });
}
