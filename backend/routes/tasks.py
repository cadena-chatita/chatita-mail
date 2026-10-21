"""
Chatita Mail v3.0 — Phase 2: Tasks & Commitments routes.

Surfaces AION-extracted actionable items so the user can act in <=5 min/day:
  GET   /api/tasks                    -> tasks (filter by status; order=value|deadline|created; offset)
  GET   /api/tasks/counts             -> counts per view (pending, overdue, today, week, no_date...)
  GET   /api/commitments              -> open commitments
  POST  /api/inbox/emails/{id}/extract-> (re)run extraction for one email
  PATCH /api/tasks/{id}               -> update task status (done|dismissed|pending)
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.models.db import get_session
from backend.models.entities import Commitment, Email, Task
from backend.models.schemas import CommitmentOut, TaskCountsOut, TaskOut, TaskStatusIn
from backend.services.workflow import Composer, StyleLearningEngine, TaskExtractor
from backend.services.workflow.composer import detect_language
from backend.services.workflow.task_lifecycle import set_status
from pydantic import BaseModel

router = APIRouter(prefix="/api", tags=["workflow"])

_extractor = TaskExtractor()
_composer = Composer()
_style = StyleLearningEngine()


def _email_lang(email) -> str:
    """Detected language of an email (subject + body), shared by draft routes."""
    text = f"{email.subject or ''}\n{email.body_text or email.snippet or ''}"
    return detect_language(text)


class DraftReplyIn(BaseModel):
    tone: str = "professional"
    instructions: str | None = None


_PRIORITY_RANK = case(
    (Task.priority == "critical", 0),
    (Task.priority == "high", 1),
    (Task.priority == "medium", 2),
    (Task.priority == "low", 3),
    else_=2,
)


@router.get("/tasks", response_model=list[TaskOut])
async def list_tasks(
    status: str | None = Query(None, description="pending | done | dismissed"),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    order: str = Query("deadline", pattern="^(deadline|value|created)$"),
    session: AsyncSession = Depends(get_session),
) -> list[TaskOut]:
    if order == "value":
        # priority first, then the soonest deadline (undated last), then newest
        ordering = (_PRIORITY_RANK.asc(), Task.deadline.asc().nullslast(), Task.created_at.desc())
    elif order == "created":
        ordering = (Task.created_at.desc(),)
    else:
        ordering = (Task.deadline.asc().nullslast(), Task.created_at.desc())
    stmt = select(Task).order_by(*ordering).limit(limit).offset(offset)
    if status:
        stmt = stmt.where(Task.status == status)
    rows = (await session.scalars(stmt)).all()
    return [TaskOut.model_validate(t) for t in rows]


@router.get("/tasks/counts", response_model=TaskCountsOut)
async def task_counts(session: AsyncSession = Depends(get_session)) -> TaskCountsOut:
    now = datetime.now(timezone.utc)
    end_today = now.replace(hour=23, minute=59, second=59, microsecond=0)
    end_week = now + timedelta(days=7)
    pend = Task.status == "pending"
    row = (
        await session.execute(
            select(
                func.count().filter(pend),
                func.count().filter(Task.status == "done"),
                func.count().filter(Task.status == "dismissed"),
                func.count().filter(pend, Task.deadline < now),
                func.count().filter(pend, Task.deadline >= now, Task.deadline <= end_today),
                func.count().filter(pend, Task.deadline > end_today, Task.deadline <= end_week),
                func.count().filter(pend, Task.deadline.is_(None)),
            )
        )
    ).one()
    return TaskCountsOut(
        pending=row[0], done=row[1], dismissed=row[2], overdue=row[3], today=row[4], week=row[5], no_date=row[6]
    )


@router.get("/commitments", response_model=list[CommitmentOut])
async def list_commitments(
    status: str | None = Query(None),
    limit: int = Query(100, le=500),
    session: AsyncSession = Depends(get_session),
) -> list[CommitmentOut]:
    stmt = select(Commitment).order_by(
        Commitment.deadline.asc().nullslast(), Commitment.created_at.desc()
    ).limit(limit)
    if status:
        stmt = stmt.where(Commitment.status == status)
    rows = (await session.scalars(stmt)).all()
    return [CommitmentOut.model_validate(c) for c in rows]


@router.get("/inbox/emails/{email_id}/tasks")
async def email_tasks(
    email_id: str, session: AsyncSession = Depends(get_session)
) -> dict:
    tasks = (
        await session.scalars(select(Task).where(Task.email_id == email_id))
    ).all()
    commits = (
        await session.scalars(select(Commitment).where(Commitment.email_id == email_id))
    ).all()
    return {
        "tasks": [TaskOut.model_validate(t).model_dump() for t in tasks],
        "commitments": [CommitmentOut.model_validate(c).model_dump() for c in commits],
    }


@router.post("/inbox/emails/{email_id}/extract")
async def extract_email(
    email_id: str, session: AsyncSession = Depends(get_session)
) -> dict:
    """(Re)run task/commitment extraction for a single email."""
    email = await session.scalar(select(Email).where(Email.id == email_id))
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    result = await _extractor.extract_and_persist(session, email, replace=True, force=True)
    return {
        "email_id": email_id,
        "source": result.source,
        "tasks_extracted": len(result.tasks),
        "tasks_filtered_out": len(result.dropped),
        "commitments_extracted": len(result.commitments),
        "tasks": result.tasks,
        "commitments": result.commitments,
    }


@router.patch("/tasks/{task_id}", response_model=TaskOut)
async def update_task(
    task_id: str, payload: TaskStatusIn, session: AsyncSession = Depends(get_session)
) -> TaskOut:
    task = await session.scalar(select(Task).where(Task.id == task_id))
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await set_status(session, task, payload.status, via="user")
    return TaskOut.model_validate(task)


@router.patch("/commitments/{commitment_id}", response_model=CommitmentOut)
async def update_commitment(
    commitment_id: str, payload: TaskStatusIn, session: AsyncSession = Depends(get_session)
) -> CommitmentOut:
    c = await session.scalar(select(Commitment).where(Commitment.id == commitment_id))
    if not c:
        raise HTTPException(status_code=404, detail="Commitment not found")
    c.status = payload.status
    await session.flush()
    return CommitmentOut.model_validate(c)


# ── Phase 2: Composer (AION Brain) ──────────────────────────
async def _load_email(session: AsyncSession, email_id: str) -> Email:
    email = await session.scalar(select(Email).where(Email.id == email_id))
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    return email


@router.post("/inbox/emails/{email_id}/summarize")
async def summarize_email(
    email_id: str, session: AsyncSession = Depends(get_session)
) -> dict:
    """AI TL;DR + key points + suggested action for one email."""
    email = await _load_email(session, email_id)
    r = await _composer.summarize_email(email)
    return {
        "email_id": email_id,
        "tldr": r.tldr,
        "key_points": r.key_points,
        "suggested_action": r.suggested_action,
        "requires_reply": r.requires_reply,
        "source": r.source,
    }


@router.post("/inbox/emails/{email_id}/draft-reply")
async def draft_reply(
    email_id: str,
    payload: DraftReplyIn | None = None,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Generate an editable reply draft in Manny's learned voice."""
    email = await _load_email(session, email_id)
    payload = payload or DraftReplyIn()
    # Personalize with the learned style profile if one exists (Phase 3 / T3.1),
    # adapting language-bound cues to the email's detected language (T3.5).
    sp = await _style.get_profile(session)
    directive = _style.directive(sp.profile, target_lang=_email_lang(email)) if sp else None
    r = await _composer.draft_reply(
        email,
        tone=payload.tone,
        instructions=payload.instructions,
        style_directive=directive,
    )
    return {
        "email_id": email_id,
        "subject": r.subject,
        "body": r.body,
        "tone": r.tone,
        "source": r.source,
        "language": r.language,
        "style_applied": bool(directive),
        "style_samples": sp.sample_size if sp else 0,
    }


@router.post("/inbox/emails/{email_id}/draft-variants")
async def draft_variants(
    email_id: str, session: AsyncSession = Depends(get_session)
) -> dict:
    """T3.2 — three styled reply options (Natural/Profesional/Breve) + XAI 'why'."""
    email = await _load_email(session, email_id)
    sp = await _style.get_profile(session)
    directive = _style.directive(sp.profile, target_lang=_email_lang(email)) if sp else None
    result = await _composer.draft_variants(email, style_directive=directive)
    return {
        "email_id": email_id,
        **result,
        "style_applied": bool(directive),
        "style_samples": sp.sample_size if sp else 0,
    }


# ── Phase 3 (T3.1): Style learning ──────────────────────────
@router.post("/inbox/style/learn")
async def learn_style(
    limit: int = Query(100, ge=1, le=500),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Analyze SENT emails and (re)build Manny's writing-style profile."""
    row = await _style.learn(session, limit=limit)
    return {
        "user_key": row.user_key,
        "sample_size": row.sample_size,
        "profile": row.profile,
    }


class StyleFeedbackIn(BaseModel):
    final_body: str
    ai_body: str | None = None
    style: str | None = None
    email_id: str | None = None


@router.post("/inbox/style/feedback")
async def style_feedback(
    payload: StyleFeedbackIn, session: AsyncSession = Depends(get_session)
) -> dict:
    """T3.3 — record how Manny edited an AI draft before sending; adapt profile."""
    return await _style.record_feedback(
        session,
        final_body=payload.final_body,
        ai_body=payload.ai_body,
        style=payload.style,
        email_id=payload.email_id,
    )


@router.get("/inbox/style/metrics")
async def style_metrics(session: AsyncSession = Depends(get_session)) -> dict:
    """T3.3/T3.4 — acceptance metrics (trust score inputs)."""
    return await _style.edit_rate(session)


# ── Phase 4 (T4.2): Google Drive attachment suggestions ─────
@router.get("/inbox/drive/search")
async def drive_search(
    q: str = Query("", description="Full-text query"),
    limit: int = Query(8, ge=1, le=25),
) -> dict:
    """T4.2 — suggest Drive files to attach (read-only). Runs off the event loop."""
    import asyncio

    from backend.services.email.drive_connector import DriveConnector

    conn = DriveConnector()
    if not conn.enabled():
        return {"enabled": False, "files": []}
    try:
        files = await asyncio.to_thread(conn.search, q, limit)
        return {"enabled": True, "files": files}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Drive error: {str(exc)[:200]}") from exc


# ── Phase 2 (T2.2 / T2.4): Google Calendar ──────────────────
class CalendarEventIn(BaseModel):
    summary: str
    start: str  # ISO-8601
    end: str | None = None
    duration_min: int = 60
    description: str | None = None
    attendees: list[str] = []
    send_invites: bool = False  # human-in-the-loop: only email invites when True


@router.get("/inbox/calendar/slots")
async def calendar_slots(
    duration: int = Query(60, ge=15, le=480),
    days: int = Query(10, ge=1, le=30),
    max_slots: int = Query(5, ge=1, le=10),
) -> dict:
    """T2.4 — propose free meeting slots (read-only) from the primary calendar."""
    import asyncio

    from backend.services.email.calendar_connector import CalendarConnector

    conn = CalendarConnector()
    if not conn.enabled():
        return {"enabled": False, "slots": []}
    try:
        slots = await asyncio.to_thread(conn.find_free_slots, duration, days, max_slots)
        return {"enabled": True, "slots": slots}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Calendar error: {str(exc)[:200]}") from exc


@router.post("/inbox/calendar/events")
async def calendar_create_event(payload: CalendarEventIn) -> dict:
    """T2.2/T2.4 — create a calendar event (called only after user confirmation)."""
    import asyncio

    from backend.services.email.calendar_connector import CalendarConnector

    conn = CalendarConnector()
    if not conn.enabled():
        raise HTTPException(status_code=503, detail="Calendar not configured")
    try:
        ev = await asyncio.to_thread(
            conn.create_event,
            summary=payload.summary,
            start_iso=payload.start,
            end_iso=payload.end,
            duration_min=payload.duration_min,
            description=payload.description,
            attendees=payload.attendees,
            send_updates="all" if payload.send_invites else "none",
        )
        return {"created": True, "event": ev}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Calendar error: {str(exc)[:200]}") from exc


@router.post("/inbox/emails/{email_id}/meeting/detect")
async def detect_meeting(
    email_id: str, session: AsyncSession = Depends(get_session)
) -> dict:
    """T2.4 — detect if an email requests a meeting; if so, propose free slots."""
    import asyncio

    from backend.services.email.calendar_connector import CalendarConnector

    email = await session.get(Email, email_id)
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")

    body = (email.body_text or email.snippet or "")[:3000]
    prompt = (
        "Analyze if this email is REQUESTING a meeting/call. Return ONLY minified JSON: "
        '{"is_meeting_request":true|false,"topic":"...","duration_minutes":30|60|...,'
        '"attendees":["email"],"urgency":"low|medium|high"}. '
        "If it is not a meeting request, set is_meeting_request=false.\n\n"
        f"FROM: {email.from_name or ''} <{email.from_address}>\n"
        f"SUBJECT: {email.subject or ''}\nBODY:\n{body}"
    )
    detected: dict = {"is_meeting_request": False}
    try:
        resp = await _extractor.aion.orchestrate(prompt, task_type="simple", priority="P2")
        text = (resp or {}).get("text") or ""
        parsed = _extractor._parse_json(text) if text else None
        if parsed:
            detected = parsed
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"AION error: {str(exc)[:160]}") from exc

    slots: list[dict] = []
    if detected.get("is_meeting_request"):
        conn = CalendarConnector()
        if conn.enabled():
            dur = int(detected.get("duration_minutes") or 60)
            try:
                slots = await asyncio.to_thread(conn.find_free_slots, dur, 10, 5)
            except Exception:  # noqa: BLE001
                slots = []
    # Default attendee = the sender, so the UI can pre-fill the invite.
    attendees = detected.get("attendees") or [email.from_address]
    return {
        "is_meeting_request": bool(detected.get("is_meeting_request")),
        "topic": detected.get("topic") or (email.subject or "Reunión"),
        "duration_minutes": int(detected.get("duration_minutes") or 60),
        "attendees": [a for a in attendees if a],
        "urgency": detected.get("urgency"),
        "slots": slots,
    }


# ── Phase 2 (T2.3): overdue commitments + follow-up drafts ───
@router.get("/inbox/commitments/overdue")
async def overdue_commitments(
    limit: int = Query(50, le=200), session: AsyncSession = Depends(get_session)
) -> dict:
    """T2.3 — commitments past their deadline still pending (need a follow-up)."""
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    stmt = (
        select(Commitment)
        .where(Commitment.status == "pending")
        .where(Commitment.deadline.isnot(None))
        .where(Commitment.deadline < now)
        .order_by(Commitment.deadline.asc())
        .limit(limit)
    )
    rows = (await session.scalars(stmt)).all()
    return {
        "count": len(rows),
        "commitments": [
            {
                "id": c.id,
                "who": c.who,
                "what": c.what,
                "deadline": c.deadline.isoformat() if c.deadline else None,
                "email_id": c.email_id,
            }
            for c in rows
        ],
    }


@router.post("/inbox/commitments/{commitment_id}/followup-draft")
async def followup_draft(
    commitment_id: str, session: AsyncSession = Depends(get_session)
) -> dict:
    """T2.3 — generate a polite follow-up draft for an overdue commitment (user sends)."""
    c = await session.get(Commitment, commitment_id)
    if not c:
        raise HTTPException(status_code=404, detail="Commitment not found")
    email = await session.get(Email, c.email_id)
    lang = _email_lang(email) if email else "es"
    subject = f"Re: {email.subject}" if email and email.subject else "Seguimiento"
    prompt = (
        f"Write a short, polite follow-up email (in {'Spanish' if lang=='es' else 'English'}) "
        f"about this pending commitment: \"{c.what}\" (responsible: {c.who}, "
        f"deadline was {c.deadline.date().isoformat() if c.deadline else 'unspecified'}). "
        "Be courteous and concise (3-4 sentences). Return ONLY the email body text."
    )
    try:
        resp = await _extractor.aion.orchestrate(prompt, task_type="medium", priority="P2")
        text = (resp or {}).get("text") or ""
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"AION error: {str(exc)[:160]}") from exc
    if not text.strip():
        raise HTTPException(status_code=502, detail="AION returned empty draft")
    return {
        "commitment_id": c.id,
        "email_id": c.email_id,
        "to": email.from_address if email else None,
        "subject": subject,
        "body": text.strip(),
        "language": lang,
    }


# ── Phase 2 (T2.6): generate a Drive doc draft from an email ─
class DocDraftIn(BaseModel):
    instructions: str | None = None


class DocCreateIn(BaseModel):
    title: str
    content: str


@router.post("/inbox/emails/{email_id}/doc-draft")
async def doc_draft(
    email_id: str, payload: DocDraftIn, session: AsyncSession = Depends(get_session)
) -> dict:
    """T2.6 — AION generates a document draft from the email (no side effect yet)."""
    email = await session.get(Email, email_id)
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    lang = _email_lang(email)
    body = (email.body_text or email.snippet or "")[:3000]
    extra = f"\nExtra instructions: {payload.instructions}" if payload.instructions else ""
    prompt = (
        f"Draft a well-structured document (in {'Spanish' if lang=='es' else 'English'}) "
        f"based on this email. Use clear headings and bullet points where useful.{extra}\n\n"
        f"SUBJECT: {email.subject or ''}\nFROM: {email.from_address}\nBODY:\n{body}\n\n"
        "Return ONLY the document text (no preamble)."
    )
    try:
        resp = await _extractor.aion.orchestrate(prompt, task_type="complex", priority="P2")
        text = (resp or {}).get("text") or ""
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"AION error: {str(exc)[:160]}") from exc
    if not text.strip():
        raise HTTPException(status_code=502, detail="AION returned empty draft")
    title = (email.subject or "Documento").strip()[:200]
    return {"title": title, "content": text.strip(), "language": lang}


@router.post("/inbox/drive/doc")
async def create_drive_doc(payload: DocCreateIn) -> dict:
    """T2.6 — create the Google Doc in Drive (called after user confirms the draft)."""
    import asyncio

    from backend.services.email.drive_connector import DriveConnector

    conn = DriveConnector()
    if not conn.enabled():
        raise HTTPException(status_code=503, detail="Drive not configured")
    try:
        doc = await asyncio.to_thread(conn.create_doc, payload.title, payload.content)
        return {"created": True, "doc": doc}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Drive error: {str(exc)[:200]}") from exc


# ── Phase 4 (T4.1): Voice replies via ElevenLabs TTS ────────
class TTSIn(BaseModel):
    text: str
    voice_id: str | None = None


@router.get("/voice/health")
async def voice_health() -> dict:
    """Report whether the voice (TTS) feature is configured."""
    return {
        "enabled": bool(settings.elevenlabs_api_key and settings.elevenlabs_voice_id),
        "voice_id": settings.elevenlabs_voice_id or None,
        "model": settings.elevenlabs_model_id,
    }


@router.post("/voice/tts")
async def voice_tts(payload: TTSIn) -> Response:
    """T4.1 — synthesize reply text to speech (returns audio/mpeg)."""
    if not (settings.elevenlabs_api_key and settings.elevenlabs_voice_id):
        raise HTTPException(status_code=503, detail="Voice not configured")
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")
    text = text[:5000]  # ElevenLabs per-request cap
    voice_id = payload.voice_id or settings.elevenlabs_voice_id
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    body = {
        "text": text,
        "model_id": settings.elevenlabs_model_id,
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
    }
    headers = {
        "xi-api-key": settings.elevenlabs_api_key,
        "accept": "audio/mpeg",
        "content-type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(url, json=body, headers=headers)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"TTS upstream error: {exc}") from exc
    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"ElevenLabs {resp.status_code}: {resp.text[:200]}",
        )
    return Response(
        content=resp.content,
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/inbox/style")
async def get_style(session: AsyncSession = Depends(get_session)) -> dict:
    """Return the current learned style profile (or an empty shell if none)."""
    row = await _style.get_profile(session)
    if row is None:
        return {"user_key": _style.default_user_key(), "sample_size": 0, "profile": None}
    return {
        "user_key": row.user_key,
        "sample_size": row.sample_size,
        "profile": row.profile,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }
