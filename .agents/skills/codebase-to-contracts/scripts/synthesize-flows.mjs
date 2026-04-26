// scripts/synthesize-flows.mjs — Stage 5a of the bootstrap pipeline.
//
// For each L3 trigger (UI page or API route), walk its imports + AST
// call-sites to compose an ORDERED `members:` UUID list, then verify
// the ordering via a single LLM call (with watchdog + fallback to the
// static chain on LLM failure).
//
// Algorithm (RESEARCH Pattern 6):
//   1. Read .staging/nodes.json — the universe of UUIDs.
//   2. For each trigger (kind in {UI, API} && level == L3):
//      a. AST-walk trigger.tsx/ts — collect imports → resolve to repo
//         paths → match against nodes.json → build an importMap of
//         (localName → resolvedNode).
//      b. AST-walk trigger.tsx/ts again — collect CallExpressions
//         in source order; for each, look up callee local-name in
//         importMap and emit a member if matched.
//      c. Recurse one level into each member's source; append any
//         transitive members that weren't already in the chain.
//      d. Single LLM verification call (synthesize-flow.txt + flow.json
//         schema, watchdog 60s) returns a corrected members ordering
//         + ## Notes prose. Static chain is the fallback on LLM error.
//      e. Emit .staging/<flowUuid>.frontmatter.json + .body.json.
//   3. Update _progress.json.stage_5a.
//
// Shared services (Stripe, db.user.update, etc.) appear in nodes.json
// ONCE — multiple flow members lists naturally reference the same UUID
// (no duplicate sidecars).
//
// Re-run idempotency: deterministicUuid(repoName, `flow-<slug>`, 'L2:flow')
// produces the same flow UUID across runs given the same trigger.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBabel } from './helpers/babel-parser-bridge.mjs';
import { callClaude } from './helpers/claude-cli-bridge.mjs';
import { deterministicUuid } from './helpers/deterministic-uuid.mjs';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(__filename);

// Phase 9 parity — must match align-jsx.mjs + contract-uuid-plugin/index.js.
const BABEL_PARSE_OPTIONS = {
  sourceType: 'module',
  plugins: ['jsx', 'typescript'],
  errorRecovery: true,
};

// Watchdog: per-flow LLM verification call gets 60s; failure falls through
// to the static chain (we still emit the flow contract).
const FLOW_VERIFY_TIMEOUT_MS = 60_000;

// Extensions tried when resolving imports without explicit suffix.
const RESOLVE_EXTS = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

// ---------------------------------------------------------------------------
// Import resolution — convert an import source string to a repo-relative
// file path that can be matched against nodes.json's `file` field.
// ---------------------------------------------------------------------------

function resolveImportToFile({ source, triggerFile, repoPath, allFiles }) {
  // Skip third-party imports — they have no node sidecar.
  if (!source.startsWith('.') && !source.startsWith('@/')) return null;

  let candidatePath;
  if (source.startsWith('@/')) {
    // Next.js convention: @/ = src/ (preferred) or root/ (legacy).
    const sourceWithoutAlias = source.slice(2);
    if (allFiles.has(`src/${sourceWithoutAlias}`)) return `src/${sourceWithoutAlias}`;
    candidatePath = `src/${sourceWithoutAlias}`;
  } else {
    // Relative — resolve against trigger's directory.
    const triggerDir = dirname(triggerFile);
    const abs = resolve(repoPath, triggerDir, source);
    candidatePath = relative(repoPath, abs);
  }

  // Try direct match (already has extension).
  if (allFiles.has(candidatePath)) return candidatePath;

  // Try each known extension suffix.
  for (const ext of RESOLVE_EXTS) {
    const withExt = candidatePath + ext;
    if (allFiles.has(withExt)) return withExt;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Static AST walk — collect (importMap) then (call-sites in source order).
// Returns array of { uuid, file, name, line } in invocation order, deduped.
// ---------------------------------------------------------------------------

export function staticCallChain({ triggerSource, triggerFile, allNodes, allFiles, repoPath, babel }) {
  let ast;
  try {
    ast = babel.parse(triggerSource, BABEL_PARSE_OPTIONS);
  } catch {
    return [];
  }

  // Map (file -> node) for O(1) lookup. There can be multiple nodes per file
  // (e.g., a page.tsx with both an L3 page and L4 atom); for member-resolution
  // purposes, we prefer the most-specific (highest level number) which is
  // typically the L4 atom rather than the wrapping L3.
  const fileToNode = new Map();
  for (const node of allNodes) {
    const existing = fileToNode.get(node.file);
    // Prefer L4 over L3, L3 over L2, etc.; lower-letters wins (L4 > L3).
    if (!existing) fileToNode.set(node.file, node);
    else {
      const existingNum = parseInt(existing.level.slice(1), 10) || 0;
      const newNum = parseInt(node.level.slice(1), 10) || 0;
      if (newNum > existingNum) fileToNode.set(node.file, node);
    }
  }

  // 1. Collect imports — local-name -> resolved node.
  const importMap = new Map();
  babel.traverse(ast, {
    ImportDeclaration(path) {
      const source = path.node.source.value;
      const resolvedFile = resolveImportToFile({ source, triggerFile, repoPath, allFiles });
      if (!resolvedFile) return;
      const node = fileToNode.get(resolvedFile);
      if (!node) return;

      for (const spec of path.node.specifiers || []) {
        // `import foo from 'x'`, `import { foo } from 'x'`, `import * as foo from 'x'` —
        // all expose `foo` as the local name.
        const localName = spec.local?.name;
        if (localName) importMap.set(localName, { file: resolvedFile, uuid: node.uuid });
      }
    },
  });

  // 2. Walk call-sites in source order.
  const calls = [];
  babel.traverse(ast, {
    CallExpression(path) {
      let calleeName;
      const callee = path.node.callee;
      if (callee.type === 'Identifier') {
        calleeName = callee.name;
      } else if (callee.type === 'MemberExpression') {
        // For `db.user.update`, walk down to the leftmost identifier.
        let obj = callee.object;
        while (obj && obj.type === 'MemberExpression') obj = obj.object;
        if (obj && obj.type === 'Identifier') calleeName = obj.name;
      }
      if (!calleeName) return;

      const importInfo = importMap.get(calleeName);
      if (importInfo) {
        calls.push({
          uuid: importInfo.uuid,
          file: importInfo.file,
          name: calleeName,
          line: path.node.loc?.start?.line ?? 0,
        });
      }
    },
  });

  // Dedup by UUID, preserving first-call order.
  const seen = new Set();
  return calls.filter((c) => {
    if (seen.has(c.uuid)) return false;
    seen.add(c.uuid);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Flow slug — derive a stable, filesystem-safe slug from the trigger file.
// e.g. `src/app/api/account/delete/route.ts` -> `flow-api-account-delete`
// e.g. `src/app/(auth)/login/page.tsx` -> `flow-auth-login-page`
// ---------------------------------------------------------------------------

function flowSlugFromTrigger(triggerFile, route) {
  // Strip the common Next.js prefixes (src/, app/, src/app/) and filename
  // suffixes (page.tsx, route.ts, etc.). Route groups like (auth) collapse
  // to nothing because they don't appear in the URL. The result is a slug
  // that mirrors the URL/route shape the trigger serves.
  let stem = triggerFile
    .replace(/^src\//, '')
    .replace(/^app\//, '')
    .replace(/\/(page|route)\.(t|j)sx?$/, '')
    // Bare page.tsx / route.ts (root-level after prefix stripping) — empty.
    .replace(/^(page|route)\.(t|j)sx?$/, '')
    .replace(/\(([^)]*)\)\//g, '')   // strip route groups: (auth)/login -> login
    .replace(/[()]/g, '')
    // Convert dynamic segments [id] -> id so they survive the path-separator collapse.
    .replace(/\[([^\]]+)\]/g, '$1')
    .replace(/\.(t|j)sx?$/, '')
    .replace(/[\/.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!stem) stem = 'untitled';

  // For API triggers with multiple methods on the same route.ts, prepend
  // the HTTP method so each method gets a unique flow contract. The route
  // string is "METHOD /path" (e.g. "DELETE /api/account") for API triggers
  // and "/path" or null for UI/page triggers.
  let methodPrefix = '';
  if (typeof route === 'string') {
    const methodMatch = route.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s/i);
    if (methodMatch) {
      methodPrefix = `${methodMatch[1].toLowerCase()}-`;
    }
  }

  // Slug cap; flow contracts don't need long names.
  return `flow-${methodPrefix}${stem.slice(0, 60)}`;
}

// ---------------------------------------------------------------------------
// LLM verification — single call per flow with watchdog. Returns a
// possibly-corrected members ordering + notes string. On any failure, the
// caller falls back to the static-walk chain + a generated notes blob.
// ---------------------------------------------------------------------------

async function verifyFlowMembers({ trigger, proposedMembers, triggerSource, allNodes, schemaPath, systemPrompt }) {
  const memberDescriptors = proposedMembers.map((uuid, idx) => {
    const node = allNodes.find((n) => n.uuid === uuid);
    if (!node) return `${idx + 1}. ${uuid} — (no descriptor)`;
    return `${idx + 1}. ${uuid} — ${node.file} (${node.kind} L${node.level.slice(1)})`;
  }).join('\n');

  const userPrompt = `Verify this flow's members ordering.

Trigger:
  uuid: ${trigger.uuid}
  file: ${trigger.file}
  kind: ${trigger.kind} ${trigger.level}
  ${trigger.route ? `route: ${trigger.route}` : ''}

Trigger source code (first 3000 chars):
\`\`\`typescript
${triggerSource.slice(0, 3000)}
\`\`\`

Proposed members in candidate order:
${memberDescriptors}

Output the corrected members + notes per the flow schema. Return ONLY the JSON object.`;

  const result = await callClaude({
    schemaPath,
    systemPrompt,
    userPrompt,
    temperature: 0,
    allowedTools: ['Read'],
    timeoutMs: FLOW_VERIFY_TIMEOUT_MS,
  });

  return result.structured_output;
}

// ---------------------------------------------------------------------------
// Bootstrap notes — fallback prose when LLM verification fails. Generates
// a numbered-step walkthrough from the static chain so the flow contract
// always has a substantive ## Notes section even on LLM error.
// ---------------------------------------------------------------------------

function bootstrapNotes(trigger, members, allNodes) {
  const lines = ['Member ordering is invocation order (auto-derived from static AST walk):'];
  for (let i = 0; i < members.length; i++) {
    const node = allNodes.find((n) => n.uuid === members[i]);
    if (i === 0) {
      lines.push(`${i + 1}. ${trigger.file} (trigger ${trigger.kind} L${trigger.level.slice(1)}) — entry point`);
    } else if (node) {
      const verb = node.kind === 'lib' ? 'lib' : node.kind === 'data' ? 'data access' : node.kind === 'external' ? 'external call' : 'invocation';
      lines.push(`${i + 1}. ${node.file} (${node.kind} L${node.level.slice(1)}) — ${verb}`);
    } else {
      lines.push(`${i + 1}. ${members[i]} — (descriptor missing)`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

export async function synthesizeFlows(repoPath, options = {}) {
  const stagingDir = resolve(repoPath, '.contracts/.staging');
  const nodesJsonPath = resolve(stagingDir, 'nodes.json');
  if (!existsSync(nodesJsonPath)) {
    throw new Error(`Stage 1 has not been run. Expected ${nodesJsonPath}.`);
  }

  const allNodes = JSON.parse(readFileSync(nodesJsonPath, 'utf8'));
  // Set of all repo-relative paths in the node universe — used by the
  // import resolver to short-circuit on misses without filesystem hits.
  const allFiles = new Set(allNodes.map((n) => n.file));

  // Resolve the repo's npm package name for the deterministic flow UUID
  // (must match the namespace discover.mjs uses for non-flow nodes).
  const repoName = (() => {
    const pkgPath = resolve(repoPath, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (pkg.name && typeof pkg.name === 'string') return pkg.name;
      } catch { /* fall through */ }
    }
    return repoPath.split('/').filter(Boolean).pop() || 'unknown-repo';
  })();

  const babel = await loadBabel(repoPath);

  // Triggers = L3 surfaces (UI page or API route).
  const triggers = allNodes.filter((n) => n.level === 'L3' && (n.kind === 'UI' || n.kind === 'API'));

  const schemaPath = resolve(SCRIPT_DIR, '../schemas/flow.json');
  const systemPromptPath = resolve(SCRIPT_DIR, '../prompts/synthesize-flow.txt');
  const systemPrompt = existsSync(systemPromptPath) ? readFileSync(systemPromptPath, 'utf8') : '';

  const flows = [];
  let llmReorders = 0; // how often LLM disagreed with static chain
  let llmFailures = 0; // how often we fell through to static-chain

  for (const trigger of triggers) {
    const sourcePath = resolve(repoPath, trigger.file);
    if (!existsSync(sourcePath)) continue;
    const triggerSource = readFileSync(sourcePath, 'utf8');

    // 1. Static AST walk on the trigger.
    const directChain = staticCallChain({
      triggerSource, triggerFile: trigger.file, allNodes, allFiles, repoPath, babel,
    });
    if (directChain.length === 0) continue; // no participants → not a flow worth modeling

    // 2. Recurse one level: for each direct member, walk ITS imports +
    // call-sites and append unseen UUIDs to the chain (one-level deep,
    // matching the SKILL.md flow-synthesis algorithm).
    const seenUuids = new Set([trigger.uuid, ...directChain.map((c) => c.uuid)]);
    const chain = [...directChain];
    for (const member of directChain) {
      const memberPath = resolve(repoPath, member.file);
      if (!existsSync(memberPath)) continue;
      const memberSource = readFileSync(memberPath, 'utf8');
      const subChain = staticCallChain({
        triggerSource: memberSource, triggerFile: member.file, allNodes, allFiles, repoPath, babel,
      });
      for (const sub of subChain) {
        if (!seenUuids.has(sub.uuid)) {
          chain.push(sub);
          seenUuids.add(sub.uuid);
        }
      }
    }

    const proposedMembers = [trigger.uuid, ...chain.map((c) => c.uuid)];

    // 3. LLM verification (with watchdog + static-chain fallback on error).
    let verifiedMembers = proposedMembers;
    let verifiedNotes = bootstrapNotes(trigger, proposedMembers, allNodes);
    try {
      const verified = await verifyFlowMembers({
        trigger, proposedMembers, triggerSource, allNodes, schemaPath, systemPrompt,
      });
      if (Array.isArray(verified?.members) && verified.members.length >= 2) {
        // Cross-check: every returned member MUST come from our proposed set
        // (per synthesize-flow.txt SECTION B Rule 2: don't invent UUIDs).
        const proposedSet = new Set(proposedMembers);
        const allFromProposed = verified.members.every((u) => proposedSet.has(u));
        if (allFromProposed && verified.members[0] === trigger.uuid) {
          // Compare orderings — if changed, count it.
          const sameOrder = verified.members.length === proposedMembers.length
            && verified.members.every((u, i) => u === proposedMembers[i]);
          if (!sameOrder) llmReorders += 1;
          verifiedMembers = verified.members;
        } else {
          process.stderr.write(`[synthesize-flows] LLM returned out-of-set or wrong-trigger members for ${trigger.uuid}; using static chain.\n`);
          llmFailures += 1;
        }
      } else {
        llmFailures += 1;
      }
      if (typeof verified?.notes === 'string' && verified.notes.length >= 30) {
        verifiedNotes = verified.notes;
      }
    } catch (err) {
      process.stderr.write(`[synthesize-flows] LLM verification failed for trigger ${trigger.uuid}: ${err.message}; using static chain\n`);
      llmFailures += 1;
    }

    // 4. Compose the flow contract: deterministic UUIDv5 from
    // (repoName, `flow-<slug>`, 'L2:flow') so re-runs are idempotent.
    // Slug includes HTTP method for API triggers so multiple methods on
    // the same route.ts emit distinct flow contracts.
    const slug = flowSlugFromTrigger(trigger.file, trigger.route);
    const flowUuid = deterministicUuid(repoName, slug, 'L2:flow');

    const flowFm = {
      format_version: 5,
      uuid: flowUuid,
      kind: 'flow',
      level: 'L2',
      parent: null,
      neighbors: [],
      members: verifiedMembers,
      code_ranges: [],
      code_hash: null,
      contract_hash: null,
      human_pinned: false,
      route: null,
      derived_at: null,
      section_hashes: {},
      rollup_inputs: [],
      rollup_hash: null,
      rollup_state: 'untracked',
      rollup_generation: 0,
    };

    const flowBody = {
      kind: 'flow',
      level: 'L2',
      intent: `Auto-derived flow originating at \`${trigger.file}\` (${trigger.kind} L${trigger.level.slice(1)}). Walks ${verifiedMembers.length - 1} downstream participant${verifiedMembers.length - 1 === 1 ? '' : 's'} via import-graph traversal + AST call-site extraction. Body to be refined by IDE on first PROP-02 rollup recompute (Phase 8) — the bootstrap intent intentionally leaves room for human refinement.`,
      role: `Bootstrapped flow contract — synthesized by codebase-to-contracts skill from static analysis of the trigger source plus one-level recursion into each callee. This contract is the structural anchor for Phase 13's vertical participant chain rendering.`,
      notes: verifiedNotes,
    };

    writeFileSync(
      resolve(stagingDir, `${flowUuid}.frontmatter.json`),
      JSON.stringify(flowFm, null, 2) + '\n',
    );
    writeFileSync(
      resolve(stagingDir, `${flowUuid}.body.json`),
      JSON.stringify(flowBody, null, 2) + '\n',
    );

    flows.push({
      uuid: flowUuid,
      slug,
      trigger: trigger.uuid,
      members: verifiedMembers,
    });
  }

  // 5. Update progress.
  const progressPath = resolve(stagingDir, '_progress.json');
  let progress = {};
  if (existsSync(progressPath)) {
    try { progress = JSON.parse(readFileSync(progressPath, 'utf8')); } catch { /* ignore */ }
  }
  progress.stage = Math.max(progress.stage || 0, 5);
  progress.stage_5a_completed_at = new Date().toISOString();
  progress.stage_5a_flows_synthesized = flows.length;
  progress.stage_5a_llm_reorders = llmReorders;
  progress.stage_5a_llm_failures = llmFailures;
  writeFileSync(progressPath, JSON.stringify(progress, null, 2) + '\n');

  console.log(
    `Stage 5a complete: ${flows.length} flow contract${flows.length === 1 ? '' : 's'} synthesized, ` +
    `${llmReorders} reordered by LLM, ${llmFailures} fell through to static chain`
  );
  return flows;
}

// Exposed for testing.
export { flowSlugFromTrigger, BABEL_PARSE_OPTIONS };

if (import.meta.url === `file://${process.argv[1]}`) {
  const repoPath = resolve(process.argv[2] || process.cwd());
  synthesizeFlows(repoPath).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
