"""OAuth 2.0 authorization-code flows for Google and Microsoft (server side).

State is a short-lived signed JWT (no server-side storage). Tokens never reach
the browser; they are stored Fernet-encrypted in email_accounts.credentials_enc.
"""
from __future__ import annotations

import time
from urllib.parse import urlencode

import httpx
from jose import JWTError, jwt

from backend.config import settings

GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
GOOGLE_SCOPES = [
    "openid",
    "email",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
]

MS_SCOPES = [
    "openid",
    "email",
    "offline_access",
    "https://graph.microsoft.com/Mail.ReadWrite",
    "https://graph.microsoft.com/Mail.Send",
    "https://graph.microsoft.com/User.Read",
]


def ms_endpoint(kind: str, tenant: str | None = None) -> str:
    return f"https://login.microsoftonline.com/{tenant or settings.ms_tenant}/oauth2/v2.0/{kind}"


def redirect_uri(provider: str) -> str:
    return f"{settings.public_base_url.rstrip('/')}/api/accounts/oauth/{provider}/callback"


def configured(provider: str) -> bool:
    if provider == "google":
        return bool(settings.google_oauth_client_id and settings.google_oauth_client_secret)
    if provider == "microsoft":
        return bool(settings.ms_client_id and settings.ms_client_secret)
    return False


def make_state(account_id: str, provider: str) -> str:
    return jwt.encode(
        {"aid": account_id, "p": provider, "exp": int(time.time()) + 900},
        settings.secret_key,
        algorithm="HS256",
    )


def read_state(state: str) -> dict:
    try:
        return jwt.decode(state, settings.secret_key, algorithms=["HS256"])
    except JWTError as exc:
        raise ValueError("invalid or expired state") from exc


def authorize_url(provider: str, account_id: str, login_hint: str | None) -> str:
    state = make_state(account_id, provider)
    if provider == "google":
        q = {
            "client_id": settings.google_oauth_client_id,
            "redirect_uri": redirect_uri("google"),
            "response_type": "code",
            "scope": " ".join(GOOGLE_SCOPES),
            "access_type": "offline",
            "prompt": "consent",
            "include_granted_scopes": "true",
            "state": state,
        }
        if login_hint:
            q["login_hint"] = login_hint
        return f"{GOOGLE_AUTH}?{urlencode(q)}"
    q = {
        "client_id": settings.ms_client_id,
        "redirect_uri": redirect_uri("microsoft"),
        "response_type": "code",
        "response_mode": "query",
        "scope": " ".join(MS_SCOPES),
        "prompt": "select_account",
        "state": state,
    }
    if login_hint:
        q["login_hint"] = login_hint
    return f"{ms_endpoint('authorize')}?{urlencode(q)}"


async def exchange_code(provider: str, code: str) -> dict:
    if provider == "google":
        url = GOOGLE_TOKEN
        data = {
            "client_id": settings.google_oauth_client_id,
            "client_secret": settings.google_oauth_client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri("google"),
        }
    else:
        url = ms_endpoint("token")
        data = {
            "client_id": settings.ms_client_id,
            "client_secret": settings.ms_client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri("microsoft"),
            "scope": " ".join(MS_SCOPES),
        }
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(url, data=data)
    body = r.json()
    if r.status_code != 200:
        raise ValueError(body.get("error_description") or body.get("error") or "token exchange failed")
    return {
        "refresh_token": body.get("refresh_token"),
        "access_token": body.get("access_token"),
        "expires_at": int(time.time()) + int(body.get("expires_in", 3600)) - 60,
        "scope": body.get("scope"),
        "id_token": body.get("id_token"),
    }


def refresh_ms_token_sync(refresh_token: str) -> dict:
    r = httpx.post(
        ms_endpoint("token"),
        data={
            "client_id": settings.ms_client_id,
            "client_secret": settings.ms_client_secret,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "scope": " ".join(MS_SCOPES),
        },
        timeout=30,
    )
    body = r.json()
    if r.status_code != 200:
        raise RuntimeError(body.get("error_description") or body.get("error") or "refresh failed")
    return {
        "refresh_token": body.get("refresh_token") or refresh_token,
        "access_token": body["access_token"],
        "expires_at": int(time.time()) + int(body.get("expires_in", 3600)) - 60,
    }
