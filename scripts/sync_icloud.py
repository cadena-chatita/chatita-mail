"""Out-of-process iCloud IMAP sync (keeps the single uvicorn worker free)."""
from __future__ import annotations

import argparse
import asyncio
import json
import sys

sys.path.insert(0, ".")

from backend.models.db import AsyncSessionLocal  # noqa: E402
from backend.services.email.sync import ICloudSyncService  # noqa: E402


async def main(max_results: int, force_full: bool) -> None:
    async with AsyncSessionLocal() as session:
        res = await ICloudSyncService().sync(
            session, max_results=max_results, run_triage=False, force_full=force_full
        )
        await session.commit()
    res.pop("results", None)
    print(json.dumps(res, default=str))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=100)
    ap.add_argument("--force-full", action="store_true")
    a = ap.parse_args()
    asyncio.run(main(a.max, a.force_full))
