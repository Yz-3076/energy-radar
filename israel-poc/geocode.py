"""
Address -> (lat, lng), cached forever in data/geocode-cache.json.

Uses OpenStreetMap's Nominatim — free, keyless, but rate- and usage-policy-
limited (nominatim.org/release-docs/latest/api/Usage_Policy/): max 1
request/second, and it wants a real identifying User-Agent, not a browser
UA. Since we cache every result permanently and only ever geocode a NEW
address once (addresses don't move), a run only ever pays this cost for
stores never seen before — most runs geocode nothing at all.

Chain price files give a numeric city code, not a city name (see
docs/israel-pipeline.md), so this geocodes on street address + ZIP + country
only. That is enough for Nominatim to resolve correctly in the large
majority of cases; a lookup that comes back empty is recorded as `null` in
the cache rather than retried every run (a bad address doesn't get better by
asking again).
"""

import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

CACHE_PATH = Path(__file__).resolve().parent.parent / "data" / "geocode-cache.json"
USER_AGENT = "energy-radar-price-pipeline/1.0 (github.com/joshuazisel/monster-tracker)"
MIN_INTERVAL_S = 1.1  # Nominatim policy: max 1 req/sec; a little slack


def load_cache() -> dict:
    if CACHE_PATH.exists():
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    return {}


def save_cache(cache: dict) -> None:
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


def _cache_key(address: str, zip_code: str) -> str:
    return f"{address.strip()}|{zip_code.strip()}"


def geocode(address: str, zip_code: str, cache: dict) -> list | None:
    """Returns [lat, lng] or None (unresolved). Mutates `cache` in place;
    caller is responsible for save_cache() once done with a whole run."""
    key = _cache_key(address, zip_code)
    if key in cache:
        return cache[key]

    query = f"{address}, {zip_code}, Israel" if zip_code else f"{address}, Israel"
    qs = urllib.parse.urlencode({"q": query, "format": "json", "limit": 1})
    req = urllib.request.Request(
        f"https://nominatim.openstreetmap.org/search?{qs}",
        headers={"User-Agent": USER_AGENT},
    )
    result = None
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            hits = json.loads(resp.read().decode("utf-8"))
        if hits:
            result = [float(hits[0]["lat"]), float(hits[0]["lon"])]
    except Exception as e:  # noqa: BLE001 — a failed lookup should not crash the run
        print(f"  geocode failed for {query!r}: {e}")
    finally:
        time.sleep(MIN_INTERVAL_S)

    cache[key] = result
    return result
