# Sample App — Working Notes

A small fixture used by ingest-history.test.mjs to verify Stage 0.5 discovery + hash-skip + LLM-call dispatch.

## Decisions

- **Soft-delete users via `deletedAt` column.** Hard-delete breaks the FK chain to invoices and audit log entries, both of which need to survive user deletion for tax / compliance retention.
- **Postgres over Dynamo for the order table.** We chose Postgres because the dominant query shape is range scans over `(user_id, created_at)` — Dynamo's GSI design forces hot-key issues at our cardinality.
- **No client-side error boundaries on auth pages.** A crashed login page should show the platform 500, not a fallback that masks an actual outage.

## Open questions

- Should we cache contract bodies in MCP retrieval, or re-fetch on every query? Caching trades freshness for latency; we don't yet know how often contracts change in practice.

## Conventions

- Tailwind only; no inline styles.
- All `lib/*.ts` modules export pure functions.
