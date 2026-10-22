"""
Chatita Mail v3.0 - Triage orchestration service.

The heart of Phase 1. For each email it:
  1. Runs prompt-injection defense (sanitize + flag).
  2. Runs the 2-stage classifier (lexical -> LLM).
  3. Runs phishing detection (XAI).
  4. Applies automatic actions:
       - block/quarantine dangerous mail
       - auto-archive LOW/NOISE
       - auto-unsubscribe never-read newsletters (SPAM)
       - notify Telegram for CRITICAL/IMPORTANT
  5. Persists classification + security_event and updates email status.

Goal: shrink the inbox and surface only what matters (<=5 min/day).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.ai.classifier import EmailClassifier
from backend.ai.security import PhishingDetector, PromptInjectionDefense
from backend.models.entities import (
    Classification,
    Email,
    EmailCategory,
    EmailStatus,
    RiskLevel,
    SecurityEvent,
)
from backend.services.notifier import TelegramNotifier
from backend.services.unsubscribe import Unsubscriber
from backend.services.workflow import TaskExtractor

logger = logging.getLogger("chatita_mail.triage")

# Categories that trigger Phase-2 task/commitment extraction.
_EXTRACT_CATEGORIES = (EmailCategory.CRITICAL, EmailCategory.IMPORTANT)


@dataclass
class TriageOutcome:
    email_id: str
    category: EmailCategory
    confidence: float
    stage: str
    risk_level: RiskLevel
    risk_score: int
    status: EmailStatus
    actions: list[str]
    tasks: int = 0
    commitments: int = 0


class TriageService:
    def __init__(
        self,
        classifier: EmailClassifier | None = None,
        phishing: PhishingDetector | None = None,
        injection: PromptInjectionDefense | None = None,
        notifier: TelegramNotifier | None = None,
        unsubscriber: Unsubscriber | None = None,
        task_extractor: TaskExtractor | None = None,
    ) -> None:
        self.classifier = classifier or EmailClassifier()
        self.phishing = phishing or PhishingDetector()
        self.injection = injection or PromptInjectionDefense()
        self.notifier = notifier or TelegramNotifier()
        self.unsubscriber = unsubscriber or Unsubscriber()
        self.task_extractor = task_extractor or TaskExtractor()

    async def triage_email(
        self, session: AsyncSession, email: Email, auto_actions: bool = True
    ) -> TriageOutcome:
        actions: list[str] = []

        # 1) Prompt injection defense
        inj = self.injection.scan(email.body_text)
        safe_body = inj.sanitized_text
        if inj.detected:
            actions.append(f"prompt_injection_flagged:{','.join(inj.matches[:3])}")

        # 2) Classification (2-stage)
        cls = await self.classifier.classify(
            from_address=email.from_address,
            from_name=email.from_name,
            subject=email.subject,
            body_text=safe_body,
        )

        # 3) Phishing detection (XAI)
        sec = await self.phishing.analyze(
            from_address=email.from_address,
            subject=email.subject,
            body_text=safe_body,
            attachments=email.attachments or [],
        )
        if inj.detected:
            # Injection raises the floor to at least suspicious.
            sec.risk_score = max(sec.risk_score, 60)
            sec.risk_factors.append("Prompt injection attempt in body")
            if sec.risk_level == RiskLevel.SAFE:
                sec.risk_level = RiskLevel.SUSPICIOUS

        # 4) Decide status + actions
        new_status = email.status
        if auto_actions:
            new_status, action_log = await self._apply_actions(email, cls, sec)
            actions.extend(action_log)

        # 5) Persist
        await self._persist(session, email, cls, sec, new_status)

        # 6) Phase 2: extract tasks/commitments for high-value mail that stays in inbox
        n_tasks = n_commits = 0
        if (
            cls.category in _EXTRACT_CATEGORIES
            and new_status == EmailStatus.INBOX
            and sec.recommended_action == "allow"
        ):
            try:
                extraction = await self.task_extractor.extract_and_persist(
                    session, email, replace=True
                )
                n_tasks = len(extraction.tasks)
                n_commits = len(extraction.commitments)
                if n_tasks or n_commits:
                    actions.append(f"extracted:{n_tasks}t/{n_commits}c:{extraction.source}")
            except Exception as exc:  # noqa: BLE001
                logger.warning("Task extraction failed for %s: %s", email.id, exc)

        return TriageOutcome(
            email_id=email.id,
            category=cls.category,
            confidence=cls.confidence,
            stage=cls.stage,
            risk_level=sec.risk_level,
            risk_score=sec.risk_score,
            status=new_status,
            actions=actions,
            tasks=n_tasks,
            commitments=n_commits,
        )

    # ── Actions ─────────────────────────────────────────────
    async def _apply_actions(self, email, cls, sec) -> tuple[EmailStatus, list[str]]:
        actions: list[str] = []

        # Security first
        if sec.recommended_action == "block":
            actions.append("blocked:dangerous")
            return EmailStatus.BLOCKED, actions
        if sec.recommended_action == "quarantine":
            actions.append("quarantined:suspicious")
            return EmailStatus.QUARANTINED, actions

        # Spam newsletters -> unsubscribe + archive
        if cls.category == EmailCategory.SPAM and cls.is_newsletter and cls.unsubscribe_url:
            res = await self.unsubscriber.unsubscribe(cls.unsubscribe_url)
            actions.append(f"unsubscribe:{res.get('method')}:{'ok' if res.get('ok') else 'fail'}")
            return EmailStatus.ARCHIVED, actions

        # Low / Noise / Spam -> archive
        if cls.category in (EmailCategory.LOW, EmailCategory.NOISE, EmailCategory.SPAM):
            actions.append(f"auto_archive:{cls.category.value}")
            return EmailStatus.ARCHIVED, actions

        # Critical / Important -> notify
        # Telegram CRITICAL alerts disabled 2026-10-05 to stop notification spam.
        actions.append("telegram_alert:disabled")
        return EmailStatus.INBOX, actions

    # ── Persistence ─────────────────────────────────────────
    async def _persist(self, session, email, cls, sec, new_status) -> None:
        email.status = new_status

        existing_cls = await session.scalar(
            select(Classification).where(Classification.email_id == email.id)
        )
        if existing_cls:
            existing_cls.category = cls.category
            existing_cls.confidence = cls.confidence
            existing_cls.stage = cls.stage
            existing_cls.reasoning = cls.reasoning
            existing_cls.is_newsletter = cls.is_newsletter
            existing_cls.unsubscribe_url = cls.unsubscribe_url
        else:
            session.add(
                Classification(
                    email_id=email.id,
                    category=cls.category,
                    confidence=cls.confidence,
                    stage=cls.stage,
                    reasoning=cls.reasoning,
                    is_newsletter=cls.is_newsletter,
                    unsubscribe_url=cls.unsubscribe_url,
                )
            )

        existing_sec = await session.scalar(
            select(SecurityEvent).where(SecurityEvent.email_id == email.id)
        )
        if existing_sec:
            existing_sec.risk_score = sec.risk_score
            existing_sec.risk_level = sec.risk_level
            existing_sec.event_type = sec.event_type
            existing_sec.risk_factors = sec.risk_factors
            existing_sec.explanation = sec.explanation
            existing_sec.recommended_action = sec.recommended_action
            existing_sec.sender_reputation = sec.sender_reputation
        else:
            session.add(
                SecurityEvent(
                    email_id=email.id,
                    risk_score=sec.risk_score,
                    risk_level=sec.risk_level,
                    event_type=sec.event_type,
                    risk_factors=sec.risk_factors,
                    explanation=sec.explanation,
                    recommended_action=sec.recommended_action,
                    sender_reputation=sec.sender_reputation,
                )
            )

        await session.flush()
