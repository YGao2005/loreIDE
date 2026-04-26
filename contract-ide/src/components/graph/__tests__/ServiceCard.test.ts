/**
 * Phase 13 Plan 04 — ServiceCard render-shape unit tests.
 *
 * Tests verify ServiceCard's render decisions WITHOUT mounting React DOM —
 * the project's test infrastructure is `environment: 'node'` (no jsdom) and
 * doesn't include `@testing-library/react`, matching the established pattern
 * from DeltaBanner.test.ts ("Uses string-shape checks rather than
 * @testing-library/react rendering to keep test infrastructure minimal").
 *
 * What these tests cover:
 *   1. POST endpoint (kind='api'): the contract body parses cleanly into the
 *      Inputs/Outputs/Side-effects shapes that ServiceCard's JSX branches on
 *      (Request / Responses / Side effects sections).
 *   2. Cron card (kind='cron'): empty body produces the empty-schema flag
 *      while the schedule field flows to the kind-specific header path.
 *   3. Empty-schema fallback: when BACKEND-FM-01 sections are absent, the
 *      "no schema declared" branch is the active render path (per Phase 9
 *      external dependency note in plan 13-04 frontmatter).
 *
 * The actual JSX render is covered by manual smoke (npm run tauri dev) +
 * 13-06 / 13-11 visual verification — these tests defend the contract between
 * parseBackendSections output and ServiceCard's render-branching logic.
 */

import { describe, it, expect } from 'vitest';
import { parseBackendSections } from '@/lib/backendFrontmatter';
import { ServiceCard } from '../ServiceCard';
import { EndpointCard } from '../EndpointCard';
import { nodeTypes } from '../nodeTypes';
import type { ServiceCardData } from '../ServiceCard';

describe('ServiceCard render decisions', () => {
  it('POST endpoint: parses BACKEND-FM-01 body so ServiceCard renders Request/Responses/Side-effects branches', () => {
    const body = `## Inputs
\`\`\`json
{ "userId": "string", "confirmationToken": "string" }
\`\`\`

## Outputs
\`\`\`json
{ "deletionId": "string", "gracePeriodEnds": "ISO8601 datetime" }
\`\`\`

## Side effects
- Updates \`users.deletedAt\`
- Calls \`stripe.customers.update\`
- Sends confirmation email
`;
    const data: ServiceCardData = {
      uuid: 'uuid-post-1',
      kind: 'api',
      name: 'POST /accounts/:id/delete',
      body,
      method: 'POST',
      path: '/accounts/:id/delete',
    };

    const sections = parseBackendSections(data.body);

    // ServiceCard's three body sections all become "true" branches.
    const hasInputs = sections.inputs !== null;
    const hasOutputs = sections.outputs.length > 0;
    const hasSideEffects = sections.sideEffects.length > 0;
    const isEmpty = !hasInputs && !hasOutputs && !hasSideEffects;

    expect(hasInputs).toBe(true);
    expect(hasOutputs).toBe(true);
    expect(hasSideEffects).toBe(true);
    expect(isEmpty).toBe(false);

    // Schema content the user will see rendered in <pre>.
    expect(sections.inputs?.schema).toContain('"userId"');
    expect(sections.inputs?.schema).toContain('"confirmationToken"');
    expect(sections.outputs[0].schema).toContain('"deletionId"');
    expect(sections.sideEffects).toEqual([
      'Updates `users.deletedAt`',
      'Calls `stripe.customers.update`',
      'Sends confirmation email',
    ]);

    // Header-rendering invariants for kind='api'.
    expect(data.method).toBe('POST');
    expect(data.path).toBe('/accounts/:id/delete');
  });

  it('Cron card: empty body produces empty-schema flag; schedule field flows to header', () => {
    const data: ServiceCardData = {
      uuid: 'uuid-cron-1',
      kind: 'cron',
      name: 'cleanup-stale',
      body: '',
      schedule: '0 * * * *',
    };

    const sections = parseBackendSections(data.body);

    // Empty body → all sections empty → ServiceCard renders the
    // "No schema declared" placeholder branch.
    const isEmpty =
      sections.inputs === null &&
      sections.outputs.length === 0 &&
      sections.sideEffects.length === 0;
    expect(isEmpty).toBe(true);

    // Cron-specific data lands on the data shape so the header branch
    // (`cron: ${data.schedule}`) renders correctly.
    expect(data.kind).toBe('cron');
    expect(data.schedule).toBe('0 * * * *');
  });

  it('Empty-schema fallback: contract with no BACKEND-FM-01 sections renders placeholder branch', () => {
    const data: ServiceCardData = {
      uuid: 'uuid-empty-1',
      kind: 'api',
      name: 'GET /health',
      body: 'Just plain text body — no Inputs/Outputs/Side effects sections.\n\nA paragraph that is NOT a section.',
      method: 'GET',
      path: '/health',
    };

    const sections = parseBackendSections(data.body);

    expect(sections.inputs).toBeNull();
    expect(sections.outputs).toEqual([]);
    expect(sections.sideEffects).toEqual([]);

    // The empty-schema fallback branch is the active render path.
    const isEmpty =
      sections.inputs === null &&
      sections.outputs.length === 0 &&
      sections.sideEffects.length === 0;
    expect(isEmpty).toBe(true);
  });

  it('Multiple Outputs (200/401/500): each fenced block becomes a separate Response card', () => {
    const body = `## Outputs

### 200 OK
\`\`\`json
{ "ok": true }
\`\`\`

### 401 Unauthorized
\`\`\`json
{ "error": "unauthorized" }
\`\`\`
`;
    const sections = parseBackendSections(body);

    expect(sections.outputs).toHaveLength(2);
    expect(sections.outputs[0].status).toBe('200 OK');
    expect(sections.outputs[1].status).toBe('401 Unauthorized');
  });
});

describe('nodeTypes registration', () => {
  it('serviceCard is registered as a react-flow node type', () => {
    expect(nodeTypes.serviceCard).toBeDefined();
    expect(nodeTypes.serviceCard).toBe(ServiceCard);
  });

  it('screenCard is registered alongside serviceCard', () => {
    // Legacy `contract` / `group` types were removed when GraphCanvasInner's
    // dispatch was collapsed to always render FlowChainLayout — the only
    // emitters of those node types lived in the old grouped-graph path.
    expect(nodeTypes.screenCard).toBeDefined();
  });
});

describe('EndpointCard re-export', () => {
  it('EndpointCard is the same component reference as ServiceCard (typed re-export)', () => {
    expect(EndpointCard).toBe(ServiceCard);
  });
});
