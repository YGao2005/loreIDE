import { invoke } from '@tauri-apps/api/core';

/**
 * Day-1 integration validation IPC wrappers (Plan 01-04).
 *
 * These call the `#[tauri::command]` functions in
 * `src-tauri/src/commands/validation.rs`. Dev-time only — consumed by
 * `<Day1Validation>`, which is gated behind `import.meta.env.DEV`.
 */

export interface SpawnResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exit_code: number | null;
}

/** Check A — spawn `claude -p "say hello"` via tauri-plugin-shell. */
export const testClaudeSpawn = () => invoke<SpawnResult>('test_claude_spawn');

/**
 * Check B — PostToolUse hook fixture + referenced JSONL containing
 * `input_tokens`. Resolves to the full fixture JSON augmented with
 * `_fixture_path` and `_resolved_transcript_path`; rejects with a
 * `Check B FAIL: ...` message when the JSONL side cannot be proven.
 */
export const testHookPayloadFixture = () =>
  invoke<Record<string, unknown>>('test_hook_payload_fixture');

/** Check C — run the day0/check3-pkg-sqlite/bin/day0-sqlite binary. */
export const testPkgSqliteBinary = () => invoke<SpawnResult>('test_pkg_sqlite_binary');
