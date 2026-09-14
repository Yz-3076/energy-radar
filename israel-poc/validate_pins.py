"""Audit the pins already on the map against the town each store is filed in.

Read-only, and safe to run any time. The pipeline's verify_pins() does the
same check and actually drops the bad pins; this exists to see the damage
without waiting for a full run, and to answer "is this store really there"
when something on the map looks wrong.

Needs data/latest.json to carry `city`, which it only does for runs after
the CBS code table landed. Older snapshots have an empty city on every store
and this will report everything as unverifiable — that is the file being
stale, not the pins being bad.

An earlier version of this script checked pins against a town parsed out of
the store NAME and, on that basis, deleted 191 geocode-cache entries. That
check was wrong far more often than right — Israeli store names are usually
their own street name — and the deletions were pointless, since a purged
entry is simply looked up again. This version deletes nothing.
"""
import collections
import json
from pathlib import Path

import geocode as geo

DATA = Path(__file__).resolve().parent.parent / "data"
stores = json.loads((DATA / "latest.json").read_text(encoding="utf-8"))

bad, unverifiable = [], 0
spread = collections.Counter()
for s in stores:
    town = (s.get("city") or "").strip()
    centre = geo.town_coord(town) if town else None
    if centre is None:
        unverifiable += 1
        continue
    km = geo._haversine_km(tuple(centre), (s["lat"], s["lng"]))
    spread[town] = max(spread[town], round(km))
    if km > geo.TOWN_MAX_KM:
        bad.append((km, town, s))

for km, town, s in sorted(bad, reverse=True, key=lambda x: x[0]):
    print(f'  {km:6.0f}km  {s["chain"][:14]:14s} {s["name"][:28]:28s} '
          f'{s["address"][:24]:24s} filed in {town}')

print(f"\n{len(bad)} of {len(stores)} pins sit outside their own town "
      f"({unverifiable} unverifiable — no town on the store)")

print("\nfurthest pin from the town centre, by town (a town near the "
      f"{geo.TOWN_MAX_KM:.0f}km limit is worth a look):")
for town, km in spread.most_common(12):
    print(f"  {km:4d}km  {town}")
