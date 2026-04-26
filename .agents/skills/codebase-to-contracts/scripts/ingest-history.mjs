// scripts/ingest-history.mjs — Stage 0.5 of the bootstrap pipeline.
//
// Walks the target repo for historical decision artifacts (CLAUDE.md,
// git log, ADRs, CHANGELOG, DECISIONS.md), packages each as a synthetic
// episode, and dispatches them through `claude -p --json-schema` with the
// distill-historical.txt prompt to produce substrate nodes.
//
// Output:
//   .staging/historical-episodes.jsonl  — one synthetic episode per line
//                                          (drives hash-skip on re-run)
//   .staging/historical-substrate.jsonl — one {artifact, node} pair per
//                                          emitted substrate node, picked
//                                          up by the Rust adapter (Plan
//                                          14-08 Task 3) for persistence
//                                          to substrate_nodes table.
//
// Stage 0.5 does NOT produce contract sidecars — it produces substrate.
// Stages 1-5 produce contracts. The two paths land in different tables
// and animate via different Tauri events.
//
// CLI:
//   node ingest-history.mjs <repo-path>
//
// Test mode (BOOTSTRAP_TEST_MODE=1): callClaude short-circuits — distiller
// returns empty; tests verify discovery + hash-skip + cap behavior without
// hitting the LLM.

import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  appendFileSync,
  statSync,
} from 'node:fs';
import { resolve, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from 'tinyglobby';
import { createHash } from 'node:crypto';
import { callClaude } from './helpers/claude-cli-bridge.mjs';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(__filename);

const PROMPT_PATH = resolve(SCRIPT_DIR, '../prompts/distill-historical.txt');
const SCHEMA_PATH = resolve(SCRIPT_DIR, '../schemas/distiller-output.json');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Hard filter: commit subjects matching this prefix are dropped pre-distill.
// They never hit the LLM. Tracks the negative-example list in
// distill-historical.txt — chore/wip/docs/style/test/build/ci all have
// near-zero rationale density per commit.
const COMMIT_SKIP_PREFIX = /^(chore|wip|docs|style|test|build|ci|deps|release):/i;

// Hard cap at 50 artifacts per run (~$1.50 at sonnet pricing). Above this,
// we sample down to most-recent 50. Soft warn at 30.
const COST_HARD_CAP = 50;
const COST_SOFT_WARN = 30;

// Concurrency for distiller calls — Phase 11 precedent runs ~3 in parallel
// without rate-limit. Lower than Stage 2 (concurrency 5) because each
// historical-distill call has heavier prompt + output.
const DISTILL_CONCURRENCY = 3;

// Min commit body length for substantive-decision check. Subject under
// COMMIT_MIN_SUBJECT_LEN with empty body → emit zero nodes.
const COMMIT_MIN_SUBJECT_LEN = 30;

// Glob skip set — node_modules, vendor, build outputs.
const GLOB_IGNORE = ['**/node_modules/**', '**/.next/**', '**/dist/**', '**/build/**', '**/.git/**'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256hex(s) {
  return createHash('sha256').update(s).digest('hex');
}

function emit(event) {
  process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
}

// ---------------------------------------------------------------------------
// Discovery — file-based artifacts
// ---------------------------------------------------------------------------

async function discoverFileArtifacts(repoPath) {
  const out = [];

  const claudeMdFiles = await glob(['**/CLAUDE.md'], { cwd: repoPath, ignore: GLOB_IGNORE, absolute: false });
  for (const file of claudeMdFiles) {
    const abs = resolve(repoPath, file);
    const text = readFileSync(abs, 'utf8');
    if (text.length < 20) continue;
    out.push({
      artifact_type: 'claude_md',
      content_text: text,
      content_hash: sha256hex(text),
      provenance: {
        source: 'historical',
        repo_path: repoPath,
        file_path: file,
        timestamp: statSync(abs).mtime.toISOString(),
      },
    });
  }

  const decisionsMdFiles = await glob(['**/DECISIONS.md'], { cwd: repoPath, ignore: GLOB_IGNORE, absolute: false });
  for (const file of decisionsMdFiles) {
    const abs = resolve(repoPath, file);
    const text = readFileSync(abs, 'utf8');
    if (text.length < 20) continue;
    out.push({
      artifact_type: 'decisions_md',
      content_text: text,
      content_hash: sha256hex(text),
      provenance: {
        source: 'historical',
        repo_path: repoPath,
        file_path: file,
        timestamp: statSync(abs).mtime.toISOString(),
      },
    });
  }

  const adrFiles = await glob(
    ['docs/adr/*.md', 'docs/decisions/*.md', 'docs/architecture/*.md'],
    { cwd: repoPath, ignore: GLOB_IGNORE, absolute: false },
  );
  for (const file of adrFiles) {
    const abs = resolve(repoPath, file);
    const text = readFileSync(abs, 'utf8');
    if (text.length < 20) continue;
    out.push({
      artifact_type: 'adr',
      content_text: text,
      content_hash: sha256hex(text),
      provenance: {
        source: 'historical',
        repo_path: repoPath,
        file_path: file,
        timestamp: statSync(abs).mtime.toISOString(),
      },
    });
  }

  const changelogFiles = await glob(['CHANGELOG.md', '**/CHANGELOG.md'], {
    cwd: repoPath,
    ignore: GLOB_IGNORE,
    absolute: false,
  });
  for (const file of changelogFiles) {
    const abs = resolve(repoPath, file);
    const text = readFileSync(abs, 'utf8');
    if (text.length < 20) continue;
    out.push({
      artifact_type: 'changelog',
      content_text: text,
      content_hash: sha256hex(text),
      provenance: {
        source: 'historical',
        repo_path: repoPath,
        file_path: file,
        timestamp: statSync(abs).mtime.toISOString(),
      },
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Discovery — git commits
// ---------------------------------------------------------------------------

const COMMIT_DELIM = '<<<COMMIT-END>>>';

export function readGitLog(repoPath, n = 200) {
  try {
    return execFileSync(
      'git',
      ['log', `-n${n}`, `--format=%H%n%aI%n%s%n%b%n${COMMIT_DELIM}`],
      { cwd: repoPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {
    return '';
  }
}

export function parseGitLog(raw) {
  if (!raw) return [];
  const blocks = raw.split(COMMIT_DELIM).map(b => b.trim()).filter(Boolean);
  const out = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const sha = lines[0];
    const timestamp = lines[1];
    const subject = lines[2] ?? '';
    const body = lines.slice(3).join('\n').trim();
    if (!sha || !timestamp || !subject) continue;
    out.push({ sha, timestamp, subject, body });
  }
  return out;
}

export function passesCommitHardFilter(commit) {
  if (COMMIT_SKIP_PREFIX.test(commit.subject)) return false;
  if (commit.subject.length < COMMIT_MIN_SUBJECT_LEN && commit.body.length === 0) return false;
  // Drop merge commits — git surfaces them as "Merge ..." subjects with no body
  if (/^Merge (branch|pull request)/i.test(commit.subject) && commit.body.length === 0) return false;
  return true;
}

function discoverCommitArtifacts(repoPath) {
  const raw = readGitLog(repoPath, 200);
  const commits = parseGitLog(raw).filter(passesCommitHardFilter);
  return commits.map(c => {
    const content_text = c.body ? `${c.subject}\n\n${c.body}` : c.subject;
    return {
      artifact_type: 'commit',
      content_text,
      content_hash: sha256hex(content_text),
      provenance: {
        source: 'historical',
        repo_path: repoPath,
        commit_sha: c.sha,
        commit_subject: c.subject,
        timestamp: c.timestamp,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Hash-skip
// ---------------------------------------------------------------------------

function readExistingEpisodeHashes(stagingDir) {
  const path = resolve(stagingDir, 'historical-episodes.jsonl');
  const set = new Set();
  if (!existsSync(path)) return set;
  const raw = readFileSync(path, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const ep = JSON.parse(trimmed);
      if (ep.content_hash) set.add(ep.content_hash);
    } catch { /* skip malformed lines */ }
  }
  return set;
}

// ---------------------------------------------------------------------------
// Distiller dispatch
// ---------------------------------------------------------------------------

async function distillArtifact(artifact, systemPrompt) {
  const userPrompt = `artifact_type: ${artifact.artifact_type}\n\n${artifact.content_text}`;
  const result = await callClaude({
    schemaPath: SCHEMA_PATH,
    systemPrompt,
    userPrompt,
  });
  return result.structured_output?.nodes ?? [];
}

async function inBatches(items, size, fn) {
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size);
    await Promise.all(slice.map(fn));
  }
}

// ---------------------------------------------------------------------------
// Output writing
// ---------------------------------------------------------------------------

function appendEpisode(stagingDir, episode) {
  appendFileSync(resolve(stagingDir, 'historical-episodes.jsonl'), JSON.stringify(episode) + '\n');
}

function appendSubstrate(stagingDir, artifact, node) {
  const line = JSON.stringify({ artifact, node });
  appendFileSync(resolve(stagingDir, 'historical-substrate.jsonl'), line + '\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function ingestHistory(repoPath, options = {}) {
  emit({ event: 'stage', stage: '0.5', status: 'started' });

  const stagingDir = resolve(repoPath, '.contracts/.staging');
  mkdirSync(stagingDir, { recursive: true });

  // Discover everything
  const fileArtifacts = await discoverFileArtifacts(repoPath);
  const commitArtifacts = discoverCommitArtifacts(repoPath);
  const allDiscovered = [...fileArtifacts, ...commitArtifacts];

  for (const a of allDiscovered) {
    emit({
      event: 'artifact',
      artifact_type: a.artifact_type,
      path: a.provenance.file_path ?? a.provenance.commit_sha,
      hash: a.content_hash.slice(0, 12),
    });
  }

  // Hash-skip
  const existingHashes = readExistingEpisodeHashes(stagingDir);
  const newArtifacts = allDiscovered.filter(a => !existingHashes.has(a.content_hash));
  const skipped = allDiscovered.length - newArtifacts.length;

  if (newArtifacts.length === 0) {
    emit({ event: 'stage', stage: '0.5', status: 'completed', artifact_count: 0, node_count: 0, hash_skipped: skipped });
    return {
      artifacts_discovered: allDiscovered.length,
      artifacts_skipped_hashed: skipped,
      artifacts_capped: 0,
      artifacts_distilled: 0,
      nodes_emitted: 0,
    };
  }

  // Cost cap — sort by recency (newest first) so the cap takes the most-relevant
  newArtifacts.sort((a, b) => (b.provenance.timestamp ?? '').localeCompare(a.provenance.timestamp ?? ''));
  const capped = newArtifacts.slice(0, COST_HARD_CAP);
  const cappedOut = newArtifacts.length - capped.length;

  if (newArtifacts.length > COST_SOFT_WARN) {
    emit({
      event: 'cost-warn',
      stage: '0.5',
      artifact_count: newArtifacts.length,
      capped_to: capped.length,
      est_cost_usd: capped.length * 0.03, // rough heuristic — refined post-UAT
    });
  }

  // Read system prompt once
  const systemPrompt = readFileSync(PROMPT_PATH, 'utf8');

  // Dispatch
  let nodeCount = 0;
  await inBatches(capped, DISTILL_CONCURRENCY, async (artifact) => {
    appendEpisode(stagingDir, artifact);
    let nodes = [];
    try {
      nodes = await distillArtifact(artifact, systemPrompt);
    } catch (err) {
      emit({ event: 'error', stage: '0.5', diagnostic: { hash: artifact.content_hash, message: String(err) } });
      return;
    }
    for (const node of nodes) {
      appendSubstrate(stagingDir, artifact, node);
      emit({
        event: 'substrate-node',
        type: node.type,
        text: (node.text ?? '').slice(0, 80),
        artifact_hash: artifact.content_hash.slice(0, 12),
      });
      nodeCount++;
    }
  });

  emit({
    event: 'stage',
    stage: '0.5',
    status: 'completed',
    artifact_count: capped.length,
    node_count: nodeCount,
    hash_skipped: skipped,
    capped_out: cappedOut,
  });

  return {
    artifacts_discovered: allDiscovered.length,
    artifacts_skipped_hashed: skipped,
    artifacts_capped: cappedOut,
    artifacts_distilled: capped.length,
    nodes_emitted: nodeCount,
  };
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const repoPath = resolve(process.argv[2] || process.cwd());
  ingestHistory(repoPath)
    .then(s => process.stdout.write(JSON.stringify(s, null, 2) + '\n'))
    .catch(err => { process.stderr.write(`[ingest-history] FATAL: ${err.message}\n`); process.exit(1); });
}
