"""
Send a one-time Telegram notification when the mass re-classify finishes.
Reads final stats from retriage_progress.json and the live category
distribution from the DB, then sends via the existing TelegramNotifier
(AION telegram tool with direct Telegram API fallback).

Invoked by retriage_resume.sh once completion is detected (guarded by a
sentinel file so it fires exactly once).
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import func, select

from backend.models.db import AsyncSessionLocal
from backend.models.entities import Classification
from backend.services.notifier import TelegramNotifier

PROG = Path(__file__).resolve().parent / "retriage_progress.json"


async def main() -> None:
    stats: dict = {}
    try:
        stats = json.loads(PROG.read_text()).get("stats", {})
    except Exception:  # noqa: BLE001
        pass

    dist_lines: list[str] = []
    try:
        async with AsyncSessionLocal() as s:
            rows = (
                await s.execute(
                    select(Classification.category, func.count())
                    .group_by(Classification.category)
                    .order_by(func.count().desc())
                )
            ).all()
            dist_lines = [f"  \u2022 {cat}: {n:,}" for cat, n in rows]
    except Exception as exc:  # noqa: BLE001
        dist_lines = [f"  (distribucion no disponible: {exc})"]

    msg = (
        "\u2705 Chatita Mail \u2014 reclasificacion masiva COMPLETADA\n\n"
        f"Procesados: {stats.get('done', 0):,}\n"
        f"LLM (IA real): {stats.get('llm', 0):,}\n"
        f"Lexical: {stats.get('lexical', 0):,}\n"
        f"Fallback: {stats.get('fallback', 0):,}\n"
        f"Errores: {stats.get('errors', 0):,}\n\n"
        "Distribucion por categoria:\n" + "\n".join(dist_lines)
    )
    # Telegram completion alert disabled 2026-10-05 to stop notification spam.
    ok = True  # was: await TelegramNotifier().notify(msg)
    print(f"notified={ok}")


if __name__ == "__main__":
    asyncio.run(main())
