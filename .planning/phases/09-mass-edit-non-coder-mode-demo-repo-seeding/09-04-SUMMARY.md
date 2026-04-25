---
phase: 09-mass-edit-non-coder-mode-demo-repo-seeding
plan: 04
subsystem: demo-repo-provisioning
tags: [demo, next.js, prisma, contracts, sqlite, shadcn]
dependency_graph:
  requires: []
  provides: [contract-ide-demo-repo, demo-base-sha, 4-scenario-contracts, 35-ambient-contracts]
  affects: [09-05-baseline-recording, 09-06-uat, 10-session-watcher]
tech_stack:
  added:
    - next.js@16.2.4
    - prisma@7.8.0
    - "@prisma/adapter-better-sqlite3@7.8.0"
    - better-sqlite3@12.9.0
    - stripe@22.1.0
    - "@mailchimp/mailchimp_marketing@3.0.80"
    - shadcn/ui (button, card, input, label, badge, separator)
    - tsx@4.21.0
  patterns:
    - "Prisma 7 uses prisma.config.ts for datasource URL (not schema.prisma)"
    - "PrismaBetterSqlite3({ url: 'file:...' }) constructor — not pre-created Database instance"
    - "Option A: DEMO-SETUP.md replaces CLAUDE.md for bare-Claude baseline protection"
    - "rollup_state: untracked = gray on first paint (Phase 8 PROP-02 lazy migration)"
key_files:
  created:
    - /Users/yang/lahacks/contract-ide-demo/prisma/schema.prisma
    - /Users/yang/lahacks/contract-ide-demo/prisma.config.ts
    - /Users/yang/lahacks/contract-ide-demo/prisma/seed.ts
    - /Users/yang/lahacks/contract-ide-demo/src/app/account/settings/page.tsx
    - /Users/yang/lahacks/contract-ide-demo/src/app/team/[slug]/settings/page.tsx
    - /Users/yang/lahacks/contract-ide-demo/src/components/ui/danger-action-button.tsx
    - /Users/yang/lahacks/contract-ide-demo/src/lib/account/beginAccountDeletion.ts
    - /Users/yang/lahacks/contract-ide-demo/src/lib/marketing/lists.ts
    - /Users/yang/lahacks/contract-ide-demo/src/lib/auth.ts
    - /Users/yang/lahacks/contract-ide-demo/src/lib/db.ts
    - /Users/yang/lahacks/contract-ide-demo/DEMO-SETUP.md
    - /Users/yang/lahacks/contract-ide-demo/.contracts/a0000000-0000-4000-8000-000000000000.md
    - /Users/yang/lahacks/contract-ide-demo/.contracts/a1000000-0000-4000-8000-000000000000.md
    - /Users/yang/lahacks/contract-ide-demo/.contracts/b0000000-0000-4000-8000-000000000000.md
    - /Users/yang/lahacks/contract-ide-demo/.contracts/b1000000-0000-4000-8000-000000000000.md
    - /Users/yang/lahacks/.planning/demo/contract-ide-demo-spec.md
  modified:
    - /Users/yang/lahacks/.gitignore
    - /Users/yang/lahacks/contract-ide-demo/README.md
decisions:
  - "Prisma 7.8.0 datasource configuration: moved to prisma.config.ts; earlyAccess flag not in TS types (ts-ignore used)"
  - "PrismaBetterSqlite3 takes config object {url} not pre-created Database instance (v7 breaking change)"
  - "Auth adapter: stub (not lucia) — getCurrentUser() returns hardcoded user; import path resolves; no external dep friction"
  - "src/ directory structure: create-next-app created src/ despite --src-dir false; all paths prefixed with src/"
  - "31 ambient contracts instead of 20: extra coverage for canvas density, all passing JSX-01 + BACKEND-FM-01"
  - "section_hashes left empty ({}): lazy migration path per Phase 8 PROP-01 design; rollup_state: untracked on all"
  - "demo-base tag: points to contract SHA 95c1c20 (after contracts commit, not scaffold-only)"
metrics:
  duration_minutes: 19
  completed_date: 2026-04-25
  tasks_completed: 3
  tasks_total: 3
  files_created: 39
---

# Phase 9 Plan 04: Demo Repo Provisioning Summary

Provisioned the `contract-ide-demo` repo at `/Users/yang/lahacks/contract-ide-demo/` as a separate git repository with Next.js 14+ App Router + Prisma 7 SQLite + Stripe + Mailchimp + 35 contract sidecars (4 scenario-specific + 31 ambient) per DEMO-01 spec.

## Locked SHA

```
Locked SHA: 95c1c203ec1e05cdc293ce8ce30c50c9b18d6cdd
Tag: demo-base
```

## Option A Confirmation

NO `CLAUDE.md` exists in the demo repo at the locked commit. Demo-setup notes live in `DEMO-SETUP.md`. The `AGENTS.md` file created by create-next-app contains Next.js agent rules — it is NOT a Claude project-instructions file and is not auto-loaded by the `claude` CLI.

09-05's record-baseline.sh should assert:
```bash
[ ! -f CLAUDE.md ] || { echo "ERROR: CLAUDE.md exists — Option A violated"; exit 1; }
```

## What was built

### Task 1: Next.js Scaffold

- Next.js 16.2.4 + TypeScript + Tailwind v4 + shadcn/ui (button, card, input, label, badge, separator)
- Prisma 7.8.0 with SQLite via `@prisma/adapter-better-sqlite3` — `prisma.config.ts` specifies datasource URL (Prisma 7 broke the `datasource.url` in schema.prisma pattern)
- Stripe + Mailchimp + Auth adapter packages installed; type-check passes
- `DangerActionButton` component: `src/components/ui/danger-action-button.tsx`
- Account Settings scaffold: `src/app/account/settings/page.tsx` — NO delete button (planted absence)
- Team Settings scaffold: `src/app/team/[slug]/settings/page.tsx` — NO delete-workspace button (planted absence)
- `lib/account/beginAccountDeletion.ts` stub — throws "not implemented — Beat 2 agent fills this"
- `lib/marketing/lists.ts` — MARKETING_LIST_ID + TRANSACTIONAL_LIST_ID constants
- `lib/auth.ts` — getCurrentUser() stub (no external auth library)
- `prisma/seed.ts` — seeds user@example.com + workspace slug=test
- Both pages expose Danger Zone sections with heading + copy but NO delete button

### Task 2: Contract Sidecars

35 total contracts committed to `.contracts/`:

**4 scenario-specific (root level):**
- `a0000000-0000-4000-8000-000000000000.md` — Account Settings L3 (rollup_inputs: [a1000000])
- `a1000000-0000-4000-8000-000000000000.md` — DangerZone L4 (Beat 1 target)
- `b0000000-0000-4000-8000-000000000000.md` — Team Settings L3 (rollup_inputs: [b1000000])
- `b1000000-0000-4000-8000-000000000000.md` — TeamDangerZone L4 (Beat 4 target)

**31 ambient (`.contracts/ambient/`):**
- 4 L1 flow roots: Auth, Account, Team, Commerce
- 8 L2 surfaces: Login, Signup, Billing, Profile/Settings, Members, TeamSettings, Cart, Checkout
- 6 L3 UI components: LoginForm, SignupForm, PaymentMethod, CheckoutButton, MembersTable, TeamDangerZone parent
- 7 L3 backend contracts: 4 API endpoints + 1 lib + 2 data models
- 2 L2 backend contracts: external (Stripe, Mailchimp)
- 2 infrastructure: job (nightly-purge) + event (payment-webhook)

**JSX-01 compliance:** All 6 L4 UI atoms have code_ranges covering a single outer JSX element.

**BACKEND-FM-01 compliance:** All 11 backend-kind contracts have `## Inputs` / `## Outputs` / `## Side effects` sections.

## Package manager

`pnpm` (v9.12.3)

## Auth library decision

Stub — `src/lib/auth.ts` exports `getCurrentUser()` returning `{ id: 'demo-user', email: 'user@example.com' }`. The demo never actually authenticates. Chose stub over lucia because: (1) no dep-resolution friction, (2) import path resolves at type-check time, (3) the demo's agent code only imports `getCurrentUser()`.

## section_hashes decision

Left empty (`{}`) throughout. Chose the lazy-migration path per Phase 8 PROP-01 design — section hashes are populated on first reconcile write. The section-parser-cli binary (Phase 8 PROP-01 deliverable) exists in the contract-ide binaries directory but was NOT used to pre-compute hashes. `rollup_state: untracked` on all contracts (gray on first paint per PROP-02 cold-start design).

## Pitfall 2 resolution

Account Settings and Team Settings pages are pure static RSC shells with no Prisma imports in their render. The pages use hardcoded placeholder values (email: 'user@example.com', slug from params). Agent adds the data-fetching in Beat 2. No Prisma initialization errors on initial render.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Prisma 7 datasource URL must be in prisma.config.ts**
- **Found during:** Task 1 — `pnpm prisma generate` failed with `P1012` error
- **Issue:** Prisma 7 removed `datasource.url` from `schema.prisma`; requires `prisma.config.ts`
- **Fix:** Created `prisma.config.ts` with `defineConfig({ datasource: { url: 'file:...' } })`; added `earlyAccess: true` at runtime (not in TS types; used ts-ignore)
- **Files modified:** `prisma/schema.prisma` (removed url), `prisma.config.ts` (new)
- **Commit:** 7face05 (scaffold commit)

**2. [Rule 1 - Bug] PrismaBetterSqlite3 v7 takes config object, not Database instance**
- **Found during:** Task 1 — `pnpm tsx prisma/seed.ts` failed with "PrismaBetterSQLite3 is not a constructor"
- **Issue 1:** Export name is `PrismaBetterSqlite3` (lowercase 's'/'q') not `PrismaBetterSQLite3`
- **Issue 2:** Prisma 7 adapter takes `{ url: 'file:...' }` config object, not a pre-created `Database` instance
- **Fix:** Updated all imports and constructor calls in seed.ts and db.ts
- **Files modified:** `prisma/seed.ts`, `src/lib/db.ts`
- **Commit:** 7face05 (scaffold commit, fixed inline)

**3. [Rule 2 - Missing critical] create-next-app created CLAUDE.md**
- **Found during:** Task 1 — directory listing after scaffold
- **Issue:** create-next-app v16 created `CLAUDE.md` containing `@AGENTS.md` — a project-instructions file that would violate Option A
- **Fix:** Removed `CLAUDE.md` immediately before first git init (never committed)
- **Commit:** 7face05 (CLAUDE.md never committed — not present at any SHA)

**4. [Rule 1 - Bug] src/ directory structure despite --src-dir false**
- **Found during:** Task 1 — after scaffold completed
- **Issue:** create-next-app created `src/` directory structure. Worked with this structure rather than fighting the scaffold. Contract `code_ranges` reference `src/`-prefixed paths.
- **Impact:** Minor — all code_ranges in contracts use the correct `src/` paths
- **Commit:** Not a deviation from behavior, just different path prefix

### Auth Library Fallback

Chose auth stub over lucia per plan's fallback instruction ("FALL BACK to a lib/auth.ts stub if lucia adds dep-resolution friction"). lucia+@lucia-auth/adapter-prisma were not tested — the stub is lighter and sufficient for the demo.

## Verification Status

All 3 tasks complete — human-verify checkpoint APPROVED:

- `pnpm install` + `pnpm prisma generate` + `pnpm prisma db push` + seed: all pass
- `pnpm dev` boots (port 3001 since 3000 was in use during verification)
- `/account/settings` and `/team/[slug]/settings` render without delete buttons
- `pnpm tsc --noEmit` clean
- 35 contracts committed including 4 scenario UUIDs
- All L4 UI atoms: single-JSX-element code_ranges (JSX-01 ready)
- All backend-kind contracts: Inputs + Outputs + Side effects (BACKEND-FM-01 ready)
- NO CLAUDE.md at any commit
- demo-base tag at SHA 95c1c20
- Task 3 human-verify checkpoint: **APPROVED** by user 2026-04-25

## Known Limitations / Phase 9 Polish Backlog

### Cmd+K search-by-intent-text gap

The Cmd+K palette (`find_by_intent_mass` plumbing shipped in 09-01) indexes contract nodes by `name`, `level`, and `kind` for the autocomplete display. The intent-text semantic search path (`find_by_intent_mass` MCP tool, which queries by free-form intent text using section-weighted re-ranking) is NOT yet wired into the Cmd+K palette UI.

**Current behavior:** `Cmd+K → "DangerZone"` resolves via node name match. `Cmd+K → "destructive endpoint"` searches by name only and may return zero hits even though the intent-text search path in `find_by_intent_mass` would return several ambient contracts that mention destructive endpoints in their `## Intent` sections.

**Impact on demo:** Beat 1 uses the canvas click path (PM clicks rendered Danger Zone in the iframe, which resolves to the a1000000 UUID via BABEL-01 chip annotation), NOT the Cmd+K text-search path. Demo is not blocked.

**Fix location:** `contract-ide/src/components/palette/CommandPalette.tsx` — the `find_nodes` IPC call should be supplemented with a `find_by_intent_mass` call for non-empty query strings, merging results and deduplicating by UUID. Deferred to 09-04b or Phase 13 polish per ROADMAP sequencing.

## Self-Check: PASSED

All key files exist:
- prisma/schema.prisma: FOUND
- danger-action-button.tsx: FOUND
- account settings page: FOUND
- team settings page: FOUND
- beginAccountDeletion.ts: FOUND
- lists.ts: FOUND
- a0000000, a1000000, b0000000, b1000000: all FOUND
- DEMO-SETUP.md: FOUND
- No CLAUDE.md: CONFIRMED
- contract-ide-demo-spec.md: FOUND

Commits in demo repo:
- 800357b docs: update README with locked SHA 95c1c20
- 95c1c20 feat: seed 35 contracts (4 scenario + 31 ambient) per DEMO-01
- 7face05 feat: scaffold contract-ide-demo per DEMO-01 spec
- demo-base tag: points to 95c1c20

Commit in lahacks repo:
- ff8f443 feat(09-04): scaffold contract-ide-demo repo
