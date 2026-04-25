# Demo Runbook — Contract IDE

**Video length:** 3:00
**Subject:** Contract IDE operating on `vercel/commerce`
**Recording conditions:** Same repo commit, same model, demo machine in airplane-mode-except-Claude, screen recording at 1080p60 (slow to 1.3× in post), macOS dark mode, system accent = graphite.

Three beats. Each ends on a receipt comparison. Three muted-playback callouts designed to survive sound-off viewing:

1. **"Intent, not file path."** (Beat 1, @ 0:55)
2. **"10 nodes. One intent. Zero file hunting."** (Beat 2, @ 1:27)
3. **"No code required."** (Beat 3, @ 1:52)

---

## Pre-recording checklist

- [ ] Kill all other applications. Focus mode on.
- [ ] Demo repo is at locked commit. `git status` clean.
- [ ] `.contracts/` directory has exactly the 25 seeded nodes. Verified by `ls .contracts/ | wc -l`.
- [ ] Dev server is running at `localhost:3000` — homepage loads a product page (Shopify-stubbed or live).
- [ ] Baseline receipts recorded with no contract context and committed to `.planning/demo/baselines/`.
- [ ] Contract IDE is open, zoomed to L1 Flows lens showing the Checkout flow in the center of the canvas.
- [ ] Chat panel empty, inspector closed.
- [ ] Rehearsed 3× in a row today. Last run: ___ (record date).

---

## 0:00–0:20 — Cold open (the pain)

**Camera:** split screen, left = a terminal with `claude` running, right = a dev scrolling a file tree in VS Code.

**On-screen text (top, fixed):**
> *"Agents grep. Humans guess."*

**Narration:**
> *"Today's best tools make you a detective in your own codebase. Every change starts with finding the right file."*

**B-roll:** terminal shows 18+ `Glob` and `Grep` tool calls scrolling; VS Code shows nested folders being expanded one by one.

---

## 0:20–0:45 — Thesis

**Camera:** Contract IDE pulls into view. Graph canvas centered. L0 Product node visible, then zoom-out to show the constellation. Single slow zoom-out, 3 seconds.

**On-screen text:** none — let the graph speak.

**Narration:**
> *"We built an IDE where every file, component, and button has a versioned natural-language contract. The graph is the map. Code becomes the compiled artifact. And — this is also how a new engineer understands the product on day one."*

*(That last clause is the reframe caught in UX review — zero implementation cost, doubles the demo's addressable audience.)*

---

## 0:45–1:15 — Beat 1: Cherrypick the Add-to-Cart button

**UI state before shot:** L1 Flows lens, zoomed into Checkout flow. Inspector closed. Chat focused.

**Action 1 (0:45–0:52):** User types in chat:
> `make the Add to Cart button color coral instead of indigo`

**Expected:** graph pans to `AddToCartButton` node, ring glow appears on the node, zoom transitions from L1 → L3 automatically. Inspector opens on the right.

**Action 2 (0:52–1:00):** Inspector shows Contract tab selected. User clicks `[Edit Contract ⌘E]`. Contract body becomes editable. One line is already highlighted: `Color = brand primary (indigo)`. User types over it: `Color = coral`.

**On-screen callout (fixed from 0:55 to 1:05, 28pt, right-aligned):**
> **Intent, not file path.**

**Action 3 (1:00–1:10):** User presses `⌘↵ Run Agent`. Chat panel streams. Diff modal appears with persistent header: `AddToCartButton · "make the Add to Cart button color coral instead of indigo" · 3 tool calls`. Contract diff (left), code diff (center), preview diff (right: indigo → coral button screenshot).

**Action 4 (1:10–1:15):** User clicks `[✓ Approve Both ⌘↵]`. Modal closes. Receipt card pops into the inspector's Receipts tab. User clicks `[Pin side-by-side ⌘P]`. Comparison view:

```
  CONTRACT IDE RUN                TERMINAL BASELINE
  1,240 tokens / 3 tool calls     6,890 tokens / 18 tool calls
  ─────────────────────────────────────────────────────────
              −82% tokens   −85% wall time
```

**Cut.**

---

## 1:15–1:50 — Beat 2: Mass edit loading states

**UI state before shot:** L1 Flows lens, zoomed out to Product constellation. Inspector closed.

**Action 1 (1:15–1:22):** User types in chat:
> `add loading state to every button that triggers an async request`

**Expected:** a match banner appears over the canvas:
```
10 nodes matched — [Review all diffs ⌘↵]   [Cancel ⌘.]
```
Ten buttons across the graph pulse with amber rings, staggered 50ms apart.

**On-screen callout (fixed from 1:25 to 1:35, 28pt, center):**
> **10 nodes. One intent. Zero file hunting.**

**Action 2 (1:22–1:35):** User scrubs — camera follows 3 of the 10 matched nodes (`AddToCart`, `CheckoutNow`, `ApplyCoupon`) and briefly zooms into each to show the contract preview.

**Action 3 (1:35–1:45):** User clicks `[Review all diffs ⌘↵]`. Batch review modal opens, 10 diffs queued. User scrubs to diff #3, then clicks `[✓ Approve All]`.

**Action 4 (1:45–1:50):** Graph updates — 10 nodes flash green, preview iframe refreshes, a spinner appears briefly on each button. Receipt card appears showing mass-edit stats:
```
  CONTRACT IDE (MASS)             TERMINAL (MASS)
  4,100 tokens / 11 tool calls    47,200 tokens / 62 tool calls / 8 min
                  −91% tokens
```

**Cut.**

---

## 1:50–2:20 — Beat 3: Non-coder edits empty-state copy

**UI state before shot:** Return to main layout. Left sidebar visible.

**Action 1 (1:50–1:55):** User clicks the **"Copy Mode"** pill in the left sidebar (not the lens switcher). Graph filters to L4 atoms: copy strings, color tokens. Layout becomes a grid of text cards with the string visible on each.

**On-screen callout (fixed from 1:52 to 2:02, 28pt, left-aligned):**
> **No code required.**

**Action 2 (1:55–2:05):** User (imagined PM, narrated as such) clicks the `EmptyCartMessage` card. Inspector opens in simplified mode — **no Code tab, no JSX visible**, just a plain-text editor showing:
> `Your cart is empty.`

User deletes that and types:
> `Nothing here yet — let's fix that. Browse the collection and find something you love.`

**Narration:**
> *"This is our PM. She doesn't touch code. She edits intent."*

**Action 3 (2:05–2:15):** User presses `⌘↵ Run Agent`. Preview iframe refreshes live — empty cart page now shows the warmer copy. Receipt card appears.

**Action 4 (2:15–2:20):** Side-by-side receipt:
```
  CONTRACT IDE                    TERMINAL BASELINE
  780 tokens / 2 tool calls       5,200 tokens / 14 tool calls
                  −85% tokens
```

**Cut.**

---

## 2:20–2:45 — Stack slide

**On screen:** three-box diagram with labels:

```
  ┌─ CONTRACT GRAPH ─┐   ┌─ CLAUDE CODE HOOKS ─┐   ┌─ MCP SERVER ──┐
  │ .contracts/*.md  │   │ PostToolUse         │   │ find_by_intent│
  │ + SQLite cache   │   │ re-derives on edit  │   │ get_contract  │
  └──────────────────┘   └─────────────────────┘   └───────────────┘
```

**Narration:**
> *"The graph lives in your repo as versioned Markdown. Hooks keep it fresh. An MCP server gives your agent a better tool than grep. Contract IDE is the visual layer over Claude Code — not a replacement."*

---

## 2:45–3:00 — Close

**On screen:** single centered line:
> **Intent is the new source code.**

Small below: repo URL, GitHub handle, "Built at LA Hacks 2026 in Tauri + React + Rust."

**End.**

---

## Post-production notes

- Slow the graph-lighting-up moments to 1.3× in post — feels snappier on replay than in real time because viewers need a beat to register what lit up.
- Zoom in on each contract-diff text block for 1–2s. That's the "oh, it's editing *meaning*, not code" moment.
- The three muted callouts must be **bold, 28pt+, high-contrast** and persist for 8–10 seconds each. That's the non-negotiable survivability floor.
- Delta banner in each receipt comparison must be the dominant visual element — large percentage number, small raw numbers.
