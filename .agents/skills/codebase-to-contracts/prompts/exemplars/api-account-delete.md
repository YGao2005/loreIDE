## Intent
The DELETE /api/account endpoint initiates account deletion for the
authenticated user. It delegates the full deletion workflow to
beginAccountDeletion() which enforces the 5 substrate rules captured
from the February 2026 deletion incident. The endpoint returns 204 on
success; the actual purge happens asynchronously after the 30-day grace.

## Role
Account deletion endpoint. Entry point for destructive account lifecycle.
Requires authentication; returns 401 if no valid session. The 5 substrate
rules are enforced inside beginAccountDeletion(), not at the route layer.

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
  - Anonymizes Invoice records (userName, userEmail → "[deleted user]")
  - Archives Stripe customer with metadata.archived
  - Suppresses user from MARKETING_LIST_ID on Mailchimp
  - Sends deletion confirmation email with 24h expiry link
  - Emits audit log entry account.deletion_requested
