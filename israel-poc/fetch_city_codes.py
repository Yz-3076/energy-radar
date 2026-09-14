"""Build data/city-codes.json: CBS locality code -> town name.

Chain price files identify a store's town only by a numeric CBS locality
code — no chain sampled published a name (0 of 602 branches). Without this
table addresses can only be geocoded street-only, which is the single
largest source of wrong pins: Israeli street names repeat in every city, so
Nominatim picks one and is confidently wrong.

Source: the Central Bureau of Statistics locality list published as open
data by the government at data.gov.il ("רשימת ישובים בישראל"). Run this by
hand when the list changes — new localities are rare, so the committed JSON
is the normal path and the pipeline never calls this at run time.

    python fetch_city_codes.py
"""

import json
import re
import urllib.request
from pathlib import Path

# data.gov.il CKAN resource for the CBS locality table.
RESOURCE_ID = "d4901968-dad3-4845-a9b0-a57d027f11ab"
API = "https://data.gov.il/api/3/action/datastore_search"
OUT = Path(__file__).resolve().parent.parent / "data" / "city-codes.json"

# Code 0 is the table's own "unlisted" placeholder, not a place. It has to be
# dropped rather than passed through: a store filed under 0 would otherwise be
# geocoded against a town called "not listed" and checked for distance from
# wherever that resolved, which is worse than having no town at all.
PLACEHOLDER_NAMES = {"לא רשום", "לא ידוע"}


def clean(name: str) -> str:
    """Collapse whitespace and drop the table's parenthetical qualifiers.

    Entries like "אבו ג'ווייעד )שבט(" carry a category in brackets — the
    reversed-looking parens are just RTL display of "(שבט)", "tribe". The
    qualifier is not part of the name anyone writes on a map, and leaving it
    in makes the town unresolvable.
    """
    return " ".join(re.sub(r"[()）（]\s*\S+\s*[()）（]?", " ", name).split())


def fetch() -> dict:
    records, offset = [], 0
    while True:
        url = f"{API}?resource_id={RESOURCE_ID}&limit=1000&offset={offset}"
        req = urllib.request.Request(url, headers={"User-Agent": "energy-radar-price-pipeline/1.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.load(resp)["result"]
        records += result["records"]
        offset += 1000
        if offset >= result["total"]:
            return {"records": records, "total": result["total"]}


def main() -> None:
    data = fetch()
    table = {}
    for rec in data["records"]:
        code = str(rec["סמל_ישוב"]).strip().lstrip("0") or "0"
        name = clean(str(rec["שם_ישוב"]))
        if not name or name in PLACEHOLDER_NAMES:
            continue
        table[code] = name

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(table, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
    print(f"wrote {OUT} — {len(table)} localities from {data['total']} rows")
    for code in ("3000", "4000", "5000", "7900", "1200"):
        print(f"  {code:>5} = {table.get(code, '(missing)')}")


if __name__ == "__main__":
    main()
