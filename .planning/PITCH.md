# Contract IDE — Pitch

**The operating system for software engineering intent.**

*Drafted 2026-04-24. Source of truth for judge-facing narrative, demo script, and positioning. Sibling docs: `VISION.md` (thesis + architecture), `ROADMAP-REVISIONS.md` (build plan), `research/constraint-distillation/` + `research/intent-supersession/` (validated primitives).*

---

## One-liner

> **GitHub stores your code. We store your reasons.**

Alt phrasings for different audiences:

- Technical: *"Docker was to containers what Contract IDE is to engineering intent — the reference implementation of a category nobody has named yet."*
- Enterprise: *"Every software team's institutional knowledge is evaporating. We're the memory layer for the agent era."*
- Poetic: *"We're ending the oral-tradition era of software engineering."*

## The shift nobody has named

Every AI coding tool in market — Cursor, Copilot, Windsurf — positions itself as a better way to **write code**. That's incremental.

The actual shift happening under our feet is different. **Code is no longer where the engineering work happens. Intent is.** Agents handle the translation from intent to code; they're getting good at it. But intent itself is still trapped in ephemeral conversations, scattered across Slack, Notion, PR descriptions, CLAUDE.md files, and agent sessions that evaporate the moment they end.

Every software organization on Earth is hemorrhaging institutional knowledge at a rate that compounds with agent adoption. Nobody has named the category this creates. We're building the category.

## The problem, stated big

Every software team accumulates institutional knowledge that evaporates:

- **Architectural decisions** — why gRPC over REST, why Postgres over Dynamo — stored in a Slack thread from eight months ago, unreachable
- **Coding conventions** — "use tailwind, no default exports, canonicalize paths" — copy-pasted into every CLAUDE.md, every session primer, every agent prompt
- **Design trade-offs** — the specific reason a button is 44px tall, not 48px — known only to the designer who made the call
- **Priority shifts** — "we're pivoting from speed to reliability" — announced in an all-hands, forgotten in six weeks, but every downstream decision made under the old priority is now silently wrong
- **Agent sessions** — every Claude Code conversation, containing goals + decisions + tried-and-rejected approaches + learned constraints — evaporates on session end, forcing the next session to re-learn from scratch

The AI-coding era makes this problem **compound, not easier**. Agents need context humans have. Humans waste time re-providing it every session. New hires take months to ramp. Priority shifts don't propagate through the codebase. Organizations are burning their knowledge at scale and don't see the fire.

## What Contract IDE is

**A visual, collaborative, real-time substrate for the conversations that run your codebase.**

Every agent session — in our IDE or in any terminal you're already using — is automatically captured, distilled into typed intent (goals, decisions, constraints, open questions), and added to a persistent graph. The graph is queryable by the agent on every future task and visually navigable by every human on the team.

### For each role

| Role | What the substrate means for them |
|---|---|
| **Developer** | Agent sessions stop leaking. Constraints inject automatically. Claude Code gets 3× better because it has long-term memory across your sessions. |
| **PM** | Every product decision is traceable to the session where it was made, with rationale intact. "Why did we do X?" has an answer in 20 seconds. |
| **Designer** | Design trade-offs live alongside the components they affect. Token decisions, interaction choices, failure states — all navigable. |
| **Reviewer** | PR review by intent, not by file. A 47-file diff reads as 4 intent-node changes in contract-diff form. Intent-drift flagged automatically. |
| **New hire** | Week-one productivity jumps. Point the IDE at the codebase and onboard by reading 500 distilled decisions — not by reading 50,000 lines of code or scheduling 20 "explain it to me" meetings. |

**One substrate. Every role. Every session. Every decision. Continuously maintained by the agents doing the work.**

## How it looks — the visual OS

The canvas is not a garnish. It's the shell of the intent OS. Other memory systems (Graphiti, mem0, Letta) are libraries — they give you an API. Other coding tools (Cursor, Copilot) give you a chat box inside a traditional editor. **Nobody has built the visual surface where intent is the first-class citizen.**

### Figma for engineering intent

The strongest visual analog is Figma:

- Figma put design on an infinite, zoomable canvas with nested frames and real-time collaboration — and in doing so became the operating system for product design.
- Contract IDE puts engineering intent on an infinite, zoomable, five-level canvas (Product → Flows → Surfaces → Components → Atoms) with real-time agent collaboration — and becomes the operating system for engineering intent.

Just like Figma unified the design conversation, Contract IDE unifies the engineering conversation.

### The specific visual primitives we ship

**The canvas (react-flow)**
- Infinite zoom from product-level down to atom-level
- Nodes represent intent: contracts, decisions, constraints, open questions — all visible in one graph
- Smooth transitions between zoom levels; 500+ nodes render at 50fps with virtualization
- `parentId + extent` hierarchical layout; dagre auto-layout with grid fallback for dense groups

**Multi-lens views over one substrate**
- **Journey lens** — flow by user experience ("checkout", "search", "auth")
- **System lens** — architectural dependency view
- **Ownership lens** — who maintains what
- Same substrate underneath. Different projections. Toggle with Cmd+K.

**Real-time state visualization**
- **Green** — synced (intent and code agree)
- **Red pulse** — code drifted from intent (fires within 2s of a file edit via the `notify` watcher)
- **Amber pulse** — intent drifted (rollup-stale — child changed but the higher-level contract citing it didn't update)
- **Gray** — untracked (no rollup inputs declared yet)
- **Orange pulse** — intent-drifted under a priority shift (the moat beat — flagged when an L0 priority change invalidates downstream decisions)
- Precedence: red > orange > amber > gray — you see health at a glance across the whole product

**The Inspector panel (four-tab anatomy per selected node)**
- **Contract tab** — the intent, editable, autosaving with merge-preserve (debounced 400ms + blur + Cmd+S)
- **Code tab** — Monaco with `setHiddenAreas` range-scoping — you see only the lines that implement this node, surrounding code dimmed; `⌘R` reveals in Finder, `⌘O` opens in your editor
- **Preview tab** — live localhost iframe for web targets; probed via `reqwest`; "Start dev server" prompt if unreachable
- **Receipts tab** — persistent history of every agent run against this node

**Live substrate updates**
- Run a Claude Code session in any terminal. Canvas animates new nodes in as the distiller ingests the session. You *see* your team's knowledge accumulate in real time.
- Not a static graph. A living one. Every session adds nodes, edges, constraint refinements.

**Side-by-side receipt comparison**
- Pin two receipts. 28px+ delta banner leads: `−72% tokens  −83% tool calls  −4.2× wall time`
- Visual proof of the product's value, visible in the UI, reproducible on camera.

**Diff-review mode**
- Paste a PR link. Canvas lights up: affected intent nodes pulse. Reviewer navigates by intent, not by file.
- Intent-drift nodes flagged even when the code passes tests — "this PR is factually correct but violates the priority shift from 2026-04-01."

**Decision-verification surface**
- Each L4 atom shows the implicit decisions baked into its current implementation — substrate-anchored rules (✓ honored / ✗ violated) AND agent-default choices (24h timeout, audit-log destination, async vs sync) — verifiable in product language without reading code.
- When a reviewer accepts an agent's default, it gets promoted to a substrate rule. Today's implicit choice becomes tomorrow's team rule. The substrate compounds in two directions: captured from explicit team conversations AND from agent defaults the team chose to keep.

**Semantic search everywhere**
- **Cmd+P** — fuzzy by intent, not by filename. "checkout button coupon" → ranked intent hits from the substrate, jump by Enter.
- **Cmd+K** — command palette with intent-aware actions: "show open questions in this flow", "flag this as superseded", "derive constraints from this module".

**Copy Mode pill (non-coder filter)**
- A single pill in the sidebar collapses the canvas to L4 atoms only, hides code tabs, exposes Given/When/Then as the primary editable surface.
- PMs and designers edit intent without ever seeing code. Contract changes trigger agent-mediated code changes with diff review.

**Chat archaeology**
- Every node carries provenance — click the `ⓘ` → opens the source session at the exact turn, shows the verbatim quote that justified the node. "Why did we decide X?" answered in 5 seconds with a scroll-to-turn.

### What this replaces

- **CLAUDE.md** — static global context blob. Replaced by task-specific constraint injection from the substrate.
- **Notion architecture docs** — human-maintained, decays. Replaced by continuously-distilled decisions with provenance.
- **`git blame` archaeology** — timestamps without rationale. Replaced by intent-provenance back to the source session.
- **PR file-by-file review** — linear slog. Replaced by canvas-lit intent diff review.
- **New-hire "explain it to me" meetings** — oral tradition, doesn't scale. Replaced by a queryable substrate of 500+ prior decisions and their reasons.
- **Endless re-priming of agent sessions** — copy-pasted constraints. Replaced by automatic constraint injection via MCP.

## The demo — 4 minutes, two laptops, one closed loop

**Structural choice:** the demo is a *live, two-laptop closed loop* with one full-screen recorded segment in Beat 2. Beat 1 happens on the PM's laptop (live). Beat 2 cuts to a recorded comparison that lands the measurable capability claim with vanilla Claude side-by-side. Beat 3 happens on the developer's laptop (live, with verifier + orange flag). Beat 4 closes the loop on the developer's laptop with a future task on a different surface, plus a brief recorded inset showing vanilla failing on the same task.

Full production-grade script: `.planning/demo/presentation-script.md`. Scenario spec: `.planning/demo/scenario-criteria.md` § Committed Scenario. The summary below is what someone reading the pitch needs to understand the demo arc.

**On-screen callouts during the recorded segments (28pt+, persist 8s+):**

1. **"5 rules captured from one incident. Vanilla doesn't know any of them."** (@ Beat 2 ~ 1:50)
2. **"Review by intent. Flagged when priorities shift."** (@ Beat 3 ~ 2:55)
3. **"The substrate compounds. Vanilla doesn't."** (@ Beat 4 inset ~ 3:45)

### Hook (0:00–0:15)

**On screen**: speakers in frame, both laptops on the table.

**NT**: *"AI agents are powerful. They still hit real limits — they don't remember what your team has decided."*

**T**: *"Every CLAUDE.md, every Slack thread, every architectural choice — your agents don't have it. We built the substrate that fixes that. One closed loop. Two laptops. Watch."*

### Beat 1 — PM trigger (0:15–0:50) — NT laptop primary

**On screen**: projector cuts to NT's laptop. A support-ticket excerpt flashes briefly:

> *Ticket #4471 — "I clicked Delete on my account last month and I just got charged again. Is anyone there? — Maya R."*

NT clicks the **Copy Mode pill** in the sidebar. Canvas filters to L4 atoms; code disappears. NT hits `⌘P`, types `account settings`. Picks `AccountSettings.DangerZone`. Inspector opens with the Contract tab active. NT types Intent + Role + Examples in product language — never names a database, an API, or a Stripe call.

NT clicks the **`Delegate to agent`** button. A small overlay appears: *"Composing prompt: contract body + 5 substrate hits + L2 surface context..."* — then a `Sent to agent` status pill.

**NT**: *"Intent in product language. The system reads my contract atom, walks its position in the graph, pulls the constraints that apply, composes the agent's prompt — and dispatches. The agent never gets a vague request."*

### Beat 2 — Agent execution (0:50–2:05) — full-screen recording ⭐ the capability claim

**On screen**: projector cuts to a full-screen recording with two panes throughout. Left: Contract IDE agent. Right: bare Claude Code in a terminal. Same prompt. Same model.

A brief annotation overlays the left pane for the first ~10 seconds explaining contract-anchored retrieval (graph-edge scoping + applies-when match + LLM re-rank — the answer to *"isn't this just RAG over chat?"*).

Five substrate hits stream into the left pane, all from the same February 2026 deletion-incident thread:

- `dec-soft-delete-30day-grace-2026-02-18`
- `con-anonymize-not-delete-tax-held-2026-03-04`
- `con-stripe-customer-archive-2026-02-22`
- `con-mailing-list-suppress-not-delete-2026-03-11`
- `dec-confirm-via-email-link-2026-02-18`

Contract IDE writes a 5-file change first try. Bare Claude greps for delete patterns, finds nothing specific, defaults to `await db.user.delete({ where: { id }})` — one line, defensibly correct against the schema, wrong against five operational rules the team learned the hard way.

**The on-screen rubric** slides up across the bottom (persists ~10s) — the team rules being checked against each agent's output:

```
┌─────────────────────────────────────────────────────────────────┐
│  Team rules — captured Feb 2026, after the deletion incident    │
├──────────────────────────────────────────────┬───────┬──────────┤
│                                              │ Bare  │ Contract │
│                                              │ Claude│ IDE      │
├──────────────────────────────────────────────┼───────┼──────────┤
│  1. Soft-delete with 30-day grace            │   ✗   │    ✓     │
│  2. Keep tax records (anonymize, not delete) │   ✗   │    ✓     │
│  3. Archive Stripe customer (don't delete)   │   ✗   │    ✓     │
│  4. Suppress mailing list (CAN-SPAM)         │   ✗   │    ✓     │
│  5. Email-link confirmation, not just modal  │   ✗   │    ✓     │
└──────────────────────────────────────────────┴───────┴──────────┘
```

Receipt comparison banner alongside the rubric:

> **Contract IDE: ~1,400 tokens · ~3 tool calls · 5/5 rules honored**
> **Bare Claude: ~7,200 tokens · ~22 tool calls · 0/5 rules honored**

**On-screen callout (1:50–2:00, 28pt)**:
> **5 rules captured from one incident. Vanilla doesn't know any of them.**

**T (over recording, last ~10s)**: *"Receipts tell you how efficiently. The rubric tells you what specifically. Five rules the team learned by getting burned in February — every one of them invisible from the code. The substrate carries the team."*

### Beat 3 — Developer review (2:05–3:15) — T laptop primary ⭐ the moat

**On screen**: projector switches to T's laptop. T clicks **`Sync`**. Canvas pulses three affected nodes. Sidebar renders a 6-line intent summary, not a code diff — each line ends with a citation back to the substrate decision behind it. T clicks `[source]` on the Stripe-archive line; Monaco scrolls to the exact `stripe.customers.update(...)` call.

T clicks **`Verify against intent`**. Stream of green checks for all five substrate constraints, an `ℹ Implicit decisions` group surfacing agent defaults that no team rule covered (24h email-link expiry, `audit_log` destination, async cleanup), then **one orange flag**:

> ⚠️ *Parent surface (Account Settings) holds `con-settings-no-modal-interrupts-2025-Q4` — derived 2025-Q4 under priority `reduce-onboarding-friction`. Current priority since 2026-04-01 is `compliance-first`. The new modal interrupt may be intended; review.*

T clicks the flag. Side panel opens with priority history. T types: *"Destructive actions require confirmation modals; the no-modal rule applies to non-destructive Settings interactions only. Narrowing the parent constraint."* Accept. Orange clears. Merge.

**On-screen callout (2:55–3:05, 28pt)**:
> **Review by intent. Flagged when priorities shift.**

**T**: *"Verifier caught it; tests didn't. This is the moat — fact-level memory tools can't do this. They don't have a goal hierarchy."*

### Beat 4 — Closed loop (3:15–3:50) — T laptop + brief recorded inset

**On screen**: harvest panel notification slides in: *"5 nodes captured from this session — DangerZone contract atom, reviewer note, scope refinement on the parent constraint, customer ticket, PR merge."*

A new ticket flashes: *"Yesterday's ticket — enterprise customer wants to delete their team workspace, not just their personal account."*

T opens a Claude Code terminal. Types: `add a delete-workspace button to the team settings page`. Substrate query streams. **All five rules from this morning surface again, plus the just-derived `AccountSettings.DangerZone` contract as a recent reference.** Agent writes a 5-file workspace-scoped change first try — org invoices anonymized, workspace Stripe customer archived, member tokens revoked, owner-orphan check added.

> **Contract IDE: ~1,200 tokens · ~2 tool calls · 5/5 rules honored**

⏵ Brief recorded inset (8s, full-screen): bare Claude on the same prompt. Greps for `Workspace`, writes `await db.workspace.delete({ where: { id }})`. Same shape of failure, on a new surface.

> **Bare Claude: ~6,800 tokens · ~19 tool calls · 0/5 rules honored**

**On-screen callout during inset (3:45, 28pt)**:
> **The substrate compounds. Vanilla doesn't.**

Cut back to T's laptop. **Three new substrate nodes animate into the canvas** — two captured from the workspace-delete implementation, one promoted from this morning's implicit default after reviewer accepted it:

- `+ con-cascade-revoke-tokens-on-org-delete-2026-04-25` — *"Revoke member access tokens immediately on org delete (don't wait for 30-day grace)."*
- `+ dec-owner-orphan-check-2026-04-25` — *"Org delete requires solo-owner OR explicit ownership transfer."*
- `+ dec-confirmation-timeout-24h-2026-04-25` `[⌃ promoted from implicit]` — *"Email confirmation links expire in 24h — agent default this morning, reviewer accepted, now a team rule."*

**T**: *"Three new rules. Two from workspace-delete code. One promoted — agent's morning default, reviewer accepted, now a team rule. The substrate compounds three different ways."*

### Close (3:50–4:00)

**On screen**: speakers back in frame. T's laptop in background.

**T**: *"Devin re-derives context every task. Windsurf re-reads your codebase every session. We're MCP-native — plug either of them into our substrate, they stop forgetting."*

**NT**: *"GitHub stores your code. We store your reasons."*

**NT**: *"Happy to take questions."*

## The moat — three layers, all demonstrated

1. **Harvest-first design** — zero human write tax; substrate is a by-product of conversations you're already having. No other system has a zero-tax capture mechanism — they all require humans to write into them.
2. **Agent-first queryable** — MCP tools inject relevant context into every Claude Code session automatically, measured delta against vanilla Claude Code. Validated 2026-04-24 in `research/constraint-distillation/` — 14 real constraints extracted from 2 sessions, 4/4 retrieval hit rate on synthetic goals, zero false positives.
3. **Intent-level supersession** — *nobody else does this.* The prior-art survey of every major agent memory framework (Graphiti, mem0, Letta, Cognee, MemOS) explicitly flagged this as an open gap. Stress-tested 2026-04-24 against a real Claude LLM: 9/10 exact match on adversarial fixtures with priority-keyword red-herrings. The moat holds.

These three stack. Any one of them alone is a feature. Together they're a category.

## Why now

Three converging shifts, all less than 18 months old:

1. **Agents actually write code.** Claude Code, Cursor agents, GitHub Copilot Workspaces. The bottleneck moved from *writing* to *intent articulation*. This wasn't true in 2023.
2. **LLMs are cheap enough to maintain a knowledge graph humans couldn't afford.** In 2020, this product was impossible — the cost of re-deriving + re-validating a graph every few sessions was prohibitive. Today a single Sonnet-tier distillation run costs pennies per session.
3. **MCP standardized agent-to-knowledge retrieval.** Before Model Context Protocol (shipped late 2024), every agent+memory integration was bespoke. Now it's a four-tool interface any Claude Code session can call by default.

The window to own this layer is open and short. First-mover advantage on category naming is real. Docker didn't invent containers; they named the category and shipped the reference implementation.

## Market

**Wedge: individual developer using Claude Code.** Download the IDE. Point it at a repo. Substrate populates from prior sessions. Constraint injection makes every future session 3× more effective. Personal productivity play.

**Expansion: engineering team.** Shared substrate becomes team memory. Onboarding, convention enforcement, PR review, priority propagation. Team-level productivity play.

**Scale: engineering organization.** The substrate becomes the system-of-record for *why* the codebase exists the way it does. Architectural ADRs, design decisions, priority history, deprecation audit trail. Organizational intelligence play. This is where it competes with Notion + Linear + Slack-as-archive — not on any single feature, but on being the one place intent lives.

## What we've validated

Not claimed — built and tested:

- **Contract graph + inspector + MCP retrieval** — Phases 1–7 complete 2026-04-24
- **Constraint distillation from real sessions** — `research/constraint-distillation/` — 14 constraints extracted from 2 real Claude Code sessions, validated retrieval on 4 synthetic goals (4/4 hits, 0 false positives)
- **Intent-level supersession against a real LLM** — `research/intent-supersession/` — 9/10 exact match on adversarial fixtures with priority-keyword traps
- **Drift detection across concurrent writes** — Phase 7 stress-tested 10 rapid edits, zero lost drift flags

What's *planned* but not yet built:
- Session watcher + distiller pipeline (Phase 10)
- Constraint-injection demo beat (Phase 11 slice)
- Intent-drift supersession beat (Phase 12)

The demo video will show all three validated + the three planned demoed in their target state. The pitch is grounded.

## The closing claim

> **Every software team's knowledge is evaporating. We built the substrate that captures it.**
>
> **Code is what gets shipped. Intent is what the team actually runs on.**
>
> **Devin re-derives context every task. Windsurf re-reads the codebase every session. Plug either into our substrate via MCP — they stop forgetting.**
>
> **GitHub stores your code. We store your reasons.**

---

*Document status: draft. Iterate as the demo script gets rehearsed and the pitch gets tested against real humans.*
