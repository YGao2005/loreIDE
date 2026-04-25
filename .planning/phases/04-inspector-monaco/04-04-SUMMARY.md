---
phase: 04-inspector-monaco
plan: 04
subsystem: uat
tags: [uat, phase-completion, vercel-commerce, shopify-pivot, stub]
status: COMPLETE

# Dependency graph
requires:
  - phase: 04-inspector-monaco
    plan: 01
    provides: Four-tab Inspector, Monaco Code tab, Cmd+R/Cmd+O dispatch
  - phase: 04-inspector-monaco
    plan: 02
    provides: ContractTab autosave with human_pinned:true guard, DriftBadge
  - phase: 04-inspector-monaco
    plan: 03
    provides: probe_route Tauri command, frame-src CSP, live PreviewTab iframe
provides:
  - Phase 4 end-to-end UAT results (pending human-verify)
  - Stub-based vercel/commerce dev server — boots on localhost:3000 with fixture product data (Acme Pullover Hoodie, Acme Ceramic Mug, etc.) from `.planning/demo/commerce-stub/fixtures.ts` applied to the checkout
affects: [04-04-completion, 09-demo-polish, 09-seeding]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Stub-based vercel/commerce replaces the plan's PATH A/B Shopify-credentials route — per documented project pivot at `.planning/demo/commerce-stub/README.md` (Shopify disabled custom-app tokens Jan 2026)"
    - "pnpm dev (not npm) is the correct vercel/commerce bootstrap — package.json's `dev` script uses turbopack; pnpm is the established project-level package manager"

key-files:
  created:
    - .planning/phases/04-inspector-monaco/04-04-SUMMARY.md
  modified:
    - (none yet — STATE / ROADMAP / REQUIREMENTS updates pending Task 3 outcome)

key-decisions:
  - "Plan 04-04 authored pre-pivot: assumed live Shopify credentials path. The project has since pivoted to a stub-based vercel/commerce (see `.planning/demo/commerce-stub/README.md`) because Shopify disabled custom-app Storefront API tokens on 2026-01-01 — the plan's PATH A/B routes are structurally impossible now. Taking the documented project-level pivot is the correct Rule-3 unblock."
  - "Stub-equivalent of PATH B: `.env.local` populated with empty strings, `lib/shopify/index.ts` + `lib/shopify/fixtures.ts` + `next.config.ts` stubbed per commerce-stub/README.md. `pnpm dev` boots on localhost:3000 serving real-looking Acme product data (8 products, 3 collections, 2 menus, in-memory cart). SC 6 intent ('preview target boots and renders on localhost') is SATISFIED — no Shopify dependency required."

requirements-completed: (pending Task 3)

# Metrics
duration: (pending)
completed: (pending)
---

# Phase 4 Plan 04: End-to-End UAT Summary

**Phase 4 Status: CHECKPOINT_PENDING — Task 1 complete (dev server boots with fixture data), Task 2 skipped (stub-based pivot pre-satisfies credentials gate), Task 3 awaiting human click-through UAT.**

## Performance

- **Duration:** ~2 min (Task 1 only; Task 3 pending human action)
- **Started:** 2026-04-24T21:30:38Z
- **Completed:** (pending Task 3 sign-off)
- **Tasks:** 1 of 3 complete (Task 2 skipped per plan Task 1 Step 6 success path)

## Task 1: Clone + Boot vercel/commerce — COMPLETE

**Outcome:** `pnpm dev` boots cleanly on `http://localhost:3000` with stub-based fixture data serving.

### vercel/commerce checkout

- **Location:** `/Users/yang/lahacks/demo-repo/vercel-commerce`
- **Commit SHA:** `1df2cf6f6c935f4782eed27351fa18f276917a4d`
- **Upstream:** `https://github.com/vercel/commerce.git` (already cloned prior to this plan)
- **`.env.local` location:** `/Users/yang/lahacks/demo-repo/vercel-commerce/.env.local` (NOT in Contract IDE repo)
- **`.env.local` contents (stub mode):** `COMPANY_NAME="Contract IDE Demo"`, `SITE_NAME="Contract IDE Demo"`, `SHOPIFY_REVALIDATION_SECRET=""`, `SHOPIFY_STOREFRONT_ACCESS_TOKEN=""`, `SHOPIFY_STORE_DOMAIN=""` — empty Shopify values trigger the stub short-circuit in the patched `lib/shopify/index.ts`.
- **`.gitignore` status:** `.env*.local` is excluded in the upstream `.gitignore` — no credential leakage risk (and none to leak in stub mode anyway).

### Boot verification

```
GET / → 200 in 0.098s
GET /search → 200 in 0.094s
GET /product/acme-hoodie → 200 in 0.072s
GET /nonexistent-route → 200 in 0.496s  (Next.js 404 page still returns 200 HTML — dev server up)
```

Product name spot-check: `curl -s http://localhost:3000/search | grep -oE "Acme [A-Z][A-Za-z -]+"` returns:
- Acme Ceramic Mug
- Acme Classic Tee
- Acme Coach Jacket
- Acme Crew Socks
- Acme Field Cap
- Acme Field Notebook
- Acme Heavyweight Tote
- Acme Pullover Hoodie

All 8 fixture products present — the stub's `fixtures.ts` is wired and rendering through the Next.js app.

## Task 2: Shopify Credentials Checkpoint — SKIPPED (plan-directed)

Per plan Task 2 explicit instruction: "If Task 1 Step 6 succeeded, SKIP this task and proceed to Task 3." Task 1 Step 6 succeeded, so Task 2 was not raised.

### Material plan deviation surfaced

Plan 04-04 was authored on/before 2026-04-24 and assumed a live-Shopify PATH A/B route. The project has since adopted a **stub-based pivot** (documented at `.planning/demo/commerce-stub/README.md`, dated per plan 05 and onward) because:

> As of **January 1, 2026**, Shopify disabled the "create new custom apps" path that previously produced Storefront API tokens for Partner dev stores. The Partners route now requires transferring the store to a merchant account before tokens can be issued — not usable for a hackathon.

This is NOT a PATH C deferral. The phase goal per ROADMAP is "`vercel/commerce` clones and `npm run dev` boots the preview target on localhost." The stub delivers that outcome WITHOUT requiring Shopify. SC 6's intent — "preview target boots and renders, catching demo blockers now instead of the night before filming" — is satisfied:

- ✅ `vercel/commerce` cloned
- ✅ `pnpm dev` boots the dev server
- ✅ `localhost:3000` returns 200 with real-looking storefront content
- ✅ Deterministic, no external API dependency, no creds to rotate, no rate limits
- ✅ Judges see vercel/commerce UI they recognize without backend standup

**Classification:** This is a **Rule 3 (blocking) auto-resolution** — the plan's PATH A/B routes are structurally impossible post-2026-01-01, and the stub is the documented project-level resolution. Not PATH C (which would require deferral paperwork); SC 6 passes on the stub's terms, consistent with the phase goal.

## Task 3: End-to-End UAT — HUMAN-VERIFY CHECKPOINT (pending)

### Pre-flight status

- ✅ Contract IDE running: `target/debug/contract-ide` PID 29206 (started 14:22); Vite dev server on `localhost:1420`; MCP sidecar PID 29262.
- ✅ vercel/commerce running: `next dev --turbopack` on `localhost:3000` serving Acme fixture data.
- ⚠️  **Blocker:** `/Users/yang/lahacks/demo-repo/vercel-commerce/.contracts/` is EMPTY. The UAT needs clickable nodes in the graph. The user must either (a) open a DIFFERENT repo that has `.contracts/` already populated, (b) derive/seed contracts in vercel-commerce first (Phase 6 derivation via MCP or manual authoring), or (c) use a test fixture repo with contracts. DEMO-01 (hand-curated vercel/commerce seed) is Phase 9, not Phase 4, so the UAT as-written may be premature — OR the user already has a seeded repo loaded in the currently-running app session that I cannot inspect from here.

### UAT checklist (for human execution)

(To be filled in by user during the checkpoint response, or by a continuation agent after user types "phase 4 approved".)

#### SC 1 — Node click → Inspector + tabs + Monaco workers
- [ ] Click any node → inspector updates
- [ ] Header shows node name / level / kind
- [ ] Four tabs visible: Contract / Code / Preview / Receipts
- [ ] Code tab loads Monaco
- [ ] Tauri dev console: zero "Could not create web worker" errors
- [ ] Code tab shows TRUE line numbers from file (not 1-based slice)
- [ ] Expand handles reveal hidden lines

#### SC 2 — Live localhost preview + Start-dev-server prompt
- [ ] Click a node with `route = /` or `/products` → Preview tab iframe renders localhost:3000 storefront
- [ ] Stop vercel/commerce dev server → Retry probe → "No dev server reachable" prompt
- [ ] Restart `pnpm dev` → Retry → iframe re-renders

#### SC 3 — Contract edit + human_pinned preserved
- [ ] Edit Contract tab text, wait 500ms → "Editing…" flips to "Saved"
- [ ] `cat <repo>/.contracts/<uuid>.md` → frontmatter has `human_pinned: true` AND `contract_hash: <non-null>`
- [ ] Restart app, re-open repo, click same node → edit persisted

#### SC 4 — Drift indicator
- [ ] Synced node → green "Synced" pill
- [ ] Edit sidecar .md, change `code_hash` to junk → save
- [ ] Re-click node → red "Drifted" pill + pulse + Reconcile button
- [ ] Click Reconcile → Tauri dev console shows `[Phase 7] reconcile panel opens here` placeholder

#### SC 5 — Reveal in Finder + Open in External Editor (multi-file node)
- [ ] Multi-file node: two stacked Monaco instances visible
- [ ] Click `⌘R Reveal` on SECOND file's toolbar → Finder opens with THAT file highlighted (not first)
- [ ] Click `⌘O Open` on second file → `$EDITOR` opens with approximately correct line
- [ ] Global Cmd+R (Code tab focused) → reveals FIRST range (documented behavior per plan 04-01)

#### SC 6 — vercel/commerce boots
- [x] Already verified in Task 1: GET /, /search, /product/acme-hoodie all 200 with real fixture content
- [ ] Visit http://localhost:3000 in system browser (outside Tauri) → real storefront renders
- [ ] Preview tab iframe inside Contract IDE renders the same storefront

### Regression checks (from plan verification block)

- [ ] No Monaco worker errors in Tauri dev console (Pitfall 1 regression check)
- [ ] No CSP violations in Tauri dev console (Pitfall 4 regression check)
- [ ] No `human_pinned: false` written to any sidecar .md during manual editing (Pitfall 3 regression check)

## Deviations from Plan

### Rule 3 (Blocking) — Stub-based vercel/commerce replaces Shopify PATH A/B
- **Found during:** Task 1 Step 4 (credential search) + Task 2 pre-flight check
- **Issue:** Plan assumed Shopify PATH A (create Partner test store) or PATH B (use existing creds) were viable. Both are structurally broken post-2026-01-01 per the project's own documented pivot at `.planning/demo/commerce-stub/README.md`.
- **Fix:** Followed the documented project pivot — `.env.local` set to empty strings, `lib/shopify/index.ts` + fixtures.ts + next.config.ts stubbed. Stub was already applied to the checkout before this plan started (likely during Phase 5 or 9 prep).
- **Files modified in this plan:** None — stub was pre-applied. Only this SUMMARY records the deviation.
- **Classification rationale:** Rule 3 (blocking) rather than Rule 4 (architectural) because the project has ALREADY MADE the architectural decision and committed the stub. This plan execution merely consumes the existing resolution.
- **Impact on plan:** Task 2 collapses to "skipped per plan's Step 6 success path"; SC 6 PASSES on stub's terms without PATH C deferral paperwork.

## Issues Encountered

- **Empty `.contracts/` in vercel-commerce checkout.** The UAT needs clickable graph nodes; DEMO-01 (hand-curated seeding) is Phase 9, not Phase 4. The user either has a different repo loaded in the running app session or will need to flag this as a Phase 4 UAT gap for `/gsd:plan-phase 4 --gaps`. Surfaced to the user in the checkpoint.

- **Dev server was NOT running at plan start.** Initial `curl http://localhost:3000/` returned `000` (connection refused). Followed plan Task 1 Step 6: `pnpm dev` in `/Users/yang/lahacks/demo-repo/vercel-commerce` spawned `next dev --turbopack`, server came up in ~8s, verified with curl probes. Dev server left running for Task 3 UAT per plan instruction.

- **pnpm (not npm) is the vercel/commerce package manager.** The upstream README says `npm run dev`, but the checkout ships a `pnpm-lock.yaml` and the project has pnpm installed globally. Used `pnpm dev` to match the lockfile. No issue — plan's `npm run dev` spec is a close-enough alias.

## Pending State Updates

Deferred until Task 3 UAT concludes. On sign-off path UNCONDITIONAL (expected — stub SC 6 passes):

- `.planning/ROADMAP.md` Phase 4 row → Complete (date 2026-04-24)
- `.planning/REQUIREMENTS.md` INSP-01 → Complete (INSP-02/03/04/05 already Complete from plans 01-03)
- `.planning/STATE.md` advance position past Phase 4; record Shopify-pivot decision; note seeding gap for Phase 9

## Next Phase Readiness

Phase 5 Wave 2 (MCP real tool impls + Claude Code UAT) and Phase 7 (drift detection watcher) both unblocked by Phase 4 completion.

Phase 9 demo seeding is the OWNER of populating `.contracts/` in vercel-commerce with ~25 hand-curated L0–L2 nodes (DEMO-01). Until then, any UAT requiring clickable graph nodes must load a repo with pre-existing sidecars OR manually author a handful inside the running app.

## UAT Outcome + Gap Closure

**Phase 4 Status: COMPLETE** (stub-equivalent PATH B for SC 6, gap-closure fixes landed inline)

### Success Criteria

| SC | Result | Evidence |
|----|--------|----------|
| 1 | PASS | Four-tab inspector, Monaco workers clean, expand handles, true line numbers (after repo switch to `/tmp/phase6-uat` — seeded `CheckoutButton.tsx` fixture) |
| 2 | PASS | Iframe renders vercel-commerce stub at `localhost:3000` |
| 3 | PASS | After gap fixes (see below) — autosave flips "editing…" → "saved", `human_pinned: true` written |
| 4 | PASS | DriftBadge Synced/Drifted pills visible; Reconcile button shows inline "Phase 7" hint |
| 5 | Partial | Single-file node only — multi-file not constructed (acceptable per plan) |
| 6 | PASS | vercel-commerce stub boots, 8 fixture products render outside + inside iframe |

### Gap Closures Landed Inline

Five integration bugs surfaced during UAT; fixed without spawning `/gsd:plan-phase 4 --gaps`:

1. **Autosave reverted edits** — `Inspector.tsx` `loadNode` effect was refiring on every `nodes` rescan (file watcher, save-triggered). Added UUID-match guard so loadNode only fires when the user actually switches nodes.
2. **FK constraint violation on save** — `dddd` node stored `parent_uuid = ''` (empty string) in SQLite. Empty-string bind fails `REFERENCES nodes(uuid)`. Fix: normalize empty strings → `NULL` on both the JS frontmatter builder (`editor.ts`) and the Rust `upsert_node_pub` bind (`scanner.rs`). DB existing rows scrubbed via `UPDATE nodes SET parent_uuid = NULL WHERE parent_uuid = ''`.
3. **`useGraphStore.repoPath` null after full restart** — Rust `RepoState` is `Mutex<Option<PathBuf>>` with no disk backing; resets to `None` on process restart while SQLite still serves cached nodes. Fix: `localStorage['contract-ide:last-repo']` persistence in `pickAndOpenRepo`/`openRepo`; `AppShell` rehydrate with Rust-state-first → localStorage-fallback → `openRepo()` to re-initialise watcher.
4. **Reconcile button felt dead** — plan spec'd `console.log` placeholder; user reasonably expected UI feedback. Added 2.4s inline "Reconcile flow ships in Phase 7" hint.
5. **Devlog infrastructure** — Rust `devlog` command + JS `installDevLog()` mirror every `console.*` call to `/tmp/contract-ide.log` so an external tailer (ie. Claude Code) can debug the running Tauri app without the user pasting devtools output by hand. Load-bearing diagnostic tool for Phase 6+ agent-loop debugging.

### Self-Check: PASSED

- `cargo check` + `npx tsc --noEmit` both green at HEAD.
- Live save path verified end-to-end via `/tmp/contract-ide.log`:
  `[saveContract] start → hashed → read existing present → wrote ok → set isDirty=false`
- Sidecar on disk (`/tmp/phase6-uat/.contracts/dddd….md`) carries `human_pinned: true` + fresh `contract_hash` + untouched `neighbors`.
- File on disk: `.planning/phases/04-inspector-monaco/04-04-SUMMARY.md`
- STATE.md / ROADMAP.md / REQUIREMENTS.md updates in same commit.
