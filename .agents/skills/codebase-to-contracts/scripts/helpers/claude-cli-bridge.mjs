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
//
// Watchdog: every callClaude() invocation has a hard timeout (default 120s,
// override via BOOTSTRAP_CLAUDE_TIMEOUT_MS env var or `timeoutMs` option).
// On timeout the child process is SIGKILL'd and the promise rejects with
// "claude -p watchdog timeout". This converts silent hangs (Plan 14-04
// debrief — path-mode schema bug had been hanging 25/40 calls indefinitely)
// into surfaceable errors so callers can decide to retry or fall through to
// bootstrap defaults.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_WATCHDOG_MS = 120_000; // 2 minutes — generous for sonnet completions.

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
 * @param {number}  [opts.timeoutMs]       — hard watchdog timeout; overrides BOOTSTRAP_CLAUDE_TIMEOUT_MS
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
  timeoutMs,
} = {}) {
  // Test-mode short-circuit (used by 14-03/04/05 unit tests).
  if (process.env.BOOTSTRAP_TEST_MODE === '1') {
    return { structured_output: {}, raw: '{}' };
  }

  const resolvedModel = model || process.env.BOOTSTRAP_CLAUDE_MODEL || DEFAULT_MODEL;
  const resolvedTimeoutMs = Number.isFinite(timeoutMs)
    ? timeoutMs
    : Number.parseInt(process.env.BOOTSTRAP_CLAUDE_TIMEOUT_MS || '', 10) || DEFAULT_WATCHDOG_MS;

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
    let settled = false;

    // Watchdog: hard kill after resolvedTimeoutMs. Plan 14-04 debrief — silent
    // hangs were the worst-case failure mode of `claude -p`; the watchdog
    // converts them into surfaceable errors so callers can decide.
    const watchdog = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch { /* already dead */ }
      reject(new Error(
        `claude -p watchdog timeout after ${resolvedTimeoutMs}ms (model=${resolvedModel}). ` +
        `Bytes captured: stdout=${stdout.length}, stderr=${stderr.length}. ` +
        `Override via BOOTSTRAP_CLAUDE_TIMEOUT_MS env or callClaude({ timeoutMs }).`
      ));
    }, resolvedTimeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
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
