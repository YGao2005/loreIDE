# Cross-Level Contract Propagation — Red-Team Review

**Status:** DRAFT (red-team iteration 1 complete; 7 revisions adopted)
**Drafted:** 2026-04-24
**Authors:** Claude (adversarial review) · shaped through two rounds of discussion with Yang, then stress-tested by two red-team agents (literature- and engineering-grounded — see `PROPAGATION_REDTEAM_LITERATURE.md` and `PROPAGATION_REDTEAM_ENGINEERING.md`)
**Decides:** how L0–L2 contracts stay coherent as L3/L4 contracts drift, across session and non-session edit paths.

---

## Verdict

**RETHINK** on the owner's proposal as stated; the revised architecture below preserves the owner's goal but replaces the mechanism. The core instinct — that an editing session holds intent-context a cold re-synthesis cannot recover — is right and load-bearing. But using the PostToolUse hook as the propagation *decision point*, and trusting the same session to audit the consequences of its own edits, collapses under at least three named attacks (#4 edit chains, #5 partial rollback, #8 cold sessions). The architecture that survives separates three concerns that the owner fused: **detection** is cheap, deterministic, hash-based, and runs on every cache rebuild including after `git pull`; **reconciliation** is opt-in, batchable, and the only place LLMs get involved; **intent capture** becomes the hook's real job — a journal on disk, not a prompt into the session. Session-initiated mid-flight propagation is retained as an explicit opt-in shortcut. Robustness stops being conditional on the hook firing; the hook becomes an optimization, not a dependency.

---

## Attack Surface Analysis

The ten attacks from the review brief, ranked by severity against the owner's original proposal:

### Critical — proposal silently breaks

**#4 Edit chains without session context.** The owner's proposal relies on the hook observing every edit. `git pull`, `rebase`, `npm run format`, a CI bot, a Claude session on another machine — all produce contract-bearing file changes the hook never sees. The Phase 7 watcher catches L3/L4 drift because those levels have `code_ranges` and `code_hash`. L0–L2 have neither; they are conceptual. Result: upstream contracts go stale with *no visual signal* and no detection mechanism. The graph reports health while actively lying to downstream consumers (the agent loop reads L1 via `find_by_intent` and plans off a false claim). **Category-killer, not a tunable knob.**

**#8 Cold session invocations.** "The same session has richer context" relies on session continuity Claude Code doesn't guarantee. `claude -p "add analytics to checkout"` starts fresh. The previous session's propagation reasoning lives in a JSONL on disk, invisible to the new session. Owner's proposal has no handoff mechanism. The "same session" property is literally true within a session and operationally useless across time.

**#5 Partial rollback.** Session A propagates an L1 change. Developer reverts only the code change in a follow-up commit (contract file untouched). L3 pulses red (watcher catches `code_hash` drift). L1 has no `code_hash` to check; it retains a claim now unsupported by code. Owner's proposal propagates forward only; it has no symmetric mechanism for rollback.

### Severe — proposal degrades badly

**#9 Economic argument.** Per-edit rollup prompts scale linearly with edit count, not with propagation-worthy events. A session with 10 edits and 0 cross-level impact spends ~50k additional tokens on "no change needed" answers. Catch rate must be unreasonably high to justify the constant tax — and attacks 2 and 7 suggest the catch rate is *not* high.

**#6 Small edit, large consequence.** A one-line change to a shared utility ripples through 40 components across ~8 L2s across ~3 L1s. Hook fires once; the naive per-edit rollup asks the session about 12+ upstream nodes in a single invocation. No batching semantics in the owner's proposal.

**#7 Large edit, small consequence.** A 500-line pure-implementation refactor preserves every contract. Hook fires N times; session answers "no change" N times; each "no change" primes the next answer toward "no change," degrading signal-to-noise when a real propagation need appears.

### Moderate — addressable with modification

**#2 Agent self-assessment unreliability.** Asking the session "do these levels need changing?" trusts an LLM to audit second-order effects of its own actions — a task LLMs measurably fail at. No backstop in the owner's proposal when the session answers "no."

**#1 Noise and alert fatigue.** Any threshold silencing per-edit noise also silences signal. Owner's proposal doesn't define the calibration; optimism is the gap.

### Low — concerns but not architecturally fatal

**#3 Concurrent sessions.** Real problem, but for single-user local-first v1 (per requirements), this is mostly a git-merge problem deferred to v2 with COLL-01.

**#10 Simpler alternative steelman.** Not a failure mode per se; it's a forcing question. The answer — pure drift-flag + opt-in reconcile — is *closer to correct* than the owner's proposal, which is why the revised architecture absorbs its reactive core.

---

## Where the Proposal is Strongest

Honest inventory of what the owner gets right:

- **Context-preservation instinct is correct.** The editing session holds information a re-synthesis cannot recover: *why* the change was made, *which* invariants the developer believed load-bearing, the user's framing. Throwing it away is expensive. The revised architecture retains this — via journal, not via session memory.
- **PostToolUse as an observation point is correct.** Every Claude Code file write is deterministically observable. That's a structural gift of the integration; wasting it would be a mistake.
- **Cross-level consistency is a real problem worth solving.** Most drift-detection systems (linters, type-checkers, schema validators) work at a single level. Propagating *semantic* intent across abstraction levels is genuinely novel and genuinely hard. The owner isn't inventing a problem.
- **Treating the agent as the propagator is plausibly sound.** The mistake is the granularity (per-edit), not the mechanism (LLM judgment). At per-reconciliation granularity, the agent is the right engine because the task is semantic judgment over natural-language contracts.

---

## Where the Proposal Breaks

Three concrete scenarios the owner has not yet walked through.

### Scenario A — The Bob/Alice rebase (attack #4)

Alice's session edits `write_derived_contract.ts` to add a missing-source guard. PostToolUse fires, Alice's session rolls up and updates L2 "MCP Write Path" Intent to claim the new guard. PR ships. Bob reviews, reverts just the code change (contract file untouched; he doesn't know it was rolled up). Merges. Alice pulls.

- L3 pulses red — Phase 7 watcher catches the `code_hash` drift.
- L2 still claims the guard. L2 has no `code_hash`; watcher is blind to it.
- Graph shows 80% healthy. `find_by_intent` returns L2 confidently.
- Next agent session reads L2, plans downstream work off a false claim.

Owner's proposal has no mechanism here. The hook didn't fire on Alice's `git pull`; staleness is invisible.

### Scenario B — The fresh-session flip-flop (attack #8)

Monday's session propagates an L1 change claiming "checkout always validates address before submission." Tuesday, same developer runs `claude -p "refactor checkout error handling"` — fresh context. New session reads L1 in its current state but has no memory of Monday's reasoning. It makes an edit that weakens the validation at L3, rolls up, proposes an L1 change that reverts Monday's claim. Without shared context, the L0–L2 layer becomes a flip-flop driven by whichever session touched it last. The "same session has context" claim is literally true and operationally useless across session boundaries.

### Scenario C — The small-utility blast radius (attack #6)

One-line change to a date-formatting utility used by 40 components. PostToolUse fires once. Those 40 L3/L4 nodes ladder up across ~8 L2s across ~3 L1s across L0. Owner's proposal, read literally, asks the session to review 3 L1s + 8 L2s + L0 = 12 rollup prompts from one edit. In practice the session either (i) skims and answers "probably fine" to all (LLM overconfidence), or (ii) spends 50k tokens of wall-time on a no-op. Neither outcome is good. Owner's proposal has no batching semantics for "one edit, many propagation paths."

---

## Alternative Architectures Considered

### Pure reactive — drift-flag + opt-in reconcile (steelman of #10)

Upstream contracts get flagged stale when a child `contract_hash` changes; user reconciles manually.

- *Pro*: near-zero ongoing cost; survives every non-session edit path; matches the L3/L4 drift model from Phase 7.
- *Con*: loses session context entirely. When the user reconciles a week later, the "why" of the original edit is gone — cold re-synthesis of L1 is exactly what the owner wanted to avoid.
- *Verdict*: this is the proposed architecture *minus* the intent journal, and that minus is load-bearing.

### Periodic sweeper — cron-style consistency check

A scheduled Claude session wakes up hourly, reads the whole graph, finds inconsistencies, proposes fixes.

- *Pro*: no per-edit tax; runs in background.
- *Con*: detection latency is hours not seconds; cold session has the same context-blindness as the steelman; cost is the same as on-demand reconciliation but without user control over timing.
- *Verdict*: strictly worse than on-demand reconciliation with a journal.

### Pure local — L0–L2 always hand-maintained, never automated

- *Pro*: zero automation complexity; can't silently lie about what it doesn't claim.
- *Con*: concedes the Contract IDE thesis at the levels that matter most. Also: this is just the status quo.
- *Verdict*: not really a candidate.

### Owner's original — per-edit hook → session self-audit

- *Pro*: leverages session context at its richest moment.
- *Con*: vulnerable to attacks 4, 5, 6, 7, 8, 9 as detailed above.

### Proposed — separation of detection, reconciliation, and intent capture

- *Pro*: survives every attack; hook becomes an optimization, not a dependency; preserves session context via journal without requiring session liveness.
- *Con*: introduces one new schema field (section hashes), one new persisted artifact (journal), and one new user gesture (reconcile).
- *Verdict*: more moving parts than the steelman, but each part does exactly one job. The design move is *separation of concerns*, not a hybrid.

---

## Proposed Architecture

Four layers. Each does exactly one job.

### Layer 1 — Detection (deterministic, complete, hash-based)

**Schema addition: `section_hashes` on every contract frontmatter.**

```yaml
section_hashes:
  intent: <sha256>
  role: <sha256>
  inputs: <sha256>
  outputs: <sha256>
  invariants: <sha256>
  examples: <sha256>
  # … one per v2 section present
```

Computed at every `write_derived_contract` / `update_contract` call, alongside the existing `contract_hash`. The single `contract_hash` is retained for drift-badge UI; section-level hashes power rollup dependency tracking.

**Canonical section parser lives in Rust only** (`src-tauri/src/sidecar/section_parser.rs`). The MCP sidecar calls Rust via IPC to compute `section_hashes` rather than maintaining a parallel TypeScript implementation. This eliminates parser divergence as a failure mode — a concrete hazard, not a hypothetical one: the two committed fixtures (`11111111-…` API L3 and `22222222-…` UI L4) already order their sections differently (`## Examples` appears mid-body in the UI fixture, late in the API fixture). Any parallel-implementation scheme that disagrees on ordering, whitespace handling, CRLF, or `##` inside fenced code blocks produces universal amber on first launch. One implementation, one source of truth. The parser must be: fenced-code-aware (a `##` inside a ```` ``` ```` block is not a heading); order-stable (hash the sorted set, not the textual order); reject duplicate headings as malformed frontmatter. Closes prior open question Q1.

**Schema addition: `rollup_inputs`, `rollup_hash`, `rollup_state`, and `rollup_generation` on every L1/L2/L3 contract.**

```yaml
rollup_inputs:
  - child_uuid: <uuid>
    sections: [intent, invariants]
  - child_uuid: <uuid>
    sections: [invariants]
rollup_hash: <sha256 over concatenated section_hashes of declared inputs>
rollup_state: fresh | stale | untracked
rollup_generation: <u64, monotonic>
```

`rollup_inputs` enumerates which child contracts (and which sections) this upstream depends on. `rollup_hash` is the derived integrity check. `rollup_state` is the tri-state visual signal. `rollup_generation` is a monotonic counter incremented on every reconcile commit.

**Justification for each new field** (per the brief's "might be useful is not justification" rule):

- `section_hashes`: enables "L1 cites L3's Invariants but not its Examples" as a first-class distinction. Without it, every Examples-only edit stales every ancestor, collapsing attack 6 into noise. *Attack 6 addressed.*
- `rollup_inputs`: makes the dependency graph explicit. Without it, we default to "any child changed → stale every ancestor," which over-flags by 5–10×. *Attack 1 (calibration) addressed.*
- `rollup_hash`: the detection signal. Mismatch = rollup stale. *Attack 4 addressed at detection layer.*
- `rollup_state`: tri-state (`fresh | stale | untracked`) instead of derived binary. Closes the cold-start footgun: an upstream with `rollup_inputs: []` would hash-match trivially (empty-set hash == empty-set hash) and register as `fresh` under a naive binary check — silently green for a node that is literally untracked. `untracked` is rendered as a distinct visual (gray outline, not amber) so the graph surfaces "no upstream tracking configured" as visible blind spots during seeding and dogfood. *Engineering red-team finding; adopted.*
- `rollup_generation`: monotonic counter serves two purposes. (a) Concurrency: two reconcilers writing the same upstream detect conflicts via generation mismatch — second-to-commit sees stale generation, must re-read and retry. (b) Audit: "how many times has this upstream been reconciled?" is a cheap query into graph health. Without it, concurrent reconciles silently last-writer-wins. *Literature red-team's top recommendation (DRed / DatalogMTL incremental-maintenance lineage); adopted.*

**L0 is exempted** from `rollup_hash` mechanics. L0 contracts describe user journeys and product goals; mechanical rollup produces false positives at this level. L0 staleness is user-declared only; the four rollup fields are absent from L0 frontmatter entirely (per open-question resolution — option (a), not null-valued fields).

**Detection runs at every cache rebuild.** The Rust backend already rebuilds SQLite from `.contracts/*.md` on startup and on file-watcher events (Phase 2 DATA-03). Extend that rebuild to: (1) recompute `section_hashes` from current body via the canonical parser, (2) for each upstream, recompute `rollup_hash` from referenced children's current `section_hashes`, (3) compare against stored `rollup_hash`, (4) set `rollup_state = stale` on mismatch, `fresh` on match, or `untracked` if `rollup_inputs: []`, (5) emit the corresponding visual (amber for `stale`, gray for `untracked`) distinct from `code_drift` (red).

This layer is *unconditional*. It works on `git pull`, `sed` edits, edits from another machine, edits from another Claude session — any write to `.contracts/` triggers re-evaluation. **Attack 4 dies here.** **Attack 5 dies here** — reverting source reverts L3's `section_hashes`, which mismatches L2's stored `rollup_hash`, which re-flags L2.

### Layer 2 — Intent journal (the hook's real job)

**New artifact: `.contracts/journal/<session_id>.jsonl`** — one file per Claude Code session, one JSON line per edit, committed to git:

```json
{"schema_version":1,"ts":"2026-04-24T10:14:00Z","session_id":"...","tool":"Edit","file":"mcp-sidecar/src/tools/write_derived_contract.ts","affected_uuids":["11111111-..."],"intent":"add missing-source guard to write_derived_contract"}
```

Per-session files (not one `.propagation_journal`) eliminate the cross-branch merge-ordering hazard: a single append-only file, when two branches each append, produces either a git merge conflict or silent interleaved ordering (depending on `.gitattributes`), and the semantic ordering of events matters for reconcile. With one file per `session_id`, merge is a directory union — no content-level conflict possible. The reconciler reads all files in `.contracts/journal/` and filters by `affected_uuids` + timestamp window. *Engineering red-team correction; the original "append-only, no conflict" claim was glib at git level.*

Each entry carries a `schema_version` so the journal format can evolve without breaking replay of older entries. Rotation and pruning remain Phase 10+ concerns; at demo and dogfood scale the growth rate is negligible.

The `intent` field is extracted by reading the most recent user prompt from the session JSONL at `$CLAUDE_TRANSCRIPT_PATH` (available to the hook via env). Phase 8 already builds this parser for receipts (AGENT-02); this reuses it. Fallback: if no recent user prompt (headless `-p` invocation), use a thin tool_use summary.

**The hook does NOT inject anything into the session.** No rollup prompt; no "do these need updating?" question. Zero LLM cost per edit beyond the user's own task. **Attack 9 reduced to near-zero ongoing cost.**

Committing to git gives cross-machine / cross-PR-reviewer visibility of intent; this is how **Attack 8 dies** — a fresh session reconciling L1 three days later can still read the journal entries for all L3 edits that invalidated L1's `rollup_hash`.

### Layer 3 — Reconciliation (opt-in, user- or session-initiated)

The reconcile panel branches on pin state. **This branching is not optional** — the engineering red team found that the naive reconcile flow routes through `update_contract` / `write_derived_contract`, both of which early-return `SKIPPED-PINNED` for pinned nodes (`write_derived_contract.ts:64-68`, `update_contract.ts:102-111`). The two committed real fixtures are both `human_pinned: true`. Without the branching, clicking "propagate" on our seed fixtures silently no-ops and the node stays stale forever.

**Unpinned path** — a node with `rollup_state: stale` and `human_pinned: false` offers three actions (reusing the Phase 7 DRIFT-02 UI chrome):

1. **Draft propagation for review.** Spawns a Claude Code call. Prompt includes: current upstream body + current cited child contract sections (only the sections in `rollup_inputs`) + the last N journal entries affecting any cited child. Produces a **draft diff** — never auto-applied. The UI force-shows the diff under a heading "AI-drafted; review before accepting" before any commit action is available. User approves, edits, or rejects. On approve: writes the new body via the canonical writer, increments `rollup_generation`, recomputes `rollup_hash` + `section_hashes`, sets `rollup_state: fresh`. *Renamed from "Propagate from children" — literature red team (Jin & Chen 2026, Stengg 2025) shows LLMs systematically fail at spec-compliance classification and code-change impact analysis, which are the exact cognitive operations this button triggers. The UI framing must not overstate what the model is doing.*
2. **Accept as-is.** Updates stored `rollup_hash` to match current children without changing body; increments `rollup_generation`; sets `rollup_state: fresh`. **For L1, requires a one-line justification** persisted to the journal as a `kind: accept-as-is` entry. L2/L3 accepts are frictionless. This prevents click-through desync while keeping the common case fast.
3. **Edit manually.** Human writes the new body directly; `rollup_hash` updated on save; `rollup_generation` incremented.

**Pinned path** — a node with `human_pinned: true` and `rollup_state: stale` offers a different three actions:

1. **Review children's changes** (no LLM call). Read-only diff view showing exactly which cited child sections changed since this upstream was last reconciled (i.e., since the last `rollup_generation`). The user sees *what drifted* without any AI interpretation. Journal entries for the affected children are shown alongside. No write path from this action.
2. **Unpin and reconcile.** Explicit two-step: user first unpins (via the existing pin-toggle affordance), then the unpinned-path three-action panel opens. Two clicks, not one — the pin should not be silently discarded.
3. **Accept as-is, keep pin.** Requires the one-line justification (same as unpinned L1 friction). Updates `rollup_hash` + `rollup_generation`, sets `rollup_state: fresh`, leaves `human_pinned: true` and the body untouched.

The pinned path never writes through `update_contract` / `write_derived_contract` unless the user has explicitly unpinned first. SKIPPED-PINNED becomes unreachable in the reconcile flow — the branching fires before either writer is called.

**Accept as-is writes only the rollup fields.** A narrow Rust IPC `accept_rollup_as_is(uuid, justification?)` updates `rollup_hash`, `rollup_generation`, `rollup_state` in-place without touching the body or round-tripping the YAML through a full `ContractFrontmatter` serialize. Bypasses the `contract_hash` perturbation the engineering red team flagged (YAML round-trip is not byte-preserving across libraries).

Sessions can trigger reconciliation inline via a new MCP tool `propose_rollup_reconciliation(upstream_uuid)` — same machinery, invoked from the session. This preserves the owner's "session has context" advantage as an **opt-in shortcut**, not the critical path. The tool respects the same pinned-path branching (returns a read-only diff for pinned upstreams; the session must surface the block to the user, not route around it).

LLM cost is proportional to reconciliations, not edits. **Attack 6 addressed via batching**: 12 flagged upstream nodes reconcile in one user-driven batch with full journal context. **Attack 7 addressed**: pure-implementation refactors don't touch `section_hashes`, don't flip `rollup_hash`, don't flag anything. **Attack 2 addressed**: the agent *drafts*; the user approves after force-viewing the diff. Auto-commit is not an option in this layer.

### Layer 4 — Query-time staleness annotation

`get_contract` and `find_by_intent` MCP tools annotate their responses:

```
[This L1 contract is rollup-stale since 2 dependent children changed
 (L3 checkout_api, L3 cart_store). Propose reconciliation or accept
 as-is before treating this as authoritative.]
```

The downstream agent reading L1 knows it's drinking from a potentially-stale well. Can choose to reconcile first, or proceed with eyes open. **Attack 2** gets a second backstop; **Attack 8** is further neutered — staleness context lives on the graph itself, not just in session memory.

### Conflict resolution for concurrent sessions (attack #3)

The Phase 7 per-node Tokio mutex serializes writes at the node level. For rollup (cross-node), the resolution is weaker but sufficient for v1 single-user local-first:

- Two sessions write to distinct per-session journal files (`.contracts/journal/<session_id>.jsonl`) — directory-union merge, no content-level conflict possible.
- Two sessions proposing reconciliation on the same upstream: each reads the current `rollup_generation` at reconcile-panel open time. On commit, the canonical writer rejects the write if the on-disk generation has advanced since read — second-to-commit must refresh and retry. `rollup_generation` is the conflict-detection primitive; it eliminates silent last-writer-wins for cross-node reconciles. *Literature red-team's top recommendation.*
- Git catches cross-machine conflicts on the sidecar body as merge conflicts on the sidecar file, which is the right outcome — generation conflicts manifest as YAML field conflicts, not as silent semantic drift.
- Multi-user concurrency (different developers, different machines, simultaneous edits to the same upstream) is out of scope for v1. Flag for v2 under COLL-01.

### Degradation when the hook didn't fire (attack #4)

**Detection is unconditional.** Cache rebuild recomputes rollup hashes regardless of edit origin. For non-session edits, the journal loses intent context — reconciliation after `git pull` operates without the edit's "why" — but *staleness is still detected and surfaced*. The graph stops lying. This is the key property the owner's proposal doesn't have.

---

## Open Questions

**Q1. ~~Canonical section parser — Rust or TypeScript or both?~~ [RESOLVED]** Canonical parser lives in Rust only; MCP sidecar calls via IPC. Eliminates parser-divergence as a failure class. See Layer 1.

**Q2. Journal volume at dogfood scale.** Per-session files make merge-conflicts a non-issue, but a year of active use produces hundreds of journal files. At what point does reconciler scan cost matter? Suggest: profile at the end of Phase 8; add indexing to SQLite if scan cost >100ms. No action needed for demo.

**Q3. L0 schema shape.** "L0 is exempt" means schema omits `rollup_*` fields on L0 entirely (option (a), not null-valued fields). Dogfood code must branch on `level == "L0"` at rollup-check sites — that's the cost; it's small and explicit beats implicit. Confirmed.

**Q4. Reconciliation updates `rollup_inputs`.** During reconciliation, if the reconciler cites new children, it updates `rollup_inputs` in the commit. Without this, the dependency graph ossifies at seed state. Canonical reconcile-commit writes: `rollup_inputs`, `rollup_hash`, `rollup_generation`, `rollup_state: fresh`, and (for propagate/edit actions) the body + `section_hashes` + `contract_hash`.

**Q5. Three visual states on the graph — red / amber / gray.** Phase 7 plans red for code drift; this doc adds amber for `rollup_state: stale` and gray for `rollup_state: untracked`. Three signals the user must distinguish at a glance. Mitigation: reserve each color for one condition; if multiple apply on the same node, red (code drift) takes precedence, then amber (rollup stale), then gray (untracked). Confirm visual design in Phase 7.

**Q6. Cold-start seeding ownership of `rollup_inputs`.** Whichever process seeds the graph (the out-of-scope "seed skill" per the brief) must populate `rollup_inputs` on every L1/L2/L3 it creates. A seed that produces `rollup_inputs: []` on every node leaves the entire graph `untracked`, which is *visible* (gray graph) but also unusable. Flag this as a seed-skill contract when that work starts.

---

## Phase Impact

### Phase 2 (Contract Data Layer) — retroactive schema additions

- Five new fields added to `ContractFrontmatter` in `contract-ide/src-tauri/src/sidecar/frontmatter.rs`: `section_hashes`, `rollup_inputs`, `rollup_hash`, `rollup_state`, `rollup_generation`. L0 omits the four `rollup_*` fields entirely.
- New module `src-tauri/src/sidecar/section_parser.rs` — the canonical section parser (fenced-code-aware, order-stable, rejects duplicate headings). Tested against a fixture corpus that includes both `11111111-…` and `22222222-…` to pin down section-order variance.
- Numbered migration in `tauri-plugin-sql` migrations (bumps sidecar `format_version` to 3). Migration is *lazy*: existing v2 contracts are upgraded on first write, not en masse on launch. This avoids a bootstrap write storm against a large seeded repo. On first read of a v2 contract, the parser computes `section_hashes` in memory and serves them through SQLite without persisting until the next genuine write.
- Two existing real contracts migrate by: compute `section_hashes` from current body, set `rollup_inputs: []`, `rollup_state: untracked`, `rollup_generation: 0`, omit `rollup_hash`. Both are leaves without upstream dependencies. The `untracked` state is the *correct* signal for current repo state — no L0/L1/L2 ancestors exist yet to track them against.
- **Affects REQUIREMENTS: DATA-01.**

### Phase 5 (MCP Server Sidecar) — IPC for canonical parser

- MCP sidecar grows a small IPC client for the Rust section parser. `write_derived_contract` and `update_contract` call Rust to compute `section_hashes` rather than parsing the body locally. One extra IPC round-trip per write is the cost; correctness is the benefit.
- **No REQUIREMENTS impact**; internal implementation change to MCP-01 / MCP-03 call graphs.

### Phase 6 (Derivation) — writer update

- `write_derived_contract` computes and persists `section_hashes` (via Phase 5 IPC) on every call. For reconcile-initiated writes, also updates `rollup_*` fields.
- No impact on DERIVE-01/02/03 success criteria; guard semantics (pinned, empty-body) are unchanged.

### Phase 7 (Drift Detection — Watcher Path) — no retroactive changes

Phase 7 is **shipped and verified** (DRIFT-01 + DRIFT-02; `07-VERIFICATION.md` 2026-04-23). Code drift red-pulse, per-UUID Tokio mutex (`DriftLocks`), SourceWatcher via `notify`, and the three-button `ReconcilePanel` are all in production. **The rollup additions below do not require revising any Phase 7 plan or code path** — they extend shipped Phase 7 machinery from inside Phase 8.

What Phase 8 reuses from Phase 7:
- `DriftLocks` per-UUID Tokio mutex → serialises rollup writes alongside code-drift writes, no new lock type needed.
- `SourceWatcher` (notify backend) → rollup detection hooks into the same watcher callbacks; no new watcher.
- `ReconcilePanel` Dialog shell → amber/rollup branch is a sibling render, not a rewrite.
- `driftedUuids` store pattern → rollup adds two parallel Sets (`rollupStaleUuids`, `untrackedUuids`) following the same pattern.
- `acknowledge_drift` Tauri command shape → `accept_rollup_as_is` mirrors it.

What Phase 8 adds on top of Phase 7:
- New engine function: `compute_rollup_and_emit` (sibling to `compute_and_emit`).
- New IPC event: `rollup:changed` (sibling to `drift:changed`).
- New CVA variants on the graph node: `rollup_stale` (amber), `rollup_untracked` (gray). Precedence red > amber > gray decided in the CVA selector.
- Extended `ReconcilePanel`: pin-aware branching on amber opens the propagation action set instead of the code-drift action set.

### Phase 8 (Agent Loop + Receipts + PostToolUse Hook + Cherrypick) — largest impact

- **MCP-02 hook scope changes substantively.** Hook appends to `.contracts/journal/<session_id>.jsonl`; it does **not** prompt the session for rollup review. Hook shrinks, not grows.
- **New MCP tool** `propose_rollup_reconciliation(upstream_uuid)` — respects pinned-path branching (returns read-only diff for pinned upstreams). Ships in Phase 8.
- **New narrow Rust IPC** `accept_rollup_as_is(uuid, justification?)` — touches only `rollup_hash`, `rollup_generation`, `rollup_state`; never round-trips the body through YAML serialize. Bypasses the `contract_hash` perturbation risk.
- **Reconcile panel UI** extends with pin-aware three-action branching + "Draft propagation for review" labeling + force-shown diff before any commit.
- **Success Criterion 5 rewrite**: "PostToolUse hook fires after Claude Code file writes, **journals edit intent to `.contracts/journal/<session_id>.jsonl`**, re-derives the affected L3/L4 contracts via `update_contract`, and updates drift state through the same per-node Tokio Mutex as Phase 7's watcher — hook and watcher coexist without racing." The phrase "re-derives the affected contracts" no longer extends to L0–L2; those are handled by the separate detection layer.
- **Planning notes at ROADMAP lines 136–139** need an addendum about `rollup_*` semantics, pinned-path reconcile branching, and "Draft propagation for review" labeling.
- **Affects REQUIREMENTS: MCP-02, AGENT-01** (prompt assembly for the reconciliation tool).

### Phase 9 (Mass Edit + Non-Coder Mode + Demo Polish) — minor impact

- Mass edit (MASS-01) already plans to upweight `## Invariants` in match ranking (per PACT 2025 in RESEARCH.md). Section-level hashes are a consistent extension of the same per-section semantics.
- Copy Mode (NONC-01) continues to hide technical sections from non-coders. Propagation is strictly developer-facing and never exposed in Copy Mode.

### Newly affected REQUIREMENTS (for traceability)

- DATA-01: frontmatter schema gains 5 fields (`section_hashes`, `rollup_inputs`, `rollup_hash`, `rollup_state`, `rollup_generation`).
- MCP-02: hook role redefined (journaling to per-session file, not prompting).
- AGENT-01: optional `propose_rollup_reconciliation` tool extends the assembly surface.
- DRIFT-01 (implicit): three-state rollup (fresh/stale/untracked) added alongside binary code drift.

### Newly affected SUCCESS_CRITERIA lines

- Phase 7 SC 1: amber `rollup_stale` and gray `rollup_untracked` visuals distinct from red `code_drift`.
- Phase 8 SC 5: hook journals to per-session file, does not prompt rollup review.
- Phase 8 new SC: "Clicking a `rollup_stale` node opens the pin-aware reconcile panel; unpinned path 'Draft propagation for review' produces a force-viewable diff reading cited child sections + relevant journal entries; pinned path offers 'Review children's changes' (read-only), 'Unpin and reconcile' (two-step), and 'Accept as-is, keep pin' (with justification) — SKIPPED-PINNED is unreachable."

---

## Red-Team Iteration 1 — Audit Trail

Two adversarial review agents attacked the initial draft (committed to `PROPAGATION_REDTEAM_LITERATURE.md` and `PROPAGATION_REDTEAM_ENGINEERING.md`). Seven revisions adopted into the architecture above; four concerns deferred to v2.

### Adopted (7)

1. **`rollup_state` tri-state** (`fresh | stale | untracked`). Addresses engineering red team's cold-start footgun: empty `rollup_inputs` hash-matches trivially and registers as fresh under a naive binary check. `untracked` surfaces seed blind spots as gray visual state.

2. **Pin-aware reconcile panel with three-action branching.** Addresses engineering red team's demo-blocker finding: the two committed real fixtures are both `human_pinned: true`; naive reconcile routes through `update_contract` / `write_derived_contract`, both of which early-return `SKIPPED-PINNED`, leaving the node stale forever. Pinned path now offers read-only "Review children's changes", two-step "Unpin and reconcile", and "Accept as-is, keep pin" with justification.

3. **Canonical section parser in Rust only.** Addresses the parser-divergence hazard raised by both teams. The two committed fixtures already disagree on section order (`## Examples` mid-body in UI L4, late in API L3); any parallel Rust + TypeScript implementations risk hash mismatches on valid contracts. Closes Q1.

4. **Per-session journal files** (`.contracts/journal/<session_id>.jsonl`). Corrects the initial draft's "append-only, no conflict" claim — true at POSIX level, false at git level when two branches both append. Per-session files reduce merge to directory union.

5. **`rollup_generation: u64` monotonic counter.** Literature red team's top recommendation (DRed / DatalogMTL incremental-maintenance lineage). Serves as concurrency primitive (second-to-commit detects generation advance, must retry) and audit trail.

6. **"Draft propagation for review"** (renamed from "Propagate from children") with force-shown diff before commit. Addresses literature red team's finding that Jin & Chen 2026 and Stengg 2025 show LLMs systematically fail at spec-compliance classification and code-change impact analysis — the exact operations this button triggers. UI framing must not overstate model confidence.

7. **Fixture migration plan made explicit.** Both committed fixtures get `section_hashes`, `rollup_inputs: []`, `rollup_state: untracked`, `rollup_generation: 0` — gray visual correctly reflects "no ancestors exist yet to track against" rather than silently green. Lazy migration (on-first-write, not bulk) avoids bootstrap write storm.

### Deferred to v2 (4)

- **Fan-in threshold amber-storm suppression** (literature rec). UX polish; a repo-level banner when >N upstreams flip stale in a single event. Nice-to-have, not load-bearing for demo.
- **Semantic / embedding-based rollup_hash** (literature rec). Addresses "byte-hash doesn't capture semantic staleness" — a real point, but research territory. Byte-hash is a defensible first cut; semantic is v2.
- **Multi-session sycophancy anti-patterns** (literature rec). Instrumentation-heavy; journal-reading reconciles bias toward confirmation rather than contestation. Mitigated partially by force-shown diff + explicit "Draft" framing; full anti-pattern work is v2.
- **Phase 7 2s SLA under 500-file `git pull`** (engineering rec). Real concern, edge case past hackathon scale. Pin to "healthy at 100 contracts" for demo; re-profile when dogfood scale grows.

### Residual risks (acknowledged, not fixed)

- **LLM overconfidence in the reconcile draft path is a soft risk.** Force-shown diff + "Draft propagation for review" framing are UI-layer mitigations; the underlying LLM remains fallible at impact analysis. Accepted because the alternative (no-LLM reconcile) forfeits the session-context advantage that motivated this architecture. The mitigation is human-in-the-loop, not model improvement.
- **Journal replay correctness across git rebase is best-effort.** If a developer rebases away a session's edits, the journal still references UUIDs that may have changed state. Reconciler filters entries whose `affected_uuids` still exist and whose timestamps fall after the last reconcile — corruption is contained to noise, not false propagation.

---

*Document ends. Iteration 1 red team complete; 7 revisions adopted. Further iterations should attack the adopted revisions themselves (particularly pin-path branching and generation-counter semantics) — those are the surfaces where the architecture is now most load-bearing.*
