# references/output-schema.md — canonical sidecar output shapes

This document is the byte-shape contract for what the skill emits. Every excerpt below is pulled verbatim from `contract-ide-demo/.contracts/` and annotated inline. Stages 2 + 3 + 5 must produce output that matches these shapes.

The JSON Schemas under `../schemas/` are the machine-checkable form of these contracts; this file is the human-readable form, with rationale.

## L4 UI atom (a1000000-…md)

L4 atoms have minimal frontmatter (no rollup), and a body composed of `## Intent` / `## Role` / `## Examples`. Examples may be empty at bootstrap.

```yaml
---
format_version: 3              # always 3 for non-flow contracts at bootstrap
uuid: a1000000-0000-4000-8000-000000000000
kind: UI                       # one of: UI | API | data | job | cron | event | lib | external | flow
level: L4                      # one of: L0 | L1 | L2 | L3 | L4
parent: a0000000-0000-4000-8000-000000000000   # parent L3 UUID
neighbors: []                  # always [] at bootstrap (Phase 13 sidebar derives)
code_ranges:
  - file: src/app/account/settings/page.tsx
    start_line: 49             # tightened in Stage 4 to wrap the JSX element exactly
    end_line: 55
code_hash: null                # null at bootstrap; Phase 6 derivation fills on first re-derive
contract_hash: null            # null at bootstrap
human_pinned: false            # default; user can pin via Inspector
route: /account/settings       # the L3 parent's route, copied for L4 convenience
derived_at: null               # null at bootstrap
section_hashes: {}             # empty at bootstrap; Phase 8 lazy-migrates on first write
rollup_inputs: []              # always [] at bootstrap
rollup_hash: null              # null at bootstrap
rollup_state: untracked        # IDE upgrades to "fresh" on first PROP-02 recompute
rollup_generation: 0           # starts at 0
---
```

Body (the `##` order is fixed — Intent first, Role second, kind-specific sections after):

```markdown
## Intent
The danger-zone region of the Account Settings page hosts irreversible
actions affecting the customer's account. v1 ships with the area present
but no actions installed; the PM-led Beat 1 contract edit triggers the
first action (delete-account).

## Role
Container for primary destructive actions on the Account Settings surface.
Each action is its own L4 atom in time; v1 has zero atoms inside this
container.

## Examples
(none yet — Beat 1 PM types the first example into this section)
```

Load-bearing notes:

- `## Intent` MUST be >= 50 chars. The Stage 3 `claude -p --json-schema contract-body.json` call enforces this. Empty `(none yet)` Examples blocks ARE acceptable.
- `## Role` MUST be >= 30 chars.
- The schema mandates `## Examples` only when `kind: UI` AND `level: L4`. Other kinds omit it.

## L3 backend API (ambient/api-account-delete-001.md)

Backend kinds (API / lib / data / external / job / cron / event) carry the BACKEND-FM-01 body shape: `## Inputs`, `## Outputs`, `## Side effects` — each a non-empty bulleted list.

```yaml
---
format_version: 3
uuid: e1000000-0000-4000-8000-000000000000
kind: API
level: L3
parent: f2010100-0000-4000-8000-000000000000   # parent area or flow UUID
neighbors: []
code_ranges:
  - file: src/app/api/account/route.ts
    start_line: 1
    end_line: 20
code_hash: null
contract_hash: null
human_pinned: false
route: DELETE /api/account     # for API: METHOD + path; for non-API backend: null
derived_at: null
section_hashes: {}
rollup_inputs: []
rollup_hash: null
rollup_state: untracked
rollup_generation: 0
---
```

Body:

```markdown
## Intent
The DELETE /api/account endpoint initiates account deletion for the
authenticated user. It delegates the full deletion workflow to
beginAccountDeletion() which enforces the 5 substrate rules captured
from the February 2026 deletion incident.

## Role
Account deletion endpoint. Entry point for destructive account lifecycle.
Requires authentication; returns 401 if no valid session.

## Inputs
- `Authorization: Bearer <token>` — session token of the authenticated user
- Request body: `{}` — no body required; the user is derived from the session

## Outputs
- `204 No Content` — deletion initiated successfully
- `401 { error: 'unauthorized' }` — no valid session
- `409 { error: 'already_deleted' }` — user already has a deletedAt set

## Side effects
- Calls beginAccountDeletion(userId) which:
  - Sets User.deletedAt (soft-delete)
  - Anonymizes Invoice records
  - Archives Stripe customer with metadata.archived
  - Suppresses user from MARKETING_LIST_ID on Mailchimp
  - Sends deletion confirmation email with 24h expiry link
  - Emits audit log entry account.deletion_requested
```

Load-bearing notes:

- Each item in `## Inputs` and `## Outputs` MUST be a string >= 5 chars (`schemas/contract-body.json` enforces `minLength: 5`). This blocks empty bullets that would pass a permissive parser but fail the Rust `backend_section_validator.rs` (Phase 14 revision Issue 6 — parity).
- `## Side effects` MAY be empty (`minItems: 0`). Pure functions legitimately have none.
- `route` for API kinds: `METHOD path` (with space). For other backend kinds: `null`.

## Flow contract (flow-delete-account.md)

Flow contracts are kind: `flow`, format_version: `5`, with a `members:` ordered list.

```yaml
---
format_version: 5              # always 5 for flow contracts (FLOW-01)
uuid: flow-de1e-0000-4000-8000-acc000000000
kind: flow
level: L2                      # flows are always L2
parent: f2000000-0000-4000-8000-000000000000  # area UUID
neighbors: []
members:                       # ordered list — first element is the trigger
  - a0000000-0000-4000-8000-000000000000      # trigger (UI L3 page)
  - e1000000-0000-4000-8000-000000000000      # API endpoint
  - e2000000-0000-4000-8000-000000000000      # lib orchestrator
  - e5000000-0000-4000-8000-000000000000      # data write
  - e7000000-0000-4000-8000-000000000000      # external (Stripe)
  - e8000000-0000-4000-8000-000000000000      # external (Mailchimp)
  - ec000000-0000-4000-8000-000000000000      # email send
code_ranges: []                # flows have no source code
code_hash: null
contract_hash: null
human_pinned: false
route: null                    # always null for flows
derived_at: null
section_hashes: {}
rollup_inputs: []
rollup_hash: null
rollup_state: untracked
rollup_generation: 0
---
```

Body:

```markdown
## Intent
The delete-account flow runs when a logged-in customer deletes their own
account from the Account Settings page.

## Role
Customer-facing account-lifecycle flow. The trigger is the Account Settings
page; the chain runs from button click through soft-delete + Stripe archive +
Mailchimp suppression + confirmation email.

## Notes
Member ordering is invocation order:
1. Account Settings page (trigger UI) — user clicks Delete Account
2. POST /api/account/delete (API endpoint) — soft-delete kicks off
3. beginAccountDeletion lib — orchestrates the full 5-rule chain
4. db.user.update — sets User.deletedAt (soft-delete marker)
5. stripe.customers.update — archives customer (NOT customers.del)
6. mailchimp.suppress — sets list status to unsubscribed
7. sendDeletionConfirmationEmail — email-link confirmation (24h expiry)
```

Load-bearing notes:

- `members` MUST have >= 2 entries (trigger + at least one participant). `schemas/flow.json` enforces this.
- Cross-flow shared services (Stripe, Mailchimp, db.user.update) are emitted ONCE as canonical sidecars and referenced by UUID in every flow's `members` list. Re-emission would break referential integrity.
- The body uses `## Notes` instead of `## Role`-after-Intent for backend kinds; flows are documented narratively because their participants carry the structured BACKEND-FM-01 shape themselves.
