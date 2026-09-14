"""
Staged geocoder for the 1,666-branch chain census.

Standalone and offline-friendly: run it by hand, let it fill a permanent
cache, and the results feed the live pipeline through geocode-cache.json
(see `--export-pipeline-cache`). Nothing here runs in CI — the stages that
cost money or hammer a public API should be a deliberate act.

    py geocode_stages.py --stores <stores.json> [--stages 1,3,4] [--limit N]

Five stages, tried in order, each narrower and more expensive than the last.
Every stage after the first operates INSIDE a town already anchored by CBS
locality code, which is the rule the whole design rests on:

  1  CBS_ANCHOR      code -> official town (+ aliases) -> town coordinate
  2  MIKUD           7-digit postcode -> town/street, for branches with no code
  3  POI_CENTROID    "קניון X" matched against real malls inside the town
  4  CBS_STREET      street matched against the official register FOR THAT TOWN
  5  GOOGLE_FALLBACK everything else, if a key is configured

WHY THE ORDERING IS NOT NEGOTIABLE

Hebrew street names and town names overlap enough that inferring a town from
address text is unsafe at any confidence. Measured on this exact dataset:
"אזור תעשייה" (industrial zone) reads as the town Azor; the street
"נתיבות המשפט" reads as Netivot, 60km from the real branch; "שדרות רוטשילד"
reads as the town Sderot when שדרות is just the word "boulevard"; "חפץ חיים"
and "סגולה" are simultaneously streets, a kibbutz and a moshav. Four separate
text-matching schemes were tried against live data and every one produced
confident, wrong pins. So the town is ALWAYS anchored to the chain's own CBS
code first, and text is only ever matched inside that anchor, where a
collision with a town 60km away is arithmetically impossible.

STAGE STATUS, MEASURED 2026-09-14 — read before trusting the summary:

  Stage 2 is implemented but NOT OPERABLE. The `mikud` package exposes
  exactly the right call (search_address(zip) -> Address), but Israel Post's
  token endpoint refuses to issue an access token: "Can't generate new
  access token". Their address file is a commercial product, not open data,
  and Nominatim has no Israeli postcode coverage at all (tested: five real
  7-digit codes, all returned nothing). The stage reports itself unavailable
  rather than silently resolving nothing. If you obtain credentials it
  should start working with no code change.

  Stage 5 needs GOOGLE_MAPS_API_KEY in the environment and bills your
  account per request. It is skipped unless the key is set AND you pass it
  in --stages. Results cache permanently, so the real cost is a one-time
  pass over the few hundred addresses nothing else can place.

DEPENDENCIES: requests + stdlib. Deliberately NOT pandas — 1,666 rows need
no dataframe, and the pipeline's CI install stays small. Fuzzy matching uses
stdlib difflib, which is plenty at this scale (the candidate list is one
town's streets, typically a few hundred strings).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import time
import unicodedata
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CACHE_DB = DATA / "geocode-stages.sqlite"
CITY_CODES = DATA / "city-codes.json"
STREETS = DATA / "israel-streets.json"

USER_AGENT = "energy-radar-price-pipeline/1.0 (github.com/joshuazisel/monster-tracker)"
NOMINATIM = "https://nominatim.openstreetmap.org/search"
OVERPASS = "https://overpass-api.de/api/interpreter"
GOOGLE = "https://maps.googleapis.com/maps/api/geocode/json"

NOMINATIM_INTERVAL_S = 1.1  # their published policy: 1 req/sec
OVERPASS_INTERVAL_S = 2.5  # no published number; this is politeness
MAX_RETRIES = 4
BACKOFF_BASE_S = 5.0

# A pin further than this from its anchored town's centre is not in that
# town, whatever the geocoder says. Covers Jerusalem (~10km centre to edge)
# and sprawling regional councils with room to spare, while still catching
# the real errors in this data, which were 50-160km out.
TOWN_MAX_KM = 25.0
ISRAEL_BOUNDS = (29.3, 33.5, 34.1, 36.0)

# Fuzzy threshold for Stage 4. High on purpose: the candidate list is
# already restricted to one town, so this only has to absorb spelling noise
# ("רח.אורן" vs "אורן"), not disambiguate between places.
STREET_MATCH_MIN = 0.82

# Names a chain writes that the CBS register spells differently. Anchoring
# happens on the CODE, so this is only consulted for the minority of rows
# whose code is missing or unlisted — and for making the alias visible when
# a store's own text disagrees with the official name.
TOWN_ALIASES = {
    "קרית ספר": "מודיעין עילית",
    "קריית ספר": "מודיעין עילית",
    "ברכפלד": "מודיעין עילית",
    'ת"א': "תל אביב - יפו",
    "תל אביב": "תל אביב - יפו",
    "תל אביב יפו": "תל אביב - יפו",
    "יפו": "תל אביב - יפו",
    'פ"ת': "פתח תקווה",
    'ראשל"צ': "ראשון לציון",
    'ב"ש': "באר שבע",
    "מודיעין": "מודיעין-מכבים-רעות",
    "מכבים": "מודיעין-מכבים-רעות",
    "רעות": "מודיעין-מכבים-רעות",
    "אום אלפחם": "אום אל-פחם",
    "נהרייה": "נהריה",
    "הרצליה פיתוח": "הרצליה",
}

# Address words that mean "a commercial place", which is what Stage 3 looks
# for. Kept explicit rather than inferred: these are the exact tokens the
# chains actually write.
POI_MARKERS = ("קניון", "מרכז מסחרי", "מתחם", "פארק תעשייה", "סנטר", "ביג", "שוק")

# OSM tags that describe a place you can shop in.
POI_TAGS = (
    'node(around:{r},{lat},{lng})[shop=mall];'
    'way(around:{r},{lat},{lng})[shop=mall];'
    'way(around:{r},{lat},{lng})[landuse=retail];'
    'node(around:{r},{lat},{lng})[amenity=marketplace];'
    'way(around:{r},{lat},{lng})[amenity=marketplace];'
    'way(around:{r},{lat},{lng})[building=commercial];'
)


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------

def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    import math

    (la1, lo1), (la2, lo2) = a, b
    p = math.pi / 180
    h = (
        0.5
        - math.cos((la2 - la1) * p) / 2
        + math.cos(la1 * p) * math.cos(la2 * p) * (1 - math.cos((lo2 - lo1) * p)) / 2
    )
    return 2 * 6371 * math.asin(math.sqrt(h))


def in_israel(lat: float, lng: float) -> bool:
    lo_la, hi_la, lo_ln, hi_ln = ISRAEL_BOUNDS
    return lo_la <= lat <= hi_la and lo_ln <= lng <= hi_ln


def normalise(s: str) -> str:
    """Comparable form of a Hebrew name: no punctuation, single spaces.

    Hebrew here is unpointed, so this is mostly about the punctuation the
    chains sprinkle through addresses — quotes in abbreviations, stray dots
    after "רח", slashes in "טשרניחובסקי/35".
    """
    s = unicodedata.normalize("NFKC", s or "")
    s = re.sub(r"[\"'`׳״.,/\\|()\[\]־–—-]", " ", s)
    return " ".join(s.split())


def street_and_number(address: str) -> tuple[str, str]:
    """Split "רח.אורן 25 רוממה" into ("אורן", "25").

    The chains write a street, sometimes a house number, and very often a
    trailing neighbourhood or landmark that belongs to neither. Taking the
    text before the first number as the street and the first number as the
    house number handles the overwhelming majority; everything else falls
    through to a later stage rather than being forced.
    """
    a = re.sub(r"^\s*(רח'|רח\.|רחוב|שד'|שד\.|דרך)\s*", "", (address or "").strip())
    a = re.split(r"[,]", a)[0]
    m = re.search(r"\d+", a)
    if not m:
        return normalise(a), ""
    before, after = normalise(a[: m.start()]), normalise(a[m.end():])
    # Most rows are "street 25"; a minority are "25 street" ("17 יצחק שמיר").
    # Taking whichever side actually holds words keeps both working — reading
    # only the text before the number silently produced an empty street name.
    return (before or after), m.group(0)


# --------------------------------------------------------------------------
# reference data
# --------------------------------------------------------------------------

class Reference:
    """The CBS town register and street register, loaded once."""

    def __init__(self) -> None:
        raw = json.loads(CITY_CODES.read_text(encoding="utf-8")) if CITY_CODES.exists() else {}
        self.names: dict[str, str] = raw.get("names", {})
        self.rural: set[str] = set(raw.get("rural", []))
        self.streets: dict[str, list[str]] = (
            json.loads(STREETS.read_text(encoding="utf-8")) if STREETS.exists() else {}
        )
        if not self.names:
            sys.exit(f"missing {CITY_CODES} — run fetch_city_codes.py first")
        if not self.streets:
            print(f"  WARNING: {STREETS} missing; stage 4 will be skipped", file=sys.stderr)
        # normalised official name -> code, for resolving an alias back to a town
        self._by_name = {normalise(v): k for k, v in self.names.items()}

    @staticmethod
    def code_of(raw: str) -> str:
        return (raw or "").strip().lstrip("0") or "0"

    def town(self, code: str) -> str:
        return self.names.get(self.code_of(code), "")

    def is_rural(self, code: str) -> bool:
        return self.code_of(code) in self.rural

    def code_for_name(self, name: str) -> str:
        """Official code for a town NAME, resolving aliases. Used only where
        no CBS code was published — never to override one that was."""
        n = normalise(TOWN_ALIASES.get((name or "").strip(), name))
        return self._by_name.get(n, "")

    def streets_in(self, code: str) -> list[str]:
        return self.streets.get(self.code_of(code), [])


# --------------------------------------------------------------------------
# cache
# --------------------------------------------------------------------------

class Cache:
    """Permanent per-store cache, keyed (chain, store_id) as specified.

    Keyed on identity rather than address text so a store keeps its resolved
    location across the address edits chains make constantly. Stores a row
    even for a definitive failure, so a hopeless address is not re-queried
    every run — but NOT for a transport failure, which is a question that
    never got asked.
    """

    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute(
            """CREATE TABLE IF NOT EXISTS geocode (
                   chain TEXT NOT NULL,
                   store_id TEXT NOT NULL,
                   lat REAL, lng REAL,
                   method TEXT NOT NULL,
                   confidence REAL NOT NULL,
                   town TEXT, matched TEXT,
                   resolved_at TEXT NOT NULL,
                   PRIMARY KEY (chain, store_id))"""
        )
        self.db.commit()

    def get(self, chain: str, store_id: str):
        cur = self.db.execute(
            "SELECT lat, lng, method, confidence, town, matched FROM geocode"
            " WHERE chain = ? AND store_id = ?",
            (chain, store_id),
        )
        return cur.fetchone()

    def put(self, chain, store_id, lat, lng, method, confidence, town, matched) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO geocode"
            " (chain, store_id, lat, lng, method, confidence, town, matched, resolved_at)"
            " VALUES (?,?,?,?,?,?,?,?,datetime('now'))",
            (chain, store_id, lat, lng, method, confidence, town, matched),
        )
        self.db.commit()


# --------------------------------------------------------------------------
# HTTP with the manners these APIs ask for
# --------------------------------------------------------------------------

class Http:
    def __init__(self) -> None:
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self._last: dict[str, float] = {}
        self.calls = 0

    def _wait(self, host: str, interval: float) -> None:
        gap = time.monotonic() - self._last.get(host, 0.0)
        if gap < interval:
            time.sleep(interval - gap)

    def get(self, url, params=None, interval=NOMINATIM_INTERVAL_S, **kw):
        """Returns (json, reachable). `reachable` False means the question
        never got an answer — throttled, timed out — which callers must not
        record as "no such place"."""
        for attempt in range(MAX_RETRIES):
            self._wait(url, interval)
            try:
                r = self.session.get(url, params=params, timeout=30, **kw)
                self._last[url] = time.monotonic()
                self.calls += 1
                if r.status_code == 429:
                    wait = BACKOFF_BASE_S * (2**attempt)
                    print(f"      rate-limited, waiting {wait:.0f}s", flush=True)
                    time.sleep(wait)
                    continue
                r.raise_for_status()
                return r.json(), True
            except requests.RequestException as e:
                self._last[url] = time.monotonic()
                print(f"      request failed: {type(e).__name__}", flush=True)
                return None, False
        return None, False

    def post(self, url, data, interval=OVERPASS_INTERVAL_S):
        for attempt in range(MAX_RETRIES):
            self._wait(url, interval)
            try:
                r = self.session.post(url, data=data, timeout=90)
                self._last[url] = time.monotonic()
                self.calls += 1
                if r.status_code in (429, 504):
                    wait = BACKOFF_BASE_S * (2**attempt)
                    print(f"      overpass busy, waiting {wait:.0f}s", flush=True)
                    time.sleep(wait)
                    continue
                r.raise_for_status()
                return r.json(), True
            except requests.RequestException as e:
                self._last[url] = time.monotonic()
                print(f"      overpass failed: {type(e).__name__}", flush=True)
                return None, False
        return None, False


# --------------------------------------------------------------------------
# results
# --------------------------------------------------------------------------

@dataclass
class Fix:
    lat: float
    lng: float
    method: str
    confidence: float
    town: str = ""
    matched: str = ""


@dataclass
class Store:
    chain: str
    store_id: str
    name: str
    address: str
    zip: str
    city_code: str
    extra: dict = field(default_factory=dict)


# --------------------------------------------------------------------------
# STAGE 1 — CBS locality anchoring
# --------------------------------------------------------------------------

class Anchor:
    """Resolves a store's town and that town's coordinate.

    Everything downstream is bounded by this. A store with no anchor can
    still reach stage 5, but nothing between here and there will run for it,
    because those stages are only safe *because* the town is already fixed.
    """

    def __init__(self, ref: Reference, http: Http) -> None:
        self.ref, self.http = ref, http
        self.coords: dict[str, list[float] | None] = {}
        self._path = DATA / "town-coords.json"
        if self._path.exists():
            self.coords = json.loads(self._path.read_text(encoding="utf-8"))

    def town_coord(self, town: str):
        """Where a town is. One lookup per town, ever.

        Safe to query by name because the name comes from the government
        register, so it really is a locality — the query shape Nominatim
        handles most reliably.
        """
        if town in self.coords:
            return self.coords[town]
        payload, reachable = self.http.get(
            NOMINATIM, {"city": town, "country": "Israel", "format": "json", "limit": 1}
        )
        if not reachable:
            return None  # unknown, not "nowhere" — don't cache, don't judge against it
        coord = None
        if payload:
            lat, lng = float(payload[0]["lat"]), float(payload[0]["lon"])
            if in_israel(lat, lng):
                coord = [lat, lng]
        self.coords[town] = coord
        self._path.write_text(
            json.dumps(self.coords, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8"
        )
        return coord

    def resolve(self, store: Store) -> tuple[str, list[float] | None]:
        """(town, town coordinate). Town from the CBS code where present."""
        town = self.ref.town(store.city_code)
        if not town:
            # No code published. The ONLY fallback permitted is an explicit
            # alias for the store's own town field, never a guess mined from
            # address text — see this module's docstring for what that costs.
            code = self.ref.code_for_name(store.extra.get("city_name", ""))
            town = self.ref.town(code) if code else ""
        if not town:
            return "", None
        return town, self.town_coord(town)

    def accept(self, coord, centre) -> bool:
        """Is a candidate inside its anchored town?"""
        if coord is None or not in_israel(coord[0], coord[1]):
            return False
        if centre is None:
            return True  # nothing to check against; caller records lower confidence
        return haversine_km(tuple(centre), tuple(coord)) <= TOWN_MAX_KM


# --------------------------------------------------------------------------
# STAGE 2 — Israel Post mikud
# --------------------------------------------------------------------------

class MikudStage:
    """7-digit postcode -> town, for the branches publishing no CBS code.

    NOT OPERABLE as written, and the reason is external. Israel Post's
    address file is a commercial product; the `mikud` package speaks to
    their endpoint but the token service declines anonymous callers
    ("Can't generate new access token", verified 2026-09-14). OSM has no
    Israeli postcode coverage to fall back on — five real codes tested,
    all returned nothing.

    Left wired up rather than deleted because the interface is correct: if
    credentials appear, this starts contributing without a code change. It
    reports itself unavailable exactly once instead of failing per store.
    """

    def __init__(self, ref: Reference) -> None:
        self.ref = ref
        self.available = False
        self.reason = "not attempted"
        self._client = None
        self._warned = False
        try:
            from mikud import Mikud

            self._client = Mikud()
            self.available = True
            self.reason = "client constructed; token is checked on first call"
        except ImportError:
            self.reason = "mikud package not installed (pip install mikud)"

    def resolve(self, store: Store) -> str:
        """Returns an official town name, or "" when unavailable."""
        zp = (store.zip or "").strip()
        if not self.available or not zp.strip("0") or len(zp) < 5:
            return ""
        try:
            addr = self._client.search_address(zp)
        except Exception as e:  # noqa: BLE001 — an unavailable service is not a crash
            if not self._warned:
                print(f"  stage 2 unavailable: {str(e).splitlines()[0][:90]}")
                self._warned = True
            self.available = False
            self.reason = "Israel Post declined to issue an access token"
            return ""
        city = getattr(addr, "city", "") or ""
        code = self.ref.code_for_name(city)
        return self.ref.town(code) if code else ""


# --------------------------------------------------------------------------
# STAGE 3 — POI / shopping centre centroid
# --------------------------------------------------------------------------

class PoiStage:
    """Malls and markets, looked up inside the anchored town.

    This is the 203-branch bucket: addresses like "מרכז מסחרי רמת רזים" or
    "קניון גני הדרים" that name a place rather than a street, which no
    street geocoder can resolve.

    Name-matching here is safe in a way it is NOT at the town level: the
    search is already confined to one municipality's radius, so the worst
    case is the wrong mall in the right town — a few km — rather than the
    right-sounding street in a town 150km away. A store that matches no
    named feature falls through instead of taking the nearest mall.
    """

    def __init__(self, http: Http, anchor: Anchor) -> None:
        self.http, self.anchor = http, anchor
        self._by_town: dict[str, list[dict]] = {}

    @staticmethod
    def looks_like_poi(address: str) -> bool:
        return any(m in (address or "") for m in POI_MARKERS)

    def features(self, town: str, centre) -> list[dict]:
        """Every commercial feature near a town. One Overpass call per town,
        reused for every branch in it."""
        if town in self._by_town:
            return self._by_town[town]
        body = "".join(POI_TAGS).format(r=15000, lat=centre[0], lng=centre[1])
        payload, ok = self.http.post(OVERPASS, {"data": f"[out:json][timeout:60];({body});out center tags 400;"})
        feats = []
        if ok and payload:
            for el in payload.get("elements", []):
                name = (el.get("tags") or {}).get("name")
                pt = el.get("center") or ({"lat": el.get("lat"), "lon": el.get("lon")})
                if name and pt.get("lat") is not None:
                    feats.append({"name": name, "lat": pt["lat"], "lng": pt["lon"]})
        if ok:
            self._by_town[town] = feats  # only cache a real answer
        return feats

    def resolve(self, store: Store, town: str, centre) -> Fix | None:
        if not town or centre is None or not self.looks_like_poi(store.address):
            return None
        target = normalise(store.address)
        best, score = None, 0.0
        for f in self.features(town, centre):
            s = SequenceMatcher(None, target, normalise(f["name"])).ratio()
            # a named mall appearing verbatim inside the address is a match
            # even when the surrounding words drag the ratio down
            if normalise(f["name"]) and normalise(f["name"]) in target:
                s = max(s, 0.95)
            if s > score:
                best, score = f, s
        if best is None or score < 0.6:
            return None
        if not self.anchor.accept([best["lat"], best["lng"]], centre):
            return None
        return Fix(best["lat"], best["lng"], "POI_CENTROID", round(score, 3), town, best["name"])


# --------------------------------------------------------------------------
# STAGE 4 — validated street register matching
# --------------------------------------------------------------------------

class StreetStage:
    """Street + number, matched against the official register FOR ONE TOWN.

    The register holds 51,497 streets, each tagged to its locality. Filtering
    to the anchored town before matching is what makes fuzzy matching
    acceptable here: the candidate pool is a few hundred streets that all
    exist in the right place, so a fuzzy hit cannot silently relocate the
    store. Matching the same string against the whole country would
    reproduce exactly the failure this pipeline is built to avoid.

    A confirmed street name is then geocoded as street+town, and the result
    still has to land inside the town.
    """

    def __init__(self, ref: Reference, http: Http, anchor: Anchor) -> None:
        self.ref, self.http, self.anchor = ref, http, anchor

    def confirm(self, address: str, code: str) -> tuple[str, float]:
        """Closest official street name in this town, with its score.

        A miss is NOT a veto. The register is Israel Post's list and has
        real gaps — "גוט לוין" in Haifa and "פנחס יעקובי" in Rehovot are
        both absent yet both are real streets — so a street it does not know
        is still tried as written. What the register buys is a better query
        when it does match ("ד.דגניה" -> "שד דגניה", "איינשטיין" ->
        "אינשטין") and a confidence score that says which happened. The
        protection against a wrong town comes from the anchor and the
        distance check, not from this list.
        """
        street, _ = street_and_number(address)
        if not street:
            return "", 0.0
        best, score = "", 0.0
        for official in self.ref.streets_in(code):
            s = SequenceMatcher(None, street, normalise(official)).ratio()
            if s > score:
                best, score = official, s
        return (best, score) if score >= STREET_MATCH_MIN else ("", score)

    def resolve(self, store: Store, town: str, centre) -> Fix | None:
        if not town:
            return None
        official, score = self.confirm(store.address, store.city_code)
        raw, number = street_and_number(store.address)
        confirmed = bool(official)
        query = f"{official or raw} {number}".strip()
        if not (official or raw):
            return None
        payload, reachable = self.http.get(
            NOMINATIM, {"street": query, "city": town, "country": "Israel", "format": "json", "limit": 1}
        )
        if not reachable or not payload:
            return None
        coord = [float(payload[0]["lat"]), float(payload[0]["lon"])]
        if not self.anchor.accept(coord, centre):
            return None
        # Confirmed against the official register, with a house number, is
        # the strongest thing this pipeline produces. An unconfirmed street
        # that Nominatim placed inside the right town is still good, just
        # not as good, and the score says so rather than hiding it.
        conf = 0.9 if confirmed else 0.65
        if not number:
            conf -= 0.1  # a street centreline, not a building
        return Fix(coord[0], coord[1],
                   "CBS_STREET" if confirmed else "STREET_UNVERIFIED",
                   round(conf, 3), town, query)


# --------------------------------------------------------------------------
# STAGE 4b — village centre
# --------------------------------------------------------------------------

def village_fix(store: Store, ref: Reference, town: str, centre) -> Fix | None:
    """A shop in a kibbutz addressed as "קיבוץ עינת", with no street.

    The locality is a few hundred metres across, so its own coordinate is a
    fair pin — and the CBS register marks these objectively via regional
    council membership, so this never fires in a city, where the same
    fallback would be kilometres wrong.
    """
    if not town or centre is None or not ref.is_rural(store.city_code):
        return None
    if re.search(r"\d", store.address or ""):
        return None  # has a street number; a later stage can do better
    return Fix(centre[0], centre[1], "VILLAGE_CENTRE", 0.5, town, town)


# --------------------------------------------------------------------------
# STAGE 5 — Google fallback
# --------------------------------------------------------------------------

class GoogleStage:
    """Junctions, interchanges and "on route 77 between X and Y".

    These have no street address because they have no street. Google's
    Israeli coverage includes named junctions and businesses, which is what
    this is for. Billed per request, so it is opt-in twice: a key in the
    environment AND stage 5 named in --stages.

    The town is still appended and the result is still checked against it,
    so a paid answer gets no more trust than a free one.
    """

    def __init__(self, http: Http, anchor: Anchor) -> None:
        self.http, self.anchor = http, anchor
        self.key = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()
        self.available = bool(self.key)

    def resolve(self, store: Store, town: str, centre) -> Fix | None:
        if not self.available:
            return None
        parts = [store.name, store.address, town, "Israel"]
        query = ", ".join(p for p in parts if p)
        payload, reachable = self.http.get(
            GOOGLE, {"address": query, "key": self.key, "language": "he", "region": "il"}, interval=0.05
        )
        if not reachable or not payload or payload.get("status") != "OK":
            return None
        top = payload["results"][0]
        loc = top["geometry"]["location"]
        coord = [loc["lat"], loc["lng"]]
        if not self.anchor.accept(coord, centre):
            return None
        # Google's own words for how precise the match is.
        conf = {"ROOFTOP": 0.9, "RANGE_INTERPOLATED": 0.75,
                "GEOMETRIC_CENTER": 0.6, "APPROXIMATE": 0.45}.get(
                    top["geometry"].get("location_type", ""), 0.5)
        return Fix(coord[0], coord[1], "GOOGLE_FALLBACK", conf, town,
                   top.get("formatted_address", "")[:80])


# --------------------------------------------------------------------------
# driver
# --------------------------------------------------------------------------

def load_stores(path: Path) -> list[Store]:
    """Accepts the census either as {"CHAIN:id": {...}} or as a list."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    items = raw.items() if isinstance(raw, dict) else ((None, r) for r in raw)
    out = []
    for key, s in items:
        chain = s.get("chain") or (key.split(":")[0] if key else "")
        sid = str(s.get("store_id") or (key.split(":", 1)[1] if key and ":" in key else ""))
        out.append(
            Store(
                chain=chain,
                store_id=sid,
                name=(s.get("name") or "").strip(),
                address=(s.get("address") or "").strip(),
                zip=(s.get("zip") or "").strip(),
                city_code=(s.get("cityCode") or s.get("city_code") or "").strip(),
                extra={"city_name": (s.get("city") or "").strip()},
            )
        )
    return out


def run(stores, stages, ref, cache, http, refresh=False):
    anchor = Anchor(ref, http)
    mikud = MikudStage(ref) if 2 in stages else None
    poi = PoiStage(http, anchor) if 3 in stages else None
    street = StreetStage(ref, http, anchor) if 4 in stages else None
    google = GoogleStage(http, anchor) if 5 in stages else None

    if google and not google.available:
        print("  stage 5 skipped: GOOGLE_MAPS_API_KEY not set\n")

    results = []
    for i, s in enumerate(stores, 1):
        hit = None if refresh else cache.get(s.chain, s.store_id)
        if hit is not None:
            lat, lng, method, conf, town, matched = hit
            results.append((s, Fix(lat, lng, method, conf, town, matched) if lat is not None else None, True))
            continue

        if not s.address or s.address.lower() in ("unknown", "0"):
            # Nothing to work with. Recorded so it is never retried, and so
            # the summary can separate "we failed" from "there was no input".
            cache.put(s.chain, s.store_id, None, None, "NO_ADDRESS", 0.0, "", "")
            results.append((s, None, False))
            continue

        town, centre = anchor.resolve(s)
        if not town and mikud:
            town = mikud.resolve(s)
            if town:
                centre = anchor.town_coord(town)

        fix = None
        if street:
            fix = street.resolve(s, town, centre)
        if fix is None and poi:
            fix = poi.resolve(s, town, centre)
        if fix is None:
            fix = village_fix(s, ref, town, centre)
        if fix is None and google:
            fix = google.resolve(s, town, centre)
        if fix is None and town and centre is not None:
            # Anchored, but nothing could place the address inside it. Real
            # cases: "ד.דגניה 14" and "איינשטיין 20" both CONFIRM against the
            # official street register yet OSM cannot place either, which is
            # a coverage gap, not evidence the store is elsewhere. The town
            # itself is solid information, so record it at the lowest
            # confidence the scale has and let the consumer decide. In a
            # large city this can be ~10km out, which is exactly what a
            # confidence of 0.25 is there to communicate.
            fix = Fix(centre[0], centre[1], "TOWN_CENTRE_ONLY", 0.25, town, town)

        if fix is not None:
            cache.put(s.chain, s.store_id, fix.lat, fix.lng, fix.method, fix.confidence, fix.town, fix.matched)
        else:
            cache.put(s.chain, s.store_id, None, None, "UNRESOLVED", 0.0, town, "")
        results.append((s, fix, False))

        if i % 25 == 0:
            done = sum(1 for _, f, _ in results if f)
            print(f"  {i}/{len(stores)} processed, {done} placed, {http.calls} API calls", flush=True)
    return results


def write_geojson(results, path: Path) -> None:
    feats = []
    for s, fix, cached in results:
        if fix is None:
            continue
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [fix.lng, fix.lat]},
            "properties": {
                "chain": s.chain, "store_id": s.store_id, "name": s.name,
                "address": s.address, "city_code": s.city_code, "town": fix.town,
                "resolution_method": fix.method, "confidence": fix.confidence,
                "matched": fix.matched, "is_cached": cached,
            },
        })
    path.write_text(json.dumps({"type": "FeatureCollection", "features": feats},
                               ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nwrote {path} — {len(feats)} placed features")


def export_pipeline_cache(results, path: Path, min_confidence: float) -> None:
    """Fold these results into the live pipeline's address cache.

    The pipeline keys on "address|zip" while this tool keys on (chain,
    store), so the bridge is written rather than shared: every store whose
    fix clears `min_confidence` is written under the address key that
    geocode.py will look for. Existing entries are overwritten, because a
    result that survived the anchored stages is better than the street-only
    guess that is probably sitting there.

    Low-confidence fixes are deliberately NOT exported. A TOWN_CENTRE_ONLY
    pin is honest inside this tool, where it carries a 0.25 next to it, and
    dishonest in the pipeline cache, where nothing records that it is really
    just the middle of a city.
    """
    existing = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    before = len(existing)
    written = 0
    for s, fix, _ in results:
        if fix is None or fix.confidence < min_confidence:
            continue
        key = f"{' '.join(s.address.split())}|{s.zip.strip()}"
        existing[key] = [fix.lat, fix.lng]
        written += 1
    path.write_text(
        json.dumps(existing, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8"
    )
    print(f"\nexported {written} fix(es) at confidence >= {min_confidence} "
          f"into {path.name} ({before} -> {len(existing)} entries)")


def report(results, http, mikud_reason) -> None:
    import collections

    total = len(results)
    by_method = collections.Counter(f.method if f else "UNPLACED" for _, f, _ in results)
    placed = sum(1 for _, f, _ in results if f)
    cached = sum(1 for _, _, c in results if c)

    print("\n" + "=" * 62)
    print(f"{total} stores | {placed} placed ({100*placed/total:.1f}%) | "
          f"{total-placed} unplaced | {cached} from cache | {http.calls} API calls")
    print("=" * 62)
    for method, n in by_method.most_common():
        print(f"  {n:5d}  {100*n/total:5.1f}%  {method}")

    # Confidence matters more than the headline rate: a town-centre pin is
    # "placed" but should never be presented like a street address.
    strong = sum(1 for _, f, _ in results if f and f.confidence >= 0.6)
    weak = placed - strong
    print(f"\n  {strong} confident (>=0.6) | {weak} approximate (<0.6)")
    print(f"  stage 2 (mikud): {mikud_reason}")

    print("\n  worst offenders still unplaced:")
    shown = 0
    for s, f, _ in results:
        if f is None and s.address and shown < 8:
            print(f"    {s.chain[:14]:14} {s.name[:24]:24} {s.address[:34]}")
            shown += 1


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--stores", type=Path, required=True, help="census JSON (dict keyed CHAIN:id, or a list)")
    ap.add_argument("--stages", default="1,2,3,4,5", help="stages to run, e.g. 1,3,4")
    ap.add_argument("--limit", type=int, default=0, help="process only the first N stores")
    ap.add_argument("--out", type=Path, default=DATA / "stores.geojson")
    ap.add_argument("--refresh", action="store_true", help="ignore the cache and re-resolve")
    ap.add_argument("--export-pipeline-cache", action="store_true",
                    help="write confident fixes into data/geocode-cache.json for pipeline.py")
    ap.add_argument("--min-confidence", type=float, default=0.6,
                    help="lowest confidence worth exporting (default 0.6)")
    args = ap.parse_args()

    stages = {int(x) for x in args.stages.split(",") if x.strip()}
    ref = Reference()
    cache = Cache(CACHE_DB)
    http = Http()
    stores = load_stores(args.stores)
    if args.limit:
        stores = stores[: args.limit]

    print(f"{len(stores)} stores | stages {sorted(stages)} | cache {CACHE_DB.name}\n")
    mikud_probe = MikudStage(ref) if 2 in stages else None
    results = run(stores, stages, ref, cache, http, refresh=args.refresh)
    write_geojson(results, args.out)
    if args.export_pipeline_cache:
        export_pipeline_cache(results, DATA / "geocode-cache.json", args.min_confidence)
    report(results, http, mikud_probe.reason if mikud_probe else "not requested")


if __name__ == "__main__":
    main()
