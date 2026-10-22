"""Schema drift guard. The database work happens inside ONE transaction that is rolled back, so nothing is left behind."""
import asyncio

import pytest
from sqlalchemy.ext.asyncio import create_async_engine

from backend.config import settings
from backend.models.db import Base
from backend.services import schema_sync


async def _drift_roundtrip():
    eng = create_async_engine(settings.database_url)
    try:
        async with eng.connect() as conn:
            trans = await conn.begin()
            await conn.exec_driver_sql("CREATE SCHEMA drift_probe")
            await conn.exec_driver_sql("SET LOCAL search_path TO drift_probe")
            await conn.run_sync(Base.metadata.create_all)
            await conn.exec_driver_sql("ALTER TABLE tasks DROP COLUMN completed_at")         # a database behind the code
            await conn.exec_driver_sql("ALTER TABLE email_accounts DROP COLUMN auth_type")
            before = await conn.run_sync(schema_sync._missing)
            applied = await conn.run_sync(schema_sync._apply)
            after = await conn.run_sync(schema_sync._missing)
            await trans.rollback()
        return before, applied, after
    finally:
        await eng.dispose()


def test_drift_is_detected_and_healed_additively():
    try:
        before, applied, after = asyncio.run(_drift_roundtrip())
    except OSError:
        pytest.skip("no local PostgreSQL")
    assert ("tasks", "completed_at") in before and ("email_accounts", "auth_type") in before
    assert after == [] and any("completed_at" in a for a in applied)
    assert all(a.startswith("ALTER TABLE") for a in applied)                                  # only additions


def test_production_policy_warns_and_never_changes(monkeypatch):
    calls = []
    async def fake_missing(_e): return [("tasks", "completed_at")]
    async def fake_apply(_e): calls.append("apply"); return ["x"]
    monkeypatch.setattr(schema_sync, "missing_columns", fake_missing)
    monkeypatch.setattr(schema_sync, "apply_additive", fake_apply)
    assert asyncio.run(schema_sync.check_and_maybe_fix(None, auto_apply=False)) == ["tasks.completed_at"] and calls == []
    assert asyncio.run(schema_sync.check_and_maybe_fix(None, auto_apply=True)) == ["tasks.completed_at"] and calls == ["apply"]


def test_enum_labels_the_code_uses_but_the_type_lacks_are_reported():
    diff = schema_sync.enum_diff({"emailstatus": {"INBOX", "ARCHIVED"}, "other": {"A"}}, {"emailstatus": ["INBOX", "ARCHIVED", "SENT"], "newtype": ["X"]})
    assert diff == [("enum:emailstatus", "SENT")]                                              # a type that does not exist yet is created by create_all, not here
