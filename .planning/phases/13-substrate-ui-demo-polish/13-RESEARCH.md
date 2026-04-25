# Phase 13: Substrate UI + Demo Polish — Research

**Researched:** 2026-04-24
**Domain:** React UI composition · react-flow overlay layering · cmdk command palette extension · SQLite provenance queries · Tauri event bus · demo orchestration + fixture management
**Confidence:** HIGH on existing-surface inventory and integration points (all verified against shipped Phase 1–7 code). MEDIUM on Phase 8–12 output shapes (phases not yet started; shapes inferred from locked ROADMAP planning notes and Phase 8 CONTEXT.md). LOW on Cmd+P semantic retrieval precision (depends on Phase 11 embedding quality at runtime).

---

## Summary

Phase 13 is the integration and demo-closing phase. It consumes outputs from Phases 10–12 and surfaces them in the UI through six deliverables: Cmd+P intent search, canvas substrate-state overlay, chat archaeology, PR-review intent-drift mode, mocked Sync affordance, and end-to-end demo reproducibility. No new data pipelines are built here — the data is assumed to exist. Phase 13's job is to make it visible, interactive, and demo-filmable.

The shipped codebase through Phase 7 provides strong integration points. The command palette uses `cmdk` v1.1.1 with an established `Command.Dialog` pattern at `CommandPalette.tsx`. The graph canvas uses `@xyflow/react` v12 with `useMemo`-computed node arrays and a `cva` style matrix already extended by Phase 8 with `rollup_stale` (amber) and `rollup_untracked` (gray) variants. The drift store pattern (`useDriftStore`) has a clean immutable-set API that Phase 13 can mirror for substrate state. The inspector already has four tabs and a `DriftBadge` pattern to extend.

The highest risks are (1) animation performance — the blast-radius animation for Sync and the canvas overlay must hold 50fps at 500 nodes, and (2) demo determinism — the 4-beat script requires pre-seeded fixtures and reset procedures that have never been production-tested end-to-end. These must be addressed in the first planning wave.

**Primary recommendation:** Plan in two waves. Wave 1 covers the UI deliverables that depend only on Phase 9 + Phase 11 outputs (Cmd+P, canvas overlay, chat archaeology — three plans). Wave 2 covers the demo-orchestration deliverables that depend on Phase 12 (PR-review intent-drift, Sync affordance, end-to-end demo rehearsal — two plans). The runbook rewrite and live-scenario replacement can absorb into Wave 2 Plan 5 as a co-deliverable.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SUB-08 | Substrate UI surface — Cmd+P by intent, canvas substrate-state coloring, chat archaeology | cmdk `Command.Dialog` extension; new Zustand store for substrate-state overlay; SQLite provenance query pattern |
| SUB-09 | PR-review intent-drift mode — paste PR diff, canvas colors affected/drifted nodes; reviewer reads explanation in ≤30s | Diff parsing via client-side text splitting; Phase 12 conflict engine provides the `intent_drifted` signal; canvas highlighting reuses existing `driftedUuids` pattern |
| DEMO-04 | 4-beat live demo reproducible — runs end-to-end 3× before filming, including all four beats with closed-loop harvest-back | Reset procedure extension to cover full 4-beat fixture set; rehearsal-log template; runbook-v2.md rewrite |
</phase_requirements>

---

## Standard Stack

### Core (all already installed — no new npm installs required for core features)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `cmdk` | 1.1.1 | Command palette UI foundation for Cmd+P | Already installed; ships `Command.Dialog`, `Command.Input`, `Command.List` primitives; React 19 override in `package.json` overrides is load-bearing |
| `@xyflow/react` | ^12.10.2 | Canvas node rendering + state overlay | Already installed; `onlyRenderVisibleElements` is on from Phase 3; node `data` prop carries arbitrary typed payloads |
| `zustand` | ^5.0.12 | Substrate-state store (fresh/stale/superseded/intent-drifted per UUID) | Pattern established by `useDriftStore`; same immutable-Set API works for substrate-state overlay |
| `class-variance-authority` (cva) | ^0.7+ | Node visual-state encoding | Already installed; `contractNodeStyles.ts` ships `drifted` + (post-Phase 8) `rollup_stale` + `rollup_untracked` variants; Phase 13 extends with `superseded` + `intent_drifted` |
| `shadcn/ui` | ^4.4.0 | Dialog for chat-archaeology modal + PR-review panel | Already installed; Dialog pattern established by `ReconcilePanel.tsx` in Phase 7 |
| `tauri-plugin-sql` | (existing) | SQLite queries for provenance + substrate-state | Already wired; `tauri-plugin-sql` migrations + Rust IPC pattern established across all phases |

### Supporting (new installs, if needed)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `diff` (npm) | ^7.0 | Client-side unified diff parser for PR-review mode | Only if server-side diff parsing is unavailable from Phase 12; lightweight pure-JS |
| `react-diff-viewer-continued` | ^4.x | Renders diff hunks in a pane — optional visual polish | Only if the PR-review panel needs rendered diff alongside canvas highlighting |

**Installation (only if needed):**
```bash
npm install diff
# react-diff-viewer-continued only if Phase 12 doesn't expose a diff format
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Extending existing `cmdk` palette | New Spotlight-style library | cmdk is already installed + wired to `ReactFlowProvider`; switching creates provider scope work |
| Zustand immutable-Set for substrate overlay | React context | Context re-renders more broadly; Zustand selective subscription matches Phase 7's `useDriftStore` pattern exactly |
| Client-side diff parsing | Rust IPC for diff | Rust IPC adds latency and Rust impl cost; PR diff text is small enough for JS |

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── components/
│   ├── command-palette/
│   │   ├── CommandPalette.tsx        # extend for Cmd+P (currently Cmd+K only)
│   │   ├── IntentPalette.tsx         # NEW — Cmd+P semantic palette
│   │   └── actions.ts                # extend with substrate node actions
│   ├── graph/
│   │   ├── contractNodeStyles.ts     # ADD superseded + intent_drifted CVA variants
│   │   ├── GraphCanvasInner.tsx      # ADD substrateStateUuids to buildFlowNodes
│   │   └── SubstrateOverlay.tsx      # NEW — precedence compositor for node coloring
│   ├── inspector/
│   │   ├── SourceArchaeologyModal.tsx # NEW — chat archaeology Dialog
│   │   └── SubstrateNodeDetail.tsx   # NEW — [source] click panel
│   └── substrate/
│       ├── SyncButton.tsx            # NEW — mocked Sync affordance
│       ├── PRReviewPanel.tsx         # NEW — paste PR diff → canvas highlighting
│       └── HarvestPanel.tsx          # NEW — Beat 4 harvest-back notification
├── store/
│   └── substrate.ts                  # NEW — Zustand store for substrate state per UUID
└── ipc/
    └── substrate.ts                  # NEW — IPC wrappers for substrate queries
```

### Pattern 1: Substrate State Store (mirrors useDriftStore exactly)

**What:** Zustand store keyed by UUID → substrate state enum.
**When to use:** Any canvas node coloring driven by substrate state (fresh/stale/superseded/intent-drifted).

```typescript
// src/store/substrate.ts
// Source: mirroring useDriftStore pattern from src/store/drift.ts (Phase 7)
type SubstrateNodeState = 'fresh' | 'stale' | 'superseded' | 'intent_drifted';

interface SubstrateState {
  nodeStates: Map<string, SubstrateNodeState>;
  setNodeState: (uuid: string, state: SubstrateNodeState) => void;
  bulkSet: (updates: { uuid: string; state: SubstrateNodeState }[]) => void;
  reset: () => void;
}

export const useSubstrateStore = create<SubstrateState>((set) => ({
  nodeStates: new Map(),
  setNodeState: (uuid, state) =>
    set((s) => {
      const next = new Map(s.nodeStates);
      next.set(uuid, state);
      return { nodeStates: next };
    }),
  bulkSet: (updates) =>
    set((s) => {
      const next = new Map(s.nodeStates);
      for (const { uuid, state } of updates) next.set(uuid, state);
      return { nodeStates: next };
    }),
  reset: () => set({ nodeStates: new Map() }),
}));
```

### Pattern 2: Canvas Overlay Precedence Compositor

**What:** Single function that takes drift state + rollup state + substrate state and returns the final CVA variant, with red > orange > amber > gray precedence.
**When to use:** `buildFlowNodes` in `GraphCanvasInner.tsx`.

```typescript
// Extension of existing logic in GraphCanvasInner.tsx
// Source: Phase 7 Plan 07-03 state-override pattern + Phase 13 SC 2 precedence rule
function resolveNodeState(
  uuid: string,
  driftedUuids: Set<string>,       // Phase 7 — code drift → red
  rollupStaleUuids: Set<string>,    // Phase 8 — rollup stale → amber
  untrackedUuids: Set<string>,      // Phase 8 — rollup untracked → gray
  substrateStates: Map<string, SubstrateNodeState>, // Phase 13 — substrate overlay
): NodeVisualState {
  if (driftedUuids.has(uuid)) return 'drifted';           // red — highest priority
  const sub = substrateStates.get(uuid);
  if (sub === 'intent_drifted') return 'intent_drifted';  // orange
  if (rollupStaleUuids.has(uuid)) return 'rollup_stale';  // amber
  if (sub === 'superseded') return 'superseded';           // orange-gray (muted)
  if (untrackedUuids.has(uuid)) return 'rollup_untracked';// gray
  return 'healthy';
}
```

CVA variants to add to `contractNodeStyles.ts`:
```typescript
// ADD to state variants in contractNodeStyles.ts:
intent_drifted: 'ring-2 ring-orange-500 animate-pulse',    // Beat 3 orange flag
superseded:     'ring-1 ring-orange-400 opacity-75',        // muted orange, not pulsing
```

### Pattern 3: Cmd+P Intent Palette (extends existing Cmd+K cmdk component)

**What:** Separate `IntentPalette.tsx` component with `Command.Dialog` driven by Cmd+P. Queries `find_by_intent` (contract FTS5, already in MCP) + `find_constraints_for_goal` + `find_decisions_about` (Phase 11 MCP tools). Returns ranked hits across all substrate node types.
**When to use:** Cmd+P keypress anywhere in the app.

The existing `CommandPalette.tsx` handles Cmd+K. Phase 13 adds a parallel `IntentPalette.tsx` with Cmd+P binding. The Cmd+K palette handles actions; the Cmd+P palette handles navigation by intent. Two separate components, two separate keyboard bindings — no collision risk.

```typescript
// src/components/command-palette/IntentPalette.tsx
// Source: established cmdk pattern from CommandPalette.tsx (Phase 3 Plan 03-03)
// Key difference: input drives a debounced async query rather than filtering
// a static action list. Use 300ms debounce — matches MCP query latency budget.
export function IntentPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SubstrateSearchHit[]>([]);

  // Cmd+P binding — same prevention pattern as Cmd+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'p' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Debounced query against substrate MCP tools via Tauri IPC
  // Phase 11 exposes find_constraints_for_goal + find_decisions_about
  // Phase 5 exposes find_by_intent (contract FTS5)
  // ...
}
```

### Pattern 4: Chat Archaeology Modal

**What:** When user clicks `[source]` on a substrate node, open a `shadcn Dialog` showing the verbatim quote and session turn context. Data comes from a Rust IPC call that reads `.contracts/journal/<session-id>.jsonl` (Phase 8 PostToolUse hook journal) + Phase 10's `sessions` table.
**When to use:** Any `[source]` provenance link on a substrate node.

The quote + turn reference is already on every substrate node: `session_id`, `turn_ref`, `verbatim_quote` (per Phase 11 schema). The IPC is a simple SQLite SELECT:
```sql
SELECT session_id, turn_ref, verbatim_quote, actor, confidence
FROM substrate_nodes WHERE uuid = ?
```

Displaying the verbatim quote inline (no file I/O needed — the quote is in SQLite) satisfies the ≤5s click-to-readable criterion. The "scroll to exact turn" behavior is a stretch — show the quote and `session_id:turn_ref` identifier; deep-link into the raw JSONL is v2 polish.

### Pattern 5: Mocked Sync Affordance

**What:** A `SyncButton` component in the developer view that, on click, dispatches a Tauri event that triggers a blast-radius animation on the canvas. The "sync" is pre-loaded state — no real socket or multi-machine transport.
**When to use:** Beat 3 entry — T's laptop, after NT delegates.

Implementation:
1. Pre-load the substrate state fixture (the 3 affected nodes from the delete-account implementation) into the `useSubstrateStore` on app launch against the seeded SQLite.
2. `SyncButton` on click emits a `sync:trigger` event via Tauri's `emit()` API.
3. `GraphCanvasInner` subscribes to `sync:trigger`; on fire, animates the 3 known UUIDs with a brief "incoming" ring flash before settling to their substrate states.
4. The animation is CSS keyframe on the CVA ring variant — no additional library needed.

```typescript
// SyncButton.tsx — Beat 3 staging
// Pre-loaded payload: { affectedUuids: ['...', '...', '...'] }
// Fires: await invoke('trigger_sync_animation', { affectedUuids })
// Canvas: subscribes to sync:triggered Tauri event, applies transient ring on affected nodes
```

### Anti-Patterns to Avoid

- **Re-querying the substrate on every node render.** All substrate state must be batch-loaded into `useSubstrateStore` on canvas mount and on Tauri event (e.g., `substrate:updated`). Never query per-node in `buildFlowNodes`.
- **Extending `useDriftStore` for substrate state.** They're separate concerns. Mixing them makes precedence logic fragile and the store hard to reset independently.
- **Nesting a second `Command.Dialog` inside the existing one.** The Cmd+P palette must be a sibling to the Cmd+K palette at the `AppShell` level, not nested inside it.
- **Making the PR-review mode a separate "mode" with a mode toggle.** PR-review is a panel + canvas highlighting mode, not a separate application mode. It overlays on the existing canvas rather than replacing the lens.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Semantic fuzzy match in Cmd+P | Custom embedding distance in JS | Phase 11's `find_constraints_for_goal` MCP tool (already has embedding + LLM rerank) | Phase 11 does the hard work; Phase 13 just calls the MCP tool via Tauri IPC and renders hits |
| Intent-drift detection for PR review | Custom diff parser + LLM | Phase 12 conflict engine's `intent_drifted` state + affected_uuids payload | Phase 12 already computes which nodes are intent-drifted; Phase 13 pastes diff → invokes Phase 12 IPC → reads the result |
| Canvas animation for Sync blast-radius | Custom canvas renderer | Existing CVA ring animation + `useSubstrateStore.bulkSet` | The amber/rollup_stale pulse animation already exists; Sync just triggers it on pre-known UUIDs with a 50ms stagger |
| Provenance session navigation | Custom JSONL file reader | `verbatim_quote` + `turn_ref` from SQLite `substrate_nodes` table | The quote is already in the DB from Phase 11 distiller; no need to re-parse the raw JSONL for the demo use case |

**Key insight:** Phase 13 is a UI consumer, not a pipeline builder. Every "hard" question (what's intent-drifted? what did this session say?) is answered by upstream phases. Phase 13's job is to ask the right questions and render the answers.

---

## Common Pitfalls

### Pitfall 1: Performance regression when adding substrate-state overlay
**What goes wrong:** Adding another `useMemo` dependency (`substrateStates`) to `buildFlowNodes` triggers re-computation on every substrate state change, even for unrelated nodes, causing jank at 500 nodes.
**Why it happens:** `Map` references are compared by identity in Zustand; any `bulkSet` call creates a new `Map`, triggering the `useMemo` regardless of whether the changed UUIDs are on screen.
**How to avoid:** Gate `buildFlowNodes` re-computation on `useMemo` with `substrateStates` as a dependency, but ensure `bulkSet` only fires when there's an actual diff. Pre-filter to visible-viewport UUIDs before calling `bulkSet` (react-flow exposes `getViewport` + `getNodes` for this). Measure with `react-flow`'s `onlyRenderVisibleElements` — only visible nodes re-render.
**Warning signs:** `buildFlowNodes` call count in React DevTools profiler exceeds once per user action.

### Pitfall 2: Cmd+P and Cmd+K binding collision
**What goes wrong:** Cmd+P on macOS is the system "Print" shortcut. WebKit may intercept it before the keydown listener fires.
**Why it happens:** Same root cause as Cmd+K / Cmd+S — WebKit intercepts meta-key shortcuts at the OS level.
**How to avoid:** Apply `e.preventDefault()` before `setOpen()` in the keydown handler, exactly as the existing Cmd+K handler does in `CommandPalette.tsx`. Validate this in a Tauri `.app` bundle (not just `tauri dev`) — same caveat as Plan 01-04.
**Warning signs:** Print dialog appears when Cmd+P is pressed in the running app.

### Pitfall 3: Mocked Sync animation firing against wrong fixture state
**What goes wrong:** The blast-radius animation runs but the "receiving" substrate state doesn't match what Beat 3 expects — affected nodes don't pulse, or wrong nodes pulse.
**Why it happens:** The Sync fixture is pre-loaded via SQLite seed; if the substrate store isn't populated from SQLite on launch, the animation fires against empty state.
**How to avoid:** `useSubstrateStore` must hydrate from SQLite on app launch (or on repo open) via a `get_substrate_states_for_canvas` IPC call. Verify in the reset procedure that substrate store is populated before triggering Sync.
**Warning signs:** Beat 3 canvas shows no animation after Sync click.

### Pitfall 4: Chat archaeology click produces blank modal
**What goes wrong:** `[source]` click opens the Dialog but the verbatim quote is empty.
**Why it happens:** The `substrate_nodes.verbatim_quote` field is NULL for nodes that were seeded directly via SQLite fixture (not distilled from a real session). The distiller (Phase 11) writes the quote; hand-seeded fixtures may omit it.
**How to avoid:** The SQLite seed fixture MUST include `verbatim_quote` for all substrate nodes that will be `[source]`-clicked in the demo. Validate during fixture prep, not on demo day.
**Warning signs:** Modal opens with empty body text.

### Pitfall 5: PR-review diff parsing fails on non-unified-diff format
**What goes wrong:** Paste a GitHub PR URL instead of the raw diff text; the parser gets HTML or a redirect.
**Why it happens:** GitHub PR URLs redirect to the web UI, not the raw diff.
**How to avoid:** The PR-review panel accepts raw diff text only (paste the output of `git diff`). For demo purposes, the diff is pre-committed in the fixtures directory and pasted from there. Document this clearly in the runbook.
**Warning signs:** Parser error on input, or parsed output shows 0 hunks.

### Pitfall 6: Orange flag visual indistinguishable from amber at 1080p
**What goes wrong:** Beat 3's intent-drift orange flag looks the same as Phase 8's rollup-stale amber on the recording — judges can't see the difference.
**Why it happens:** Amber (#f59e0b) and orange (#f97316) are close in luminance when recorded at compressed video bitrate.
**How to avoid:** Use `ring-orange-600` (not `ring-orange-500`) for `intent_drifted` — darker hue. Test the recording on a phone at arm's length. Consider adding a subtle animated halo (CSS `box-shadow` pulsing) to `intent_drifted` nodes, distinct from the simple ring on `rollup_stale`. The runbook already flags this.
**Warning signs:** Screen recording appears to show amber on both node types.

### Pitfall 7: Demo reset doesn't restore substrate store state
**What goes wrong:** `reset-demo.sh` restores the SQLite file but the in-memory `useSubstrateStore` retains state from the previous run.
**Why it happens:** The app doesn't re-hydrate from SQLite unless the repo is re-opened.
**How to avoid:** The reset script must quit and relaunch Contract IDE (not just the dev server). Alternatively, expose a `reset_substrate_store` IPC that clears both the SQLite fixture and the in-memory store — and call it from the reset script. The simpler approach is full app relaunch.

---

## Code Examples

Verified patterns from official sources and existing codebase:

### CVA Extension — adding `intent_drifted` and `superseded` states

```typescript
// Extension of src/components/graph/contractNodeStyles.ts
// Source: existing cva pattern in contractNodeStyles.ts (Phase 3 Plan 03-01)
state: {
  healthy:          '',
  drifted:          'ring-2 ring-red-500 animate-pulse',      // Phase 7
  rollup_stale:     'ring-2 ring-amber-500 animate-pulse',    // Phase 8
  rollup_untracked: 'ring-1 ring-slate-400 opacity-60',       // Phase 8
  intent_drifted:   'ring-2 ring-orange-600 animate-pulse shadow-[0_0_8px_2px_rgba(234,88,12,0.4)]', // Phase 13 — orange with glow
  superseded:       'ring-1 ring-orange-400 opacity-75',      // Phase 13 — muted, no pulse
},
```

### Substrate IPC wrapper

```typescript
// src/ipc/substrate.ts
// Source: pattern established in ipc/drift.ts (Phase 7 Plan 07-03)
import { invoke } from '@tauri-apps/api/core';

export interface SubstrateNodeSummary {
  uuid: string;
  kind: 'constraint' | 'decision' | 'open_question' | 'resolved_question' | 'attempt' | 'contract';
  state: 'fresh' | 'stale' | 'superseded' | 'intent_drifted';
  name: string;
  summary: string;
  session_id: string;
  turn_ref: string | null;
  verbatim_quote: string | null;
}

export async function getSubstrateStatesForCanvas(): Promise<SubstrateNodeSummary[]> {
  return invoke<SubstrateNodeSummary[]>('get_substrate_states_for_canvas');
}

export async function getSubstrateNodeDetail(uuid: string): Promise<SubstrateNodeSummary> {
  return invoke<SubstrateNodeSummary>('get_substrate_node_detail', { uuid });
}

export async function findByIntentSubstrate(query: string, limit = 10): Promise<SubstrateNodeSummary[]> {
  // Calls Phase 11's contract-anchored retrieval via MCP sidecar IPC
  return invoke<SubstrateNodeSummary[]>('find_substrate_by_intent', { query, limit });
}
```

### Harvest Panel notification (Beat 4)

```typescript
// src/components/substrate/HarvestPanel.tsx
// Source: Tauri event subscription pattern (established Phase 7 AppShell subscription)
// Listens for substrate:nodes-added event; renders a notification card
// with the newly-harvested node names + types
import { listen } from '@tauri-apps/api/event';

export function HarvestPanel() {
  const [recentNodes, setRecentNodes] = useState<HarvestedNode[]>([]);

  useEffect(() => {
    const unlisten = listen<HarvestedNode[]>('substrate:nodes-added', (e) => {
      setRecentNodes(e.payload);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  if (recentNodes.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 rounded-lg border bg-background/95 p-4 shadow-lg backdrop-blur">
      <p className="text-sm font-medium">{recentNodes.length} nodes captured from this session</p>
      {recentNodes.map((n) => (
        <div key={n.uuid} className="mt-1 text-xs text-muted-foreground">
          • {n.name}
        </div>
      ))}
    </div>
  );
}
```

### Blast-radius animation stagger (Sync affordance)

```typescript
// Stagger substrate state updates for visual effect — 50ms apart
// Source: Phase 9 MASS-01 spec (amber ring staggered 50ms apart, not simultaneous flash)
async function animateSyncBlastRadius(affectedUuids: string[]) {
  const { setNodeState } = useSubstrateStore.getState();
  for (let i = 0; i < affectedUuids.length; i++) {
    await new Promise<void>((res) => setTimeout(res, i * 50));
    setNodeState(affectedUuids[i], 'fresh'); // already-fresh nodes that "just synced"
  }
}
```

---

## Integration Points with Phases 8–12

Phase 13 is a pure consumer. Here are the specific APIs it depends on:

### From Phase 8 (Agent Loop + PostToolUse + Cross-Level Propagation)
- **`rollupStaleUuids` Zustand store** — Phase 8 Plan 08-02 ships this; Phase 13 reads it for the overlay precedence compositor. No new store needed.
- **`untrackedUuids` Zustand store** — same.
- **`DriftLocks` mutex map** — Phase 13 does not write to this; it's load-bearing for Phase 8's watcher. Phase 13 only reads visual state.
- **Per-session journal JSONL** at `.contracts/journal/<session-id>.jsonl` — Phase 13's chat archaeology may show `intent` fields from journal entries; the `verbatim_quote` in SQLite is the primary source.

### From Phase 9 (Demo Repo Seeding)
- **`contract-ide-demo` repo** at a locked commit — Phase 13 assumes this exists with 20+ ambient contracts + the delete-account scenario contracts.
- **SQLite seed fixture** with 5 substrate rules + parent-surface constraint + priority-shift record — Phase 13 inherits this from Phase 9's reset fixture work.

### From Phase 10 (Session Watcher)
- **`sessions` SQLite table** — Phase 13's chat archaeology reads `session_id` from substrate nodes and may show session metadata (start time, project path).
- **`substrate:nodes-added` Tauri event** — Phase 10 emits this when new sessions are ingested; Phase 13's HarvestPanel subscribes.

### From Phase 11 (Distiller + Retrieval)
- **`substrate_nodes` SQLite table** — columns: `uuid`, `type`, `name`, `text`, `applies_when`, `valid_at`, `invalid_at`, `session_id`, `turn_ref`, `verbatim_quote`, `actor`, `confidence`.
- **`find_constraints_for_goal(goal_text)` MCP tool** — Phase 13's Cmd+P calls this via a new `find_substrate_by_intent` Rust IPC that wraps the MCP tool (or calls SQLite directly using the same embedding similarity approach).
- **`find_decisions_about(topic)` MCP tool** — same.
- **`Delegate to agent` Inspector button** — Phase 11 ships this; Phase 13 doesn't re-implement it, but relies on it being present in Beat 1's NT laptop flow.
- **Implicit decisions manifest** (Phase 11 SC 7) — 3-row `decisions.json` per atom; Phase 13 renders these in the Beat 3 verifier panel (the "Implicit decisions" group below the 5 substrate-rule checkmarks).

### From Phase 12 (Conflict / Supersession Engine)
- **`intent_drifted` state on `substrate_nodes`** — Phase 12 sets `intent_drifted = true` on decision nodes when a L0 priority shift occurs; Phase 13 reads this to color canvas nodes orange.
- **Priority history query** — Phase 13's orange-flag side panel shows the priority shift timeline; this comes from a Rust IPC reading the `substrate_edges` + `l0_priority_history` (or equivalent) table that Phase 12 populates.
- **`affected_uuids` payload from PR-diff analysis** — Phase 12's conflict engine takes a diff and returns which nodes are affected; Phase 13's PR-review panel calls this IPC and passes the result to `useSubstrateStore.bulkSet`.

---

## Risks and Unknowns

### Risk 1: Phase 11 retrieval precision for Cmd+P
**Description:** Cmd+P semantic match requires ≥80% top-1 precision on 10 ambient queries. Phase 11's retrieval quality is unknown until Phase 11 is built and tested against the seeded fixture.
**Mitigation:** Phase 13 should include a precision validation step (run 10 test queries against the seeded substrate, measure top-1 hits) before declaring Cmd+P done. If precision falls below 80%, the fallback is to add FTS5 substring match as a first-pass filter before embedding similarity rerank — this degrades gracefully.
**Confidence:** LOW on hitting 80% without iteration.

### Risk 2: Phase 12 orange-flag fixture might not generalize
**Description:** Beat 3's orange flag depends on the `con-settings-no-modal-interrupts-2025-Q4` constraint being flagged as `intent_drifted` by Phase 12's engine. The constraint must have `valid_at` under the old `reduce-onboarding-friction` priority AND the new `compliance-first` priority must be the current one since 2026-04-24. If the fixture isn't precisely set up, the flag won't fire.
**Mitigation:** The orange-flag moment can be staged — hardcode the flag output against a pre-known fixture state rather than running the full Phase 12 invalidation prompt live. The runbook already calls this out as a `[STAGED]` moment.
**Confidence:** MEDIUM — the fixture is defined precisely in `scenario-criteria.md` § 8; the risk is Phase 12's IPC not being callable cleanly from Phase 13's UI.

### Risk 3: Sync animation timing with pre-loaded state
**Description:** The Sync click is supposed to animate "incoming" substrate updates. If the substrate state is already loaded (pre-loaded from fixture), the animation must simulate the arrival rather than showing a real state change.
**Mitigation:** The animation is purely visual — a brief `ring-flash` CSS keyframe on the known affected UUIDs (the 3 nodes from the delete-account implementation), followed by settling to their stable substrate state. This does not require a real state transition — it's choreography. Pre-compute the 3 UUIDs from the fixture and hardcode them in `SyncButton.tsx` for the demo.

### Risk 4: Demo reset doesn't have a working script until Phase 13 builds it
**Description:** `reset-demo.sh` was spec'd in `reset-procedure.md` to be built in Phase 10. If Phase 10 doesn't ship a complete script, Phase 13 inherits the work.
**Mitigation:** Phase 13 absorbs the reset script as a deliverable regardless of what Phase 10 ships. The script is simple (kill processes, `git reset --hard`, copy SQLite seed, start dev server, launch app). Budget ~2 hours for this in the demo-rehearsal plan.

### Risk 5: 4-beat demo reproducibility requires all upstream phases working
**Description:** The success criterion "runs end-to-end 3× before filming" is only achievable if Phases 8–12 are all working. Phase 13 cannot guarantee this.
**Mitigation:** Phase 13's demo-rehearsal plan must include a "fallback beat map" — which beats still work if specific upstream phases are missing. The runbook-v2.md rewrite must document the fallback chain (already partially spec'd in the existing runbook's "Fallback plan" section).

### Risk 6: Performance at 500 nodes with three overlay stores
**Description:** Phase 13 adds a third Zustand store (`useSubstrateStore`) alongside `useDriftStore` and (Phase 8's) rollup stores. The `buildFlowNodes` function will have 4 dependencies instead of 2.
**Mitigation:** Pre-test with the 500-node stress fixture after adding the substrate overlay. The existing `onlyRenderVisibleElements` provides a strong baseline. If `useMemo` recompute is too expensive, memoize the precedence resolution per UUID (not per render) using a stable `Map` comparison.

---

## Polish Opportunities (fits 4-beat arc, no scope creep)

These are welcome per `PROJECT.md` polish posture and are traceable to specific demo moments:

1. **Provenance arrow animation on Cmd+P result selection.** When a substrate node is selected in the Cmd+P palette, a brief CSS animation draws a "provenance line" from the palette result to the node's position in the canvas (or at least highlights the canvas node). Makes retrieval feel physical — mentioned as a "nice to have" in runbook-v2.md.

2. **Staggered node entry animation for HarvestPanel (Beat 4).** New substrate nodes animate into the canvas with a 100ms stagger as they appear in the harvest notification. This is the "substrate compounds" visual proof. Use CSS `opacity: 0 → 1` with `translateY(-8px → 0)` transition on each new node card.

3. **SF Pro monospace numerals in receipt banner.** The beat-2 receipt comparison banner uses `~N tokens · ~N tool calls · N/5 rules honored`. Use `font-variant-numeric: tabular-nums` in CSS to ensure columns align on replay. SF Pro supports this natively on macOS.

4. **Intent summary sidebar copy quality.** The 6-line Beat 3 intent summary (not a code diff) is the reviewer's primary surface. Each line should end with a citation token that is visually distinct (smaller, muted, rounded pill) from the action summary. Copy review of these 6 lines before filming.

5. **Keyboard-complete demo navigation.** Cmd+P → type → arrow-down → Enter as the complete flow for Beat 1. No mouse required for the PM beat. This reads as intentional and fast on camera. Validate that the `cmdk` keyboard navigation works in the Tauri `.app` bundle (not just dev server).

---

## Recommended Plan Breakdown

**Total: 5 plans across 2 waves.**

### Wave 1 — UI deliverables (depends on Phase 9 + Phase 11 outputs)

**13-01: Substrate State Infrastructure + Canvas Overlay**
- `useSubstrateStore` Zustand store (mirrors drift store pattern)
- `get_substrate_states_for_canvas` Rust IPC (reads `substrate_nodes` table)
- `resolveNodeState` precedence compositor in `GraphCanvasInner.tsx`
- CVA extension: `intent_drifted` + `superseded` variants
- 50fps perf validation on 500-node stress graph
- **Touches:** `store/substrate.ts` (new), `ipc/substrate.ts` (new), `graph/contractNodeStyles.ts`, `graph/GraphCanvasInner.tsx`, one Rust command

**13-02: Cmd+P Intent Palette**
- `IntentPalette.tsx` with Cmd+P binding (sibling to `CommandPalette.tsx`)
- Async debounced query against `find_by_intent` (contracts) + Phase 11's `find_constraints_for_goal` + `find_decisions_about`
- Result rendering: node type icon + name + summary + substrate-state badge
- >80% top-1 precision validation on 10 ambient queries against seeded fixture
- Copy Mode pill integration: Cmd+P in Copy Mode filters to L4 atoms only (Beat 1 NT flow)
- **Touches:** `components/command-palette/IntentPalette.tsx` (new), `ipc/substrate.ts`, `AppShell.tsx`

**13-03: Chat Archaeology + Substrate Node Detail**
- `SourceArchaeologyModal.tsx` — `shadcn Dialog` showing verbatim quote + actor + session_id:turn_ref
- `[source]` click handler on substrate node entries in inspector sidebar
- `get_substrate_node_detail` Rust IPC
- ≤5s click-to-readable validation
- **Touches:** `components/inspector/SourceArchaeologyModal.tsx` (new), `ipc/substrate.ts`, inspector sidebar (wherever substrate citations are rendered)

### Wave 2 — Demo orchestration (depends on Phase 12 output)

**13-04: PR-Review Intent-Drift Mode + Sync Affordance + HarvestPanel**
- `PRReviewPanel.tsx` — paste diff → `analyze_pr_diff` Rust IPC → `useSubstrateStore.bulkSet` with `intent_drifted` for affected nodes → canvas highlights + explanation sidebar
- `SyncButton.tsx` — mocked blast-radius animation against 3 pre-known UUIDs (50ms stagger)
- `HarvestPanel.tsx` — Beat 4 harvest-back notification (subscribes to `substrate:nodes-added` Tauri event)
- Verifier panel stream (Beat 3) — green checks + orange flag rendering
- **Touches:** `components/substrate/PRReviewPanel.tsx` (new), `SyncButton.tsx` (new), `HarvestPanel.tsx` (new), Rust PR diff analysis command

**13-05: Demo Reproducibility + Runbook Rewrite**
- `reset-demo.sh` final version — kill, git reset, copy SQLite seed, start dev server, launch app, verify
- `seeds/substrate.sqlite.seed` final version — 5 substrate rules + parent constraint + priority-shift record + ambient padding nodes
- `seeds/contracts/` final version — all sidecar `.md` files for the demo scenario
- 4-beat end-to-end rehearsal: run 3× in a row, log results, fix any failures
- `runbook-v2.md` rewrite — replaces structurally-outdated content with current 4-beat + two-laptop staging
- `live-scenario.md` replacement — Beat 4 workspace-delete is now the "live" moment; replaces the old single-prompt button-color placeholder
- **Touches:** `contract-ide/demo/reset-demo.sh` (new), seed files, `.planning/demo/runbook-v2.md` (rewrite), `.planning/demo/live-scenario.md` (replacement)

### Wave parallelism

Wave 1 plans (13-01, 13-02, 13-03) can execute in parallel after Phase 11 lands. Wave 2 plans (13-04, 13-05) depend on Phase 12 and Wave 1 being complete. 13-05 is the final gate before filming.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `cmdk` v0.x `CommandMenu` component | `cmdk` v1.1.1 `Command.Dialog` + `Command.Input` | v1 released 2024 | Different API surface; project already on v1.1.1 per Phase 3 Plan 03-03 decisions |
| React Flow v11 `nodeTypes` as inline object | `@xyflow/react` v12 `nodeTypes` as module-level constant | v12 released 2024 | Inline objects cause re-render storms; module-level const is load-bearing per existing code |
| Tailwind v3 `className` string concatenation | Tailwind v4 + `@tailwindcss/vite` + `cva` | v4 released 2025 | `@layer base` override needed for vibrancy; already handled in Phase 1 |

---

## Open Questions

1. **Phase 11 retrieval API shape for Cmd+P**
   - What we know: Phase 11 exposes `find_constraints_for_goal` + `find_decisions_about` as MCP tools; Phase 5 exposes `find_by_intent` for contracts via FTS5.
   - What's unclear: Does Phase 13 call these via a new Rust IPC that aggregates all three, or does it call the MCP sidecar directly from the frontend? The single-writer rule says Rust owns writes; reads can go either way. Calling the MCP sidecar directly from JS is architecturally messier but avoids a new Rust IPC.
   - Recommendation: Add a `find_substrate_by_intent(query, limit)` Rust command that queries SQLite directly (same FTS5 approach as the MCP tool) and returns unified results across all node types. This avoids a network hop to the MCP sidecar for a read-only query.

2. **Phase 12 PR-diff analysis IPC shape**
   - What we know: Phase 12 computes which nodes are `intent_drifted` based on a L0 priority shift. Applying this to a PR diff requires identifying which files/symbols are touched and mapping back to substrate nodes.
   - What's unclear: Does Phase 12 expose a `analyze_pr_diff(diff_text) → affected_uuids[]` IPC, or does Phase 13 need to implement the file-to-node mapping?
   - Recommendation: Phase 13 should implement a simple file-to-node mapper (diff hunk → file path → SQLite `nodes.code_ranges.file` lookup → UUID). This doesn't require Phase 12 — it's a simple join. The `intent_drifted` coloring then applies to any matched UUID whose substrate state is already `intent_drifted` from Phase 12's engine.

3. **HarvestPanel trigger mechanism**
   - What we know: Phase 10 emits a Tauri event when new sessions are ingested.
   - What's unclear: Does Phase 10 emit `substrate:nodes-added` with the newly-harvested node payloads, or does Phase 13 need to poll? Beat 4 requires this to feel live — polling with a 2s interval would be acceptable for the demo.
   - Recommendation: Phase 13 Plan 13-04 should implement both: subscribe to `substrate:nodes-added` if Phase 10 emits it, and fall back to polling `substrate_nodes WHERE created_at > ?` if not. The fallback produces the same UX.

4. **Runbook-v2.md and live-scenario.md replacement scope**
   - What we know: Both are marked as structurally outdated; Phase 13 is tasked with rewriting them.
   - What's unclear: Should the new runbook preserve the current markdown structure, or is a full rewrite to a different format warranted?
   - Recommendation: Full rewrite. The current runbook references a 3-beat recorded video structure that's been superseded by the 4-beat two-laptop live structure. The new runbook should mirror the `presentation-script.md` structure: Hook + Beat 1 + Beat 2 + Beat 3 + Beat 4 + Close, with implementation-status annotations per beat and pre-recording/rehearsal checklists updated to the committed scenario.

---

## Sources

### Primary (HIGH confidence)

- Existing codebase — `contract-ide/src/components/command-palette/CommandPalette.tsx` — cmdk v1.1.1 established pattern
- Existing codebase — `contract-ide/src/components/graph/contractNodeStyles.ts` — CVA extension pattern
- Existing codebase — `contract-ide/src/store/drift.ts` — Zustand immutable-Set pattern for Phase 13 substrate store
- Existing codebase — `contract-ide/src/components/graph/GraphCanvasInner.tsx` — `buildFlowNodes` + precedence pattern (Phase 7)
- Existing codebase — `contract-ide/src/lib.rs` — Rust IPC command registration pattern
- `.planning/demo/presentation-script.md` — locked 4-beat script (canonical for Phase 13 deliverables)
- `.planning/demo/scenario-criteria.md` § Committed Scenario — fixture content (5 substrate rules, orange-flag fixture, Beat 4 harvest-back)
- `.planning/ROADMAP.md` Phase 13 section — success criteria and planning notes
- `.planning/phases/08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation/08-RESEARCH.md` — Phase 8 IPC shapes and store patterns Phase 13 consumes

### Secondary (MEDIUM confidence)

- `.planning/research/constraint-distillation/README.md` — validated that `find_constraints_for_goal` retrieval via `applies_when` achieves 4/4 on synthetic goals; extrapolated to ≥80% at 50 nodes scale
- `.planning/research/intent-supersession/evaluation.md` — 9/10 intent-drift detection precision; basis for orange-flag demo reliability claim
- `.planning/CANVAS-PURPOSE.md` — canvas framing and verifier surface design; confirms Phase 13 role as UI consumer

### Tertiary (LOW confidence)

- Phase 10–12 output shapes — inferred from ROADMAP planning notes only; actual API surfaces are TBD until those phases are planned and executed. Phase 13 plans must include integration checkpoints to validate assumptions.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already installed and patterned
- Architecture: HIGH for Phase 1–7 integration surfaces; MEDIUM for Phase 8–12 integration (phases not yet built)
- Pitfalls: HIGH — all identified from existing codebase patterns and demo runbook precedents
- Demo orchestration: MEDIUM — reset procedure spec exists but has never been end-to-end tested

**Research date:** 2026-04-24
**Valid until:** Valid for planning; reassess Phase 11/12 integration points after those phases complete their RESEARCH.md and first PLAN.md

---

## RESEARCH COMPLETE

**Phase:** 13 — Substrate UI + Demo Polish
**Confidence:** MEDIUM-HIGH (HIGH on existing-surface integration; MEDIUM on upstream phase output shapes)

### Key Findings

- Phase 13 is a pure UI consumer — every hard capability (retrieval, intent-drift detection, supersession) is owned by Phases 10–12. Phase 13 wires the UI, manages the canvas overlay precedence, and closes the demo loop.
- The `useDriftStore` + CVA pattern from Phase 7 is the exact template for Phase 13's substrate-state overlay — same store shape, same `buildFlowNodes` extension, just more CVA variants.
- Cmd+P should be a new `IntentPalette.tsx` sibling to the existing `CommandPalette.tsx` — Cmd+K and Cmd+P are different bindings for different jobs (actions vs. navigation by intent).
- The Sync affordance is pure choreography against pre-loaded state — no multi-machine infrastructure needed. 3 pre-known UUIDs, 50ms stagger, CSS ring-flash.
- Demo reproducibility is the highest-risk deliverable — `reset-demo.sh` + the SQLite seed fixture must be built and tested before any filming attempt.
- The runbook rewrite and live-scenario replacement are load-bearing Phase 13 deliverables, not optional documentation.

### File Created
`/Users/yang/lahacks/.planning/phases/13-substrate-ui-demo-polish/13-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | All libraries installed; all patterns established in shipped code |
| Architecture | MEDIUM-HIGH | Phase 1–7 integration clear; Phase 8–12 shapes inferred from ROADMAP notes |
| Pitfalls | HIGH | All derived from existing codebase patterns and prior plan decisions |
| Demo Orchestration | MEDIUM | Reset procedure spec exists but untested end-to-end |
| Retrieval Precision | LOW | Depends on Phase 11 embedding quality at runtime; 4/4 on small experiment, unvalidated at scale |

### Open Questions

1. Phase 11 retrieval API shape — recommend `find_substrate_by_intent` Rust IPC aggregating all node types (avoids MCP sidecar hop for reads)
2. Phase 12 PR-diff analysis IPC shape — recommend Phase 13 implements file-to-node mapper independently; `intent_drifted` state comes from Phase 12's existing substrate_nodes records
3. HarvestPanel event vs. poll — implement both; subscribe to `substrate:nodes-added` with 2s-poll fallback

### Ready for Planning

Research complete. Planner can now create PLAN.md files starting with Wave 1 (13-01: substrate state + overlay, 13-02: Cmd+P palette, 13-03: chat archaeology) in parallel after Phase 11 completes, then Wave 2 (13-04: PR-review + Sync + Harvest, 13-05: demo reproducibility + runbook rewrite) after Phase 12.
