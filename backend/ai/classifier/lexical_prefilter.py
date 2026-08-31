"""
Chatita Mail v3.0 — Stage 1: Lexical pre-filter.

Research basis:
  - Jáñez-Martino et al. (2023): TF-IDF + LR classifies at ~2ms/email.
  - Fast, deterministic, $0 cost. Handles obvious cases (newsletters,
    receipts, notifications) WITHOUT invoking an LLM.

Only ambiguous emails (confidence < threshold) escalate to Stage 2 (LLM).
This is the primary cost-optimization lever for AION Brain usage.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from backend.models.entities import EmailCategory

# ── Signal dictionaries ─────────────────────────────────────
_NEWSLETTER_HEADERS = ("list-unsubscribe", "list-id", "precedence: bulk")

_NOISE_SENDERS = (
    "noreply", "no-reply", "donotreply", "do-not-reply", "notifications@",
    "notification@", "automated@", "mailer-daemon", "postmaster@",
)

_NOISE_SUBJECTS = (
    "receipt", "your order", "order confirmation", "shipping", "has shipped",
    "invoice #", "statement is ready", "payment received", "verify your email",
    "confirm your subscription", "password reset",
)

_PROMO_KEYWORDS = (
    "unsubscribe", "% off", "sale ends", "limited time", "shop now",
    "deal", "discount", "promo code", "newsletter", "weekly digest",
    "black friday", "cyber monday", "exclusive offer",
)

_SPAM_KEYWORDS = (
    "you won", "winner", "claim your prize", "viagra", "crypto giveaway",
    "act now", "risk-free", "100% free", "make money fast", "work from home",
    "nigerian prince", "wire transfer", "bitcoin doubler",
)

_CRITICAL_KEYWORDS = (
    "urgent", "asap", "deadline today", "action required", "immediately",
    "time sensitive", "please respond", "overdue",
)

_TRAVEL_TRANSACTION_KEYWORDS = (
    "flight receipt", "reservation itinerary", "trip confirmation",
    "itinerary confirmation", "cancel itinerary", "booking confirmation",
    "reservación confirmada", "confirmación de viaje", "cambio de itinerario",
    "itinerario de viaje", "hotel confirmation", "check-in confirmation",
)

_UNSUBSCRIBE_RE = re.compile(
    r'https?://[^\s"\'<>]*unsub[^\s"\'<>]*', re.IGNORECASE
)


@dataclass
class LexicalResult:
    category: EmailCategory
    confidence: float
    is_newsletter: bool = False
    unsubscribe_url: str | None = None
    matched_signals: list[str] = field(default_factory=list)

    @property
    def is_confident(self) -> bool:
        # Threshold applied by caller; helper for readability.
        return self.confidence >= 0.90


def _contains_any(haystack: str, needles: tuple[str, ...]) -> list[str]:
    hs = haystack.lower()
    return [n for n in needles if n in hs]


class LexicalPreFilter:
    """Deterministic first-pass classifier (Stage 1)."""

    def classify(
        self,
        from_address: str,
        subject: str | None,
        body_text: str | None,
        raw_headers: str | None = None,
    ) -> LexicalResult:
        subject = subject or ""
        body = body_text or ""
        headers = (raw_headers or "").lower()
        signals: list[str] = []

        # Detect newsletter via headers or unsubscribe link
        header_newsletter = any(h in headers for h in _NEWSLETTER_HEADERS)
        unsub_match = _UNSUBSCRIBE_RE.search(body) or _UNSUBSCRIBE_RE.search(headers)
        unsubscribe_url = unsub_match.group(0) if unsub_match else None
        promo_hits = _contains_any(f"{subject} {body}", _PROMO_KEYWORDS)
        is_newsletter = bool(header_newsletter or (unsubscribe_url and promo_hits))

        travel_hits = _contains_any(f"{subject} {body}", _TRAVEL_TRANSACTION_KEYWORDS)
        if travel_hits:
            signals += [f"travel_transaction:{s}" for s in travel_hits]
            return LexicalResult(
                category=EmailCategory.IMPORTANT,
                confidence=0.96,
                is_newsletter=False,
                unsubscribe_url=unsubscribe_url,
                matched_signals=signals,
            )

        # ── SPAM: strong scammy keywords ────────────────────
        spam_hits = _contains_any(f"{subject} {body}", _SPAM_KEYWORDS)
        if len(spam_hits) >= 1:
            signals += [f"spam:{s}" for s in spam_hits]
            return LexicalResult(
                category=EmailCategory.SPAM,
                confidence=0.93 if len(spam_hits) >= 2 else 0.88,
                is_newsletter=is_newsletter,
                unsubscribe_url=unsubscribe_url,
                matched_signals=signals,
            )

        # ── NOISE: automated senders / transactional ────────
        sender_hits = _contains_any(from_address, _NOISE_SENDERS)
        subject_noise = _contains_any(subject, _NOISE_SUBJECTS)
        if sender_hits or subject_noise:
            signals += [f"noise_sender:{s}" for s in sender_hits]
            signals += [f"noise_subject:{s}" for s in subject_noise]
            conf = 0.92 if sender_hits else 0.85
            return LexicalResult(
                category=EmailCategory.NOISE,
                confidence=conf,
                is_newsletter=is_newsletter,
                unsubscribe_url=unsubscribe_url,
                matched_signals=signals,
            )

        # ── SPAM/LOW: promotional newsletters ───────────────
        if is_newsletter and promo_hits:
            signals += [f"promo:{p}" for p in promo_hits]
            return LexicalResult(
                category=EmailCategory.SPAM,
                confidence=0.86,
                is_newsletter=True,
                unsubscribe_url=unsubscribe_url,
                matched_signals=signals,
            )

        # ── CRITICAL hint (still low confidence; verify w/ LLM) ─
        critical_hits = _contains_any(subject, _CRITICAL_KEYWORDS)
        if critical_hits:
            signals += [f"critical:{c}" for c in critical_hits]
            # Deliberately LOW confidence -> escalate to LLM for real judgment.
            return LexicalResult(
                category=EmailCategory.IMPORTANT,
                confidence=0.55,
                is_newsletter=is_newsletter,
                unsubscribe_url=unsubscribe_url,
                matched_signals=signals,
            )

        # ── Ambiguous -> force LLM escalation ────────────────
        return LexicalResult(
            category=EmailCategory.UNCLASSIFIED,
            confidence=0.0,
            is_newsletter=is_newsletter,
            unsubscribe_url=unsubscribe_url,
            matched_signals=signals,
        )
