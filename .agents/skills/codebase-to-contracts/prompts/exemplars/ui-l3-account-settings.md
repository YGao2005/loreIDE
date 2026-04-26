## Intent
The Account Settings page is where a logged-in customer manages their
profile, billing, notifications, and account-lifecycle actions. Customers
arriving here want to update small pieces of personal data (email, display
name, password) inline and without context-switching to a settings ticket
— except for irreversible actions, which are surfaced in a clearly-named
danger zone at the bottom of the page.

## Role
The user-facing primary surface for "manage my account." Other surfaces
(billing, notifications) are children of this surface. The danger-zone
affords account-level destructive actions; non-destructive Settings
interactions live above it.

## Notes
Historical decision (Q4 2025, under priority `reduce-onboarding-friction`):
Settings page interactions should be inline and friction-free; no modal
interrupts on save or update actions. This decision predates the current
priority `compliance-first` (active since 2026-04-01) — a future review
may need to narrow the no-modal rule to non-destructive actions only.
