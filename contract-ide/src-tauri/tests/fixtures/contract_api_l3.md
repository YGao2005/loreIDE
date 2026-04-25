---
format_version: 2
uuid: 11111111-1111-1111-1111-111111111111
kind: API
level: L3
parent: 00000000-0000-0000-0000-000000000001
neighbors: []
code_ranges:
  - file: src/api/users.ts
    start_line: 1
    end_line: 80
code_hash: null
contract_hash: null
human_pinned: false
route: /api/users
derived_at: 2026-04-24T00:00:00Z
---

## Intent
Handles all user management API endpoints including creation, retrieval,
updating, and soft-deletion with a 30-day grace window.

## Inputs
Accepts JSON request bodies with user fields validated against the
UserSchema definition. All fields must be present unless marked optional.

## Outputs
Returns standardized JSON response envelopes with data, errors, and
pagination metadata where applicable.

## Examples
GIVEN a valid POST /api/users request with all required fields
WHEN the request is authenticated
THEN a new user record is created and a 201 response returned

GIVEN a DELETE /api/users/:id request
WHEN the user exists and requester has admin rights
THEN the user is soft-deleted with deletedAt set, not hard-deleted

## Invariants
All mutation endpoints must be behind auth middleware.
Soft-delete is the only supported deletion strategy.
Email addresses must be unique across active accounts.
