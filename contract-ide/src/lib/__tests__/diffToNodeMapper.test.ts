import { describe, it, expect } from 'vitest';
import { parseDiffHunks, mapDiffToNodes } from '../diffToNodeMapper';

const SAMPLE_DIFF = `diff --git a/lib/account/beginAccountDeletion.ts b/lib/account/beginAccountDeletion.ts
index abc123..def456 100644
--- a/lib/account/beginAccountDeletion.ts
+++ b/lib/account/beginAccountDeletion.ts
@@ -10,5 +10,7 @@ export async function beginAccountDeletion(userId: string) {
   const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
+  // 1. Soft-delete with 30-day grace
+  await db.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });
diff --git a/app/account/settings/page.tsx b/app/account/settings/page.tsx
index 111..222 100644
--- a/app/account/settings/page.tsx
+++ b/app/account/settings/page.tsx
@@ -50,3 +50,5 @@ export default function AccountSettings() {
+  <DangerActionButton onClick={requestDeletion} confirmation="email-link">Delete Account</DangerActionButton>
`;

describe('parseDiffHunks', () => {
  it('parses two-file diff into hunks', () => {
    const hunks = parseDiffHunks(SAMPLE_DIFF);
    expect(hunks.length).toBe(2);
    expect(hunks[0].filePath).toBe('lib/account/beginAccountDeletion.ts');
    expect(hunks[0].newStart).toBe(10);
    expect(hunks[0].newLines).toBe(7);
    expect(hunks[1].filePath).toBe('app/account/settings/page.tsx');
    expect(hunks[1].newStart).toBe(50);
    expect(hunks[1].newLines).toBe(5);
  });

  it('returns empty array on empty input', () => {
    expect(parseDiffHunks('')).toEqual([]);
  });
});

describe('mapDiffToNodes', () => {
  it('maps file+line-overlap to uuid', () => {
    const hunks = parseDiffHunks(SAMPLE_DIFF);
    const ranges = [
      {
        uuid: 'uuid-deletion-fn',
        file: 'lib/account/beginAccountDeletion.ts',
        startLine: 8,
        endLine: 30,
      },
      {
        uuid: 'uuid-button',
        file: 'app/account/settings/page.tsx',
        startLine: 48,
        endLine: 60,
      },
      {
        uuid: 'uuid-unrelated',
        file: 'lib/other/thing.ts',
        startLine: 1,
        endLine: 100,
      },
    ];
    const result = mapDiffToNodes(hunks, ranges);
    expect(result.has('uuid-deletion-fn')).toBe(true);
    expect(result.has('uuid-button')).toBe(true);
    expect(result.has('uuid-unrelated')).toBe(false);
  });

  it('treats nodes without line range as affected on file match (conservative)', () => {
    const hunks = parseDiffHunks(SAMPLE_DIFF);
    const ranges = [
      {
        uuid: 'uuid-no-lines',
        file: 'lib/account/beginAccountDeletion.ts',
      },
    ];
    expect(mapDiffToNodes(hunks, ranges).has('uuid-no-lines')).toBe(true);
  });
});
