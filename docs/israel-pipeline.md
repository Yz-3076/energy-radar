# Israel: finding a Monster can's variant, price, and store

Status: proof of concept validated with live data on 2026-09-05 against
Shufersal, then turned into the real running pipeline
([`../israel-poc/pipeline.py`](../israel-poc/pipeline.py)) on a 3-hour
GitHub Actions schedule — see [staying-current.md](staying-current.md) for
the honest current-coverage details (Shufersal only for now).

## Why this is possible at all

Israel's **Food Competition Promotion Law (Price Transparency Regulations),
2014** requires every retail chain with 3+ branches to publish, several
times a day, machine-readable files listing:

- every product it sells, per store, with its current price (`PriceFull`)
- every active promotion, per store (`PromoFull`)
- the full list of its branches with addresses (`Stores`)

This is a legal obligation, not a courtesy — chains have been fined for
skipping it or letting files go stale (Yeinot Bitan received the largest
fine on record for non-compliance; Tiv Taam has skipped publishing
entirely at times). ~49 chains currently comply, including all the major
supermarket groups (Shufersal, Rami Levy, Victory, Osher Ad, Yeinot Bitan)
and, notably, two gas-station-adjacent convenience chains: **Yellow** (Paz)
and **Dor Alon** (which runs AM:PM and Alonit under the Sonol brand).

There is no single central API — each chain hosts its own portal (e.g.
Shufersal's is at `https://prices.shufersal.co.il/`) with its own file
list, though the file *format* is standardized by law.

## The pipeline

```
[chain portal, e.g. prices.shufersal.co.il]
        │  (PriceFull*.gz, Stores*.gz — one file per store, updated ~hourly)
        ▼
[il-supermarket-scraper]  -- downloads + gunzips -->  raw XML per store
        │
        ▼
[filter step]  -- match ItemName/ItemCode against "מונסטר" / known UPCs -->  Monster rows
        │
        ▼
[store lookup]  -- StoreID -> Stores.xml -->  real name + address + city + zip
        │
        ▼
sightings table: variant, barcode, price, store, address, last_sale_time, source=official_feed
```

### 1. Download

We used the open-source [`il-supermarket-scraper`](https://github.com/OpenIsraeliSupermarkets/israeli-supermarket-scarpers)
library (`pip install il-supermarket-scraper`) rather than reverse-engineering
each chain's blob-storage URLs by hand — it already knows the quirks of
~35 chains' portals (auth cookies, pagination, per-chain URL schemes).

```python
from il_supermarket_scarper.scrappers.shufersal import Shufersal
from il_supermarket_scarper.utils.file_output import DiskFileOutput

# file_output must be passed explicitly — see the library bug note below
s = Shufersal(file_output=DiskFileOutput(storage_path="dumps/Shufersal"))
async for result in s.scrape(limit=3, files_types=["PRICE_FULL_FILE"]):
    print(result)
```

This downloads gzipped XML files named like
`PriceFull7290027600007-001-001-20260905-030000.gz`, auto-extracted to `.xml`.

**Library bug found during the PoC:** calling `Shufersal()` (or any chain
class) without an explicit `file_output=` throws `KeyError` inside
`DumpFolderNames[chain]` (v1.0.11) — `chain` is already the enum member,
not a string, so the lookup is wrong. Worse, when the same call happens
inside the library's `ScarpingTask` multiprocessing wrapper, the exception
is swallowed: the run just produces zero files with no visible error. The
workaround (construct `DiskFileOutput` yourself and pass it in) is applied
in both `israel-poc/fetch_prices.py` and `israel-poc/fetch_stores.py`.

### 2. Parse and filter

Each `PriceFull` file is one store's full catalog as flat XML:

```xml
<Item>
  <ItemCode>5060639128051</ItemCode>
  <ItemName>מונסטר אנרגי אולטרה500מ</ItemName>
  <ManufactureName>---</ManufactureName>
  <ItemPrice>9.90</ItemPrice>
  <Quantity>500.00</Quantity>
  <UnitQty>מיליליטר</UnitQty>
  <PriceUpdateTime>...</PriceUpdateTime>
  <LastSaleDateTime>2026-09-04T15:27:04</LastSaleDateTime>
</Item>
```

Key fields:

| Field | Use |
|---|---|
| `ItemCode` | barcode — the real product key; match against a known Monster UPC list |
| `ItemName` | fallback match on `"מונסטר"` / `"MONSTER"` when the barcode isn't in your known list yet (catches new/regional SKUs) |
| `ItemPrice` | the price, per the law updated within an hour of any in-store change |
| `Quantity` + `UnitQty` | can size (e.g. 500 mL) |
| `LastSaleDateTime` | **not price data — this is a real freshness/availability signal.** If it's within the last day or two, the item is actively selling at that store right now, which is a much stronger "you'll actually find it" signal than the price-file timestamp alone. If it's weeks old, treat the listing as stale/possibly discontinued at that branch even though it's still in the price file. |

`find_monster.py` does this filtering with plain `xml.etree.ElementTree`
(no need for the scraper library past the download step).

### 3. Resolve the store

A separate `Stores` file (one per chain, covering every branch at once, not
per-store like `PriceFull`) maps `StoreID` to a real address:

```xml
<Store>
  <StoreID>1</StoreID>
  <StoreName>שלי ת"א- בן יהודה</StoreName>
  <Address>בן יהודה 79</Address>
  <City>5000</City>
  <ZIPCode>6343504</ZIPCode>
</Store>
```

`City` is a numeric code, not a name — Shufersal's `Stores` file uses
internal city IDs; for a real app you'd build a small lookup table (or
geocode `Address` + `ZIPCode` directly, since ZIP is precise enough for
Google/OSM geocoding without needing the city code at all).

### 4. Confirmed live result (2026-09-05)

| Store | Variant | Barcode | Price | Last sold |
|---|---|---|---|---|
| שלי ת"א-בן יהודה, בן יהודה 79 | Monster Ultra | 5060639128051 | ₪9.90 | 2026-09-04 15:27 |
| שלי ת"א-בן יהודה, בן יהודה 79 | Monster Mango Loco | 5060639129102 | ₪9.90 | 2026-09-04 11:37 |
| שלי ירושלים-אגרון, אגרון 1 | Monster Ultra | 5060639128051 | ₪9.90 | 2026-09-01 14:32 |
| שלי ירושלים-אגרון, אגרון 1 | Monster Mango Loco | 5060639129102 | ₪9.90 | 2026-08-28 13:28 |
| שלי ירושלים-אגרון, אגרון 1 | Monster Ultra Paradise | 5060751219033 | ₪9.90 | 2026-09-03 20:58 |
| שלי ירושלים-אגרון, אגרון 1 | Monster Ultra Fiesta | 5060896625249 | ₪9.90 | 2026-09-03 20:58 |
| שלי ירושלים-אגרון, אגרון 1 | Monster Energy (generic listing) | 5061013942249 | ₪9.90 | 2026-08-26 19:04 |
| שלי ירושלים-אגרון, אגרון 1 | Monster Full Zero | 5061013948364 | ₪9.90 | 2026-09-01 20:05 |

## Coverage and honest limitations

- **Price accuracy**: legally required to update within an hour of a
  register price change; Shufersal's own portal was timestamped for the
  day we tested. Not every chain is equally diligent — expect occasional
  stale or missing files from smaller/less compliant chains.
- **Not a live stock feed**: a listed item can still be physically sold out
  on the shelf. `LastSaleDateTime` is the best proxy available for "this is
  actively moving," not a guarantee of current shelf presence.
- **Gas stations / kiosks**: partially covered. `YELLOW` (Paz) and
  `DOR_ALON` (AM:PM / Alonit / Sonol-affiliated) are in the mandated
  system. Independent or unbranded kiosks are not.
- **~30+ different portals**: no single feed for all chains; each chain's
  URL scheme differs, which is exactly what `il-supermarket-scraper`
  abstracts away.

## Turning this into the real pipeline

1. Repeat the `fetch → filter → resolve` steps above for each chain in
   `ScraperFactory` you want to support (`SHUFERSAL`, `RAMI_LEVY`,
   `VICTORY`, `OSHER_AD`, `DOR_ALON`, `YELLOW`, ...), applying the same
   `file_output=` workaround per chain until the upstream bug is fixed.
2. Geocode each store's `Address` + `ZIPCode` once (cache the lat/lng —
   addresses don't change often) instead of per-run.
3. Maintain a canonical Monster variant table (barcode → flavor/line/size)
   seeded from Open Food Facts, and reconcile new/unrecognized barcodes
   found via the `ItemName` regex match into it over time.
4. Write results to a `sightings` table: `variant_id, store_id, price,
   last_sale_time, source='official_feed', fetched_at`.
5. Run on a schedule (e.g. every few hours) — matches the law's own update
   cadence, no need to poll more often than that.
