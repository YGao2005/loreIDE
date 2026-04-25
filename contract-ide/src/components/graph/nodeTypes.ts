import { ContractNode } from './ContractNode';
import { GroupNode } from './GroupNode';
import { ServiceCard } from './ServiceCard';

// MUST be a module-level const. Inline {{ contract: ContractNode }} in JSX
// creates a new object every render → React Flow remounts every node.
// See RESEARCH §Pitfall 1 / https://reactflow.dev/learn/advanced-use/performance
//
// `contract`    — leaf node (fixed size, full visual encoding matrix).
// `group`       — container variant for any row with children (Plan 03-03 dagre
//                 drive-by). Sized by layout.ts from dagre subtree bbox.
// `serviceCard` — Phase 13 Plan 04 (CARD-02 / CARD-03): backend participant
//                 card (api / lib / data / external / job / cron / event)
//                 with Stripe-API-docs-style structured rendering.
//                 Plan 13-05 will append `screenCard` next (additive — Wave 2
//                 serialization_hint mandates 13-04 → 13-05 nodeTypes.ts edits
//                 run sequentially).
export const nodeTypes = {
  contract: ContractNode,
  group: GroupNode,
  serviceCard: ServiceCard,
} as const;
