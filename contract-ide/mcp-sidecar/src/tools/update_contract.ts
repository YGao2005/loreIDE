import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { getRepoPath } from '../db';
import type { ContractFrontmatter } from '../types';

interface UpdateContractArgs {
  uuid: string;
  body: string;
  frontmatter_patch?: Record<string, unknown>;
}

/**
 * Update a contract sidecar .md file on disk.
 *
 * MCP-03 single-writer invariant: this tool NEVER opens a writable SQLite
 * connection. It rewrites `.contracts/<uuid>.md` via temp-file + atomic rename
 * (mirrors Plan 02-02's Rust `write_contract`), and the Plan 02-03 fs watcher
 * picks up the change and calls `refresh_nodes` in Rust within ~2s. Rust
 * remains the sole SQLite writer.
 *
 * UUID is explicitly preserved from the existing file — DATA-04 (identity is
 * immutable). Even if `frontmatter_patch.uuid` is provided, it is overwritten
 * back to the original.
 *
 * YAML parsing uses the `yaml` npm package — the hand-rolled parser originally
 * shipped in Plan 05-02 Task 1 dropped indented list items (code_ranges) and
 * was swapped out during UAT, as pre-authorised by the plan.
 */
export async function updateContract({
  uuid,
  body,
  frontmatter_patch,
}: UpdateContractArgs) {
  let repoPath: string;
  try {
    repoPath = getRepoPath();
  } catch (e) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `ERROR: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
    };
  }

  const sidecarPath = path.join(repoPath, '.contracts', `${uuid}.md`);
  if (!fs.existsSync(sidecarPath)) {
    return {
      content: [
        { type: 'text' as const, text: `ERROR: sidecar not found: ${sidecarPath}` },
      ],
    };
  }

  const original = fs.readFileSync(sidecarPath, 'utf-8');
  const parsed = splitFrontmatterAndBody(original);
  if (!parsed) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `ERROR: failed to split frontmatter fence at ${sidecarPath}`,
        },
      ],
    };
  }
  const { yamlBlock, originalBody } = parsed;

  let fm: ContractFrontmatter;
  try {
    fm = YAML.parse(yamlBlock) as ContractFrontmatter;
  } catch (e) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `ERROR: YAML parse failed at ${sidecarPath}: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
    };
  }
  if (!fm || typeof fm.uuid !== 'string' || !fm.uuid) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `ERROR: parsed frontmatter missing uuid at ${sidecarPath}`,
        },
      ],
    };
  }

  // DERIVE-03 pin guard (mirrors write_derived_contract.ts:64-68). Phase 6
  // shipped `update_contract` without this check under the assumption that
  // only the user calls it — but the tool is exposed over MCP to any Claude
  // session, so the assumption doesn't hold. The user's Inspector save path
  // uses the Tauri `write_contract` IPC, not this MCP tool, so the guard
  // blocks only the agent path.
  if (fm.human_pinned === true) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `SKIPPED-PINNED: ${fm.uuid} is human_pinned — sidecar left unchanged.`,
        },
      ],
    };
  }

  // Apply patch shallowly. UUID identity is immutable (DATA-04) — overwrite
  // any patch attempt back to the original value.
  const patched: ContractFrontmatter = {
    ...fm,
    ...(frontmatter_patch ?? {}),
  } as ContractFrontmatter;
  patched.uuid = fm.uuid;

  const newContent = serializeSidecar(
    patched,
    body.length > 0 ? body : originalBody,
  );

  const tmpPath = `${sidecarPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, newContent, 'utf-8');
  fs.renameSync(tmpPath, sidecarPath); // atomic within the same filesystem

  return {
    content: [
      {
        type: 'text' as const,
        text:
          `Updated ${sidecarPath} — Rust watcher will propagate to SQLite within 2s. ` +
          `(Single-writer upheld: MCP sidecar never writes SQLite directly.)`,
      },
    ],
  };
}

/**
 * Split on the canonical `---\n…\n---\n` fence. A literal `---` line inside
 * the body is safe because we only look for the first closing fence after
 * the opening one (Pitfall 6).
 */
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

/**
 * Emit sidecar .md text. Plan 02-01 locks the field order (format_version
 * first, derived_at last). YAML.stringify preserves insertion order, so we
 * build a plain object in the canonical order and round-trip it.
 */
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
