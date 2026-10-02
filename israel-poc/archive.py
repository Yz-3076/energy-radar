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
import sys
import urllib.parse
from pathlib import Path

# A promo file's `groups` column is one JSON blob holding every barcode the
# promotion covers, and a chain-wide deal pushes it past the 131,072-char
# default, which csv raises on rather than truncating. Mahsani Ashuk does
# exactly that. sys.maxsize overflows the C long on some builds, so this
# walks down until one is accepted.
for _limit in (sys.maxsize, 2**31 - 1, 2**27):
    try:
        csv.field_size_limit(_limit)
        break
    except OverflowError:
        continue

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
    # Delivery-only dark stores — see DELIVERY_ONLY_CHAINS in pipeline.py.
    "WOLT": "wolt",
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
#: wolt was a decision rather than a measurement: 34 branches, 30 with
#: Monster, 587 rows, and not one door you can walk through — they are
#: Wolt Market's own dark stores. They are in, carrying the delivery-only
#: flag that stops the app offering a walking time to a warehouse.

#: Bytes of archive a single run is allowed to download.
#:
#: The full set is about 3.0 GB a day — 1.2 GB of price files and 1.8 GB of
#: promo files, Super Pharm alone being 604 MB and 1287 MB of that. Pulling
#: it in one run is what took the scheduled job from 1:04 to the timeout on
#: 2026-09-30, so a run refreshes only what fits here and leaves the rest to
#: the next one. The archive republishes once a day and the schedule fires
#: eight times, so everything still lands inside a day; a chain waiting its
#: turn is served from the cache meanwhile.
#:
#: 900 MB measured at ~7 MB/s end to end, download and parse together, is
#: about two minutes — set against a run that is 65 minutes of scraping, and
#: with 7.2 GB/day of capacity against 3.0 GB of need, so a missed run does
#: not put the schedule behind.
REFRESH_BUDGET = 900_000_000

#: Columns the archive writes once per source file rather than on every row.
_MERGED_COLUMNS = ("file_name", "storeid", "chainid", "subchainid")

#: The same merging, one level deeper, in the promo files.
#:
#: A promo covering several barcodes is flattened to one row per barcode and
#: only the FIRST carries the promotion itself — measured on Victory, where
#: 60% of rows have no promotionid or description, 97% no start date and
#: 99.7% no club id. Read literally, a two-for-18 on three flavours reads as
#: one real deal and two nameless ones with no dates, which the app would
#: then show as permanent. Only `groups` is genuinely per-row.
_PROMO_MERGED_COLUMNS = _MERGED_COLUMNS + (
    "promotionid", "promotiondescription", "promotionstartdatetime",
    "promotionenddatetime", "minnoofitemoffered", "clubid",
    "additionalrestrictions", "allowmultiplediscounts", "remarks",
)

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


def _promo_items(groups_json: str):
    """The promotion's item rows out of the `groups` column.

    This column is where the archive keeps what the XML feed calls
    PromotionItem, and it is the only part of a promo row that is not a
    merged cell.

    Both levels collapse a single child to a bare object instead of a
    one-element list, which is ordinary XML-to-JSON behaviour and bit once
    already: `group` is a list whenever a promotion has more than one
    group, and assuming a dict there took the run down.
    """
    def _many(value):
        if isinstance(value, dict):
            return [value]
        return value if isinstance(value, list) else []

    try:
        parsed = json.loads(groups_json or "")
    except (json.JSONDecodeError, TypeError):
        return []
    if not isinstance(parsed, dict):
        return []
    items = []
    for group in _many(parsed.get("group")):
        container = group.get("promotionitems")
        if isinstance(container, dict):
            items += _many(container.get("promotionitem"))
    return items


def _num(value):
    """A number, or None for the archive's several ways of writing one."""
    text = str(value or "").strip().strip("'\"")
    if not text or text == "NO_BODY":
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _text(value):
    text = str(value or "").strip().strip("'\"")
    return "" if text == "NO_BODY" else text


def fetch_chain_promos(chain: str, slug: str, tmp_dir: Path, barcode_to_variant: dict,
                       shape, is_real, files=None):
    """{store_id: {variant_id: [promo, ...]}} for one chain, in exactly the
    shape promotions_gov.get_promos_for_stores returns.

    The nine archive chains had no promos at all: they cannot be scraped
    from a CI runner, which is why they are archive chains in the first
    place, and that applies to their promo files as much as their prices.
    This is the other half.

    `shape` and `is_real` are passed in rather than imported so that what
    counts as a real discount, and what a promo looks like once shaped,
    stay defined in one place — promotions_gov.
    """
    files = files if files is not None else list_files()
    path = path_for(files, "promo_full_file", slug)
    if not path:
        print(f"  {chain}: no promo file in the archive (looked for {slug})")
        return {}

    local = tmp_dir / f"archive_promo_{slug}.csv"
    local.parent.mkdir(parents=True, exist_ok=True)
    _curl(_download_url(path), local)
    if not local.exists():
        print(f"  {chain}: promo download failed")
        return {}

    out: dict[str, dict[str, list[dict]]] = {}
    rows = 0
    try:
        with io.open(local, encoding="utf-8", errors="replace", newline="") as f:
            for row in _forward_fill(csv.DictReader(f), _PROMO_MERGED_COLUMNS):
                items = _promo_items(row.get("groups"))
                matched = [
                    (i, barcode_to_variant[code])
                    for i in items
                    if (code := _text(i.get("itemcode"))) in barcode_to_variant
                ]
                if not matched or not is_real(_text(row.get("promotiondescription")), len(items)):
                    continue
                sid = _text(row.get("storeid")).lstrip("0") or "0"
                if sid == "0":
                    continue
                for item, variant_id in matched:
                    promo = shape(row, item)
                    by_variant = out.setdefault(sid, {}).setdefault(variant_id, [])
                    if promo not in by_variant:  # a promo repeats per barcode it covers
                        by_variant.append(promo)
                        rows += 1
    finally:
        local.unlink(missing_ok=True)

    print(f"  {chain}: {rows} Monster promo(s) across {len(out)} branch(es) (archive)")
    return out


def refresh_plan(cache: dict, files: list[dict], chains=None,
                 budget: int = REFRESH_BUDGET) -> dict:
    """What this run should download, as {chain: {kind: publication date}}.

    "Kind" is the price file or the promo file. They are planned together
    rather than in two passes so that one budget covers both and prices
    keep priority: a promo on a branch that has no price yet is a deal on
    a shop that is not on the map.

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
        for kind, date_key in (("price_full_file", "sourceDate"),
                               ("promo_full_file", "promoSourceDate")):
            meta = meta_for(files, kind, ARCHIVE_CHAINS[chain])
            if meta is None:
                continue  # the fetch prints the "not in the archive" line
            published = (meta.get("creationDate") or "").strip()
            entry = cache.get(chain)
            held = entry.get(date_key) if isinstance(entry, dict) else None
            if published and held == published:
                continue
            # Prices before promos, and never-fetched ahead of merely stale:
            # a chain with no price entry contributes no stores at all,
            # and a promo on a branch that is not on the map shows nobody
            # anything.
            candidates.append((
                (0 if kind == "price_full_file" else 1, held or "", chain),
                chain, kind, published, meta.get("totalBytes") or 0,
            ))
    candidates.sort()

    plan: dict[str, dict[str, str]] = {}
    spend = 0
    for _, chain, kind, published, size in candidates:
        if plan and spend + size > budget:
            continue
        plan.setdefault(chain, {})[kind] = published
        spend += size
    return plan
