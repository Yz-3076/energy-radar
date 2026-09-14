"""Dump every branch and its location, exactly as published and as resolved.

    py dump_locations.py --stores <census.json> [--out ../data/locations.txt]

One line per branch, nothing filtered, nothing prettified. The address, city
code and ZIP are reproduced byte-for-byte from the chain's own XML — including
the empty ones, the literal "unknown", the double spaces and the stray
punctuation — because the point of this file is to see what the source
actually says, not what the pipeline made of it.

Columns are tab-separated so the file opens cleanly in a spreadsheet while
staying readable in a terminal. RESOLVED_* columns are blank where the store
has not been geocoded yet.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

COLUMNS = [
    "CHAIN", "STORE_ID", "STORE_NAME",
    "RAW_ADDRESS", "RAW_CITY_CODE", "RAW_ZIP",
    "RESOLVED_TOWN", "RESOLVED_LAT", "RESOLVED_LNG",
    "METHOD", "CONFIDENCE", "MATCHED_AS",
]


def load_census(path: Path) -> list[tuple[str, str, dict]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    items = raw.items() if isinstance(raw, dict) else ((None, r) for r in raw)
    out = []
    for key, s in items:
        chain = s.get("chain") or (key.split(":")[0] if key else "")
        sid = str(s.get("store_id") or (key.split(":", 1)[1] if key and ":" in key else ""))
        out.append((chain, sid, s))
    return out


def clean_cell(v) -> str:
    """Keep the value verbatim, but never let a tab or newline break the row.

    Escaped rather than stripped so the file stays faithful: a value that
    really did contain a tab still shows that it did.
    """
    if v is None:
        return ""
    return str(v).replace("\t", "\\t").replace("\r", "").replace("\n", "\\n")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stores", type=Path, required=True)
    ap.add_argument("--out", type=Path, default=DATA / "locations.txt")
    ap.add_argument("--db", type=Path, default=DATA / "geocode-stages.sqlite")
    args = ap.parse_args()

    fixes = {}
    if args.db.exists():
        db = sqlite3.connect(args.db)
        for row in db.execute(
            "SELECT chain, store_id, lat, lng, method, confidence, town, matched FROM geocode"
        ):
            fixes[(row[0], row[1])] = row[2:]

    census = load_census(args.stores)
    lines = ["\t".join(COLUMNS)]
    placed = 0
    for chain, sid, s in census:
        lat, lng, method, conf, town, matched = fixes.get((chain, sid), (None,) * 6)
        if lat is not None:
            placed += 1
        lines.append("\t".join(clean_cell(c) for c in [
            chain, sid, s.get("name"),
            s.get("address"), s.get("cityCode"), s.get("zip"),
            town, lat, lng, method, conf, matched,
        ]))

    header = [
        f"# {len(census)} branches from {len(set(c for c, _, _ in census))} chains",
        f"# {placed} with a resolved coordinate, {len(census) - placed} without",
        "# RAW_* columns are verbatim from each chain's own Stores XML.",
        "# METHOD: CBS_STREET (street confirmed against the official register)",
        "#         STREET_UNVERIFIED (street not in the register, but placed in the right town)",
        "#         POI_CENTROID (matched a named mall/market inside the town)",
        "#         VILLAGE_CENTRE (kibbutz/moshav with no street address)",
        "#         TOWN_CENTRE_ONLY (town is known, exact address is not -- can be km off)",
        "#         GOOGLE_FALLBACK / NO_ADDRESS / UNRESOLVED",
        "# CONFIDENCE: 0.9 best, 0.25 means 'this is a town, not a shop'.",
        "",
    ]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(header + lines) + "\n", encoding="utf-8")
    print(f"wrote {args.out} — {len(census)} rows, {placed} resolved "
          f"({args.out.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
