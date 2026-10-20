"""Sync every active, connected account (cron entrypoint; keeps uvicorn free).

Usage: python -m scripts.sync_all_accounts [--max 100]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys

sys.path.insert(0, ".")

from sqlalchemy import select  # noqa: E402

from backend.models.db import AsyncSessionLocal  # noqa: E402
from backend.models.entities import EmailAccount  # noqa: E402
from backend.services.email.account_sync import sync_account  # noqa: E402


async def main(max_results: int) -> None:
    async with AsyncSessionLocal() as session:
        accounts = (await session.scalars(select(EmailAccount).where(
            EmailAccount.deleted_at.is_(None), EmailAccount.is_active.is_(True),
            EmailAccount.auth_type.isnot(None)))).all()
        for a in accounts:
            res = await sync_account(session, a, max_results)
            await session.commit()
            print(json.dumps(res, default=str))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=100)
    asyncio.run(main(ap.parse_args().max))
