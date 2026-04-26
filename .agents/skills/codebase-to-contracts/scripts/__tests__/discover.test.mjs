// scripts/__tests__/discover.test.mjs
//
// Idempotency + classification-correctness contract for Stage 1 (discover.mjs).
// Builds a tiny in-memory Next.js + Prisma fixture under os.tmpdir(), runs
// discover() against it, and asserts:
//   1. The 6 canonical patterns each emit at least one expected node.
//   2. Re-running produces byte-identical UUIDs (deterministic UUIDv5 contract).
//   3. Deleting a source file and re-running drops its nodes.
//
// Mocks `claude -p` via BOOTSTRAP_TEST_MODE=1 so no subprocess fires.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

process.env.BOOTSTRAP_TEST_MODE = '1';
const { discover } = await import('../discover.mjs');

function makeFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'discover-test-'));

  // package.json — drives repoNameFromPath
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture-app' }, null, 2));

  // src/app/page.tsx (UI L3 + at least one L4 component candidate)
  mkdirSync(join(dir, 'src/app'), { recursive: true });
  writeFileSync(join(dir, 'src/app/page.tsx'),
    `export default function Home() {
       return <main><Hero /></main>;
     }
     export function Hero() { return <h1>Welcome</h1>; }
    `
  );

  // src/app/api/notes/route.ts (API L3 — POST only)
  mkdirSync(join(dir, 'src/app/api/notes'), { recursive: true });
  writeFileSync(join(dir, 'src/app/api/notes/route.ts'),
    `import { NextResponse } from 'next/server';
     export async function POST(req) { return NextResponse.json({ ok: true }); }
    `
  );

  // prisma/schema.prisma (data L2 — one model)
  mkdirSync(join(dir, 'prisma'), { recursive: true });
  writeFileSync(join(dir, 'prisma/schema.prisma'),
    `model User {
       id String @id
       email String
     }
    `
  );

  // src/lib/db.ts (lib L2 — small, pure helper)
  mkdirSync(join(dir, 'src/lib'), { recursive: true });
  writeFileSync(join(dir, 'src/lib/db.ts'),
    `export function getDb() { return { hello: 'world' }; }`
  );

  // src/lib/stripe.ts (external L3 — imports stripe SDK)
  writeFileSync(join(dir, 'src/lib/stripe.ts'),
    `import Stripe from 'stripe';
     export const stripe = new Stripe(process.env.STRIPE_KEY ?? '');
    `
  );

  return dir;
}

test('discover classifies 6 canonical patterns from a small fixture', async () => {
  const repo = makeFixtureRepo();
  try {
    const nodes = await discover(repo);

    const filesByKindLevel = new Map();
    for (const n of nodes) {
      const key = `${n.kind}:${n.level}:${n.file}`;
      filesByKindLevel.set(key, n);
    }

    // Page -> UI L3
    assert.ok(
      [...filesByKindLevel.keys()].some(k => k.startsWith('UI:L3:') && k.includes('page.tsx')),
      'expected UI L3 from app/page.tsx'
    );
    // Page -> at least one UI L4 component candidate (Home or Hero)
    assert.ok(
      nodes.some(n => n.kind === 'UI' && n.level === 'L4' && n.file.endsWith('page.tsx')),
      'expected UI L4 component candidate from app/page.tsx'
    );
    // API L3 (POST)
    const apiNode = nodes.find(n => n.kind === 'API' && n.level === 'L3');
    assert.ok(apiNode, 'expected API L3 from app/api/notes/route.ts');
    assert.ok(apiNode.route?.startsWith('POST '), `expected POST route, got ${apiNode.route}`);
    // data L2
    assert.ok(
      nodes.some(n => n.kind === 'data' && n.level === 'L2' && n.model_name === 'User'),
      'expected data L2 for Prisma model User'
    );
    // lib L2 (small db helper)
    assert.ok(
      nodes.some(n => n.kind === 'lib' && n.level === 'L2' && n.file.endsWith('lib/db.ts')),
      'expected lib L2 from src/lib/db.ts'
    );
    // external L3 (stripe)
    assert.ok(
      nodes.some(n => n.kind === 'external' && n.level === 'L3' && n.file.endsWith('lib/stripe.ts')),
      'expected external L3 from src/lib/stripe.ts'
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('discover is idempotent: re-runs produce identical nodes.json', async () => {
  const repo = makeFixtureRepo();
  try {
    await discover(repo);
    const first = readFileSync(resolve(repo, '.contracts/.staging/nodes.json'), 'utf8');
    await discover(repo);
    const second = readFileSync(resolve(repo, '.contracts/.staging/nodes.json'), 'utf8');
    assert.equal(first, second, 'nodes.json must be byte-identical across re-runs');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('discover handles deletion: removed files are absent on re-run', async () => {
  const repo = makeFixtureRepo();
  try {
    const initial = await discover(repo);
    const beforeUuids = new Set(initial.map(n => n.uuid));
    const pageNodes = initial.filter(n => n.file.endsWith('page.tsx'));
    assert.ok(pageNodes.length > 0, 'fixture should include page.tsx nodes');

    rmSync(resolve(repo, 'src/app/page.tsx'));
    const after = await discover(repo);
    const afterUuids = new Set(after.map(n => n.uuid));

    // None of the page.tsx UUIDs should remain after deletion.
    for (const removed of pageNodes) {
      assert.ok(!afterUuids.has(removed.uuid), `expected ${removed.uuid} to be gone after page.tsx deletion`);
    }
    // The other files' UUIDs should still be present (no UUID drift).
    const survivingApi = initial.find(n => n.kind === 'API');
    assert.ok(afterUuids.has(survivingApi.uuid), 'API L3 UUID must survive across re-runs');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
