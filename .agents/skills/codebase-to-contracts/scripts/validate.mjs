// scripts/validate.mjs — Stage 5b validator gate dispatcher.
//
// Strategy (RESEARCH Open Question 7):
//   1. Try `contract-ide validate-repo <path>` subprocess if the IDE binary
//      is on PATH. The Rust validators (jsx_align_validator.rs +
//      backend_section_validator.rs) are the source of truth.
//   2. Fall back to JS-side reimplementation with a loud warning when the
//      binary isn't available (e.g., bootstrap target machine without IDE
//      installed). The JS fallback enforces:
//        a. JSX-01: every L4 UI atom has non-empty code_ranges; the
//           ranges must wrap exactly one JSX element (mirrors
//           jsx_align_validator.rs::check_single_jsx_element).
//        b. BACKEND-FM-01: every backend-kind sidecar has ## Inputs /
//           ## Outputs / ## Side effects sections present and non-empty
//           (mirrors backend_section_validator.rs).
//        c. Schema allOf re-assertion (per Plan 14-04 SUMMARY mitigation):
//           - kind=='flow' MUST have format_version=5, level=='L2', and
//             non-empty members[].
//           - kind!='flow' MUST have format_version=3 and NO members
//             field. The bridge strips top-level allOf at the API
//             boundary; this validator re-asserts those constraints
//             post-hoc on the emitted .md files (defense in depth).
//
// On success: returns { ok: true, source: 'ide-binary'|'js-fallback' }.
// On failure: returns { ok: false, source, errors: [...] }. The caller
// (emit.mjs) treats !ok as a fatal gate and aborts the atomic rename —
// .contracts/ never gets written when validation fails.

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import yaml from 'js-yaml';

const BACKEND_KINDS = new Set(['API', 'lib', 'data', 'external', 'job', 'cron', 'event']);
const REQUIRED_BACKEND_SECTIONS = ['Inputs', 'Outputs', 'Side effects'];

// ---------------------------------------------------------------------------
// IDE-binary subprocess (Rust validators — source of truth).
// ---------------------------------------------------------------------------

function tryIdeBinary(repoPath) {
  let binaryAvailable = false;
  try {
    execSync('which contract-ide', { stdio: 'pipe' });
    binaryAvailable = true;
  } catch { /* not installed */ }
  if (!binaryAvailable) return null;

  // Per RESEARCH Open Question 7: the `validate-repo` subcommand doesn't
  // exist today (TODO: ship it as a Phase 14 follow-up). When it lands,
  // this is the dispatch path.
  const result = spawnSync('contract-ide', ['validate-repo', repoPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // If the binary doesn't recognize the subcommand, it'll exit non-zero
  // with a "no such subcommand" stderr — treat that as "not yet
  // available" and fall through.
  if (result.status === null || result.status === 127) return null;
  if (result.stderr && /unrecognized|no such subcommand|unknown subcommand/i.test(result.stderr)) {
    return null;
  }

  if (result.status === 0) return { ok: true, source: 'ide-binary' };
  return {
    ok: false,
    source: 'ide-binary',
    errors: (result.stderr || result.stdout || 'unknown failure').split('\n').filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// Sidecar parsing — extract frontmatter + body from a .md or .frontmatter.json
// + .body.json pair. We accept both shapes because validate.mjs runs BEFORE
// emit.mjs has finished composing .md files (validator gate runs against the
// staging tree where some sidecars may already be composed and others may
// still be JSON intermediates; supporting both gives us flexibility).
// ---------------------------------------------------------------------------

function parseSidecarFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  // Match Phase 2's frontmatter reader fence: `---\n...\n---\n`.
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { fm: null, body: null, error: 'no YAML frontmatter found' };
  let fm;
  try {
    fm = yaml.load(match[1]);
  } catch (err) {
    return { fm: null, body: null, error: `YAML parse error: ${err.message}` };
  }
  return { fm, body: match[2] || '', error: null };
}

// ---------------------------------------------------------------------------
// Body section parser — extracts ## H2 sections into a Map<lowercase-name, body>.
// Matches the lenient behavior of section_parser.rs::parse_sections.
// ---------------------------------------------------------------------------

function parseBodySections(body) {
  const sections = new Map();
  let currentName = null;
  let currentLines = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      if (currentName !== null) {
        sections.set(currentName, currentLines.join('\n').trim());
      }
      currentName = m[1].toLowerCase();
      currentLines = [];
    } else if (currentName !== null) {
      currentLines.push(line);
    }
  }
  if (currentName !== null) {
    sections.set(currentName, currentLines.join('\n').trim());
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Schema allOf re-assertion — re-applies the top-level allOf guards from
// schemas/frontmatter.json that claude-cli-bridge.mjs strips at the API
// boundary. Per Plan 14-04 SUMMARY mitigation: defense in depth.
// ---------------------------------------------------------------------------

function validateFrontmatterAllOf(fm, file) {
  const errors = [];
  if (fm.kind === 'flow') {
    // Flow contracts: format_version=5, level=L2, members required + non-empty.
    if (fm.format_version !== 5) {
      errors.push(`${file}: kind=flow requires format_version=5 (got ${fm.format_version})`);
    }
    if (fm.level !== 'L2') {
      errors.push(`${file}: kind=flow requires level=L2 (got ${fm.level})`);
    }
    if (!Array.isArray(fm.members) || fm.members.length < 2) {
      errors.push(`${file}: kind=flow requires members[] with ≥2 entries (trigger + ≥1 participant)`);
    }
  } else {
    // Non-flow contracts: format_version=3, members must NOT be present.
    if (fm.format_version !== 3) {
      errors.push(`${file}: kind=${fm.kind} requires format_version=3 (got ${fm.format_version})`);
    }
    if (fm.members !== undefined) {
      errors.push(`${file}: kind=${fm.kind} must not declare members[] (only kind=flow may)`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// JSX-01 — L4 UI atoms must have non-empty code_ranges. Skip the
// "exactly one JSX element" structural check here; that lives in the
// Rust validator (which is invoked when the IDE binary is available).
// The JS fallback is permissive on the structural check — we still emit
// errors when code_ranges is empty or malformed, which catches the most
// common Stage 4 failure modes.
// ---------------------------------------------------------------------------

function validateJsxAlignment(fm, file, repoPath) {
  const errors = [];
  if (fm.kind !== 'UI' || fm.level !== 'L4') return errors;
  if (!Array.isArray(fm.code_ranges) || fm.code_ranges.length === 0) {
    errors.push(`${file}: L4 UI atom has empty code_ranges (JSX-01)`);
    return errors;
  }
  for (const range of fm.code_ranges) {
    if (!range || typeof range.file !== 'string' || !Number.isInteger(range.start_line) || !Number.isInteger(range.end_line)) {
      errors.push(`${file}: malformed code_range entry (JSX-01)`);
      continue;
    }
    if (range.start_line < 1 || range.end_line < range.start_line) {
      errors.push(`${file}: code_range has invalid line numbers (start=${range.start_line}, end=${range.end_line})`);
      continue;
    }
    // Source-file existence — silent skip on missing (matches Rust validator).
    const sourcePath = resolve(repoPath, range.file);
    if (!existsSync(sourcePath)) continue;
  }
  return errors;
}

// ---------------------------------------------------------------------------
// BACKEND-FM-01 — backend-kind sidecars must have ## Inputs / ## Outputs /
// ## Side effects sections present AND non-empty.
// ---------------------------------------------------------------------------

function validateBackendSections(fm, body, file) {
  const errors = [];
  if (!BACKEND_KINDS.has(fm.kind)) return errors;
  const sections = parseBodySections(body);
  for (const required of REQUIRED_BACKEND_SECTIONS) {
    const key = required.toLowerCase();
    const text = sections.get(key);
    if (text === undefined || text.trim().length === 0) {
      errors.push(`${file}: missing or empty ## ${required} (BACKEND-FM-01)`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// JS fallback validator — runs against a directory of composed .md sidecars
// (ignores .frontmatter.json / .body.json staging artifacts; those are
// staging-only intermediates).
// ---------------------------------------------------------------------------

function jsFallbackValidate(repoPath, sourceDir) {
  const errors = [];
  if (!existsSync(sourceDir)) {
    return { ok: false, source: 'js-fallback', errors: [`No sidecar directory at ${sourceDir}`] };
  }

  const sidecars = readdirSync(sourceDir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('.'));
  if (sidecars.length === 0) {
    return { ok: false, source: 'js-fallback', errors: [`No .md sidecars found in ${sourceDir}`] };
  }

  for (const file of sidecars) {
    const filePath = join(sourceDir, file);
    if (!statSync(filePath).isFile()) continue;
    const { fm, body, error } = parseSidecarFile(filePath);
    if (error || !fm) {
      errors.push(`${file}: ${error || 'no frontmatter'}`);
      continue;
    }
    // Schema-required fields presence check (lightweight).
    const required = ['format_version', 'uuid', 'kind', 'level'];
    for (const key of required) {
      if (fm[key] === undefined) {
        errors.push(`${file}: missing required frontmatter field '${key}'`);
      }
    }
    // Re-assert the stripped top-level allOf rules.
    errors.push(...validateFrontmatterAllOf(fm, file));
    // JSX-01 (L4 UI atoms only).
    errors.push(...validateJsxAlignment(fm, file, repoPath));
    // BACKEND-FM-01 (backend kinds only).
    errors.push(...validateBackendSections(fm, body || '', file));
  }

  return { ok: errors.length === 0, source: 'js-fallback', errors };
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

export function validate(repoPath, options = {}) {
  // 1. Try IDE binary subprocess first (source of truth).
  if (!options.forceJsValidator) {
    const ideResult = tryIdeBinary(repoPath);
    if (ideResult) return ideResult;
  }

  // 2. JS fallback with degraded-mode warning (loud per RESEARCH Open
  //    Question 7 — users should know they're not getting full Rust
  //    validator coverage).
  if (!options.silent) {
    process.stderr.write(
      `[validate] Skill is using degraded JS-side validators. ` +
      `Install Contract IDE for stronger guarantees ` +
      `(or add \`validate-repo\` CLI subcommand to the binary; RESEARCH Open Question 7 follow-up).\n`,
    );
  }

  // Validation source resolution: prefer composed sidecars in .contracts/,
  // fall back to .staging/ if .contracts/ is empty/absent (Stage 5b runs
  // validation BEFORE the atomic rename, so .staging/ is the natural target).
  const stagingDir = resolve(repoPath, '.contracts/.staging');
  const finalDir = resolve(repoPath, '.contracts');
  const sourceDir = (() => {
    if (existsSync(stagingDir) && readdirSync(stagingDir).some((f) => f.endsWith('.md'))) return stagingDir;
    if (existsSync(finalDir) && readdirSync(finalDir).some((f) => f.endsWith('.md'))) return finalDir;
    return stagingDir; // default to staging for the error message clarity
  })();

  return jsFallbackValidate(repoPath, sourceDir);
}

// Exposed for testing.
export {
  parseSidecarFile,
  parseBodySections,
  validateFrontmatterAllOf,
  validateJsxAlignment,
  validateBackendSections,
  jsFallbackValidate,
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const repoPath = resolve(process.argv[2] || process.cwd());
  const result = validate(repoPath);
  if (!result.ok) {
    console.error(`Validation FAILED (source: ${result.source}):`);
    for (const err of result.errors) console.error(`  - ${err}`);
    process.exit(1);
  }
  console.log(`Validation OK (source: ${result.source})`);
}
