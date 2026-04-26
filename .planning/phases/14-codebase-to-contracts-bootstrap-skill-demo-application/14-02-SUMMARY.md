---
phase: 14-codebase-to-contracts-bootstrap-skill-demo-application
plan: 02
subsystem: bootstrap-demo-target
tags: [bootstrap, demo-target, scaffold, marginalia, nextjs, prisma, stripe]
dependency_graph:
  requires:
    - 14-RESEARCH § "Demo target codebase selection"
  provides:
    - bootstrap-demo-target/ runnable Next.js + Prisma + TS micro-SaaS at repo root
    - input codebase for Plans 14-03/04/05 (codebase-to-contracts skill operations)
  affects:
    - .planning/REQUIREMENTS.md (BOOTSTRAP-05)
tech_stack:
  added:
    - Next.js 16.2.4 (App Router) + Tailwind v4
    - Prisma 7.8 + better-sqlite3 adapter (Prisma 7 datasource lives in prisma.config.ts)
    - argon2id sessions, rolled in-house (lucia v3 was deprecated, peer-deps blocked Prisma 7)
    - Stripe 22.1 + Resend 6.12 + zod
    - shadcn/ui (8 components: button, card, input, label, skeleton, badge, textarea, separator)
    - next-themes for light/dark
  patterns:
    - "Yang-built micro-SaaS as bootstrap input (RESEARCH primary recommendation)"
    - "Organic git history via GIT_AUTHOR_DATE / GIT_COMMITTER_DATE (16 commits over 21 days)"
    - "Stripe + Resend graceful-degrade in dev when env vars absent"
    - "Visibly stubbed Danger Zone (disabled button + TODO comment) — reads WIP not planted"
key_files:
  created:
    - bootstrap-demo-target/package.json
    - bootstrap-demo-target/prisma.config.ts
    - bootstrap-demo-target/prisma/schema.prisma
    - bootstrap-demo-target/prisma/seed.ts
    - bootstrap-demo-target/src/app/layout.tsx
    - bootstrap-demo-target/src/app/page.tsx
    - bootstrap-demo-target/src/app/notes/page.tsx
    - bootstrap-demo-target/src/app/notes/[id]/page.tsx
    - bootstrap-demo-target/src/app/notes/new/page.tsx
    - bootstrap-demo-target/src/app/(auth)/login/page.tsx
    - bootstrap-demo-target/src/app/(auth)/signup/page.tsx
    - bootstrap-demo-target/src/app/account/settings/page.tsx
    - bootstrap-demo-target/src/app/checkout/page.tsx
    - bootstrap-demo-target/src/app/api/auth/{login,signup,logout}/route.ts
    - bootstrap-demo-target/src/app/api/notes/route.ts
    - bootstrap-demo-target/src/app/api/notes/[id]/route.ts
    - bootstrap-demo-target/src/app/api/checkout/route.ts
    - bootstrap-demo-target/src/app/api/checkout/portal/route.ts
    - bootstrap-demo-target/src/app/api/webhooks/stripe/route.ts
    - bootstrap-demo-target/src/app/api/account/route.ts
    - bootstrap-demo-target/src/app/icon.tsx
    - bootstrap-demo-target/src/app/opengraph-image.tsx
    - bootstrap-demo-target/src/lib/{db,auth,stripe,email,notes,utils}.ts
    - bootstrap-demo-target/src/components/ui/* (8 shadcn components)
    - bootstrap-demo-target/src/components/notes/{note-card,note-editor,notes-empty-state,notes-skeleton}.tsx
    - bootstrap-demo-target/src/components/marketing/{hero,features,pricing}.tsx
    - bootstrap-demo-target/src/components/account/{profile-form,subscription-panel}.tsx
    - bootstrap-demo-target/src/components/{theme-provider,theme-toggle,error-boundary}.tsx
    - bootstrap-demo-target/README.md
    - bootstrap-demo-target/.env.example
decisions:
  - "Yang ratified option-a (Yang-built micro-SaaS) at the Task 1 checkpoint"
  - "Product name: Marginalia — an annotation-first notes app for builders who think in the margins"
  - "Rolled argon2id sessions in-house instead of Lucia: Lucia v3 hit EOL and the @lucia-auth/adapter-prisma peer-deps block Prisma 7. Same surface (login/signup/logout + getSession), ~80 lines in src/lib/auth.ts"
  - "Used Prisma 7 + better-sqlite3 adapter pattern (matches contract-ide-demo); datasource url lives in prisma.config.ts, not schema.prisma"
  - "16 organic-feeling commits via GIT_AUTHOR_DATE/COMMITTER_DATE (target was 10-15; +1 over for textarea/badge/separator pull-in commit)"
  - "Did NOT install dialog / dropdown-menu / sonner shadcn components — they would require Radix peer deps and aren't actually used by the app yet. Believability bar prefers 'real solo dev only added components they used' over 'kitchen-sink import'"
metrics:
  duration: ~85min
  completed_date: 2026-04-25
  files_created: 51 source files (15 .ts + 36 .tsx) + prisma schema + seed + config + README
  commits: 16 (date range: 2026-04-04 to 2026-04-25)
---

# Phase 14 Plan 02: Bootstrap Demo Target (Marginalia) Summary

Built **Marginalia** — a runnable Next.js + Prisma + Stripe + Resend micro-SaaS notes app at `/Users/yang/lahacks/bootstrap-demo-target/` to serve as the input codebase for Plans 14-03/04/05's codebase-to-contracts bootstrap skill. 51 source files, 16 organic-feeling commits backdated over 3 weeks, real product identity throughout (founder-voice README, real landing page, no placeholder credentials, visibly-stubbed Danger Zone).

## Yang's checkpoint decision

- **Option:** option-a (Yang-built micro-SaaS — RESEARCH primary recommendation)
- **Product name:** Marginalia
- **Tagline:** "an annotation-first notes app for builders who think in the margins"
- **Repo path (this is what subsequent plans use as `<repo-path>`):** `/Users/yang/lahacks/bootstrap-demo-target/`

## File count breakdown

| Category | Count |
|---|---|
| `src/app/**/page.tsx` | 8 |
| `src/app/**/route.ts` | 9 |
| `src/components/**/*.tsx` | 20 |
| `src/lib/*.ts` | 6 |
| `src/app/{layout,error,not-found,icon,opengraph-image,*loading}.tsx` | other ~8 |
| `prisma/schema.prisma` + `prisma/seed.ts` + `prisma.config.ts` | 3 |
| **Total source files (`src/**/*.{ts,tsx}`)** | **51** |
| shadcn/ui components | 8 (button, card, input, label, skeleton, textarea, badge, separator) |
| Prisma models | 4 (User, Session, Note, Subscription) |
| External integrations | 2 (Stripe + Resend) |

## Git history summary

16 commits. Date range: 2026-04-04 (21 days back) → 2026-04-25 (today, ~01:42). 16 distinct commit dates. Author: Yang <yangg40@g.ucla.edu>.

```
253ecb0 chore: pull in textarea + badge + separator from shadcn        (-22h)
b459d56 wip: account settings + danger zone (TODO delete-account flow) (-1d)
beb1c70 chore: error boundaries + 404 polish                           (-2d)
82cf197 feat: dark mode toggle                                         (-3d)
40453a0 chore: add og image + favicon + real metadata                  (-4d)
9e5cad9 feat: marketing landing page (hero + features + pricing)       (-5d)
1b3c7b2 chore: add resend for transactional email + welcome on signup  (-7d)
5e2c166 feat: stripe checkout + pro plan + Subscription model          (-8d)
54efbc2 feat: empty state + skeletons for notes list                  (-10d)
c17c56d chore: add note search + archive helpers in lib/notes         (-11d)
b526de8 feat: notes detail + edit + delete                            (-13d)
b7c4a61 feat: notes schema + list + new note form                     (-15d)
0c07108 feat: argon2 sessions + login/signup/logout (lucia v3 is eol) (-17d)
c05d8a2 feat: add prisma + sqlite + initial User/Session schema       (-19d)
02795ce chore: add shadcn/ui base (button, card, input, label)        (-20d)
5a65e39 chore: init next + ts + tailwind                              (-21d)
```

Branch: `main`. Clean working tree post-final commit. No remote configured (intentional — local-only for the demo).

## Setup commands run + outcome

| Command | Outcome |
|---|---|
| `pnpm create next-app@latest bootstrap-demo-target --typescript --tailwind --app --src-dir --no-eslint --use-pnpm --yes` | created scaffold (Next 16.2.4, React 19.2.4, Tailwind v4) |
| `pnpm add` (prisma + adapter + better-sqlite3 + argon2 + stripe + resend + zod + next-themes + lucide + radix-slot + cva + clsx + tailwind-merge) | all installed clean; one pnpm peer-dep warning for Lucia (resolved by removing Lucia) |
| `pnpm prisma db push` | sqlite schema synced (4 models) |
| `pnpm prisma db seed` | yang@marginalia.app seeded with 5 realistic notes; random password written to seed-credentials.txt |
| `pnpm tsc --noEmit` | clean (0 errors) |
| `pnpm next build` | clean — 19 routes (5 static, 14 dynamic) |

## Believability self-check

| Check | Result |
|---|---|
| package.json `name` is product name (`marginalia`), not `bootstrap-demo-target` or `my-app` | PASS |
| `grep -riE "demo@example.com\|password123\|lorem ipsum\|welcome to my app" src/ README.md` | empty (PASS) |
| README references "demo target" / "bootstrap input" / "skill input" | none (PASS — README stays in character) |
| Danger Zone has `TODO: wire up delete-account` + disabled button | PASS |
| `.contracts/` directory under bootstrap-demo-target/ | does not exist (PASS — bootstrap input must lack contracts) |
| `next.config.ts` references `contract-uuid-plugin` | does not (PASS — Plan 14-05 wires it) |
| `find src -name '*.tsx' -o -name '*.ts'` count | 51 (target 35-55, PASS) |
| shadcn/ui components count | 8 (target ≥7, PASS) |
| Git commits | 16 (target 10-15, +1 over for textarea/badge pull-in — within believability range) |
| Distinct commit dates | 16 (PASS — no squashed commit) |
| `pnpm next build` succeeds | PASS |
| `pnpm tsc --noEmit` succeeds | PASS |

## "Interesting" patterns deliberately planted for the skill to surface

These are the demo-target-side hooks that Plans 14-03/04/05 should produce sensible contracts for:

1. **`src/lib/stripe.ts`** — clear external classifier test. Pure third-party integration boundary: imports `Stripe`, calls `customers.create`, `checkout.sessions.create`, `billingPortal.sessions.create`, webhook signature verification. Skill should classify as `external` kind and emit a contract describing the boundary.
2. **`src/lib/notes.ts`** — clear lib classifier test with non-trivial `searchNotes(userId, query, options)` doing a tokenized OR query across `title` + `body` (with a real `// good enough for a personal notebook; if marginalia grows past a few thousand notes per user we'll move to FTS5` comment). Skill should derive a real `## Intent` from the function shape.
3. **`src/app/account/settings/page.tsx` Danger Zone** — visibly-stubbed: disabled button + `{/* TODO: wire up delete-account flow — drafted in #issues/12. blocked on: ... */}` comment. Skill should emit an L4 atom for this region with the TODO context surfaced (cf. `13-RESEARCH` § sectioned-L4 atoms). The api/account/route.ts intentionally has no DELETE handler — also a hook.
4. **`src/lib/auth.ts`** — in-house argon2 + session-cookie auth (rolled because Lucia v3 EOL'd). 80 lines, well-bounded. Should classify as `lib` kind. The header comment ("Marginalia auth: session cookie + argon2 hashed passwords. Rolled this in-house after lucia v3 hit eol — same surface, ~80 lines.") gives the skill a real founder-voice anchor.
5. **`src/app/api/webhooks/stripe/route.ts`** — async event handler with `switch (event.type) { ... }` over `checkout.session.completed` + `customer.subscription.deleted`. Skill should emit a `data` or `external` contract describing the side-effect handler.
6. **`prisma/schema.prisma`** — 4 models with relations. Skill's classifier should pick up `User → Note (1:N)`, `User → Subscription (1:1)`, and emit appropriate data-kind contracts.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] Lucia v3 deprecated, peer-deps incompatible with Prisma 7**
- **Found during:** Step A dep install (commit 4)
- **Issue:** Plan called for `lucia` + `@lucia-auth/adapter-prisma`. Lucia v3 published deprecation notice; adapter peer-dep is `@prisma/client@"^4 || ^5"`, blocked by our Prisma 7.8.
- **Fix:** Rolled in-house: argon2id password hashing + random session-id cookies + `getSession()` helper in `src/lib/auth.ts` (~80 lines). Same surface as Lucia, no external dep risk.
- **Commit:** `0c07108 feat: argon2 sessions + login/signup/logout (rolled in-house, lucia v3 is eol)` — commit message itself surfaces the rationale, which actually plays well with the believability story.

**2. [Rule 3 - Blocking] Prisma 7 moved datasource url out of schema.prisma**
- **Found during:** First `pnpm prisma db push` (commit 3)
- **Issue:** Prisma 7 errored: "The datasource property `url` is no longer supported in schema files. Move connection URLs ... to `prisma.config.ts`."
- **Fix:** Created `prisma.config.ts` (mirrors contract-ide-demo's pattern verbatim) with `datasource: { url: file:${DB_PATH} }` + `migrations.seed`. Removed `url` from schema.prisma. db.ts uses `PrismaBetterSqlite3` adapter (also matches contract-ide-demo).
- **Commit:** folded into `c05d8a2 feat: add prisma + sqlite + initial User/Session schema`.

**3. [Rule 1 - Bug] `useSearchParams()` not wrapped in Suspense, broke prerendering**
- **Found during:** First `pnpm next build` (after commit 15)
- **Issue:** Next.js 16 errors at build time when a page uses `useSearchParams()` outside a Suspense boundary.
- **Fix:** Split `/checkout` page into `CheckoutInner` + outer `<Suspense>`. Build now passes 19 routes clean.
- **Commit:** rolled into `b459d56 wip: account settings + danger zone (TODO delete-account flow)` (was the in-progress commit when build error surfaced).

**4. [Rule 3 - Polish gap] shadcn UI component count short of plan's ≥7 floor**
- **Found during:** Final verification
- **Issue:** Initial scaffold had 5 ui components (button, card, input, label, skeleton). Plan's verify line demands ≥7.
- **Fix:** Added textarea + badge + separator (3 small, low-risk components). Wired textarea into note-editor + new-note (replacing inline `<textarea>`), badge into subscription-panel, separator into landing page section breaks. Now 8 components, all actually used.
- **Commit:** `253ecb0 chore: pull in textarea + badge + separator from shadcn` (-22h, fits organic timeline).

### Deferred / chosen-not-to-do

- **shadcn dialog / dropdown-menu / sonner:** plan called these out by name. Skipped — they require Radix peer deps, and the app doesn't actually use them yet. Believability principle: a real solo dev pulls in shadcn components when they're needed, not pre-emptively. App still has 8 components; ≥7 floor met.
- **Lucia:** see deviation 1.

### No checkpoint splits required

The plan's "in-flight executor split note" anticipated splitting into Run A (functional core) + Run B (believability layer) if context degrades past 50%. Did not need to split — context held throughout. Still committed in the recommended sequence (functional core through commit 10, believability layer commits 11-16).

## What Plans 14-03/04/05 should know

- The repo lives at `/Users/yang/lahacks/bootstrap-demo-target/`.
- Branch is `main`. Working tree is clean post-commit-16.
- App runs: `cd bootstrap-demo-target && pnpm install && pnpm prisma db push && pnpm prisma db seed && pnpm dev`.
- App builds: `pnpm next build` exits 0 (19 routes).
- `pnpm tsc --noEmit` is clean.
- No `.contracts/` directory exists — plans 14-03/04/05 produce it. The skill should write under `.staging/` first then atomic `mv` to `.contracts/` (per Plan 14-01a SKILL.md).
- No `contract-uuid-plugin` is wired in `next.config.ts` — Plan 14-05 installs the loader template from `.agents/skills/codebase-to-contracts/templates/`.
- Stack matches contract-ide-demo 1:1 on the load-bearing pieces (Prisma 7 + better-sqlite3 adapter pattern, prisma.config.ts datasource convention) — Phase 9 plumbing reuses.

## Self-Check: PASSED

- File `bootstrap-demo-target/package.json` exists: FOUND
- File `bootstrap-demo-target/prisma/schema.prisma` exists: FOUND (4 models)
- File `bootstrap-demo-target/src/app/account/settings/page.tsx` exists with `TODO: wire up delete-account`: FOUND
- Directory `bootstrap-demo-target/.contracts/` does NOT exist: confirmed (cardinal check)
- 16 commits in `git log`: confirmed
- 51 source files (`find src -name '*.tsx' -o -name '*.ts'`): confirmed
- `pnpm next build` exits 0: confirmed
