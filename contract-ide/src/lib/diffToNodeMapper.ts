// Phase 13 Plan 08 — Pure unified-diff parser + file/line → ContractNode uuid mapper.
//
// Two pure functions:
//   parseDiffHunks(diffText)  — split a unified diff into per-hunk records.
//   mapDiffToNodes(hunks, nodeRanges) — return Set<uuid> of nodes whose
//     code_ranges overlap any hunk on a matching file path.
//
// Used by PRReviewPanel (TS-side) for the local affected-set preview while
// the analyze_pr_diff Rust IPC does the authoritative DB-backed join in
// the background. This file is also the testable kernel for vitest coverage.

export interface DiffHunk {
  filePath: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  rawHunk: string;
}

/**
 * Parse a unified diff text into hunks.
 *
 * Accepts standard `git diff` output. Handles:
 *   diff --git a/path b/path
 *   --- a/path
 *   +++ b/path
 *   @@ -OLD,L +NEW,L @@
 *
 * Returns ALL hunks across ALL files in the diff. The `+++` line is the
 * source of truth for the file path (handles renames where `---` differs).
 */
export function parseDiffHunks(diffText: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  if (!diffText) return hunks;
  const lines = diffText.split('\n');
  let currentFile: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('+++ ')) {
      // Match `+++ b/path` or `+++ /dev/null` (deleted file — skip).
      const match = line.match(/^\+\+\+ b\/(.+?)\s*$/);
      if (match) {
        currentFile = match[1];
      } else {
        currentFile = null;
      }
      continue;
    }
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch && currentFile) {
      const oldStart = parseInt(hunkMatch[1], 10);
      const oldLines = hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1;
      const newStart = parseInt(hunkMatch[3], 10);
      const newLines = hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1;

      const rawLines: string[] = [line];
      let j = i + 1;
      while (
        j < lines.length &&
        !lines[j].startsWith('@@') &&
        !lines[j].startsWith('+++ ') &&
        !lines[j].startsWith('diff ')
      ) {
        rawLines.push(lines[j]);
        j++;
      }
      hunks.push({
        filePath: currentFile,
        oldStart,
        oldLines,
        newStart,
        newLines,
        rawHunk: rawLines.join('\n'),
      });
    }
  }

  return hunks;
}

export interface NodeCodeRange {
  uuid: string;
  file: string;
  startLine?: number;
  endLine?: number;
}

/**
 * Map diff hunks to ContractNode uuids by file path + line range overlap.
 *
 * For each hunk, find all nodes whose code_ranges have:
 *   - file === hunk.filePath (exact string match — paths normalised at IPC layer)
 *   - line range overlaps the hunk's NEW line range
 *
 * Nodes with no line range (startLine/endLine == null) are conservatively
 * marked affected on any file match — defensive for atoms whose code_ranges
 * frontmatter only carries a file string.
 *
 * Returns a Set of uuids (deduped across overlapping hunks).
 */
export function mapDiffToNodes(
  hunks: DiffHunk[],
  nodeRanges: NodeCodeRange[],
): Set<string> {
  const affected = new Set<string>();
  for (const hunk of hunks) {
    const hunkStart = hunk.newStart;
    const hunkEnd = hunk.newStart + Math.max(hunk.newLines - 1, 0);
    for (const node of nodeRanges) {
      if (node.file !== hunk.filePath) continue;
      if (node.startLine == null || node.endLine == null) {
        affected.add(node.uuid);
        continue;
      }
      if (node.endLine >= hunkStart && node.startLine <= hunkEnd) {
        affected.add(node.uuid);
      }
    }
  }
  return affected;
}
