"""
Full calendar for AION Agent (month / week / day / agenda in the UI). Everything the owner's calendars hold, marked with the
case it belongs to, plus scheduling with Google Meet or Zoom.

  GET    /api/agent/calendar/calendars             calendars (Google + the ones AION Agent ingested) with colors
  GET    /api/agent/calendar/events?start=&end=    every event in the range, case-marked
  POST   /api/agent/calendar/events                create (Google Calendar; Meet or Zoom optional; invitations only if asked)
  PATCH  /api/agent/calendar/events/{cal}/{id}     edit
  DELETE /api/agent/calendar/events/{cal}/{id}     delete
  GET    /api/agent/calendar/free-slots            free work-hour slots

Reads merge the AION Agent database (all calendars, with case links) with live Google events; a Google event replaces the
AION copy of the same event, so what you just created appears at once and stays editable.
"""
from __future__ import annotations

import asyncio
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.config import settings
from backend.routes.agent import _seeds, open_agent_db
from backend.services.agent_colors import calendar_color, case_color
from backend.services.email import calendar_service
from backend.services.email.zoom_connector import ZoomClient, ZoomError

router = APIRouter(prefix="/api/agent/calendar", tags=["aion-agent-calendar"])

ZOOM_RX = re.compile(r"https://[\w.-]*zoom\.us/j/[^\s<>\"']+", re.I)
MEET_RX = re.compile(r"https://meet\.google\.com/[a-z0-9-]+", re.I)


def _parse(s: str, tz: str) -> datetime:
    d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=ZoneInfo(tz))


def _key(title: str, start_epoch: float) -> tuple[str, int]:
    return re.sub(r"\W+", "", (title or "").lower()), int(start_epoch // 60)


def _case_rules() -> list[tuple[str, str, list[re.Pattern]]]:
    """(code, title, keyword patterns) from the seeds: used to MARK events that have no explicit link (flagged as inferred)."""
    out = []
    for c in _seeds().get("cases", []):
        kws = [i if isinstance(i, str) else (i.get("value") or "") for i in c.get("keywords", [])]
        pats = [re.compile(rf"\b{re.escape(k)}\b", re.I) for k in kws if len(k) >= 4]
        if pats:
            out.append((c["code"], c.get("title") or "", pats))
    return out


def _chip(code: str, title: str | None, inferred: bool = False) -> dict:
    return {"code": code, "title": title, "color": case_color(code), "inferred": inferred}


def _from_aion(con, start: datetime, end: datetime, wanted: set[str] | None) -> list[dict]:
    rows = con.execute("""SELECT e.id, e.calendar, e.title, e.start_at, e.end_at, e.all_day, e.location, substr(coalesce(e.description,''),1,1200)
                          FROM calendar_events e WHERE e.start_at < ? AND coalesce(e.end_at, e.start_at) >= ? ORDER BY e.start_at LIMIT 4000""",
                       (end.timestamp(), start.timestamp())).fetchall()
    out = []
    for eid, cal, title, s, e, all_day, loc, desc in rows:
        if wanted is not None and cal not in wanted:
            continue
        att = [{"email": em, "name": None, "status": {0: "unknown", 1: "pending", 2: "accepted", 3: "declined", 4: "tentative"}.get(st, "unknown"), "self": bool(me)}
               for em, st, me in con.execute("SELECT email, status, is_self FROM calendar_attendees WHERE event_id=? AND email IS NOT NULL LIMIT 60", (eid,))]
        cases = [_chip(c, t) for c, t in con.execute("SELECT cs.code, cs.title FROM case_events ce JOIN cases cs ON cs.id=ce.case_id WHERE ce.event_id=?", (eid,))]
        text = f"{loc or ''}\n{desc}"
        z, m = ZOOM_RX.search(text), MEET_RX.search(text)
        out.append({"id": f"a:{eid}", "source": "aion", "calendar_id": None, "event_id": eid, "calendar": cal, "calendar_color": calendar_color(cal or ""), "title": title or "(sin título)",
                    "start": datetime.fromtimestamp(s, timezone.utc).isoformat() if s else None, "end": datetime.fromtimestamp(e or s, timezone.utc).isoformat() if s else None,
                    "all_day": bool(all_day), "location": loc, "description": desc, "attendees": att, "meet_url": m.group(0) if m else None, "zoom_url": z.group(0) if z else None,
                    "cases": cases, "editable": False})
    return out


def _from_google(ev: dict, cal: dict) -> dict | None:
    st, en = ev.get("start", {}), ev.get("end", {})
    if ev.get("status") == "cancelled" or not st:
        return None
    all_day = "date" in st
    s = st.get("dateTime") or f"{st['date']}T00:00:00+00:00"
    e = en.get("dateTime") or f"{en.get('date', st['date'])}T00:00:00+00:00"
    text = f"{ev.get('location') or ''}\n{ev.get('description') or ''}"
    meet = ev.get("hangoutLink") or next((p.get("uri") for p in (ev.get("conferenceData") or {}).get("entryPoints", []) if p.get("entryPointType") == "video"), None)
    z = ZOOM_RX.search(text)
    priv = (ev.get("extendedProperties") or {}).get("private", {})
    cases = [_chip(priv["aion_case"], None)] if priv.get("aion_case") else []
    return {"id": f"g:{cal['id']}:{ev['id']}", "source": "google", "calendar_id": cal["id"], "event_id": ev["id"], "calendar": cal["name"], "calendar_color": cal.get("color") or calendar_color(cal["name"]),
            "title": ev.get("summary") or "(sin título)", "start": s, "end": e, "all_day": all_day, "location": ev.get("location"), "description": (ev.get("description") or "")[:1200],
            "attendees": [{"email": a.get("email"), "name": a.get("displayName"), "status": a.get("responseStatus", "unknown"), "self": bool(a.get("self")), "organizer": bool(a.get("organizer"))} for a in ev.get("attendees", [])][:60],
            "meet_url": meet, "zoom_url": z.group(0) if z else None, "cases": cases, "editable": bool(cal.get("writable")), "html_link": ev.get("htmlLink")}


def _mark_inferred(events: list[dict]) -> None:
    rules = _case_rules()
    for ev in events:
        if ev["cases"] or not rules:
            continue
        text = f"{ev['title']} {ev.get('location') or ''}"
        for code, title, pats in rules:
            if any(p.search(text) for p in pats):
                ev["cases"].append(_chip(code, title, inferred=True)); break


def _wanted(calendars: str | None) -> set[str] | None:
    return {c for c in (calendars or "").split("|") if c} or None


@router.get("/calendars")
def calendars() -> dict:
    out: list[dict] = []
    con, src = open_agent_db()
    if con is not None:
        try:
            for name, n in con.execute("SELECT calendar, count(*) FROM calendar_events GROUP BY 1 ORDER BY 2 DESC"):
                out.append({"id": f"aion:{name}", "name": name or "(sin nombre)", "color": calendar_color(name or ""), "source": "aion", "writable": False, "count": n})
        finally:
            con.close()
    google_error = None
    if calendar_service.GoogleCalendar.enabled():
        try:
            names = {c["name"] for c in out}
            for c in calendar_service.shared().calendars():
                out.append({"id": c["id"], "name": c["name"], "color": c["color"] or calendar_color(c["name"]), "source": "google", "writable": c["writable"], "primary": c["primary"],
                            "also_in_aion": c["name"] in names})
        except Exception as exc:  # noqa: BLE001
            google_error = f"{type(exc).__name__}"
    return {"source": src, "google_error": google_error, "zoom": ZoomClient.enabled(), "calendars": out}


@router.get("/events")
async def events(start: str, end: str, calendars: str | None = None, live: bool = True) -> dict:
    tz = settings.calendar_timezone
    s, e = _parse(start, tz), _parse(end, tz)
    if e <= s or (e - s) > timedelta(days=400):
        raise HTTPException(422, "Rango de fechas inválido (máximo 400 días)")
    wanted = _wanted(calendars)
    con, src = open_agent_db()
    items: list[dict] = []
    if con is not None:
        try:
            items = _from_aion(con, s, e, wanted)
        finally:
            con.close()
    google_error = None
    if live and calendar_service.GoogleCalendar.enabled():
        try:
            gcal = calendar_service.shared()
            cals = await asyncio.to_thread(gcal.calendars)
            chosen = [c for c in cals if wanted is None or c["name"] in wanted]
            fetched = await asyncio.to_thread(gcal.events_many, [c["id"] for c in chosen], s, e)        # sequential on purpose: the client is not thread-safe
            live_events = [g for c in chosen for ev in fetched[c["id"]] if (g := _from_google(ev, c))]
            by_key = {_key(a["title"], datetime.fromisoformat(a["start"]).timestamp()): a for a in items if a["start"]}
            for g in live_events:
                twin = by_key.pop(_key(g["title"], datetime.fromisoformat(g["start"]).timestamp()), None)
                if twin:                                    # same event: keep the live one, inherit the case links AION Agent knew
                    items.remove(twin)
                    g["cases"] = g["cases"] or twin["cases"]
            items += live_events
        except Exception as exc:  # noqa: BLE001
            google_error = f"{type(exc).__name__}: {str(exc)[:120]}"
    _mark_inferred(items)
    items.sort(key=lambda x: (x["start"] or "", x["title"]))
    return {"source": src, "google_error": google_error, "count": len(items), "events": items}


class EventIn(BaseModel):
    summary: str = Field(min_length=1, max_length=300)
    start: str
    end: str
    all_day: bool = False
    timezone: str | None = None
    calendar_id: str = "primary"
    location: str | None = None
    description: str | None = None
    attendees: list[str] = []
    send_invites: bool = False
    conference: str = Field("none", pattern="^(none|meet|zoom)$")
    case_code: str | None = None
    reminders: list[int] | None = None


class EventPatch(BaseModel):
    summary: str | None = None
    start: str | None = None
    end: str | None = None
    all_day: bool | None = None
    timezone: str | None = None
    location: str | None = None
    description: str | None = None
    attendees: list[str] | None = None
    send_invites: bool = False
    add_meet: bool = False
    case_code: str | None = None


def _times(start: str, end: str, all_day: bool, tz: str) -> tuple[dict, dict, datetime, datetime]:
    s, e = _parse(start, tz), _parse(end, tz)
    if e <= s and not all_day:
        raise HTTPException(422, "El fin debe ser posterior al inicio")
    if all_day:
        d0, d1 = s.date(), e.date()
        d1 = max(d1, d0) + timedelta(days=1)                 # Google all-day end is exclusive
        return {"date": d0.isoformat()}, {"date": d1.isoformat()}, s, e
    return {"dateTime": s.isoformat(), "timeZone": tz}, {"dateTime": e.isoformat(), "timeZone": tz}, s, e


def _body(p: EventIn | EventPatch, tz: str, zoom: dict | None = None) -> dict:
    body: dict = {}
    if getattr(p, "summary", None) is not None:
        body["summary"] = p.summary
    if p.start and p.end:
        body["start"], body["end"], _, _ = _times(p.start, p.end, bool(p.all_day), tz)
    if p.location is not None:
        body["location"] = p.location
    if p.description is not None or zoom:
        desc = p.description or ""
        if zoom:
            desc = (desc + "\n\n" if desc else "") + f"Zoom: {zoom['join_url']}" + (f"\nCódigo: {zoom['passcode']}" if zoom.get("passcode") else "")
            if not body.get("location"):
                body["location"] = zoom["join_url"]
        body["description"] = desc
    if p.attendees is not None:
        body["attendees"] = [{"email": a.strip()} for a in p.attendees if a.strip()]
    priv = {}
    if p.case_code:
        priv["aion_case"] = p.case_code
    if zoom:
        priv["aion_zoom_id"] = zoom["id"]
    if priv:
        body["extendedProperties"] = {"private": priv}
    return body


def _need_google() -> calendar_service.GoogleCalendar:
    if not calendar_service.GoogleCalendar.enabled():
        raise HTTPException(503, "Google Calendar no está configurado en este entorno (falta la cuenta de servicio).")
    return calendar_service.shared()


@router.post("/events")
async def create_event(p: EventIn) -> dict:
    gcal = _need_google()
    tz = p.timezone or settings.calendar_timezone
    zoom = None
    s_obj, e_obj, s, e = _times(p.start, p.end, p.all_day, tz)
    if p.conference == "zoom":
        if p.all_day:
            raise HTTPException(422, "Una reunión de Zoom necesita hora de inicio y fin")
        if not ZoomClient.enabled():
            raise HTTPException(503, "Zoom no está configurado en este entorno")
        try:
            zoom = await asyncio.to_thread(ZoomClient().create_meeting, p.summary, s.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                                           int((e - s).total_seconds() // 60), tz, p.description or "")
        except ZoomError as exc:
            raise HTTPException(502, str(exc)) from exc
    body = _body(p, tz, zoom)
    body["start"], body["end"] = s_obj, e_obj
    if p.reminders is not None:
        body["reminders"] = {"useDefault": False, "overrides": [{"method": "popup", "minutes": m} for m in p.reminders[:5]]}
    if p.conference == "meet":
        body["conferenceData"] = {"createRequest": {"requestId": uuid.uuid4().hex, "conferenceSolutionKey": {"type": "hangoutsMeet"}}}
    send = "all" if (p.send_invites and p.attendees) else "none"
    try:
        ev = await asyncio.to_thread(gcal.create, p.calendar_id, body, p.conference == "meet", send)
    except Exception as exc:  # noqa: BLE001
        if zoom:                                          # do not leave an orphan Zoom meeting behind a failed event
            try:
                await asyncio.to_thread(ZoomClient().delete_meeting, zoom["id"])
            except Exception:  # noqa: BLE001
                pass
        raise HTTPException(502, f"Google Calendar rechazó el evento: {str(exc)[:200]}") from exc
    cal = next((c for c in await asyncio.to_thread(gcal.calendars) if c["id"] == p.calendar_id or (p.calendar_id == "primary" and c["primary"])), {"id": p.calendar_id, "name": p.calendar_id, "writable": True})
    return {"created": True, "invitations_sent": send == "all", "event": _from_google(ev, cal)}


@router.patch("/events/{calendar_id}/{event_id}")
async def patch_event(calendar_id: str, event_id: str, p: EventPatch) -> dict:
    gcal = _need_google()
    tz = p.timezone or settings.calendar_timezone
    body = _body(p, tz)
    if (p.start is None) != (p.end is None):
        raise HTTPException(422, "Cambia inicio y fin juntos")
    if p.add_meet:
        body["conferenceData"] = {"createRequest": {"requestId": uuid.uuid4().hex, "conferenceSolutionKey": {"type": "hangoutsMeet"}}}
    send = "all" if (p.send_invites and p.attendees) else "none"
    try:
        ev = await asyncio.to_thread(gcal.patch, calendar_id, event_id, body, p.add_meet, send)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Google Calendar rechazó el cambio: {str(exc)[:200]}") from exc
    cal = next((c for c in await asyncio.to_thread(gcal.calendars) if c["id"] == calendar_id), {"id": calendar_id, "name": calendar_id, "writable": True})
    return {"updated": True, "event": _from_google(ev, cal)}


@router.delete("/events/{calendar_id}/{event_id}")
async def delete_event(calendar_id: str, event_id: str, notify: bool = False) -> dict:
    gcal = _need_google()
    try:
        ev = await asyncio.to_thread(gcal.get, calendar_id, event_id)
        zoom_id = ((ev.get("extendedProperties") or {}).get("private") or {}).get("aion_zoom_id")
        await asyncio.to_thread(gcal.delete, calendar_id, event_id, "all" if notify else "none")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Google Calendar no pudo eliminar el evento: {str(exc)[:200]}") from exc
    if zoom_id and ZoomClient.enabled():                  # the Zoom meeting created together with this event goes with it
        try:
            await asyncio.to_thread(ZoomClient().delete_meeting, zoom_id)
        except Exception:  # noqa: BLE001
            pass
    return {"deleted": True}


@router.get("/free-slots")
async def free_slots(duration: int = Query(30, ge=15, le=480), days: int = Query(7, ge=1, le=30)) -> dict:
    from backend.services.email.calendar_connector import CalendarConnector
    if not CalendarConnector.enabled():
        raise HTTPException(503, "Google Calendar no está configurado en este entorno")
    slots = await asyncio.to_thread(CalendarConnector().find_free_slots, duration, days, 8)
    return {"slots": slots}
