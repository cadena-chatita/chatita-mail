"""Provider-agnostic per-account sync (pull newest N, idempotent upsert)."""
from __future__ import annotations

import asyncio
import inspect
import logging
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.entities import EmailAccount
from backend.services.accounts import crypto
from backend.services.email.account_connectors import build_connector
from backend.services.email.sync import _existing_message_ids, _upsert_email

logger = logging.getLogger("chatita_mail.account_sync")


async def sync_account(session: AsyncSession, account: EmailAccount, max_results: int = 100) -> dict:
    if account.deleted_at or not account.is_active or account.status in ("pending_auth", "disabled"):
        return {"email": account.email_address, "skipped": account.status or "inactive"}

    def persist(creds: dict) -> None:
        account.credentials_enc = crypto.encrypt(creds)

    account.sync_status = "running"
    await session.flush()
    try:
        conn = build_connector(account, persist_creds=persist)
        kw = {"max_results": max_results, "unread_only": False}
        if "since_date" in inspect.signature(conn.list_inbox).parameters and account.last_sync_at:
            kw["since_date"] = account.last_sync_at
        emails = await asyncio.to_thread(conn.list_inbox, **kw)
        known = await _existing_message_ids(session, account.id)
        created = 0
        for ne in emails:
            if ne.provider_message_id in known:
                continue
            _, was_new = await _upsert_email(session, account, ne)
            created += was_new
        account.last_sync_at = datetime.now(tz=timezone.utc)
        account.sync_status, account.status, account.last_error = "idle", "connected", None
        return {"email": account.email_address, "fetched": len(emails), "created": created}
    except Exception as exc:  # noqa: BLE001
        logger.warning("sync %s failed: %s", account.email_address, exc)
        account.sync_status, account.status, account.last_error = "error", "error", str(exc)[:500]
        return {"email": account.email_address, "error": str(exc)[:200]}
