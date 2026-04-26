---
phase: 08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation
plan: 04b
type: execute
wave: 3
depends_on:
  - "08-04a"
files_modified:
  - contract-ide/src/lib/jsonl-parser.ts
  - contract-ide/src/lib/__tests__/jsonl-parser.test.ts
  - contract-ide/src/lib/agent-prompt.ts
  - contract-ide/src/store/agent.ts
  - contract-ide/src/store/receipts.ts
  - contract-ide/src/ipc/agent.ts
  - contract-ide/src/ipc/receipts.ts
  - contract-ide/src/components/layout/ChatPanel.tsx
  - contract-ide/src/components/layout/AppShell.tsx
  - contract-ide/src/components/inspector/ReceiptsTab.tsx
  - contract-ide/src/components/inspector/ReceiptCard.tsx
  - contract-ide/src/components/inspector/ReceiptHistoryTab.tsx
  - contract-ide/src/components/inspector/ReceiptComparison.tsx
  - contract-ide/src/components/inspector/DeltaBanner.tsx
autonomous: true
requirements:
  - AGENT-01
  - AGENT-04

must_haves:
  truths:
    - "User types an intent in the existing layout/ChatPanel.tsx; on Send, runAgent is called with `scopeUuid = useGraphStore(s => s.selectedNodeUuid)` (W4 — graph store does NOT expose `currentZoomedNodeUuid`; selectedNodeUuid IS the currently-zoomed node)"
    - "ChatPanel streams agent:stream events into a per-run buffer; agent:complete flips status; receipt:created appends to useReceiptsStore"
    - "ReceiptsTab keeps the existing `node` prop signature (W5 — Inspector calls `<ReceiptsTab node={selectedNode} />`); do NOT change to `nodeUuid`"
    - "Receipt cards persist per node and are retrievable via the inspector's receipt-history tab in reverse-chronological order"
    - "User pins two receipts side-by-side and the comparison view leads with a 28px+ DeltaBanner reserving THREE rows from day one (tokens, tool calls, rules honored — last row N/A until Phase 13) so Phase 13 layout cannot shift"
    - "DeltaBanner ships TWO view modes: absolute-stacked (Beat 2 demo, two rows of `Contract IDE: ~N tokens · ~N tool calls · N/5 rules honored`) AND percentage-delta (developer dogfood, single-row `−82% tokens · −83% tool calls`)"
    - "AppShell mounts agent + receipt subscriptions ONCE at boot (sibling to existing subscribeDriftChanged), not per tab — tab unmount must not tear down receipt-event subscription"
    - "TS jsonl-parser ships as an isolated module with Vitest unit tests (defense-in-depth alongside Rust parser)"
    - "ChatPanel REPLACES the Phase 1 placeholder (`Chat coming in Phase 8…`) in-place at contract-ide/src/components/layout/ChatPanel.tsx — keeps the existing PanelImperativeHandle props signature so AppShell's collapse/expand affordance keeps working"
  artifacts:
    - path: "contract-ide/src/lib/jsonl-parser.ts"
      provides: "Isolated TS-side defensive parser (mirrors Rust parser logic for in-browser fallback / streaming token preview)"
      exports: ["parseSessionJsonl", "extractTokenCounts"]
      min_lines: 50
    - path: "contract-ide/src/lib/agent-prompt.ts"
      provides: "Frontend prompt-shape preview helpers"
      exports: ["previewPrompt", "assembleScopeContext"]
    - path: "contract-ide/src/store/agent.ts"
      provides: "Zustand store for active agent run, streaming output buffer, status, tracking_id"
      exports: ["useAgentStore"]
    - path: "contract-ide/src/store/receipts.ts"
      provides: "Zustand store for per-node receipt history + pinned-comparison set (max two pins)"
      exports: ["useReceiptsStore"]
    - path: "contract-ide/src/ipc/agent.ts"
      provides: "runAgent invoke + subscribeAgentStream + subscribeAgentComplete event wrappers"
      exports: ["runAgent", "subscribeAgentStream", "subscribeAgentComplete"]
    - path: "contract-ide/src/ipc/receipts.ts"
      provides: "listReceiptsForNode + subscribeReceiptCreated wrappers"
      exports: ["listReceiptsForNode", "subscribeReceiptCreated"]
    - path: "contract-ide/src/components/layout/ChatPanel.tsx"
      provides: "Chat panel REPLACES the Phase 1 placeholder in-place at layout/ChatPanel.tsx — input box + streaming output pane + scope-context indicator. PanelImperativeHandle props signature preserved (B1 — keeps the existing layout panel-ref contract)"
      contains: "useAgentStore"
      min_lines: 80
    - path: "contract-ide/src/components/inspector/ReceiptsTab.tsx"
      provides: "Receipts tab — receipt-history list + pin-2-for-comparison entry + delegates to ReceiptComparison when 2 pinned. PROP SIGNATURE PRESERVED: `({ node }: { node: ContractNode | null })` (W5 — do NOT change to nodeUuid)"
      contains: "node"
      min_lines: 50
    - path: "contract-ide/src/components/inspector/ReceiptCard.tsx"
      provides: "Single receipt summary card — tokens, tool calls, est cost, nodes touched, parse_status badge"
      min_lines: 30
    - path: "contract-ide/src/components/inspector/ReceiptHistoryTab.tsx"
      provides: "Reverse-chrono list of all receipts for the selected node with pin checkboxes (max 2)"
      min_lines: 40
    - path: "contract-ide/src/components/inspector/ReceiptComparison.tsx"
      provides: "Side-by-side comparison view that LEADS with the 28px+ DeltaBanner before raw numbers"
      min_lines: 40
    - path: "contract-ide/src/components/inspector/DeltaBanner.tsx"
      provides: "28px+ banner component — absolute-stacked AND percentage-delta variants, three rows reserved (Phase 13 forward-compat)"
      exports: ["default"]
      min_lines: 30
  key_links:
    - from: "contract-ide/src/components/layout/ChatPanel.tsx"
      to: "useAgentStore + subscribeAgentStream + useGraphStore.selectedNodeUuid"
      via: "On Send, calls runAgent({ prompt, scopeUuid: useGraphStore.getState().selectedNodeUuid }) (W4 — selectedNodeUuid IS the zoomed node); appends each agent:stream line to the agent store's output buffer; on agent:complete, store flips status to 'complete' and triggers receipt fetch"
      pattern: "useAgentStore|selectedNodeUuid|runAgent"
    - from: "contract-ide/src/components/layout/AppShell.tsx"
      to: "subscribeAgentStream + subscribeAgentComplete + subscribeReceiptCreated"
      via: "Mount-time subscription block sibling to existing subscribeDriftChanged — single subscription at app boot, NOT per-tab"
      pattern: "subscribeAgentStream|subscribeReceiptCreated"
    - from: "contract-ide/src/components/inspector/ReceiptComparison.tsx"
      to: "DeltaBanner.tsx"
      via: "Renders DeltaBanner FIRST (top of comparison view) with 28px+ rows; raw-number table below as secondary detail"
      pattern: "<DeltaBanner"
---

<objective>
Land the frontend half of Beat 2 — the chat panel that dispatches `run_agent` (08-04a) on user intent, the receipt history tab + pin-2-for-comparison view, and the 28px+ DeltaBanner that leads the comparison layout. Build on top of the Rust runner shipped in 08-04a.

Per checker B1: the existing chat panel lives at `contract-ide/src/components/layout/ChatPanel.tsx` (NOT `contract-ide/src/components/chat/ChatPanel.tsx`). Inspector lives at `contract-ide/src/components/layout/Inspector.tsx`. AppShell lives at `contract-ide/src/components/layout/AppShell.tsx`. RECOMMENDATION: extend the existing `layout/ChatPanel.tsx` IN-PLACE — it already implements the collapse/expand handle that AppShell uses via `panelRef`. Replacing its body content is cheap; rebuilding the panel-ref contract is not.

Per checker W4: `useGraphStore` exposes `selectedNodeUuid` and `parentUuidStack` — there is NO `currentZoomedNodeUuid` field. AGENT-01's "currently-zoomed node" maps to `selectedNodeUuid` (set on graph node click + Cmd+K jump-to-node). Document the choice in the plan.

Per checker W5: `ReceiptsTab.tsx` already exists as a Phase 8 placeholder with prop signature `function ReceiptsTab({ node }: { node: ContractNode | null })`, called from `Inspector.tsx` as `<ReceiptsTab node={selectedNode} />`. Keep the `node` prop signature; do NOT change to `nodeUuid`.

Per checker B1 finding on chat-panel location: do NOT create a new `src/components/chat/` directory. Extend `src/components/layout/ChatPanel.tsx` in place — the file already has a stub `Chat coming in Phase 8…` placeholder; replacing the body content is the smallest change.

Output: TS-side jsonl-parser module with Vitest tests + agent + receipts stores + IPC wrappers + ChatPanel content (in layout/) + receipt-history tab + pinned-comparison view + DeltaBanner reserving three rows. Wave 2 — depends on 08-04a for the Rust IPC + event wire.
</objective>

<execution_context>
@/Users/yang/.claude/get-shit-done/workflows/execute-plan.md
@/Users/yang/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/ROADMAP.md
@.planning/phases/08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation/08-CONTEXT.md
@.planning/phases/08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation/08-RESEARCH.md
@.planning/phases/08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation/08-04a-SUMMARY.md
@.planning/demo/presentation-script.md

# Existing surfaces this plan extends/replaces
@contract-ide/src/components/layout/AppShell.tsx
@contract-ide/src/components/layout/ChatPanel.tsx
@contract-ide/src/components/layout/Inspector.tsx
@contract-ide/src/components/inspector/ReceiptsTab.tsx
@contract-ide/src/store/graph.ts
@contract-ide/src/store/inspector.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: TS-side jsonl-parser module + Vitest tests + agent/receipts stores + IPC wrappers</name>
  <files>contract-ide/src/lib/jsonl-parser.ts, contract-ide/src/lib/__tests__/jsonl-parser.test.ts, contract-ide/src/lib/agent-prompt.ts, contract-ide/src/store/agent.ts, contract-ide/src/store/receipts.ts, contract-ide/src/ipc/agent.ts, contract-ide/src/ipc/receipts.ts</files>
  <action>
    1. **Frontend isolated jsonl-parser module + tests** (`src/lib/jsonl-parser.ts` + `src/lib/__tests__/jsonl-parser.test.ts`):
       Even though Rust does the canonical parse (08-04a), ship a thin TS-side parser that:
       - `parseSessionJsonl(text: string): { input_tokens, output_tokens, tool_calls, parse_status }` — used as a SECOND-LINE fallback if the Rust path emits a `parse_status: FallbackMock` receipt; the frontend can attempt to re-parse the raw_jsonl_path content client-side as a courtesy.
       - `extractTokenCounts(line: object): { input?, output?, tool_calls? }` — defensive single-line extractor used by streaming consumers if they want to show live partial counts (not required for the demo, but the parser is small and isolated tests give 08-04 a deliverable for the requirement that the parser ship as an isolated module).
       Use Vitest (verify if already in package.json from prior phases; if absent, install `vitest` as a dev dep). Tests:
       - `parses_real_session_jsonl_inline` — synthetic small JSONL string, assert non-zero input_tokens.
       - `tolerates_malformed_lines` — input has one truncated line; parser skips it, returns counts from rest.
       - `tolerates_unknown_top_level_types` — input has `{"type":"unknown_event"}` lines; parser skips them.
       Run `npx vitest run src/lib/__tests__/jsonl-parser.test.ts` — must pass.

       Both Rust (08-04a) AND TS sides ship isolated modules; defense in depth.

    2. **Frontend prompt-shape preview** (`src/lib/agent-prompt.ts`):
       - `previewPrompt(userIntent: string, scopeNodeUuid: string | null): Promise<string>` — client-side approximation that reads scope node + neighbors via existing `get_nodes`/`get_edges` IPC and assembles a string structurally identical to the Rust assembler. Used by the chat panel to show "this is what will be sent" tooltip on hover. Optional but small.
       - `assembleScopeContext(scopeNodeUuid)` — returns `{ neighbors: ContractNode[], journalEntries: JournalEntry[] }` for the chat panel's scope-context indicator UI (e.g., a chip showing `Scope: Account Settings (3 neighbors)`).

    3. **Stores**:
       - `src/store/agent.ts`:
         ```ts
         interface AgentRun {
           trackingId: string;
           scopeUuid: string | null;
           status: 'idle' | 'running' | 'complete' | 'error';
           streamBuffer: string[];
           startedAt: string;
         }
         interface AgentStore {
           current: AgentRun | null;
           start: (trackingId, scopeUuid) => void;
           appendStream: (line: string) => void;
           complete: (code: number) => void;
           reset: () => void;
         }
         ```
       - `src/store/receipts.ts`:
         ```ts
         interface ReceiptsStore {
           byNode: Map<string, Receipt[]>;
           pinned: [string?, string?];           // up to two receipt IDs pinned for comparison
           hydrate: (nodeUuid, receipts) => void;
           addReceipt: (receipt) => void;        // inserted at front for receipt:created event
           togglePin: (receiptId) => void;       // FIFO eviction at 3rd pin
           clearPins: () => void;
         }
         ```

    4. **IPC wrappers**:
       - `src/ipc/agent.ts`: `runAgent(prompt, scopeUuid)`, `subscribeAgentStream(handler)`, `subscribeAgentComplete(handler)`. Each `subscribe*` returns the `UnlistenFn` from `@tauri-apps/api/event`.
       - `src/ipc/receipts.ts`: `listReceiptsForNode(nodeUuid)`, `subscribeReceiptCreated(handler)`. Same shape pattern. The TS `Receipt` type uses snake_case field names matching 08-04a's Rust struct (`tool_call_count`, `estimated_cost_usd`, `wall_time_ms`, etc.) — Tauri's default serde camelCase conversion is OFF for this project per Phase 4 lineage; verify against an existing IPC type and match it.

    5. Verify `npm run tsc` clean; `npx vitest run` (jsonl-parser tests) clean.
  </action>
  <verify>
    From `contract-ide/`:
    - `npm run tsc` clean.
    - `npx vitest run src/lib/__tests__/jsonl-parser.test.ts` passes.
    - All new files compile and pass type-check.
  </verify>
  <done>
    Vitest jsonl-parser tests pass; agent + receipts Zustand stores exist with correct API; IPC wrappers exist for runAgent / subscribeAgentStream / subscribeAgentComplete / listReceiptsForNode / subscribeReceiptCreated; tsc clean.
  </done>
</task>

<task type="auto">
  <name>Task 2: ChatPanel (in-place at layout/ChatPanel.tsx) + AppShell subscription block + ReceiptsTab + ReceiptCard + ReceiptHistoryTab + ReceiptComparison + DeltaBanner</name>
  <files>contract-ide/src/components/layout/ChatPanel.tsx, contract-ide/src/components/layout/AppShell.tsx, contract-ide/src/components/inspector/ReceiptsTab.tsx, contract-ide/src/components/inspector/ReceiptCard.tsx, contract-ide/src/components/inspector/ReceiptHistoryTab.tsx, contract-ide/src/components/inspector/ReceiptComparison.tsx, contract-ide/src/components/inspector/DeltaBanner.tsx</files>
  <action>
    1. **Edit `contract-ide/src/components/layout/ChatPanel.tsx`** (B1 — extend in place; keep the existing `ChatPanelProps { panelRef }` signature so AppShell's collapse/expand affordance keeps working):
       - Keep the existing `collapsed` toggle behavior + `Chat` header strip.
       - REPLACE the placeholder body (`Chat coming in Phase 8 — this panel focuses on Cmd+K palette actions...`) with:
         - **Scope-context chip at top**: derives from `useGraphStore(s => s.selectedNodeUuid)` (W4 — selectedNodeUuid IS the currently-zoomed node; `useGraphStore` does NOT have a `currentZoomedNodeUuid` field). Document this choice in the file's leading JSDoc: "selectedNodeUuid maps to AGENT-01's 'currently-zoomed node' — graph store exposes selectedNodeUuid set by graph node click and Cmd+K jump-to-node; no separate zoomed-node tracking exists." Look up the node by uuid via `useGraphStore(s => s.nodes.find(n => n.uuid === selectedNodeUuid))` to render its name + neighbor count via `assembleScopeContext`.
         - **Streaming output pane**: subscribes to `useAgentStore(s => s.current?.streamBuffer)`. Each line: try `JSON.parse(line)` (stream-json mode) and extract human-readable text via `extractTokenCounts` → render the text. If parse fails, show raw.
         - **Input textarea + Send button** at the bottom. On Send: read `selectedNodeUuid` from `useGraphStore.getState()`, call `runAgent(prompt, selectedNodeUuid)` → store the returned tracking_id via `useAgentStore.getState().start(trackingId, selectedNodeUuid)`. Disable Send while `current?.status === 'running'`.
         - **Status indicator**: idle / streaming / complete / error.
         - **On `agent:complete`**: show a "View receipt" link that calls `useGraphStore.getState().selectNode(scopeUuid)` (already-selected, but resets focus) and switches Inspector to Receipts tab — for v1 just toast `"Receipt ready — see Receipts tab"`.

       Do NOT burn polish budget here per CONTEXT.md decision (Beat 1 dispatches via the Phase 11 Delegate button, not this chat panel — but the panel must work for developer dogfood). UX is Claude's discretion per CONTEXT.md but functional bar is fine.

    2. **`contract-ide/src/components/layout/AppShell.tsx`** (B1 — actual path; existing AppShell is at `layout/`, NOT `components/`): add a sibling subscription block alongside Phase 7's `subscribeDriftChanged` (already wired):
       ```tsx
       useEffect(() => {
         let unlistenStream: UnlistenFn | undefined;
         let unlistenComplete: UnlistenFn | undefined;
         let unlistenReceipt: UnlistenFn | undefined;
         (async () => {
           unlistenStream = await subscribeAgentStream(p => useAgentStore.getState().appendStream(p.line));
           unlistenComplete = await subscribeAgentComplete(p => useAgentStore.getState().complete(p.code));
           unlistenReceipt = await subscribeReceiptCreated(r => useReceiptsStore.getState().addReceipt(r));
         })();
         return () => {
           unlistenStream?.();
           unlistenComplete?.();
           unlistenReceipt?.();
         };
       }, []);
       ```
       This subscription block is mounted ONCE at app boot (NOT per tab — receipt event subscription must survive tab unmount). Sibling to the existing drift subscription block.

    3. **`contract-ide/src/components/inspector/ReceiptsTab.tsx`** (W5 — REPLACE the existing placeholder body but PRESERVE the `node` prop signature):
       - The current file exports `function ReceiptsTab({ node }: { node: ContractNode | null })`. KEEP THAT SIGNATURE. Inspector calls `<ReceiptsTab node={selectedNode} />` (verified at `layout/Inspector.tsx`). Do NOT change to `nodeUuid`.
       - Mounts: `useEffect(() => { if (node?.uuid) listReceiptsForNode(node.uuid).then(rows => useReceiptsStore.getState().hydrate(node.uuid, rows)); }, [node?.uuid])`.
       - Renders `<ReceiptHistoryTab node={node} />` when 0 or 1 pinned; `<ReceiptComparison ... />` when exactly 2 pinned. (NOTE: the receipt-event subscription is mounted at AppShell, NOT here — Task 2 step 2.)

    4. **`src/components/inspector/ReceiptCard.tsx`**:
       - Props: `{ receipt: Receipt }`.
       - Shows: ts (relative + absolute on hover), input_tokens, output_tokens, tool_call_count, estimated_cost_usd ($X.XX), wall_time_ms (humanized as Ns), nodes_touched count, parse_status badge (`mock` if FallbackMock — small/muted, NEVER hidden).
       - "Pin to compare" button → `useReceiptsStore.getState().togglePin(receipt.id)`. If 2 already pinned, FIFO-evict the older one.

    5. **`src/components/inspector/ReceiptHistoryTab.tsx`**:
       - Reverse-chrono list of `<ReceiptCard>` for the current node.
       - Read from `useReceiptsStore(s => s.byNode.get(node.uuid) ?? [])`.

    6. **`src/components/inspector/ReceiptComparison.tsx`** — the demo-load-bearing comparison view per RESEARCH.md SC 4:
       - Layout from top to bottom:
         1. **`<DeltaBanner>` FIRST** (full width, ≥28px text, three rows reserved — see DeltaBanner below).
         2. Below: side-by-side raw-number table (small text, secondary detail).
         3. Below: per-receipt metadata (ts, model, raw_jsonl_path link).
       - View toggle: `[Absolute stacked] [Percentage delta]` button row defaulting to `Percentage delta` for the developer-dogfood UI inside the IDE (Beat 2's `−82% tokens` framing is the in-IDE comparison view per CONTEXT.md). Beat 2's on-stage banner is a screenshot/recorded frame — it lives inside the recorded video and is NOT this in-IDE view, but the same DeltaBanner component renders both via the `view` prop.

    7. **`src/components/inspector/DeltaBanner.tsx`** — per RESEARCH.md Code Example 3 + Pitfall 9:
       ```tsx
       interface DeltaBannerProps {
         contractIde: { tokens: number; toolCalls: number; rulesHonored: string };
         bareClaude: { tokens: number; toolCalls: number; rulesHonored: string };
         view: 'absolute-stacked' | 'percentage-delta';
       }
       ```
       - **Reserve THREE rows ALWAYS** (Pitfall 9: `tokens`, `tool calls`, `rules honored`). For Phase 8, `rulesHonored` arrives as `"N/A"` placeholder — Phase 13 wires the real value. The third row renders `· N/A rules honored` with a slightly muted style; locked decision in CONTEXT.md is that the row reserves 28px+ height even when N/A so Phase 13 doesn't trigger layout shift.
       - `view: 'absolute-stacked'` (Beat 2 demo): two rows stacked vertically:
         ```
         Contract IDE: ~1,400 tokens · ~3 tool calls · 5/5 rules honored
         Bare Claude:  ~7,200 tokens · ~22 tool calls · 0/5 rules honored
         ```
         Monospace, 28px+, separator `·`, approximate-tilde prefix on numerals, exact phrasing per `presentation-script.md` § Beat 2.
       - `view: 'percentage-delta'`: single row `−{pct}% tokens · −{pct}% tool calls · {rulesHonored} rules honored`. Same 28px+ monospace.
       - Snapshot test (Vitest + a small renderer like @testing-library/react if not already in deps, or just a string-shape check): assert the rendered HTML contains the literal Beat 2 line shape for absolute-stacked view with sample props (1_400, 3, "5/5") + (7_200, 22, "0/5"). Risk Register row "Beat 2 banner format mismatch" mitigation.

    8. Verify `npm run tsc` clean; `npm run lint` clean; `npx vitest run` clean (parser + DeltaBanner snapshot tests); `npm run tauri dev` launches; chat panel send produces streaming output then a receipt card.
  </action>
  <verify>
    From `contract-ide/`:
    - `npm run tsc` clean.
    - `npx vitest run` passes all tests (jsonl-parser + DeltaBanner snapshot).
    - `npm run tauri dev` launches; chat panel renders at the bottom of the shell (it WAS the placeholder; now it has the input + streaming pane).
    - Open a seeded repo, click a node (sets selectedNodeUuid), type "list 3 colors that match this node's contract" → click Send → streaming output appears in real time → a receipt card appears in the Receipts tab within ~15s with non-zero token counts.
    - Pin two receipts → ReceiptComparison renders with DeltaBanner LEADING the layout; toggle absolute-stacked vs percentage-delta and verify both render the literal text shape per spec.
    - Switch inspector to Code tab and back to Receipts — receipt list still populated (subscription survived; addReceipt didn't double-fire).
    - Open a different node → its own receipt history renders (or empty state if none yet); pinned receipts from the previous node clear.
    - Verify `useGraphStore` does NOT have a `currentZoomedNodeUuid` field (just `selectedNodeUuid` and `parentUuidStack`) — done by reading `src/store/graph.ts` and confirming the chat panel's scope chip uses `selectedNodeUuid`.
  </verify>
  <done>
    layout/ChatPanel.tsx replaces the Phase 1 placeholder in-place (preserving panelRef contract); AppShell mounts agent + receipt subscriptions ONCE at boot (sibling to drift subscription); ReceiptsTab keeps `node` prop signature (W5); ReceiptHistoryTab + ReceiptComparison + ReceiptCard + DeltaBanner all wired end-to-end; DeltaBanner reserves 3 rows even when rulesHonored=N/A (snapshot test passes); pin-2-FIFO logic works; tsc + vitest + lint clean; manual UAT confirms a full intent → streaming → receipt → comparison flow.
  </done>
</task>

</tasks>

<verification>
- TS-side jsonl-parser module ships as an isolated module with three Vitest tests (defense-in-depth alongside Rust parser).
- Chat panel REPLACES the existing layout/ChatPanel.tsx placeholder body in place; PanelImperativeHandle props signature preserved; AppShell collapse/expand keeps working.
- Chat panel uses `useGraphStore(s => s.selectedNodeUuid)` for AGENT-01's "currently-zoomed node" (W4); no `currentZoomedNodeUuid` field needed.
- ReceiptsTab keeps `({ node }: { node: ContractNode | null })` prop signature (W5); Inspector continues calling `<ReceiptsTab node={selectedNode} />` unchanged.
- DeltaBanner reserves THREE rows from day one (Pitfall 9 closed); absolute-stacked + percentage-delta variants both ship.
- ReceiptComparison leads layout with DeltaBanner before raw numbers (SC 4 invariant).
- AppShell mounts agent + receipt subscriptions ONCE at boot (not per tab) sibling to existing subscribeDriftChanged.
- File paths are correct: layout/ChatPanel.tsx, layout/AppShell.tsx, layout/Inspector.tsx, inspector/ReceiptsTab.tsx (B1).
- tsc + vitest + lint clean.
- Manual UAT: type intent → streaming output → receipt card → pin two → comparison view with banner.
</verification>

<success_criteria>
- SC 1 of Phase 8: User types intent in chat panel; `claude` CLI runs scoped to currently-zoomed node + neighbors (NOT whole-repo grep); streaming output appears in chat panel in real time.
- SC 2 of Phase 8: After agent run, receipt card shows non-zero token counts, tool-call count, est cost, nodes touched — parsed defensively with mock fallback. Isolated parser module with unit tests (TS side this plan, Rust side 08-04a).
- SC 4 of Phase 8: Receipt cards persist per node; user pins two side-by-side; comparison leads with full-width 28px+ DeltaBanner; THREE rows reserved (Phase 13 forward-compat).
- AGENT-04: pin-2 comparison + DeltaBanner with both view modes.
- W4 closed: scope binding uses selectedNodeUuid (the actual graph-store field).
- W5 closed: ReceiptsTab keeps existing `node` prop signature.
- B1 closed: ChatPanel extended in-place at layout/ChatPanel.tsx; AppShell at layout/AppShell.tsx; Inspector at layout/Inspector.tsx.
</success_criteria>

<output>
After completion, create `.planning/phases/08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation/08-04b-SUMMARY.md` documenting:
- Snapshot test result: DeltaBanner absolute-stacked render matches literal Beat 2 line shape from `presentation-script.md`
- Latency observed: agent prompt sent → first streaming line in chat panel (target ≤ 1s); agent terminated → receipt card visible (target ≤ 2s)
- Confirmation that ChatPanel kept the existing `panelRef: RefObject<PanelImperativeHandle | null>` prop and didn't break AppShell's collapse/expand
- Confirmation that `useGraphStore.selectedNodeUuid` was the field used (W4)
- Confirmation that `<ReceiptsTab node={selectedNode} />` call site at layout/Inspector.tsx works without modification (W5)
- Whether the Rust `Receipt` struct's snake_case field names round-trip cleanly through Tauri's serde to the TS `Receipt` interface (or whether an alias mapping was needed)
</output>
