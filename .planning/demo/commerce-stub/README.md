# vercel/commerce — Shopify Stub

Patches that let `vercel/commerce` run with zero external services (no Shopify Partners dev store, no Storefront API token). The homepage, PDP, search, and collection routes all render real product data served from in-process fixtures.

## Why we stubbed instead of using a real Shopify dev store

As of **January 1, 2026**, Shopify disabled the "create new custom apps" path that previously produced Storefront API tokens for Partner dev stores. The Partners route now requires transferring the store to a merchant account before tokens can be issued — not usable for a hackathon.

Stubbing is also strictly better for the demo:
- No external API dependency — demo records identically every time
- No creds to rotate, no rate limits, no Shopify outages
- Judges can see Contract IDE editing "the Vercel commerce template" they recognize without us standing up any backend

## How to apply

Starting from a fresh clone of `vercel/commerce`:

```bash
git clone https://github.com/vercel/commerce.git demo-repo/vercel-commerce
cd demo-repo/vercel-commerce
pnpm install

# Copy the stubbed files from .planning/demo/commerce-stub/
cp ../../.planning/demo/commerce-stub/fixtures.ts   lib/shopify/fixtures.ts
cp ../../.planning/demo/commerce-stub/index.ts      lib/shopify/index.ts
cp ../../.planning/demo/commerce-stub/next.config.ts next.config.ts
cp ../../.planning/demo/commerce-stub/env.local      .env.local

pnpm dev
# → http://localhost:3000 renders Acme products from fixtures
```

## What changed

- **`lib/shopify/fixtures.ts`** (new) — 8 Acme products, 3 collections, 2 menus, in-memory cart. Product images served from `picsum.photos` (deterministic seed → stable images).
- **`lib/shopify/index.ts`** — every exported provider function short-circuits with fixtures when `SHOPIFY_STORE_DOMAIN` is empty. The real Shopify path is unchanged; setting the env var re-enables the live client.
- **`next.config.ts`** — added `picsum.photos` and `fastly.picsum.photos` to `images.remotePatterns` so `next/image` accepts the placeholder images.
- **`.env.local`** — Shopify vars set to empty strings (not the placeholder in `.env.example`, which would make `!endpoint` false and hit the real API).

## Smoke-tested routes

| Route | Status |
|---|---|
| `/` | 200 — homepage with three-up featured + carousel |
| `/search` | 200 — all products grid |
| `/search/apparel` | 200 — filtered collection |
| `/product/acme-hoodie` | 200 — PDP with price, size selector, images |
| Add-to-cart | In-memory — cart count updates; no checkout |

## Known limits (acceptable for demo)

- Cart state is per-process, not per-cookie — restarting the dev server clears it. Fine.
- Checkout URL is a fake `example.com` — we don't demo the checkout step.
- Pages (`/about`, etc.) return empty body — we don't demo those pages.

## If we ever need live Shopify back

Set `SHOPIFY_STORE_DOMAIN` and `SHOPIFY_STOREFRONT_ACCESS_TOKEN` in `.env.local`. Every fixture guard is of the form `if (!endpoint) return fixture...`, so the live path engages automatically.
