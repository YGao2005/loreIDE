# Demo Reset Procedure

**Purpose:** Return the demo environment to a clean, predictable state so the live scenario (`live-scenario.md`) produces deterministic results.

**Scenario status:** Seed contents below (`dec-brand-green-2f855a`, the priority-shift fixture, etc.) are **placeholders** tied to the green-button example. Replace with real seeds once the committed scenario is picked per `scenario-criteria.md`. Reset *procedure* stands as-is.

**Target time:** 5–10 seconds automated (shell script), 60 seconds manual if the script breaks.

**Script lives at:** `contract-ide/demo/reset-demo.sh` *(to be written during Phase 10 — spec below)*

## Canonical demo state

One directory tree, one set of seed files, one database snapshot. **Don't invent state at demo time** — everything comes from committed fixtures.

```
/tmp/contract-ide-demo/
├── vercel-commerce/              ← cloned + pinned to known commit
│   ├── .contracts/               ← 28 seeded contract sidecars
│   ├── .claude/                  ← empty; sessions go here during the demo
│   └── src/components/
│       └── checkout/
│           └── CheckoutNow.tsx   ← starts with non-green button class
└── substrate.sqlite              ← pre-seeded with constraints + decisions + priority fixtures
```

Source fixtures live in-repo:

```
contract-ide/demo/
├── reset-demo.sh                 ← the reset script (Phase 10)
├── seeds/
│   ├── contracts/                ← the 28 canonical contract sidecars
│   ├── substrate.sqlite.seed     ← snapshot of a known-good substrate state
│   ├── priority-shift.json       ← the L0 old→new priority fixture
│   └── source-sessions/          ← the 10 Claude Code JSONL sessions for Scene 1 timelapse
└── PROMPTS.md                    ← canonical prompts for each live beat
```

## Reset script — spec for what it must do

`reset-demo.sh` runs these steps in order:

### 1. Kill anything already running (2s)
```sh
pkill -f 'tauri dev' || true
pkill -f 'pnpm dev' || true
pkill -f 'mcp-server-' || true
```

### 2. Restore repo state (1s)
```sh
cd /tmp/contract-ide-demo/vercel-commerce
git reset --hard $DEMO_COMMIT_SHA
git clean -fd
# Restore the non-green button starting state:
cp /path/to/seeds/CheckoutNow-initial.tsx src/components/checkout/CheckoutNow.tsx
```

### 3. Restore `.contracts/` (1s)
```sh
rm -rf .contracts
cp -r /path/to/seeds/contracts .contracts
```

### 4. Restore substrate (2s)
```sh
rm -f /tmp/contract-ide-demo/substrate.sqlite
cp /path/to/seeds/substrate.sqlite.seed /tmp/contract-ide-demo/substrate.sqlite
# Verify row counts match expected:
sqlite3 /tmp/contract-ide-demo/substrate.sqlite 'SELECT type, COUNT(*) FROM substrate_nodes GROUP BY type'
# Expected: constraint=40, decision=8, session=10, contract=28
```

### 5. Start dev server (background, 2–3s to listen)
```sh
cd /tmp/contract-ide-demo/vercel-commerce
pnpm dev > /tmp/contract-ide-demo/dev-server.log 2>&1 &
# Wait for listen:
until curl -sf http://localhost:3000/checkout > /dev/null; do sleep 0.2; done
```

### 6. Launch Contract IDE
```sh
open /Applications/ContractIDE.app --args --open-repo /tmp/contract-ide-demo/vercel-commerce
# Or during development:
# cd /Users/yang/lahacks/contract-ide && npm run tauri dev &
```

### 7. Verification (1s)
```sh
# Sanity checks — fail loudly if any of these go wrong:
test -d /tmp/contract-ide-demo/vercel-commerce/.contracts || exit 1
test -f /tmp/contract-ide-demo/substrate.sqlite || exit 1
curl -sf http://localhost:3000/checkout > /dev/null || exit 1
echo "✓ Reset complete. State is clean."
```

## Manual reset (fallback if the script breaks)

In demo order, rehearsed:

1. **`Cmd+Q` Contract IDE.** Wait for it to fully quit.
2. **Kill dev server.** `pkill -f 'pnpm dev'` in terminal.
3. **Reset repo.** `cd /tmp/contract-ide-demo/vercel-commerce && git reset --hard <commit>`
4. **Reset contracts.** `rm -rf .contracts && cp -r ~/lahacks/contract-ide/demo/seeds/contracts .contracts`
5. **Reset substrate.** `cp ~/lahacks/contract-ide/demo/seeds/substrate.sqlite.seed /tmp/contract-ide-demo/substrate.sqlite`
6. **Start dev server.** `pnpm dev &`
7. **Wait for server.** `curl http://localhost:3000/checkout` — should 200
8. **Launch Contract IDE** from Applications.
9. **Cmd+O** → pick `/tmp/contract-ide-demo/vercel-commerce`.
10. **Wait for canvas to populate.** Zoom to L1 Flows, center on Checkout.
11. **Verify:** no red/amber/orange pulses on canvas; Inspector closed; chat empty.

## What the seeded substrate must contain

For the live scenario to produce the right constraint retrieval:

**Constraints (at minimum 5, padded to 40 for realism):**
- `con-use-tailwind` — "use tailwind utility classes exclusively; no CSS files except index.css"
- `con-debounce-autosave-400ms` — "autosave fires on blur after 400ms debounce"
- `con-canonicalize-paths` — "Rust commands that accept paths must canonicalize and assert under repo root"
- `con-no-default-exports` — "no default exports in TS files; named exports only"
- 36 others — padded with realistic constraints from prior Claude Code sessions on this repo

**Decisions:**
- `dec-brand-green-2f855a` — "brand primary green is `#2f855a`; used for all primary CTAs; decided 2026-02-14 after design-system review"
  - Provenance: source session `session-2026-02-14-design-system`, turn 47, verbatim quote
- 7 others (routing, state management, testing conventions, etc.)

**Priority shift (for recorded video only — not live beat):**
- L0 `l0-q1-aggressive-differentiation` (valid 2025-01-01 to 2026-04-01)
- L0 `l0-q2-brand-consistency` (valid 2026-04-01 to present)
- Supersession edge from the second to the first

**Sessions (for Scene 1 timelapse):**
- 10 real Claude Code JSONL sessions run against vercel/commerce in the 2 weeks pre-filming
- Each distilled during the timelapse in Scene 1

## When to reset

- Before every rehearsal run
- Before every take during filming
- Immediately before a live demo in front of a judge
- After any live demo that produced unexpected results (don't reuse a session's context for the next judge)

## Rehearsal verification

Run the reset → live-scenario → verify cycle 5 times the day before filming. Log each run:

| Run | Reset time | Live beat time | MCP returned right constraints? | Preview updated? | Receipt reasonable? |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |

If any column shows inconsistency across runs, debug before filming — don't rely on hope.

---

*Phase 10 / Phase 11 slice must land `reset-demo.sh` + `seeds/` as a ship-blocker. Demo-day reliability depends on them.*
