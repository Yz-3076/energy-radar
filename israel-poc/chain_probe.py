import asyncio, logging, time
logging.disable(logging.CRITICAL)
from il_supermarket_scarper.scrappers_factory import ScraperFactory
from pipeline import fetch_files, parse_stores, parse_monster_items, CHAINS

ALL = [c.name for c in ScraperFactory]
TODO = [c for c in ALL if c not in CHAINS]

async def main():
    print(f"probing {len(TODO)} chains not currently scraped\n", flush=True)
    print(f"{'chain':32s} {'branches':>8s} {'monster':>8s} {'secs':>6s}  note", flush=True)
    good = []
    for chain in TODO:
        t0 = time.time()
        try:
            sd = await fetch_files(chain, "STORE_FILE", "stores")
            stores = parse_stores(sd)
            pd = await fetch_files(chain, "PRICE_FULL_FILE", "prices")
            rows = list(parse_monster_items(pd))
        except Exception as e:
            print(f"{chain:32s} {'-':>8s} {'-':>8s} {time.time()-t0:6.0f}  FAILED {type(e).__name__}", flush=True)
            continue
        dt = time.time() - t0
        if rows and stores:
            good.append(chain); note = "USABLE"
        elif not stores:
            note = "no store file -> cannot geocode"
        else:
            note = "no Monster in sampled files"
        print(f"{chain:32s} {len(stores):8d} {len(rows):8d} {dt:6.0f}  {note}", flush=True)
    print("\nUSABLE:", good, flush=True)

asyncio.run(main())
