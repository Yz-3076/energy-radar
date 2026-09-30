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
from datetime import datetime, timedelta, timezone
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

#: The archive publishes once a day, so refetching every three hours costs
#: several hundred megabytes a run and buys nothing.
CACHE_TTL = timedelta(hours=20)

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


def path_for(files: list[dict], kind: str, slug: str) -> str | None:
    """Look a file up by name, not by assumed folder — the dataset moves
    chains between folders and Victory currently lives under misc/."""
    want = f"{kind}_{slug}.csv"
    for f in files:
        name = f.get("name") or ""
        if name == want or name.endswith("/" + want):
            return name
    return None


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
        if address.lower() in ("", "unknown"):
            # Het Cohen publishes a town and no street at all. Falling back
            # to the town name keeps the branch alive and lands it on the
            # existing approximate-pin path, which the app already labels
            # "somewhere in this town" rather than implying a doorway.
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


def is_fresh(entry) -> bool:
    """Has this chain been pulled from the archive recently enough to skip?"""
    if not isinstance(entry, dict):
        return False
    try:
        fetched = datetime.fromisoformat(entry["fetchedAt"])
    except (KeyError, ValueError, TypeError):
        return False
    return datetime.now(timezone.utc) - fetched < CACHE_TTL
