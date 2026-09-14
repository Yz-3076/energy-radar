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
import shutil
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
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
#
# The 15 below were added 2026-09-14 after probing all 41 chains the
# scraper library supports (israel-poc/chain_probe.py). Each one was
# confirmed to publish a store file (without it a branch can't be
# geocoded, so it can never reach the map) AND to carry Monster rows in a
# sampled price file. The ones left out fail for concrete reasons rather
# than being untried: 8 raise on construction (MEGA, COFIX, QUIK, VICTORY
# — the old source, superseded by VICTORY_NEW_SOURCE — HET_COHEN,
# MAHSANI_ASHUK, CITY_MARKET_GIVATAYIM, CITY_MARKET_KIRYATONO), 6 publish
# no store file at all, and 6 publish one but stock no Monster.
#
# WOLT is deliberately excluded despite being usable: its locations are
# delivery fulfilment sites, not shops you can walk into, and this app's
# entire promise is walking distance.
#
# What actually happened on the first full run (2026-09-13, 49min, 334 ->
# 461 stores). The three largest additions contributed nothing, for three
# different reasons, none of them a bug here — worth writing down so the
# next person doesn't re-diagnose them:
#
#   SUPER_PHARM (307 branches) — intermittent. Returned 307 branches to a
#     probe, then 0 files an hour later both in CI *and* from a home
#     connection in Israel. Their publishing is simply unreliable; left in
#     because it costs ~30s a run and contributes whenever it works.
#   NETIV_HASED (91), HAZI_HINAM (13) — 0 files in CI, but 91 and 13
#     branches from a home connection in Israel, minutes apart. Same shape
#     as VICTORY_NEW_SOURCE: reachable from Israel, not from GitHub's
#     runners. Nothing to fix from here.
#   YAYNO_BITAN_AND_CARREFOUR (147) — fetches fine, and its price files do
#     contain Monster, but only 2 of 147 branches' price files come back
#     per run and neither resolved to a store. Worth a look if their
#     coverage matters; not obviously broken, just thin.
#
# That first probe sampled 3 files per chain, which was too few and cleared
# two usable chains by mistake. Re-probed at 30-40 files on 2026-09-14:
#   SHUK_AHIR  — 26 branches, 177 Monster rows (0 at 3 files). Added.
#   POLIZER    — 8 branches, 13 Monster rows; its store file did not even
#                appear until ~30 files in. Added.
# Re-probing also confirmed the rest of the exclusions are real at depth:
# GOOD_PHARM (82 branches), SHEFA_BARCART_ASHEM, MESHMAT_YOSEF_1/2,
# ZOL_VEBEGADOL, HET_COHEN_NEW_SOURCE, MAHSANI_ASHUK_NEW_SOURCE and
# CITY_MARKET_KIRYATGAT all carry zero Monster at 40 files.
#
# CITY_MARKET_SHOPS is the one genuinely painful exclusion: 112 Monster
# rows, and no store file at any depth. Same shape as YELLOW — real prices
# with no address to put them at, and nothing this end can do about it.
# The 8 "failing" chains are not broken either: ScraperFactory raises
# "class_names X not found" for MEGA, COFIX, QUIK, VICTORY, HET_COHEN,
# MAHSANI_ASHUK and both CITY_MARKET variants because they are retired
# enum entries with no implementation behind them, several already
# superseded by the _NEW_SOURCE versions in use above.
_CHAINS_ENV = os.environ.get("PIPELINE_CHAINS", "").strip()
_WANTED = {c.strip().upper() for c in _CHAINS_ENV.split(",") if c.strip()}

CHAINS = [
    # original six
    "SHUFERSAL", "VICTORY_NEW_SOURCE", "RAMI_LEVY", "YELLOW", "OSHER_AD", "DOR_ALON",
    # added after the 2026-09-14 probe
    "SUPER_PHARM", "YAYNO_BITAN_AND_CARREFOUR", "NETIV_HASED", "SUPER_SAPIR",
    "TIV_TAAM", "YOHANANOF", "FRESH_MARKET_AND_SUPER_DOSH", "MAAYAN_2000",
    "KING_STORE", "KESHET", "SUPER_YUDA", "BAREKET", "HAZI_HINAM",
    "SALACH_DABACH", "STOP_MARKET",
    # Found on a re-probe (see below) — the first pass sampled too few files
    # and wrongly cleared both.
    "SHUK_AHIR", "POLIZER",
]

# PIPELINE_CHAINS=SUPER_PHARM,NETIV_HASED runs only those chains and leaves
# every other chain "silent", so carry_forward() keeps the existing stores
# for the rest rather than wiping them. That is what lets a scrape from an
# Israeli connection top up the three chains that refuse cloud IPs without
# clobbering the twenty the scheduled cloud run owns.
#
# Unset (the default, and what the cloud run uses) means every chain. The
# guard matters: an empty PIPELINE_CHAINS must mean "all", never "none" —
# filtering on an empty set silently emptied CHAINS and the run scraped
# nothing at all.
_ALL_CHAINS = list(CHAINS)  # before any filtering, for carry_forward
if _WANTED:
    _missing = _WANTED - set(CHAINS)
    if _missing:
        raise SystemExit(f"PIPELINE_CHAINS names unknown chain(s): {sorted(_missing)}")
    CHAINS = [c for c in CHAINS if c in _WANTED]

# For local smoke-testing only: PIPELINE_LIMIT=5 py pipeline.py fetches just a
# handful of branches per chain instead of the whole country. Unset (the
# default, and what CI uses) means every branch.
_LIMIT_ENV = os.environ.get("PIPELINE_LIMIT")
FILE_LIMIT = int(_LIMIT_ENV) if _LIMIT_ENV else None


VARIANTS = json.loads((Path(__file__).parent / "variants.json").read_text(encoding="utf-8"))
BARCODE_TO_VARIANT = {v["barcode"]: v["id"] for v in VARIANTS if v.get("barcode")}
KNOWN_NAME_HINT = "מונסטר"  # catches SKUs not yet in variants.json by barcode

# Words that contain the hint as a substring but are a different product.
# "מונסטרל" is the Monastrell wine grape, and "יין אל גרינגו - מונסטרל" was
# being picked up as an energy drink; it only stayed out of the data because
# its barcode happens not to be mapped, which is luck rather than a filter.
NAME_HINT_EXCLUDES = ("מונסטרל", "monastrell")


def _discard_dumps(chain_name: str) -> None:
    """Delete a chain's downloaded XML once it has been parsed.

    Keeps the working set to whichever chain is in flight instead of a
    whole run's worth. Best-effort on purpose: a file still held open by
    the scraper, or a permissions hiccup, must not take down a scrape that
    has already got what it needed.
    """
    target = DUMPS_DIR / chain_name
    if not target.exists():
        return
    freed = sum(f.stat().st_size for f in target.rglob("*") if f.is_file())
    shutil.rmtree(target, ignore_errors=True)
    if freed > 50_000_000:  # only worth a line when it is actually large
        print(f"  freed {freed / 1e6:.0f} MB of {chain_name} downloads")


async def _scrape(scraper, file_type: str, when_date=None) -> int:
    count = 0
    async for _ in scraper.scrape(limit=FILE_LIMIT, files_types=[file_type], when_date=when_date):
        count += 1
    return count


async def fetch_files(chain_name: str, file_type: str, out_subdir: str) -> Path:
    scraper_cls = ScraperFactory.get(chain_name)
    if scraper_cls is None:
        print(f"  {chain_name}: not enabled / not found, skipping")
        return DUMPS_DIR / chain_name / out_subdir
    out_dir = DUMPS_DIR / chain_name / out_subdir

    # Start each chain from an empty directory.
    #
    # Nothing ever deleted these and they are not small: 21.7 GB across
    # 4,508 files by 2026-09-14, with King Store alone at 4.5 GB. On
    # GitHub's runners that is invisible because every run gets a fresh VM,
    # but this also runs on a real machine (see the self-hosted workflow for
    # the chains that refuse cloud IPs), where it would grow until the disk
    # filled.
    #
    # It also fixes a quieter bug. parse_monster_items() reads the whole
    # directory, so a chain whose fetch failed would still contribute
    # yesterday's files and present them as today's prices. Clearing first
    # means a failed fetch yields nothing, which carry_forward() handles
    # honestly instead.
    if out_dir.exists():
        shutil.rmtree(out_dir, ignore_errors=True)

    scraper = scraper_cls(file_output=DiskFileOutput(storage_path=str(out_dir)))

    # Ask for each store's LATEST file, not every file the chain still hosts.
    #
    # Measured on the 98-minute run of 2026-09-14: King Store published 43
    # distinct file dates going back to 29 July and we downloaded all 2,086
    # of them — for 29 branches — every single run. Super Sapir and Maayan
    # 2000 were the same shape. Those three chains alone were ~34 of the 98
    # minutes, spent re-downloading prices from weeks ago that the pipeline
    # parses and discards, since only the current price matters.
    #
    # It must be a datetime.datetime. The library's own error text says
    # "datetime or 'latest'", but the string is not handled anywhere —
    # apply_limit does `isinstance(when_date, datetime.datetime)` and raises
    # on everything else, so both a date object and the literal "latest"
    # blow up. The filter itself is a substring match on "-YYYYMMDD" in the
    # file name (see Engine.get_by_date), so the time of day is irrelevant.
    #
    # The fallback is what makes this safe. Several chains publish around
    # 05:00, and a run at 03:00 would legitimately find nothing dated today;
    # without the retry, a timing quirk would look like an outage and the
    # chain would silently drop out of the map for that run.
    try:
        count = await _scrape(scraper, file_type, when_date=datetime.now(timezone.utc))
        if count == 0:
            count = await _scrape(scraper, file_type)
            if count:
                print(f"  {chain_name} {file_type}: nothing published today; fell back to all dates")
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
                # A numeric municipality code, not a name. Useless for
                # geocoding directly, but it groups branches by town, which
                # is what validates a city guessed from a store name.
                "cityCode": (store.findtext("City") or "").strip(),
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
            lowered = name.lower()
            is_named_monster = (
                (KNOWN_NAME_HINT in name or "MONSTER" in name.upper())
                and not any(x in lowered for x in NAME_HINT_EXCLUDES)
            )
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


def verify_pins(stores_by_key: dict[str, dict], store_city_code: dict[str, str]) -> None:
    """Label every store with its real town, and drop pins that aren't in it.

    Two gaps this closes that the check inside geocode() cannot. That check
    only runs when an address is looked up, so a pin cached by an earlier
    run — including every pin cached before the check existed — is never
    re-examined; and a cached pin is exactly where a bad coordinate hides,
    because it is stored permanently and never questioned again. Running
    over the finished set catches both.

    It also fills in `city`, which was empty on all 461 stores: chain price
    files carry a numeric CBS code and no name, so until the code table
    existed there was no town name to put there and the app had none to show.

    Modifies stores_by_key in place.
    """
    print("\n=== verifying pins ===")
    dropped, labelled, unknown = 0, 0, 0
    for key in list(stores_by_key):
        store = stores_by_key[key]
        town = geo.city_name(store_city_code.get(key, ""))
        if not town:
            unknown += 1
            continue
        centre = geo.town_coord(town)
        if centre is None:
            unknown += 1
            continue
        km = geo._haversine_km(tuple(centre), (store["lat"], store["lng"]))
        if km > geo.TOWN_MAX_KM:
            dropped += 1
            print(f"  dropped {store['chain']} {store['name']!r} ({store['address']!r}): "
                  f"{km:.0f}km from {town}")
            del stores_by_key[key]
            continue
        store["city"] = town
        labelled += 1
    print(f"  {labelled} store(s) labelled with a town, {dropped} misplaced pin(s) dropped, "
          f"{unknown} unverifiable (no usable city code)")


def carry_forward_promos(fresh: dict, stores_by_key: dict[str, dict]) -> dict:
    """Keep promos for stores this run did not look at.

    promotions.json is rewritten whole every run, the same as latest.json,
    and nothing protected it. A SHUFERSAL-only run therefore replaced all
    190 stores' deals with Shufersal's — which are none — and the empty
    file was pushed before anyone noticed. carry_forward() had covered
    exactly this for latest.json and stopped one file short.

    A store the run DID fetch is authoritative: if its promo is gone today,
    the deal ended and must disappear. Only stores absent from this run's
    output are carried, which is the same "could not look" versus "looked
    and it is gone" distinction carry_forward() draws.
    """
    path = DATA_DIR / "promotions.json"
    if not path.exists():
        return fresh
    try:
        previous = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:  # noqa: BLE001
        print(f"  promo carry-forward skipped: {e}")
        return fresh

    looked_at = {s["id"] for s in stores_by_key.values()}
    carried = {k: v for k, v in previous.items() if k not in looked_at and k not in fresh}
    if carried:
        print(f"  carried promos for {len(carried)} store(s) this run did not fetch")
    return {**carried, **fresh}


def carry_forward(stores_out: list[dict], silent_chains: set[str]) -> list[dict]:
    """Keep the previous run's stores for chains that returned nothing today.

    Several chains answer a home connection in Israel and not GitHub's
    runners — Super Pharm (307 branches), Netiv Hased (91) and Victory (70)
    were all confirmed reachable from a home connection on 2026-09-14 and
    all returned zero files in CI the same day. Without this, a scrape run
    from Israel would add them and the very next scheduled CI run would
    silently delete them again, because latest.json is rebuilt from scratch
    every time and a chain that fetched nothing contributes nothing.

    Only chains that fetched NOTHING AT ALL are carried. A chain that came
    back with real files is authoritative for its own branches, so a branch
    it no longer lists has genuinely stopped stocking Monster and must
    disappear. This is the difference between "we could not look" and "we
    looked and it is gone", and only the first is worth preserving.

    Prices on a carried store are as old as the run that fetched them. The
    app already dates every shelf row from `seenAt` and fades stale ones, so
    a carried store reads as old rather than as current.
    """
    if not silent_chains:
        return []
    path = DATA_DIR / "latest.json"
    if not path.exists():
        return []
    try:
        previous = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:  # noqa: BLE001
        print(f"  carry-forward skipped: could not read previous latest.json ({e})")
        return []

    have = {s["id"] for s in stores_out}
    carried = [
        s for s in previous
        if s.get("chain", "").upper().replace(" ", "_") in silent_chains and s["id"] not in have
    ]
    if carried:
        by_chain = Counter(s["chain"] for s in carried)
        print(f"  carried {len(carried)} store(s) from chain(s) that returned nothing "
              f"this run: {dict(by_chain)}")
    return carried


async def run() -> None:
    now = datetime.now(timezone.utc).isoformat()
    geocode_cache = geo.load_cache()
    promo_cache = promotions_gov.load_cache()
    new_observations: list[dict] = []
    stores_by_key: dict[str, dict] = {}  # f"{chain}:{store_id}" -> Store shape
    promo_stores: list[tuple[str, str]] = []  # (chain, store_id) — see promotions_gov.py
    store_city_code: dict[str, str] = {}  # store_key -> CBS code, for verify_pins
    # Chains this run will not contribute to. Seeded with the ones
    # PIPELINE_CHAINS excluded, because those are never attempted and so
    # never reach the "returned nothing" branch below — carry_forward would
    # find nothing to carry and latest.json would shrink to just the chains
    # that ran. Confirmed: a SHUFERSAL-only run wrote 220 stores over 1,019.
    silent_chains: set[str] = set(_ALL_CHAINS) - set(CHAINS)

    for chain in CHAINS:
        print(f"=== {chain} ===")
        stores_dir = await fetch_files(chain, "STORE_FILE", "stores")
        prices_dir = await fetch_files(chain, "PRICE_FULL_FILE", "prices")

        store_info = parse_stores(stores_dir)
        items = list(parse_monster_items(prices_dir))
        if not store_info and not items:
            # Nothing at all came back — could not look, as opposed to
            # looked and found none. carry_forward() treats the two
            # differently.
            silent_chains.add(chain)
        print(f"  {len(items)} Monster row(s) across {len(store_info)} branch(es)")

        # Both dicts are fully in memory now, so the XML has no further use.
        # Deleting it here rather than at the start of the next run is the
        # difference between a peak of one chain's files and a whole run's:
        # the old behaviour left every chain's download sitting on disk
        # until that same chain was fetched again, which is how 22.7 GB
        # accumulated. This matters because the scrape now also runs on a
        # real machine (see fetch-blocked-chains.yml), not only on a
        # throwaway cloud VM.
        _discard_dumps(chain)

        for item in items:
            info = store_info.get(item["store_id"])
            if not info or not info["address"]:
                continue  # can't place a pin without an address

            variant_id = BARCODE_TO_VARIANT.get(item["barcode"])
            if not variant_id:
                continue  # a name-matched row we don't have a catalog id for yet

            coords = geo.geocode(
                info["address"],
                info["zip"],
                geocode_cache,
                store_name=info.get("name", ""),
                city_code=info.get("cityCode", ""),
            )
            if coords is None:
                continue  # can't place a pin without coordinates

            store_key = f"{chain}:{item['store_id']}"
            if store_key not in stores_by_key:
                stores_by_key[store_key] = {
                    "id": store_key.lower().replace(":", "-"),
                    "chain": chain.replace("_", " ").title(),
                    "name": info["name"],
                    "address": info["address"],
                    # Chain files carry a numeric CBS code, not a name;
                    # verify_pins fills this in from the code table.
                    "city": "",
                    "lat": coords[0],
                    "lng": coords[1],
                    # True when the pin is the village's centre rather than
                    # the store's own address — see geocode.is_approximate.
                    # Worth shipping so the app can say "somewhere in this
                    # kibbutz" instead of implying a precise location.
                    "approximate": geo.is_approximate(
                        info["address"], info.get("cityCode", "")
                    ),
                    "shelf": [],
                }
                store_city_code[store_key] = info.get("cityCode", "")
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

    verify_pins(stores_by_key, store_city_code)

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

    stores_out += carry_forward(stores_out, silent_chains)

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
    promo_by_store = carry_forward_promos(gov_promo_maps, stores_by_key)
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
    prices_by_chain: dict[str, list[float]] = defaultdict(list)
    prices_by_variant: dict[str, list[float]] = defaultdict(list)
    stores_per_chain = defaultdict(int)
    cheapest_now = None
    for store in stores_out:
        stores_per_chain[store["chain"]] += 1
        for row in store["shelf"]:
            per_variant_counts[row["variantId"]] += 1
            depletion_counts[row["depletion"]] += 1
            prices_by_chain[store["chain"]].append(row["price"])
            prices_by_variant[row["variantId"]].append(row["price"])
            if cheapest_now is None or row["price"] < cheapest_now["price"]:
                cheapest_now = {
                    "price": row["price"],
                    "variantId": row["variantId"],
                    "storeId": store["id"],
                    "storeName": store["name"],
                    "chain": store["chain"],
                }

    def _spread(values: list[float]) -> dict:
        """min / median / max / n for a price list. Median rather than mean:
        one mispriced outlier in a published file shouldn't move the number
        everyone reads."""
        s = sorted(values)
        n = len(s)
        mid = s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2
        return {"min": s[0], "median": round(mid, 2), "max": s[-1], "listings": n}

    stats = {
        "generated_at": now,
        "chains_covered": CHAINS,
        "store_count": len(stores_out),
        "total_observations": len(full_history),
        "observations_this_run": len(new_observations),
        "listings_per_variant": dict(per_variant_counts),
        "depletion_breakdown": dict(depletion_counts),
        # --- the counter: how much Monster is on Israeli shelves right now
        "live_listings": sum(per_variant_counts.values()),
        "flavours_on_shelves": len(per_variant_counts),
        "stores_per_chain": dict(sorted(stores_per_chain.items(), key=lambda kv: -kv[1])),
        # --- price analysis, for "who is actually cheapest"
        "price_by_chain": {
            chain: _spread(v) for chain, v in sorted(prices_by_chain.items())
        },
        "price_by_variant": {
            variant: _spread(v) for variant, v in sorted(prices_by_variant.items())
        },
        "cheapest_listing": cheapest_now,
    }
    (DATA_DIR / "stats.json").write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Wrote data/stats.json")


if __name__ == "__main__":
    asyncio.run(run())
