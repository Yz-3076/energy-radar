"""Offline tests for the geocoding rules. No network: `_ask` is replaced.

Run: `py test_geocode.py` (exits non-zero on failure).

Worth having because this module's logic has been wrong three separate
times in ways that looked right — a town check that rejected 188 of 461
correct pins, a median-anchor check that rejected the correct pins in a
town where most were wrong, and a cache that stored "rate limited" as
"this address does not exist". Each of those shipped, and each was caught
only by re-measuring live data. The cases below pin down the behaviour so
the next change to this file has to stay honest about them.
"""
import sys

import geocode as geo

HAIFA = [32.794, 34.989]
HAIFA_BRANCH = [32.8, 34.99]
TEL_AVIV = [32.08, 34.78]
EINAT = [32.0827765, 34.9394305]

failures: list[str] = []


def check(label: str, got, want) -> None:
    if got == want:
        print(f"  PASS  {label}")
    else:
        failures.append(label)
        print(f"  FAIL  {label}\n        got {got!r}\n        want {want!r}")


def stub(fn) -> None:
    geo._ask = fn
    geo._GIVE_UPS = 0


print("geocoding rules:")

# A street address in a known town resolves via street+town.
geo._TOWN_COORDS = {"חיפה": HAIFA}
stub(lambda p: (HAIFA_BRANCH, True) if "street" in p else (HAIFA, True))
cache: dict = {}
check("street+town resolves", geo.geocode("שלמה המלך 55", "3542273", cache, city_code="4000"), HAIFA_BRANCH)

# The whole point: a result in the wrong city is rejected, not stored.
# This is the real Haifa-branch-pinned-in-Tel-Aviv case.
geo._TOWN_COORDS = {"חיפה": HAIFA}
stub(lambda p: (TEL_AVIV, True) if "street" in p else (HAIFA, True))
cache = {}
check("pin outside its own town is rejected",
      geo.geocode("שלמה המלך 55", "3542273", cache, city_code="4000"), None)
check("  ...and is cached as a settled 'no'", cache, {"שלמה המלך 55|3542273": None})

# A lookup that never completed must not become a permanent verdict.
stub(lambda p: (None, False))
geo._TOWN_COORDS = {"חיפה": HAIFA}
cache = {}
geo.geocode("שלמה המלך 55", "3542273", cache, city_code="4000")
check("an unreachable geocoder is NOT cached", cache, {})

stub(lambda p: (None, True))
cache = {}
geo.geocode("רחוב דמיוני 9", "1234567", cache, city_code="4000")
check("an answered 'no such place' IS cached", cache, {"רחוב דמיוני 9|1234567": None})

# Pins cached before the city table existed must heal rather than persist.
geo._TOWN_COORDS = {"חיפה": HAIFA}
stub(lambda p: (HAIFA_BRANCH, True))
cache = {"שלמה המלך 55|3542273": TEL_AVIV}
check("a wrong cached pin is re-resolved",
      geo.geocode("שלמה המלך 55", "3542273", cache, city_code="4000"), HAIFA_BRANCH)

calls: list = []
stub(lambda p: (calls.append(p), (None, True))[1])
cache = {"שלמה המלך 55|3542273": HAIFA_BRANCH}
geo.geocode("שלמה המלך 55", "3542273", cache, city_code="4000")
check("a correct cached pin costs no lookups", len(calls), 0)

# A kibbutz shop with no street address is placed at the village; the same
# address shape in a city is not, because there the error would be large.
geo._TOWN_COORDS = {"עינת": EINAT}
stub(lambda p: (None, True))
cache = {}
check("village address -> village centre", geo.geocode("קיבוץ עינת", "", cache, city_code="871"), EINAT)

geo._TOWN_COORDS = {"תל אביב - יפו": TEL_AVIV}
cache = {}
check("vague city address stays dropped", geo.geocode("מרכז מסחרי", "", cache, city_code="5000"), None)

print("\nname hints (only consulted when a store has no city code):")
check("a street name is not accepted as a town", geo.city_hints("סופר יודה אלנבי"), [])
check("a real town in the name is accepted", geo.city_hints("שלי חיפה- אורן"), ["חיפה"])

print("\ncity code table:")
check("code 0 is not a place", geo.city_name("0"), "")
check("a city is not rural", geo.is_rural("5000"), False)
check("a kibbutz is rural", geo.is_rural("871"), True)

print(f"\n{len(failures)} failure(s)" if failures else "\nall passed")
sys.exit(1 if failures else 0)
