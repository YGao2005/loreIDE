// Phase 9 Plan 09-04b: helpers for surfacing JSX-01 + BACKEND-FM-01 +
// VALIDATORS errors from the repo-load scan_result.errors stream.
//
// The Rust validators run inside `open_repo` and append prefixed errors
// (`[JSX-01] ...`, `[BACKEND-FM-01] ...`, `[VALIDATORS] ...`) to the same
// `ScanResult.errors: string[]` channel that GraphPlaceholder already
// surfaces. These helpers let UI code split the stream by category so
// validator failures can render with their own icon / copy / severity.

import type { ScanResult } from '@/ipc/types';

export type ValidatorCategory = 'jsx' | 'backend' | 'pipeline';

export interface CategorizedRepoLoadErrors {
  /** Errors prefixed `[JSX-01]` — JSX-alignment violations. */
  jsx: string[];
  /** Errors prefixed `[BACKEND-FM-01]` — missing required backend sections. */
  backend: string[];
  /** Errors prefixed `[VALIDATORS]` — validator pipeline failures (DB read, parse). */
  pipeline: string[];
  /** All other errors (parse failures, dup UUIDs, upsert errors). */
  generic: string[];
  /** True if any category has at least one entry. */
  hasErrors: boolean;
  /** True if any validator-category has at least one entry (jsx | backend). */
  hasValidatorErrors: boolean;
}

/**
 * Split a ScanResult's `errors` array by validator prefix so the UI can
 * render JSX-01 / BACKEND-FM-01 errors with persistent-banner styling
 * separate from the generic scan-error display.
 */
export function categorizeRepoLoadErrors(
  result: Pick<ScanResult, 'errors'> | null | undefined,
): CategorizedRepoLoadErrors {
  const out: CategorizedRepoLoadErrors = {
    jsx: [],
    backend: [],
    pipeline: [],
    generic: [],
    hasErrors: false,
    hasValidatorErrors: false,
  };

  if (!result || !result.errors || result.errors.length === 0) {
    return out;
  }

  for (const e of result.errors) {
    if (e.startsWith('[JSX-01]')) {
      out.jsx.push(e);
    } else if (e.startsWith('[BACKEND-FM-01]')) {
      out.backend.push(e);
    } else if (e.startsWith('[VALIDATORS]')) {
      out.pipeline.push(e);
    } else {
      out.generic.push(e);
    }
  }

  out.hasErrors = result.errors.length > 0;
  out.hasValidatorErrors = out.jsx.length > 0 || out.backend.length > 0;
  return out;
}
