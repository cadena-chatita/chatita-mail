"""Full calendar: merge of AION Agent events with live Google events, case marks, scheduling with Meet or Zoom (fakes, no network)."""
import json
import sqlite3
import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.routes import calendar as cal_routes
from backend.services.email import calendar_service
from backend.services.email.zoom_connector import ZoomClient
from backend.tests.test_agent_routes import _agent_db

NOW = datetime.now(timezone.utc).replace(microsecond=0)


class _Exec:
    def __init__(self, value): self.value = value
    def execute(self): return self.value


class FakeGoogle:
    """The slice of the Google Calendar v3 client the app touches."""
    def __init__(self):
        self.calls, self.items, self.fail_insert = [], [], False
        self.active, self.max_active = 0, 0
    def overlap_probe(self):
        import time as _t
        self.active += 1; self.max_active = max(self.max_active, self.active); _t.sleep(0.01); self.active -= 1
    def calendarList(self): return self
    def events(self): return self
    def list(self, **kw):
        self.calls.append(("list", kw))
        self.overlap_probe()
        if "maxResults" in kw and "calendarId" not in kw:
            return _Exec({"items": [{"id": "primary@x", "summary": "Trabajo", "backgroundColor": "#123456", "primary": True, "accessRole": "owner"},
                                    {"id": "fest@x", "summary": "Festivos", "backgroundColor": "#ff0000", "accessRole": "reader"}]})
        return _Exec({"items": self.items if kw["calendarId"] == "primary@x" else []})
    def insert(self, **kw):
        self.calls.append(("insert", kw))
        if self.fail_insert: raise RuntimeError("boom")
        ev = dict(kw["body"], id="new1", htmlLink="https://calendar.google.com/x")
        if "conferenceData" in kw["body"]: ev["hangoutLink"] = "https://meet.google.com/abc-defg-hij"
        return _Exec(ev)
    def get(self, **kw): return _Exec({"id": kw["eventId"], "extendedProperties": {"private": {"aion_zoom_id": "999"}}})
    def patch(self, **kw):
        self.calls.append(("patch", kw)); return _Exec({"id": kw["eventId"], "summary": kw["body"].get("summary", "x"), "start": {"dateTime": NOW.isoformat()}, "end": {"dateTime": (NOW + timedelta(hours=1)).isoformat()}})
    def delete(self, **kw): self.calls.append(("delete", kw)); return _Exec({})


@pytest.fixture()
def env(tmp_path, monkeypatch):
    db = tmp_path / "agent.db"; _agent_db(db)
    seeds = tmp_path / "seeds.json"; seeds.write_text(json.dumps({"cases": [{"code": "HMG", "title": "Hospital HMG", "keywords": ["dictamen", "HMG"]}]}))
    monkeypatch.setenv("AIONAGENT_DB", str(db)); monkeypatch.setenv("AIONAGENT_SEEDS", str(seeds))
    fake = FakeGoogle()
    monkeypatch.setattr(calendar_service, "_shared", calendar_service.GoogleCalendar(service=fake))
    monkeypatch.setattr(calendar_service.GoogleCalendar, "enabled", staticmethod(lambda: True))
    zooms = {"created": [], "deleted": []}
    monkeypatch.setattr(ZoomClient, "enabled", staticmethod(lambda: True))
    monkeypatch.setattr(ZoomClient, "create_meeting", lambda self, topic, start, dur, tz, agenda="": zooms["created"].append((topic, start, dur, tz)) or {"id": "999", "join_url": "https://us02web.zoom.us/j/999?pwd=x", "passcode": "123456"})
    monkeypatch.setattr(ZoomClient, "delete_meeting", lambda self, mid: zooms["deleted"].append(mid))
    return TestClient(app), fake, zooms


def _range(days=3):
    return {"start": (NOW - timedelta(hours=1)).isoformat(), "end": (NOW + timedelta(days=days)).isoformat()}


def test_events_merge_aion_and_live_google_without_duplicates_and_mark_cases(env):
    c, fake, _ = env
    start = NOW + timedelta(hours=2)
    fake.items = [
        {"id": "g1", "summary": "Junta del caso", "start": {"dateTime": start.isoformat()}, "end": {"dateTime": (start + timedelta(hours=1)).isoformat()}, "attendees": [{"email": "a@x.test", "responseStatus": "accepted"}],
         "hangoutLink": "https://meet.google.com/aaa-bbbb-ccc", "location": "Sala 1"},                                  # same as the AION event (same title and start)
        {"id": "g2", "summary": "Revisión del dictamen pericial", "start": {"dateTime": (NOW + timedelta(hours=5)).isoformat()}, "end": {"dateTime": (NOW + timedelta(hours=6)).isoformat()}, "location": "https://us02web.zoom.us/j/555"},
        {"id": "g3", "summary": "Dentista", "start": {"date": (NOW + timedelta(days=1)).date().isoformat()}, "end": {"date": (NOW + timedelta(days=2)).date().isoformat()}},
    ]
    r = c.get("/api/agent/calendar/events", params=_range()).json()
    titles = [e["title"] for e in r["events"]]
    assert titles.count("Junta del caso") == 1 and r["google_error"] is None
    junta = next(e for e in r["events"] if e["title"] == "Junta del caso")
    assert junta["source"] == "google" and junta["editable"] is True and junta["meet_url"].endswith("aaa-bbbb-ccc")
    assert [x["code"] for x in junta["cases"]] == ["HMG"] and junta["cases"][0]["inferred"] is False                    # inherited from the AION link
    assert junta["attendees"][0]["status"] == "accepted"
    rev = next(e for e in r["events"] if e["title"].startswith("Revisión"))
    assert rev["cases"][0]["inferred"] is True and rev["cases"][0]["color"].startswith("#") and rev["zoom_url"].endswith("/j/555")
    assert next(e for e in r["events"] if e["title"] == "Dentista")["all_day"] is True


def test_calendars_lists_both_sources_with_colors_and_zoom_flag(env):
    c, _, _ = env
    r = c.get("/api/agent/calendar/calendars").json()
    names = {x["name"]: x for x in r["calendars"]}
    assert names["Trabajo"]["writable"] is True and names["Festivos"]["writable"] is False and names["Work"]["source"] == "aion" and r["zoom"] is True


def test_create_with_meet_sends_no_invitations_unless_asked(env):
    c, fake, _ = env
    body = {"summary": "Reunión", "start": (NOW + timedelta(days=1)).isoformat(), "end": (NOW + timedelta(days=1, hours=1)).isoformat(), "attendees": ["ana@x.test"], "conference": "meet", "case_code": "HMG", "calendar_id": "primary@x", "reminders": [10, 60]}
    r = c.post("/api/agent/calendar/events", json=body).json()
    ins = [k for n, k in fake.calls if n == "insert"][-1]
    assert ins["sendUpdates"] == "none" and ins["conferenceDataVersion"] == 1 and r["invitations_sent"] is False
    assert ins["body"]["extendedProperties"]["private"]["aion_case"] == "HMG" and ins["body"]["reminders"]["overrides"][1]["minutes"] == 60
    assert r["event"]["meet_url"].startswith("https://meet.google.com/") and r["event"]["cases"][0]["code"] == "HMG"
    c.post("/api/agent/calendar/events", json={**body, "send_invites": True})
    assert [k for n, k in fake.calls if n == "insert"][-1]["sendUpdates"] == "all"


def test_create_with_zoom_puts_the_link_in_the_event_and_all_day_end_is_exclusive(env):
    c, fake, zooms = env
    s = (NOW + timedelta(days=2)).replace(hour=15, minute=0)
    r = c.post("/api/agent/calendar/events", json={"summary": "Llamada", "start": s.isoformat(), "end": (s + timedelta(minutes=45)).isoformat(), "conference": "zoom", "timezone": "America/Mexico_City"}).json()
    topic, start_utc, dur, tz = zooms["created"][0]
    assert topic == "Llamada" and dur == 45 and start_utc.endswith("Z") and tz == "America/Mexico_City"
    assert r["event"]["zoom_url"].startswith("https://us02web.zoom.us/j/999") and "Código: 123456" in r["event"]["description"]
    assert [k for n, k in fake.calls if n == "insert"][-1]["body"]["extendedProperties"]["private"]["aion_zoom_id"] == "999"
    d = (NOW + timedelta(days=5)).date()
    c.post("/api/agent/calendar/events", json={"summary": "Viaje", "start": d.isoformat(), "end": d.isoformat(), "all_day": True})
    body = [k for n, k in fake.calls if n == "insert"][-1]["body"]
    assert body["start"] == {"date": d.isoformat()} and body["end"] == {"date": (d + timedelta(days=1)).isoformat()}


def test_a_failed_google_insert_does_not_leave_an_orphan_zoom_meeting(env):
    c, fake, zooms = env
    fake.fail_insert = True
    r = c.post("/api/agent/calendar/events", json={"summary": "X", "start": NOW.isoformat(), "end": (NOW + timedelta(hours=1)).isoformat(), "conference": "zoom"})
    assert r.status_code == 502 and zooms["deleted"] == ["999"]


def test_deleting_an_event_also_deletes_its_zoom_meeting_and_notifies_only_if_asked(env):
    c, fake, zooms = env
    assert c.delete("/api/agent/calendar/events/primary@x/e1").json() == {"deleted": True}
    assert [k for n, k in fake.calls if n == "delete"][-1]["sendUpdates"] == "none" and zooms["deleted"] == ["999"]
    c.delete("/api/agent/calendar/events/primary@x/e1", params={"notify": "true"})
    assert [k for n, k in fake.calls if n == "delete"][-1]["sendUpdates"] == "all"


def test_patch_changes_fields_and_validation_rejects_bad_input(env):
    c, fake, _ = env
    assert c.patch("/api/agent/calendar/events/primary@x/e1", json={"summary": "Nuevo título"}).json()["event"]["title"] == "Nuevo título"
    assert c.patch("/api/agent/calendar/events/primary@x/e1", json={"start": NOW.isoformat()}).status_code == 422
    assert c.post("/api/agent/calendar/events", json={"summary": "X", "start": NOW.isoformat(), "end": (NOW - timedelta(hours=1)).isoformat()}).status_code == 422
    assert c.post("/api/agent/calendar/events", json={"summary": "X", "start": NOW.date().isoformat(), "end": NOW.date().isoformat(), "all_day": True, "conference": "zoom"}).status_code == 422
    assert c.get("/api/agent/calendar/events", params={"start": NOW.isoformat(), "end": (NOW + timedelta(days=500)).isoformat()}).status_code == 422


def test_without_google_the_calendar_still_shows_aion_events_and_writes_are_503(env, monkeypatch):
    c, _, _ = env
    monkeypatch.setattr(calendar_service.GoogleCalendar, "enabled", staticmethod(lambda: False))
    r = c.get("/api/agent/calendar/events", params=_range()).json()
    assert [e["title"] for e in r["events"]] == ["Junta del caso"] and r["events"][0]["source"] == "aion" and r["events"][0]["editable"] is False
    assert c.post("/api/agent/calendar/events", json={"summary": "X", "start": NOW.isoformat(), "end": (NOW + timedelta(hours=1)).isoformat()}).status_code == 503


def test_google_calls_never_run_concurrently(env):
    """The Google client crashed production (SIGSEGV) when called from several threads at once: calls must be serialized."""
    import threading
    c, fake, _ = env
    gcal = calendar_service.shared()
    ts = [threading.Thread(target=lambda: gcal.events("primary@x", NOW, NOW + timedelta(days=1))) for _ in range(8)]
    [t.start() for t in ts]; [t.join() for t in ts]
    assert fake.max_active == 1
    c.get("/api/agent/calendar/events", params=_range())
    assert fake.max_active == 1
