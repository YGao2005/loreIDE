import { spawnSync } from 'node:child_process';

// PACT 2025 weights per .planning/research/contract-form/RESEARCH.md.
// Examples + Invariants are highest-leverage for LLM contract adherence;
// Notes is the conventional drop-first section under token pressure.
export const SECTION_WEIGHTS: Record<string, number> = {
  'invariants': 2.0,
  'examples': 2.0,
  'intent': 1.5,
  'role': 1.0,
  'inputs': 1.0,
  'outputs': 1.0,
  'side effects': 0.8,
  'failure modes': 0.8,
  'notes': 0.5,
};

interface ParsedSections {
  section_hashes: Record<string, string>;
  sections: Record<string, string>;  // section name → faithful body text
}

/**
 * Call the section-parser-cli binary (Phase 8 PROP-01) to parse a
 * contract body. Returns the parsed sections (lowercase keys) or null
 * if the parser fails (treated as "section detection unavailable" —
 * caller falls back to BM25 ranking).
 *
 * The CLI emits only `section_hashes` (confirmed by 09-01 verification:
 * echo body | section-parser-cli-aarch64-apple-darwin → {"section_hashes":{...}}).
 * The simpleH2Split fallback is always used for section TEXT since the
 * CLI doesn't emit it. The section_hashes are not needed here (we only
 * need text to locate which section a snippet belongs to).
 */
export function parseSectionsViaCli(
  body: string,
  binaryPath: string,
): ParsedSections | null {
  try {
    const result = spawnSync(binaryPath, [], { input: body, encoding: 'utf-8' });
    if (result.status !== 0) return null;
    const parsed = JSON.parse(result.stdout);
    if (!parsed.section_hashes || typeof parsed.section_hashes !== 'object') return null;
    // 08-01-SUMMARY.md confirms the CLI emits ONLY `section_hashes` (no section text).
    // Use simpleH2Split to get section text for snippet matching.
    const sections = parsed.sections ?? simpleH2Split(body);
    return { section_hashes: parsed.section_hashes, sections };
  } catch {
    return null;
  }
}

/**
 * Fallback H2 splitter — used when section-parser-cli emits hashes
 * but not section text (confirmed behavior for this project). Produces
 * lowercase keys matching the CLI's key convention.
 */
function simpleH2Split(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = body.split('\n');
  let currentSection: string | null = null;
  let currentBody: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (line.trimStart().startsWith('```')) inFence = !inFence;
    if (!inFence && line.startsWith('## ')) {
      if (currentSection !== null) {
        out[currentSection] = currentBody.join('\n').trim();
      }
      currentSection = line.slice(3).trim().toLowerCase();
      currentBody = [];
    } else if (currentSection !== null) {
      currentBody.push(line);
    }
  }
  if (currentSection !== null) out[currentSection] = currentBody.join('\n').trim();
  return out;
}

export interface FtsResultLike {
  uuid: string;
  name: string;
  level: string;
  kind: string;
  snippet: string;
  body: string;       // full contract body (joined with caller)
  human_pinned: number | boolean;  // SQLite INTEGER 0/1 — cast to boolean in callers
  ftsRank: number;    // BM25 raw value (negative; lower is better)
  weightedScore?: number;
}

/**
 * Apply section-weighted re-ranking. For each result, identify which
 * H2 section the snippet came from (by substring match against the
 * parsed sections), apply the SECTION_WEIGHTS multiplier, and re-sort.
 *
 * IMPORTANT: ftsRank is BM25 in SQLite FTS5 — MORE NEGATIVE = MORE
 * RELEVANT. We invert to a positive score before multiplying so that
 * higher weight × stronger match = higher final score.
 *
 * When section-parser-cli is unavailable (missing binary or spawn error),
 * falls back to sorting by raw -ftsRank without throwing.
 */
export function reRankWithSectionWeight(
  results: FtsResultLike[],
  binaryPath: string,
): FtsResultLike[] {
  return results.map(r => {
    const positiveScore = -r.ftsRank;  // invert BM25
    const parsed = parseSectionsViaCli(r.body, binaryPath);
    if (!parsed) {
      return { ...r, weightedScore: positiveScore };
    }
    // Find which section contains the snippet text (strip ** delimiters first)
    const snippetText = r.snippet.replace(/\*\*/g, '').replace(/\.\.\./g, '').trim();
    let matchedSection: string | null = null;
    for (const [name, sectionText] of Object.entries(parsed.sections)) {
      // Match heuristic: any 8+ char run of snippet appears in section text.
      if (snippetText.length >= 8 && sectionText.includes(snippetText.slice(0, Math.min(snippetText.length, 24)))) {
        matchedSection = name;
        break;
      }
    }
    const weight = matchedSection ? (SECTION_WEIGHTS[matchedSection] ?? 1.0) : 1.0;
    return {
      ...r,
      weightedScore: positiveScore * weight,
      matchedSection: matchedSection ?? undefined,
    } as FtsResultLike & { matchedSection?: string };
  }).sort((a, b) => (b.weightedScore ?? 0) - (a.weightedScore ?? 0));
}
