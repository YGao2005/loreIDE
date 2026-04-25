import { ContractNode } from './ContractNode';
import { GroupNode } from './GroupNode';

// MUST be a module-level const. Inline {{ contract: ContractNode }} in JSX
// creates a new object every render → React Flow remounts every node.
// See RESEARCH §Pitfall 1 / https://reactflow.dev/learn/advanced-use/performance
//
// `contract` — leaf node (fixed size, full visual encoding matrix).
// `group`    — container variant for any row with children (Plan 03-03 dagre
//              drive-by). Sized by layout.ts from dagre subtree bbox.
export const nodeTypes = {
  contract: ContractNode,
  group: GroupNode,
} as const;
