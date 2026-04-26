# Contract IDE

A macOS IDE where every product flow, screen, endpoint, and atom carries a versioned natural-language contract. The canvas renders each flow as a vertical chain of participants — your UI for screens, your schemas for endpoints — and surfaces every implicit decision an agent makes as a fact on the atom it lives on. Built on top of this, a harvest-first substrate captures the *reasons* behind every team decision from Claude Code sessions, queryable by future agents. **GitHub stores your code. We store your reasons.**

Navigation is `⌘P` semantic search. The canvas is the **agent-decision verification surface** (see `.planning/CANVAS-PURPOSE.md`) — not a file tree, not a graph to traverse.

## Current target

The 4-beat live two-laptop demo defined in `.planning/demo/presentation-script.md`. Every phase in `.planning/ROADMAP.md` exists to enable that demo. **Don't introduce work that doesn't trace back to the demo.**

## Source of truth

| Question | Canonical doc |
|---|---|
| How does the demo run on stage? | `.planning/demo/presentation-script.md` |
| What's the scenario / substrate fixture? | `.planning/demo/scenario-criteria.md` § Committed Scenario |
| What's the build plan? | `.planning/ROADMAP.md` (13 phases, one milestone) |
| What does the canvas look like / do? | `.planning/CANVAS-PURPOSE.md` |
| Pitch / positioning | `.planning/PITCH.md` |
| Long-term thesis | `.planning/VISION.md` |

If two docs conflict: the script wins for performance details; the scenario wins for content; the roadmap wins for build sequencing.

## Where we are

Phases 1–7 complete. Phases 8–13 outstanding. Milestone close = working, demo-ready product.

## Polish is welcome

The 13 phases are the spine, not the ceiling. **Looking complete and professional is part of the demo bar.** Smooth animations, native macOS feel, copy that doesn't read like a template, micro-interactions that make state changes feel intentional, empty/loading/error states that don't look like dev placeholders — all welcome above the bare phase requirements when they support the demo arc. Don't ship features that distract from the four beats; don't strip polish that makes the product feel real.

## Tech stack (locked)

Tauri 2 · React + TypeScript · Tailwind · shadcn/ui · react-flow · Monaco · Rust · SQLite · TypeScript MCP server. macOS only for v1.

## Planning workflow

`.planning/` is the canonical planning surface (GSD system). Phase plans live in `.planning/phases/<phase-id>/`. `/gsd:progress` shows where you are; `/gsd:plan-phase N` plans the next one. Don't create planning docs outside that structure.
