# Coverage Review: Contract IDE

**Reviewer:** Independent audit
**Date:** 2026-04-24
**Documents reviewed:** PROJECT.md, REQUIREMENTS.md, ROADMAP.md, FEATURES.md, PITFALLS.md

---

## 1. Forward Coverage — Requirements → Phases

For each of the 39 v1 requirements: phase assignment, whether the phase's success criteria would actually verify the requirement (Y / Partial / N), and notes on gaps.

| REQ-ID   | Phase | Success Criteria Verify? | Notes |
|----------|-------|--------------------------|-------|
| SHELL-01 | 1     | Y | Phase 1 SC-1 exactly targets three-pane layout + native chrome. |
| SHELL-02 | 2     | Y | Phase 2 SC-1 tests repo open → SQLite population end-to-end. |
| SHELL-03 | 3     | Y | Phase 3 SC-4 tests Cmd+K palette with node jump + lens toggle. |
| SHELL-04 | 1     | Partial | Phase 1 SC-2 covers loading/empty/error states for async ops, but narrows scope to "async operations" generically. The requirement names three specific contexts (repo indexing, derivation, agent runs); derivation and agent are not available in Phase 1 to test. The error states for those contexts are only verifiable after Phases 6 and 8. Phase 1 SC-2 is necessary but not sufficient. |
| DATA-01  | 2     | Y | Phase 2 SC-2 tests round-trip: write sidecar → parse → SQLite with all named frontmatter fields intact. |
| DATA-02  | 2     | Y | Phase 2 SC-1 directly targets startup scan → SQLite population visible via IPC. |
| DATA-03  | 2     | Y | Phase 2 SC-4 tests watcher updates within 2 seconds on disk edit. |
| DATA-04  | 2     | Y | Phase 2 SC-3 tests UUID stability under file rename. |
| DATA-05  | 2     | Partial | Phase 2 SC-1 mentions "canonical/ghost reference rows" in passing, but no success criterion explicitly tests the ghost reference render path or the `canonical_uuid` linkage structure. The data model is implied by SC-1 but there is no "ghost node appears in the graph linked to its canonical home" verification. |
| GRAPH-01 | 3     | Y | Phase 3 SC-1 tests the five-level zoom with smooth transitions and breadcrumb. |
| GRAPH-02 | 3     | Y | Phase 3 SC-1 covers zoom-reveal and breadcrumb directly. |
| GRAPH-03 | 3     | Y | Phase 3 SC-2 sets explicit FPS floor (50fps at 500 nodes + screen recording). |
| GRAPH-04 | 3     | Y | Phase 3 SC-3 tests all three visual encodings (kind, health, canonical/ghost) as "distinguishable at a glance." |
| GRAPH-05 | 3     | Y | Phase 3 SC-5 tests Journey fully working + System/Ownership selectable without crash. |
| INSP-01  | 4     | Y | Phase 4 SC-1 tests contract body + Monaco code view + receipt history per node with Monaco worker confirmation. |
| INSP-02  | 4     | Y | Phase 4 SC-2 tests live preview with "Start dev server" prompt fallback. |
| INSP-03  | 4     | Y | Phase 4 SC-3 tests contract body edit preserved + "contract dirty" marking + no overwrite of human-authored text. |
| INSP-04  | 4     | Y | Phase 4 SC-4 tests drift indicator + reconcile affordance visibility. |
| MCP-01   | 5     | Y | Phase 5 SC-2 calls all four tools against live data from a Claude Code session. |
| MCP-02   | 5     | Y | Phase 5 SC-3 tests single-writer rule: `update_contract` writes sidecar only; Rust watcher propagates. |
| MCP-03   | 5     | Y | Phase 5 SC-3 validates read-only `better-sqlite3` connection and single-writer discipline. |
| DERIVE-01| 6     | Y | Phase 6 SC-1 tests non-blocking derivation with per-node progress + contract update in graph. |
| DERIVE-02| 6     | Y | Phase 6 SC-2 tests hash-skip: unchanged `code_hash` = no LLM call, existing contract preserved. |
| DERIVE-03| 6     | Y | Phase 6 SC-3 tests pinned human contract is not overwritten, with visible pin status in inspector. |
| DRIFT-01 | 7     | Y | Phase 7 SC-1 tests red-pulse within 2 seconds of manual file edit via `notify` watcher. |
| DRIFT-02 | 7     | Y | Phase 7 SC-3 tests reconcile panel with all three options visible on click of drifted node. |
| AGENT-01 | 8     | Y | Phase 8 SC-1 tests `claude` CLI scoped to zoomed node + neighbors, with streaming output in chat. |
| AGENT-02 | 8     | Y | Phase 8 SC-2 tests non-zero token counts + mock fallback preventing blank card. |
| AGENT-03 | 8     | Y | Phase 8 SC-4 tests per-node receipt persistence + retrieval from receipt history tab. |
| AGENT-04 | 8     | Y | Phase 8 SC-4 tests two-receipt side-by-side pinning. |
| CHRY-01  | 8     | Partial | Phase 8 SC-1 covers intent-typed node location via chat, but CHRY-01 also requires visual highlighting of the target node "before any change." No success criterion explicitly verifies the highlight state (the node is selected/focused in the graph) as a precondition before the agent runs. It is implied by the flow but not tested. |
| CHRY-02  | 8     | Y | Phase 8 SC-3 tests side-by-side diff view (contract + code) with atomic single-action approval. |
| CHRY-03  | 8     | Y | Phase 8 SC-3 explicitly tests atomic write via single Rust IPC command (not a sequence of frontend calls). |
| MASS-01  | 9     | Y | Phase 9 SC-1 tests multi-node highlight + per-node patch queue + approve-all via Demo Beat 2. |
| MASS-02  | 9     | Y | Phase 9 SC-1 tests scrub-through + approve-all + selective approval. |
| NONC-01  | 9     | Y | Phase 9 SC-2 tests simplified inspector view with no source code visible + targeted code change via Demo Beat 3. |
| DEMO-01  | 9     | Y | Phase 9 SC-3 tests exactly 25 contracts, each uniquely identifiable by behavioral description. |
| DEMO-02  | 9     | Y | Phase 9 SC-4 tests all three beats reproducible 3 times in a row before filming. |
| DEMO-03  | 9     | Y | Phase 9 SC-5 tests baseline receipt committed under reproducible conditions + token delta visible. |

### Flagged Items

**SHELL-04 (Partial):** Phase 1 can only verify the shell-level loading/error states. Derivation and agent-run error states cannot be tested until Phases 6 and 8 respectively. Recommend adding explicit re-verification of SHELL-04 to Phase 6 and Phase 8 success criteria — one line each: "Error state for derivation failure is visible and actionable" and "Error state for a failed `claude` CLI run is visible and actionable."

**DATA-05 (Partial):** The ghost-reference UX — ghost nodes rendered with dashed border, linked to canonical home — has no dedicated success criterion. Phase 2 SC-1 mentions "canonical/ghost reference rows" in the data layer but Phase 3 has no criterion that verifies ghost nodes are visually distinguishable or that clicking a ghost navigates to the canonical. GRAPH-04 SC-3 does test "canonical vs ghost reference visually distinguishable," which partially covers this, but the navigation behavior (ghost → canonical home) is not tested anywhere.

**CHRY-01 (Partial):** Visual pre-highlight of the target node before the agent runs is part of the requirement but absent from success criteria. This is a UX detail that's easy to miss under pressure. Add to Phase 8 SC-1: "The target node is visually highlighted in the graph before the agent run begins."

---

## 2. Backward Coverage — Core Value → Requirements → Phases

Core Value: *"A developer or PM can locate any piece of the product by intent, edit its contract, and have the agent produce the corresponding code change — without ever touching the file tree."*

### Piece 1: "locate any piece of the product by intent"

| What's needed | REQ-IDs | Phase | Covered? |
|---------------|---------|-------|----------|
| Searchable contract graph that maps intent to nodes | GRAPH-01, GRAPH-02, GRAPH-05 | 3 | Y |
| FTS / semantic search so "checkout confirm button" finds the right node | GRAPH-03 (virtualization, not search), AGENT-01 (intent via chat) | 3, 8 | Partial |
| Command palette for keyboard-driven locate | SHELL-03 | 3 | Y |
| MCP `find_by_intent` for agent-side lookup | MCP-01 | 5 | Y |

**Gap identified:** There is no v1 requirement for graph-level text search or FTS filtering. SHELL-03 (command palette) lets a user jump to a node by name if they already know the name. AGENT-01 lets a user type intent in chat and have the agent call `find_by_intent`. But neither path gives a user the ability to type "checkout confirm button" directly into the graph canvas and see matching nodes highlighted — which is what "locate by intent" most naturally implies for a non-agent user path.

FEATURES.md lists "Search / filter within graph" as P2 (deferred). The feature dependency graph in FEATURES.md also lists it as an enhancement — but the Core Value verb "locate by intent" requires it for the non-agent user path. The MVP definition in FEATURES.md defers it with "Cmd+K serves the demo case" — but Cmd+K does name-matching, not intent-matching.

**Verdict:** The agent path (AGENT-01 + MCP-01) covers intent-based location. The direct human path relies on Cmd+K name matching, which is weaker than "by intent." This is a philosophically meaningful gap in the Core Value chain, mitigated by the demo showing the agent path. For the hackathon demo it is acceptable; for a real user it is a gap.

### Piece 2: "edit its contract"

| What's needed | REQ-IDs | Phase | Covered? |
|---------------|---------|-------|----------|
| Contract editor in inspector | INSP-03 | 4 | Y |
| Human-authored text protection | DERIVE-03 | 6 | Y |
| Contract persistence as sidecar | DATA-01 | 2 | Y |
| Non-coder simplified edit view | NONC-01 | 9 | Y |

**Verdict:** Fully covered. The chain from open inspector → edit contract → persist to sidecar → protect from re-derivation is complete across Phases 2, 4, 6, and 9.

### Piece 3: "have the agent produce the corresponding code change"

| What's needed | REQ-IDs | Phase | Covered? |
|---------------|---------|-------|----------|
| Agent runner shelling to `claude` CLI | AGENT-01 | 8 | Y |
| Context scoped to the selected node | AGENT-01 | 8 | Y |
| Diff view for the code change | CHRY-02 | 8 | Y |
| Atomic approval of both diffs | CHRY-03 | 8 | Y |
| Receipts confirming what happened | AGENT-02, AGENT-03 | 8 | Y |

**Verdict:** Fully covered within Phase 8.

### Piece 4: "without ever touching the file tree"

| What's needed | REQ-IDs | Phase | Covered? |
|---------------|---------|-------|----------|
| File tree absent from primary UI | (Out-of-scope item in PROJECT.md + REQUIREMENTS.md) | — | Y (by omission) |
| All navigation via graph/intent | GRAPH-01–05, SHELL-03, AGENT-01, MCP-01 | 3, 5, 8 | Y |
| Atomic writes handled by Rust backend | CHRY-03 | 8 | Y |

**Gap identified:** "Without touching the file tree" is enforced by omission (no file tree requirement exists and the feature is explicitly out of scope) — but no success criterion in any phase affirmatively tests that a complete user journey (locate → edit → approve) was performed without the user ever opening Finder or a terminal. This is fine for a demo but worth noting: the guarantee is architectural assumption, not a tested invariant.

**Verdict:** The no-file-tree guarantee is structurally sound but untested as a user-journey invariant. All four Core Value pieces are covered well enough for the hackathon, with two modest gaps:
1. The direct human "locate by intent" path (without agent mediation) relies on name-matching Cmd+K, not true intent-matching.
2. The no-file-tree guarantee is by design but never explicitly verified end-to-end.

---

## 3. Demo-Beat Coverage

### Beat 1: Cherrypick checkout button color → receipt comparison

| Step | REQ-IDs | Phase | Notes |
|------|---------|-------|-------|
| Locate checkout button node by intent | AGENT-01, MCP-01, CHRY-01 | 8, 5 | Phase 5 (MCP) unlocks `find_by_intent`; Phase 8 wires chat-driven location |
| Inspect node | INSP-01, INSP-02 | 4 | |
| Edit contract (change color spec) | INSP-03 | 4 | |
| Agent produces scoped code patch | AGENT-01, CHRY-02 | 8 | |
| Atomic approve | CHRY-03 | 8 | |
| Receipt card appears | AGENT-02, AGENT-03 | 8 | |
| Side-by-side receipt pinning | AGENT-04 | 8 | |
| Demo seed for vercel/commerce | DEMO-01, DEMO-02, DEMO-03 | 9 | |

**Beat 1 demoability:** Beat 1's agent/inspect/approve chain is entirely in Phase 8. Phase 4 (inspector) and Phase 5 (MCP) are prerequisites. The receipt pinning baseline (DEMO-03) requires Phase 9. This means Beat 1 is partially blocked by Phase 9 — the actual beat is ready after Phase 8, but the side-by-side receipt comparison with the committed baseline isn't filmable until DEMO-03 (Phase 9) is done. In practice, the beat is demoable at the end of Phase 8 with a manually recorded baseline, and fully polished at Phase 9. Not a blocking concern.

**Risk:** The demo seed (DEMO-01, DEMO-02) is Phase 9, yet Beat 1 needs a seeded `vercel/commerce` node to point at. The beat can be roughed out against a hand-crafted test repo in Phase 8, but filming requires the Phase 9 seed. The roadmap correctly places the seed in Phase 9, but this means no filmable Beat 1 exists until the very last phase.

### Beat 2: Mass-add loading states to async buttons → receipt comparison

| Step | REQ-IDs | Phase | Notes |
|------|---------|-------|-------|
| Multi-node intent match + highlight | MASS-01 | 9 | |
| Agent produces per-node patches | MASS-02, AGENT-01 | 9, 8 | Agent runner from Phase 8 reused |
| Batch diff review + approve-all | MASS-02 | 9 | |
| Receipt card per node | AGENT-02, AGENT-03 | 8 | |
| Side-by-side pinning | AGENT-04 | 8 | |
| Demo seed | DEMO-01, DEMO-02, DEMO-03 | 9 | |

**Beat 2 demoability:** MASS-01 and MASS-02 are both Phase 9. Beat 2 is entirely blocked until the last phase. This is the latest-breaking beat in the build. If Phase 9 runs over time, Beat 2 fails. This is the weakest beat by phase distribution.

**Risk:** Mass semantic edit (MASS-01/02) requires multi-node intent matching. FEATURES.md notes this requires "SQLite FTS + embedding similarity" for the node matching step. No explicit FTS or embedding requirement exists in v1 requirements. MASS-01 says "matches multiple nodes" but does not specify the mechanism. If the matching is naive (keyword match against node names), it may not produce demo-quality results. This is a hidden implementation risk.

### Beat 3: Non-coder edits empty-state copy → receipt comparison

| Step | REQ-IDs | Phase | Notes |
|------|---------|-------|-------|
| Filter to L4 atoms | GRAPH-01, GRAPH-02 | 3 | Zoom to atom level; filter not a separate requirement |
| Simplified inspector (no code) | NONC-01 | 9 | |
| Edit copy in plain English | NONC-01, INSP-03 | 9, 4 | |
| Agent produces targeted code change | AGENT-01, CHRY-02 | 8 | |
| Receipt card + comparison | AGENT-02, AGENT-03, AGENT-04 | 8 | |
| Demo seed (text-bearing atom node) | DEMO-01, DEMO-02, DEMO-03 | 9 | |

**Beat 3 demoability:** NONC-01 is Phase 9, but FEATURES.md rightly notes it is "a skin on top of the inspector" — no new backend primitives needed. It is the lowest-risk differentiator and can be added late. Demo seed is Phase 9. Beat 3 is not filmable until Phase 9 but the implementation work is low. Least risky of the three beats.

### Beat Phase Distribution Summary

| Beat | Earliest demoable | Blocking late requirement | Risk level |
|------|------------------|---------------------------|------------|
| Beat 1: Cherrypick color | Phase 8 (rough) / Phase 9 (filmable) | DEMO-01/02/03 in Phase 9 | Medium |
| Beat 2: Mass loading states | Phase 9 only | MASS-01/02 + DEMO-* all Phase 9 | High — latest-breaking |
| Beat 3: Non-coder copy edit | Phase 9 only | NONC-01 + DEMO-* all Phase 9 | Low — implementation is thin |

**Key finding:** All three beats require Phase 9 to be filmable (demo seeds). Beat 2 additionally requires the heaviest Phase 9 implementation (mass semantic edit). If Phase 9 hits time pressure, Beat 2 is the most likely casualty.

---

## 4. Table-Stakes vs. Differentiators Gap Check

FEATURES.md lists 13 table-stakes features. Here is their v1 status:

| Table-stakes Feature | In v1 Requirements? | Notes |
|----------------------|---------------------|-------|
| Command palette (Cmd+K) | Yes — SHELL-03 (Phase 3) | Covered. |
| Global keyboard navigation | No — deferred to v1.x | FEATURES.md lists it as P2 ("blocks nothing for demo"). |
| Settings panel | No — deferred to v2 (IDE-05) | Deferred entirely. |
| Autosave + crash recovery | Implicit in DATA-01/03 | No explicit autosave requirement. Sidecar write on every contract mutation is the intent but not stated as a requirement with a success criterion. |
| Undo / Redo for contract edits | No — deferred to v1.x | FEATURES.md P2. |
| Error states with actionable messages | Yes — SHELL-04 (Phase 1) | Covered, with the Partial caveat noted above. |
| Theming (dark/light, system preference) | Implicit in SHELL-01 (Phase 1) | macOS native chrome is required; dark/light switching not explicitly stated. PITFALLS.md calls out `window-vibrancy` but not theming toggle. |
| Syntax highlighting in code pane | Implicit in INSP-01 (Phase 4) | Monaco handles this; not a gap. |
| Search / filter within graph | No — deferred to P2 | Named gap in Core Value analysis above. |
| Inline diff view + accept/reject | Yes — CHRY-02/03 (Phase 8) | Covered. |
| Loading / progress indicators | Yes — SHELL-04 (Phase 1), DERIVE-01 (Phase 6) | Covered. |
| Empty state onboarding | Implicit in SHELL-04 (Phase 1) | "Open a repo" prompt implied but no explicit success criterion tests the first-launch empty state content. |
| Link to open file in Finder | No | Not in v1 requirements at all. FEATURES.md lists it as table stakes ("LOW complexity"). Missing entirely from requirements. |

### 3 Most Impactful Omissions

**1. Undo/Redo for contract edits (deferred to v1.x).**
Every developer editing a contract will hit Cmd+Z. If it does nothing or reverts unexpected content, trust breaks immediately during the demo and dogfood. FEATURES.md rates this MEDIUM complexity and defers it, but for a demo that involves editing contracts on camera, a broken Cmd+Z is a credibility destroyer. This is the highest-impact deferred table stake.

**2. Autosave with explicit requirement and success criterion.**
The current spec implies sidecar files are written on every mutation, but there is no requirement with a success criterion that verifies: "user closes the app mid-edit and contract is preserved." DATA-01 covers the on-disk format; INSP-03 covers the dirty state. But if the write is triggered by a blur or explicit save action rather than truly continuous, data loss is possible. No test verifies this. For dogfooding (which PROJECT.md says will begin mid-build), silent data loss would be catastrophic.

**3. "Reveal in Finder" / escape hatch (not in v1 requirements at all).**
FEATURES.md lists this as LOW complexity table stakes: "Users will occasionally need the escape hatch to Finder/terminal." It is absent from v1 requirements entirely. During the demo, if a narrator wants to point to a file, they have no in-app affordance. During dogfood, power users will need this regularly. Tauri's `shell::open()` is a one-line implementation. The risk is low but the omission is complete.

---

## 5. Anti-Feature Discipline Check

Reviewing each v1 requirement against the Out-of-Scope list in PROJECT.md and REQUIREMENTS.md.

| Scope risk | Requirement | Assessment |
|------------|-------------|------------|
| File tree creep | INSP-02 (live localhost preview) | Clean. Preview is in inspector, not a file browse surface. |
| File tree creep | DATA-01 (sidecar files) | Clean. Sidecars are implementation, not UI navigation. |
| Cloud sync | DATA-03 (file watcher) | Clean. Local `notify` watcher only. |
| Authoritative contracts | DERIVE-03 (human-pin protection) | Borderline. The ability to pin a contract and have derivation never overwrite it is a step toward treating the contract as authoritative. In v1 this is clearly "derived + pinned" not "code generated from contract." But the INSP-03 + DERIVE-03 combination (edit contract → agent produces matching code) is the authoritative pattern in behavior even if not in name. This is intentional design, not scope creep — but worth watching. |
| Multi-provider | AGENT-01 (claude CLI) | Clean. Hard-wired to `claude` CLI explicitly. |
| Code scaffolding | CHRY-02/03 (agent produces code change) | Clean. Changes scoped to existing nodes, not new-project generation. |
| Code scaffolding | MASS-01/02 (mass edit) | Clean. Mass edit against existing nodes. |
| Skills-based integration | MCP-02 (PostToolUse hook) | Clean. Single hook only, no skills system. |
| Full IDE (Monaco editable) | INSP-01 (Monaco read-only) | Clean. Read-only explicitly stated. |
| Multi-user | No v1 requirement touches this | Clean. |
| Non-macOS | SHELL-01 (macOS chrome) | Clean. macOS-only explicitly required. |

**One genuine creep signal found:**

**NONC-01 combined with AGENT-01 and CHRY-02/03 — non-coder mode is implicitly a simplified authoritative-contract experience.** The user edits a plain-English contract field (no code), the agent produces a code change, user approves — from the user's perspective, they wrote intent and got code. This is precisely the authoritative-contract pattern described as out of scope. The v1 framing keeps it safe (it's still "derived, not authoritative") because the underlying code file is the ground truth and the contract is just the edit signal. But if during demo narration this is described as "you write what you want and the machine produces the code," the demo will invite "isn't this authoritative contracts?" questions. This is a communication risk, not a scope risk, but the line is thin.

**No hard scope creep found.** All 39 requirements trace cleanly to the in-scope feature set.

---

## 6. Final Call

### Is every requirement mapped?

**Yes.** All 39 v1 requirements are mapped to phases. No unmapped requirements. Three requirements have Partial success-criteria coverage (SHELL-04, DATA-05, CHRY-01) — they are mapped to phases but the phase success criteria do not fully verify the requirement. These are gaps in verification quality, not in phase assignment.

### Is Core Value fully covered?

**Mostly yes, with one meaningful gap.** Three of the four Core Value phrases have complete requirement and phase coverage. The one gap: "locate any piece of the product by intent" — the direct human path (without agent mediation) uses Cmd+K name-matching, not semantic intent search. The agent path (AGENT-01 + MCP-01) does provide true intent-based lookup. For the demo, the agent path is the demonstrated path, so this gap does not hurt the video. For real users, it would be felt.

### Are all three demo beats demoable by end of roadmap?

**Yes, but all three require Phase 9 to be complete before filming is possible** (due to demo seeding). Beat 2 (mass loading states) is the weakest: it is the heaviest Phase 9 implementation, has the most Phase 9 dependencies, and carries a hidden mechanism risk (multi-node intent matching is not specified with a concrete algorithm in requirements — MASS-01 says "matches multiple nodes" without specifying whether that is FTS, embedding similarity, or something else).

### Hidden gap?

**The multi-node intent matching mechanism for MASS-01 is unspecified.** FEATURES.md calls out "SQLite FTS + embedding similarity" as required, but no v1 requirement names FTS or embeddings. If the implementation defaults to naive name/tag matching, Demo Beat 2 ("add loading states to every button that triggers an async request") will fail to find the right nodes — the query is semantic, not name-based. This needs an explicit implementation decision before Phase 9 begins.

---

*Coverage review complete. 3 Partial requirements flagged, 1 hidden mechanism gap identified, 3 table-stakes omissions named, 0 hard scope creep findings.*
