/**
 * Phase 9 FLOW-01: tests for layoutFlowMembers pure function.
 *
 * Run with: npx vitest run src/lib/__tests__/flow-layout.test.ts
 */
import { describe, it, expect } from 'vitest';
import { layoutFlowMembers, VERTICAL_GAP_PX, TRIGGER_Y } from '../flow-layout';

const makeNodeMap = (uuids: string[]): Map<string, { uuid: string }> => {
  return new Map(uuids.map((uuid) => [uuid, { uuid }]));
};

describe('layoutFlowMembers', () => {
  it('returns empty array for empty members', () => {
    const result = layoutFlowMembers([], makeNodeMap(['a', 'b']));
    expect(result).toEqual([]);
  });

  it('returns one entry for single-member flow (trigger only)', () => {
    const members = ['trigger-uuid'];
    const allNodes = makeNodeMap(['trigger-uuid']);
    const result = layoutFlowMembers(members, allNodes);

    expect(result).toHaveLength(1);
    expect(result[0].uuid).toBe('trigger-uuid');
    expect(result[0].y).toBe(TRIGGER_Y);
    expect(result[0].index).toBe(0);
    expect(result[0].role).toBe('trigger');
  });

  it('assigns y=0 to trigger and correct y to participants', () => {
    const members = ['trigger', 'part1', 'part2'];
    const allNodes = makeNodeMap(['trigger', 'part1', 'part2']);
    const result = layoutFlowMembers(members, allNodes);

    expect(result).toHaveLength(3);

    expect(result[0].uuid).toBe('trigger');
    expect(result[0].y).toBe(0);
    expect(result[0].role).toBe('trigger');

    expect(result[1].uuid).toBe('part1');
    expect(result[1].y).toBe(VERTICAL_GAP_PX);     // 1 * 120 = 120
    expect(result[1].role).toBe('participant');

    expect(result[2].uuid).toBe('part2');
    expect(result[2].y).toBe(2 * VERTICAL_GAP_PX); // 2 * 120 = 240
    expect(result[2].role).toBe('participant');
  });

  it('produces correct y-positions for 7-member delete-account chain', () => {
    const members = [
      'a0000000', // trigger: Account Settings UI
      'e1000000', // POST /api/account/delete
      'e2000000', // beginAccountDeletion
      'e5000000', // db.user.update
      'e7000000', // stripe.customers.update
      'e8000000', // mailchimp.suppress
      'e9000000', // sendDeletionConfirmationEmail
    ];
    const allNodes = makeNodeMap(members);
    const result = layoutFlowMembers(members, allNodes);

    expect(result).toHaveLength(7);
    result.forEach((entry, i) => {
      expect(entry.y).toBe(i * VERTICAL_GAP_PX);
      expect(entry.index).toBe(i);
    });
    // y-positions: 0, 120, 240, 360, 480, 600, 720
    expect(result[6].y).toBe(720);
  });

  it('omits members not present in allNodes', () => {
    const members = ['trigger', 'missing-uuid', 'part2'];
    const allNodes = makeNodeMap(['trigger', 'part2']); // 'missing-uuid' absent

    const result = layoutFlowMembers(members, allNodes);

    // 'missing-uuid' is omitted; trigger and part2 remain
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.uuid)).toEqual(['trigger', 'part2']);
    // Indices are preserved from the original members array
    expect(result[0].index).toBe(0);
    expect(result[1].index).toBe(2);
    // y-positions based on original indices, not re-indexed
    expect(result[0].y).toBe(0);
    expect(result[1].y).toBe(2 * VERTICAL_GAP_PX);
  });

  it('VERTICAL_GAP_PX is 120', () => {
    expect(VERTICAL_GAP_PX).toBe(120);
  });

  it('TRIGGER_Y is 0', () => {
    expect(TRIGGER_Y).toBe(0);
  });
});
