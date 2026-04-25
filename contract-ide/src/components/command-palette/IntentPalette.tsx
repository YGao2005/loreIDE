/**
 * Phase 13 Plan 03 — Cmd+P semantic intent palette (SUB-08).
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
 *   - Substrate hit (constraint / decision / open_question / resolved_question / attempt):
 *       use the canonical setter `useGraphStore.selectNode(parent_uuid)` so the
 *       Inspector opens on the atom the substrate node speaks to. Plan 13-07
 *       (chat archaeology modal) will refine this; for now, parent-contract
 *       selection is the right "land here, see context" behaviour.
 *
 * **Pitfall guard (research §Pitfall 2):** `e.preventDefault()` MUST run BEFORE
 * `setOpen` on the Cmd+P listener. macOS's default Cmd+P opens the system
 * Print dialog. Without preventDefault, the dialog fires alongside the palette
 * and the keystroke is unrecoverable until the user dismisses it.
 *
 * **Canonical setter API (per plan 13-01 SUMMARY checker N7):** all graphStore
 * mutations use `selectNode` (NOT `setSelectedNode`) and `setFocusedAtomUuid`
 * (NOT raw `useGraphStore.setState({ focusedAtomUuid: ... })`).
 */

import { useCallback, useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { findSubstrateByIntent, type IntentSearchHit } from '@/ipc/substrate';
import { useGraphStore } from '@/store/graph';
import { useSidebarStore } from '@/store/sidebar';
import { IntentPaletteHit } from './IntentPaletteHit';
import './commandPalette.css';

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
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
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
        const result = await findSubstrateByIntent(query, QUERY_LIMIT);
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
  }, [query, open]);

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
  }, []);

  /**
   * Branch on hit kind to land on the correct canvas surface. See file-header
   * comment for the per-kind navigation contract.
   *
   * The handler is wrapped in useCallback so the function identity stays
   * stable across renders — cmdk memoises Command.Item children by props, so
   * an unstable onSelect would defeat the memoization and re-render the entire
   * list on every keystroke.
   */
  const handleSelect = useCallback(
    (hit: IntentSearchHit) => {
      close();

      if (hit.kind === 'flow') {
        // Flow → land at L2 vertical-chain view. Both stores updated so:
        //   - Sidebar's flow-row selection state matches the canvas focus.
        //   - Canvas drill-in renders the L2 chain via parent stack.
        useSidebarStore.getState().setSelectedFlow(hit.uuid);
        useGraphStore.getState().pushParent(hit.uuid);
        return;
      }

      if (hit.kind === 'contract' && hit.level === 'L4') {
        // L4 atom → land at parent's L3 trigger view, focus the atom chip.
        // setFocusedAtomUuid is consumed by plan 13-05 ScreenCard for halo;
        // pushParent drives the canvas to render the parent surface. If
        // parent_uuid is null (orphan atom — defensive, shouldn't happen in
        // practice), we still focus the atom so the Inspector can show it.
        if (hit.parent_uuid) {
          useGraphStore.getState().pushParent(hit.parent_uuid);
        }
        useGraphStore.getState().setFocusedAtomUuid(hit.uuid);
        return;
      }

      if (hit.kind === 'contract') {
        // L0–L3 non-flow contract → push it onto the parent stack so the
        // canvas drills into its child surface.
        useGraphStore.getState().pushParent(hit.uuid);
        return;
      }

      // Substrate hit — open the atom that the substrate node speaks to via
      // the canonical setter (selectNode, NOT setSelectedNode per plan 13-01
      // SUMMARY checker N7). Plan 13-07 (chat archaeology modal) will refine
      // this with a substrate-detail surface; for now, parent-atom selection
      // is the right "land here, see related substrate" behaviour.
      if (hit.parent_uuid) {
        useGraphStore.getState().selectNode(hit.parent_uuid);
      }
    },
    [close],
  );

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
      label="Find by intent"
      shouldFilter={false}
    >
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
