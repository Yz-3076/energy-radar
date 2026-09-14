"""
Address -> (lat, lng), cached forever in data/geocode-cache.json.

Uses OpenStreetMap's Nominatim — free, keyless, but rate- and usage-policy-
limited (nominatim.org/release-docs/latest/api/Usage_Policy/): max 1
request/second, and it wants a real identifying User-Agent, not a browser
UA. Since we cache every result permanently and only ever geocode a NEW
address once (addresses don't move), a run only ever pays this cost for
stores never seen before — most runs geocode nothing at all.

Chain price files give a numeric city code, not a city name (see
docs/israel-pipeline.md), so this geocodes on street address + ZIP + country.

Confirmed 2026-09-09 (real case: a Modi'in branch listed only as "ישפרו
סנטר" — a mall name, no street number): Nominatim doesn't fail on an
address like this, it confidently returns a WRONG match up to ~150km away
(a same-named place elsewhere in Israel). The old `if coords is None` check
had no way to catch that — a wrong-but-non-null result was cached forever
and the store silently showed up at the wrong location instead of just
being missing. Three defenses now, in order:
  1. An address with no digit at all (no street number — a mall/center
     name, not a real street address) is treated as too vague to trust and
     never even queried; see `_too_vague`.
  2. A structured query (street/postalcode/country as separate fields
     rather than one free-text string) tends to match this data shape
     better than a smushed-together string.
  3. Any result outside Israel's own bounding box is rejected as a sanity
     backstop.
None of this is a complete fix — a *properly formatted* street address can
still resolve to the wrong city if Nominatim/OpenStreetMap's coverage for
that specific street is thin (confirmed on a real case: "צאלון 21" in
Modi'in resolved ~150km away despite being a normal street+number). That's
a genuine data-quality gap in the free geocoder, not something a smarter
query can fully solve — worth knowing about rather than pretending it's
airtight. A lookup that fails, is too vague, or fails the sanity check is
recorded as `null` in the cache rather than retried every run (a bad
address doesn't get better by asking again).

For the handful of specific branches this has actually been confirmed on,
see MANUAL_OVERRIDES below — hand-verified once (by re-querying with the
real city name, which the automated pipeline can't do — see its own
comment) rather than left wrong or silently dropped.
"""

import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

CACHE_PATH = Path(__file__).resolve().parent.parent / "data" / "geocode-cache.json"
USER_AGENT = "energy-radar-price-pipeline/1.0 (github.com/joshuazisel/monster-tracker)"
MIN_INTERVAL_S = 1.1  # Nominatim policy: max 1 req/sec; a little slack

# Generous bounding box around Israel + the territories chain branches can
# realistically be in (lat, lng). Not a precise border — just wide enough to
# never reject a real branch, tight enough to catch a same-named place in a
# totally different part of the country.
ISRAEL_BOUNDS = (29.3, 33.5, 34.1, 36.0)  # (min_lat, max_lat, min_lng, max_lng)

# How far a city-hint result may sit from another branch already resolved
# in the same municipality before it is treated as the wrong town.
#
# 25km, not the 40 first tried. The anchor is one arbitrary branch, so this
# has to tolerate two real branches at opposite ends of a large city — but
# 40 let a hint of the *street* name resolve inside the window while the
# correct town ("נתניה", 42km from its own anchor) was rejected just
# outside it. This app sends people walking; a pin in roughly the right
# region is not good enough, and a store that never appears is a smaller
# failure than one that appears somewhere wrong.
CITY_CLUSTER_MAX_KM = 25.0

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


def city_hints(store_name: str) -> list[str]:
    """Candidate towns pulled out of a store's own name, best guess first.

    Chain files only carry a numeric city code, but the name very often
    spells the town out — "שלי חיפה- אורן", "אום אלפחם", "שלי באר יעקב".
    Nominatim resolves street+city far better than street alone on Israeli
    data (measured: 3 of 4 previously-unresolvable Shufersal branches came
    back correct once the town was supplied).

    Several candidates rather than one, because a store name is not a
    structured field and a single guess is wrong often: the first token can
    be the town ("אום אלפחם"), the brand ("תיב טעם נתניה"), or a street
    ("סופר יודה בוגרשוב"). Two-word towns are common too ("באר יעקב"), so
    the pair is offered as well. Wrong guesses are cheap — Nominatim
    usually returns nothing for them, and anything it does return still has
    to survive the caller's distance check against other branches in the
    same municipality.
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
    # preserve order, drop repeats
    return list(dict.fromkeys(out))


def _in_israel(lat: float, lng: float) -> bool:
    min_lat, max_lat, min_lng, max_lng = ISRAEL_BOUNDS
    return min_lat <= lat <= max_lat and min_lng <= lng <= max_lng


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


def _ask(params: dict) -> list | None:
    """One Nominatim call, rate-limited, Israel-bounds-checked. None on
    anything that fails or lands outside the country."""
    qs = urllib.parse.urlencode({**params, "country": "Israel", "format": "json", "limit": 1})
    req = urllib.request.Request(
        f"https://nominatim.openstreetmap.org/search?{qs}",
        headers={"User-Agent": USER_AGENT},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            hits = json.loads(resp.read().decode("utf-8"))
        if hits:
            lat, lng = float(hits[0]["lat"]), float(hits[0]["lon"])
            if _in_israel(lat, lng):
                return [lat, lng]
            print(f"  geocode rejected {params}: {lat},{lng} outside Israel")
    except Exception as e:  # noqa: BLE001 — a failed lookup should not crash the run
        print(f"  geocode failed {params}: {e}")
    finally:
        time.sleep(MIN_INTERVAL_S)
    return None


def geocode(
    address: str,
    zip_code: str,
    cache: dict,
    store_name: str = "",
    city_code: str = "",
    city_anchors: dict | None = None,
) -> list | None:
    """Returns [lat, lng] or None (unresolved). Mutates `cache` in place;
    caller is responsible for save_cache() once done with a whole run.

    `store_name` and `city_code` are optional and only used for the
    city-hint retry described in `city_hint` — without them this behaves
    exactly as it always did. `city_anchors` maps a city code to a
    coordinate already resolved for that code, and is what keeps the retry
    honest: a hint pulled out of a store name is a guess, and a guess that
    lands 150km from every other branch in the same municipality is wrong.
    """
    key = _cache_key(address, zip_code)
    if key in MANUAL_OVERRIDES:
        cache[key] = MANUAL_OVERRIDES[key]
        return MANUAL_OVERRIDES[key]

    if key in cache:
        return cache[key]

    if _too_vague(address):
        print(f"  geocode skipped for {address!r} ({zip_code}): no street number, too vague to trust")
        cache[key] = None
        return None

    primary = {"street": address}
    if zip_code:
        primary["postalcode"] = zip_code
    result = _ask(primary)

    # Street+ZIP alone leaves ~39% of these addresses unresolved, because
    # OpenStreetMap's Israeli street coverage is patchy and the files carry
    # no city name. The town is usually sitting in the store's own name, and
    # supplying it as a structured field resolves a good share of them.
    if result is None:
        anchor = (city_anchors or {}).get(city_code)
        trimmed = street_only(address)
        for hint in city_hints(store_name):
            candidate = _ask({"street": trimmed, "city": hint})
            if candidate is None:
                continue
            if anchor:
                km = _haversine_km(tuple(anchor), tuple(candidate))
                if km > CITY_CLUSTER_MAX_KM:
                    # The hint is a guess scraped out of a name; this check
                    # is what stops a plausible-looking wrong town being
                    # cached forever, which is exactly how branches ended up
                    # 150km out before.
                    print(
                        f"  geocode rejected hint {hint!r} for {address!r}: "
                        f"{km:.0f}km from other branches in city code {city_code}"
                    )
                    continue
            print(f"  geocode resolved {address!r} via city hint {hint!r}")
            result = candidate
            break

    cache[key] = result
    return result
