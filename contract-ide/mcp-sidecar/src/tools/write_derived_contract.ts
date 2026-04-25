import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { getRepoPath } from '../db';
import type { CodeRange, ContractFrontmatter } from '../types';

interface WriteDerivedContractArgs {
  uuid: string;
  body: string;
}

/**
 * Derivation-specific sidecar writer. Differs from `update_contract`:
 *
 *   - ENFORCES the DERIVE-03 `human_pinned` guard — refuses to overwrite.
 *   - RECOMPUTES `code_hash` over current source at the referenced ranges
 *     (the baseline Phase 7 drift detection compares against).
 *   - RECOMPUTES `contract_hash` over the new body.
 *   - SETS `derived_at` to the current ISO-8601 timestamp.
 *
 * Used by the calling Claude Code session after it generates a contract body.
 * The Rust fs watcher (Phase 2) propagates the sidecar change into SQLite
 * within ~2s, so the IDE graph refreshes without any extra RPC.
 *
 * Hash semantics intentionally mirror the Rust helpers in
 * `src-tauri/src/commands/derive.rs` (kept as pure utilities for Phase 7):
 *   - code_hash:     sha256( concat(lines[i..j] + "\n" for each range) )
 *   - contract_hash: sha256( body.trim() )
 */
export async function writeDerivedContract({
  uuid,
  body,
}: WriteDerivedContractArgs) {
  let repoPath: string;
  try {
    repoPath = getRepoPath();
  } catch (e) {
    return errText(e instanceof Error ? e.message : String(e));
  }

  const sidecarPath = path.join(repoPath, '.contracts', `${uuid}.md`);
  if (!fs.existsSync(sidecarPath)) {
    return errText(`sidecar not found: ${sidecarPath}`);
  }

  const original = fs.readFileSync(sidecarPath, 'utf-8');
  const parsed = splitFrontmatterAndBody(original);
  if (!parsed) return errText(`failed to split frontmatter fence at ${sidecarPath}`);

  let fm: ContractFrontmatter;
  try {
    fm = YAML.parse(parsed.yamlBlock) as ContractFrontmatter;
  } catch (e) {
    return errText(
      `YAML parse failed at ${sidecarPath}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!fm || typeof fm.uuid !== 'string') {
    return errText(`parsed frontmatter missing uuid at ${sidecarPath}`);
  }

  // ---- Guard: human_pinned (DERIVE-03) ----
  if (fm.human_pinned === true) {
    return okText(
      `SKIPPED-PINNED: ${uuid} is human_pinned — sidecar left unchanged.`,
    );
  }

  const trimmedBody = body.trim();
  if (!trimmedBody) return errText(`empty body supplied for ${uuid}`);

  // ---- Recompute hashes + timestamp ----
  const freshCodeHash = computeCodeHash(repoPath, fm.code_ranges ?? []);
  if (freshCodeHash === null && (fm.code_ranges ?? []).length > 0) {
    return errText(
      `cannot read source for ${uuid} — one or more files in code_ranges missing`,
    );
  }

  const patched: ContractFrontmatter = {
    ...fm,
    code_hash: freshCodeHash, // null is legitimate for conceptual nodes with no code_ranges
    contract_hash: sha256Hex(trimmedBody),
    derived_at: new Date().toISOString(),
  };
  patched.uuid = fm.uuid; // DATA-04: identity immutable

  const newContent = serializeSidecar(patched, trimmedBody);

  const tmpPath = `${sidecarPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, newContent, 'utf-8');
  fs.renameSync(tmpPath, sidecarPath);

  return okText(
    `DONE: ${uuid} — code_hash=${freshCodeHash ?? '∅'}, contract_hash=${patched.contract_hash!.slice(0, 12)}…, derived_at=${patched.derived_at}. Rust watcher will refresh SQLite within 2s.`,
  );
}

function computeCodeHash(repoPath: string, ranges: CodeRange[]): string | null {
  if (ranges.length === 0) return null;
  const hasher = createHash('sha256');
  for (const r of ranges) {
    const full = path.join(repoPath, r.file);
    let content: string;
    try {
      content = fs.readFileSync(full, 'utf-8');
    } catch {
      return null;
    }
    const lines = content.split('\n');
    const start = Math.max(0, r.start_line - 1);
    const end = Math.min(lines.length, r.end_line);
    for (let i = start; i < end; i++) {
      hasher.update(lines[i] + '\n');
    }
  }
  return hasher.digest('hex');
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function splitFrontmatterAndBody(
  content: string,
): { yamlBlock: string; originalBody: string } | null {
  const bom = content.startsWith('\ufeff') ? 1 : 0;
  const rest = content.slice(bom).replace(/\r\n/g, '\n');
  if (!rest.startsWith('---\n')) return null;
  const after = rest.slice(4);
  const closeIdx = after.indexOf('\n---\n');
  if (closeIdx < 0) return null;
  return {
    yamlBlock: after.slice(0, closeIdx),
    originalBody: after.slice(closeIdx + 5).replace(/^\n+/, ''),
  };
}

function serializeSidecar(fm: ContractFrontmatter, body: string): string {
  const ordered: Record<string, unknown> = {
    format_version: fm.format_version,
    uuid: fm.uuid,
    kind: fm.kind,
    level: fm.level,
    parent: fm.parent ?? null,
    neighbors: fm.neighbors ?? [],
    code_ranges: fm.code_ranges ?? [],
    code_hash: fm.code_hash ?? null,
    contract_hash: fm.contract_hash ?? null,
    human_pinned: fm.human_pinned ?? false,
    route: fm.route ?? null,
    derived_at: fm.derived_at ?? null,
  };
  const yamlBlock = YAML.stringify(ordered, { lineWidth: 0 }).trimEnd();
  return `---\n${yamlBlock}\n---\n\n${body.replace(/^\n+/, '')}`;
}

function okText(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}
function errText(text: string) {
  return { content: [{ type: 'text' as const, text: `ERROR: ${text}` }] };
}
