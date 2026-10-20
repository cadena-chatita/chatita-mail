"""Fernet encryption for stored mailbox credentials (tokens / IMAP passwords)."""
from __future__ import annotations

import json

from cryptography.fernet import Fernet, InvalidToken

from backend.config import settings


def _fernet() -> Fernet:
    if not settings.mail_cred_key:
        raise RuntimeError("MAIL_CRED_KEY is not configured (Fernet key required)")
    return Fernet(settings.mail_cred_key.encode())


def encrypt(data: dict) -> str:
    return _fernet().encrypt(json.dumps(data).encode()).decode()


def decrypt(token: str | None) -> dict:
    if not token:
        return {}
    try:
        return json.loads(_fernet().decrypt(token.encode()))
    except InvalidToken as exc:
        raise RuntimeError("Stored credentials cannot be decrypted (wrong MAIL_CRED_KEY)") from exc
