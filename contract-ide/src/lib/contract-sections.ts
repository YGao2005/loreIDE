/**
 * DISPLAY-ONLY section parsing for Copy Mode UI surfaces.
 *
 * SCOPE: this file parses Markdown ## Examples bodies into Given/When/Then
 * blocks for editing in the simplified inspector. It produces strings; it
 * NEVER computes, reads, or writes section_hashes.
 *
 * The canonical section parser is contract-ide/src-tauri/src/sidecar/section_parser.rs
 * (Phase 8 PROP-01), invoked via the section-parser-cli binary at write time.
 * That Rust parser is the SINGLE source of truth for section-hash computation.
 *
 * If you need section_hashes from TypeScript, call section-parser-cli over IPC
 * (see mcp-sidecar/src/lib/section_weight.ts:parseSectionsViaCli for the pattern).
 * Do NOT add hash computation to this file.
 */

/**
 * Parse the ## Examples section out of a contract body. Splits on GIVEN/WHEN/THEN
 * markers per Gherkin pattern. Returns the FIRST example block (Phase 9 v1 ships
 * single-example editing; multi-example UX deferred).
 *
 * NOT canonical — the Rust section parser at section_parser.rs is the source of
 * truth for section_hashes. This helper is a thin client-side parse for the UI only.
 */
export interface GwtBlock {
  given: string;
  when: string;
  then: string;
}

export function parseExamplesSection(body: string): GwtBlock {
  // Find ## Examples (case-insensitive, fence-aware shallow check)
  const examplesMatch = body.match(/^##\s+Examples\s*\n([\s\S]*?)(?=^##\s+\w|\z)/im);
  if (!examplesMatch) return { given: '', when: '', then: '' };
  const examples = examplesMatch[1];
  // Take first GIVEN ... WHEN ... THEN ... block
  const givenMatch = examples.match(/GIVEN\s+([\s\S]*?)(?=WHEN\s+|\z)/i);
  const whenMatch = examples.match(/WHEN\s+([\s\S]*?)(?=THEN\s+|\z)/i);
  const thenMatch = examples.match(/THEN\s+([\s\S]*?)(?=\nGIVEN\s+|\z)/i);
  return {
    given: givenMatch?.[1].trim() ?? '',
    when: whenMatch?.[1].trim() ?? '',
    then: thenMatch?.[1].trim() ?? '',
  };
}

/**
 * Reconstruct the body with the new ## Examples block. Preserves all other H2
 * sections in their original order. If no ## Examples existed, append it at the
 * end (above ## Notes if present).
 */
export function reconstructExamplesSection(body: string, gwt: GwtBlock): string {
  const newExamples = `## Examples\nGIVEN ${gwt.given}\nWHEN ${gwt.when}\nTHEN ${gwt.then}\n`;
  if (/^##\s+Examples\s*\n/im.test(body)) {
    // Replace existing block (up to next ## or EOF)
    return body.replace(/^##\s+Examples\s*\n[\s\S]*?(?=^##\s+\w|\z)/im, newExamples);
  }
  // Append at end (or before ## Notes if present)
  if (/^##\s+Notes/im.test(body)) {
    return body.replace(/^##\s+Notes/im, `${newExamples}\n## Notes`);
  }
  return body.endsWith('\n') ? body + newExamples : body + '\n' + newExamples;
}
