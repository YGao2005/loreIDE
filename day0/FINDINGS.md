# Day 0 Validation Findings

**Date:** 2026-04-24
**Goal:** De-risk the four highest-uncertainty integration seams before Wave 1 starts.

---

## Environment verified

| Tool | Version | Location |
|---|---|---|
| `claude` | 2.1.111 | `/opt/homebrew/bin/claude` |
| `node` | v24.6.0 | nvm |
| `npm` | 11.5.1 | — |
| `pnpm` | 9.12.3 | `~/.npm-global/bin/pnpm` |
| `cargo` | 1.89.0 | `~/.cargo/bin/cargo` |

---

## Check 1 — `claude -p` non-interactive CLI

**Status:** ✅ Pass (basic invocation)
**Caveat:** The *real* check — whether `tauri-plugin-shell` inherits the logged-in user's Claude Code auth into the spawned subprocess — requires a Tauri scaffold. That validation moves to **Wave 1 Day 1** as a Phase 1 entry criterion (specific test: `Command::new("claude").args(["-p", "say hello"]).output()` from Rust returns the expected stdout without prompting for login).

**What we know today:** `claude -p "..."` returns clean stdout when invoked from any shell the user has used to authenticate Claude Code. Authentication appears to be stored in `~/.claude/`, which a subprocess will inherit by default via `HOME` — if Tauri's plugin-shell spawn preserves `HOME` (it does by default in 2.x), this will work.

---

## Check 2 — PostToolUse hook payload

**Status:** ✅ Pass (exceeded expectations)

**Payload fields (confirmed present):**

```json
{
  "session_id":        "c39b839d-...",
  "transcript_path":   "/Users/.../PROJECT_PATH/<session_id>.jsonl",
  "cwd":               "<workspace where claude was run>",
  "permission_mode":   "default",
  "hook_event_name":   "PostToolUse",
  "tool_name":         "Write" | "Edit" | ...,
  "tool_input":        { "file_path": "...", "content": "..." },
  "tool_response":     { "type": "create", "filePath": "...", "structuredPatch": [], ... },
  "tool_use_id":       "toolu_..."
}
```

**Key implications for Phase 8:**
1. `tool_input.file_path` maps agent edits → affected contract nodes. The hook can query `find_nodes_by_file_path(path)` against SQLite and re-derive exactly those nodes (not the whole repo).
2. `tool_response.structuredPatch` gives us the precise diff — we don't need to re-read/re-hash the whole file for drift detection if the patch is small.
3. The JSONL at `transcript_path` contains `message.usage` per assistant turn with: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`. **Bonus:** we can show cache savings in the receipt delta, not just raw token counts.

**Confidence:** HIGH. Schema richer than anticipated.

---

## Check 3 — `better-sqlite3` inside `pkg`-compiled sidecar binary

**Status:** ✅ Pass with caveat

**Result:** `bin/day0-sqlite` (12 MB Mach-O arm64) runs and returns `DAY0_CHECK3_OK`. The native `.node` addon resolves and SQLite queries execute.

**Caveat:** `pkg@5.8.1` only supports up to Node 18. Targets `node20-macos-arm64` fail with `No available node version satisfies 'node20'`. The MCP sidecar will ship as a Node 18 runtime embed, which is fine (MCP SDK works on Node 18), but the STACK.md should be updated.

**Alternatives if Node 18 proves a problem:**
- `@yao-pkg/pkg` — community fork with Node 20+ support (recommended upgrade path)
- Native Node Single Executable Applications (SEA, Node 20+ built-in)
- `bun build --compile` if we swap Node for Bun in the sidecar (Bun has native `better-sqlite3` support)

**Action:** No change to stack. Note the pkg@5 → Node 18 limit in STACK.md; migrate to `@yao-pkg/pkg` post-demo if we want modern Node in the sidecar.

---

## Check 4 — `vercel/commerce` dev server with empty Shopify credentials

**Status:** ❌ Fail — demo blocker identified

**Result:** `pnpm dev` starts and binds to port 3000, but `GET /` returns HTTP 500. Server log shows repeated Shopify Storefront GraphQL errors (401/missing-token). The live preview iframe for demo Beat 3 (non-coder edits empty-state copy) would render a Next.js error page instead of the storefront.

**Required env vars (from `.env.example`):**
- `SHOPIFY_STORE_DOMAIN` (e.g., `dev-store.myshopify.com`)
- `SHOPIFY_STOREFRONT_ACCESS_TOKEN` (Storefront API token)
- `SHOPIFY_REVALIDATION_SECRET` (arbitrary string, any value works)
- `COMPANY_NAME`, `SITE_NAME` (cosmetic only)

**Three resolution paths, ranked:**

| Option | Effort | Fragility | Recommendation |
|---|---|---|---|
| **A. Stub the Shopify client** with fixture data (hardcoded products JSON in `lib/shopify/`). | ~2 hours | **None** — no external API, fully deterministic. | **Recommended** — matches the hackathon mindset; demo day survives even if Shopify is down or creds rotate. |
| B. Register a Shopify Partners dev store + Storefront API token. | ~30 min manual | Low — requires ongoing working connection during demo. | Acceptable fallback if stubbing proves too much code to touch. |
| C. Swap to a different commerce template with public demo creds (Medusa, BigCommerce fork). | ~1 hour | Medium — different UI, less recognizable as "the Vercel commerce template." | Only if A and B both fail. |

**Why Option A is the right call:**
- `lib/shopify/index.ts` has a clean provider shape — replacing the GraphQL calls with fixture returns is mechanical
- The Contract IDE demo doesn't need a *real* commerce backend; it needs a *rendered UI surface* for the preview iframe
- Fixtures make Beat 3 ("non-coder edits empty-state copy") reproducible in CI-like conditions — you can re-record the demo at any time

**Action:** Add a "Stub Shopify client with fixtures" task to Wave 2 (runs parallel with contract seeding). Produces a `lib/shopify/fixtures/` directory + wrapped client that short-circuits API calls. Budget: 2 hours of the 4-hour demo-seed timebox.

---

## Summary

| Check | Status | Blocker? |
|---|---|---|
| 1. Claude CLI | ✅ (basic) | No — defer Tauri-subprocess check to Wave 1 |
| 2. Hook payload | ✅ | No — schema richer than planned |
| 3. better-sqlite3 in pkg | ✅ | No — pin Node 18 target |
| 4. vercel/commerce dev server | ⚠ | Yes — requires stub-Shopify work in Wave 2 |

**Overall:** plan survives. Single new workstream (Shopify stub) added to Wave 2. No phase boundaries change.
