// __tests__/ingest-history.test.mjs — Stage 0.5 walker unit tests.
//
// Tests the pure functions (parseGitLog, passesCommitHardFilter) directly
// against fixtures, and tests the orchestration (ingestHistory) against
// a temp-dir scratch repo with BOOTSTRAP_TEST_MODE=1 to short-circuit
// the LLM dispatch (mocked to return empty nodes — distillation behavior
// is integration-level, validated in Plan 14-08 Task 5 against real LLM).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  parseGitLog,
  passesCommitHardFilter,
  ingestHistory,
} from '../ingest-history.mjs';

const __filename = fileURLToPath(import.meta.url);
const TEST_DIR = dirname(__filename);
const FIXTURES_DIR = resolve(TEST_DIR, 'fixtures');

// ---------------------------------------------------------------------------
// Pure-function tests (no fs / no git)
// ---------------------------------------------------------------------------

test('parseGitLog: parses fixture into 6 commits with correct fields', () => {
  const raw = readFileSync(resolve(FIXTURES_DIR, 'sample-git-log.txt'), 'utf8');
  const commits = parseGitLog(raw);
  assert.equal(commits.length, 6);
  assert.equal(commits[0].sha, 'a1b2c3d4e5f6789012345678901234567890abcd');
  assert.equal(commits[0].subject.startsWith('feat: add Stripe webhook'), true);
  assert.equal(commits[0].body.includes('processedWebhook'), true);
  assert.equal(commits[3].subject.startsWith('docs:'), true);
});

test('parseGitLog: empty input returns empty array', () => {
  assert.deepEqual(parseGitLog(''), []);
  assert.deepEqual(parseGitLog('   '), []);
});

test('passesCommitHardFilter: chore / wip / docs prefixes filtered out', () => {
  assert.equal(passesCommitHardFilter({ subject: 'chore: bump deps', body: 'nothing' }), false);
  assert.equal(passesCommitHardFilter({ subject: 'wip: account settings draft', body: 'In progress.' }), false);
  assert.equal(passesCommitHardFilter({ subject: 'docs: typo in README', body: 'Fixed.' }), false);
  assert.equal(passesCommitHardFilter({ subject: 'style: fix indentation', body: '' }), false);
  assert.equal(passesCommitHardFilter({ subject: 'test: add jest config', body: '' }), false);
});

test('passesCommitHardFilter: feat / fix / refactor commits pass when substantial', () => {
  assert.equal(
    passesCommitHardFilter({
      subject: 'feat: add Stripe webhook idempotency via processedWebhook table',
      body: 'Stripe replays webhooks on 4xx/5xx...',
    }),
    true,
  );
  assert.equal(
    passesCommitHardFilter({
      subject: 'fix: handle null Stripe customer in webhook deletion path',
      body: 'Edge case where customer.deleted webhooks arrive after we have already archived locally.',
    }),
    true,
  );
});

test('passesCommitHardFilter: short subject + empty body is dropped', () => {
  assert.equal(passesCommitHardFilter({ subject: 'feat: x', body: '' }), false);
});

test('passesCommitHardFilter: merge commits with empty body are dropped', () => {
  assert.equal(passesCommitHardFilter({ subject: 'Merge branch master', body: '' }), false);
  assert.equal(passesCommitHardFilter({ subject: 'Merge pull request #123', body: '' }), false);
});

test('parseGitLog + passesCommitHardFilter together: 6 commits → 3 substantive', () => {
  const raw = readFileSync(resolve(FIXTURES_DIR, 'sample-git-log.txt'), 'utf8');
  const all = parseGitLog(raw);
  const substantive = all.filter(passesCommitHardFilter);
  // feat (Stripe webhook), fix (null customer), feat (argon2 sessions) → 3
  assert.equal(substantive.length, 3, `expected 3 substantive commits, got ${substantive.length}: ${substantive.map(c => c.subject).join(' | ')}`);
  assert.deepEqual(
    substantive.map(c => c.subject.split(':')[0]),
    ['feat', 'fix', 'feat'],
  );
});

// ---------------------------------------------------------------------------
// Orchestration tests (temp-dir scratch repo, BOOTSTRAP_TEST_MODE=1)
// ---------------------------------------------------------------------------

function setupTempRepo(label) {
  const dir = mkdtempSync(resolve(tmpdir(), `ingest-history-${label}-`));
  // Init git so discoverCommitArtifacts has something to work with — but with
  // an empty commit history (just init), so commit discovery yields zero.
  execFileSync('git', ['init', '-q', '--initial-branch', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@local'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  return dir;
}

function teardownTempRepo(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
}

test('ingestHistory: discovers a CLAUDE.md and writes deterministic episode hash', async () => {
  const dir = setupTempRepo('discover');
  try {
    const text = readFileSync(resolve(FIXTURES_DIR, 'sample-claude-md.md'), 'utf8');
    writeFileSync(resolve(dir, 'CLAUDE.md'), text);

    process.env.BOOTSTRAP_TEST_MODE = '1';
    const summary = await ingestHistory(dir);
    delete process.env.BOOTSTRAP_TEST_MODE;

    assert.equal(summary.artifacts_discovered, 1);
    assert.equal(summary.artifacts_distilled, 1);
    // Test mode short-circuits → 0 nodes produced.
    assert.equal(summary.nodes_emitted, 0);

    const episodeFile = resolve(dir, '.contracts/.staging/historical-episodes.jsonl');
    assert.equal(existsSync(episodeFile), true);
    const lines = readFileSync(episodeFile, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const episode = JSON.parse(lines[0]);
    assert.equal(episode.artifact_type, 'claude_md');
    assert.equal(episode.content_hash, createHash('sha256').update(text).digest('hex'));
    assert.equal(episode.provenance.source, 'historical');
  } finally {
    teardownTempRepo(dir);
  }
});

test('ingestHistory: re-running on unchanged repo hash-skips → 0 distillations', async () => {
  const dir = setupTempRepo('skip');
  try {
    writeFileSync(resolve(dir, 'CLAUDE.md'), readFileSync(resolve(FIXTURES_DIR, 'sample-claude-md.md'), 'utf8'));

    process.env.BOOTSTRAP_TEST_MODE = '1';
    const first = await ingestHistory(dir);
    const second = await ingestHistory(dir);
    delete process.env.BOOTSTRAP_TEST_MODE;

    assert.equal(first.artifacts_distilled, 1);
    assert.equal(second.artifacts_distilled, 0);
    assert.equal(second.artifacts_skipped_hashed, 1);
  } finally {
    teardownTempRepo(dir);
  }
});

test('ingestHistory: updated CLAUDE.md re-derives only the changed artifact', async () => {
  const dir = setupTempRepo('update');
  try {
    const original = readFileSync(resolve(FIXTURES_DIR, 'sample-claude-md.md'), 'utf8');
    writeFileSync(resolve(dir, 'CLAUDE.md'), original);

    process.env.BOOTSTRAP_TEST_MODE = '1';
    await ingestHistory(dir);

    // Mutate the CLAUDE.md
    writeFileSync(resolve(dir, 'CLAUDE.md'), original + '\n\n## Added\n- A new decision.\n');
    const summary = await ingestHistory(dir);
    delete process.env.BOOTSTRAP_TEST_MODE;

    assert.equal(summary.artifacts_distilled, 1, 'expected exactly one re-derivation on the changed file');
  } finally {
    teardownTempRepo(dir);
  }
});

test('ingestHistory: discovers ADR + CHANGELOG + DECISIONS.md when present', async () => {
  const dir = setupTempRepo('multi');
  try {
    mkdirSync(resolve(dir, 'docs/adr'), { recursive: true });
    writeFileSync(resolve(dir, 'docs/adr/0001-use-postgres.md'), '# ADR 0001: Use Postgres\n## Context\nNeed durable storage.\n## Decision\nUse Postgres for the primary db.\n');
    writeFileSync(resolve(dir, 'CHANGELOG.md'), '## v1.0.0 - 2026-04-01\n\n### BREAKING CHANGE\n- Removed deprecated /api/v1 endpoints.\n');
    writeFileSync(resolve(dir, 'DECISIONS.md'), '# Decisions\n\n- Use sentry for error reporting in prod.\n- Use vitest for unit tests.\n');

    process.env.BOOTSTRAP_TEST_MODE = '1';
    const summary = await ingestHistory(dir);
    delete process.env.BOOTSTRAP_TEST_MODE;

    assert.equal(summary.artifacts_discovered, 3, `expected ADR + CHANGELOG + DECISIONS.md = 3, got ${summary.artifacts_discovered}`);
  } finally {
    teardownTempRepo(dir);
  }
});

test('ingestHistory: empty repo (no artifacts) returns zero counts', async () => {
  const dir = setupTempRepo('empty');
  try {
    process.env.BOOTSTRAP_TEST_MODE = '1';
    const summary = await ingestHistory(dir);
    delete process.env.BOOTSTRAP_TEST_MODE;

    assert.equal(summary.artifacts_discovered, 0);
    assert.equal(summary.artifacts_distilled, 0);
    assert.equal(summary.nodes_emitted, 0);
  } finally {
    teardownTempRepo(dir);
  }
});

test('ingestHistory: skips files smaller than 20 bytes', async () => {
  const dir = setupTempRepo('tiny');
  try {
    writeFileSync(resolve(dir, 'CLAUDE.md'), 'tiny');  // < 20 chars

    process.env.BOOTSTRAP_TEST_MODE = '1';
    const summary = await ingestHistory(dir);
    delete process.env.BOOTSTRAP_TEST_MODE;

    assert.equal(summary.artifacts_discovered, 0);
  } finally {
    teardownTempRepo(dir);
  }
});
