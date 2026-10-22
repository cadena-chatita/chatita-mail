"""
Zoom meetings for the calendar (Server-to-Server OAuth, same app Chatita already uses).

Only creates, updates and deletes MEETINGS when a route explicitly asks (after the user confirmed in the UI). The
access token is cached in memory and refreshed five minutes before it expires. Secrets come from settings, never from code.
"""
from __future__ import annotations

import time

import httpx

from backend.config import settings

OAUTH_URL = "https://zoom.us/oauth/token"
API = "https://api.zoom.us/v2"


class ZoomError(RuntimeError):
    pass


class ZoomClient:
    def __init__(self, http: httpx.Client | None = None) -> None:
        self._http = http or httpx.Client(timeout=30)
        self._token: str | None = None
        self._expires = 0.0

    @staticmethod
    def enabled() -> bool:
        return bool(settings.zoom_account_id and settings.zoom_client_id and settings.zoom_client_secret)

    def _access_token(self) -> str:
        if self._token and time.time() < self._expires - 300:
            return self._token
        r = self._http.post(OAUTH_URL, params={"grant_type": "account_credentials", "account_id": settings.zoom_account_id},
                            auth=(settings.zoom_client_id, settings.zoom_client_secret))
        if r.status_code != 200:
            raise ZoomError(f"Zoom rechazó las credenciales (HTTP {r.status_code})")
        data = r.json()
        self._token, self._expires = data["access_token"], time.time() + int(data.get("expires_in", 3600))
        return self._token

    def _call(self, method: str, path: str, **kw) -> dict:
        r = self._http.request(method, f"{API}{path}", headers={"Authorization": f"Bearer {self._access_token()}"}, **kw)
        if r.status_code >= 300:
            raise ZoomError(f"Zoom respondió HTTP {r.status_code}: {r.text[:160]}")
        return r.json() if r.content else {}

    def create_meeting(self, topic: str, start_utc_iso: str, duration_min: int, timezone: str, agenda: str = "") -> dict:
        body = {"topic": topic[:200], "type": 2, "start_time": start_utc_iso, "duration": max(5, min(duration_min, 1440)), "timezone": timezone,
                "agenda": agenda[:2000], "settings": {"join_before_host": False, "waiting_room": True, "meeting_authentication": False}}
        m = self._call("POST", "/users/me/meetings", json=body)
        return {"id": str(m["id"]), "join_url": m["join_url"], "passcode": m.get("password"), "start_url_available": bool(m.get("start_url"))}

    def update_meeting(self, meeting_id: str, **fields) -> None:
        self._call("PATCH", f"/meetings/{meeting_id}", json=fields)

    def delete_meeting(self, meeting_id: str) -> None:
        self._call("DELETE", f"/meetings/{meeting_id}")
