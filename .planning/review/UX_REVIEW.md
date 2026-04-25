# UX Review: Contract IDE
**Reviewer:** Independent UX Reviewer
**Date:** 2026-04-24
**Scope:** Demo UX viability, wireframe layout, shot-by-shot script, risk assessment
**Based on:** PROJECT.md, REQUIREMENTS.md, ROADMAP.md, FEATURES.md, PITFALLS.md

---

## 1. Survival Check — Brutal Honesty

**Verdict: The thesis survives with one critical edit and two conditional passes.**

### Five-Level Zoom: Will It Read in 3 Seconds?

Not as designed. Five levels is one too many for a 3-minute video. The demo repo
only ever descends to L3 (Components) in Beat 1. L4 (Atoms) appears only in Beat 3.
If a viewer watches the cold open and sees L0 → L1 → L2 navigation, then Beat 1
drills to L3, they have processed three zoom events before the first meaningful action.
That is too much orientation tax.

Recommendation: The demo video should start already zoomed to L1 (Flows visible).
Breadcrumb shows "vercel/commerce > Checkout." The viewer is oriented immediately.
Reserve the L0 pullback for the thesis section as a "here's the whole picture" moment,
then never return to it. This collapses the navigation overhead from three zoom hops to
one per beat.

Zoom speed itself is fine if react-flow is built to spec. A 300ms ease-in-out
transition between zoom levels reads as snappy on camera, not sluggish — as long as
`onlyRenderVisibleElements` is on and child nodes load in under 100ms from SQLite.
The risk is not the transition speed; it is the number of transitions required.

### Cherrypick Flow: 5 Steps, Visual Distinctness

The five steps (locate → inspect → edit → compile → reconcile) each need a clearly
different screen state or the viewer cannot track progress. Currently there is a
continuity risk between steps 1 and 2: "locate a node by clicking it" and "node is
now open in inspector" look like the same screen with a panel opening. That is fine
in use but creates a visual jump cut on video.

Fix: Add a transient highlight ring on the selected node that persists for 1 second
after the inspector opens. Viewer eye-tracks: graph (node highlighted) → inspector
(contract visible). The ring creates the visual bridge.

Steps 3 (edit contract), 4 (compile), and 5 (reconcile) are already visually
distinct: text editing, then a loading state with streaming output in chat, then a
diff modal. These will read clearly even muted.

### Mass Edit: Powerful or Confusing?

Confusing, as currently planned — if all N nodes light up simultaneously.

The problem is simultaneity. On a 3-inch phone replay, 10 nodes flashing at once
reads as a bug or a crash frame, not as "the system found all the matches." The fix
is sequence: nodes should highlight in a fast staggered ripple (50ms between each),
not all at once. The eye follows movement, not area fills. A ripple across 10 nodes
in 500ms reads as "it found them all systematically" rather than "everything broke."

Additionally: show a count badge ("10 nodes matched") in the graph toolbar the
moment the ripple completes. This is the legible WOW signal. The badge is what
survives muted phone replay.

### Non-Coder Beat: Believable in 30 Seconds?

Yes, but only if the entry state is already filtered. The beat fails if it begins
with "and now switch to L4 atom view" — that is 8 seconds of orientation that a
non-developer viewer won't follow. The beat must open with the filtered view already
active and labeled: "Copy Atoms — Plain English Editing." From that state, a
typewriter-cursor edit to an empty-state headline and a single approve takes 20
seconds comfortably.

The believability of this beat depends entirely on the copy node's contract being
written in plain English (no JSX, no tokens). If it reads as "the `emptyStateHeadline`
prop of `<EmptyState>`," a non-technical viewer checks out. Write the contract as:
"Headline shown when search returns no results. Currently: 'No products found.'"

### Receipt Card: WOW or Developer Log?

Neither, as designed. The receipt card will read as a metrics panel, which is
neutral. It becomes a WOW moment only through the contrast with the baseline.

The key is the delta callout, not the raw numbers. A card that shows
"1,240 tokens / 3 tool calls" is a developer log. A card that shows
"−82% tokens vs. terminal baseline" with the raw numbers below it is a WOW moment.
Design the receipt card to lead with the delta, not the absolute. This single change
makes the side-by-side comparison land for every viewer, not just the ones who
intuitively understand what 1,240 tokens means.

**Word count: 397**

---

## 2. Finalized UI Layouts — ASCII Wireframes

### View A: Main Layout
Three-pane shell with native macOS chrome. This is the default state when a
repo is open and no node is selected.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ● ● ●  Contract IDE — vercel/commerce                      [Cmd+K]      │  <- title bar (overlay, traffic lights)
├──────────┬──────────────────────────────────────┬───────────────────────┤
│  LENS    │  GRAPH CANVAS                        │  INSPECTOR            │
│ ─────── │                                      │                       │
│ ● Journey│  [breadcrumb: commerce > Checkout]  │  (empty)              │
│ ○ System │                                      │  Select a node to     │
│ ○ Owners │  ┌────────────────────────────────┐  │  inspect its contract,│
│          │  │   [L1: Checkout Flow]          │  │  code, and receipts.  │
│ ─────── │  │                                │  │                       │
│ FILTER   │  │  ┌──────────┐  ┌──────────┐  │  │                       │
│ [Search] │  │  │ Cart     │  │ Payment  │  │  │                       │
│          │  │  │ Surface  │  │ Surface  │  │  │                       │
│ ─────── │  │  └────┬─────┘  └────┬─────┘  │  │                       │
│ NODES    │  │       │              │         │  │                       │
│ 25 total │  │  ┌────┴──────────────┴──────┐  │  │                       │
│  8 L0–L1 │  │  │ Confirm Surface         │  │  │  ← BEAT 1 target      │
│ 15 L2    │  │  │ [● healthy]             │  │  │    lands here         │
│  2 drift │  │  └─────────────────────────┘  │  │                       │
│          │  └────────────────────────────────┘  │                       │
│ ─────── │                                      │                       │
│ [+ Derive│  [minimap: bottom-right corner]      │                       │
│  Nodes]  │                                      │                       │
│          │  Zoom: L2 visible  [⌘- ⌘+]           │                       │
└──────────┴──────────────────────────────────────┴───────────────────────┤
│  CHAT PANEL                                          [↑↓ history] [⌘/]  │  <- bottom strip, collapsible
│  > Type an intent or ask about the selected node...                      │
└─────────────────────────────────────────────────────────────────────────┘

LEFT SIDEBAR  : ~180px, vibrancy background, lens switcher + node list
GRAPH CANVAS  : flex-grow, react-flow, pan with trackpad, zoom with scroll
INSPECTOR     : ~360px, slides in on node select, tabs across top
CHAT STRIP    : ~80px collapsed, ~200px expanded, Cmd+/ toggles
```

**Node visual key (graph canvas)**
```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌ ─ ─ ─ ─ ─┐
│ Confirm  │   │ Payment  │   │ Cart     │   │ Button   │
│ Surface  │   │ Surface  │   │ Surface  │   │ [ghost]  │
│ [● hlthy]│   │ [◉ drift]│   │ [○ untst]│   └ ─ ─ ─ ─ ─┘
└──────────┘   └──────────┘   └──────────┘
solid border    red pulse       dashed             dashed + link icon
healthy         drifted         untested           ghost reference
```

---

### View B: Zoomed Node Inspector
State after clicking a node. Inspector panel expands to full detail. This is
the primary interaction surface for all three demo beats.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ● ● ●  Contract IDE — vercel/commerce                      [Cmd+K]      │
├──────────┬──────────────────────────────────────┬───────────────────────┤
│  (left   │  GRAPH (dimmed, node selected)       │  INSPECTOR            │
│  sidebar │                                      │ ─────────────────── │
│  same as │  ┌────────────────────────────────┐  │ [Contract][Code][...] │  <- tabs: Contract / Code /
│  View A) │  │                                │  │  Preview / Receipts   │     Preview / Receipts
│          │  │  ┌──────────────────────────┐  │  │ ─────────────────── │
│          │  │  │ ★ AddToCartButton        │  │  │  AddToCartButton      │  <- node name
│          │  │  │   [selected, ring glow]  │  │  │  L3 Component · UI    │  <- kind + level badge
│          │  │  └──────────────────────────┘  │  │                       │
│          │  │                                │  │  CONTRACT  [Pin][Edit]│
│          │  └────────────────────────────────┘  │  ─────────────────── │
│          │                                      │  Intent: Primary CTA  │
│          │                                      │  for adding items to  │
│          │                                      │  cart. Disabled when  │
│          │                                      │  inventory is zero.   │
│          │                                      │                       │
│          │                                      │  Invariants:          │
│          │                                      │  · Color = brand      │
│          │                                      │    primary (coral)    │  <- BEAT 1: edit this line
│          │                                      │  · Label = "Add to    │
│          │                                      │    Cart" always       │
│          │                                      │                       │
│          │                                      │  [Edit Contract ⌘E]   │  <- BEAT 1 entry point
│          │                                      │ ─────────────────── │
│          │                                      │  DRIFT STATUS: ● OK   │
│          │                                      │  Last run: 2m ago     │
│          │                                      │  [↻ Reconcile]        │
│          │                                      │ ─────────────────── │
│          │                                      │  RECEIPT HISTORY      │
│          │                                      │  · Run 3 — 1,240 tok  │
│          │                                      │  · Run 2 — 4,820 tok  │  <- baseline shows here
│          │                                      │  [Pin side-by-side ⌘P]│  <- BEAT 1 climax
└──────────┴──────────────────────────────────────┴───────────────────────┤
│  CHAT    > "Change the Add to Cart button color to coral"                │
│            [agent streaming output appears here in real time]            │
└─────────────────────────────────────────────────────────────────────────┘

CONTRACT TAB  : markdown-rendered contract with Edit toggle (⌘E)
CODE TAB      : Monaco read-only, syntax highlighted, no LSP
PREVIEW TAB   : iframe → localhost:${PORT}${node.route}, "Start server" fallback
RECEIPTS TAB  : chronological list of receipt cards, pin action on each
```

**Contract Editor Mode** (triggered by ⌘E in BEAT 1):
```
│  CONTRACT  [Save ⌘S][Cancel ⌘.]                                         │
│  ─────────────────────────────────────────────────────────────────────  │
│  Intent: [Primary CTA for adding items to cart. Disabled when...]       │
│                                                                          │
│  Invariants:                                                             │
│  · Color = brand primary (coral)          <- cursor is here, editing    │
│  · Label = "Add to Cart" always                                          │
│                                                                          │
│  [plain text editor, no code, no JSX shown]                             │
│  ─────────────────────────────────────────────────────────────────────  │
│  [Run Agent ⌘↵]  ← triggers compile step, emits streaming to chat      │
```

---

### View C: Diff Reconcile Modal
Triggered after agent run completes. Overlays the main layout. This is the
final approval step and the visual setup for the receipt comparison beat.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ● ● ●  Contract IDE                         REVIEW CHANGES  [⎋ cancel] │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  AddToCartButton — Contract + Code Changes                               │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  ┌─ CONTRACT DIFF ─────────────────┐  ┌─ CODE DIFF ───────────────────┐ │
│  │  Invariants:                    │  │  // AddToCartButton.tsx        │ │
│  │  · Color = brand primary        │  │  import { colors } from        │ │
│  │  - ·  (coral)                   │  │    'lib/tokens'                │ │
│  │  + ·  (indigo)                  │  │  ...                           │ │
│  │  · Label = "Add to Cart" always │  │  - backgroundColor: coral      │ │
│  │                                 │  │  + backgroundColor: indigo     │ │
│  │  [human-authored · pinned]      │  │                                │ │
│  └─────────────────────────────────┘  └───────────────────────────────┘ │
│                                                                          │
│  ┌─ PREVIEW DIFF ──────────────────────────────────────────────────────┐ │
│  │  BEFORE                         │  AFTER                            │ │
│  │  [coral button screenshot]      │  [indigo button screenshot]       │ │  <- iframe snapshots
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  [← Reject All  ⌘.]     [✓ Approve Both  ⌘↵]     Atomic write to disk  │
│                                                                          │
│  After approval: receipt card generated → view in inspector             │
└─────────────────────────────────────────────────────────────────────────┘

MODAL WIDTH   : 900px centered, backdrop blur + dim on main layout
CONTRACT DIFF : left third, Monaco diff editor (read-only in modal)
CODE DIFF     : center third, Monaco diff editor (read-only)
PREVIEW DIFF  : bottom strip, iframe before + after side by side
APPROVE BUTTON: single action — ⌘↵ — writes both files atomically
```

---

### View D: Receipt Side-by-Side (Demo Beat Climax)
Appears in the inspector's Receipts tab after Approve. All three beats end here.

```
│  RECEIPTS  ─────────────────────────────────────────────────────────── │
│                                                                          │
│  ┌─ CONTRACT IDE RUN ──────────┐  ┌─ TERMINAL BASELINE ───────────────┐ │
│  │  AddToCartButton color      │  │  "change Add to Cart color"       │ │
│  │  ─────────────────────────  │  │  ─────────────────────────────    │ │
│  │  1,240 input tokens         │  │  6,890 input tokens               │ │
│  │  180 output tokens          │  │  310 output tokens                │ │
│  │  3 tool calls               │  │  18 tool calls                    │ │
│  │  1 node touched             │  │  12 files read                    │ │
│  │  4.2s wall time             │  │  28.4s wall time                  │ │
│  │                             │  │                                   │ │
│  │  ████████████░░░░░░░░░░░░░  │  │  (no contract context)            │ │
│  └─────────────────────────────┘  └───────────────────────────────────┘ │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  −82% tokens   −83% tool calls   −85% wall time                    │ │  <- MUTED CALLOUT: big type
│  │  Same task. Same model. The difference is context.                  │ │
│  └─────────────────────────────────────────────────────────────────────┘ │

DELTA BANNER : 100% width, large type, contrast background, survives muted
RAW NUMBERS  : secondary, shown below the delta for credibility
```

---

### View E: Mass Edit — Graph State (Beat 2)

```
┌──────────┬──────────────────────────────────────────────────────────────┤
│  LENS    │  GRAPH CANVAS — Mass Edit Active                             │
│          │                                                               │
│          │  [breadcrumb: commerce > (all flows)]                        │
│          │                                                               │
│          │  ┌─ MATCH BANNER ──────────────────────────────────────────┐ │
│          │  │  10 nodes matched "add loading state to async actions"  │ │
│          │  │  [Review all diffs ⌘↵]            [Cancel ⌘.]           │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                               │
│          │   ┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐                │
│          │   │ Add  │   │ Buy  │   │Submit│   │Search│                 │
│          │   │ Cart │   │ Now  │   │ Addr │   │      │                 │
│          │   │ [◉]  │   │ [◉]  │   │ [◉]  │   │ [◉]  │                │
│          │   └──┬───┘   └──────┘   └──────┘   └──────┘                │
│          │      │  (nodes pulse with amber ring = "matched")            │
│          │      │  (ripple timing: staggered 50ms apart)                │
│          │                                                               │
│          │   ┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐                │
│          │   │Login │   │Sign  │   │Apply │   │Update│                 │
│          │   │Button│   │ Up   │   │Coupon│   │ Cart │                 │
│          │   │ [◉]  │   │ [◉]  │   │ [◉]  │   │ [◉]  │                │
│          │   └──────┘   └──────┘   └──────┘   └──────┘                │
└──────────┴──────────────────────────────────────────────────────────────┘
│  CHAT    > "add loading state to every button that triggers async"       │
│            Matching nodes... ████████████████░░░ 10 found               │
└──────────────────────────────────────────────────────────────────────────┘

◉ = amber ring on matched nodes (not red — red = drift, amber = selected for edit)
Banner shows count + two actions; approve sends to batch diff review queue
```

---

### View F: Non-Coder Mode — L4 Atom View (Beat 3)

```
┌──────────┬──────────────────────────────────────────────────────────────┤
│  LENS    │  GRAPH CANVAS                         COPY ATOMS VIEW        │
│          │  ─────────────────────────────────────────────────────────── │
│          │  [breadcrumb: commerce > Search > Empty State]               │
│          │                                                               │
│          │  ┌──────────────────────────────────────────────────────────┐│
│          │  │  L4 ATOMS — Plain English  [← Back to full graph]        ││
│          │  │                                                           ││
│          │  │  ┌─ headline ──────────┐  ┌─ subtext ──────────────────┐ ││
│          │  │  │ "No products found" │  │ "Try adjusting your        │ ││
│          │  │  │                     │  │  search or filters."       │ ││
│          │  │  │ [click to edit]     │  │ [click to edit]            │ ││
│          │  │  └─────────────────────┘  └────────────────────────────┘ ││
│          │  │                                                           ││
│          │  │  ┌─ cta-button ────────┐  ┌─ alt-cta ──────────────────┐ ││
│          │  │  │ "Browse all"        │  │ "Clear filters"            │ ││
│          │  │  │ [click to edit]     │  │ [click to edit]            │ ││
│          │  │  └─────────────────────┘  └────────────────────────────┘ ││
│          │  │                                                           ││
│          │  │  [CODE HIDDEN — non-coder mode active]                   ││  <- no JSX visible
│          │  └──────────────────────────────────────────────────────────┘│
└──────────┴──────────────────────────────────────────────────────────────┘
│  CHAT    > "Change the empty state headline to 'Nothing here yet'"       │
└──────────────────────────────────────────────────────────────────────────┘

KEY DESIGN DECISION: In non-coder mode, source code tab is hidden entirely.
Inspector shows only: display text, edit field, preview, approve.
No token, no JSX, no prop names. Written as content, not as code.
```

---

## 3. Shot-by-Shot Demo Script — 3:00 Video

---

### 0:00–0:20 — Cold Open

**Camera:** Screen recording. App already open. Repo is `vercel/commerce`. Graph
is at L1 (Flows visible: Checkout, Product, Search, Account). No node selected.
Smooth ambient pan in progress — the canvas drifts gently left on autopilot.

**UI State:** Checkout flow is in center. Three L2 surfaces visible inside it
(Cart, Payment, Confirm). Nodes are health-green. No inspector open.

**On-Screen Text Callout (appears at 0:05, large, center-bottom):**
> "You've lost the map. This is it back."

**Narration (optional voice-over):**
> "Every codebase has a map. File trees hide it. Contract IDE shows it."

**Direction note:** No mouse movement in the cold open. Let the canvas breathe.
The slow ambient pan is doing all the work. The callout appears, holds 8 seconds,
fades. Cut.

---

### 0:20–0:45 — Thesis

**Camera:** Graph pulls back to L0 (the whole product map — single root node
"vercel/commerce" expanding into four L1 flows, each showing 3–4 L2 children).
Then cuts to a split-screen: left = graph, right = a terminal window running
`grep -r "AddToCart" src/` producing 40 lines of output.

**UI State:** L0 view on left. Terminal grep output on right (static screenshot,
not live).

**On-Screen Text Callout (appears at 0:28):**
> "Agents grep. Humans guess. There's a better way."

**Narration:**
> "When you work with Claude Code today, the agent reads files. It doesn't know
> what your product does. Every session starts from scratch. Contract IDE adds an
> intent layer above your code — a living graph of what every node is for."

**Direction note:** At 0:38, zoom the graph back in to L1/Checkout. This is
the orientation for Beat 1. The transition should be a smooth zoom, not a cut.
Viewer should feel they're "flying in" to the Checkout flow.

---

### 0:45–1:15 — Beat 1: Cherrypick — Button Color Change

**Step 1 (0:45–0:52): Locate**
Mouse hovers over "Confirm Surface" node in graph. It shows a tooltip:
"Checkout Confirm Page — renders AddToCartButton, OrderSummary, PaymentConfirm."
Click. Inspector opens on the right. Tab is on "Contract."

**UI State:** Node selected (ring glow persists 1s). Inspector shows contract
for Confirm Surface, which lists AddToCartButton as a child.

**Step 2 (0:52–0:58): Inspect**
Click on AddToCartButton (either from inspector's neighbor list or directly in
graph — the graph zooms one level to show L3 components inside the surface).
Inspector reloads. Contract visible: Invariants include "Color = brand primary (coral)."

**On-Screen Text Callout (appears at 0:55):**
> "Intent, not file path."

**Step 3 (0:58–1:04): Edit**
Press ⌘E. Contract goes into edit mode. Cursor positioned on "coral."
Type over it: "indigo." Save ⌘S. Inspector shows "contract dirty" badge briefly.

**UI State:** Contract editor mode active, minimal chrome, just the text and
the save/run buttons at bottom.

**Step 4 (1:04–1:10): Compile**
Press ⌘↵ (Run Agent). Chat strip expands. Streaming output begins:
"Reading AddToCartButton contract... Reading neighbors... Writing patch..."
A progress indicator on the graph node pulses gently.

**UI State:** Chat strip showing streaming text. Node has a "processing" spinner
overlay. 6-second wait, then: "Patch ready. 3 tool calls."

**Step 5 (1:10–1:15): Reconcile**
Diff modal appears. Contract diff on left (coral → indigo). Code diff in center
(one line changed). Preview diff at bottom (coral button / indigo button side by
side). Cursor is already on the Approve button.
Press ⌘↵. Modal closes. Node flashes green.
Camera holds on the inspector's Receipts tab opening automatically. Receipt card
appears. Cut to receipt comparison (pins the baseline).

**Muted callout on screen during approve:**
> "One approval. Both files. Atomic."

---

### 1:15–1:50 — Beat 2: Mass Edit — Loading States

**Step 1 (1:15–1:20): Intent**
Click into chat strip. Type:
"add a loading spinner to every button that triggers an async request"
Press Enter.

**UI State:** Chat shows the input. Graph is at L1 overview.

**Step 2 (1:20–1:28): Ripple**
Graph zooms out to show multiple flows simultaneously (or a multi-select view).
Nodes begin to highlight in a staggered amber ripple — left to right, top to
bottom. Each node gets an amber ring as it's identified. 10 nodes total.
At 500ms: all 10 are lit. Count badge appears in the top-left of the canvas:
"10 matched."

**On-Screen Text Callout (appears when ripple completes at 1:27):**
> "10 nodes. One intent. Zero file hunting."

**Direction note:** The staggered ripple is the visual money shot of this beat.
Time the recording so the ripple happens in real time at this speed. Do not fast-
forward through it. The 500ms ripple is the entire drama of this beat.

**Step 3 (1:28–1:40): Batch Review**
A "Review 10 diffs" banner appears. Click or press ⌘↵. A stacked diff view
opens: diffs are shown as a numbered list. Each entry is one node's contract + code
diff. The user scrubs through them with arrow keys (↓ to advance). 3 of the 10 are
shown on camera quickly (user scrubs in ~4 seconds). Camera doesn't linger on
individual diffs — the scrubbing speed itself conveys quantity.

**UI State:** Stacked diff review. "1 of 10 / 2 of 10 / 3 of 10" counter visible
top-right. "Approve All ⌘↵" button at top.

**Step 4 (1:40–1:50): Approve + Receipt**
Press ⌘↵ (Approve All). 10 nodes in graph all flash green in rapid sequence.
Inspector opens on one of them. Receipt card shows:
"10 nodes touched. 4,100 tokens. 12s."
Baseline pinned alongside: "same task, terminal Claude Code: 24,000 tokens. 110s."
Delta banner: "−83% tokens. −89% time."

---

### 1:50–2:20 — Beat 3: Non-Coder — Copy Edit

**Step 1 (1:50–1:57): Switch Mode**
Click lens switcher on the left sidebar. Select "Copy Atoms" (this is L4 filter,
not a lens — but branded as "Copy Atoms" mode for non-technical viewers).
Graph view changes. Only L4 text-bearing nodes visible. Layout is a clean grid,
not a hierarchy. Labels are human-readable: "Search Empty Headline," "Cart Empty
Message," "Error Toast Text."

**UI State:** Atom grid view. No code visible anywhere.

**On-Screen Text Callout (appears at 1:52):**
> "No code required."

**Step 2 (1:57–2:05): Select + Edit**
Click "Search Empty Headline" node. Inspector opens. Only visible content:
a plain text label: "No products found." and an [Edit] button.
Click Edit. A single-line text input appears, pre-filled.
Type over it: "Nothing here yet."

**UI State:** Inspector in copy-edit mode. No code tab visible. No JSX. Just
a text field and a preview.

**Step 3 (2:05–2:12): Approve**
Press ⌘↵. Agent runs (very brief — copy-only patch is trivial). Diff modal:
contract diff on left (one sentence change), code diff in center (one string
literal changed). No code knowledge needed to understand it. Press ⌘↵ again.

**Step 4 (2:12–2:20): Receipt**
Receipt card: "1 node. 890 tokens. 2.1s."
Baseline: "4,200 tokens. 19s."
Delta: "−79% tokens."
A PM appears to be able to do this, the narration makes this explicit.

**Narration:**
> "A PM. A writer. Anyone who can describe what they want. The contract is the
> interface. The code never has to be."

---

### 2:20–2:45 — Stack / Architecture

**Camera:** Static screen with a clean architectural diagram (not the running app).
Dark background. Three layers labeled in large type:

```
  ┌─────────────────────────────────────────┐
  │  CONTRACT GRAPH  (you navigate by intent)│
  ├─────────────────────────────────────────┤
  │  AGENT LAYER     (Claude Code + MCP)     │
  ├─────────────────────────────────────────┤
  │  CODE             (the artifact)         │
  └─────────────────────────────────────────┘
  Tauri 2 · react-flow · Monaco · SQLite · TypeScript MCP
```

**Narration:**
> "Built on Tauri — native macOS, web stack. react-flow for the graph. Monaco
> for code. SQLite for the contract cache. A TypeScript MCP server so Claude Code
> can query contracts from outside the IDE. The stack is boring. The layer on top
> is not."

**Direction note:** This section earns developer trust. Keep it factual, fast,
and confident. Do not over-explain. The diagram does the work.

---

### 2:45–3:00 — Close

**Camera:** Return to the graph. L1 view. All nodes green. Slow zoom out to L0.

**On-Screen Text (center, large):**
> "Contract IDE"
> "Navigate by intent. Edit by intent. Measure every change."

**Narration (optional):**
> "Code changes every day. Intent is what you're actually trying to preserve.
> Contract IDE is the layer between the two."

**Final frame:** The L0 graph node — a single circle labeled "vercel/commerce" —
centered on screen. Fade to black.

---

## 4. Top 3 UX Risks

### Risk 1: The Diff Modal Has No Orientation Header — Viewers Won't Know What They're Approving

**Specific problem:** The diff modal as designed shows three panes (contract,
code, preview) with no persistent context about which node this is or what intent
was just run. A viewer watching the video at 1:14 sees a modal with two columns of
green/red diffs and has to remember: "right, this is the Add to Cart button color
change." Memory is not UX. The modal must say so.

**What to change:** Add a fixed header inside the modal, above the diffs:
"AddToCartButton — 'Change color to indigo' — 1 node · 3 tool calls · 4.2s"
This header is also the first thing the receipt inherits from. It creates narrative
continuity from chat input → diff modal → receipt card. Without it, each step
feels detached.

**Demo impact:** Without the header, the Approve step on video looks like a
meaningless diff. With it, every viewer understands what they're watching.

### Risk 2: The "Copy Atoms" Entry Point Is Hidden — Non-Coder Beat Requires Setup Viewers Won't Follow

**Specific problem:** Beat 3 (non-coder copy edit) depends on a mode switch that
is currently tucked into the lens switcher. The lens switcher is designed for
developers. A non-technical viewer watching the demo at 1:50 will not follow
"and now I toggle the lens to L4 atoms." The beat is supposed to demonstrate
that a PM can do this without developer guidance.

**What to change:** Create a dedicated "Copy Mode" button that is visually
separated from the lens switcher — a top-level affordance, not a submenu item.
Position it in the left sidebar as a prominent pill: "Copy Mode." When activated,
it filters to L4 text atoms AND hides the Code tab from the inspector globally.
The visual state change (grid layout, no code anywhere) communicates the mode
switch without narration.

**Demo impact:** Without this change, the non-coder beat requires 10–15 seconds
of "here's how to navigate to this mode" that eats the beat. With it, one click
establishes the mode and the rest of the beat plays as promised.

### Risk 3: The Receipt Delta Is Buried — The Comparison Does Not Land Without It as a First-Class Element

**Specific problem:** As designed, the receipt card shows raw numbers in two
side-by-side columns. The delta (−82% tokens) is implied, not stated. Viewers
who are not developers will not mentally compute the savings from raw token counts.
Even developer viewers skimming a conference talk replay won't land on the key
number unless it is explicitly surfaced.

**What to change:** The receipt comparison view must have a delta banner as its
dominant visual element — not a footnote below the numbers. The banner should be
in a high-contrast color (e.g., green on dark), large type (28px+), and contain
exactly three numbers: token savings %, tool call savings %, and wall time savings %.
The raw numbers sit below in smaller type for credibility. On video, the camera
should hold on the delta banner for at least 3 seconds before cutting away.

**Demo impact:** This is the product's ROI claim made visible. If it does not
land as a WOW moment, the entire receipt infrastructure was built for nothing.
The delta banner is worth more than everything else in the receipt card combined.

---

## 5. One Unexpected Insight

**The contract graph is accidentally a better onboarding document than the README.**

No one on the team has stated this as a use case, but it follows inevitably from
the design: the L0–L2 graph of `vercel/commerce` is the clearest product map a
new developer could receive when joining a project. It is more useful than any
README because it is structured, interactive, browsable by intent, and linked to
the actual code. Every new engineer on a team that uses Contract IDE would
understand the product's flows within 5 minutes of opening the graph — versus the
current reality of reading docs, navigating file trees, and running code to piece
together the same mental model manually.

**The implication:** There is a distinct user journey — the "new joiner" or the
"context-loading" session — where the contract graph is the primary read-only
surface, not an editing tool. No agent runs. No contract edits. Just browsing,
clicking, and reading contracts to build a mental model.

**Why the team hasn't considered it:** Every demo beat centers on editing or
changing something. The planning documents treat navigation as a means to an edit,
not as an end in itself. But for the demo video this is a free second thesis
statement that costs nothing to surface: pause for 5 seconds during the cold open
on the L1 graph and say "This is also how you onboard a new engineer." It reframes
the product from "AI editing tool for developers who already know the codebase" to
"shared source of truth for everyone who touches the product" — PMs, designers,
tech writers, and new hires included.

**Immediate action:** Add one sentence to the demo script at 0:35:
> "This is also how a new engineer understands the product on day one."
No implementation change required. The graph already does this. Just say it.

---

*Review complete. File: `/Users/yang/lahacks/.planning/review/UX_REVIEW.md`*
*Word count: ~3,800 words. Line count: ~400 (within budget).*
