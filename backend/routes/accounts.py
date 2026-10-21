"""Chatita Mail — account management API (settings menu: add / edit / remove mailboxes)."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.models.db import get_session
from backend.models.entities import AccountProvider, Email, EmailAccount, EmailStatus
from backend.services.accounts import crypto, discovery, oauth
from backend.services.email.account_connectors import build_connector
from backend.services.email.account_sync import sync_account

logger = logging.getLogger("chatita_mail.accounts")
router = APIRouter(prefix="/api/accounts", tags=["accounts"])

PALETTE = ["#6366F1", "#10B981", "#F59E0B", "#EF4444", "#06B6D4", "#8B5CF6", "#EC4899", "#84CC16"]
# Known IMAP/SMTP presets for password-based providers.
IMAP_PRESETS = {
    "workmail": {"imap_host": "imap.mail.us-east-1.awsapps.com", "imap_port": 993,
                 "smtp_host": "smtp.mail.us-east-1.awsapps.com", "smtp_port": 587},
    "icloud": {"imap_host": "imap.mail.me.com", "imap_port": 993,
               "smtp_host": "smtp.mail.me.com", "smtp_port": 587},
    "outlook_imap": {"imap_host": "outlook.office365.com", "imap_port": 993,
                     "smtp_host": "smtp.office365.com", "smtp_port": 587},
}


class AccountOut(BaseModel):
    id: str
    provider: str
    email_address: str
    display_name: str | None
    color: str | None
    auth_type: str | None
    status: str
    is_active: bool
    is_default: bool
    last_sync_at: datetime | None
    last_error: str | None
    email_count: int = 0
    unread_count: int = 0
    oauth_ready: bool = False


class AccountCreate(BaseModel):
    email_address: EmailStr
    provider: str = Field(pattern="^(gmail|microsoft|imap|icloud)$")
    display_name: str | None = None
    color: str | None = None
    # password-based (imap/icloud only); never returned by the API
    password: str | None = None
    imap_preset: str | None = None
    imap_host: str | None = None
    imap_port: int | None = None
    smtp_host: str | None = None
    smtp_port: int | None = None


class DiscoverIn(BaseModel):
    email_address: EmailStr


class PasswordConnectIn(BaseModel):
    password: str = Field(min_length=1)
    username: str | None = None
    imap_host: str | None = None
    imap_port: int | None = None
    smtp_host: str | None = None
    smtp_port: int | None = None


class AccountPatch(BaseModel):
    display_name: str | None = None
    color: str | None = Field(default=None, pattern="^#[0-9A-Fa-f]{6}$")
    is_active: bool | None = None
    is_default: bool | None = None
    sort_order: int | None = None


async def _out(session: AsyncSession, a: EmailAccount) -> AccountOut:
    cnt = await session.scalar(select(func.count(Email.id)).where(Email.account_id == a.id)) or 0
    unread = await session.scalar(select(func.count(Email.id)).where(
        Email.account_id == a.id, Email.is_read.is_(False), Email.status == EmailStatus.INBOX)) or 0
    prov = a.provider.value
    return AccountOut(
        id=a.id, provider=prov, email_address=a.email_address, display_name=a.display_name,
        color=a.color, auth_type=a.auth_type,
        status=("disabled" if not a.is_active else (a.status or "connected")),
        is_active=a.is_active, is_default=a.is_default, last_sync_at=a.last_sync_at,
        last_error=a.last_error, email_count=cnt, unread_count=unread,
        oauth_ready=oauth.configured("google" if prov == "gmail" else prov) if prov in ("gmail", "microsoft") else True,
    )


async def _get(session: AsyncSession, account_id: str) -> EmailAccount:
    a = await session.get(EmailAccount, account_id)
    if not a or a.deleted_at:
        raise HTTPException(404, "Account not found")
    return a


@router.get("", response_model=list[AccountOut])
async def list_accounts(session: AsyncSession = Depends(get_session)) -> list[AccountOut]:
    rows = (await session.scalars(
        select(EmailAccount).where(EmailAccount.deleted_at.is_(None))
        .order_by(EmailAccount.sort_order, EmailAccount.created_at))).all()
    return [await _out(session, a) for a in rows]


@router.post("", response_model=AccountOut, status_code=201)
async def create_account(body: AccountCreate, session: AsyncSession = Depends(get_session)) -> AccountOut:
    addr = body.email_address.lower()
    existing = await session.scalar(select(EmailAccount).where(EmailAccount.email_address == addr))
    if existing and not existing.deleted_at:
        raise HTTPException(409, "Account already registered")
    n = await session.scalar(select(func.count(EmailAccount.id)).where(EmailAccount.deleted_at.is_(None))) or 0
    a = existing or EmailAccount(email_address=addr, provider=AccountProvider(body.provider))
    a.provider = AccountProvider(body.provider)
    a.display_name = body.display_name or addr
    a.color = body.color or PALETTE[n % len(PALETTE)]
    a.deleted_at, a.is_active, a.sort_order = None, True, n
    if body.provider in ("gmail", "microsoft"):
        a.auth_type, a.status = "oauth", "pending_auth"
    else:
        preset = IMAP_PRESETS.get(body.imap_preset or ("icloud" if body.provider == "icloud" else ""), {})
        a.imap_host = body.imap_host or preset.get("imap_host")
        a.imap_port = body.imap_port or preset.get("imap_port", 993)
        a.smtp_host = body.smtp_host or preset.get("smtp_host")
        a.smtp_port = body.smtp_port or preset.get("smtp_port", 587)
        a.auth_type = "password"
        if body.password and a.imap_host:
            a.credentials_enc = crypto.encrypt({"username": addr, "password": body.password})
            a.status = "connected"
        else:
            a.status = "pending_auth"
    if not existing:
        session.add(a)
    await session.flush()
    return await _out(session, a)


@router.patch("/{account_id}", response_model=AccountOut)
async def patch_account(account_id: str, body: AccountPatch, session: AsyncSession = Depends(get_session)) -> AccountOut:
    a = await _get(session, account_id)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(a, k, v)
    if body.is_default:
        for o in (await session.scalars(select(EmailAccount).where(EmailAccount.id != a.id))).all():
            o.is_default = False
    await session.flush()
    return await _out(session, a)


@router.delete("/{account_id}")
async def delete_account(account_id: str, purge: bool = Query(False, description="Also delete locally stored mail"),
                         session: AsyncSession = Depends(get_session)) -> dict:
    """Soft-delete: stops sync and wipes credentials. Local mail is kept unless purge=true."""
    a = await _get(session, account_id)
    a.deleted_at, a.is_active, a.status = datetime.now(tz=timezone.utc), False, "disabled"
    a.credentials_enc = None
    removed = 0
    if purge:
        removed = await session.scalar(select(func.count(Email.id)).where(Email.account_id == a.id)) or 0
        await session.delete(a)
    return {"ok": True, "purged_emails": removed}


@router.post("/{account_id}/password")
async def set_password(account_id: str, body: dict, session: AsyncSession = Depends(get_session)) -> dict:
    a = await _get(session, account_id)
    if a.auth_type != "password":
        raise HTTPException(400, "Account does not use password authentication")
    pw = (body or {}).get("password")
    if not pw or not a.imap_host:
        raise HTTPException(400, "password and IMAP host are required")
    a.credentials_enc = crypto.encrypt({"username": a.email_address, "password": pw})
    a.status, a.last_error = "connected", None
    return {"ok": True}


@router.post("/{account_id}/test")
async def test_account(account_id: str, session: AsyncSession = Depends(get_session)) -> dict:
    import asyncio
    a = await _get(session, account_id)
    if a.status == "pending_auth":
        return {"ok": False, "error": "Authorization pending"}
    res = await asyncio.to_thread(build_connector(a).health)
    a.status, a.last_error = ("connected", None) if res.get("ok") else ("error", str(res.get("error"))[:500])
    return res


@router.post("/{account_id}/sync")
async def sync_one(account_id: str, max_results: int = Query(100, le=500),
                   session: AsyncSession = Depends(get_session)) -> dict:
    return await sync_account(session, await _get(session, account_id), max_results)


@router.post("/{account_id}/authorize")
async def authorize(account_id: str, session: AsyncSession = Depends(get_session)) -> dict:
    a = await _get(session, account_id)
    prov = "google" if a.provider == AccountProvider.GMAIL else a.provider.value
    if prov not in ("google", "microsoft"):
        raise HTTPException(400, "This provider does not use OAuth")
    if not oauth.configured(prov):
        raise HTTPException(503, f"{prov} OAuth client is not configured on the server")
    return {"url": oauth.authorize_url(prov, a.id, a.email_address), "redirect_uri": oauth.redirect_uri(prov)}


@router.get("/oauth/{provider}/callback", include_in_schema=False)
async def oauth_callback(provider: str, state: str = "", code: str = "", error: str = "",
                         error_description: str = "", session: AsyncSession = Depends(get_session)):
    back = f"{settings.public_base_url.rstrip('/')}/mail/"
    try:
        st = oauth.read_state(state)
        if st["p"] != provider:
            raise ValueError("provider mismatch")
        a = await _get(session, st["aid"])
        if error or not code:
            raise ValueError(error_description or error or "authorization denied")
        creds = await oauth.exchange_code(provider, code)
        if not creds.get("refresh_token"):
            raise ValueError("no refresh token returned (revoke app access and retry)")
        claims = {}
        try:
            from jose import jwt as _jwt
            claims = _jwt.get_unverified_claims(creds.get("id_token") or "")
        except Exception:  # noqa: BLE001
            pass
        got = (claims.get("email") or claims.get("preferred_username") or "").lower()
        if got and got != a.email_address.lower():
            raise ValueError(f"signed in as {got}, expected {a.email_address}")
        creds.pop("id_token", None)
        a.credentials_enc = crypto.encrypt(creds)
        a.status, a.last_error, a.auth_type = "connected", None, "oauth"
        await session.commit()
        return RedirectResponse(f"{back}?settings=accounts&connected={a.email_address}")
    except Exception as exc:  # noqa: BLE001
        logger.warning("oauth callback failed: %s", exc)
        return RedirectResponse(f"{back}?settings=accounts&error={str(exc)[:120]}")


@router.post("/discover")
async def discover(body: DiscoverIn) -> dict:
    """Detect provider + servers from the address (DNS only; no login attempted)."""
    import asyncio
    return (await asyncio.to_thread(discovery.detect, body.email_address)).as_dict()


@router.post("/{account_id}/connect-password")
async def connect_password(account_id: str, body: PasswordConnectIn,
                           session: AsyncSession = Depends(get_session)) -> dict:
    """Apple-Mail-style setup: discover servers, test IMAP (+SMTP) with the typed password, save only on success.

    At most one IMAP login attempt per call (avoids provider lockouts). Microsoft 365 is reported as
    `login_disabled` without attempting a login: Exchange Online only accepts OAuth over IMAP.
    """
    import asyncio
    a = await _get(session, account_id)
    det = await asyncio.to_thread(discovery.detect, a.email_address)
    manual = bool(body.imap_host)
    imap_host = body.imap_host or (det.imap[0] if det.imap else None)
    imap_port = body.imap_port or (det.imap[1] if det.imap else 993)
    smtp_host = body.smtp_host or (det.smtp[0] if det.smtp else None)
    smtp_port = body.smtp_port or (det.smtp[1] if det.smtp else 465)
    user = body.username or a.email_address
    out: dict = {"detection": det.as_dict(), "tried": {"imap_host": imap_host, "imap_port": imap_port, "username": user}}
    if not imap_host:
        return {**out, "ok": False, "code": "no_server",
                "message": "No pude encontrar el servidor de correo de este dominio. Indícalo manualmente."}
    imap = await asyncio.to_thread(discovery.test_imap, imap_host, imap_port, user, body.password)
    out["imap"] = imap
    if not imap["ok"]:
        a.last_error = f"{imap.get('code')}: {imap.get('message')}"[:500]
        out.update(ok=False, code=imap.get("code"), message=imap.get("message"))
        if imap.get("code") == "login_disabled" and det.method == "oauth_microsoft":
            out["suggest"] = "oauth_microsoft"
            out["oauth_ready"] = oauth.configured("microsoft")
        return out
    smtp = await asyncio.to_thread(discovery.test_smtp, smtp_host, smtp_port, user, body.password) if smtp_host else {"ok": False, "code": "no_server", "message": "Sin servidor SMTP"}
    out["smtp"] = smtp
    a.provider, a.auth_type, a.status, a.last_error = AccountProvider.IMAP, "password", "connected", None
    a.imap_host, a.imap_port, a.smtp_host, a.smtp_port = imap_host, imap_port, smtp_host, smtp_port
    a.credentials_enc = crypto.encrypt({"username": user, "password": body.password})
    await session.flush()
    return {**out, "ok": True, "code": "ok", "manual": manual,
            "message": "Cuenta conectada" + ("" if smtp["ok"] else " (envío SMTP no verificado: " + str(smtp.get("message")) + ")")}
