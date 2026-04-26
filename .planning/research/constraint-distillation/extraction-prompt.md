# Constraint Extraction Prompt

You are extracting reusable CONSTRAINTS from a software-development session transcript.

## What is a constraint

A rule that should guide future work on this codebase. Constraints are **reusable** — they would save time or prevent bugs if automatically surfaced to the agent on a future relevant task.

**Examples of constraints:**
- "Always use tailwind for styling"
- "Rust Tauri commands that accept file paths from JS must canonicalize and assert under repo root"
- "Monaco `setHiddenAreas` must run in `useEffect` keyed on `[monaco, content]`, not `onMount`"
- "Use button tab strips, not shadcn-Tabs"

**NOT constraints (skip these):**
- Task descriptions ("fix the neighbors bug")
- One-off decisions with no future applicability
- Status updates, summaries of work done
- Specific file changes that wouldn't generalize

## Output schema

For each constraint, emit one JSON object matching `schema.json`. Key fields:

- `text`: imperative statement of the rule — one sentence
- `scope`: `global` | `module:<path-pattern>` | `task-pattern:<short>`
- `applies_when`: **the semantic trigger for retrieval**. Be specific enough to avoid false positives, broad enough to catch paraphrases. Example: "when writing a Rust Tauri command that accepts a path argument from JS"
- `source.quote`: verbatim quote from the transcript justifying the constraint
- `source.actor`: `user` if stated explicitly by user, `claude` if surfaced or inferred by Claude, `derived` if from observed behavior
- `confidence`: `explicit` (stated as rule) or `inferred` (surfaced from context)

## Quality bar

Each constraint should answer "would I want this injected automatically into a future session where the goal matches `applies_when`?" If the answer is no, drop it.

Prefer fewer high-quality constraints over many low-quality ones.
