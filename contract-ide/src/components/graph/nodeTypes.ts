import { ServiceCard } from './ServiceCard';
import { ScreenCard } from './ScreenCard';

// MUST be a module-level const. Inline {{ ... }} in JSX creates a new object
// every render → React Flow remounts every node.
// See RESEARCH §Pitfall 1 / https://reactflow.dev/learn/advanced-use/performance
//
// `serviceCard` — Phase 13 Plan 04 (CARD-02 / CARD-03): backend participant
//                 card (api / lib / data / external / job / cron / event)
//                 with Stripe-API-docs-style structured rendering.
// `screenCard`  — Phase 13 Plan 05 (CARD-01): UI-mode L3 trigger card with
//                 iframe at the screen contract's `route` + atom-chip overlay
//                 layered in the parent (NOT inside iframe — sidesteps
//                 cross-origin / pan-zoom interference). Inspect/Interact
//                 mode toggle in header.
//
// The legacy `contract` / `group` types (abstract L0–L4 grouped-graph render)
// were removed alongside GraphCanvasInner's dispatch — see CANVAS-PURPOSE.md
// for the redesign rationale.
export const nodeTypes = {
  serviceCard: ServiceCard,
  screenCard: ScreenCard,
} as const;
