"""
Chatita Mail — task value filter, extractor merge and lifecycle tests (offline).

Covers Quipu DISENO_07 rules: V1 V2 V3 V4 V5 V6 V8 V9, the 2026-10-01 cutoff,
and "completing a task settles it" (no resurrection, duplicates closed).
"""
import asyncio
import json
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.config import settings
from backend.models.entities import Base, Email, EmailAccount, AccountProvider, Task
from backend.services.workflow.task_extractor import TaskExtractor
from backend.services.workflow.task_lifecycle import set_status
from backend.services.workflow.task_value import (
    filter_tasks,
    fingerprint,
    is_bulk_sender,
    is_sensitive,
    is_vague,
)

NOW = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)


# ── Pure rules ──────────────────────────────────────────────
def test_fingerprint_ignores_case_accents_punctuation():
    assert fingerprint("Pagar la factura, ¡hoy!") == fingerprint("pagar la factura hoy")
    assert fingerprint("pay 100") != fingerprint("pay 200")


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Use verification code 498395 within 10 minutes", True),
        ("Introduce el código de verificación 123456", True),
        ("password: hunter2", True),
        ("Card 4111 1111 1111 1111 expires soon", True),
        ("Pay the invoice 1234 by Friday", False),
        ("Send the signed contract to the notary", False),
    ],
)
def test_sensitive_detection(text, expected):
    assert is_sensitive(text) is expected


def test_vague_rule():
    assert is_vague("Review prohibited items for checked bags", has_deadline=False)
    assert not is_vague("Review contract by Friday", has_deadline=True)
    assert not is_vague("Review the Q3 budget", has_deadline=False)  # has a digit
    assert not is_vague("Pay the outstanding balance", has_deadline=False)


@pytest.mark.parametrize(
    "addr,expected",
    [
        ("deltaairlines@t.delta.com", True),
        ("americanexpress@welcome.americanexpress.com", True),
        ("noreply@service.com", True),
        ("ana@lawfirm.com", False),
        ("ernesto.avila@sunflowerbank.com", False),
    ],
)
def test_bulk_sender(addr, expected):
    assert is_bulk_sender(addr) is expected
    assert is_bulk_sender("ana@lawfirm.com", is_newsletter=True)


def _t(desc, priority="medium", deadline=None):
    return {"description": desc, "priority": priority, "deadline": deadline, "task_type": "other"}


def test_v5_expired_on_arrival_and_v6_sensitive_are_dropped():
    arrival = NOW
    res = filter_tasks(
        [
            _t("Send the report", deadline=NOW - timedelta(days=3)),
            _t("Use verification code 123456 to continue"),
            _t("Send the quarterly report to Ana", deadline=NOW + timedelta(days=2)),
        ],
        from_address="ana@lawfirm.com", received_at=arrival, bulk=False, now=NOW,
    )
    assert [t["description"] for t in res.kept] == ["Send the quarterly report to Ana"]
    assert {r for _, r in res.dropped} == {"V5:caducada_al_llegar", "V6:dato_sensible"}


def test_v4_cap_keeps_highest_value_first():
    cands = [
        _t("Sign the lease amendment for the Lehi office", "high", NOW + timedelta(days=1)),
        _t("Reply to the investor about the term sheet", "high"),
        _t("Schedule a call with the accountant", "medium"),
        _t("Update the shared spreadsheet with notes", "low"),
        _t("Reorganize the folder of old documents", "low"),
    ]
    res = filter_tasks(cands, from_address="x@y.com", received_at=NOW, bulk=False, now=NOW, max_per_email=3)
    assert len(res.kept) == 3
    assert res.kept[0]["description"].startswith("Sign the lease")
    assert sum(1 for _, r in res.dropped if r == "V4:tope_por_correo") == 2


def test_v1_bulk_notice_keeps_one_task_with_a_signal():
    cands = [
        _t("Prepay for checked bag fees during check-in"),  # no amount, no deadline
        _t("Pay the outstanding balance of USD 1,783.29", "high"),
        _t("Pay the card statement of MX$14,093.23", "high", NOW + timedelta(days=5)),
    ]
    res = filter_tasks(cands, from_address="a@t.delta.com", received_at=NOW, bulk=True, now=NOW)
    assert len(res.kept) == 1
    reasons = {r for _, r in res.dropped}
    assert "V1:aviso_transaccional_sin_senal" in reasons and "V1:un_solo_task_por_aviso" in reasons


def test_v9_strict_fallback_requires_deadline_or_amount():
    res = filter_tasks([_t("Pay the annual membership")], from_address="x@y.com", received_at=NOW,
                       bulk=False, now=NOW, strict=True)
    assert res.kept == [] and res.dropped[0][1].startswith("V9")


# ── Extractor + lifecycle on a throwaway SQLite database ────────────────────
class _FakeAion:
    def __init__(self, tasks):
        self.payload = json.dumps({"tasks": tasks, "commitments": []})

    async def orchestrate(self, *a, **k):
        return {"text": self.payload}


def _run(coro):
    return asyncio.run(coro)


async def _session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return async_sessionmaker(engine, expire_on_commit=False)()


async def _email(session, *, sender="ana@lawfirm.com", received=NOW, subject="Contract"):
    acct = await session.scalar(select(EmailAccount))
    if acct is None:
        acct = EmailAccount(provider=AccountProvider.GMAIL, email_address="owner@example.com")
        session.add(acct)
        await session.flush()
    e = Email(account_id=acct.id, provider_message_id=f"{sender}-{received.isoformat()}-{subject}",
              from_address=sender, subject=subject, body_text="Please act.", received_at=received)
    session.add(e)
    await session.flush()
    return e


TASKS = [
    {"description": "Send the signed contract to the notary", "priority": "high",
     "deadline": (NOW + timedelta(days=3)).isoformat(), "task_type": "document"},
    {"description": "Reply to Ana about the payment schedule", "priority": "medium", "deadline": None,
     "task_type": "reply"},
]


def test_cutoff_skips_old_emails_unless_forced():
    async def go():
        s = await _session()
        old = await _email(s, received=datetime(2026, 9, 15, tzinfo=timezone.utc), subject="old")
        ex = TaskExtractor(aion=_FakeAion(TASKS))
        r = await ex.extract_and_persist(s, old)
        assert r.source == "skipped_before_cutoff"
        assert (await s.scalars(select(Task))).all() == []
        r2 = await ex.extract_and_persist(s, old, force=True)
        assert len(r2.tasks) == 2
    _run(go())


def test_reextraction_never_resurrects_closed_tasks():
    async def go():
        s = await _session()
        e = await _email(s)
        ex = TaskExtractor(aion=_FakeAion(TASKS))
        await ex.extract_and_persist(s, e)
        tasks = (await s.scalars(select(Task))).all()
        assert len(tasks) == 2
        done = next(t for t in tasks if "contract" in t.description)
        await set_status(s, done, "done")
        assert done.completed_at is not None and done.closed_via == "user"

        await ex.extract_and_persist(s, e, replace=True)  # the old code deleted and recreated as pending
        again = (await s.scalars(select(Task))).all()
        assert len(again) == 2
        assert next(t for t in again if "contract" in t.description).status == "done"
        assert sum(1 for t in again if t.status == "pending") == 1
    _run(go())


def test_same_obligation_from_same_sender_is_not_recreated():
    async def go():
        s = await _session()
        e1 = await _email(s, subject="first")
        e2 = await _email(s, subject="reminder", received=NOW + timedelta(days=1))
        ex = TaskExtractor(aion=_FakeAion(TASKS))
        await ex.extract_and_persist(s, e1)
        await ex.extract_and_persist(s, e2)
        assert len((await s.scalars(select(Task))).all()) == 2  # not 4
    _run(go())


def test_completing_a_task_settles_pending_duplicates_of_the_same_sender():
    async def go():
        s = await _session()
        e1 = await _email(s, subject="a")
        e2 = await _email(s, subject="b")
        t1 = Task(email_id=e1.id, description="Pay the card statement", status="pending")
        t2 = Task(email_id=e2.id, description="Pay the card statement!", status="pending")
        other = Task(email_id=e2.id, description="Something else entirely", status="pending")
        s.add_all([t1, t2, other])
        await s.flush()
        settled = await set_status(s, t1, "done")
        assert [t.id for t in settled] == [t2.id]
        assert t2.status == "done" and t2.closed_via == "duplicate"
        assert other.status == "pending"
        # reopening clears the stamp
        await set_status(s, t1, "pending")
        assert t1.completed_at is None and t1.closed_via is None
    _run(go())


def test_default_cutoff_is_october_first_2026():
    assert settings.task_extract_since.startswith("2026-10-01")


@pytest.mark.parametrize(
    "a,b,expected",
    [
        ("Inform PCBWay that the component fee has been paid so assembly can proceed", "Inform PCBWay that the component fee has been paid", True),
        ("Pay the PCBWay component fee through order G1686168", "Inform PCBWay that the component fee has been paid", False),   # paying and informing are two obligations
        ("Pagar $500 a Proveedor X", "Pagar $900 a Proveedor X", False),                                                      # different amounts never merge
        ("Send the signed contract to the notary", "Reply to Ana about the payment schedule", False),
        ("Enviar el contrato firmado al notario", "Enviar al notario el contrato firmado", True),
        ("", "Pay the invoice", False),
    ],
)
def test_same_obligation_rule(a, b, expected):
    from backend.services.workflow.task_value import same_obligation
    assert same_obligation(a, b) is expected


def test_paraphrases_within_one_extraction_and_across_emails_become_one_task():
    para = [
        {"description": "Inform PCBWay that the component fee has been paid so assembly can proceed", "priority": "high", "deadline": None, "task_type": "reply"},
        {"description": "Inform PCBWay that the component fee has been paid", "priority": "high", "deadline": None, "task_type": "reply"},
        {"description": "Pay the PCBWay component fee through order G1686168", "priority": "high", "deadline": None, "task_type": "payment"},
    ]

    async def go():
        s = await _session()
        e1 = await _email(s, sender="svc@pcbway.example", subject="fee")
        e2 = await _email(s, sender="svc@pcbway.example", subject="fee reminder", received=NOW + timedelta(days=1))
        ex = TaskExtractor(aion=_FakeAion(para))
        r1 = await ex.extract_and_persist(s, e1)
        assert len(r1.tasks) == 2 and any("misma_obligacion" in why for _, why in r1.dropped)
        await ex.extract_and_persist(s, e2)
        assert len((await s.scalars(select(Task))).all()) == 2                                      # the reminder adds nothing
    _run(go())


def test_closing_a_task_also_settles_its_paraphrase_from_the_same_sender():
    async def go():
        s = await _session()
        e1 = await _email(s, subject="a"); e2 = await _email(s, subject="b")
        t1 = Task(email_id=e1.id, description="Inform PCBWay that the component fee has been paid", status="pending")
        t2 = Task(email_id=e2.id, description="Inform PCBWay that the component fee has been paid so assembly can proceed", status="pending")
        s.add_all([t1, t2]); await s.flush()
        settled = await set_status(s, t1, "done")
        assert [t.id for t in settled] == [t2.id] and t2.closed_via == "duplicate"
    _run(go())
