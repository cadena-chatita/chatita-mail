"""Stable colors: the same case or calendar always gets the same color in every view and every endpoint."""
from __future__ import annotations

import hashlib

CASE_PALETTE = ["#4f46e5", "#0891b2", "#059669", "#d97706", "#dc2626", "#7c3aed", "#db2777", "#2563eb", "#65a30d", "#ea580c", "#0d9488", "#9333ea"]
CALENDAR_PALETTE = ["#64748b", "#0ea5e9", "#22c55e", "#eab308", "#f43f5e", "#a855f7", "#14b8a6", "#f97316", "#6366f1", "#84cc16"]


def _pick(palette: list[str], key: str) -> str:
    return palette[int(hashlib.sha256(key.encode("utf-8")).hexdigest(), 16) % len(palette)]


def case_color(code: str) -> str:
    return _pick(CASE_PALETTE, f"case:{code}")


def calendar_color(name: str) -> str:
    return _pick(CALENDAR_PALETTE, f"cal:{name}")
