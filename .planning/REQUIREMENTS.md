# Requirements: Contract IDE

**Defined:** 2026-04-24
**Core Value:** A developer or PM can locate any piece of the product by intent, edit its contract, and have the agent produce the corresponding code change — without touching the file tree.

**Visual model (locked 2026-04-24, see `CANVAS-PURPOSE.md`):** The canvas renders flows as vertical participant chains — rendered iframe trigger for UI surfaces, structured Stripe-API-docs-style cards for backend endpoints / cron / webhooks. Atom chips overlay components on the iframe (UI mode) or sit beside the card (backend mode). Sidebar replaces L0/L1 zoom. The L0–L4 hierarchy in `.contracts/*.md` frontmatter is preserved unchanged as the data model. New requirement families (CARD-, CHIP-, CHAIN-, SIDEBAR-, BABEL-, JSX-, FLOW-, BACKEND-FM-) added below for the new affordances; existing GRAPH-* requirements annotated where their visual treatment is superseded.

---

## v1 Requirements

Requirements for the hackathon demo release. Each maps to a roadmap phase.

### Shell

- [x] **SHELL-01**: User launches the app and sees a three-pane layout (left sidebar with lens switcher + Copy Mode pill, center graph canvas, right inspector, bottom collapsible chat) with native macOS chrome (traffic lights, vibrancy, SF Pro)
- [x] **SHELL-02**: User can open a repository via folder picker and the app indexes it into the contract cache
- [x] **SHELL-03**: User opens a command palette with Cmd+K and runs core actions (open repo, toggle lens, focus chat, jump to node)
- [x] **SHELL-04**: User sees loading/empty/error states for repo indexing, derivation, and agent runs
- [x] **SHELL-05**: Contract edits autosave on blur + Cmd+S, and a two-level undo (Cmd+Z) reverts the most recent contract edit before commit — protects demo recording from accidental keystrokes

### Data Layer

- [x] **DATA-01**: Contracts persist as `.contracts/<uuid>.md` sidecar files with YAML frontmatter: `format_version`, `uuid`, `kind`, `level`, `parent`, `neighbors`, `code_ranges` (list of `{file, start_line, end_line}` — supports fragment coverage and single-line atoms), `code_hash` (source hash at last derivation), `contract_hash` (hash of contract body text), `human_pinned` (boolean, DERIVE-03), `route` (for INSP-02 live preview of UI surfaces), `derived_at`. **Extended in Phase 8 (`format_version: 3`)** with propagation fields (PROP-01/PROP-02): `section_hashes` (map of v2 section → sha256, all levels), and on L1/L2/L3 only: `rollup_inputs` (list of `{child_uuid, sections[]}`), `rollup_hash` (sha256 over cited child section_hashes), `rollup_state` (`fresh | stale | untracked`), `rollup_generation` (u64 monotonic counter). L0 omits the four `rollup_*` fields.
- [x] **DATA-02**: On startup, the app scans `.contracts/` and populates a SQLite cache (`nodes`, `edges`, `node_flows` for lens membership, `drift_state`, `receipts`, `receipt_nodes` join)
- [x] **DATA-03**: A file watcher keeps the SQLite cache in sync as sidecar files change on disk
- [x] **DATA-04**: Node identity is stable under rename/move — sidecar UUID is canonical, filename and `code_ranges.file` are metadata
- [x] **DATA-05**: Canonical + reference model — shared nodes have one sidecar (`is_canonical=1`); ghost references are SQLite-only rows linked by `canonical_uuid`, regenerated from `node_flows` membership on rebuild
- [x] **DATA-06**: Phase 1 migrations create all required indexes (`idx_nodes_parent_uuid`, `idx_node_flows_flow`, `idx_receipts_node_uuid`) and FTS5 virtual table for intent search; schema changes after Phase 1 ship as numbered `tauri-plugin-sql` migration files (no manual DB deletions during parallel development)

### Graph Canvas

> **Note (2026-04-24 redesign):** GRAPH-01 through GRAPH-05 were satisfied by Phase 3's abstract-zoom rendering shipped 2026-04-24. The 2026-04-24 visual model lock supersedes that visual treatment with vertical-flow-chain rendering (see CARD-/CHIP-/CHAIN-/SIDEBAR- below). The L0–L4 data model encoded in these requirements is preserved unchanged; only the visual representation changes. Phase 3's react-flow infrastructure, virtualization, Cmd+K palette, and CVA encoding pattern carry forward to Phase 13's new node renderers.

- [x] **GRAPH-01**: ~~User sees a zoomable five-level contract graph (L0 Product → L1 Flows → L2 Surfaces → L3 Components → L4 Atoms) rendered with `@xyflow/react`~~ — *visual treatment superseded 2026-04-24*; data model (L0–L4 in frontmatter, react-flow infra) preserved. Replaced by CHAIN-01 (L2 vertical chain) + CARD-01/02 (L3 trigger card) + CHIP-01 (L4 atom chip) + SIDEBAR-01 (L0/L1)
- [x] **GRAPH-02**: ~~User zooms into a flow and child nodes reveal with smooth transitions; breadcrumb reflects current zoom position~~ — *visual treatment superseded 2026-04-24*; navigation is now `⌘P` selecting a flow → lands at L2 view, selecting an atom → lands at L3 view with chip auto-focused. Replaced by SUB-08 (Cmd+P by intent, flow-aware landing)
- [x] **GRAPH-03**: Graph renders performantly with virtualization (`onlyRenderVisibleElements`) for 500+ nodes — **preserved**; carries forward to Phase 13's new renderers
- [x] **GRAPH-04**: Node visually encodes kind (UI / API / data / job), state (healthy / drifted / untested), and canonical vs ghost reference — **preserved at data-model level**; visual treatment migrated to chips (UI mode) and cards (backend mode) in Phase 13. Substrate-state coloring (fresh/stale/superseded/intent-drifted) added by CHIP-03
- [x] **GRAPH-05**: ~~User filters the graph by lens — Journey (default, fully working), System and Ownership (at least toggleable, even if mocked)~~ — *vestigial under new model 2026-04-24*; lenses don't apply to vertical flow chains. Lens switcher removed in Phase 13; lens membership in `node_flows` SQLite table preserved for v2 (LENS-01/02/03 in v2 requirements)

### Inspector

- [ ] **INSP-01**: Clicking a graph node opens the inspector with tabs (Contract / Code / Preview / Receipts); the Code tab renders Monaco read-only scoped to the node's `code_ranges`, with surrounding context dimmed and expandable (GitHub-diff-style expand handles), so manual inspection of exactly what a node covers is unambiguous
- [x] **INSP-02**: Inspector shows a live localhost preview for UI-surface nodes when a dev server is running at the node's `route`; shows a "Start dev server" prompt when unreachable
- [x] **INSP-03**: User edits the contract directly in the inspector; edits are the primary interaction for cherrypick changes
- [x] **INSP-04**: Inspector shows drift status (contract vs. code hash divergence) with a visible reconcile affordance
- [x] **INSP-05**: Inspector Code tab exposes `[⌘R Reveal in Finder]` and `[⌘O Open in External Editor]` actions so users can manually edit the underlying file when the agent can't (or shouldn't) — deliberate escape hatch for v1 without rebuilding full in-app editing

### MCP Integration

- [x] **MCP-01**: A TypeScript MCP server packaged as a Tauri sidecar exposes `find_by_intent`, `get_contract`, `list_drifted_nodes`, and `update_contract` tools over stdio
- [ ] **MCP-02**: A PostToolUse hook re-derives contracts for files modified by the agent and flags drift if code diverges from contract.
- [ ] **MCP-03**: MCP sidecar reads the SQLite cache via a read-only `better-sqlite3` connection (single-writer rule upheld by Rust backend)

### Derivation

- [x] **DERIVE-01**: When a new repo is opened or a new file appears, the app runs an LLM-backed derivation to produce a natural-language contract per node (batched by file, hash-skipped if unchanged, lazy for unseen zoom levels)
- [x] **DERIVE-02**: Derivation stores `code_hash` and `contract_hash` on each sidecar for drift detection
- [x] **DERIVE-03**: User can manually edit a contract; the app pins it and never overwrites human-authored text on re-derivation

### Agent Loop & Receipts

- [x] **AGENT-01**: User types an intent in the chat panel; the app runs `claude` CLI with a prompt assembled from the currently-zoomed node + its contract + its neighbors' contracts (not whole-repo grep)
- [x] **AGENT-02**: App parses `claude` session JSONL defensively into receipt cards (tokens, time, tool calls, nodes touched, prompt size) with a mock fallback if parsing fails
- [x] **AGENT-03**: Receipt cards persist per node and are retrievable from the inspector's receipt history
- [x] **AGENT-04**: User pins two receipt cards side-by-side for benchmarking; comparison view leads with a full-width delta banner (`−82% tokens   −83% tool calls   −85% wall time`) in 28px+ high-contrast type as the dominant visual element, with raw numbers secondary — designed to survive muted playback in the demo video

### Cherrypick Flow

- [x] **CHRY-01**: User locates a target node by typing intent in chat or clicking a graph node; a ring glow bridges graph selection to inspector focus, and the target remains visually highlighted before any change
- [x] **CHRY-02**: User edits contract in inspector → agent produces code patch scoped to that node → side-by-side diff view shows contract diff + code diff (+ preview diff for UI nodes) with a persistent orientation header (`NodeName — intent phrase — N tool calls`) above all three diff panes
- [x] **CHRY-03**: User approves both diffs in one action; sidecar and source files are written atomically (temp + rename) via a single Rust IPC command (no sequence of frontend calls)

### Mass Semantic Edit

- [x] **MASS-01**: User enters an intent that matches multiple nodes; matching runs via hybrid SQLite FTS5 (over contract body) + embedding similarity (over contract intent summaries precomputed at derivation time), with keyword-only fallback if embeddings unavailable; matched nodes pulse with amber ring staggered 50ms apart (not simultaneous flash) so it reads as systematic search, not a crash
- [x] **MASS-02**: Agent produces per-node patches queued in a single review; user scrubs through diffs and approves all at once or selectively

### Drift Detection

- [x] **DRIFT-01**: When code changes without matching contract update (or vice versa), the affected node pulses red in the graph
- [x] **DRIFT-02**: User clicks a drifted node → reconcile panel offers: update contract to match code, rewrite code to match contract, or mark acknowledged

### Cross-Level Propagation (Phase 8 — see `.planning/research/contract-form/PROPAGATION.md`)

- [x] **PROP-01**: Section-level hashes are computed by a canonical Rust section parser (`src-tauri/src/sidecar/section_parser.rs` — fenced-code-aware, order-stable, rejects duplicate headings) and persisted on every `write_derived_contract` / `update_contract`. MCP sidecar calls the parser via IPC rather than maintaining a parallel TypeScript implementation. Migration to `format_version: 3` is lazy (on first write, not bulk) to avoid a bootstrap write storm on large seeded repos
- [x] **PROP-02**: Cache rebuild recomputes `rollup_state` for every L1/L2/L3 node on startup, file-watcher events, and post-write. `fresh` when stored `rollup_hash` matches recomputed; `stale` on mismatch; `untracked` when `rollup_inputs: []`. Graph renders distinct visuals — red (code drift, existing), amber (rollup stale, new), gray (rollup untracked, new) — with precedence red > amber > gray when conditions overlap. L0 is exempt from rollup mechanics (fields absent from schema)
- [ ] **PROP-03**: PostToolUse hook appends one JSONL line per edit to `.contracts/journal/<session-id>.jsonl` (committed to git; one file per session eliminates cross-branch merge-ordering ambiguity). The `intent` field is extracted by reading the latest user prompt from `$CLAUDE_TRANSCRIPT_PATH`; fallback to a thin tool_use summary for headless `-p` invocations. Each entry carries a `schema_version` for format evolution. Hook does **not** prompt the session for rollup review; it journals and is silent
- [ ] **PROP-04**: Rollup-stale node opens a pin-aware reconcile panel. Unpinned path: "Draft propagation for review" (spawns Claude call; force-shows proposed diff before commit; renamed from "Propagate from children" per literature red-team Jin & Chen 2026 / Stengg 2025) / "Accept as-is" (L1 requires one-line justification persisted to journal) / "Edit manually." Pinned path: "Review children's changes" (read-only diff of cited sections that drifted since last `rollup_generation`) / "Unpin and reconcile" (two-step, user unpins first) / "Accept as-is, keep pin" (with justification). `SKIPPED-PINNED` is unreachable — the branching fires before any writer is called. `propose_rollup_reconciliation(upstream_uuid)` MCP tool is callable from an active Claude Code session; `accept_rollup_as_is(uuid, justification?)` narrow Rust IPC touches only the rollup fields (bypasses full YAML round-trip to avoid `contract_hash` perturbation); `get_contract` / `find_by_intent` annotate responses with staleness when `rollup_state ≠ fresh`. `rollup_generation` is the concurrency primitive — second-to-commit sees generation advance and must refresh

### Conflict / Supersession Engine (Phase 12 — see `.planning/research/intent-supersession/` and `.planning/phases/12-conflict-supersession-engine/12-RESEARCH.md`)

- [x] **SUB-06**: Fact-level supersession (Graphiti pattern) — when the distiller ingests a substrate node that contradicts an existing one (judged by the LLM-backed invalidation prompt against FTS5-shortlisted candidates, top-K=10), the system invalidates the stale node by setting `invalid_at = new.valid_at` and `expired_at = utc_now()` rather than deleting it; emits a `substrate_edges` row with `edge_type = 'supersedes'` from new → stale; sets `substrate_nodes.invalidated_by = new.uuid`. Current-truth queries filter via `WHERE invalid_at IS NULL` (partial index `idx_substrate_nodes_active`). History queries return both nodes ordered by `valid_at` ASC. Adversarial regression harness against the 5-fixture set in `.planning/research/intent-supersession/fixtures.json` (extended with 5 fact-level contradiction pairs) achieves recall ≥ 80% and precision ≥ 85%; gated by `CI_LLM_LIVE=1` env flag in `cargo test`. Per-UUID Tokio Mutex via `DriftLocks` (Phase 7) serializes writes; lock-acquisition order is lexicographic-UUID-first to prevent deadlock when locking new + stale together. RFC3339 UTC timestamps everywhere (`chrono::Utc::now().to_rfc3339()`) — Graphiti issue #893 is the timezone-naive footgun. **Status: Phase 12 Plan 01 landed schema foundation (migration v7); fact engine in 12-02 closes this requirement.**
- [x] **SUB-07**: Intent-level supersession (the moat) — when an L0 contract priority shift is recorded via `record_priority_shift(old_l0_uuid, new_l0_uuid, valid_at)`, every transitively rollup-linked decision substrate node (descendants of the new L0 contract via `rollup_inputs` edges from Phase 8 PROP-02, walked DOWN with depth ≤ 5, edge-type filter `rollup_inputs` + `derived-from-contract`) is judged for intent drift via the validated prompt at `.planning/research/intent-supersession/prompt.md`. The judge returns a three-way verdict (`DRIFTED` | `NOT_DRIFTED` | `NEEDS_HUMAN_REVIEW`) with confidence 0.0–1.0. Confidence ≥ 0.85 → auto-applied (`intent_drift_verdicts.auto_applied = 1`); 0.50–0.85 OR `NEEDS_HUMAN_REVIEW` → surfaced for review; < 0.50 → filtered as noise. A "priority-shift impact preview" gate runs a DRY-RUN judge on a sample of 10 descendants and shows "N nodes will flip" before the user confirms full apply (load-bearing safeguard per `evaluation.md` failure mode 5). The validated prompt is codified verbatim — variations risk losing the "focus on the DECISION, not the rationale" instruction that prevented adversarial keyword false positives (d7 pnpm, d9 ENV flags). Adversarial harness reproduces the 9/10 baseline against the 10-decision evaluation fixture; `cargo test` gated by `CI_LLM_LIVE=1`. Reuses Phase 8 PROP-02 `compute_rollup_and_emit` machinery — same DAG, same `DriftLocks`, traversed in reverse via `rollup_inputs` edges. Verdicts persist to `intent_drift_verdicts` table (full audit trail) AND `substrate_nodes.intent_drift_state` (latest verdict). Emits `substrate:intent_drift_changed` Tauri event for Phase 13 to consume. v1 stops at depth-1 from priority shift (no transitive cascade through already-flagged decisions — v2.5 per `evaluation.md` failure mode 3). **Status: Phase 12 Plan 01 landed schema foundation (migration v7) + canonical text + supersession::types module; intent engine in 12-03 closes this requirement.**

### Non-Coder Mode

- [x] **NONC-01**: "Copy Mode" is a top-level pill button in the left sidebar (separate from the lens switcher) that filters the graph to L4 atoms (copy strings, color tokens, simple text content); clicking an atom opens a simplified inspector view with no JSX, no code tab visible, and a plain-text editor — non-technical users edit and approve without ever seeing source code

### Demo Seeding

- [x] **DEMO-01**: `contract-ide-demo` repo (custom Next.js + Auth + Prisma + Stripe + Mailchimp scaffold) ships with the delete-account scenario per `.planning/demo/scenario-criteria.md` § Committed Scenario — planted `DangerActionButton`, `app/account/settings/page.tsx` + `app/team/[slug]/settings/page.tsx` scaffolds without delete buttons, `User`/`Workspace`/`Invoice`/`OrgInvoice` Prisma models, and ~20 ambient L1–L4 contracts plus the specific delete-account contracts (Account Settings L3 + DangerZone L4, Team Settings L3 + TeamDangerZone L4) committed to a seed directory. (`vercel/commerce` was the v1 target; superseded 2026-04-24 by the scenario re-lock.)
- [x] **DEMO-02**: The four scripted demo beats per `.planning/demo/presentation-script.md` are reproducible end-to-end: PM contract trigger (Beat 1), recorded constraint-injection comparison (Beat 2), developer review with orange-flag supersession (Beat 3), closed-loop workspace-delete with harvest-back of two new substrate rules (Beat 4) — each backed by a SQLite reset fixture (5 seeded substrate rules + parent-surface no-modal-interrupts constraint + Q4-2025→2026-04-24 priority-shift record) restorable in one `git checkout` + one SQLite swap, reproducible 5 times in a row before filming
- [x] **DEMO-03**: Bare-Claude baseline receipts are recorded and committed under reproducible conditions (same model, same repo commit, no MCP, no CLAUDE.md) for both demo prompts — `add a delete-account button to the account settings page` and `add a delete-workspace button to the team settings page` — captured *before* substrate seeding so context cannot leak; token + tool-call deltas verified favorable against the Contract IDE side
- [x] **DEMO-04**: 4-beat live demo runs end-to-end 3 times in a row clean before filming, including all four beats (PM trigger / recorded comparison / developer review with implicit-decisions group + orange flag / closed-loop workspace-delete with harvest-back including a promoted-from-implicit rule). Per-beat acceptance criteria all pass on each of the 3 runs; total runtime is 4:00 ± 5s; reset script (`contract-ide/demo/reset-demo.sh`) restores deterministic state in <10s; `runbook-v2.md` and `live-scenario.md` aligned to the locked 4-beat two-laptop structure

### Visual Model — Vertical Flow Chain (Phase 13, added 2026-04-24)

The 2026-04-24 visual model lock supersedes Phase 3's abstract-zoom treatment with a vertical participant chain on canvas. The canvas surfaces L2 (flow chain) and L3 (trigger card) with L4 atom chips on top; L0/L1 collapse to a sidebar. Two L3 render modes: UI (rendered iframe + chip overlays) and backend (Stripe-API-docs-style structured cards).

- [ ] **CARD-01** (UI mode L3 — ScreenCard): Trigger view for `kind: UI` flows renders the live iframe at the screen's `route` with absolutely-positioned overlay chips on each atomic component. Chips live in the parent (Tauri WebView) layer, not inside the iframe — sidesteps cross-origin and pan/zoom interference. Chip positions snap to component bounding rects via `getBoundingClientRect`; positions update on iframe `load` and `resize`. State picker toolbar exposes fixture states (`empty | loaded | error | logged-out | admin`) for testing conditional content. (Phase 13) — *Implementation 2026-04-25 via plan 13-05 (commits d66cbc9, 4089fda): ScreenCard react-flow node + AtomChipOverlay parent-layer overlay + requestChipRects same-origin-direct + postMessage-fallback helper + screenCard nodeTypes registration (additive append after 13-04 serviceCard); 13 vitest cases pass; tsc clean; vite build succeeds. Visual end-to-end verification DEFERRED to plan 13-06 by user direction — natural test surface via FlowChainLayout (ScreenCard at top + ServiceCards below in flow.members order). State picker toolbar (fixture states empty/loaded/error/logged-out/admin) is plan 13-06+ scope (out of 13-05 isolation). Full completion gates on 13-06 visual verification + 13-10b section-bottom fallback wiring.*
- [x] **CARD-02** (Backend mode L3 — EndpointCard / ServiceCard): Trigger view for backend kinds (`API / job / cron / event / lib / external / data`) renders a structured card showing request schema, response schemas, side-effects list, and atom chips on the side. Method-colored badges (POST green, GET blue, PUT orange, PATCH yellow, DELETE red); method+path in monospace; schemas syntax-highlighted JSON. Card body content is driven directly by the contract's `## Inputs` / `## Outputs` / `## Side effects` sections (BACKEND-FM-01) — no parallel data path. (Phase 13)
- [x] **CARD-03** (Backend trigger types beyond HTTP): Render mode adapts by trigger `kind` — CLI command card (terminal frame with `$ tool subcommand --flag` + flag/argument schemas); cron schedule card (`cron: 0 * * * *  →  handler`); webhook event card (`event: stripe.customer.subscription.deleted`); GraphQL resolver schema card; gRPC RPC method/proto card; library function syntax-highlighted signature card. Each is a variant of CARD-02's structured rendering with a kind-specific header. (Phase 13)
- [ ] **CHIP-01** (Atom chip — UI mode): For each L4 atom whose `code_ranges` point into the screen rendered by CARD-01, an overlay chip is positioned over the matched JSX element (resolved via BABEL-01 `data-contract-uuid` injection). Chip shows: atom name (collapsed), decision count, drift/rollup-state indicator. Hover lights chip; click opens atom inspector. (Phase 13) — *Implementation 2026-04-25 via plan 13-05 (commits d66cbc9, 4089fda): AtomChip component with state-keyed CVA matching plan 13-01 NodeVisualState exactly (drifted / intent_drifted / rollup_stale / rollup_untracked / superseded / healthy) + focused halo when uuid matches `useGraphStore.focusedAtomUuid` (set by Cmd+P L4 atom-hit landing per plan 13-03); canonical `selectNode` + `setFocusedAtomUuid` typed actions per checker N7 (NEVER setSelectedNode, NEVER raw setState). data-atom-uuid + data-state DOM attributes mirror plan 13-04 ServiceCardChips for plan 13-07 citation halo selector compatibility. Empty-element fallback (atom contract exists but JSX has no `data-contract-uuid` yet) renders nothing in 13-05 — section-bottom placement deferred to plan 13-10b once seeded fixture exists. Visual verification DEFERRED to plan 13-06 by user direction. Phase 9 BABEL-01 dependency surfaces as Phase 9 contract gap to plan 13-11 rehearsal if iframe content lacks `data-contract-uuid` annotations on the Beat 1 surface.*
- [x] **CHIP-02** (Atom chip — Backend mode): For each L4 atom anchored to a backend participant, a chip renders beside the EndpointCard / ServiceCard (CARD-02). Same hover/click semantics as CHIP-01. (Phase 13)
- [x] **CHIP-03** (Atom chip — substrate state coloring): Chips render substrate-state coloring (`fresh / stale / superseded / intent-drifted`) above the existing code-drift coloring. Precedence red > orange > amber > gray when multiple states apply on the same chip. Reuses Phase 8 PROP-02 amber/gray CVA tokens; orange and red are existing. (Phase 13)
- [ ] **CHAIN-01** (L2 vertical participant chain): A flow's L2 view renders `flow.members` (FLOW-01) top-to-bottom — trigger card at top + participant cards below in invocation order. Layout is deterministic given members order; renders at 50+ fps with 1 iframe + 6–8 service cards. Performance constraint: at most one *live* iframe per canvas (Beat 4's two-flow case shows the unfocused flow's iframe as a screenshot). (Phase 13)
- [ ] **CHAIN-02** (Call-shape edge labels): Edges between consecutive participants in a flow chain render call-shape labels derived from each participant's `## Outputs` (BACKEND-FM-01) → next participant's `## Inputs`. Mismatched / unmappable schemas render as `?` or are omitted; never render garbage. The label teaches the caller's mental model on the way down the chain. (Phase 13)
- [x] **SIDEBAR-01** (Sidebar replacing L0/L1 zoom): Left sidebar renders the repository tree by area; per-area drift / rollup-stale / intent-drifted counts visible as small badges; flows under each area expandable. Replaces the L0/L1 abstract-zoom canvas surface entirely; the canvas no longer renders L0/L1 directly. (Phase 13)
- [x] **BABEL-01** (Babel/SWC plugin in demo repo): A build-time plugin reads `.contracts/*.md` frontmatter for L4 atoms whose `code_ranges` point into the demo repo's `.tsx` files; injects `data-contract-uuid="<uuid>"` onto the matched JSX element. Plugin runs in `next.config.js` (SWC plugin or custom Babel transform); re-runs on every demo-repo build; HMR preserves attribute mapping. Day-1 spike validates the click-resolution chain end-to-end (PM clicks empty Danger Zone → correct UUID resolved → inspector opens). Fallback if Babel proves fragile: bounding-rect chip-overlay layer (chips position via `getBoundingClientRect` query, no DOM injection required). (Phase 9 — Plan 09-04b: Route A custom webpack loader chosen; spike PASSED; commit add5e64 in contract-ide-demo)
- [x] **JSX-01** (JSX-aligned `code_ranges` validator): At IDE startup, an AST-based validator confirms every L4 contract's `code_ranges` covers exactly one JSX element (no partial / multi-element ranges). Violations produce a loud startup error with file path and offending range; the IDE refuses to load the repo until fixed. Constraint exists so BABEL-01's chip-to-atom resolution has unambiguous targets. Backend kinds (`API / lib / data / external / job / cron / event`) are exempt — JSX alignment doesn't apply. (Phase 9)
- [x] **FLOW-01** (Flow contracts): A new `kind: flow` is allowed in contract frontmatter; flow contracts have `members: [trigger_uuid, participant_uuid_1, participant_uuid_2, ...]` ordered by invocation. Trigger's `kind` (UI / API / cron / event / lib) determines L3 render mode. The CHAIN-01 layout reads from `members` to determine participant order. Schema migration folds into Phase 8 PROP-01's `format_version: 3` if PROP-01 is still in flight, else ships as v4 in Phase 9. (Phase 9)
- [x] **BACKEND-FM-01** (Backend frontmatter sections): Every backend participant contract (kinds: `API / lib / data / external / job / cron / event`) carries populated `## Inputs`, `## Outputs`, `## Side effects` sections in the contract body. Sections render as the structured-card body content in CARD-02. Validator: missing required sections on a backend contract = startup error with file path. CHAIN-02 edge labels source from these sections directly. (Phase 9)

### Substrate (Phases 10–13)

- [x] **SUB-01**: Ambient session watcher detects new `~/.claude/projects/<cwd-key>/*.jsonl` files within 2s of first user message; appends a row to a SQLite `sessions` table (Phase 10) — *Complete 2026-04-25 via 10-04 UAT Step 1; SessionWatcher::watch_project (notify::RecommendedWatcher) lands new session rows live; gap-closure FK fix d6f3444 ensures the FK target row precedes child episode INSERTs*
- [x] **SUB-02**: Filter pipeline reduces a 1MB JSONL to <50KB conversational text without losing user/assistant content; episode chunking is idempotent across re-ingestion; opt-in backfill shows per-session token-cost preview before running (Phase 10) — *Complete 2026-04-25 via 10-04 UAT Steps 2/3/4; 5f44 642KB → 9.6KB (94% reduction), efadfcc4 1332KB → 24KB (98% reduction), both well under 50KB ceiling; INSERT OR IGNORE on episode_id PK proven idempotent (2/2 tests pass + UAT touch-replay verification); BackfillModal three-step UX (select → preview → confirm) with structurally-enforced opt-in — executeBackfill called ONLY from Confirm button onClick*
- [x] **SUB-03**: Distiller LLM extracts ≥5 typed nodes (Constraint, Decision, OpenQuestion, ResolvedQuestion, Attempt) per completed session with full provenance (`session_id`, `turn_ref`, `verbatim_quote`, `actor`, `confidence`); kernel-experiment fixture reproduces the 14 hand-extracted constraints (Phase 11)
- [x] **SUB-04**: Contract-anchored retrieval returns top-3 results within ranking on the seeded 50-constraint substrate; `find_constraints_for_goal` scopes candidates by graph edges from contract lineage before semantic match; LLM rerank uses the contract body as grounding (Phase 11)
- [x] **SUB-05**: `Delegate to agent` Inspector button composes prompt with retrieved substrate hits + parent-surface context + lineage-scoped neighbors; dispatches via MCP to a coding agent; replaces chat-panel-as-prompt-entry for contract-driven work (Phase 11; demo-load-bearing for Beat 1 → Beat 2 transition)
- [x] **SUB-08**: Substrate UI surface — Cmd+P by intent (semantic match across all substrate node types **including flows**, ≥80% top-1 precision on 10 ambient queries; selecting a flow lands at L2 view per CHAIN-01, selecting an atom lands at L3 view with its chip auto-focused per CHIP-01/02); canvas substrate-state overlay (fresh / stale / superseded / intent-drifted **renders on screen cards / service cards / atom chips per CHIP-03**, precedence red > orange > amber > gray, ≥50fps on a chain with 1 iframe + 6–8 service cards); chat archaeology (`[source]` click on substrate node opens verbatim quote within ≤5s; **citation click in Beat 3 sidebar additionally halos the corresponding service card / chip**) (Phase 13) — *Partial 2026-04-25: Cmd+P navigation surface SHIPS (plan 13-03, commits c46841b/49734f2/2ad13e4) — IPC unifies nodes_fts + substrate_nodes_fts with BM25 normalisation; per-kind handler routes flow→L2 / L4 atom→L3+chip-halo / contract→pushParent / substrate→Inspector; shouldFilter={false} on cmdk Command.Dialog so IPC ranking is authoritative. Substrate-state overlay landed in plan 13-01 + 13-04. ≥80% top-1 precision SC GATES on plan 13-10b UAT (test fixture + harness ship today; substrate seed in plan 13-10a). Chat archaeology gates on plan 13-07.*
- [x] **SUB-09**: PR-review intent-drift mode — paste raw unified diff, **canvas colors affected screen cards / service cards / atom chips** (intent-drifted highlighted distinctly); explanation sidebar reads in ≤30s on camera; **mocked Sync affordance triggers blast-radius animation against pre-loaded substrate state — trigger card pulses, service cards pulse in invocation order down the chain** (real multi-machine sync deferred to v3) (Phase 13)
- [x] **SUB-10**: Constraint-injection demo beat measures Contract IDE vs bare Claude on the locked Beat 2 prompt — Contract IDE retrieves all 5 substrate rules, writes a 5-file change first try; bare Claude defaults to `db.user.delete()` and 0/5 rules; receipt comparison shows favorable token + tool-call delta in stacked-absolute format (`Contract IDE: ~N tokens · ~N tool calls · 5/5 rules`) (Phase 11 demo-required slice)

### Substrate Trust Surface (Phase 15 — added 2026-04-25)

Closes the predictable judge attack on hallucination by giving humans a direct, demoable path to inspect and correct any rule. Architecture: chained immutable versions (`prev_version_uuid` chain on `substrate_nodes`) preserves Phase 12's "facts at time T" model.

- [x] **TRUST-01**: User opens Cmd+P, selects the new `Substrate` filter chip (alongside existing `Contracts` / `Code`), types a free-form rationale question (e.g., `"why email confirmation"`), and gets ranked substrate hits across `verbatim_quote` + `summary` + `applies_when` via FTS5 + DeepSeek listwise rerank (reusing the Phase 11 retrieval primitive). Selecting a hit opens the existing `SourceArchaeologyModal` in <2s end-to-end (keystroke → readable verbatim quote rendered).
- [x] **TRUST-02**: User clicks `Refine` in `SourceArchaeologyModal` to edit a rule's `text` and `applies_when` with a required reason. Save creates a new `substrate_nodes` row with `prev_version_uuid` pointing to the previous row; the previous row's `invalid_at` is set to now with `invalidated_reason = 'refined: <reason>'`. Modal `History` tab walks the chain via `prev_version_uuid` and renders each version with a diff against the prior. Phase 12 supersession queries continue to read current rows via `WHERE invalid_at IS NULL` without modification.
- [x] **TRUST-03**: User clicks `Delete this rule` in `SourceArchaeologyModal`. Confirm dialog requires (a) reason picker as a radio: `Hallucinated · Obsolete · Wrong scope · Duplicate · Other`; (b) free-text amplification (required when `Other`); (c) auto-loaded impact preview showing atoms citing the rule + recent prompts (past 7 days) including it. Confirm sets `invalid_at = now`, `invalidated_reason = '<picker>: <text>'`, `invalidated_by = 'human:<email>'`. Tombstone preserved indefinitely. New `Substrate Health` sidebar surface lists tombstoned rules with a `Restore` action that clears `invalid_at` and writes a `restore` audit row. No time limit on restore.
- [x] **TRUST-04**: A new `substrate_edits` audit table captures every refine / delete / restore: `{edit_id, rule_uuid, prev_version_uuid, new_version_uuid, actor, edited_at, before_text, after_text, reason, kind ∈ {refine, delete, restore}}`. Audit row is written atomically with the substrate-node version write (single Rust IPC, single SQLite transaction). Audit table survives `reset-demo.sh`.

---

## v2 Requirements

Deferred beyond hackathon demo. Tracked but not in current roadmap.

### Collaboration

- **COLL-01**: Cloud sync of contracts across machines
- **COLL-02**: Multi-user collaboration / comments on contracts
- **COLL-03**: Shared benchmark library

### Platform Reach

- **PLAT-01**: Linux and Windows Tauri targets
- **PLAT-02**: Multi-provider agent abstraction (OpenAI, Gemini, local models)
- **PLAT-03**: Browser-hosted version of the graph canvas

### Authoritative Contracts

- **AUTH-01**: Contracts become the source of truth; code is generated from contracts on demand
- **AUTH-02**: Property test generation from contract invariants
- **AUTH-03**: CI integration that blocks PRs whose code changes lack matching contract changes

### Deeper IDE

- **IDE-01**: Full code editing in Monaco (not read-only inspector)
- **IDE-02**: File tree fallback for power users
- **IDE-03**: Integrated terminal
- **IDE-04**: Git UI inside the app
- **IDE-05**: Settings/theming UI

### Additional Lenses

- **LENS-01**: Fully working System lens (client/server/data/external projection)
- **LENS-02**: Fully working Ownership lens (team/module projection)
- **LENS-03**: Custom user-defined lenses

### Agent Power

- **AGP-01**: Multi-agent orchestration view (watch 2–3 agents work different subgraphs live)
- **AGP-02**: Automated drift sweeper background agent
- **AGP-03**: Contract-aware property test generation

---

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Native SwiftUI app | Graph viz + Monaco + chat UX mature in web; single-language stack across frontend and MCP; Tauri delivers native feel |
| Rebuilding Claude Code's agent harness | We shell out to `claude` CLI; Contract IDE is the visual layer over Claude Code, not a replacement |
| Traditional file tree in primary UI | Intentional omission — `⌘P` semantic search is the navigation; users can fall back to OS-level tools (per 2026-04-24 visual model lock; see `CANVAS-PURPOSE.md`) |
| Cloud sync / multi-user collab | Single-user local-first MVP |
| Non-macOS platforms for v1 | Tauri makes cross-platform cheap later; not doing it now |
| Code generation from scratch / scaffolding | Contract IDE operates on existing repos |
| Authoritative contracts | v1 ships derived + version-controlled contracts; authoritative is the long-term vision |
| Skills-based Claude Code integration | MCP + one PostToolUse hook only for MVP |
| Multi-provider agent abstraction | Claude Code only |
| Real-time multi-agent view | Stretch goal; defer to v2 |

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SHELL-01 | Phase 1 | Complete |
| SHELL-04 | Phase 1 | Complete |
| SHELL-05 | Phase 1 | Complete |
| SHELL-02 | Phase 2 | Complete |
| DATA-01 | Phase 2 | Complete |
| DATA-02 | Phase 2 | Complete |
| DATA-03 | Phase 2 | Complete |
| DATA-04 | Phase 2 | Complete |
| DATA-05 | Phase 3 | Complete |
| DATA-06 | Phase 1 | Complete |
| GRAPH-01 | Phase 3 | Complete |
| GRAPH-02 | Phase 3 | Complete |
| GRAPH-03 | Phase 3 | Complete |
| GRAPH-04 | Phase 3 | Complete |
| GRAPH-05 | Phase 3 | Complete |
| SHELL-03 | Phase 3 | Complete |
| INSP-01 | Phase 4 | Pending |
| INSP-02 | Phase 4 | Complete |
| INSP-03 | Phase 4 | Complete |
| INSP-04 | Phase 4 | Complete |
| INSP-05 | Phase 4 | Complete |
| MCP-01 | Phase 5 | Complete |
| MCP-03 | Phase 5 | Pending |
| DERIVE-01 | Phase 6 (MCP-driven) | Complete |
| DERIVE-02 | Phase 6 (MCP-driven) | Complete |
| DERIVE-03 | Phase 6 (MCP-driven) | Complete |
| DRIFT-01 | Phase 7 | Complete |
| DRIFT-02 | Phase 7 | Complete |
| PROP-01 | Phase 8 | Complete |
| PROP-02 | Phase 8 | Complete |
| PROP-03 | Phase 8 | Pending |
| PROP-04 | Phase 8 | Pending |
| MCP-02 | Phase 8 | Pending |
| AGENT-01 | Phase 8 | Complete |
| AGENT-02 | Phase 8 | Complete |
| AGENT-03 | Phase 8 | Complete |
| AGENT-04 | Phase 8 | Complete |
| CHRY-01 | Phase 8 | Complete |
| CHRY-02 | Phase 8 | Complete |
| CHRY-03 | Phase 8 | Complete |
| MASS-01 | Phase 9 | Complete |
| MASS-02 | Phase 9 | Complete |
| NONC-01 | Phase 9 | Complete |
| DEMO-01 | Phase 9 | Complete |
| DEMO-02 | Phase 9 | Complete |
| DEMO-03 | Phase 9 | Complete |
| BABEL-01 | Phase 9 | Complete |
| JSX-01 | Phase 9 | Complete |
| FLOW-01 | Phase 9 | Complete |
| BACKEND-FM-01 | Phase 9 | Complete |
| DEMO-04 | Phase 13 | In Progress (13-10a data layer + 13-10b UI orchestration shipped 2026-04-25 — fixtures + IPCs + DemoOrchestrationPanel; full completion gates on 13-11 rehearsal validation: 3x end-to-end + cmdp-precision ≥8/10 + reset-script <10s) |
| CARD-01 | Phase 13 | Complete (visual verification approved 2026-04-25 via plan 13-06 FlowChainLayout integration — ScreenCard mounts at top of vertical chain, iframe + atom chips render against running demo build) |
| CARD-02 | Phase 13 | Complete |
| CARD-03 | Phase 13 | Complete |
| CHIP-01 | Phase 13 | Complete (visual verification approved 2026-04-25 via plan 13-06 — AtomChip + state-keyed CVA + focused halo verified end-to-end against demo build with BABEL-01 `data-contract-uuid` annotations; cross-origin postMessage protocol with requestId nonce + 500ms timeout shipped) |
| CHIP-02 | Phase 13 | Complete |
| CHIP-03 | Phase 13 | Complete |
| CHAIN-01 | Phase 13 | Complete (assembleFlowChain pure function + FlowChainLayout shipped 2026-04-25 plan 13-06; deterministic vertical chain with screenCard-vs-serviceCard kind dispatch; user verified) |
| CHAIN-02 | Phase 13 | Complete (CallShapeEdge + deriveCallShape shipped 2026-04-25 plan 13-06; matched-keys label vs `?` muted fallback; user verified) |
| SIDEBAR-01 | Phase 13 | Complete |
| SUB-01 | Phase 10 | Complete |
| SUB-02 | Phase 10 | Complete |
| SUB-03 | Phase 11 | Complete |
| SUB-04 | Phase 11 | Complete |
| SUB-05 | Phase 11 | Complete |
| SUB-06 | Phase 12 | Complete |
| SUB-07 | Phase 12 | Complete |
| SUB-08 | Phase 13 | In Progress (Cmd+P navigation + state overlay shipped 13-01/03/04; chat archaeology shipped 13-07; verifier panel + implicit-decisions group + harvest panel + promoted-from-implicit badge shipped 13-09; precision SC + visual verification gate on 13-10b UAT with fixture-loaded uuids) |
| SUB-09 | Phase 13 | In Progress (PR-review intent-drift mode shipped 13-08; mocked-Sync clause — SyncButton + animateSyncBlastRadius + trigger_sync_animation IPC with placeholder uuids — shipped 13-09; full completion gates on 13-10b real-fixture verification of chain-pulse fidelity) |
| SUB-10 | Phase 11 | Complete |

**Coverage:**
- v1 requirements: 70 total (46 base + DEMO-04 + 10 SUB-* added 2026-04-24 for Phase 10–13 planning + 13 added 2026-04-25 for visual model lock: 4 in Phase 9 (BABEL-01, JSX-01, FLOW-01, BACKEND-FM-01) + 9 in Phase 13 (CARD-01/02/03, CHIP-01/02/03, CHAIN-01/02, SIDEBAR-01))
- Mapped to phases: 70
- Unmapped: 0
- GRAPH-01, GRAPH-02, GRAPH-05 visual treatment superseded 2026-04-24 (data model preserved, replaced visually by CARD-/CHIP-/CHAIN-/SIDEBAR- families); GRAPH-03, GRAPH-04 preserved

---
*Requirements defined: 2026-04-24*
*Last updated: 2026-04-25 (continued, plan 13-09 close) — SUB-09 walked back from Complete → In Progress to reflect partial fulfillment of the mocked-Sync clause: SyncButton + animateSyncBlastRadius + trigger_sync_animation Rust IPC ship in plan 13-09 (commits 8c4165d, 83cf126), but the IPC returns placeholder uuids today; plan 13-10b will extend sync.rs to read blast-radius.json with real Phase 9 uuids. Visual verification of chain-pulse fidelity (trigger card pulses first; service cards pulse in invocation order with 50ms stagger) DEFERRED to plan 13-10b's DemoOrchestrationPanel surface by user direction — natural test surface with fixture-loaded uuids. SUB-08 progress: VerifierPanel (6 honors + ImplicitDecisionsGroup of 3 hand-crafted rows + 1 orange flag with 8s halo on parent screen card via useCitationStore.highlight) + HarvestPanel (substrate:nodes-added subscription + 2s poll fallback + [⌃ promoted from implicit] amber badge) + window.__demo.loadBeat3VerifierResults debug helper ship in plan 13-09; visual verification + ≥80% top-1 precision SC continue to gate on plan 13-10b UAT. Previous update 2026-04-25 (continued, plan 13-05 close) — CARD-01 + CHIP-01 walked from Pending → In Progress: ScreenCard + AtomChipOverlay + AtomChip + screenCard nodeTypes registration shipped via plan 13-05 (commits d66cbc9, 4089fda); 13 vitest cases pass; tsc clean; vite build succeeds. Visual end-to-end verification DEFERRED to plan 13-06's checkpoint by user direction — natural test surface via FlowChainLayout (ScreenCard at top + ServiceCards below in flow.members order); custom annotated localhost page for 13-05 isolation alone is wasted scope. State picker toolbar (CARD-01 fixture states) + section-bottom chip fallback (CHIP-01 empty-element case) gate on plan 13-06+13-10b. Phase 9 BABEL-01 dependency surfaces as Phase 9 contract gap to plan 13-11 rehearsal if iframe content lacks `data-contract-uuid` annotations on Beat 1 surface. Previous update 2026-04-25 (continued, plan 13-03 close) — SUB-08 walked back from Complete → In Progress to reflect partial fulfillment: Cmd+P navigation surface (find_substrate_by_intent IPC + IntentPalette + per-kind navigation contract) ships in plan 13-03; substrate-state overlay shipped in plans 13-01 + 13-04; ≥80% top-1 precision SC gates on plan 13-10b UAT (test fixture and harness ship in plan 13-03 today, but the assertion runs against seeded substrate in 13-10b); chat archaeology gates on plan 13-07. The earlier `[x]` was premature relative to the requirement's full SC text. Previous update 2026-04-25 (continued) — Phase 12-01 transcribed canonical SUB-06 (fact-level supersession, Graphiti pattern) and SUB-07 (intent-level supersession, the moat) under new "Conflict / Supersession Engine (Phase 12)" subsection. Previous SUB-06 / SUB-07 stub-form one-liners were collapsed into the new canonical entries (no double-entry; one entry per requirement). Codified from `.planning/phases/12-conflict-supersession-engine/12-RESEARCH.md` table 14–17 and ROADMAP Phase 12 success criteria 1–4. These IDs were referenced in ROADMAP since 2026-04-24 but the canonical text was deferred to this Phase 12 planning pass per RESEARCH.md Q6 recommendation. No new requirements invented; transcription only. Previous update 2026-04-25 after Phase 10 close — SUB-01 + SUB-02 marked Complete (10-04 UAT all four steps PASSED, ZERO Claude API calls confirmed by static grep + user lsof). Previous update 2026-04-25 (visual model lock) added CARD-01..03, CHIP-01..03, CHAIN-01/02, SIDEBAR-01 (Phase 13) + BABEL-01, JSX-01, FLOW-01, BACKEND-FM-01 (Phase 9); annotated GRAPH-01/02/05 visual treatment as superseded (data model preserved); updated SUB-08/SUB-09 to reference new node types; flagged the lens switcher (GRAPH-05) as vestigial under the new model; reframed the "Traditional file tree" Out-of-Scope row to clarify `⌘P` is the navigator. Previous update 2026-04-24 (cross-level propagation research) added PROP-01..04 (Phase 8) and extended DATA-01 with `format_version: 3` rollup fields. Previous update 2026-04-24 added SHELL-05, DATA-06, INSP-05 and expanded DATA-01/INSP-01/MASS-01/CHRY-01/CHRY-02/AGENT-04/NONC-01; MCP-02 moved Phase 5 → Phase 8.*
