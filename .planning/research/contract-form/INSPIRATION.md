# Semantic IDE for Agent-Native Coding

*User-supplied design concept, 2026-04-24. Read as inspiration and framing, not specification — some ideas (e.g. tiered verification states, intent-capture hooks) extend beyond the current ROADMAP v1 scope.*

A design concept for an IDE that complements Claude Code by building a durable semantic layer over the codebase.

## Core Thesis

Traditional IDEs (VS Code, Cursor, Windsurf) are file-and-text-centric — built on 1970s editor assumptions. In an agent-first workflow where the human rarely reads code, the IDE's job changes: it's no longer where you write, it's where meaning gets captured, navigated, and verified.

**The IDE is demoted from primary surface to semantic index and review environment.** Claude Code remains the primary interface. The IDE makes agent sessions durable and makes future sessions smarter.

## Key Inversion

Earlier framings tried to replace code with a semantic layer for non-coders. The better framing: the semantic layer is **primarily for the agent**, with the human as occasional reviewer.

- Agent navigates by meaning, not grep
- Human reviews meaning, not diffs
- Code is still the ground truth, just not the primary surface

## The Contract Capture Loop

Intent already exists in every Claude Code session — it just evaporates. The core mechanism is to harvest it.

- Hooks capture session dialogue where intent is expressed
- Agent proposes contract-worthy statements; user confirms or edits
- Contracts attach to code regions / behavior nodes
- The index builds as a **byproduct of shipping**, not as extra discipline

This flips the Eiffel Design-by-Contract economics: specs used to be expensive, now they're nearly free because the user already stated them to the agent.

## Gradual Verification

Contracts exist in tiered states, always visible:

- **Verified** — checked against current code
- **Example-checked** — validated via concrete scenarios
- **Assumed** — captured but not checked

Soundness caveat: "verified" here means "consistent with the LLM's formalization of intent," not Eiffel-grade proof. Honest uncertainty display matters more than false confidence.

## Primary Surfaces

Instead of file tree + tabs + buffer:

- **Behavior map** — zoomable graph of system capabilities
- **Contract panel** — live view of invariants for current focus area
- **Intent timeline** — history of decisions, not commits
- **Semantic search** — "where can a project become invisible?" not grep
- **Intent diff** — PR review surface showing meaning changes, not line changes

Code views still exist. They're just not the default.

## Agent Benefits

The index gives Claude Code something closer to senior-engineer context:

- Multi-hop reasoning over behavior graph
- Knows invariants before making changes
- Refactors bounded by explicit contracts
- Bug investigation starts with relevant paths, not cold grep
- Every session enriches the index → compounds over time

## Calibrated Interruption

The IDE speaks up when it matters, stays quiet otherwise:

- Proactive: contract violations on merge, stale contracts touched by current work
- Passive: trivial changes pass through without ceremony
- Not every change is semantic — system knows when to get out of the way

## What's Engineering vs. Research vs. Paradigm Limits

### Engineering-tractable

- Hook layer for session capture
- Impact analysis on changes
- Constrained DSLs for common contract patterns (auth, state, dataflow)
- Semantic zoom on behavior map
- Grounded "why" explanations citing intent log
- Event-sourced intent history

### Research-hard

- Sound NL→contract translation
- Calibrated uncertainty in LLM verification
- Semantic three-way merge (identity of behaviors across refactors)
- Visualization of large behavior graphs at scale

### Paradigm limits (won't fully solve)

- Underspecification problem — user doesn't know what they didn't say
- Gap between designer-articulable and production-necessary properties (security, concurrency, timing)
- Human trust calibration — confident wrong output is worse than no output

## Critical Failure Modes

- **Stale contracts** — worse than no contracts; need decay/re-validation
- **Garbage-in intent** — system only as clear as user's communication with agent
- **Contract rot across refactors** — identity of behaviors must follow concept, not file path
- **Hallucinated explanations** — "why" answers can be plausible and wrong
- **Trust erosion** — one false "verified" badge damages the model

## Integration Model

Not a VS Code competitor. Sits alongside Claude Code:

- Terminal pane runs Claude Code (primary work surface)
- IDE panes show semantic index reacting live to session
- Hooks wire session events → contract proposals
- User confirms contracts in seconds, not minutes
- Review, debugging, refactoring happen in IDE; writing happens in session

## The Day-in-the-Life Signal

The system earns its keep when:

- A scary refactor becomes bounded by known invariants
- A bug investigation goes from hour-long grep to two-minute semantic trace
- PR review shifts from line comments to contract comments
- Questions don't get forgotten — they get pinned to the relevant behavior

## Honest Limits

- First weeks on a fresh codebase feel similar to today (empty index)
- Requires user to communicate clearly with agent (already the Claude Code skill)
- Not a replacement for engineers on infra, security, concurrency layers
- Works best for product-behavior layer; weaker at system-level properties

## One-Line Summary

**Harvest intent from agent sessions into a live semantic index that makes the agent smarter, the human a better reviewer, and the codebase's meaning durable across sessions.**
