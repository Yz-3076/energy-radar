# Prompt for the public stats + privacy policy website

Saved for later, per the user's own instruction — **do not build this yet**.
When it's time: hand the section below to a design pass first (Claude
Design, or the `artifact-design` skill) for visuals, then build the actual
site from that design. Two jobs, one static site, no backend — reads
`data/latest.json`, `data/stats.json`, `data/history/*.ndjson`, and
`data/promotions.json` straight from this repo on GitHub Pages, exactly like
`docs/index.html` already does.

---

Design a small public website for **Energy Radar** — a companion site to a
mobile app that tracks Monster Energy prices and stock across Israeli
stores. The site has two jobs on one domain: a **privacy policy page**
(required before the app can go live on the App Store / Play Store) and a
**public stats/heatmap dashboard** showing off the price data the app
collects. Same visual identity as the app itself.

## Brand & visual language

Reuse Energy Radar's own aesthetic: near-black background (`#060807`),
electric green accent (`#39ff6a`), a dimmer supporting green (`#1c7a3a`) for
secondary UI, white reserved for callout cards so they pop. Energy-drink /
gaming-adjacent mood, high contrast, glowing accents — not a neutral
corporate dashboard. No literal Monster Energy claw-logo reproduction.

## Page 1: Privacy Policy

Plain, honestly-written, no dark patterns. Cover, accurately:

- **What the app collects**: device location, used only on-device to sort
  nearby stores and never transmitted anywhere. Nothing else — no accounts,
  no sign-up, no personal information of any kind is collected or stored on
  any server.
- **What the app stores locally**: drink log, saved stores, alerts, recent
  searches — all in on-device storage only, never uploaded, never seen by
  anyone but the user.
- **What the price data is**: sourced from Israel's own mandatory
  price-transparency law (chains publish these files publicly by law) — not
  scraped from user activity, not personal in any way.
- **Third parties**: name the free API this project optionally calls for
  promotion data (openisraelisupermarkets.co.il) and note it receives no
  personal data from the app, only a product-barcode lookup.
- **No ads, no tracking SDKs, no analytics** (true today — update this
  section the day that changes, don't let it go stale).
- Standard boilerplate sections: children's privacy (not directed at
  children under 13), contact method, "we'll update this page and note the
  date" clause.
- A visible **last-updated date** at the top.

## Page 2: Stats dashboard

Build on top of `docs/index.html`'s existing rollup (store counts,
per-variant listing counts, depletion breakdown) rather than duplicating it
— this can be the more polished, public-facing evolution of that page.

Feature ideas to design against (pick what actually looks good with real
data volume — don't force all of them in):

- **National price heatmap** — map of Israel, colored/sized by cheapest
  Monster price observed per city/region. The single most "wow" visual this
  data can produce.
- **Cheapest chain right now** — small leaderboard, average price per
  chain, refreshed each pipeline run.
- **Price-over-time chart** — pick a flavour, see its national average
  price trend from `history/*.ndjson` (one file per month — fetch however
  many months you want a trend line over).
- **Flavour popularity** — which flavours show up on the most shelves
  nationwide (a proxy for how widely stocked each one is).
- **Stock-health breakdown** — healthy / slowing / likely-out counts from
  the depletion algorithm, as a simple donut or bar.
- **Live deals ticker** — current promotions from `promotions.json`, once
  that's populated (discount rate, chain, expiry) — skip this section
  gracefully if the file is empty.
- **Data transparency strip** — "last updated Xh ago · N chains · M stores
  · fully free, sourced from Israeli law" — this is what makes the whole
  page credible rather than a random claim.
- A few **fun one-line callouts** — "cheapest Monster in Israel right now:
  ₪X at [chain]" — the kind of thing worth sharing as a link.

## Technical notes for whoever builds this later

- Static site, GitHub Pages, same repo — no server, no build step beyond
  what `docs/index.html` already does.
- Read `data/stats.json` for aggregates, `data/history/*.ndjson` for time
  series — already sharded one file per month (see `israel-poc/pipeline.py`),
  so a long trend line means fetching several small files, never one huge one.
- Every number on the page should be traceable to a real file in `data/` —
  no placeholder/fake stats, ever, even for a "coming soon" section.
