# Staying current: how the Monster data keeps refreshing

The question this answers: once the app is on a phone, **what makes the prices
on it stop being yesterday's prices?**

Two things feed it, on two very different clocks.

---

## 1. The chain price files — the backbone, and now actually running

This is the one that does the heavy lifting, and it is the reason this app is
possible in Israel and hard everywhere else.

Israel's **Food Competition Promotion Law (Price Transparency Regulations),
2014** obliges every retail chain with 3+ branches to publish, several times a
day, machine-readable files of every product it sells, per store, with the
current price. It is a legal obligation, not a courtesy — chains have been
fined for letting the files go stale.

So we do not ask the chains for anything. We read what they are already
required to publish. This runs for real, on a schedule, today:
[`.github/workflows/fetch-prices.yml`](../.github/workflows/fetch-prices.yml)
triggers [`israel-poc/pipeline.py`](../israel-poc/pipeline.py) every 3 hours on
GitHub's own infrastructure — not a server we run, not your laptop, whether
anyone has the app open or not.

```
every 3 hours:
  1. download   PriceFull*.gz   (one file per store)   ← current prices
                Stores*.gz      (one per chain)        ← branch list + addresses
  2. filter     ItemCode against the known Monster barcode table (variants.json),
                plus an ItemName regex for SKUs not yet in that table
  3. resolve    StoreID → branch name + address (from Stores)
  4. geocode    address + ZIP → lat/lng, via OpenStreetMap Nominatim
                (cached forever in data/geocode-cache.json — addresses don't move)
  5. append     one line per (store, variant) to data/history/YYYY-MM.ndjson
                — never overwritten, one file per month, this is the
                actual database (load_history() reads every month back
                as one combined list)
  6. assess     depletion per (store, variant) from that history — see below
  7. write      data/latest.json — the current snapshot, shaped exactly like
                the app's Store[] type, committed straight into the repo
```

The app fetches `data/latest.json` directly off GitHub's CDN
(`raw.githubusercontent.com`) — see
[`mobile/src/data/api.ts`](../mobile/src/data/api.ts). No server to run, no
server to go down; a fetch failure just falls back to the bundled seed data.

**What each field is worth:**

| Field | What it actually tells you |
|---|---|
| `ItemPrice` | What the register will charge. Legally kept fresh. Trustworthy. |
| `LastSaleDateTime` | **The freshness signal — and now the depletion signal too.** Not a price — the last time that store actually rang up that item. See "the depletion algorithm" below for how a run of these over time turns into "likely out of stock." |
| `Stores` | Branch name and address. Changes rarely; geocode once and cache. |

**What it can never tell you:** whether the can is physically on the shelf
right now. There is no stock field in the feed at all.

**Coverage, honestly, right now: Shufersal only.** ~49 chains are legally
required to comply (Rami Levy, Victory, Osher Ad, Yellow, Dor Alon among
them), and [`il-supermarket-scraper`](https://github.com/OpenIsraeliSupermarkets/israeli-supermarket-scarpers)
can reach most of their portals — but Rami Levy's own endpoint
(`url.retail.publishedprices.co.il`) currently fails to resolve in DNS at all,
confirmed against Google's own resolver, not a problem on our end. It's
commented out in `pipeline.py`'s `CHAINS` list with a note to re-add it once
that resolves. Adding any other chain from the list above is a one-line
change — the pipeline doesn't care which chain, `ScraperFactory` handles all
of them the same way.

### The depletion algorithm

`israel-poc/depletion.py` turns the history of `LastSaleDateTime` for one
(store, variant) into one of four states: `insufficient_data`, `healthy`,
`slowing`, `likely_out`. The idea: a store that's been ringing up a flavour
every few hours for days and then goes completely quiet almost always means
the shelf is empty, not that it suddenly got unpopular — Monster is a
grab-and-go, habitual purchase. This is a plain, readable rule over real data,
not a trained model — there's no "was it actually restocked" label anywhere
to train one on. Needs at least ~18 hours of history before it says anything
at all rather than guessing early.

---

## 2. Store owners — paid, verified, refreshes when they say so

A shop pays for a featured listing, submits its own prices and a shelf photo,
gets verified, and appears as a gold pin. See
[owner-monetization.md](owner-monetization.md). This is the revenue side, and
it is also the highest-intent data: the owner knows exactly what is on the
shelf.

**Cadence:** whenever the owner updates it. Stale owner listings should expire
back to feed prices rather than sit there looking authoritative — that rule is
not written yet.

*(A third source — hunters logging sightings in-app — existed earlier in this
project and was cut: it added real coverage for kiosks and unbranded stations
the law doesn't reach, but asking users to report shelf stock turned out to be
the wrong ask for this app. What replaced it is client-side only: a plain
recency-based stock estimate per listing — [`mobile/src/data/stock.ts`](../mobile/src/data/stock.ts)
— for whenever the server-computed depletion status isn't available yet for
a given row.)*

---

## Outside Israel

There is no equivalent law, so the pipeline above simply does not exist for
other countries. The honest options are surveyed in
[us-data-sources.md](us-data-sources.md): Kroger's official developer API for
its own banners, crowdsourcing for everything else, and delivery-platform
scraping as a ToS-risky enrichment. Until one of those is built, the app tells
the user plainly when they are standing outside coverage instead of showing an
empty map.

---

## What the app on the phone does today

Live, for real, for Shufersal: the app fetches `data/latest.json` on launch,
which a GitHub Actions job has kept refreshed every 3 hours since it was set
up. When that fetch fails or hasn't run yet, it falls back to the bundled seed
data (synthetic density around a handful of real 2026-09-05 branches) rather
than showing an empty map.

The live and bundled datasets are **not merged** — live data, when it loads,
replaces the seed set outright rather than layering on top of it, since the
two describe overlapping real branches under different ids and merging them
risked showing the same physical store twice. That means real coverage starts
*narrower* than the curated seed data (one chain vs. several) and grows as
more chains get added to `pipeline.py`'s `CHAINS` list — an honest tradeoff of
a real transition, not a bug.

Worth deciding next: how long a `likely_out` row should keep showing on the
map before it's hidden entirely, and whether the stats dashboard
([`docs/index.html`](index.html), GitHub Pages) needs anything beyond the
current bar-chart rollups once there's enough history to show real trends
over time.
