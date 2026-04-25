---
created: 2026-04-25
plan: 09-05
status: provisioned
---

# contract-ide-demo Spec

Tracks the locked commit SHA, provisioning state, and operational details
for the `contract-ide-demo` repository. Referenced by 09-05's reset script
and 09-06's UAT.

## Repo location

```
/Users/yang/lahacks/contract-ide-demo/
```

Separate git repository. NOT a subdirectory of lahacks (the lahacks repo
does not track contract-ide-demo's history).

## Locked SHA

```
Locked SHA: 9f5029b0f4667ef4c5182a5386092b8e201e01af
Tag: demo-base
```

The `demo-base` tag points to this SHA. 09-05's reset script restores to
this tag with `.contracts/` removed.

Previous SHA (pre-FLOW-01): `95c1c203ec1e05cdc293ce8ce30c50c9b18d6cdd` — 35 contracts, no flow kind.

## Scaffolded routes

| Route | File | Notes |
|---|---|---|
| `/account/settings` | `src/app/account/settings/page.tsx` | No Delete button (planted absence) |
| `/team/test/settings` | `src/app/team/[slug]/settings/page.tsx` | No Delete Workspace button |

## Package manager

`pnpm` (v9.12.3)

## Auth library

Stub (no external auth library). `src/lib/auth.ts` exports `getCurrentUser()`
returning a hardcoded demo user. Decision: lucia adds dep-resolution friction
and the demo never actually authenticates — the import path just needs to
resolve at type-check time.

## section_hashes

Left empty (`{}`) for lazy migration on first write. The section-parser-cli
binary (Phase 8 PROP-01 deliverable) was NOT used to pre-compute hashes —
the Phase 8 lazy-migration design populates them on first reconcile write.

## Contract count

35 total: 4 scenario-specific + 31 ambient

| Category | Count |
|---|---|
| Scenario-specific (a0000000, a1000000, b0000000, b1000000) | 4 |
| L1 flow roots (Auth, Account, Team, Commerce) | 4 |
| L2 surfaces (Login, Signup, Billing, Profile/Settings, Members, TeamSettings, Cart, Checkout) | 8 |
| L3 UI components | 6 |
| L3 API/lib/external contracts | 7 |
| L4 UI atoms | 6 |
| Background job + event | 2 |
| **Total** | **35** |

## UUID scheme for ambient contracts

- L1 flows: `f{flow_index}000000-0000-4000-8000-000000000000`
  - f1 = Auth Flow, f2 = Account Flow, f3 = Team Flow, f4 = Commerce Flow
- L2 surfaces: `f{flow_index}{surface_index}0000-0000-4000-8000-000000000000`
- L3 components: `f{flow}{surface}{component}00-0000-4000-8000-000000000000`
- L4 atoms: `f{flow}{surface}{component}{atom}-0000-4000-8000-000000000000`
- Backend-kind atoms: `e{sequence}000000-0000-4000-8000-000000000000`

NO UUID collisions with the 4 scenario UUIDs (a0000000, a1000000, b0000000, b1000000).

## Prisma / SQLite setup

Prisma 7.8.0 — uses `prisma.config.ts` (Prisma 7 moved datasource URL out of
`schema.prisma`). Uses `@prisma/adapter-better-sqlite3` + `better-sqlite3`.

```bash
pnpm prisma db push      # creates prisma/dev.db
pnpm tsx prisma/seed.ts  # seeds one user + workspace
```

Seeded data:
- User: `user@example.com` / stripeCustomerId: `cus_demo`
- Workspace: slug `test`, name `Acme Engineering` / stripeCustomerId: `cus_workspace_demo`

## Required env vars (all empty for demo)

```
DATABASE_URL="file:./prisma/dev.db"  # used by prisma.config.ts
STRIPE_SECRET_KEY=""
MAILCHIMP_API_KEY=""
MAILCHIMP_SERVER_PREFIX=""
```

## Pitfall 2 resolution (Prisma initialization on initial render)

Account Settings and Team Settings pages are static RSC shells — they do NOT
make any Prisma calls in their initial render (no `db.user.findUnique()` etc.).
The pages render purely from JSX with hardcoded placeholder values. Agent adds
the data-fetching in Beat 2. Pitfall 2 resolved: no Prisma import in these pages.

## Bare-Claude reproducibility (Option A)

NO `CLAUDE.md` exists in the demo repo at the `demo-base` tag. The demo-setup
notes live in `DEMO-SETUP.md`. 09-05's record-baseline.sh asserts:

```bash
[ ! -f CLAUDE.md ] || { echo "ERROR: CLAUDE.md exists — Option A violated"; exit 1; }
```

The `AGENTS.md` file exists (created by create-next-app) and contains Next.js
agent rules. This is not a CLAUDE.md equivalent — `claude` CLI does not
auto-load AGENTS.md as project instructions. The assertion only checks for
CLAUDE.md specifically.

## 09-05 reset procedure

```bash
/Users/yang/lahacks/.planning/demo/scripts/reset-demo.sh
```

This restores the repo to the locked SHA + copies the substrate seed to
`/tmp/contract-ide-demo-substrate.sqlite` in one command. Phase 13 will extend
this script with dev-server start + Contract IDE launch + watcher restart.

The substrate seed schema is defined in:
`.planning/demo/seeds/substrate-rules.sql`

Rebuild the seed after edits:
```bash
/Users/yang/lahacks/.planning/demo/scripts/build-substrate-seed.sh
```

### 5x reproducibility log (2026-04-25T10:20Z)

```
Run 1: substrate=f4c2f579e50275513d9a56fdaf6189cddb1aa5afa80b66a4166c05fc9caa9354 repo=9f5029b0f4667ef4c5182a5386092b8e201e01af
Run 2: substrate=f4c2f579e50275513d9a56fdaf6189cddb1aa5afa80b66a4166c05fc9caa9354 repo=9f5029b0f4667ef4c5182a5386092b8e201e01af
Run 3: substrate=f4c2f579e50275513d9a56fdaf6189cddb1aa5afa80b66a4166c05fc9caa9354 repo=9f5029b0f4667ef4c5182a5386092b8e201e01af
Run 4: substrate=f4c2f579e50275513d9a56fdaf6189cddb1aa5afa80b66a4166c05fc9caa9354 repo=9f5029b0f4667ef4c5182a5386092b8e201e01af
Run 5: substrate=f4c2f579e50275513d9a56fdaf6189cddb1aa5afa80b66a4166c05fc9caa9354 repo=9f5029b0f4667ef4c5182a5386092b8e201e01af
```

All 5 runs: identical substrate SHA-256 hash + identical repo HEAD = reproducibility VERIFIED.

## BABEL-01 spike result

**Route attempted:** Custom webpack loader using @babel/parser (NOT babel-loader)
**Spike date:** 2026-04-25T09:15:00Z
**Result:** PASS — Route A (custom webpack loader)
**HMR test:** PASS — attribute preserved after file save (dev server reprocesses .tsx through loader on each HMR cycle)
**Build test:** PASS — `data-contract-uuid` visible in `.next/server/app/account/settings.html` static HTML
**Failure mode (if any):** None. Key deviation from plan's Route A spec: used custom webpack loader (not babel-loader) to avoid Turbopack/babel-loader compatibility issues with Next.js 16. `next dev --webpack` and `next build --webpack` flags added to package.json scripts because Next.js 16 defaults to Turbopack, which doesn't support `module.rules` webpack config.
**Decision:** Ship Route A (custom webpack loader using @babel/parser from Next.js pnpm store) — Phase 13 CHIP-01 builds against `data-contract-uuid` DOM attribute on the Danger Zone `<section>` element.

Phase 13 CHIP-01 dependency confirmed: to resolve a click in the iframe to a contract UUID, Phase 13 reads `event.target.closest('[data-contract-uuid]')?.dataset.contractUuid` from the DOM. No postMessage needed — data is already in the DOM.

## FLOW-01 seeded flows (Phase 9 09-04c)

6 flow contracts committed at the locked SHA (9f5029b). New contract count: 35 + 14 = 49.

| Flow uuid | Name | Trigger uuid | # members | Demo beats |
|-----------|------|--------------|-----------|------------|
| `flow-de1e-0000-4000-8000-acc000000000` | delete-account | `a0000000-...` (Account Settings UI) | 7 | Beat 1, Beat 2 |
| `flow-de1e-0000-4000-8000-wks000000000` | delete-workspace | `b0000000-...` (Team Settings UI) | 7 | Beat 4 |
| `flow-sgup-0000-4000-8000-auth000000000` | signup | `f1020100-...` (SignupForm UI) | 5 | ambient density |
| `flow-chkt-0000-4000-8000-comm000000000` | checkout | `f4020100-...` (CheckoutButton UI) | 5 | ambient density |
| `flow-atm0-0000-4000-8000-team000000000` | add-team-member | `f3010100-...` (MembersTable UI) | 4 | ambient density |
| `flow-pwrs-0000-4000-8000-auth000000001` | password-reset | `f1010100-...` (LoginForm UI) | 3 | ambient density |

### delete-account chain UUID resolution table

Phase 13 CHAIN-01 reads these to render the Beat 1/2 vertical chain.

| Position | UUID | Contract | Kind | Notes |
|----------|------|----------|------|-------|
| 0 (trigger) | `a0000000-0000-4000-8000-000000000000` | Account Settings page | UI L3 | Phase 13: iframe render mode |
| 1 | `e1000000-0000-4000-8000-000000000000` | POST /api/account/delete | API L3 | Phase 13: structured card |
| 2 | `e2000000-0000-4000-8000-000000000000` | beginAccountDeletion | lib L3 | Phase 13: structured card |
| 3 | `e5000000-0000-4000-8000-000000000000` | db.user (data model) | data L2 | Phase 13: structured card |
| 4 | `e7000000-0000-4000-8000-000000000000` | stripe.customers.update | external L3 | Phase 13: structured card |
| 5 | `e8000000-0000-4000-8000-000000000000` | mailchimp.suppress | external L3 | Phase 13: structured card |
| 6 | `ec000000-0000-4000-8000-000000000000` | sendDeletionConfirmationEmail | lib L3 | Phase 13: structured card |

### delete-workspace chain UUID resolution table

Phase 13 Beat 4 needs this chain. Members 3-5 are SHARED with delete-account — Phase 13 renders them as ghost-referenced cards.

| Position | UUID | Contract | Kind | Shared with delete-account? |
|----------|------|----------|------|-----------------------------|
| 0 (trigger) | `b0000000-0000-4000-8000-000000000000` | Team Settings page | UI L3 | No |
| 1 | `e4000000-0000-4000-8000-000000000000` | DELETE /api/workspace/[slug] | API L3 | No |
| 2 | `ed000000-0000-4000-8000-000000000000` | beginWorkspaceDeletion | lib L3 | No |
| 3 | `e5000000-0000-4000-8000-000000000000` | db.user | data L2 | **Yes** |
| 4 | `e7000000-0000-4000-8000-000000000000` | stripe.customers.update | external L3 | **Yes** |
| 5 | `e8000000-0000-4000-8000-000000000000` | mailchimp.suppress | external L3 | **Yes** |
| 6 | `ee000000-0000-4000-8000-000000000000` | sendWorkspaceDeletionConfirmationEmail | lib L3 | No |

### New participant contracts added by 09-04c

8 new lib/data contracts authored to fill gaps in the flow chains:

| UUID | Contract | Kind | Flow(s) |
|------|----------|------|---------|
| `ec000000-0000-4000-8000-000000000000` | sendDeletionConfirmationEmail | lib L3 | delete-account |
| `ed000000-0000-4000-8000-000000000000` | beginWorkspaceDeletion | lib L3 | delete-workspace |
| `ee000000-0000-4000-8000-000000000000` | sendWorkspaceDeletionConfirmationEmail | lib L3 | delete-workspace |
| `ef000000-0000-4000-8000-000000000000` | validateSignup | lib L3 | signup |
| `f00000a0-0000-4000-8000-000000000000` | sendWelcomeEmail | lib L3 | signup |
| `f00000b0-0000-4000-8000-000000000000` | validatePayment | lib L3 | checkout |
| `f00000c0-0000-4000-8000-000000000000` | sendReceiptEmail | lib L3 | checkout |
| `f00000d0-0000-4000-8000-000000000000` | sendInviteEmail | lib L3 | add-team-member |
| `f00000e0-0000-4000-8000-000000000000` | sendPasswordResetEmail | lib L3 | password-reset |
| `f00000f0-0000-4000-8000-000000000000` | data-order | data L2 | checkout |
| `f0000100-0000-4000-8000-000000000000` | data-invite | data L2 | add-team-member |

## Deviations from scenario-criteria.md § 9

1. **src/ directory structure**: create-next-app created a `src/` directory
   despite `--src-dir false` flag. All source files are under `src/`
   (e.g., `src/app/`, `src/lib/`, `src/components/`). Contract `code_ranges`
   reference the `src/`-prefixed paths. No functional impact.

2. **Prisma 7 configuration**: Prisma 7.8.0 removed datasource URL from
   `schema.prisma` in favor of `prisma.config.ts`. Schema uses `@prisma/adapter-better-sqlite3`.
   `db.user.update()` / `db.invoice.updateMany()` etc. work identically — the
   adapter is transparent to query code.

3. **31 ambient contracts instead of 20**: 35 total contracts (31 ambient
   + 4 scenario) exceeds the 20-minimum for canvas density. All JSX-01 and
   BACKEND-FM-01 constraints are satisfied.
