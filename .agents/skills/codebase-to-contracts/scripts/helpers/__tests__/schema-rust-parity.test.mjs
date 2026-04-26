// scripts/helpers/__tests__/schema-rust-parity.test.mjs
//
// Phase 14 revision Issue 12: parity smoke between the Rust Frontmatter
// struct (Phase 2) and the JSON Schema shipped by the skill (Plan 14-01a).
//
// Catches drift: if Phase 9's struct gains a new required field, but the
// JSON Schema's required[] doesn't include it, downstream sidecars will
// pass the schema validator but fail the Rust reader at Stage 5b. This
// test catches that BEFORE re-runs ship broken sidecars.
//
// SKIP behavior: if schemas/frontmatter.json doesn't exist yet (Plan 14-01a
// runs in parallel and may not have completed), the test is skipped with a
// clear message. The full parity gate runs once both halves of wave 1 land.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(HERE, '../../..');
const REPO_ROOT = path.resolve(SKILL_ROOT, '../../..');

const SCHEMA_PATH = path.join(SKILL_ROOT, 'schemas', 'frontmatter.json');
const RUST_PATH = path.join(REPO_ROOT, 'contract-ide', 'src-tauri', 'src', 'sidecar', 'frontmatter.rs');

/**
 * Parse Rust struct fields out of frontmatter.rs. Looks for `pub <field>:
 * <type>,` lines inside the Frontmatter struct and notes whether the type
 * is `Option<...>` or has `#[serde(default)]` on the line above.
 */
function parseRustFrontmatterStruct(rustSource) {
  const fields = [];
  // Find the Frontmatter struct body.
  const structMatch = rustSource.match(/pub struct Frontmatter\s*\{([\s\S]*?)^\}/m);
  if (!structMatch) {
    throw new Error('Could not locate `pub struct Frontmatter` in frontmatter.rs');
  }
  const body = structMatch[1];
  const lines = body.split('\n');

  let pendingSerdeDefault = false;
  let pendingSerdeRename = null;

  for (const line of lines) {
    const trimmed = line.trim();
    // Track serde attribute on the immediately-preceding line.
    if (trimmed.startsWith('#[serde')) {
      if (/default/.test(trimmed)) pendingSerdeDefault = true;
      const renameMatch = trimmed.match(/rename\s*=\s*"([^"]+)"/);
      if (renameMatch) pendingSerdeRename = renameMatch[1];
      continue;
    }
    if (trimmed.startsWith('//') || trimmed === '') continue;

    const fieldMatch = trimmed.match(/^pub\s+(\w+)\s*:\s*(.+?),?\s*$/);
    if (fieldMatch) {
      const [, name, type] = fieldMatch;
      const isOption = /^Option</.test(type);
      const isVecOrHashMap = /^(Vec|HashMap|BTreeMap)</.test(type);
      fields.push({
        rustName: name,
        jsonName: pendingSerdeRename ?? name,
        type,
        isOption,
        // Vec/HashMap default to empty; serde_yaml_ng accepts missing keys
        // even without #[serde(default)] — but we require them in the
        // schema only if they're not Option and not collection types
        // marked with default.
        hasSerdeDefault: pendingSerdeDefault,
        // Schema-required = not Option AND no #[serde(default)] AND not a collection type.
        // (Collections without serde(default) ARE required-strict in Rust, but
        // serde_yaml_ng populates them as empty collections from missing keys
        // for Vec — so be conservative: require unless Option or has default.)
        schemaRequired: !isOption && !pendingSerdeDefault && !isVecOrHashMap,
        isVecOrHashMap,
      });
      pendingSerdeDefault = false;
      pendingSerdeRename = null;
    }
  }
  return fields;
}

test('schema-vs-Rust parity: every non-Option Rust field appears in JSON Schema', { skip: !fs.existsSync(SCHEMA_PATH) ? `SKIP — schemas/frontmatter.json missing (Plan 14-01a not yet executed). Path: ${SCHEMA_PATH}` : false }, () => {
  const rustSource = fs.readFileSync(RUST_PATH, 'utf8');
  const fields = parseRustFrontmatterStruct(rustSource);
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const required = new Set(schema.required ?? []);
  const properties = new Set(Object.keys(schema.properties ?? {}));

  const failures = [];
  const table = [['Rust field', 'kind', 'in required[]', 'in properties', 'match?']];

  for (const f of fields) {
    const inRequired = required.has(f.jsonName);
    const inProperties = properties.has(f.jsonName);
    let kind;
    if (f.isOption) kind = 'Option';
    else if (f.hasSerdeDefault) kind = 'serde(default)';
    else if (f.isVecOrHashMap) kind = 'collection';
    else kind = 'required';

    let match = true;
    if (kind === 'required' && !inRequired) {
      failures.push(`${f.jsonName} is required in Rust but missing from JSON Schema required[]`);
      match = false;
    }
    if (!inProperties) {
      failures.push(`${f.jsonName} is declared in Rust but missing from JSON Schema properties`);
      match = false;
    }

    table.push([f.jsonName, kind, String(inRequired), String(inProperties), match ? 'OK' : 'FAIL']);
  }

  // Print parity table for posterity.
  // eslint-disable-next-line no-console
  console.log('\n=== Schema-vs-Rust Parity Table ===');
  for (const row of table) {
    // eslint-disable-next-line no-console
    console.log('| ' + row.map((c) => String(c).padEnd(20)).join(' | ') + ' |');
  }

  assert.equal(failures.length, 0, `Parity failures:\n  - ${failures.join('\n  - ')}`);
});
