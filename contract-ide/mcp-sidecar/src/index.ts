import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { findByIntent } from './tools/find_by_intent';
import { findByIntentMass } from './tools/find_by_intent_mass';
import { getContract } from './tools/get_contract';
import { listDriftedNodes } from './tools/list_drifted';
import { listNodesNeedingDerivation } from './tools/list_needing_derivation';
import { updateContract } from './tools/update_contract';
import { writeDerivedContract } from './tools/write_derived_contract';
import { handleProposeRollupReconciliation } from './tools/propose_rollup_reconciliation';
import { listIngestedSessions } from './tools/list_ingested_sessions';
import { registerFindConstraintsForGoal } from './tools/find_constraints_for_goal.js';
import { registerFindDecisionsAbout } from './tools/find_decisions_about.js';
import { registerOpenQuestions } from './tools/open_questions.js';

const server = new McpServer({
  name: 'contract-ide-mcp',
  version: '1.0.0',
});

server.tool(
  'find_by_intent',
  'Search contracts by natural-language intent using SQLite FTS5',
  {
    query: z.string().describe('Natural language search query'),
    limit: z.number().default(10),
  },
  async ({ query, limit }) => findByIntent(query, limit),
);

server.tool(
  'find_by_intent_mass',
  'Mass-edit retrieval: FTS5 search returning full match set (default cap 100, no LIMIT below cap) with section-weighted re-ranking and full contract bodies. Surfaces embedding_status: "disabled" (keyword-only fallback per MASS-01). Returns human_pinned per node so the review queue can show predictive pinned-count before apply runs. Sibling of find_by_intent — does NOT replace it.',
  {
    query: z.string().describe('Natural language search query for mass edit targeting'),
    limit: z.number().optional().describe('Max results cap (default 100)'),
  },
  async ({ query, limit }) => findByIntentMass(query, limit),
);

server.tool(
  'get_contract',
  'Retrieve a specific contract node by UUID',
  { uuid: z.string().describe('Contract node UUID') },
  async ({ uuid }) => getContract(uuid),
);

server.tool(
  'list_drifted_nodes',
  'List nodes where code_hash diverges from contract_hash',
  {},
  async () => listDriftedNodes(),
);

server.tool(
  'update_contract',
  'Update a contract sidecar .md file. Enforces human_pinned guard (returns SKIPPED-PINNED without writing if the node is pinned). NEVER writes SQLite directly — Rust watcher propagates. For fresh LLM-derived bodies that should recompute code_hash/contract_hash, use write_derived_contract instead.',
  {
    uuid: z.string(),
    body: z.string().describe('New contract body text'),
    frontmatter_patch: z
      .record(z.unknown())
      .optional()
      .describe('Fields to merge into frontmatter'),
  },
  async (args) => updateContract(args),
);

server.tool(
  'list_nodes_needing_derivation',
  'DERIVE-01 queue. Lists nodes whose contract_body is empty OR code_hash is null. Hides human_pinned rows by default. Hand each row to write_derived_contract after reading the source.',
  {
    include_pinned: z.boolean().default(false),
    limit: z.number().default(100),
  },
  async (args) => listNodesNeedingDerivation(args),
);

server.tool(
  'write_derived_contract',
  'Write a freshly-derived contract body. ENFORCES human_pinned guard (DERIVE-03), auto-recomputes code_hash over current source + contract_hash over body, sets derived_at. Use this (not update_contract) when the calling session has just generated a body from source.',
  {
    uuid: z.string().describe('Contract node UUID'),
    body: z.string().describe('Generated 2-4 sentence contract body'),
  },
  async (args) => writeDerivedContract(args),
);

server.tool(
  'propose_rollup_reconciliation',
  'Propose a reconciliation for a rollup-stale upstream contract. Respects human_pinned: for pinned upstreams returns a read-only diff with instructions to use the IDE Reconcile panel; for unpinned returns a draft-propagation prompt with current upstream body + cited child sections + recent journal context. NEVER calls a writer — the user approves via the IDE.',
  {
    upstream_uuid: z
      .string()
      .describe('UUID of the rollup-stale upstream contract to reconcile'),
  },
  async (args) => handleProposeRollupReconciliation(args),
);

server.tool(
  'list_ingested_sessions',
  'List Claude Code sessions ingested into the Contract IDE substrate for the currently-open repo. Filtered by CONTRACT_IDE_REPO_PATH-derived cwd_key. Returns sessions ordered by last_seen_at descending. Read-only.',
  {
    limit: z
      .number()
      .int()
      .positive()
      .max(500)
      .optional()
      .describe('Max rows to return (default 50, capped at 500)'),
  },
  async ({ limit }) => listIngestedSessions(limit),
);

// Phase 11 substrate tools — FTS5 only, no LLM rerank (reserved for Delegate flow)
registerFindConstraintsForGoal(server);
registerFindDecisionsAbout(server);
registerOpenQuestions(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Health signal for the Tauri parent — stderr is SAFE (stdout is reserved
  // for MCP JSON-RPC framing; any byte on stdout that isn't a valid JSON-RPC
  // frame breaks the client, Pitfall 1 in 05-RESEARCH.md).
  process.stderr.write('[mcp-server] ready\n');
}

main().catch((err) => {
  process.stderr.write(`[mcp-server] fatal: ${err}\n`);
  process.exit(1);
});
