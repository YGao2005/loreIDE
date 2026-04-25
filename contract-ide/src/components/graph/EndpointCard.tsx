/**
 * Phase 13 Plan 04 — EndpointCard.
 *
 * Thin re-export of ServiceCard restricted to `kind: 'api'` for IDE-friendly
 * typing and call-site clarity.
 *
 * Why this thin file exists: when a parent component knows it's rendering an
 * HTTP endpoint specifically, importing `EndpointCard` reads more naturally
 * than `ServiceCard` and the IDE can hint that `method` + `path` should be
 * provided. The actual rendering logic lives in ServiceCard — duplicating it
 * here would create a synchronisation hazard.
 *
 * If a future need arises for backend-only repos with richer HTTP-specific
 * visualisation (e.g. request/response example tabs, OpenAPI-generated curl
 * snippets), promote the HTTP-specific UI into this file. For Phase 13's
 * demo, ServiceCard's kind='api' branch already covers method-colored badge +
 * monospace path + Stripe-API-docs-style schemas.
 */

export { ServiceCard as EndpointCard } from './ServiceCard';
export type {
  ServiceCardData as EndpointCardData,
  ServiceCardMethod as EndpointCardMethod,
} from './ServiceCard';
