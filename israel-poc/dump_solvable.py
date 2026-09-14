"""Write the branches that still have no location, sorted by how fixable they are.

    py dump_solvable.py [--out ../data/unresolved.txt]

The point is triage. "203 unplaced" is one number hiding five different
problems, and only some of them are work anyone can do. A branch whose
address field literally says "unknown" is not waiting on better code; a
branch whose chain forgot the city code but whose name says "אשקלון" is.

Groups, most fixable first:

  1 CHAIN_INTERNAL_CODE  The chain used its own 5-digit code instead of the
                         CBS one, but the town is written in the store name
                         and is a real locality. Resolvable with a lookup
                         table of those codes.
  2 TOWN_ALIAS           No city code, but the name carries a town under a
                         colloquial name (קרית ספר = מודיעין עילית). Only
                         safe for names in an explicit alias list -- mining
                         free text for town names is what produced wrong
                         pins four separate times (see geocode_stages.py).
  3 MALL_OR_CENTRE       Addressed as a mall or commercial centre. Needs a
                         POI source with better Israeli coverage than OSM.
  4 JUNCTION_OR_HIGHWAY  A road junction or interchange. Has no street
                         address because it has none; a geocoder that knows
                         named junctions can place these.
  5 STREET_NOT_FOUND     Has a proper CBS town and a normal-looking street,
                         which simply is not in OpenStreetMap. Nothing to
                         deduce -- needs a geocoder with better coverage.
  6 NO_CITY_CODE         No city code and nothing else to anchor on.
  7 NO_ADDRESS_AT_ALL    The address field is empty or literally "unknown".
                         NOT SOLVABLE from this data at any effort. The
                         chain did not publish where the shop is.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

SOLVABLE = {
    "1 CHAIN_INTERNAL_CODE": "likely — town is in the store name; needs a code lookup table",
    "2 TOWN_ALIAS": "likely — town present under a colloquial name; needs an alias entry",
    "3 MALL_OR_CENTRE": "maybe — needs a POI source with better Israeli mall coverage",
    "4 JUNCTION_OR_HIGHWAY": "maybe — needs a geocoder that knows named junctions",
    "5 STREET_NOT_FOUND": "maybe — real street, missing from OpenStreetMap",
    "6 NO_CITY_CODE": "hard — nothing objective to anchor the town on",
    "7 NO_ADDRESS_AT_ALL": "NO — the chain published no address",
}


def classify(store: dict, town: str) -> str:
    addr = (store.get("address") or "").strip()
    code = (store.get("cityCode") or "").strip()
    if not addr or addr.lower() in ("unknown", "0"):
        return "7 NO_ADDRESS_AT_ALL"
    if code and len(code) == 5 and code.startswith("10"):
        return "1 CHAIN_INTERNAL_CODE"
    if re.search(r"צומת|מחלף|כביש \d|קילומטר|ק\"מ", addr):
        return "4 JUNCTION_OR_HIGHWAY"
    if re.search(r"קניון|מרכז מסחרי|מתחם|סנטר|פארק תעשייה", addr):
        return "3 MALL_OR_CENTRE"
    if town:
        return "5 STREET_NOT_FOUND"
    if re.search(r"קרית ספר|קריית ספר|ברכפלד|עילית", (store.get("name") or "") + addr):
        return "2 TOWN_ALIAS"
    return "6 NO_CITY_CODE"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=DATA / "unresolved.txt")
    args = ap.parse_args()

    census = json.loads((DATA / "store-census.json").read_text(encoding="utf-8"))
    db = sqlite3.connect(DATA / "geocode-stages.sqlite")
    towns = {f"{c}:{s}": (t or "") for c, s, t in
             db.execute("select chain,store_id,town from geocode where lat is null")}

    groups: dict[str, list] = defaultdict(list)
    for key, store in census.items():
        if key not in towns:
            continue
        groups[classify(store, towns[key])].append((key, store, towns[key]))

    total = sum(len(v) for v in groups.values())
    solvable = total - len(groups.get("7 NO_ADDRESS_AT_ALL", []))

    out = [
        f"{total} branches still without a location, grouped by how fixable each one is.",
        f"{solvable} have something to work with. "
        f"{len(groups.get('7 NO_ADDRESS_AT_ALL', []))} do not — see group 7.",
        "",
        "Columns: CHAIN | STORE_ID | STORE_NAME | RAW_ADDRESS | CITY_CODE | ANCHORED_TOWN",
        "=" * 100,
    ]
    for name in sorted(groups):
        rows = groups[name]
        out += ["", f"### {name}  ({len(rows)} branches)", f"### fixable: {SOLVABLE[name]}", ""]
        for key, s, town in sorted(rows, key=lambda r: r[0]):
            chain, sid = key.split(":", 1)
            out.append("\t".join([
                chain, sid,
                " ".join((s.get("name") or "").split()),
                " ".join((s.get("address") or "").split()) or "(empty)",
                (s.get("cityCode") or "").strip() or "-",
                town or "-",
            ]))

    args.out.write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"wrote {args.out} — {total} branches, {solvable} with something to work with")
    for name in sorted(groups):
        print(f"  {len(groups[name]):4d}  {name}")


if __name__ == "__main__":
    main()
