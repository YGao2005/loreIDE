/**
 * Phase 13 Plan 04: Backend frontmatter section parser.
 *
 * Phase 9 BACKEND-FM-01 ships every backend participant contract (kinds:
 * `API / lib / data / external / job / cron / event`) with populated
 * `## Inputs` / `## Outputs` / `## Side effects` markdown sections in the
 * contract body. ServiceCard renders these sections as Stripe-API-docs-style
 * structured content (request schema · response schemas · side-effects list).
 *
 * Defensive posture (per 13-04 PLAN external_phase_dependencies): this parser
 * MUST tolerate Phase 9 BACKEND-FM-01 not being shipped yet — when the body
 * has no `## Inputs` etc., return all-null/empty so ServiceCard can render
 * a "No schema declared (BACKEND-FM-01 not populated)" placeholder rather
 * than crashing.
 *
 * Multiple Outputs: some endpoints have 200/401/500 variants. `## Outputs`
 * may contain multiple fenced JSON blocks separated by status-line subheadings
 * like `### 200 OK` or `### 401 Unauthorized`. Each block is parsed as a
 * separate output entry; if the section contains a single fenced block with
 * no subheadings, just one entry is returned.
 *
 * Format we control: line-based parsing is intentional — adding a markdown
 * library dependency for one file would be over-engineered for a content
 * format the team owns end-to-end.
 */

export interface BackendSection {
  /** Raw schema text (JSON / text body). Trimmed, no fence markers. */
  schema: string;
  /** Format detected from the fence marker (```json vs ```). */
  format: 'json' | 'text';
  /** Optional status label parsed from `### 200 OK` / `### 401 Unauthorized`. */
  status?: string;
  /** Original raw fenced block including marker (for debug / round-trip). */
  raw: string;
}

export interface BackendSections {
  /** First fenced block under `## Inputs`. Null if section absent. */
  inputs: BackendSection | null;
  /**
   * One entry per fenced block under `## Outputs`. Status subheadings (`### 200 OK`)
   * are attached to the next fenced block. Empty array if section absent.
   */
  outputs: BackendSection[];
  /** Bulleted list items under `## Side effects`. Empty array if section absent. */
  sideEffects: string[];
}

/**
 * Parse a contract body (markdown) into BackendSections.
 *
 * @param body Raw contract body markdown (the part after the YAML frontmatter).
 *             Empty string or null-ish input returns all-empty sections.
 */
export function parseBackendSections(body: string): BackendSections {
  if (!body || typeof body !== 'string') {
    return { inputs: null, outputs: [], sideEffects: [] };
  }

  const inputsLines = extractSectionLines(body, 'Inputs');
  const outputsLines = extractSectionLines(body, 'Outputs');
  const sideEffectsLines = extractSectionLines(body, 'Side effects');

  return {
    inputs: inputsLines !== null ? parseFirstFencedBlock(inputsLines) : null,
    outputs: outputsLines !== null ? parseAllFencedBlocks(outputsLines) : [],
    sideEffects: sideEffectsLines !== null ? parseSideEffectsLines(sideEffectsLines) : [],
  };
}

/**
 * Extract the lines BETWEEN the `## <heading>` line and the next `## ` heading
 * (or end of body), excluding the heading line itself.
 *
 * Returns null if the section heading is not found in the body.
 * Case-insensitive on heading text. Tolerant of trailing whitespace.
 *
 * Line-based scan rather than regex because regex with `^` / `$` and multiline
 * needs careful escape handling that's not worth the risk for a controlled
 * format.
 */
function extractSectionLines(body: string, headingName: string): string[] | null {
  const lines = body.split('\n');
  const target = headingName.toLowerCase();
  let startIdx = -1;
  let endIdx = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match `## <heading>` (exactly two #, then whitespace, then the name).
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const name = m[1].toLowerCase();
    if (startIdx === -1 && name === target) {
      startIdx = i + 1;
    } else if (startIdx !== -1) {
      // We've found our section start AND we're now at the next ## heading
      // (any name) — close the section.
      endIdx = i;
      break;
    }
  }

  if (startIdx === -1) return null;
  return lines.slice(startIdx, endIdx);
}

/**
 * Find the first ```fence```-block in a slice of lines and return it as a
 * BackendSection. Returns null if no fenced block found.
 */
function parseFirstFencedBlock(lines: string[]): BackendSection | null {
  const blocks = parseAllFencedBlocks(lines);
  return blocks.length > 0 ? blocks[0] : null;
}

/**
 * Walk a slice of lines and emit one BackendSection per ```fence```-block,
 * attaching the most recent `### <status>` subheading to the next fenced
 * block (and consuming it after attachment).
 */
function parseAllFencedBlocks(lines: string[]): BackendSection[] {
  const out: BackendSection[] = [];
  let pendingStatus: string | undefined = undefined;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // ### <status>  → attach to next fenced block
    const statusMatch = /^###\s+(.+?)\s*$/.exec(line);
    if (statusMatch) {
      pendingStatus = statusMatch[1];
      i++;
      continue;
    }

    // ```<lang>  → consume body until closing ```
    const fenceOpenMatch = /^```([a-zA-Z0-9_-]*)\s*$/.exec(line);
    if (fenceOpenMatch) {
      const lang = fenceOpenMatch[1].toLowerCase();
      const bodyLines: string[] = [];
      let j = i + 1;
      while (j < lines.length && !/^```\s*$/.test(lines[j])) {
        bodyLines.push(lines[j]);
        j++;
      }
      // j is on closing ``` or end-of-lines.
      const rawBody = bodyLines.join('\n');
      const raw = `\`\`\`${fenceOpenMatch[1]}\n${rawBody}\n\`\`\``;
      out.push({
        schema: rawBody.trim(),
        format: lang === 'json' ? 'json' : 'text',
        status: pendingStatus,
        raw,
      });
      pendingStatus = undefined;
      // Skip past the closing fence (or to end if unterminated).
      i = j + 1;
      continue;
    }

    i++;
  }
  return out;
}

/**
 * Parse a slice of lines as a bulleted list — `-`, `*`, `+` markers.
 *
 * Tolerant of leading whitespace; preserves inline backticks (the renderer
 * may want to detect code-like items via the backtick markers).
 */
function parseSideEffectsLines(lines: string[]): string[] {
  const items: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = /^[-*+]\s+(.+)$/.exec(trimmed);
    if (m) items.push(m[1].trim());
  }
  return items;
}
