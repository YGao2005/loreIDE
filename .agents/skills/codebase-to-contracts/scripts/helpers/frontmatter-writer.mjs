// scripts/helpers/frontmatter-writer.mjs
//
// Round-trip-safe YAML frontmatter writer. Output MUST parse cleanly through
// the Phase 2 reader at `contract-ide/src-tauri/src/sidecar/frontmatter.rs`
// (serde_yaml_ng). The reader is strict about:
//   - Open fence `---\n` at byte 0
//   - Close fence `\n---\n` (newline on BOTH sides — Phase 2 RESEARCH Pitfall 6)
//   - Empty arrays serialized as `[]` (NOT bare `:` with empty next line)
//
// We use `js-yaml` for the YAML body and post-process to enforce the empty-
// array invariant.

import yaml from 'js-yaml';

/**
 * Serialize a frontmatter object + body into the canonical sidecar format.
 *
 * @param {object} frontmatterObj — parsed frontmatter (e.g. { format_version: 3, uuid: '...', ... })
 * @param {string} body           — markdown body (already-rendered contract content)
 * @returns {string}              — full sidecar file content
 */
export function writeFrontmatter(frontmatterObj, body = '') {
  let yamlBody = yaml.dump(frontmatterObj, {
    // lineWidth -1 = no auto-wrap (preserves long URLs/strings as-is).
    lineWidth: -1,
    // noRefs: don't emit YAML anchors/aliases — serde_yaml_ng can read them
    // but byte-equality with seeded sidecars (which never use anchors) requires
    // we also avoid emitting them.
    noRefs: true,
    // sortKeys false: preserve caller-supplied key order. Callers are
    // responsible for inserting keys in the canonical schema order.
    sortKeys: false,
  });

  // Post-process: js-yaml emits empty arrays as `key: []` already (block-style
  // for non-empty, flow-style for empty). Verify that's still true; if a
  // future js-yaml version regresses to `key:\n` for empties, fix here.
  // (No-op for now — covered by the round-trip parity test.)

  // Normalize trailing newline on the YAML body.
  if (!yamlBody.endsWith('\n')) yamlBody += '\n';

  return `---\n${yamlBody}---\n\n${body}`;
}
