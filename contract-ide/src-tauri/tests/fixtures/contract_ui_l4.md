---
format_version: 2
uuid: 22222222-2222-2222-2222-222222222222
kind: UI
level: L4
parent: 11111111-1111-1111-1111-111111111111
neighbors: []
code_ranges:
  - file: src/components/UserTable.tsx
    start_line: 1
    end_line: 60
code_hash: null
contract_hash: null
human_pinned: false
route: null
derived_at: 2026-04-24T00:00:00Z
---

## Examples
GIVEN a populated user list in the database
WHEN the admin navigates to the Users page
THEN each user row shows name, email, status, and action buttons

GIVEN a user with deletedAt set (soft-deleted within grace window)
WHEN the admin views the user list
THEN the row shows a "Pending deletion" badge and no delete action

## Intent
Renders the tabular user list for admin management. Shows active and
pending-deletion users with appropriate actions per user state.

## Invariants
Soft-deleted users remain visible with restricted actions until the
grace window expires and the cleanup job removes them.
The table must paginate at 50 rows to avoid memory pressure.

## Inputs
Accepts a paginated list of UserRecord objects from the parent API L3.
Requires authentication context to render admin-only action buttons.

## Outputs
Renders an interactive table. Row-click navigates to the user detail
view. Action buttons emit events handled by the parent page component.
