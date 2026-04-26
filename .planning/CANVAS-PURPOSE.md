# Canvas Purpose — The Agent-Decision Verification Surface

**Status:** Drafted 2026-04-24. **Revised 2026-04-24 (this conversation)** — vertical-flow rendering with two trigger types (rendered screen vs. structured card) supersedes the abstract L0–L4 atom-zoom treatment. Sibling docs: `PITCH.md` (positioning), `VISION.md` (thesis), `ROADMAP.md` (build plan), `demo/presentation-script.md` (the locked 4-beat demo this doc traces against).

## The job, in one sentence

> **The canvas renders every flow your product runs as a vertical chain of participants — each in the medium its caller sees — with every implicit decision surfaced as a verifiable fact on its atom.**

## Why this framing — alternatives ruled out, two revised

| Framing tried | Status |
|---|---|
| File-graph with edges as imports | Ruled out — files too granular; "file tree but visual" |
| Primary navigation surface (canvas as nav) | Ruled out — `⌘P` semantic search does the actual work |
| Abstract L0–L4 zoom on contract atoms | **Revised 2026-04-24** — see "the redesign" below |
| Multi-agent supervision dashboard | Ruled out — claude-squad / Conductor / Devin own that category |
| Visual-preview-with-click-to-component (commodity) | **Revised 2026-04-24** — see below |
| All-in-one PM/designer/dev tool | Ruled out — $100M+ category fight |
| "Pretty intent map" | Ruled out — a static sidebar would do the same job |

**On "visual-preview-with-click-to-component":** the *commodity* version (v0 / Lovable / Bolt) was correctly ruled out — clicking a component shows source, which every browser DevTools already does. The **verification** version (this redesign) is qualitatively different: clicking a component surfaces the *implicit decisions baked into its current implementation, in product language, with substrate provenance*. Same gesture, different payload — the substrate-anchored decision facts are the moat, not the rendering.

**On abstract L0–L4 zoom:** the original spec asked the user to navigate five levels of an abstract graph to reach an atom. The L0–L4 hierarchy is correct as a *data model* (Phase 1–7 builds on it; Phase 8 PROP-01..04 depends on it) but wrong as a *user interface* — five zoom levels of abstract nodes is the "messy graph" the canvas is supposed to escape. **The redesign keeps the L0–L4 data model and replaces its visual treatment** with two concrete affordances:

- **L0 / L1 → sidebar** (repository tree, area drift counts) — not canvas surface
- **L2 → flow chain** on canvas (vertical, call-shape edges, one trigger card at top + N participant cards below)
- **L3 → trigger card** that's the externally-observable interface to its caller (rendered iframe for UI; structured card for backend endpoint / CLI command / cron / webhook)
- **L4 → atom chips** on the trigger card (overlays on iframe components for UI; side chips for backend cards)

The data model preserves the L0–L4 hierarchy unchanged; the canvas surfaces only L2 and L3 (with L4 as decoration on L3).

## The pain it solves

When a dev (or PM, or designer) tells an agent *"implement a signup screen"*, the agent makes ~30 implicit choices in the act of writing code:

- Password: min length, capital required, special char required, max length, breach-check, strength-meter shown/hidden
- Email: validation regex strictness, normalization, disposable-email blocklist
- Confirm-password field: present/absent
- Verification: email link / 6-digit code / none, expiry window
- Session: duration, refresh strategy, concurrent-session policy
- Captcha: present/absent, threshold
- Rate limiting: attempts/window, cool-off
- Welcome email: send/skip
- Locale: detected/defaulted
- Terms acceptance: checkbox / inline / modal

The diff shows the **implementation** (a Zod schema, a function call, a regex). It does **not** show the decision in product language. Reading 80 lines to recover *"the agent picked min 8 with special-char required"* is friction that scales linearly per atom and quadratically per multi-atom surface.

**The canvas's job is to surface these as first-class facts on the atom they live on, in product language, with substrate provenance where applicable — and to render the flow they belong to in the medium the caller already sees.**

## What the canvas uniquely provides

Diff, chat-history, file-tree, terminal, and structured panels all *can* show decisions one-at-a-time. None render the flow's full participant chain in the caller's native medium. Specifically:

- **Diff** is post-hoc and at code abstraction
- **Chat history** is linear, no spatial concept
- **A flat panel** works for one atom; clutters for a flow with 5+ participants
- **The substrate (database + MCP)** is queryable but invisible until queried
- **The canvas** = a vertical flow chain, each participant rendered as the externally-observable interface its caller sees, atoms surfacing decisions baked into current implementation

## How it materializes — flow + trigger + atom

### Flow view (the daily scan, L2)

A vertical chain of participant cards. The **trigger** sits at the top (rendered screen, endpoint card, CLI command, cron schedule, webhook event — depending on what initiates the flow). Below it, services / DB writes / external calls / lib calls stack in invocation order. **Edges between participants carry call-shape** — `{userId} → {deletionId, gracePeriodEnds}` — so the canvas teaches the caller's mental model on the way down.

```
   [ Account Settings — rendered iframe ]
                  │
                  │  click → POST { confirmation_token }
                  ▼
   [ POST /api/account/delete — endpoint card ]
                  │
                  │  beginAccountDeletion({ userId, token })
                  ▼
   [ beginAccountDeletion — lib card ]
                  │
                  │  { userId, deletedAt, graceEnd }
                  ▼
   [ db.user.update — data card ]
                  │
                  │  { customerId }
                  ▼
   [ stripe.customers.update — external card ]
                  │
                  │  { listId, email }
                  ▼
   [ mailchimp.suppress — external card ]
                  │
                  │  { userId, gracePeriodEnds }
                  ▼
   [ sendDeletionConfirmationEmail — lib card ]
```

Each participant card surfaces:

| Element | Source |
|---|---|
| Name + kind | `nodes.kind` (UI / API / data / job / external) |
| Intent (1-line) | Contract `## Intent` |
| Drift indicator | Phase 7 watcher (red pulse) |
| Substrate-rule chip count | Phase 11 retrieval |
| Atomic chips (decisions on this participant) | L4 nodes anchored to this L3 |
| Substrate-state coloring | Phase 13 (fresh / stale / superseded / intent-drifted) |

### Trigger view (the unit of editing/reviewing, L3)

The trigger card expands into the surface where atoms live. Two rendering modes:

**UI mode** (`kind: UI` triggers): rendered iframe of the screen at its `route`, with absolutely-positioned overlay chips on each atomic component. Phase 9 ships the Babel/SWC plugin that injects `data-contract-uuid` for chip-to-atom mapping; Tauri parent renders chip overlays via `postMessage` from iframe. Hover a chip → atom inspector slides in.

**Structured mode** (backend triggers — `kind: API / job / cron / event / lib`): Stripe-API-docs-style card showing request schema, response schemas, side effects (substrate-anchored rules), and atomic chips on the side. Method-colored badges (POST green, DELETE red), syntax-highlighted JSON, monospace paths. Same hover → inspector machinery.

```
┌─ POST /accounts/:id/delete ────────────────────┐
│                                                │
│  Request:  { confirmation_token: string }      │
│                                                │
│  Responses:                                    │
│    200 → { deletion_id, grace_period_ends }    │
│    401 → { error }                             │
│                                                │
│  Side effects (5 substrate rules ✓):           │
│    • soft-delete with 30-day grace             │
│    • anonymize tax-held invoices               │
│    • archive Stripe customer                   │
│    • suppress mailchimp                        │
│    • send confirmation email                   │
└────────────────────────────────────────────────┘
   atoms:
     • input validation        [⚠ drift]
     • auth check
     • rate limit
     • beginAccountDeletion()  [⚠ rollup-stale]
```

### Atom inspector (decision verification, single atom — L4 inspector)

| Element | Source | Example |
|---|---|---|
| **Contract** (Intent + Role + Examples) | `.contracts/<uuid>.md` body | "user creates a strong password…" |
| **Substrate-anchored decisions** | Phase 11 retrieval scoped by graph edges | `dec-soft-delete-30day-grace ✓ honored — deletedAt set, no hard delete` |
| **Default-derived decisions** *(v2)* | Decisions manifest from agent / post-hoc extraction | `password.min_length: 8 — agent default; no substrate rule` |
| **Drift indicator** | Phase 7 watcher (`code_hash` vs `contract_hash`) | red pulse |
| **Substrate state** | Phase 12 + 13 (fresh/stale/superseded/intent-drifted) | orange flag (priority-shifted) |
| **Code references** | Phase 4 inspector → Monaco range scope | `lib/auth/password.ts:42-80` |

## Backend-only repos

A repo with no UI surfaces (HTTP API, CLI tool, library, ETL, microservice) renders entirely in **structured mode**. Same canvas geometry; only the trigger visual changes by `kind`:

| Repo type | Trigger card |
|---|---|
| HTTP API | Method-colored endpoint card (`POST /accounts/:id/delete`) with request/response schemas |
| CLI | Terminal frame (`$ tool delete-user --id=42`) with flag/argument schemas |
| Worker / cron | Schedule card (`cron: 0 * * * * → cleanup-stale-sessions`) |
| Webhook-driven | Event card (`event: stripe.customer.subscription.deleted`) |
| GraphQL | Resolver schema card |
| Public library function | Syntax-highlighted signature card |
| gRPC | RPC method / proto card |

The Babel plugin doesn't run for backend-only repos — cards render directly from contract frontmatter (which gains `## Inputs` / `## Outputs` / `## Side effects` sections per the v2 sectioned-markdown contract form, see `.planning/research/contract-form/RESEARCH.md`).

**The UI repo is the special case** (with iframe + Babel plugin). **The backend-only repo is the default case** — same canvas, no iframe. Same flow chain. Same atom chips. Same inspector.

### Edge cases

| Construct | How it lands |
|---|---|
| **Middleware** running across many endpoints | Shared atom chip rendered as a ghost reference (DATA-05) on each endpoint card it touches |
| **Database migration** | Not an L3 — an event that flips drift state on data atoms |
| **Background job triggered by another job** | Two flows linked by an event card; "see what calls this" walks across flows (v2 polish) |
| **Branchy flows** (success/failure paths) | Single chain with collapsible alternative paths; v2 if it gets messy |
| **Polyglot monorepo** | Each repo's flows render in its native idiom; sidebar groups by area regardless of language |

## What this means for each user

| Role | What they ask the canvas |
|---|---|
| **Dev** | "I asked for a signup screen — did the agent pick reasonable defaults? Where do they disagree with our team's rules?" |
| **PM** | "Password min is 8; we told customer support it's 12. Fix." |
| **Designer** | "Confirm-password field is present; design called for dropping it. Fix." |
| **Reviewer** | "5/5 substrate rules honored; 1 inherited parent constraint flagged. Approve or refine." |
| **New hire** | "Why does the delete-account button confirm via email link? Click `[source]` → original Feb-2026 incident thread." |
| **Backend-only dev** | "What does this endpoint actually do? Card shows request/response, side effects, and the 5 rules they honor. No code-reading needed." |

## Cross-check vs. roadmap phases

| Capability needed | Where it lives | Status |
|---|---|---|
| Contract on each atom (the *intent* half) | Phase 2 (frontmatter) + Phase 4 (inspector display) | ✅ Done |
| `code_ranges` on each atom | Phase 2 frontmatter | ✅ Done |
| Code-vs-contract drift indicator | Phase 7 watcher + visual states | ✅ Done |
| L0–L4 hierarchy (data model) | Phase 2 schema | ✅ Done |
| Substrate constraints scoped to atoms | Phase 11 (distiller + contract-anchored retrieval) | 🔶 Planned (demo-load-bearing) |
| **Verifier output: "did agent honor each substrate rule?"** | Demo Beat 3 + Phase 11/12/13 | 🔶 Planned (demo-load-bearing) |
| Cross-level rollup-stale propagation (amber pulse) | Phase 8 PROP-02 | 🔶 In flight |
| Intent-level supersession (orange flag) | Phase 12 | 🔶 Planned (the moat) |
| Citation `[source]` jumps from decisions to source session | Phase 13 SC 3 (chat archaeology) | 🔶 Planned |
| **Vertical flow chain rendering (L2 view)** | Phase 13 (supersedes Phase 3 abstract-graph treatment) | 🔶 Planned (new) |
| **Iframe + Babel plugin (L3 UI mode)** | Phase 9 (09-04 absorbs) | 🔶 Planned (new) |
| **Structured trigger cards (L3 backend mode)** | Phase 13 | 🔶 Planned (new) |
| **L0/L1 → sidebar collapse** | Phase 13 | 🔶 Planned (new) |
| **Atom chips on trigger cards (L4 visual)** | Phase 13 | 🔶 Planned (new) |
| **Call-shape edges between participants** | Phase 13 (renders from contract `## Outputs` → next contract `## Inputs`) | 🔶 Planned (new) |
| Per-atom implementation-decisions manifest — **demo narrow slice** | Phase 11 SC 7 + Phase 13 SC 7 | 🔶 Planned |
| Per-atom implementation-decisions manifest — **broader v2 (full coverage + 2-pass auditor)** | Future Phase 14 (next milestone) | ⚠ v2 extension below |

**Read the rightmost column carefully.** The 2026-04-24 redesign moves five rows from existing phase scope into Phase 13's reworked surface (and one row, the Babel plugin, into Phase 9's demo-repo provisioning). The data model is unchanged; the visual treatment at L2/L3/L4 is new. Phase 1–7 work is preserved; Phase 3's abstract-graph rendering is superseded by the trigger/participant treatment but the underlying react-flow infrastructure carries forward.

## How the demo demonstrates this

| Beat | Where the framing shows up |
|---|---|
| **Beat 1** (PM trigger) | NT does Cmd+P → lands at the **L3 trigger view** for `AccountSettings.DangerZone` (rendered Account Settings iframe, atom chips visible). NT clicks the danger-zone-button chip → atom inspector opens with Contract tab. NT writes Intent + Role + Examples. The atom-as-decision-attachment unit is established visually. |
| **Beat 2** (recorded comparison) | The 5-row rubric ✓/✗ panel **is** the decision-verification surface, applied to substrate-anchored rules. *"Receipts tell you how efficiently. The rubric tells you what specifically."* The rubric rows correspond to atoms / participants the agent touched. |
| **Beat 3** (developer review) | T clicks Sync. Canvas pulses **the rendered Account Settings screen at top + 3 service cards in the call chain below** — far more cinematic than three abstract nodes. Sidebar streams 6 green checks + 1 orange flag against atoms in the chain. T clicks `[source]` on any decision. Two clicks to investigate any decision in the PR. |
| **Beat 4** (closed loop) | New flow renders: Team Settings rendered iframe at top + parallel call chain below (shared service cards visible as ghost references with the morning's atoms still attached). 2 new rules harvest back as new atom chips animating onto the workspace-delete service card. The decision-verification surface compounds — what was verified once is default for the next caller. |

**Every beat is a manifestation of the framing.** The canvas isn't decoration in the demo — it's decision verification at four different timescales (authoring, comparison, review, compounding), with the *rendered medium* of each flow making it instantly legible to whichever role is on stage.

### Demo insertion points — narrow slice (added 2026-04-24, preserved through redesign)

Two specific insertions take demo coverage from ~85% to ~95% without expanding scope:

| Insertion | Beat | What changes |
|---|---|---|
| **Implicit-decisions group in verifier output** | Beat 3 | Verifier panel adds an `ℹ Implicit decisions` group between substrate-honor rows and the orange-flag warning. 3 rows hand-crafted for `AccountSettings.DangerZone`: 24h email-link expiry, `audit_log` destination, async cleanup job. T scans in 3 seconds and verifies defaults match intent. |
| **Promoted-from-implicit badge in harvest panel** | Beat 4 | Harvest animation gains a third item — `dec-confirmation-timeout-24h-2026-04-25` with a `[⌃ promoted from implicit]` badge. T's narration becomes: *"Three new rules — two from workspace-delete code, one promoted from agent's morning default after I accepted it. Three different kinds of compounding."* |

**Don't** expand Beat 2's rubric. The 5/5 vs 0/5 punch survives by being all-team-rules; mixing in implicit-decision rows would show parity in places and dilute the differentiation. The narrow slice lives in Beats 3 and 4 only.

Build cost is ~1 day distributed across Phase 11 (manifest emission, ~3h) and Phase 13 (verifier UI extension + Beat 4 polish, ~5h). Both narrow slices fit inside existing phase scopes as additional success criteria (Phase 11 SC 7 + Phase 13 SC 7).

## v2 extension — the broader manifest + 2-pass auditor

The narrow slice (Phase 11 SC 7 + Phase 13 SC 7) covers the demo with hand-crafted manifests for two atoms. The v2 extension generalizes:

### What v2 adds

1. **Beyond hand-crafted atoms.** Any atom in a real product carries 5–30 implicit decisions. Production-grade manifest emission means the agent reliably surfaces them across arbitrary contracts — not just hand-tuned for a demo scenario.
2. **2-pass auditor pattern.** A working agent has completion-bias: it documents what it consciously decided, misses what it did by reflex (negative-space decisions — *"the form has no name field; agent silently decided it isn't needed"*). A fresh auditor agent reads the final code and surfaces unsurfaced decisions. Triggered on-demand ("audit this atom") rather than every write — ~$0.01–0.05/audit, reasonable as a manual button.
3. **Post-hoc extraction route.** AST + LLM analyzer extracts decisions from any agent's output (including bare Claude Code), useful for the *"point at an existing repo"* onboarding path.

### Where this lives

Likely a dedicated phase in the next milestone (provisional name: **Phase 14 — Implementation Decisions Manifest, full coverage**). Schema additions:
- `decisions` field on atom-level frontmatter (or a sibling table)
- Auditor agent prompt + invocation (manual trigger)
- AST analyzer for non-IDE-mediated agent paths
- Decisions diff in receipt cards (decisions added/removed/changed across runs)

**Do not absorb into phases 8–13 beyond the narrow slice.** The 5-rule rubric + 3-row implicit-decisions group + 1 promoted-rule badge is sufficient to demonstrate the framing; broader manifest emission is v2 polish that risks scope-creep on the locked demo timeline.

## Pitch language

For judge-facing or external messaging, the canonical line:

> **Diff tells you what changed. We tell you what the agent decided — in your team's language, against your team's rules, on every atom of your product, rendered the way your callers see it.**

For internal product debate, the framing's named identity:

> **The canvas is the agent-decision verification surface. Every flow renders as a vertical participant chain; every participant renders in the medium its caller sees; every atomic decision surfaces as a fact on the atom.**

Use the latter when discussing scope, build sequencing, or daily-use jobs. Use the former when discussing positioning.

## What this doc replaces / clarifies

- **Replaces** the abstract-L0–L4-zoom visual model that drove Phase 3's original spec. The L0–L4 hierarchy stays as the data model; the visual treatment is now sidebar (L0/L1) + flow chain (L2) + trigger card (L3) + atom chips (L4).
- **Replaces** the vague *"intent map"* / *"contract graph"* shorthand for the canvas. The canvas is not a map; it's a medium-aware verification surface.
- **Clarifies** the canvas's relationship to terminal+diff: terminal+diff cover ~80% of the daily loop (single-agent, single-change, single-file). The canvas covers the remaining 20% — *what did the agent decide, and does it match intent?* — at product-concept granularity, in the caller's native medium.
- **Settles** the recurring debate about whether the canvas is necessary. **Yes**, but its scope is narrow and named: decision verification at flow / trigger / atom granularity, not navigation, not multi-agent ops, not visual preview-as-end-in-itself.
- **Locks** the v1 demo posture: ship the rendered-iframe-with-atom-chips for UI screens, the structured cards for backend participants, and the 5-rule rubric / substrate-state coloring on top of both. Ship the broader implementation-decisions manifest as a deliberate v2.

## Revision history

- **2026-04-24 (initial draft)** — Canvas defined as decision verification surface; ruled out file-graph, primary nav, multi-agent supervision, visual-preview-with-click-to-component (commodity), all-in-one PM/dev tool. Three-view materialization (L4 atom / L3 surface / L0–L2 zoom).
- **2026-04-24 (this revision)** — Vertical flow chain replaces abstract zoom. L3 splits into UI mode (rendered iframe + overlay chips) and structured mode (Stripe-docs-style cards). Backend-only case made first-class. L0/L1 demoted to sidebar. Visual-preview-with-click revised from "ruled out" to "in scope" with the verification-not-just-rendering distinction. Data model (L0–L4 hierarchy in frontmatter) preserved unchanged.
