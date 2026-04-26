# Contract IDE

## What This Is

A macOS IDE built on two stacked primitives:

1. **Contract substrate** — every product surface, component, and atom carries a versioned natural-language contract. The contract graph (Product → Flows → Surfaces → Components → Atoms) is the primary navigation, not the file tree. Humans and agents both operate against contracts; code is the compiled artifact.

2. **Harvest-first intent substrate** — every Claude Code session is automatically distilled into a typed graph (decisions, constraints, open questions, attempts) with bitemporal validity. The substrate is queryable by future agents (so they stop forgetting your team's hard-won discipline) and visually navigable by every human on the team. See `VISION.md` for the full thesis.

## Current Milestone Target

The 4-beat live two-laptop demo per `.planning/demo/presentation-script.md`. **One milestone, 13 phases, ending in a working demo.** Source-of-truth pointers live in repo-root `CLAUDE.md`; the build plan lives in `ROADMAP.md`.

## Status

Phases 1–7 complete. Phases 8–13 outstanding. Milestone close = working, demo-ready product, with explicit room for polish above the bare phase requirements.

## Constraints

- **Timeline**: hackathon-paced; every scope decision measured against the 4-beat demo, not against a polished GA product
- **Tech stack (locked)**: Tauri 2, React + TS, Tailwind, shadcn/ui, react-flow, Monaco, Rust, SQLite, TypeScript MCP server. No re-litigation
- **Platform**: macOS-only for v1. Native feel non-negotiable (traffic lights, translucent sidebars, SF Pro, smooth transitions)
- **Agent provider**: Claude Code (`claude` CLI). No multi-provider abstraction
- **Demo determinism**: scenario content + reset fixtures are hand-curated and committed; demo is not live-improvised

## Out of Scope (this milestone)

- Native SwiftUI app (Tauri chosen for ecosystem fit + single-language stack)
- Rebuilding Claude Code's agent harness (we're the visual layer, not a replacement)
- Cloud sync, multi-user collaboration, hosted backend (single-user local-first)
- Non-macOS platforms (Tauri makes cross-platform cheap later)
- Code generation from scratch / new-project scaffolding (operates on existing repos)
- Authoritative contracts (code generated from contracts) — long-term vision; this milestone ships derived contracts
- Real multi-machine substrate sync (Phase 13 mocks the demo affordance; real sync is v3)

## Polish posture

Looking complete and professional is part of this milestone's bar. Polish above per-phase success criteria — animations, micro-interactions, copy quality, state-change smoothness, empty/loading/error states that don't look like dev placeholders — is welcome wherever it supports the demo arc. The 13 phases are the spine; polish that makes the product feel real is encouraged, not deferred.

---

*Source-of-truth pointers and current build status: repo-root `CLAUDE.md`. Long-term thesis: `VISION.md`. Build plan: `ROADMAP.md`. Demo: `.planning/demo/presentation-script.md`.*
