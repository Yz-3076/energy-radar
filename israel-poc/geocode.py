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


def geocode(address: str, zip_code: str, cache: dict) -> list | None:
    """Returns [lat, lng] or None (unresolved). Mutates `cache` in place;
    caller is responsible for save_cache() once done with a whole run."""
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

    params = {"street": address, "country": "Israel", "format": "json", "limit": 1}
    if zip_code:
        params["postalcode"] = zip_code
    qs = urllib.parse.urlencode(params)
    req = urllib.request.Request(
        f"https://nominatim.openstreetmap.org/search?{qs}",
        headers={"User-Agent": USER_AGENT},
    )
    result = None
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            hits = json.loads(resp.read().decode("utf-8"))
        if hits:
            lat, lng = float(hits[0]["lat"]), float(hits[0]["lon"])
            if _in_israel(lat, lng):
                result = [lat, lng]
            else:
                print(f"  geocode rejected for {address!r} ({zip_code}): {lat},{lng} is outside Israel")
    except Exception as e:  # noqa: BLE001 — a failed lookup should not crash the run
        print(f"  geocode failed for {address!r} ({zip_code}): {e}")
    finally:
        time.sleep(MIN_INTERVAL_S)

    cache[key] = result
    return result
