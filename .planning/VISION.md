# Contract IDE — Vision

**Status:** Drafted 2026-04-24 after Phase 7 completion. Supersedes the v1-only framing in `PROJECT.md` as the forward-looking target. v1 (Phases 1–9) ships first as the demo milestone; v2 (harvest-first substrate) is the next milestone.

## Thesis (one sentence)

**Intent is already captured in every Claude Code session — the product is harvesting it into a persistent, queryable substrate that humans navigate visually and agents query as long-term memory.**

## Why this exists

The terminal-agent workflow has a durable set of pains that no existing tool addresses:

1. **Goal articulation has no affordances.** Every session re-states the same constraints ("use tailwind", "no default exports", "canonicalize paths"). Copy-paste priming is the current workaround.
2. **Context window is opaque.** No way to know what the agent currently knows vs. doesn't.
3. **Sessions don't compose.** `CLAUDE.md` is static and global. Task-specific priming is reinvented every run.
4. **Diff review reads linearly.** A 47-file PR means mental translation of 47 diffs into one product-level change.
5. **Unrequested scope is invisible.** "Did the agent also touch something I didn't ask?" requires line-by-line review.
6. **Mental model decays.** Code gets written but not read. Three weeks later, nobody knows how checkout works.
7. **No session-to-session memory.** What the agent learned in session A is lost before session B starts. Retold every time.
8. **Decisions lose their why.** Code tells you *what*. Chat tells you *why*. Only chat gets captured — ephemerally — and then evaporates.

The file tree, LSP, autocomplete, syntax highlighting, debugger: all these are optimized for humans *writing code*. None of them help with the pains above, because the agent is doing the code writing. The post-agent IDE is a better place to do the things the agent can't: articulate intent, review what came back, maintain a mental model, and make judgment calls.

## The four primitives

### 1. Substrate

A local, SQLite-backed graph of typed nodes with bitemporal validity (timestamps for creation, when-fact-became-true, when-invalidated, internal versioning — pattern borrowed from Graphiti).

**Node types (MVP):**
- **Contract** — intent at a level (L0–L4), the existing Contract IDE v1 primitive
- **Constraint** — a rule that guides future work ("use tailwind", "canonicalize Rust path args")
- **Decision** — a choice made, with rationale and what was rejected
- **ResolvedQuestion** — a Q asked and answered in-session
- **OpenQuestion** — a Q raised but unresolved (the gold — durable unknowns)
- **Attempt** — something tried and abandoned, with reason

**Edges:** `implements`, `contradicts`, `supersedes`, `references`, `derived-from-session`, `derived-from-code`.

Every node carries provenance: `session_id`, turn reference, verbatim quote, actor (user/claude/derived), confidence (explicit/inferred).

### 2. Distiller

An ambient observer that watches Claude Code JSONL session files and extracts typed nodes into the substrate.

**Pipeline (validated 2026-04-24 in `research/constraint-distillation/`):**
1. Watch `~/.claude/projects/<cwd-key>/*.jsonl` (new sessions and, opt-in, historical backfill)
2. Filter via `jq` to user-text + assistant-text only (95% size reduction, zero signal loss)
3. Episode-chunk the conversation (sliding window per Graphiti's pattern)
4. Run a single LLM extraction prompt per chunk with a Pydantic-equivalent schema
5. Write typed nodes + edges to SQLite; run invalidation prompt against existing overlapping nodes

**Single extraction prompt handles both modes** — explicit rules stated in-session ("always use X") and inferred rules from bug-fix patterns ("bug was caused by empty-string FK → constraint: coerce to NULL"). The distinction is captured in the `confidence` field, not by running separate pipelines.

### 3. Retrieval

Semantic + multi-hop retrieval against the substrate, exposed through two channels:

**For agents (via MCP sidecar):**
- `find_constraints_for_goal(goal_text)` → ranked constraints via `applies_when` embedding match
- `find_decisions_about(topic)` → decisions + their rationale, with supersession applied
- `open_questions(scope?)` → unresolved Qs in this area
- Existing v1 tools: `find_by_intent`, `get_contract`, `list_drifted_nodes`, `update_contract`

**For humans (via the IDE):**
- Cmd+P fuzzy-by-intent (replaces file-tree navigation)
- Canvas (existing) now colors nodes by substrate state (fresh, stale, superseded, contested)
- Chat archaeology: "where was this choice made?" jumps to the source session, turn-level

### 4. Supersession (the moat)

Every prior-art memory system handles **fact-level supersession** (user's city changed from A to B). None handle **intent-level supersession** — where a prior decision becomes soft-invalidated not because a fact contradicts it, but because the *priority* behind it shifted upstream.

**Example.** Last quarter the L0 goal was "optimize for latency." A dozen L3/L4 decisions were made under that priority. This quarter the L0 shifts to "correctness first." None of the L3/L4 decisions are factually wrong, but every one of them is now *intent-drifted*. They may or may not still be the right call; a human needs to review.

The Contract IDE L0–L4 hierarchy is the unlock here — we have the hierarchy that lets us propagate a high-level priority shift down to every affected decision node. **No other memory system has this structure.**

This is the single most interesting claim of v2 and the hardest to validate.

## The two-source pattern

**Code tells you *what* conventions exist. Chat tells you *why* and *when* they apply.**

- **Code-based seeding** bootstraps the substrate on install: derive proposed constraints from code patterns (framework usage, import conventions, file naming), present as a curated list for human accept/reject. Solves the cold-start problem.
- **Chat-archaeology on ambiguity** is the high-value runtime behavior: when the agent hits uncertainty ("REST or gRPC here?"), it queries the distilled decision layer first; if silent, it embeds-searches raw session chunks for relevant prior turns. Every answer carries provenance back to the conversation where the choice was made.

Every existing tool has only one side of this. `CLAUDE.md` crams both into a static blob. Cursor rules manually capture the *what*. `git blame` timestamps the *when* but loses the *why*. Contract IDE v2 is the first system that harvests both automatically and makes them task-queryable.

## Roles

All roles write into the same substrate via different surfaces. **The substrate is singular; the views are skins.**

| Role | Primary surface | What they write | What they read |
|---|---|---|---|
| **Developer** | Chat + Inspector + Canvas | Session transcripts (via distiller); direct contract edits | All node types; constraints injected automatically into sessions |
| **PM** | L0–L2 overlay + Open Questions feed | Goal priorities; resolution of open questions | Flow-level contracts; decisions that affect priorities |
| **Designer** | Surface / Component / Atom overlay | Visual intent; design-token constraints | L2/L3 contracts; design-specific decisions |
| **Reviewer** | Diff-review canvas | Acceptance or supersession of prior decisions | Substrate state at PR-commit vs. HEAD; intent-drift flags |
| **New hire** | Cmd+P by intent; onboarding canvas | Nothing initially | Full distilled history — conventions, decisions, open Qs |

## Relationship to Contract IDE v1

**v1 is not replaced. It's the foundation.** Everything Phases 1–9 builds becomes the substrate's initial node type and infrastructure:

| v1 component | v2 role |
|---|---|
| L0–L4 contract hierarchy | One node type (Contract) in the substrate |
| react-flow canvas | Primary visual surface for all node types |
| Inspector + Monaco | Editor for any node type, not just contracts |
| MCP sidecar | Retrieval layer — v1 exposes 4 tools; v2 extends with constraint/decision/question queries |
| PostToolUse hook + journal (Phase 8) | **The kernel of the distiller** — v1's per-edit journaling extends to full session-level distillation in v2 |
| Drift detection (Phase 7) | **Generalizes from code↔contract to any edge type** — detects staleness across decisions, constraints, open questions too |
| Cross-level propagation (Phase 8) | **The intent-level supersession primitive** — already ships L0 → L4 propagation for contracts; v2 extends to decision nodes |

Nothing in v1 is invalidated. Several v1 pieces — the PostToolUse hook, the L0–L4 hierarchy, the drift watcher, the propagation model — are actually the *exact primitives* v2 needs. v2 is adjacent, not a pivot.

## Demo implications

v1's demo has three beats: cherrypick button color, mass-edit loading states, non-coder copy edit. All three are *doing* beats.

v2 opens a fourth beat category: **memory-and-comprehension beats.**

1. **Constraint injection** — "Run the same goal in vanilla Claude Code (N tokens, 12 tool calls, wrong framework guess) vs. Contract IDE (N/3 tokens, 2 tool calls, correct framework inferred from prior sessions)." Receipts side-by-side.
2. **Chat archaeology** — "Why did we use gRPC here?" → jumps to the session where the decision was made, shows the rationale in 20 seconds instead of 20 minutes of archaeology.
3. **Intent-drift on PR review** — a PR that compiles and passes tests but violates last-quarter's intent shift; Contract IDE flags it, code review tools don't.

Demo option A (conservative): ship v1 for the demo video, keep v2 as the "next milestone" story in the pitch. Low risk.

Demo option B (ambitious): ship v1 + the first v2 phase (session distiller + constraint injection demo beat) in the demo. Higher risk, stronger story. The constraint-distillation experiment (2026-04-24) shows the extraction primitive is ~half-a-day of implementation work; retrieval is cheap; the demo beat is compelling.

The right call depends on demo timeline — decided per `ROADMAP-REVISIONS.md`.

## Enterprise wedge

The constraint-management angle is a standalone enterprise product, not just a hackathon demo feature:

- **New-hire ramp:** new dev points Contract IDE at the codebase, gets a curated constraint feed distilled from 500 historical sessions. Week-one productivity is sub-linear right now; this moves the curve.
- **Convention enforcement:** constraints get injected into every agent session automatically. Senior devs' hard-won rules propagate without stale CLAUDE.md maintenance.
- **Decision archaeology:** "why did we do X?" has an answer shorter than Slack + git blame + asking around. Captured once, queryable forever.

These aren't demo-video beats — they're why a company would pay for the tool after the demo. Worth naming in the pitch explicitly.

## Open questions (v2 boundary)

These genuinely need user input — they aren't things more thinking resolves:

1. **Watcher scope**: ambient-global (install → indexes all `~/.claude/projects/*/`) vs. opt-in-per-repo vs. IDE-only-sessions. Ambient-global is the magical version but has privacy and cost implications (multi-LLM-call per episode ingestion).
2. **Historical backfill**: import weeks of prior sessions on install, or start fresh? Stale decisions from 6 months ago are noise; recent decisions are gold. Needs a cutoff heuristic.
3. **Non-coder write path**: can PMs edit decisions directly, or is their only write path through the agent? Coupling decision ownership to agent-mediated writes keeps the substrate clean; letting humans write directly risks the quality the distiller maintains.
4. **Intent-level supersession UX**: when a priority shift invalidates 40 prior decisions, what's the review workflow? Batch review, per-decision review, or auto-defer until the next time each decision is queried? This is a Phase 10+ design problem.
5. **Multi-user story**: local-first is the default. If two devs on the same repo have separate local substrates, do they merge? When? This might be a v3 concern; v2 can ship single-user clean.

---

*Related docs:*
- `.planning/PROJECT.md` — v1 canonical (current through Phase 9)
- `.planning/ROADMAP.md` — v1 phase breakdown
- `.planning/ROADMAP-REVISIONS.md` — proposed v2 milestone shape (see separate doc)
- `.planning/research/constraint-distillation/` — kernel experiment validating the distiller
