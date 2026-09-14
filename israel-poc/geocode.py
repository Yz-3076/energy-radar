"""
Address -> (lat, lng), cached in data/geocode-cache.json.

Uses OpenStreetMap's Nominatim — free, keyless, but rate- and usage-policy-
limited (nominatim.org/release-docs/latest/api/Usage_Policy/): max 1
request/second, and it wants a real identifying User-Agent, not a browser
UA. Results are cached, so a run only pays for addresses never seen before
— most runs geocode nothing at all.

THE CENTRAL PROBLEM: chain price files give a store's town as a numeric CBS
code and never as a name (confirmed across every chain sampled — 0 of 602
branches carried a name). Geocoding street-only is therefore the obvious
thing to do, and it is badly wrong: Israeli street names repeat in every
city, so Nominatim does not fail on an ambiguous address, it confidently
returns a WRONG match. Measured on live data, five Haifa branches were
pinned 67-116km away, in the Tel Aviv area, and a Mitzpe Ramon branch sat
in Petah Tikva. Nothing about those results looks like an error — they are
real coordinates for a real street of that name, in the wrong city.

THE FIX: data/city-codes.json maps the CBS code to the official town name
(see fetch_city_codes.py), so addresses are geocoded as street + town. That
turned the branches above from 116km, 82km and 41km out into 3.2km, 2.1km
and 0.2km — corrected, not merely discarded. The same table then gives a
free second job: every result is checked against the town's own coordinate
and rejected if it lands more than TOWN_MAX_KM away.

Two earlier attempts at that check are worth knowing about, because both
failed in instructive ways and both looked reasonable first:
  - Checking against a town parsed out of the STORE NAME rejected 188 of
    461 live pins, nearly all of them correct. Israeli store names are
    routinely just their own street name, and streets like אלנבי and הילל
    resolve as settlements, so the check could not tell "the Allenby
    branch" from "a branch in a place called Allenby".
  - Checking against the median of other branches sharing a city code
    failed the opposite way: for city code 4000 the majority of pins were
    themselves wrong, so the median sat outside Haifa and the five
    genuinely-correct Haifa branches were the ones rejected.
A town's published coordinate has neither weakness — it is right even when
every branch pinned around it is wrong.

Remaining defences, unchanged:
  - An address with no digit at all (a mall name, not a street address) is
    too vague to trust and is never queried; see `_too_vague`.
  - Any result outside Israel's bounding box is rejected.
  - MANUAL_OVERRIDES holds hand-verified coordinates for specific branches.

Caching rule: an address is cached once it has an ANSWER — a coordinate, or
a confirmed "no such place". A lookup that never completed (throttled,
timed out) is NOT cached, because writing it in as null would retire a
perfectly good address permanently on the strength of a transient 429.
A cached coordinate that fails the town check is re-resolved rather than
trusted, which is what lets pins cached before this table existed heal
themselves.
"""

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

CACHE_PATH = Path(__file__).resolve().parent.parent / "data" / "geocode-cache.json"
# CBS locality code -> town name, and town name -> coordinate. Both are
# separate files from the address cache: different key spaces, and both are
# small, stable reference data rather than per-store results.
CITY_CODES_PATH = Path(__file__).resolve().parent.parent / "data" / "city-codes.json"
TOWN_CACHE_PATH = Path(__file__).resolve().parent.parent / "data" / "town-coords.json"
USER_AGENT = "energy-radar-price-pipeline/1.0 (github.com/joshuazisel/monster-tracker)"
MIN_INTERVAL_S = 1.1  # Nominatim policy: max 1 req/sec; a little slack
# A 429 is not a "no". Retry it, backing off 5s, 10s, 20s — long enough to
# actually clear a throttle, and bounded so one hostile response can't stall
# a run indefinitely.
MAX_RETRIES = 4
BACKOFF_BASE_S = 5.0

# Stop geocoding entirely once this many addresses in a row exhaust their
# retries, and let the run finish on cached coordinates alone.
#
# Without this the worst case is unbounded: full backoff is ~75s per
# address, so a few hundred throttled addresses would run past the
# workflow's 120-minute timeout and lose the ENTIRE scrape — prices,
# promos and all — to a geocoder being slow. Geocoding is incremental and
# permanently cached, so stopping early just defers those addresses to the
# next run, while finishing the run keeps everything else. Any success
# resets the counter, so a couple of isolated failures never trip it.
GIVE_UP_LIMIT = 5
_GIVE_UPS = 0

# Generous bounding box around Israel + the territories chain branches can
# realistically be in (lat, lng). Not a precise border — just wide enough to
# never reject a real branch, tight enough to catch a same-named place in a
# totally different part of the country.
ISRAEL_BOUNDS = (29.3, 33.5, 34.1, 36.0)  # (min_lat, max_lat, min_lng, max_lng)

# How far a pin may sit from the centre of the town it is filed under.
#
# Measured against the town centre, not against other branches, so this only
# has to cover a municipality's own radius. Jerusalem, the largest, is about
# 10km from centre to edge, and regional councils sprawl further, so 25km
# leaves real room while still catching the errors actually seen in this
# data — which were 50km, 113km and 163km out, not 26km.
TOWN_MAX_KM = 25.0

# Chain brand words that sit in front of the town in a store name
# ("שלי חיפה- אורן", "סופר יודה בוגרשוב"). Stripped before the first
# remaining token is treated as a town.
_BRAND_WORDS = {
    "שלי", "דיל", "אקספרס", "יש", "חסד", "סופר", "יודה", "מרקט", "סניף",
    "ביג", "סיטי", "מגה", "בעיר", "am-pm", "ampm", "כהן", "טוב", "רמי", "לוי",
}


def street_only(address: str) -> str:
    """Strip an address down to just "street number".

    Nominatim's `street` field wants exactly that, but these files rarely
    give it cleanly: "רח.אורן 25 רוממה" carries a street abbreviation and a
    trailing neighbourhood, "בזק 1 פינת ברקן" names a corner. Both fail as
    written and resolve once trimmed.

    This turned out to matter far more than the city hint it supports:
    hints alone rescued 1 of 20 failed addresses, hints plus this trimming
    rescued 10 of 15 (measured 2026-09-14 on real Shufersal branches).
    """
    a = re.sub(r"^(רח'|רח\.|רחוב|שד'|שד\.|שדרות|דרך)\s*", "", address.strip())
    m = re.match(r"^(.+?\s+\d+)\b", a)  # "street 25 neighbourhood" -> "street 25"
    if m:
        return m.group(1)
    m = re.match(r"^(\d+\s+\S+)", a)  # "25 street"
    if m:
        return m.group(1)
    return a


def _haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    import math

    (la1, lo1), (la2, lo2) = a, b
    p = math.pi / 180
    h = (
        0.5
        - math.cos((la2 - la1) * p) / 2
        + math.cos(la1 * p) * math.cos(la2 * p) * (1 - math.cos((lo2 - lo1) * p)) / 2
    )
    return 2 * 6371 * math.asin(math.sqrt(h))


_KNOWN_TOWNS: set | None = None


def _known_towns() -> set:
    """Every town name in the CBS list, plus a hyphen-free spelling of each.

    The table writes "אום אל-פחם" and "מודיעין-מכבים-רעות"; store names
    write them without the hyphens. Matching both spellings costs nothing
    and is the difference between recognising those towns and not.
    """
    global _KNOWN_TOWNS
    if _KNOWN_TOWNS is None:
        _load_codes()
        names = set((_CITY_CODES or {}).values())
        _KNOWN_TOWNS = names | {n.replace("-", " ") for n in names}
    return _KNOWN_TOWNS


def city_hints(store_name: str) -> list[str]:
    """Candidate towns pulled out of a store's own name, best guess first.

    Chain files only carry a numeric city code, but the name very often
    spells the town out — "שלי חיפה- אורן", "אום אלפחם", "שלי באר יעקב".
    Nominatim resolves street+city far better than street alone on Israeli
    data (measured: 3 of 4 previously-unresolvable Shufersal branches came
    back correct once the town was supplied).

    Only used when the store's city code is missing or not in the CBS table
    (real case: several branches filed under code "0"). Every candidate is
    checked against the official locality list before use, which is what
    makes this safe now — a guess only counts if Israel actually has a town
    by that name. That single filter removes the failure that made an
    earlier version of this unusable: "אלנבי", "הילל" and "יפת" are street
    names that Nominatim happily resolves as places, but none of them is a
    locality, so none of them survives.

    Several candidates rather than one, because a store name is not a
    structured field: the first token can be the town ("אום אלפחם"), the
    brand ("תיב טעם נתניה"), or a street ("סופר יודה בוגרשוב"). Two-word
    towns are common too ("באר יעקב"), so the pair is offered as well.

    Deliberately limited to those few token positions in the NAME. Scanning
    the name and address freely for any locality in the CBS list was tried
    and rejected 2026-09-14: it found a town for 115 of the 188 branches
    that have no city code, but the matches included "אזור תעשייה"
    (industrial *zone*) read as the town Azor, the street "נתיבות המשפט"
    read as the town Netivot 60km away, and the street "חפץ חיים" read as
    the kibbutz of that name. Israeli streets are named after places often
    enough that free text cannot be mined this way — the same failure that
    made a store-name town check unusable, in a new disguise. With no city
    code there is nothing to validate the guess against, so those branches
    are better left unplaced than placed wrongly.
    """
    if not store_name:
        return []
    cleaned = store_name.replace("-", " ").replace(".", " ").replace(",", " ")
    tokens = [t for t in cleaned.split() if t]
    tokens = [t for t in tokens if t.lower() not in _BRAND_WORDS and not any(c.isdigit() for c in t)]
    if not tokens:
        return []

    out: list[str] = []
    if len(tokens) >= 2:
        out.append(" ".join(tokens[:2]))  # "באר יעקב"
    out.append(tokens[0])  # "חיפה", "אום"
    if len(tokens) >= 2:
        out.append(tokens[1])  # brand-first names: "תיב טעם נתניה" -> "טעם"...
        out.append(tokens[-1])  # ...and the trailing town: "נתניה"
    known = _known_towns()
    return [c for c in dict.fromkeys(out) if c in known]  # ordered, deduped, real


# How far a branch may sit from the town its own name claims it is in.
# Generous — it only has to catch the failure this exists for, which is a
# branch named for a Negev town landing near Tel Aviv, 150-200km out.

# city name -> [lat, lng] | None, resolved once per run. Towns are few and
# repeat constantly across branches, so this keeps the extra lookups to
# roughly one per town rather than one per address.


# Nominatim `type` values that are actually a settlement. A street is
# class=highway and must never be treated as a town: half these store names
# are named after their own street ("סופר יודה אלנבי", "מעיין 2000 הילל"),
# and Israeli street names double as place names often enough that accepting
# any result at all made this check reject 41% of perfectly good pins.


_CITY_CODES: dict | None = None
_RURAL_CODES: set | None = None


def _load_codes() -> None:
    global _CITY_CODES, _RURAL_CODES
    if _CITY_CODES is not None:
        return
    raw = (
        json.loads(CITY_CODES_PATH.read_text(encoding="utf-8"))
        if CITY_CODES_PATH.exists()
        else {}
    )
    _CITY_CODES = raw.get("names", {})
    _RURAL_CODES = set(raw.get("rural", []))
    if not _CITY_CODES:
        print("  WARNING: data/city-codes.json missing — geocoding without town names")


def is_rural(city_code: str) -> bool:
    """Is this locality a kibbutz/moshav rather than a town?

    True when the CBS table files it under a regional council. Those places
    are a few hundred metres across, which is what makes the town's own
    coordinate an acceptable pin for a store there with no street address.
    """
    _load_codes()
    return (_normalise_code(city_code) in (_RURAL_CODES or set()))


def _normalise_code(city_code: str) -> str:
    return (city_code or "").strip().lstrip("0") or "0"


def city_name(city_code: str) -> str:
    """Official town name for a CBS locality code, or "" if unknown.

    Chain price files give this numeric code and no name at all (confirmed
    across every chain sampled: 0 of 602 branches carried a name), which is
    why addresses were geocoded street-only for so long. The table is the
    Central Bureau of Statistics locality list published on data.gov.il —
    see tools/fetch_city_codes.py for how data/city-codes.json is built.
    """
    _load_codes()
    return (_CITY_CODES or {}).get(_normalise_code(city_code), "")


def load_town_cache() -> dict:
    if TOWN_CACHE_PATH.exists():
        return json.loads(TOWN_CACHE_PATH.read_text(encoding="utf-8"))
    return {}


def save_town_cache(cache: dict) -> None:
    TOWN_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    TOWN_CACHE_PATH.write_text(
        json.dumps(cache, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8"
    )


_TOWN_COORDS: dict | None = None


def town_coord(town: str) -> list | None:
    """Where a town is. One lookup per town ever, cached on disk.

    Safe to trust in a way the old name-guessing was not: `town` here comes
    from the CBS table, so it really is a locality, and asking Nominatim
    for a locality by name is the one query shape it handles reliably.
    There are ~1,270 towns in Israel and a few hundred in the data, so this
    costs a handful of lookups on the first run and nothing after that.
    """
    global _TOWN_COORDS
    if _TOWN_COORDS is None:
        _TOWN_COORDS = load_town_cache()
    if town in _TOWN_COORDS:
        return _TOWN_COORDS[town]
    coords, reachable = _ask({"city": town})
    if coords is None and not reachable:
        return None  # unknown, not "nowhere" — don't cache, don't check against it
    _TOWN_COORDS[town] = coords
    save_town_cache(_TOWN_COORDS)  # cheap, and survives a run that dies midway
    return coords


def _in_israel(lat: float, lng: float) -> bool:
    min_lat, max_lat, min_lng, max_lng = ISRAEL_BOUNDS
    return min_lat <= lat <= max_lat and min_lng <= lng <= max_lng


def is_approximate(address: str, city_code: str) -> bool:
    """Will this store be pinned at its village's centre rather than its own
    address?

    True only for an address with no street number in a locality small
    enough that the distinction barely matters (see is_rural). Callers
    should surface it — a pin the app presents as exact when it is really
    "somewhere in this kibbutz" is the kind of small dishonesty that makes
    a walking app untrustworthy.

    Pure function of its inputs, so the pipeline can ask about a store
    without re-running the lookup.
    """
    return _too_vague(address) and bool(city_name(city_code)) and is_rural(city_code)


def _too_vague(address: str) -> bool:
    """No digit at all means no street number — a mall/center/branch name
    ("ישפרו סנטר", "מודיעין") rather than an actual street address.
    Confirmed these are exactly the addresses Nominatim confidently
    mis-resolves rather than fails on, so they're worth skipping outright."""
    return not any(ch.isdigit() for ch in address)


def load_cache() -> dict:
    if CACHE_PATH.exists():
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    return {}


def save_cache(cache: dict) -> None:
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


def _cache_key(address: str, zip_code: str) -> str:
    # Collapse internal whitespace too (a real case had "צאלון   21" with
    # three spaces, straight from the source XML) so a manual override or
    # cache entry keyed on the clean form still matches.
    return f"{' '.join(address.split())}|{zip_code.strip()}"


# Manual corrections for specific branches confirmed, by hand, to have no
# reliable free-geocoder answer (see the module docstring above). Found by
# re-querying Nominatim with the real city name included — something the
# pipeline itself can't do, since chain files never give a city name, only
# a numeric code — which the automated street+zip query can't replicate.
# `None` means "confirmed to be a real branch, but no trustworthy
# coordinate exists" — excluded on purpose rather than guessed. Checked
# before the cache, so it always wins over whatever's already cached.
#
# Keys are address+zip only, with no chain or city in them, so an entry
# for a bare street+number could in principle hijack a different chain's
# branch at the same-numbered address in another town. Verified
# 2026-09-10 that every key here matches exactly one branch across all
# 766 branches of all six chains; re-check that when adding one, since
# several of these addresses carry no zip to disambiguate them.
MANUAL_OVERRIDES: dict[str, list[float] | None] = {
    # Shufersal Deal Modi'in Center. Automated query put this ~150km away
    # near Tiberias; re-querying with "מודיעין" as the city resolved it
    # ~1.5km from Modi'in's real centre (2026-09-10).
    _cache_key("צאלון 21", "7171519"): [31.9073982, 35.0157619],
    # Shufersal Express Modi'in. Automated query put this near Tel Aviv;
    # with the real city included it lands on the same block as a real
    # Super-Pharm and Pizza Hut at this address (2026-09-10).
    _cache_key("26 חיים ויצמן", "7178943"): [31.9044678, 34.9867339],
    # Shufersal Express HaTziporim Modi'in. Real branch, confirmed by web
    # search to be in Modi'in's "Birds" neighbourhood (streets there are
    # all named after birds) -- but HaChasida St isn't in OpenStreetMap's
    # data at all, under any phrasing tried, so there is no free-geocoder
    # path to a real coordinate. Excluded rather than guessed.
    _cache_key("2 החסידה", "7169447"): None,
    # Rami Levy "מודיעין חדש". Its address is an industrial-zone name with
    # no house number, so _too_vague rejects it before a lookup is even
    # attempted and the branch never reached the map at all -- the guard
    # doing its job, but costing a real store. OpenStreetMap has the actual
    # shop as a POI tagged `supermarket` ("רמי לוי, כרמל, כפר רות, מועצה
    # אזורית חבל מודיעין"), returned identically by two independent
    # queries, 2.9km from Modi'in's centre and 0.8km off the Shilat
    # locality centroid -- i.e. a real building, not a settlement centroid
    # standing in for one (2026-09-10).
    _cache_key("א.ת שילת", ""): [31.9161055, 35.0242511],
    # Rami Levy "מודעין ישפרו" (their own spelling), in the Yishpro centre
    # in Modi'in. Unlike the Shilat branch this one has a house number, so
    # it was queried normally -- but the address packs a street, a centre
    # name and a mall name into one field ("החרט 1 מרכז עינב ישפרו"), which
    # the structured street= query can't parse, and Nominatim returned
    # nothing at all. Looked up by the mall instead: "ישפרו סנטר, המלאכות,
    # מרכז עינב, מודיעין-מכבים-רעות", tagged `commercial`, and separately
    # confirmed by the street itself (החרט, מרכז עינב) landing 218m away --
    # two independent hits agreeing on the same block (2026-09-10).
    _cache_key("החרט 1 מרכז עינב ישפרו", ""): [31.8893287, 34.9635571],
    # Victory Modi'in. "מנחם בגין" is one of the most-repeated street names
    # in the country and this row carries no zip, so the automated query
    # picks the famous Tel Aviv one and lands 29km away -- confidently
    # wrong, the failure this table exists for. OpenStreetMap has the shop
    # itself as "Victory, 21, מנחם בגין, מוריה, מודיעין-מכבים-רעות", tagged
    # `supermarket`, matching the house number exactly and sitting 157m off
    # the Modi'in stretch of that street (2026-09-10).
    _cache_key("מנחם בגין 21", ""): [31.8813051, 35.0129965],
}


def _ask(params: dict) -> tuple[list | None, bool]:
    """One Nominatim call, rate-limited and Israel-bounds-checked.

    Returns (coords, reachable). The second value is the important one:
    False means the question never got answered — throttled, timed out,
    connection died — as opposed to answered with "no such place". The
    caller must not cache a False as a result. Confirmed the hard way:
    Nominatim starts returning 429 well before its documented 1/sec limit
    bites, and because every failure used to look alike, a throttled
    address was written into the cache as permanently unresolvable and
    never asked about again.
    """
    global _GIVE_UPS
    if _GIVE_UPS >= GIVE_UP_LIMIT:
        return None, False  # circuit open — see the counter's comment

        # NOT constrained with country=Israel, deliberately. OSM does not tag
    # West Bank localities as Israel, so that filter did not merely miss
    # them, it substituted something else: "אפרת" with country=Israel
    # returned a point in the GALILEE, 130km from the real Efrat, while
    # מעלה אדומים, ביתר עילית, מודיעין עילית and קרית ארבע returned nothing
    # at all (measured 2026-09-14). Israel's chains serve those towns and
    # publish CBS codes for them. ISRAEL_BOUNDS is the honest filter here:
    # it is a box on the map rather than a claim about sovereignty, and it
    # is what every result is checked against anyway.
    qs = urllib.parse.urlencode({**params, "format": "json", "limit": 1})
    req = urllib.request.Request(
        f"https://nominatim.openstreetmap.org/search?{qs}",
        headers={"User-Agent": USER_AGENT},
    )
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                hits = json.loads(resp.read().decode("utf-8"))
            _GIVE_UPS = 0  # a success means the throttle has passed
            time.sleep(MIN_INTERVAL_S)
            if not hits:
                return None, True  # a real answer: no such place
            lat, lng = float(hits[0]["lat"]), float(hits[0]["lon"])
            if _in_israel(lat, lng):
                return [lat, lng], True
            print(f"  geocode rejected {params}: {lat},{lng} outside Israel")
            return None, True
        except urllib.error.HTTPError as e:
            if e.code != 429:
                print(f"  geocode failed {params}: {e}")
                time.sleep(MIN_INTERVAL_S)
                return None, False
            # Backing off further each time rather than retrying at the
            # same pace, because a 429 means the server wants less traffic,
            # not the same traffic again.
            wait = BACKOFF_BASE_S * (2**attempt)
            print(f"  rate-limited, waiting {wait:.0f}s (attempt {attempt + 1}/{MAX_RETRIES})")
            time.sleep(wait)
        except Exception as e:  # noqa: BLE001 — a failed lookup should not crash the run
            print(f"  geocode failed {params}: {e}")
            time.sleep(MIN_INTERVAL_S)
            return None, False
    _GIVE_UPS += 1
    print(f"  geocode gave up on {params}: still rate-limited after {MAX_RETRIES} attempts")
    if _GIVE_UPS >= GIVE_UP_LIMIT:
        print(f"  geocoding disabled for the rest of this run after {_GIVE_UPS} "
              f"rate-limited addresses in a row — they will be retried next run")
    return None, False


def geocode(
    address: str,
    zip_code: str,
    cache: dict,
    store_name: str = "",
    city_code: str = "",
) -> list | None:
    """Returns [lat, lng] or None (unresolved). Mutates `cache` in place;
    caller is responsible for save_cache() once done with a whole run.

    An address only enters the cache once it has an ANSWER — a coordinate,
    or a confirmed "no such place". If the geocoder could not be reached
    (throttled, timed out), nothing is written and the address is simply
    retried on the next run, which is the difference between a slow run and
    a permanently missing store.

    The town comes from `city_code` via the official CBS table (see
    city_name); `store_name` is only a fallback for the rows whose code is
    missing or unlisted. The town's own coordinate is what a result is
    checked against, rather than other branches in the same town — it stays
    right even when every branch around it is wrong, which is exactly the
    case that defeated the previous approach.
    """
    key = _cache_key(address, zip_code)
    if key in MANUAL_OVERRIDES:
        cache[key] = MANUAL_OVERRIDES[key]
        return MANUAL_OVERRIDES[key]

    town = city_name(city_code)
    trimmed = street_only(address)

    if key in cache:
        cached = cache[key]
        # A cached None is a settled answer — re-asking a bad address every
        # run just burns the rate limit for the same "no".
        if cached is None:
            return None
        centre = town_coord(town) if town else None
        if centre is None or _haversine_km(tuple(centre), tuple(cached)) <= TOWN_MAX_KM:
            return cached
        # A cached coordinate that is not in the store's own town. Almost
        # all of these were resolved street-only, before the city code was
        # available, and street-only is precisely what puts a Haifa branch
        # in Tel Aviv. Fall through and re-resolve it properly rather than
        # trusting it forever — otherwise every pin cached before the code
        # table existed keeps its old wrong answer, since a cache hit
        # normally returns before any lookup happens.
        print(f"  geocode re-resolving {address!r}: cached pin is not in {town}")

    # Street + town, the authoritative pairing. Worth doing FIRST rather
    # than as a retry: street-alone is what produced the confidently-wrong
    # pins this module exists to prevent (a Haifa branch in the Tel Aviv
    # area, a Mitzpe Ramon branch in Petah Tikva), because Israeli street
    # names repeat in every city and Nominatim simply picks one.
    result, reachable = _ask({"street": trimmed, "city": town}) if town else (None, True)

    if result is None and not town:
        # No usable city code. Fall back to a town guessed from the store
        # name — safe only because city_hints now rejects anything that is
        # not an actual locality.
        for hint in city_hints(store_name):
            result, ok = _ask({"street": trimmed, "city": hint})
            reachable = reachable and ok
            if result is not None:
                print(f"  geocode resolved {address!r} via name hint {hint!r}")
                town = hint
                break

    if result is None:
        if _too_vague(address):
            if is_approximate(address, city_code):
                # A petrol station or shop in a kibbutz, addressed as
                # "קיבוץ עינת" or "בכניסה לקיבוץ מזרע" — no street, because
                # the village has no streets to speak of. Dor Alon files
                # hundreds of these. The village's own coordinate is a
                # genuinely good pin at that scale, so the store appears
                # instead of being dropped; callers can tell these apart
                # via is_approximate() and say so in the UI.
                centre = town_coord(town)
                if centre is not None:
                    print(f"  geocode placed {address!r} at the centre of {town} (village, no street address)")
                    cache[key] = centre
                    return centre
            print(f"  geocode skipped for {address!r} ({zip_code}): no street number, too vague to trust")
        else:
            # Last resort. Weaker than street+town, so the check below has
            # to carry the weight.
            primary = {"street": address}
            if zip_code:
                primary["postalcode"] = zip_code
            result, ok = _ask(primary)
            reachable = reachable and ok

    # Does the pin actually land in the town the chain filed it under?
    #
    # This replaces two earlier attempts, both of which failed for the same
    # underlying reason — they had no trustworthy idea of what town the
    # store was in. Checking against a town parsed out of the STORE NAME
    # rejected 188 of 461 live pins, nearly all correct, because Israeli
    # store names are routinely their own street name and streets like
    # אלנבי and הילל resolve as settlements. Checking against the median of
    # other branches sharing the city code then failed the opposite way:
    # for city code 4000 the majority of pins were themselves wrong, so the
    # median sat outside Haifa and the five genuinely-correct Haifa
    # branches were the ones rejected.
    #
    # The CBS table settles it. The code is the chain's own field, the name
    # is the government's, and the town's coordinate does not move when the
    # branch pins around it are wrong.
    if result is not None and town:
        centre = town_coord(town)
        if centre:
            km = _haversine_km(tuple(centre), tuple(result))
            if km > TOWN_MAX_KM:
                print(f"  geocode rejected {address!r}: {km:.0f}km from {town}")
                result = None

    if result is None and not reachable:
        # Never reached the geocoder, so we know nothing about this address.
        # Leaving it out of the cache costs one retry next run; writing it in
        # would cost the store forever.
        return None

    cache[key] = result
    return result
