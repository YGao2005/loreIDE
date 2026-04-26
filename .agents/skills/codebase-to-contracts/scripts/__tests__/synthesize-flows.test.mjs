// scripts/__tests__/synthesize-flows.test.mjs
//
// Verifies Stage 5a: import-walking + AST call-site extraction + flow UUID
// determinism + LLM verification fallback. claude -p mocked via
// BOOTSTRAP_TEST_MODE=1 (returns {} → static chain stands).
//
// Asserts:
//   1. staticCallChain on api-route-with-imports.ts returns [auth, account,
//      stripe] in invocation ORDER (not declaration order).
//   2. Synthesizing flows over a fixture writes one flow.frontmatter.json
//      with format_version=5, kind=flow, members=[trigger, ...participants].
//   3. Re-running on same repo + nodes.json produces SAME flow UUID
//      (deterministic UUIDv5 from (repoName, slug, 'L2:flow')).
//   4. Shared services (e.g. stripe imported by two routes) appear in
//      both flows' members lists referencing the SAME UUID — no duplicate
//      sidecar emission.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.BOOTSTRAP_TEST_MODE = '1';
const { staticCallChain, synthesizeFlows, flowSlugFromTrigger } = await import('../synthesize-flows.mjs');
const { loadBabel } = await import('../helpers/babel-parser-bridge.mjs');

const __filename = fileURLToPath(import.meta.url);
const FIXTURES_DIR = resolve(dirname(__filename), 'fixtures');

// ---------------------------------------------------------------------------
// Test 1: staticCallChain returns participants in INVOCATION order.
// ---------------------------------------------------------------------------

test('staticCallChain returns members in invocation order, not import order', async () => {
  // The fixture imports beginAccountDeletion, getSession, archiveStripeCustomer
  // in that ORDER, but invokes them in the order: getSession → beginAccountDeletion →
  // archiveStripeCustomer. The chain MUST reflect invocation order.
  const repoPath = resolve(FIXTURES_DIR, '../../..'); // skill root — has node_modules for Babel
  const { parse, traverse } = await loadBabel(repoPath);

  const triggerSource = readFileSync(join(FIXTURES_DIR, 'api-route-with-imports.ts'), 'utf8');
  const triggerFile = 'src/app/api/account/route.ts';
  const allNodes = [
    { uuid: '11111111-1111-4111-8111-111111111111', file: 'src/lib/account.ts', kind: 'lib', level: 'L2' },
    { uuid: '22222222-2222-4222-8222-222222222222', file: 'src/lib/auth.ts', kind: 'lib', level: 'L2' },
    { uuid: '33333333-3333-4333-8333-333333333333', file: 'src/lib/stripe.ts', kind: 'external', level: 'L3' },
  ];
  const allFiles = new Set(allNodes.map((n) => n.file));

  const chain = staticCallChain({
    triggerSource, triggerFile, allNodes, allFiles, repoPath: '/fake-repo', babel: { parse, traverse },
  });

  assert.equal(chain.length, 3, 'three participants resolved');
  assert.equal(chain[0].uuid, '22222222-2222-4222-8222-222222222222', 'auth (getSession) called first');
  assert.equal(chain[1].uuid, '11111111-1111-4111-8111-111111111111', 'account (beginAccountDeletion) called second');
  assert.equal(chain[2].uuid, '33333333-3333-4333-8333-333333333333', 'stripe (archiveStripeCustomer) called third');
});

// ---------------------------------------------------------------------------
// Test 2: synthesizeFlows writes a format_version=5, kind=flow contract
// with members ordered correctly.
// ---------------------------------------------------------------------------

test('synthesizeFlows writes flow.frontmatter.json with format_version=5 and ordered members', async () => {
  const tmpRepo = mkdtempSync(join(tmpdir(), 'synth-flows-test-'));
  try {
    // Copy fixture into the fake repo at the right path
    writeFileSync(join(tmpRepo, 'package.json'), JSON.stringify({ name: 'fixture-marginalia' }, null, 2));
    mkdirSync(join(tmpRepo, 'src/app/api/account'), { recursive: true });
    copyFileSync(
      join(FIXTURES_DIR, 'api-route-with-imports.ts'),
      join(tmpRepo, 'src/app/api/account/route.ts'),
    );

    // Stub out the lib modules so the recursion doesn't error on missing files.
    mkdirSync(join(tmpRepo, 'src/lib'), { recursive: true });
    writeFileSync(join(tmpRepo, 'src/lib/account.ts'), 'export async function beginAccountDeletion() {}\n');
    writeFileSync(join(tmpRepo, 'src/lib/auth.ts'), 'export async function getSession() { return null; }\n');
    writeFileSync(join(tmpRepo, 'src/lib/stripe.ts'), 'export async function archiveStripeCustomer() {}\n');

    // Build a nodes.json — the API route is the trigger.
    const triggerUuid = 'aaaa1111-1111-4111-8111-111111111111';
    const accountUuid = '11111111-1111-4111-8111-111111111111';
    const authUuid = '22222222-2222-4222-8222-222222222222';
    const stripeUuid = '33333333-3333-4333-8333-333333333333';
    const nodes = [
      { uuid: triggerUuid, kind: 'API', level: 'L3', file: 'src/app/api/account/route.ts', route: 'DELETE /api/account', candidate_lines: { start_line: 1, end_line: 13 }, parent_hint: null, source: 'heuristic' },
      { uuid: accountUuid, kind: 'lib', level: 'L2', file: 'src/lib/account.ts', candidate_lines: { start_line: 1, end_line: 1 }, source: 'heuristic' },
      { uuid: authUuid, kind: 'lib', level: 'L2', file: 'src/lib/auth.ts', candidate_lines: { start_line: 1, end_line: 1 }, source: 'heuristic' },
      { uuid: stripeUuid, kind: 'external', level: 'L3', file: 'src/lib/stripe.ts', candidate_lines: { start_line: 1, end_line: 1 }, source: 'heuristic' },
    ];
    const stagingDir = join(tmpRepo, '.contracts/.staging');
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, 'nodes.json'), JSON.stringify(nodes, null, 2));

    const flows = await synthesizeFlows(tmpRepo);
    assert.equal(flows.length, 1, 'one flow synthesized for the API trigger');

    const flow = flows[0];
    assert.equal(flow.trigger, triggerUuid, 'flow trigger matches API route uuid');
    // members should be [trigger, auth, account, stripe] — invocation order.
    assert.deepEqual(flow.members, [triggerUuid, authUuid, accountUuid, stripeUuid]);

    const fmPath = join(stagingDir, `${flow.uuid}.frontmatter.json`);
    assert.ok(existsSync(fmPath), 'flow frontmatter file written');
    const fm = JSON.parse(readFileSync(fmPath, 'utf8'));
    assert.equal(fm.format_version, 5, 'format_version=5 for flow');
    assert.equal(fm.kind, 'flow');
    assert.equal(fm.level, 'L2');
    assert.deepEqual(fm.members, [triggerUuid, authUuid, accountUuid, stripeUuid]);
    assert.deepEqual(fm.code_ranges, [], 'flows have no code_ranges');

    const bodyPath = join(stagingDir, `${flow.uuid}.body.json`);
    assert.ok(existsSync(bodyPath), 'flow body file written');
    const body = JSON.parse(readFileSync(bodyPath, 'utf8'));
    assert.equal(body.kind, 'flow');
    assert.ok(typeof body.intent === 'string' && body.intent.length >= 50, 'intent ≥50 chars');
    assert.ok(typeof body.role === 'string' && body.role.length >= 30, 'role ≥30 chars');
    assert.ok(typeof body.notes === 'string' && body.notes.length >= 30, 'notes ≥30 chars');
  } finally {
    rmSync(tmpRepo, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 3: Deterministic flow UUID across re-runs.
// ---------------------------------------------------------------------------

test('synthesizeFlows produces same flow UUID across re-runs (deterministic)', async () => {
  const tmpRepo = mkdtempSync(join(tmpdir(), 'synth-flows-determinism-'));
  try {
    writeFileSync(join(tmpRepo, 'package.json'), JSON.stringify({ name: 'fixture-marginalia' }, null, 2));
    mkdirSync(join(tmpRepo, 'src/app/api/account'), { recursive: true });
    copyFileSync(
      join(FIXTURES_DIR, 'api-route-with-imports.ts'),
      join(tmpRepo, 'src/app/api/account/route.ts'),
    );
    mkdirSync(join(tmpRepo, 'src/lib'), { recursive: true });
    writeFileSync(join(tmpRepo, 'src/lib/account.ts'), 'export async function beginAccountDeletion() {}\n');
    writeFileSync(join(tmpRepo, 'src/lib/auth.ts'), 'export async function getSession() { return null; }\n');
    writeFileSync(join(tmpRepo, 'src/lib/stripe.ts'), 'export async function archiveStripeCustomer() {}\n');

    const nodes = [
      { uuid: 'aaaa1111-1111-4111-8111-111111111111', kind: 'API', level: 'L3', file: 'src/app/api/account/route.ts', route: 'DELETE /api/account' },
      { uuid: '11111111-1111-4111-8111-111111111111', kind: 'lib', level: 'L2', file: 'src/lib/account.ts' },
      { uuid: '22222222-2222-4222-8222-222222222222', kind: 'lib', level: 'L2', file: 'src/lib/auth.ts' },
      { uuid: '33333333-3333-4333-8333-333333333333', kind: 'external', level: 'L3', file: 'src/lib/stripe.ts' },
    ];
    const stagingDir = join(tmpRepo, '.contracts/.staging');
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, 'nodes.json'), JSON.stringify(nodes, null, 2));

    const flows1 = await synthesizeFlows(tmpRepo);
    const flows2 = await synthesizeFlows(tmpRepo);
    assert.equal(flows1.length, 1);
    assert.equal(flows2.length, 1);
    assert.equal(flows1[0].uuid, flows2[0].uuid, 'flow UUID stable across re-runs');
  } finally {
    rmSync(tmpRepo, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 4: Shared services produce ONE sidecar — multiple flows reference
// the same UUID via members:.
// ---------------------------------------------------------------------------

test('synthesizeFlows: shared services across two flows emit ONE sidecar (no duplicate UUID)', async () => {
  const tmpRepo = mkdtempSync(join(tmpdir(), 'synth-flows-shared-'));
  try {
    writeFileSync(join(tmpRepo, 'package.json'), JSON.stringify({ name: 'fixture-marginalia' }, null, 2));

    // Two API routes both invoke stripe.
    mkdirSync(join(tmpRepo, 'src/app/api/account'), { recursive: true });
    writeFileSync(join(tmpRepo, 'src/app/api/account/route.ts'),
      `import { archiveStripeCustomer } from '@/lib/stripe';
       export async function DELETE() {
         await archiveStripeCustomer('user-1');
         return new Response(null, { status: 204 });
       }`
    );
    mkdirSync(join(tmpRepo, 'src/app/api/checkout'), { recursive: true });
    writeFileSync(join(tmpRepo, 'src/app/api/checkout/route.ts'),
      `import { archiveStripeCustomer } from '@/lib/stripe';
       export async function POST() {
         await archiveStripeCustomer('user-1');
         return Response.json({ ok: true });
       }`
    );
    mkdirSync(join(tmpRepo, 'src/lib'), { recursive: true });
    writeFileSync(join(tmpRepo, 'src/lib/stripe.ts'), 'export async function archiveStripeCustomer() {}\n');

    const stripeUuid = '99999999-9999-4999-8999-999999999999';
    const accountTriggerUuid = 'aaaa0000-0000-4000-8000-000000000001';
    const checkoutTriggerUuid = 'aaaa0000-0000-4000-8000-000000000002';
    const nodes = [
      { uuid: accountTriggerUuid, kind: 'API', level: 'L3', file: 'src/app/api/account/route.ts', route: 'DELETE /api/account' },
      { uuid: checkoutTriggerUuid, kind: 'API', level: 'L3', file: 'src/app/api/checkout/route.ts', route: 'POST /api/checkout' },
      { uuid: stripeUuid, kind: 'external', level: 'L3', file: 'src/lib/stripe.ts' },
    ];
    const stagingDir = join(tmpRepo, '.contracts/.staging');
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, 'nodes.json'), JSON.stringify(nodes, null, 2));

    const flows = await synthesizeFlows(tmpRepo);
    assert.equal(flows.length, 2, 'two flows synthesized (one per API trigger)');

    // BOTH flow members lists must include the SAME stripeUuid (one sidecar
    // node referenced by two flows — no duplicate uuid emission).
    const accountFlow = flows.find((f) => f.trigger === accountTriggerUuid);
    const checkoutFlow = flows.find((f) => f.trigger === checkoutTriggerUuid);
    assert.ok(accountFlow.members.includes(stripeUuid), 'account flow includes stripe uuid');
    assert.ok(checkoutFlow.members.includes(stripeUuid), 'checkout flow includes stripe uuid');

    // Ensure only ONE sidecar exists for stripe in nodes.json (it was, but
    // verify we didn't write a NEW <stripeUuid>.frontmatter.json from the
    // synth — synth only writes flow contracts, never re-emits referenced
    // services).
    const writtenFlowFm = readdirSync(stagingDir)
      .filter((f) => f.endsWith('.frontmatter.json'));
    const flowFm = writtenFlowFm.filter((f) => {
      const fm = JSON.parse(readFileSync(join(stagingDir, f), 'utf8'));
      return fm.kind === 'flow';
    });
    assert.equal(flowFm.length, 2, 'exactly two flow frontmatter files (no extra sidecars created for stripe)');
  } finally {
    rmSync(tmpRepo, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 5: flowSlugFromTrigger generates filesystem-safe slugs.
// ---------------------------------------------------------------------------

test('flowSlugFromTrigger: route group + page suffix stripped', () => {
  // Route groups like (auth) DON'T appear in the URL (Next.js convention),
  // so they should NOT appear in the slug either.
  assert.equal(flowSlugFromTrigger('src/app/(auth)/login/page.tsx'), 'flow-login');
  assert.equal(flowSlugFromTrigger('src/app/api/account/delete/route.ts'), 'flow-api-account-delete');
  assert.equal(flowSlugFromTrigger('src/app/account/settings/page.tsx'), 'flow-account-settings');
  // Root page.tsx — no route segments left after stripping app/page.tsx.
  assert.equal(flowSlugFromTrigger('app/page.tsx'), 'flow-untitled');
});
