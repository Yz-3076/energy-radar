import asyncio
import logging

logging.basicConfig(level=logging.WARNING)

from il_supermarket_scarper.scrappers.shufersal import Shufersal
from il_supermarket_scarper.utils.file_output import DiskFileOutput


async def main():
    s = Shufersal(file_output=DiskFileOutput(storage_path="dumps/Shufersal_stores"))
    async for result in s.scrape(limit=1, files_types=["STORE_FILE"]):
        print("GOT:", result, flush=True)


asyncio.run(main())
