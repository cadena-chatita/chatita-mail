"""AION Agent inside Chatita Mail: today / agenda / cases / search / email context (FICTITIOUS data, temp databases)."""
import asyncio
import sqlite3
import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.main import app
from backend.models.db import Base, get_session
from backend.models.entities import AccountProvider, Commitment, Email, EmailAccount, Task

NOW = datetime.now(timezone.utc)

AGENT_DDL = """
CREATE TABLE cases (id INTEGER PRIMARY KEY, code TEXT, title TEXT, kind TEXT, source TEXT);
CREATE TABLE case_links (case_id INTEGER, ref_kind TEXT, ref_id TEXT, evidence TEXT, score REAL, source TEXT, status TEXT);
CREATE TABLE case_mail (message_id TEXT, case_id INTEGER, score REAL, reasons TEXT);
CREATE TABLE case_events (event_id TEXT, case_id INTEGER, score REAL, reasons TEXT);
CREATE TABLE mail_observations (atom_id TEXT, account TEXT, provider TEXT, provider_message_id TEXT, status TEXT, is_read INTEGER);
CREATE TABLE mail_messages (id TEXT PRIMARY KEY, subject TEXT, body_text TEXT, from_addr TEXT, from_name TEXT, received_at INTEGER);
CREATE TABLE calendar_events (id TEXT PRIMARY KEY, calendar TEXT, title TEXT, start_at INTEGER, end_at INTEGER, all_day INTEGER, location TEXT, description TEXT);
CREATE TABLE calendar_attendees (event_id TEXT, email TEXT, phone TEXT, is_self INTEGER, status INTEGER);
CREATE TABLE atoms (id TEXT PRIMARY KEY, chat_jid TEXT, occurred_at INTEGER, body_text TEXT);
CREATE TABLE chats (jid TEXT PRIMARY KEY, name TEXT);
CREATE TABLE orgs (id INTEGER PRIMARY KEY, name TEXT);
CREATE VIRTUAL TABLE fts USING fts5(ref_kind UNINDEXED, ref_id UNINDEXED, text);
CREATE TABLE replica_meta (k TEXT PRIMARY KEY, v TEXT);
CREATE VIEW v_case_timeline AS SELECT cm.case_id, 'mail' AS channel, m.received_at AS t, m.subject AS summary, m.id AS ref FROM case_mail cm JOIN mail_messages m ON m.id=cm.message_id;
"""


def _agent_db(path):
    c = sqlite3.connect(path); c.executescript(AGENT_DDL)
    now = int(time.time())
    c.execute("INSERT INTO cases VALUES (1,'HMG','Hospital HMG','matter','x')")
    c.execute("INSERT INTO mail_messages VALUES ('aa_1','Honorarios del dictamen','Detalle de honorarios','ana@alfa.example','Ana',?)", (now - 3600,))
    c.execute("INSERT INTO mail_observations VALUES ('aa_1','owner@example.test','GMAIL','pm-123','INBOX',0)")
    c.execute("INSERT INTO case_mail VALUES ('aa_1',1,1,'x')")
    c.execute("INSERT INTO calendar_events VALUES ('ev1','Work','Junta del caso',?,?,0,'Oficina',NULL)", (now + 7200, now + 10800))
    c.execute("INSERT INTO calendar_attendees (event_id, email, is_self, status) VALUES ('ev1','x@y.example',0,2)"); c.execute("INSERT INTO case_events VALUES ('ev1',1,1,'x')")
    c.execute("INSERT INTO fts VALUES ('mail','aa_1','Honorarios del dictamen')")
    c.execute("INSERT INTO chats VALUES ('g1','Grupo HMG')"); c.execute("INSERT INTO atoms VALUES ('a1','g1',?,'Revisar el dictamen pericial')", (now,))
    c.execute("INSERT INTO fts VALUES ('atom','a1','Revisar el dictamen pericial')")
    c.execute("INSERT INTO replica_meta VALUES ('exported_at', ?)", (str(now),)); c.execute("INSERT INTO replica_meta VALUES ('tz','America/Denver')")
    c.commit(); c.close()


@pytest.fixture()
def client(tmp_path, monkeypatch):
    agent = tmp_path / "agent.db"; _agent_db(agent)
    monkeypatch.setenv("AIONAGENT_DB", str(agent)); monkeypatch.setenv("AIONAGENT_SEEDS", str(tmp_path / "nope.json"))
    eng = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/mail.db")
    Session = async_sessionmaker(eng, expire_on_commit=False)
    ids = {}

    async def seed():
        async with eng.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with Session() as s:
            acct = EmailAccount(provider=AccountProvider.GMAIL, email_address="owner@example.test"); s.add(acct); await s.flush()
            e = Email(account_id=acct.id, provider_message_id="pm-123", from_address="ana@alfa.example", from_name="Ana", subject="Honorarios del dictamen", body_text="x", received_at=NOW)
            e2 = Email(account_id=acct.id, provider_message_id="pm-999", from_address="x@y.example", subject="Otro", body_text="y", received_at=NOW)
            old = Email(account_id=acct.id, provider_message_id="pm-old", from_address="z@y.example", subject="Viejo", body_text="z", received_at=datetime(2025, 3, 1, tzinfo=timezone.utc))
            s.add_all([e, e2, old]); await s.flush()
            s.add(Commitment(email_id=old.id, who="me", what="Compromiso de 2025", deadline=NOW - timedelta(days=400), status="pending"))
            s.add(Commitment(email_id=e.id, who="sender", what="Confirmar la fecha", deadline=NOW + timedelta(days=3), status="pending"))
            s.add_all([Task(email_id=e.id, description="Pagar honorarios", priority="high", task_type="payment", status="pending", deadline=NOW - timedelta(days=1)),
                       Task(email_id=e.id, description="Responder a Ana", task_type="reply", status="pending", deadline=NOW + timedelta(hours=10)),
                       Task(email_id=e2.id, description="Sin plazo", status="pending"),
                       Commitment(email_id=e.id, who="me", what="Enviar el dictamen", deadline=NOW + timedelta(days=2), status="pending")])
            await s.commit(); ids.update(e=e.id, e2=e2.id)
    asyncio.run(seed())

    async def override():
        async with Session() as s:
            yield s
    app.dependency_overrides[get_session] = override
    yield TestClient(app, raise_server_exceptions=True), ids
    app.dependency_overrides.clear()
    asyncio.run(eng.dispose())


def test_today_orders_by_urgency_and_links_every_item_to_its_email_and_case(client):
    c, ids = client
    r = c.get("/api/agent/today").json()
    keys = [s["key"] for s in r["sections"]]
    assert keys == ["overdue", "today", "soon", "open"] or keys[:2] == ["overdue", "today"]
    flat = {i["title"]: i for s in r["sections"] for i in s["items"]}
    pay = flat["Pagar honorarios"]
    assert pay["urgency"] == "overdue" and pay["email_id"] == ids["e"] and [(c["code"], c["title"]) for c in pay["cases"]] == [("HMG", "Hospital HMG")] and pay["cases"][0]["color"].startswith("#") and pay["email_subject"] == "Honorarios del dictamen"
    assert flat["Responder a Ana"]["action"] == "reply" and flat["Responder a Ana"]["urgency"] == "today" and flat["Responder a Ana"]["suggestion"] == "Responder a Ana"
    assert flat["Pagar honorarios"]["suggestion"] == "Revisar el monto y registrar el pago" and flat["Pagar honorarios"]["email_excerpt"] == "x" and flat["Pagar honorarios"]["case_latest"]["channel"] == "mail"
    assert flat["Junta del caso"]["suggestion"] == "Preparar: revisa lo último del caso HMG"
    assert flat["Tú: Enviar el dictamen"]["kind"] == "commitment" and "Remitente: Confirmar la fecha" in flat and flat["Sin plazo"]["urgency"] == "open" and flat["Sin plazo"]["cases"] == []
    assert flat["Junta del caso"]["kind"] == "event" and flat["Junta del caso"]["cases"][0]["code"] == "HMG"
    assert r["source"]["kind"] == "local" and r["summary"]["overdue"] == 1
    assert "Compromiso de 2025" not in flat and "Tú: Compromiso de 2025" not in flat                       # pre-cutoff backlog does not bury today's work


def test_email_context_gives_subject_sender_and_cases_for_task_rows(client):
    c, ids = client
    r = c.get("/api/agent/email-context", params={"ids": f"{ids['e']},{ids['e2']},desconocido"}).json()["items"]
    assert r[ids["e"]]["cases"][0]["code"] == "HMG" and r[ids["e"]]["subject"] == "Honorarios del dictamen" and r[ids["e"]]["from"] == "Ana"
    assert r[ids["e2"]]["cases"] == [] and "desconocido" not in r


def test_agenda_cases_case_detail_and_search(client):
    c, _ = client
    ag = c.get("/api/agent/agenda?days=3").json()
    assert ag["days"][0]["events"][0]["title"] == "Junta del caso" and ag["days"][0]["events"][0]["cases"][0]["code"] == "HMG" and ag["days"][0]["events"][0]["attendees"] == 1
    cs = c.get("/api/agent/cases").json()["cases"]
    assert cs[0]["code"] == "HMG" and cs[0]["mail"] == 1 and cs[0]["events"] == 1
    d = c.get("/api/agent/cases/HMG").json()
    assert d["timeline"][0]["summary"] == "Honorarios del dictamen" and c.get("/api/agent/cases/NOPE").status_code == 404
    assert d["color"].startswith("#") and d["upcoming_events"][0]["title"] == "Junta del caso" and d["activity_30d"].get("mail") == 1
    assert {i["title"] for i in d["open_items"]} >= {"Pagar honorarios", "Responder a Ana"}                               # open work of this case, found through its mail
    assert cs[0]["last_activity"] is not None
    s = c.get("/api/agent/search", params={"q": "dictamen"}).json()["results"]
    assert {x["kind"] for x in s} == {"correo", "whatsapp"} and "dictamen" in " ".join(x["snippet"] + x["title"] for x in s).lower()
    assert c.get("/api/agent/search", params={"q": "a "}).status_code in (200, 422)


def test_without_agent_data_everything_degrades_to_an_explicit_empty_state(client, monkeypatch, tmp_path):
    c, _ = client
    monkeypatch.setenv("AIONAGENT_DB", str(tmp_path / "missing.db"))
    from backend.routes import agent
    monkeypatch.setattr(agent, "_candidates", lambda: [("local", tmp_path / "missing.db")])
    assert c.get("/api/agent/status").json()["available"] is False
    t = c.get("/api/agent/today").json()
    assert t["source"]["kind"] == "none" and any(i["kind"] == "task" for s in t["sections"] for i in s["items"])     # Chatita's own tasks still show
    assert c.get("/api/agent/agenda").json()["days"] == [] and c.get("/api/agent/cases/HMG").status_code == 503
    assert c.post("/api/agent/command", json={"text": "casos"}).status_code == 503                                       # no credential here


def test_stale_full_copy_is_ignored(tmp_path, monkeypatch):
    from backend.routes import agent
    p = tmp_path / "full.db"; _agent_db(p)
    c = sqlite3.connect(p); c.execute("UPDATE replica_meta SET v='1' WHERE k='exported_at'"); c.commit(); c.close()
    monkeypatch.setattr(agent, "_candidates", lambda: [("full", p)])
    assert agent.open_agent_db()[1]["kind"] == "none"


def test_a_replica_without_mail_observations_still_serves_today(client, monkeypatch, tmp_path):
    c, ids = client
    p = tmp_path / "old_replica.db"; _agent_db(p)
    con = sqlite3.connect(p); con.execute("DROP TABLE mail_observations"); con.commit(); con.close()
    from backend.routes import agent
    monkeypatch.setattr(agent, "_candidates", lambda: [("light", p)])
    t = c.get("/api/agent/today").json()
    pay = next(i for s in t["sections"] for i in s["items"] if i["title"] == "Pagar honorarios")
    assert pay["cases"] == [] and pay["email_id"] == ids["e"]
