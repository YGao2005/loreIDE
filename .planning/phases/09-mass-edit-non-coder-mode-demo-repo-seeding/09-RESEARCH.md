# Phase 9: Mass Edit + Non-Coder Mode + Demo Repo Seeding — Research

**Researched:** 2026-04-24
**Domain:** Hybrid FTS5+embedding retrieval · Non-coder inspector surface · Next.js repo provisioning · SQLite reset fixtures · Bare-Claude baseline recording · Source-session script authoring
**Confidence:** HIGH on all phase-8 seam points (verified against code) · HIGH on FTS5 and repo provisioning patterns · MEDIUM on embedding strategy (no embedding pipeline exists; options evaluated for offline-demo fitness)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MASS-01 | Hybrid FTS5 + embedding similarity match; keyword-only fallback; matched nodes pulse amber staggered 50ms; section-weighted ranking (Invariants/Examples over Notes) | FTS5 `nodes_fts` virtual table is live; section_hashes from Phase 8 PROP-01 enable section-weighted re-ranking; embedding plan below; amber CVA variant from Phase 8 PROP-02 reused for mass-match pulse |
| MASS-02 | Per-node patches queued in single review queue; user approves all at once or selectively; skipped-pinned count visible; upstream-impact count visible | Review queue is a new React component; `update_contract` MCP tool per matched node; pinned-node guard already returns `SKIPPED-PINNED`; rollup_stale emission from Phase 8 PROP-02 tracks upstream cascades |
| NONC-01 | "Copy Mode" pill in left sidebar (separate from lens switcher) filters graph to L4 atoms; selecting an atom opens simplified inspector with no code tab, Given/When/Then editable surface | Sidebar.tsx has disabled pill stub with `data-copy-mode-pill`; `NONC-01` in REQUIREMENTS.md; `## Examples` section is primary editable surface per RESEARCH.md/PACT-2025 |
| DEMO-01 | `contract-ide-demo` repo: Next.js + Auth + Prisma + Stripe + Mailchimp; DangerActionButton; Account Settings + Team Settings scaffolds; 20 ambient L1-L4 contracts + delete-account scenario contracts | `demo-repo/vercel-commerce` exists but is vanilla vercel/commerce with no Auth/Prisma/Stripe/Mailchimp — needs full fork and add-on; exact spec from scenario-criteria.md |
| DEMO-02 | Reset fixture: 5 substrate rules + parent constraint + priority-shift record; reset = git checkout + SQLite swap; reproducible 5x | SQLite snapshot in committed seeds directory; `reset-demo.sh` script; substrate_nodes table (Phase 11's table — Phase 9 must pre-seed it directly) |
| DEMO-03 | Bare-Claude baselines recorded under reproducible conditions (same model, same commit, no MCP, no CLAUDE.md) before substrate seeding; token + tool-call deltas favorable | Bash/Node script wrapping `claude -p` with token counting; committed to `.planning/demo/baselines/` |
</phase_requirements>

---

## Summary

Phase 9 completes the v1 contract-substrate IDE capabilities (mass semantic edit + non-coder Copy Mode) and provisions the demo environment for the four-beat live presentation. It is the last "capabilities" phase before the substrate stack (Phases 10–13) lands on top.

Phase 9 has two distinct workloads that differ sharply in nature. The **capabilities workload** (MASS-01, MASS-02, NONC-01) is UI/retrieval engineering on top of Phase 8's shipped primitives — FTS5 already exists, the amber CVA variant will exist (PROP-02), the section parser will exist (PROP-01), and the `Sidebar.tsx` already has the Copy Mode pill stub waiting to be wired. The **demo provisioning workload** (DEMO-01, DEMO-02, DEMO-03) is infrastructure — building a custom Next.js repo, hand-authoring seed contracts, recording baseline runs, writing a source-session script, and locking a SQLite snapshot.

Critical seam with Phase 8: **Phase 9 depends on Phase 8 being done first.** Section hashes (PROP-01), the amber rollup-stale CVA variant (PROP-02), `update_contract` with section awareness (PROP-01 extension), and the `rollup_stale` emission on writes (PROP-02) are all Phase 8 deliverables that Phase 9 directly reuses. Do not start Phase 9 plans until Phase 8 is committed.

Critical seam with Phase 11: **The `Delegate to agent` button is Phase 11's deliverable, not Phase 9's.** Phase 9 builds the Copy Mode inspector surface (the Given/When/Then editable area, the simplified view) and leaves a `onDelegate` callback stub that Phase 11 will fill. Phase 9 ships the seam; Phase 11 fills it.

**Primary recommendation:** Split Phase 9 into six plans: (09-01) mass-edit retrieval backend (FTS5 section-weighted + embedding fallback), (09-02) mass-edit review queue UI (staggered amber pulse + approval queue + skipped/upstream counts), (09-03) Copy Mode pill wiring + simplified inspector surface, (09-04) `contract-ide-demo` repo provisioning + contract seeding, (09-05) reset fixture + bare-Claude baselines, (09-06) source-session script + UAT rehearsal.

---

## Goal and Seam-In / Seam-Out

### Seam In (what Phase 8 delivers that Phase 9 consumes)

| Phase 8 Deliverable | Phase 9 Consumer | Plan | Confidence |
|---|---|---|---|
| `section_parser.rs` canonical Rust parser (PROP-01) | Mass-edit section-weighted ranking reuses parser output (`section_hashes`) to up-weight FTS matches in `## Invariants` / `## Examples` sections | 09-01 | HIGH — plan 08-01 specifies it |
| `section_hashes` field on every node frontmatter (PROP-01) | Mass-edit match ranker reads `section_hashes` to determine which matched text lives in load-bearing sections | 09-01 | HIGH |
| `rollup_stale` amber CVA variant on graph nodes (PROP-02) | Mass-edit staggered amber pulse reuses this variant; a separate `mass_matched` variant may be added or the same amber is used with a distinct CSS animation | 09-02 | HIGH |
| `update_contract` MCP tool (shipped Phase 5, pinned-node guard added 2026-04-24 commit e232191) | Mass-edit review queue dispatches `update_contract` per approved matched node | 09-02 | HIGH — code confirmed in `update_contract.ts` |
| `rollup_stale` emission after writes (PROP-02) | Review queue post-write upstream-impact count reads how many L1/L2/L3 nodes flipped to `rollup_state: stale` | 09-02 | HIGH |
| `format_version: 3` migration (PROP-01) | Demo seed contracts must be written in `format_version: 3` with `section_hashes` populated | 09-04 | HIGH |
| Per-session journal (PROP-03) | Source-session script produces JSONL that reads like a real Phase 8 journal; Phase 10 distiller will ingest it | 09-06 | HIGH |

### Seam Out (what Phase 9 delivers that downstream phases consume)

| Phase 9 Deliverable | Downstream Consumer | Phase |
|---|---|---|
| Copy Mode simplified inspector with `onDelegate` stub | `Delegate to agent` button wired by Phase 11; stub must accept `(contractBody: string, nodeUuid: string) => void` | 11 |
| `contract-ide-demo` repo locked at a commit SHA | Phase 10's session watcher reads from this repo directory; Phase 11's distiller runs against its sessions | 10, 11 |
| Reset fixture (`seeds/substrate.sqlite.seed`) | Phases 10–13 all use this as the canonical demo start state; Phase 13's `reset-demo.sh` runs the swap | 13 |
| Source-session script JSONL | Phase 10's session watcher ingests it; Phase 11's distiller extracts the 5 substrate rules | 10, 11 |
| Bare-Claude baseline receipts | Beat 2 recording; Phase 13 demo rehearsal uses these numbers as the target delta | 13 |

---

## Existing Primitives (Phases 1–8 Deliverables Reused)

### Already Shipped (Phases 1–7, Confirmed in Code)

| Primitive | Location | Phase 9 Use |
|---|---|---|
| FTS5 `nodes_fts` virtual table | `src-tauri/src/db/migrations.rs:101-108` — `USING fts5(uuid UNINDEXED, name, contract_body, tags, content='nodes')` | Mass-edit keyword search; BM25-ranked via `ORDER BY rank` |
| `find_by_intent` MCP tool | `mcp-sidecar/src/tools/find_by_intent.ts` — raw FTS5 MATCH with BM25 rank | Foundation for mass-edit retrieval; section-weighted ranking extends this |
| `update_contract` MCP tool with `SKIPPED-PINNED` guard | `mcp-sidecar/src/tools/update_contract.ts:102-111` | Mass-edit per-node write; guard returns error string that review queue surfaces |
| `Sidebar.tsx` Copy Mode pill stub | `src/components/layout/Sidebar.tsx:35-43` — `data-copy-mode-pill`, `disabled`, tooltip "Phase 9" | Phase 9 enables this pill and wires it to Copy Mode state |
| Lens-switching state | `src/store/graph.ts` — `currentLens`, `setLens()` | Copy Mode is a separate toggle, but same Zustand pattern |
| `shadcn Dialog` | Phase 7 install | Mass-edit review queue modal; Copy Mode simplified inspector both use Dialog |
| `drifted` CVA variant (red pulse) | `src/components/graph/contractNodeStyles.ts` | Mass-edit amber pulse is a new CVA variant alongside `drifted` — same pattern |
| Per-node Tokio Mutex (`DriftLocks`) | `src-tauri/src/drift/state.rs` | Mass-edit writes serialize through same mutex |

### Delivered by Phase 8 (Not Yet Implemented — Dependency)

| Primitive | Expected Location | Phase 9 Use |
|---|---|---|
| `section_parser.rs` | `src-tauri/src/sidecar/section_parser.rs` | Section-weighted ranking for mass-edit |
| `section_hashes` on frontmatter | `src-tauri/src/sidecar/frontmatter.rs` field; migration v3 | Seed contracts must have `section_hashes` populated |
| `rollup_stale` amber CVA variant | `src/components/graph/contractNodeStyles.ts` | Mass-match amber pulse reuses or extends this |
| `rollup_state` SQLite column | Migration v3 in `src-tauri/src/db/migrations.rs` | Mass-edit query reads `rollup_state` to track upstream impact |
| `compute_rollup_and_emit` | `src-tauri/src/drift/engine.rs` | Mass-edit post-write triggers rollup detection for upstream count |
| Per-session journal schema (`schema_version`, `ts`, `session_id`, etc.) | `.contracts/journal/<session-id>.jsonl` | Source-session script must use exact same schema |
| `rollupStaleUuids` Zustand store | `src/store/drift.ts` | Review queue reads this after writes to show upstream-impact count |

---

## Implementation Patterns

### MASS-01: Hybrid Retrieval (FTS5 + Embedding)

#### FTS5 Side (HIGH confidence — code confirmed)

The `nodes_fts` virtual table is live and BM25-ranked. `find_by_intent.ts` already queries it. Mass-edit extends this with a **section-weighted re-ranking** layer:

1. FTS5 MATCH returns ranked results across the full `contract_body`.
2. After FTS, for each matched node, load its `section_hashes` (available after Phase 8 ships `format_version: 3`).
3. Use the canonical section parser (via the `section-parser-cli` binary or a new `get_section_hashes` Rust IPC) to identify which H2 sections contain the matched text.
4. Apply a multiplier: hits in `## Invariants` or `## Examples` → weight x2; hits in `## Notes` → weight x0.5; other sections → x1.0. This is the PACT 2025 signal (per `RESEARCH.md`: "examples outperform descriptions for LLM contract adherence").

Implementation: this re-ranking runs in the MCP sidecar or a new Rust IPC. It is NOT a new SQLite column — it is a post-FTS computation. Keep it simple: get the snippet, parse sections, weight, sort.

**FTS5 query pattern (already working):**
```typescript
// In find_by_intent.ts — reuse for mass-edit match
db.prepare(`
  SELECT n.uuid, n.name, n.level, n.kind,
         snippet(nodes_fts, -1, '**', '**', '...', 20) AS snippet,
         rank
  FROM nodes_fts
  JOIN nodes n ON n.uuid = nodes_fts.uuid
  WHERE nodes_fts MATCH ?
  ORDER BY rank
  LIMIT ?
`).all(query, limit)
```

For mass-edit, remove the `LIMIT` (or set it high, e.g. 100) and let the section-weighted re-ranker sort.

#### Embedding Side (MEDIUM confidence — no existing pipeline)

**Status:** No embedding pipeline exists in the codebase. The SQLite schema has no embedding column. The Cargo.toml has no embedding crate. The MCP sidecar has no embedding library.

**Constraint:** Demo must run offline-capable. The demo machine will be in "airplane mode except Claude" per `runbook-v2.md`. This rules out OpenAI embeddings API at demo time.

**Options evaluated:**

| Option | Offline? | Integration complexity | Demo risk |
|---|---|---|---|
| `sqlite-vec` + local model via `ort` (ONNX Runtime) | YES | High — Rust ONNX binding + model file bundling | High |
| `transformers.js` in MCP sidecar with local model | YES (model cached) | Medium — adds 50MB+ model to sidecar | Medium |
| OpenAI `text-embedding-3-small` via API | NO | Low — one HTTP call | High (offline failure) |
| **Keyword-only fallback with section weighting** | YES | Zero — already exists | LOW |

**Recommendation for Phase 9:** Ship the keyword-only (FTS5 + section weighting) path as primary. Stub the embedding slot with a `EMBEDDING_DISABLED` flag that makes the fallback explicit in the review queue UI ("semantic similarity unavailable — showing keyword matches only"). The roadmap says "keyword-only fallback if embeddings unavailable" as an explicit spec (MASS-01: "with keyword-only fallback"). Honor the spec literally — don't block Phase 9 plans on a full embedding pipeline.

If embeddings are desired before the demo, the lightest path is `transformers.js` in the MCP sidecar using `Xenova/all-MiniLM-L6-v2` (20MB, fully local, runs in Node/Bun). Precompute at derivation time, store as JSON blob in a new SQLite column. Query with cosine similarity at retrieval time. This is a stretch goal for 09-01.

**Decision to make at planning time:** Is the embedding stretch goal in scope? If yes, add `@xenova/transformers` to `mcp-sidecar/package.json` and a `contract_embedding` TEXT column to nodes (migration v4 or extend v3 addendum). If no, ship keyword-only and annotate the UI clearly. The keyword-only path is fully sufficient for demo because the seed contracts are carefully authored to be FTS-findable.

#### Staggered Amber Pulse

Matched nodes must pulse with amber ring staggered 50ms apart (MASS-01 spec verbatim). This is distinct from the Phase 8 `rollup_stale` amber (which is always-on while stale). For mass-match, the amber is a transient animation on the matched set.

Pattern:
```typescript
// In GraphCanvasInner.tsx — extend with massMatchedUuids state
const [massMatchedUuids, setMassMatchedUuids] = useState<Map<string, number>>(() => new Map())
// Map<uuid, animationDelayMs> — filled staggered 50ms apart
// node.state = 'mass_matched' for nodes in the map
// CSS: animate-pulse with animation-delay from the map value
```

New CVA variant in `contractNodeStyles.ts`:
```typescript
// Add to state variant:
mass_matched: 'ring-2 ring-amber-400 animate-pulse [animation-delay:var(--match-delay)]'
```

Node receives `style={{ '--match-delay': `${matchIndex * 50}ms` }}` from the parent.

### MASS-02: Review Queue UI

The review queue is a new modal (shadcn Dialog, same chrome as ReconcilePanel). It shows:

1. **Header:** `{N} nodes matched — {M} pinned, skipped` where M is the count returned by `update_contract` calls that returned `SKIPPED-PINNED`.
2. **Per-node diff rows** (scrollable list): each shows the node name, the proposed body diff (abbreviated), and a checkbox. User can deselect nodes to exclude them from the batch apply.
3. **Upstream impact banner:** `{K} upstream contracts may now be amber — reconcile via graph` where K is counted from `rollupStaleUuids` after the apply. Shown post-apply in a footer banner.
4. **Action bar:** `Approve all` / `Approve selected` / `Cancel`.

Approval dispatches `update_contract` calls sequentially (one per selected node) via the MCP sidecar. On completion: graph refreshes, staggered amber pulses clear, upstream-impact count shows.

**Note on review queue and SKIPPED-PINNED:** The pinned-node guard fires inside `update_contract`. The review queue must catch the `SKIPPED-PINNED` string in the tool response and count it separately. The UI should show `"3 of 12 nodes skipped — pinned"` not just silently drop them.

### NONC-01: Copy Mode Pill + Simplified Inspector

#### Pill Wiring

The `data-copy-mode-pill` stub in `Sidebar.tsx` is disabled today. Phase 9 enables it:

1. Add `copyModeActive: boolean` + `setCopyMode(v: boolean) => void` to `graphStore` or a new `uiStore`.
2. Replace the disabled stub button with a toggling pill that sets `copyModeActive`.
3. When `copyModeActive`, `GraphCanvasInner` filters nodes to `level === 'L4'` only — same as current lens filtering but across all lenses.
4. The pill is visually separate from the lens switcher (which it already is in the existing stub — it's above the lens switcher in the DOM order).

**Exact existing DOM position (confirmed from code):**
```
Sidebar
├── Copy Mode pill (line 35-43) ← Phase 9 enables this
├── Lens switcher (line 45-68) ← unchanged
└── Placeholder tree (line 71-77) ← replaced by real tree in a future phase
```

The pill does NOT live inside or adjacent to the lens switcher widget. It is already separate. Phase 9 just enables it.

#### Simplified Inspector Surface

When Copy Mode is active and an L4 node is selected, the Inspector changes:

1. **Tab bar:** hide the "Code" tab entirely (`visibility: hidden` or conditional render). The "Contract", "Preview", "Receipts" tabs remain but "Code" disappears. This maps to NONC-01: "no code tab visible".
2. **Contract tab content in Copy Mode:** instead of the full Monaco/textarea editor, render a structured form view:
   - `## Intent` section → read-only paragraph (non-coder can see but not edit)
   - `## Role` section → read-only paragraph
   - `## Inputs` / `## Outputs` / `## Invariants` sections → **hidden** (per planning note: "hides Inputs/Outputs/Invariants from non-coders")
   - `## Examples` section → **primary editable surface** — a plain textarea or structured Given/When/Then field with three sub-inputs (Given / When / Then)
3. **Rollup amber/gray pulses hidden** when Copy Mode is active. Non-coder never sees amber/gray graph state.
4. **Entry copy:** above the editable area, display: `"Your edit lands; a teammate reviews upstream impact."` (verbatim from planning notes — this is the mandatory acknowledgment).
5. **`Delegate to agent` button stub:** a disabled button that Phase 11 will wire. Phase 9 places the button at the bottom of the simplified inspector with `onDelegate={undefined}` and shows a tooltip "available in Phase 11". Label: `Delegate to agent`.

**Phase 9 / Phase 11 seam explicitly:**
```typescript
// In SimplifiedInspector.tsx (new component)
interface Props {
  node: ContractNode;
  onDelegate?: (contractBody: string, nodeUuid: string) => void; // Phase 11 fills this
}
// If onDelegate is undefined, the Delegate button is disabled with tooltip
```

Phase 11 imports `SimplifiedInspector` and passes `onDelegate={handleDelegate}`. Phase 9 ships the component shell with `onDelegate` as an optional prop.

**Given/When/Then form:** The `## Examples` section in v2 sectioned markdown uses the Gherkin pattern `GIVEN / WHEN / THEN`. The simplified inspector parses this section using the canonical section parser (or a simpler string split on `GIVEN `) and renders it as three labeled textareas. On save, reconstructs the section text and calls `saveContract` IPC (same path as the existing `ContractTab` autosave).

### DEMO-01: `contract-ide-demo` Repo Provisioning

#### Repo Base (HIGH confidence)

The existing `demo-repo/vercel-commerce` is **vanilla vercel/commerce** — a Next.js App Router e-commerce starter with `@headlessui/react`, `@heroicons/react`, `next`, `react`, `sonner`. It has **no** Auth, Prisma, Stripe, or Mailchimp. It is **not** the right base for the delete-account scenario.

**Required base:** A custom Next.js + shadcn dashboard app. The `scenario-criteria.md` says: "fork a starter, add Auth + Prisma + Stripe + Mailchimp adapters, plant `DangerActionButton` + Account Settings + Team Settings scaffolds."

**Recommended approach:** Scaffold from `create-next-app` with TypeScript + Tailwind + App Router, then `shadcn init`, then add:
- `@prisma/client` + `prisma` — schema with `User`, `Workspace`, `Invoice`, `OrgInvoice` models
- `next-auth` or `lucia` — Auth adapter (any; demo doesn't need to actually authenticate)
- `stripe` npm package — `stripe.customers.update()` import path must resolve
- `@mailchimp/mailchimp_marketing` — `mailchimp.lists.setListMember()` import path must resolve (or the `mailchimp-api-v3` package — whichever resolves `MARKETING_LIST_ID` + `.lists.setListMember`)

**Planted files (exact paths per scenario-criteria.md):**
- `app/account/settings/page.tsx` — scaffold, no Delete Account button (agent adds it in Beat 1)
- `app/team/[slug]/settings/page.tsx` — scaffold, no Delete Workspace button (agent adds it in Beat 4)
- `components/ui/danger-action-button.tsx` — `DangerActionButton` component with `onClick`, `loading`, `confirmation` props
- `lib/account/beginAccountDeletion.ts` — stub (empty or throws "not implemented") — agent fills this in Beat 2

**Prisma schema (exact models required):**
```prisma
model User {
  id               String    @id @default(cuid())
  email            String    @unique
  deletedAt        DateTime?
  stripeCustomerId String?
  invoices         Invoice[]
  workspaces       Workspace[]
}

model Workspace {
  id               String    @id @default(cuid())
  slug             String    @unique
  deletedAt        DateTime?
  stripeCustomerId String?
  orgInvoices      OrgInvoice[]
}

model Invoice {
  id        String  @id @default(cuid())
  userId    String
  userName  String?
  userEmail String?
  user      User    @relation(fields: [userId], references: [id])
}

model OrgInvoice {
  id          String    @id @default(cuid())
  workspaceId String
  orgName     String?
  workspace   Workspace @relation(fields: [workspaceId], references: [id])
}
```

**`MARKETING_LIST_ID` constant:** `lib/marketing/lists.ts` exporting `export const MARKETING_LIST_ID = 'demo-list-id';` and `export const TRANSACTIONAL_LIST_ID = 'demo-transactional-id';`.

#### Contract Seeds (~20 ambient + scenario-specific)

Seed contracts are committed to `contract-ide-demo/.contracts/` as `<uuid>.md` sidecar files in `format_version: 3` (Phase 8's schema). The scenario-specific ones are:

| UUID (deterministic) | Name | Level | Kind | Notes |
|---|---|---|---|---|
| `a0000000-…` | Account Settings | L3 | UI | Parent surface; holds `con-settings-no-modal-interrupts-2025-Q4` in contract body |
| `a1000000-…` | DangerZone | L4 | UI | The delete-account atom; PM edits this in Beat 1 |
| `b0000000-…` | Team Settings | L3 | UI | Parent surface for Beat 4 |
| `b1000000-…` | TeamDangerZone | L4 | UI | The delete-workspace atom |

The ~20 ambient contracts should cover L1 flows (Auth Flow, Account Flow, Billing Flow, Team Admin Flow) and L2/L3/L4 surfaces/components under them for graph density. These are authored manually for Phase 9 — they are not LLM-derived.

**Key constraint on format_version:** Phase 8 ships the migration v3 that adds `section_hashes`, `rollup_inputs`, `rollup_hash`, `rollup_state`, `rollup_generation` columns to SQLite. The seed contracts must include these fields in their frontmatter. Contracts without them will lazy-migrate on first write (Phase 8 design) but will appear as `rollup_untracked` (gray) at startup, which is fine for ambient nodes. The scenario-specific contracts (DangerZone, TeamDangerZone) should have `rollup_inputs` populated linking them to their parent surfaces, so the rollup cascade works during the demo.

#### Demo Repo Git Strategy

The repo should be its own separate git repository (not a subdirectory of `lahacks`). Commit to `github.com/YGao2005/contract-ide-demo` (or similar). Lock to a commit SHA in the demo documentation. The reset script checks out this commit SHA to ensure determinism.

### DEMO-02: Reset Fixture

The reset fixture is a SQLite snapshot (`seeds/substrate.sqlite.seed`) containing:

1. **5 substrate rules** (from `scenario-criteria.md` § 6) — these go into a `substrate_nodes` table that Phase 11 will formally create, but Phase 9 must pre-populate it directly.
2. **Parent surface constraint** — `con-settings-no-modal-interrupts-2025-Q4` linked to Account Settings L3 node.
3. **Priority-shift record** — `reduce-onboarding-friction` (valid Q4-2025) → `compliance-first` (valid 2026-04-24 to present), with a supersession edge.

**Schema concern:** The `substrate_nodes` table is a Phase 11 deliverable. Phase 9 must either (a) create a minimal `substrate_nodes` table schema in the seed SQLite file that Phase 11 will adopt, or (b) encode the 5 rules as SQLite rows in a simpler format that Phase 11 will migrate. Option (a) is safer — write the Phase 11 schema now in the seed file, and Phase 11's migration becomes a no-op if the table already exists.

**Minimal `substrate_nodes` schema for seed:**
```sql
CREATE TABLE IF NOT EXISTS substrate_nodes (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL, -- decision | constraint | open_question | attempt
  text         TEXT NOT NULL,
  applies_when TEXT,
  justification TEXT,
  valid_at     TEXT NOT NULL,
  invalid_at   TEXT,
  session_id   TEXT,
  turn_ref     TEXT,
  actor        TEXT,
  confidence   REAL DEFAULT 1.0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS substrate_edges (
  id         TEXT PRIMARY KEY,
  from_id    TEXT NOT NULL REFERENCES substrate_nodes(id),
  to_id      TEXT NOT NULL REFERENCES substrate_nodes(id),
  edge_type  TEXT NOT NULL -- supersedes | derived_from | related_to
);
```

The 5 substrate rules, the parent-surface constraint, and the priority-shift record are rows in `substrate_nodes` + `substrate_edges`. Phase 11 extends this schema, and Phase 9's rows will remain valid.

**Reset mechanics (per `reset-procedure.md` pattern):**
```bash
# Phase 9's reset additions:
cp seeds/substrate.sqlite.seed $DEMO_SUBSTRATE_PATH
sqlite3 $DEMO_SUBSTRATE_PATH "SELECT type, COUNT(*) FROM substrate_nodes GROUP BY type"
# Expected: decision=2, constraint=3 (the 5 rules) + 1 constraint (no-modal)
# + 1 priority row (encoded as a constraint type "priority_shift")
```

The reset = `git checkout $DEMO_COMMIT_SHA` (for the demo repo) + `cp seeds/substrate.sqlite.seed $path` (for the substrate). Two commands. The `reset-demo.sh` script lives in the `lahacks` planning repo.

**Reproducibility target:** 5x in a row before filming. Log each run (per `reset-procedure.md` rehearsal table).

### DEMO-03: Bare-Claude Baseline Recording

The baseline must be recorded **before** substrate seeding, so context cannot leak. This means:

1. Check out the `contract-ide-demo` repo at its locked commit (no `.contracts/` sidecars except a minimal set that don't contain the 5 rules).
2. Run `claude -p "<prompt>" --no-tools` (or with minimal tools — no MCP) in the repo directory without a `CLAUDE.md` file.
3. Capture the session JSONL to get token counts and tool call counts.
4. Commit the captured receipt to `.planning/demo/baselines/`.

**Prompts to baseline (DEMO-03 spec, verbatim):**
1. `add a delete-account button to the account settings page`
2. `add a delete-workspace button to the team settings page`

**Baseline recording script sketch:**
```bash
#!/bin/bash
# demo/record-baseline.sh
REPO=$1  # path to contract-ide-demo
PROMPT=$2

# No CLAUDE.md, no MCP
cd $REPO
rm -f CLAUDE.md .mcp.json

# Run with session capture
SESSION_DIR=~/.claude/projects/$(pwd | sed 's/\//-/g')
claude -p "$PROMPT" > /tmp/baseline-output.txt 2>&1

# Find the most recent session file
JSONL=$(ls -t $SESSION_DIR/*.jsonl | head -1)
TOKEN_COUNT=$(cat $JSONL | jq '[.message.usage.input_tokens // 0] | add')
TOOL_CALLS=$(cat $JSONL | jq '[select(.type == "tool_use")] | length')

echo "Prompt: $PROMPT"
echo "Input tokens: $TOKEN_COUNT"
echo "Tool calls: $TOOL_CALLS"
echo "Session: $JSONL"
```

The session JSONL path follows `~/.claude/projects/<encoded-cwd>/<sessionid>.jsonl` — same pattern Phase 10's session watcher will use. Phase 10 reads from `~/.claude/projects/<cwd-hash>/*.jsonl` (confirmed from roadmap Phase 10 planning note: "Rust SessionWatcher extends SourceWatcher with glob `~/.claude/projects/<cwd-key>/*.jsonl`").

**Token/tool-call targets (from `presentation-script.md` Beat 2):**
- Bare Claude: `~7,200 tokens · ~22 tool calls · 0/5 rules honored`
- Contract IDE: `~1,400 tokens · ~3 tool calls · 5/5 rules honored`

The baseline captures the ~7,200 / ~22 numbers. The actual Contract IDE run happens in Phase 13 demo rehearsal.

### DEMO-04: Source-Session Script

The source-session script is a pre-written Claude Code conversation (a JSONL file or a narrated session) that, when ingested by Phase 10/11's distiller, produces the 5 substrate rules with the correct `applies_when`, `justification`, and `valid_at` fields.

**Narrative arc (from planning notes — single coherent thread):**
1. **Feb-12:** Customer ticket #4471 arrives — "I clicked Delete on my account and got charged the next month." Team discusses. Decision: soft-delete with grace window + email-link confirmation (`dec-soft-delete-30day-grace-2026-02-18`, `dec-confirm-via-email-link-2026-02-18`).
2. **Feb-19:** Stripe webhook 404s after deletion because the customer record was hard-deleted. Team adds constraint: archive, don't delete (`con-stripe-customer-archive-2026-02-22`).
3. **Mar-3:** IRS audit response reveals cascade-deleted invoices. Legal/finance signs off on anonymize-in-place (`con-anonymize-not-delete-tax-held-2026-03-04`).
4. **Mar-9:** Sales CSV re-subscribed the deleted customer. CAN-SPAM violation. Marketing adds mailing list suppress constraint (`con-mailing-list-suppress-not-delete-2026-03-11`).

**Format:** The script should be a real Claude Code session JSONL (or a synthetic one matching the JSONL format Phase 10 ingests). The Phase 10 session watcher reads `~/.claude/projects/<cwd-key>/*.jsonl`. The source-session script should be committed to `seeds/source-sessions/` in the demo planning directory and placed in the right location before demo.

**Schema of Claude Code JSONL** (required fields for Phase 10 filter pipeline, per Phase 10 planning notes): the `jq` filter the Phase 10 watcher applies extracts `user` and `assistant` message content. The source-session JSONL must contain realistic `{type: "user", message: {...}}` and `{type: "assistant", message: {...}}` entries following the same format the kernel-experiment sessions use (confirmed in `constraint-distillation/README.md`: "Single jq filter reduces session JSONL by 95% (user text + assistant text only)").

---

## Architecture Patterns

### Recommended Project Structure (Net-New Files)

```
contract-ide/
├── src/
│   ├── components/
│   │   ├── mass-edit/
│   │   │   ├── MassEditModal.tsx          # Review queue modal (shadcn Dialog)
│   │   │   ├── MatchedNodeRow.tsx         # Per-node diff row with checkbox
│   │   │   └── MassEditResultBanner.tsx   # Post-apply upstream-impact count
│   │   ├── inspector/
│   │   │   └── SimplifiedInspector.tsx   # Copy Mode inspector surface (new)
│   │   └── layout/
│   │       └── Sidebar.tsx               # EXTEND — enable Copy Mode pill
│   ├── store/
│   │   └── ui.ts                         # NEW — copyModeActive bool + toggle
│   └── ipc/
│       └── mass-edit.ts                  # NEW — findByIntentSectionWeighted IPC
│
├── mcp-sidecar/src/tools/
│   ├── find_by_intent_mass.ts            # NEW — section-weighted version returning full match set
│   └── section_weight.ts                 # NEW — section-weighted re-ranker utility
│
contract-ide-demo/                        # NEW — separate git repo
├── app/
│   ├── account/settings/page.tsx        # Scaffold, no delete button
│   └── team/[slug]/settings/page.tsx   # Scaffold, no delete button
├── components/ui/danger-action-button.tsx
├── lib/account/beginAccountDeletion.ts  # Stub
├── lib/marketing/lists.ts               # MARKETING_LIST_ID constant
├── prisma/schema.prisma                 # User/Workspace/Invoice/OrgInvoice
├── .contracts/                          # 20+ seeded contract sidecars
└── package.json
│
.planning/demo/
├── seeds/
│   ├── substrate.sqlite.seed            # NEW — SQLite snapshot with 5 rules
│   ├── source-sessions/
│   │   └── deletion-incident-2026-02.jsonl  # NEW — source-session script
│   └── contracts/                       # The seeded .contracts/ directory
├── baselines/
│   ├── delete-account-baseline.json    # NEW — bare-Claude token/tool receipt
│   └── workspace-delete-baseline.json  # NEW — bare-Claude token/tool receipt
└── reset-demo.sh                        # NEW — reset script (partial in Phase 9; full in Phase 13)
```

### Pattern: Section-Weighted FTS Re-Ranking

```typescript
// mcp-sidecar/src/tools/section_weight.ts
// Source: PACT 2025 (via contract-form/RESEARCH.md)
const SECTION_WEIGHTS: Record<string, number> = {
  'Invariants': 2.0,
  'Examples':   2.0,
  'Intent':     1.5,
  'Role':       1.0,
  'Inputs':     1.0,
  'Outputs':    1.0,
  'Side Effects': 0.8,
  'Failure Modes': 0.8,
  'Notes':      0.5,
};

export function reRankWithSectionWeight(
  results: FtsResult[],
  sectionHashes: Record<string, string>, // from frontmatter
  querySnippet: string
): FtsResult[] {
  return results.map(r => {
    // Identify which section the snippet came from
    const matchedSection = detectSection(r.snippet, r.contractBody);
    const weight = SECTION_WEIGHTS[matchedSection] ?? 1.0;
    return { ...r, weightedScore: r.ftsScore * weight };
  }).sort((a, b) => b.weightedScore - a.weightedScore);
}
```

### Pattern: Staggered Amber Pulse

```typescript
// In GraphCanvasInner.tsx
// After mass-edit match returns:
const uuids = matchResults.map(r => r.uuid);
const delayMap = new Map(uuids.map((uuid, i) => [uuid, i * 50]));
setMassMatchedUuids(delayMap);

// In ContractNode data prop:
// state = 'mass_matched' when uuid is in massMatchedUuids
// --match-delay CSS variable = delayMap.get(uuid) + 'ms'
```

### Pattern: Copy Mode Graph Filter

```typescript
// In GraphCanvasInner.tsx — extend existing lens filter
const copyModeActive = useUiStore(s => s.copyModeActive);
const visibleNodes = useMemo(() => {
  const lensFiltered = applyLensFilter(allNodes, currentLens);
  if (copyModeActive) {
    return lensFiltered.filter(n => n.data.level === 'L4');
  }
  return lensFiltered;
}, [allNodes, currentLens, copyModeActive]);
```

### Anti-Patterns to Avoid

- **Embedding as a blocking dependency:** Do not block the mass-edit review queue on a working embedding pipeline. FTS5 section-weighted ranking is sufficient for demo correctness; embedding is a quality enhancement.
- **Copy Mode modifying the lens switcher:** Copy Mode is a separate toggle. It filters the visible graph but does NOT change `currentLens`. If the user switches lens while in Copy Mode, the combined filter applies.
- **Hard-coding substrate rules in React state:** The reset fixture SQLite rows are the source of truth. Demo state must not be baked into React components.
- **Seeding `format_version: 2` contracts:** Phase 8's lazy migration is on-WRITE, not on-read. Contracts seeded as `format_version: 2` will work but will show gray (`untracked`) until first write. Prefer seeding as `format_version: 3` with proper `section_hashes`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Markdown section detection for re-ranking | Custom regex | Section parser CLI binary (Phase 8 deliverable, `section-parser-cli`) via stdin/stdout IPC | Parser is fenced-code-aware; regex breaks on `##` inside code blocks |
| Embedding vector similarity | Custom cosine implementation | If embeddings are added: `sqlite-vec` or just `Array.reduce` on stored JSON arrays; skip for demo | Overkill; FTS5 is sufficient |
| YAML round-tripping in the review queue | Parse + modify + serialize YAML | `update_contract` MCP tool writes the sidecar; review queue calls the tool | Single-writer rule; sidecar must go through the Rust-side writer chain |
| Per-node Tokio serialization | New lock type | Existing `DriftLocks` map in `src-tauri/src/drift/state.rs` | Already ships; same UUID-keyed mutex handles mass-edit writes |
| Given/When/Then parsing | Full Gherkin parser | Simple string split on `\nGIVEN ` / `\nWHEN ` / `\nTHEN ` (PACT 2025 validated examples are short and structured) | Full Gherkin parser adds ~300KB of dependencies for a 3-token split |

---

## Common Pitfalls

### Pitfall 1: Forgetting the `SKIPPED-PINNED` Count in the Review Queue

**What goes wrong:** Mass-edit calls `update_contract` for each matched node. Pinned nodes silently return `SKIPPED-PINNED`. If the review queue doesn't track this, the user sees "10 nodes updated" but the canvas shows only 7 changed — looks like a bug on camera.

**Prevention:** After each `update_contract` call, parse the response for the `SKIPPED-PINNED` prefix. Accumulate into a separate counter. Show: `"3 of 10 nodes skipped — pinned"` in the review queue header.

### Pitfall 2: Demo Repo Starts Dev Server Successfully but Crashes on Prisma

**What goes wrong:** The demo repo has Prisma schema but no actual database. `next dev` boots; navigation works; but any page that touches Prisma (account settings, team settings) throws a "PrismaClientInitializationError" because the database URL isn't set.

**Prevention:** Use SQLite as the Prisma database provider for the demo repo (not PostgreSQL). `DATABASE_URL=file:./dev.db` in `.env.local`. Commit a seeded `dev.db` (or run `prisma db push` and seed it as part of demo setup). The account and team settings pages should NOT make Prisma calls in their initial page render — scaffold them as static shells with a commented-out data fetch.

### Pitfall 3: Copy Mode Hiding the Code Tab Breaks Inspector State

**What goes wrong:** When Copy Mode is active, the Code tab is hidden. If the user had the Code tab open and then activates Copy Mode, the Inspector could be in an inconsistent active-tab state.

**Prevention:** When Copy Mode activates (`copyModeActive = true`), if `activeTab === 'code'`, programmatically switch to `activeTab = 'contract'`. This is a one-line guard in the Copy Mode toggle handler.

### Pitfall 4: Source-Session Script JSONL Format Mismatch

**What goes wrong:** Phase 10's session watcher reads `~/.claude/projects/<cwd-key>/*.jsonl` and applies a `jq` filter to extract user/assistant messages. If the source-session script uses a slightly different JSONL format (e.g., different field names, different nesting), the filter fails silently and no substrate rules get extracted.

**Prevention:** Reference the two kernel-experiment session files in `.planning/research/constraint-distillation/` (`extracted-5f44f5af.json`, `extracted-efadfcc4.json`) for the exact JSONL format. The source-session script must use the same format or Phase 10 won't ingest it. Run the `jq` filter from `extraction-prompt.md` against the source-session script before committing.

### Pitfall 5: Reset Fixture Uses a Different SQLite Schema Than Phase 11

**What goes wrong:** Phase 9 creates `substrate_nodes` table in the seed SQLite. Phase 11 creates the same table in its migration. If the schemas differ (even slightly — column order, nullable flags, default values), Phase 11's migration will conflict.

**Prevention:** Coordinate with Phase 11 research (not yet started). Use `CREATE TABLE IF NOT EXISTS` with the schema from Phase 11 roadmap planning notes. Do not add Phase-11-specific columns (like `graph_edge_uuid`) — leave those for Phase 11 to add via migration. Phase 9's seed schema is the minimum necessary for demo recovery.

### Pitfall 6: Baseline Recorded After Substrate Seeding

**What goes wrong:** DEMO-03 says baselines must be recorded "before substrate seeding so context cannot leak." If the baseline run happens after the demo repo's contracts are seeded (`.contracts/` populated) or after CLAUDE.md is added, the bare-Claude baseline isn't truly bare — it may find the contracts directory and derive context from it.

**Prevention:** Record baseline in a clean checkout of the demo repo with no `.contracts/` directory and no CLAUDE.md. Verify: `ls app/contract-ide-demo/.contracts` should return "no such file" at baseline recording time. Commit the baseline receipt with the demo repo commit SHA, so provenance is traceable.

### Pitfall 7: Mass-Edit Upstream Impact Count Is Zero (Phase 8 PROP-02 Not Complete)

**What goes wrong:** The review queue banner says "N upstream contracts now amber" but PROP-02 hasn't actually emitted `rollup:changed` events after writes. The count is always 0, making the feature useless on camera.

**Prevention:** Phase 9 mass-edit depends on Phase 8 PROP-02 completion. Specifically, `compute_rollup_and_emit` must fire after every `update_contract` write (via the SourceWatcher file event on the updated sidecar). Verify this end-to-end before Phase 9 plans are locked.

---

## File-Level Pointers

### Files to Read Before Planning

| File | What to Extract |
|---|---|
| `contract-ide/src/components/layout/Sidebar.tsx` | Exact DOM position of Copy Mode pill stub; its CSS classes; the `data-copy-mode-pill` attribute |
| `contract-ide/src/store/graph.ts` | Current Zustand store shape; how to add `copyModeActive` without breaking existing consumers |
| `contract-ide/src/components/graph/contractNodeStyles.ts` | CVA variant shape; how to add `mass_matched` variant alongside `drifted` |
| `contract-ide/src/components/inspector/ReconcilePanel.tsx` | Dialog chrome to reuse for mass-edit review queue |
| `contract-ide/mcp-sidecar/src/tools/find_by_intent.ts` | Exact FTS5 query; column names; how to extend for section weighting |
| `contract-ide/mcp-sidecar/src/tools/update_contract.ts` | `SKIPPED-PINNED` response string (line 103-111); how to detect it in review queue |
| `contract-ide/src-tauri/src/db/migrations.rs` | Current schema; where to add migration v4 if needed for mass-edit columns |
| `.planning/demo/scenario-criteria.md` § 6 | Exact text, `applies_when`, and `justification` of all 5 substrate rules |
| `.planning/demo/presentation-script.md` § Beat 1, Beat 2, Beat 4 | Exact prompts, contract body shape, receipt delta target numbers |

### Files to Modify

| File | Change |
|---|---|
| `contract-ide/src/components/layout/Sidebar.tsx` | Enable Copy Mode pill, connect to `uiStore.copyModeActive` |
| `contract-ide/src/components/graph/contractNodeStyles.ts` | Add `mass_matched` CVA variant; add `NodeHealthState` extension |
| `contract-ide/src/components/graph/GraphCanvasInner.tsx` | Copy Mode filter logic; `massMatchedUuids` staggered delay injection |
| `contract-ide/src/components/inspector/Inspector.tsx` | Branch on `copyModeActive` to show `SimplifiedInspector` vs normal tabs |
| `contract-ide/mcp-sidecar/src/tools/find_by_intent.ts` | Add section-weighted re-ranking for mass-edit (or new sibling tool) |

### Files to Create

| File | Purpose |
|---|---|
| `contract-ide/src/components/mass-edit/MassEditModal.tsx` | Review queue modal |
| `contract-ide/src/components/inspector/SimplifiedInspector.tsx` | Copy Mode inspector surface |
| `contract-ide/src/store/ui.ts` | `copyModeActive` Zustand store |
| `contract-ide/mcp-sidecar/src/tools/section_weight.ts` | Section re-ranking utility |
| `.planning/demo/seeds/substrate.sqlite.seed` | Reset fixture SQLite snapshot |
| `.planning/demo/seeds/source-sessions/deletion-incident-2026-02.jsonl` | Source-session script |
| `.planning/demo/baselines/delete-account-baseline.json` | Bare-Claude baseline |
| `.planning/demo/baselines/workspace-delete-baseline.json` | Bare-Claude baseline |
| `.planning/demo/reset-demo.sh` (partial) | Reset script shell |

---

## Open Questions and Defaults

### Q1: Is embedding in scope for Phase 9?

**What we know:** FTS5 section-weighted ranking is sufficient for the demo. Embedding adds semantic fuzzy matching for non-keyword queries.

**What's unclear:** How much demo rehearsal time will be available? Embedding would add 1-2 days of implementation. Does it materially change the demo story?

**Default if not resolved:** Ship keyword-only with an explicit `EMBEDDING_DISABLED` flag and a UI note in the review queue. This is fully consistent with MASS-01's "keyword-only fallback if embeddings unavailable."

### Q2: Which SQLite schema does `substrate_nodes` use?

**What we know:** Phase 11's distiller will formally create this table. Phase 9 must pre-seed it.

**What's unclear:** Phase 11 research hasn't started. The exact column set Phase 11 needs may differ from Phase 9's minimal schema.

**Default:** Use the minimal schema documented in this research (id, type, text, applies_when, justification, valid_at, invalid_at, session_id, turn_ref, actor, confidence, created_at) with `CREATE TABLE IF NOT EXISTS`. Phase 11 adds columns via ALTER TABLE. Keep Phase 9 rows compatible.

### Q3: Where does `contract-ide-demo` repo live?

**What we know:** It must be a separate git repo opened by Contract IDE on Laptop A. `reset-procedure.md` clones it to `/tmp/contract-ide-demo/`.

**Default:** Create `github.com/YGao2005/contract-ide-demo` as a public repo. The reset script clones it to `/tmp/contract-ide-demo/demo` and checks out the locked SHA.

### Q4: Does Phase 9 need to create `reset-demo.sh` fully or just the skeleton?

**What's unclear:** The full reset script requires knowledge of Phase 10's session watcher and Phase 11's substrate paths. Phase 9 knows only the contract and SQLite pieces.

**Default:** Phase 9 writes the demo repo + SQLite swap portions. Phase 13 completes the full script (per `reset-procedure.md`: "script lives at `contract-ide/demo/reset-demo.sh` — to be written during Phase 10").

### Q5: Should the source-session script be a real JSONL or a prose document?

**What we know:** Phase 10's session watcher reads JSONL from `~/.claude/projects/<cwd-key>/`. The distiller extracts decisions from conversational text.

**Default:** Write the source-session script as a JSONL file matching the exact Claude Code session format (confirmed via kernel experiment files). Place it in the seeded sessions location. If authoring real JSONL is too laborious, write it as prose in the Phase 9 planning note and commit the JSONL formatting as a Phase 10 task — but the narrative arc must be documented in Phase 9.

---

## Sources

### Primary (HIGH confidence)

- `contract-ide/src/components/layout/Sidebar.tsx` — Copy Mode pill stub at lines 35-43; confirmed `data-copy-mode-pill` attribute and disabled state
- `contract-ide/mcp-sidecar/src/tools/find_by_intent.ts` — FTS5 `nodes_fts MATCH ?` query; BM25 `ORDER BY rank`; confirmed working
- `contract-ide/mcp-sidecar/src/tools/update_contract.ts` — `SKIPPED-PINNED` guard at lines 102-111; atomic temp+rename write; confirmed
- `contract-ide/src-tauri/src/db/migrations.rs` — `nodes_fts` FTS5 virtual table confirmed at lines 101-108; `receipts` table confirmed; no `substrate_nodes` table yet
- `contract-ide/src/components/graph/contractNodeStyles.ts` — current CVA variants (`healthy`, `drifted`, `untested`); `drifted` = `ring-2 ring-red-500 animate-pulse`
- `.planning/research/contract-form/RESEARCH.md` — PACT 2025: Examples > Notes for LLM adherence; section-weighted ranking recommendation
- `.planning/research/contract-form/PROPAGATION.md` — Section hashes architecture, pinned-node guard path, SKIPPED-PINNED unreachability requirement
- `.planning/demo/scenario-criteria.md` § 6 — verbatim substrate rules with full text, applies_when, justification
- `.planning/demo/presentation-script.md` — Beat 1 PM contract body; Beat 2 receipt delta targets; Beat 4 workspace-delete prompt
- `.planning/ROADMAP.md` Phase 9 planning notes — verbatim constraints on review queue UI copy, Copy Mode section hiding, section weighting

### Secondary (MEDIUM confidence)

- `.planning/research/constraint-distillation/README.md` — session JSONL format, jq filter approach, schema from kernel experiment
- `demo-repo/vercel-commerce/package.json` — confirmed vanilla vercel/commerce, no Auth/Prisma/Stripe/Mailchimp; Phase 9 must build a new repo from scratch
- `.planning/phases/08-*/08-01-PLAN.md` — Phase 8 plan confirms `section-parser-cli` binary target, `format_version: 3` fields, lazy migration design

---

## Metadata

**Confidence breakdown:**
- FTS5 retrieval and section-weighted ranking: HIGH — code confirmed, patterns established
- Embedding strategy: MEDIUM — no existing pipeline; recommendation is keyword-only fallback
- Copy Mode pill wiring: HIGH — stub confirmed in code; pattern identical to lens switcher
- Simplified inspector surface: HIGH — standard React conditional render; Given/When/Then is a simple string parse
- `contract-ide-demo` repo provisioning: HIGH — requirements explicit from scenario-criteria.md; base choice is straightforward
- Reset fixture SQLite schema: MEDIUM — depends on Phase 11 schema not yet researched; use CREATE IF NOT EXISTS pattern to hedge
- Source-session script JSONL format: MEDIUM — kernel experiment files are the reference; format is well-understood but authoring realistic narrative JSONL takes care

**Research date:** 2026-04-24
**Valid until:** 2026-05-15 (stable domain; the seam with Phase 8 is the primary volatility factor — re-validate Phase 8 deliverables before locking Phase 9 plans)

---

## RESEARCH COMPLETE

**Phase:** 9 — Mass Edit + Non-Coder Mode + Demo Repo Seeding
**Confidence:** HIGH on capabilities workload (FTS5, Copy Mode, review queue); MEDIUM on demo provisioning (embedding decision deferred; Phase 11 schema coordination needed)

### Key Findings

1. **Phase 8 is a hard seam-in dependency.** Section hashes (PROP-01), rollup amber variant (PROP-02), and `rollup_stale` emission on writes (PROP-02) are all Phase 8 deliverables Phase 9 directly reuses. Phase 9 plans must not be executed until Phase 8 is committed. The existing SKIPPED-PINNED guard is already live in `update_contract.ts`.

2. **FTS5 + section weighting is fully sufficient for demo.** The `nodes_fts` virtual table is live and BM25-ranked. PACT 2025 (per `RESEARCH.md`) validates that `## Invariants` and `## Examples` sections are the highest-leverage for LLM adherence. Section-weighted re-ranking is a post-FTS computation against existing `section_hashes` — no schema change needed. Embedding is a stretch goal; ship keyword-only with an explicit flag.

3. **Copy Mode pill is already stubbed and positioned correctly.** `Sidebar.tsx` line 35-43 has the disabled pill with `data-copy-mode-pill` above the lens switcher. Phase 9 enables it, connects it to a `uiStore.copyModeActive` Zustand store, and adds the L4-filter logic to `GraphCanvasInner`. The `Delegate to agent` button goes into `SimplifiedInspector.tsx` as a disabled stub with an optional `onDelegate` prop — Phase 11 fills it.

4. **`demo-repo/vercel-commerce` is the wrong base.** The existing demo repo is vanilla vercel/commerce with no Auth, Prisma, Stripe, or Mailchimp. Phase 9 must provision a new `contract-ide-demo` repo from scratch (create-next-app + shadcn + adapters). The Prisma schema requires `User`, `Workspace`, `Invoice`, `OrgInvoice` models. Account/Team Settings scaffolds must be present without delete buttons.

5. **Reset fixture needs a forward-compatible `substrate_nodes` schema.** Phase 9 must pre-seed the 5 substrate rules into a SQLite table that Phase 11 will formally own. Use `CREATE TABLE IF NOT EXISTS` with Phase 11's documented minimal schema. Seeding before Phase 11 is complete is safe if column names match.

6. **Bare-Claude baseline must be recorded before any substrate is seeded.** DEMO-03 explicitly requires baselines "before substrate seeding so context cannot leak." Record against a clean checkout with no `.contracts/` directory, no `CLAUDE.md`, no `.mcp.json`. Use `claude -p` with the two locked prompts; capture session JSONL for token/tool counts.

### File Created

`/Users/yang/lahacks/.planning/phases/09-mass-edit-non-coder-mode-demo-repo-seeding/09-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| FTS5 retrieval + section weighting | HIGH | `nodes_fts` confirmed in code; section-weighted pattern directly from PACT 2025 |
| Copy Mode pill wiring | HIGH | Stub confirmed in `Sidebar.tsx`; pattern identical to existing lens switcher |
| Mass-edit review queue | HIGH | `update_contract` + SKIPPED-PINNED pattern confirmed; shadcn Dialog chrome reused |
| Embedding strategy | MEDIUM | No existing pipeline; recommendation is keyword-only fallback (spec explicitly allows this) |
| `contract-ide-demo` repo | HIGH | Requirements verbatim in scenario-criteria.md; base choice straightforward |
| Reset fixture schema | MEDIUM | Phase 11 schema not yet researched; `CREATE IF NOT EXISTS` hedges the risk |
| Source-session script format | MEDIUM | Kernel experiment files are the reference; narrative arc is clear but JSONL authoring is laborious |

### Open Questions

1. **Embedding in scope?** Default: no, ship keyword-only fallback. Revisit if Phase 8 finishes faster than expected.
2. **`substrate_nodes` column names match Phase 11?** Phase 11 research not started. Use minimum required columns; Phase 11 ALTERs.
3. **`contract-ide-demo` repo hosting?** GitHub public repo; locked SHA in demo documentation. Needs to be created before Phase 9 plans execute.

### Ready for Planning

Research complete. Planner can now create PLAN.md files for the six planned tasks: 09-01 (mass-edit retrieval), 09-02 (mass-edit review queue UI), 09-03 (Copy Mode), 09-04 (repo provisioning), 09-05 (reset fixture + baselines), 09-06 (source-session script + UAT rehearsal).
