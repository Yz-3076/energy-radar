# Brief: Israeli retail-branch geocoding

Hand this to another model (Gemini) to continue or rebuild the geocoding tool.
It is written to be read cold — it assumes no memory of the project.

---

## 1. What the system is

An Android app that shows which Israeli shops stock Monster Energy, at what
price, with what promotions. It sends people **walking**, so a pin in roughly
the right area is not good enough — a store that doesn't appear is a smaller
failure than one that appears in the wrong place.

Data comes from Israel's 2014 Food Price Transparency Law: every chain with
3+ stores must publish `PriceFull`, `PromoFull` and `Stores` XML several
times a day. There is **no central government API** — roughly 30 separate
chain portals, scraped via the `il-supermarket-scraper` package.

Census size: **1,666 branches across 21 chains** (the census is a one-off
dump of every chain's `Stores` XML).

---

## 2. The core problem

Every chain publishes the **same 7 fields**, mandated by law, and no more:

```
StoreID, BikoretNo, StoreType, StoreName, Address, City, ZIPCode
```

**No chain publishes latitude/longitude.** Verified across all 21. That gap
is in the law, not in the scraping.

`City` is a **numeric CBS locality code**, never a name. Verified: 0 of 602
sampled branches carried a town name. So the naive approach is to geocode the
street alone — and that is the single largest source of error, because
**Israeli street names repeat in every city**. Nominatim does not fail on an
ambiguous street; it confidently returns a real coordinate for the wrong
city. Measured on live data: five Haifa branches pinned 67–116km away near
Tel Aviv, a Mitzpe Ramon branch in Petah Tikva, a Safed branch 144km out.

**28% of pins that could be checked were in the wrong town.**

---

## 3. What went RIGHT — keep all of this

### 3.1 Anchor the town to the CBS code, before anything else
Israel's Central Bureau of Statistics publishes the locality table as open
data. This was the breakthrough.

```
https://data.gov.il/api/3/action/datastore_search
  ?resource_id=d4901968-dad3-4845-a9b0-a57d027f11ab
fields: סמל_ישוב (code), שם_ישוב (name), סמל_מועצה_איזורית (regional council)
1,272 localities
```

Geocoding as **street + town** instead of street alone produced:

| Branch | Before | After |
|---|---|---|
| שלי חיפה-סטלה | 116km out | 3.2km |
| דיל רמת הנשיא חיפה | 82km | 3.4km |
| שלי פ"ת-העצמאות | 82km | 2.1km |
| שלי נתניה-סמילנסקי | 41km | 0.2km |

Correct pins were unaffected. These are **corrected**, not discarded.

### 3.2 Validate every result against the town's own coordinate
Geocode the town name once, cache it, and reject any pin more than **25km**
from it. A town's published coordinate is right *even when every branch
pinned around it is wrong* — which is the property that matters (see 4.2).

### 3.3 The street register — as an advisor, never a gatekeeper
```
resource_id=a7296d1a-f8c9-4b70-96c2-6ebb4352f8e3
51,497 streets, each tagged to its locality. 79% of street names exist in
exactly ONE locality.
```
Filter to the **anchored town**, then fuzzy-match the street within that
town only. This upgrades the query (`ד.דגניה` → `שד דגניה`, `איינשטיין` →
`אינשטין`) and gives a confidence signal.

**It must not veto.** It is Israel Post's list and has real gaps — `גוט לוין`
in Haifa and `פנחס יעקובי` in Rehovot are both absent yet both are real
streets. Treating a register miss as "no such street" cost 10 of 40 branches
in testing. Safety comes from the town anchor and the distance check, not
from this list.

### 3.4 Regional-council membership identifies rural localities
`סמל_מועצה_איזורית != 0` means a kibbutz or moshav. Verified: every kibbutz
checked has one, every city has none. Those places are a few hundred metres
across, so for an address like `קיבוץ עינת` with no street, the **village's
own coordinate is a fair pin**. Recovered 59 branches. Never apply this in a
city, where it would be kilometres wrong.

### 3.5 Separate "no answer" from "no such place"
A 429 or timeout must **never** be cached as a null result. This bug
permanently retired good addresses on the strength of a transient rate
limit. Cache only a real answer; retry transport failures next run.

### 3.6 Emit a confidence score, and never let it be optional
`0.9` street-confirmed, `0.65` street placed but unverified, `0.25`
town-centre-only. A town-centre pin in Haifa can be 10km off. It is honest
labelled `0.25` and dishonest presented as an address.

---

## 4. What went WRONG — do not repeat these

Four separate attempts to infer a town from text. **Every one produced
confident, wrong pins.** This is the single most important section.

### 4.1 Parsing the town out of the store NAME
Rejected **188 of 461 live pins, nearly all of them correct.** Israeli store
names are routinely just their own street name, and those street names
resolve as settlements:

| Text | Read as | Actually |
|---|---|---|
| `אלנבי`, `הילל`, `יפת` | settlements | streets in Tel Aviv / Jerusalem |
| `מרכז` | a place | the word "centre" |

### 4.2 Anchoring to the median of branches sharing a city code
Failed in the opposite direction. For city code 4000 (Haifa) the **majority
of pins were themselves wrong**, so the median sat outside Haifa and the
five genuinely-correct Haifa branches were the ones rejected. Never derive
your reference from the data you are trying to validate.

### 4.3 Scanning name + address for any locality in the CBS list
Would have found a town for 115 of 188 no-code branches, but:

| Text | Read as | Actually |
|---|---|---|
| `אזור תעשייה` | the town Azor | "industrial **zone**" |
| `נתיבות המשפט` | the town Netivot | a street in Modi'in Illit, 60km away |
| `שדרות רוטשילד` | the town Sderot | "**boulevard** Rothschild" |
| `חפץ חיים` | the kibbutz | a street in Kiryat Sefer |

### 4.4 Cross-checking the register against the store's own text
Even *agreement between two sources* produced false positives, because the
coincidence appears in both: `סגולה` is simultaneously a moshav and a Petah
Tikva neighbourhood; `שדרות` matched as a town when it was the word
"boulevard" in the address.

**Conclusion: Hebrew place names and street names overlap so heavily that no
free-text town inference is safe at any confidence threshold.** Matching text
*inside* an already-anchored town is fine — the worst case there is the wrong
mall in the right town.

### 4.5 Two smaller traps
- **CBS code `0` is a real row** meaning "unlisted" (`לא רשום`). Treating it
  as a town geocodes against nonsense. Drop it.
- **Reverse geocoding to name the town doesn't work** either. One city
  returns several valid names across its own pins (`תל־אביב–יפו` vs a
  suburb), so majority-voting on them drops correct branches.

---

## 5. Current state

Implemented in `israel-poc/geocode_stages.py`:

| Stage | Method | Status |
|---|---|---|
| 1 | CBS anchor + aliases | **working** |
| 2 | Israel Post postcode → town | **blocked** (see below) |
| 3 | Overpass POI / mall centroid | **working** |
| 4 | Street register + Nominatim | **working** |
| 5 | Google Geocoding fallback | needs `GOOGLE_MAPS_API_KEY` |

Measured on a 60-branch sample with stages 1,3,4: **77% placed confidently**,
the remainder as town-centre pins carrying `0.25`.

**Stage 2 is blocked externally.** The `mikud` PyPI package exposes exactly
the right call (`search_address(zip) -> Address`), but Israel Post's token
endpoint refuses anonymous callers: *"Can't generate new access token"*.
Their address file is a commercial product. OpenStreetMap has **no Israeli
postcode coverage at all** — five real 7-digit codes tested, all returned
nothing. 61 branches are waiting on this.

---

## 6. What is still unsolved

Ranked by how many branches each would recover:

1. **203 branches — landmark addresses in cities.** `מרכז מסחרי רמת רזים`,
   `קניון גני הדרים`, `עמק איילון פינת` ("corner of"). Stage 3 handles these
   when OSM has the mall named; it often doesn't. **A POI gazetteer with
   Israeli mall coverage is the highest-value missing input.**
2. **~127 branches — no city code and no ZIP.** Whole chains (Yohananof,
   Super Sapir, Keshet) publish `City = 0`. Nothing objective identifies
   their town. Do **not** guess from text (§4).
3. **92 branches — no address at all.** Field empty or literally `unknown`.
   Unfixable from this data; would need the chain's own store locator.
4. **61 branches — blocked on Stage 2** above.
5. **True non-addresses** — `צומת גוש עציון` (a junction), `מחלף לטרון` (a
   motorway interchange), `על כביש 77 בין צומת המוביל...` ("on route 77
   between..."). These have no street address because they have none. Only
   Stage 5 (Google) can place them; it handles named junctions well.

---

## 7. If you build the next version

**The single highest-leverage change is Stage 5 with a real geocoding API.**
Google's Israeli Hebrew coverage is substantially better than OSM's. Cost is
about $5 per 1,000 requests and results cache permanently, so a one-time pass
over the ~400 unplaced addresses is a couple of dollars, not a subscription.

Keep these invariants no matter what you change:

1. **Anchor the town from the CBS code before any lookup.** Never infer it
   from address or name text.
2. **Validate every coordinate against the anchored town** (25km).
3. **Cache permanently, keyed by (chain, store_id)** — not by address text,
   which chains edit constantly.
4. **Never cache a transport failure as a negative result.**
5. **Carry a confidence score end to end**, and don't let a `0.25`
   town-centre pin reach a walking user as if it were an address.
