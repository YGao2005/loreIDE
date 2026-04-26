# Phase 8: Agent Loop + Receipts + PostToolUse Hook + Cherrypick + Cross-Level Propagation - Research

**Researched:** 2026-04-24
**Domain:** Claude CLI subprocess orchestration · session JSONL parsing · PostToolUse hook journaling · sectioned-markdown propagation · pin-aware reconcile · atomic two-file write
**Confidence:** HIGH on existing-surface inventory, propagation schema, hook payload, JSONL shapes, and cherrypick atomic-write pattern (all verified against shipped Phase 7 code, captured live session JSONL, official Claude Code hooks docs, and the locked PROPAGATION.md / RESEARCH.md decisions). MEDIUM on `tauri-plugin-shell` stream-event API (verified in v2 docs and Tauri discussion #8641; the Rust `CommandEvent::Stdout` API is sound but the project hasn't yet wired stream events — only `output()`/non-streaming usage exists in Phase 5).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Receipt card + delta banner

- **Banner format aligned to Beat 2 recording (absolute stacked, not percentage delta):**
  ```
  Contract IDE: ~N tokens · ~N tool calls · N/5 rules honored
  Bare Claude:  ~N tokens · ~N tool calls · 0/5 rules honored
  ```
  Two rows, monospace numerals, 28px+ for the numerals, slightly smaller for the labels. The original Phase 8 SC 4 spec (`−82% tokens −83% tool calls −85% wall time`) is a **second view** — used for in-IDE pinned-receipt comparisons (developer dogfood). Demo uses the absolute-stacked view.
- "Rules honored" row is a substrate-verifier output (Phase 12/13) but the receipt-card layout must reserve space for it from day one — don't ship a banner that needs re-layout when Phase 13 adds the rubric.
- Receipts persist per node in SQLite `receipts` table with `(node_uuid, session_id, ts, input_tokens, output_tokens, tool_calls, est_cost_usd, raw_jsonl_path)`. Receipt-history tab in inspector shows reverse-chrono list; click two to pin side-by-side.
- Defensive JSONL parser ships as an **isolated module with unit tests against a captured real session**, fixture-mock fallback prevents blank cards.

#### Agent loop dispatch surfaces

- **Two dispatch paths, same runner:**
  1. Chat-panel entry (Phase 8's own surface, scoped to currently-zoomed node + neighbors) — developer dogfood path
  2. Phase 11's `Delegate to agent` Inspector button (composes prompt with substrate hits + lineage neighbors) — **the demo path**
- The runner module (`claude` CLI invocation, JSONL streaming, receipt assembly) must expose a clean Rust API that Phase 11 can call without re-implementation. Plan accordingly: the agent loop is a library + two thin UI surfaces, not a chat-panel-coupled feature.
- Beat 1 dispatches via the Delegate button (Phase 11) — Phase 8's chat panel UX gets shipped but doesn't need demo polish.

#### Cherrypick flow

- Build to functional bar: side-by-side diff modal works, persistent orientation header (`NodeName — intent — N tool calls`) shows correctly, single-IPC atomic approve writes both sidecar and source file via temp+rename.
- **Skip demo-grade polish:** no need for entrance/exit animation choreography, no need for fancy empty/error states beyond functional placeholders. Modal can use shadcn Dialog defaults.
- Target-node ring glow (CHRY-01) ships, but visual treatment is Claude's discretion — pick something that reads as "this is the focus" without competing with red-pulse drift state.

#### Cross-level propagation (PROP-01..04)

- **PROP-01 (schema v3 + section parser): demo-grade.** Section parser must round-trip stable hashes for the two committed fixtures (`11111111-…` API L3, `22222222-…` UI L4). MCP sidecar calls Rust parser via IPC — no parallel TS implementation.
- **PROP-02 (rollup detection + amber/gray visuals): correct, not polished.** Reuse Phase 7's `DriftLocks` mutex map and `SourceWatcher` notify infrastructure. Add `compute_rollup_and_emit` engine fn alongside `compute_and_emit` (do NOT replace). Graph CVA variants extend with `rollup_stale` (amber) + `rollup_untracked` (gray), precedence red > amber > gray. Visual hue choice is Claude's discretion — pick something distinguishable from the red-pulse and from the substrate-state colors Phase 13 will add later (avoid orange — Phase 13 uses orange for `intent_drifted`).
- **PROP-03 (per-session intent journal): demo-load-bearing for Phase 10.** Schema is locked: `{schema_version, ts, session_id, tool, file, affected_uuids, intent}`. Append-only, tolerant of unknown fields, per-session files (one JSONL per `session_id`). Hook calls `update_contract` after journal write; pinned nodes return `SKIPPED-PINNED` and the hook records the intent regardless.
- **PROP-04 (pin-aware reconcile + MCP tools): correct, not polished.** Pin-aware branching fires before any writer is called — `SKIPPED-PINNED` must be unreachable from both UI paths. `propose_rollup_reconciliation` respects pin-aware branching. `accept_rollup_as_is` is a narrow IPC that updates only `rollup_hash`, `rollup_generation`, `rollup_state` — never round-trips the body through YAML. Microcopy for the six action buttons is Claude's discretion; lean on existing shadcn Dialog patterns.

#### PostToolUse hook + watcher coexistence

- Hook and Phase 7 watcher serialize via the same `DriftLocks` per-UUID Tokio mutex — no race on `nodes.code_hash`.
- Hook script reads `$CLAUDE_TRANSCRIPT_PATH`, extracts `intent` from the latest user prompt; falls back to a thin tool_use summary for headless `-p` invocations (e.g., distiller calls in Phase 11).
- Journal write happens **before** `update_contract` call. Even if `update_contract` returns `SKIPPED-PINNED`, the journal entry is preserved — the intent record is useful regardless of the write outcome.

#### Concurrency

- `rollup_generation` is the cross-node concurrency primitive. Reconcile panels read generation at open; canonical writer rejects writes whose generation has advanced; second-to-commit re-reads and retries. No silent last-writer-wins.

### Claude's Discretion

- Visual treatment of amber pulse (specific hue, animation timing, intensity relative to red-pulse)
- Ring-glow visual on target node (color, animation curve, persistence behavior beyond "appears on selection, persists through agent run")
- Cherrypick modal exact layout — header position, diff pane proportions, scroll behavior, collapse/expand of unchanged sections
- Reconcile panel microcopy for the six action variants (three pinned + three unpinned)
- Chat panel UX during agent run — streaming pane position, interrupt affordance design, scoped-context visual cue
- Receipt-history tab interaction — pinning UX, ordering, filtering
- Empty/loading/error states for receipt card, reconcile panel, cherrypick modal beyond functional placeholders
- Cascade UX for the dev-facing L4→L3→L2→L1 click-at-a-time path — whether the graph auto-pans to the next amber node, etc.

### Deferred Ideas (OUT OF SCOPE)

- **Side-by-side delta-percentage receipt comparison view** (`−82% tokens` etc.) — ships in Phase 8 as a secondary view on the receipt-history tab; not on camera in the demo. Functional is fine.
- **Cherrypick demo polish** — entrance/exit animations, fancy empty states, motion design. v2.
- **Cascade reconciliation batch action** ("Reconcile all amber in this dependency chain") — explicitly v2. v1 is click-at-a-time.
- **Real multi-machine `rollup_generation` coordination across replicas** — out of scope; v1 is single-machine. Beat 3's Sync is mocked per Phase 13.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AGENT-01 | Run `claude` CLI scoped to currently-zoomed node + neighbor contracts | tauri-plugin-shell `Command::sidecar` + `spawn()` returning `Receiver<CommandEvent>` (Tauri v2). Prompt assembler reads contract bodies + neighbors via SQLite — section-weighted (`## Examples` last-to-drop per PACT 2025). |
| AGENT-02 | Defensively parse session JSONL into receipt cards (tokens/time/tool calls/nodes touched) with mock fallback | Captured-real-session schema documented below — `assistant.message.usage.{input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens}`, `tool_use` content blocks, `timestamp` ISO-8601. Isolated module with mock-fallback fixture. |
| AGENT-03 | Receipts persist per node, retrievable from inspector receipt history | New SQLite table `receipts` + `receipt_nodes` join (already partially indexed in Phase 1 — `idx_receipts_node_uuid`). |
| AGENT-04 | Pin two receipts side-by-side; comparison leads with delta banner | Two view modes: absolute-stacked (demo, Beat 2 verbatim) + percentage-delta (developer dogfood). |
| CHRY-01 | Target node ring-glow bridges graph→inspector focus, persists pre-edit | New CVA variant `targeted` on contractNodeStyles; coexists with `drifted` (precedence: drifted red beats targeted glow visually). |
| CHRY-02 | Side-by-side diff modal with persistent header (`NodeName — intent — N tool calls`) | shadcn Dialog (already installed Phase 7) + Monaco DiffEditor (already in `vite-plugin-monaco-editor` config). |
| CHRY-03 | Atomic approve via single Rust IPC (sidecar + source file via temp+rename) | New `commands/cherrypick.rs::apply_cherrypick(uuid, contract_body, file_patches)` — temp-write each, fsync, then rename in dependency order (sidecar last so a partial source write leaves the source observable but contract still pointing at old hash → Phase 7 watcher fires drift). |
| MCP-02 | PostToolUse hook re-derives contracts for files modified by agent + flags drift | Hook script (bash or node) reads stdin JSON payload, calls `update_contract` MCP tool. Coexists with Phase 7 `SourceWatcher` via `DriftLocks` per-UUID Tokio mutex. |
| PROP-01 | Section-level hashes via canonical Rust section parser persisted on every write | New `src-tauri/src/sidecar/section_parser.rs` (fenced-code-aware, order-stable, rejects duplicate H2). MCP sidecar calls via Rust IPC. `format_version: 3` lazy migration on first write. |
| PROP-02 | Rollup detection on cache rebuild (startup/watcher/post-write) — fresh/stale/untracked tri-state | New `compute_rollup_and_emit` engine fn beside `compute_and_emit`. New `rollup:changed` Tauri event. Two new Zustand sets `rollupStaleUuids` + `untrackedUuids`. CVA variants `rollup_stale` (amber) + `rollup_untracked` (gray); precedence red > amber > gray decided in CVA selector. |
| PROP-03 | PostToolUse hook appends one JSONL line per edit to `.contracts/journal/<session-id>.jsonl` | Schema locked. Per-session files avoid git merge ordering ambiguity. Reads `$CLAUDE_TRANSCRIPT_PATH` for `intent` extraction. Tolerant of unknown fields (forward-compat for Phase 10 distiller). |
| PROP-04 | Rollup-stale pin-aware reconcile + `propose_rollup_reconciliation` MCP tool + `accept_rollup_as_is` narrow IPC + staleness annotation on `get_contract`/`find_by_intent` | Pin-aware branching fires BEFORE writer call (SKIPPED-PINNED unreachable). New narrow Rust IPC writes only rollup_* fields (no YAML round-trip → no contract_hash perturbation). |
</phase_requirements>

## Summary

Phase 8 is a six-plan phase that lands four independent-but-interlocking workstreams: (1) the **propagation schema + section parser** (PROP-01) which is the foundation for everything else PROP-flavored, (2) the **rollup detection + tri-state graph** (PROP-02) plus pin-aware reconcile (PROP-04), (3) the **PostToolUse hook + per-session journal** (PROP-03 + MCP-02) which feeds Phase 10's distiller, and (4) the **agent loop + receipts** (AGENT-01..04) plus **cherrypick flow** (CHRY-01..03) which together ship Beat 1's substrate. The phase is large but not architecturally novel — every workstream extends shipped Phase 7 machinery (`DriftLocks` Tokio mutex map, `SourceWatcher` notify wrapper, `ReconcilePanel` shadcn Dialog shell, `drifted` CVA variant). The risk is *integration*, not invention.

The agent-loop substrate (`tauri-plugin-shell` spawn → JSONL stream parse → SQLite receipt persistence → React chat panel emit) is the largest single net-new module and the highest-risk piece for the live demo. The defensive JSONL parser must be unit-tested against a captured real session before plan close — otherwise Beat 2's receipt card silently goes blank on stage. The PostToolUse hook script is the smallest piece by line count but has the highest coupling (must coexist with Phase 7 watcher under the same Tokio mutex; must read `$CLAUDE_TRANSCRIPT_PATH`; must tolerate headless `-p` invocations from Phase 11 distiller).

The propagation stack is conservative: section parser is straightforward (200–300 LOC of Rust), rollup detection mirrors `compute_and_emit` byte-for-byte with `rollup_inputs`/`rollup_hash` as the comparison primitives, pin-aware reconcile is a sibling render in the existing `ReconcilePanel`. The schema migration to `format_version: 3` is **lazy on first write** (not bulk on startup) per PROPAGATION.md decision — avoids a bootstrap write storm against the seeded `contract-ide-demo` repo Phase 9 will provision.

**Primary recommendation:** Execute the six plans in this order: 08-01 (schema + parser, foundational) → 08-02 (rollup detection, depends on 08-01) and 08-03 (PostToolUse hook, depends on 08-01) in parallel → 08-04 (agent loop) and 08-05 (cherrypick) in parallel with each other and with 08-02/03 → 08-06 (reconcile panel + MCP tools + E2E UAT, depends on 08-02 + 08-03). Beat 2 receipt format must match `presentation-script.md` line shape verbatim; Beat 1 contract body shape (`## Intent` / `## Role` / `## Examples` with multiple `GIVEN/WHEN/THEN`) must round-trip through the section parser as the acceptance test for PROP-01.

## Standard Stack

### Core (Locked — Already Shipped or Required by Constraint)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `tauri-plugin-shell` | 2.x (already in deps) | Spawn `claude` CLI, stream stdout via `Receiver<CommandEvent>` | Only Tauri-blessed subprocess API; phase 1 already validated `claude -p "say hello"` end-to-end (STATE.md: "Plan 01-04 Pitfall-4 cleared"); Day-1 validation pill confirms env inheritance works under Finder launch |
| `notify` | 7.x via `notify::recommended_watcher` | Existing Phase 7 source watcher; rollup detection reuses callbacks | `RecommendedWatcher` picks FSEvents on macOS automatically; `macos_fsevent` feature already active |
| `tokio::sync::Mutex` via `DriftLocks` | (existing) | Per-UUID serialization across watcher + hook + reconcile writers | Phase 7 shipped `dashmap::DashMap<String, Arc<Mutex<()>>>` — extend with `for_uuid("rollup:" + uuid)` namespacing if rollup needs separate locks (DECISION below: SAME lock keyed on uuid alone — body writes and rollup writes for the same node serialize together) |
| `shadcn Dialog` | (existing — Phase 7 install) | Reconcile panel + cherrypick modal chrome | Already installed; six new action buttons + new branching are sibling renders |
| `@xyflow/react` v12 | (existing) | Add `rollup_stale` + `rollup_untracked` + `targeted` CVA variants | CVA already gates `kind/state/canonical` on the contract node |
| `@monaco-editor/react` + Monaco DiffEditor | (existing) | Cherrypick side-by-side diff pane | Already loaded; DiffEditor is part of standard Monaco bundle, no new install |
| `serde_yaml_ng` | (existing) | YAML frontmatter round-trip; extend with 5 new fields under `format_version: 3` | Already shipped; field-order locked |
| `sqlx` | 0.8 (existing) | Direct dep for `receipts` table writes + read | Already direct dep — Phase 2 added it |
| `sha2` | (existing) | Section hash + rollup hash computation | Already shipped (Phase 6 derivation); same `hash_text` Rust entry point |
| `chrono` | (existing — Phase 7) | ISO-8601 timestamps for journal entries + receipts | Already shipped |
| `pulldown-cmark` (NEW) | 0.13.x | Markdown section parser — H2 heading detection with fenced-code-block awareness | Industry-standard CommonMark parser in Rust; correctly distinguishes `##` inside ` ``` ` fences. Alternative `markdown` crate is also viable but `pulldown-cmark` is more mature and widely used in Rust ecosystem (mdbook, rustdoc internals). |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Bash hook script | n/a | PostToolUse hook entry — reads stdin JSON, writes journal line, calls `update_contract` MCP tool | Per Claude Code hooks docs — hook command receives JSON payload via stdin; stdout is captured but ignored; exit 0 for success. Bash chosen over node because it inherits PATH cleanly under Claude Code's spawn (no node-version-mismatch failure mode). Falls through to node if jq isn't installed. |
| `serde_json` (existing) | 1.x | Receipt JSONL line parsing + journal line emit | Already shipped |
| Existing `commands/contracts.rs::write_contract` Rust IPC | n/a | Cherrypick atomic sidecar write piggybacks on this; new `apply_cherrypick` IPC composes write_contract + source-file write inside one Tokio task | DO NOT add a parallel atomic-write helper |
| Existing `mcp-sidecar` MCP server | n/a | New MCP tools `propose_rollup_reconciliation`, `accept_rollup_as_is` (the latter is a Rust IPC, not MCP — see decision below); staleness annotation on existing `get_contract`/`find_by_intent` | Already running; section_hashes computed via Rust IPC client (NEW — does not exist yet, must be added) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `pulldown-cmark` for section parsing | Hand-rolled regex + line-by-line state machine | Hand-rolled is ~30 LOC less but breaks on fenced blocks containing `## ` lines (the explicit "fenced-code-aware" requirement in PROPAGATION.md). Reject. |
| Bash hook script | Node script | Bash inherits PATH cleanly under spawn; node has version-mismatch failure mode (Plan 01-04 Pitfall 4 lineage). Use bash with `jq` (assume macOS dev machine has jq; fallback path documented as "install jq if missing"). |
| `Receiver<CommandEvent>` for Claude streaming | `Command::output()` non-streaming | `output()` blocks until completion → no streaming chat panel UX. Streaming is required by SC 1 ("agent's streaming output appears in the chat panel in real time"). |
| `accept_rollup_as_is` as MCP tool | Narrow Rust IPC (chosen) | Narrow IPC bypasses YAML serialize round-trip, avoiding `contract_hash` perturbation. Per PROPAGATION.md the body MUST not round-trip — only the four `rollup_*` fields update. MCP tool would force a full ContractFrontmatter serialize. |
| `propose_rollup_reconciliation` as Rust IPC | MCP tool (chosen) | MUST be callable from an active Claude Code session (per spec) — only MCP path enables that. Tool internally calls Rust IPC for the diff-generation primitive but the surface area is MCP. |

**Installation (only the new pieces):**
```toml
# src-tauri/Cargo.toml — append to [dependencies]
pulldown-cmark = "0.13"  # markdown H2 + fenced-code parser
# NO new tauri-plugin needed — shell + sql + fs already shipped
```

```bash
# Add to mcp-sidecar/package.json — already has zod, just declare new tool inputs
# No new npm deps required
```

## Architecture Patterns

### Recommended Project Structure (Net-New Files)

```
contract-ide/
├── src-tauri/src/
│   ├── sidecar/
│   │   ├── frontmatter.rs                # EXTEND — 5 new fields under format_version: 3
│   │   └── section_parser.rs             # NEW — canonical pulldown-cmark wrapper
│   ├── drift/
│   │   ├── engine.rs                     # EXTEND — add compute_rollup_and_emit fn (sibling)
│   │   ├── state.rs                      # KEEP — same DriftLocks, no namespacing change
│   │   └── watcher.rs                    # EXTEND — fire BOTH compute_and_emit and compute_rollup_and_emit
│   ├── commands/
│   │   ├── agent.rs                      # NEW — claude CLI runner, stream events, receipt assembly
│   │   ├── receipts.rs                   # NEW — receipt SQLite read/write IPC
│   │   ├── cherrypick.rs                 # NEW — apply_cherrypick atomic two-file write IPC
│   │   ├── rollup.rs                     # NEW — accept_rollup_as_is + propose_rollup_reconciliation IPC bridge
│   │   └── journal.rs                    # NEW — read journal entries for reconcile panel context
│   └── lib.rs                            # EXTEND — register new commands + state
│
├── src-tauri/migrations/                 # NEW migration file
│   └── 0003_phase8_receipts_and_journal.sql  # receipts table, receipt_nodes join refinement
│
├── mcp-sidecar/src/tools/
│   ├── propose_rollup_reconciliation.ts  # NEW — MCP tool with pin-aware branching
│   ├── update_contract.ts                # EXTEND — call Rust section parser via IPC for section_hashes
│   ├── write_derived_contract.ts         # EXTEND — same IPC call for section_hashes; lazy v3 upgrade
│   ├── get_contract.ts                   # EXTEND — staleness annotation when rollup_state ≠ fresh
│   └── find_by_intent.ts                 # EXTEND — staleness annotation
│
├── mcp-sidecar/src/
│   └── rust-bridge.ts                    # NEW — IPC client for section parser (over MCP-04 channel? OR separate stdio?)
│                                         #     DECISION below: spawn `mcp-sidecar`-side helper that calls Rust via Tauri's
│                                         #     existing process IPC … OR subprocess-call a small Rust binary section_parser_cli
│
├── src/
│   ├── components/
│   │   ├── inspector/
│   │   │   ├── ReconcilePanel.tsx        # EXTEND — pin-aware branching for amber + cherrypick header
│   │   │   ├── ReceiptsTab.tsx           # EXTEND — list view + pin-2-for-comparison + delta banner sub-component
│   │   │   ├── DeltaBanner.tsx           # NEW — 28px+ stacked-rows + percentage-delta variants
│   │   │   └── CherrypickModal.tsx       # NEW — diff layout + persistent header + Approve action
│   │   ├── graph/
│   │   │   ├── contractNodeStyles.ts     # EXTEND — rollup_stale, rollup_untracked, targeted variants
│   │   │   └── GraphCanvasInner.tsx      # EXTEND — rollupStaleUuids + untrackedUuids + targetedUuid feed CVA selector
│   │   └── chat/
│   │       └── ChatPanel.tsx             # NEW — bottom collapsible chat (already in shell, fill in agent run UX)
│   ├── store/
│   │   ├── rollup.ts                     # NEW — Zustand store for rollupStaleUuids + untrackedUuids
│   │   ├── receipts.ts                   # NEW — Zustand store for receipt cards + pinned-comparison set
│   │   └── agent.ts                      # NEW — Zustand store for active agent run, streaming output, status
│   ├── ipc/
│   │   ├── agent.ts                      # NEW — invoke runAgent + subscribe to agent:stream + agent:complete events
│   │   ├── receipts.ts                   # NEW — read receipt history per node
│   │   ├── cherrypick.ts                 # NEW — invoke apply_cherrypick
│   │   ├── rollup.ts                     # NEW — invoke acceptRollupAsIs, subscribe to rollup:changed
│   │   └── journal.ts                    # NEW — read journal entries for reconcile context
│
└── .claude/                              # NEW — committed PostToolUse hook config
    ├── settings.json                     # hook config: { hooks.PostToolUse: [{ matcher: "Write|Edit", hooks: [...] }]}
    └── hooks/
        └── post-tool-use.sh              # bash hook script — appends to journal, calls update_contract via mcp
```

### Pattern 1: Section Parser (PROP-01)

**What:** A canonical Rust function `parse_sections(body: &str) -> Result<BTreeMap<String, String>, ParseError>` returning a sorted map of section name → section body (sorted because `section_hashes` map MUST be order-stable per PROPAGATION.md).

**When to use:** Every `write_derived_contract` / `update_contract` write (called by MCP sidecar via IPC); every `compute_rollup_and_emit` (called from drift engine for upstream-ladder rebuild); every `accept_rollup_as_is` (NO — this only touches rollup_* fields, never recomputes section_hashes).

**Example:**
```rust
// Source: synthesized from PROPAGATION.md Q1 + pulldown-cmark Tag::Heading docs
// File: src-tauri/src/sidecar/section_parser.rs
use pulldown_cmark::{Event, HeadingLevel, Parser, Tag, TagEnd};
use std::collections::BTreeMap;
use sha2::{Digest, Sha256};

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("duplicate H2 heading: {0}")]
    DuplicateHeading(String),
}

/// Parse markdown body into a sorted map of H2 section name → trimmed section text.
/// Sections inside fenced code blocks are NOT detected as headings (pulldown-cmark
/// already handles this — Tag::Heading is only emitted for actual ATX/Setext headings).
pub fn parse_sections(body: &str) -> Result<BTreeMap<String, String>, ParseError> {
    let mut sections: BTreeMap<String, String> = BTreeMap::new();
    let mut current_name: Option<String> = None;
    let mut current_body = String::new();
    let parser = Parser::new(body);

    for ev in parser {
        match ev {
            Event::Start(Tag::Heading { level: HeadingLevel::H2, .. }) => {
                // Flush previous section.
                if let Some(name) = current_name.take() {
                    if sections.insert(name.clone(), current_body.trim().to_string()).is_some() {
                        return Err(ParseError::DuplicateHeading(name));
                    }
                    current_body.clear();
                }
                // Next Text event will be the heading title.
                current_name = Some(String::new());
            }
            Event::Text(t) | Event::Code(t) if matches!(current_name.as_deref(), Some("")) => {
                current_name = Some(t.into_string());
            }
            Event::End(TagEnd::Heading(_)) => { /* heading title already captured */ }
            other => {
                if current_name.is_some() {
                    // Re-render this event back to source-text form; pulldown-cmark
                    // doesn't expose the source span directly, so easier path:
                    // walk the body string with the original source-span tracker
                    // using `Parser::new_ext + offset_iter`. (See below.)
                }
            }
        }
    }
    if let Some(name) = current_name.take() {
        if sections.insert(name.clone(), current_body.trim().to_string()).is_some() {
            return Err(ParseError::DuplicateHeading(name));
        }
    }
    Ok(sections)
}

/// Compute sha256(section_body) for each section, returning a sorted map.
pub fn compute_section_hashes(body: &str) -> Result<BTreeMap<String, String>, ParseError> {
    let sections = parse_sections(body)?;
    Ok(sections
        .into_iter()
        .map(|(k, v)| {
            let mut hasher = Sha256::new();
            hasher.update(v.as_bytes());
            (k, hex::encode(hasher.finalize()))
        })
        .collect())
}
```

**IMPORTANT:** The naive Event-walker above doesn't reconstruct the original section text faithfully (pulldown-cmark normalizes whitespace, drops trailing newlines, etc.). The correct implementation uses `Parser::new_ext(body, options).into_offset_iter()` which yields `(Event, Range<usize>)` pairs — slice the original `body[range]` to recover faithful source-text per section. The hash is then over the original source bytes between consecutive H2 headings, which is the only reproducible invariant. **Plan 08-01 must use offset_iter, not the synthesized walker above.** (Source: pulldown-cmark crate docs — `Parser::into_offset_iter`.)

### Pattern 2: Rollup Detection (PROP-02)

**What:** A new engine function `compute_rollup_and_emit(app, uuid)` parallel to existing `compute_and_emit`. Acquires the same `DriftLocks::for_uuid(uuid)` mutex (no namespacing — body writes and rollup writes for the same node serialize). Reads `nodes.rollup_inputs` JSON, fetches each cited child's stored `section_hashes`, recomputes upstream `rollup_hash`, compares against stored, writes new `rollup_state` to a new SQLite table or to the sidecar (DECISION: write to a new `rollup_state` SQLite table mirroring the `drift_state` pattern, NOT to the sidecar — sidecar is the source of truth, but rollup is derived state and rewriting the sidecar on every detection is the bootstrap-storm anti-pattern PROPAGATION.md flagged. The sidecar's `rollup_state` field is updated only on real reconcile commits, not on detection.).

**Schema for `rollup_state` derived-state table** (NEW migration):
```sql
CREATE TABLE rollup_derived (
    node_uuid           TEXT PRIMARY KEY REFERENCES nodes(uuid) ON DELETE CASCADE,
    computed_rollup_hash TEXT NOT NULL,
    stored_rollup_hash  TEXT,                -- the value last committed to sidecar
    state               TEXT NOT NULL,       -- 'fresh' | 'stale' | 'untracked'
    generation_at_check u64 NOT NULL,
    checked_at          TEXT NOT NULL
);
```

**When to use:** Fired from `SourceWatcher` callback (when an L3/L4 child's source file changed → walk parent UUIDs and queue rollup recomputes); from cache rebuild on startup; from post-write hook in `write_derived_contract` / `update_contract` (when a cited child's section_hashes change → recompute parent rollup_hash).

**Concurrency primitive:** `rollup_generation` in the sidecar frontmatter is a u64 monotonic counter. Reconcile panels read at open; `accept_rollup_as_is` and `propose_rollup_reconciliation` both check generation-match before commit. Mismatch → reject + return current generation, second-to-commit retries.

### Pattern 3: PostToolUse Hook Script (PROP-03 + MCP-02)

**What:** A bash script registered in `.claude/settings.json` under `hooks.PostToolUse[].hooks[].command` with matcher `"Write|Edit|MultiEdit"`. Receives JSON via stdin with shape (verified against [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks)):

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/<cwd-key>/<session_id>.jsonl",
  "cwd": "/Users/yang/lahacks/contract-ide",
  "permission_mode": "default",
  "hook_event_name": "PostToolUse",
  "tool_name": "Write",
  "tool_input": { "file_path": "/abs/path/to/file.ts", "content": "..." },
  "tool_response": { "filePath": "/abs/path/to/file.ts", "success": true },
  "tool_use_id": "toolu_01ABC..."
}
```

**Hook flow:**
1. Read JSON from stdin (`jq` for parsing).
2. Validate `tool_name` is in `Write|Edit|MultiEdit`; `tool_response.success == true`.
3. Compute `affected_uuids` by querying SQLite (`SELECT uuid FROM nodes WHERE … code_ranges contains tool_input.file_path …`). The hook is bash → it shells out to `sqlite3` CLI to query (single-writer rule preserved — hook ONLY reads).
4. Extract `intent` from `$transcript_path` JSONL: read the file, find the most recent `type: "user"` entry whose `message.content` is a plain string (not a tool_result), take its trimmed content. Fallback for headless `-p`: extract from the first non-thinking `assistant` text block following the tool_use ID match.
5. Append one JSONL line to `.contracts/journal/<session_id>.jsonl` (create dir if missing; `mkdir -p .contracts/journal`).
6. For each affected UUID, **spawn a fire-and-forget background `claude -p` subprocess** that calls the `update_contract` MCP tool — Pass 2 of the three-pass verification model (objective truth, fresh-eyes rederive). The hook is OUTSIDE the MCP context but a freshly-spawned `claude -p` IS inside one (subscription auth carries to subprocess; mirrors Phase 6 derivation pivot). Pattern: `for uuid in $AFFECTED_UUIDS; do (cd "$REPO_PATH" && claude -p "Use update_contract for UUID $uuid: read sidecar, read code at cited code_ranges, derive new body matching code, call update_contract($uuid, new_body). Preserve user-authored ## Intent and ## Role sections verbatim — only update ## Examples and ## Implicit Decisions. If pinned, update_contract returns SKIPPED-PINNED — exit silently." > /dev/null 2>&1) & done`. **Why a separate `claude -p` (fresh agent) and not the active session calling MCP:** fresh-eyes pass — the active session is biased by "I just wrote this" and systematically misses implicit decisions (the very thing contracts must surface); single-session-recursion avoidance — calling `update_contract` from inside the active agent loop creates weird recursion. **Single-writer rule preserved:** all writes serialize through `DriftLocks` per-UUID Tokio mutex (existing `write_contract` path); the hook + spawned `claude -p` are clients, not writers themselves. **Latency expectation:** brief red pulse → fresh over ~10-30s as background spawns complete in parallel — visibly shows the verification loop working. **Graceful degradation:** if `claude` CLI is missing from PATH, the spawn fails silently and the user sees red drift only — explicit, not silent.
7. Exit 0. Stdout silent.

**Coexistence with Phase 7 watcher:** The hook fires AFTER Claude writes the file. The Phase 7 `SourceWatcher` ALSO fires on that write (via FSEvents). Both reach `compute_and_emit(app, uuid)` which acquires the same `DriftLocks::for_uuid(uuid)` mutex — second caller waits, then re-reads the now-updated `nodes.code_hash` and computes correctly. **No race possible.** This is the exact reason Phase 7 chose `tokio::sync::Mutex` and the reason MCP-02 was deferred from Phase 5 to Phase 8.

### Pattern 4: Agent Loop Streaming (AGENT-01..04)

**What:** A Rust IPC `run_agent(prompt, scope_uuid)` returns a tracking ID; the Rust task spawns `claude -p "..."` via `tauri-plugin-shell::Command::new("claude").args([...])`, awaits `child.spawn()` returning `(rx, child)`, and forwards each `CommandEvent::Stdout(line)` to React via `app.emit("agent:stream", { tracking_id, line })`. On `CommandEvent::Terminated { code, … }`, parse the session JSONL (located at `~/.claude/projects/<encoded-cwd>/<session_id>.jsonl` — discoverable via `tool_response.session_id` in the latest log lines OR by listing the projects dir for the most-recent JSONL after spawn time).

**Stream API verified pattern** (from [Tauri v2 plugin-shell docs](https://v2.tauri.app/plugin/shell/) and [Tauri discussion #8641](https://github.com/tauri-apps/tauri/discussions/8641)):

```rust
// File: src-tauri/src/commands/agent.rs
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

#[tauri::command]
pub async fn run_agent(
    app: tauri::AppHandle,
    prompt: String,
    scope_uuid: Option<String>,
) -> Result<String, String> {
    let tracking_id = uuid::Uuid::new_v4().to_string();
    let tracking_id_clone = tracking_id.clone();

    // Build prompt: assembler reads scope contract + neighbors, prepends to user prompt.
    let assembled = assemble_prompt(&app, &prompt, scope_uuid.as_deref()).await?;

    let (mut rx, _child) = app
        .shell()
        .command("claude")
        .args(["-p", &assembled, "--output-format", "json"])  // VERIFY --output-format flag exists
        .spawn()
        .map_err(|e| e.to_string())?;

    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(ev) = rx.recv().await {
            match ev {
                CommandEvent::Stdout(line) => {
                    let s = String::from_utf8_lossy(&line).to_string();
                    let _ = app_clone.emit("agent:stream", serde_json::json!({
                        "tracking_id": tracking_id_clone,
                        "line": s,
                    }));
                }
                CommandEvent::Stderr(line) => { /* log */ }
                CommandEvent::Terminated(payload) => {
                    let _ = app_clone.emit("agent:complete", serde_json::json!({
                        "tracking_id": tracking_id_clone,
                        "code": payload.code,
                    }));
                    // Parse session JSONL for receipt — DEFENSIVE module call.
                    let receipt = crate::commands::receipts::parse_and_persist(
                        &app_clone, &tracking_id_clone, scope_uuid.as_deref()
                    ).await;
                    if let Err(e) = receipt {
                        eprintln!("[agent] receipt parse failed: {e} — using mock fallback");
                        // Mock fallback: emit a receipt with zeros so the card never blanks.
                        let _ = app_clone.emit("receipt:created", crate::commands::receipts::mock_receipt(&tracking_id_clone));
                    }
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(tracking_id)
}
```

**Capability requirement:** `tauri.conf.json` capabilities already grant `shell:allow-execute` (Phase 1) — extend to grant `shell:allow-spawn` for streaming (per Tauri 2 sidecar streaming requires explicit `shell:allow-spawn`). Verify in `src-tauri/capabilities/default.json`.

### Pattern 5: Defensive JSONL Receipt Parser (AGENT-02)

**What:** Isolated module `src-tauri/src/commands/receipts.rs::parse_session_jsonl(path) -> SessionReceipt`. Walks the JSONL line-by-line; each line is `serde_json::Value` (NOT a typed struct) and the parser reads only fields it needs, ignoring unknown shapes. Returns `Result<SessionReceipt, ParseError>` — caller handles the error by emitting a mock receipt rather than a blank card.

**Verified shape from captured live session JSONL** (`~/.claude/projects/-Users-yang-lahacks-contract-ide/adda62e2-da18-4496-b95c-2b6cadb9a863.jsonl`):

| Line type | Top-level fields | Extract for receipt |
|-----------|------------------|---------------------|
| `permission-mode` | `type, permissionMode, sessionId` | (skip) |
| `file-history-snapshot` | `type, messageId, snapshot, isSnapshotUpdate` | (skip) |
| `user` | `type, message, uuid, timestamp, sessionId, cwd, gitBranch, version` | First-occurring user `timestamp` is session start |
| `attachment` | `type, ...` | (skip) |
| `assistant` | `type, message, uuid, timestamp, sessionId` — `message.usage = { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, server_tool_use, service_tier, ... }` — `message.content = [{ type: "thinking" | "text" | "tool_use", ... }]` | Sum `usage.input_tokens + cache_creation_input_tokens + cache_read_input_tokens` for total inputs; `output_tokens` for outputs; count `content[].type == "tool_use"` for tool calls |
| `last-prompt` | `type, ...` | (skip) |
| `system` | `type, ...` | (skip) |

**Tool-use content block shape:** `{ type: "tool_use", id, name, input, caller }`.
**Tool-result content block shape (in `user` lines):** `{ type: "tool_result", tool_use_id, content }`.

**Token cost estimation:** `est_cost_usd = input_tokens * INPUT_RATE + output_tokens * OUTPUT_RATE` per Anthropic pricing. **Hard-code rates as constants with model name → rate mapping.** Reference: Sonnet 4.5 / Opus 4.7 published rates as of 2026-04 (verify before commit; rates change).

**Mock fallback:** If parse fails for ANY reason — file missing, malformed JSON, unknown line type, missing `usage` — emit `SessionReceipt { input_tokens: 0, output_tokens: 0, tool_calls: 0, est_cost_usd: 0.0, raw_jsonl_path: <attempted path>, parse_status: "fallback_mock" }`. The card renders, the demo doesn't blank. The `parse_status` field is shown subtly in the inspector for debug visibility but doesn't break the layout.

**Test fixture:** Capture one real `claude` session run during Plan 08-04 development, save to `src-tauri/tests/fixtures/session_real.jsonl`, write unit tests asserting parser extracts non-zero counts. Two synthetic fixtures: `session_truncated.jsonl` (cut mid-line) and `session_unknown_types.jsonl` (with extra unknown top-level types). Both must produce non-zero counts where data exists, not crash.

### Pattern 6: Cherrypick Atomic Apply (CHRY-03)

**What:** A single Tauri IPC `apply_cherrypick(uuid, contract_body, file_patches)` writes BOTH the sidecar `.contracts/<uuid>.md` AND each source file in `file_patches: Vec<{file: String, new_content: String}>` atomically. Rust executes:

```rust
// File: src-tauri/src/commands/cherrypick.rs (NEW)
#[tauri::command]
pub async fn apply_cherrypick(
    app: tauri::AppHandle,
    uuid: String,
    contract_body: String,
    file_patches: Vec<FilePatch>,
) -> Result<(), String> {
    let locks = app.state::<crate::drift::state::DriftLocks>();
    let _guard = locks.for_uuid(&uuid).lock().await;  // serialize with watcher

    // 1. Write each source file via temp + rename. Fsync each temp before rename.
    let mut written: Vec<PathBuf> = vec![];
    for p in &file_patches {
        let tmp = source_temp_path(&p.file);
        std::fs::write(&tmp, &p.new_content).map_err(|e| e.to_string())?;
        written.push(tmp.clone());
    }
    // 2. Write sidecar via existing helper (write_contract Rust command from Phase 2)
    //    NOTE: write_contract recomputes contract_hash + section_hashes via Rust IPC
    //    and writes the sidecar atomically. This is the LAST write — order matters
    //    because if it fails, source-file writes still got renamed and the watcher
    //    will fire drift on the next FSEvents tick (correct: we have unflushed sidecar
    //    intent but the source has moved, so user sees red pulse and knows to retry).
    let sidecar_tmp = sidecar_temp_path(&uuid);
    let new_sidecar_content = build_sidecar_content(&uuid, &contract_body)?;
    std::fs::write(&sidecar_tmp, new_sidecar_content).map_err(|e| e.to_string())?;
    
    // 3. Now rename source temps in dependency order, then sidecar.
    for (tmp, p) in written.iter().zip(&file_patches) {
        std::fs::rename(tmp, &p.file).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&sidecar_tmp, sidecar_final_path(&uuid)).map_err(|e| e.to_string())?;

    Ok(())
}
```

**Atomicity guarantee:** POSIX `rename(2)` on the same filesystem is atomic. Writing the source files BEFORE the sidecar means a crash mid-cherrypick leaves the source updated but the sidecar still pointing at old code_hash → Phase 7 watcher fires drift → user sees red pulse → user retries cherrypick. **Failure mode is observable, not silent.** The reverse order (sidecar first) would be silent: contract claims new behavior but source is unchanged. **The decision below — write source temps + sidecar temp before any rename, then rename all — is the right tradeoff between true two-phase commit (which doesn't exist on POSIX) and observable failure.**

### Anti-Patterns to Avoid

- **DO NOT** rewrite `compute_and_emit` to handle rollup. Add `compute_rollup_and_emit` as a sibling function. Phase 7 reasoning ("hook + watcher coexist via shared DriftLocks") only holds if the existing fn signature stays.
- **DO NOT** add a parallel TS section parser in `mcp-sidecar`. PROPAGATION.md Q1 RESOLVED: Rust only. MCP sidecar calls Rust via IPC. (See decision below on IPC mechanism.)
- **DO NOT** make `accept_rollup_as_is` an MCP tool. It must be a narrow Rust IPC writing only `rollup_hash`, `rollup_generation`, `rollup_state` to bypass YAML round-trip. (`contract_hash` perturbation is a real risk if YAML.parse + YAML.stringify don't round-trip byte-identically — engineering red team flagged this.)
- **DO NOT** call `update_contract` directly from the PostToolUse hook process — the hook is outside the MCP context and synchronous calls would block the agent. Instead, **spawn a fire-and-forget background `claude -p` per affected UUID** that calls `update_contract` from a fresh agent context (subscription auth carries to subprocess; see Pattern 3 step 6). Single-writer rule preserved by `DriftLocks` mutex coordination at the existing `write_contract` path.
- **DO NOT** poll the `~/.claude/projects/<...>/<session_id>.jsonl` file for receipts. Wait for `CommandEvent::Terminated` then read the file once. The session_id discovery is the only tricky part (see Open Question 1).
- **DO NOT** use percentage-delta as the demo banner format. Locked decision: absolute-stacked rows for Beat 2; percentage-delta is a secondary developer-dogfood view on the receipt-history tab.
- **DO NOT** rewrite `ReconcilePanel`. Extend with conditional rendering: `if (rollupState === 'stale')` → render new pin-aware action set; `else if (drifted)` → render existing three-action set. Same Dialog shell.
- **DO NOT** burn polish on cherrypick modal. Constraint locked: shadcn Dialog defaults, functional only. Demo never lands on the cherrypick modal.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Markdown H2 section parsing | Hand-rolled regex / line-state-machine | `pulldown-cmark` with `into_offset_iter` | Fenced-code-aware parsing is the explicit requirement; pulldown-cmark gets ATX/Setext/CRLF/BOM right; offset_iter preserves source spans for faithful section-text recovery |
| Atomic file write | Manual `write()` then `rename()` without fsync | Existing `write_contract` Rust IPC + the cherrypick wrapper documented above | write_contract already handles BOM, CRLF, frontmatter ordering, and tmp+rename. Reusing it keeps the single-writer contract intact. |
| YAML serialization for the 5 new frontmatter fields | Manual `format!()` of YAML | `serde_yaml_ng::to_string` (already shipped) on extended `ContractFrontmatter` struct | Field-order locked; serde keeps insertion order via field declaration order |
| Streaming subprocess output | Loop over `child.stdout.read_line()` manually | `tauri-plugin-shell::Command::spawn()` returning `Receiver<CommandEvent>` | Plugin handles dropped-receiver cleanup, exit-code propagation, stderr separation |
| Diff rendering in cherrypick modal | Hand-built side-by-side renderer | Monaco `DiffEditor` (`<DiffEditor original={...} modified={...} />`) | Already in bundle (Phase 4 Monaco install); zero new deps; native syntax highlighting + collapse-unchanged regions for free |
| SQLite read from MCP sidecar context | Direct better-sqlite3 write | Existing read-only better-sqlite3 connection (Phase 5 MCP-03) — write via Rust IPC OR via `update_contract.ts` sidecar-write-then-rust-watcher pattern | Single-writer rule. PostToolUse hook reads via `sqlite3` CLI; that's also a read. |
| Per-session journal file rotation | Custom rotator | Per-session files (one file per session_id) — never rotate | PROPAGATION.md decision: per-session files avoid git merge ordering; volume is negligible at hackathon scale (Q2 in PROPAGATION) |
| Session JSONL field discovery | Assume schema | Captured-live-fixture validated parse | The shapes documented in this RESEARCH.md are from a real session — but Anthropic CAN change the JSONL format between Claude versions. Defensive parsing + mock fallback is the durable fix. |

**Key insight:** Every domain in this phase has a "hand-rolled is 50 LOC less but breaks under one specific edge case" trap. Section parsing breaks on fenced code blocks. Atomic write breaks under crash mid-write. JSONL parsing breaks on schema evolution. The defensive choice is consistent: lean on shipped libraries / patterns and pay the LOC tax. The phase is large enough that any hand-rolled corner is the one that costs Beat 2.

## Common Pitfalls

### Pitfall 1: Section Parser Order Stability

**What goes wrong:** Two contracts with identical sections but different ordering produce different `section_hashes` → rollup_hash mismatch → false-positive amber. Already a real risk: the two committed fixtures (`11111111-…` API L3 and `22222222-…` UI L4) order their sections differently (`## Examples` mid-body vs. late).

**Why it happens:** A naive section parser hashes sections in textual order; a `BTreeMap<String, String>` (sorted by section name) is order-stable.

**How to avoid:** Use `BTreeMap<String, String>` (sorted by name). The `section_hashes` field in YAML frontmatter must serialize in alphabetical order — `serde_yaml_ng` preserves insertion order, so insert via the BTreeMap iterator.

**Warning signs:** Two writes with identical body content produce different section_hashes maps. Test fixture: hash a body, shuffle the H2 sections, hash again — must match.

### Pitfall 2: Concurrent Writers on the Same Sidecar

**What goes wrong:** Two writers update the same sidecar `.md` file at near-identical timestamps. Examples: (a) the PostToolUse hook spawns `claude -p` which calls `update_contract` for UUID X *while* the user is also editing X's contract via the Inspector saveContract path; (b) two background `claude -p` rederives spawned by the same hook fire happen to land on the same UUID via overlapping `code_ranges`. Without coordination, last-writer-wins silently corrupts state — `contract_hash` and `section_hashes` go stale, the file watcher sees inconsistent values, drift state oscillates.

**Why it happens:** The single-writer rule from earlier phases meant "only one process writes the .md file" — but Phase 8 introduces multiple legitimate writers (active session via Inspector, hook-spawned `claude -p` via `update_contract`, future Phase 11 `Delegate` button). They all need to coexist.

**How to avoid:** **Single-writer means "serialize all writes through `DriftLocks::for_uuid(uuid)` Tokio mutex"** — NOT "only one writer exists." Both writer paths (hook→`claude -p`→`update_contract`→`write_contract` AND active-session→`saveContract`→`write_contract`) acquire the same per-UUID mutex before touching the file. The mutex coordinates: second writer waits, then re-reads `nodes.code_hash` / `section_hashes` and computes correctly against the post-first-write state. Phase 7's watcher also acquires the same mutex on FSEvents-fired drift recompute, so the ordering is: write → mutex release → watcher acquire → drift computed against fresh content. **No race.** This is the exact reason Phase 7 chose `tokio::sync::Mutex` (Send across .await) and the reason MCP-02 was deferred from Phase 5 to Phase 8.

**Warning signs:** Two `drift:changed` events for the same UUID within 100ms with conflicting drift status. Symptom of the mutex being bypassed (probably a writer that opens the file directly instead of via `write_contract`). Test: stress the hook + saveContract paths concurrently against the same UUID; assert exactly N writes complete, no `contract_hash` mismatches afterward.

### Pitfall 3: Receipt Parser Crashes on Schema Evolution

**What goes wrong:** Anthropic ships Claude 4.7 → 4.8 with a new top-level JSONL line type, or renames `usage.input_tokens` → `usage.inputTokens`. Parser throws → receipt card is blank → demo Beat 2 fails.

**Why it happens:** Strict typed parsing assumes schema. Real session JSONLs already vary across Claude versions (`version: 2.1.111` in the captured sample).

**How to avoid:**
1. Parse line-by-line as `serde_json::Value` (not typed struct).
2. For each field read, use `.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0)`.
3. Mock-fallback receipt on any panic / parse error.
4. Unit test against captured real session + two synthetic-malformed fixtures.

**Warning signs:** Parser unit tests pass on one fixture but fail on a second-captured session. Schema drift is real; the mock fallback is the only durable fix.

### Pitfall 4: `claude -p` Output Format Surprise

**What goes wrong:** The agent loop streams stdout assuming text output. If `claude` is invoked with `--output-format json` (which streams JSON-line events) or without (which streams human-readable text), the chat panel rendering differs.

**Why it happens:** Two valid output modes; only one is the right choice. JSON-line mode produces parseable events but isn't human-readable; text mode is human-readable but doesn't expose token counts mid-stream.

**How to avoid:** Use plain text mode (`claude -p "prompt"` without `--output-format`) so the chat panel shows the agent's natural output. Token/tool-call counts come from session JSONL parsing AFTER `CommandEvent::Terminated` — not from mid-stream parsing. Verify via Plan 08-04 Day-1 spike: invoke `claude -p "list 3 colors"`, confirm stdout is human-readable, check that `~/.claude/projects/<key>/*.jsonl` got the session row.

**Warning signs:** Chat panel shows JSON gibberish; receipt card shows zeros. Symptom mapping: gibberish → wrong output format. Zeros → JSONL not found / session-id discovery failed.

### Pitfall 5: Pin-Aware Branching Race

**What goes wrong:** User opens reconcile panel for a node that's currently `human_pinned: true`. While the panel is open, another session calls `update_contract`, gets SKIPPED-PINNED (correct), but ALSO… no actually the panel race is the OTHER direction: user unpins via "Unpin and reconcile", clicks the propagate button, but in the milliseconds between unpin-write and propagate-call, another session got there first and pinned it again.

**Why it happens:** Pin state is a single boolean in the YAML; reads aren't atomic with writes.

**How to avoid:** Pin-aware branching reads `human_pinned` AT THE MOMENT THE WRITE FIRES, not at panel open. The panel renders the correct action set based on cached state, but the write IPC itself re-checks pin state under the `DriftLocks::for_uuid(uuid)` mutex — if pin flipped during the panel session, return an error to the UI rather than silent SKIPPED-PINNED. Critical phrasing in the spec: "SKIPPED-PINNED is unreachable from both UI paths — the branching fires before any writer is called." This is the implementation: re-check is at write time, but the *return value* on race is an explicit error, not silent skip.

**Warning signs:** Reconcile panel says "Draft propagation for review", user clicks, nothing happens. Symptom of silent SKIPPED-PINNED. The fix: return error → render error toast.

### Pitfall 6: Cherrypick Two-File Write Order

**What goes wrong:** Sidecar gets written first; source file write fails halfway → contract claims new behavior, source unchanged → silent inconsistency. User merges thinking everything's fine.

**Why it happens:** POSIX rename is atomic per-file but not across files; there's no cross-file 2PC.

**How to avoid:** Order documented in Pattern 6 above — write all temp files first (no renames yet), THEN rename source temps, THEN rename sidecar. If any rename fails after the first source rename, the partially-applied state has at least ONE source updated and sidecar still pointing at OLD code_hash → Phase 7 watcher fires drift on next tick → red pulse → user sees and retries. Failure is observable, never silent.

**Warning signs:** Cherrypick succeeds but no drift fires AND source is partially updated. (Test: simulate `std::fs::rename` returning error mid-loop in Plan 08-05.)

### Pitfall 7: Lazy Schema Migration Bootstrap

**What goes wrong:** On first startup with format_version: 3 logic, every existing v2 contract is silently re-parsed — expected — but if the parser computes `section_hashes` and writes them back to disk, all 25 seed contracts (Phase 9 DEMO-01) trigger a write storm → file watcher fires 25 times → 25 drift recomputes → 1-second app freeze on launch.

**Why it happens:** Eager migration is the obvious-but-wrong choice; PROPAGATION.md decision is **lazy on first write**.

**How to avoid:** Reading a v2 contract returns a virtual `section_hashes` map computed in memory but NOT persisted. Only when the contract is written via `write_derived_contract` / `update_contract` (or any other writer) does the v3 frontmatter get persisted. SQLite stores `section_hashes` from the in-memory computation → graph + reconcile work correctly without bulk-rewriting 25 sidecars. Verify in Plan 08-01: test seed of 25 v2 contracts → app launch produces 0 sidecar writes.

**Warning signs:** App launch causes a flurry of sidecar mtime updates. Counter: `find .contracts -name "*.md" -newer /tmp/before-launch | wc -l` after launch == 0.

### Pitfall 8: Journal Directory Missing on First Hook Fire

**What goes wrong:** `.contracts/journal/` doesn't exist; hook tries to append → ENOENT → hook script crashes → Claude session pauses with hook-failure error popup on stage during Beat 2.

**Why it happens:** `.contracts/` exists (created by repo open) but `.contracts/journal/` is hook-created on first use.

**How to avoid:** Hook script does `mkdir -p .contracts/journal` before append. Cheap (idempotent). Cost: one mkdir per hook fire.

**Warning signs:** First hook invocation in a fresh repo errors. Test: blow away `.contracts/journal/` and run a Claude session → first hook should succeed.

### Pitfall 9: Receipt Banner Reserves Space For Phase 13 Rules-Honored Row

**What goes wrong:** Phase 8 ships banner with 2 rows (tokens, tool calls). Phase 13 adds rules-honored row → layout shifts, demo recording's banner doesn't match Phase 8 banner → re-record required.

**Why it happens:** Forgot to reserve vertical space in initial component design.

**How to avoid:** `<DeltaBanner>` component has THREE rows from Phase 8: tokens, tool calls, rules honored (ships with `N/A` placeholder for rules until Phase 13 wires it). Reserved 28px+ height per row × 3 rows. Locked decision in CONTEXT.md.

**Warning signs:** Phase 13 visual diff against Phase 8 reveals layout shift. Counter: snapshot test the banner at Phase 8 with `5/5 rules honored` placeholder string.

### Pitfall 10: Section Parser Rejects Beat 1 Body

**What goes wrong:** PM types Beat 1 body verbatim from `presentation-script.md` (`## Intent`, `## Role`, `## Examples` with multi-paragraph blocks and GIVEN/WHEN/THEN). Section parser rejects on a malformed-looking Examples block (e.g., the GIVEN/WHEN/THEN don't have explicit code fencing). **Demo doesn't run.**

**Why it happens:** Strict parser interpretation of "duplicate H2" or "unknown section" causes rejection. Beat 1 body is THE acceptance test.

**How to avoid:** Use the literal Beat 1 body from `presentation-script.md` lines 34-56 as a Plan 08-01 fixture test. Parser must accept any H2 set without rejecting on "unknown section name" — only reject on duplicate H2 (literal duplicate after case normalization). All sections allowed in any order, in any combination. Validation of "required sections per (kind, level)" is a Phase 13 concern (slot registry), not Phase 8.

**Warning signs:** PROP-01 tests pass on synthetic fixtures but the literal Beat 1 body is never tested. Always test with the demo fixture.

## Code Examples

### Example 1: Extended ContractFrontmatter Struct (PROP-01)

```rust
// Source: extends src-tauri/src/sidecar/frontmatter.rs
// Verified field-order conventions from existing struct.
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RollupInput {
    pub child_uuid: String,
    pub sections: Vec<String>,  // section names (e.g., ["intent", "invariants"])
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContractFrontmatter {
    pub format_version: u32,                   // bumped to 3 on next write
    pub uuid: String,
    pub kind: String,
    pub level: String,                          // "L0" | "L1" | "L2" | "L3" | "L4"
    pub parent: Option<String>,
    #[serde(default)]
    pub neighbors: Vec<String>,
    #[serde(default)]
    pub code_ranges: Vec<CodeRange>,
    pub code_hash: Option<String>,
    pub contract_hash: Option<String>,
    #[serde(default)]
    pub human_pinned: bool,
    pub route: Option<String>,
    pub derived_at: Option<String>,
    // ----- Phase 8 (format_version: 3) additions -----
    /// All levels. Map of section name (lowercase) → sha256 hex of source-text bytes.
    /// Sorted (BTreeMap) for stable serialization.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub section_hashes: BTreeMap<String, String>,
    /// L1/L2/L3 only — what child sections this rollup cites.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rollup_inputs: Vec<RollupInput>,
    /// L1/L2/L3 only — sha256 over concatenated cited child section_hashes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rollup_hash: Option<String>,
    /// L1/L2/L3 only. "fresh" | "stale" | "untracked"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rollup_state: Option<String>,
    /// L1/L2/L3 only — monotonic concurrency counter.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rollup_generation: Option<u64>,
}
```

**L0 omits the four `rollup_*` fields entirely** (per PROPAGATION.md Q3 confirmed). Use `skip_serializing_if = "Option::is_none"` so L0 sidecars never write the field. On parse, missing fields default to None — fits `serde(default)` semantics.

### Example 2: PostToolUse Hook Configuration

```json
// Source: synthesized from https://code.claude.com/docs/en/hooks (verified 2026-04-24)
// File: contract-ide/.claude/settings.json (committed to git)
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/post-tool-use.sh"
          }
        ]
      }
    ]
  }
}
```

```bash
#!/usr/bin/env bash
# Source: synthesized from PROPAGATION.md Layer 2 + Claude Code hooks reference
# File: contract-ide/.claude/hooks/post-tool-use.sh
set -euo pipefail

# Read JSON payload from stdin.
PAYLOAD=$(cat)

SESSION_ID=$(echo "$PAYLOAD" | jq -r '.session_id')
TRANSCRIPT_PATH=$(echo "$PAYLOAD" | jq -r '.transcript_path')
TOOL_NAME=$(echo "$PAYLOAD" | jq -r '.tool_name')
FILE_PATH=$(echo "$PAYLOAD" | jq -r '.tool_input.file_path // .tool_input.path // empty')
CWD=$(echo "$PAYLOAD" | jq -r '.cwd')

# Skip if not a file-modifying tool or no file_path
if [[ -z "$FILE_PATH" ]]; then exit 0; fi
# Skip writes outside the contract-ide repo
case "$FILE_PATH" in
  "$CWD"/*) ;;
  *) exit 0 ;;
esac

JOURNAL_DIR="$CWD/.contracts/journal"
mkdir -p "$JOURNAL_DIR"

# Resolve relative path
REL_PATH="${FILE_PATH#$CWD/}"

# Find affected UUIDs by reading SQLite (read-only). Single-writer rule preserved.
DB_PATH="${CONTRACT_IDE_DB_PATH:-$HOME/Library/Application Support/com.contract-ide.app/contract-ide.db}"
AFFECTED_UUIDS_JSON="[]"
if [[ -f "$DB_PATH" ]]; then
  # nodes.code_ranges is a JSON column. Use json_each to expand and find matching files.
  AFFECTED_UUIDS_JSON=$(sqlite3 -readonly "$DB_PATH" \
    "SELECT json_group_array(uuid) FROM (
       SELECT DISTINCT n.uuid FROM nodes n, json_each(n.code_ranges) je
       WHERE json_extract(je.value, '$.file') = '$REL_PATH'
     )" 2>/dev/null || echo "[]")
fi

# Extract intent from transcript: latest user message whose content is a string.
INTENT=""
if [[ -f "$TRANSCRIPT_PATH" ]]; then
  INTENT=$(jq -r 'select(.type=="user") | select(.message.content | type=="string") | .message.content' "$TRANSCRIPT_PATH" 2>/dev/null | tail -n 1 || true)
fi
# Fallback for headless -p / synthetic sessions
if [[ -z "$INTENT" ]]; then
  INTENT="(headless: $TOOL_NAME on $REL_PATH)"
fi

# Append journal line — schema_version: 1
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
JOURNAL_FILE="$JOURNAL_DIR/$SESSION_ID.jsonl"
jq -nc \
  --arg sv "1" \
  --arg ts "$TS" \
  --arg sid "$SESSION_ID" \
  --arg tool "$TOOL_NAME" \
  --arg file "$REL_PATH" \
  --argjson uuids "$AFFECTED_UUIDS_JSON" \
  --arg intent "$INTENT" \
  '{schema_version: ($sv | tonumber), ts: $ts, session_id: $sid, tool: $tool, file: $file, affected_uuids: $uuids, intent: $intent}' \
  >> "$JOURNAL_FILE"

# Phase 7 SourceWatcher will fire on the source file write itself — drift + rollup
# detection runs through the existing watcher path. No explicit update_contract call.

exit 0
```

### Example 3: Receipt Banner Shape (AGENT-04)

```tsx
// Source: synthesized from CONTEXT.md locked decision + presentation-script.md Beat 2
// File: src/components/inspector/DeltaBanner.tsx
interface DeltaBannerProps {
  contractIde: { tokens: number; toolCalls: number; rulesHonored: string };  // "5/5"
  bareClaude: { tokens: number; toolCalls: number; rulesHonored: string };  // "0/5"
  view: 'absolute-stacked' | 'percentage-delta';
}

export default function DeltaBanner({ contractIde, bareClaude, view }: DeltaBannerProps) {
  if (view === 'absolute-stacked') {
    return (
      <div className="font-mono">
        <div className="text-[28px] leading-tight">
          Contract IDE: ~{contractIde.tokens.toLocaleString()} tokens · ~{contractIde.toolCalls} tool calls · {contractIde.rulesHonored} rules honored
        </div>
        <div className="text-[28px] leading-tight text-muted-foreground mt-2">
          Bare Claude:  ~{bareClaude.tokens.toLocaleString()} tokens · ~{bareClaude.toolCalls} tool calls · {bareClaude.rulesHonored} rules honored
        </div>
      </div>
    );
  }
  // percentage-delta view (developer dogfood — receipt-history tab)
  const tokensDelta = pct(contractIde.tokens, bareClaude.tokens);
  const toolsDelta = pct(contractIde.toolCalls, bareClaude.toolCalls);
  return (
    <div className="font-mono text-[28px] flex gap-6">
      <span>−{tokensDelta}% tokens</span>
      <span>−{toolsDelta}% tool calls</span>
      <span>{contractIde.rulesHonored} rules honored</span>
    </div>
  );
}
function pct(a: number, b: number): number {
  if (b === 0) return 0;
  return Math.round((1 - a / b) * 100);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct subprocess `Command::new("claude").output()` (blocking) | `tauri-plugin-shell::Command::spawn()` returning `Receiver<CommandEvent>` | Tauri 2 GA | Streaming UX feasible; chat panel populates progressively |
| Strict typed JSONL parsing | Defensive `serde_json::Value` walking + mock fallback | Standing pattern (this project's `Day-1 validation` lineage) | Schema drift across Claude versions tolerated |
| Single-call PostToolUse hook side effects | Hook journals (Pass 1) + spawns fresh `claude -p` per affected UUID for auto-rederive (Pass 2); all writes serialize through `DriftLocks` mutex | This project's revised three-pass model (2026-04-24) | True single-writer via mutex coordination; hook + watcher + active-session writers coexist |
| Hand-rolled markdown parser | `pulldown-cmark` with offset_iter | Standing convention in Rust ecosystem | Fenced-code-aware; CommonMark compliant |
| Naive LLM-driven propagation (per-edit prompt) | Hash-based detection + opt-in reconcile | PROPAGATION.md red-team verdict | Detection is unconditional, deterministic, hash-based; LLMs only run on user-initiated reconciliation |
| Single contract body as one prose blob | Sectioned markdown with H2 slots + per-section hashes | RESEARCH.md Option F adoption (2026-04-24) | Section-weighted FTS, mass-edit ranking, agent prompt drop priority — all unlocked |

**Deprecated/outdated:**
- ARCHITECTURE.md "Phase 8 = drift only" framing: superseded by ROADMAP Phase 8 absorbing PROP-01..04.
- "Hook prompts session for rollup review": red-teamed away (PROPAGATION.md attacks #4, #8, #9).
- Storing `rollup_state` only in sidecar: replaced by hybrid (sidecar holds committed state, SQLite `rollup_derived` table holds detection state).

## Open Questions

### Q1: Session ID discovery after `claude -p` spawn

**What we know:** `claude -p "prompt"` writes to `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. The session_id is generated at session start, not provided by us. Stdout doesn't reliably echo the session_id in plain text mode.

**What's unclear:** How to deterministically find the session_id from the spawning process. Approaches considered: (a) parse stdout for a session-start marker, (b) snapshot the projects dir before spawn and find the new file after, (c) use `claude --output-format json` which prints session_id as the first event.

**Recommendation:** **Option (c) — parse stdout for session_id with `--output-format stream-json --include-partial-messages` flag.** Verify in Plan 08-04 spike. Fallback if (c) doesn't expose session_id: option (b) — directory snapshot diff. Option (a) is fragile.

### Q2: MCP sidecar → Rust section parser IPC mechanism

**What we know:** PROPAGATION.md mandates Rust-only canonical parser; MCP sidecar must call it. Three IPC paths considered: (a) Tauri command from MCP sidecar (impossible — sidecar is a separate process, can't invoke Tauri), (b) HTTP localhost from Rust to MCP, (c) standalone CLI binary `section-parser-cli` that MCP sidecar spawns per call, (d) extend existing MCP sidecar's process to be a Tauri sidecar that already shares process group.

**What's unclear:** Best path. (c) is simple but spawns a process per write — high overhead at hot paths. (b) requires Rust to host an HTTP server.

**Recommendation:** **Option (c) — small CLI binary `section-parser-cli` in `src-tauri/binaries/`** that reads body from stdin, writes JSON `{"section_hashes": {...}}` to stdout. MCP sidecar spawns it via `child_process.execFileSync()`. Build-time bundled the same way `mcp-server-aarch64-apple-darwin` is bundled today. Per-call cost ~5ms which is fine — write paths are rare. Verify in Plan 08-01.

### Q3: Receipt cost-rate constants

**What we know:** Anthropic publishes per-model token rates. Sonnet 4.5 / Opus 4.7 rates current as of 2026-04. Rates change.

**What's unclear:** Do we hardcode rates for Phase 8 or fetch from a config?

**Recommendation:** Hardcode in `src-tauri/src/commands/receipts.rs` constants table with model-name → (input_rate, output_rate). Document that rates are point-in-time and the file should be updated when rates change. NOT a runtime fetch — adds network dependency and demo-day risk.

### Q4: How to detect `model_name` from the JSONL

**What we know:** `assistant.message.model` field exists in some Claude versions but not all (the captured fixture didn't show it cleanly). Without model name, can't compute cost rate.

**What's unclear:** Whether the captured JSONL has `model` somewhere or we need to default-assume Opus 4.7.

**Recommendation:** Default-assume the model the IDE is configured to use (read from a constant or env). Cost is a soft display, not a billing source — slight inaccuracy is acceptable. Mock fallback covers the missing-model case.

### Q5: Cherrypick when source file is not in `code_ranges`

**What we know:** A node's `code_ranges` defines its source file set. The agent loop may produce a patch touching a file NOT in `code_ranges` (e.g., new file).

**What's unclear:** Should cherrypick allow this? If yes, does it update `code_ranges` automatically?

**Recommendation:** v1: allow new files outside `code_ranges` to be written by cherrypick (the patch is what the agent decided), but DO NOT auto-update `code_ranges`. Surface "Files written outside this node's tracked ranges: X, Y" warning in the cherrypick header. Phase 9+ may add an "extend code_ranges" affordance. Demo doesn't hit this case.

## Sources

### Primary (HIGH confidence)

- **Existing Phase 7 code** (`src-tauri/src/drift/{state,engine,watcher}.rs`, `src/components/inspector/ReconcilePanel.tsx`, `src/components/graph/contractNodeStyles.ts`): authoritative on `DriftLocks`, `compute_and_emit`, `SourceWatcher`, CVA variant chrome, Dialog shell.
- **Captured live session JSONL** (`~/.claude/projects/-Users-yang-lahacks-contract-ide/adda62e2-da18-4496-b95c-2b6cadb9a863.jsonl`): authoritative on `assistant.message.usage`, `tool_use`, `tool_result`, `timestamp`, top-level `type` set.
- **PROPAGATION.md** (`.planning/research/contract-form/PROPAGATION.md`): authoritative on schema v3 fields, pin-aware branching, `rollup_generation` semantics, hook-as-journal-not-prompter design, lazy migration.
- **RESEARCH.md** (`.planning/research/contract-form/RESEARCH.md`): authoritative on `## Examples` as load-bearing under token pressure (PACT 2025), sectioned markdown form, slot registry pattern.
- **Claude Code Hooks Reference** [`https://code.claude.com/docs/en/hooks`](https://code.claude.com/docs/en/hooks): PostToolUse JSON payload shape (`session_id`, `transcript_path`, `tool_input`, `tool_response`).
- **Tauri v2 plugin-shell docs** [`https://v2.tauri.app/plugin/shell/`](https://v2.tauri.app/plugin/shell/): `Command::spawn()` returning `Receiver<CommandEvent>`; `shell:allow-spawn` capability.
- **Tauri Discussion #8641** [`https://github.com/tauri-apps/tauri/discussions/8641`](https://github.com/tauri-apps/tauri/discussions/8641): worked example of streaming sidecar stdout.

### Secondary (MEDIUM confidence)

- **Pulldown-cmark crate docs** (crates.io 0.13): `Parser::into_offset_iter` returning `(Event, Range<usize>)` — verified pattern; need to confirm exact API in plan via `cargo doc --open`.
- **STATE.md** ledger of Phase 1–7 decisions: critical reuse points (e.g., `requireLiteralLeadingDot=false` for `.contracts/`, `tokio::sync::Mutex` chosen for Send-across-await).
- **Anthropic pricing pages** for Sonnet 4.5 / Opus 4.7 cost rates: rates change; verify at plan time, not commit time.

### Tertiary (LOW confidence)

- **claude-code-hooks-mastery** GitHub examples ([disler/claude-code-hooks-mastery](https://github.com/disler/claude-code-hooks-mastery)): community examples of PostToolUse usage. Verified shape matches official docs but specific patterns (e.g., `additionalContext` field) not validated against our use case.
- **Claude Code Hooks Guide 2026** ([smartscope.blog](https://smartscope.blog/en/generative-ai/claude/claude-code-hooks-guide/)): community guide; cross-checked one example against official docs.

## Metadata

**Confidence breakdown:**
- Existing-surface inventory: **HIGH** — read source directly, all paths verified.
- PostToolUse JSON payload shape: **HIGH** — official docs + community examples agree.
- Session JSONL parser fields: **HIGH** — verified against captured real session; defensive parsing eliminates schema-drift risk.
- Section parser approach (`pulldown-cmark` + offset_iter): **MEDIUM** — pattern is sound; exact API may need plan-time verification.
- Receipt cost rates: **MEDIUM** — hardcoded approach correct; specific numbers must be re-verified at plan time.
- Cherrypick atomic-write order: **HIGH** — POSIX rename semantics + Phase 7 single-writer pattern.
- MCP sidecar → Rust IPC mechanism (Q2): **MEDIUM** — recommended approach (CLI binary) is viable but not the only option; plan should evaluate.
- Pin-aware branching design: **HIGH** — PROPAGATION.md red-team-validated.

**Research date:** 2026-04-24
**Valid until:** 30 days for stable areas (existing surfaces, propagation design); **7 days for Claude Code session JSONL schema** (Anthropic ships frequently — re-capture a fresh fixture immediately before plan execution begins).

---

## Risk Register (Demo Survival Checklist)

For the 3-minute live demo, these are the concrete risks Plan 08 must close:

| Risk | Mitigation | Owner |
|------|------------|-------|
| Receipt card blanks on stage | Mock fallback in JSONL parser; unit-tested against captured live + 2 synthetic-malformed fixtures | Plan 08-04 |
| Beat 1 contract body rejected by parser | Use literal Beat 1 body from `presentation-script.md` lines 34-56 as Plan 08-01 fixture | Plan 08-01 |
| Hook script crashes on first invocation | `mkdir -p .contracts/journal`; idempotent; CI test "fresh repo + first hook" | Plan 08-03 |
| Concurrent writers on the same sidecar (hook-spawned `claude -p` + active-session saveContract + watcher) | All writers serialize through `DriftLocks::for_uuid(uuid)` Tokio mutex at the `write_contract` path; second writer re-reads post-first-write state | Plan 08-03 |
| Section parser disagrees on order between fixtures | Use `BTreeMap` (alphabetical); test asserts sorted-keys are stable across two fixtures with different visual order | Plan 08-01 |
| Lazy migration triggers write storm on launch | In-memory section_hashes for v2 reads; persist only on real writes; smoke test on 25-seed repo | Plan 08-01 |
| `rollup_generation` race silently overwrites | Generation-mismatch returns explicit error to UI; `accept_rollup_as_is` + `propose_rollup_reconciliation` both check | Plan 08-06 |
| Pin-aware reconcile silent SKIPPED-PINNED | Re-check pin under DriftLocks at write time; return error on mid-flight pin flip; UI toasts | Plan 08-06 |
| Cherrypick partial write goes silent | Atomic-rename order: source temps + sidecar temp first, then renames; partial state fires drift; observable | Plan 08-05 |
| `claude -p` output format surprise | Plan 08-04 Day-1 spike: invoke and confirm stdout shape before building chat panel | Plan 08-04 |
| `--output-format stream-json` not exposing session_id (Open Q1) | Fallback: directory snapshot diff against `~/.claude/projects/<key>/` | Plan 08-04 |
| Beat 2 banner layout shifts when Phase 13 adds rules-honored row | Reserve 3 rows from Phase 8 with `N/A` placeholder; snapshot test | Plan 08-04 |
| Section parser breaks on fenced `## ` inside code blocks | Use `pulldown-cmark` (CommonMark-compliant — handles fenced blocks correctly) | Plan 08-01 |
| Demo runs against stale Beat 2 banner format | Lock to absolute-stacked rows in Plan 08-04; spec-test against `presentation-script.md` literal lines | Plan 08-04 |

**Demo-load-bearing readiness gate** before Phase 8 close (Plan 08-06 UAT):
1. Beat 1 typing the literal contract body → no parser error, sidecar persists with v3 frontmatter.
2. Beat 1 click `Delegate to agent` (the Phase 11 button — but the runner ships in 08-04) → chat panel streams live `claude` output → receipt card shows non-zero numbers AND matches Beat 2 banner format.
3. PostToolUse hook, in headless `-p` mode, journals one entry to `.contracts/journal/<session>.jsonl`.
4. Edit a sidecar's `## Examples` section → upstream rollup_state flips to `stale` within 2s → amber pulse on graph → reconcile panel opens with pin-aware action set.
5. Cherrypick: edit contract body via inspector → click Approve → both files written atomically; verified by checking mtime-ordering on a successful write.

If 1–5 pass, Phase 8 closes. If any fail, fix before Phase 9 starts — Phase 9 builds the demo seed on top of this substrate.

---

*Research date: 2026-04-24*
*Valid until: 2026-05-24 (30 days) for stable areas; 2026-05-01 (7 days) for Claude Code JSONL schema specifics.*
