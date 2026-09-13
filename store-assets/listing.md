# Play Store listing — Energy Radar

Copy-paste source for the Play Console listing. Character limits are
Google's; counts are checked by `scripts/check_listing.py`.

---

## App name  (max 30)

```
Energy Radar
```

## Short description  (max 80)

```
Real shelf prices for Monster Energy, from the chains' own published files.
```

## Full description  (max 4000)

```
Energy Radar shows you where Monster Energy is on the shelf near you, and what it actually costs.

Israeli supermarket chains are legally required to publish their prices as machine-readable files, several times a day. Energy Radar reads those files directly, matches the Monster barcodes, and puts every branch on a map — so the prices you see are the chains' own published numbers, not crowd guesses or an out-of-date list someone typed in once.

WHAT YOU GET

• A map of shelves near you, sorted by walking distance
• The real price per can at each branch, and how long ago that price was published
• A crown on the cheapest shelf on your screen, so you can see the best price at a glance
• Current deals — buy-2 offers and discounts — shown only at the branches actually running them
• 13 flavours tracked, including ones that rarely make it to Israeli shelves
• Search by flavour, store, or barcode
• A private tally of what you've drunk, if you want one

HOW THE PRICES WORK

Every price is tagged with where it came from and when. A price file tells you what a register charges — it can't tell you whether the last can just left the shelf, and chains don't always publish the moment something sells out. Energy Radar says plainly how fresh each number is instead of pretending to know more than it does.

Coverage grows as chains publish. Some chains publish reliably, some don't publish at all, and that's visible in the app rather than hidden.

DEALS

Promotions come from the same official feeds and are matched to the specific branch running them. If a shop isn't running a deal, Energy Radar doesn't invent one — a store with nothing on offer simply shows nothing.

PRIVACY

There are no accounts and no sign-up. Your location is used on your device, to sort what's near you, and is never sent anywhere. There is no advertising, no tracking, no analytics, and no crash reporting. Nothing you do in the app is measured or reported. Deleting the app removes everything it stored.

Full policy: https://yz-3076.github.io/energy-radar/privacy.html

---

Energy Radar is an independent project. It is not affiliated with, endorsed by, sponsored by, or connected to Monster Energy Company or any retail chain. All trademarks belong to their respective owners. Product names are used only to identify the drinks whose published prices the app reports.
```

---

## Other Play Console fields

| Field | Value |
|---|---|
| Category | Shopping |
| Tags | Shopping, Food & Drink, Maps & Navigation |
| Contact email | *(your email — required, shown publicly)* |
| Website | `https://yz-3076.github.io/energy-radar/` |
| Privacy policy | `https://yz-3076.github.io/energy-radar/privacy.html` |
| Content rating | Everyone — no user-generated content shown to others, no ads, no purchases |

## Data safety form — answers

These must match the privacy policy or Google will flag the mismatch.

- **Does your app collect or share user data?** → **No**
- Location: used, **not collected** (never leaves the device, never transmitted)
- No data types collected, no data shared with third parties
- Data encrypted in transit: N/A — no user data is transmitted
- Users can request deletion: N/A — no account, nothing stored off-device

If Play insists on a Location declaration: *approximate and precise location, used for App functionality, processed ephemerally on-device, not collected or shared.*

## Screenshots

`store-assets/play-listing/` — six 1080×1920 images. Suggested order:

1. `01-map.png` — the map, with the crowned cheapest pin
2. `02-store-deals.png` — a store page with real deals
3. `05-search.png` — cheapest-right-now list
4. `03-flavour.png` — a flavour page
5. `04-store-local.png` — a local branch
6. `06-onboarding.png` — the radar intro

## App icon

`store-assets/icon-512.png` — 512×512, RGB. Downscaled from the 1024px
master and flattened, since Play rejects an alpha channel on the icon.

## Feature graphic

`store-assets/feature-graphic.png` — 1024×500, RGB, no alpha. Generated
externally, then cropped to Play's exact 2.048 ratio before scaling
rather than stretching a 2.055 source into the box. Title and tagline sit
inside the middle 60%, so neither is lost when Google crops the banner
differently across its surfaces; the price pins near the edges are
decorative and safe to lose.

## Open risk on this listing

The short and full descriptions both name Monster Energy. That is
nominative use — the app reports published prices for a product and has
to say which product — and the disclaimer above is deliberately explicit
about non-affiliation. It is now the app's main remaining trademark
exposure, together with the icon. The photographic 3-D can textures that
used to sit alongside it are gone — the cans are drawn in-house — and the
icon was a deliberate decision on 2026-09-14 to ship as-is and change it
later if anyone objects.
