# PROPAGATION.md — Engineering Red-Team

**Reviewer:** Claude (engineering-mechanics adversarial pass)
**Date:** 2026-04-24
**Scope:** Concrete implementation mechanics. Assumes the architectural direction (detection / reconciliation / journal separation) is the right frame — attacks only the engineering contract that would ship it.

---

## 1. Verdict

The layered architecture is structurally sound and correctly diagnoses the owner's original mistake, but the engineering spec is **not implementable as written without four concrete fixes**. The two load-bearing ones are (a) section-hash parsing semantics — completely unspecified against a real fixture corpus that already violates its own canonical ordering, and (b) a pinned-vs-stale interaction in the reconcile flow that will produce a silent no-op in the *exact* configuration of the two committed dogfood fixtures (both `human_pinned: true`). Detection at cache-rebuild time is cheap and defensible, the journal-as-file design survives APFS concurrency once it stops promising more than append, and the L0 exemption is clean. But the "`section_hashes` power the rollup" sentence is doing a lot of work no parser currently does, the single-writer invariant (MCP-03) as currently enforced by bun:sqlite `readonly: true` is compatible with the new journal *only* if the journal is a file not a DB table (doc is ambiguous), and there are two explicit footguns (cold-start seeding with empty `rollup_inputs`, pinned-L1 reconcile) that will demo as "nothing happens" rather than "clear error." The architecture survives; the specification, as drafted, does not.

---

## 2. Specific Failures Found

### 2.1 Section parsing is completely unspecified, and the two real fixtures already violate the prompt's own canonical ordering

PROPAGATION.md §Layer 1 treats `section_hashes` as a pure text operation — "hash pure text operation over delimited sections" — with zero actual delimiter grammar. The v2 prompt at `/Users/yang/lahacks/contract-ide/mcp-sidecar/src/tools/prompt-v2.ts:30-116` defines a REQUIRED section list (`Intent → Role → Inputs → Outputs → Invariants → Examples`) and then an OPTIONAL list. The order matters for prompt authoring but the doc never says whether the hash is order-independent or order-dependent. The two committed fixtures disagree:

- `/Users/yang/lahacks/contract-ide/.contracts/11111111-1111-1111-1111-111111111111.md` orders: Intent, Role, Inputs, Outputs, Invariants, **Side Effects, Failure Modes, HTTP, Examples** (line 64). Examples is SIXTH in the required list but appears LAST after three optional sections.
- `/Users/yang/lahacks/contract-ide/.contracts/22222222-2222-2222-2222-222222222222.md` orders: Intent, Role, Inputs, Outputs, Invariants, **Examples**, Interaction, Visual States — canonical ordering.

If the parser hashes by walking `^## ` headings in file order and storing `section_name → content_hash`, both round-trip equivalently. If it concatenates sections in the file's written order and hashes that, the two fixtures will register spurious `rollup_hash` drift on every whitespace-preserving re-serialization. Neither frontmatter.rs (`/Users/yang/lahacks/contract-ide/src-tauri/src/sidecar/frontmatter.rs:44-73`) nor write_derived_contract.ts has any `##`-aware logic today — the existing Rust parser only knows about YAML fences.

Additionally unspecified and a real production issue given prompt-v2.ts's explicit Examples template containing ` ## ` substrings in code fences (the Examples section uses GIVEN/WHEN/THEN keywords but agents will write literal backtick blocks citing APIs): an `##` inside a fenced code block must not start a new section. The existing markdown in `11111111` doesn't hit this (uses inline code, not blocks) but v2 explicitly permits it. A 50-line rewrite of section parsing with `pulldown-cmark` is arguably Phase 7's drift-detection gate, not a forgettable subtask.

**Two concrete observable failures under the as-written spec:**
1. First launch against the current dogfood repo will compute `section_hashes` that include HTTP in 11111111 and Interaction/Visual States in 22222222. If the cross-platform parser between Rust (cache rebuild) and TypeScript (writer) differs by even a trailing-newline convention, the hashes diverge and every contract on disk instantly registers rollup-stale. Phase 2's frontmatter round-trip test (`frontmatter.rs:121`) exists *precisely* because this class of bug existed for the YAML layer; the doc's Q1 acknowledges the problem and punts on it.
2. An LLM re-deriving a contract will legally reorder optional sections (prompt-v2.ts:90 says "skip the heading otherwise" but says nothing about stable ordering of *included* optional headings). File-order hashing produces spurious drift; header-keyed hashing does not. Decision is absent.

### 2.2 The pinned-plus-stale interaction is silently broken for exactly the two fixtures shipped

Both real contracts — the ONLY two that exist in `.contracts/` right now — carry `human_pinned: true`. Both MCP writers return early with SKIPPED-PINNED:
- `write_derived_contract.ts:64-68`
- `update_contract.ts:102-111`

PROPAGATION.md §Layer 3 action 1 ("Propagate from children") "spawns a Claude Code call ... produces a proposed diff; user approves." Implementation-wise, the only write path today that could land that approved body is either `update_contract` or `write_derived_contract`, both of which refuse pinned nodes. The doc says nothing about this. Three distinct failure outcomes depending on how the code turns out:
- *Silent no-op*: UI shows "Reconciled" after the Claude call returns 200, but the body never changes because SKIPPED-PINNED fires invisibly. The `rollup_hash` is then *not* updated either (because the writer returned before reaching the patched frontmatter), so the node remains rollup-stale forever. User clicks again. Loops.
- *Confusing error bubbled to user*: the propagation flow surfaces "SKIPPED-PINNED" as an error string, which reads as "something broke" rather than "your explicit pin is working." Worse since `11111111.md` is specifically the contract describing the writer — so a user reconciling from it would see its own SKIPPED-PINNED phrasing quoted back at them.
- *Architectural loop*: action 2 "Accept as-is" updates `rollup_hash` without touching body, which needs to write frontmatter through a path that honors the pin but still permits the hash field update. Neither existing writer exposes that mode; both re-serialize the whole frontmatter block via a temp-rename atomic write. A third writer is implied and unacknowledged.

The ReconcilePanel UI (`/Users/yang/lahacks/contract-ide/src/components/inspector/ReconcilePanel.tsx:44`) already hits this in its code-drift form — it explicitly warns the user "If it returns SKIPPED-PINNED, stop and report." The propagation flow needs the same warning *or* a mechanism. The doc offers neither.

### 2.3 Single-writer (MCP-03) is violated by the proposed MCP tool and the journal, depending on interpretation

MCP-03 as enforced: `/Users/yang/lahacks/contract-ide/mcp-sidecar/src/db.ts:25` opens `new Database(dbPath, { readonly: true })`. All MCP tools write to `.md` files only; Rust's watcher re-reads and re-populates SQLite. This is a *file-system* invariant, not a database invariant — anyone with filesystem access is a potential writer. The proposed architecture adds two new writers:
- `propose_rollup_reconciliation` (MCP tool) — fine if it writes `.md` via the same temp-rename pattern as `update_contract`, but that's only true for action 3 "Edit manually" and action 1 "Propagate from children." Action 2 "Accept as-is" writes *only frontmatter* (specifically `rollup_hash`). A frontmatter-only writer that doesn't re-serialize body risks diverging from the `contract_hash` invariant at `write_derived_contract.ts:84`, where `contract_hash = sha256Hex(body.trim())` is re-stamped against the body. If Accept-as-is only touches `rollup_hash`, `contract_hash` isn't re-stamped and is fine; but the temp-rename pattern rewrites the whole file including re-serializing YAML through `YAML.stringify` — which is not a bit-preserving operation. Result: Accept-as-is can perturb `contract_hash` on disk even though body was not intentionally modified. Silent code-drift becomes possible on what should be a no-op click.
- `.propagation_journal` — if it's a plain file, it's fine under MCP-03 because MCP-03 governs SQLite, not every possible on-disk artifact. But the doc never commits to "file, not table." If any downstream reader wants to materialize it as a SQLite table for query convenience (likely, given `list_drifted_nodes` is already SQL), that writer path needs to be explicitly Rust, not MCP. The doc says "hook appends to journal" but the hook runs in Claude Code's environment — is "the hook" writing the file directly, or calling an MCP tool, or calling the Rust backend? Phase 8 SC 5 says the hook "re-derives … via `update_contract` against the MCP server," so the precedent is MCP-side. The doc needs to say this explicitly.

### 2.4 Journal growth at dogfood scale is not bounded

`/Users/yang/lahacks/contract-ide/.contracts/` currently has exactly 2 files. The stress-test directory referenced in the planning docs doesn't exist yet. But Q2 in the doc acknowledges the real range: "20 lines per hour of active dev." The v2 form of each journal entry from the doc example is ~160 bytes after field inflation (session_id is a UUID, intent is a sentence, affected_uuids is an array, timestamp is ISO-8601). A 4-hour dogfood session appends 80 lines × 160 bytes ≈ 13KB. Not huge. But Phase 9 "vercel/commerce" seeding will dogfood Claude sessions against a 25-node graph for hours per demo rehearsal — and the journal is committed to git per the doc's explicit choice. Three problems:

- Every developer's reproducible rehearsal bloats the git history (no pruning described).
- PR diffs show journal noise even for unrelated changes (pattern: code change in `src/`, contract change in `.contracts/XXX.md`, and 40 unrelated journal appends from the session). Reviewer signal-to-noise collapses.
- Merge-conflict resolution on `.propagation_journal` requires the reviewer to manually concat two timelines, which git can do textually but cannot do semantically (event-ordering is now ambiguous across the merge).

The doc's assertion at §"Conflict resolution" that "Two sessions can append to `.propagation_journal` in parallel — append-only, no conflict" is true at the POSIX level (`O_APPEND` writes under PIPE_BUF are atomic), but *false* at the git level the instant two branches append concurrently. Git's default three-way merge on an append-only file will interleave commits in an order neither session actually observed; for a journal that is load-bearing as intent-capture, that's semantic drift. The doc treats this as solved; it isn't.

### 2.5 Cold-start seeding produces a silent-pass graph

§Q4 acknowledges this obliquely: "The field must exist on every upstream for the hash comparison to run. Cold-start seeding (out of scope per brief) must establish it." But §Layer 1 also says `rollup_hash` mismatch = stale. If seeding leaves `rollup_inputs: []` on an L2 (because the seed skill didn't know what children to cite), then `rollup_hash` computes over the empty set (some canonical digest of zero bytes, or missing-field-so-no-check). Either way: the L2 registers as *not stale* regardless of what its children do. The graph shows green; nothing is tracked.

This is the exact footgun the doc itself calls out as the owner's original sin (attack #4 from PROPAGATION.md: "graph reports health while actively lying"), except now re-introduced at the seeding layer. A user debugging "why isn't reconcile firing?" has two indistinguishable causes: (a) `rollup_hash` matches because children haven't changed, (b) `rollup_inputs` is empty so nothing is being watched. No diagnostic in the architecture distinguishes them.

### 2.6 Phase 7 SLA (2 seconds) versus cross-contract rebuild complexity

Phase 7 SC 1 in `/Users/yang/lahacks/.planning/ROADMAP.md:116` specifies a 2-second window for the red pulse after a source edit. The current watcher path (`/Users/yang/lahacks/contract-ide/src-tauri/src/drift/engine.rs:41-159`) is per-UUID, parallel, bounded work. Adding rollup computation means: on every sidecar change, for *every upstream* whose `rollup_inputs` references the changed child, recompute `rollup_hash` by concatenating `section_hashes` from each listed child. This is a pointer-chase through SQLite, not a graph traversal, so the complexity is O(upstream_fanout × avg_rollup_input_size) per affected child. For a 25-node demo graph with an L2 citing 5 children, that's < 50 SQL queries on a hot cache — fine.

Not fine: a `git pull` event flips 500 contract files in a burst. The `notify` watcher (`/Users/yang/lahacks/contract-ide/src-tauri/src/drift/watcher.rs:86-113`) fires `spawn_per_uuid` for each file event with no debouncing, and each spawned task acquires the per-UUID mutex. Rollup amplifies: each changed leaf triggers recompute of every upstream citing it, and the spawned tasks serialize only on their own UUID — not on the upstream UUID. Two independent leaf edits both citing the same L2 each spawn their own compute-and-emit against L2, which now *does* serialize because `DriftLocks::for_uuid(l2_uuid)` returns the same Arc<Mutex>. The mutex is now a global bottleneck for any heavily-cited upstream, and `git pull` serializes a fat-fan-in node behind a queue of N updates. At 25 nodes this is unobservable; at the 500-node `vercel/commerce` scale the doc references for Phase 9, a pull-in-an-unrelated-branch event can take multiple seconds before a single pulse stabilizes. Phase 7's 2-second SLA then quietly breaks and nothing catches it because the watcher technically returned within 2s *for the leaf* while the fat-fan-in upstream is still catching up.

### 2.7 Format_version migration is a bootstrap write storm

The doc says "bumps sidecar `format_version` to 3" and "migrate by: compute `section_hashes` from current body, set `rollup_inputs: []`." `format_version: u32` is the first field in `ContractFrontmatter` (`frontmatter.rs:21`) but is otherwise unused by the parser — it's a hinge, not a validator. Parallel implementations in Rust and TypeScript (Q1) mean the first launch after merge against a large repo triggers: Rust startup scanner reads N files with `format_version: 2`, ...then what? If the answer is "recompute at first read and write back," it's a bootstrap write storm that fires the fs watcher for every contract at once, which cascades through `refresh_source_watcher_from_db` (`/Users/yang/lahacks/contract-ide/src-tauri/src/commands/drift.rs:35`) and drift recompute. If the answer is "migrate lazily on next MCP writer touch," then `format_version: 2` and `format_version: 3` contracts coexist indefinitely and `rollup_hash` comparison has to handle absent-field-means-unknown semantics everywhere.

The doc specifies neither. Phase 2 migrations are numbered SQL files (`/Users/yang/lahacks/contract-ide/src-tauri/src/db/migrations.rs`, the DATA-06 pattern). The analogous frontmatter migration is file-level and has no established pattern in the codebase.

---

## 3. Severity Ranking

### v1 demo blockers (must-fix before Phase 8 ships)

1. **Section-hash parser spec (§2.1)** — without a defined section grammar, `section_hashes` are not reproducible across Rust/TS implementations, and the two demo fixtures will register spurious drift on first launch. Ship spec: "hash per-section body by `^## <name>$` heading, ignoring heading lines inside fenced code blocks; store as `Record<section_name, sha256>` keyed by name, not position."
2. **Pinned-plus-stale interaction (§2.2)** — both shipped fixtures are `human_pinned: true`. The reconcile flow on a pinned node will silently no-op or confusingly error. Pick one: (a) pinned nodes never register rollup-stale (cleanest), or (b) reconcile panel adds a fourth action "Unpin and reconcile" that explicitly breaks the pin.
3. **Cold-start seeding diagnostic (§2.5)** — `rollup_inputs: []` must visually register as "not tracked" (gray, not green) so the user can distinguish "healthy" from "untracked." Otherwise the first demo where reconcile should fire won't, and the investigation path is silent.

### Papercuts (demo survives, cleanup post-demo)

4. **Journal growth / merge-conflict (§2.4)** — at 25-node dogfood + single-user scale, the journal stays under 100KB and merge conflicts are rare. Fine for demo. Post-demo, either git-ignore the journal and land a Phase 10 cross-machine-sync story, or add an LSN/epoch field to the entries to make merge ordering reconstructible.
5. **Phase 7 SLA under git pull (§2.6)** — at demo scale this is unobservable. Post-demo, add a debounce window + batch recompute for upstreams.
6. **Format_version migration (§2.7)** — at demo scale one manual pass over `.contracts/` plus the two dogfood files works. Post-demo, formalize the migration protocol before a real repo onboards.

### Landmines (post-demo follow-up, will bite if ignored)

7. **MCP-03 interpretation drift (§2.3)** — the doc doesn't commit to "journal is a file, journal-writer is MCP." Post-demo, if anyone wants to materialize the journal into SQLite for faster query, the single-writer invariant gets violated invisibly. Document this commitment explicitly now.
8. **Accept-as-is YAML re-serialization (§2.3 sub)** — `YAML.stringify` is not bit-preserving. An Accept-as-is click perturbs `contract_hash` even though body didn't change intentionally. Fix by computing `contract_hash` against `body.trim()` (same invariant as `write_derived_contract.ts:84`) rather than trusting the round-tripped file bytes.

---

## 4. Recommended Schema / Implementation Changes

1. **Commit to header-keyed, fenced-code-aware section parsing.** Write it into the schema section explicitly: `section_hashes: Record<string, sha256>`, keyed by normalized heading text (`"Intent"`, `"Invariants"`, case-sensitive per prompt-v2.ts), skipping any `##` inside `` ``` `` fences. Hash is over section body only (exclude the heading line, exclude leading/trailing whitespace, normalize CRLF to LF). Parallel Rust + TS implementations with a shared corpus test including the two current fixtures as reference artifacts.

2. **Add `rollup_schema_version` at the `rollup_inputs` level.** Distinct from `format_version`. This lets you evolve the rollup dependency grammar (e.g., "add cited sections ranges within a section") without a full format_version bump. Without it, any future change to how `rollup_inputs` is expressed requires a schema migration pass over every contract.

3. **Introduce a tri-state for rollup: `fresh | stale | untracked`.** `untracked` is the explicit state when `rollup_inputs` is empty or absent. Visual treatment: gray, not green, not amber. This closes §2.5 and gives the user a debuggable distinction between "I set it up and it's working" and "I never set this up."

4. **Exempt `human_pinned: true` from rollup staleness, OR add a distinct UI action to reconcile-by-unpinning.** Recommend the former for v1: pinned means "this is the human's ground truth and rollup math is irrelevant." Drop the stale flag on a pinned upstream. This eliminates the silent-no-op class entirely and matches the semantic of the word "pinned."

5. **Split "Accept as-is" from the body-rewriting writers.** Create a fourth narrow writer `update_rollup_hash_only(uuid, new_hash)` that touches exactly one frontmatter field and never re-serializes body. Ensures `contract_hash` isn't perturbed by YAML round-trip on a no-body-change operation. Can live in Rust as an IPC (since Accept-as-is is initiated from the reconcile panel UI, the round trip is frontend → Rust, not through MCP at all).

6. **Commit the journal to a per-session rotation, not a monolithic file.** `.contracts/.propagation_journal/YYYY-MM-DD-<session_id>.jsonl`. Append-within-file stays atomic per POSIX; per-file isolation makes git merges trivially conflict-free (two sessions = two new files); replay is still one glob-and-sort. Removes §2.4's merge-conflict class.

7. **Define the migration pattern explicitly.** Two-phase: (a) Rust scanner on first launch after format_version bump reads v2 files, computes `section_hashes`, writes them back *without* triggering the watcher (direct-write mode distinguished from user-write mode); (b) first-launch mode banner in the UI: "Upgraded N contracts to format_version 3." This contains the bootstrap write storm and makes the migration legible.

8. **Pin the SLA to a specific graph size.** Phase 7 SC 1's "within 2 seconds" is implicitly 25-node. Annotate it: "within 2 seconds at < 100 nodes; within 5 seconds at < 500." This makes §2.6 a specified performance cliff rather than a broken SLA.

Word count: ~1490.
