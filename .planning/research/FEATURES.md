# Feature Research

**Domain:** Agent-native macOS IDE with semantic contract graph as primary navigation surface
**Researched:** 2026-04-24
**Confidence:** HIGH (table stakes from competitor analysis), MEDIUM (differentiators — novel category with few direct comparisons), LOW (non-coder path — limited direct evidence for this specific hybrid UX)

---

## Feature Landscape

### Table Stakes (Users Expect These)

These come from Cursor, VS Code, Zed, and Raycast. Missing any of these and the product feels broken to a power user even if the contract graph is brilliant.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Command palette (Cmd+K / Cmd+P) | Every modern tool has this; power users navigate entirely by keyboard. Cursor, VS Code, Raycast all center around it. | LOW | Raycast-style: fuzzy-match, recent items ranked higher, one hotkey away from anywhere |
| Global keyboard navigation | Users arriving from Cursor/Zed will refuse a mouse-only workflow. Tab/arrow/enter through graph nodes, inspector, chat. | MEDIUM | Must cover: node focus, inspector tabs, chat input, diff accept/reject |
| Settings panel | Theme, font, keybindings, agent path config (where is `claude` CLI). Missing = product looks unfinished. | LOW | JSON-backed settings + UI overlay; not complex but must exist day one |
| Autosave + crash recovery | VS Code trained every developer to expect silent autosave. Any data loss is trust-destroying. | LOW | Tauri file-write on every contract mutation; SQLite cache is easily rebuilt |
| Undo / Redo for contract edits | Standard editor expectation; editing a contract and hitting Cmd+Z must work. | MEDIUM | Per-node undo stack in contract state; heavier across mass edits |
| Error states with actionable messages | When `claude` CLI is missing, when graph fails to load, when SQLite rebuild fails — user needs to know what went wrong and how to fix it. | LOW | Toast + inline error banners; no empty spinners |
| Theming (dark/light, macOS system preference) | Expected in any macOS-native tool in 2026. Zed, Cursor both respect system theme. | LOW | Tailwind dark mode + CSS vars; follows macOS appearance switch |
| Syntax highlighting in contract + code view | Monaco provides this for free. Not having it in the code pane reads as unfinished. | LOW | Monaco handles; just configure language detection |
| Search / filter within the graph | Cursor has codebase search; Sourcegraph has deep search. Users will type a component name and expect to find it. | MEDIUM | Filter graph nodes by name/label; highlight matches; requires SQLite FTS on node labels |
| Inline diff view with accept / reject | Cursor and Copilot Workspace both have this. Approval of agent-produced code diffs is table stakes for any agent IDE. | MEDIUM | Monaco diff editor already supports accept/reject; must wire to agent output |
| Loading / progress indicators | Any async operation (agent run, graph rebuild, preview load) needs a visible progress signal. | LOW | Spinner + estimated step indicators; without this users think it's frozen |
| Empty state onboarding | First launch with no project open must tell the user what to do. | LOW | "Open a repo" prompt with clear CTA |
| Link to open file in system editor / Finder | Users will occasionally need the escape hatch to Finder/terminal. Not a file tree — just a "reveal in Finder" on a node or code pane. | LOW | `tauri::api::shell::open()` or `open` command |

---

### Differentiators (Competitive Moat)

These are the features no competitor has in combination. Each one is only meaningful because the others exist — they are not standalone features, they are a system.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Five-level zoomable contract graph | Primary navigation surface. User navigates by intent ("checkout confirm button") not by file path. Replaces file tree entirely. Zero competitor does this for code. | HIGH | react-flow; custom node types per level (Product, Flow, Surface, Component, Atom); zoom-to-level logic; minimap |
| Canonical + reference (ghost node) model | Shared components (Button, Spinner) live once; referenced as ghosts across flows. Prevents graph duplication. Matches how design systems work in Figma. | HIGH | Node data model: `canonical: bool`, `canonical_id: uuid`; ghost nodes render with dashed border + link-to-home action |
| Inspector panel (contract + code + preview + receipts) | Single unified view of a node's full context: what it's supposed to do, what the code actually does, what it looks like, and what the agent did last time. No competitor combines all four. | HIGH | Four tabs or split pane; tabs: Contract (markdown), Code (Monaco read-only), Preview (iframe), Receipts (list) |
| Contract-grounded chat panel | Chat context is pinned to the currently-zoomed graph subgraph — not whole-repo grep. Agent gets `get_contract` and `find_by_intent` tools, not raw file search. Signal-to-noise improvement over Cursor/Cody. | HIGH | Chat panel bound to `selected_scope` (current zoom level); passes contract IDs as context; streams claude CLI output |
| Cherrypick flow | Locate by intent → inspect → edit contract → agent compiles → atomic side-by-side approve (contract diff + code diff together). The primary editing gesture. | HIGH | Ties together: graph selection, inspector, contract editor, agent runner, diff viewer. **Demo beat 1: button color change.** |
| Drift detection with visual signal | Nodes where code has diverged from contract pulse red. PostToolUse hook re-derives contracts after every agent edit. User sees divergence immediately, not in a separate audit tool. | HIGH | Rust backend compares contract hash vs. derived hash; `drifted: bool` on node; react-flow node style responds to drift flag; **requires PostToolUse hook** |
| Drift reconcile flow | On a drifted node, user can either update the contract to match code, or re-run the agent to update code to match contract. Both paths end on the same atomic approve. | MEDIUM | Two buttons in inspector drift banner: "Accept code" (update contract) vs "Fix code" (re-derive + agent run) |
| Mass semantic edit | One intent phrase ("add loading state to all async actions") selects N matching nodes, produces N code diffs, approve-all in one atomic step. | HIGH | Requires: graph multi-select, intent → node matching (SQLite FTS + embedding similarity), parallel agent runs, batch diff review UI. **Demo beat 2: mass-add loading states.** |
| Receipt cards per agent run | Token count, wall time, tool calls, nodes touched, prompt size — surfaced as a card in the inspector's receipt tab. Makes cost visible. | MEDIUM | Parse claude CLI session JSONL; extract usage fields; store as receipt record in SQLite; render as card component |
| Receipt side-by-side pinning | Pin a Contract IDE receipt next to a terminal-agent-baseline receipt. Shows the moat: fewer tokens, fewer tool calls, more targeted changes. | MEDIUM | Receipt pin/compare mode in inspector; `baseline_receipt` stored separately; delta calculation (token savings %). **All three demo beats end here.** |
| Lens switcher | Journey lens (default, working): nodes grouped by user flow. System lens (mocked): nodes grouped by technical layer. Ownership lens (mocked): nodes grouped by team. | HIGH | Journey fully wired to data model. System + Ownership render as empty/placeholder state with "coming soon" — still demonstrates the model's extensibility. |
| MCP server (`find_by_intent`, `get_contract`, `list_drifted_nodes`, `update_contract`) | Claude Code sessions launched outside the IDE can still query the contract graph. Makes contracts a first-class context source for any agent session. | MEDIUM | TypeScript MCP server; reads from same SQLite cache; exposes 4 tools with typed schemas |
| Non-coder copy-edit mode | A PM or writer selects a text-bearing node, edits the contract copy field in plain English, and the agent produces a targeted code change to only that text — no code knowledge required. | MEDIUM | Inspector contract editor in "copy mode": hides technical fields, shows only `display_name`, `description`, `copy` fields; simplified prompt template for copy-only edits. **Demo beat 3: non-coder copy edit.** |
| Live localhost preview pane | Renders the running app at the selected node's route inside the inspector. Lets the user see the before/after of an agent change without context-switching to a browser. | MEDIUM | `<webview>` or iframe pointed at `localhost:PORT`; auto-refreshes on agent-confirmed file write; URL derived from node's `route` contract field |
| PostToolUse hook for live drift | After every `claude` tool use that touches a file, re-derive affected contracts and flag any new drift. Keeps the graph live without polling. | MEDIUM | Claude Code hook config; shell script calls Rust backend `rederive` endpoint; SQLite update triggers graph re-render via Tauri event |
| Demo repo (`vercel/commerce`) with seeded contracts | Pre-seeded L0–L2 contract graph gives a credible realistic demo without requiring users to seed their own repo. Reproducible beats. | MEDIUM | Hand-curated `.contracts/` files; vercel/commerce submodule or copy; startup loads + validates seed integrity |

---

### Anti-Features (Deliberately Not Built)

These are all tempting. They are explicitly out of scope. Justifications matter because they will come up in reviews and decisions.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| File tree in primary UI | Replicates the IDE mental model we're replacing. Every file tree added pulls attention away from the graph and teaches users to navigate by path instead of intent. | Let macOS Finder and the OS-level escape hatch handle file browsing; provide "reveal in Finder" on any node |
| Cloud sync / hosted backend | Single-user local-first is the constraint. Adding sync infrastructure balloons scope by weeks and introduces auth, conflict resolution, and data residency concerns. | Git is the sync layer. Contracts are `.md` sidecars in the repo. Push to GitHub = synced. |
| Multi-user collaboration / multiplayer graph | CRDT graph state (what Zed built) is months of infrastructure. The use case (PM + dev simultaneously editing contracts) is real but post-MVP. | Single-user + async: PM edits contract file in any editor, agent or dev reviews on next open |
| Multi-provider agent abstraction (OpenAI, Gemini, etc.) | Abstractions for multiple providers create adapter layer complexity, testing surface, and prompt differences across providers. The moat is the contract graph, not model routing. | Hard-wire to `claude` CLI. When other CLIs support session JSONL with the same schema, revisit. |
| Code generation from scratch (new project scaffolding) | Contract IDE operates on existing repos. Scaffolding requires a project template system, dependency selection, git init flow — a different product (Bolt/v0 already do this). | Open an existing repo; require git history. |
| Authoritative contracts (code generated from contracts as source of truth) | v1 ships derived contracts. Authoritative mode requires a bidirectional sync engine with merge conflict resolution. Big enough to be a v2 product definition. | Derived + version-controlled. Contracts describe intent; code remains authoritative for execution. |
| Skills-based Claude Code integration | Skills add a custom configuration surface (skill YAML, hook bindings, tool permissions) beyond the single PostToolUse hook. Scope risk too high for hackathon. | MCP server + 1 PostToolUse hook. Covers the demo use case completely. |
| Non-macOS platform (v1) | Cross-platform brings window chrome differences, font rendering differences, Tauri API differences, and CI complexity. Not worth it until the product is validated. | Tauri makes v2 cross-platform cheap. Ship macOS. |
| In-app terminal / shell emulator | Terminal emulators are complex to embed correctly (PTY handling, ANSI codes, resize, copy-paste). Users already have iTerm / Terminal. | Shell out to `claude` CLI and parse its JSONL output. No in-app terminal. |
| Persistent agent memory / conversation history across sessions | Session history storage, retrieval, relevance ranking, context window budget management — all complex. The contract graph is the persistent memory layer already. | Contracts ARE the memory. Each session starts with fresh context grounded in contracts. |
| Real-time code linting / language server | LSP integration per language is a large surface. Contract IDE is not a code editor in the full sense — Monaco is read-only in the inspector. | Monaco read-only view for code pane; no LSP. Agents handle linting through their own tool calls. |
| Plugin / extension system | Extension APIs require stable internal interfaces, versioning, sandboxing. That's Cursor/VS Code territory. | Hard-wired feature set for v1. |

---

## Feature Dependencies

```
[Contract Graph (react-flow nodes + zoom)]
    └──requires──> [SQLite cache (node/edge data)]
                       └──requires──> [.contracts/ MD sidecar parser]
                                          └──requires──> [Stable UUID frontmatter schema]

[Inspector panel (contract + code + preview + receipts)]
    └──requires──> [Contract Graph] (node selection)
    └──requires──> [SQLite cache] (contract + receipt lookup)
    └──requires──> [Agent runner (claude CLI shell-out)]
    └──requires──> [Session JSONL parser] (receipt production)

[Cherrypick flow]  ← DEMO BEAT 1
    └──requires──> [Contract Graph] (node selection by intent)
    └──requires──> [Inspector panel] (contract edit surface)
    └──requires──> [Agent runner]
    └──requires──> [Inline diff viewer (Monaco diff editor)]

[Drift detection]
    └──requires──> [PostToolUse hook]
    └──requires──> [SQLite cache] (contract hash storage)
    └──requires──> [Contract re-derivation (Rust backend)]
    └──enhances──> [Contract Graph] (red-pulse visual on drifted nodes)

[Drift reconcile flow]
    └──requires──> [Drift detection]
    └──requires──> [Inspector panel] (reconcile banner UI)
    └──requires──> [Agent runner] (for "fix code" path)

[Mass semantic edit]  ← DEMO BEAT 2
    └──requires──> [Contract Graph] (multi-select)
    └──requires──> [MCP server] (find_by_intent for node matching)
    └──requires──> [Agent runner] (parallel runs)
    └──requires──> [Inline diff viewer] (batch approve UI)

[Receipt cards]
    └──requires──> [Session JSONL parser]
    └──requires──> [SQLite cache] (receipt storage)
    └──requires──> [Inspector panel] (receipts tab)

[Receipt side-by-side pinning]  ← ALL DEMO BEATS END HERE
    └──requires──> [Receipt cards]
    └──requires──> [Inspector panel] (pin/compare mode)

[Non-coder copy-edit mode]  ← DEMO BEAT 3
    └──requires──> [Inspector panel] (simplified contract editor view)
    └──requires──> [Agent runner] (copy-only prompt template)
    └──requires──> [Inline diff viewer] (approve step)

[Lens switcher]
    └──requires──> [Contract Graph] (re-layout on lens change)
    └──requires──> [SQLite cache] (lens-specific grouping queries)
    Journey lens ──full──> working
    System lens ──mocked──> placeholder UI

[MCP server]
    └──requires──> [SQLite cache] (read-only query layer)
    └──requires──> [.contracts/ MD sidecar parser] (for update_contract tool)

[Live preview pane]
    └──requires──> [Inspector panel] (preview tab)
    └──enhances──> [Cherrypick flow] (see result in-situ after agent run)

[PostToolUse hook]
    └──requires──> [Rust backend rederive endpoint]
    └──requires──> [SQLite cache]
    └──feeds──> [Drift detection]

[Command palette]
    └──enhances──> [Contract Graph] (jump to node by name)
    └──enhances──> [Cherrypick flow] (trigger by keyboard)

[Search / filter within graph]
    └──requires──> [SQLite cache] (FTS on node labels)
    └──enhances──> [Contract Graph] (highlight + scroll-to matches)
```

### Dependency Notes

- **Session JSONL parser is a shared primitive**: Receipt cards, observability, and the agent runner all depend on it. Build and test this in isolation before wiring to UI.
- **SQLite cache is the backbone**: Seven distinct features depend on it. Schema must be stable before building on top. Changes to schema during development cascade widely.
- **Cherrypick requires the full stack**: It is the first end-to-end feature and thus the hardest to integrate-test. All five layers (graph → inspector → contract editor → agent → diff view) must be working.
- **Mass semantic edit depends on working cherrypick**: The same agent runner, diff viewer, and approve logic are reused at N scale. Do not attempt mass edit until single cherrypick is reliable.
- **Drift detection requires PostToolUse hook AND re-derivation**: Neither half works alone. The hook fires; the Rust backend re-derives; the SQLite cache updates; the graph re-renders. Any gap in the chain = silent non-detection.
- **Receipt pinning enhances demo credibility but has no functional dependency**: It can be added after receipts are working without breaking anything.
- **Lens switcher (Journey) is functionally required for demo**: System/Ownership mocks are cosmetic and can be added last.
- **Non-coder mode is a skin on top of the inspector**: No new backend primitives required. Just a simplified editor view + a copy-focused prompt template. Easiest differentiator to add late.

---

## MVP Definition

### Launch With (v1 — Hackathon Demo)

These are required to hit all three demo beats. Nothing here is optional for the video.

- [ ] Five-level zoomable contract graph with react-flow — navigation surface exists
- [ ] SQLite cache with `.contracts/` sidecar parser — data layer that everything reads from
- [ ] Inspector panel (Contract + Code + Preview tabs) — single-node deep-dive works
- [ ] Agent runner shelling out to `claude` CLI + session JSONL parser — agent executes from IDE
- [ ] Inline diff viewer with accept/reject (Monaco diff editor) — atomic approve works
- [ ] Cherrypick flow end-to-end — **Demo beat 1: button color change**
- [ ] Receipt cards from JSONL — cost visibility per run
- [ ] Receipt side-by-side pinning — **all three beats end here**
- [ ] Drift detection + red-pulse node visual — **moat demonstration**
- [ ] Mass semantic edit (select N, approve-all) — **Demo beat 2: mass-add loading states**
- [ ] Non-coder copy-edit mode (simplified inspector + copy-only prompt) — **Demo beat 3**
- [ ] Journey lens working — coherent graph layout for demo repo
- [ ] System + Ownership lenses mocked — demonstrates model extensibility without full build
- [ ] MCP server with 4 tools (`find_by_intent`, `get_contract`, `list_drifted_nodes`, `update_contract`) — agent-from-outside access
- [ ] PostToolUse hook for live drift — keeps graph live during demo
- [ ] Demo repo `vercel/commerce` seeded L0–L2 — reproducible demo beats
- [ ] Command palette (Cmd+K) — power user navigation
- [ ] Error states + loading indicators — product feels solid, not hacky
- [ ] Theming + macOS native chrome (traffic lights, translucent sidebars, SF Pro) — required for "polished native" feel

### Add After Validation (v1.x)

- [ ] Keyboard navigation throughout graph + inspector — power user polish; blocks nothing for demo
- [ ] Search/filter within graph (FTS) — useful but Cmd+K serves the demo case
- [ ] Drift reconcile flow (both "accept code" and "fix code" paths) — detection is the demo; reconcile is polish
- [ ] Canonical + ghost node full UX (link-to-home, ghost badge) — model already exists; UX polish deferred
- [ ] Settings panel with keybinding config — needed for real users, not for demo video
- [ ] Undo/redo for contract edits — expected in production; demo doesn't require it
- [ ] Live preview pane auto-refresh on agent write — preview works from demo; auto-refresh is polish

### Future Consideration (v2+)

- [ ] Full System + Ownership lens implementation — meaningful only after teams adopt the product
- [ ] Authoritative contracts (code generated from contract, not derived) — requires bidirectional sync engine; entirely different scope
- [ ] Multi-user / collaboration — post-product-market-fit infrastructure investment
- [ ] Non-macOS platform — cheap with Tauri once macOS is proven
- [ ] Extension/plugin system — only after internal feature set stabilizes
- [ ] Cross-session agent memory beyond contracts — contracts ARE the memory; this is a future research question

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Contract graph (zoomable, react-flow) | HIGH | HIGH | P1 |
| SQLite cache + sidecar parser | HIGH | MEDIUM | P1 |
| Inspector panel | HIGH | HIGH | P1 |
| Agent runner + JSONL parser | HIGH | MEDIUM | P1 |
| Inline diff viewer (Monaco) | HIGH | LOW | P1 |
| Cherrypick flow (Demo beat 1) | HIGH | HIGH | P1 |
| Drift detection + visual | HIGH | HIGH | P1 |
| Receipt cards | MEDIUM | MEDIUM | P1 |
| Receipt pinning | MEDIUM | LOW | P1 |
| Mass semantic edit (Demo beat 2) | HIGH | HIGH | P1 |
| Non-coder copy-edit mode (Demo beat 3) | HIGH | LOW | P1 |
| Journey lens | HIGH | MEDIUM | P1 |
| MCP server (4 tools) | MEDIUM | MEDIUM | P1 |
| PostToolUse hook | MEDIUM | LOW | P1 |
| Demo repo seeding (`vercel/commerce`) | HIGH | MEDIUM | P1 |
| Command palette | MEDIUM | LOW | P1 |
| macOS native chrome + theming | MEDIUM | LOW | P1 |
| Error states / loading indicators | MEDIUM | LOW | P1 |
| System/Ownership lens mocks | LOW | LOW | P1 (cosmetic) |
| Keyboard navigation (full) | MEDIUM | MEDIUM | P2 |
| Graph search / FTS filter | MEDIUM | MEDIUM | P2 |
| Drift reconcile flow | MEDIUM | MEDIUM | P2 |
| Ghost node full UX | MEDIUM | MEDIUM | P2 |
| Settings panel | LOW | LOW | P2 |
| Undo/redo for contracts | MEDIUM | MEDIUM | P2 |
| Live preview auto-refresh | LOW | LOW | P2 |
| Full System/Ownership lenses | LOW | HIGH | P3 |
| Authoritative contracts | HIGH | HIGH | P3 |

**Priority key:**
- P1: Must have for demo video (blocks all three beats)
- P2: Should have once beats work (power user polish)
- P3: Future / post-validation

---

## Competitor Feature Analysis

| Feature | Cursor | Sourcegraph Cody | GitHub Copilot Workspace | Our Approach |
|---------|--------|-----------------|--------------------------|--------------|
| Primary navigation | File tree + fuzzy search | File search + code graph (text symbols) | GitHub issue / PR as entry point | Contract graph — navigate by intent, not path |
| Context for agent | Whole-repo grep + embeddings (Cursor's @ mentions) | Code graph (symbol relationships) | Spec → plan → file list | Selected graph scope (contract + node context) — targeted, not broad |
| Change approval | Inline diff accept/reject per file | Inline diff in IDE | Iterative plan review then batch apply | Atomic contract diff + code diff together; mass approve-all for semantic edits |
| Drift detection | None — no intent layer to drift from | None | None (spec is ephemeral) | Red-pulse nodes; PostToolUse hook; list_drifted_nodes MCP tool |
| Cost observability | None | None | None | Receipt cards per run; side-by-side pinning for benchmarking |
| Non-coder access | None — requires coding literacy | None | Partial (GitHub issue → NL plan, but output is code review) | Copy-edit mode: plain-English contract edit produces targeted code change |
| Graph visualization | None | Dependency graph in web UI (not primary navigation) | None | react-flow canvas IS the primary navigation surface |
| Persistent intent layer | None — each chat session starts over | Partial (code graph is structural, not semantic intent) | Partial (spec written per session, not version-controlled) | `.contracts/` sidecar files: git-native, versioned, diff-friendly |
| Multi-lens views | None | None | None | Journey (working), System + Ownership (mocked); extensible model |

---

## Sources

- Cursor changelog (March 2026 Agents Window, parallel agents): https://cursor.com/changelog/3-0
- Zed AI native editing, ACP protocol, GPUI performance: https://zed.dev/ai
- Sourcegraph Cody code graph context: https://sourcegraph.com/docs/cody
- GitHub Copilot Workspace spec-plan-edit flow: https://githubnext.com/projects/copilot-workspace
- GitHub dadbodgeoff/drift — intent drift detection tool: https://github.com/dadbodgeoff/drift
- Intent Drift Detection article series (zenn.dev, 2026-04): https://zenn.dev/virtualcraft/articles/idd-11_why-idd-now
- Raycast command palette + macOS power user UX: https://www.raycast.com/
- react-flow / xyflow node-based UI library: https://reactflow.dev/
- Monaco inline diff editor with accept/reject: https://github.com/Dimitri-WEI-Lingfeng/monaco-inline-diff-editor-with-accept-reject-undo
- Claude Code MCP + observability tools: https://code.claude.com/docs/en/mcp
- claude-code-hooks-multi-agent-observability (hook-based JSONL): https://github.com/disler/claude-code-hooks-multi-agent-observability
- v0/Bolt/Replit NL-to-code live preview patterns: https://blog.techforproduct.com/p/how-do-replit-v0-and-bolt-actually
- Figma semantic tokens + intent layer design: https://www.figma.com/blog/the-future-of-design-systems-is-semantic/
- Preventing Agent Drift (designative.info, March 2026): https://www.designative.info/2026/03/08/preventing-agent-drift-designing-ai-systems-that-stay-aligned-with-human-intent

---
*Feature research for: Agent-native macOS IDE, contract graph navigation*
*Researched: 2026-04-24*
