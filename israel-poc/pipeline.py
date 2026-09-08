"""
The real fetch -> filter -> resolve -> geocode -> depletion pipeline.

Run standalone: `py pipeline.py`
Meant to be run on a schedule (see ../.github/workflows/fetch-prices.yml),
every few hours — matching the cadence the law itself requires chains to
publish at, so there is no benefit to polling faster.

Writes, all under ../data/:
  latest.json        — current snapshot, shaped exactly like the mobile
                        app's Store[] (src/data/stores.ts) — the file the
                        app fetches directly.
  history.ndjson      — append-only, one line per (store, variant) per run.
                        The "database": every past price/sale observation,
                        never overwritten. This is what stats and the
                        depletion algorithm are built from.
  geocode-cache.json  — address -> [lat, lng], built up once per address.
  stats.json          — small pre-aggregated summary for the GitHub Pages
                        dashboard, so that page doesn't need to parse the
                        whole (eventually large) history file client-side.

Chains covered so far: Shufersal, Rami Levy — the two the app's seed data
already leans on. Add more from docs/israel-pipeline.md's list
(VICTORY, OSHER_AD, DOR_ALON, YELLOW, ...) by extending CHAINS below; each
one Just Works through the same ScraperFactory path.
"""

import asyncio
import glob
import json
import os
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from il_supermarket_scarper.scrappers_factory import ScraperFactory
from il_supermarket_scarper.utils.file_output import DiskFileOutput

import depletion
import geocode as geo

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DUMPS_DIR = Path(__file__).resolve().parent / "dumps"

CHAINS = ["SHUFERSAL"]
# RAMI_LEVY is temporarily out: its portal host
# (url.retail.publishedprices.co.il) fails to resolve in DNS right now —
# confirmed both locally and against Google's own resolver (8.8.8.8), so
# this is that domain's own outage/misconfiguration, not a local network
# issue. Worth retrying later; add it back to this list once it resolves.

# For local smoke-testing only: PIPELINE_LIMIT=5 py pipeline.py fetches just a
# handful of branches per chain instead of the whole country. Unset (the
# default, and what CI uses) means every branch.
_LIMIT_ENV = os.environ.get("PIPELINE_LIMIT")
FILE_LIMIT = int(_LIMIT_ENV) if _LIMIT_ENV else None

VARIANTS = json.loads((Path(__file__).parent / "variants.json").read_text(encoding="utf-8"))
BARCODE_TO_VARIANT = {v["barcode"]: v["id"] for v in VARIANTS if v.get("barcode")}
KNOWN_NAME_HINT = "מונסטר"  # catches SKUs not yet in variants.json by barcode


async def fetch_files(chain_name: str, file_type: str, out_subdir: str) -> Path:
    scraper_cls = ScraperFactory.get(chain_name)
    if scraper_cls is None:
        print(f"  {chain_name}: not enabled / not found, skipping")
        return DUMPS_DIR / chain_name / out_subdir
    out_dir = DUMPS_DIR / chain_name / out_subdir
    scraper = scraper_cls(file_output=DiskFileOutput(storage_path=str(out_dir)))
    count = 0
    async for _ in scraper.scrape(limit=FILE_LIMIT, files_types=[file_type]):
        count += 1
    print(f"  {chain_name} {file_type}: {count} file(s)")
    return out_dir


def _normalize_store_id(raw: str | None) -> str | None:
    """PriceFull files zero-pad StoreID (e.g. "049"); the Stores file for the
    same chain does not (e.g. "49") — confirmed against live Shufersal data.
    Strip leading zeros on both sides so the two files' IDs actually match."""
    if not raw:
        return None
    stripped = raw.lstrip("0")
    return stripped or "0"


def parse_stores(stores_dir: Path) -> dict[str, dict]:
    """StoreID -> {name, address, zip}"""
    stores = {}
    for path in glob.glob(str(stores_dir / "*.xml")):
        try:
            root = ET.parse(path).getroot()
        except ET.ParseError:
            continue
        for store in root.iter("Store"):
            sid = _normalize_store_id(store.findtext("StoreID"))
            if not sid:
                continue
            stores[sid] = {
                "name": (store.findtext("StoreName") or "").strip(),
                "address": (store.findtext("Address") or "").strip(),
                "zip": (store.findtext("ZIPCode") or "").strip(),
            }
    return stores


def parse_monster_items(prices_dir: Path):
    """Yields {store_id, barcode, name, price, last_sale} for every Monster
    row found across every PriceFull file in `prices_dir`."""
    for path in glob.glob(str(prices_dir / "*.xml")):
        try:
            root = ET.parse(path).getroot()
        except ET.ParseError:
            continue
        store_id = _normalize_store_id(root.findtext("StoreID"))
        if not store_id:
            continue
        for item in root.iter("Item"):
            code = item.findtext("ItemCode")
            name = item.findtext("ItemName") or ""
            is_known = code in BARCODE_TO_VARIANT
            is_named_monster = KNOWN_NAME_HINT in name or "MONSTER" in name.upper()
            if not is_known and not is_named_monster:
                continue
            price_text = item.findtext("ItemPrice")
            try:
                price = float(price_text) if price_text else None
            except ValueError:
                price = None
            if price is None:
                continue
            yield {
                "store_id": store_id,
                "barcode": code,
                "name": name,
                "price": price,
                "last_sale": item.findtext("LastSaleDateTime") or None,
            }


def load_history() -> list[dict]:
    path = DATA_DIR / "history.ndjson"
    if not path.exists():
        return []
    rows = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def append_history(new_rows: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / "history.ndjson"
    with path.open("a", encoding="utf-8") as f:
        for row in new_rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


async def run() -> None:
    now = datetime.now(timezone.utc).isoformat()
    geocode_cache = geo.load_cache()
    new_observations: list[dict] = []
    stores_by_key: dict[str, dict] = {}  # f"{chain}:{store_id}" -> Store shape

    for chain in CHAINS:
        print(f"=== {chain} ===")
        stores_dir = await fetch_files(chain, "STORE_FILE", "stores")
        prices_dir = await fetch_files(chain, "PRICE_FULL_FILE", "prices")

        store_info = parse_stores(stores_dir)
        items = list(parse_monster_items(prices_dir))
        print(f"  {len(items)} Monster row(s) across {len(store_info)} branch(es)")

        for item in items:
            info = store_info.get(item["store_id"])
            if not info or not info["address"]:
                continue  # can't place a pin without an address

            variant_id = BARCODE_TO_VARIANT.get(item["barcode"])
            if not variant_id:
                continue  # a name-matched row we don't have a catalog id for yet

            coords = geo.geocode(info["address"], info["zip"], geocode_cache)
            if coords is None:
                continue  # can't place a pin without coordinates

            store_key = f"{chain}:{item['store_id']}"
            if store_key not in stores_by_key:
                stores_by_key[store_key] = {
                    "id": store_key.lower().replace(":", "-"),
                    "chain": chain.replace("_", " ").title(),
                    "name": info["name"],
                    "address": info["address"],
                    "city": "",  # chain files give a numeric city code, not a name — see geocode.py
                    "lat": coords[0],
                    "lng": coords[1],
                    "shelf": [],
                }

            stores_by_key[store_key]["shelf"].append(
                {
                    "variantId": variant_id,
                    "price": item["price"],
                    "qty": None,  # the official feed has no stock field at all
                    "seenAt": item["last_sale"] or now,
                    "source": "official_feed",
                }
            )
            new_observations.append(
                {
                    "store_id": store_key,
                    "variant_id": variant_id,
                    "price": item["price"],
                    "last_sale": item["last_sale"],
                    "fetched_at": now,
                }
            )

    geo.save_cache(geocode_cache)
    append_history(new_observations)

    # Depletion needs the FULL history including what we just appended.
    full_history = load_history()
    by_pair = defaultdict(list)
    for row in full_history:
        by_pair[(row["store_id"], row["variant_id"])].append(row)
    for rows in by_pair.values():
        rows.sort(key=lambda r: r["fetched_at"])

    stores_out = []
    for store_key, store in stores_by_key.items():
        for row in store["shelf"]:
            history_rows = by_pair.get((store_key, row["variantId"]), [])
            row["depletion"] = depletion.assess(history_rows)
        stores_out.append(store)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "latest.json").write_text(
        json.dumps(stores_out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\nWrote data/latest.json — {len(stores_out)} store(s), {len(new_observations)} observation(s) this run")

    # A small rollup for the GitHub Pages dashboard — cheap to compute here,
    # much cheaper than having the dashboard parse the whole history file.
    per_variant_counts = defaultdict(int)
    depletion_counts = defaultdict(int)
    for store in stores_out:
        for row in store["shelf"]:
            per_variant_counts[row["variantId"]] += 1
            depletion_counts[row["depletion"]] += 1
    stats = {
        "generated_at": now,
        "chains_covered": CHAINS,
        "store_count": len(stores_out),
        "total_observations": len(full_history),
        "observations_this_run": len(new_observations),
        "listings_per_variant": dict(per_variant_counts),
        "depletion_breakdown": dict(depletion_counts),
    }
    (DATA_DIR / "stats.json").write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Wrote data/stats.json")


if __name__ == "__main__":
    asyncio.run(run())
