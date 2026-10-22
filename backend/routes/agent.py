"""
AION Agent inside Chatita Mail: one place to see what to do next, the agenda, the cases and the full-text search,
and to give direct orders. Read-only over AION Agent's database (the full copy in RAM on the server, the light replica,
or the computer's own database on a developer machine); orders go through the AION Agent command endpoint.

  GET  /api/agent/status           where the data comes from and how fresh it is
  GET  /api/agent/today            "what's next": overdue/urgent tasks, commitments, events, mail waiting for a reply, proposals
  GET  /api/agent/agenda?days=14   upcoming events with the cases they belong to
  GET  /api/agent/cases[/{code}]   cases with counts / one case with its timeline
  GET  /api/agent/search?q=        full text over WhatsApp, mail, attachments and calendar
  GET  /api/agent/email-context    subject, sender and cases for a list of Chatita Mail email ids (tasks, commitments)
  POST /api/agent/command          a direct order in Spanish ("agrega palabra clave X al caso Y")
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.models.db import get_session
from backend.models.entities import Commitment, Email, EmailAccount, Task
from backend.services.workflow.task_value import aware, parse_cutoff

router = APIRouter(prefix="/api/agent", tags=["aion-agent"])

FULL_MAX_AGE_S = 6 * 3600
_WHO = {"me": "Tú", "sender": "Remitente"}   # how the extractor labels who owes the commitment
HOME = Path(os.path.expanduser("~"))


def _candidates() -> list[tuple[str, Path]]:
    env = os.environ.get("AIONAGENT_DB")
    out = [("local", Path(env))] if env else []
    out += [("full", Path("/opt/aionagent/ram/full.db")), ("light", Path("/opt/aionagent/data/replica.db")), ("local", HOME / "aionagent_local" / "aionagent_wa.db")]
    return out


def _age(con: sqlite3.Connection) -> float | None:
    try:
        row = con.execute("SELECT v FROM replica_meta WHERE k='exported_at'").fetchone()
        return time.time() - float(row[0]) if row else None
    except sqlite3.Error:
        return None


def open_agent_db() -> tuple[sqlite3.Connection | None, dict]:
    """First usable source: a fresh full copy, the light replica, or the local database. (None, info) when AION Agent is absent."""
    for kind, path in _candidates():
        if not path.exists():
            continue
        try:
            con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=10)
            con.execute("SELECT 1 FROM cases LIMIT 1")
        except sqlite3.Error:
            continue
        age = _age(con)
        if kind == "full" and age is not None and age > FULL_MAX_AGE_S:
            con.close(); continue
        return con, {"kind": kind, "age_s": None if age is None else int(age)}
    return None, {"kind": "none", "age_s": None}


def _seeds() -> dict:
    for p in (os.environ.get("AIONAGENT_SEEDS"), "/opt/aionagent/data/seeds.json", str(HOME / "aionagent_local/knowledge/seeds.json")):
        if p and Path(p).exists():
            try:
                return json.loads(Path(p).read_text(encoding="utf-8"))
            except (OSError, ValueError):
                pass
    return {}


def _iso(ts) -> str | None:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat() if ts else None


def _urgency(deadline: datetime | None, now: datetime) -> str:
    if deadline is None:
        return "open"
    hours = (aware(deadline) - now).total_seconds() / 3600
    return "overdue" if hours < 0 else "today" if hours <= 24 else "soon" if hours <= 72 else "week" if hours <= 168 else "later"


# ── case chips for Chatita Mail email ids ───────────────────
def _pmids(emails: list[tuple]) -> dict[tuple[str, str], str]:
    return {(acct, pmid): eid for eid, acct, pmid in emails}


def case_chips(con: sqlite3.Connection | None, rows: list[tuple[str, str, str]]) -> dict[str, list[dict]]:
    """rows: (chatita email id, account address, provider message id) -> {email id: [{code,title}]}."""
    if con is None or not rows:
        return {}
    out: dict[str, list[dict]] = {}
    if not _has(con, "mail_observations"):      # an older light replica: no case chips yet, but the view must still work
        return out
    for eid, acct, pmid in rows:
        cs = con.execute("""SELECT DISTINCT cs.code, cs.title FROM mail_observations o JOIN case_mail cm ON cm.message_id = o.atom_id JOIN cases cs ON cs.id = cm.case_id
                            WHERE o.provider_message_id = ? AND o.account = ?""", (pmid, acct)).fetchall()
        if cs:
            out[eid] = [{"code": c, "title": t} for c, t in cs]
    return out


async def _email_rows(session: AsyncSession, ids: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    rows = (await session.execute(
        select(Email.id, Email.subject, Email.from_name, Email.from_address, Email.received_at, Email.provider_message_id, EmailAccount.email_address)
        .join(EmailAccount, EmailAccount.id == Email.account_id).where(Email.id.in_(ids)))).all()
    return {r[0]: {"subject": r[1], "from": r[2] or r[3], "received_at": r[4].isoformat() if r[4] else None, "pmid": r[5], "account": r[6]} for r in rows}


# ── endpoints ───────────────────────────────────────────────
@router.get("/status")
def status() -> dict:
    con, src = open_agent_db()
    if con is None:
        return {"available": False, "source": src, "message": "AION Agent no tiene datos en este entorno todavía."}
    try:
        counts = {t: con.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in ("cases", "calendar_events", "mail_messages", "atoms", "chats") if _has(con, t)}
        tz = con.execute("SELECT v FROM replica_meta WHERE k='tz'").fetchone() if _has(con, "replica_meta") else None
        return {"available": True, "source": src, "counts": counts, "tz": tz[0] if tz else None, "has_search": _has(con, "fts")}
    finally:
        con.close()


def _has(con: sqlite3.Connection, table: str) -> bool:
    return bool(con.execute("SELECT 1 FROM sqlite_master WHERE name = ?", (table,)).fetchone())


class EmailContextOut(BaseModel):
    items: dict[str, dict]


@router.get("/email-context")
async def email_context(ids: str = Query(..., description="comma separated Chatita Mail email ids"), session: AsyncSession = Depends(get_session)) -> EmailContextOut:
    wanted = [i for i in ids.split(",") if i][:200]
    info = await _email_rows(session, wanted)
    con, _ = open_agent_db()
    try:
        chips = case_chips(con, [(i, v["account"], v["pmid"]) for i, v in info.items()])
    finally:
        if con:
            con.close()
    return EmailContextOut(items={i: {"subject": v["subject"], "from": v["from"], "received_at": v["received_at"], "cases": chips.get(i, [])} for i, v in info.items()})


@router.get("/today")
async def today(session: AsyncSession = Depends(get_session)) -> dict:
    now = datetime.now(timezone.utc)
    con, src = open_agent_db()
    items: list[dict] = []
    t_rows = (await session.execute(select(Task).where(Task.status == "pending"))).scalars().all()
    # Same cut-off as task generation: the pre-October backlog stays in the Commitments view but must not bury today's work.
    cutoff = parse_cutoff(settings.task_extract_since)
    c_all = (await session.execute(select(Commitment, Email.received_at).join(Email, Email.id == Commitment.email_id).where(Commitment.status == "pending"))).all()
    c_rows = [c for c, received in c_all if received is None or aware(received) >= cutoff]
    ids = list({t.email_id for t in t_rows} | {c.email_id for c in c_rows})
    info = await _email_rows(session, ids)
    chips = case_chips(con, [(i, v["account"], v["pmid"]) for i, v in info.items()]) if con else {}

    def base(kind: str, ident: str, title: str, when: datetime | None, email_id: str | None, why: str, action: str) -> dict:
        ctx = info.get(email_id or "", {})
        when = aware(when) if when else None
        return {"kind": kind, "id": ident, "title": title, "when": when.isoformat() if when else None, "urgency": _urgency(when, now), "email_id": email_id,
                "email_subject": ctx.get("subject"), "email_from": ctx.get("from"), "cases": chips.get(email_id or "", []), "why": why, "action": action}

    for t in t_rows:
        items.append(base("task", t.id, t.description, t.deadline, t.email_id,
                          "Tarea abierta" + (" con plazo" if t.deadline else " sin plazo") + f" · prioridad {t.priority or 'media'}", "reply" if t.task_type == "reply" else "open_email"))
    for c in c_rows:
        items.append(base("commitment", c.id, f"{_WHO.get(c.who, c.who)}: {c.what}", c.deadline, c.email_id, "Compromiso detectado en el correo", "open_email"))
    summary = {"proposals": 0}
    if con is not None:
        try:
            lim_a, lim_b = int(now.timestamp()), int((now + timedelta(hours=72)).timestamp())
            for eid, cal, title, start, n in con.execute("""SELECT e.id, e.calendar, e.title, e.start_at, (SELECT count(*) FROM calendar_attendees a WHERE a.event_id=e.id AND coalesce(a.is_self,0)=0)
                                                          FROM calendar_events e WHERE e.all_day=0 AND e.start_at BETWEEN ? AND ? ORDER BY e.start_at LIMIT 12""", (lim_a, lim_b)):
                cs = con.execute("SELECT cs.code, cs.title FROM case_events ce JOIN cases cs ON cs.id=ce.case_id WHERE ce.event_id=?", (eid,)).fetchall()
                when = datetime.fromtimestamp(start, timezone.utc)
                items.append({"kind": "event", "id": eid, "title": title or "(sin título)", "when": when.isoformat(), "urgency": _urgency(when, now), "email_id": None, "email_subject": None,
                              "email_from": None, "cases": [{"code": c, "title": t} for c, t in cs], "why": f"Evento de {cal}" + (f" con {n} invitado(s)" if n else ""), "action": "agenda"})
            summary["proposals"] = con.execute("SELECT count(*) FROM case_links WHERE status='proposed'").fetchone()[0]
        finally:
            con.close()
    order = {"overdue": 0, "today": 1, "soon": 2, "week": 3, "later": 4, "open": 5}
    items.sort(key=lambda i: (order[i["urgency"]], i["when"] or "9999"))
    groups = [("overdue", "Vencido"), ("today", "Hoy"), ("soon", "Próximas 72 horas"), ("week", "Esta semana"), ("later", "Más adelante"), ("open", "Abierto, sin plazo")]
    sections = [{"key": k, "title": title, "items": [i for i in items if i["urgency"] == k][:30]} for k, title in groups]
    return {"generated_at": now.isoformat(), "source": src, "summary": {**summary, "total": len(items), **{k: sum(1 for i in items if i["urgency"] == k) for k, _ in groups}},
            "sections": [s for s in sections if s["items"]]}


@router.get("/agenda")
def agenda(days: int = Query(14, ge=1, le=90), back: int = Query(0, ge=0, le=30)) -> dict:
    con, src = open_agent_db()
    if con is None:
        return {"source": src, "days": []}
    try:
        now = time.time()
        rows = con.execute("""SELECT e.id, e.calendar, e.title, e.start_at, e.end_at, e.all_day, e.location,
                              (SELECT count(*) FROM calendar_attendees a WHERE a.event_id=e.id AND coalesce(a.is_self,0)=0) FROM calendar_events e
                              WHERE e.start_at BETWEEN ? AND ? ORDER BY e.start_at LIMIT 400""", (now - back * 86400, now + days * 86400)).fetchall()
        by_day: dict[str, list[dict]] = {}
        for eid, cal, title, start, end, all_day, loc, n in rows:
            cs = con.execute("SELECT cs.code, cs.title FROM case_events ce JOIN cases cs ON cs.id=ce.case_id WHERE ce.event_id=?", (eid,)).fetchall()
            day = time.strftime("%Y-%m-%d", time.localtime(start))
            by_day.setdefault(day, []).append({"id": eid, "calendar": cal, "title": title or "(sin título)", "start": _iso(start), "end": _iso(end), "all_day": bool(all_day),
                                               "location": loc, "attendees": n, "cases": [{"code": c, "title": t} for c, t in cs]})
        return {"source": src, "days": [{"date": d, "events": ev} for d, ev in by_day.items()]}
    finally:
        con.close()


@router.get("/cases")
def cases() -> dict:
    con, src = open_agent_db()
    if con is None:
        return {"source": src, "cases": []}
    try:
        rows = con.execute("""SELECT cs.code, cs.title, cs.kind,
            (SELECT count(*) FROM case_links WHERE case_id=cs.id AND ref_kind='group' AND status IN ('confirmed','provisional')),
            (SELECT count(*) FROM case_mail WHERE case_id=cs.id), (SELECT count(*) FROM case_events WHERE case_id=cs.id),
            (SELECT count(*) FROM case_links WHERE case_id=cs.id AND status='proposed') FROM cases cs ORDER BY cs.id""").fetchall()
        return {"source": src, "cases": [{"code": r[0], "title": r[1], "kind": r[2], "groups": r[3], "mail": r[4], "events": r[5], "proposals": r[6]} for r in rows]}
    finally:
        con.close()


@router.get("/cases/{code}")
def case_detail(code: str, limit: int = Query(40, le=200)) -> dict:
    con, src = open_agent_db()
    if con is None:
        raise HTTPException(503, "AION Agent no tiene datos en este entorno")
    try:
        row = con.execute("SELECT id, code, title, kind FROM cases WHERE code=?", (code,)).fetchone()
        if not row:
            raise HTTPException(404, "Caso no encontrado")
        seeds_case = next((c for c in _seeds().get("cases", []) if c.get("code") == code), {})
        kws = [i if isinstance(i, str) else (i.get("value") or i.get("pattern") or "") for i in seeds_case.get("keywords", [])]
        tl = [{"channel": ch, "at": _iso(t), "summary": s} for ch, t, s in con.execute("SELECT channel, t, summary FROM v_case_timeline WHERE case_id=? ORDER BY t DESC LIMIT ?", (row[0], limit))]
        orgs = [r[0] for r in con.execute("SELECT o.name FROM case_links cl JOIN orgs o ON o.id=cast(cl.ref_id AS integer) WHERE cl.case_id=? AND cl.ref_kind='org' AND cl.status IN ('confirmed','provisional') ORDER BY o.name LIMIT 30", (row[0],))]
        groups = [r[0] for r in con.execute("SELECT coalesce(ch.name, cl.ref_id) FROM case_links cl LEFT JOIN chats ch ON ch.jid=cl.ref_id WHERE cl.case_id=? AND cl.ref_kind='group' AND cl.status IN ('confirmed','provisional') ORDER BY 1 LIMIT 40", (row[0],))]
        return {"source": src, "code": row[1], "title": row[2], "kind": row[3], "keywords": kws, "organizations": orgs, "groups": groups, "timeline": tl}
    finally:
        con.close()


@router.get("/search")
def search(q: str = Query(..., min_length=2), top: int = Query(15, le=40)) -> dict:
    con, src = open_agent_db()
    if con is None or not _has(con, "fts"):
        if con:
            con.close()
        return {"source": src, "results": [], "message": "La búsqueda de texto completo necesita la copia completa de AION Agent."}
    try:
        words = [w for w in re.findall(r"[\wáéíóúüñ]+", q, re.I) if len(w) > 2]
        if not words:
            return {"source": src, "results": [], "message": "Escribe al menos una palabra de 3 letras."}
        hits = con.execute("SELECT ref_kind, ref_id FROM fts WHERE fts MATCH ? ORDER BY rank LIMIT ?", (" OR ".join(f'"{w}"' for w in words), top)).fetchall()
        out = []
        for kind, rid in hits:
            if kind == "mail":
                r = con.execute("SELECT received_at, coalesce(from_name, from_addr), substr(subject,1,200), substr(body_text,1,240) FROM mail_messages WHERE id=?", (rid,)).fetchone()
            elif kind == "event":
                r = con.execute("SELECT start_at, calendar, substr(title,1,200), substr(coalesce(description,''),1,240) FROM calendar_events WHERE id=?", (rid,)).fetchone()
            elif kind == "attachment":
                r = con.execute("SELECT a.occurred_at, c.name, 'Adjunto', substr(t.extracted_text,1,240) FROM attachments t JOIN atoms a ON a.id=t.atom_id LEFT JOIN chats c ON c.jid=a.chat_jid WHERE t.atom_id=?", (rid,)).fetchone()
            else:
                r = con.execute("SELECT a.occurred_at, c.name, '', substr(a.body_text,1,240) FROM atoms a LEFT JOIN chats c ON c.jid=a.chat_jid WHERE a.id=?", (rid,)).fetchone()
            if r:
                out.append({"kind": {"mail": "correo", "event": "agenda", "attachment": "adjunto"}.get(kind, "whatsapp"), "at": _iso(r[0]), "where": r[1], "title": r[2], "snippet": " ".join((r[3] or "").split())})
        return {"source": src, "results": out}
    finally:
        con.close()


class CommandIn(BaseModel):
    text: str
    session: str = "mail-ui"


def _command_token() -> str | None:
    for p in (os.environ.get("AIONAGENT_CMD_TOKEN_FILE"), "/opt/aionagent/data/.cmd_token", str(HOME / "aionagent_local/.cmd_token")):
        if p and Path(p).exists():
            return Path(p).read_text().strip()
    return None


@router.post("/command")
async def command(body: CommandIn) -> dict:
    token = _command_token()
    url = os.environ.get("AIONAGENT_CMD_URL", "http://127.0.0.1:18767/command")
    if not token:
        raise HTTPException(503, "AION Agent no está configurado en este entorno (falta la credencial del servidor de órdenes).")
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(url, json={"text": body.text[:1000], "session": f"{body.session}"[:80]}, headers={"Authorization": f"Bearer {token}"})
    except httpx.HTTPError as exc:
        raise HTTPException(503, f"No pude hablar con AION Agent: {type(exc).__name__}") from exc
    if r.status_code != 200:
        raise HTTPException(503, f"AION Agent rechazó la orden (HTTP {r.status_code})")
    return r.json()
