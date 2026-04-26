/**
 * Phase 13 Plan 06 — CHAIN-01 / CHAIN-02 unit tests for flowChainAssembler.
 *
 * Test infrastructure parity with plan 13-04 / 13-05: vitest .test.ts (NOT
 * .test.tsx), `environment: 'node'`, no jsdom, no @testing-library/react.
 * The assembler is a pure synchronous function so DOM mounting is unnecessary.
 *
 * Coverage:
 *   1. Order: nodes appear top-to-bottom in `members` array order.
 *   2. ScreenCard vs ServiceCard selection — first member with kind:'UI' →
 *      screenCard; otherwise serviceCard.
 *   3. Trigger kind switching — kind:'API' as trigger uses serviceCard.
 *   4. Defensive: missing member uuids skipped silently.
 *   5. Edges connect every consecutive pair; first node has none.
 *   6. isFocused flag flows to ScreenCard data when thisFlowUuid ===
 *      focusedFlowUuid.
 *   7. deriveCallShape: matched shared keys → `{ ... }` label.
 *   8. deriveCallShape: no shared keys → `?` with matched: false.
 *   9. deriveCallShape: missing sections → `?` with matched: false.
 */

import { describe, it, expect } from 'vitest';
import {
  assembleFlowChain,
  deriveCallShape,
} from '@/lib/flowChainAssembler';
import type { ContractNode } from '@/ipc/types';

/** Build a minimal ContractNode-shaped fixture. */
function mkNode(partial: Partial<ContractNode> & { uuid: string; name: string; kind: string }): ContractNode {
  return {
    uuid: partial.uuid,
    level: partial.level ?? 'L3',
    name: partial.name,
    kind: partial.kind,
    code_ranges: [],
    parent_uuid: partial.parent_uuid ?? null,
    is_canonical: true,
    code_hash: null,
    contract_hash: null,
    human_pinned: false,
    route: partial.route ?? null,
    derived_at: null,
    contract_body: partial.contract_body ?? null,
    tags: [],
    rollup_generation: 0,
    members: partial.members,
  };
}

describe('assembleFlowChain', () => {
  it('orders nodes top-to-bottom by members array', () => {
    const allNodes: ContractNode[] = [
      mkNode({ uuid: 'a', name: 'Account Settings', kind: 'UI' }),
      mkNode({ uuid: 'b', name: 'POST /api/account', kind: 'API', route: 'POST /api/account' }),
      mkNode({ uuid: 'c', name: 'beginAccountDeletion', kind: 'lib' }),
    ];

    const { nodes, edges } = assembleFlowChain(['a', 'b', 'c'], allNodes, null, 'flow-1');

    // Nodes preserved in members order.
    expect(nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    // Increasing y coordinates — top-to-bottom layout.
    expect(nodes[0].position.y).toBe(0);
    expect(nodes[1].position.y).toBeGreaterThan(0);
    expect(nodes[2].position.y).toBeGreaterThan(nodes[1].position.y);
    // Edges: 2 between 3 nodes.
    expect(edges.length).toBe(2);
    expect(edges[0].source).toBe('a');
    expect(edges[0].target).toBe('b');
    expect(edges[1].source).toBe('b');
    expect(edges[1].target).toBe('c');
  });

  it('uses screenCard for trigger when kind is UI (uppercase)', () => {
    const allNodes: ContractNode[] = [
      mkNode({ uuid: 'a', name: 'Account Settings', kind: 'UI', route: '/account/settings' }),
    ];
    const { nodes } = assembleFlowChain(['a'], allNodes, null, 'flow-1');
    expect(nodes[0].type).toBe('screenCard');
    // ScreenCardData carries route + isFocused.
    const data = nodes[0].data as { uuid: string; name: string; route: string; isFocused?: boolean };
    expect(data.uuid).toBe('a');
    expect(data.route).toBe('/account/settings');
  });

  it('uses serviceCard when trigger kind is API (no UI)', () => {
    const allNodes: ContractNode[] = [
      mkNode({ uuid: 'a', name: 'POST /webhook', kind: 'API', route: 'POST /webhook' }),
    ];
    const { nodes } = assembleFlowChain(['a'], allNodes, null, 'flow-1');
    expect(nodes[0].type).toBe('serviceCard');
    // ServiceCardData carries kind in lowercase + parsed method/path.
    const data = nodes[0].data as { uuid: string; kind: string; method?: string; path?: string };
    expect(data.kind).toBe('api');
    expect(data.method).toBe('POST');
    expect(data.path).toBe('/webhook');
  });

  it('skips missing member uuids gracefully', () => {
    const allNodes: ContractNode[] = [
      mkNode({ uuid: 'a', name: 'A', kind: 'UI', route: '/a' }),
    ];
    const { nodes, edges } = assembleFlowChain(
      ['a', 'missing-uuid', 'also-missing'],
      allNodes,
      null,
      'flow-1',
    );
    expect(nodes.length).toBe(1);
    expect(edges.length).toBe(0);
  });

  it('flows isFocused=true to ScreenCard data when thisFlowUuid === focusedFlowUuid', () => {
    const allNodes: ContractNode[] = [
      mkNode({ uuid: 'a', name: 'Settings', kind: 'UI', route: '/settings' }),
    ];
    const { nodes } = assembleFlowChain(['a'], allNodes, 'flow-1', 'flow-1');
    const data = nodes[0].data as { isFocused?: boolean };
    expect(data.isFocused).toBe(true);
  });

  it('flows isFocused=false to ScreenCard data when this flow is NOT the focused one', () => {
    const allNodes: ContractNode[] = [
      mkNode({ uuid: 'a', name: 'Settings', kind: 'UI', route: '/settings' }),
    ];
    const { nodes } = assembleFlowChain(['a'], allNodes, 'flow-1', 'flow-2');
    const data = nodes[0].data as { isFocused?: boolean };
    expect(data.isFocused).toBe(false);
  });

  it('emits CallShape edges with type:callShape and matched data when schemas align', () => {
    const allNodes: ContractNode[] = [
      mkNode({
        uuid: 'src',
        name: 'POST /api/x',
        kind: 'API',
        route: 'POST /api/x',
        contract_body: '## Outputs\n```json\n{ "userId": "string", "deletedAt": "string" }\n```',
      }),
      mkNode({
        uuid: 'dst',
        name: 'beginDelete',
        kind: 'lib',
        contract_body: '## Inputs\n```json\n{ "userId": "string", "extra": "string" }\n```',
      }),
    ];
    const { edges } = assembleFlowChain(['src', 'dst'], allNodes, null, 'f');
    expect(edges).toHaveLength(1);
    expect(edges[0].type).toBe('callShape');
    const cs = edges[0].data as { label: string; matched: boolean };
    expect(cs.matched).toBe(true);
    expect(cs.label).toContain('userId');
  });

  it('returns empty result for empty members array', () => {
    const allNodes: ContractNode[] = [
      mkNode({ uuid: 'a', name: 'A', kind: 'UI' }),
    ];
    const { nodes, edges } = assembleFlowChain([], allNodes, null, 'flow-1');
    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);
  });

  it('lowercases service kinds for ServiceCard (UI special-cased upstream)', () => {
    const allNodes: ContractNode[] = [
      // Trigger UI to anchor the chain — ScreenCard.
      mkNode({ uuid: 'a', name: 'A', kind: 'UI', route: '/a' }),
      // Subsequent participants with various on-disk casings.
      mkNode({ uuid: 'b', name: 'B', kind: 'lib' }),
      mkNode({ uuid: 'c', name: 'C', kind: 'data' }),
      mkNode({ uuid: 'd', name: 'D', kind: 'external' }),
    ];
    const { nodes } = assembleFlowChain(['a', 'b', 'c', 'd'], allNodes, null, 'flow-1');
    expect(nodes[0].type).toBe('screenCard');
    expect((nodes[1].data as { kind: string }).kind).toBe('lib');
    expect((nodes[2].data as { kind: string }).kind).toBe('data');
    expect((nodes[3].data as { kind: string }).kind).toBe('external');
  });
});

describe('deriveCallShape', () => {
  it('returns shared keys label when both bodies have JSON schemas with overlap', () => {
    const prev = '## Outputs\n```json\n{ "userId": "string", "deletedAt": "ISO8601" }\n```';
    const next = '## Inputs\n```json\n{ "userId": "string", "extra": "true" }\n```';
    const shape = deriveCallShape(prev, next);
    expect(shape.matched).toBe(true);
    expect(shape.label).toContain('userId');
    expect(shape.label).toMatch(/^\{ .* \}$/);
  });

  it('returns ? when no shared keys', () => {
    const prev = '## Outputs\n```json\n{ "a": "1" }\n```';
    const next = '## Inputs\n```json\n{ "b": "1" }\n```';
    const shape = deriveCallShape(prev, next);
    expect(shape.label).toBe('?');
    expect(shape.matched).toBe(false);
  });

  it('returns ? when sections missing', () => {
    expect(deriveCallShape('', '').label).toBe('?');
    expect(deriveCallShape('', '').matched).toBe(false);
  });

  it('returns ? when prev has no Outputs section', () => {
    const prev = '## Side effects\n- does a thing';
    const next = '## Inputs\n```json\n{ "a": "1" }\n```';
    const shape = deriveCallShape(prev, next);
    expect(shape.label).toBe('?');
    expect(shape.matched).toBe(false);
  });

  it('returns ? when next has no Inputs section', () => {
    const prev = '## Outputs\n```json\n{ "a": "1" }\n```';
    const next = '## Side effects\n- writes db';
    const shape = deriveCallShape(prev, next);
    expect(shape.label).toBe('?');
    expect(shape.matched).toBe(false);
  });

  it('returns ? when JSON cannot be parsed (invalid JSON content)', () => {
    const prev = '## Outputs\n```json\nnot-valid-json {{\n```';
    const next = '## Inputs\n```json\n{ "a": "1" }\n```';
    const shape = deriveCallShape(prev, next);
    expect(shape.label).toBe('?');
    expect(shape.matched).toBe(false);
  });
});
