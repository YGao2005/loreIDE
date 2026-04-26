## Intent
beginAccountDeletion() orchestrates the full account deletion workflow
honoring all 5 substrate rules from the February 2026 incident. It is the
single implementation point for account deletion — no other code should
directly delete users. Beat 2 agent fills this stub with the 5-rule
implementation.

## Role
Central deletion orchestrator. Called exclusively from DELETE /api/account.
Responsible for sequencing: soft-delete → anonymize invoices → archive
Stripe → suppress mailing list → send confirmation email → audit log.

## Inputs
- `userId: string` — the ID of the user to begin deletion for

## Outputs
- `Promise<void>` — resolves when all 5 substrate rules have been applied
- Throws if the user does not exist (db.user.findUniqueOrThrow will throw)

## Side effects
- Sets User.deletedAt to current timestamp (soft-delete per dec-soft-delete-30day-grace)
- Calls db.invoice.updateMany to anonymize userName and userEmail (per con-anonymize-not-delete-tax-held)
- Calls stripe.customers.update with archived metadata (per con-stripe-customer-archive)
- Calls mailchimp.lists.setListMember to suppress email (per con-mailing-list-suppress-not-delete)
- Sends confirmation email via sendDeletionConfirmationEmail
- Writes to audit log: account.deletion_requested
