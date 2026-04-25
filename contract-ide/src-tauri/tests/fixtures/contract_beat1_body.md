## Intent
The Account Settings page needs a way for a customer to delete
their own account without contacting support. Today, every delete
request is a manual ticket, and we have a backlog from the GDPR
and CCPA windows. The customer who started the latest thread
clicked "delete" once already, was charged the next month anyway,
and is unhappy.

## Role
A primary action at the bottom of the danger-zone section of the
Account Settings page.

## Examples
GIVEN a logged-in customer on the Account Settings page
WHEN they click Delete Account and confirm via the email link
THEN their account is marked for deletion with a 30-day grace window
  AND they are signed out

GIVEN a customer who clicked Delete Account by mistake
WHEN they don't click the email confirmation link within 24 hours
THEN nothing changes and their account remains fully active
