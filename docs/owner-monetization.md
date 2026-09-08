# Store-owner paid listings + featured pins

A store/kiosk owner can pay to get a featured pin on the map (gold outline,
merged into the live dataset alongside the scraped/mock stores), funded by
them instead of the end user. Implemented as a minimal but fully working
prototype — verified end-to-end, not just designed.

## Flow

1. **Submit** ([owner.html](../app/owner.html)) — store name, address, a
   flavor+price list, and a shelf photo. `POST /api/listings` on the
   backend ([server/server.js](../server/server.js)) stores it as
   `pending_verification`.
2. **Verify** — `POST /api/listings/:id/verify` runs the photo through
   [`verifyStorePhoto()`](../server/verification.js), a deliberately
   pluggable function. **No AI vision provider is wired up yet** — this was
   left as an open decision (Claude's multimodal API is the natural
   default, reusing existing Anthropic access, but nothing is implemented
   against it). The honest default always comes back `pending` for a human
   to review, never an auto-pass. A `force-verify` dev-only endpoint exists
   to unblock testing the rest of the pipeline without a real reviewer —
   gate it behind real admin auth (or delete it) before this is anything
   but a local demo.
3. **Subscribe** — once verified, `POST /api/listings/:id/subscribe`
   creates a Stripe Checkout session (test mode) for a recurring monthly
   charge. No `STRIPE_SECRET_KEY` configured (see
   [server/.env.example](../server/.env.example))? It falls back to a
   clearly-labeled mock checkout so the whole pipeline still runs without
   needing real Stripe credentials yet.
4. **Featured** — Stripe's webhook (or the mock-checkout endpoint in mock
   mode) flips `featured: true`. The mobile app pulls the same
   `GET /api/listings` in [`mobile/src/data/api.ts`](../mobile/src/data/api.ts)
   and merges verified+featured rows into the map as gold pins, dropping any
   listing that still has no coordinates rather than placing it at a fake
   point — the geocoding gap below, made visible instead of papered over.
   The web prototype does the same through `loadFeaturedListings()` in
   [app/src/main.js](../app/src/main.js), merging them into the same
   Supercluster index as the scraped/mock stores — gold outline rather than
   the green "recently sold" one, and a "★ Featured" tag in the info bubble.

## Verified working (2026-09-05)

Ran the full pipeline against the live server: submit with a real photo
upload → stayed `pending_verification` after `/verify` (correct — no AI
provider configured) → `force-verify` → mock `/subscribe` → mock checkout
completion → `featured: true`. Reloaded the map and clicked the resulting
gold pin; the bubble read `"FEATURED LISTING · ★ FEATURED | Test Kiosk"`
with the submitted flavors/prices.

## Known gaps, on purpose (prototype, not production)

- **Storage** is a single JSON file ([server/store.js](../server/store.js)),
  fine for one dev process, not for concurrent real traffic.
- **No real geocoding** for owner-submitted addresses yet — featured
  listings render at a randomized point near the demo cluster rather than
  their real address. Needs the same geocoding step called out for
  crowdsourced sightings in [us-data-sources.md](us-data-sources.md).
- **AI verification provider is unresolved** — flag this again before
  shipping anything real; right now every submission needs a human.
- **`force-verify` and mock-checkout are dev-only escape hatches** — both
  need to be removed or locked behind real auth before this goes anywhere
  near production.
- A moderate `qs`/`body-parser` advisory comes in transitively through
  Express 4; `npm audit fix` alone doesn't clear it (needs a major Express
  bump). Not urgent for a local prototype, worth revisiting before deploy.
