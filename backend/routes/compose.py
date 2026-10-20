"""
Chatita Mail v3.0 — Compose routes (reply / reply-all / forward / new).

Sends real mail as the impersonated mailbox (jose@manuelcadena.com) via the
service account's gmail.send scope. The frontend always shows a confirmation
before calling these endpoints. Every send is logged by the connector.

  POST /api/inbox/emails/{id}/reply    -> reply (threaded) to an email
  POST /api/inbox/emails/{id}/forward  -> forward an email (optionally w/ files)
  POST /api/inbox/compose              -> brand-new message
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.models.db import get_session
from backend.models.entities import Email, EmailStatus
from backend.routes.inbox import _get_or_create_account
from backend.services.email.gmail_connector import GmailConnector

log = logging.getLogger("chatita_mail.compose")
router = APIRouter(prefix="/api", tags=["compose"])

_gmail = GmailConnector()


async def _persist_sent(
    session: AsyncSession,
    *,
    result: dict,
    to: list[str],
    cc: list[str] | None,
    subject: str,
    body: str,
    thread_id: str | None = None,
) -> None:
    """Store a copy of an outbound message (status=SENT). Never fails the send."""
    try:
        account = await _get_or_create_account(session, settings.gmail_impersonate_subject)
        session.add(
            Email(
                account_id=account.id,
                provider_message_id=result.get("id") or f"sent-{datetime.now(timezone.utc).timestamp()}",
                thread_id=result.get("threadId") or thread_id,
                from_address=settings.gmail_impersonate_subject,
                from_name="Me",
                to_addresses=to,
                cc_addresses=cc or None,
                subject=subject,
                body_text=body,
                snippet=(body or "")[:200],
                status=EmailStatus.SENT,
                is_read=True,
                received_at=datetime.now(timezone.utc),
            )
        )
        await session.flush()
    except Exception as exc:  # noqa: BLE001
        log.warning("persist SENT failed (mail already sent): %s", exc)


# ── request bodies ──────────────────────────────────────────
class ReplyIn(BaseModel):
    body: str
    to: list[str] | None = None      # override recipients (defaults to sender)
    cc: list[str] | None = None
    subject: str | None = None       # defaults to "Re: <original>"
    reply_all: bool = False


class ForwardIn(BaseModel):
    to: list[str]
    body: str = ""
    cc: list[str] | None = None
    subject: str | None = None       # defaults to "Fwd: <original>"
    include_attachments: bool = True


class ComposeIn(BaseModel):
    to: list[str]
    subject: str
    body: str
    cc: list[str] | None = None
    bcc: list[str] | None = None
    from_account_id: str | None = None


# ── helpers ─────────────────────────────────────────────────
async def _load_email(session: AsyncSession, email_id: str) -> Email:
    email = await session.scalar(select(Email).where(Email.id == email_id))
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    return email


def _self_addr() -> str:
    return (settings.gmail_impersonate_subject or "").lower()


def _dedup_keep_order(items: list[str], exclude: set[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for a in items:
        a = (a or "").strip()
        low = a.lower()
        if not a or low in seen or low in exclude:
            continue
        seen.add(low)
        out.append(a)
    return out


def _re_subject(prefix: str, original: str | None) -> str:
    subj = (original or "").strip()
    low = subj.lower()
    if prefix == "Re:" and low.startswith("re:"):
        return subj
    if prefix == "Fwd:" and (low.startswith("fwd:") or low.startswith("fw:")):
        return subj
    return f"{prefix} {subj}".strip()


# ── endpoints ───────────────────────────────────────────────
@router.post("/inbox/emails/{email_id}/reply")
async def reply_email(
    email_id: str, payload: ReplyIn, session: AsyncSession = Depends(get_session)
) -> dict:
    """Send a threaded reply to an email as the mailbox owner."""
    email = await _load_email(session, email_id)

    # Live threading headers from Gmail (RFC Message-ID / References chain).
    try:
        hdrs = await asyncio.to_thread(_gmail.get_headers, email.provider_message_id)
    except Exception as exc:  # noqa: BLE001
        log.warning("reply: could not fetch headers for %s: %s", email_id, exc)
        hdrs = {}

    to = payload.to or [email.from_address]
    cc = payload.cc or []
    if payload.reply_all and payload.cc is None:
        pool = list(email.to_addresses or []) + list(email.cc_addresses or [])
        cc = _dedup_keep_order(pool, exclude={_self_addr(), (email.from_address or "").lower()})

    subject = payload.subject or _re_subject("Re:", email.subject)

    try:
        result = await asyncio.to_thread(
            _gmail.send_message,
            to=to,
            cc=cc or None,
            subject=subject,
            body_text=payload.body,
            thread_id=email.thread_id,
            in_reply_to=hdrs.get("message_id") or None,
            references=hdrs.get("references") or None,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Send failed: {exc}")

    if not email.is_read:
        email.is_read = True
    await _persist_sent(
        session, result=result, to=to, cc=cc, subject=subject,
        body=payload.body, thread_id=email.thread_id,
    )
    await session.flush()
    return {"sent": True, "to": to, "cc": cc, "subject": subject, **result}


@router.post("/inbox/emails/{email_id}/forward")
async def forward_email(
    email_id: str, payload: ForwardIn, session: AsyncSession = Depends(get_session)
) -> dict:
    """Forward an email (quoted original + optional re-attached files)."""
    email = await _load_email(session, email_id)
    if not payload.to:
        raise HTTPException(status_code=422, detail="Forward requires at least one recipient")

    subject = payload.subject or _re_subject("Fwd:", email.subject)
    quoted = (
        f"{payload.body}\n\n"
        "---------- Forwarded message ----------\n"
        f"From: {email.from_name or ''} <{email.from_address}>\n"
        f"Date: {email.received_at or ''}\n"
        f"Subject: {email.subject or ''}\n"
        f"To: {', '.join(email.to_addresses or [])}\n\n"
        f"{email.body_text or email.snippet or ''}"
    )

    attachments: list[dict] = []
    if payload.include_attachments and email.attachments:
        for att in email.attachments:
            att_id = att.get("attachmentId")
            if not att_id:
                continue
            try:
                data = await asyncio.to_thread(
                    _gmail.get_attachment_bytes, email.provider_message_id, att_id
                )
                attachments.append(
                    {
                        "filename": att.get("filename") or "attachment",
                        "mime_type": att.get("mimeType") or "application/octet-stream",
                        "data": data,
                    }
                )
            except Exception as exc:  # noqa: BLE001
                log.warning("forward: attachment %s failed: %s", att_id, exc)

    try:
        result = await asyncio.to_thread(
            _gmail.send_message,
            to=payload.to,
            cc=payload.cc or None,
            subject=subject,
            body_text=quoted,
            attachments=attachments or None,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Send failed: {exc}")
    await _persist_sent(
        session, result=result, to=payload.to, cc=payload.cc,
        subject=subject, body=quoted, thread_id=result.get("threadId"),
    )
    return {"sent": True, "to": payload.to, "subject": subject, "attachments": len(attachments), **result}


@router.post("/inbox/compose")
async def compose_email(
    payload: ComposeIn, session: AsyncSession = Depends(get_session)
) -> dict:
    """Send a brand-new email."""
    if not payload.to:
        raise HTTPException(status_code=422, detail="Compose requires at least one recipient")
    sender = _gmail
    if payload.from_account_id:
        from backend.models.entities import EmailAccount
        from backend.services.email.account_connectors import build_connector
        acct = await session.get(EmailAccount, payload.from_account_id)
        if not acct or acct.deleted_at or acct.status != "connected":
            raise HTTPException(status_code=422, detail="Selected sender account is not connected")
        sender = build_connector(acct)
    try:
        result = await asyncio.to_thread(
            sender.send_message,
            to=payload.to,
            cc=payload.cc or None,
            bcc=payload.bcc or None,
            subject=payload.subject,
            body_text=payload.body,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Send failed: {exc}")
    await _persist_sent(
        session, result=result, to=payload.to, cc=payload.cc,
        subject=payload.subject, body=payload.body,
    )
    return {"sent": True, "to": payload.to, "subject": payload.subject, **result}
