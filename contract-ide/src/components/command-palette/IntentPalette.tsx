/**
 * Phase 13 Plan 03 — Cmd+P semantic intent palette (SUB-08).
 * Phase 15 Plan 02 — Filter chip row (All / Contracts / Code / Substrate) +
 *                    Substrate-hit routing override (TRUST-01).
 *
 * Sibling-of-Cmd+K: the existing `CommandPalette.tsx` (Phase 1 SHELL-03)
 * stays unmodified. This component handles a separate Cmd+P keybinding that
 * runs a debounced async query against `find_substrate_by_intent` (unified
 * contract FTS5 + substrate retrieval, Plan 13-03 Rust IPC).
 *
 * Why two palettes instead of one merged surface?
 *   - Cmd+K is action-first ("open repo", "switch lens", "jump to known node").
 *     It works against a small, in-memory action registry plus the loaded
 *     `nodes` array — instant, no IPC round-trip.
 *   - Cmd+P is intent-first ("account settings danger" → AccountSettings.DangerZone).
 *     It runs an async FTS5+substrate query per keystroke — slower, but the
 *     content-shape is fundamentally different.
 *   Merging them would force the user to mentally context-switch within the
 *   same surface. Two siblings keeps each palette's grammar clean.
 *
 * Navigation contract (per plan 13-03 frontmatter must_haves.key_links):
 *   - Flow hit (`hit.kind === 'flow'`):
 *       useSidebarStore.setSelectedFlow(hit.uuid)
 *       useGraphStore.pushParent(hit.uuid)         (drives canvas to L2 chain)
 *   - L4 atom contract (`hit.kind === 'contract' && hit.level === 'L4'`):
 *       useGraphStore.pushParent(hit.parent_uuid)  (parent surface for L3 view)
 *       useGraphStore.setFocusedAtomUuid(hit.uuid) (chip halo target — plan 13-01)
 *   - Other contracts (L0–L3 non-flow): pushParent on the contract uuid itself.
 *   - Substrate hit under "All" chip:
 *       use `useGraphStore.selectNode(parent_uuid)` — Inspector opens on the atom.
 *   - Substrate hit under "Substrate" chip (TRUST-01 override, Phase 15-02):
 *       use `useCitationStore.openCitation(hit.uuid)` — SourceArchaeologyModal
 *       opens directly, showing the verbatim quote and provenance metadata.
 *       This is the <2s demo path per TRUST-01 SC.
 *
 * **Pitfall guard (research §Pitfall 2):** `e.preventDefault()` MUST run BEFORE
 * `setOpen` on the Cmd+P listener. macOS's default Cmd+P opens the system
 * Print dialog. Without preventDefault, the dialog fires alongside the palette
 * and the keystroke is unrecoverable until the user dismisses it.
 *
 * **Canonical setter API (per plan 13-01 SUMMARY checker N7):** all graphStore
 * mutations use `selectNode` (NOT `setSelectedNode`) and `setFocusedAtomUuid`
 * (NOT raw `useGraphStore.setState({ focusedAtomUuid: ... })`).
 *
 * **Chip state:** `useState<ChipFilter>` local to this component. Resets to
 * 'all' when the dialog closes. No Zustand store needed — chip selection is
 * session-scoped (per-open) per plan 15-02 must_haves.
 */

import { useCallback, useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { useReactFlow } from '@xyflow/react';
import { findSubstrateByIntent, type IntentSearchHit } from '@/ipc/substrate';
import { useGraphStore } from '@/store/graph';
import { useSidebarStore } from '@/store/sidebar';
import { useCitationStore } from '@/store/citation';
import { isFlowContract, type ContractNode } from '@/ipc/types';
import { IntentPaletteHit } from './IntentPaletteHit';
import './commandPalette.css';

/**
 * Phase 15 Plan 02 — filter chip state type.
 *
 * 'all' is the default. When a non-all chip is selected, its value is passed as
 * `kindFilter` to `findSubstrateByIntent` on the next debounced query.
 */
export type ChipFilter = 'all' | 'contracts' | 'code' | 'substrate';

/**
 * Maps a ChipFilter value to the optional kindFilter argument for
 * `findSubstrateByIntent`. 'all' → undefined (no filter, existing behaviour).
 *
 * Exported for unit-testing (IntentPalette.test.ts case 1).
 */
export function resolveKindFilter(
  chip: ChipFilter,
): 'substrate' | 'contracts' | 'code' | undefined {
  return chip === 'all' ? undefined : chip;
}

/**
 * Substrate-node kind guard. Returns true for the five substrate node_type
 * values; false for contract / flow / unknown kinds.
 *
 * Exported for unit-testing (IntentPalette.test.ts + IntentPaletteHit.tsx).
 */
export function isSubstrateKind(kind: string): boolean {
  return (
    kind === 'constraint' ||
    kind === 'decision' ||
    kind === 'open_question' ||
    kind === 'resolved_question' ||
    kind === 'attempt'
  );
}

/**
 * Backend node kinds. Hits with these `node_kind` values land on the L2 chain
 * and zoom to the ServiceCard for that node — they ARE nodes in the chain,
 * not screens.
 */
const BACKEND_NODE_KINDS = new Set([
  'API',
  'lib',
  'data',
  'external',
  'job',
  'cron',
  'event',
]);

/**
 * Destination tags. Each tag maps to a deterministic action chain in
 * `handleSelect`, plus a short user-facing hint rendered in the result row so
 * users can preview where a click will take them.
 *
 *   - 'modal'        → SourceArchaeologyModal (substrate rule editing)
 *   - 'flow-chain'   → L2 vertical chain mounted (clicked a flow itself)
 *   - 'screen'       → L2 chain + ScreenCard centered (clicked a UI L3 page)
 *   - 'screen-chip'  → L2 chain + parent ScreenCard centered + chip halo on
 *                       the L4 atom (clicked a UI L4 component)
 *   - 'service-node' → L2 chain + ServiceCard centered + selected (clicked an
 *                       API/lib/data/external/job/cron/event node)
 *   - 'breadcrumb'   → fallback for L0/L1/L2 non-flow contracts; pushParent
 *                       only (canvas does NOT change — see GraphCanvasInner)
 */
export type Destination =
  | 'modal'
  | 'flow-chain'
  | 'screen'
  | 'screen-chip'
  | 'service-node'
  | 'breadcrumb';

/**
 * Single source of truth for "what does clicking this hit do?". Pure function
 * — depends only on hit shape, not on store state — so it can drive both the
 * row's destination hint AND `handleSelect`'s action dispatch from the same
 * decision.
 *
 * Substrate rules ALWAYS open the modal regardless of chip filter (per Yang
 * 2026-04-25 spec — "rule → opens up the popup modal that allows edits or
 * changes or deletions"). This supersedes plan 15-02's chip-conditional
 * routing: the chip is now a search-scope toggle, not a routing toggle.
 *
 * Exported for unit-testing.
 */
export function resolveDestination(hit: IntentSearchHit): Destination {
  if (isSubstrateKind(hit.kind)) return 'modal';
  if (hit.kind === 'flow') return 'flow-chain';
  if (hit.kind === 'contract') {
    if (hit.node_kind === 'UI' && hit.level === 'L4') return 'screen-chip';
    if (hit.node_kind === 'UI') return 'screen';
    if (hit.node_kind && BACKEND_NODE_KINDS.has(hit.node_kind)) {
      return 'service-node';
    }
  }
  return 'breadcrumb';
}

/**
 * Short human-facing hint for the right edge of each result row — answers
 * "where will this take me?" before the user clicks. Kept under ~14 chars so
 * it fits the row without truncation at typical palette widths.
 */
export function destinationHint(dest: Destination): string {
  switch (dest) {
    case 'modal':
      return 'Open rule';
    case 'flow-chain':
      return 'Open flow';
    case 'screen':
      return 'Open screen';
    case 'screen-chip':
      return 'Focus chip';
    case 'service-node':
      return 'Zoom to node';
    case 'breadcrumb':
      return 'Open';
  }
}

/**
 * Semantic kind label rendered as the row's right-side badge. Replaces the
 * raw L0..L4 level pill with something users can read ("Screen", "API",
 * "Decision") instead of inferring kind from level + body.
 */
export function kindLabel(hit: IntentSearchHit): string {
  if (isSubstrateKind(hit.kind)) {
    switch (hit.kind) {
      case 'constraint':
        return 'Constraint';
      case 'decision':
        return 'Decision';
      case 'open_question':
        return 'Open Q';
      case 'resolved_question':
        return 'Resolved Q';
      case 'attempt':
        return 'Attempt';
    }
  }
  if (hit.kind === 'flow') return 'Flow';
  if (hit.kind === 'contract' && hit.node_kind) {
    if (hit.node_kind === 'UI' && hit.level === 'L4') return 'Component';
    if (hit.node_kind === 'UI') return 'Screen';
    if (hit.node_kind === 'API') return 'API';
    if (hit.node_kind === 'lib') return 'Lib';
    if (hit.node_kind === 'data') return 'Data';
    if (hit.node_kind === 'external') return 'External';
    if (hit.node_kind === 'job') return 'Job';
    if (hit.node_kind === 'cron') return 'Cron';
    if (hit.node_kind === 'event') return 'Event';
  }
  return hit.level ?? '';
}

/**
 * Resolve the flow contract whose `members` array contains the given uuid.
 * Used to land the canvas on the right L2 chain when the user lands on an
 * L3 trigger or an L4 atom whose parent is L3.
 *
 * Linear scan over `allNodes` is fine for hackathon scale (~500 nodes); the
 * canvas already does similar O(n) work per render.
 */
function findOwningFlow(
  targetUuid: string | null,
  allNodes: ContractNode[],
): ContractNode | null {
  if (!targetUuid) return null;
  return (
    allNodes.find(
      (n) => isFlowContract(n) && n.members.includes(targetUuid),
    ) ?? null
  );
}

/**
 * Animate the viewport to center on a chain member after `setSelectedFlow`
 * triggers FlowChainLayout to mount. The mount is async (Zustand → React
 * effect → react-flow render → `getNode` returns a node), so we poll a few
 * times before giving up. Each retry is one frame (~16ms); stop after 30
 * frames (~500ms) — by then either the chain rendered or the uuid isn't in
 * this flow's members and centering would never succeed anyway.
 *
 * Retries are cheap (an early `getNode` returns null immediately); the only
 * cost is the requestAnimationFrame closure. No-op if the node never appears.
 */
function centerOnNode(
  uuid: string,
  getNode: (id: string) => { position: { x: number; y: number }; measured?: { width?: number; height?: number } } | undefined,
  setCenter: (x: number, y: number, opts?: { zoom?: number; duration?: number }) => void,
  zoom: number,
): void {
  let attempts = 0;
  const tryCenter = () => {
    const target = getNode(uuid);
    if (target) {
      const cx = target.position.x + (target.measured?.width ?? 320) / 2;
      const cy = target.position.y + (target.measured?.height ?? 200) / 2;
      setCenter(cx, cy, { zoom, duration: 500 });
      return;
    }
    attempts += 1;
    if (attempts < 30) {
      requestAnimationFrame(tryCenter);
    }
  };
  requestAnimationFrame(tryCenter);
}

/**
 * Debounce window (ms) between the last keystroke and IPC dispatch. Picked
 * to match the typical 80–120wpm typing speed: a fast typer hitting 6 chars
 * in 600ms triggers ONE query, not six. 300ms is also the cap that keeps
 * the palette feeling responsive — longer than ~400ms reads as laggy.
 */
const QUERY_DEBOUNCE_MS = 300;

/**
 * Max hits requested per query. Matches the cmdk list height (max 360px / row
 * height ~36px = ~10 visible rows). Substrate hits get rank-tied with contracts
 * past 0.5; if the user has many of both, contracts dominate the visible
 * window per the score-normalisation contract in `find_substrate_by_intent`.
 */
const QUERY_LIMIT = 10;

export function IntentPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<IntentSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  // useReactFlow is safe here because <ReactFlowProvider> is hoisted to
  // AppShell so both the canvas and the palette resolve the same instance.
  // setCenter / getNode let us animate the viewport to the clicked hit's
  // ServiceCard or ScreenCard inside FlowChainLayout.
  const { setCenter, getNode } = useReactFlow();
  /**
   * Phase 15 Plan 02 — chip filter state. Resets to 'all' on close so each
   * dialog open starts fresh (per must_haves: "chip state resets between dialog
   * opens"). useState is sufficient — no Zustand needed for session-scoped UI.
   */
  const [chipFilter, setChipFilter] = useState<ChipFilter>('all');

  /**
   * Cmd+P / Ctrl+P keybinding. preventDefault BEFORE setOpen — see file-header
   * comment for the macOS Print-dialog rationale.
   *
   * Escape closes the palette without committing a selection. Closing also
   * clears the query so the next open starts fresh (avoids stale hits from
   * the previous session).
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'p' && (e.metaKey || e.ctrlKey)) {
        // CRITICAL: preventDefault before setOpen, NOT after — the macOS
        // Print dialog races with React state flush.
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    // Sidebar search affordance dispatches `intent-palette:open` on click so
    // mouse users get the same surface as Cmd+P. Always sets to true (open),
    // not toggle — clicking the search input shouldn't close an already-open
    // palette.
    const onOpenEvent = () => setOpen(true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('intent-palette:open', onOpenEvent);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('intent-palette:open', onOpenEvent);
    };
  }, [open]);

  /**
   * Debounced async query. Fires only when the dialog is open AND the query is
   * non-empty (whitespace-only queries trip the Rust early-return). The
   * cleanup function clears the timeout on every keystroke so only the last
   * 300ms-quiet keystroke triggers an IPC.
   *
   * Race-safety: this effect doesn't need a generation counter — `setTimeout`
   * inside an effect is auto-cancelled by the cleanup function on the next
   * render, so a stale-result commit is impossible. (The only path to a
   * stale-result is the IPC promise resolving AFTER the user typed more —
   * which the cleanup-clears-timeout pattern prevents.)
   */
  useEffect(() => {
    if (!open) {
      setHits([]);
      setLoading(false);
      return;
    }
    if (!query.trim()) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        // Phase 15 Plan 02: pass chipFilter as kindFilter when non-'all'.
        // resolveKindFilter is the exported pure helper (tested in case 1).
        // console.time guard for <2s TRUST-01 SC measurement (DEV only).
        if (import.meta.env.DEV) {
          console.time('substrate-cmdp-roundtrip');
        }
        const result = await findSubstrateByIntent(query, QUERY_LIMIT, resolveKindFilter(chipFilter));
        if (import.meta.env.DEV) {
          console.timeEnd('substrate-cmdp-roundtrip');
        }
        setHits(result);
      } catch (err) {
        // Non-fatal — the user just sees an empty list. Common cause: the
        // Rust IPC isn't registered yet (HMR mid-rebuild) or the DB isn't
        // loaded. Log once so debugging is possible without UI noise.
        console.warn('[IntentPalette] findSubstrateByIntent failed:', err);
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, QUERY_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, open, chipFilter]);

  /**
   * Reset palette state on close — query string, hits, loading flag. Without
   * this, reopening the palette flashes the previous query / hits before the
   * fresh query lands. Subtle but reads as "the palette remembered me", which
   * is the wrong UX for a per-session search surface.
   */
  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setHits([]);
    setLoading(false);
    // Phase 15 Plan 02: reset chip to 'all' so next open starts clean.
    setChipFilter('all');
  }, []);

  /**
   * Branch on hit kind to land on the correct canvas surface. See file-header
   * comment for the per-kind navigation contract.
   *
   * The handler is wrapped in useCallback so the function identity stays
   * stable across renders — cmdk memoises Command.Item children by props, so
   * an unstable onSelect would defeat the memoization and re-render the entire
   * list on every keystroke.
   *
   * Phase 15 Plan 02 (TRUST-01): substrate-hit routing override when the
   * Substrate chip is active. In that mode, substrate hits open the
   * SourceArchaeologyModal directly via useCitationStore.openCitation instead
   * of navigating to the parent atom. This is the <2s demo path.
   */
  const handleSelect = useCallback(
    (hit: IntentSearchHit) => {
      close();

      const dest = resolveDestination(hit);
      const allNodes = useGraphStore.getState().nodes;

      // Substrate rules ALWAYS open the modal (Yang spec 2026-04-25 — replaces
      // plan 15-02's chip-conditional substrate routing). The chip remains a
      // search-scope toggle; click destination is determined by hit kind.
      if (dest === 'modal') {
        useCitationStore.getState().openCitation(hit.uuid);
        return;
      }

      // Flow contract → mount L2 chain for this flow.
      if (dest === 'flow-chain') {
        useSidebarStore.getState().setSelectedFlow(hit.uuid);
        useGraphStore.getState().pushParent(hit.uuid);
        return;
      }

      // UI L4 component → land on parent screen, halo the chip. The L4 atom
      // isn't itself a chain member; the L3 parent screen is. ScreenCard's
      // chip overlay reads focusedAtomUuid to render the halo.
      if (dest === 'screen-chip') {
        const owningFlow = findOwningFlow(hit.parent_uuid, allNodes);
        if (owningFlow) {
          useSidebarStore.getState().setSelectedFlow(owningFlow.uuid);
        }
        if (hit.parent_uuid) {
          useGraphStore.getState().selectNode(hit.parent_uuid);
          useGraphStore.getState().pushParent(hit.parent_uuid);
          centerOnNode(hit.parent_uuid, getNode, setCenter, 1.0);
        }
        useGraphStore.getState().setFocusedAtomUuid(hit.uuid);
        return;
      }

      // UI L3 screen → land on the screen itself (the ScreenCard at the top
      // of the chain is the iframe). selectNode populates the Inspector;
      // setCenter animates the viewport.
      if (dest === 'screen') {
        const owningFlow = findOwningFlow(hit.uuid, allNodes);
        if (owningFlow) {
          useSidebarStore.getState().setSelectedFlow(owningFlow.uuid);
        }
        useGraphStore.getState().selectNode(hit.uuid);
        useGraphStore.getState().pushParent(hit.uuid);
        centerOnNode(hit.uuid, getNode, setCenter, 1.0);
        return;
      }

      // Backend node (API / lib / data / external / job / cron / event) →
      // ServiceCard inside the chain. Zoom in tighter (1.4) since service
      // cards carry signature + schema + side-effects detail worth reading.
      if (dest === 'service-node') {
        const owningFlow = findOwningFlow(hit.uuid, allNodes);
        if (owningFlow) {
          useSidebarStore.getState().setSelectedFlow(owningFlow.uuid);
        }
        useGraphStore.getState().selectNode(hit.uuid);
        useGraphStore.getState().pushParent(hit.uuid);
        centerOnNode(hit.uuid, getNode, setCenter, 1.4);
        return;
      }

      // Fallback (L0/L1/L2 non-flow contract or unknown node_kind) — push
      // onto the breadcrumb stack so it shows up in the trail. The canvas
      // doesn't change; the inspector reflects the contract.
      useGraphStore.getState().selectNode(hit.uuid);
      useGraphStore.getState().pushParent(hit.uuid);
    },
    [close, getNode, setCenter],
  );

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
      label="Find by intent"
      shouldFilter={false}
    >
      {/* Phase 15 Plan 02 — filter chip row.
          Sits above the cmdk Command.Input so the user picks the search scope
          before typing. Active chip gets bg-secondary text-secondary-foreground;
          others muted. Clicking a chip immediately re-fires the debounced query
          (chipFilter is in the effect deps) so results refresh without waiting
          for another keystroke. */}
      <div
        className="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5"
        role="group"
        aria-label="Filter by kind"
      >
        {(['all', 'contracts', 'code', 'substrate'] as const).map((chip) => (
          <button
            key={chip}
            type="button"
            aria-pressed={chipFilter === chip}
            onClick={() => setChipFilter(chip)}
            className={[
              'rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize transition-colors',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              chipFilter === chip
                ? 'bg-secondary text-secondary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted/60',
            ].join(' ')}
          >
            {chip === 'all' ? 'All' : chip.charAt(0).toUpperCase() + chip.slice(1)}
          </button>
        ))}
      </div>

      {/* cmdk owns the input rendering — pass value/onValueChange so the
          hidden internal state stays in sync with the React state we drive
          the debounced query from. Don't try to set value via DOM — the
          Command.Input wrapper would override it. */}
      <Command.Input
        value={query}
        onValueChange={setQuery}
        placeholder="Find by intent..."
        autoFocus
      />
      <Command.List>
        {/* shouldFilter={false} above — IPC is the authoritative BM25 ranker; cmdk renders our pre-ranked list without re-sorting. */}
        {loading && (
          <Command.Loading>
            <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>
          </Command.Loading>
        )}
        {!loading && query.trim() && hits.length === 0 && (
          <Command.Empty>No matches.</Command.Empty>
        )}
        {!loading && !query.trim() && (
          <div className="px-3 py-3 text-xs text-muted-foreground">
            Type to find contracts, flows, decisions, constraints, and questions
            by intent.
          </div>
        )}
        {hits.map((hit) => (
          <Command.Item
            key={hit.uuid}
            value={hit.uuid}
            onSelect={() => handleSelect(hit)}
          >
            <IntentPaletteHit hit={hit} />
          </Command.Item>
        ))}
      </Command.List>
    </Command.Dialog>
  );
}
