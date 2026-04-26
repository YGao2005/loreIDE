# Demo Sidecar Contracts — Required Phase 9 Output

Phase 13 plan 13-10a expects the following `.contracts/*.md` files in the demo repo
(`contract-ide-demo`), seeded as part of Phase 9 SC 8 + SC 7. If any are missing,
substrate retrieval and chain rendering will fail during the 4-beat rehearsal.

## Surfaces (L3 contracts)

- `account/settings.md` — Account Settings page (kind: ui, route: /account/settings)
  - Frontmatter: `code_ranges: [{file: 'app/account/settings/page.tsx', startLine: ..., endLine: ...}]`
- `team/settings.md` — Team Settings page (kind: ui, route: /team/[slug]/settings)

## Atom contracts (L4)

- `account/danger-zone-button.md` — kind: ui, parent: account/settings.md, code_ranges anchors to a SECTION (the danger-zone section in page.tsx)

## Backend participants (L3)

- `api/account/delete.md` — kind: api, method: POST, path: /api/account/delete, with `## Inputs` / `## Outputs` / `## Side effects` populated
- `lib/account/begin-account-deletion.md` — kind: lib
- `external/stripe-customers-update.md` — kind: external
- `external/mailchimp-suppress.md` — kind: external
- `lib/account/send-deletion-confirmation-email.md` — kind: lib

## Flow contracts (Phase 9 FLOW-01)

- `flows/delete-account.md` — kind: flow, members: [<account/settings uuid>, <api/account/delete uuid>, <lib/account/begin-account-deletion uuid>, <stripe uuid>, <mailchimp uuid>, <send-email uuid>]
- `flows/delete-workspace.md` — kind: flow (Beat 4)

## Validation

Run plan 13-11's rehearsal harness with `--verify-contracts` flag. Missing contracts
will be listed; Phase 9 must provide before demo runs.
