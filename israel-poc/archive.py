"""Prices for chains the scheduled scrape cannot get for itself.

Four chains we already scrape answer a home connection in Israel and not
GitHub's runners — Super Pharm, Victory, Netiv Hased and Hazi Hinam sit 15
to 17 days stale for exactly that reason. Four more publish usable files we
never scrape at all. The OpenIsraeliSupermarkets project scrapes every chain
from its own machine in Israel and publishes the raw files daily, so reading
their output covers both cases without a second machine of our own.

  https://www.kaggle.com/datasets/erlichsefi/israeli-supermarkets-2024

LICENCE, and why this module is built to be easy to switch off: the dataset
is CC BY-NC-SA — attribution, share-alike, and NON-COMMERCIAL. That is fine
while the site carries no ads and credits the source, and it stops being
fine the day it does. ARCHIVE_CHAINS is the whole switch: take a chain out
and the pipeline scrapes it directly again, which is what the self-hosted
workflow exists for. Nothing else in the pipeline knows this module is here.

THE TRAP, if you ever touch the parsing: these CSVs fill the file-level
columns — storeid, file_name — only on the FIRST row of each source XML and
leave them blank on every row after, like merged spreadsheet cells. 246 of
Yellow's 400,000 rows carry a store id. Read literally, every price lands on
a blank store, and a chain with 234 branches stocking Monster reads as one.
It fails silently and the numbers look plausible, so _forward_fill is not
optional.
"""

import csv
import io
import json
import subprocess
import urllib.parse
from pathlib import Path

DATASET = "erlichsefi/israeli-supermarkets-2024"
_API = "https://www.kaggle.com/api/v1/datasets"

#: Chains sourced from the archive instead of scraped directly. Removing one
#: hands it straight back to the normal scrape — see the licence note above.
ARCHIVE_CHAINS = {
    # Reachable only from an Israeli connection; 15-17 days stale without this.
    "SUPER_PHARM": "super_pharm",
    "VICTORY_NEW_SOURCE": "victory_new_source",
    "NETIV_HASED": "netiv_hased",
    "HAZI_HINAM": "hazi_hinam",
    # Publish usable files but were never in our chain list. Measured
    # 2026-09-30: Monster in 70/71, 26/34, 24/24 and 5/5 branches.
    "MAHSANI_ASHUK_NEW_SOURCE": "mahsani_ashuk_new_source",
    "ZOL_VEBEGADOL": "zol_vebegadol",
    "CITY_MARKET_KIRYATGAT": "city_market_kiryatgat",
    "HET_COHEN_NEW_SOURCE": "het_cohen_new_source",
}

#: The archive carries 31 chains with both a store file and a price file.
#: Of the ones above neither we scrape nor source, every one was read in
#: full on 2026-10-01 — the whole price file, not the 40-file sample that
#: previously cleared SHUK_AHIR and POLIZER by mistake:
#:
#:   wolt                  34 branches, 30 with Monster, 587 rows
#:   city_market_shops     72 branches,  0 placeable    , 997 rows
#:   good_pharm            82 branches,  1 with Monster,   1 row
#:   shefa_barcart_ashem   22 branches,  0 with Monster,   0 rows
#:   meshmat_yosef_2        4 branches,  0 with Monster,   0 rows
#:
#: So three of them are settled: they do not sell it, and re-measuring
#: costs 78 MB to learn that again.
#:
#: city_market_shops is the frustrating one. It has the Monster rows and
#: it has the store file our own scrape could never find, and the store
#: file gives "unknown" for the address and the town of all 72 branches.
#: There is nowhere to put the pins.
#:
#: wolt is a decision rather than a measurement, which is why it is not
#: in the table above. Those 30 branches are Wolt Market's own dark
#: stores: real addresses, real stock, and no door you can walk through.
#: Adding them to a map that answers "where can I buy this near me" and
#: shows a walking time needs them labelled as delivery-only first, the
#: way forecourts are labelled approximate.

#: Bytes of archive a single run is allowed to download.
#:
#: The whole set is 1.08 GB and Super Pharm alone is 604 MB of it. Pulling
#: all eight chains in one run is what took the scheduled job from 1:04 to
#: the 120-minute timeout on 2026-09-30 — the download is most of a run's
#: wall clock, and on the old code every run paid it again for files that
#: had not changed. So a run now refreshes only what fits in this budget
#: and leaves the rest to the next one. The schedule fires eight times a
#: day and the archive republishes once, so every chain still lands inside
#: a day; a chain waiting its turn is served from the cache meanwhile, and
#: the very first run after this lands is the only one that has nothing to
#: serve. 400 MB is chosen so Super Pharm gets a run to itself and the
#: other seven fit in two.
REFRESH_BUDGET = 400_000_000

#: Columns the archive writes once per source file rather than on every row.
_MERGED_COLUMNS = ("file_name", "storeid", "chainid", "subchainid")

_TIMEOUT_S = 900


def _curl(url: str, out: Path | None = None) -> str:
    cmd = ["curl", "-sL", "-m", str(_TIMEOUT_S), url]
    if out is not None:
        subprocess.run(cmd + ["-o", str(out)], check=False)
        return ""
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8").stdout


def list_files() -> list[dict]:
    """Every file in the dataset.

    Unauthenticated access works for a public dataset — confirmed against
    the real endpoint. KAGGLE_API_TOKEN only becomes necessary if Kaggle
    starts rate-limiting anonymous downloads.
    """
    files: list[dict] = []
    token = None
    for _ in range(20):
        url = f"{_API}/list/{DATASET}?pageSize=200"
        if token:
            url += "&pageToken=" + urllib.parse.quote(token, safe="")
        try:
            page = json.loads(_curl(url))
        except json.JSONDecodeError:
            break
        files += page.get("datasetFiles", [])
        token = page.get("nextPageToken")
        if not token:
            break
    return files


def meta_for(files: list[dict], kind: str, slug: str) -> dict | None:
    """Look a file up by name, not by assumed folder — the dataset moves
    chains between folders and Victory currently lives under misc/."""
    want = f"{kind}_{slug}.csv"
    for f in files:
        name = f.get("name") or ""
        if name == want or name.endswith("/" + want):
            return f
    return None


def path_for(files: list[dict], kind: str, slug: str) -> str | None:
    meta = meta_for(files, kind, slug)
    return (meta.get("name") or None) if meta else None


def _forward_fill(reader, columns=_MERGED_COLUMNS):
    """Yield rows with the once-per-file columns carried down. See THE TRAP."""
    last = {c: "" for c in columns}
    for row in reader:
        for c in columns:
            value = (row.get(c) or "").strip()
            if value:
                last[c] = value
        row.update(last)
        yield row


def _download_url(path: str) -> str:
    return f"{_API}/download/{DATASET}?fileName=" + urllib.parse.quote(path, safe="")


def fetch_chain(chain: str, slug: str, tmp_dir: Path, is_monster, files=None):
    """(store_info, items) for one chain, shaped exactly as the pipeline's own
    parse_stores and parse_monster_items return them, so nothing downstream
    can tell where a chain's data came from.

    `is_monster(barcode, name) -> bool` is passed in rather than imported, to
    keep the one definition of what counts as Monster in pipeline.py.
    """
    files = files if files is not None else list_files()
    stores_path = path_for(files, "store_file", slug)
    prices_path = path_for(files, "price_full_file", slug)
    if not stores_path or not prices_path:
        print(f"  {chain}: not in the archive (looked for {slug})")
        return None

    store_info: dict[str, dict] = {}
    for row in csv.DictReader(io.StringIO(_curl(_download_url(stores_path)))):
        sid = (row.get("storeid") or "").strip().lstrip("0") or "0"
        address = (row.get("address") or "").strip()
        city = (row.get("city") or "").strip()
        if city.lower() == "unknown":
            city = ""
        if address.lower() in ("", "unknown"):
            # Het Cohen publishes a town and no street at all. Falling back
            # to the town name keeps the branch alive and lands it on the
            # existing approximate-pin path, which the app already labels
            # "somewhere in this town" rather than implying a doorway.
            #
            # Blanking an "unknown" city first is what stops that fallback
            # turning into a store whose address is the literal string
            # "unknown" — City Market Shops files exactly that, for all 72
            # of its branches, and one of them was getting through.
            address = city
        if not sid or not address:
            continue
        store_info[sid] = {
            "name": (row.get("storename") or "").strip(),
            "address": address,
            "zip": (row.get("zipcode") or "").strip(),
            # The archive gives the town as a NAME. The pipeline wants a CBS
            # code, so it is resolved by the caller, which owns that table.
            "cityCode": "",
            "cityName": city,
        }

    local = tmp_dir / f"archive_{slug}.csv"
    local.parent.mkdir(parents=True, exist_ok=True)
    _curl(_download_url(prices_path), local)
    if not local.exists():
        print(f"  {chain}: price download failed")
        return None

    items = []
    try:
        with io.open(local, encoding="utf-8", errors="replace", newline="") as f:
            for row in _forward_fill(csv.DictReader(f)):
                sid = (row.get("storeid") or "").strip().lstrip("0") or "0"
                code = (row.get("itemcode") or "").strip().lstrip(".'\"")
                name = (row.get("itemname") or "").strip()
                if sid == "0" or not is_monster(code, name):
                    continue
                try:
                    price = float(row.get("itemprice") or "")
                except ValueError:
                    continue
                items.append({
                    "store_id": sid,
                    "barcode": code,
                    "name": name,
                    "price": price,
                    "last_sale": (row.get("lastsaledatetime") or "").strip() or None,
                })
    finally:
        local.unlink(missing_ok=True)

    print(f"  {chain}: {len(items)} Monster row(s) across {len(store_info)} branch(es) (archive)")
    return store_info, items


def refresh_plan(cache: dict, files: list[dict], chains=None,
                 budget: int = REFRESH_BUDGET) -> dict:
    """{chain: publication date} for the chains this run should download.

    Two gates, in order.

    Has it changed? Each cache entry records the `creationDate` Kaggle
    reports for the price file it was built from, so an unchanged date is
    an unchanged file and there is nothing to fetch. This replaced a
    20-hour timer, which could only ever guess: it re-downloaded 1.08 GB
    to find yesterday's bytes whenever the timer expired before the
    archive republished, and served a stale chain whenever it did not.

    `chains` restricts the plan to the run's own chain list, so a
    PIPELINE_CHAINS-limited run does not spend its budget downloading
    chains it is not going to look at.

    Does it fit? Whatever is left competes for REFRESH_BUDGET, oldest
    first, so a run spreads its cost instead of paying for all eight. One
    chain is always taken even if it alone blows the budget — otherwise
    Super Pharm, at 604 MB, would never be refreshed at all. That cannot
    starve the small chains either: a chain skipped for size stays a
    candidate, and once the ones that do fit are current they drop out of
    the running and it is the only thing left to take.
    """
    wanted = ARCHIVE_CHAINS if chains is None else [c for c in chains if c in ARCHIVE_CHAINS]
    candidates = []
    for chain in wanted:
        meta = meta_for(files, "price_full_file", ARCHIVE_CHAINS[chain])
        if meta is None:
            continue  # fetch_chain prints the "not in the archive" line
        published = (meta.get("creationDate") or "").strip()
        entry = cache.get(chain)
        held = entry.get("sourceDate") if isinstance(entry, dict) else None
        if published and held == published:
            continue
        # Never fetched sorts ahead of merely stale: a chain with no cache
        # entry contributes no stores at all until its first download.
        candidates.append(((held or "", chain), chain, published, meta.get("totalBytes") or 0))
    candidates.sort()

    plan: dict[str, str] = {}
    spend = 0
    for _, chain, published, size in candidates:
        if plan and spend + size > budget:
            continue
        plan[chain] = published
        spend += size
    return plan
