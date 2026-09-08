import asyncio
import logging

logging.basicConfig(level=logging.INFO)

from il_supermarket_scarper.scrappers.shufersal import Shufersal
from il_supermarket_scarper.utils.file_output import DiskFileOutput


async def main():
    # Work around a bug in il-supermarket-scraper 1.0.11: Shufersal.__init__
    # calls DumpFolderNames[chain] where chain is already the enum member
    # (should be DumpFolderNames[chain.name] or just `chain`), which raises
    # KeyError when file_output isn't supplied explicitly.
    s = Shufersal(file_output=DiskFileOutput(storage_path="dumps/Shufersal"))
    print("instantiated, starting scrape...", flush=True)
    async for result in s.scrape(limit=3, files_types=["PRICE_FULL_FILE"]):
        print("GOT:", result, flush=True)
    print("done", flush=True)


asyncio.run(main())
