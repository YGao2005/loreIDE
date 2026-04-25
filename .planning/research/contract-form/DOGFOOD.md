# Dogfood test — v2 contract form, single-node run

## Why

`RESEARCH.md` recommends a v2 contract form (sectioned markdown with per-kind slot registry + Gherkin Examples). The recommendation is research-backed but has never been run against a real LLM. Before committing to v2 at scale (migrating fixtures, rewriting the derivation prompt, seeding 25 vercel/commerce contracts), one live dogfood test against one real node is the cheap way to find out whether the proposed form survives contact with reality.

## Design rationale

Three-session pattern to avoid author-as-judge bias:

1. **Design session (concluded):** drafted the recommendation + prompt + stub fixture. All artifacts below.
2. **Derivation session (user-driven):** a fresh Claude Code session runs the v2 prompt against the stub. MCP-driven; uses the real `write_derived_contract` path. Emits a body into the stub sidecar.
3. **Evaluation session (user-driven):** a second fresh Claude Code session critiques the emitted contract cold — no access to the design conversation, only `RESEARCH.md` + source + emitted contract.

## Artifacts

| File | Purpose | Who reads it |
|---|---|---|
| `contract-ide/.contracts/11111111-...md` | Stub sidecar for the target node (`write_derived_contract.ts:31-98`, kind=API, level=L3). Empty body, `human_pinned: false`, no hashes — so `list_nodes_needing_derivation` returns it. | Derivation session (via MCP) |
| `DOGFOOD_PROMPT.md` | The literal v2 prompt to paste into the derivation session. | Human, then derivation session |
| `DOGFOOD_EVAL.md` | The literal cold-eval prompt to paste into a fresh Claude Code session after derivation completes. | Human, then eval session |

## How to run the test

1. **Verify the MCP sidecar's repo path.** Open `contract-ide/.mcp.json` and confirm `env.CONTRACT_IDE_REPO_PATH` points at `/Users/yang/lahacks/contract-ide` (not `/tmp/phase5-uat` or any other UAT scratch dir). The sidecar resolves `.contracts/<uuid>.md` against this path — if it's wrong, `write_derived_contract` will fail with "sidecar not found" even though the stub is committed to the repo. If you just edited `.mcp.json`, restart the Claude Code terminal so the MCP server picks up the new env.
2. **Open a Claude Code terminal cd'd to `/Users/yang/lahacks/contract-ide/`.** Paste the prompt block from `DOGFOOD_PROMPT.md`. Watch the session call `write_derived_contract` once.
3. **Inspect the result:** `cat contract-ide/.contracts/11111111-1111-1111-1111-111111111111.md`. Body should be present.
4. **Open a new Claude Code terminal cd'd to `/Users/yang/lahacks/`** — DO NOT reuse the derivation session. Paste the prompt block from `DOGFOOD_EVAL.md`. The eval session reads RESEARCH.md + source + emitted contract and returns a structured verdict.
5. **Decision:** apply the eval's launch recommendation (READY / REFINE / RETHINK).

## Target node — why this one

`write_derived_contract.ts:31-98` was chosen because:
- Non-trivial: ~70 lines, multiple concerns (guards, hashing, atomic write).
- Has real pre/post/invariant structure worth articulating.
- Has a known failure mode (pinned guard) that the Examples slot should catch.
- Kind=API is an imperfect fit (MCP tool ≠ HTTP endpoint) — honest stress test of the registry's edge cases.
- If the v2 form works on an MCP tool, it will likely work on UI components (easier case).

## Cleanup after the test

If the verdict is READY or REFINE:
- Delete the stub once v2 is committed, or convert it into a real self-contracted node with `human_pinned: true` after review.

If the verdict is RETHINK:
- Leave the stub in place; the emitted contract is a teaching artifact for the next design iteration.
