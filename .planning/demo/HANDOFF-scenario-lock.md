# Handoff — Lock Down the Exact Demo Scenario

**Mode:** no code, no phase plans, no roadmap edits. Structure + commitment only.
**Prior session context:** not loaded — everything below + the referenced docs is self-contained.

---

You're picking up a Contract IDE planning session. The prior session produced a complete v2 pivot (harvest-first intent substrate), a demo runbook, and a scenario-selection rubric — but deliberately did NOT commit to the exact demo scenario. That's your job.

**The goal of this session:** pick one locked, specific demo scenario that passes all five criteria in `.planning/demo/scenario-criteria.md`, and enumerate the 3–5 unintuitive decisions/constraints the substrate must contain to make it work. Everything downstream (fake repo structure, session scripts, reset fixtures, script placeholders) gets resolved against that commitment.

Do not write code. Do not draft Phase 10/11 plans. Do not edit ROADMAP.md or REQUIREMENTS.md. Your deliverable is text commitment in one file — nothing more.

## Read these in this order before writing anything

1. `.planning/demo/scenario-criteria.md` — the five-criteria rubric + eight candidate categories + illustrative example. This is the working document you'll update.
2. `.planning/VISION.md` — the harvest-first substrate thesis. The scenario must demo this thesis, not just "agent writes code."
3. `.planning/PITCH.md` — especially §§ "The demo" and "How it looks." The scenario fits inside this pitch; don't invent a narrative that conflicts.
4. `.planning/demo/runbook-v2.md` — the 3-minute video script. The scenario replaces the placeholder green-button content in Scene 3 (constraint-injection beat).
5. `.planning/demo/live-scenario.md` — the single-prompt live beat. The scenario must also work in a 20–30 second one-prompt form.

Do NOT read the full planning dir. Those five files are enough.

## The five criteria (from scenario-criteria.md, inlined for reference)

A viable scenario must pass all five:

1. **Verifiable correctness.** A specific right answer (hex code, library name, utility function, config value) — a judge can check which side got it right without appealing to taste.
2. **Discoverable only in the substrate.** The right answer lives in a prior decision/constraint the distiller captured — not in code patterns a fresh agent could grep out.
3. **Non-obvious from code alone.** A blank-slate Claude doing thorough exploration would still guess wrong — the right answer contradicts sensible defaults.
4. **Specific, not generic.** A specific utility (`fetchWithAuth()` vs bare `fetch`), a specific library (`@radix-ui/react-dialog` vs `react-modal`), a specific value (`300ms` vs `500ms`). Not "good UX" or "nice copy."
5. **Visible on screen.** Shows up in the code diff, preview iframe, or a rendered page — not hidden in behavior you have to probe.

## Why brand-voice / error-messages was rejected

The prior session landed on "update form error messages to match brand voice" and walked it back. The problem: copy quality is taste, not correctness. A judge can't objectively say *"yes, that's the right copy"* without trusting our voice guide. Anything taste-based fails criterion 1. The rejected example is kept as a placeholder in the downstream docs — ignore it.

## The deliverable

Update `.planning/demo/scenario-criteria.md` with a new top section titled **"## Committed Scenario"** containing exactly:

1. **The prompt** — the single sentence the user types in chat / speaks into the demo (one line, verbatim, in a code block).
2. **The vanilla-Claude wrong answer** — what a blank-slate agent would produce. Specific file + line shape, not prose.
3. **The Contract IDE right answer** — what the substrate-informed agent produces. Specific file + line shape.
4. **The 3–5 substrate decisions/constraints** driving the difference. Each with: `id`, `text` (imperative statement), `applies_when` (retrieval trigger), `justification` (why the decision was made — the "why" that could only come from a prior conversation).
5. **The demo repo choice** — `vercel/commerce` OR a new custom `contract-ide-demo` repo. With a one-paragraph justification.
6. **The one-prompt live beat variant** — how the same scenario compresses to 20–30 seconds in `live-scenario.md`.

Nothing more, nothing less. No code. No roadmap. No phase plans.

## Out of scope for this session

- Writing the fake repo files
- Drafting the source-session scripts that produce the decisions
- Building the reset script
- Editing PROJECT.md, ROADMAP.md, REQUIREMENTS.md
- Phase 10/11/12 planning
- Re-litigating the v2 vision or Option B decision

If you find yourself drifting into these, stop. This session commits one scenario; the rest is follow-up.

## Opening questions to drive the dialogue

Ask these in this order. Don't try to resolve them all at once — one at a time.

1. **Use vercel/commerce or build a new `contract-ide-demo` repo?** The prior session leaned custom-repo (smaller surface, faster reset, full control over scenario). vercel/commerce has inertia (already in the v1 runbook + research docs). Which way?
2. **Which of the eight candidate categories in `scenario-criteria.md` is most compelling for the pitch?** Custom-utility preference is my instinct (strong code-diff moment, easy to verify, universal pain). But the decision depends on what the chosen repo actually supports.
3. **What's the specific decision history that makes the substrate "know" the right answer?** The demo only lands if the decisions have a clear "why." A good decision carries its own mini-story: *"decided 2026-01-15 after screen-reader audit flagged 14 unlabeled buttons."* Bad decisions sound made-up: *"use this utility because it's better."*
4. **Does the same scenario work for both the 3-minute recorded demo AND the 20–30 second live beat?** If the live beat needs a different scenario, we have two demos to produce — that's double the seed/rehearse cost. Strong preference for one scenario that scales.
5. **What does the before/after code diff literally look like, character-for-character?** Not *"the code is cleaner"* — the actual diff hunk. Only commit once you can show this.

## Done when

A judge watching the 3-minute video can say, *out loud*, which side got it right and why. If they'd have to trust the demo-runner's taste, the scenario isn't locked yet.

---

*Prior-session artifacts: `VISION.md`, `PITCH.md`, `ROADMAP-REVISIONS.md`, `runbook-v2.md`, `live-scenario.md`, `reset-procedure.md`, `scenario-criteria.md`, `research/constraint-distillation/`, `research/intent-supersession/`. Everything coherent; don't re-litigate, just commit the scenario.*
