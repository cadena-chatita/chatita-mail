"""LiveKit avatar token endpoint for Chatita Mail (avatar button in the PWA).

GET /api/avatar/token -> {url, token}
Mints a LiveKit access token (HS256, stdlib only) that joins a fresh
`chatita-avatar-<rand>` room and dispatches the `chatita` agent worker.
Secrets come from the service EnvironmentFile (/opt/chatita-mail/.env):
LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET.
"""

import base64
import hashlib
import hmac
import json
import os
import time
import uuid

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/avatar", tags=["avatar"])


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _mint_token(api_key: str, secret: str, identity: str, room: str) -> str:
    now = int(time.time())
    payload = {
        "name": "Manny",
        "video": {"roomJoin": True, "room": room},
        "roomConfig": {
            "syncStreams": True,
            "agents": [{"agentName": "chatita"}],
        },
        "iss": api_key,
        "exp": now + 6 * 3600,
        "nbf": now,
        "sub": identity,
    }
    header = _b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = _b64url(json.dumps(payload, separators=(",", ":")).encode())
    sig = hmac.new(secret.encode(), f"{header}.{body}".encode(), hashlib.sha256).digest()
    return f"{header}.{body}.{_b64url(sig)}"


@router.get("/token")
async def avatar_token() -> dict:
    url = os.getenv("LIVEKIT_URL", "")
    api_key = os.getenv("LIVEKIT_API_KEY", "")
    secret = os.getenv("LIVEKIT_API_SECRET", "")
    if not (url and api_key and secret):
        raise HTTPException(status_code=503, detail="livekit_not_configured")
    room = f"chatita-avatar-{uuid.uuid4().hex[:8]}"
    identity = f"user-{uuid.uuid4().hex[:6]}"
    return {"url": url, "token": _mint_token(api_key, secret, identity, room)}
