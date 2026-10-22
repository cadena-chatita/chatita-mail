"""
Schema drift guard. `Base.metadata.create_all` never ALTERs an existing table, so code that is newer than the
database fails with 500s (e.g. "column email_accounts.auth_type does not exist") while the UI just looks dead.

* `missing_columns()` compares the ORM models with the real database.
* `apply_additive()` adds ONLY missing columns (and their enum types); it never drops or rewrites anything.
* Development: applied automatically at startup. Production: never automatic; the problem is logged loudly and
  exposed by /health (`schema_missing`) so a deploy cannot silently leave the database behind.
"""
from __future__ import annotations

import logging

from sqlalchemy import Enum as SAEnum
from sqlalchemy import inspect, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncEngine

from backend.models import entities  # noqa: F401  (registers the models)
from backend.models.db import Base

log = logging.getLogger("chatita_mail.schema")


def _missing(sync_conn) -> list[tuple[str, str]]:
    insp = inspect(sync_conn)
    out = []
    for table in Base.metadata.sorted_tables:
        if not insp.has_table(table.name):
            out.append((table.name, "*"))               # whole table: create_all handles it
            continue
        have = {c["name"] for c in insp.get_columns(table.name)}
        out.extend((table.name, col.name) for col in table.columns if col.name not in have)
    return out


def enum_diff(existing: dict[str, set[str]], wanted: dict[str, list[str]]) -> list[tuple[str, str]]:
    """Enum labels the models use but the PostgreSQL type lacks (pure function, easy to test)."""
    return [(f"enum:{name}", label) for name, labels in wanted.items() if name in existing for label in labels if label not in existing[name]]


def _missing_enums(sync_conn) -> list[tuple[str, str]]:
    wanted = {c.type.name: list(c.type.enums) for t in Base.metadata.sorted_tables for c in t.columns if isinstance(c.type, SAEnum) and c.type.name}
    existing: dict[str, set[str]] = {}
    for typname, label in sync_conn.exec_driver_sql(
            "SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE pg_type_is_visible(t.oid)"):
        existing.setdefault(typname, set()).add(label)
    return enum_diff(existing, wanted)


async def missing_columns(engine: AsyncEngine) -> list[tuple[str, str]]:
    """Missing columns and missing enum labels, as (table, column) / (enum:type, label)."""
    async with engine.connect() as conn:
        return await conn.run_sync(_missing) + await conn.run_sync(_missing_enums)


def _apply(sync_conn) -> list[str]:
    done = []
    dialect = postgresql.dialect()
    for table_name, col_name in _missing(sync_conn):
        table = Base.metadata.tables[table_name]
        if col_name == "*":
            table.create(sync_conn, checkfirst=True)
            done.append(f"CREATE TABLE {table_name}")
            continue
        col = table.columns[col_name]
        if col.type.__class__.__name__ == "Enum":
            col.type.create(sync_conn, checkfirst=True)
        ddl = f'ALTER TABLE "{table_name}" ADD COLUMN IF NOT EXISTS "{col_name}" {col.type.compile(dialect=dialect)}'
        if col.server_default is not None and getattr(col.server_default, "arg", None) is not None:
            arg = col.server_default.arg
            ddl += f" DEFAULT {arg.text if hasattr(arg, 'text') else repr(arg)}"
        sync_conn.exec_driver_sql(ddl)                 # always nullable here: existing rows must stay valid
        done.append(ddl)
        default = col.default
        if default is not None and getattr(default, "is_scalar", False):
            # existing rows would otherwise hold NULL and break response models that expect the Python default
            sync_conn.execute(text(f'UPDATE "{table_name}" SET "{col_name}" = :v WHERE "{col_name}" IS NULL'), {"v": default.arg})
            done.append(f'BACKFILL {table_name}.{col_name} = {default.arg!r}')
    return done


def _backfill_nulls(sync_conn) -> list[str]:
    """NULLs in columns whose model default is a plain scalar (False, 0, 'connected'...): the ORM never writes NULL there."""
    done = []
    insp = inspect(sync_conn)
    for table in Base.metadata.sorted_tables:
        if not insp.has_table(table.name):
            continue
        have = {c["name"] for c in insp.get_columns(table.name)}
        for col in table.columns:
            d = col.default
            if col.name in have and d is not None and getattr(d, "is_scalar", False) and d.arg is not None and not col.primary_key:
                n = sync_conn.execute(text(f'UPDATE "{table.name}" SET "{col.name}" = :v WHERE "{col.name}" IS NULL'), {"v": d.arg}).rowcount
                if n:
                    done.append(f'BACKFILL {table.name}.{col.name} = {d.arg!r} ({n} rows)')
    return done


async def apply_additive(engine: AsyncEngine) -> list[str]:
    async with engine.begin() as conn:
        done = await conn.run_sync(_apply)
        done += await conn.run_sync(_backfill_nulls)
        enums = await conn.run_sync(_missing_enums)
    if enums:  # ALTER TYPE ... ADD VALUE needs its own autocommit transaction
        async with engine.connect() as raw:
            raw = await raw.execution_options(isolation_level="AUTOCOMMIT")
            for name, label in enums:
                await raw.exec_driver_sql(f'ALTER TYPE "{name.removeprefix("enum:")}" ADD VALUE IF NOT EXISTS \'{label}\'')
                done.append(f"ALTER TYPE {name.removeprefix('enum:')} ADD VALUE {label}")
    return done


async def check_and_maybe_fix(engine: AsyncEngine, auto_apply: bool) -> list[str]:
    """Returns the columns still missing after the check (empty list = schema in sync)."""
    try:
        missing = await missing_columns(engine)
        if not missing:
            if auto_apply:  # development: also repair NULLs left by columns added by an earlier run
                async with engine.begin() as conn:
                    for line in await conn.run_sync(_backfill_nulls):
                        log.warning("Schema repair: %s", line)
            return []
        names = [f"{t}.{c}" for t, c in missing]
        if auto_apply:
            applied = await apply_additive(engine)
            log.warning("Schema was behind the code; added %d object(s): %s", len(applied), "; ".join(applied))
            return [f"{t}.{c}" for t, c in await missing_columns(engine)]
        log.error("SCHEMA OUT OF DATE (run python -m scripts.setup_db): missing %s", ", ".join(names))
        return names
    except Exception as exc:  # noqa: BLE001 - the guard must never take the API down
        log.error("Schema check failed: %s", exc)
        return []
