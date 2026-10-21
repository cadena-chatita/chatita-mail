"""
Chatita Mail — task value filter (pure functions, no database).

Implements the deterministic rules of Quipu DISENO_07 §4 so the inbox stops
filling up with low-value tasks:

  V1  a bulk / transactional notice yields at most ONE task, and only when it has
      a concrete signal (an amount or an upcoming deadline)
  V2  a vague verb with no concrete object, amount or deadline is dropped
  V3  fingerprint = hash(normalized description); used to deduplicate
  V4  hard cap of tasks per email, highest value first
  V5  a deadline already past when the email arrived is dropped
  V6  anything that looks like a one-time code, password or card number is dropped
  V9  the offline fallback is stricter than the LLM path

Nothing here touches the database; the extractor applies the decisions.
"""
from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

# ── Text normalisation / fingerprint (V3) ───────────────────
_PUNCT = re.compile(r"[^a-z0-9 ]+")
_SPACES = re.compile(r"\s+")


def normalize_text(value: str | None) -> str:
    text = unicodedata.normalize("NFKD", (value or "").lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return _SPACES.sub(" ", _PUNCT.sub(" ", text)).strip()


def fingerprint(value: str | None) -> str:
    """Stable 16-hex fingerprint of a task/commitment description."""
    return hashlib.sha256(normalize_text(value).encode("utf-8")).hexdigest()[:16]


# ── Sensitive data (V6) ─────────────────────────────────────
_SENSITIVE = (
    re.compile(
        r"\b(verification|security|confirmation|login|sign[- ]?in|one[- ]?time|otp|2fa|"
        r"verificaci[oó]n|seguridad|acceso)\b[^.\n]{0,40}\b(code|c[oó]digo|pin)\b",
        re.I,
    ),
    re.compile(r"\b(c[oó]digo|code|pin)\b[^.\n]{0,30}\b\d{4,8}\b", re.I),
    re.compile(r"\b(password|contrase[ñn]a)\b\s*[:=]", re.I),
    re.compile(r"\b(?:\d[ -]?){13,19}\b"),  # long digit run: card-like number
)


def is_sensitive(text: str | None) -> bool:
    return any(p.search(text or "") for p in _SENSITIVE)


# ── Concreteness (V2) ───────────────────────────────────────
VAGUE_VERBS = frozenset(
    "review check read view see look consider verify revisar revisa ver leer consultar "
    "verificar checar considerar".split()
)
_AMOUNT = re.compile(
    r"([$€£]\s?\d)|\b(usd|mxn|eur|mx\$)\b|\b\d{1,3}(,\d{3})+(\.\d+)?\b|\b\d+\.\d{2}\b", re.I
)
_HAS_DIGIT = re.compile(r"\d")


def has_amount(text: str | None) -> bool:
    return bool(_AMOUNT.search(text or ""))


def is_vague(description: str, has_deadline: bool) -> bool:
    """Vague verb, short, no digit/amount and no deadline -> low value (V2)."""
    words = normalize_text(description).split()
    if not words or words[0] not in VAGUE_VERBS:
        return False
    return len(words) <= 7 and not has_deadline and not _HAS_DIGIT.search(description)


# ── Bulk / transactional sender detection (V1) ──────────────
_BULK_LOCAL = re.compile(
    r"(no[-_.]?reply|do[-_.]?not[-_.]?reply|notifications?|notify|alerts?|mailer|bounce|"
    r"billing|receipts?|statements?|newsletter|news|updates?|marketing|promo|offers?|"
    r"digest|support|service|info)",
    re.I,
)
_BULK_SUBDOMAIN = frozenset(
    "e em email mail mailer news info notify notification notifications alerts ealerts t go "
    "click welcome messages updates marketing offers promo comms post bounce".split()
)


def is_bulk_sender(from_address: str | None, *, is_newsletter: bool = False, has_unsubscribe: bool = False) -> bool:
    if is_newsletter or has_unsubscribe:
        return True
    addr = (from_address or "").lower()
    if "@" not in addr:
        return False
    local, domain = addr.rsplit("@", 1)
    if _BULK_LOCAL.search(local):
        return True
    labels = domain.split(".")
    return len(labels) >= 3 and labels[0] in _BULK_SUBDOMAIN


# ── Dates ───────────────────────────────────────────────────
def aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def parse_cutoff(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return aware(dt)  # type: ignore[return-value]


# ── Decision ────────────────────────────────────────────────
@dataclass
class FilterResult:
    kept: list[dict] = field(default_factory=list)
    dropped: list[tuple[str, str]] = field(default_factory=list)  # (description, reason)


_PRIORITY_WEIGHT = {"critical": 4, "high": 3, "medium": 2, "low": 1}


def _score(task: dict, now: datetime) -> float:
    s = float(_PRIORITY_WEIGHT.get((task.get("priority") or "medium"), 2))
    deadline = aware(task.get("deadline"))
    if deadline:
        days = (deadline - now).total_seconds() / 86400
        if 0 <= days <= 3:
            s += 2.0
        elif days <= 14:
            s += 1.0
    if has_amount(task["description"]):
        s += 1.0
    if len(normalize_text(task["description"]).split()) >= 4:
        s += 0.5
    return s


def filter_tasks(
    candidates: list[dict],
    *,
    from_address: str | None,
    received_at: datetime | None,
    bulk: bool,
    now: datetime | None = None,
    max_per_email: int = 3,
    strict: bool = False,
) -> FilterResult:
    """Apply V1, V2, V4, V5, V6 (and V9 when `strict`). Returns kept + reasons."""
    now = aware(now) or datetime.now(timezone.utc)
    arrival = aware(received_at) or now
    out = FilterResult()
    seen: set[str] = set()

    for t in candidates:
        desc = (t.get("description") or "").strip()
        deadline = aware(t.get("deadline"))
        if not desc:
            continue
        if is_sensitive(desc):
            out.dropped.append((desc, "V6:dato_sensible"))
            continue
        if deadline and deadline < arrival:
            out.dropped.append((desc, "V5:caducada_al_llegar"))
            continue
        if is_vague(desc, has_deadline=deadline is not None):
            out.dropped.append((desc, "V2:verbo_vago"))
            continue
        if strict and not (deadline or has_amount(desc)):
            out.dropped.append((desc, "V9:reserva_sin_plazo_ni_monto"))
            continue
        fp = fingerprint(desc)
        if fp in seen:
            out.dropped.append((desc, "V3:duplicada_en_el_correo"))
            continue
        seen.add(fp)
        out.kept.append(t)

    if bulk:
        concrete, weak = [], []
        for t in out.kept:
            soon = aware(t.get("deadline")) and now <= aware(t["deadline"]) <= now + timedelta(days=14)
            (concrete if (has_amount(t["description"]) or soon) else weak).append(t)
        out.dropped += [(t["description"], "V1:aviso_transaccional_sin_senal") for t in weak]
        concrete.sort(key=lambda t: _score(t, now), reverse=True)
        out.dropped += [(t["description"], "V1:un_solo_task_por_aviso") for t in concrete[1:]]
        out.kept = concrete[:1]
        return out

    ranked = sorted(out.kept, key=lambda t: _score(t, now), reverse=True)
    for t in ranked[max_per_email:]:
        out.dropped.append((t["description"], "V4:tope_por_correo"))
    out.kept = ranked[:max_per_email]
    return out
