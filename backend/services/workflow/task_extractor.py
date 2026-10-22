"""
Chatita Mail v3.0 — Phase 2: Task & Commitment Extractor.

Given an email, delegates to AION Brain to extract:
  - tasks       : actionable items the USER must do (with optional deadline/type/priority)
  - commitments : promises made (by "me" or by the "sender") with a due date

The LLM is asked to return STRICT JSON. We parse defensively and persist to the
`tasks` and `commitments` tables. If AION Brain is unavailable, a light regex
fallback extracts obvious deadline phrases so the pipeline never blocks.

This is a Chatita Mail client concern — it only *calls* AION Brain (orchestrate),
it does NOT modify AION Brain itself.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from dateutil import parser as dateparser
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.ai.aion_client import AIONBrainClient
from backend.config import settings
from backend.models.entities import Classification, Commitment, Email, Task
from backend.services.workflow.task_value import (
    aware,
    filter_tasks,
    fingerprint,
    is_bulk_sender,
    is_sensitive,
    parse_cutoff,
    same_obligation,
)

logger = logging.getLogger("chatita_mail.workflow")

_MAX_BODY = 4000  # chars sent to the LLM (cost control)

_PROMPT = """You are an executive assistant. Read the email below and extract:
1. TASKS: concrete actions the RECIPIENT must take. Each task: a short imperative \
description that NAMES the object (never just "review" or "check"), optional ISO-8601 deadline, \
type (calendar|document|reply|payment|reminder|other), priority (high|medium|low). \
Be strict: at most 3 tasks; ignore marketing, receipts, informational notices, shipping or travel \
boilerplate, and anything whose deadline already passed. NEVER include verification codes, \
passwords or card numbers. When unsure whether it needs real action, return no task.
2. COMMITMENTS: explicit promises. who = "me" (recipient) or "sender"; what = the promise; \
optional ISO-8601 deadline.

Return ONLY valid minified JSON, no markdown, with this exact shape:
{{"tasks":[{{"description":"...","deadline":null,"task_type":"reply","priority":"medium"}}],\
"commitments":[{{"who":"me","what":"...","deadline":null}}]}}
If there are none, return {{"tasks":[],"commitments":[]}}.

Today is {today}.

FROM: {sender}
SUBJECT: {subject}
BODY:
{body}
"""


@dataclass
class ExtractionResult:
    tasks: list[dict] = field(default_factory=list)
    commitments: list[dict] = field(default_factory=list)
    source: str = "llm"  # llm | fallback | none | skipped_before_cutoff
    dropped: list[tuple[str, str]] = field(default_factory=list)  # (description, rule)


class TaskExtractor:
    def __init__(self, aion: AIONBrainClient | None = None) -> None:
        self.aion = aion or AIONBrainClient()

    # ── Public API ──────────────────────────────────────────
    async def extract(
        self,
        *,
        from_address: str,
        from_name: str | None,
        subject: str | None,
        body_text: str | None,
        received_at: datetime | None = None,
        is_bulk: bool | None = None,
    ) -> ExtractionResult:
        body = (body_text or "").strip()[:_MAX_BODY]
        if not body and not subject:
            return ExtractionResult(source="none")
        if is_bulk is None:
            is_bulk = is_bulk_sender(from_address)

        prompt = _PROMPT.format(
            today=datetime.utcnow().date().isoformat(),
            sender=f"{from_name} <{from_address}>" if from_name else from_address,
            subject=subject or "(no subject)",
            body=body or "(empty)",
        )

        try:
            resp = await self.aion.orchestrate(prompt, task_type="medium", priority="P2")
            text = (resp or {}).get("text") or ""
            if not text or (resp or {}).get("fallback"):
                result = self._fallback(subject, body)
            else:
                parsed = self._parse_json(text)
                if parsed is None:
                    result = self._fallback(subject, body)
                else:
                    result = ExtractionResult(
                        tasks=self._clean_tasks(parsed.get("tasks", [])),
                        commitments=self._clean_commitments(parsed.get("commitments", [])),
                        source="llm",
                    )
        except Exception as exc:  # noqa: BLE001
            logger.warning("TaskExtractor LLM failed: %s", exc)
            result = self._fallback(subject, body)

        return self._apply_value_filter(
            result, from_address=from_address, received_at=received_at, is_bulk=is_bulk
        )

    def _apply_value_filter(
        self, result: ExtractionResult, *, from_address: str, received_at: datetime | None, is_bulk: bool
    ) -> ExtractionResult:
        verdict = filter_tasks(
            result.tasks,
            from_address=from_address,
            received_at=received_at,
            bulk=is_bulk,
            max_per_email=settings.task_max_per_email,
            strict=result.source == "fallback",
        )
        result.tasks = verdict.kept
        result.dropped = verdict.dropped
        kept_c = []
        for c in result.commitments:
            if is_sensitive(c["what"]):
                result.dropped.append((c["what"], "V6:dato_sensible"))
            else:
                kept_c.append(c)
        result.commitments = kept_c
        if result.dropped:
            logger.info("TaskExtractor filtered %d item(s): %s", len(result.dropped),
                        sorted({r for _, r in result.dropped}))
        return result

    async def extract_and_persist(
        self, session: AsyncSession, email: Email, *, replace: bool = True, force: bool = False
    ) -> ExtractionResult:
        """Extract tasks/commitments for an email and merge them without ever
        resurrecting something the user already closed.

        * Emails received before `settings.task_extract_since` are skipped unless
          `force` (manual "Extract tasks" click).
        * `replace` only refreshes still-PENDING items; done/dismissed ones stay.
        * The same obligation from the same sender is not recreated within
          `settings.task_dedupe_days`, whatever its status.
        """
        cutoff = parse_cutoff(settings.task_extract_since)
        received = aware(email.received_at)
        if not force and received is not None and received < cutoff:
            return ExtractionResult(source="skipped_before_cutoff")

        cls = await session.scalar(select(Classification).where(Classification.email_id == email.id))
        bulk = is_bulk_sender(
            email.from_address,
            is_newsletter=bool(cls and cls.is_newsletter),
            has_unsubscribe=bool(cls and cls.unsubscribe_url),
        )
        result = await self.extract(
            from_address=email.from_address,
            from_name=email.from_name,
            subject=email.subject,
            body_text=email.body_text,
            received_at=received,
            is_bulk=bulk,
        )

        existing_tasks = (await session.scalars(select(Task).where(Task.email_id == email.id))).all()
        closed_or_open_fp = {fingerprint(t.description) for t in existing_tasks}
        new_fp = {fingerprint(t["description"]) for t in result.tasks}

        deleted_ids: set = set()
        if replace:  # drop only stale PENDING tasks; never touch closed ones
            for t in existing_tasks:
                if t.status == "pending" and fingerprint(t.description) not in new_fp:
                    await session.delete(t)
                    deleted_ids.add(t.id)
            existing_c = (await session.scalars(select(Commitment).where(Commitment.email_id == email.id))).all()
            new_c_fp = {fingerprint(f"{c.get('who')} {c['what']}") for c in result.commitments}
            for c in existing_c:
                if c.status == "pending" and fingerprint(f"{c.who} {c.what}") not in new_c_fp:
                    await session.delete(c)
        existing_c_fp = {
            fingerprint(f"{c.who} {c.what}")
            for c in (await session.scalars(select(Commitment).where(Commitment.email_id == email.id))).all()
        }

        recent_fp, recent_desc = await self._recent_fingerprints(session, email)
        seen_desc = [t.description for t in existing_tasks if t.id not in deleted_ids] + recent_desc   # the same obligation in other words
        added_tasks, added_commits = [], []
        for t in result.tasks:
            fp = fingerprint(t["description"])
            if fp in closed_or_open_fp or fp in recent_fp:
                result.dropped.append((t["description"], "V3:ya_existe"))
                continue
            if any(same_obligation(t["description"], d) for d in seen_desc):
                result.dropped.append((t["description"], "V3:misma_obligacion"))
                continue
            seen_desc.append(t["description"])
            session.add(
                Task(
                    email_id=email.id,
                    description=t["description"],
                    task_type=t.get("task_type"),
                    priority=t.get("priority"),
                    deadline=t.get("deadline"),
                    status="pending",
                )
            )
            added_tasks.append(t)
        for c in result.commitments:
            if fingerprint(f"{c.get('who')} {c['what']}") in existing_c_fp:
                continue
            session.add(
                Commitment(
                    email_id=email.id,
                    who=c.get("who", "me")[:320],
                    what=c["what"],
                    deadline=c.get("deadline"),
                    status="pending",
                )
            )
            added_commits.append(c)
        result.tasks, result.commitments = added_tasks, added_commits
        await session.flush()
        return result

    async def _recent_fingerprints(self, session: AsyncSession, email: Email) -> tuple[set[str], list[str]]:
        since = datetime.now(timezone.utc) - timedelta(days=settings.task_dedupe_days)
        rows = (
            await session.scalars(
                select(Task)
                .join(Email, Email.id == Task.email_id)
                .where(Email.from_address == email.from_address, Task.email_id != email.id, Task.created_at >= since)
            )
        ).all()
        return {fingerprint(t.description) for t in rows}, [t.description for t in rows]

    # ── Parsing helpers ─────────────────────────────────────
    @staticmethod
    def _parse_json(text: str) -> dict | None:
        text = text.strip()
        # Strip markdown fences if the model added them.
        if text.startswith("```"):
            text = re.sub(r"^```[a-zA-Z]*\n?|\n?```$", "", text).strip()
        # Grab the first {...} block.
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            return None
        try:
            data = json.loads(match.group(0))
            return data if isinstance(data, dict) else None
        except json.JSONDecodeError:
            return None

    def _clean_tasks(self, raw: list) -> list[dict]:
        out: list[dict] = []
        for item in raw or []:
            if not isinstance(item, dict):
                continue
            desc = (item.get("description") or "").strip()
            if not desc:
                continue
            out.append(
                {
                    "description": desc[:500],
                    "task_type": self._norm(item.get("task_type")),
                    "priority": self._norm(item.get("priority")) or "medium",
                    "deadline": self._parse_date(item.get("deadline")),
                }
            )
        return out[:10]

    def _clean_commitments(self, raw: list) -> list[dict]:
        out: list[dict] = []
        for item in raw or []:
            if not isinstance(item, dict):
                continue
            what = (item.get("what") or "").strip()
            if not what:
                continue
            who = (item.get("who") or "me").strip().lower()
            who = who if who in ("me", "sender") else who[:320]
            out.append(
                {"who": who, "what": what[:500], "deadline": self._parse_date(item.get("deadline"))}
            )
        return out[:10]

    @staticmethod
    def _norm(v) -> str | None:
        if not v or not isinstance(v, str):
            return None
        return v.strip().lower()[:20] or None

    @staticmethod
    def _parse_date(v) -> datetime | None:
        if not v or not isinstance(v, str):
            return None
        try:
            return dateparser.parse(v)
        except (ValueError, OverflowError):
            return None

    # ── Fallback (offline) ──────────────────────────────────
    def _fallback(self, subject: str | None, body: str) -> ExtractionResult:
        """Very light heuristic: detect deadline words + imperative subject."""
        text = f"{subject or ''}\n{body}".lower()
        tasks: list[dict] = []
        deadline = None
        if re.search(r"\b(hoy|today|urgent|urgente|asap|end of day|eod)\b", text):
            deadline = datetime.utcnow().replace(hour=23, minute=59, second=0, microsecond=0)
        elif re.search(r"\b(ma[nñ]ana|tomorrow)\b", text):
            deadline = (datetime.utcnow() + timedelta(days=1)).replace(
                hour=17, minute=0, second=0, microsecond=0
            )
        if subject and re.search(
            r"\b(review|revisa|sign|firma|pay|paga|send|env[ií]a|confirm|schedule|agenda)\b",
            subject.lower(),
        ):
            tasks.append(
                {
                    "description": subject.strip()[:500],
                    "task_type": "reply",
                    "priority": "high" if deadline else "medium",
                    "deadline": deadline,
                }
            )
        return ExtractionResult(tasks=tasks, commitments=[], source="fallback")
