"""
Chatita Mail v3.0 - Inbox routes.

Endpoints to ingest, list, and read emails.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.config import settings
from backend.models.db import AsyncSessionLocal, get_session
from backend.models.entities import (
    AccountProvider,
    Classification,
    Commitment,
    Email,
    EmailAccount,
    EmailCategory,
    EmailStatus,
    Task,
)
from backend.models.schemas import (
    CommitmentOut,
    EmailIn,
    EmailOut,
    InboxStats,
    ReadUpdateIn,
    SemanticHit,
    StatusUpdateIn,
    TaskOut,
)
from backend.services.embeddings import (
    build_email_text,
    embedder,
)
from backend.services.email.gmail_connector import GmailConnector
from backend.services.email.icloud_connector import ICloudConnector
from backend.services.email.sync import (
    GmailSyncService,
    ICloudSyncService,
)
from backend.services.triage import TriageService
from backend.services.unsubscribe import Unsubscriber

router = APIRouter(prefix="/api/inbox", tags=["inbox"])

_gmail_sync = GmailSyncService()
_icloud_sync = ICloudSyncService()
_triage = TriageService()
_unsubscriber = Unsubscriber()

# Minutes of manual triage saved per auto-handled email (archived/blocked/quarantined).
_MINUTES_SAVED_PER_EMAIL = 1.5


async def _get_or_create_account(session: AsyncSession, email_address: str) -> EmailAccount:
    account = await session.scalar(
        select(EmailAccount).where(EmailAccount.email_address == email_address)
    )
    if account:
        return account
    account = EmailAccount(
        provider=AccountProvider.IMAP,
        email_address=email_address,
        display_name=email_address,
    )
    session.add(account)
    await session.flush()
    return account


@router.post("/ingest", response_model=EmailOut, status_code=201)
async def ingest_email(
    payload: EmailIn,
    account_email: str = Query(..., description="Owner mailbox address"),
    session: AsyncSession = Depends(get_session),
) -> EmailOut:
    """Ingest a single email into the unified store (idempotent by provider id)."""
    account = await _get_or_create_account(session, account_email)

    existing = await session.scalar(
        select(Email).where(
            Email.account_id == account.id,
            Email.provider_message_id == payload.provider_message_id,
        )
    )
    if existing:
        return EmailOut.model_validate(existing)

    email = Email(
        account_id=account.id,
        provider_message_id=payload.provider_message_id,
        thread_id=payload.thread_id,
        from_address=payload.from_address,
        from_name=payload.from_name,
        to_addresses=payload.to_addresses,
        cc_addresses=payload.cc_addresses,
        subject=payload.subject,
        body_text=payload.body_text,
        body_html=payload.body_html,
        snippet=payload.snippet or (payload.body_text or "")[:200],
        attachments=payload.attachments,
        received_at=payload.received_at,
    )
    session.add(email)
    await session.flush()
    return EmailOut.model_validate(email)


# Importance rank for smart sorting: lower = shown first. Emails with no
# classification yet (or UNCLASSIFIED) rank between LOW and SPAM so they never
# hide genuinely important mail nor pollute the top with noise.
_CATEGORY_RANK = case(
    (Classification.category == EmailCategory.CRITICAL, 0),
    (Classification.category == EmailCategory.IMPORTANT, 1),
    (Classification.category == EmailCategory.MEDIUM, 2),
    (Classification.category == EmailCategory.LOW, 3),
    (Classification.category == EmailCategory.SPAM, 5),
    (Classification.category == EmailCategory.NOISE, 6),
    else_=4,
)


@router.get("/emails", response_model=list[EmailOut])
async def list_emails(
    status: EmailStatus | None = Query(None),
    category: EmailCategory | None = Query(None),
    unread_only: bool = Query(False),
    search: str | None = Query(None, description="Match subject/sender/snippet"),
    account: str | None = Query(
        None, description="Filter by mailbox address (e.g. manuelcadena@mac.com)"
    ),
    sort: str = Query("priority", pattern="^(priority|date)$", description="priority: importance then recency; date: recency only"),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> list[EmailOut]:
    """List emails with optional filters.

    sort='priority' (default): CRITICAL → IMPORTANT → MEDIUM → LOW → (unclassified)
    → SPAM → NOISE, newest-first within each level.
    sort='date': strictly newest-first regardless of importance.
    """
    stmt = select(Email).options(
        selectinload(Email.classification), selectinload(Email.security_event)
    )
    # A classification join is needed to filter by category AND to sort by
    # importance. Use an OUTER join so emails without a classification row still
    # appear (critical for the default priority view over the full inbox).
    if category is not None or sort == "priority":
        stmt = stmt.outerjoin(Classification, Classification.email_id == Email.id)

    if status:
        stmt = stmt.where(Email.status == status)
    if unread_only:
        stmt = stmt.where(Email.is_read.is_(False))
    if account:
        stmt = stmt.join(EmailAccount, EmailAccount.id == Email.account_id).where(
            EmailAccount.email_address.ilike(f"%{account.strip()}%")
        )
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                Email.subject.ilike(like),
                Email.from_address.ilike(like),
                Email.from_name.ilike(like),
                Email.snippet.ilike(like),
            )
        )
    if category:
        stmt = stmt.where(Classification.category == category)

    if sort == "priority":
        stmt = stmt.order_by(
            _CATEGORY_RANK.asc(),
            Email.received_at.desc().nullslast(),
            Email.created_at.desc(),
        )
    else:
        stmt = stmt.order_by(Email.received_at.desc().nullslast(), Email.created_at.desc())

    stmt = stmt.limit(limit).offset(offset)
    emails = list((await session.scalars(stmt)).all())

    out: list[EmailOut] = []
    for e in emails:
        item = EmailOut.model_validate(e)
        item.has_html = bool(e.body_html)
        item.has_attachments = bool(e.attachments)
        if e.classification:
            item.category = e.classification.category
            item.confidence = e.classification.confidence
            item.is_newsletter = e.classification.is_newsletter
            item.unsubscribe_url = e.classification.unsubscribe_url
        if e.security_event:
            item.risk_level = e.security_event.risk_level
            item.risk_score = e.security_event.risk_score
        out.append(item)
    return out


async def _hydrate_hits(
    session: AsyncSession,
    id_to_sim: dict[str, float],
    status: EmailStatus | None,
    limit: int,
) -> list[SemanticHit]:
    """Load emails by id, attach classification/security + similarity, sort desc."""
    if not id_to_sim:
        return []
    stmt = (
        select(Email)
        .options(selectinload(Email.classification), selectinload(Email.security_event))
        .where(Email.id.in_(list(id_to_sim.keys())))
    )
    if status:
        stmt = stmt.where(Email.status == status)
    emails = list((await session.scalars(stmt)).all())
    hits: list[SemanticHit] = []
    for e in emails:
        item = SemanticHit.model_validate(e)
        item.has_html = bool(e.body_html)
        item.has_attachments = bool(e.attachments)
        if e.classification:
            item.category = e.classification.category
            item.confidence = e.classification.confidence
            item.is_newsletter = e.classification.is_newsletter
            item.unsubscribe_url = e.classification.unsubscribe_url
        if e.security_event:
            item.risk_level = e.security_event.risk_level
            item.risk_score = e.security_event.risk_score
        item.similarity = round(id_to_sim.get(e.id, 0.0), 4)
        hits.append(item)
    hits.sort(key=lambda h: h.similarity, reverse=True)
    return hits[:limit]


async def _keyword_matches(
    session: AsyncSession, query: str, status: EmailStatus | None, limit: int
) -> list[str]:
    terms = [term for term in query.split() if len(term) >= 3][:6]
    if not terms:
        return []
    stmt = select(Email.id)
    for term in terms:
        like = f"%{term}%"
        stmt = stmt.where(
            or_(
                Email.subject.ilike(like),
                Email.from_address.ilike(like),
                Email.from_name.ilike(like),
                Email.snippet.ilike(like),
                Email.body_text.ilike(like),
            )
        )
    if status is not None:
        stmt = stmt.where(Email.status == status)
    stmt = stmt.order_by(Email.received_at.desc().nullslast()).limit(limit)
    return [str(email_id) for email_id in (await session.scalars(stmt)).all()]


@router.get("/search/semantic", response_model=list[SemanticHit])
async def semantic_search(
    q: str = Query(..., min_length=2, description="Natural-language query"),
    status: str | None = Query("INBOX", description="Status filter; empty or 'ALL' = search everywhere"),
    limit: int = Query(25, le=100),
    session: AsyncSession = Depends(get_session),
) -> list[SemanticHit]:
    """Search emails by meaning (BGE-M3 embeddings + pgvector cosine)."""
    # Parse the optional status filter (empty string or 'ALL' -> no filter).
    status_filter: EmailStatus | None = None
    if status and status.upper() != "ALL":
        try:
            status_filter = EmailStatus(status)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid status: {status}")
    try:
        qvec = await embedder.embed_text(q)
    except Exception:
        keyword_ids = await _keyword_matches(session, q, status_filter, limit)
        return await _hydrate_hits(
            session,
            {email_id: 0.999 - rank / 1000 for rank, email_id in enumerate(keyword_ids)},
            status_filter,
            limit,
        )
    # Overfetch (status filter is applied after the vector search) then trim.
    hits = await embedder.semantic_search(session, qvec, limit=limit * 3)
    keyword_ids = await _keyword_matches(session, q, status_filter, limit)
    combined = dict(hits)
    for rank, email_id in enumerate(keyword_ids):
        combined[email_id] = 0.999 - rank / 1000
    return await _hydrate_hits(session, combined, status_filter, limit)


@router.get("/emails/{email_id}/similar", response_model=list[SemanticHit])
async def similar_emails(
    email_id: str,
    limit: int = Query(10, le=50),
    session: AsyncSession = Depends(get_session),
) -> list[SemanticHit]:
    """Find emails semantically similar to a given one."""
    vec = await embedder.get_email_vector(session, email_id)
    if vec is None:
        email = await session.get(Email, email_id)
        if email is None:
            raise HTTPException(status_code=404, detail="Email not found")
        try:
            vec = await embedder.embed_text(
                build_email_text(email.subject, email.body_text, email.snippet)
            )
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=502, detail=f"Embedding provider error: {exc}")
    hits = await embedder.semantic_search(
        session, vec, limit=limit, exclude_email_id=email_id
    )
    return await _hydrate_hits(session, dict(hits), None, limit)


@router.get("/stats", response_model=InboxStats)
async def inbox_stats(session: AsyncSession = Depends(get_session)) -> InboxStats:
    """Aggregate counts powering the sidebar (folders, categories, workload)."""
    total = await session.scalar(select(func.count(Email.id))) or 0
    unread = (
        await session.scalar(
            select(func.count(Email.id)).where(
                Email.is_read.is_(False), Email.status == EmailStatus.INBOX
            )
        )
        or 0
    )

    by_status: dict[str, int] = {}
    for st, cnt in (
        await session.execute(select(Email.status, func.count(Email.id)).group_by(Email.status))
    ).all():
        by_status[st.value if hasattr(st, "value") else str(st)] = cnt

    by_category: dict[str, int] = {}
    for cat, cnt in (
        await session.execute(
            select(Classification.category, func.count(Classification.id)).group_by(
                Classification.category
            )
        )
    ).all():
        by_category[cat.value if hasattr(cat, "value") else str(cat)] = cnt

    open_tasks = (
        await session.scalar(select(func.count(Task.id)).where(Task.status == "pending")) or 0
    )
    open_commitments = (
        await session.scalar(
            select(func.count(Commitment.id)).where(Commitment.status == "pending")
        )
        or 0
    )

    auto_handled = sum(
        by_status.get(s, 0)
        for s in ("ARCHIVED", "BLOCKED", "QUARANTINED")
    )
    time_saved = int(auto_handled * _MINUTES_SAVED_PER_EMAIL)

    return InboxStats(
        total=total,
        unread=unread,
        by_status=by_status,
        by_category=by_category,
        open_tasks=open_tasks,
        open_commitments=open_commitments,
        time_saved_minutes=time_saved,
    )


@router.get("/analytics")
async def inbox_analytics(
    days: int = Query(14, ge=1, le=90),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Dashboard metrics: time saved, throughput, reply rate, top senders, volume."""
    total = await session.scalar(select(func.count(Email.id))) or 0
    sent = (
        await session.scalar(
            select(func.count(Email.id)).where(Email.status == EmailStatus.SENT)
        )
        or 0
    )
    received = max(total - sent, 0)

    # Auto-handled (noise/quarantine/spam) → minutes saved (mirrors /stats).
    auto_handled = (
        await session.scalar(
            select(func.count(Email.id)).where(
                Email.status.in_(
                    [EmailStatus.ARCHIVED, EmailStatus.BLOCKED, EmailStatus.QUARANTINED]
                )
            )
        )
        or 0
    )
    time_saved_minutes = int(auto_handled * _MINUTES_SAVED_PER_EMAIL)

    # Actionable inbound = Critical + Important (needing a human reply).
    actionable = (
        await session.scalar(
            select(func.count(Classification.id)).where(
                Classification.category.in_(
                    [EmailCategory.CRITICAL, EmailCategory.IMPORTANT]
                )
            )
        )
        or 0
    )
    reply_rate = round(sent / actionable, 3) if actionable else 0.0

    # Top senders (inbound only), by address.
    top_senders = [
        {"sender": addr, "count": cnt}
        for addr, cnt in (
            await session.execute(
                select(Email.from_address, func.count(Email.id))
                .where(Email.status != EmailStatus.SENT)
                .group_by(Email.from_address)
                .order_by(func.count(Email.id).desc())
                .limit(10)
            )
        ).all()
        if addr
    ]

    # Daily inbound volume for the last `days` days.
    since = datetime.now(timezone.utc) - timedelta(days=days)
    day = func.date(Email.received_at)
    volume_by_day = [
        {"date": str(d), "count": cnt}
        for d, cnt in (
            await session.execute(
                select(day, func.count(Email.id))
                .where(Email.received_at >= since, Email.status != EmailStatus.SENT)
                .group_by(day)
                .order_by(day.asc())
            )
        ).all()
        if d is not None
    ]

    return {
        "total": total,
        "received": received,
        "sent": sent,
        "auto_handled": auto_handled,
        "time_saved_minutes": time_saved_minutes,
        "time_saved_hours": round(time_saved_minutes / 60, 1),
        "actionable": actionable,
        "reply_rate": reply_rate,
        "top_senders": top_senders,
        "volume_by_day": volume_by_day,
        "window_days": days,
    }


@router.get("/emails/{email_id}")
async def get_email(
    email_id: str,
    mark_read: bool = Query(True, description="Mark email as read when opened"),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Full email detail including body (HTML+text), recipients, attachments,
    classification + security XAI, and Phase-2 tasks/commitments."""
    email = await session.scalar(
        select(Email)
        .options(selectinload(Email.classification), selectinload(Email.security_event))
        .where(Email.id == email_id)
    )
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")

    if mark_read and not email.is_read:
        email.is_read = True
        await session.flush()

    tasks = (await session.scalars(select(Task).where(Task.email_id == email_id))).all()
    commits = (
        await session.scalars(select(Commitment).where(Commitment.email_id == email_id))
    ).all()

    return {
        "id": email.id,
        "from_address": email.from_address,
        "from_name": email.from_name,
        "to_addresses": email.to_addresses or [],
        "cc_addresses": email.cc_addresses or [],
        "subject": email.subject,
        "body_text": email.body_text,
        "body_html": email.body_html,
        "snippet": email.snippet,
        "attachments": email.attachments or [],
        "status": email.status,
        "is_read": email.is_read,
        "thread_id": email.thread_id,
        "received_at": email.received_at,
        "classification": {
            "category": email.classification.category,
            "confidence": email.classification.confidence,
            "stage": email.classification.stage,
            "reasoning": email.classification.reasoning,
            "is_newsletter": email.classification.is_newsletter,
            "unsubscribe_url": email.classification.unsubscribe_url,
        }
        if email.classification
        else None,
        "security": {
            "risk_score": email.security_event.risk_score,
            "risk_level": email.security_event.risk_level,
            "explanation": email.security_event.explanation,
            "risk_factors": email.security_event.risk_factors,
            "recommended_action": email.security_event.recommended_action,
        }
        if email.security_event
        else None,
        "tasks": [TaskOut.model_validate(t).model_dump() for t in tasks],
        "commitments": [CommitmentOut.model_validate(c).model_dump() for c in commits],
    }


# ── Actions (mutations for the UI toolbar) ──────────────────
@router.patch("/emails/{email_id}/status", response_model=EmailOut)
async def update_status(
    email_id: str, payload: StatusUpdateIn, session: AsyncSession = Depends(get_session)
) -> EmailOut:
    """Move an email between folders (INBOX/ARCHIVED/DELETED/QUARANTINED...)."""
    email = await session.scalar(
        select(Email)
        .options(selectinload(Email.classification), selectinload(Email.security_event))
        .where(Email.id == email_id)
    )
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    email.status = payload.status
    await session.flush()
    return _to_out(email)


@router.patch("/emails/{email_id}/read", response_model=EmailOut)
async def update_read(
    email_id: str, payload: ReadUpdateIn, session: AsyncSession = Depends(get_session)
) -> EmailOut:
    email = await session.scalar(
        select(Email)
        .options(selectinload(Email.classification), selectinload(Email.security_event))
        .where(Email.id == email_id)
    )
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    email.is_read = payload.is_read
    await session.flush()
    return _to_out(email)


@router.post("/emails/{email_id}/unsubscribe")
async def unsubscribe_email(
    email_id: str, session: AsyncSession = Depends(get_session)
) -> dict:
    """Attempt RFC-8058 one-click unsubscribe using the stored unsubscribe URL."""
    email = await session.scalar(
        select(Email).options(selectinload(Email.classification)).where(Email.id == email_id)
    )
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    url = email.classification.unsubscribe_url if email.classification else None
    if not url:
        raise HTTPException(status_code=400, detail="No unsubscribe URL for this email")
    result = await _unsubscriber.unsubscribe(url)
    if result.get("ok"):
        email.status = EmailStatus.ARCHIVED
        await session.flush()
    return result


def _to_out(email: Email) -> EmailOut:
    item = EmailOut.model_validate(email)
    item.has_html = bool(email.body_html)
    item.has_attachments = bool(email.attachments)
    if email.classification:
        item.category = email.classification.category
        item.confidence = email.classification.confidence
        item.is_newsletter = email.classification.is_newsletter
        item.unsubscribe_url = email.classification.unsubscribe_url
    if email.security_event:
        item.risk_level = email.security_event.risk_level
        item.risk_score = email.security_event.risk_score
    return item


@router.get("/gmail/health", tags=["gmail"])
async def gmail_health() -> dict:
    """Verify Gmail service-account delegation works for the configured mailbox."""
    return GmailConnector().health()


@router.post("/sync/gmail", tags=["gmail"])
async def sync_gmail(
    max_results: int = Query(10, le=50, description="How many recent INBOX emails to pull"),
    unread_only: bool = Query(False),
    triage: bool = Query(True, description="Run classification + security + auto-actions"),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """
    Pull recent Gmail emails, persist them, and (optionally) run the full
    triage pipeline. Idempotent by provider_message_id.
    """
    return await _gmail_sync.sync(
        session, max_results=max_results, unread_only=unread_only, run_triage=triage
    )


# ── Robust ingest: full backfill + incremental (historyId) ──


async def _run_full_sync_bg(
    query: str, label_ids: list[str] | None, max_total: int | None, run_triage: bool
) -> None:
    """Background full sync with its own DB session (request session is closed)."""
    async with AsyncSessionLocal() as session:
        try:
            await _gmail_sync.full_sync(
                session,
                query=query,
                label_ids=label_ids,
                max_total=max_total,
                run_triage=run_triage,
            )
        except Exception:  # noqa: BLE001
            await session.rollback()
            raise


@router.post("/sync/gmail/full", tags=["gmail"])
async def sync_gmail_full(
    background: BackgroundTasks,
    scope: str = Query("inbox", pattern="^(inbox|all)$", description="'inbox' or 'all' mail"),
    max_total: int | None = Query(None, ge=1, description="Cap messages (None = every message)"),
    triage: bool = Query(False, description="Run triage during backfill (slow/costly)"),
    wait: bool = Query(False, description="Run synchronously and return the summary"),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """
    Backfill the entire mailbox (paginated, batched, de-duplicated).

    For large mailboxes (e.g. 31k) leave `wait=false` to run in the background
    and poll `/api/inbox/sync/status`. Triage defaults OFF — run `/triage/pending`
    afterwards in bounded batches.
    """
    query = "in:inbox" if scope == "inbox" else None
    label_ids = None if scope == "inbox" else []
    if wait:
        return await _gmail_sync.full_sync(
            session, query=query, label_ids=label_ids,
            max_total=max_total, run_triage=triage,
        )
    background.add_task(_run_full_sync_bg, query, label_ids, max_total, triage)
    return {
        "status": "started",
        "scope": scope,
        "max_total": max_total,
        "triage": triage,
        "poll": "/api/inbox/sync/status",
    }


@router.post("/sync/gmail/incremental", tags=["gmail"])
async def sync_gmail_incremental(
    triage: bool = Query(True, description="Triage newly arrived emails"),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Delta sync via Gmail historyId. Bootstraps anchor on first run."""
    return await _gmail_sync.sync_incremental(session, run_triage=triage)


@router.post("/sync/icloud", tags=["icloud"])
async def sync_icloud(
    max_results: int = Query(50, le=500, description="Max messages to pull this run"),
    triage: bool = Query(True),
    force_full: bool = Query(False, description="Ignore last_sync_at, pull newest N"),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """
    Incremental iCloud IMAP sync (SINCE last_sync_at). Requires
    ICLOUD_USERNAME + ICLOUD_APP_PASSWORD in the environment.
    """
    if not settings.icloud_username or not settings.icloud_app_password:
        raise HTTPException(
            status_code=503,
            detail="iCloud not configured (set ICLOUD_USERNAME + ICLOUD_APP_PASSWORD)",
        )
    return await _icloud_sync.sync(
        session, max_results=max_results, run_triage=triage, force_full=force_full
    )


@router.get("/icloud/health", tags=["icloud"])
async def icloud_health() -> dict:
    """Verify iCloud IMAP connectivity (never raises)."""
    if not settings.icloud_username or not settings.icloud_app_password:
        return {"ok": False, "error": "iCloud not configured", "configured": False}
    return ICloudConnector().health()


@router.get("/sync/status", tags=["sync"])
async def sync_status(session: AsyncSession = Depends(get_session)) -> dict:
    """Per-account sync state + stored/untriaged counts (for backfill monitoring)."""
    accounts = (await session.scalars(select(EmailAccount))).all()
    total = await session.scalar(select(func.count(Email.id))) or 0
    untriaged = (
        await session.scalar(
            select(func.count(Email.id))
            .select_from(Email)
            .outerjoin(Classification, Classification.email_id == Email.id)
            .where(Classification.id.is_(None))
        )
        or 0
    )
    out = []
    for a in accounts:
        acc_total = await session.scalar(
            select(func.count(Email.id)).where(Email.account_id == a.id)
        )
        out.append({
            "provider": a.provider.value,
            "mailbox": a.email_address,
            "sync_status": a.sync_status,
            "last_sync_at": a.last_sync_at.isoformat() if a.last_sync_at else None,
            "last_history_id": a.last_history_id,
            "emails": acc_total or 0,
        })
    return {"total_emails": total, "untriaged": untriaged, "accounts": out}


async def _triage_pending_bg(limit: int) -> None:
    async with AsyncSessionLocal() as session:
        stmt = (
            select(Email)
            .outerjoin(Classification, Classification.email_id == Email.id)
            .where(Classification.id.is_(None))
            .order_by(Email.received_at.desc().nullslast())
            .limit(limit)
        )
        emails = (await session.scalars(stmt)).all()
        for email in emails:
            try:
                await _triage.triage_email(session, email, auto_actions=True)
                await session.commit()
            except Exception:  # noqa: BLE001
                await session.rollback()


@router.post("/triage/pending", tags=["sync"])
async def triage_pending(
    background: BackgroundTasks,
    limit: int = Query(200, ge=1, le=2000, description="Max un-triaged emails to process"),
    wait: bool = Query(False, description="Run synchronously (small batches only)"),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """
    Triage backfilled emails that have no classification yet (newest first).
    Use after a full backfill to classify historical mail in bounded batches.
    """
    if wait:
        stmt = (
            select(Email)
            .outerjoin(Classification, Classification.email_id == Email.id)
            .where(Classification.id.is_(None))
            .order_by(Email.received_at.desc().nullslast())
            .limit(limit)
        )
        emails = (await session.scalars(stmt)).all()
        triaged = 0
        for email in emails:
            try:
                await _triage.triage_email(session, email, auto_actions=True)
                triaged += 1
            except Exception:  # noqa: BLE001
                pass
        return {"triaged": triaged, "requested": len(emails)}
    background.add_task(_triage_pending_bg, limit)
    return {"status": "started", "limit": limit, "poll": "/api/inbox/sync/status"}
