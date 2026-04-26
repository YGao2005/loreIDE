/**
 * Phase 13 Plan 04 — CARD-02 / CARD-03: ServiceCard
 *
 * Renders any backend participant (API endpoint, lib function, DB write, external
 * service call, cron job, webhook handler, GraphQL resolver, gRPC method) using
 * Stripe-API-docs-style structured rendering:
 *
 *   - Header: kind icon + monospace name (or method+path for HTTP)
 *   - Body : `## Inputs` (request schema) · `## Outputs` (response schemas) ·
 *            `## Side effects` (bulleted list), all driven by Phase 9
 *            BACKEND-FM-01 sections in the contract body
 *   - Side : ServiceCardChips column (CHIP-02) for L4 atoms anchored here
 *
 * Body content is 100% driven by `parseBackendSections(d.body)` — no parallel
 * data path. If Phase 9 hasn't shipped sections yet (or this contract simply
 * lacks them), the empty-schema fallback renders a "No schema declared
 * (BACKEND-FM-01 not populated)" placeholder rather than blank.
 *
 * Variants (all share this single component — kind-switch on header):
 *   - api      → method badge (POST green / GET blue / etc.) + monospace path
 *   - lib      → monospace `name()` function signature
 *   - data     → monospace `db.<table>.<op>` header
 *   - external → monospace SDK call (e.g. `stripe.customers.update`)
 *   - cron     → `cron: <schedule>` with cyan border
 *   - event    → `event: <type>` with pink border
 *   - job      → monospace job name with purple border
 *
 * Phase 3 patterns (per Plan 03-01 decisions):
 *   - Plain `NodeProps` (no generic) in the function signature; cast to
 *     ServiceCardData via `data as` inside the body. Parameterising NodeProps<T>
 *     triggers a variance error through memo() + nodeTypes.
 *   - `[key: string]: unknown` extends the data interface to satisfy xyflow's
 *     Record constraint.
 *   - `memo()` wrapper at module scope per Pitfall 1 (inline memo in JSX
 *     remounts every node every frame).
 *
 * State coloring uses `resolveNodeState` from plan 13-01 — single source of
 * truth across cards / chips / contract nodes (drifted > intent_drifted >
 * rollup_stale > superseded > rollup_untracked > healthy precedence).
 *
 * Wave 2 placement: this component renders ONE card in isolation. Plan 13-06's
 * vertical-chain assembler (FlowChain) composes multiple ServiceCard instances
 * into a participant chain — chain composition is explicitly out of scope here.
 */

import { memo, useMemo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import {
  CodeIcon,
  ClockIcon,
  DatabaseIcon,
  GlobeIcon,
  PackageIcon,
  PlugIcon,
  ZapIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { cardKindStyles, methodBadgeStyles } from './cardStyles';
import { ServiceCardChips } from './ServiceCardChips';
import { resolveNodeState, citationHaloClass } from './contractNodeStyles';
import { parseBackendSections, type BackendSection } from '@/lib/backendFrontmatter';
import { useDriftStore } from '@/store/drift';
import { useRollupStore } from '@/store/rollup';
import { useSubstrateStore } from '@/store/substrate';
import { useCitationStore } from '@/store/citation';

export type ServiceCardKind =
  | 'api'
  | 'lib'
  | 'data'
  | 'external'
  | 'job'
  | 'cron'
  | 'event';

export type ServiceCardMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ServiceCardData extends Record<string, unknown> {
  /** Contract uuid — keys into substrate / drift / rollup state stores. */
  uuid: string;
  /** Backend kind — drives header layout + border tone. */
  kind: ServiceCardKind;
  /** Display name (used in header for non-api kinds). */
  name: string;
  /** Contract body markdown (frontmatter sections parsed by parseBackendSections). */
  body: string;
  /** HTTP method — required when kind === 'api'. */
  method?: ServiceCardMethod;
  /** HTTP path — required when kind === 'api'. */
  path?: string;
  /** Cron expression — used when kind === 'cron'. */
  schedule?: string;
  /** Event type identifier — used when kind === 'event'. */
  eventType?: string;
}

/**
 * Map a ServiceCardKind to its lucide icon. Subtle iconography helps the user
 * tell at a glance whether a card represents a synchronous endpoint vs a
 * scheduled job vs a webhook listener.
 */
function KindIcon({ kind }: { kind: ServiceCardKind }) {
  const props = { size: 14, className: 'shrink-0 text-muted-foreground' };
  switch (kind) {
    case 'api':
      return <GlobeIcon {...props} />;
    case 'lib':
      return <CodeIcon {...props} />;
    case 'data':
      return <DatabaseIcon {...props} />;
    case 'external':
      return <PlugIcon {...props} />;
    case 'job':
      return <PackageIcon {...props} />;
    case 'cron':
      return <ClockIcon {...props} />;
    case 'event':
      return <ZapIcon {...props} />;
  }
}

/**
 * Render a single fenced-block schema (JSON or text) with optional status label.
 */
function SchemaBlock({ section }: { section: BackendSection }) {
  return (
    <div>
      {section.status && (
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground/80 mb-0.5">
          {section.status}
        </div>
      )}
      <pre
        className="rounded bg-muted/50 p-1.5 font-mono text-[11px] leading-relaxed overflow-x-auto whitespace-pre"
        data-format={section.format}
      >
        {section.schema}
      </pre>
    </div>
  );
}

/**
 * Render the kind-specific header row of a ServiceCard.
 */
function CardHeader({ data }: { data: ServiceCardData }) {
  return (
    <header className="flex items-center gap-2 px-3 py-2 border-b border-border/40 min-w-0">
      <KindIcon kind={data.kind} />
      {data.kind === 'api' && data.method && data.path && (
        <>
          <span className={methodBadgeStyles({ method: data.method })}>
            {data.method}
          </span>
          <code
            className="text-sm font-mono truncate min-w-0 flex-1 text-foreground"
            title={data.path}
          >
            {data.path}
          </code>
        </>
      )}
      {data.kind === 'lib' && (
        <code className="text-sm font-mono truncate min-w-0 flex-1 text-foreground">
          {data.name}
          {data.name.endsWith(')') ? '' : '()'}
        </code>
      )}
      {data.kind === 'data' && (
        <code className="text-sm font-mono truncate min-w-0 flex-1 text-foreground">
          {data.name}
        </code>
      )}
      {data.kind === 'external' && (
        <code className="text-sm font-mono truncate min-w-0 flex-1 text-foreground">
          {data.name}
        </code>
      )}
      {data.kind === 'cron' && (
        <code
          className="text-xs font-mono truncate min-w-0 flex-1 text-foreground"
          title={data.schedule || data.name}
        >
          cron: {data.schedule || '— no schedule —'}
        </code>
      )}
      {data.kind === 'event' && (
        <code
          className="text-xs font-mono truncate min-w-0 flex-1 text-foreground"
          title={data.eventType || data.name}
        >
          event: {data.eventType || data.name}
        </code>
      )}
      {data.kind === 'job' && (
        <code className="text-sm font-mono truncate min-w-0 flex-1 text-foreground">
          {data.name}
        </code>
      )}
    </header>
  );
}

function ServiceCardImpl({ data }: NodeProps) {
  const d = data as ServiceCardData;

  // Parse contract body once per render of this card. Memoised on `body`
  // identity — `body` only changes when the contract is rewritten on disk
  // (rare in steady state).
  const sections = useMemo(() => parseBackendSections(d.body || ''), [d.body]);

  // Compose visual state from the four upstream signals (drift / substrate /
  // rollup) via the load-bearing resolveNodeState helper from plan 13-01.
  const drifted = useDriftStore((s) => s.driftedUuids);
  const rollupStale = useRollupStore((s) => s.rollupStaleUuids);
  const untracked = useRollupStore((s) => s.untrackedUuids);
  const substrate = useSubstrateStore((s) => s.nodeStates);
  const visualState = resolveNodeState(
    d.uuid,
    drifted,
    rollupStale,
    untracked,
    substrate,
  );

  // Phase 13 Plan 07 — citation halo. Stable primitive selector (per 13-06
  // SUMMARY pattern), no derived array; no useSyncExternalStore hazard.
  const haloUuid = useCitationStore((s) => s.highlightedUuid);
  const haloed = haloUuid === d.uuid;

  const hasInputs = sections.inputs !== null;
  const hasOutputs = sections.outputs.length > 0;
  const hasSideEffects = sections.sideEffects.length > 0;
  const isEmpty = !hasInputs && !hasOutputs && !hasSideEffects;

  return (
    <div className="flex items-start" data-uuid={d.uuid} data-kind={d.kind}>
      <div
        className={cn(
          cardKindStyles({ kind: d.kind, state: visualState }),
          haloed && citationHaloClass,
        )}
        style={{ minWidth: 320, maxWidth: 480 }}
      >
        <Handle type="target" position={Position.Top} />
        <CardHeader data={d} />

        <div className="px-3 py-2 space-y-2 text-xs">
          {hasInputs && sections.inputs && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
                Request
              </div>
              <SchemaBlock section={sections.inputs} />
            </div>
          )}

          {hasOutputs && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
                Responses
              </div>
              <div className="space-y-1.5">
                {sections.outputs.map((out, i) => (
                  <SchemaBlock key={i} section={out} />
                ))}
              </div>
            </div>
          )}

          {hasSideEffects && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
                Side effects
              </div>
              <ul className="space-y-0.5">
                {sections.sideEffects.map((eff, i) => (
                  <li
                    key={i}
                    className="font-mono text-[11px] leading-relaxed text-foreground/90 before:content-['•'] before:mr-1.5 before:text-muted-foreground"
                  >
                    {eff}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {isEmpty && (
            <div className="text-muted-foreground italic text-[11px] py-1">
              No schema declared (BACKEND-FM-01 not populated)
            </div>
          )}
        </div>

        <Handle type="source" position={Position.Bottom} />
      </div>

      <ServiceCardChips participantUuid={d.uuid} />
    </div>
  );
}

/**
 * Memoised at module scope per Plan 03-01 Pitfall 1 — inline memo inside the
 * nodeTypes record causes React Flow to remount every node every frame.
 */
export const ServiceCard = memo(ServiceCardImpl);
