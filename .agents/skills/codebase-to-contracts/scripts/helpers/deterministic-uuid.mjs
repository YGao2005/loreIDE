// scripts/helpers/deterministic-uuid.mjs
//
// Deterministic UUIDv5 generator — single source of UUIDs across the
// codebase-to-contracts skill. Plans 14-03/04/05 import deterministicUuid()
// for every node UUID they generate, so re-running the skill on the same
// codebase produces byte-identical sidecars (re-run idempotency, RESEARCH
// Pattern 3).
//
// RFC 4122 §4.3 — UUIDv5 = SHA-1(namespace_bytes || name_string), then
// stamp version=5 and RFC 4122 variant bits. Namespace is the standard URL
// namespace from RFC 4122 §C.2 (verbatim constant; do not change).

import { createHash } from 'node:crypto';

// RFC 4122 §C.2 URL namespace — MUST NOT change (deterministic UUID stability).
const NAMESPACE_URL = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

function uuidStrToBytes(uuid) {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

/**
 * Produce a deterministic UUIDv5 from (repoName, filePath, astAnchor).
 *
 * Same inputs always yield the same UUID. Use astAnchor as the disambiguator
 * for multiple contracts living in the same file (e.g. JSXElement@L60-65 vs
 * JSXElement@L82-89).
 *
 * @param {string} repoName    — npm package name of the target repo (e.g. "demo-repo")
 * @param {string} filePath    — repo-relative path (e.g. "app/page.tsx")
 * @param {string} astAnchor   — short stable AST anchor (e.g. "JSXElement@L60-65")
 * @returns {string}           — RFC 4122 UUIDv5 string (lowercase)
 */
export function deterministicUuid(repoName, filePath, astAnchor) {
  const name = `${repoName}::${filePath}::${astAnchor}`;
  const namespaceBytes = uuidStrToBytes(NAMESPACE_URL);
  const hash = createHash('sha1');
  hash.update(namespaceBytes);
  hash.update(name);
  const digest = hash.digest();

  // RFC 4122 §4.3: stamp version (5) at byte 6 and variant (10xx) at byte 8.
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;

  const hex = digest.toString('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
