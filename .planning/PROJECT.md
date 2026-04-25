# Contract IDE

## What This Is

An agent-native macOS IDE where every file, surface, component, and atom carries a versioned natural-language contract. The contract graph — not the file tree — is the primary navigation and editing surface. Humans and agents both operate against contracts; code is the compiled artifact.

## Core Value

A developer or PM can locate any piece of the product by intent ("the checkout confirm button"), edit its contract, and have the agent produce the corresponding code change — without ever touching the file tree.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Five-level zoomable contract graph (Product → Flows → Surfaces → Components → Atoms) rendered with react-flow
- [ ] Contracts stored as `.contracts/` sidecar `.md` files with YAML frontmatter (stable UUIDs, not file paths)
- [ ] SQLite cache derived from sidecar contracts, rebuilt on startup and updated incrementally
- [ ] Canonical + reference model for shared nodes (one home + ghost references across flows)
- [ ] Inspector panel showing contract + code + live preview + receipt history for the selected node
- [ ] Chat panel grounded in currently-zoomed context (not whole-repo grep)
- [ ] Cherrypick flow: locate by intent → inspect → edit contract → agent compiles → atomic approve of both diffs
- [ ] Mass semantic edit: one intent changes N matching nodes, all diffs approve-all
- [ ] Drift detection with red-pulsing nodes and reconcile flow when code diverges from contract
- [ ] Receipt cards (tokens, time, tool calls, nodes touched, prompt size) produced per agent run
- [ ] Receipt side-by-side pinning for benchmarking (Contract IDE run vs. terminal-agent baseline)
- [ ] Lens switcher — Journey lens fully working; System and Ownership lenses at least mocked
- [ ] MCP server exposing `find_by_intent`, `get_contract`, `list_drifted_nodes`, `update_contract` to Claude Code
- [ ] PostToolUse hook that re-derives contracts for edited files and flags drift
- [ ] Agent loop shells out to `claude` CLI and parses session JSONL to produce receipts
- [ ] Live localhost preview pane for web demo repos
- [ ] Demo repo `vercel/commerce` seeded with hand-curated L0–L2 contracts
- [ ] 3-minute demo video: cherrypick beat + mass-edit beat + non-coder copy-edit beat, each ending on a receipt comparison

### Out of Scope

- Native SwiftUI app — chose Tauri for react-flow / Monaco / shadcn ecosystem and single-language stack across frontend and MCP
- Rebuilding Claude Code's agent harness — we shell out to `claude` CLI; our IDE is the visual layer, not a replacement
- Traditional file tree in the primary UI — intentional omission; the contract graph is the navigation. Power users can fall back to OS-level tools
- Cloud sync, multi-user collaboration, or hosted backend — single-user local-first MVP
- Non-macOS platforms for v1 — Tauri makes cross-platform cheap later; not doing it now
- Code generation from scratch / new-project scaffolding — Contract IDE operates on existing repos
- Authoritative contracts (code generated from contracts) — v1 ships derived + version-controlled contracts; authoritative is the long-term vision
- Skills-based Claude Code integration — MCP + one hook only for MVP

## Context

- Built for hackathon demo; timeline ~1 week, parallelized across Claude Code sessions (graph canvas, Rust backend + SQLite, MCP server + hook, inspector/chat/receipts, demo repo seeding).
- Users (us) have moved from IDEs to terminal-agent workflows (Claude Code) and lost the spatial map of codebases. Agents grep; humans guess. This product's thesis is that both pathologies share one fix: a persistent intent layer above code.
- The "bug = gap between intent and execution" framing is old (design-by-contract, Meyer 1986); the "why now" is that LLMs can cheaply derive, maintain, and query intent at scale.
- Demo target is `vercel/commerce` because it has recognizable real flows (checkout, product, search) at a size that fits a 3-minute video — not so small it feels toy, not so gnarly the contract seeding eats the week.
- We will dogfood Contract IDE on its own repo mid-build once the graph + inspector are up — a forcing function for usability.

## Constraints

- **Timeline**: ~1 week to demo-ready — every scope decision is measured against the 3-minute video, not a polished product.
- **Tech stack**: Tauri 2, React + TypeScript, Tailwind, shadcn/ui, react-flow, Monaco, Rust for backend, SQLite for cache, TypeScript MCP server. Locked — no re-litigation.
- **Platform**: macOS-only for v1. The app must feel native (traffic lights, translucent sidebars, SF Pro, smooth transitions).
- **Agent provider**: Claude Code (`claude` CLI). No multi-provider abstraction. Receipts are parsed from Claude Code's session JSONL.
- **Dependency**: User must have Claude Code installed and authenticated. We assume this; we don't reinstall/configure it.
- **Demo determinism**: Demo video beats must be reproducible. Contract seeds for `vercel/commerce` are hand-curated and committed; the demo is not live-improvised.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Tauri + React over SwiftUI | Graph viz, code editor, streaming chat UX all mature in web; MCP server shares TS with frontend; native-feel achievable with proper macOS chrome | — Pending |
| Contracts as `.md` sidecar + derived SQLite cache | Greppable, diffable, git-native; cache rebuilds cheaply; avoids dual-source-of-truth problem | — Pending |
| Shell out to `claude` CLI for agent loop | We're the visual layer over Claude Code, not a replacement; reuses existing tool config; parses session JSONL for receipts | — Pending |
| react-flow for graph canvas | Best-in-class zoom/pan/custom-nodes; SwiftUI has no equivalent worth building in a week | — Pending |
| Canonical + reference model for shared nodes | Matches mental model of component libraries; cleaner graph than duplicate-and-link; small UX cost (ghost nodes) | — Pending |
| MCP + 1 PostToolUse hook (no skills) | MCP gives agents `find_by_intent` as a first-class tool; hook keeps contracts fresh; skills deferred | — Pending |
| Journey lens default, System/Ownership mocked | Journey is most universal mental model; full three-lens implementation is stretch | — Pending |
| Demo repo is `vercel/commerce` | Recognizable, right-sized, rich UI flows for the three video beats | — Pending |
| Archive the initial Swift boilerplate | Language mismatch with the Tauri stack; no git history to preserve | ✓ Good |

---
*Last updated: 2026-04-24 after initialization*
