/**
 * Phase 13 Plan 06 — CHAIN-02: react-flow edge types registry.
 *
 * MUST be a module-level const. Inline `{{ callShape: CallShapeEdge }}` in
 * JSX creates a new object every render → React Flow remounts every edge
 * (Pitfall 1, same as nodeTypes).
 *
 * `callShape` — Phase 13 Plan 06: edge between consecutive flow chain
 *               participants with a `{ field1, field2 }` or `?` label
 *               derived from prev `## Outputs` → next `## Inputs`.
 */

import { CallShapeEdge } from './CallShapeEdge';

export const edgeTypes = {
  callShape: CallShapeEdge,
} as const;
