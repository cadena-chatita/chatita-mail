"""
Google Calendar read/write for the full calendar view (service account + domain-wide delegation, the same access
`calendar_connector` already uses). Writes happen only when a route is called after the user confirmed in the UI.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timezone

from backend.services.email.calendar_connector import CalendarConnector

_CAL_TTL = 600


class GoogleCalendar:
    """The Google API client (httplib2 + ssl) is NOT thread-safe: concurrent calls crashed the production process with a
    segmentation fault. Every call therefore goes through one lock; nothing here runs in parallel."""

    def __init__(self, service=None) -> None:
        self._svc = service
        self._cals: tuple[float, list[dict]] | None = None
        self._lock = threading.RLock()

    @staticmethod
    def enabled() -> bool:
        return CalendarConnector.enabled()

    def _service(self):
        with self._lock:
            return self._service_unlocked()

    def _service_unlocked(self):
        if self._svc is None:
            self._svc = CalendarConnector()._service()
        return self._svc

    def calendars(self) -> list[dict]:
        with self._lock:
            return self._calendars()

    def _calendars(self) -> list[dict]:
        if self._cals and time.time() - self._cals[0] < _CAL_TTL:
            return self._cals[1]
        items = self._service().calendarList().list(maxResults=100).execute().get("items", [])
        out = [{"id": c["id"], "name": c.get("summaryOverride") or c.get("summary") or c["id"], "color": c.get("backgroundColor"),
                "primary": bool(c.get("primary")), "writable": c.get("accessRole") in ("owner", "writer"), "role": c.get("accessRole")} for c in items]
        self._cals = (time.time(), out)
        return out

    def events(self, calendar_id: str, start: datetime, end: datetime, limit: int = 500) -> list[dict]:
        with self._lock:
            return self._events(calendar_id, start, end, limit)

    def events_many(self, calendar_ids: list[str], start: datetime, end: datetime) -> dict[str, list[dict]]:
        """One thread, one calendar after another (see the class note)."""
        with self._lock:
            return {c: self._events(c, start, end) for c in calendar_ids}

    def _events(self, calendar_id: str, start: datetime, end: datetime, limit: int = 500) -> list[dict]:
        iso = lambda d: d.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        resp = self._service().events().list(calendarId=calendar_id, timeMin=iso(start), timeMax=iso(end), singleEvents=True, orderBy="startTime",
                                             maxResults=limit, showDeleted=False).execute()
        return resp.get("items", [])

    def create(self, calendar_id: str, body: dict, meet: bool, send_updates: str) -> dict:
        with self._lock:
            return self._create(calendar_id, body, meet, send_updates)

    def _create(self, calendar_id: str, body: dict, meet: bool, send_updates: str) -> dict:
        return self._service().events().insert(calendarId=calendar_id, body=body, conferenceDataVersion=1 if meet else 0, sendUpdates=send_updates).execute()

    def get(self, calendar_id: str, event_id: str) -> dict:
        with self._lock:
            return self._get(calendar_id, event_id)

    def _get(self, calendar_id: str, event_id: str) -> dict:
        return self._service().events().get(calendarId=calendar_id, eventId=event_id).execute()

    def patch(self, calendar_id: str, event_id: str, body: dict, meet: bool, send_updates: str) -> dict:
        with self._lock:
            return self._patch(calendar_id, event_id, body, meet, send_updates)

    def _patch(self, calendar_id: str, event_id: str, body: dict, meet: bool, send_updates: str) -> dict:
        return self._service().events().patch(calendarId=calendar_id, eventId=event_id, body=body, conferenceDataVersion=1 if meet else 0, sendUpdates=send_updates).execute()

    def delete(self, calendar_id: str, event_id: str, send_updates: str) -> None:
        with self._lock:
            self._delete(calendar_id, event_id, send_updates)

    def _delete(self, calendar_id: str, event_id: str, send_updates: str) -> None:
        self._service().events().delete(calendarId=calendar_id, eventId=event_id, sendUpdates=send_updates).execute()


_shared: GoogleCalendar | None = None


def shared() -> GoogleCalendar:
    global _shared
    if _shared is None:
        _shared = GoogleCalendar()
    return _shared
