"""
Chatita Mail v3.0 — Database setup.

Creates the database (if missing), enables pgvector (best-effort),
creates all ORM tables, and adds the pgvector column to `embeddings`.

Usage:
    python -m scripts.setup_db
"""
import asyncio
import sys

import asyncpg
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

# Ensure project root importable
sys.path.insert(0, ".")

from backend.config import settings  # noqa: E402
from backend.models.db import Base  # noqa: E402
from backend.models import entities  # noqa: E402,F401 (register models)


async def ensure_database_exists() -> None:
    """Create the target database if it does not exist."""
    # Parse sync URL: postgresql://user@host:port/dbname
    url = settings.database_url_sync.replace("postgresql://", "")
    creds, _, host_db = url.partition("@")
    user = creds.split(":")[0]
    password = creds.split(":")[1] if ":" in creds else None
    host_port, _, dbname = host_db.partition("/")
    host = host_port.split(":")[0]
    port = int(host_port.split(":")[1]) if ":" in host_port else 5432

    conn = await asyncpg.connect(
        user=user, password=password, host=host, port=port, database="postgres"
    )
    exists = await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", dbname)
    if not exists:
        await conn.execute(f'CREATE DATABASE "{dbname}"')
        print(f"[setup_db] Created database '{dbname}'")
    else:
        print(f"[setup_db] Database '{dbname}' already exists")
    await conn.close()


async def create_schema() -> None:
    """Enable pgvector, create tables, add vector column."""
    engine = create_async_engine(settings.database_url, echo=False)

    async with engine.begin() as conn:
        # pgvector is optional (used in Phase 2+). Best-effort.
        try:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            print("[setup_db] pgvector extension enabled")
            has_vector = True
        except Exception as exc:  # noqa: BLE001
            print(f"[setup_db] pgvector NOT available (ok for Phase 1): {exc}")
            has_vector = False

        await conn.run_sync(Base.metadata.create_all)
        print("[setup_db] Tables created")

        # Idempotent column migrations for pre-existing installs (create_all
        # does not ALTER existing tables).
        for stmt in (
            "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ",
            "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS closed_via VARCHAR(20)",
            "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS last_history_id VARCHAR(64)",
            "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS sync_status VARCHAR(32) DEFAULT 'idle'",
            "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS auth_type VARCHAR(16)",
            "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS status VARCHAR(16) DEFAULT 'connected'",
            "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS color VARCHAR(9)",
            "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS credentials_enc TEXT",
            "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS last_error TEXT",
            "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS imap_host VARCHAR(255)",
            "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS imap_port INTEGER",
            "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS smtp_host VARCHAR(255)",
            "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS smtp_port INTEGER",
            "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT FALSE",
            "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0",
            "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
        ):
            await conn.execute(text(stmt))
        print("[setup_db] email_accounts columns ensured (sync + multi-account)")
    # ALTER TYPE ... ADD VALUE needs its own (autocommit) transaction.
    async with engine.connect() as ac:
        ac = await ac.execution_options(isolation_level="AUTOCOMMIT")
        await ac.execute(text("ALTER TYPE accountprovider ADD VALUE IF NOT EXISTS 'MICROSOFT'"))
        print("[setup_db] accountprovider enum has MICROSOFT")
    async with engine.begin() as conn:

        if has_vector:
            # Add 1024-dim vector column (BGE-M3) if not present
            await conn.execute(
                text(
                    "ALTER TABLE embeddings "
                    "ADD COLUMN IF NOT EXISTS vector vector(1024)"
                )
            )
            print("[setup_db] embeddings.vector column ensured (1024-dim)")

    async with engine.connect() as conn:
        result = await conn.execute(
            text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public' ORDER BY table_name"
            )
        )
        tables = [row[0] for row in result.fetchall()]
        print(f"[setup_db] Tables in DB ({len(tables)}): {', '.join(tables)}")

    await engine.dispose()


async def main() -> None:
    await ensure_database_exists()
    await create_schema()
    print("[setup_db] ✅ Done")


if __name__ == "__main__":
    asyncio.run(main())
