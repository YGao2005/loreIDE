# Pitfalls Research

**Domain:** Agent-native macOS IDE — semantic contract graph + Tauri 2 + Claude Code integration
**Researched:** 2026-04-24
**Confidence:** HIGH (Tauri/WKWebView issues — verified via official GitHub issues), MEDIUM (contract drift, demo failure modes — cross-referenced from adjacent project post-mortems), LOW (non-coder UX claims — no direct comparable product exists)

---

## DEMO-RISK SECTION: What Will Kill the Video

These are the failure modes that would cause the 3-minute demo video to fail outright. Address all of them before any polish work.

| # | Risk | Likelihood | Demo Impact | Kill Switch |
|---|------|-----------|-------------|-------------|
| 1 | Contracts describe implementation not intent — graph looks like a file tree | HIGH | TOTAL (the moat is gone) | Pre-approve all seeded contracts before filming |
| 2 | Monaco workers fail in WKWebView — editor is jank or blank | HIGH | BEAT 1, 2, 3 all fail | vite-plugin-monaco-editor + CSP `blob:` early |
| 3 | Session JSONL parse fails — receipt shows $0 / 0 tokens | MEDIUM | Receipt pinning beat is broken | Defensive parse + mock fallback for demo |
| 4 | react-flow bogs down — graph pan/zoom stutters on camera | MEDIUM | First impression destroyed | onlyRenderVisibleElements + node cap in demo repo |
| 5 | Contract seeding eats 3 days — vercel/commerce L2 never finishes | HIGH | Demo repo is unusable | Hard scope to L0–L1 only; 30 nodes max |
| 6 | Drift detection fires on wrong files — false positives | MEDIUM | Red nodes confuse narrator | Scope hook to `.contracts/`-adjacent files only |
| 7 | Non-native chrome (scrollbars, fonts, window) — product looks like a web page | MEDIUM | "This is just an Electron app" impression | window-vibrancy + SF Pro + traffic lights day 1 |
| 8 | Demo beats are not reproducible — live improvised demo breaks | HIGH | Any slip destroys the narrative | Scripted beats against committed contract seeds |

---

## Critical Pitfalls

### Pitfall 1: Contract Drift — Contracts Go Stale the Moment Code Changes

**What goes wrong:**
The LLM-derived contract for a component says "renders a buy button with primary color" but a developer pushed a refactor that renamed the component, extracted a subcomponent, and changed the color token. The contract is now wrong. Wrong contracts are worse than none: they silently send agents to the wrong node, and drift detection misses the divergence because it compares code to the wrong baseline.

**Why it happens:**
Contract derivation is a one-time batch job in most implementations. Developers treat derivation as "done" once seeded. No mechanism re-fires the job on code changes unless explicitly wired. In a hackathon build the PostToolUse hook fires only when Claude Code writes files, not when the developer makes a manual edit.

**How to avoid:**
- Wire the `notify` crate watcher to watch both `.contracts/` AND source files in the project. Any write to a watched source file triggers a re-derivation for that file's corresponding contract node.
- PostToolUse hook covers agent writes; `notify` covers manual writes. Both paths must exist day 1.
- Store a `derived_at` hash (SHA-256 of source file content) in the contract frontmatter. Drift check = compare `derived_at` to current file hash, not to a time-based staleness window.
- For the demo repo: re-derive and verify all contracts immediately before filming. Lock the demo repo to a specific commit. Never film against a live checked-out repo.

**Warning signs:**
- A contract reads as a generic description ("this is a React component that renders UI") rather than a specific behavioral description ("renders the checkout confirm button disabled when cart is empty")
- The `derived_at` field in the YAML frontmatter is older than the last git commit to the corresponding source file
- You catch yourself editing a contract manually to match code changes instead of re-deriving

**Phase to address:** Data layer phase (SQLite + sidecar parser) — the hash-based drift check must be part of the initial schema, not bolted on later.

**Fallback:** If drift detection is broken at demo time, remove the red-pulse animation entirely. Showing a stable clean graph is better than a graph that pulses incorrectly. Mock a single known-drifted node manually.

---

### Pitfall 2: Generic Contract Quality — "This Is a Button" Kills the Demo

**What goes wrong:**
The most dangerous quality failure. The contract for `<AddToCartButton>` reads: "A button component that handles click events and updates state." This is true but useless. The demo relies on the viewer saying "oh, I can find *any* piece of the product by intent." Generic contracts destroy that claim immediately. The graph becomes a worse-named file tree.

**Why it happens:**
Default LLM derivation prompts produce structural summaries because that's what's easiest to generate from code alone. Without behavioral context (what user goal does this serve? what contract does it uphold with the user?), the model produces documentation, not contracts.

**How to avoid:**
- Write the derivation prompt to demand three specific fields: `intent` (the user goal this serves), `invariants` (what must always be true when this renders), `dependencies` (what contract-level assumptions it makes about its parent/children). Generic summaries fail all three.
- Seed the demo repo's L0–L2 contracts entirely by hand. Do not auto-derive them. The demo contracts are marketing copy — write them as such.
- Spot-check: if you can swap the contract body between two different components without it reading as wrong, the contract is too generic.
- Rate-limit auto-derivation to files where you have enough context. Mark low-confidence derivations with `confidence: LOW` in frontmatter so the graph can visually differentiate them.

**Warning signs:**
- Contract description contains the word "component" more than once and no user-facing behavior verbs
- Two sibling component contracts have nearly identical bodies
- The `intent` field starts with "This component..."
- You find yourself reading a contract and not knowing which page of the app it refers to

**Phase to address:** Demo repo seeding phase. Contracts are written before filming, not auto-generated and accepted uncritically.

**Fallback:** If auto-derivation quality is poor, narrow the demo to only manually-curated nodes. Hide the auto-derived nodes behind a "needs review" filter. The demo never surfaces an un-reviewed contract.

---

### Pitfall 3: react-flow Performance — Graph Bogs Down on Camera

**What goes wrong:**
With ~200+ visible nodes, react-flow re-renders all of them on every pan/zoom event. On a MacBook Pro during screen recording (CPU shared with recording software), the graph drops below 30fps. Pan gestures stutter. The demo narrator pauses awkwardly. Viewers notice.

**Why it happens:**
react-flow renders every node by default, even off-screen ones. Custom node components with `useState` or unoptimized renders multiply the cost. `vercel/commerce` at L3 (component level) has ~300+ components. Without `onlyRenderVisibleElements`, this is a guaranteed performance problem.

**How to avoid:**
- Enable `onlyRenderVisibleElements` on the `<ReactFlow>` component from day 1. This is a single prop. There is no reason to not set it.
- Memoize all custom node components with `React.memo`. The node re-render cost is `O(visible_nodes * render_time)` — even simple renders add up.
- For the demo, cap the loaded graph at L0–L2 (Product → Flows → Surfaces). That's typically 20–60 nodes. Load L3/L4 (Components, Atoms) only when the user explicitly drills into a Surface node. This is correct UX anyway (progressive disclosure).
- Avoid storing derived state in node `data` objects that changes on every tick. Keep node data static; use a separate store for transient state (hover, selection).
- Test with screen recording software running (QuickTime, OBS). Not with the app alone.

**Warning signs:**
- Chrome DevTools FPS meter drops below 50fps during pan on a graph with >100 visible nodes
- Node re-renders show up in React Profiler on mouse moves (not just on data changes)
- The minimap lags behind the main canvas viewport

**Phase to address:** Graph canvas phase — set `onlyRenderVisibleElements` and `React.memo` at scaffolding time, not as an optimization pass.

**Fallback:** Hard-cap the demo graph at 50 nodes. If L2 surfaces alone fit in 50, show only L2 for the demo. Zoom-to-L3 behavior can be demoed on a single drilled-in surface, not the full graph.

---

### Pitfall 4: Tauri Async Runtime Conflict — Silent Deadlocks

**What goes wrong:**
Adding `#[tokio::main]` to `main.rs` (the most natural Rust pattern) causes Tauri to initialize a second Tokio runtime. Background tasks silently deadlock or panic. The symptom is: the app launches, appears fine, but IPC commands for file watching or contract re-derivation silently drop. This is hours of debugging for no net gain.

**Why it happens:**
Every Rust tutorial for async code shows `#[tokio::main]`. It's the cargo-cult pattern. Tauri's own runtime initialization is non-obvious and not front-and-center in beginner docs.

**How to avoid:**
- Remove `#[tokio::main]` from `main.rs`. Use `tauri::async_runtime::spawn()` for all background work.
- File a linter rule / comment at the top of `main.rs`: `// DO NOT add #[tokio::main] — Tauri owns the runtime. Use tauri::async_runtime::spawn().`
- For CPU-bound Rust work (contract derivation, file hashing): `tauri::async_runtime::spawn_blocking(|| { ... })`.

**Warning signs:**
- `notify` file watcher callbacks fire but the Tauri event emission inside them never reaches the frontend
- IPC commands return `Ok` immediately but the UI never updates
- Background file scan appears to complete but SQLite is never populated

**Phase to address:** Rust backend phase — Tauri project scaffold, day 1. The comment in `main.rs` is the prevention.

**Fallback:** If deadlocks appear, `git grep tokio::main` immediately. It's almost always the cause.

---

### Pitfall 5: Monaco Editor Web Workers Fail in WKWebView

**What goes wrong:**
Monaco creates Web Workers for syntax highlighting, IntelliSense, and diff computation. WKWebView on macOS blocks worker creation from dynamic blob URLs when CSP is restrictive. The editor silently falls back to single-threaded mode. Symptoms: editor is slow, diff highlights are delayed, scrolling large files causes UI jank. On camera, the code pane looks broken.

**Why it happens:**
WKWebView is not Chrome. Its security model more strictly enforces `script-src` CSP directives. The default Tauri CSP does not include `blob:` in `script-src`. Monaco's default worker creation uses `new Worker(URL.createObjectURL(...))` which is blocked.

**How to avoid (two steps, both required):**
1. Install `vite-plugin-monaco-editor` — converts Monaco's dynamic worker imports to Vite-resolved URLs (not blob).
2. Add `"blob:"` to `script-src` in `tauri.conf.json` CSP as a belt-and-suspenders fallback.

Test on macOS WKWebView explicitly (not browser dev mode). Workers work in browser dev mode because it's Chrome. They fail in WKWebView.

**Warning signs:**
- Browser console shows: "Could not create web worker(s)"
- Monaco works fine during `npm run dev` (browser mode) but breaks in `cargo tauri dev`
- Diff editor highlights flash then disappear

**Phase to address:** Inspector panel phase — wire Monaco and run `cargo tauri dev` smoke test before building any contract editing UI on top of it.

**Fallback:** If workers still fail after both mitigations, use Monaco in single-threaded mode deliberately: set `workerUrl: null` in Monaco options and accept the performance cost. For read-only code display (most of the inspector), single-threaded Monaco is acceptable. Only the diff editor needs workers.

---

### Pitfall 6: Claude Code JSONL Schema Drift — Receipts Show Wrong Data

**What goes wrong:**
The session JSONL format at `~/.claude/projects/<path>/<session>.jsonl` is undocumented. The `usage` object fields have already changed once (ephemeral cache tier sub-fields added post-launch). A field that existed in January may not exist today, or may be nested differently. Receipts that show `$0` or `0 tokens` destroy the demo's cost-comparison narrative.

**Why it happens:**
Engineering teams ship internal tooling changes that ripple into the JSONL without versioning the schema. The community documents the format from observation, not from Anthropic-published specs.

**How to avoid:**
- Parse defensively: `usage?.input_tokens ?? 0`, not `usage.input_tokens`.
- Extract only 4 fields: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, and `tool_use` block count. Everything else is noise.
- Log the raw JSON of any line that fails to parse. Never silently swallow parse errors.
- On startup, parse a known session JSONL file from the test fixture and assert the 4 expected fields are present. This is a 10-line test that catches schema drift before demo day.
- Use `transcript_path` from the PostToolUse hook stdin — do not scan `~/.claude/projects/` yourself. The hook provides the exact file path.

**Warning signs:**
- Receipt card shows 0 tokens after an agent run that visibly produced output
- `console.log(rawLine)` shows a `usage` object with different keys than expected
- Token cost estimate is negative or absurdly large (field name collision)

**Phase to address:** Agent runner phase — write the JSONL parser as an isolated module with a fixture-based test before connecting it to the receipt UI.

**Fallback:** If JSONL parsing breaks at demo time, hard-code one plausible receipt for the demo video. The demo is pre-recorded. A reasonable mock receipt is better than a broken receipt. Never show a broken receipt on camera.

---

### Pitfall 7: Node Identity Under Refactors — The Graph Breaks When Files Move

**What goes wrong:**
A developer renames `ProductCard.tsx` to `product/Card.tsx`. The contract sidecar was keyed to the file path (or derived from it). The UUID in the frontmatter is what matters — but if the scanning logic uses file path as a fallback identity, it creates a new node and loses the edge history. The graph develops phantom nodes and orphaned contracts after even trivial refactors.

**Why it happens:**
It's tempting to derive node identity from file path because it's always available. UUIDs require discipline to assign once and never regenerate. During rapid development, scaffolding scripts regenerate UUIDs to "fix" mismatches.

**How to avoid:**
- UUIDs live in the YAML frontmatter and are **never regenerated**. If a file moves, the sidecar moves with it. The UUID is the identity; the path is just the current location.
- The scanner builds its index from UUID → current path, never path → UUID.
- Write a startup validation that detects duplicate UUIDs across `.contracts/` files and refuses to load until they're resolved. Duplicate UUIDs are the most dangerous form of this bug.
- When creating new contracts, generate the UUID once with `crypto.randomUUID()` and commit the sidecar immediately. Never re-generate.

**Warning signs:**
- The graph shows more nodes than you have contract files (phantom nodes from old paths)
- Moving a file causes it to appear twice in the graph
- Edge connections disappear after a file rename

**Phase to address:** Data layer phase — enforce UUID immutability in the sidecar parser before building the graph layer on top.

**Fallback:** If UUID drift has already happened, write a one-time migration script that deduplicates by contract body hash (contracts with identical bodies are probably the same node re-created). Fix before demo.

---

### Pitfall 8: Atomicity Failure — Contract and Code Diverge at Commit Time

**What goes wrong:**
The cherrypick flow produces two diffs: the contract `.md` file and the source code file. If the user approves only one (a UI bug, a crash, a network error), the contract and code are now out of sync at the git history level. This creates permanent drift that's invisible to the drift detection system (which only checks derivation hash, not approval atomicity).

**Why it happens:**
Two separate file writes with a confirmation step between them. Any interruption — app crash, accidental Cmd+Q, mis-click on "reject code" when intending "reject contract" — produces a partial commit.

**How to avoid:**
- Use a two-phase write: write both files to temp paths, then atomically rename both into place (rename is atomic on POSIX). Neither file lands until both are ready to land.
- The "approve" button in the diff viewer writes both files in a single Rust IPC command (`approve_cherrypick(contract_diff, code_diff)`). Never two separate IPC calls.
- After writing, emit a single SQLite transaction that updates the contract hash and the code hash together. Partial state in SQLite is as bad as partial state on disk.

**Warning signs:**
- The approve flow has separate "approve contract" and "approve code" buttons rather than a single "approve both" action
- You find yourself writing two `invoke('write_file', ...)` calls in sequence from the frontend

**Phase to address:** Cherrypick flow phase — the atomic write must be designed as a single Rust command, not a sequence of frontend calls.

**Fallback:** If a partial write occurs, the drift detection will catch it on next load (contract hash won't match code hash). Surface a "repair" option that re-derives and re-proposes the pair. This is a P2 feature but the detection machinery exists already.

---

### Pitfall 9: MCP Sidecar Binary Naming — Wrong Target Triple Prevents Launch

**What goes wrong:**
The MCP server binary compiled for `x86_64-apple-darwin` will not launch on an M3 Mac (requires `aarch64-apple-darwin`). Tauri's sidecar launch will fail silently — no error surface in the UI, the MCP tools just don't respond. This is a 10-minute fix if you know the cause; a 2-hour debug if you don't.

**Why it happens:**
Developers compile on one machine and forget the target triple. The `externalBin` config in `tauri.conf.json` requires the filename to match exactly.

**How to avoid:**
- Check target triple once: `rustc -Vv | grep host` — this outputs e.g. `aarch64-apple-darwin`.
- Name the output binary in the `pkg` build command: `mcp-server-aarch64-apple-darwin`.
- Add a startup check: if the MCP sidecar fails to spawn, surface a visible error banner in the UI immediately. Never allow silent MCP absence.

**Warning signs:**
- `find_by_intent` tool calls return empty results or never respond
- No output in the MCP sidecar stdout log
- Tauri shell plugin log shows a "binary not found" or "exec format error"

**Phase to address:** MCP server phase — test sidecar launch before writing any MCP tool logic.

**Fallback:** For the demo, run the MCP server as a plain `node mcp-server/index.js` process manually started before demo. Not a sidecar. Wire Claude Code's `mcp` config to point at it directly. This bypasses Tauri sidecar entirely for demo purposes.

---

## Moderate Pitfalls

### Pitfall 10: Demo Repo Seeding Scope Creep — vercel/commerce L3 Eats the Week

**What goes wrong:**
`vercel/commerce` has ~400 components at L3. Attempting to hand-curate all of them consumes the entire hackathon timeline. The demo only needs 3 beats. Beat 1 needs one node (AddToCartButton). Beat 2 needs ~10 nodes. Beat 3 needs one text node.

**How to avoid:**
- Hard-cap seeding at L0 (1 node: the product), L1 (4–6 nodes: major flows), L2 (10–15 nodes: key surfaces for the 3 flows in the demo). Total: ~25 nodes.
- Do not seed L3/L4 for the demo. The demo never shows those levels. Add a "..." indicator on surfaces to signal there are unseen children.
- Time-box seeding to 4 hours total. If not done in 4 hours, cut nodes, not quality.

**Warning signs:**
- More than 2 people are working on contract seeding simultaneously
- You've been writing contracts for > 4 hours
- You're on L3 components and it's day 3

**Phase to address:** Demo repo seeding phase — scope is fixed before the phase begins.

**Fallback:** Abandon L2 partial nodes. Show only L0–L1 fully seeded. A shallow but coherent graph is better than a deep incomplete one.

---

### Pitfall 11: Live Preview iframe CORS / Localhost Assumptions

**What goes wrong:**
The inspector's preview pane points at `localhost:3000` (or wherever `vercel/commerce` dev server runs). If the dev server isn't running, the iframe shows a blank page. If the port is different on the demo machine, it shows a blank page. CORS headers on the dev server may block the Tauri WebView origin. The "before/after" preview beat fails silently.

**How to avoid:**
- Derive the preview URL from the node's `route` contract field: `http://localhost:${PORT}${route}`. Make `PORT` a configurable setting, not a hardcoded 3000.
- Show an explicit "Start dev server" prompt with a button that calls `tauri-plugin-shell` to run `npm run dev` if the port is unreachable.
- For the demo: start `vercel/commerce` dev server before filming, verify the preview pane loads, commit the port to demo settings. Do not improvise.

**Warning signs:**
- Preview pane is a persistent spinner
- Browser console shows "Refused to display 'http://localhost:...' in a frame" (X-Frame-Options or CSP)
- The app works on your machine but not on the demo machine because port differs

**Phase to address:** Inspector panel phase — preview pane should have an error state from day 1.

**Fallback:** Cut the live preview pane from the demo video if it's unreliable. Show the after-state in the code pane (Monaco read-only) instead. The receipt comparison is the demo's climax, not the preview.

---

### Pitfall 12: Scope Creep into Code Scaffolding / Multi-Provider Agent Abstraction

**What goes wrong:**
Mid-build, the temptation arises to add: "what if we also generated new components from contracts?" or "what if we supported OpenAI's CLI too?" Either of these re-scopes the project entirely. Code scaffolding requires a template system, project init flow, and conflict resolution. Multi-provider abstraction requires an adapter layer for JSONL schema differences. Both produce zero demo value.

**How to avoid:**
- Maintain a written "out of scope" list in `PROJECT.md` (already exists). When a new idea emerges, the default answer is "does it appear in the 3-minute demo video?" If no, it's out of scope.
- Daily check: is every commit traceable to one of the three demo beats? If a commit isn't, stop and ask why.
- The only scope expansions that are acceptable are ones that directly unblock a demo beat and cannot be mocked.

**Warning signs:**
- "We could also..." in any planning conversation
- A feature discussion that doesn't reference a demo beat by number
- New dependencies appear in `package.json` that aren't in STACK.md

**Phase to address:** Every phase — this is a decision policy, not a one-time implementation.

**Fallback:** None needed. Scope creep is always optional. Cut the feature and ship the demo.

---

### Pitfall 13: Benchmark Methodology — Token Comparisons That Don't Land

**What goes wrong:**
The receipt pinning beat requires a believable "Contract IDE vs. terminal Claude Code" comparison. If the baseline was run on a different task, different file, or different model context window, the comparison is apples-to-oranges. Viewers feel manipulated even if the numbers are technically correct.

**How to avoid:**
- Run the exact same task (e.g., "change the Add to Cart button color to coral") with terminal Claude Code against the same `vercel/commerce` repo before adding contracts. Capture the JSONL. Store it as the baseline receipt.
- Run the same task with Contract IDE. The only variable should be: does the agent have the contract graph context or not?
- Calculate: token delta, tool call delta, time delta. These should be favorable for Contract IDE by a wide margin (the agent doesn't need to grep the whole repo to find the right file).
- Commit the baseline receipt as a test fixture. It should be reproducible.

**Warning signs:**
- The baseline and the Contract IDE run used different prompt texts
- The baseline was run on a different machine or different network conditions (latency affects wall time)
- The token difference is less than 20% — this won't land as a compelling demo beat

**Phase to address:** Receipt system phase — design the receipt schema to support baseline storage from day 1.

**Fallback:** If the real numbers aren't compelling, be honest in the demo narration: "same task, same model — the difference is context quality." Let the receipt speak. Don't manufacture dramatic numbers.

---

### Pitfall 14: Non-Native macOS Feel Despite Web Stack

**What goes wrong:**
Default Tauri + React apps look like web pages running in a frame. The scrollbars are webview scrollbars. The fonts are Inter instead of SF Pro. The sidebar doesn't have the frosted glass effect. The window has no proper macOS traffic lights. First impression for any macOS developer: "this is just Electron."

**Why this matters for the demo:**
The pitch includes "feels native on macOS." If it doesn't, that claim is dead on arrival.

**How to avoid (all four items are required):**
1. `window-vibrancy` crate: `apply_vibrancy(&window, NSVisualEffectMaterial::Sidebar, ...)` on the sidebar panel.
2. CSS: `font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif` on `body`. Do not use Inter for UI chrome.
3. Tailwind CSS scrollbar hiding (`scrollbar-thin` or `scrollbar-none`) on all panels except code view.
4. Tauri window config: `decorations: true` with `transparent: true` on the title bar area to expose native traffic lights. Set `titleBarStyle: "overlay"` in `tauri.conf.json`.

**Warning signs:**
- Default Inter or system UI font visible in the sidebar
- Standard webview scrollbar (thick, Windows-style) visible on scroll
- Window has a white non-translucent sidebar
- Traffic lights are missing or misaligned

**Phase to address:** App shell phase — apply all four items when the window is first scaffolded. Retrofitting native chrome after building panels is much harder.

**Fallback:** If vibrancy is broken (can happen with certain macOS versions + transparency settings), fall back to a solid dark sidebar (`bg-zinc-900/95`) with a backdrop blur (`backdrop-blur-xl`) on the panel. Not identical to native but avoids the "web page in a frame" look.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Auto-derive all contracts without review | Fast seeding | Generic contracts destroy demo credibility | Never for demo-facing nodes |
| File path as node identity (no UUID) | Simpler scanning | Graph breaks on any refactor | Never |
| Two separate IPC calls for approve (contract + code) | Simpler frontend code | Partial writes cause permanent drift | Never |
| Skip `onlyRenderVisibleElements` | Less code | Graph stutters at >100 nodes on camera | Never (it's a one-line fix) |
| Hardcode `localhost:3000` for preview | Quick to ship | Fails on any other port | Acceptable in MVP if made a config value |
| JSONL parse without error logging | Simpler | Silent receipt failures, impossible to debug | Never |
| Skip startup MCP sidecar health check | Faster startup | MCP tools silently absent, no user feedback | Never |
| Deploy demo against live vercel/commerce (no committed seed) | One less step | Demo is non-reproducible | Never — seeds must be committed |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Monaco + WKWebView | Assume browser dev mode behavior = production | Install `vite-plugin-monaco-editor` + set `blob:` in CSP; test in `cargo tauri dev` explicitly |
| Claude Code JSONL | Access `usage.cache_creation.ephemeral` directly | Use optional chaining: `usage?.cache_creation?.ephemeral ?? 0` |
| PostToolUse hook | Try to return a blocking response to modify Claude Code behavior | Exit 0, write nothing to stdout; hook is fire-and-forget for our use case |
| Tauri `invoke()` | Use `invoke('command_name')` with no type parameter | Use `invoke<ContractNode[]>('get_nodes')` — type the return or validation is impossible |
| Tauri events | Call `listen('event', handler)` without cleanup | `const unlisten = await listen(...); return () => unlisten()` in `useEffect` cleanup |
| `notify` watcher + Tauri | Call async Tauri API from a `notify` callback directly | Use a `std::sync::mpsc` channel; drain in a `spawn_blocking` thread that calls the Tauri command |
| MCP sidecar | Use `StdioServerTransport` and expect it to work over HTTP | Stdio is correct for sidecar; don't add HTTP server logic |
| `#[tokio::main]` | Copy from Rust tutorial | Delete it; Tauri owns the runtime |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| All graph nodes rendered at once | Pan/zoom FPS drops below 30 on camera | `onlyRenderVisibleElements` + `React.memo` on node components | >100 visible nodes |
| SQLite full scan on every graph update | Noticeable pause when a contract file changes | Index on `uuid`, `file_path`, `drift_state`; use `WHERE uuid = ?` not `SELECT * FROM nodes` | >200 rows |
| `gray-matter` parsing all contracts on every IPC call | Agent run causes UI freeze | Parse once on file change, cache in SQLite; IPC returns SQLite data, not re-parsed files | >50 contract files |
| Polling `~/.claude/projects/` for JSONL changes | CPU spike + latency | Use `transcript_path` from hook payload; parse on hook fire, not on a 1s interval | Immediately |
| react-flow edge label re-renders | Graph judders when any node state changes | Memoize edge components; edges should only update when their own data changes | >50 edges |

---

## "Looks Done But Isn't" Checklist

- [ ] **Monaco diff editor:** Appears to work but workers are actually in single-threaded fallback — verify by checking for "Could not create web worker" in Tauri dev console, NOT browser console
- [ ] **Drift detection:** Shows red nodes after manual file edits — verify the `notify` watcher fires on manual saves (not just Claude Code writes), by editing a source file outside the IDE and confirming the node turns red
- [ ] **Receipt cards:** Show non-zero token counts — verify by running a real agent task through the app (not a mocked session), checking that `input_tokens` is populated from actual JSONL
- [ ] **MCP server tools:** `find_by_intent` returns results — verify by calling it from a Claude Code session pointing at the running MCP sidecar, not just from a unit test
- [ ] **Atomic approve:** Contract and code files both updated atomically — verify by killing the app mid-approve (Cmd+Q after clicking approve but before the Tauri command completes) and confirming neither file is in a partial state
- [ ] **Native chrome:** Sidebar has vibrancy effect — verify on the demo machine (not dev machine) after building with `cargo tauri build`, not just in `cargo tauri dev`
- [ ] **Demo beats are reproducible:** All three beats succeed 3 times in a row — run full rehearsal before filming
- [ ] **vercel/commerce seed contracts are committed:** `git status` shows clean on the demo repo branch

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Generic contracts in demo | LOW | Rewrite the 25 seeded contracts manually; takes 2–3 hours |
| Monaco worker failure in WKWebView | LOW | Add `vite-plugin-monaco-editor` + CSP `blob:` — 30 minutes |
| JSONL parse broken at demo time | LOW | Hard-code plausible receipt values as a static fixture for demo purposes |
| Graph stuttering | LOW | Enable `onlyRenderVisibleElements` + `React.memo` — 1 hour |
| Node UUID drift (duplicates) | MEDIUM | Write one-time dedup script keyed on file path; 2 hours |
| Tauri runtime deadlock | MEDIUM | `git grep tokio::main` + remove; 1 hour to diagnose, 5 minutes to fix |
| Sidecar binary wrong target triple | LOW | Recompile with correct target triple + rename; 20 minutes |
| Partial approve (atomicity failure) | MEDIUM | Detect drifted node at load time; surface "repair" button that re-derives and re-proposes |
| Demo repo seeding overrun | LOW | Cut to L0–L1 only (10 nodes); 1 hour to prune existing work |
| Non-native chrome | MEDIUM | Apply all 4 native chrome items before any panel work; retrofitting costs 4+ hours |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Contract drift (no re-derivation) | Data layer (SQLite + sidecar + notify watcher) | Manually edit a source file; confirm graph node turns red within 2s |
| Generic contract quality | Demo repo seeding | Read each seeded contract aloud; can you identify the UI element uniquely? |
| react-flow performance | Graph canvas scaffolding | FPS counter during pan/zoom with 100 visible nodes + screen recording running |
| Tauri async runtime conflict | Rust backend scaffolding | `git grep tokio::main src-tauri/` returns empty |
| Monaco web workers | Inspector panel scaffolding | Check Tauri dev console for "Could not create web worker" before building editor UI |
| JSONL schema drift | Agent runner phase | Fixture-based parse test against a real JSONL sample |
| Node UUID drift | Data layer phase | Startup validation catches duplicate UUIDs and refuses to load |
| Atomicity failure | Cherrypick flow phase | Single Rust IPC command for approve; no sequence of frontend calls |
| MCP sidecar naming | MCP server phase | Launch sidecar before writing any MCP tool logic; check Tauri log |
| Demo repo scope creep | Demo repo seeding phase | Fixed node budget (25 nodes) written before seeding begins |
| Non-native chrome | App shell phase | Check on demo machine post-build (not just in dev mode) |
| Benchmark methodology | Receipt system phase | Committed baseline JSONL fixture with documented conditions |

---

## Sources

- Tauri GitHub Issue #13330 — `#[tokio::main]` async runtime conflict: https://github.com/tauri-apps/tauri/issues/13330 (HIGH confidence)
- Tauri GitHub Discussion #9595 — Monaco Web Worker failure in WKWebView: https://github.com/orgs/tauri-apps/discussions/9595 (HIGH confidence)
- Tauri sidecar-nodejs docs — binary naming, target triples: https://v2.tauri.app/learn/sidecar-nodejs/ (HIGH confidence)
- Claude Code hooks reference — PostToolUse schema: https://code.claude.com/docs/en/hooks (HIGH confidence)
- Claude Code hook schema inconsistency — GitHub issue #19115: https://github.com/anthropics/claude-code/issues/19115 (MEDIUM confidence)
- Community JSONL format analysis: https://databunny.medium.com/inside-claude-code-the-session-file-format-and-how-to-inspect-it-b9998e66d56b (MEDIUM confidence — single source, no official doc)
- react-flow performance docs — onlyRenderVisibleElements: https://reactflow.dev/learn/advanced-use/performance (HIGH confidence)
- window-vibrancy crate — macOS NSVisualEffectView: https://crates.io/crates/window-vibrancy (HIGH confidence)
- Adjacent project failure modes: LLM-maintained doc systems (Docusaurus AI features, Mintlify AI drift), visual IDE attempts (CodeSandbox Projects, StackBlitz AI), desktop web apps (Notion, Linear — both required significant native chrome effort)

---
*Pitfalls research for: Agent-native macOS IDE with semantic contract graph (Contract IDE)*
*Researched: 2026-04-24*
