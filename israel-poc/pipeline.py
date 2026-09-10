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
  history/YYYY-MM.ndjson — append-only, one line per (store, variant) per
                        run, sharded into one file per calendar month (see
                        _current_history_path). The "database": every past
                        price/sale observation, never overwritten, never
                        edited — this is what stats and the depletion
                        algorithm are built from. load_history() reads
                        every month's file back as one combined list, so
                        every caller sees the full history regardless of
                        how many months it now spans.
  geocode-cache.json  — address -> [lat, lng], built up once per address.
  stats.json          — small pre-aggregated summary for the GitHub Pages
                        dashboard, so that page doesn't need to parse the
                        whole (eventually large) history file client-side.
  promotions.json     — store_id -> variant_id -> current promotions,
                        parsed from the government PromoFull feeds (see
                        promotions_gov.py). Only stores actually running a
                        deal appear. Optional and additive: a missing store
                        means no deal was seen there, not that prices are
                        wrong.
  promo-cache.json    — store_id -> last parsed promo result + timestamp,
                        so a run doesn't re-download every branch's
                        multi-MB promo file (see promotions_gov.CACHE_TTL).

Chains covered: see the CHAINS list and its comments below for current
per-chain status.
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
import promotions_gov

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DUMPS_DIR = Path(__file__).resolve().parent / "dumps"

# Every chain here is confirmed to actually run without crashing the
# pipeline; whether it contributes any rows on a given run varies (see
# fetch_files' try/except above — a broken chain just logs and yields
# nothing, it never takes the run down).
#
#  SHUFERSAL           — fully working: real branches, real prices, live.
#  RAMI_LEVY           — shared host url.retail.publishedprices.co.il went
#  OSHER_AD            — fully DNS-dead for about a week (~2026-09-01 to
#  DOR_ALON            — 2026-09-08 — confirmed from multiple independent
#                        networks, so it was a real outage on their end, not
#                        ours), and came back on its own on 2026-09-08 —
#                        re-confirmed working, real files downloading again,
#                        no code change needed. Left as a reminder that this
#                        shared host is known to have multi-day rough
#                        patches; if one of these three goes quiet again,
#                        check that host before assuming our code broke.
#  YELLOW              — same host, still up, but Yellow (Paz) simply never
#                        publishes STORE_FILE at all (confirmed: 591
#                        price/promo files, 0 store files) — so it never
#                        contributes rows here since we can't geocode a
#                        branch without its address. Not a bug, just a gap
#                        in what this one chain publishes.
#  VICTORY_NEW_SOURCE  — publishes fine, but only to some networks. From a
#                        home connection in Israel on 2026-09-10 this
#                        returned 70 branches, 70 price files and 836
#                        Monster rows; the CI run 10 minutes later got a
#                        connect timeout on every single call to
#                        laibcatalog.co.il (30s, no response at all). A
#                        connect-level timeout rather than a refusal or a
#                        403 is what an IP-level firewall drop looks like,
#                        so the working theory is that they block cloud or
#                        non-Israeli addresses. This is NOT the same as the
#                        earlier "their API returns an empty list" note,
#                        which described a real outage on their side and is
#                        no longer what's happening.
#                        Consequence: no Victory branch can appear in data
#                        produced by GitHub Actions, however healthy their
#                        feed is. Getting them in needs the scrape to run
#                        from a network they answer — see docs/staying-current.md.
CHAINS = ["SHUFERSAL", "VICTORY_NEW_SOURCE", "RAMI_LEVY", "YELLOW", "OSHER_AD", "DOR_ALON"]

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
    try:
        async for _ in scraper.scrape(limit=FILE_LIMIT, files_types=[file_type]):
            count += 1
    except Exception as e:  # noqa: BLE001 — one flaky chain must never take the whole run down
        print(f"  {chain_name} {file_type}: FAILED ({type(e).__name__}: {e})")
        return out_dir
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


HISTORY_DIR = DATA_DIR / "history"


def _current_history_path() -> Path:
    """One file per calendar month (UTC) — data/history/2026-09.ndjson,
    data/history/2026-10.ndjson, and so on. A single ever-growing file would
    hit GitHub's 100MB-per-file push limit after roughly a month at this
    project's real observed volume (~2,700 observations / 3-hour run
    nationwide, confirmed 2026-09-08); sharding by month means no file ever
    grows past about a month's worth, forever, with zero manual upkeep."""
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    return HISTORY_DIR / f"{month}.ndjson"


def load_history() -> list[dict]:
    """Every observation ever recorded, across every monthly file — this is
    the FULL accumulated history, not just the current month. Depletion
    classification and any future stats/analysis work should always read
    through this function rather than one file directly, so rotation stays
    invisible to every caller."""
    rows = []
    if not HISTORY_DIR.exists():
        return rows
    for path in sorted(HISTORY_DIR.glob("*.ndjson")):
        with path.open(encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    rows.append(json.loads(line))
    return rows


def append_history(new_rows: list[dict]) -> None:
    """Appends only to the CURRENT month's file — never touches older
    months, so a file that already exists on disk/in the repo never grows
    again once its month has passed."""
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    with _current_history_path().open("a", encoding="utf-8") as f:
        for row in new_rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    write_history_index()


def write_history_index() -> None:
    """data/history/index.json — the sorted list of monthly filenames that
    actually exist. A browser fetching raw.githubusercontent.com has no way
    to list a directory, so anything client-side that wants the FULL
    history (a stats/analysis website, say) reads this manifest first, then
    fetches each file it names. Rewritten every run; trivially cheap."""
    months = sorted(p.name for p in HISTORY_DIR.glob("*.ndjson"))
    (HISTORY_DIR / "index.json").write_text(
        json.dumps(months, indent=2), encoding="utf-8"
    )


async def run() -> None:
    now = datetime.now(timezone.utc).isoformat()
    geocode_cache = geo.load_cache()
    promo_cache = promotions_gov.load_cache()
    new_observations: list[dict] = []
    stores_by_key: dict[str, dict] = {}  # f"{chain}:{store_id}" -> Store shape
    promo_stores: list[tuple[str, str]] = []  # (chain, store_id) — see promotions_gov.py

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
                # First time we're keeping this store this run, so this is
                # the natural place to note that it needs promos — but only
                # note it. Fetching inline here made the run serial, one
                # multi-MB file at a time, which is what pushed nationwide
                # runs past 40 minutes; they're fetched concurrently in one
                # batch once every chain has been walked instead.
                promo_stores.append((chain, item["store_id"]))

            new_row = {
                "variantId": variant_id,
                "price": item["price"],
                "qty": None,  # the official feed has no stock field at all
                "seenAt": item["last_sale"] or now,
                "source": "official_feed",
            }
            shelf = stores_by_key[store_key]["shelf"]
            # Some chains' own price feeds list the same barcode twice for
            # one store (confirmed 2026-09-10 on a handful of Rami Levy
            # branches — byte-identical duplicate rows, upstream feed
            # noise, not our scrape). Without this guard the duplicate
            # variant_id survives into latest.json and React sees two
            # list items with the same key on the store screen. Keep
            # whichever row was seen most recently rather than assuming
            # first-wins, in case a real same-run price update is what's
            # actually happening.
            existing = next((r for r in shelf if r["variantId"] == variant_id), None)
            if existing is None:
                shelf.append(new_row)
            elif new_row["seenAt"] > existing["seenAt"]:
                shelf.remove(existing)
                shelf.append(new_row)
            new_observations.append(
                {
                    "store_id": store_key,
                    "variant_id": variant_id,
                    "price": item["price"],
                    "last_sale": item["last_sale"],
                    "fetched_at": now,
                }
            )

    gov_promo_maps = await promotions_gov.get_promos_for_stores(
        promo_stores, BARCODE_TO_VARIANT, promo_cache
    )

    geo.save_cache(geocode_cache)
    promotions_gov.save_cache(promo_cache)
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

    # Bonus, non-authoritative layer on top of the prices above, written as
    # store_id -> variant_id -> [promo]. Only stores that actually run a
    # deal appear, so a missing store means "no deal seen at that branch",
    # never proof there isn't one.
    #
    # promotions.py's third-party API is deliberately not merged in here:
    # its schema attributes a promo to a barcode nationwide, with no store
    # behind it, so folding it in would put back exactly the false
    # store-level deals this shape exists to prevent. It stays available
    # for a flavour-level view if their auth is ever fixed (it currently
    # hangs on any request — see that module's docstring).
    promo_by_store = gov_promo_maps
    (DATA_DIR / "promotions.json").write_text(
        json.dumps(promo_by_store, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    distinct = {p["description"] for byv in promo_by_store.values() for ps in byv.values() for p in ps}
    print(
        f"Wrote data/promotions.json — {len(promo_by_store)} store(s) "
        f"running {len(distinct)} distinct deal(s)"
    )

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
