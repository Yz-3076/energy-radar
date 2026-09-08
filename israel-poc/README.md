# Israel price pipeline

`pipeline.py` is the real thing: fetch → filter → resolve → geocode →
depletion-assess → write `../data/latest.json` + append `../data/history.ndjson`.
It runs on a 3-hour schedule via
[`../.github/workflows/fetch-prices.yml`](../.github/workflows/fetch-prices.yml) —
see [`../docs/staying-current.md`](../docs/staying-current.md) for the
honest current-coverage state.

```bash
pip install -r requirements.txt
python pipeline.py
```

`PIPELINE_LIMIT=5 python pipeline.py` fetches just a handful of branches per
chain instead of the whole country — useful for a quick local check without
waiting on (or re-geocoding) a full national run.

Add a chain by adding its `ScraperFactory` name to `CHAINS` in `pipeline.py`
— every chain in the transparency law goes through the same code path, no
per-chain logic needed beyond that.

## The exploratory scripts (`fetch_prices.py`, `find_monster.py`,
## `fetch_stores.py`, `resolve_stores.py`)

These are what proved the concept on 2026-09-05, kept for reference — small,
single-purpose, print-to-stdout versions of the same fetch/filter/resolve
steps `pipeline.py` now does properly (multi-chain, geocoded, historied,
depletion-assessed). Not needed for anything anymore, but they're the
easiest way to poke at one piece of the pipeline in isolation.

## Known library bug (worked around in `pipeline.py` and the scripts above)

`il-supermarket-scraper` 1.0.11's chain classes (e.g. `Shufersal.__init__`) call
`DumpFolderNames[chain]` where `chain` is already the enum *member*, not its
string name — this raises `KeyError` unless you pass `file_output=` yourself.
When run through the library's own `ScarpingTask` (multiprocessing) wrapper,
the error is swallowed silently: it looks like the scrape just hangs and
produces zero files, with no error printed. The fix is to construct the
scraper with an explicit `DiskFileOutput`, as `pipeline.py` does.

## Another real quirk found building this (worked around in `pipeline.py`)

A chain's `PriceFull` files zero-pad `StoreID` (`"049"`); that same chain's
`Stores` file does not (`"49"`). Confirmed against live Shufersal data —
without normalizing both to the same format, every single item gets dropped
for "unknown store" even though the data is all correct. See
`_normalize_store_id` in `pipeline.py`.

## Known library bug (worked around in `fetch_prices.py` / `fetch_stores.py`)

`il-supermarket-scraper` 1.0.11's chain classes (e.g. `Shufersal.__init__`) call
`DumpFolderNames[chain]` where `chain` is already the enum *member*, not its
string name — this raises `KeyError` unless you pass `file_output=` yourself.
When run through the library's own `ScarpingTask` (multiprocessing) wrapper,
the error is swallowed silently: it looks like the scrape just hangs and
produces zero files, with no error printed. The fix is to construct the
scraper with an explicit `DiskFileOutput`, as both scripts here do.
