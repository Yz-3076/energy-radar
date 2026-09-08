# USA: options for finding a Monster can's variant, price, and store

Status: research only, nothing built yet. Unlike Israel, there is no legal
mandate and no single strong answer — this is a survey of every real avenue
found, ranked by how usable each actually is.

## Why Israel's approach doesn't transfer

Israel's pipeline works because a 2014 law *forces* publication. The US has
no equivalent, and 2026's state-level activity is pointed the opposite way:
100+ bills across 33 states this year are about **banning or disclosing
"surveillance pricing"** (personalized/algorithmic pricing using shopper
data) — not about publishing open per-store product catalogs. New Jersey,
Maryland, and Connecticut have banned surveillance pricing outright in 2026.
None of it produces a machine-readable feed of "store X has product Y at
price Z." So there is no direct equivalent to build against — the options
below are all substitutes of varying quality.

## Option 1 — Kroger Developer API (real, official, free)

- Self-service registration at `developer.kroger.com` — no business
  approval needed, unlike most retailer APIs.
- OAuth2 `client_credentials` flow (no end-user login required for
  public/non-cart data).
- **Locations API**: find a specific store by ZIP → `location_id`.
- **Products API**: search by term (e.g. "monster energy") + `location_id`
  → returns the live price at that specific store.
- Covers Kroger's own banners: Kroger, Ralphs, Fred Meyer, Fry's, King
  Soopers, Smith's, QFC, Harris Teeter, and others — a meaningful chunk of
  US grocery, but only that one company.
- **Action needed from you**: register your own app to get a
  `client_id`/`client_secret` — this can't be done on your behalf. Once you
  have one, the same PoC pattern used for Shufersal applies directly here.

## Option 2 — Delivery platforms as a de facto inventory/price database (new finding)

Delivery apps need real per-store, per-item pricing to fulfill orders, which
makes them an unintentional but genuinely broad price database — and
critically, **this is the one avenue that reaches gas-station convenience
stores**, which nothing else here does at scale:

- **Instacart** delivers from ~1,400+ grocery banners *and*, since a 2023+
  partnership, **~6,000 7-Eleven stores nationwide** (7-Eleven has since
  acquired Speedway, ~3,900 more fuel/convenience locations). Products are
  fetched per `warehouse_id`/`zone_id` via an internal endpoint pattern like
  `instacart.com/api/v2/items?warehouse_id=...&zone_id=...`; hobbyist
  wrappers exist on GitHub (e.g. `InstacWrapper`) documenting this.
- **DoorDash** independently partners with **Circle K** and **Wawa** (plus
  its own 7-Eleven deals), covering a different slice of gas-station
  convenience.
- **Caveat, and it's a real one**: these are *unofficial/reverse-engineered*
  endpoints, not sanctioned public APIs. Prices shown often carry a delivery
  markup over shelf price (needs a correction factor or an explicit "delivery
  price, may differ in-store" label), and scraping these endpoints is likely
  against each platform's Terms of Service — this is a build-it-at-your-own-risk
  option, not a compliant integration, and could get an IP/account blocked
  or draw a cease-and-desist if done at scale/commercially. Flag this
  explicitly to yourself as a legal/ToS tradeoff before relying on it,
  distinct from Kroger's sanctioned public API.

## Option 3 — Flipp (weekly circulars) — promo prices only

- Flipp aggregates digital weekly ads for a huge retailer list — Walmart,
  Target, Kroger, Costco, Lidl, and many regional chains, via an official
  partner API plus third-party scrapers (e.g. an Apify "Flipp Scraper").
- **Real limitation**: this only surfaces items currently in a retailer's
  *promotional* circular. Monster Energy would only show up when it's on
  sale that week — not as an always-on catalog lookup. Useful as a
  "there's a Monster deal at Store X this week" signal, not a general
  price database.

## Option 4 — Google Local Inventory Ads / Pointy (long-tail, small stores)

- Google's Local Inventory program (formerly the standalone "Pointy"
  hardware/service, now merged in) lets small retailers plug their
  point-of-sale (Square, Clover, Lightspeed, etc.) into Google Shopping,
  so a barcode scan at checkout becomes a public "in stock at [store name]"
  listing on Google.
- This is the one path that could realistically surface **independent gas
  stations and kiosks** that no chain-level API or delivery platform
  reaches — but only for the subset of small merchants who've opted into
  Local Inventory / use a supported POS.
- Not directly queryable as a clean API by us — third-party scrapers of
  Google's "nearby stores" shopping results exist (e.g. SerpApi's Nearby
  Results / Immersive Product Stores endpoints, paid), which return store
  name, distance, and price per product per location. Same caveat as
  Option 2: this is scraping a Google-surfaced result, not a first-party
  data agreement.

## Option 5 — Crowdsourcing (the fallback that covers everything else)

Precedent already exists and works commercially: **Basket** (crowdsourced
grocery price comparison, updates from users' own shopping trips) and
**Fetch Rewards** (receipt-scanning for rewards, which is itself a receipt
→ store/item/price pipeline) both validate that consumers will submit this
data voluntarily. For Walmart, Target, independent stores, and any gas
station not covered by Option 2, this is the only remaining source: your
original barcode-scan + price + map-pin flow.

## Not viable for this app (noted for completeness)

- **NielsenIQ / Numerator retail scanner panels**: real per-SKU sales data
  exists here, but it's enterprise/research-licensed, expensive, and
  aggregated for market research — not a live per-store lookup a consumer
  app can query.
- **Walmart / Target public APIs**: don't exist for price lookup; their
  developer platforms are seller/marketplace-only (managing your own
  listings), not for reading arbitrary product prices.

## Recommendation

Layer these by reliability, in this order:

1. **Kroger API** where the store is a Kroger banner — official, real,
   worth building first since it needs no ToS gray area.
2. **Crowdsourced sightings** as the universal fallback — required
   regardless, since nothing else covers Walmart/Target/independents.
3. **Instacart/DoorDash scraping** as an optional enrichment layer,
   specifically valuable for gas-station convenience coverage — but treat
   it as higher-risk/unofficial and gate it behind a clear internal flag so
   it can be turned off if it causes problems.
4. **Flipp** as a "deal alert" feature layered on top later, not a core
   price source.
5. Local Inventory/Google Shopping scraping is the lowest priority — most
   effort for the narrowest (independent-kiosk) payoff.

Every non-crowdsourced, non-Kroger source above should be tagged
`source: unofficial_scrape` in the data model, separate from
`source: official_feed` (Israel) and `source: official_api` (Kroger), so
the app can be honest about confidence/legal footing per row if this ever
needs to be revisited (e.g. if a platform blocks the scraper).
