# references/classification-rules.md — Stage 1 heuristic taxonomy

Stage 1 of the bootstrap walks the repo and assigns each candidate file (or sub-region) a `kind` and `level`. The taxonomy below is heuristic-first: ~85% of files in a typical Next.js + Prisma + TS repo classify deterministically by path glob + file shape. Only ambiguous files fall through to a single `claude -p --json-schema schemas/classify.json` LLM call.

Heuristic-first matters because re-running the skill on the same codebase MUST produce the same `nodes.json` modulo UUIDs (uuids are deterministic v5 derived from the file path + element location). Determinism is what lets Plan 14-04's CI smoke run the skill twice and assert byte-identical output on the second run.

## Heuristic kind/level table

| Path glob (relative to `$repo_path`) | kind | level | parent_hint |
|---|---|---|---|
| `app/**/page.tsx` | `UI` | `L3` | flow uuid (one per route, derived in Stage 5a) |
| `app/**/layout.tsx` | `UI` | `L3` | parent route's L3 |
| `pages/**/*.tsx` (Next.js Pages Router) | `UI` | `L3` | flow uuid |
| `app/**/loading.tsx` | `UI` | `L4` | parent route's L3 |
| `app/**/error.tsx` | `UI` | `L4` | parent route's L3 |
| `app/api/**/route.ts` | `API` | `L3` | flow uuid |
| `pages/api/**/*.ts` | `API` | `L3` | flow uuid |
| `prisma/schema.prisma` (per `model` block) | `data` | `L2` | repo L0 |
| `lib/**/*.ts` exporting fns importing `stripe` / `@mailchimp/*` / OAuth providers / `next-auth` provider configs | `external` | `L3` | flow uuid |
| `lib/**/*.ts` exporting fns importing `@prisma/client` (db.* calls) | `data` (write op) or `lib` (read op) | `L3` | flow uuid |
| `lib/**/*.ts` exporting only pure helpers, file size < 100 lines | `lib` | `L2` | area L1 |
| `lib/**/*.ts` exporting orchestrators, file size >= 100 lines | `lib` | `L3` | flow uuid |
| `lib/jobs/**/*.ts`, `app/api/cron/**/route.ts`, `cron.{ts,js}` | `cron` or `job` | `L3` | flow uuid |
| `lib/events/**/*.ts`, files exporting `EventEmitter` instances | `event` | `L3` | flow uuid |
| Identifiable JSX inside `page.tsx` / `layout.tsx` (sectioned by H2/H3 prose comments OR named const exports OR top-level component declarations) | `UI` | `L4` | parent L3 (the file's L3) |
| Repository root (synthetic) | `UI` | `L0` | none |
| Top-level dir under `app/`, `lib/`, `prisma/` (synthetic) | `UI` (mixed area) | `L1` | repo L0 |

### Notes on the table

- **L0 / L1 are synthetic.** The skill emits one L0 (the repo) and one L1 per top-level directory. These have empty `code_ranges` and serve as roll-up anchors for Phase 8 propagation.
- **`cron` vs `job`.** A `cron` exposes a Next.js route (or vercel.json cron config) and runs on a schedule. A `job` is invoked imperatively (e.g. by an API endpoint) and may run synchronously or via a queue. The path heuristics above are best-effort — when ambiguous, fall through to the LLM.
- **`data` vs `lib` for Prisma callers.** A `lib/**/*.ts` file that imports `@prisma/client` and contains **write** operations (`create`, `update`, `delete`, `upsert`, `createMany`, etc.) is `kind: data`. A file that contains **only read** operations (`findUnique`, `findMany`, `count`, etc.) is `kind: lib` — it's a query helper, not a write surface. Mixed files (read + write) → `data` (the write surface dominates).
- **L4 atom identification.** In Stage 1, L4 atoms are *candidates* — Stage 4 (jsx-alignment) tightens `code_ranges` to wrap exactly the JSX element. If Stage 4 cannot resolve a unique element, the candidate is dropped (marked unbootstrappable in diagnostics).

## When the LLM fallback fires

A file goes to LLM fallback when:

1. The file matches multiple rows of the table with conflicting `kind` (e.g. `lib/foo.ts` imports both `stripe` and `@prisma/client` — could be `external` or `data`).
2. The file matches no row but is reachable from a node we already classified (e.g. a deeply imported helper).
3. The size threshold (`< 100 lines` vs `>= 100 lines` for `lib`) lands within ±10% of the boundary.

Fallback protocol:

```bash
claude -p --output-format json --json-schema schemas/classify.json
```

The prompt includes:

- The file content (or relevant excerpt).
- The set of rows the heuristic *might* have matched (so the model is choosing among real candidates, not free-styling).
- The classification examples in [output-schema.md](output-schema.md).

The schema returns a single `{ kind, level, confidence, reasoning }`. The skill takes the top-1 answer if `confidence >= 0.6`; otherwise marks the file `unclassified: true` in diagnostics and skips it (do not emit a sidecar for it). Unclassified files are listed in the final summary so the user can re-run with manual hints.

## Why heuristic-first

If we routed every file through the LLM, a small repo with 200 files would burn ~200 `claude -p` calls on Stage 1 alone. The heuristic table covers ~85% of files in a typical Next.js + Prisma + TS repo, dropping LLM cost to ~30 calls. Just as importantly: heuristic classification is **deterministic across reruns**, while LLM classification has variance even at temperature 0. The Phase 14 skill's reproducibility guarantee depends on keeping the LLM surface small.
