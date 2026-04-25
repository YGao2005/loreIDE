/**
 * Vitest unit tests for parseBackendSections — the BACKEND-FM-01 section
 * parser used by ServiceCard (Phase 13 Plan 04).
 *
 * Tests verify:
 *   1. Full parse: ## Inputs / ## Outputs / ## Side effects all present.
 *   2. Missing sections: defensive fallback to null/empty (BACKEND-FM-01 not
 *      shipped yet on a given contract).
 *   3. Multiple Outputs: 200 OK / 401 Unauthorized status subheadings produce
 *      separate output entries with status labels attached.
 */
import { describe, it, expect } from 'vitest';
import { parseBackendSections } from '../backendFrontmatter';

describe('parseBackendSections', () => {
  it('parses full BACKEND-FM-01 body — Inputs / Outputs / Side effects', () => {
    const body = `Some preamble paragraph that should be ignored.

## Inputs
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

    const result = parseBackendSections(body);

    // Inputs
    expect(result.inputs).not.toBeNull();
    expect(result.inputs?.format).toBe('json');
    expect(result.inputs?.schema).toContain('"userId"');
    expect(result.inputs?.schema).toContain('"confirmationToken"');

    // Outputs (single — no status subheading)
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0].format).toBe('json');
    expect(result.outputs[0].schema).toContain('"deletionId"');
    expect(result.outputs[0].status).toBeUndefined();

    // Side effects (3 bulleted items)
    expect(result.sideEffects).toHaveLength(3);
    expect(result.sideEffects[0]).toBe('Updates `users.deletedAt`');
    expect(result.sideEffects[1]).toBe('Calls `stripe.customers.update`');
    expect(result.sideEffects[2]).toBe('Sends confirmation email');
  });

  it('returns all-null/empty when sections are missing (BACKEND-FM-01 not populated)', () => {
    const body = `Some preamble.

This contract has no structured sections.

Just plain text body.
`;
    const result = parseBackendSections(body);
    expect(result.inputs).toBeNull();
    expect(result.outputs).toEqual([]);
    expect(result.sideEffects).toEqual([]);
  });

  it('parses multiple Outputs with ### status subheadings (200 / 401 / 500)', () => {
    const body = `## Inputs
\`\`\`json
{ "id": "string" }
\`\`\`

## Outputs

### 200 OK
\`\`\`json
{ "ok": true }
\`\`\`

### 401 Unauthorized
\`\`\`json
{ "error": "unauthorized" }
\`\`\`

### 500 Internal Server Error
\`\`\`json
{ "error": "server_error" }
\`\`\`
`;
    const result = parseBackendSections(body);

    expect(result.outputs).toHaveLength(3);

    expect(result.outputs[0].status).toBe('200 OK');
    expect(result.outputs[0].format).toBe('json');
    expect(result.outputs[0].schema).toContain('"ok"');

    expect(result.outputs[1].status).toBe('401 Unauthorized');
    expect(result.outputs[1].schema).toContain('"unauthorized"');

    expect(result.outputs[2].status).toBe('500 Internal Server Error');
    expect(result.outputs[2].schema).toContain('"server_error"');
  });

  it('handles empty / null-ish body gracefully', () => {
    expect(parseBackendSections('')).toEqual({
      inputs: null,
      outputs: [],
      sideEffects: [],
    });
    // @ts-expect-error — testing defensive null handling at runtime.
    expect(parseBackendSections(null)).toEqual({
      inputs: null,
      outputs: [],
      sideEffects: [],
    });
    // @ts-expect-error — testing defensive undefined handling at runtime.
    expect(parseBackendSections(undefined)).toEqual({
      inputs: null,
      outputs: [],
      sideEffects: [],
    });
  });

  it('parses non-json fenced blocks as text format', () => {
    const body = `## Inputs
\`\`\`
plain text input
\`\`\`
`;
    const result = parseBackendSections(body);
    expect(result.inputs?.format).toBe('text');
    expect(result.inputs?.schema).toBe('plain text input');
  });
});
