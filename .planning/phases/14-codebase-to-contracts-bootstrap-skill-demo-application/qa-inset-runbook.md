# Q&A Inset Runbook — `/codebase-to-contracts` against bootstrap-demo-target

**Authored:** 2026-04-26 (Phase 14 Plan 06 Task 1)
**Inset runtime:** 75–105 seconds (firm cap; revised UP from previous 60–90s for the contract-scrolling tail)
**Demo posture:** Q&A-only inset — held queued in mpv / QuickTime on the demo machine; played ONLY when judges trigger it. The locked 4-beat presentation script (`.planning/demo/presentation-script.md`) is **NOT MODIFIED** by this inset — Phase 14's affordance is out-of-band, not a 5th beat.

---

## Purpose

This inset answers the Q&A questions we expect about Phase 14 / Day-0 bootstrap:

1. *"Does this work on any repo, or just the one in your demo?"*
2. *"What about other codebases — what about a real existing app?"*
3. *"Is this just for the demo repo, or can someone point it at their codebase?"*
4. *"What did the contracts actually look like before review? Show me the `.contracts/` directory."*

It is a **Q&A side-pocket answer**, not part of the 4-beat narrative. The 4 beats are the headline. This inset only plays when a judge asks.

If unprompted, do NOT play. Volunteering it dilutes the 4-beat arc.

---

## Trigger conditions

Play the inset if a judge asks any of:

- "Can this work on any repo?"
- "What about other codebases?"
- "Is this just for the demo?"
- "Does this work on a real app, or only the planted one?"
- "What did the contracts look like before you reviewed them?"
- "Show me the `.contracts/` directory."
- "What did the bootstrap output actually produce?"
- "Is the skill we ship the same one that built the demo repo?"

Heuristic: *if a judge questions the generality of the bootstrap claim or the prose-quality of the auto-derived contracts*, play this. If they're asking about retrieval, supersession, or substrate — different question, don't play.

---

## Recording setup

**Demo machine:** the same machine that runs the live 4-beat demo (T laptop). Ensure:

- contract-ide running (matches Beat 3 / Beat 4 setup)
- macOS QuickTime installed for screen capture
- Iterm2 with a fresh tab in `/Users/yang/lahacks/bootstrap-demo-target/`
- VS Code (or the IDE's inspector) ready to open `.md` files for the contract-scrolling tail
- mpv installed (`brew install mpv`) for the projector playback path — keeps the inset queued at 1x speed, no streaming delays

**Pre-recording reset (CRITICAL — reproducibility):**

```bash
# Wipe any prior contracts state
rm -rf /Users/yang/lahacks/bootstrap-demo-target/.contracts/
rm -rf /Users/yang/lahacks/bootstrap-demo-target/contract-uuid-plugin/

# Restore a clean next.config.ts (no BOOTSTRAP-INSERT block)
cd /Users/yang/lahacks/bootstrap-demo-target
git checkout next.config.ts

# Verify the reset
ls /Users/yang/lahacks/bootstrap-demo-target/.contracts/ 2>&1   # should: No such file
ls /Users/yang/lahacks/bootstrap-demo-target/contract-uuid-plugin/ 2>&1   # should: No such file
grep -c BOOTSTRAP-INSERT /Users/yang/lahacks/bootstrap-demo-target/next.config.ts   # should: 0
```

**Pre-recording session prep:**

- Open Claude Code in `/Users/yang/lahacks/bootstrap-demo-target/` (cd into the directory; `claude` to start a session — model pinned to `claude-sonnet-4-6` per skill default, override via `BOOTSTRAP_CLAUDE_MODEL` if needed)
- Verify the `/codebase-to-contracts` skill is loaded: type `/` and confirm `codebase-to-contracts` appears in the slash-command menu (skill is at `.agents/skills/codebase-to-contracts/`; Claude Code auto-discovers from project-local `.agents/` if running from a directory above it)
- Window size at recording resolution: 1920×1200 minimum (so the projector at 1080p has a 1:1 byte mapping)

---

## Runtime budget (75–105 seconds, firm)

| Block                                        | Target time    | Cumulative |
| -------------------------------------------- | -------------- | ---------- |
| Setup framing                                | 0:00 – 0:08    | 0:08       |
| Stage 1 + Stage 2 visible (LLM streaming)    | 0:08 – 0:30    | 0:30       |
| **Jump-cut #1 (skip 30s of Stage 2 stream)** | (cut)          | 0:30       |
| Stage 3 starts, body derivation visible      | 0:30 – 0:45    | 0:45       |
| **Jump-cut #2 (skip 60s of Stage 3 stream)** | (cut)          | 0:45       |
| Stage 4 + 5a + 5b complete (validator pass)  | 0:45 – 0:60    | 1:00       |
| IDE confirmation (sidebar + Cmd+P + chips)   | 1:00 – 1:15    | 1:15       |
| **Contract-scrolling tail (load-bearing)**   | 1:15 – 1:30    | 1:30       |
| Outro framing                                | 1:30 – 1:45    | 1:45       |

**Cap:** 105 seconds. Anything longer dilutes Q&A flow. The contract-scrolling tail is **mandatory** — without it, the inset is "spinner → jump-cut → IDE" and the prose claim is unsupported.

---

## Verbatim talking points

Read aloud or pre-record audio narration over the screen capture. Use **declarative voice**, not promotional. Pause briefly between blocks for jump-cut transitions.

### [0:00–0:08 — Setup framing]

> "Most teams have repos already. Here's what 'point at any repo' looks like."

> "I open Claude Code in an existing Next.js notes app. No contracts. No Contract IDE setup."

### [0:08–0:30 — pipeline starts, Stages 1 + 2]

> "I type: `/codebase-to-contracts`."

> "Skill kicks off. Stage 1 enumerates the source files — heuristic taxonomy classifies forty candidate nodes deterministically — UI pages, API routes, Prisma models, lib functions, external integrations."

> "Stage 2 derives frontmatter — `claude -p --json-schema`, parallel — every node gets uuid, kind, level, route, code_ranges, schema-validated."

[on screen: Stage 1 + Stage 2 progress logs visible; nodes.json count climbs to 40; concurrency-5 batches stream in iTerm]

### [0:30–0:45 — Stage 3 starts, body derivation]

> "Stage 3 derives bodies — Intent, Role, Inputs, Outputs, Side effects — the prose contracts that read like a code review."

[on screen: derive-body.mjs streaming; sample bodies appearing in `.staging/<uuid>.body.json`]

### [0:45–1:00 — Stages 4 + 5a + 5b — validator pass]

> "Stage 4 aligns each L4 atom to its outermost JSX element — same Babel parser config the IDE plugin uses."

> "Stage 5a synthesizes flows — import-graph walk, AST call-sites, single LLM verification per flow."

> "Stage 5b validates and atomically promotes from staging to `.contracts/`. If anything fails, no `.contracts/` gets written."

> "Total: about four minutes. About a dollar fifty."

[on screen: validator pass → `mv .staging → .contracts/`; final tree visible: ~40 sidecars + 16 flow contracts + contract-uuid-plugin/]

### [1:00–1:15 — IDE confirmation]

> "Open the IDE, point it at this repo. Sidebar populates with areas. Cmd+P searches by intent."

[on screen: contract-ide opens bootstrap-demo-target; sidebar populates from `.contracts/`; Cmd+P search "delete account" returns ranked hits]

> "Click a screen — the iframe renders, atom chips overlay the components."

[on screen: NT clicks an L3 trigger card (e.g. `app/account/settings/page.tsx`); rendered iframe loads; atom chips visible on Danger Zone area]

### [1:15–1:30 — Contract-scrolling tail (LOAD-BEARING)]

> "And here's what came out — these are the actual `.md` files."

[on screen: VS Code or IDE inspector opens `bootstrap-demo-target/.contracts/<uuid-for-account-route>.md` (the API route for `app/api/account/route.ts`). Scroll slowly through `## Intent` and `## Side effects` for 4–5 seconds. **`## Intent` and `## Side effects` headers + their bodies must be FULLY visible at readable size — not just header glimpses.**]

[on screen: jump-cut to a UI L3 contract `.md` — the account/settings page contract. Scroll through `## Intent` and `## Role` for 4–5 seconds. Same rule: body text fully readable.]

> "Same operation, different repo — and what came out is prose I'd accept in a code review."

### [1:30–1:45 — Outro framing]

> "Cmd+P just worked on this repo because the contracts know what each surface is for. The Babel plugin is installed. The validator passed."

> "Day zero — any team can adopt this."

---

## Recording checklist

1. **Reset state** (above). Verify no `.contracts/`, no `contract-uuid-plugin/`, no BOOTSTRAP-INSERT in `next.config.ts`.
2. **Start QuickTime screen recording** — full screen, 1080p+ (use Cmd+Shift+5 → Record Entire Screen, NOT a region; we want 1080p byte-perfect for the projector).
3. **Open iTerm2** with the bootstrap-demo-target directory; start Claude Code session; ready to type `/codebase-to-contracts`.
4. **Begin recording**, hit play on talking-point block 1.
5. **Run the skill**. Block 1 → 2 → 3 → 4 timing. Use jump-cuts in post-edit (or verbal "30 seconds later" overlay if recording in one take):
   - Skip the middle 30s of Stage 2 (frontmatter LLM streaming) — viewer sees start + cut to "30 seconds later" + final summary
   - Skip the middle 60s of Stage 3 (body LLM streaming) — viewer sees start + cut to "1 minute later" + final summary
   - **DO NOT cut the contract-scrolling tail** — the 10–15s of `.md` files visible on screen is the load-bearing answer to "what came out"
6. **Open contract-ide** on bootstrap-demo-target. Walk through the 6-item smoke checklist (sidebar populates, Cmd+P returns hits, screen card renders, chips visible on iframe, click a chip, inspector opens). Total time on this block: ~15s.
7. **Scroll contracts** in VS Code or IDE inspector — 2 contracts shown:
   - `bootstrap-demo-target/.contracts/<uuid>.md` for the API route `app/api/account/route.ts` (use `jq -r 'map(select(.kind=="API" and .file_path | contains("account/route.ts"))) | .[0].uuid' bootstrap-demo-target/.contracts/.staging/nodes.json` to find the uuid; or scan filenames after `.contracts/` is populated)
   - `bootstrap-demo-target/.contracts/<uuid>.md` for the UI L3 page `app/account/settings/page.tsx`
   - Scroll EACH for 4–5 seconds. `## Intent` + `## Side effects` (backend) and `## Intent` + `## Role` (UI) sections must be fully visible at readable size. Pause on each section for ~1.5s before scrolling further so the viewer has time to read.
8. **Hit stop on QuickTime**, save the recording (target file path: `~/Movies/contract-ide-qa-inset-2026-04-26.mov` or similar — see Final-file-path section below).
9. **Render at 1080p**, h.264, no audio compression, no upscaling. QuickTime's default export at 1080p is fine — verify duration is in the 75–105s window before exporting.
10. **Move to demo machine's mpv queue** (NOT to `~/Downloads/` — see Final-file-path section).

---

## Final file path

Save the recorded inset to:

```
/Users/yang/lahacks/.planning/phases/14-codebase-to-contracts-bootstrap-skill-demo-application/assets/qa-inset-2026-04-26.mp4
```

Add `assets/qa-inset-*.mp4` to `.gitignore` (binary > 50MB; do NOT commit to repo). Track the file path in the SUMMARY.md instead.

**Discoverable on the demo machine:**

- Pre-load in mpv: `mpv --keep-open=yes /Users/yang/lahacks/.planning/phases/14-codebase-to-contracts-bootstrap-skill-demo-application/assets/qa-inset-2026-04-26.mp4 --pause`
- Or pre-load in QuickTime: open the file, hit pause at frame 0
- DO NOT bury in `~/Downloads/` — the file must be one cmd+tab away from the live demo session

---

## Fallback plan (if live demo glitches at recording time)

If the bootstrap pipeline fails during recording (LLM error, schema timeout, validator fail):

1. **Best:** keep an earlier-recorded "good" inset committed to assets/ (or external Drive). Even a 75s recording from 2 days ago suffices — the inset is illustrative, not load-bearing.
2. **Verbal fallback:** "Yes, the skill we ship handles it. I'll demonstrate offline if you'd like — and I can show you the `.contracts/` tree right now in the IDE."
   - Then pull up `bootstrap-demo-target/.contracts/` in the IDE (live, on T laptop) and walk through 2–3 contracts manually. ~30 seconds.
3. **Worst case:** skip the inset; verbal answer "yes, it works on any Next.js + Prisma + TypeScript repo; the skill is open-source-ready and the contract format is documented in `.agents/skills/codebase-to-contracts/SKILL.md`."

The inset is a **luxury Q&A artifact**, not a demo dependency. If it doesn't render in time, the verbal fallback is acceptable.

---

## Anti-patterns (avoid)

- **DO NOT play the inset unprompted.** The 4-beat script is the headline; this is a side-pocket answer.
- **DO NOT extend past 105 seconds.** Q&A is a clock burn; respect the room.
- **DO NOT skip the contract-scrolling tail to fit in 60s.** The tail is the answer to "what did the contracts look like" — without it, the inset is "spinner → jump-cut → IDE" and the prose claim is unsupported.
- **DO NOT modify the locked 4-beat presentation script** to add a Phase 14 segment. The script is locked 2026-04-24 and Phase 14's posture is out-of-band Q&A only (RESEARCH Open Question 4 ratified).
- **DO NOT include audio narration if the room PA is uncertain.** Verbal talking points can be delivered live by the speaker over a silent inset; embedded audio is optional polish, not a requirement.
- **DO NOT show errors / dialog boxes / Claude Code permission prompts** on screen. Pre-authenticate / pre-acknowledge ALL interactive prompts before starting the recording.
- **DO NOT show the timer / clock / system tray** if it's near a sensitive time (e.g. don't record at 2:33am — the recording is timeless; the system clock undermines that).

---

## Success gate

The recording passes the gate if all of the following are true (verified by Yang in Plan 14-06 Task 4):

- [ ] Total duration 75–105 seconds (NOT 60s, NOT 2min)
- [ ] Visible jump-cuts at slow LLM stages so the inset doesn't drag (Stage 2 + Stage 3 each have a cut)
- [ ] Final 3 shots in order:
  - [ ] IDE displaying bootstrap-demo-target with sidebar populated + atoms visible on iframe
  - [ ] Backend contract `.md` opened in editor; `## Intent` + `## Side effects` sections fully visible (scrolled slowly enough to read, NOT just glimpsed)
  - [ ] UI L3 contract `.md` opened in editor; `## Intent` + `## Role` sections fully visible
- [ ] No on-camera errors / dialogs / permission prompts
- [ ] Audio (if any) matches the verbatim talking points above
- [ ] File is 1080p+ h.264, ready for projector playback (no `.mov` if the demo machine doesn't have QuickTime; convert to `.mp4` if uncertain)
- [ ] File is at the noted absolute path AND queued in mpv / QuickTime (NOT in `~/Downloads/`)

If any item fails: re-record. The inset is short — 75–105s — re-recording costs ~10 minutes per attempt.

---

## Reference paths

- Locked 4-beat script: `/Users/yang/lahacks/.planning/demo/presentation-script.md` — DO NOT MODIFY
- Phase 14 UAT runbook: `/Users/yang/lahacks/.planning/phases/14-codebase-to-contracts-bootstrap-skill-demo-application/14-UAT.md` (sibling document)
- Skill: `/Users/yang/lahacks/.agents/skills/codebase-to-contracts/`
- Demo target repo: `/Users/yang/lahacks/bootstrap-demo-target/` (Marginalia)
- Phase 14 Plan 06 (this plan): `/Users/yang/lahacks/.planning/phases/14-codebase-to-contracts-bootstrap-skill-demo-application/14-06-PLAN.md`
