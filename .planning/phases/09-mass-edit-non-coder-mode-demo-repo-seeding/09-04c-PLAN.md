---
phase: 09-mass-edit-non-coder-mode-demo-repo-seeding
plan: 04c
type: execute
wave: 2
depends_on:
  - "09-04"
files_modified:
  - contract-ide/src-tauri/src/db/migrations.rs
  - contract-ide/src-tauri/src/sidecar/frontmatter.rs
  - contract-ide/src-tauri/src/scanner/scanner.rs
  - contract-ide/src-tauri/src/types.rs
  - contract-ide/src-tauri/src/commands/repo.rs
  - contract-ide/src/store/graph.ts
  - contract-ide/src/lib/flow-layout.ts
  - contract-ide-demo/.contracts/flow-delete-account.md
  - contract-ide-demo/.contracts/flow-delete-workspace.md
  - contract-ide-demo/.contracts/ambient/flow-signup.md
  - contract-ide-demo/.contracts/ambient/flow-checkout.md
  - contract-ide-demo/.contracts/ambient/flow-add-team-member.md
  - contract-ide-demo/.contracts/ambient/flow-password-reset.md
  - .planning/demo/contract-ide-demo-spec.md
autonomous: true
requirements:
  - FLOW-01

must_haves:
  truths:
    - "`kind: flow` is a permissible value in contract frontmatter parsed by the canonical Rust frontmatter parser (frontmatter.rs); existing kinds (UI / API / lib / data / external / job / cron / event) remain unchanged"
    - "Flow contracts carry a `members: [trigger_uuid, participant_uuid_1, participant_uuid_2, ...]` ordered array in frontmatter — first element is the flow's trigger (its kind determines L3 render mode in Phase 13: UI iframe vs. structured backend card), subsequent elements are participants in invocation order"
    - "Migration v5 adds `members_json TEXT NULL` column to the nodes table (Phase 8 v3 took the rollup columns; Phase 10 v4 took sessions/episodes; FLOW-01 ships as v5). Column is nullable because non-flow contracts don't have members. JSON shape: `[\"<trigger_uuid>\", \"<participant_1>\", ...]`"
    - "Scanner persists members_json on flow contracts during repo-load (reuses the existing INSERT INTO nodes path; flow-kind contracts get members serialized; non-flow rows get NULL)"
    - "src/lib/flow-layout.ts exports a pure function `layoutFlowMembers(flow: FlowNode, allNodes: Map<uuid, Node>): LayoutEntry[]` that returns the flow's trigger + participants in invocation order with deterministic y-positions (y_n = n * VERTICAL_GAP). This is the layout primitive Phase 13 CHAIN-01 will read; Phase 9 ships it but does not render it (Phase 13 renders the chain on canvas)"
    - "Frontend graph store (src/store/graph.ts) exposes `getFlowMembers(flowUuid: string): string[]` selector returning the ordered uuid list — Phase 13 CHAIN-01 + Cmd+P-to-flow nav (Phase 13 SUB-08) read from this"
    - "All 6 demo flows are seeded as committed `.contracts/*.md` files in the demo repo at the locked SHA: 2 scenario flows (delete-account, delete-workspace) + 4 ambient flows (signup, checkout, add-team-member, password-reset). Each flow has a valid `members` array of UUIDs that exist as other contracts in `.contracts/`"
    - "delete-account flow members reference the canonical chain from CANVAS-PURPOSE.md:67-93: trigger = a0000000 (Account Settings page L3), then API endpoint POST /api/account/delete, then beginAccountDeletion lib, then db.user.update data atom, then stripe.customers.update external, then mailchimp.suppress external, then sendDeletionConfirmationEmail lib (UUIDs from 09-04 ambient seeding scheme — exact mapping documented in 09-04c-SUMMARY.md)"
    - "delete-workspace flow members reference parallel chain anchored at b0000000 (Team Settings page L3) — Phase 13 Beat 4 needs both flows to be queryable so the canvas can render delete-account chain at top + delete-workspace chain below as side-by-side"
    - "Migration v5 is forward-compatible with future schema additions (Phase 13 may add layout-position columns); CREATE INDEX added on members_json for the JSON-extract-by-uuid lookups Phase 13 will run"
    - "Type-safety on TS side: `FlowContract` interface in contract-ide/src/ipc/types.ts (or wherever existing contract types live) extends the base contract type with `members: string[]` and `kind: 'flow'` discriminant — type narrowing for Phase 13 consumers"
  artifacts:
    - path: "contract-ide/src-tauri/src/db/migrations.rs"
      provides: "EXTENDED — adds Migration v5 that ALTERs nodes to add members_json TEXT NULL + CREATE INDEX. Migration is immutable per the existing v1/v2/v3/v4 contract — never modify v5's sql once applied to any developer's DB"
      contains: "version: 5"
    - path: "contract-ide/src-tauri/src/sidecar/frontmatter.rs"
      provides: "EXTENDED — frontmatter struct gains optional `members: Option<Vec<String>>` field; serde deserialization accepts kind: flow + members array. Existing fields untouched (lazy-migration-safe per Phase 8 PROP-01 design)"
      contains: "members"
    - path: "contract-ide/src-tauri/src/scanner/scanner.rs"
      provides: "EXTENDED — when persisting a contract row, serialize members (if present) to JSON string and pass to nodes INSERT/UPDATE; null otherwise"
      contains: "members_json"
    - path: "contract-ide/src/lib/flow-layout.ts"
      provides: "Pure function layoutFlowMembers(flow, allNodes) → LayoutEntry[] with deterministic y-positions; consumed by Phase 13 CHAIN-01"
      exports: ["layoutFlowMembers", "type LayoutEntry"]
      min_lines: 50
    - path: "contract-ide-demo/.contracts/flow-delete-account.md"
      provides: "Beat 1 / Beat 2 anchor flow contract — members chain through the 5-rule honoring participants per CANVAS-PURPOSE.md illustrative chain"
      contains: "kind: flow"
    - path: "contract-ide-demo/.contracts/flow-delete-workspace.md"
      provides: "Beat 4 anchor flow contract — parallel chain reusing shared participants (visible in Phase 13 as ghost references)"
      contains: "kind: flow"
    - path: ".planning/demo/contract-ide-demo-spec.md"
      provides: "EXTENDED — adds 'FLOW-01 seeded flows' section with 6 flow uuids + member maps (exact uuid → contract resolution table)"
      contains: "FLOW-01"
  key_links:
    - from: "contract-ide-demo/.contracts/flow-delete-account.md"
      to: "contract-ide-demo/.contracts/a0000000-...md (Account Settings L3 trigger) + ambient backend contracts (POST /api/account/delete, beginAccountDeletion, etc.)"
      via: "members[0] = a0000000 (trigger; kind: UI determines Phase 13 L3 iframe render); members[1..] cite the backend ambient contracts authored in 09-04 by their UUIDs"
      pattern: "members"
    - from: "contract-ide/src-tauri/src/db/migrations.rs"
      to: "Phase 8 v3 (rollup columns) + Phase 10 v4 (sessions table) + Phase 9 v5 (members_json)"
      via: "Versioned migration sequence; v5 is the next available slot. tauri-plugin-sql tracks applied (version, description) — never modify v5 sql once any dev has run it"
      pattern: "version: 5"
    - from: "contract-ide/src/lib/flow-layout.ts"
      to: "Phase 13 CHAIN-01 (vertical participant chain renderer)"
      via: "Phase 13 imports layoutFlowMembers from this module; Phase 9 ships only the deterministic-position primitive, not the canvas rendering. y-position formula: trigger at y=0, participant_n at y = (n * VERTICAL_GAP) where VERTICAL_GAP is exported from this module (default 120)"
      pattern: "layoutFlowMembers"
    - from: "contract-ide/src/store/graph.ts"
      to: "contract-ide-demo/.contracts/flow-*.md (flow contracts)"
      via: "Adds getFlowMembers(flowUuid) selector that returns flow.members from the loaded nodes; Phase 13 SUB-08 (Cmd+P-to-flow nav) and CHAIN-01 (vertical render) both consume this selector"
      pattern: "getFlowMembers"
---

<objective>
Land FLOW-01: a new contract `kind: flow` with an ordered `members` array, the v5 schema migration that persists members in the nodes table, the canonical frontmatter parser extension, and 6 seeded flow contracts (2 scenario + 4 ambient) committed to the demo repo at the locked SHA. Plus a deterministic layout primitive (`flow-layout.ts`) that Phase 13's CHAIN-01 vertical-chain renderer will consume.

Purpose: The canvas reframe (CANVAS-PURPOSE.md, locked 2026-04-24) renders L2 as a vertical chain of flow members — trigger card at top + participants below in invocation order. Without `kind: flow + members`, Phase 13 has no L2 data to render. Beat 3's *"canvas pulses the rendered Account Settings screen at top + 3 service cards in the call chain below"* (presentation-script.md:217) and Beat 4's parallel two-flow rendering both depend on flow contracts existing as queryable schema-level entities.

Output: v5 migration + frontmatter extension + scanner persistence + flow-layout.ts primitive + 6 seeded flow contracts in demo repo. NO Phase 13 rendering (CHAIN-01/CHAIN-02 ship in Phase 13). NO call-shape edge labels (BACKEND-FM-01 sections from 09-04 + 09-04b feed those — Phase 13 reads).
</objective>

<execution_context>
@/Users/yang/.claude/get-shit-done/workflows/execute-plan.md
@/Users/yang/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/CANVAS-PURPOSE.md
@.planning/phases/09-mass-edit-non-coder-mode-demo-repo-seeding/09-RESEARCH.md
@.planning/phases/09-mass-edit-non-coder-mode-demo-repo-seeding/09-04-SUMMARY.md
@.planning/demo/scenario-criteria.md
@.planning/demo/presentation-script.md

# Phase 8 v3 + Phase 10 v4 — predecessor migrations
@contract-ide/src-tauri/src/db/migrations.rs

# Existing frontmatter parser this plan extends
@contract-ide/src-tauri/src/sidecar/frontmatter.rs
@contract-ide/src-tauri/src/scanner/scanner.rs
</context>

<tasks>

<task type="auto">
  <name>Task 1: Migration v5 + frontmatter extension + scanner persistence + types</name>
  <files>contract-ide/src-tauri/src/db/migrations.rs, contract-ide/src-tauri/src/sidecar/frontmatter.rs, contract-ide/src-tauri/src/scanner/scanner.rs, contract-ide/src-tauri/src/types.rs, contract-ide/src-tauri/src/commands/repo.rs, contract-ide/src/lib/flow-layout.ts, contract-ide/src/store/graph.ts</files>
  <action>
    1. **Verify predecessor migration state.** Read `contract-ide/src-tauri/src/db/migrations.rs` and confirm v1-v4 are present. v4 was added by Phase 10 plan 10-01 (sessions + episodes table). v5 is the next available slot for FLOW-01.

       If v4 is NOT yet present (Phase 10 hasn't shipped 10-01 yet), STOP and surface to user — Phase 9 plans assume Phase 10 wave 1 has at minimum 10-01 committed. Phase 10 plans were committed 2026-04-25 per git log; verify before proceeding.

    2. **Add Migration v5** to `migrations.rs`:
       ```rust
       Migration {
           version: 5,
           description: "Phase 9 FLOW-01 — add members_json column to nodes for kind:flow contracts",
           sql: "
               -- Phase 9 FLOW-01: members array for kind:flow contracts.
               -- Stored as JSON string array of UUIDs in invocation order.
               -- Non-flow contracts have NULL.

               ALTER TABLE nodes ADD COLUMN members_json TEXT;

               -- Index for the json-array-membership query Phase 13 SUB-08 will run
               -- (find flows containing a given participant uuid). SQLite does not
               -- index JSON natively; we index the raw text and rely on json_each()
               -- in Phase 13's queries.
               CREATE INDEX IF NOT EXISTS idx_nodes_members_json ON nodes(members_json) WHERE members_json IS NOT NULL;
           ",
           kind: MigrationKind::Up,
       },
       ```

       Add this migration at the END of the existing `vec![...]` in `get_migrations()`. Do NOT touch v1-v4. Per the file's WARNING comment, v5 becomes immutable once any dev runs it.

    3. **Extend the frontmatter struct** at `contract-ide/src-tauri/src/sidecar/frontmatter.rs`:
       ```rust
       #[derive(Debug, Clone, Serialize, Deserialize)]
       pub struct Frontmatter {
           pub uuid: String,
           pub kind: String,        // existing — accepts new value "flow"
           pub level: Option<String>,
           pub parent: Option<String>,
           pub neighbors: Vec<String>,
           pub code_ranges: Vec<CodeRange>,
           pub code_hash: Option<String>,
           pub contract_hash: Option<String>,
           pub human_pinned: Option<bool>,
           pub route: Option<String>,
           pub format_version: Option<u32>,
           pub section_hashes: Option<HashMap<String, String>>,  // Phase 8 PROP-01
           pub rollup_inputs: Option<Vec<RollupInput>>,           // Phase 8 PROP-02
           pub rollup_hash: Option<String>,
           pub rollup_state: Option<String>,
           pub rollup_generation: Option<u32>,

           /// Phase 9 FLOW-01: ordered list of member uuids — first is trigger,
           /// remainder are participants in invocation order. Required ONLY when
           /// kind == "flow"; absent on all other kinds.
           #[serde(default)]
           pub members: Option<Vec<String>>,
       }
       ```

       Add `#[serde(default)]` so existing contracts without `members` deserialize cleanly (they get None).

       Add a validation hook (preferably as a method on Frontmatter): when `kind == "flow"`, `members` must be Some(non_empty). Otherwise, deserialization succeeds but a runtime warning is logged. Per CLAUDE.md "no error handling for scenarios that can't happen" — flow contracts authored by hand SHOULD have members; if absent, it's a contract authoring bug and a startup banner (similar to 09-04b's validators) is appropriate. Add a tiny `validate_flow_members(fm: &Frontmatter) -> Result<(), String>` that the scanner calls; aggregate failures into the same persistent banner mechanism added by 09-04b.

    4. **Extend the scanner** at `contract-ide/src-tauri/src/scanner/scanner.rs`:
       - Find the existing INSERT INTO nodes statement (or upsert path).
       - Add `members_json` column to the INSERT column list.
       - Bind value: `frontmatter.members.as_ref().map(|m| serde_json::to_string(m).unwrap_or_default())` (None → SQL NULL).
       - On UPDATE path (re-scan of an existing contract), also update members_json.

       The scanner's existing test (if any) should stay green. If it asserts column counts, update the count.

    5. **Add the TS-side types and store helpers.**

       In `contract-ide/src/ipc/types.ts` (or wherever the existing ContractNode type is defined; check via `grep -rn "ContractNode\\|interface.*Node" contract-ide/src/`), extend with:
       ```typescript
       export interface FlowContract extends BaseContract {
           kind: 'flow';
           members: string[];  // [trigger_uuid, ...participant_uuids]
       }

       export type AnyContract = UIContract | BackendContract | LibContract | FlowContract;
       ```

       In `contract-ide/src/store/graph.ts`, add:
       ```typescript
       /** Phase 9 FLOW-01: return the ordered member uuids for a flow node, or [] if not a flow. */
       getFlowMembers: (flowUuid: string) => {
           const node = get().nodesByUuid.get(flowUuid);
           if (!node || node.kind !== 'flow') return [];
           return node.members ?? [];
       },
       ```
       Plus selector typing if the store uses Zustand's typed selector pattern.

    6. **Author `contract-ide/src/lib/flow-layout.ts`** — pure function consumed by Phase 13 CHAIN-01:
       ```typescript
       /**
        * Phase 9 FLOW-01 layout primitive. Phase 13 CHAIN-01 imports this to render
        * vertical participant chains on canvas. Pure function — no React, no DOM,
        * no canvas — just deterministic position math.
        */
       export const VERTICAL_GAP_PX = 120;
       export const TRIGGER_Y = 0;

       export interface LayoutEntry {
           uuid: string;
           y: number;
           index: number;
           role: 'trigger' | 'participant';
       }

       /**
        * Given a flow node and a Map of all loaded nodes, return the layout
        * entries for trigger + participants in invocation order with deterministic
        * y-positions. Members not found in allNodes are omitted (the validator
        * in 09-04b's repo-load path should have caught dangling references; this
        * function is defensive but does not throw).
        */
       export function layoutFlowMembers(
           members: string[],
           allNodes: Map<string, { uuid: string }>,
       ): LayoutEntry[] {
           const out: LayoutEntry[] = [];
           members.forEach((uuid, index) => {
               if (!allNodes.has(uuid)) return;
               out.push({
                   uuid,
                   index,
                   y: index === 0 ? TRIGGER_Y : index * VERTICAL_GAP_PX,
                   role: index === 0 ? 'trigger' : 'participant',
               });
           });
           return out;
       }
       ```
       Add a tiny inline test (or a separate `flow-layout.test.ts`) asserting:
       - Empty members → empty layout
       - 3 members → 3 entries with y = 0, 120, 240
       - Missing member in allNodes → omitted

    7. **Wire the validator into commands/repo.rs** — extend the validator chain from 09-04b:
       ```rust
       // After 09-04b's validate_jsx_alignment + validate_backend_sections:
       let flow_errors = validate_flow_members(&contracts);
       if !flow_errors.is_empty() {
           return Err(RepoLoadError::ValidationFailed { jsx_errors, section_errors, flow_errors });
       }
       ```
       The validate_flow_members function lives in frontmatter.rs (or sidecar/flow_validator.rs as a parallel to 09-04b's validators); it asserts every kind:flow contract has non-empty members AND every uuid in members exists as a contract in the loaded set.

    8. **Verify the migration runs on a fresh DB** without errors:
       ```bash
       cd /Users/yang/lahacks/contract-ide
       # Delete any local dev DB to force fresh migration sequence
       rm -f ~/Library/Application\ Support/com.contractide.dev/contract.db
       npm run tauri dev
       ```
       Open any seeded repo. The migration log (or `sqlite3 <db> ".schema nodes"`) should show `members_json` column. No errors during migration.

    9. **Verify scanner persistence** (after Task 2 seeds the flow contracts):
       ```bash
       sqlite3 <db> "SELECT uuid, kind, members_json FROM nodes WHERE kind='flow' LIMIT 6"
       ```
       Expect 6 rows after Task 2 seeds them, each with a JSON array of UUIDs in members_json.

    10. From `/Users/yang/lahacks/contract-ide/`:
        - `cargo check` clean.
        - `npm run tsc` clean.
        - `npm run tauri dev` boots without migration errors.
  </action>
  <verify>
    - Migration v5 added to migrations.rs at the end of the migrations vec.
    - Fresh DB migrates v1→v5 without errors; `.schema nodes` shows members_json column.
    - frontmatter.rs accepts kind: flow + members array; existing contracts without members deserialize as None.
    - scanner.rs persists members_json (JSON string of uuid array) on flow contracts; NULL on others.
    - validate_flow_members fires the persistent banner if a flow contract has missing/dangling members.
    - flow-layout.ts exports layoutFlowMembers with correct y-position math; inline tests pass.
    - graph.ts getFlowMembers selector returns the ordered uuid list.
    - cargo check + npm tsc clean.
  </verify>
  <done>
    Migration v5 ships and runs cleanly on fresh DB. Frontmatter parser accepts kind:flow + members. Scanner persists members_json. validate_flow_members extends the 09-04b validator chain. flow-layout.ts ships the deterministic vertical-chain layout primitive. Frontend store getFlowMembers selector + FlowContract type added. Phase 13 CHAIN-01 has its data path complete.
  </done>
</task>

<task type="auto">
  <name>Task 2: Author 6 flow contracts (2 scenario + 4 ambient) in demo repo</name>
  <files>contract-ide-demo/.contracts/flow-delete-account.md, contract-ide-demo/.contracts/flow-delete-workspace.md, contract-ide-demo/.contracts/ambient/flow-signup.md, contract-ide-demo/.contracts/ambient/flow-checkout.md, contract-ide-demo/.contracts/ambient/flow-add-team-member.md, contract-ide-demo/.contracts/ambient/flow-password-reset.md, .planning/demo/contract-ide-demo-spec.md</files>
  <action>
    1. **Read the ambient UUID scheme** from 09-04-SUMMARY.md to identify the actual UUIDs of the participant contracts (POST /api/account/delete, beginAccountDeletion, db.user.update, stripe.customers.update, mailchimp.suppress, sendDeletionConfirmationEmail, etc.). 09-04 Task 2 step 2 used a `f1010101-...` style hierarchy; the SUMMARY documents the exact mapping. If the SUMMARY does not yet exist (09-04 not yet executed), document the scheme inline in this plan's execution: pick deterministic UUIDs that match 09-04's pattern.

       For this plan to work, 09-04 must be SHIPPED FIRST. The wave structure (09-04 in Wave 1, 09-04c in Wave 2) enforces this.

    2. **Author `contract-ide-demo/.contracts/flow-delete-account.md`** — Beat 1 / Beat 2 anchor flow:

       ```markdown
       ---
       format_version: 3
       uuid: flow-de1e7e00-0000-4000-8000-acc000000000
       kind: flow
       level: L2
       parent: f2000000-0000-4000-8000-000000000000  # account-flow L1 (from 09-04 ambient)
       neighbors: []
       members:
         - a0000000-0000-4000-8000-000000000000   # trigger: Account Settings page (UI L3)
         - <api-account-delete-uuid>              # POST /api/account/delete (API L3)
         - <begin-account-deletion-uuid>          # beginAccountDeletion (lib L3)
         - <db-user-update-uuid>                  # db.user.update (data L4 / L3 ambient)
         - <stripe-customers-update-uuid>         # stripe.customers.update (external L3)
         - <mailchimp-suppress-uuid>              # mailchimp.suppress (external L3)
         - <send-deletion-confirmation-email-uuid> # sendDeletionConfirmationEmail (lib L3)
       human_pinned: false
       section_hashes: {}
       ---

       ## Intent
       The delete-account flow runs when a logged-in customer deletes their own account
       from the Account Settings page. v1 ships with the trigger present (Account Settings
       page at /account/settings) but no Delete button installed; Beat 1's PM contract edit
       commissions the button, and Beat 2's agent fills the chain below. The flow must honor
       the 5 substrate rules from the Feb-2026 deletion incident — soft-delete with grace,
       email-link confirmation, Stripe customer archive (not delete), invoice anonymization,
       Mailchimp suppression.

       ## Role
       Customer-facing account-lifecycle flow. The trigger is the Account Settings page;
       the chain runs from button click through soft-delete + Stripe archive + Mailchimp
       suppression + confirmation email.

       ## Notes
       Member ordering is invocation order:
       1. Account Settings page (trigger UI) → user clicks Delete Account
       2. POST /api/account/delete (API endpoint) → soft-delete kicks off
       3. beginAccountDeletion lib → orchestrates the chain
       4. db.user.update → set deletedAt
       5. stripe.customers.update → archive (NOT del)
       6. mailchimp.suppress → set list status to unsubscribed
       7. sendDeletionConfirmationEmail → email-link confirmation per dec-confirm-via-email-link
       ```

       Replace the `<*-uuid>` placeholders with the actual UUIDs from the 09-04 ambient seeding scheme. Document the resolution in 09-04c-SUMMARY.md.

    3. **Author `contract-ide-demo/.contracts/flow-delete-workspace.md`** — Beat 4 anchor flow:

       Mirror flow-delete-account.md structure, with:
       - `uuid: flow-de1e7e00-0000-4000-8000-wks000000000`
       - `parent`: team-flow L1 (`f3000000-...` per 09-04 scheme)
       - `members[0] = b0000000` (Team Settings page L3)
       - `members[1..]` cite the team-side participants (POST /api/team/[slug]/delete API, beginWorkspaceDeletion lib, db.workspace.update data, stripe.customers.update for the workspace's stripeCustomerId, mailchimp.suppress for org members, sendWorkspaceDeletionConfirmationEmail lib)

       Several members will be SHARED with flow-delete-account (the same Stripe + Mailchimp + email lib are reused) — that's the Beat 4 "ghost reference" point. Phase 13 will detect duplicates and render them as ghost-referenced cards. Phase 9 just authors the contracts; the rendering policy is Phase 13's.

    4. **Author 4 ambient flow contracts** at `.contracts/ambient/`:

       - `flow-signup.md`: trigger = signup page UI L3, members include validation lib + db.user.create + stripe.customers.create + welcome email lib
       - `flow-checkout.md`: trigger = checkout page UI L3, members include payment-validation lib + stripe.charges.create + db.order.create + receipt-email lib
       - `flow-add-team-member.md`: trigger = team-members page UI L3, members include invite-validation lib + db.invite.create + invite-email lib
       - `flow-password-reset.md`: trigger = password-reset page UI L3, members include reset-token lib + db.user.update + reset-email lib

       Each ambient flow needs 4-6 members minimum (Phase 13 CHAIN-01 layout looks better with depth than width). Use the 09-04 ambient UUIDs where available; for missing participants, this plan can ALSO add them as new ambient contracts in `.contracts/ambient/` if 09-04 didn't author them. Document any added contracts in 09-04c-SUMMARY.md.

    5. **Update `.planning/demo/contract-ide-demo-spec.md`** with a FLOW-01 section:
       ```markdown
       ## FLOW-01 seeded flows (Phase 9 09-04c)

       6 flow contracts committed at the locked SHA:

       | Flow uuid | Name | Trigger uuid | # members | Demo beats |
       |-----------|------|--------------|-----------|------------|
       | flow-de1e7e00-...-acc... | delete-account | a0000000-... (Account Settings UI) | 7 | Beat 1, Beat 2 |
       | flow-de1e7e00-...-wks... | delete-workspace | b0000000-... (Team Settings UI) | 7 | Beat 4 |
       | flow-... | signup | <signup-page-uuid> (signup UI) | 5 | ambient density |
       | flow-... | checkout | <checkout-page-uuid> (checkout UI) | 5 | ambient density |
       | flow-... | add-team-member | <team-members-page-uuid> (UI) | 4 | ambient density |
       | flow-... | password-reset | <pwreset-page-uuid> (UI) | 4 | ambient density |
       ```

    6. **Verify the seeded flows pass validation.** From `/Users/yang/lahacks/contract-ide-demo/`:
       ```bash
       git add .contracts/
       git commit -m "feat: seed 6 flow contracts (FLOW-01) — 2 scenario + 4 ambient"
       git tag -f demo-base
       ```
       Update locked SHA in `.planning/demo/contract-ide-demo-spec.md` to point at the new commit.

       From `/Users/yang/lahacks/contract-ide/`:
       - Open the demo repo via Cmd+O
       - validate_flow_members (Task 1 deliverable) confirms every flow's members exist as contracts
       - sqlite3 query confirms `SELECT COUNT(*) FROM nodes WHERE kind='flow'` returns 6
       - sqlite3 query confirms `SELECT json_array_length(members_json) FROM nodes WHERE kind='flow'` returns row counts (4-7 per flow)

    7. **Commit** the lahacks-side changes (migration + scanner + spec doc):
       ```bash
       node /Users/yang/.claude/get-shit-done/bin/gsd-tools.cjs commit "feat(09-04c): FLOW-01 — kind:flow + members + v5 migration + 6 seeded flows" \
         --files contract-ide/src-tauri/src/db/migrations.rs \
                 contract-ide/src-tauri/src/sidecar/frontmatter.rs \
                 contract-ide/src-tauri/src/scanner/scanner.rs \
                 contract-ide/src-tauri/src/types.rs \
                 contract-ide/src-tauri/src/commands/repo.rs \
                 contract-ide/src/store/graph.ts \
                 contract-ide/src/lib/flow-layout.ts \
                 .planning/demo/contract-ide-demo-spec.md
       ```
  </action>
  <verify>
    From `contract-ide-demo/`:
    - 6 flow contract files present (2 in `.contracts/`, 4 in `.contracts/ambient/`).
    - Each flow's `members` array references uuids that EXIST as other contracts.
    - `git log --oneline | head -1` shows the seed commit.

    From `contract-ide/`:
    - Open contract-ide-demo via IDE — repo loads cleanly (validate_flow_members passes).
    - `sqlite3 <db> "SELECT COUNT(*) FROM nodes WHERE kind='flow'"` returns 6.
    - `sqlite3 <db> "SELECT json_array_length(members_json) FROM nodes WHERE kind='flow' AND uuid LIKE 'flow-de1e7e00%'"` returns 7 for each scenario flow.
    - getFlowMembers('flow-de1e7e00-...-acc...') returns the 7 ordered uuids.
    - layoutFlowMembers returns 7 LayoutEntry rows with y = 0, 120, 240, 360, 480, 600, 720.
  </verify>
  <done>
    6 flow contracts seeded in demo repo at locked SHA; v5 migration persists members_json; getFlowMembers + layoutFlowMembers selectors functional; spec doc documents the FLOW-01 contract list. Phase 13 CHAIN-01 has the data structure + layout primitive it needs to render.
  </done>
</task>

</tasks>

<verification>
- Migration v5 added at end of migrations.rs vec; fresh DB migrates cleanly v1→v5.
- frontmatter.rs accepts kind: flow + optional members; existing non-flow contracts deserialize unchanged.
- scanner.rs persists members_json on flow contracts; NULL on others.
- flow-layout.ts ships layoutFlowMembers with deterministic y-positions; tests pass.
- store/graph.ts ships getFlowMembers selector.
- 6 flow contracts seeded in contract-ide-demo (2 scenario + 4 ambient).
- delete-account flow members chain through the 7 participants per CANVAS-PURPOSE.md.
- delete-workspace flow members chain through the parallel 7 participants anchored at Team Settings.
- 4 ambient flows (signup, checkout, add-team-member, password-reset) provide canvas density.
- validate_flow_members extends the 09-04b validator chain; passes against all 6 seeded flows.
- Locked SHA in `.planning/demo/contract-ide-demo-spec.md` updated to include FLOW-01 seed commit.
- Schema migration is forward-compatible with Phase 13's anticipated additions (no UNIQUE / CHECK constraints that would lock layout-position columns out).
</verification>

<success_criteria>
- FLOW-01: kind:flow + ordered members[] is a permissible contract shape; v5 migration persists it.
- Phase 13 CHAIN-01 unblocked: layoutFlowMembers + getFlowMembers ship the data + position primitives Phase 13 reads.
- 6 demo flows authored at the locked SHA; reset script in 09-05 restores them via git checkout.
- Frontmatter parser remains the single source of truth (frontmatter.rs in src-tauri/) — TS-side type definitions are derived, not parallel.
- Migration version sequence preserved (v1→v5 monotonic, immutable per tauri-plugin-sql contract).
</success_criteria>

<output>
After completion, create `.planning/phases/09-mass-edit-non-coder-mode-demo-repo-seeding/09-04c-SUMMARY.md` documenting:
- Confirmed Phase 10 v4 migration was present at start (precondition for v5).
- Final list of 6 flow contracts authored + their member counts + the trigger UUIDs they reference.
- Resolution table: which 09-04 ambient UUIDs were used as participants in the scenario flows; any new ambient contracts added by this plan to fill gaps.
- Whether validate_flow_members caught any missing-member references during initial authoring + how resolved.
- Migration v5 schema final form (verbatim SQL).
- Frontmatter validation rule: confirmed flow contracts without members raise the persistent banner; non-flow contracts unaffected.
- Locked SHA in spec doc updated; reset script in 09-05 will restore the FLOW-01 seed via git checkout.
</output>
</content>
