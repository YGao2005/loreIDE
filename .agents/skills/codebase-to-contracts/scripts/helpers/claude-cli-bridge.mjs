// scripts/helpers/claude-cli-bridge.mjs
//
// Wraps `claude -p --output-format json --json-schema <path>
// --append-system-prompt <inline>` invocation as an async Node function.
//
// Plans 14-03/04/05 use this to call a structured-output Claude session for
// classification, frontmatter synthesis, etc. Model is pinned via env var
// BOOTSTRAP_CLAUDE_MODEL (default `claude-sonnet-4-6`) per RESEARCH Pitfall 1
// (un-pinned models cause silent drift across re-runs).
//
// Test mode: set BOOTSTRAP_TEST_MODE=1 to short-circuit the subprocess and
// return `{ structured_output: {}, raw: '{}' }` immediately. Downstream tests
// in 14-03/04/05 use this to mock the CLI.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

// Strip top-level keywords the Anthropic structured-output API rejects.
// (`tools.N.custom.input_schema: input_schema does not support oneOf, allOf,
// or anyOf at the top level`). The full schema — including these keywords —
// is still enforced post-hoc by `validate.mjs` in Stage 5b.
function stripUnsupportedTopLevel(schema) {
  const { allOf: _a, oneOf: _o, anyOf: _y, ...rest } = schema;
  return rest;
}

/**
 * Call `claude -p` with a structured-output schema and return the parsed
 * `structured_output` field.
 *
 * @param {object}   opts
 * @param {string}  [opts.schemaPath]      — path to a JSON Schema file
 * @param {string}  [opts.systemPrompt]    — appended via --append-system-prompt
 * @param {string}   opts.userPrompt       — piped via stdin
 * @param {string[]} [opts.allowedTools]   — defaults to ['Read']
 * @param {number}  [opts.temperature]     — currently unused by claude -p but retained for caller intent (always 0)
 * @param {string}  [opts.model]           — overrides BOOTSTRAP_CLAUDE_MODEL
 * @returns {Promise<{ structured_output: object, raw: string }>}
 */
export async function callClaude({
  schemaPath,
  systemPrompt = '',
  userPrompt = '',
  allowedTools = ['Read'],
  // eslint-disable-next-line no-unused-vars
  temperature = 0,
  model,
} = {}) {
  // Test-mode short-circuit (used by 14-03/04/05 unit tests).
  if (process.env.BOOTSTRAP_TEST_MODE === '1') {
    return { structured_output: {}, raw: '{}' };
  }

  const resolvedModel = model || process.env.BOOTSTRAP_CLAUDE_MODEL || DEFAULT_MODEL;

  const args = [
    '-p',
    '--output-format', 'json',
    '--model', resolvedModel,
    '--allowedTools', allowedTools.join(','),
    '--dangerously-skip-permissions',
  ];
  if (schemaPath) {
    const raw = JSON.parse(readFileSync(schemaPath, 'utf8'));
    args.push('--json-schema', JSON.stringify(stripUnsupportedTopLevel(raw)));
  }
  if (systemPrompt) {
    args.push('--append-system-prompt', systemPrompt);
  }

  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`claude -p failed (exit ${code}): ${stderr}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve({
          structured_output: parsed.structured_output ?? parsed.result ?? parsed,
          raw: stdout,
        });
      } catch (err) {
        reject(new Error(`claude -p returned non-JSON stdout: ${err.message}\n--- stdout ---\n${stdout}`));
      }
    });

    if (userPrompt) child.stdin.write(userPrompt);
    child.stdin.end();
  });
}
