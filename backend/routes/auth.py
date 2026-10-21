"""Standalone login for mail.chatita.ai (Google OIDC, allow-list) + session gate.

Reuses Chatita's Google OAuth client. The gateway at chatita.ai keeps its own
session; this app issues its own signed cookie scoped to its host.
Behind chatita.ai/mail (nginx auth_request to the gateway) the gate is bypassed
via the X-Chatita-Gateway header that nginx sets only on that location.
"""
from __future__ import annotations

import logging
import time
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, RedirectResponse

_HOME = "/"
from jose import JWTError, jwt

from backend.config import settings
from backend.services.accounts.oauth import GOOGLE_AUTH, GOOGLE_TOKEN

logger = logging.getLogger("chatita_mail.auth")
router = APIRouter(prefix="/auth", tags=["auth"])


def _allowed() -> set[str]:
    return {e.strip().lower() for e in settings.login_allowed_emails.split(",") if e.strip()}


def _cb() -> str:
    return f"{settings.public_base_url.rstrip('/')}/auth/callback"


def session_email(request: Request) -> str | None:
    tok = request.cookies.get(settings.session_cookie_name)
    if not tok:
        return None
    try:
        return jwt.decode(tok, settings.secret_key, algorithms=["HS256"]).get("sub")
    except JWTError:
        return None


@router.get("/login")
async def login(next: str = "/"):
    if not (settings.google_oauth_client_id and _allowed()):
        return JSONResponse({"error": "login not configured"}, status_code=503)
    state = jwt.encode({"n": next if next.startswith("/") else "/", "exp": int(time.time()) + 600},
                       settings.secret_key, algorithm="HS256")
    q = {"client_id": settings.google_oauth_client_id, "redirect_uri": _cb(), "response_type": "code",
         "scope": "openid email profile", "state": state, "prompt": "select_account"}
    return RedirectResponse(f"{GOOGLE_AUTH}?{urlencode(q)}")


@router.get("/callback")
async def callback(code: str = "", state: str = "", error: str = ""):
    try:
        nxt = jwt.decode(state, settings.secret_key, algorithms=["HS256"]).get("n", "/")
    except JWTError:
        return RedirectResponse("/?error=invalid_state")
    if error or not code:
        return RedirectResponse("/?error=denied")
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(GOOGLE_TOKEN, data={
            "client_id": settings.google_oauth_client_id, "client_secret": settings.google_oauth_client_secret,
            "code": code, "grant_type": "authorization_code", "redirect_uri": _cb()})
    if r.status_code != 200:
        return RedirectResponse("/?error=token_failed")
    claims = jwt.get_unverified_claims(r.json().get("id_token", ""))
    email = (claims.get("email") or "").lower()
    if not claims.get("email_verified") or email not in _allowed():
        logger.warning("login denied for %s", email)
        return RedirectResponse("/?error=not_allowed")
    tok = jwt.encode({"sub": email, "exp": int(time.time()) + settings.session_ttl_hours * 3600},
                     settings.secret_key, algorithm="HS256")
    resp = RedirectResponse(nxt)
    resp.set_cookie(settings.session_cookie_name, tok, max_age=settings.session_ttl_hours * 3600,
                    httponly=True, secure=True, samesite="lax", path="/")
    return resp


@router.get("/check")
async def check(request: Request):
    """nginx auth_request target: 204 if signed in, 401 otherwise."""
    return JSONResponse({"email": e}, status_code=200) if (e := session_email(request)) else JSONResponse({}, status_code=401)


@router.get("/me")
async def me(request: Request):
    e = session_email(request)
    return JSONResponse({"email": e}, status_code=200 if e else 401)


@router.post("/logout")
async def logout():
    r = JSONResponse({"ok": True})
    r.delete_cookie(settings.session_cookie_name, path="/")
    return r
